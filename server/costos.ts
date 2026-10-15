/**
 * A-15 · Costos de automatización, calculados desde los datos propios:
 * - Claude: tokens de order_intake_logs (interpretación de pedidos) + ai_usage (clasificador y respuestas del bot) × tarifa por millón.
 * - WhatsApp: mensajes enviados (wa_outbound: los del ERP y los que informa el bot) × tarifa por categoría; si YCloud
 *   devolvió el precio del mensaje, se usa ese. Servicio (texto libre dentro de 24 h): los primeros N del mes gratis.
 * - Fijos mensuales: Render (ERP y bot), YCloud.
 * Las tarifas viven en cost_rates (editables). Opcional: gasto real de Anthropic si hay ANTHROPIC_ADMIN_KEY.
 */
import { storage } from "./storage";
import * as ycloud from "./ycloud";

const TZ = "America/Argentina/Buenos_Aires";
function mesAR(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(d); // YYYY-MM
}
/** Límites UTC de un mes (hora Argentina, UTC-3 sin horario de verano). */
function limitesMes(mes: string): { from: Date; to: Date } {
  const [y, m] = mes.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1, 3, 0, 0));
  const to = new Date(Date.UTC(y, m, 1, 3, 0, 0));
  return { from, to };
}
function mesAnterior(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export type ResumenMes = {
  mes: string; pedidos: number; costoTotal: number; costoPorPedido: number | null;
  conceptos: { clave: string; label: string; cantidad: number; unidad: string; costo: number; nota?: string }[];
  porCliente: { customerId: number | null; nombre: string; tokens: number; mensajes: number; costo: number }[];
  advertencias: string[];
};

export async function resumenMes(mes: string): Promise<ResumenMes> {
  const rates = await storage.costRatesMap();
  const { from, to } = limitesMes(mes);
  const raw = await storage.costRawData(from, to);
  const nombre = new Map<number, string>(raw.nombres.map((n: any) => [Number(n.id), String(n.name)]));
  const porTel = new Map<string, number>(raw.contactos.map((c: any) => [String(c.phone), Number(c.customerId)]));
  const advertencias: string[] = [];
  const porCliente = new Map<number | null, { tokens: number; mensajes: number; costo: number }>();
  const acum = (cid: number | null, d: { tokens?: number; mensajes?: number; costo: number }) => {
    const e = porCliente.get(cid) ?? { tokens: 0, mensajes: 0, costo: 0 };
    e.tokens += d.tokens ?? 0; e.mensajes += d.mensajes ?? 0; e.costo += d.costo;
    porCliente.set(cid, e);
  };
  const costoTokens = (inp: number, out: number, cr: number, cw: number) =>
    (inp * rates.claude_input + out * rates.claude_output + cr * rates.claude_cache_read + cw * rates.claude_cache_write) / 1_000_000;

  // Claude: interpretación de pedidos
  let intIn = 0, intOut = 0, intCr = 0, intCw = 0, intN = 0, intSinCache = 0, intCosto = 0;
  for (const r of raw.intake) {
    const inp = Number(r.in), out = Number(r.out), cr = Number(r.cr), cw = Number(r.cw);
    const c = costoTokens(inp, out, cr, cw);
    intIn += inp; intOut += out; intCr += cr; intCw += cw; intN += Number(r.n); intSinCache += Number(r.sinCache); intCosto += c;
    acum(r.customerId == null ? null : Number(r.customerId), { tokens: inp + out + cr + cw, costo: c });
  }
  if (intSinCache > 0) advertencias.push(`${intSinCache} interpretaciones anteriores al 15/10 tienen la caché sumada en los tokens de entrada: su costo está sobreestimado.`);
  // Claude: bot (clasificador, sugerencias, respuestas)
  let botIn = 0, botOut = 0, botCr = 0, botCw = 0, botN = 0, botCosto = 0;
  for (const r of raw.ai) {
    const inp = Number(r.in), out = Number(r.out), cr = Number(r.cr), cw = Number(r.cw);
    const c = costoTokens(inp, out, cr, cw);
    botIn += inp; botOut += out; botCr += cr; botCw += cw; botN += Number(r.n); botCosto += c;
    const cid = r.customerId != null ? Number(r.customerId) : (r.phone ? porTel.get(String(r.phone)) ?? null : null);
    acum(cid, { tokens: inp + out + cr + cw, costo: c });
  }
  // WhatsApp por categoría
  const cat: Record<string, { n: number; precio: number; sinPrecio: number }> = {};
  for (const r of raw.wa) {
    const k = String(r.categoria ?? "service").toLowerCase();
    const e = cat[k] ?? { n: 0, precio: 0, sinPrecio: 0 };
    e.n += Number(r.n); e.precio += Number(r.precio); e.sinPrecio += Number(r.sinPrecio);
    cat[k] = e;
  }
  const tarifaCat = (k: string) => (k === "utility" ? rates.wa_utility : k === "marketing" ? rates.wa_marketing : k === "authentication" ? rates.wa_utility : rates.wa_service);
  const costoCat: Record<string, number> = {};
  for (const [k, e] of Object.entries(cat)) {
    let sinPrecio = e.sinPrecio;
    if (k === "service") sinPrecio = Math.max(0, sinPrecio - Math.max(0, (rates.wa_service_gratis ?? 0) - (e.n - e.sinPrecio))); // los gratis del mes se descuentan de los que no tienen precio
    costoCat[k] = e.precio + sinPrecio * tarifaCat(k);
  }
  // WhatsApp por cliente (los que tienen precio exacto se reparten tal cual; los demás a tarifa)
  for (const r of raw.wa) {
    const k = String(r.categoria ?? "service").toLowerCase();
    const cid = r.customerId != null ? Number(r.customerId) : (r.phone ? porTel.get(String(r.phone)) ?? null : null);
    const costo = Number(r.precio) + Number(r.sinPrecio) * (k === "service" ? 0 : tarifaCat(k));
    acum(cid, { mensajes: Number(r.n), costo });
  }
  const conceptos: ResumenMes["conceptos"] = [
    { clave: "claude_intake", label: "Claude · interpretación de pedidos", cantidad: intN, unidad: "pedidos leídos", costo: r2(intCosto), nota: `${fmtTok(intIn)} entrada · ${fmtTok(intOut)} salida · ${fmtTok(intCr)} caché leída · ${fmtTok(intCw)} caché escrita` },
    { clave: "claude_bot", label: "Claude · clasificador y respuestas del bot", cantidad: botN, unidad: "llamadas", costo: r2(botCosto), nota: `${fmtTok(botIn)} entrada · ${fmtTok(botOut)} salida · ${fmtTok(botCr)} caché leída` },
  ];
  for (const k of ["service", "utility", "marketing", "authentication"]) {
    if (!cat[k]) continue;
    const label = k === "service" ? "WhatsApp · servicio (texto libre, 24 h)" : k === "utility" ? "WhatsApp · utilidad (plantillas)" : k === "marketing" ? "WhatsApp · marketing" : "WhatsApp · autenticación";
    conceptos.push({ clave: `wa_${k}`, label, cantidad: cat[k].n, unidad: "mensajes", costo: r2(costoCat[k]), nota: cat[k].sinPrecio ? `${cat[k].n - cat[k].sinPrecio} con precio de YCloud, ${cat[k].sinPrecio} a tarifa` : "precios de YCloud" });
  }
  const fijos: [string, string][] = [["render_erp", "Render · servidor del ERP"], ["render_bot", "Render · servidor del bot"], ["ycloud_fijo", "YCloud · fijo mensual"]];
  for (const [k, label] of fijos) if ((rates[k] ?? 0) > 0) conceptos.push({ clave: k, label, cantidad: 1, unidad: "mes", costo: r2(rates[k]) });
  const costoTotal = r2(conceptos.reduce((s, c) => s + c.costo, 0));
  const porClienteArr = Array.from(porCliente.entries())
    .map(([cid, e]) => ({ customerId: cid, nombre: cid == null ? "Sin cliente (equipo / desconocidos)" : (nombre.get(cid) ?? `#${cid}`), tokens: e.tokens, mensajes: e.mensajes, costo: r4(e.costo) }))
    .sort((a, b) => b.costo - a.costo);
  return { mes, pedidos: raw.pedidos, costoTotal, costoPorPedido: raw.pedidos ? r4(costoTotal / raw.pedidos) : null, conceptos, porCliente: porClienteArr, advertencias };
}
const fmtTok = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : String(n)) + " tok";

