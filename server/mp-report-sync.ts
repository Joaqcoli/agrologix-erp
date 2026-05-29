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

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const firstLine = text.split("\n")[0] ?? "";
  const sep = firstLine.includes(";") ? ";" : ",";
  const lines = text.split("\n").filter(l => l.trim().length > 0);
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, "").toUpperCase());
  const rows = lines.slice(1).map(line => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === sep && !inQuotes) { result.push(current.trim()); current = ""; }
      else { current += ch; }
    }
    result.push(current.trim());
    return result;
  });
  return { headers, rows };
}

export async function syncMpReport(token: string): Promise<{
  synced: number;
  skipped: number;
  reportFile: string | null;
  details: string;
}> {
  const BASE = "https://api.mercadopago.com";
  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const toUpsert: { movementId: string; payerIdentifier: string; payerName?: string | null; rawExternalId?: string | null }[] = [];
  let skipped = 0;
  const details: string[] = [];

  // ── 1. Sync from Payments API ─────────────────────────────────────────────
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

    // Detect merchantId — most frequent collector_id
    const freq = new Map<string, number>();
    for (const p of allPayments) {
      const cid = String(p.collector_id ?? p.collector?.id ?? "");
      if (cid && cid !== "0") freq.set(cid, (freq.get(cid) ?? 0) + 1);
    }
    let merchantId = OWN_COLLECTOR_ID;
    let best = 0;
    for (const [id, n] of freq) { if (n > best) { best = n; merchantId = id; } }
    details.push(`merchantId: ${merchantId}`);

    // Log first 3 incoming payments raw fields for diagnosis
    let diagCount = 0;
    for (const p of allPayments) {
      if (diagCount >= 3) break;
      const collId = String(p.collector_id ?? p.collector?.id ?? "");
      if (collId !== merchantId) continue; // skip outgoing
      const pbi = p.transaction_details?.payer_bank_info;
      console.log(`[mp-sync PAYMENTS DIAG ingreso #${diagCount+1}] id=${p.id} op=${p.operation_type} payment_type=${p.payment_type_id}` +
        ` payer_id=${p.payer_id} payer.id=${p.payer?.id} payer.email=${p.payer?.email}` +
        ` payer.identification=${JSON.stringify(p.payer?.identification)}` +
        ` pbi.cbu=${pbi?.cbu} pbi.account_id=${pbi?.account_id} pbi.owner_name=${pbi?.owner_name}` +
        ` description=${p.description}`);
      diagCount++;
    }

    for (const p of allPayments) {
      const movId = String(p.id ?? "");
      if (!movId || movId === "0") { skipped++; continue; }

      const collId = String(p.collector_id ?? p.collector?.id ?? "");
      const isIncoming = collId === merchantId;

      if (isIncoming) {
        // CVU/bank transfer: payer_bank_info.cbu
        const pbi = p.transaction_details?.payer_bank_info;
        const cbu = String(pbi?.cbu ?? pbi?.account_id ?? "").replace(/[\s-]/g, "");
        if (cbu.length >= 11 && !isSelf(cbu)) {
          toUpsert.push({ movementId: movId, payerIdentifier: cbu, payerName: String(pbi?.owner_name ?? "").trim() || null, rawExternalId: `payer_bank_info.cbu` });
          continue;
        }

        // MP user ID (app-to-app payments, QR)
        const payerId = String(p.payer_id ?? p.payer?.id ?? "");
        const mpId = classifyMpId(payerId, merchantId);
        if (mpId && !isSelf(mpId)) {
          const firstName = String(p.payer?.first_name ?? "").trim();
          const lastName  = String(p.payer?.last_name  ?? "").trim();
          const payerName = [firstName, lastName].filter(Boolean).join(" ") || null;
          toUpsert.push({ movementId: movId, payerIdentifier: mpId, payerName, rawExternalId: `payer.id` });
          continue;
        }

        // Email fallback
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

  // ── 2. Settlement report CSV (log raw rows + secondary sync) ──────────────
  let reportFile: string | null = null;
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
          const csvUrl = `${BASE}/v1/account/release_report/${encodeURIComponent(reportFile)}`;
          const csvRes = await fetch(csvUrl, { headers: authHeaders });
          if (csvRes.ok) {
            const csvText = await csvRes.text();
            const { headers: cols, rows } = parseCsv(csvText);

            // ── LOG COMPLETO DEL CSV (primeras 5 filas) ──────────────────────
            console.log(`[mp-sync CSV] ====== INICIO DIAGNÓSTICO CSV ======`);
            console.log(`[mp-sync CSV] Columnas (${cols.length}): ${cols.join(" | ")}`);
            console.log(`[mp-sync CSV] Total filas: ${rows.length}`);
            for (let i = 0; i < Math.min(5, rows.length); i++) {
              const row = rows[i];
              const rowObj: Record<string, string> = {};
              cols.forEach((col, idx) => { rowObj[col] = row[idx] ?? ""; });
              console.log(`[mp-sync CSV] Fila ${i+1}:`, JSON.stringify(rowObj));
            }
            console.log(`[mp-sync CSV] ====== FIN DIAGNÓSTICO CSV ======`);

            details.push(`CSV columns: ${cols.join(", ")}`);
            details.push(`CSV rows: ${rows.length}`);

            // Find any column that looks like a payer identifier (not collector)
            const idxSourceId    = cols.findIndex(h => h === "SOURCE_ID");
            const idxExternalId  = cols.findIndex(h => h === "EXTERNAL_ID");
            const idxNetCredit   = cols.findIndex(h => h.includes("NET_CREDIT"));
            const idxNetDebit    = cols.findIndex(h => h.includes("NET_DEBIT"));
            const idxRecordType  = cols.findIndex(h => h.includes("RECORD_TYPE") || h === "TYPE");

            // Extra payer-like columns
            const idxPayerId     = cols.findIndex(h => h === "PAYER_ID" || h === "PAYER_ACCOUNT_ID" || h === "COUNTERPART_ID");
            const idxPayerColName = idxPayerId >= 0 ? cols[idxPayerId] : null;

            if (idxPayerId >= 0) {
              details.push(`Found payer column: ${idxPayerColName} at index ${idxPayerId}`);
            }

            if (idxSourceId >= 0) {
              const csvIds = new Set(toUpsert.map(r => r.movementId));
              for (const row of rows) {
                const sourceId = (row[idxSourceId] ?? "").trim();
                if (!sourceId || sourceId === "0" || csvIds.has(sourceId)) continue;

                const recordType = idxRecordType >= 0 ? (row[idxRecordType] ?? "").toUpperCase() : "";
                if (["CLEARING", "TAX", "FEE", "ADJUSTMENT", "PAYOUT"].some(t => recordType.includes(t))) continue;

                // Only ingresos (NET_CREDIT > 0)
                if (idxNetCredit >= 0) {
                  const credit = parseFloat((row[idxNetCredit] ?? "0").replace(",", "."));
                  if (credit <= 0) continue;
                }

                // Prefer PAYER_ID column if available
                if (idxPayerId >= 0) {
                  const payerVal = (row[idxPayerId] ?? "").trim();
                  if (payerVal && !isSelf(payerVal)) {
                    const classified = classifyCbu(payerVal) ?? (`mp:${payerVal}`.match(/^\d+$/) ? `mp:${payerVal}` : null);
                    if (classified) {
                      toUpsert.push({ movementId: sourceId, payerIdentifier: classified, rawExternalId: `${idxPayerColName}:${payerVal}` });
                      continue;
                    }
                  }
                }

                // Fallback: EXTERNAL_ID
                if (idxExternalId >= 0) {
                  const rawExtId = (row[idxExternalId] ?? "").trim();
                  if (rawExtId && !isSelf(rawExtId)) {
                    const cbu = classifyCbu(rawExtId);
                    if (cbu) {
                      toUpsert.push({ movementId: sourceId, payerIdentifier: cbu, rawExternalId: rawExtId });
                    }
                  }
                }
              }
            }
          } else {
            details.push(`CSV download error: ${csvRes.status}`);
          }
        }
      }
    } else {
      details.push(`report list error: ${listRes.status}`);
    }
  } catch (e: any) {
    details.push(`report sync error: ${e.message}`);
  }

  // ── 3. Persist ────────────────────────────────────────────────────────────
  if (toUpsert.length > 0) {
    await storage.upsertMpMovementIdentifiers(toUpsert);
  }

  const msg = `${toUpsert.length} upserted, ${skipped} skipped | ${details.join(" | ")}`;
  console.log(`[mp-sync] done: ${msg}`);
  return { synced: toUpsert.length, skipped, reportFile, details: msg };
}
