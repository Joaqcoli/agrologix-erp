/**
 * A-13 · Emisión de facturas (una función para el botón "Emitir Factura" y para la facturación automática).
 *
 * - Varios pedidos por factura (`invoice_orders`); `invoices.order_id` queda como el primero por compatibilidad.
 * - Facturar al padre: según `customers.bill_to` del cliente del pedido ('padre' → parent_customer_id), como venía
 *   pasando en la práctica (los colegios a Black Pot). Si no tiene padre, al cliente.
 * - "Precios del remito incluyen IVA" (`customers.prices_include_iva`) o `ivaIncluido` explícito: neto = precio/(1+alícuota)
 *   por renglón según su alícuota (10,5 % frutas y verduras, 21 % huevos); el total de la factura = total del remito.
 *   Factura B siempre desarma (no discrimina IVA), como antes.
 * - Fecha del comprobante en hora Argentina (antes usaba la hora del servidor, UTC: después de las 21 h salía con fecha del día siguiente).
 */
import { storage } from "./storage";
import { ivaRateOf } from "@shared/iva";
import { getLastVoucher, createVoucher } from "./arca";
import type { Customer, Invoice } from "@shared/schema";

export type EmitirFacturaInput = {
  orderIds: number[];
  /** A | B | C. Si falta: el del cliente facturado (`invoice_type`), si no A con CUIT / B sin. */
  invoiceType?: "A" | "B" | "C";
  /** 1 RI, 4 Exento, 5 CF, 6 Monotributo. Si falta: el del cliente, si no 1 para A / 5 para B. */
  condicionIva?: number;
  /** Los precios ya incluyen IVA. Si falta: `customers.prices_include_iva` del cliente del pedido. */
  ivaIncluido?: boolean;
  detailMode?: "completo" | "agrupado";
  description?: string | null;
  /** Para forzar el facturado (por defecto según bill_to). */
  billingCustomerId?: number;
};

export type IvaBuckets = { neto105: number; iva105: number; neto21: number; iva21: number; totalNeto: number; totalIVA: number; total: number };

/** Fecha YYYYMMDD en hora Argentina (lo que ARCA espera como CbteFch). */
export function cbteFchArgentina(d = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return parseInt(`${get("year")}${get("month")}${get("day")}`, 10);
}

/** Desglose de IVA de un conjunto de renglones (cantidad × precio vigente). */
export function bucketsDe(items: { quantity: string | number; pricePerUnit: string | number | null; product: any }[], invoiceType: string, ivaIncluido: boolean): IvaBuckets {
  let neto105 = 0, iva105 = 0, neto21 = 0, iva21 = 0;
  for (const item of items) {
    const rate = ivaRateOf(item.product);
    const is21 = rate >= 0.2;
    const sub = (parseFloat(String(item.quantity)) || 0) * (parseFloat(String(item.pricePerUnit ?? "0")) || 0);
    const netSub = (invoiceType === "B" || ivaIncluido) ? sub / (1 + rate) : sub;
    if (is21) { neto21 += netSub; iva21 += netSub * rate; } else { neto105 += netSub; iva105 += netSub * rate; }
  }
  const totalNeto = neto105 + neto21, totalIVA = iva105 + iva21;
  return { neto105, iva105, neto21, iva21, totalNeto, totalIVA, total: totalNeto + totalIVA };
}

/** Cliente al que se factura un pedido según la ficha (bill_to) — padre si corresponde. */
export async function clienteFacturado(customer: Customer): Promise<Customer> {
  const quiereAlPadre = (customer as any).billTo === "padre" || ((customer as any).billTo == null && customer.parentCustomerId != null);
  if (quiereAlPadre && customer.parentCustomerId) return (await storage.getCustomer(customer.parentCustomerId)) ?? customer;
  return customer;
}

