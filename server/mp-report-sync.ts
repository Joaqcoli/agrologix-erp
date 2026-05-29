import * as XLSX from "xlsx";
import { storage } from "./storage";

const OWN_COLLECTOR_ID = "1852295299";
const OWN_EMAIL = "vegetalesargentinos.srl@gmail.com";

function isSelf(value: string): boolean {
  const v = value.toLowerCase().trim();
  return v === OWN_COLLECTOR_ID || v === `mp:${OWN_COLLECTOR_ID}` || v === OWN_EMAIL;
}

function classifyCbu(value: string): string | null {
  const v = value.replace(/[\s-]/g, "");
  if (/^\d{11,}$/.test(v)) return v;  // CBU (22 digits) or CUIT (11 digits)
  return null;
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
    // Use UTC date to avoid TZ shift — the report dates are calendar dates
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
    const pad2 = (n: number) => String(n).padStart(2, "0");
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

  // ── 2. XLSX report — extract movements missing from payments API ──────────
  let reportFile: string | null = null;
  let xlsxSynced = 0;
  try {
    const listRes = await fetch(`${BASE}/v1/account/release_report/list`, { headers: authHeaders });
    if (listRes.ok) {
      const reports: any[] = await listRes.json();
      details.push(`reports found: ${reports?.length ?? 0}`);

      if (reports && reports.length > 0) {
        const sorted = [...reports].sort((a, b) =>
          new Date(b.created_from ?? b.date_created ?? 0).getTime() -
          new Date(a.created_from ?? a.date_created ?? 0).getTime()
        );
        const latest = sorted[0];
        reportFile = latest.file_name ?? latest.id ?? null;
        details.push(`report file: ${reportFile}`);

        if (reportFile) {
          const fileRes = await fetch(`${BASE}/v1/account/release_report/${encodeURIComponent(reportFile)}`, { headers: authHeaders });
          if (fileRes.ok) {
            const buffer = Buffer.from(await fileRes.arrayBuffer());

            // Parse XLSX
            const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

            const headers: string[] = (allRows[0] ?? []).map((h: any) => normHeader(h));
            const dataRows = allRows.slice(1).filter(r => r.some((v: any) => v !== ""));

            console.log(`[mp-sync XLSX] Columnas (${headers.length}): ${headers.join(" | ")}`);
            console.log(`[mp-sync XLSX] Total filas: ${dataRows.length}`);
            for (let i = 0; i < Math.min(3, dataRows.length); i++) {
              const obj: Record<string, any> = {};
              headers.forEach((h, idx) => { obj[h] = dataRows[i][idx] ?? ""; });
              console.log(`[mp-sync XLSX] Fila ${i + 1}:`, JSON.stringify(obj));
            }

            details.push(`XLSX columnas: ${headers.join(", ")}`);
            details.push(`XLSX filas: ${dataRows.length}`);

            // Map column indices (normalized, using includes for robustness)
            const col = (exact: string, fallback?: string) => {
              let i = headers.findIndex(h => h === exact);
              if (i < 0 && fallback) i = headers.findIndex(h => h.includes(fallback));
              return i;
            };
            const iMpId    = col("ID DE OPERACION EN MERCADO PAGO", "OPERACION EN MERCADO");
            const iFecha   = col("FECHA");
            const iDesc    = col("DESCRIPCION");
            const iGross   = col("MONTO BRUTO", "BRUTO");
            const iDebit   = col("MONTO NETO DEBITADO", "DEBITADO");
            const iCredit  = col("MONTO NETO ACREDITADO", "ACREDITADO");
            const iFee     = col("COMISION");

            details.push(`Índices: mpId=${iMpId} fecha=${iFecha} desc=${iDesc} gross=${iGross} debit=${iDebit} credit=${iCredit} fee=${iFee}`);

            if (iMpId < 0) {
              details.push("XLSX: columna ID DE OPERACION no encontrada — revisar headers");
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
                const debit   = parseNum(get(iDebit));
                const credit  = parseNum(get(iCredit));

                // Keep: egresos CVU (Extracción de efectivo) + ingresos que no sean reservas/rendimientos
                const isEgresoCvu = rawDesc === "Extracción de efectivo" || rawDesc === "Extraccion de efectivo";
                const isIngreso   = credit > 0
                  && !rawDesc.toLowerCase().includes("reserva")
                  && !rawDesc.toLowerCase().includes("rendimiento");
                if (!isEgresoCvu && !isIngreso) continue;

                const fecha = parseXlsxDate(get(iFecha));

                xlsxRows.push({
                  mpId,
                  fecha,
                  descripcion: rawDesc,
                  montoBruto: parseNum(get(iGross)),
                  montoNetoDebitado: debit,
                  montoNetoAcreditado: credit,
                  comision: parseNum(get(iFee)),
                });
              }

              details.push(`XLSX filas útiles: ${xlsxRows.length}`);
              if (xlsxRows.length > 0) {
                await storage.upsertMpXlsxMovements(xlsxRows);
                xlsxSynced = xlsxRows.length;
              }
            }
          } else {
            details.push(`XLSX download error: ${fileRes.status}`);
          }
        }
      }
    } else {
      details.push(`report list error: ${listRes.status}`);
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
