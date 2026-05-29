import { storage } from "./storage";

interface ReportRow {
  movementId: string;
  payerIdentifier: string;
  payerName: string | null;
  rawExternalId: string | null;
}

function classifyIdentifier(value: string): string | null {
  const v = value.replace(/[\s-]/g, "");
  if (/^\d{22}$/.test(v)) return v;        // CBU exact
  if (/^\d{15,}$/.test(v)) return v;       // CBU-like (>=15 digits)
  if (/^\d{11}$/.test(v)) return v;        // CUIT (11 digits)
  if (/^\d{6,14}$/.test(v)) return `mp:${v}`; // MP user ID range
  return null;
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  // Auto-detect separator
  const firstLine = text.split("\n")[0] ?? "";
  const sep = firstLine.includes(";") ? ";" : ",";

  const lines = text.split("\n").filter(l => l.trim().length > 0);
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, "").toUpperCase());

  const rows = lines.slice(1).map(line => {
    // Simple CSV parse — handles quoted fields
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

export async function syncMpReport(token: string): Promise<{ synced: number; skipped: number; reportFile: string | null }> {
  const BASE = "https://api.mercadopago.com";
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // 1. Configure report columns to include PAYER_ID and EXTERNAL_ID
  try {
    await fetch(`${BASE}/v1/account/release_report/config`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        columns: [
          { key: "DATE" },
          { key: "SOURCE_ID" },
          { key: "EXTERNAL_ID" },
          { key: "RECORD_TYPE" },
          { key: "DESCRIPTION" },
          { key: "NET_CREDIT_AMOUNT" },
          { key: "NET_DEBIT_AMOUNT" },
          { key: "GROSS_AMOUNT" },
          { key: "MP_FEE_AMOUNT" },
          { key: "FINANCING_FEE_AMOUNT" },
          { key: "SHIPPING_FEE_AMOUNT" },
          { key: "TAXES_AMOUNT" },
          { key: "COUPON_AMOUNT" },
          { key: "INSTALLMENTS" },
          { key: "PAYMENT_METHOD" },
        ],
      }),
    });
  } catch (e) {
    console.warn("[mp-report] Could not update report config:", e);
  }

  // 2. List available reports
  const listRes = await fetch(`${BASE}/v1/account/release_report/list`, { headers });
  if (!listRes.ok) {
    throw new Error(`MP report list failed: ${listRes.status} ${await listRes.text()}`);
  }
  const reports: any[] = await listRes.json();
  if (!reports || reports.length === 0) {
    return { synced: 0, skipped: 0, reportFile: null };
  }

  // Sort by created_from desc, take the most recent
  const sorted = [...reports].sort((a, b) => {
    const da = new Date(b.created_from ?? b.date_created ?? 0).getTime();
    const db_ = new Date(a.created_from ?? a.date_created ?? 0).getTime();
    return da - db_;
  });
  const latest = sorted[0];
  const reportFile: string = latest.file_name ?? latest.id ?? "unknown";

  // 3. Download the CSV
  const csvUrl = `${BASE}/v1/account/release_report/${encodeURIComponent(reportFile)}`;
  const csvRes = await fetch(csvUrl, { headers });
  if (!csvRes.ok) {
    throw new Error(`MP report download failed: ${csvRes.status} ${await csvRes.text()}`);
  }
  const csvText = await csvRes.text();

  if (!csvText || csvText.trim().length === 0) {
    return { synced: 0, skipped: 0, reportFile };
  }

  // 4. Parse CSV — find column indices dynamically
  const { headers: cols, rows } = parseCsv(csvText);

  const idxSourceId    = cols.findIndex(h => h.includes("SOURCE_ID"));
  const idxExternalId  = cols.findIndex(h => h.includes("EXTERNAL_ID") || h.includes("EXTERNAL"));
  const idxRecordType  = cols.findIndex(h => h.includes("RECORD_TYPE") || h.includes("TYPE"));
  const idxDescription = cols.findIndex(h => h.includes("DESCRIPTION") || h.includes("DESC"));

  if (idxSourceId < 0) {
    console.warn("[mp-report] SOURCE_ID column not found in report. Columns:", cols);
    return { synced: 0, skipped: 0, reportFile };
  }

  // 5. Build upsert rows
  const toUpsert: ReportRow[] = [];
  let skipped = 0;

  for (const row of rows) {
    const sourceId = (row[idxSourceId] ?? "").trim();
    if (!sourceId || sourceId === "0" || sourceId === "") { skipped++; continue; }

    // Only process income lines — skip fee/tax/adjustment rows
    const recordType = idxRecordType >= 0 ? (row[idxRecordType] ?? "").toUpperCase() : "";
    if (recordType && !recordType.includes("PAYMENT") && !recordType.includes("APPROVED") && !recordType.includes("INCOME") && recordType !== "") {
      // Keep it if it looks like a payment line or unknown
      if (["CLEARING", "TAX", "FEE", "ADJUSTMENT", "PAYOUT"].some(t => recordType.includes(t))) {
        skipped++;
        continue;
      }
    }

    const rawExtId = idxExternalId >= 0 ? (row[idxExternalId] ?? "").trim() : "";
    const description = idxDescription >= 0 ? (row[idxDescription] ?? "").trim() : "";

    // Classify the external ID
    let payerIdentifier: string | null = null;
    if (rawExtId) {
      payerIdentifier = classifyIdentifier(rawExtId);
    }

    if (!payerIdentifier) { skipped++; continue; }

    toUpsert.push({
      movementId: sourceId,
      payerIdentifier,
      payerName: description || null,
      rawExternalId: rawExtId || null,
    });
  }

  if (toUpsert.length > 0) {
    await storage.upsertMpMovementIdentifiers(toUpsert);
  }

  console.log(`[mp-report] sync done: ${toUpsert.length} upserted, ${skipped} skipped, file=${reportFile}`);
  return { synced: toUpsert.length, skipped, reportFile };
}
