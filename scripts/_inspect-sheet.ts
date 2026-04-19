import { createRequire } from "module";
const XLSX: typeof import("xlsx") = createRequire(import.meta.url)("xlsx");
import * as path from "path";

const FILE_PATH = path.resolve(process.cwd(), "attached_assets/info 2026.xlsx");
const wb = XLSX.readFile(FILE_PATH, { cellDates: false, raw: false });
const sheetName = wb.SheetNames.find((n) => n.trim() === "15-04-2026")!;
const sheet = wb.Sheets[sheetName];
const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
console.log("Sheet:", sheetName, "maxRow:", range.e.r + 1);

function cellStr(c: number, r: number): string {
  const addr = XLSX.utils.encode_cell({ c, r });
  const cell = sheet[addr];
  return cell ? String(cell.v ?? "").trim() : "";
}

// Mostrar filas 100-140
for (let r = 100; r <= 140; r++) {
  const cols = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((c) =>
    cellStr(c, r).padEnd(22).slice(0, 22),
  );
  console.log(`R${String(r + 1).padStart(3)}: ${cols.join(" | ")}`);
}
