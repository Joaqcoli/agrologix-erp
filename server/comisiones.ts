// ─── Comisiones de vendedores: devengada por pedido, habilitada por cobranza (16/11/2026) ─────────────
// Ver docs/AUDITORIA-COMISIONES-POR-COBRANZA-2026-11-16.md y shared/comisiones.ts (reglas del %).
//
// Cómo se reparte la cobranza entre pedidos: MISMO algoritmo que la cuenta corriente
// (storage.getPendingOrdersForCustomer): vínculos explícitos (payment_order_links) primero; lo que queda
// (pagos sin vínculo, sobrantes, menos el saldo inicial) va FIFO al pedido más viejo con saldo. La única
// diferencia es que acá el FIFO se recorre pago por pago, en orden de fecha, para saber QUÉ pago (y en qué
// fecha) cubrió cada pedido. El total cubierto por pedido es el mismo que ve la CC.
//
// Comisión habilitada por una cobranza = % del pedido × neto del pedido × (aplicado / total con IVA).
// Retenciones y ajustes por diferencia cubren el pedido pero no comisionan (COBRANZA_SIN_COMISION).
// Pedidos con comision_saldada (Juan hasta el 31/10/2026) no generan comisión por cobranza.
import { db } from "./db";
import { sql } from "drizzle-orm";
import { COBRANZA_SIN_COMISION, comisionPctEn, fechaBajaComision } from "@shared/comisiones";

export type Cobranza = {
  paymentId: number | null; // null = saldo inicial a favor (no comisiona)
  fecha: string;            // YYYY-MM-DD del pago
  method: string;
  orderId: number;
  aplicado: number;
  comisiona: boolean;       // plata que entró (no retención/diferencia) sobre un pedido con % y no saldado
  comision: number;         // $ habilitados por esta cobranza
};

export type PedidoComision = {
  id: number; folio: string; remitoNum: number | null; orderDate: string; customerId: number; customerName: string;
  neto: number; totalConIva: number; pct: number | null; saldada: boolean;
  devengada: number; habilitada: number; sinComision: number; pendiente: number;
  cobrado: number; cubierto: number; saldo: number;
};

type OrderRow = {
  id: number; customerId: number; rootId: number; folio: string; remitoNum: number | null; orderDate: string;
  customerName: string; billing: number; neto: number; pct: number | null; saldada: boolean;
};

const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Fija alta del cliente (si no la tiene) y % del pedido. soloSiFalta: no pisa un % ya fijado (al aprobar). */
export async function fijarComisionPedido(orderId: number, soloSiFalta = false): Promise<void> {
  await db.execute(sql`
    UPDATE customers c SET comision_alta = o.order_date::date
    FROM orders o WHERE o.id = ${orderId} AND c.id = o.customer_id AND c.comision_alta IS NULL`);
  await db.execute(sql`
    UPDATE orders o SET comision_pct = CASE WHEN o.order_date::date < (c.comision_alta + interval '6 months')::date THEN 5 ELSE 1 END
    FROM customers c WHERE c.id = o.customer_id AND o.id = ${orderId} AND c.comision_alta IS NOT NULL
      ${soloSiFalta ? sql`AND o.comision_pct IS NULL` : sql``}`);
}

