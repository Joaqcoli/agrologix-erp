// Detalle de cuenta corriente de un cliente, versión vendedor (17/11/2026): solo lectura.
// Misma fuente que el admin (getCCCustomerDetail + getPendingOrdersForCustomer) vía /api/vendedor/cc/*.
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, Redirect } from "wouter";
import { VendedorLayout } from "./layout";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ChevronDown, ChevronRight, Clock, Receipt, Banknote, Building2 } from "lucide-react";
import { fmtPesos } from "@/lib/format";
import { VX_CSS, MESES, fmtFechaCorta, formatRemito } from "./rx";

const fmt = fmtPesos;
/** Muestra solo el número secuencial de la factura: "B-0004-00000003" → "03" */
const fmtFacturaSeq = (n: string | null | undefined): string => {
  if (!n) return "—";
  const seq = n.split("-").at(-1);
  if (!seq) return n;
  const num = parseInt(seq, 10);
  return isNaN(num) ? n : String(num).padStart(2, "0");
};
const metodoLabel = (m: string) => m.charAt(0) + m.slice(1).toLowerCase().replace(/_/g, " ");

type OrderRow = { id: number; folio: string; remitoNum: number | null; orderDate: string; total: number; invoiceNumber?: string | null; isPaid: boolean; paidAmount: number; customerId?: number };
type PaymentRow = {
  id: number; date: string; amount: string | number; method: string; notes?: string | null;
  orderFolio?: string | null;
  lines?: { method: string; amount: number }[];
  appliedOrders?: { folio: string | null; remitoNum: number | null; invoiceNumber: string | null; amountApplied: number | null }[];
  chequeDetails?: { numero: string | null; fechaCobro: string | null; monto: number | null }[];
};
type Withholding = { id: number; date: string; amount: string | number; type: string; notes?: string | null };
type Subsidiary = { customerId: number; customerName: string; facturacion: number; cobranza: number; saldo: number };
type CCDetail = {
  isChild?: boolean; parentId?: number; parentName?: string;
  customer: { id: number; name: string; hasIva: boolean; ccType?: string | null; phone?: string | null; city?: string | null };
  month: number; year: number;
  saldoMesAnterior: number; facturacion: number; cobranza: number; retenciones: number; saldo: number;
  orders: OrderRow[]; payments: PaymentRow[]; withholdings: Withholding[];
  isParent?: boolean; subsidiaries?: Subsidiary[];
};
type PendingOrder = { id: number; folio: string; remitoNum: number | null; total: string; paidAmount: string; orderDate: string; invoiceNumber?: string | null; customerId?: number };