/** Gasto real de Anthropic (API de administración, opcional). */
async function gastoAnthropic(mes: string): Promise<{ usd: number; detalle: string } | null> {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) return null;
  const { from, to } = limitesMes(mes);
  const u = new URL("https://api.anthropic.com/v1/organizations/cost_report");
  u.searchParams.set("starting_at", from.toISOString()); u.searchParams.set("ending_at", to.toISOString()); u.searchParams.set("bucket_width", "1d"); u.searchParams.set("limit", "31");
  const r = await fetch(u, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
  const j: any = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Anthropic cost_report → ${r.status}: ${j?.error?.message ?? ""}`);
  let total = 0;
  for (const b of j?.data ?? []) for (const x of b?.results ?? []) total += parseFloat(String(x?.amount ?? "0")) || 0;
  return { usd: r2(total / 100), detalle: `${(j?.data ?? []).length} días` }; // amount viene en centavos de USD
}

let balanceCache: { at: number; v: { amount: number; currency: string } | null; error: string | null } = { at: 0, v: null, error: null };
export async function saldoYCloud(force = false): Promise<{ amount: number; currency: string } | null> {
  if (!force && Date.now() - balanceCache.at < 10 * 60_000) return balanceCache.v;
  try { balanceCache = { at: Date.now(), v: await ycloud.getBalance(), error: null }; }
  catch (e: any) { balanceCache = { at: Date.now(), v: null, error: e.message }; }
  return balanceCache.v;
}
export function errorSaldo(): string | null { return balanceCache.error; }

export async function resumenCostos(mes?: string) {
  const actual = mes ?? mesAR();
  const [a, b] = await Promise.all([resumenMes(actual), resumenMes(mesAnterior(actual))]);
  const rates = await storage.costRatesMap();
  const saldo = await saldoYCloud();
  let anthropicReal: { usd: number; detalle: string } | null = null; let anthropicError: string | null = null;
  try { anthropicReal = await gastoAnthropic(actual); } catch (e: any) { anthropicError = e.message; }
  const umbral = rates.alerta_saldo ?? 3;
  return {
    actual: a, anterior: b, saldo, saldoError: errorSaldo(), umbralSaldo: umbral, saldoBajo: saldo != null && saldo.amount < umbral,
    anthropicReal, anthropicError, anthropicDisponible: !!process.env.ANTHROPIC_ADMIN_KEY,
  };
}
