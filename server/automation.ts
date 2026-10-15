/**
 * A-13 · Automatizaciones: remito por WhatsApp al aprobar, facturación con corte 14:00, envío de facturas,
 * nota de crédito, Excel semanal Black Pot, plantillas de Meta.
 *
 * Interruptores generales (app_settings): remitos_automaticos, facturacion_automatica, envio_facturas. En OFF no pasa
 * nada para ningún cliente, salvo PRUEBA (id 167), que siempre está activo para probar. Nada es retroactivo.
 * Todo envío queda en wa_outbound (estado, hora, error) y se puede reenviar desde el pedido / la factura.
 */
import { storage } from "./storage";
import { normalizeArPhone } from "@shared/phone";
import type { Customer, Invoice, CreditNote } from "@shared/schema";
import { emitirFactura, clienteFacturado } from "./invoicing";
import { remitoPdfBuffer, invoicePdfBuffer, argDate } from "./pdf-server";
import * as ycloud from "./ycloud";
import { buildBlackPotWorkbook } from "./blackpot-excel";

const PRUEBA_ID = 167;
const log = (m: string) => console.log(`[A-13] ${m}`);

// ─── Hora Argentina ───
export function ahoraAR(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24, minute: Number(get("minute")), dow: dow[get("weekday")] ?? 0 };
}
export const saludoHora = (d = new Date()) => (ahoraAR(d).hour < 13 ? "Buen día" : "Buenas tardes");
function addDays(iso: string, n: number): string { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function dowOf(iso: string): number { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
/** Último día hábil (lunes a viernes) del mes de `iso`. Feriados no se tratan distinto (decisión 15/10). */
function ultimoDiaHabilDelMes(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  let d = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // último día del mes
  while (dowOf(d) === 0 || dowOf(d) === 6) d = addDays(d, -1);
  return d;
}
const fechaLinda = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

// ─── Interruptores y destinatarios ───
export async function interruptores() {
  const all = await storage.getSettings();
  return { remitos: all.remitos_automaticos === true, facturacion: all.facturacion_automatica === true, envio: all.envio_facturas === true };
}
const esPrueba = (c: { id: number; name: string }) => c.id === PRUEBA_ID || c.name.trim().toUpperCase() === "PRUEBA";

/** Teléfonos con check Remito / Factura de un cliente (contactos + administración). */
export async function destinatarios(customer: Customer, kind: "remito" | "factura"): Promise<string[]> {
  const out = new Set<string>();
  const contacts = await storage.getCustomerContacts(customer.id);
  for (const c of contacts) if ((kind === "remito" ? (c as any).sendRemito : (c as any).sendFactura) && c.phone) out.add(c.phone);
  const adminFlag = kind === "remito" ? (customer as any).adminPhoneRemito : (customer as any).adminPhoneFactura;
  if (adminFlag && customer.phone) { const p = normalizeArPhone(customer.phone); if (p) out.add(p); }
  return Array.from(out);
}

// ─── Plantillas (message_templates) ───
export const DEFAULT_TEMPLATES: { key: string; label: string; text: string; hasDocument: boolean }[] = [
  { key: "remito", label: "Remito", text: "{saludo}, envío el remito de hoy. Gracias!", hasDocument: true },
  { key: "remito_faltantes", label: "Remito con faltantes", text: "{saludo}, envío el remito de hoy. {faltantes} Gracias!", hasDocument: true },
  { key: "factura_diaria", label: "Factura diaria", text: "Buenas tardes, envío la factura correspondiente a la entrega de hoy. Gracias!", hasDocument: true },
  { key: "factura_semanal", label: "Factura semanal", text: "Buenas tardes, envío la factura correspondiente a la semana. Gracias!", hasDocument: true },
  { key: "factura_mensual", label: "Factura mensual", text: "Buenas tardes, envío la factura correspondiente al mes. Gracias!", hasDocument: true },
  { key: "factura_blackpot", label: "Factura (envío semanal Black Pot, una por archivo)", text: "Buenas tardes, envío la factura correspondiente a la entrega del {fecha}. Gracias!", hasDocument: true },
  { key: "excel_blackpot", label: "Excel semanal Black Pot", text: "Buenas tardes, envío el detalle de cuenta corriente de la semana. Gracias!", hasDocument: true },
  { key: "nota_credito", label: "Nota de crédito", text: "Buenas tardes, envío nota de crédito correspondiente al pedido del {fecha}. Gracias!", hasDocument: true },
  { key: "pedido_recibido", label: "Pedido recibido (bot, texto libre)", text: "{saludo}, pedido recibido. Gracias!", hasDocument: false },
  { key: "aviso_dudas", label: "Aviso de dudas al equipo (bot)", text: "Hay {cantidad} líneas en duda en los pedidos para el {fecha}. Revisalas en el sistema antes de las 00:00.", hasDocument: false },
];
const PARAM_ORDER: Record<string, string[]> = {
  remito: ["saludo"], remito_faltantes: ["saludo", "faltantes"], factura_diaria: [], factura_semanal: [], factura_mensual: [],
  factura_blackpot: ["fecha"], excel_blackpot: [], nota_credito: ["fecha"], pedido_recibido: ["saludo"], aviso_dudas: ["cantidad", "fecha"],
};
const EJEMPLOS: Record<string, string> = { saludo: "Buenas tardes", faltantes: "El morrón amarillo está en faltante.", fecha: "14/10/2026", cantidad: "3" };

export async function ensureMessageTemplates(): Promise<void> {
  for (const t of DEFAULT_TEMPLATES) await storage.ensureMessageTemplate(t);
}
/** Texto de Meta: {saludo} → {{1}} en el orden fijo de cada clave. */
export function textoMeta(key: string, texto: string): { body: string; example: string[] } {
  const params = PARAM_ORDER[key] ?? [];
  let body = texto;
  params.forEach((p, i) => { body = body.split(`{${p}}`).join(`{{${i + 1}}}`); });
  return { body, example: params.map((p) => EJEMPLOS[p] ?? p) };
}
/** Rellena el texto con valores (para texto libre dentro de las 24 h o para la vista previa). */
export function rellenar(texto: string, valores: Record<string, string>): string {
  return texto.replace(/\{(\w+)\}/g, (_, k) => valores[k] ?? "").replace(/\s{2,}/g, " ").trim();
}
/** Crea en Meta (vía YCloud) la versión nueva de una plantilla y la deja pendiente. */
export async function publicarPlantilla(key: string, baseUrl: string): Promise<{ name: string; status: string }> {
  const t = await storage.getMessageTemplate(key);
  if (!t) throw new Error(`Plantilla ${key} no existe`);
  const version = (t.version ?? 0) + 1;
  const name = `va_${key}_v${version}`;
  const { body, example } = textoMeta(key, t.text);
  const r = await ycloud.createTemplate({ name, bodyText: body, bodyExample: example, headerDocumentExampleUrl: t.hasDocument ? `${baseUrl}/ejemplo.pdf` : undefined });
  await storage.updateMessageTemplate(key, { version, pendingName: name, pendingStatus: r.status ?? "PENDING", pendingReason: r.reason ?? null });
  return { name, status: r.status ?? "PENDING" };
}
/** Consulta a Meta el estado de las plantillas pendientes; las aprobadas pasan a ser la vigente. */
export async function revisarPlantillas(): Promise<void> {
  if (!ycloud.ycloudConfigured()) return;
  const all = await storage.listMessageTemplates();
  for (const t of all) {
    if (!t.pendingName) continue;
    try {
      const st = await ycloud.getTemplateStatus(t.pendingName);
      if (!st) continue;
      if (st.status === "APPROVED") await storage.updateMessageTemplate(t.key, { approvedName: t.pendingName, pendingName: null, pendingStatus: null, pendingReason: null });
      else if (st.status !== t.pendingStatus || (st.reason ?? null) !== (t.pendingReason ?? null)) await storage.updateMessageTemplate(t.key, { pendingStatus: st.status, pendingReason: st.reason ?? null });
    } catch (e: any) { log(`plantilla ${t.pendingName}: ${e.message}`); }
  }
}

// ─── Envío de un documento a varios teléfonos ───
async function enviarDocumento(p: {
  kind: "remito" | "factura" | "nota_credito" | "excel_blackpot"; refId: number; customerId: number | null; phones: string[];
  buffer: Buffer; fileName: string; mime?: string; templateKey: string; valores: Record<string, string>; force?: boolean;
}): Promise<{ enviados: number; errores: string[] }> {
  const errores: string[] = [];
  if (!p.phones.length) { await storage.createWaOutbound({ kind: p.kind, refId: p.refId, customerId: p.customerId, phone: "-", status: "error", error: "Sin teléfonos con check para este envío", fileName: p.fileName }); return { enviados: 0, errores: ["sin teléfonos con check"] }; }
  if (!ycloud.ycloudConfigured()) { for (const ph of p.phones) await storage.createWaOutbound({ kind: p.kind, refId: p.refId, customerId: p.customerId, phone: ph, status: "error", error: "YCloud no configurado en el ERP (YCLOUD_API_KEY)", fileName: p.fileName }); return { enviados: 0, errores: ["YCloud no configurado"] }; }
  const t = await storage.getMessageTemplate(p.templateKey);
  const texto = rellenar(t?.text ?? DEFAULT_TEMPLATES.find((d) => d.key === p.templateKey)?.text ?? "", p.valores);
  let mediaId: string | null = null;
  let enviados = 0;
  for (const phone of p.phones) {
    if (!p.force && (await storage.waOutboundYaEnviado(p.kind, p.refId, phone))) { log(`${p.kind} ${p.refId} → ${phone}: ya enviado, no se repite`); continue; }
    const row = await storage.createWaOutbound({ kind: p.kind, refId: p.refId, customerId: p.customerId, phone, templateName: t?.approvedName ?? null, fileName: p.fileName });
    try {
      if (!mediaId) mediaId = await ycloud.uploadMedia(p.buffer, p.fileName, p.mime ?? "application/pdf");
      let r: { id: string; status: string };
      if (t?.approvedName) {
        const params = (PARAM_ORDER[p.templateKey] ?? []).map((k) => p.valores[k] ?? "");
        r = await ycloud.sendTemplate({ to: phone, name: t.approvedName, bodyParams: params, headerDocument: { mediaId, filename: p.fileName }, externalId: `${p.kind}-${p.refId}-${row.id}` });
      } else {
        // Sin plantilla aprobada: documento con texto, entra solo si el cliente escribió en las últimas 24 h
        r = await ycloud.sendDocument({ to: phone, mediaId, filename: p.fileName, caption: texto, externalId: `${p.kind}-${p.refId}-${row.id}` });
      }
      await storage.updateWaOutbound(row.id, { status: "sent", ycloudId: r.id, sentAt: new Date(), error: null });
      enviados++;
    } catch (e: any) {
      const msg = t?.approvedName ? e.message : `Sin plantilla aprobada y fuera de las 24 h: ${e.message}`;
      await storage.updateWaOutbound(row.id, { status: "error", error: String(msg).slice(0, 500) });
      errores.push(`${phone}: ${msg}`);
    }
  }
  return { enviados, errores };
}

// ─── Remito automático al aprobar ───
export async function enviarRemitoAuto(orderId: number, opts: { force?: boolean; manual?: boolean } = {}): Promise<{ enviados: number; errores: string[]; omitido?: string }> {
  const order = await storage.getOrder(orderId);
  if (!order) throw new Error("Pedido no encontrado");
  const customer = order.customer as Customer;
  const sw = await interruptores();
  if (!opts.manual && !sw.remitos && !esPrueba(customer)) return { enviados: 0, errores: [], omitido: "remitos automáticos en OFF" };
  if (order.status !== "approved") return { enviados: 0, errores: [], omitido: "el pedido no está aprobado" };
  const phones = await destinatarios(customer, "remito");
  const { buffer, fileName } = await remitoPdfBuffer(orderId);
  const aviso = ((order as any).avisoFaltantes ?? "").trim();
  const valores = { saludo: saludoHora(), faltantes: aviso };
  return enviarDocumento({ kind: "remito", refId: orderId, customerId: customer.id, phones, buffer, fileName, templateKey: aviso ? "remito_faltantes" : "remito", valores, force: opts.force });
}

// ─── Facturación ───
type Modo = "ninguna" | "diaria" | "semanal" | "mensual" | "diaria_envio_semanal";
const modoDe = (c: Customer): Modo => (((c as any).billingMode as Modo) ?? "ninguna");

/** Emite (o encola si es la primera vez / falla ARCA) y manda si corresponde. Devuelve la factura o null. */
async function facturarPedidos(orderIds: number[], billing: Customer, modo: Modo, enviar: boolean): Promise<Invoice | null> {
  // La primera factura automática de CADA cliente (PRUEBA incluido) la aprueba Joaquín en "Facturas a emitir"
  if (!(billing as any).autoInvoiceApproved) {
    await storage.enqueueInvoice({ billingCustomerId: billing.id, orderIds, mode: modo, reason: "primera_vez" });
    log(`primera factura automática de ${billing.name}: a "Facturas a emitir"`);
    return null;
  }
  try {
    const inv = await emitirFactura({ orderIds, billingCustomerId: billing.id });
    log(`factura ${inv.invoiceNumber} para ${billing.name} (${orderIds.length} pedido/s, modo ${modo})`);
    if (enviar) enviarFacturaAuto(inv.id, modo).catch((e) => log(`envío factura ${inv.id}: ${e.message}`));
    return inv;
  } catch (e: any) {
    await storage.enqueueInvoice({ billingCustomerId: billing.id, orderIds, mode: modo, reason: "error", error: String(e.message).slice(0, 500) });
    log(`error facturando a ${billing.name}: ${e.message} → cola`);
    return null;
  }
}

/** Al aprobar: si es después de las 14:00 y el cliente factura diario, se factura y manda en el momento. */
export async function facturarTrasAprobar(orderId: number): Promise<void> {
  const order = await storage.getOrder(orderId);
  if (!order || order.status !== "approved" || order.invoiceNumber) return;
  const customer = order.customer as Customer;
  const sw = await interruptores();
  if (!sw.facturacion && !esPrueba(customer)) return;
  const modo = modoDe(customer);
  if (modo !== "diaria" && modo !== "diaria_envio_semanal") return;
  const ar = ahoraAR();
  if (ar.hour < 14) return; // lo toma el corte de las 14:00
  const billing = await clienteFacturado(customer);
  await facturarPedidos([orderId], billing, modo, modo === "diaria" && (sw.envio || esPrueba(customer)));
}

/** Corte de las 14:00 (hora Argentina). Idempotente por día (app_settings.corte14_ultimo). */
export async function corte14(): Promise<void> {
  const ar = ahoraAR();
  const sw = await interruptores();
  const pendientes = await storage.getApprovedUninvoicedOrders(ar.date); // pedidos aprobados sin factura, fecha ≤ hoy
  // Agrupar por cliente facturado y modo
  const grupos = new Map<string, { billing: Customer; modo: Modo; orderIds: number[]; sedes: Set<number> }>();
  for (const o of pendientes) {
    const customer = o.customer as Customer;
    if (!sw.facturacion && !esPrueba(customer)) continue;
    const modo = modoDe(customer);
    if (modo === "ninguna") continue;
    const esViernes = ar.dow === 5;
    const esUltimoHabil = ar.date === ultimoDiaHabilDelMes(ar.date);
    if (modo === "semanal" && !esViernes) continue;
    if (modo === "mensual" && !esUltimoHabil) continue;
    const billing = await clienteFacturado(customer);
    const key = `${billing.id}|${modo}${modo === "diaria" || modo === "diaria_envio_semanal" ? `|${o.id}` : ""}`; // diaria: una factura por pedido
    const g = grupos.get(key) ?? { billing, modo, orderIds: [], sedes: new Set<number>() };
    g.orderIds.push(o.id); g.sedes.add(customer.id);
    grupos.set(key, g);
  }
  for (const g of Array.from(grupos.values())) {
    const enviar = g.modo !== "diaria_envio_semanal" && (sw.envio || esPrueba(g.billing));
    await facturarPedidos(g.orderIds, g.billing, g.modo, enviar);
  }
  // Viernes: envío semanal Black Pot (facturas de la semana + Excel)
  if (ar.dow === 5 && (sw.envio || true)) await envioSemanalBlackPot(ar.date, sw.envio);
}

/** Envía una factura a los teléfonos con check Factura del facturado (si no tiene, los de la sede). */
export async function enviarFacturaAuto(invoiceId: number, modo?: Modo, opts: { force?: boolean; manual?: boolean } = {}): Promise<{ enviados: number; errores: string[]; omitido?: string }> {
  const data = await storage.getInvoiceById(invoiceId);
  if (!data) throw new Error("Factura no encontrada");
  const billing = data.customer as Customer;
  const sw = await interruptores();
  if (!opts.manual && !sw.envio && !esPrueba(billing) && !data.orders.some((o) => esPrueba(o.customer as Customer))) return { enviados: 0, errores: [], omitido: "envío de facturas en OFF" };
  let phones = await destinatarios(billing, "factura");
  if (!phones.length) for (const o of data.orders) phones = phones.concat(await destinatarios(o.customer as Customer, "factura"));
  phones = Array.from(new Set(phones));
  const m = modo ?? modoDe((data.orders[0]?.customer as Customer) ?? billing);
  const templateKey = m === "semanal" ? "factura_semanal" : m === "mensual" ? "factura_mensual" : m === "diaria_envio_semanal" ? "factura_blackpot" : "factura_diaria";
  const { buffer, fileName } = await invoicePdfBuffer(invoiceId);
  const fecha = data.orders[0]?.orderDate ? argDate(new Date(data.orders[0].orderDate as any)) : argDate(new Date(data.invoice.createdAt as any));
  return enviarDocumento({ kind: "factura", refId: invoiceId, customerId: billing.id, phones, buffer, fileName, templateKey, valores: { fecha: `${fecha.dd}/${fecha.mm}/${fecha.yyyy}` }, force: opts.force });
}

/** Viernes 14:00: facturas de la semana de los clientes "diaria con envío semanal" (Black Pot), cada una como archivo, + Excel lunes a viernes. */
export async function envioSemanalBlackPot(hoyISO: string, envioOn: boolean): Promise<void> {
  const lunes = addDays(hoyISO, -((dowOf(hoyISO) + 6) % 7));
  const clientes = await storage.getCustomersByBillingMode("diaria_envio_semanal");
  const padres = new Map<number, Customer>();
  for (const c of clientes) { const b = await clienteFacturado(c); padres.set(b.id, b); }
  for (const billing of Array.from(padres.values())) {
    if (!envioOn && !esPrueba(billing)) continue;
    const facturas = await storage.getInvoicesForBilling(billing.id, lunes, hoyISO);
    for (const inv of facturas) {
      const r = await enviarFacturaAuto(inv.id, "diaria_envio_semanal");
      if (r.errores.length) log(`Black Pot ${billing.name} factura ${inv.invoiceNumber}: ${r.errores.join(" | ")}`);
    }
    const orderIds = await storage.getOrderIdsForBilling(billing.id, lunes, hoyISO);
    if (!orderIds.length) continue;
    try {
      const buffer = await buildBlackPotWorkbook(orderIds);
      const [y, m, d] = hoyISO.split("-");
      const fileName = `Cuenta corriente ${billing.name} semana ${d}.${m}.xlsx`.replace(/[\\/:*?"<>|]/g, "");
      const phones = await destinatarios(billing, "factura");
      await enviarDocumento({ kind: "excel_blackpot", refId: Number(`${y}${m}${d}`), customerId: billing.id, phones, buffer, fileName, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", templateKey: "excel_blackpot", valores: {} });
    } catch (e: any) { log(`Excel Black Pot ${billing.name}: ${e.message}`); }
  }
}

/** Nota de crédito: se manda sola a los teléfonos con check Factura. */
export async function enviarNotaCreditoAuto(creditNoteId: number, opts: { force?: boolean } = {}): Promise<{ enviados: number; errores: string[] }> {
  const nc = await storage.getCreditNoteById(creditNoteId);
  if (!nc) throw new Error("Nota de crédito no encontrada");
  const data = await storage.getInvoiceById(nc.invoiceId);
  if (!data) throw new Error("Factura no encontrada");
  const billing = data.customer as Customer;
  let phones = await destinatarios(billing, "factura");
  if (!phones.length) for (const o of data.orders) phones = phones.concat(await destinatarios(o.customer as Customer, "factura"));
  const { buffer, fileName } = await invoicePdfBuffer(nc.invoiceId, { isNotaCredito: true, creditNote: nc as CreditNote });
  const fecha = data.orders[0]?.orderDate ? argDate(new Date(data.orders[0].orderDate as any)) : argDate(new Date());
  return enviarDocumento({ kind: "nota_credito", refId: creditNoteId, customerId: billing.id, phones: Array.from(new Set(phones)), buffer, fileName, templateKey: "nota_credito", valores: { fecha: `${fecha.dd}/${fecha.mm}/${fecha.yyyy}` }, force: opts.force });
}

/** Cola "Facturas a emitir": aprobar = emitir + marcar al cliente como automático + enviar. */
export async function aprobarEnCola(queueId: number): Promise<Invoice> {
  const q = await storage.getInvoiceQueueItem(queueId);
  if (!q || q.status !== "pending") throw new Error("Ítem de cola no encontrado o ya resuelto");
  const billing = await storage.getCustomer(q.billingCustomerId);
  if (!billing) throw new Error("Cliente no encontrado");
  const orderIds = (q.orderIds as number[]).filter(Boolean);
  const inv = await emitirFactura({ orderIds, billingCustomerId: billing.id });
  await storage.updateCustomer(billing.id, { autoInvoiceApproved: true } as any);
  await storage.resolveInvoiceQueue(queueId, "done", inv.id);
  const sw = await interruptores();
  const modo = q.mode as Modo;
  if (modo !== "diaria_envio_semanal" && (sw.envio || esPrueba(billing))) enviarFacturaAuto(inv.id, modo).catch((e) => log(`envío factura ${inv.id}: ${e.message}`));
  return inv;
}

// ─── Programador ───
let corriendo = false;
export function iniciarAutomatizacion(baseUrl: string): void {
  ensureMessageTemplates().catch((e) => log(`plantillas: ${e.message}`));
  let ultimoPoll = 0;
  setInterval(async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      const ar = ahoraAR();
      if (ar.hour === 14 && ar.minute < 10) {
        const ultimo = (await storage.getSetting("corte14_ultimo")) as string | undefined;
        if (ultimo !== ar.date) {
          await storage.setSetting("corte14_ultimo", ar.date);
          log(`corte 14:00 del ${ar.date}`);
          await corte14();
        }
      }
      if (Date.now() - ultimoPoll > 10 * 60_000) { ultimoPoll = Date.now(); await revisarPlantillas(); }
    } catch (e: any) { log(`tick: ${e.message}`); }
    finally { corriendo = false; }
  }, 60_000);
  void baseUrl;
}
