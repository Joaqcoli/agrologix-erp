import { storage } from "./storage";

/**
 * Syncs MP payment identifiers from the Payments API directly.
 * Extracts payer identifiers (CBU, CUIT, MP user ID) from:
 *   - transaction_details.payer_bank_info.cbu  (CVU bank transfers)
 *   - payer.identification.number              (for outgoing: collector's CUIT)
 *   - payer.id                                 (MP user ID for app-to-app)
 *   - payer.email                              (fallback)
 *
 * Also tries the settlement report CSV as a secondary source (EXTERNAL_ID).
 */

function classifyCbu(value: string): string | null {
  const v = value.replace(/[\s-]/g, "");
  if (/^\d{11,}$/.test(v)) return v;  // CBU (22 digits) or CUIT (11 digits)
  return null;
}

function classifyMpId(value: string, merchantId: string): string | null {
  const v = value.replace(/[\s-]/g, "");
  if (!v || v === "0" || v === merchantId) return null;
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

  // ── 1. Sync from Payments API (primary) ───────────────────────────────────
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
    let merchantId = "";
    let best = 0;
    for (const [id, n] of freq) { if (n > best) { best = n; merchantId = id; } }
    details.push(`merchantId: ${merchantId}`);

    for (const p of allPayments) {
      const movId = String(p.id ?? "");
      if (!movId || movId === "0") { skipped++; continue; }

      const collId = String(p.collector_id ?? p.collector?.id ?? "");
      const isIncoming = collId === merchantId;

      if (isIncoming) {
        // CVU/bank transfer: payer_bank_info.cbu
        const pbi = p.transaction_details?.payer_bank_info;
        const cbu = String(pbi?.cbu ?? pbi?.account_id ?? "").replace(/[\s-]/g, "");
        if (cbu.length >= 11) {
          toUpsert.push({
            movementId: movId,
            payerIdentifier: cbu,
            payerName: String(pbi?.owner_name ?? "").trim() || null,
            rawExternalId: `payer_bank_info.cbu`,
          });
          continue;
        }

        // MP user ID (app-to-app payments, QR)
        const payerId = String(p.payer_id ?? p.payer?.id ?? "");
        const mpId = classifyMpId(payerId, merchantId);
        if (mpId) {
          const firstName = String(p.payer?.first_name ?? "").trim();
          const lastName  = String(p.payer?.last_name  ?? "").trim();
          const payerName = [firstName, lastName].filter(Boolean).join(" ") || null;
          toUpsert.push({
            movementId: movId,
            payerIdentifier: mpId,
            payerName,
            rawExternalId: `payer.id`,
          });
          continue;
        }

        // Email fallback
        const email = String(p.payer?.email ?? "").toLowerCase().trim();
        if (email && email.includes("@") && !email.includes("noreply")) {
          toUpsert.push({ movementId: movId, payerIdentifier: email, payerName: null, rawExternalId: "payer.email" });
          continue;
        }
      }
      // Outgoing: skip (egreso identifies collector via other means)
      skipped++;
    }
  } catch (e: any) {
    details.push(`payments sync error: ${e.message}`);
  }

  // ── 2. Settlement report CSV (secondary — EXTERNAL_ID might have CBU) ──────
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

        if (reportFile) {
          const csvUrl = `${BASE}/v1/account/release_report/${encodeURIComponent(reportFile)}`;
          const csvRes = await fetch(csvUrl, { headers: authHeaders });
          if (csvRes.ok) {
            const csvText = await csvRes.text();
            const { headers: cols, rows } = parseCsv(csvText);
            details.push(`CSV columns: ${cols.join(", ")}`);
            details.push(`CSV rows: ${rows.length}`);

            const idxSourceId   = cols.findIndex(h => h.includes("SOURCE_ID"));
            const idxExternalId = cols.findIndex(h => h.includes("EXTERNAL_ID") || h.includes("EXTERNAL"));
            const idxRecordType = cols.findIndex(h => h.includes("RECORD_TYPE") || h.includes("TYPE"));

            // Sample first row values for debugging
            if (rows.length > 0 && rows[0]) {
              details.push(`CSV first row sample: ${rows[0].slice(0, 5).join(" | ")}`);
            }

            if (idxSourceId >= 0 && idxExternalId >= 0) {
              const csvIds = new Set(toUpsert.map(r => r.movementId));
              for (const row of rows) {
                const sourceId = (row[idxSourceId] ?? "").trim();
                if (!sourceId || sourceId === "0" || csvIds.has(sourceId)) continue;

                const recordType = idxRecordType >= 0 ? (row[idxRecordType] ?? "").toUpperCase() : "";
                if (["CLEARING", "TAX", "FEE", "ADJUSTMENT", "PAYOUT"].some(t => recordType.includes(t))) continue;

                const rawExtId = (row[idxExternalId] ?? "").trim();
                if (!rawExtId) continue;

                const cbu = classifyCbu(rawExtId);
                if (cbu) {
                  toUpsert.push({ movementId: sourceId, payerIdentifier: cbu, rawExternalId: rawExtId });
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

  const msg = `payments: ${toUpsert.length} upserted, ${skipped} skipped | ${details.join(" | ")}`;
  console.log(`[mp-report] sync done: ${msg}`);
  return { synced: toUpsert.length, skipped, reportFile, details: msg };
}