export async function emitirFactura(input: EmitirFacturaInput): Promise<Invoice & { orderIds: number[] }> {
  if (!input.orderIds.length) throw new Error("Sin pedidos para facturar");
  const orders = [];
  for (const id of input.orderIds) {
    const o = await storage.getOrder(id);
    if (!o) throw new Error(`Pedido ${id} no encontrado`);
    if (o.status !== "approved") throw new Error(`El pedido ${o.folio} debe estar aprobado`);
    if (o.invoiceNumber) throw new Error(`El pedido ${o.folio} ya tiene factura ${o.invoiceNumber}`);
    orders.push(o);
  }
  const first = orders[0];
  const customer = first.customer as Customer;
  const billingCustomer = input.billingCustomerId
    ? ((await storage.getCustomer(input.billingCustomerId)) ?? customer)
    : await clienteFacturado(customer);
  // Todos los pedidos tienen que facturarse al mismo cliente
  for (const o of orders) {
    const bc = input.billingCustomerId ? billingCustomer : await clienteFacturado(o.customer as Customer);
    if (bc.id !== billingCustomer.id) throw new Error(`El pedido ${o.folio} se factura a ${bc.name}, no a ${billingCustomer.name}`);
  }

  const invoiceType: "A" | "B" | "C" = input.invoiceType
    ?? (((billingCustomer as any).invoiceType as "A" | "B" | null) ?? (billingCustomer.cuit ? "A" : "B"));
  if (invoiceType === "A" && !billingCustomer.cuit) throw new Error("El cliente (ni su cliente padre) tiene CUIT registrado");
  const condicionIva = input.condicionIva ?? ((billingCustomer as any).condicionIva as number | null) ?? (invoiceType === "A" ? 1 : 5);
  const ivaIncluido = input.ivaIncluido ?? !!(customer as any).pricesIncludeIva;
  const detailMode = input.detailMode ?? (((billingCustomer as any).invoiceDetail as "completo" | "agrupado" | null) ?? "agrupado");

  // Descripción: nombre de la sede (si se factura al padre) + remitos incluidos cuando son varios
  const sedes = Array.from(new Set(orders.map((o) => o.customer.name))).filter((n) => n !== billingCustomer.name);
  const remitos = orders.length > 1 ? `Remitos ${orders.map((o) => o.remitoNum ?? o.folio).join(", ")}` : null;
  const partes = [...sedes, remitos, input.description?.trim() || null].filter(Boolean);
  const effectiveDescription = partes.length ? partes.join(" — ") : null;

  const allItems = orders.flatMap((o) => o.items);
  const b = bucketsDe(allItems, invoiceType, ivaIncluido);
  if (!isFinite(b.totalNeto) || !isFinite(b.totalIVA)) throw new Error(`Total inválido: neto=${b.totalNeto}, iva=${b.totalIVA}. Verificar precios de los ítems.`);
  if (b.total <= 0) throw new Error("El total a facturar es 0");

  const cbteTipo = invoiceType === "A" ? 1 : invoiceType === "B" ? 6 : 11;
  const lastVoucher = await getLastVoucher(cbteTipo);
  const nextNumber = lastVoucher + 1;
  const docTipo = invoiceType === "A" ? 80 : 99;
  const docNro = invoiceType === "A" ? parseInt((billingCustomer.cuit ?? "").replace(/\D/g, "")) : 0;
  const iva: { Id: number; BaseImp: number; Importe: number }[] = [];
  if (b.neto105 > 0) iva.push({ Id: 4, BaseImp: r2(b.neto105), Importe: r2(b.iva105) });
  if (b.neto21 > 0) iva.push({ Id: 5, BaseImp: r2(b.neto21), Importe: r2(b.iva21) });

  const { CAE, CAEFchVto } = await createVoucher({
    CantReg: 1, PtoVta: 4, CbteTipo: cbteTipo, Concepto: 1, DocTipo: docTipo, DocNro: docNro,
    CbteDesde: nextNumber, CbteHasta: nextNumber, CbteFch: cbteFchArgentina(),
    ImpTotal: r2(b.total), ImpTotConc: 0, ImpNeto: r2(b.totalNeto), ImpOpEx: 0, ImpIVA: r2(b.totalIVA), ImpTrib: 0,
    MonId: "PES", MonCotiz: 1, CondicionIVAReceptorId: condicionIva, Iva: iva,
  });

  const formattedNumber = `${invoiceType}-0004-${String(nextNumber).padStart(8, "0")}`;
  const invoice = await storage.createInvoice({
    orderId: first.id, customerId: billingCustomer.id, invoiceType, invoiceNumber: formattedNumber, pointOfSale: 4,
    cae: String(CAE), caeExpiry: String(CAEFchVto), total: String(r2(b.total).toFixed(2)), ivaAmount: String(r2(b.totalIVA).toFixed(2)),
    condicionIvaReceptorId: condicionIva, description: effectiveDescription, detailMode,
  });
  await storage.linkInvoiceOrders(invoice.id, orders.map((o) => o.id));
  for (const o of orders) await storage.updateOrderInvoiceNumber(o.id, formattedNumber);
  return { ...invoice, orderIds: orders.map((o) => o.id) };
}

const r2 = (n: number) => parseFloat(n.toFixed(2));

/**
 * Nota de crédito por DIFERENCIA: el pedido facturado se modificó y ahora vale menos. Se acredita solo la diferencia
 * por alícuota (nunca anular y refacturar). Devuelve null si no hay diferencia a favor del cliente.
 */
