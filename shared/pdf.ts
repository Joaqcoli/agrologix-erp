// ─── PDFs de remito y factura — ISOMÓRFICOS ──────────────────────────────────
// Este archivo corre en el navegador (descarga con doc.save) y en el servidor Node
// (devuelve un Buffer para, p. ej., mandarlo por WhatsApp). Mismo dibujo en ambos.
// Reglas: no usar APIs del navegador sin guardas (typeof document/fetch/Image), y
// nada de lógica de negocio nueva acá: solo presentación.
// Export NOMBRADO a propósito: el build Node de jspdf (dist/jspdf.node.min.js) no marca __esModule,
// y en el bundle CJS del servidor `import jsPDF from` resolvería al módulo entero (new falla).
// `{ jsPDF }` existe en el build ES (navegador), en el Node y en los types.
import { jsPDF } from "jspdf";
import { ivaRateOf } from "@shared/iva";

/** Opciones comunes de salida (navegador o servidor). */
export type PdfOutputOpts = {
  /** "download" (default): doc.save() en el navegador. "buffer": devuelve los bytes (Node). */
  output?: "download" | "buffer";
  /** Logo ya cargado como data URL (PNG o JPEG). Si se pasa (aunque sea null) NO se hace fetch. */
  logoDataUrl?: string | null;
  /** Nombre del archivo al descargar (solo output "download"). Default: el histórico. */
  fileName?: string;
};

export type RemitoData = {
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
      product: { name: string; sku: string; ivaRate?: string | number | null } | null;
      quantity: string;
      unit: string;
      pricePerUnit: string;
      subtotal: string;
      isBonification?: boolean | null;
      aliasNombre?: string | null;
    }[];
    total: string;
  };
};

// La tasa de IVA sale de product.iva_rate (helper compartido). Ver M6.
function itemIvaRate(product?: { ivaRate?: string | number | null } | null): number {
  return ivaRateOf(product);
}

/** Regla ÚNICA de nombre a mostrar en documentos del cliente (remito/factura):
 *  si la línea tiene alias_nombre con valor → ese; si no → nombre real del producto. */
function displayItemName(item: {
  product?: { name: string; [k: string]: any } | null;
  rawProductName?: string | null;
  aliasNombre?: string | null;
}): string {
  const alias = (item.aliasNombre ?? "").trim();
  if (alias) return alias;
  return (item.product?.name ?? item.rawProductName ?? "").trim();
}

/** Merge items with the same DISPLAY name (alias-aware) + unit + product into a single row
 *  (bolsa/bolsa_propia + normal). Alias distinto ⇒ clave distinta ⇒ NO se fusionan. */