// ─── Motor: cobranzas por pedido para un conjunto de cuentas corrientes (padre + sedes activas) ─────────
export async function cobranzasDeGrupos(rootIds: number[]): Promise<{ orders: OrderRow[]; cobranzas: Cobranza[] }> {
  if (rootIds.length === 0) return { orders: [], cobranzas: [] };
  const roots = sql.raw(rootIds.map((n) => Math.trunc(Number(n))).filter((n) => n > 0).join(","));
  const members = (await db.execute(sql`
    SELECT id, COALESCE(parent_customer_id, id) AS root, opening_balance::numeric AS opening
    FROM customers
    WHERE id IN (${roots}) OR (parent_customer_id IN (${roots}) AND active = true)`)).rows as any[];
  const rootOf = new Map<number, number>();
  const openingByRoot = new Map<number, number>();
  for (const m of members) {
    const id = Number(m.id), root = Number(m.root);
    rootOf.set(id, root);
    openingByRoot.set(root, (openingByRoot.get(root) ?? 0) + Number(m.opening ?? 0));
  }
  const memberIds = sql.raw(Array.from(rootOf.keys()).join(",") || "0");

  const [payRows, ordRows] = await Promise.all([
    db.execute(sql`
      SELECT p.id, p.customer_id AS "customerId", p.date, p.amount::numeric AS amount, p.method,
        STRING_AGG(CAST(pol.order_id AS text), ',' ORDER BY o.order_date, o.id) FILTER (WHERE pol.order_id IS NOT NULL) AS linked_ids,
        STRING_AGG(COALESCE(pol.amount_applied::text, 'N'), ',' ORDER BY o.order_date, o.id) FILTER (WHERE pol.order_id IS NOT NULL) AS amounts_applied
      FROM payments p
      LEFT JOIN payment_order_links pol ON pol.payment_id = p.id
      LEFT JOIN orders o ON o.id = pol.order_id
      WHERE p.customer_id IN (${memberIds})
      GROUP BY p.id, p.customer_id, p.date, p.amount, p.method
      ORDER BY p.date, p.id`),
    db.execute(sql`
      SELECT o.id, o.customer_id AS "customerId", o.folio, o.remito_num AS "remitoNum", o.order_date::date::text AS "orderDate",
        c.name AS "customerName", o.comision_pct::numeric AS pct, o.comision_saldada AS saldada,
        ROUND(SUM(CASE
          WHEN oi.price_per_unit::numeric = 0 THEN 0
          WHEN (c.has_iva AND (c.iva_since IS NULL OR o.order_date::date >= c.iva_since)) THEN oi.quantity::numeric * oi.price_per_unit::numeric * (1 + COALESCE(p.iva_rate, 0.105))
          ELSE oi.quantity::numeric * oi.price_per_unit::numeric END)) AS billing,
        SUM(CASE WHEN oi.price_per_unit::numeric = 0 THEN 0 ELSE oi.quantity::numeric * oi.price_per_unit::numeric END) AS neto
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.customer_id IN (${memberIds}) AND o.status = 'approved'
      GROUP BY o.id, o.customer_id, o.folio, o.remito_num, o.order_date, c.name, o.comision_pct, o.comision_saldada, c.has_iva, c.iva_since
      ORDER BY o.order_date ASC, o.id ASC`),
  ]);

  const orders: OrderRow[] = (ordRows.rows as any[]).map((r) => ({
    id: Number(r.id), customerId: Number(r.customerId), rootId: rootOf.get(Number(r.customerId)) ?? Number(r.customerId),
    folio: String(r.folio), remitoNum: r.remitoNum != null ? Number(r.remitoNum) : null, orderDate: String(r.orderDate),
    customerName: String(r.customerName), billing: Math.round(Number(r.billing ?? 0)), neto: Number(r.neto ?? 0),
    pct: r.pct != null ? Number(r.pct) : null, saldada: !!r.saldada,
  }));
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const ordersByRoot = new Map<number, OrderRow[]>();
  for (const o of orders) { if (!ordersByRoot.has(o.rootId)) ordersByRoot.set(o.rootId, []); ordersByRoot.get(o.rootId)!.push(o); }
  const paysByRoot = new Map<number, any[]>();
  for (const p of payRows.rows as any[]) {
    const root = rootOf.get(Number(p.customerId)) ?? Number(p.customerId);
    if (!paysByRoot.has(root)) paysByRoot.set(root, []);
    paysByRoot.get(root)!.push(p);
  }

  const cobranzas: Cobranza[] = [];
  const comisionDe = (o: OrderRow | undefined, method: string, aplicado: number): { comisiona: boolean; comision: number } => {
    if (!o || o.saldada || !o.pct || o.billing <= 0 || COBRANZA_SIN_COMISION.has(method)) return { comisiona: false, comision: 0 };
    return { comisiona: true, comision: r2((o.pct / 100) * o.neto * (aplicado / o.billing)) };
  };
  const push = (paymentId: number | null, fecha: string, method: string, orderId: number, aplicado: number) => {
    if (aplicado <= 0) return;
    cobranzas.push({ paymentId, fecha, method, orderId, aplicado, ...comisionDe(orderById.get(orderId), method, aplicado) });
  };

  for (const root of Array.from(new Set([...Array.from(ordersByRoot.keys()), ...Array.from(paysByRoot.keys())]))) {
    const ords = ordersByRoot.get(root) ?? [];
    const credit = new Map<number, number>();
    const pool: { paymentId: number; fecha: string; method: string; amount: number }[] = [];
    // Paso 1: vínculos explícitos (idéntico a la CC)
    for (const p of paysByRoot.get(root) ?? []) {
      const amount = Math.round(Number(p.amount ?? 0));
      const pid = Number(p.id), fecha = String(p.date).slice(0, 10), method = String(p.method ?? "");
      const linkedIdsStr: string | null = p.linked_ids;
      if (!linkedIdsStr) { pool.push({ paymentId: pid, fecha, method, amount }); continue; }
      const linkedIds = linkedIdsStr.split(",").map(Number).filter((n) => !isNaN(n) && n > 0);
      const rawAmounts: string[] = p.amounts_applied ? String(p.amounts_applied).split(",") : [];
      const allKnown = rawAmounts.length === linkedIds.length && rawAmounts.every((s) => s !== "N");
      if (allKnown) {
        let totalApplied = 0;
        for (let i = 0; i < linkedIds.length; i++) {
          const exact = Math.round(parseFloat(rawAmounts[i]));
          if (!isNaN(exact) && exact > 0) {
            credit.set(linkedIds[i], (credit.get(linkedIds[i]) ?? 0) + exact);
            push(pid, fecha, method, linkedIds[i], exact);
            totalApplied += exact;
          }
        }
        if (amount - totalApplied > 0) pool.push({ paymentId: pid, fecha, method, amount: amount - totalApplied });
      } else {
        let remaining = amount;
        for (const oid of linkedIds) {
          if (remaining <= 0) break;
          const total = orderById.get(oid)?.billing ?? 0;
          const covered = credit.get(oid) ?? 0;
          const toApply = Math.min(remaining, Math.max(0, total - covered));
          if (toApply > 0) { credit.set(oid, covered + toApply); push(pid, fecha, method, oid, toApply); remaining -= toApply; }
        }
        if (remaining !== 0) pool.push({ paymentId: pid, fecha, method, amount: remaining });
      }
    }
    // Paso 2: pool FIFO pago por pago. Saldo inicial y entradas negativas se netean primero (mismo total que la CC).
    let deuda = Math.round(openingByRoot.get(root) ?? 0);
    for (const e of pool) if (e.amount < 0) deuda += -e.amount;
    const entradas = pool.filter((e) => e.amount > 0).map((e) => ({ ...e, paymentId: e.paymentId as number | null }));
    if (deuda < 0) { entradas.unshift({ paymentId: null, fecha: "0000-00-00", method: "SALDO_INICIAL", amount: -deuda }); deuda = 0; }
    for (const e of entradas) {
      let usable = e.amount;
      if (deuda > 0) { const u = Math.min(deuda, usable); deuda -= u; usable -= u; }
      if (usable <= 0) continue;
      for (const o of ords) {
        if (usable <= 0) break;
        const covered = credit.get(o.id) ?? 0;
        const toApply = Math.min(usable, Math.max(0, o.billing - covered));
        if (toApply > 0) { credit.set(o.id, covered + toApply); push(e.paymentId, e.fecha, e.method, o.id, toApply); usable -= toApply; }
      }
    }
  }
  return { orders, cobranzas };
}