export async function diferenciaFacturada(invoiceId: number): Promise<{ invoice: Invoice; buckets: IvaBuckets; diff: IvaBuckets; acreditado: number } | null> {
  const data = await storage.getInvoiceById(invoiceId);
  if (!data) return null;
  const { invoice } = data;
  const ivaIncluido = data.orders.some((o) => !!(o.customer as any)?.pricesIncludeIva);
  const actual = bucketsDe(data.orders.flatMap((o) => o.items), invoice.invoiceType, ivaIncluido);
  // Lo ya acreditado por NC anteriores de esta factura
  const ncs = await storage.getCreditNotesByInvoiceId(invoiceId);
  const acreditado = ncs.reduce((s, n) => s + (parseFloat(String(n.total)) || 0), 0);
  // Facturado neto por alícuota: se reconstruye desde total/iva de la factura con la misma proporción que hoy
  // (no se guardó el desglose por alícuota). Aproximación suficiente para la diferencia.
  const facturadoTotal = parseFloat(String(invoice.total)) || 0;
  const facturadoIva = parseFloat(String(invoice.ivaAmount)) || 0;
  const facturadoNeto = facturadoTotal - facturadoIva;
  const vigente = facturadoTotal - acreditado;
  const diffTotal = r2(vigente - actual.total);
  if (diffTotal < 1) return null; // nada a favor del cliente (o subió: haría falta nota de débito)
  const share21 = actual.totalNeto > 0 ? actual.neto21 / actual.totalNeto : 0;
  const diffNeto = facturadoNeto - acreditadoNeto(ncs) - actual.totalNeto;
  const neto21 = Math.max(0, diffNeto * share21), neto105 = Math.max(0, diffNeto - neto21);
  const iva21 = neto21 * 0.21, iva105 = neto105 * 0.105;
  const diff: IvaBuckets = { neto105, iva105, neto21, iva21, totalNeto: neto105 + neto21, totalIVA: iva105 + iva21, total: neto105 + neto21 + iva105 + iva21 };
  return { invoice, buckets: actual, diff, acreditado };
}
function acreditadoNeto(ncs: { total: any; ivaAmount: any }[]): number {
  return ncs.reduce((s, n) => s + ((parseFloat(String(n.total)) || 0) - (parseFloat(String(n.ivaAmount)) || 0)), 0);
}

export async function emitirNotaCreditoDiferencia(invoiceId: number, condicionIvaOverride?: number) {
  const d = await diferenciaFacturada(invoiceId);
  if (!d) throw new Error("No hay diferencia a favor del cliente para acreditar");
  const { invoice, diff } = d;
  const data = (await storage.getInvoiceById(invoiceId))!;
  const ncTypes: Record<string, number> = { A: 3, B: 8, C: 13 };
  const origTypes: Record<string, number> = { A: 1, B: 6, C: 11 };
  const ncCbteTipo = ncTypes[invoice.invoiceType];
  if (!ncCbteTipo) throw new Error("Tipo de factura no soportado para NC");
  const origNumber = parseInt(invoice.invoiceNumber.split("-").pop() ?? "0", 10);
  const nextNumber = (await getLastVoucher(ncCbteTipo)) + 1;
  const iva: { Id: number; BaseImp: number; Importe: number }[] = [];
  if (diff.neto105 > 0.005) iva.push({ Id: 4, BaseImp: r2(diff.neto105), Importe: r2(diff.iva105) });
  if (diff.neto21 > 0.005) iva.push({ Id: 5, BaseImp: r2(diff.neto21), Importe: r2(diff.iva21) });
  const customer = data.customer;
  const condicion = condicionIvaOverride ?? (invoice as any).condicionIvaReceptorId ?? (invoice.invoiceType === "A" ? 1 : 5);
  const { CAE, CAEFchVto } = await createVoucher({
    CantReg: 1, PtoVta: 4, CbteTipo: ncCbteTipo, Concepto: 1,
    DocTipo: invoice.invoiceType === "A" ? 80 : 99, DocNro: invoice.invoiceType === "A" ? parseInt((customer.cuit ?? "").replace(/\D/g, "")) : 0,
    CbteDesde: nextNumber, CbteHasta: nextNumber, CbteFch: cbteFchArgentina(),
    ImpTotal: r2(diff.total), ImpTotConc: 0, ImpNeto: r2(diff.totalNeto), ImpOpEx: 0, ImpIVA: r2(diff.totalIVA), ImpTrib: 0,
    MonId: "PES", MonCotiz: 1, CondicionIVAReceptorId: condicion, Iva: iva,
    CbtesAsoc: [{ Tipo: origTypes[invoice.invoiceType], PtoVta: 4, Nro: origNumber }],
  });
  const formattedNumber = `NC-${invoice.invoiceType}-0004-${String(nextNumber).padStart(8, "0")}`;
  const fecha = data.orders[0]?.orderDate ? new Date(data.orders[0].orderDate as any) : new Date(invoice.createdAt as any);
  const dd = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit" }).format(fecha);
  return storage.createCreditNote({
    invoiceId, customerId: invoice.customerId, creditNoteType: invoice.invoiceType, creditNoteNumber: formattedNumber, pointOfSale: 4,
    cae: String(CAE), caeExpiry: String(CAEFchVto), total: String(r2(diff.total).toFixed(2)), ivaAmount: String(r2(diff.totalIVA).toFixed(2)),
    condicionIvaReceptorId: condicion, description: `Diferencia por modificación del pedido del ${dd} (factura ${invoice.invoiceNumber})`,
  });
}
