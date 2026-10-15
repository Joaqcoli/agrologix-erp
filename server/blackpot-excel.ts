/** A-13: Excel "Black Pot" (una hoja por pedido) — usado por el botón de Cuentas Corrientes y por el envío semanal automático. */
import ExcelJS from "exceljs";
import { storage } from "./storage";
import { ivaRateOf } from "@shared/iva";

export async function buildBlackPotWorkbook(orderIds: number[]): Promise<Buffer> {
  const MONTHS_ES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

  const wb = new ExcelJS.Workbook();
  wb.creator = "AgroLogix ERP";

  // Nombres de hoja únicos: si se repite un colegio (varios pedidos), agrega " 2", " 3"…
  // (Excel limita el nombre de hoja a 31 caracteres, así que se recorta la base para que entre el sufijo.)
  const usedSheetNames = new Set<string>();
  const uniqueSheetName = (base: string): string => {
    const b = base || "Hoja";
    if (!usedSheetNames.has(b.toLowerCase())) { usedSheetNames.add(b.toLowerCase()); return b; }
    let n = 2;
    while (true) {
      const suffix = ` ${n}`;
      const cand = b.slice(0, 31 - suffix.length) + suffix;
      if (!usedSheetNames.has(cand.toLowerCase())) { usedSheetNames.add(cand.toLowerCase()); return cand; }
      n++;
    }
  };

  for (const id of orderIds) {
    const order = await storage.getOrder(id);
    if (!order) continue;

    const customer = order.customer;
    const schoolName = customer.name;
    const address = [customer.address, customer.city].filter(Boolean).join(", ");
    const remitoStr = order.remitoNum != null ? String(order.remitoNum).padStart(6, "0") : "";
    const d = new Date(order.orderDate);
    const dateStr = `${d.getDate()}-${MONTHS_ES[d.getMonth()]}`;

    const baseName = schoolName.replace(/[\\\/\?\*\[\]:]/g, "").slice(0, 31) || `Pedido-${id}`;
    const sheetName = uniqueSheetName(baseName);
    const ws = wb.addWorksheet(sheetName);

    ws.columns = [
      { width: 10 },  // A CANTIDAD
      { width: 10 },  // B UNIDAD
      { width: 32 },  // C PRODUCTO
      { width: 14 },  // D PRECIO
      { width: 14 },  // E TOTAL
      { width: 16 },  // F TOTAL + IVA
    ];

    // Row 1 — school header
    ws.mergeCells("A1:D1");
    const r1 = ws.getRow(1);
    r1.getCell("A").value = `COLEGIO ${schoolName}${address ? ` - ${address}` : ""}`;
    r1.getCell("A").font = { name: "Arial", bold: true, size: 11 };
    r1.getCell("A").alignment = { vertical: "middle" };
    r1.getCell("E").value = remitoStr ? `rto: ${remitoStr}` : "";
    r1.getCell("E").font = { name: "Arial", size: 10 };
    r1.getCell("F").value = dateStr;
    r1.getCell("F").font = { name: "Arial", size: 10 };
    r1.height = 18;
    r1.commit();

    // Row 2 — invoice
    ws.mergeCells("A2:D2");
    const r2 = ws.getRow(2);
    r2.getCell("A").value = "";
    r2.getCell("E").value = "Factura Nro:";
    r2.getCell("E").font = { name: "Arial", size: 10 };
    r2.getCell("F").value = order.invoiceNumber ?? "";
    r2.getCell("F").font = { name: "Arial", size: 10 };
    r2.commit();

    // Row 3 — column headers
    const r3 = ws.getRow(3);
    ["CANTIDAD","UNIDAD","PRODUCTO","PRECIO","TOTAL","TOTAL + IVA"].forEach((h, i) => {
      const cell = r3.getCell(i + 1);
      cell.value = h;
      cell.font = { name: "Arial", bold: true, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
      cell.alignment = { horizontal: i >= 3 ? "right" : "left" };
    });
    r3.commit();

    // Item rows — productos en ORDEN ALFABÉTICO (como se ven en el sistema),
    // excluyendo las líneas de bolsa. (Antes iban en orden de carga y la celda
    // PRODUCTO referenciaba una variable inexistente `productName`.)
    const nombreProducto = (it: typeof order.items[number]) =>
      String(it.product?.name ?? (it as any).rawProductName ?? "");
    const itemsOrdenados = [...order.items]
      .filter((it) => !(it as any).bolsaType)
      .sort((a, b) => nombreProducto(a).localeCompare(nombreProducto(b), "es", { sensitivity: "base" }));

    const startRow = 4;
    let rowIdx = startRow;
    for (const item of itemsOrdenados) {
      const productName = nombreProducto(item);
      const ivaRate = ivaRateOf(item.product);
      const subtotal = parseFloat(String(item.subtotal ?? "0"));
      const totalConIva = parseFloat((subtotal * (1 + ivaRate)).toFixed(2));

      const row = ws.getRow(rowIdx);
      row.getCell(1).value = parseFloat(String(item.quantity));
      row.getCell(1).font = { name: "Arial", size: 10 };
      row.getCell(2).value = item.unit as string;
      row.getCell(2).font = { name: "Arial", size: 10 };
      row.getCell(3).value = productName;
      row.getCell(3).font = { name: "Arial", size: 10 };
      row.getCell(4).value = parseFloat(String(item.pricePerUnit ?? "0"));
      row.getCell(4).numFmt = '"$"#,##0.00';
      row.getCell(4).font = { name: "Arial", size: 10 };
      row.getCell(4).alignment = { horizontal: "right" };
      row.getCell(5).value = subtotal;
      row.getCell(5).numFmt = '"$"#,##0.00';
      row.getCell(5).font = { name: "Arial", size: 10 };
      row.getCell(5).alignment = { horizontal: "right" };
      row.getCell(6).value = totalConIva;
      row.getCell(6).numFmt = '"$"#,##0.00';
      row.getCell(6).font = { name: "Arial", size: 10 };
      row.getCell(6).alignment = { horizontal: "right" };
      row.commit();
      rowIdx++;
    }

    const endRow = rowIdx - 1;

    // Total row
    const tr = ws.getRow(rowIdx);
    tr.getCell(3).value = "TOTAL";
    tr.getCell(3).font = { name: "Arial", bold: true, size: 10 };
    tr.getCell(5).value = endRow >= startRow ? { formula: `SUM(E${startRow}:E${endRow})` } : 0;
    tr.getCell(5).numFmt = '"$"#,##0.00';
    tr.getCell(5).font = { name: "Arial", bold: true, size: 10 };
    tr.getCell(5).alignment = { horizontal: "right" };
    tr.getCell(6).value = endRow >= startRow ? { formula: `SUM(F${startRow}:F${endRow})` } : 0;
    tr.getCell(6).numFmt = '"$"#,##0.00';
    tr.getCell(6).font = { name: "Arial", bold: true, size: 10 };
    tr.getCell(6).alignment = { horizontal: "right" };
    tr.commit();
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