// ─── Vista de un vendedor ───────────────────────────────────────────────────────────────────────────
async function clientesDelVendedor(vendedor: string) {
  return (await db.execute(sql`
    SELECT id, name, parent_customer_id AS "parentId", comision_alta::text AS alta, active
    FROM customers WHERE salesperson_name = ${vendedor}`)).rows as { id: number; name: string; parentId: number | null; alta: string | null; active: boolean }[];
}

export async function cobranzasVendedor(vendedor: string): Promise<{ pedidos: PedidoComision[]; cobranzas: Cobranza[]; clientes: Awaited<ReturnType<typeof clientesDelVendedor>> }> {
  const clientes = await clientesDelVendedor(vendedor);
  const ids = new Set(clientes.map((c) => Number(c.id)));
  const roots = Array.from(new Set(clientes.map((c) => Number(c.parentId ?? c.id))));
  const { orders, cobranzas } = await cobranzasDeGrupos(roots);
  const mios = orders.filter((o) => ids.has(o.customerId));
  const mioIds = new Set(mios.map((o) => o.id));
  const cobs = cobranzas.filter((c) => mioIds.has(c.orderId));
  const agg = new Map<number, { habilitada: number; sinCom: number; cobrado: number; cubierto: number }>();
  for (const c of cobs) {
    const a = agg.get(c.orderId) ?? { habilitada: 0, sinCom: 0, cobrado: 0, cubierto: 0 };
    a.cubierto += c.aplicado;
    if (c.comisiona) { a.habilitada += c.comision; a.cobrado += c.aplicado; }
    else if (c.paymentId != null) a.sinCom += c.aplicado;
    agg.set(c.orderId, a);
  }
  const pedidos: PedidoComision[] = mios.map((o) => {
    const a = agg.get(o.id) ?? { habilitada: 0, sinCom: 0, cobrado: 0, cubierto: 0 };
    const devengada = o.saldada || !o.pct ? 0 : r2((o.pct / 100) * o.neto);
    const sinComision = o.billing > 0 ? r2(devengada * (a.sinCom / o.billing)) : 0;
    const habilitada = r2(a.habilitada);
    return {
      id: o.id, folio: o.folio, remitoNum: o.remitoNum, orderDate: o.orderDate, customerId: o.customerId, customerName: o.customerName,
      neto: r2(o.neto), totalConIva: o.billing, pct: o.pct, saldada: o.saldada,
      devengada, habilitada, sinComision, pendiente: Math.max(0, r2(devengada - habilitada - sinComision)),
      cobrado: a.cobrado, cubierto: Math.min(a.cubierto, o.billing), saldo: Math.max(0, o.billing - a.cubierto),
    };
  });
  return { pedidos, cobranzas: cobs, clientes };
}