type FilterType = "mes" | "semana" | "dia";
const localStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function monthRange(month: number, year: number): [string, string] {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const em = month === 12 ? 1 : month + 1, ey = month === 12 ? year + 1 : year;
  return [from, `${ey}-${String(em).padStart(2, "0")}-01`];
}
function dayRange(dateStr: string): [string, string] {
  const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + 1);
  return [dateStr, localStr(d)];
}
function weekRange(weekStr: string): [string, string] {
  const [ys, ws] = weekStr.split("-W");
  const year = parseInt(ys), week = parseInt(ws);
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = (jan4.getDay() + 6) % 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + (week - 1) * 7);
  const next = new Date(monday); next.setDate(monday.getDate() + 7);
  return [localStr(monday), localStr(next)];
}
function toISOWeek(d: Date): string {
  const tmp = new Date(d.getTime());
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const week1 = new Date(tmp.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${tmp.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}
function detectFilterType(from: string, to: string): FilterType {
  const d1 = new Date(from + "T00:00:00"), d2 = new Date(to + "T00:00:00");
  const days = Math.round((d2.getTime() - d1.getTime()) / 86400000);
  if (days === 1) return "dia";
  if (days === 7) return "semana";
  return "mes";
}

function Saldo({ v }: { v: number }) {
  if (v > 0) return <span style={{ color: "#b0553f", fontWeight: 700 }}>{fmt(v)}</span>;
  if (v < 0) return <span style={{ color: "#5f8020", fontWeight: 700 }}>{fmt(v)}</span>;
  return <span style={{ color: "#c8ccc3" }}>$0</span>;
}
const gris = { color: "#8b8f88" };

export default function VendedorCCDetail({ customerId, month: initMonth, year: initYear, dateFrom: initDateFrom, dateTo: initDateTo }: {
  customerId: number; month: number; year: number; dateFrom?: string; dateTo?: string;
}) {
  const [, setLocation] = useLocation();
  const today = new Date();
  const years = Array.from({ length: 3 }, (_, i) => today.getFullYear() - i);

  const initRange = useMemo<[string, string]>(() => (initDateFrom && initDateTo ? [initDateFrom, initDateTo] : monthRange(initMonth, initYear)), []);
  const [filterType, setFilterType] = useState<FilterType>(() => detectFilterType(initRange[0], initRange[1]));
  const [month, setMonth] = useState(initMonth);
  const [year, setYear] = useState(initYear);
  const [selectedDate, setSelectedDate] = useState(initRange[0]);
  const [selectedWeek, setSelectedWeek] = useState(() => toISOWeek(new Date(initRange[0] + "T00:00:00")));
  const [expandedPayment, setExpandedPayment] = useState<number | null>(null);

  const [from, to] = useMemo<[string, string]>(() => {
    if (filterType === "mes") return monthRange(month, year);
    if (filterType === "dia") return dayRange(selectedDate);
    return weekRange(selectedWeek);
  }, [filterType, month, year, selectedDate, selectedWeek]);

  const { data, isLoading, error } = useQuery<CCDetail>({
    queryKey: ["/api/vendedor/cc/customer", customerId, from, to],
    queryFn: async () => {
      const res = await fetch(`/api/vendedor/cc/customer/${customerId}?dateFrom=${from}&dateTo=${to}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const { data: pendingOrders = [] } = useQuery<PendingOrder[]>({
    queryKey: ["/api/vendedor/cc/pending-orders", customerId],
    queryFn: async () => {
      const res = await fetch(`/api/vendedor/cc/pending-orders/${customerId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  // Pedidos impagos de períodos anteriores (misma regla que el admin)
  const prevPending = useMemo(() => pendingOrders.filter((o) => o.orderDate.slice(0, 10) < from), [pendingOrders, from]);
  const prevTotal = prevPending.reduce((s, o) => s + parseFloat(o.total) - parseFloat(o.paidAmount ?? "0"), 0);
  const pendientesPeriodo = (data?.orders ?? []).filter((o) => !o.isPaid);
  const pendientesPeriodoTotal = pendientesPeriodo.reduce((s, o) => s + (o.total - (o.paidAmount ?? 0)), 0);

  const periodLabel = filterType === "mes" ? `${MESES[month - 1]} ${year}`
    : filterType === "dia" ? new Date(from + "T00:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })
    : `Semana del ${fmtFechaCorta(from)}`;
  const backUrl = `/vendedor/cc`;

  if (data?.isChild && data.parentId) {
    return <Redirect to={`/vendedor/cc/${data.parentId}?dateFrom=${from}&dateTo=${to}&month=${month}&year=${year}`} />;
  }

  return (
    <VendedorLayout title={data?.customer?.name ? `CC — ${data.customer.name}` : "Cuenta corriente"}>
      <div className="vx">
        <style>{VX_CSS}</style>
        <div className="vx-wrap">
          <button className="vx-back" onClick={() => setLocation(backUrl)}><ArrowLeft className="h-4 w-4" /> Volver a cuentas corrientes</button>

          <div className="vx-top">
            <div style={{ minWidth: 0 }}>
              {isLoading ? <Skeleton className="h-7 w-56" /> : (
                <>
                  <h1 className="vx-title">{data?.customer.name}</h1>
                  <div className="vx-subtitle" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span>{periodLabel}</span>
                    {data?.customer.city && <span>· {data.customer.city}</span>}
                    {data?.customer.hasIva && <span className="vx-chip iva">Con IVA</span>}
                    <span className="vx-chip line">{data?.customer.ccType === "por_remito" ? "Por remito" : "Por saldo"}</span>
                    {data?.isParent && <span className="vx-chip info">Cuenta unificada con sedes</span>}
                  </div>
                </>
              )}
            </div>
            <div className="vx-controls">
              <div className="vx-seg">
                {(["mes", "semana", "dia"] as FilterType[]).map((t) => (
                  <button key={t} className={filterType === t ? "on" : ""} onClick={() => setFilterType(t)}>{t === "mes" ? "Mes" : t === "semana" ? "Semana" : "Día"}</button>
                ))}
              </div>
              {filterType === "mes" && (
                <>
                  <div className="vx-sel">
                    <select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))}>{MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}</select>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </div>
                  <div className="vx-sel">
                    <select value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </div>
                </>
              )}
              {filterType === "dia" && <input type="date" className="vx-input" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />}
              {filterType === "semana" && <input type="week" className="vx-input" value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)} />}
            </div>
          </div>

          {error && <div className="vx-err">Error al cargar: {String(error)}</div>}

          {isLoading || !data ? (
            <div className="vx-kpis c4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}</div>
          ) : (
            <div className="vx-kpis c4">
              <div className="vx-kpi"><div className="lab">Saldo anterior</div><div className="val"><Saldo v={data.saldoMesAnterior} /></div><div className="note">al inicio del período</div></div>
              <div className="vx-kpi"><div className="lab">Facturación</div><div className="val">{fmt(data.facturacion)}</div><div className="note">{data.orders.length} pedido{data.orders.length !== 1 ? "s" : ""} en el período</div></div>
              <div className="vx-kpi main"><div className="lab">Cobranza</div><div className="val">{fmt(data.cobranza)}</div><div className="note">{data.retenciones > 0 ? `+ ${fmt(data.retenciones)} en retenciones` : `${data.payments.length} pago${data.payments.length !== 1 ? "s" : ""}`}</div></div>
              <div className={`vx-kpi${data.saldo > 0 ? " warn" : ""}`}><div className="lab">Saldo actual</div><div className="val"><Saldo v={data.saldo} /></div><div className="note">{data.saldo > 0 ? "el cliente debe" : data.saldo < 0 ? "a favor del cliente" : "al día"}</div></div>
            </div>
          )}

          {prevPending.length > 0 && (
            <div className="vx-card" style={{ borderColor: "#f3d9d0" }}>
              <div className="vx-chead">
                <span className="t"><Clock className="h-4 w-4" style={{ color: "#c05e42" }} /> Pendientes de períodos anteriores</span>
                <span className="n">{prevPending.length} remito{prevPending.length !== 1 ? "s" : ""} · <b style={{ color: "#b0553f" }}>{fmt(prevTotal)}</b></span>
              </div>
              <div className="vx-tblwrap">
                <table className="vx-tbl">
                  <thead><tr><th className="l">Remito</th><th className="l">Fecha</th><th className="l vx-hide-m">Factura</th><th>Total</th><th>Pendiente</th></tr></thead>
                  <tbody>
                    {prevPending.map((o) => (
                      <tr key={o.id} className="click" onClick={() => setLocation(`/vendedor/orders/${o.id}`)}>
                        <td className="l vx-mono" style={{ fontWeight: 600 }}>{formatRemito(o)}</td>
                        <td className="l mut">{fmtFechaCorta(o.orderDate)}</td>
                        <td className="l mut vx-hide-m">{fmtFacturaSeq(o.invoiceNumber)}</td>
                        <td>{fmt(parseFloat(o.total))}</td>
                        <td className="neg">{fmt(parseFloat(o.total) - parseFloat(o.paidAmount ?? "0"))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="vx-card">
            <div className="vx-chead">
              <span className="t"><Receipt className="h-4 w-4" /> Pedidos del período</span>
              <span className="n">{pendientesPeriodo.length > 0 ? <>{pendientesPeriodo.length} sin pagar · <b style={{ color: "#b0553f" }}>{fmt(pendientesPeriodoTotal)}</b></> : (data?.orders.length ?? 0) > 0 ? "todo pagado" : ""}</span>
            </div>
            {isLoading ? <div style={{ padding: "0 22px 16px" }}><Skeleton className="h-16 w-full" /></div>
            : (data?.orders.length ?? 0) === 0 ? <div style={{ padding: "28px 22px", textAlign: "center", fontSize: 14, ...gris }}>Sin pedidos en el período</div>
            : (
              <div className="vx-tblwrap">
                <table className="vx-tbl">
                  <thead><tr>
                    <th className="l">Remito</th><th className="l">Fecha</th>{data?.isParent && <th className="l vx-hide-m">Sede</th>}<th className="l vx-hide-m">Factura</th><th>Total</th><th className="l">Estado</th>
                  </tr></thead>
                  <tbody>
                    {data!.orders.map((o) => (
                      <tr key={o.id} className="click" onClick={() => setLocation(`/vendedor/orders/${o.id}`)} data-testid={`row-order-${o.id}`}>
                        <td className="l vx-mono" style={{ fontWeight: 600 }}>{formatRemito(o)}</td>
                        <td className="l mut">{fmtFechaCorta(o.orderDate)}</td>
                        {data?.isParent && <td className="l vx-hide-m mut">{o.customerId !== customerId ? ((data.subsidiaries ?? []).find((s) => s.customerId === o.customerId)?.customerName ?? "—") : "Principal"}</td>}
                        <td className="l mut vx-hide-m">{fmtFacturaSeq(o.invoiceNumber)}</td>
                        <td style={o.isPaid ? { color: "#8b8f88", textDecoration: "line-through" } : { fontWeight: 600 }}>{fmt(o.total)}</td>
                        <td className="l">{o.isPaid ? <span className="vx-chip ok"><i />Pagado</span> : o.paidAmount > 0 ? <span className="vx-chip par"><i />Parcial · falta {fmt(o.total - o.paidAmount)}</span> : <span className="vx-chip no"><i />Pendiente</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="vx-card">
            <div className="vx-chead"><span className="t"><Banknote className="h-4 w-4" /> Pagos del período</span><span className="n">{data?.payments.length ?? 0} pago{(data?.payments.length ?? 0) !== 1 ? "s" : ""} · tocá uno para ver a qué remitos fue</span></div>
            {isLoading ? <div style={{ padding: "0 22px 16px" }}><Skeleton className="h-16 w-full" /></div>
            : (data?.payments.length ?? 0) === 0 ? <div style={{ padding: "28px 22px", textAlign: "center", fontSize: 14, ...gris }}>Sin pagos en el período</div>
            : (
              <div className="vx-tblwrap">
                <table className="vx-tbl">
                  <thead><tr><th className="l">Fecha</th><th className="l">Método</th><th>Monto</th></tr></thead>
                  <tbody>
                    {data!.payments.map((p) => {
                      const open = expandedPayment === p.id;
                      return (
                        <Fragment key={p.id}>
                          <tr className="click" onClick={() => setExpandedPayment(open ? null : p.id)} data-testid={`row-payment-${p.id}`}>
                            <td className="l"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{open ? <ChevronDown className="h-3.5 w-3.5" style={gris} /> : <ChevronRight className="h-3.5 w-3.5" style={gris} />}{fmtFechaCorta(p.date)}</span></td>
                            <td className="l">
                              <span className="vx-chip gris">{metodoLabel(p.method)}</span>
                              {(p.lines?.length ?? 0) > 1 && <span style={{ fontSize: 11.5, marginLeft: 8, ...gris }}>{p.lines!.map((l) => `${metodoLabel(l.method)} ${fmt(l.amount)}`).join(" · ")}</span>}
                            </td>
                            <td className="pos">{fmt(parseFloat(String(p.amount)))}</td>
                          </tr>
                          {open && (
                            <tr className="sub">
                              <td className="l" colSpan={3} style={{ whiteSpace: "normal" }}>
                                {(p.appliedOrders?.length ?? 0) === 0 ? <span style={gris}>Pago no imputado a remitos puntuales.</span> : (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    {p.appliedOrders!.map((o, i) => (
                                      <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, maxWidth: 420 }}>
                                        <span className="vx-mono" style={{ fontSize: 12.5 }}>{o.remitoNum != null ? `Remito ${formatRemito(o)}` : o.folio}{o.invoiceNumber ? <span style={gris}> · Fac. {o.invoiceNumber}</span> : null}</span>
                                        {o.amountApplied != null && <span style={{ color: "#5f8020", fontWeight: 600 }}>{fmt(o.amountApplied)}</span>}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {(p.chequeDetails?.length ?? 0) > 0 && (
                                  <div style={{ marginTop: 8, fontSize: 12.5 }}>
                                    <b>Cheque{p.chequeDetails!.length > 1 ? "s" : ""}:</b>{" "}
                                    {p.chequeDetails!.map((c, i) => <span key={i} style={{ marginRight: 10 }}>{c.numero ? `N° ${c.numero}` : "s/n"}{c.fechaCobro ? ` · cobro ${fmtFechaCorta(c.fechaCobro)}` : ""}{c.monto != null ? ` · ${fmt(c.monto)}` : ""}</span>)}
                                  </div>
                                )}
                                {p.notes && <div style={{ marginTop: 6, fontSize: 12.5, ...gris }}>{p.notes}</div>}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {(data?.withholdings.length ?? 0) > 0 && (
            <div className="vx-card">
              <div className="vx-chead"><span className="t">Retenciones del período</span></div>
              <div className="vx-tblwrap">
                <table className="vx-tbl">
                  <thead><tr><th className="l">Fecha</th><th className="l">Tipo</th><th>Monto</th></tr></thead>
                  <tbody>{data!.withholdings.map((w) => <tr key={w.id}><td className="l">{fmtFechaCorta(w.date)}</td><td className="l mut">{w.type}</td><td style={{ color: "#3a67a3", fontWeight: 600 }}>{fmt(parseFloat(String(w.amount)))}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}

          {data?.isParent && (data.subsidiaries?.length ?? 0) > 0 && (
            <div className="vx-card">
              <div className="vx-chead"><span className="t"><Building2 className="h-4 w-4" /> Sedes</span><span className="n">la cuenta se unifica en el principal</span></div>
              <div className="vx-tblwrap">
                <table className="vx-tbl">
                  <thead><tr><th className="l">Sede</th><th>Facturación</th><th>Cobranza</th><th>Saldo</th></tr></thead>
                  <tbody>{data.subsidiaries!.map((s) => <tr key={s.customerId}><td className="l cli">{s.customerName}</td><td>{fmt(s.facturacion)}</td><td className="pos">{fmt(s.cobranza)}</td><td><Saldo v={s.saldo} /></td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
          <div className="vx-note">Montos con IVA. Los pagos se imputan a los remitos elegidos al cargarlos; si no, al remito impago más viejo.</div>
        </div>
      </div>
    </VendedorLayout>
  );
}