function mergeForPDF<T extends {
  product?: { name: string; [k: string]: any } | null;
  productId?: number | null;
  rawProductName?: string | null;
  aliasNombre?: string | null;
  quantity: string;
  unit: string;
  pricePerUnit?: string | null;
  subtotal: string;
  [k: string]: any;
}>(items: T[]): T[] {
  const result: T[] = [];
  const idx = new Map<string, number>();
  for (const item of items) {
    const name = displayItemName(item);
    const isBonif = !!(item as any).isBonification;
    if (!name || isBonif) { result.push(item); continue; }
    // Clave incluye productId: dos productos reales distintos con el MISMO alias no se fusionan.
    const key = `${name.toLowerCase()}||${item.unit.toLowerCase()}||${item.productId ?? item.product?.id ?? "x"}`;
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
// Solo navegador: en Node devuelve null (el servidor pasa logoDataUrl por opción).
export async function loadLogoAsJpeg(): Promise<string | null> {
  if (typeof fetch === "undefined" || typeof document === "undefined" || typeof Image === "undefined") {
    return null;
  }
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

/** Resuelve el logo: si vino por opción se usa tal cual (null = sin logo); si no, se carga del navegador. */
async function resolveLogo(opts?: PdfOutputOpts): Promise<string | null> {
  if (opts && "logoDataUrl" in opts && opts.logoDataUrl !== undefined) return opts.logoDataUrl;
  return loadLogoAsJpeg();
}

/** addImage según el formato del data URL. En el navegador el logo llega como JPEG (canvas);
 *  en Node llega el PNG crudo: se incrusta como PNG con compresión (sin compresión jsPDF
 *  escribe el RGBA 1920×1080 plano → ~8 MB). */
function addLogo(doc: jsPDF, logoDataUrl: string, x: number, y: number, w: number, h: number) {
  if (/^data:image\/png/i.test(logoDataUrl)) {
    doc.addImage(logoDataUrl, "PNG", x, y, w, h, undefined, "SLOW");
  } else {
    doc.addImage(logoDataUrl, "JPEG", x, y, w, h);
  }
}

/** Cierre común: descarga en el navegador o bytes (Buffer en Node, Uint8Array si no hay Buffer). */
function finishDoc(doc: jsPDF, defaultFileName: string, opts?: PdfOutputOpts): Uint8Array | undefined {
  if (opts?.output === "buffer") {
    const ab = doc.output("arraybuffer");
    return typeof Buffer !== "undefined" ? Buffer.from(ab) : new Uint8Array(ab);
  }
  doc.save(opts?.fileName ?? defaultFileName);
  return undefined;
}

// Fecha dd/mm/aaaa en hora Argentina. El navegador de la empresa ya está en esa zona;
// la zona explícita hace que el servidor (UTC) muestre el mismo día.
const fmtDateAr = (d: string | Date) =>
  new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" });

export async function generateRemitoPDF(
  data: RemitoData,
  opts?: { hidePrecios?: boolean } & PdfOutputOpts,
): Promise<Uint8Array | undefined> {
  const hidePrecios = opts?.hidePrecios ?? false;
  const hasIva = data.order.customer.hasIva ?? false;

  const logoDataUrl = await resolveLogo(opts);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const fmtDate = fmtDateAr;
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
    totalConIva += sub * (1 + itemIvaRate(item.product));
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
        addLogo(doc, logoDataUrl, ML, 5, 57, 32);
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
    const pName  = (displayItemName(item) || "Producto sin nombre") + (isBonif ? " (Bonificacion)" : "");
    const unit   = item.unit.toUpperCase();
    const iva    = itemIvaRate(item.product);
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

  return finishDoc(doc, `Remito-${data.folio}.pdf`, opts);
}

// ── Factura Electrónica PDF ───────────────────────────────────────────────────

export type InvoicePdfData = {
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
      product?: { name: string; ivaRate?: string | number | null } | null;
      productId?: number | null;
      rawProductName?: string | null;
      aliasNombre?: string | null;
      quantity: string;
      unit: string;
      pricePerUnit?: string | null;
      subtotal: string;
    }[];
  };
};

export async function generateInvoicePDF(
  data: InvoicePdfData,
  detailMode: "completo" | "agrupado" = "completo",
  opts?: { isNotaCredito?: boolean } & PdfOutputOpts,
): Promise<Uint8Array | undefined> {
  const isNotaCredito = opts?.isNotaCredito ?? false;
  const { invoice, customer, order } = data;
  const logoDataUrl = await resolveLogo(opts);

  const fmtDate = fmtDateAr;
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
    try { addLogo(doc, logoDataUrl, ML, 5, 57, 32); } catch { /**/ }
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
    const isHuevo = ivaRateOf(item.product) >= 0.2; // bucket 21% (huevos)
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
      if (ivaRateOf(item.product) >= 0.2 && !seen.has(pName)) {
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
      const pName = displayItemName(item) || "Producto sin nombre";
      const rate  = itemIvaRate(item.product);
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

  return finishDoc(doc, `Factura-${invoice.invoiceNumber}.pdf`, opts);
}
