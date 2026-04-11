import jsPDF from "jspdf";

type RemitoData = {
  folio: string;
  issuedAt: string | Date;
  order: {
    folio: string;
    orderDate: string | Date;
    notes?: string | null;
    customer: {
      name: string;
      hasIva?: boolean;
      rfc?: string | null;
      address?: string | null;
      city?: string | null;
      phone?: string | null;
    };
    items: {
      product: { name: string; sku: string } | null;
      quantity: string;
      unit: string;
      pricePerUnit: string;
      subtotal: string;
    }[];
    total: string;
  };
};

function itemIvaRate(name: string): number {
  return /huevo/i.test(name) ? 0.21 : 0.105;
}

// Load logo from /logo.png, convert RGBA PNG → JPEG via canvas (avoids jsPDF PNG issues)
async function loadLogoAsJpeg(): Promise<string | null> {
  try {
    const res = await fetch("/logo.png");
    if (!res.ok) return null;
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = objUrl;
    });
    URL.revokeObjectURL(objUrl);
    const cvs = document.createElement("canvas");
    cvs.width = img.naturalWidth;
    cvs.height = img.naturalHeight;
    const ctx = cvs.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.drawImage(img, 0, 0);
    return cvs.toDataURL("image/jpeg", 0.92);
  } catch {
    return null;
  }
}