export async function getComisionesVendedor(vendedor: string) {
  const { pedidos, cobranzas, clientes } = await cobranzasVendedor(vendedor);
  const hoy = hoyAR();
  const mes = hoy.slice(0, 7);
  const porCliente = new Map<number, { facturado: number; cubierto: number; habilitada: number; pendiente: number; pedidos: number }>();
  for (const p of pedidos) {
    const a = porCliente.get(p.customerId) ?? { facturado: 0, cubierto: 0, habilitada: 0, pendiente: 0, pedidos: 0 };
    a.facturado += p.totalConIva; a.cubierto += p.cubierto; a.habilitada += p.habilitada; a.pendiente += p.pendiente; a.pedidos += 1;
    porCliente.set(p.customerId, a);
  }
  const clientesOut = clientes.filter((c) => c.active).map((c) => {
    const a = porCliente.get(Number(c.id)) ?? { facturado: 0, cubierto: 0, habilitada: 0, pendiente: 0, pedidos: 0 };
    return {
      id: Number(c.id), name: c.name, alta: c.alta, fechaBaja: c.alta ? fechaBajaComision(c.alta) : null,
      pctVigente: comisionPctEn(c.alta, hoy), pedidos: a.pedidos,
      facturado: r2(a.facturado), cobrado: r2(a.cubierto), saldo: r2(a.facturado - a.cubierto),
      habilitada: r2(a.habilitada), pendiente: r2(a.pendiente),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const habilitadasMes = r2(cobranzas.filter((c) => c.comisiona && c.fecha.slice(0, 7) === mes).reduce((s, c) => s + c.comision, 0));
  // 17/11: habilitadas por mes (YYYY-MM → $) para el selector de mes de la pantalla del vendedor: cobranzas por mes
  // de cobro + pedidos saldados (esquema anterior, % × facturado) por mes de pedido. Misma regla que comisionesPorMes.
  const habilitadasPorMes: Record<string, number> = {};
  for (const c of cobranzas) {
    if (!c.comisiona) continue;
    const ym = c.fecha.slice(0, 7);
    habilitadasPorMes[ym] = r2((habilitadasPorMes[ym] ?? 0) + c.comision);
  }
  for (const [ym, v] of Array.from((await saldadasPorMes(vendedor, "2000-01-01", "2100-01-01")).entries())) {
    habilitadasPorMes[ym] = r2((habilitadasPorMes[ym] ?? 0) + v);
  }
  const pendientes = r2(pedidos.reduce((s, p) => s + p.pendiente, 0));
  const liquidado = (await db.execute(sql`SELECT COALESCE(SUM(total::numeric), 0) AS t FROM comision_liquidaciones WHERE vendedor = ${vendedor}`)).rows[0] as any;
  // Habilitadas en total = por cobranza + lo saldado por facturación desde que arrancó el esquema (oct 2026), que es
  // lo que entra en los cierres; así `sinLiquidar` cuadra con las liquidaciones.
  const habilitadasTotal = r2(pedidos.reduce((s, p) => s + p.habilitada + (p.saldada && p.pct && p.orderDate >= "2026-10-01" ? (p.pct / 100) * p.neto : 0), 0));
  return {
    hoy, mes,
    resumen: { habilitadasMes, pendientes, habilitadasTotal, liquidado: r2(Number(liquidado?.t ?? 0)), sinLiquidar: r2(habilitadasTotal - Number(liquidado?.t ?? 0)) },
    habilitadasPorMes,
    clientes: clientesOut,
    pedidos: pedidos.filter((p) => p.orderDate >= "2026-10-01" || p.pendiente > 0).sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.id - a.id),
    liquidaciones: await getLiquidaciones(vendedor),
  };
}

export async function getLiquidaciones(vendedor: string) {
  const cabs = (await db.execute(sql`
    SELECT id, periodo, total::numeric AS total, cerrada_at AS "cerradaAt" FROM comision_liquidaciones WHERE vendedor = ${vendedor} ORDER BY periodo DESC`)).rows as any[];
  if (cabs.length === 0) return [];
  const items = (await db.execute(sql`
    SELECT i.liquidacion_id AS lid, i.order_id AS "orderId", i.payment_id AS "paymentId", i.fecha_cobro AS fecha, i.cobrado::numeric AS cobrado,
      i.pct::numeric AS pct, i.comision::numeric AS comision, i.ajuste, o.folio, o.remito_num AS "remitoNum", o.order_date::date::text AS "orderDate", c.name AS "customerName"
    FROM comision_liquidacion_items i
    JOIN comision_liquidaciones l ON l.id = i.liquidacion_id
    LEFT JOIN orders o ON o.id = i.order_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE l.vendedor = ${vendedor}
    ORDER BY i.fecha_cobro, i.id`)).rows as any[];
  return cabs.map((l) => ({
    id: Number(l.id), periodo: String(l.periodo), total: Number(l.total), cerradaAt: l.cerradaAt,
    items: items.filter((i) => Number(i.lid) === Number(l.id)).map((i) => ({
      orderId: Number(i.orderId), paymentId: i.paymentId != null ? Number(i.paymentId) : null, fecha: String(i.fecha),
      cobrado: Number(i.cobrado), pct: Number(i.pct), comision: Number(i.comision), ajuste: !!i.ajuste,
      folio: i.folio ?? null, remitoNum: i.remitoNum != null ? Number(i.remitoNum) : null, orderDate: i.orderDate ?? null, customerName: i.customerName ?? null,
    })),
  }));
}

// ─── Totales por rango / mes (dashboards). Para pedidos saldados vale lo viejo: % × facturado por fecha de pedido ──
async function saldadasPorMes(vendedor: string, from: string, to: string): Promise<Map<string, number>> {
  const rows = (await db.execute(sql`
    SELECT to_char(o.order_date, 'YYYY-MM') AS ym,
      COALESCE(SUM(CASE WHEN oi.price_per_unit::numeric = 0 THEN 0 ELSE COALESCE(o.comision_pct::numeric, 0) / 100 * oi.quantity::numeric * oi.price_per_unit::numeric END), 0)::float AS comision
    FROM orders o JOIN customers c ON c.id = o.customer_id JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status = 'approved' AND o.comision_saldada = true AND c.salesperson_name = ${vendedor}
      AND o.order_date >= ${from}::timestamp AND o.order_date < ${to}::timestamp
    GROUP BY 1`)).rows as any[];
  return new Map(rows.map((r) => [String(r.ym), Number(r.comision)]));
}

/** 17/11: comisión TOTAL devengada por mes de pedido (YYYY-MM → % × neto de todos los pedidos aprobados con %, saldados incluidos). */
export async function devengadasPorMes(vendedor: string, from: string, to: string): Promise<Map<string, number>> {
  const rows = (await db.execute(sql`
    SELECT to_char(o.order_date, 'YYYY-MM') AS ym,
      COALESCE(SUM(CASE WHEN oi.price_per_unit::numeric = 0 THEN 0 ELSE COALESCE(o.comision_pct::numeric, 0) / 100 * oi.quantity::numeric * oi.price_per_unit::numeric END), 0)::float AS comision
    FROM orders o JOIN customers c ON c.id = o.customer_id JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status = 'approved' AND c.salesperson_name = ${vendedor}
      AND o.order_date >= ${from}::timestamp AND o.order_date < ${to}::timestamp
    GROUP BY 1`)).rows as any[];
  return new Map(rows.map((r) => [String(r.ym), r2(Number(r.comision))]));
}

/** 17/11: de los pedidos con fecha en [from, to): comisión total devengada (saldados: % × neto) y lo que todavía falta cobrar. */
export async function pedidosEnRango(vendedor: string, from: string, to: string): Promise<{ total: number; pendiente: number }> {
  const { pedidos } = await cobranzasVendedor(vendedor);
  let total = 0, pendiente = 0;
  for (const p of pedidos) {
    if (p.orderDate < from || p.orderDate >= to) continue;
    total += p.saldada && p.pct ? r2((p.pct / 100) * p.neto) : p.devengada;
    pendiente += p.pendiente;
  }
  return { total: r2(total), pendiente: r2(pendiente) };
}

/** Comisiones de un vendedor en [from, to): habilitadas por cobranzas de esas fechas + saldadas por facturación. */
export async function comisionesEnRango(vendedor: string, from: string, to: string): Promise<{ porCobranza: number; saldadas: number; total: number }> {
  const [{ cobranzas }, sal] = await Promise.all([cobranzasVendedor(vendedor), saldadasPorMes(vendedor, from, to)]);
  const porCobranza = r2(cobranzas.filter((c) => c.comisiona && c.fecha >= from && c.fecha < to).reduce((s, c) => s + c.comision, 0));
  const saldadas = r2(Array.from(sal.values()).reduce((s, v) => s + v, 0));
  return { porCobranza, saldadas, total: r2(porCobranza + saldadas) };
}

/** Comisiones mes a mes (YYYY-MM → $) de un año. */
export async function comisionesPorMes(vendedor: string, year: number): Promise<Map<string, number>> {
  const from = `${year}-01-01`, to = `${year + 1}-01-01`;
  const [{ cobranzas }, sal] = await Promise.all([cobranzasVendedor(vendedor), saldadasPorMes(vendedor, from, to)]);
  const out = new Map<string, number>(sal);
  for (const c of cobranzas) {
    if (!c.comisiona || c.fecha < from || c.fecha >= to) continue;
    const ym = c.fecha.slice(0, 7);
    out.set(ym, (out.get(ym) ?? 0) + c.comision);
  }
  return out;
}

export type DetalleRow = { tipo: "cobranza" | "facturado"; orderDate: string; customerName: string; folio: string; total: number; commissionPct: number; commissionAmount: number };

/** Detalle de un mes para el modal de admin (y PDF): cobranzas del mes + pedidos saldados del mes. */
export async function detalleMes(vendedor: string, year: number, month: number): Promise<{ rows: DetalleRow[]; totalVentas: number; totalComision: number }> {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const { pedidos, cobranzas } = await cobranzasVendedor(vendedor);
  const byId = new Map(pedidos.map((p) => [p.id, p]));
  const rows: DetalleRow[] = [];
  for (const p of pedidos) {
    if (p.saldada && p.orderDate >= from && p.orderDate < to && p.pct) {
      rows.push({ tipo: "facturado", orderDate: p.orderDate, customerName: p.customerName, folio: p.folio, total: p.neto, commissionPct: p.pct, commissionAmount: r2((p.pct / 100) * p.neto) });
    }
  }
  for (const c of cobranzas) {
    if (!c.comisiona || c.fecha < from || c.fecha >= to) continue;
    const p = byId.get(c.orderId);
    if (!p) continue;
    rows.push({ tipo: "cobranza", orderDate: c.fecha, customerName: p.customerName, folio: p.folio, total: c.aplicado, commissionPct: p.pct ?? 0, commissionAmount: c.comision });
  }
  rows.sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.customerName.localeCompare(b.customerName));
  return { rows, totalVentas: r2(rows.reduce((s, r) => s + r.total, 0)), totalComision: r2(rows.reduce((s, r) => s + r.commissionAmount, 0)) };
}

export async function getVendedores(): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT salesperson_name AS v FROM customers WHERE salesperson_name IS NOT NULL AND TRIM(salesperson_name) <> '' AND active = true ORDER BY 1`)).rows as any[];
  return rows.map((r) => String(r.v));
}

// ─── Cierre mensual ───────────────────────────────────────────────────────────────────────────────────
/**
 * Liquida `periodo` (YYYY-MM, ya terminado) para el vendedor: toma todas las cobranzas que habilitan comisión
 * con fecha de pago ≤ fin del período y que no estén en ningún cierre anterior. Si una cobranza ya liquidada
 * cambió o desapareció, entra un item de ajuste por la diferencia. Un cobro cargado tarde entra en el cierre siguiente.
 */
export async function cerrarLiquidacion(vendedor: string, periodo: string, userId: number): Promise<{ id: number; total: number; items: number; ajustes: number }> {
  if (!/^\d{4}-\d{2}$/.test(periodo)) throw new Error("Período inválido (YYYY-MM)");
  if (periodo >= hoyAR().slice(0, 7)) throw new Error("Solo se puede cerrar un mes ya terminado");
  const prev = (await db.execute(sql`SELECT MAX(periodo) AS m FROM comision_liquidaciones WHERE vendedor = ${vendedor}`)).rows[0] as any;
  if (prev?.m && String(prev.m) >= periodo) throw new Error(`Ya hay un cierre de ${vendedor} para ${prev.m}; solo se cierran períodos posteriores`);
  const fin = `${periodo}-31`;
  const vista = await cobranzasVendedor(vendedor);
  const cobranzas = vista.cobranzas;
  const pedidos = new Map(vista.pedidos.map((p) => [p.id, p]));
  const cur = new Map<string, { paymentId: number; orderId: number; fecha: string; cobrado: number; comision: number; pct: number }>();
  for (const c of cobranzas) {
    if (!c.comisiona || c.paymentId == null || c.fecha > fin) continue;
    const k = `${c.paymentId}:${c.orderId}`;
    const a = cur.get(k) ?? { paymentId: c.paymentId, orderId: c.orderId, fecha: c.fecha, cobrado: 0, comision: 0, pct: pedidos.get(c.orderId)?.pct ?? 0 };
    a.cobrado += c.aplicado; a.comision = r2(a.comision + c.comision);
    cur.set(k, a);
  }
  const prior = new Map<string, { cobrado: number; comision: number; pct: number; fecha: string; paymentId: number; orderId: number }>();
  for (const r of (await db.execute(sql`
    SELECT i.payment_id AS pid, i.order_id AS oid, SUM(i.cobrado::numeric) AS cobrado, SUM(i.comision::numeric) AS comision, MAX(i.pct::numeric) AS pct, MAX(i.fecha_cobro) AS fecha
    FROM comision_liquidacion_items i JOIN comision_liquidaciones l ON l.id = i.liquidacion_id
    WHERE l.vendedor = ${vendedor} AND i.payment_id IS NOT NULL GROUP BY 1, 2`)).rows as any[]) {
    prior.set(`${r.pid}:${r.oid}`, { cobrado: Number(r.cobrado), comision: Number(r.comision), pct: Number(r.pct), fecha: String(r.fecha), paymentId: Number(r.pid), orderId: Number(r.oid) });
  }
  const items: { orderId: number; paymentId: number; fecha: string; cobrado: number; pct: number; comision: number; ajuste: boolean }[] = [];
  for (const [k, c] of Array.from(cur.entries())) {
    const p = prior.get(k);
    if (!p) { items.push({ orderId: c.orderId, paymentId: c.paymentId, fecha: c.fecha, cobrado: r2(c.cobrado), pct: c.pct, comision: c.comision, ajuste: false }); continue; }
    const diff = r2(c.comision - p.comision);
    if (Math.abs(diff) >= 0.01) items.push({ orderId: c.orderId, paymentId: c.paymentId, fecha: c.fecha, cobrado: r2(c.cobrado - p.cobrado), pct: c.pct, comision: diff, ajuste: true });
  }
  for (const [k, p] of Array.from(prior.entries())) {
    if (cur.has(k) || Math.abs(p.comision) < 0.01) continue;
    items.push({ orderId: p.orderId, paymentId: p.paymentId, fecha: p.fecha, cobrado: r2(-p.cobrado), pct: p.pct, comision: r2(-p.comision), ajuste: true });
  }
  // 17/11: pedidos SALDADOS (esquema anterior: comisionados por facturación) con fecha de pedido en el período entran
  // al cierre como item sin pago (% × neto, fecha = fecha del pedido), una sola vez. Así el cierre de octubre de Juan
  // muestra lo mismo que el gráfico mensual (comisionesPorMes) y `liquidado` cuadra con `habilitadasTotal`.
  const yaSaldados = new Set(((await db.execute(sql`
    SELECT i.order_id AS oid FROM comision_liquidacion_items i JOIN comision_liquidaciones l ON l.id = i.liquidacion_id
    WHERE l.vendedor = ${vendedor} AND i.payment_id IS NULL AND i.ajuste = false`)).rows as any[]).map((r) => Number(r.oid)));
  const itemsSaldados: { orderId: number; paymentId: null; fecha: string; cobrado: number; pct: number; comision: number; ajuste: boolean }[] = [];
  for (const p of vista.pedidos) {
    if (!p.saldada || !p.pct || p.orderDate < `${periodo}-01` || p.orderDate > fin || yaSaldados.has(p.id)) continue;
    itemsSaldados.push({ orderId: p.id, paymentId: null, fecha: p.orderDate, cobrado: r2(p.neto), pct: p.pct, comision: r2((p.pct / 100) * p.neto), ajuste: false });
  }
  const total = r2([...items, ...itemsSaldados].reduce((s, i) => s + i.comision, 0));
  return db.transaction(async (tx) => {
    const cab = (await tx.execute(sql`
      INSERT INTO comision_liquidaciones (vendedor, periodo, total, cerrada_by) VALUES (${vendedor}, ${periodo}, ${total.toFixed(2)}, ${userId}) RETURNING id`)).rows[0] as any;
    const id = Number(cab.id);
    for (const i of [...items, ...itemsSaldados]) {
      await tx.execute(sql`
        INSERT INTO comision_liquidacion_items (liquidacion_id, order_id, payment_id, fecha_cobro, cobrado, pct, comision, ajuste)
        VALUES (${id}, ${i.orderId}, ${i.paymentId}, ${i.fecha}, ${i.cobrado.toFixed(2)}, ${i.pct.toFixed(2)}, ${i.comision.toFixed(2)}, ${i.ajuste})`);
    }
    return { id, total, items: items.length + itemsSaldados.length, ajustes: items.filter((i) => i.ajuste).length };
  });
}

/**
 * 17/11: cierre automático. Cuando termina un mes, se liquida solo (sin esperar el botón "Cerrar mes"): para cada
 * vendedor cierra todos los meses terminados que todavía no tengan cierre, desde el siguiente al último cerrado
 * (o el mes recién terminado si nunca cerró) hasta el mes anterior al actual. Idempotente: se puede llamar seguido.
 * Lo llama el programador (server/automation.ts) una vez por hora. Devuelve los cierres que hizo.
 */
export async function cerrarMesesVencidos(userId: number | null = null): Promise<{ vendedor: string; periodo: string; total: number }[]> {
  const mesActual = hoyAR().slice(0, 7);
  const mesAnterior = sumarMeses(mesActual, -1);
  const vendedores = new Set(await getVendedores());
  for (const r of (await db.execute(sql`SELECT DISTINCT vendedor FROM comision_liquidaciones`)).rows as any[]) vendedores.add(String(r.vendedor));
  const hechos: { vendedor: string; periodo: string; total: number }[] = [];
  for (const v of Array.from(vendedores)) {
    const last = (await db.execute(sql`SELECT MAX(periodo) AS m FROM comision_liquidaciones WHERE vendedor = ${v}`)).rows[0] as any;
    let periodo = last?.m ? sumarMeses(String(last.m), 1) : mesAnterior;
    while (periodo <= mesAnterior) {
      const r = await cerrarLiquidacion(v, periodo, userId as any);
      hechos.push({ vendedor: v, periodo, total: r.total });
      periodo = sumarMeses(periodo, 1);
    }
  }
  return hechos;
}

function sumarMeses(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
