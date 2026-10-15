// ─── PDFs de remito y factura generados en el SERVIDOR ───────────────────────
// Misma presentación que la descarga del navegador: usa los generadores isomórficos
// de shared/pdf.ts con output "buffer". Arma los datos igual que handleDownloadRemito
// (client/src/pages/orders/detail.tsx) y que la página de facturas.
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { hasIvaOn } from "@shared/iva";
import { generateRemitoPDF, generateInvoicePDF, type RemitoData, type InvoicePdfData } from "@shared/pdf";

const AR_TZ = "America/Argentina/Buenos_Aires";

/** Día/mes/año de una fecha en hora Argentina (nunca toISOString: en UTC cambia el día). */
export function argDate(d: Date): { dd: string; mm: string; yyyy: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AR_TZ, day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { dd: get("day"), mm: get("month"), yyyy: get("year") };
}

/** Día calendario de un order_date. En la base, order_date es un timestamp naive a medianoche
 *  (drizzle lo lee como medianoche UTC): el día es el guardado, NO hay que pasarlo a hora
 *  Argentina (retrocedería un día). Misma convención que hasIvaOn. Si trae hora real → argDate. */
export function orderDay(d: string | Date): { dd: string; mm: string; yyyy: string } {
  const dt = new Date(d);
  if (dt.getUTCHours() === 0 && dt.getUTCMinutes() === 0 && dt.getUTCSeconds() === 0) {
    const iso = dt.toISOString(); // YYYY-MM-DD de la fecha pura
    return { yyyy: iso.slice(0, 4), mm: iso.slice(5, 7), dd: iso.slice(8, 10) };
  }
  return argDate(dt);
}

/** Quita caracteres inválidos en nombres de archivo (Windows/macOS/WhatsApp) y colapsa espacios. */
function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim();
}

