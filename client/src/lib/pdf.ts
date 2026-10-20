import jsPDF from "jspdf";
import { loadLogoAsJpeg } from "@shared/pdf";

// Remito y Factura viven en shared/pdf.ts (isomórficos: navegador y servidor).
// Se re-exportan acá para que los imports `@/lib/pdf` sigan funcionando sin cambios.
export {
  generateRemitoPDF,
  generateInvoicePDF,
  loadLogoAsJpeg,
  type RemitoData,
  type InvoicePdfData,
  type PdfOutputOpts,
} from "@shared/pdf";

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

// ─── Hoja de armado del galpón (SIN precios) ─────────────────────────────────
// Lista por pedido: cantidad · unidad · producto, con el cliente y quién hizo el pedido.
// Empaqueta varios pedidos en la misma hoja para no malgastar papel.
export type ArmadoOrder = {
  folio: string;
  customerName: string;
  createdByName?: string | null;
  items: { quantity: string; unit: string; productName: string | null }[];
  /** Notas del bot (qué asumió) y del encargado: se imprimen en la hoja de armado, no en el remito (20/10). */
  notes?: string | null;
  galponNotes?: string | null;
};

export function generateArmadoPDF(orders: ArmadoOrder[], dateLabel: string) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210, pageH = 297, margin = 12;
  const lineH = 5;
  const fmtQty = (q: string) => {
    const n = parseFloat(q);
    return Number.isFinite(n) ? String(+n.toFixed(2)) : q;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`HOJA DE ARMADO — ${dateLabel}`, pageW / 2, margin, { align: "center" });
  let y = margin + 8;

  const bottom = pageH - margin;
  for (const ord of orders) {
    // Notas (bot y galpón) en líneas cortas para la hoja
    doc.setFont("helvetica", "italic"); doc.setFontSize(8);
    const notasLineas: string[] = [];
    if (ord.notes?.trim()) notasLineas.push(...(doc.splitTextToSize(`Notas: ${ord.notes.trim().replace(/\s*\n\s*/g, " · ")}`, pageW - margin * 2) as string[]));
    if (ord.galponNotes?.trim()) notasLineas.push(...(doc.splitTextToSize(`Galpón: ${ord.galponNotes.trim().replace(/\s*\n\s*/g, " · ")}`, pageW - margin * 2) as string[]));
    // Alto COMPLETO del pedido (separador + header + encabezados + ítems + notas + espacio)
    const fullBlockH = 5 + 5 + 5.5 + ord.items.length * lineH + (notasLineas.length ? notasLineas.length * 3.8 + 2 : 0) + 5;
    const fitsOnEmptyPage = fullBlockH <= bottom - margin;
    // Si el pedido NO entra completo en lo que queda de la hoja, y sí entra en una hoja
    // vacía → arrancar en hoja nueva. Así nunca se parte un mismo pedido entre dos hojas.
    // (Si el pedido es tan grande que no entra ni en una hoja vacía, se deja fluir/partir.)
    if (y > margin + 8 && y + fullBlockH > bottom && fitsOnEmptyPage) {
      doc.addPage();
      y = margin;
    }

    // separador + header del pedido
    doc.setDrawColor(170); doc.setLineWidth(0.3);
    doc.line(margin, y, pageW - margin, y);
    y += 5;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(ord.customerName, margin, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    const meta = `${ord.folio}${ord.createdByName ? "  ·  Pedido por: " + ord.createdByName : ""}`;
    doc.text(meta, pageW - margin, y, { align: "right" });
    y += 5;

    // encabezados de columna
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(110);
    doc.text("CANT.", margin, y); doc.text("UN.", margin + 18, y); doc.text("PRODUCTO", margin + 32, y);
    doc.setTextColor(0);
    y += 1.5; doc.setDrawColor(220); doc.line(margin, y, pageW - margin, y); y += 4;

    // ítems
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    for (const it of ord.items) {
      if (y > pageH - margin) { doc.addPage(); y = margin; }
      doc.text(fmtQty(it.quantity), margin, y);
      doc.text(it.unit ?? "", margin + 18, y);
      doc.text(it.productName ?? "—", margin + 32, y);
      y += lineH;
    }
    if (notasLineas.length) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(90);
      for (const ln of notasLineas) { if (y > pageH - margin) { doc.addPage(); y = margin; } doc.text(ln, margin, y); y += 3.8; }
      doc.setTextColor(0); y += 2;
    }
    y += 5;
  }

  doc.save(`armado-${dateLabel}.pdf`);
}
