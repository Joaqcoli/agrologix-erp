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
      isBonification?: boolean | null;
    }[];
    total: string;
  };
};

function itemIvaRate(name: string): number {
  return /huevo/i.test(name) ? 0.21 : 0.105;
}

/** Merge items with the same product name+unit into a single row (bolsa/bolsa_propia + normal). */
function mergeForPDF<T extends {
  product?: { name: string; [k: string]: any } | null;
  rawProductName?: string | null;
  quantity: string;
  unit: string;
  pricePerUnit?: string | null;
  subtotal: string;
  [k: string]: any;
}>(items: T[]): T[] {
  const result: T[] = [];
  const idx = new Map<string, number>();
  for (const item of items) {
    const name = (item.product?.name ?? item.rawProductName ?? "").trim();
    const isBonif = !!(item as any).isBonification;
    if (!name || isBonif) { result.push(item); continue; }
    const key = `${name.toLowerCase()}||${item.unit.toLowerCase()}`;
    if (idx.has(key)) {
      const i = idx.get(key)!;
      const ex = result[i];
      const newQty  = parseFloat(ex.quantity)  + parseFloat(item.quantity);
      const newSub  = parseFloat(ex.subtotal)  + parseFloat(item.subtotal);
      const exPrice = parseFloat(ex.pricePerUnit  ?? "0");
      const itPrice = parseFloat(item.pricePerUnit ?? "0");
      result[i] = { ...ex, quantity: String(newQty), subtotal: newSub.toFixed(2),
        pricePerUnit: String(exPrice > 0 ? exPrice : itPrice) };
    } else {
      idx.set(key, result.length);
      result.push({ ...item });
    }
  }
  return result;
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

  // ── Sort + merge same-product items (bolsa/bolsa_propia + normal) ───────────
  const sortedItems = [...data.order.items].sort((a, b) =>
    (a.product?.name ?? "").localeCompare(b.product?.name ?? "", "es", { sensitivity: "base" })
  );
  const displayItems = mergeForPDF(sortedItems);

  // ── Totals ─────────────────────────────────────────────────────────────────
  let totalSinIva = 0;
  let totalConIva = 0;
  for (const item of displayItems) {
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
  displayItems.forEach((item, i) => {
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
    const isBonif = !!(item as any).isBonification;
    const pName  = (item.product?.name ?? "Producto sin nombre") + (isBonif ? " (Bonificacion)" : "");
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

// ── Lista de Precios PDF ─────────────────────────────────────────────────────

export type PriceListPdfItem = {
  category: string;
  productName: string;
  pricePerCajon: string;
  pricePerKg: string;
};

export async function generatePriceListPDF(items: PriceListPdfItem[], dateLabel: string) {
  const logoDataUrl = await loadLogoAsJpeg();
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const PW = 210, PH = 297;
  const ML = 14, MR = 14;
  const CW = PW - ML - MR; // 182mm

  // Column widths: Producto | Precio x Cajón | Precio x Kg/U
  const PROD_W  = 98;
  const PRICE_W = (CW - PROD_W) / 2; // 42mm each
  const PROD_X  = ML;
  const CAJON_X = ML + PROD_W;
  const KG_X    = ML + PROD_W + PRICE_W;

  // Row heights
  const CAT_H  = 7;  // category title row (olive)
  const COL_H  = 7;  // column header row (dark gray)
  const ROW_H  = 6;  // product row
  const CAT_GAP = 6; // vertical gap between sections on same page

  // Layout: same header on every page
  const SEP_Y      = 36;   // separator line y
  const TABLE_Y    = 40;   // content starts here (all pages)
  const FT_GRAY_H  = 15;   // footer gray section height (matches remito)
  const FT_GREEN_H = 8;    // footer green section height (matches remito)
  const FOOTER_H   = FT_GRAY_H + FT_GREEN_H; // 23mm
  const FT_Y       = PH - FOOTER_H;           // 274mm — where footer starts
  const MAX_Y      = FT_Y - 2;

  // Colors
  const C_OLIVE:    [number, number, number] = [107, 122, 45];   // olive green — category title bg
  const C_COL:      [number, number, number] = [74,  74,  74];   // #4a4a4a — column header bg
  const C_ALT:      [number, number, number] = [245, 245, 245];  // #f5f5f5 — alternate row bg
  const C_WHITE:    [number, number, number] = [255, 255, 255];
  const C_TEXT:     [number, number, number] = [30,  30,  30];
  const C_SEP:      [number, number, number] = [180, 180, 180];
  const C_ROWSEP:   [number, number, number] = [215, 215, 215];
  const C_FT_GRAY:  [number, number, number] = [224, 224, 224];
  const C_FT_GREEN: [number, number, number] = [45,  80,  22];
  const C_FT_LBL:   [number, number, number] = [102, 102, 102];
  const C_FT_VAL:   [number, number, number] = [34,  34,  34];

  // Argentine price format: $ 15.000 / — for zero
  const fmtPrice = (v: string) => {
    const n = Math.round(parseFloat(v));
    if (!n) return "—";
    return `$ ${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
  };

  // Skip products where BOTH prices are 0 or empty
  const filterItems = (list: PriceListPdfItem[]) =>
    list.filter((i) => {
      const c = Math.round(parseFloat(i.pricePerCajon) || 0);
      const k = Math.round(parseFloat(i.pricePerKg) || 0);
      return c !== 0 || k !== 0;
    });

  // ── HEADER — identical on every page ──────────────────────────────────────
  const drawHeader = () => {
    // Logo — left, bigger (30mm height, 16:9 aspect ≈ 53mm wide)
    if (logoDataUrl) {
      try { doc.addImage(logoDataUrl, "JPEG", ML, 3, 30 * (1920 / 1080), 30); } catch { /**/ }
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(45, 80, 22);
      doc.text("vegetales argentinos.", ML, 22);
    }

    // "LISTA DE PRECIOS" — top right, slightly smaller bold black
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(20, 20, 20);
    doc.text("LISTA DE PRECIOS", PW - MR, 17, { align: "right" });

    // Date — below title, gray
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(100, 100, 100);
    doc.text(dateLabel, PW - MR, 26, { align: "right" });

    // Separator line
    doc.setDrawColor(...C_SEP);
    doc.setLineWidth(0.4);
    doc.line(ML, SEP_Y, PW - MR, SEP_Y);
    doc.setLineWidth(0.2);
  };

  // ── FOOTER — idéntico al remito (gris + verde) ────────────────────────────
  const drawFooter = () => {
    // Gray top section
    doc.setFillColor(...C_FT_GRAY);
    doc.rect(0, FT_Y, PW, FT_GRAY_H, "F");

    // Dark green bottom section
    doc.setFillColor(...C_FT_GREEN);
    doc.rect(0, FT_Y + FT_GRAY_H, PW, FT_GREEN_H, "F");

    const c1 = ML, c2 = ML + CW * 0.34, c3 = ML + CW * 0.66;

    // Labels
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...C_FT_LBL);
    doc.text("WhatsApp", c1, FT_Y + 5);
    doc.text("Email",    c2, FT_Y + 5);
    doc.text("Website",  c3, FT_Y + 5);

    // Values
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C_FT_VAL);
    doc.text("11-7123-2459",                      c1, FT_Y + 11);
    doc.text("vegetalesargentinos.srl@gmail.com", c2, FT_Y + 11);
    doc.text("www.vegetalesargentinos.com",        c3, FT_Y + 11);

    // CUIT + company — right-aligned in green section
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...C_WHITE);
    doc.text("CUIT: 30-71855184-2",      PW - MR, FT_Y + FT_GRAY_H + 3,   { align: "right" });
    doc.text("VEGETALES ARGENTINOS SRL", PW - MR, FT_Y + FT_GRAY_H + 6.5, { align: "right" });
  };

  // ── TABLE HELPERS ──────────────────────────────────────────────────────────
  // Olive category title row; returns y after row
  const drawCatTitle = (y: number, catName: string): number => {
    doc.setFillColor(...C_OLIVE);
    doc.rect(ML, y, CW, CAT_H, "F");
    doc.setTextColor(...C_WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(catName.toUpperCase(), ML + CW / 2, y + CAT_H / 2 + 2.5, { align: "center" });
    return y + CAT_H;
  };

  // Dark-gray column header row; returns y after row
  const drawColHeader = (y: number): number => {
    doc.setFillColor(...C_COL);
    doc.rect(ML, y, CW, COL_H, "F");
    doc.setTextColor(...C_WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    const ty = y + COL_H / 2 + 2.5;
    doc.text("Producto",       PROD_X  + 3,           ty);
    doc.text("Precio x Cajón", CAJON_X + PRICE_W - 3, ty, { align: "right" });
    doc.text("Precio x Kg/U",  KG_X    + PRICE_W - 3, ty, { align: "right" });
    return y + COL_H;
  };

  // Outer border + column separators (separators start below cat title row)
  const drawBlockFrame = (startY: number, colHdrY: number, endY: number) => {
    doc.setDrawColor(...C_SEP);
    doc.setLineWidth(0.2);
    doc.rect(ML, startY, CW, endY - startY, "S");
    doc.setLineWidth(0.1);
    doc.line(CAJON_X, colHdrY, CAJON_X, endY);
    doc.line(KG_X,    colHdrY, KG_X,    endY);
  };

  // ── GROUP ITEMS ────────────────────────────────────────────────────────────
  const CAT_ORDER = ["Verdura", "Fruta", "Hortaliza Liviana", "Hortaliza Pesada", "Hongos/Hierbas", "Huevos"];
  const grouped = new Map<string, PriceListPdfItem[]>();
  for (const c of CAT_ORDER) grouped.set(c, []);
  for (const item of items) {
    if (!grouped.has(item.category)) grouped.set(item.category, []);
    grouped.get(item.category)!.push(item);
  }

  const PAGE_GROUPS: string[][] = [
    ["Verdura"],
    ["Fruta"],
    ["Hortaliza Liviana", "Hortaliza Pesada"],
    ["Hongos/Hierbas", "Huevos"],
  ];

  // Render one category. rowIdx.n drives alternating rows across categories on same page.
  const renderCategory = (cat: string, y: number, rowIdx: { n: number }): number => {
    const catItems = filterItems(grouped.get(cat) ?? []);
    if (catItems.length === 0) return y;

    let blockStartY = y;
    y = drawCatTitle(y, cat);
    let colHdrY = y;
    y = drawColHeader(y);

    for (const item of catItems) {
      if (y + ROW_H > MAX_Y) {
        drawBlockFrame(blockStartY, colHdrY, y);
        doc.addPage();
        drawHeader();
        drawFooter();
        y = TABLE_Y;
        blockStartY = y;
        y = drawCatTitle(y, cat);
        colHdrY = y;
        y = drawColHeader(y);
        rowIdx.n = 0;
      }

      // Alternating rows: even=white, odd=light gray
      if (rowIdx.n % 2 === 0) {
        doc.setFillColor(...C_WHITE);
      } else {
        doc.setFillColor(...C_ALT);
      }
      doc.rect(ML, y, CW, ROW_H, "F");

      doc.setDrawColor(...C_ROWSEP);
      doc.setLineWidth(0.1);
      doc.line(ML, y + ROW_H, ML + CW, y + ROW_H);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...C_TEXT);
      const ry = y + ROW_H - 1.5;
      doc.text(doc.splitTextToSize(item.productName, PROD_W - 5)[0], PROD_X + 3, ry);
      doc.text(fmtPrice(item.pricePerCajon), CAJON_X + PRICE_W - 3, ry, { align: "right" });
      doc.text(fmtPrice(item.pricePerKg),    KG_X    + PRICE_W - 3, ry, { align: "right" });

      y += ROW_H;
      rowIdx.n++;
    }

    drawBlockFrame(blockStartY, colHdrY, y);
    return y;
  };

  // ── RENDER ─────────────────────────────────────────────────────────────────
  let isFirstPage = true;
  for (const pageGroup of PAGE_GROUPS) {
    const hasItems = pageGroup.some((cat) => filterItems(grouped.get(cat) ?? []).length > 0);
    if (!hasItems) continue;

    if (!isFirstPage) doc.addPage();
    isFirstPage = false;

    drawHeader();
    drawFooter();

    let y = TABLE_Y;
    const rowIdx = { n: 0 };
    for (let gi = 0; gi < pageGroup.length; gi++) {
      if (gi > 0) y += CAT_GAP;
      y = renderCategory(pageGroup[gi], y, rowIdx);
    }
  }

  doc.save(`ListaPrecios-${dateLabel.replace(/\//g, "-")}.pdf`);
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

// ── Factura Electrónica PDF ───────────────────────────────────────────────────

export async function generateInvoicePDF(data: {
  invoice: {
    id: number;
    invoiceType: string;
    invoiceNumber: string;
    cae: string;
    caeExpiry: string;
    total: string;
    ivaAmount: string;
    description?: string | null;
    createdAt: string | Date;
  };
  customer: {
    name: string;
    cuit?: string | null;
    address?: string | null;
    city?: string | null;
  };
  order: {
    folio: string;
    items: {
      product?: { name: string } | null;
      rawProductName?: string | null;
      quantity: string;
      unit: string;
      pricePerUnit?: string | null;
      subtotal: string;
    }[];
  };
}, detailMode: "completo" | "agrupado" = "completo", opts?: { isNotaCredito?: boolean }): Promise<void> {
  const isNotaCredito = opts?.isNotaCredito ?? false;
  const { invoice, customer, order } = data;
  const logoDataUrl = await loadLogoAsJpeg();

  const fmtDate = (d: string | Date) =>
    new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtMoney = (v: number) =>
    `$${v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ── Layout constants ─────────────────────────────────────────────────────────
  const PW = 210, PH = 297;
  const ML = 14, MR = 14;
  const CW = PW - ML - MR;

  // ── Colors (reuse same palette) ───────────────────────────────────────────────
  const C_TBL_HDR:  [number, number, number] = [30, 30, 30];
  const C_ALT_ROW:  [number, number, number] = [245, 245, 245];
  const C_FT_GRAY:  [number, number, number] = [224, 224, 224];
  const C_FT_GREEN: [number, number, number] = [45, 80, 22];
  const C_WHITE:    [number, number, number] = [255, 255, 255];
  const C_TEXT:     [number, number, number] = [51, 51, 51];
  const C_SEP:      [number, number, number] = [170, 170, 170];
  const C_ROW_SEP:  [number, number, number] = [210, 210, 210];
  const C_FT_LBL:   [number, number, number] = [102, 102, 102];
  const C_FT_VAL:   [number, number, number] = [34, 34, 34];

  const ROW_H    = 7;
  const TH_H     = 8;
  const FOOTER_H = 23;
  const FT_GRAY_H  = 15;
  const FT_GREEN_H = 8;
  const FOOTER_Y = PH - FOOTER_H;

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // ── Footer ───────────────────────────────────────────────────────────────────
  const drawFooter = () => {
    doc.setFillColor(...C_FT_GRAY);
    doc.rect(0, FOOTER_Y, PW, FT_GRAY_H, "F");
    doc.setFillColor(...C_FT_GREEN);
    doc.rect(0, FOOTER_Y + FT_GRAY_H, PW, FT_GREEN_H, "F");

    const c1 = ML, c2 = ML + CW * 0.34, c3 = ML + CW * 0.66;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...C_FT_LBL);
    doc.text("WhatsApp", c1, FOOTER_Y + 5);
    doc.text("Email",    c2, FOOTER_Y + 5);
    doc.text("Website",  c3, FOOTER_Y + 5);
    doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(...C_FT_VAL);
    doc.text("11-7123-2459",                       c1, FOOTER_Y + 11);
    doc.text("vegetalesargentinos.srl@gmail.com",  c2, FOOTER_Y + 11);
    doc.text("www.vegetalesargentinos.com",         c3, FOOTER_Y + 11);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...C_WHITE);
    doc.text("CUIT : 30-71855184-2",     PW - MR, FOOTER_Y + FT_GRAY_H + 3,   { align: "right" });
    doc.text("VEGETALES ARGENTINOS SRL", PW - MR, FOOTER_Y + FT_GRAY_H + 6.5, { align: "right" });
  };

  // ── Header block ─────────────────────────────────────────────────────────────
  const invoiceDate = fmtDate(invoice.createdAt);
  const tipoLetter = invoice.invoiceType.toUpperCase();

  // Logo
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, "JPEG", ML, 5, 57, 32); } catch { /**/ }
  } else {
    doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(...C_TEXT);
    doc.text("vegetales argentinos.", ML, 22);
  }

  // Company info — center-ish
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...C_TEXT);
  doc.text("Vegetales Argentinos SRL", 80, 12);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text("CUIT: 30-71855184-2", 80, 18);
  doc.text("Buenos Aires, Argentina", 80, 24);

  // Invoice type box — top-right
  const boxX = PW - MR - 28, boxY = 5, boxW = 28, boxH = 32;
  doc.setDrawColor(30, 30, 30); doc.setLineWidth(1.5);
  doc.rect(boxX, boxY, boxW, boxH);
  doc.setLineWidth(0.2);
  doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(...C_TEXT);
  doc.text(tipoLetter, boxX + boxW / 2, boxY + 14, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(7);
  doc.text(isNotaCredito ? "N. Crédito" : "Factura", boxX + boxW / 2, boxY + 20, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
  doc.text(`Nro: ${invoice.invoiceNumber.split("-").slice(1).join("-")}`, boxX + boxW / 2, boxY + 26, { align: "center" });
  doc.text(`Fecha: ${invoiceDate}`, boxX + boxW / 2, boxY + 31, { align: "center" });

  // Separator
  doc.setDrawColor(...C_SEP); doc.setLineWidth(0.4);
  doc.line(ML, 41, PW - MR, 41); doc.setLineWidth(0.2);

  // Customer block
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...C_TEXT);
  doc.text(`Cliente: ${customer.name}`, ML, 47);
  if (customer.cuit) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.text(`CUIT: ${customer.cuit}`, ML + 90, 47);
  }
  if (invoice.description) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
    doc.text(invoice.description, ML, 53);
  }

  // ── Table header ─────────────────────────────────────────────────────────────
  const TABLE_Y = 57;
  const cantX = ML,        cantW = 20;
  const unitX = ML + 20,   unitW = 20;
  const prodX = ML + 40,   prodW = 80;
  const priceX = ML + 120, priceW = 30;
  const totX  = ML + 150,  totW  = 32;

  const drawTableHeader = (atY: number): number => {
    doc.setFillColor(...C_TBL_HDR);
    doc.rect(ML, atY, CW, TH_H, "F");
    doc.setTextColor(...C_WHITE); doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
    const hty = atY + TH_H / 2 + 2.5;
    doc.text("CANTIDAD", cantX + cantW / 2, hty, { align: "center" });
    doc.text("UNIDAD",   unitX + unitW / 2, hty, { align: "center" });
    doc.text("PRODUCTO", prodX + 3, hty);
    doc.text("PRECIO",   priceX + priceW - 2, hty, { align: "right" });
    doc.text("TOTAL",    totX + totW - 2, hty, { align: "right" });
    return atY + TH_H;
  };

  // ── Rows ─────────────────────────────────────────────────────────────────────
  let y = drawTableHeader(TABLE_Y);

  type PdfRow = { qty: string; unit: string; name: string; price: number; sub: number };

  // Pre-compute gross item subtotals per category (always from order items, unmodified)
  let subtotalFrutas = 0, subtotalHuevos = 0;
  for (const item of order.items) {
    const pName = (item.product?.name ?? (item as any).rawProductName ?? "").toUpperCase();
    const isHuevo = pName.includes("HUEVO") || pName.includes("MAPLE");
    const sub = parseFloat((item as any).subtotal) || 0;
    if (isHuevo) subtotalHuevos += sub; else subtotalFrutas += sub;
  }
  const totalIva = parseFloat(invoice.ivaAmount);
  const total    = parseFloat(invoice.total);
  const neto     = total - totalIva;

  // Factura B: IVA no discriminado — está contenido en el total, no se suma.
  // El total que paga el cliente = subtotal bruto de los ítems (independiente del total almacenado).
  const isFacturaB = invoice.invoiceType === "B";
  const grossItemTotal = subtotalFrutas + subtotalHuevos;

  // Para Factura B, IVA contenido derivado de los brutos de los ítems
  const ivaContenidoFrutas = subtotalFrutas * 0.105 / 1.105;
  const ivaContenidoHuevos = subtotalHuevos * 0.21  / 1.21;

  // Para Factura A: derivar netos exactos resolviendo el sistema:
  //   netoF + netoH = neto  y  netoF×0.105 + netoH×0.21 = totalIva
  let netoFrutas = 0, netoHuevos = 0;
  if (subtotalFrutas > 0 && subtotalHuevos > 0) {
    netoHuevos = Math.max(0, Math.min(neto, (totalIva - neto * 0.105) / 0.105));
    netoFrutas = neto - netoHuevos;
  } else if (subtotalHuevos > 0) {
    netoHuevos = neto;
  } else {
    netoFrutas = neto;
  }
  const iva105 = netoFrutas * 0.105;
  const iva21  = netoHuevos * 0.21;

  // Detectar si los ítems de Factura A tienen IVA incluido (ivaIncluido=true al crear)
  const itemsHaveIva = !isFacturaB && grossItemTotal > 1 && Math.abs(grossItemTotal - total) < Math.abs(grossItemTotal - neto);

  let pdfRows: PdfRow[];
  if (detailMode === "agrupado") {
    // Collect distinct egg product names for correct label
    const huevoNames: string[] = [];
    const seen = new Set<string>();
    for (const item of order.items) {
      const pName = (item.product?.name ?? (item as any).rawProductName ?? "").toUpperCase();
      if ((pName.includes("HUEVO") || pName.includes("MAPLE")) && !seen.has(pName)) {
        seen.add(pName);
        huevoNames.push(item.product?.name ?? (item as any).rawProductName ?? pName);
      }
    }
    const huevoLabel = huevoNames.length > 0 ? huevoNames.join(" / ") : "HUEVO";
    pdfRows = [];
    if (isFacturaB) {
      // Factura B: mostrar precios brutos (IVA contenido)
      if (subtotalFrutas > 0) pdfRows.push({ qty: "1", unit: "", name: "FRUTAS Y VERDURAS", price: subtotalFrutas, sub: subtotalFrutas });
      if (subtotalHuevos > 0) pdfRows.push({ qty: "1", unit: "", name: huevoLabel,           price: subtotalHuevos, sub: subtotalHuevos });
    } else {
      // Factura A: mostrar precios netos
      if (subtotalFrutas > 0) pdfRows.push({ qty: "1", unit: "", name: "FRUTAS Y VERDURAS", price: netoFrutas, sub: netoFrutas });
      if (subtotalHuevos > 0) pdfRows.push({ qty: "1", unit: "", name: huevoLabel,           price: netoHuevos, sub: netoHuevos });
    }
  } else {
    const mergedItems = mergeForPDF(order.items);
    pdfRows = mergedItems.map((item) => {
      const pName = item.product?.name ?? item.rawProductName ?? "Producto sin nombre";
      const rate  = itemIvaRate(pName);
      const rawPrice = parseFloat(item.pricePerUnit ?? "0");
      const rawSub   = parseFloat(item.subtotal) || 0;
      // Factura B: siempre brutos. Factura A + ivaIncluido: dividir por (1+tasa).
      const divIva = !isFacturaB && itemsHaveIva;
      return {
        qty:   String(parseFloat(item.quantity) % 1 === 0 ? Math.round(parseFloat(item.quantity)) : parseFloat(item.quantity).toFixed(2)),
        unit:  item.unit.toUpperCase(),
        name:  pName,
        price: divIva ? rawPrice / (1 + rate) : rawPrice,
        sub:   divIva ? rawSub   / (1 + rate) : rawSub,
      };
    });
  }

  pdfRows.forEach((row, i) => {
    if (y + ROW_H > FOOTER_Y - 2) {
      drawFooter();
      doc.addPage();
      y = drawTableHeader(20);
    }
    if (i % 2 === 1) { doc.setFillColor(...C_ALT_ROW); doc.rect(ML, y, CW, ROW_H, "F"); }
    doc.setDrawColor(...C_ROW_SEP); doc.setLineWidth(0.1);
    doc.line(ML, y + ROW_H, ML + CW, y + ROW_H);
    doc.setTextColor(...C_TEXT); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    const ty = y + ROW_H - 2;
    doc.text(row.qty,  cantX + cantW / 2, ty, { align: "center" });
    doc.text(row.unit, unitX + unitW / 2, ty, { align: "center" });
    doc.text(doc.splitTextToSize(row.name, prodW - 4)[0], prodX + 2, ty);
    doc.text(fmtMoney(row.price), priceX + priceW - 2, ty, { align: "right" });
    doc.text(fmtMoney(row.sub),   totX + totW - 2,     ty, { align: "right" });
    y += ROW_H;
  });

  // ── Totals ────────────────────────────────────────────────────────────────────
  if (y + 55 > FOOTER_Y) {
    drawFooter();
    doc.addPage();
    y = 20;
  }
  y += 5;
  doc.setDrawColor(...C_SEP); doc.setLineWidth(0.3);
  doc.line(ML, y, ML + CW, y);
  y += 7;

  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...C_TEXT);
  if (isFacturaB) {
    // Factura B: IVA contenido en el total, no se suma
    doc.text("Subtotal:", priceX, y); doc.text(fmtMoney(grossItemTotal), totX + totW - 2, y, { align: "right" });
    y += 7;
    if (ivaContenidoFrutas > 0 && ivaContenidoHuevos > 0) {
      doc.text("IVA contenido 10.5%:", priceX, y); doc.text(fmtMoney(ivaContenidoFrutas), totX + totW - 2, y, { align: "right" });
      y += 7;
      doc.text("IVA contenido 21%:", priceX, y); doc.text(fmtMoney(ivaContenidoHuevos), totX + totW - 2, y, { align: "right" });
      y += 7;
    } else if (ivaContenidoHuevos > 0) {
      doc.text("IVA contenido 21%:", priceX, y); doc.text(fmtMoney(ivaContenidoHuevos), totX + totW - 2, y, { align: "right" });
      y += 7;
    } else {
      doc.text("IVA contenido 10.5%:", priceX, y); doc.text(fmtMoney(ivaContenidoFrutas), totX + totW - 2, y, { align: "right" });
      y += 7;
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text("TOTAL:", priceX, y); doc.text(fmtMoney(grossItemTotal), totX + totW - 2, y, { align: "right" });
  } else {
    // Factura A: IVA discriminado, se suma al neto
    doc.text("Subtotal Neto:", priceX, y); doc.text(fmtMoney(neto), totX + totW - 2, y, { align: "right" });
    y += 7;
    if (iva105 > 0 && iva21 > 0) {
      doc.text("IVA 10.5%:", priceX, y); doc.text(fmtMoney(iva105), totX + totW - 2, y, { align: "right" });
      y += 7;
      doc.text("IVA 21%:", priceX, y); doc.text(fmtMoney(iva21), totX + totW - 2, y, { align: "right" });
      y += 7;
    } else if (iva21 > 0) {
      doc.text("IVA 21%:", priceX, y); doc.text(fmtMoney(iva21), totX + totW - 2, y, { align: "right" });
      y += 7;
    } else {
      doc.text("IVA 10.5%:", priceX, y); doc.text(fmtMoney(iva105 > 0 ? iva105 : totalIva), totX + totW - 2, y, { align: "right" });
      y += 7;
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text("TOTAL:", priceX, y); doc.text(fmtMoney(total), totX + totW - 2, y, { align: "right" });
  }

  // ── CAE block ─────────────────────────────────────────────────────────────────
  const caeY = Math.max(y + 12, FOOTER_Y - 22);
  doc.setFillColor(...C_FT_GRAY);
  doc.rect(ML, caeY, CW, 16, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(34, 34, 34);
  doc.text("CAE:", ML + 3, caeY + 6);
  doc.setFont("helvetica", "normal");
  doc.text(invoice.cae, ML + 16, caeY + 6);
  doc.setFont("helvetica", "bold");
  const expDate = invoice.caeExpiry.length === 8
    ? `${invoice.caeExpiry.slice(6)}/${invoice.caeExpiry.slice(4, 6)}/${invoice.caeExpiry.slice(0, 4)}`
    : invoice.caeExpiry;
  doc.text("Vencimiento CAE:", ML + 3, caeY + 12);
  doc.setFont("helvetica", "normal");
  doc.text(expDate, ML + 38, caeY + 12);

  drawFooter();

  doc.save(`Factura-${invoice.invoiceNumber}.pdf`);
}