// ── Logo: client/public/logo.png (dev) o dist/public/logo.png (prod) → data URL PNG, cacheado ──
let logoCache: string | null | undefined;
function loadLogoDataUrl(): string | null {
  if (logoCache !== undefined) return logoCache;
  const candidates = [
    path.resolve(process.cwd(), "dist/public/logo.png"),
    path.resolve(process.cwd(), "client/public/logo.png"),
    ...(typeof __dirname !== "undefined" ? [path.resolve(__dirname, "public/logo.png")] : []),
  ];
  logoCache = null;
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        logoCache = `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
        break;
      }
    } catch { /* probar el siguiente */ }
  }
  return logoCache;
}

function toBuffer(bytes: Uint8Array | undefined): Buffer {
  if (!bytes) throw new Error("El generador de PDF no devolvió bytes");
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

type RemitoItem = RemitoData["order"]["items"][number] & {
  productId?: number | null;
  bolsaType?: string | null;
};

/** Remito del pedido como Buffer PDF, idéntico al que baja el navegador. */
export async function remitoPdfBuffer(
  orderId: number,
  opts?: { hidePrecios?: boolean },
): Promise<{ buffer: Buffer; fileName: string }> {
  const order = await storage.getOrder(orderId);
  if (!order) throw new Error(`Pedido ${orderId} no encontrado`);

  const mapItems = (items: any[]): RemitoItem[] => items.map((item) => ({
    product: item.product
      ? { name: item.product.name, sku: item.product.sku ?? "", ivaRate: item.product.ivaRate ?? null }
      : null,
    productId: item.productId ?? null,
    quantity: String(item.quantity),
    unit: String(item.unit),
    pricePerUnit: String(item.pricePerUnit ?? "0"),
    subtotal: String(item.subtotal),
    bolsaType: item.bolsaType ?? null,
    isBonification: item.isBonification ?? false,
    aliasNombre: item.aliasNombre ?? null,
  }));

  let remitoItems: RemitoItem[] | undefined;
  let remitoFolio = "";
  let remitoDate: string | Date = order.orderDate;

  // Pedido aprobado con remito emitido: ítems y fecha del remito (como GET /api/remitos/:id)
  if (order.remitoId) {
    const remito = await storage.getRemito(order.remitoId);
    if (remito) {
      remitoItems = mapItems(remito.order.items);
      remitoFolio = order.remitoNum != null ? String(order.remitoNum) : remito.folio;
      remitoDate = remito.issuedAt;
    }
  }
  if (!remitoItems) {
    remitoItems = mapItems(order.items);
    remitoFolio = order.remitoNum != null
      ? String(order.remitoNum)
      : (order.notes?.match(/Remito\s+(\S+)/i)?.[1] ?? order.folio);
    remitoDate = order.orderDate;
  }

  const customer: any = order.customer;
  const remito: RemitoData = {
    folio: remitoFolio,
    issuedAt: remitoDate,
    order: {
      folio: order.folio,
      orderDate: order.orderDate,
      notes: order.notes,
      customer: {
        name: customer.name,
        hasIva: hasIvaOn(customer, order.orderDate),
        rfc: customer.rfc ?? null,
        address: customer.address ?? null,
        city: customer.city ?? null,
        phone: customer.phone ?? null,
      },
      items: remitoItems,
      total: String(order.total),
    },
  };

  // Clientes con Bolsa FV: fusionar líneas del mismo producto (alias-aware), igual que el cliente
  if (customer.bolsaFv) {
    const merged = new Map<string, RemitoItem>();
    for (const item of remito.order.items as RemitoItem[]) {
      const dispName = (item.aliasNombre ?? "").trim() || item.product?.name || "";
      const key = dispName ? `${dispName}||${item.productId ?? item.product?.name ?? "x"}` : String(Math.random());
      const existing = merged.get(key);
      if (existing) {
        merged.set(key, {
          ...existing,
          quantity: String(parseFloat(existing.quantity) + parseFloat(item.quantity)),
          subtotal: String(parseFloat(existing.subtotal) + parseFloat(item.subtotal)),
        });
      } else {
        merged.set(key, { ...item });
      }
    }
    remito.order.items = Array.from(merged.values());
    remito.order.total = String(remito.order.items.reduce((s, i) => s + parseFloat(i.subtotal), 0));
  }

  const bytes = await generateRemitoPDF(remito, {
    hidePrecios: opts?.hidePrecios ?? false,
    output: "buffer",
    logoDataUrl: loadLogoDataUrl(),
  });
  const { dd, mm } = orderDay(order.orderDate);
  return { buffer: toBuffer(bytes), fileName: safeFileName(`Remito ${customer.name} ${dd}.${mm}`) + ".pdf" };
}

/** Factura (o nota de crédito) como Buffer PDF, igual que la descarga de la página de facturas. */
export async function invoicePdfBuffer(
  invoiceId: number,
  opts?: { isNotaCredito?: boolean; detailMode?: "completo" | "agrupado"; creditNote?: { creditNoteNumber: string; cae: string; caeExpiry: string; createdAt?: Date | string | null } },
): Promise<{ buffer: Buffer; fileName: string }> {
  const detail = await storage.getInvoiceById(invoiceId);
  if (!detail) throw new Error(`Factura ${invoiceId} no encontrada`);
  // Nota de crédito: mismo PDF con el número, CAE y fecha de la NC (igual que la pantalla de Facturas)
  if (opts?.creditNote) {
    detail.invoice = { ...detail.invoice, invoiceNumber: opts.creditNote.creditNoteNumber, cae: opts.creditNote.cae, caeExpiry: opts.creditNote.caeExpiry, createdAt: (opts.creditNote.createdAt ?? detail.invoice.createdAt) as any };
    opts = { ...opts, isNotaCredito: true };
  }
  const { invoice, customer } = detail;

  const detailMode: "completo" | "agrupado" =
    opts?.detailMode ?? ((invoice.detailMode === "completo" ? "completo" : "agrupado") as "completo" | "agrupado");
  const isNotaCredito = opts?.isNotaCredito ?? false;

  const bytes = await generateInvoicePDF(detail as unknown as InvoicePdfData, detailMode, {
    isNotaCredito,
    output: "buffer",
    logoDataUrl: loadLogoDataUrl(),
  });
  const { dd, mm } = argDate(new Date(invoice.createdAt));
  const prefix = isNotaCredito ? "Nota de credito" : "Factura";
  return { buffer: toBuffer(bytes), fileName: safeFileName(`${prefix} ${customer.name} ${dd}.${mm}`) + ".pdf" };
}
