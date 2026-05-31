import * as XLSX from "xlsx";
import { storage } from "./storage";

const OWN_COLLECTOR_ID = "1852295299";
const OWN_EMAIL = "vegetalesargentinos.srl@gmail.com";

function isSelf(value: string): boolean {
  const v = value.toLowerCase().trim();
  return v === OWN_COLLECTOR_ID || v === `mp:${OWN_COLLECTOR_ID}` || v === OWN_EMAIL;
}

function classifyMpId(value: string, merchantId: string): string | null {
  const v = value.replace(/[\s-]/g, "");
  if (!v || v === "0" || v === merchantId || v === OWN_COLLECTOR_ID) return null;
  if (/^\d{4,}$/.test(v)) return `mp:${v}`;
  return null;
}

/** Normalize header string: uppercase, remove accents, trim */
function normHeader(s: string): string {
  return String(s ?? "").toUpperCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Parse date from XLSX cell value to YYYY-MM-DD */
function parseXlsxDate(val: any): string {
  if (!val) return "";
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY
  const dm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dm) return `${dm[3]}-${String(dm[2]).padStart(2, "0")}-${String(dm[1]).padStart(2, "0")}`;
  return s.slice(0, 10);
}

/** Parse numeric value from XLSX cell (may be number or string with comma decimal) */
function parseNum(val: any): number {
  if (typeof val === "number") return val;
  return parseFloat(String(val ?? "0").replace(",", ".")) || 0;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const pad2 = (n: number) => String(n).padStart(2, "0");

export async function syncMpReport(token: string): Promise<{
  synced: number;
  skipped: number;
  xlsxSynced: number;
  reportFile: string | null;
  details: string;
}> {
  const BASE = "https://api.mercadopago.com";
  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const toUpsert: { movementId: string; payerIdentifier: string; payerName?: string | null; rawExternalId?: string | null }[] = [];
  let skipped = 0;
  const details: string[] = [];

  // ── 1. Sync payer identifiers from Payments API ───────────────────────────
  try {
    const now = new Date();
    const from = new Date(now); from.setMonth(now.getMonth() - 3);
    const isoFrom = `${from.getFullYear()}-${pad2(from.getMonth()+1)}-${pad2(from.getDate())}T00:00:00.000-03:00`;
    const isoTo   = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}T23:59:59.999-03:00`;

    let offset = 0;
    const LIMIT = 100;
    const allPayments: any[] = [];

    while (true) {
      const url = `${BASE}/v1/payments/search?range=date_created&begin_date=${encodeURIComponent(isoFrom)}&end_date=${encodeURIComponent(isoTo)}&sort=date_created&criteria=desc&limit=${LIMIT}&offset=${offset}`;
      const r = await fetch(url, { headers: authHeaders });
      if (!r.ok) { details.push(`payments API error: ${r.status}`); break; }
      const body = await r.json();
      const page: any[] = body.results ?? body.elements ?? [];
      allPayments.push(...page);
      if (page.length < LIMIT) break;
      if (offset >= 5000) break;
      offset += LIMIT;
    }

    details.push(`payments fetched: ${allPayments.length}`);

    // Detect merchantId
    const freq = new Map<string, number>();
    for (const p of allPayments) {
      const cid = String(p.collector_id ?? p.collector?.id ?? "");
      if (cid && cid !== "0") freq.set(cid, (freq.get(cid) ?? 0) + 1);
    }
    let merchantId = OWN_COLLECTOR_ID;
    let best = 0;
    for (const [id, n] of freq) { if (n > best) { best = n; merchantId = id; } }
    details.push(`merchantId: ${merchantId}`);

    for (const p of allPayments) {
      const movId = String(p.id ?? "");
      if (!movId || movId === "0") { skipped++; continue; }

      const collId = String(p.collector_id ?? p.collector?.id ?? "");
      const isIncoming = collId === merchantId;

      if (isIncoming) {
        const pbi = p.transaction_details?.payer_bank_info;
        const cbu = String(pbi?.cbu ?? pbi?.account_id ?? "").replace(/[\s-]/g, "");
        if (cbu.length >= 11 && !isSelf(cbu)) {
          toUpsert.push({ movementId: movId, payerIdentifier: cbu, payerName: String(pbi?.owner_name ?? "").trim() || null, rawExternalId: `payer_bank_info.cbu` });
          continue;
        }

        const payerId = String(p.payer_id ?? p.payer?.id ?? "");
        const mpId = classifyMpId(payerId, merchantId);
        if (mpId && !isSelf(mpId)) {
          const firstName = String(p.payer?.first_name ?? "").trim();
          const lastName  = String(p.payer?.last_name  ?? "").trim();
          const payerName = [firstName, lastName].filter(Boolean).join(" ") || null;
          toUpsert.push({ movementId: movId, payerIdentifier: mpId, payerName, rawExternalId: `payer.id` });
          continue;
        }

        const email = String(p.payer?.email ?? "").toLowerCase().trim();
        if (email && email.includes("@") && !email.includes("noreply") && !isSelf(email)) {
          toUpsert.push({ movementId: movId, payerIdentifier: email, payerName: null, rawExternalId: "payer.email" });
          continue;
        }
      }
      skipped++;
    }
  } catch (e: any) {
    details.push(`payments sync error: ${e.message}`);
  }

  // ── 2. On-demand report — generate, poll (up to 90s), download, parse ─────
  let reportFile: string | null = null;
  let xlsxSynced = 0;
  try {
    const now = new Date();
    const begin = new Date(now); begin.setDate(begin.getDate() - 35);
    const beginStr = `${begin.getUTCFullYear()}-${pad2(begin.getUTCMonth()+1)}-${pad2(begin.getUTCDate())}T00:00:00Z`;
    const endStr   = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth()+1)}-${pad2(now.getUTCDate())}T23:59:59Z`;

    // Capture existing report file_names before POST
    const existingNames = new Set<string>();
    try {
      const lr = await fetch(`${BASE}/v1/account/release_report/list`, { headers: authHeaders });
      if (lr.ok) {
        const reports: any[] = await lr.json() ?? [];
        for (const r of reports) { if (r.file_name) existingNames.add(r.file_name); }
        details.push(`reports before POST: ${reports.length}`);
      }
    } catch (_) {}

    // POST to generate on-demand
    const postTime = Date.now();
    let postOk = false;
    try {
      const pr = await fetch(`${BASE}/v1/account/release_report`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ begin_date: beginStr, end_date: endStr, format: "XLSX" }),
      });
      if ([200, 201, 202].includes(pr.status)) {
        postOk = true;
        details.push(`POST report: ${pr.status}`);
      } else {
        // Fallback: query params
        const pr2 = await fetch(
          `${BASE}/v1/account/release_report?begin_date=${encodeURIComponent(beginStr)}&end_date=${encodeURIComponent(endStr)}`,
          { method: "POST", headers: authHeaders },
        );
        if ([200, 201, 202].includes(pr2.status)) {
          postOk = true;
          details.push(`POST report (qp): ${pr2.status}`);
        } else {
          details.push(`POST report failed: ${pr.status} / ${pr2.status}`);
        }
      }
    } catch (e: any) { details.push(`POST report error: ${e.message}`); }

    // Poll up to 90s (18 × 5s) for the new report to appear in the list
    let newReport: any = null;
    if (postOk) {
      for (let i = 0; i < 18; i++) {
        await sleep(5000);
        try {
          const lr = await fetch(`${BASE}/v1/account/release_report/list`, { headers: authHeaders });
          if (!lr.ok) continue;
          const list: any[] = await lr.json() ?? [];
          const sorted = [...list].sort((a, b) =>
            new Date(b.date_created ?? b.created_at ?? b.created_from ?? 0).getTime() -
            new Date(a.date_created ?? a.created_at ?? a.created_from ?? 0).getTime()
          );
          const candidate = sorted[0];
          if (candidate) {
            const createdAt = new Date(candidate.date_created ?? candidate.created_at ?? candidate.created_from ?? 0).getTime();
            if (createdAt >= postTime - 10000 || !existingNames.has(candidate.file_name ?? "")) {
              newReport = candidate;
              details.push(`report ready after ${(i + 1) * 5}s`);
              break;
            }
          }
        } catch (_) {}
      }
    }

    // Fallback: take the most recent report available
    if (!newReport) {
      try {
        const lr = await fetch(`${BASE}/v1/account/release_report/list`, { headers: authHeaders });
        if (lr.ok) {
          const list: any[] = await lr.json() ?? [];
          newReport = [...list].sort((a, b) =>
            new Date(b.date_created ?? b.created_at ?? b.created_from ?? 0).getTime() -
            new Date(a.date_created ?? a.created_at ?? a.created_from ?? 0).getTime()
          )[0] ?? null;
          if (newReport) details.push("report fallback: most recent");
        }
      } catch (_) {}
    }

    if (!newReport) {
      details.push("no report available");
    } else {
      reportFile = newReport.file_name ?? newReport.id ?? null;
      details.push(`report file: ${reportFile}`);

      if (reportFile) {
        const fileRes = await fetch(
          `${BASE}/v1/account/release_report/${encodeURIComponent(reportFile)}`,
          { headers: authHeaders },
        );
        if (fileRes.ok) {
          const buffer = Buffer.from(await fileRes.arrayBuffer());

          // Detect format: CSV by extension unless magic bytes say XLSX (PK = ZIP)
          const isCsv = (reportFile.toLowerCase().endsWith(".csv"))
            && buffer.slice(0, 2).toString("hex") !== "504b";

          let headers: string[] = [];
          let dataRows: any[][] = [];

          if (!isCsv) {
            // XLSX
            const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
            headers = (allRows[0] ?? []).map((h: any) => normHeader(h));
            dataRows = allRows.slice(1).filter(r => r.some((v: any) => v !== ""));
          } else {
            // CSV — separator ";" or ","
            const text = buffer.toString("utf-8");
            const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
            const sep = lines[0]?.includes(";") ? ";" : ",";
            headers = lines[0].split(sep).map(h => normHeader(h.replace(/^"|"$/g, "")));
            dataRows = lines.slice(1).map(line => {
              const cells: string[] = [];
              let cur = "", inQ = false;
              for (const ch of line) {
                if (ch === '"') { inQ = !inQ; }
                else if (ch === sep && !inQ) { cells.push(cur.trim()); cur = ""; }
                else { cur += ch; }
              }
              cells.push(cur.trim());
              return cells;
            });
          }

          details.push(`format: ${isCsv ? "csv" : "xlsx"} rows: ${dataRows.length} cols: ${headers.length}`);
          console.log(`[mp-sync] format=${isCsv ? "csv" : "xlsx"} rows=${dataRows.length} cols: ${headers.join("|")}`);

          // Column mapping: Spanish (XLSX manual) + English (CSV technical)
          const col = (exact: string, fallback?: string): number => {
            let i = headers.findIndex(h => h === exact);
            if (i < 0 && fallback) i = headers.findIndex(h => h.includes(fallback));
            return i;
          };
          const iMpId   = col("ID DE OPERACION EN MERCADO PAGO", "OPERACION EN MERCADO") >= 0
            ? col("ID DE OPERACION EN MERCADO PAGO", "OPERACION EN MERCADO")
            : col("SOURCE_ID");
          const iFecha  = col("FECHA DE LIBERACION", "LIBERACION") >= 0
            ? col("FECHA DE LIBERACION", "LIBERACION")
            : col("FECHA") >= 0 ? col("FECHA") : col("DATE");
          const iDesc   = col("DESCRIPCION") >= 0 ? col("DESCRIPCION") : col("DESCRIPTION");
          const iGross  = col("MONTO BRUTO", "BRUTO") >= 0 ? col("MONTO BRUTO", "BRUTO") : col("GROSS_AMOUNT");
          const iDebit  = col("MONTO NETO DEBITADO", "DEBITADO") >= 0 ? col("MONTO NETO DEBITADO", "DEBITADO") : col("NET_DEBIT_AMOUNT");
          const iCredit = col("MONTO NETO ACREDITADO", "ACREDITADO") >= 0 ? col("MONTO NETO ACREDITADO", "ACREDITADO") : col("NET_CREDIT_AMOUNT");
          const iFee    = col("COMISION") >= 0 ? col("COMISION") : col("MP_FEE_AMOUNT");

          if (iMpId < 0) {
            details.push("column ID not found — skipping parse");
          } else {
            const xlsxRows: {
              mpId: string; fecha: string; descripcion: string;
              montoBruto: number; montoNetoDebitado: number;
              montoNetoAcreditado: number; comision: number;
            }[] = [];

            for (const row of dataRows) {
              const get = (i: number) => i >= 0 ? row[i] : "";
              const mpId = String(get(iMpId) ?? "").trim();
              if (!mpId || mpId === "0") continue;

              const rawDesc = String(get(iDesc) ?? "").trim();
              const normDesc = normHeader(rawDesc);
              const debit  = parseNum(get(iDebit));
              const credit = parseNum(get(iCredit));

              // Keep: CVU extractions (outgoing) + ingresos (not reservas/rendimientos)
              const isEgresoCvu = normDesc === "EXTRACCION DE EFECTIVO";
              const isIngreso   = credit > 0
                && !normDesc.includes("RESERVA")
                && !normDesc.includes("RENDIMIENTO");
              if (!isEgresoCvu && !isIngreso) continue;

              xlsxRows.push({
                mpId,
                fecha: parseXlsxDate(get(iFecha)),
                descripcion: rawDesc,
                montoBruto:          parseNum(get(iGross)),
                montoNetoDebitado:   debit,
                montoNetoAcreditado: credit,
                comision:            parseNum(get(iFee)),
              });
            }

            details.push(`useful rows: ${xlsxRows.length}`);
            if (xlsxRows.length > 0) {
              await storage.upsertMpXlsxMovements(xlsxRows);
              xlsxSynced = xlsxRows.length;
            }
          }
        } else {
          details.push(`download error: ${fileRes.status}`);
        }
      }
    }
  } catch (e: any) {
    details.push(`xlsx sync error: ${e.message}`);
  }

  // ── 3. Persist payer identifiers ──────────────────────────────────────────
  if (toUpsert.length > 0) {
    await storage.upsertMpMovementIdentifiers(toUpsert);
  }

  const msg = `${toUpsert.length} identifiers upserted, ${skipped} skipped, ${xlsxSynced} xlsx rows | ${details.join(" | ")}`;
  console.log(`[mp-sync] done: ${msg}`);
  return { synced: toUpsert.length, skipped, xlsxSynced, reportFile, details: msg };
}