export async function generateRemitoPDF(data: RemitoData, opts?: { hidePrecios?: boolean }) {
  const hidePrecios = opts?.hidePrecios ?? false;
  const hasIva = data.order.customer.hasIva ?? false;

  const logoDataUrl = await loadLogoAsJpeg();

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const fmtDate = (d: string | Date) =>
    new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtMoney = (v: number) =>
    `$${v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ── Totals ─────────────────────────────────────────────────────────────────
  let totalSinIva = 0;
  let totalConIva = 0;
  for (const item of data.order.items) {
    const sub = parseFloat(item.subtotal);
    totalSinIva += sub;
    totalConIva += sub * (1 + itemIvaRate(item.product?.name ?? ""));
  }

  // ── Layout constants ───────────────────────────────────────────────────────
  const PW = 210;   // page width mm
  const PH = 297;   // page height mm
  const ML = 14;    // left margin
  const MR = 14;    // right margin
  const CW = PW - ML - MR;  // 182mm content width

  const ROW_H      = 7;   // data row height mm
  const TH_H       = 8;   // table header height mm
  const ROWS_MAX   = 26;  // max rows before new page

  const SEP_Y      = 40;  // horizontal separator line y
  const CLIENT_Y   = 47;  // "Cliente:" baseline y (first page only)
  const TABLE_Y1   = 52;  // table header y — first page
  const TABLE_Y2   = 45;  // table header y — continuation pages
  const FOOTER_H   = 23;  // total footer height (gray + green)
  const FT_GRAY_H  = 15;  // gray section height
  const FT_GREEN_H = 8;   // green section height
  const FOOTER_Y   = PH - FOOTER_H;  // 274mm

  // ── Colors ─────────────────────────────────────────────────────────────────
  const C_TBL_HDR:  [number, number, number] = [30, 30, 30];
  const C_ALT_ROW:  [number, number, number] = [245, 245, 245];
  const C_FT_GRAY:  [number, number, number] = [224, 224, 224];
  const C_FT_GREEN: [number, number, number] = [45, 80, 22];
  const C_WHITE:    [number, number, number] = [255, 255, 255];
  const C_TEXT:     [number, number, number] = [51, 51, 51];
  const C_SEP:      [number, number, number] = [170, 170, 170];
  const C_ROW_SEP:  [number, number, number] = [210, 210, 210];
  const C_FT_LBL:   [number, number, number] = [102, 102, 102];  // gray section labels
  const C_FT_VAL:   [number, number, number] = [34, 34, 34];     // gray section values

  // ── Column positions ───────────────────────────────────────────────────────
  // With prices + IVA (6 cols): 20+20+68+26+24+24 = 182 ✓
  const C = {
    cantX: ML,        cantW: 20,
    unitX: ML + 20,   unitW: 20,
    prodX: ML + 40,   prodW: 68,
    priceX: ML + 108, priceW: 26,
    totX:  ML + 134,  totW:  24,
    tivaX: ML + 158,  tivaW: 24,
  };
  // With prices, no IVA (5 cols): 23+23+78+30+28 = 182 ✓
  const CN = {
    cantX: ML,        cantW: 23,
    unitX: ML + 23,   unitW: 23,
    prodX: ML + 46,   prodW: 78,
    priceX: ML + 124, priceW: 30,
    totX:  ML + 154,  totW:  28,
  };
  // Without prices (3 cols): 22+27+133 = 182 ✓
  const CH = {
    cantX: ML,       cantW: 22,
    unitX: ML + 22,  unitW: 27,
    prodX: ML + 49,  prodW: 133,
  };

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const remitoDate = fmtDate(data.issuedAt);

  // ────────────────────────────────────────────────────────────────────────────
  // FOOTER — drawn on every page
  // ────────────────────────────────────────────────────────────────────────────
  const drawFooter = () => {
    // Gray top section
    doc.setFillColor(...C_FT_GRAY);
    doc.rect(0, FOOTER_Y, PW, FT_GRAY_H, "F");

    // Dark green bottom section
    doc.setFillColor(...C_FT_GREEN);
    doc.rect(0, FOOTER_Y + FT_GRAY_H, PW, FT_GREEN_H, "F");

    const c1 = ML;
    const c2 = ML + CW * 0.34;
    const c3 = ML + CW * 0.66;

    // Labels (gray section)
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...C_FT_LBL);
    doc.text("WhatsApp", c1, FOOTER_Y + 5);
    doc.text("Email",    c2, FOOTER_Y + 5);
    doc.text("Website",  c3, FOOTER_Y + 5);

    // Values (gray section, dark bold)
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C_FT_VAL);
    doc.text("11-7123-2459",                       c1, FOOTER_Y + 11);
    doc.text("vegetalesargentinos.srl@gmail.com",  c2, FOOTER_Y + 11);
    doc.text("www.vegetalesargentinos.com",         c3, FOOTER_Y + 11);

    // CUIT + company — right-aligned in green section
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...C_WHITE);
    doc.text("CUIT : 30-71855184-2",     PW - MR, FOOTER_Y + FT_GRAY_H + 3,   { align: "right" });
    doc.text("VEGETALES ARGENTINOS SRL", PW - MR, FOOTER_Y + FT_GRAY_H + 6.5, { align: "right" });
  };

  // ────────────────────────────────────────────────────────────────────────────
  // PAGE HEADER — logo + FECHA/REMITO + separator [+ cliente on first page]
  // ────────────────────────────────────────────────────────────────────────────
  const drawPageHeader = (isFirst: boolean) => {
    // Logo (height 32mm, width proportional to 1920×1080 aspect ≈ 57mm)
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, "JPEG", ML, 5, 57, 32);
      } catch { /* skip logo if jsPDF rejects it */ }
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(...C_TEXT);
      doc.text("vegetales argentinos.", ML, 22);
    }

    // FECHA + REMITO — right-aligned
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...C_TEXT);
    doc.text(`FECHA : ${remitoDate}`,  PW - MR, 18, { align: "right" });
    doc.text(`REMITO : ${data.folio}`, PW - MR, 25, { align: "right" });

    // Separator line
    doc.setDrawColor(...C_SEP);
    doc.setLineWidth(0.4);
    doc.line(ML, SEP_Y, PW - MR, SEP_Y);
    doc.setLineWidth(0.2);

    // "Cliente:" — first page only
    if (isFirst) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...C_TEXT);
      doc.text(`Cliente: ${data.order.customer.name}`, ML, CLIENT_Y);
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // TABLE HEADER ROW
  // ────────────────────────────────────────────────────────────────────────────
  const drawTableHeader = (y: number) => {
    doc.setFillColor(...C_TBL_HDR);
    doc.rect(ML, y, CW, TH_H, "F");
    doc.setTextColor(...C_WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    const ty = y + TH_H / 2 + 2.5;

    if (!hidePrecios) {
      if (hasIva) {
        // 6 cols
        doc.text("CANTIDAD",    C.cantX  + C.cantW  / 2, ty, { align: "center" });
        doc.text("UNIDAD",      C.unitX  + C.unitW  / 2, ty, { align: "center" });
        doc.text("PRODUCTO",    C.prodX  + 3, ty);
        doc.text("PRECIO",      C.priceX + C.priceW - 2, ty, { align: "right" });
        doc.text("TOTAL",       C.totX   + C.totW   - 2, ty, { align: "right" });
        doc.text("TOTAL + IVA", C.tivaX  + C.tivaW  - 2, ty, { align: "right" });
      } else {
        // 5 cols (no IVA column)
        doc.text("CANTIDAD", CN.cantX  + CN.cantW  / 2, ty, { align: "center" });
        doc.text("UNIDAD",   CN.unitX  + CN.unitW  / 2, ty, { align: "center" });
        doc.text("PRODUCTO", CN.prodX  + 3, ty);
        doc.text("PRECIO",   CN.priceX + CN.priceW - 2, ty, { align: "right" });
        doc.text("TOTAL",    CN.totX   + CN.totW   - 2, ty, { align: "right" });
      }
    } else {
      // 3 cols (no prices)
      doc.text("CANTIDAD", CH.cantX + CH.cantW / 2, ty, { align: "center" });
      doc.text("UNIDAD",   CH.unitX + CH.unitW / 2, ty, { align: "center" });
      doc.text("PRODUCTO", CH.prodX + 3, ty);
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // DRAW FIRST PAGE SCAFFOLD
  // ────────────────────────────────────────────────────────────────────────────
  drawPageHeader(true);
  drawFooter();
  drawTableHeader(TABLE_Y1);

  let y = TABLE_Y1 + TH_H;
  let rowOnPage = 0;

  // ────────────────────────────────────────────────────────────────────────────
  // ROWS
  // ────────────────────────────────────────────────────────────────────────────
  data.order.items.forEach((item, i) => {
    // Pagination
    if (rowOnPage >= ROWS_MAX) {
      doc.addPage();
      drawPageHeader(false);
      drawFooter();
      drawTableHeader(TABLE_Y2);
      y = TABLE_Y2 + TH_H;
      rowOnPage = 0;
    }

    const qty    = parseFloat(item.quantity);
    const sub    = parseFloat(item.subtotal);
    const price  = parseFloat(item.pricePerUnit);
    const pName  = item.product?.name ?? "Producto sin nombre";
    const unit   = item.unit.toUpperCase();
    const iva    = itemIvaRate(pName);
    const subIva = sub * (1 + iva);

    // Alternate row bg (odd index = gray)
    if (i % 2 === 1) {
      doc.setFillColor(...C_ALT_ROW);
      doc.rect(ML, y, CW, ROW_H, "F");
    }

    // Row bottom divider
    doc.setDrawColor(...C_ROW_SEP);
    doc.setLineWidth(0.1);
    doc.line(ML, y + ROW_H, ML + CW, y + ROW_H);

    doc.setTextColor(...C_TEXT);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    const ty = y + ROW_H - 2;  // baseline inside row

    if (!hidePrecios) {
      if (hasIva) {
        doc.text(qty % 1 === 0 ? String(qty) : qty.toFixed(2), C.cantX + C.cantW / 2, ty, { align: "center" });
        doc.text(unit, C.unitX + C.unitW / 2, ty, { align: "center" });
        doc.text(doc.splitTextToSize(pName, C.prodW - 4)[0], C.prodX + 2, ty);
        doc.text(fmtMoney(price),  C.priceX + C.priceW - 2, ty, { align: "right" });
        doc.text(fmtMoney(sub),    C.totX   + C.totW   - 2, ty, { align: "right" });
        doc.text(fmtMoney(subIva), C.tivaX  + C.tivaW  - 2, ty, { align: "right" });
      } else {
        doc.text(qty % 1 === 0 ? String(qty) : qty.toFixed(2), CN.cantX + CN.cantW / 2, ty, { align: "center" });
        doc.text(unit, CN.unitX + CN.unitW / 2, ty, { align: "center" });
        doc.text(doc.splitTextToSize(pName, CN.prodW - 4)[0], CN.prodX + 2, ty);
        doc.text(fmtMoney(price), CN.priceX + CN.priceW - 2, ty, { align: "right" });
        doc.text(fmtMoney(sub),   CN.totX   + CN.totW   - 2, ty, { align: "right" });
      }
    } else {
      doc.text(qty % 1 === 0 ? String(qty) : qty.toFixed(2), CH.cantX + CH.cantW / 2, ty, { align: "center" });
      doc.text(unit, CH.unitX + CH.unitW / 2, ty, { align: "center" });
      doc.text(doc.splitTextToSize(pName, CH.prodW - 4)[0], CH.prodX + 2, ty);
    }

    y += ROW_H;
    rowOnPage++;
  });

  // ────────────────────────────────────────────────────────────────────────────
  // NOTES (if any)
  // ────────────────────────────────────────────────────────────────────────────
  if (data.order.notes) {
    y += 3;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text(`Notas: ${data.order.notes}`, ML, y + 4);
    y += 8;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TOTALS — right-aligned under price columns
  // ────────────────────────────────────────────────────────────────────────────
  if (!hidePrecios) {
    y += 4;
    doc.setDrawColor(...C_SEP);
    doc.setLineWidth(0.3);
    doc.line(ML, y, ML + CW, y);
    y += 6;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...C_TEXT);

    if (hasIva) {
      doc.text(fmtMoney(totalSinIva), C.totX  + C.totW  - 2, y, { align: "right" });
      doc.text(fmtMoney(totalConIva), C.tivaX + C.tivaW - 2, y, { align: "right" });
    } else {
      doc.text(fmtMoney(totalSinIva), CN.totX + CN.totW - 2, y, { align: "right" });
    }
    y += 10;
  } else {
    y += 4;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RECIBIO CONFORME — pinned near footer regardless of item count
  // ────────────────────────────────────────────────────────────────────────────
  const conformeY = Math.max(y + 6, FOOTER_Y - 32);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...C_TEXT);
  doc.text("RECIBIO CONFORME:", ML, conformeY);

  doc.setDrawColor(120, 120, 120);
  doc.setLineWidth(0.5);
  doc.line(ML, conformeY + 10, ML + 110, conformeY + 10);

  doc.save(`Remito-${data.folio}.pdf`);
}

// ── Bolsa FV PDF (unchanged) ─────────────────────────────────────────────────

export type BolsaFvRow = {
  orderFolio: string;
  orderDate: string | Date;
  customerName: string;
  productName: string | null;
  quantity: string;
  unit: string;
  pricePerUnit: string | null;
  subtotal: string;
  bolsaType: string;
};

export function generateBolsaFvPDF(rows: BolsaFvRow[], grandTotal: number, from: string, to: string) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const margin = 15;
  let y = margin;

  const fmtDate = (d: string | Date) =>
    new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtMoney = (v: string | null) =>
    v ? `$${parseFloat(v).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

  doc.setFillColor(29, 78, 216);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Reporte Bolsa FV", margin, 13);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Período: ${from} — ${to}`, margin, 22);

  y = 38;

  const cols = { fecha: margin, cliente: margin + 22, producto: margin + 72, cant: margin + 122, precio: margin + 142, subtotal: margin + 162, tipo: margin + 180 };
  doc.setFillColor(29, 78, 216);
  doc.rect(margin, y, pageW - margin * 2, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("Fecha",    cols.fecha + 1,    y + 4.5);
  doc.text("Cliente",  cols.cliente + 1,  y + 4.5);
  doc.text("Producto", cols.producto + 1, y + 4.5);
  doc.text("Cant.",    cols.cant + 1,     y + 4.5);
  doc.text("Precio",   cols.precio + 1,   y + 4.5);
  doc.text("Total",    cols.subtotal + 1, y + 4.5);
  doc.text("Tipo",     cols.tipo + 1,     y + 4.5);
  y += 9;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  rows.forEach((row, i) => {
    if (y > 270) { doc.addPage(); y = margin; }
    if (i % 2 === 0) {
      doc.setFillColor(248, 248, 255);
      doc.rect(margin, y - 2, pageW - margin * 2, 7, "F");
    }
    doc.setTextColor(30, 30, 30);
    doc.text(fmtDate(row.orderDate),                       cols.fecha + 1,    y + 3);
    doc.text((row.customerName ?? "").slice(0, 22),        cols.cliente + 1,  y + 3);
    doc.text((row.productName ?? "—").slice(0, 22),        cols.producto + 1, y + 3);
    doc.text(`${parseFloat(row.quantity).toFixed(2)} ${row.unit}`, cols.cant + 1, y + 3);
    doc.text(fmtMoney(row.pricePerUnit),                   cols.precio + 1,   y + 3);
    doc.text(fmtMoney(row.subtotal),                       cols.subtotal + 1, y + 3);
    doc.text(row.bolsaType === "bolsa_propia" ? "Propia" : "Bolsa", cols.tipo + 1, y + 3);
    y += 7;
  });

  y += 4;
  doc.setFillColor(29, 78, 216);
  doc.rect(pageW - margin - 60, y, 60, 9, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("TOTAL:", pageW - margin - 42, y + 6);
  doc.text(`$${grandTotal.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, pageW - margin - 3, y + 6, { align: "right" });

  doc.save(`BolsaFV-${from}-${to}.pdf`);
}

export type ComisionRow = {
  orderDate: string;
  customerName: string;
  total: number;
  commissionPct: number;
  commissionAmount: number;
};

export function generateComisionesPDF(
  vendedor: string,
  monthLabel: string,
  rows: ComisionRow[],
  totalVentas: number,
  totalComision: number,
) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const margin = 15;
  let y = margin;

  const fmtDate = (d: string) =>
    new Date(d + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtMoney = (v: number) =>
    `$${v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Header bar
  doc.setFillColor(29, 78, 216);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Reporte de Comisiones", margin, 13);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Vendedor: ${vendedor}  —  Período: ${monthLabel}`, margin, 22);

  y = 38;

  const cols = {
    fecha:    margin,
    cliente:  margin + 26,
    total:    margin + 122,
    pct:      margin + 148,
    comision: margin + 163,
  };

  doc.setFillColor(29, 78, 216);
  doc.rect(margin, y, pageW - margin * 2, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("Fecha",    cols.fecha + 1,    y + 4.5);
  doc.text("Cliente",  cols.cliente + 1,  y + 4.5);
  doc.text("Total",    cols.total + 1,    y + 4.5);
  doc.text("%",        cols.pct + 1,      y + 4.5);
  doc.text("Comisión", cols.comision + 1, y + 4.5);
  y += 9;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  rows.forEach((row, i) => {
    if (y > 270) { doc.addPage(); y = margin; }
    if (i % 2 === 0) {
      doc.setFillColor(248, 248, 255);
      doc.rect(margin, y - 2, pageW - margin * 2, 7, "F");
    }
    doc.setTextColor(30, 30, 30);
    doc.text(fmtDate(row.orderDate),                  cols.fecha + 1,    y + 3);
    doc.text((row.customerName ?? "").slice(0, 42),   cols.cliente + 1,  y + 3);
    doc.text(fmtMoney(row.total),                     cols.total + 24,   y + 3, { align: "right" });
    doc.text(`${row.commissionPct.toFixed(1)}%`,      cols.pct + 1,      y + 3);
    doc.text(fmtMoney(row.commissionAmount),          pageW - margin - 2, y + 3, { align: "right" });
    y += 7;
  });

  // Totals footer
  y += 4;
  if (y > 270) { doc.addPage(); y = margin; }
  doc.setFillColor(29, 78, 216);
  doc.rect(margin, y, pageW - margin * 2, 10, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("TOTAL VENTAS:", cols.cliente + 1, y + 6.5);
  doc.text(fmtMoney(totalVentas), cols.total + 24, y + 6.5, { align: "right" });
  doc.text("TOTAL COMISIÓN:", cols.pct - 2, y + 6.5);
  doc.text(fmtMoney(totalComision), pageW - margin - 2, y + 6.5, { align: "right" });

  doc.save(`Comisiones-${vendedor.replace(/\s+/g, "-")}-${monthLabel.replace(/\s+/g, "-")}.pdf`);
}
