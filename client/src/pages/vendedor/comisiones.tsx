// Comisiones del vendedor (16/11/2026): devengada por pedido al crearse (5 % primeros 6 meses del cliente,
// después 1 %), habilitada a medida que entra la cobranza, liquidada por mes calendario de cobranza.
// 17/11: pantalla simplificada (un mes a la vez, solo los clientes que pidieron ese mes) con el estilo del admin.
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { VendedorLayout } from "./layout";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, ChevronLeft } from "lucide-react";
import { fmtPesos } from "@/lib/format";
import { VX_CSS, mesLabel, fmtFechaCorta, fmtDiaMes, hoyAR, sumarMes, formatRemito, fetchJson } from "./rx";

const fmt = fmtPesos;

type Cliente = { id: number; name: string; alta: string | null; fechaBaja: string | null; pctVigente: number; pedidos: number; facturado: number; cobrado: number; saldo: number; habilitada: number; pendiente: number };
type Pedido = { id: number; folio: string; remitoNum: number | null; orderDate: string; customerId: number; customerName: string; neto: number; totalConIva: number; pct: number | null; saldada: boolean; devengada: number; habilitada: number; sinComision: number; pendiente: number; cobrado: number; cubierto: number; saldo: number };
type LiqItem = { orderId: number; paymentId: number | null; fecha: string; cobrado: number; pct: number; comision: number; ajuste: boolean; folio: string | null; remitoNum: number | null; orderDate: string | null; customerName: string | null };
type Liquidacion = { id: number; periodo: string; total: number; cerradaAt: string; items: LiqItem[] };
export type ComisionesData = {
  hoy: string; mes: string;
  resumen: { habilitadasMes: number; pendientes: number; habilitadasTotal: number; liquidado: number; sinLiquidar: number };
  habilitadasPorMes?: Record<string, number>;
  clientes: Cliente[]; pedidos: Pedido[]; liquidaciones: Liquidacion[];
};

type Estado = { cls: "ok" | "par" | "no" | "line"; label: string };
const estadoPedido = (p: Pedido): Estado =>
  p.saldada ? { cls: "line", label: "Saldado" }
  : p.saldo <= 0 ? { cls: "ok", label: "Cobrado" }
  : p.cubierto > 0 ? { cls: "par", label: "Parcial" }
  : { cls: "no", label: "Sin cobrar" };

const Chip = ({ e }: { e: Estado }) => <span className={`vx-chip ${e.cls}`}>{e.cls !== "line" && <i />}{e.label}</span>;
/** Comisión del pedido: la devengada; para los saldados (esquema anterior, ya pagados por facturación) % × neto. */
const comisionDe = (p: Pedido) => (p.saldada && p.pct ? Math.round((p.pct / 100) * p.neto * 100) / 100 : p.devengada);
const gris = { color: "#8b8f88" };

/** Vista reutilizable: el vendedor la ve en su sesión; admin la abre por vendedor ("Vista del vendedor"). */
export function ComisionesVista({ data, isLoading, embed }: { data?: ComisionesData; isLoading: boolean; embed?: boolean }) {
  const [mes, setMes] = useState<string>(() => hoyAR().slice(0, 7));
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());
  const [liqAbierta, setLiqAbierta] = useState<number | null>(null);

  const mesActual = data?.mes ?? hoyAR().slice(0, 7);
  const pedidosMes = useMemo(() => (data?.pedidos ?? []).filter((p) => p.orderDate.startsWith(mes)), [data, mes]);

  // Clientes que pidieron en el mes, con sus pedidos
  const clientesMes = useMemo(() => {
    const m = new Map<number, { id: number; name: string; pedidos: Pedido[] }>();
    for (const p of pedidosMes) {
      const c = m.get(p.customerId) ?? { id: p.customerId, name: p.customerName, pedidos: [] };
      c.pedidos.push(p);
      m.set(p.customerId, c);
    }
    return Array.from(m.values()).map((c) => {
      const neto = c.pedidos.reduce((s, p) => s + p.neto, 0);
      const devengada = c.pedidos.reduce((s, p) => s + comisionDe(p), 0);
      const habilitada = c.pedidos.reduce((s, p) => s + p.habilitada, 0);
      const pendiente = c.pedidos.reduce((s, p) => s + p.pendiente, 0);
      const pcts = Array.from(new Set(c.pedidos.map((p) => p.pct).filter((x) => x != null)));
      const pctLabel = pcts.length === 1 ? `${pcts[0]} %` : pcts.length > 1 ? pcts.map((x) => `${x} %`).join(" / ") : "—";
      const saldados = c.pedidos.filter((p) => p.saldada).length;
      const estado: Estado = saldados === c.pedidos.length ? { cls: "line", label: "Saldado" }
        : c.pedidos.every((p) => p.saldada || p.saldo <= 0) ? { cls: "ok", label: "Cobrado" }
        : c.pedidos.some((p) => p.cubierto > 0) ? { cls: "par", label: "Parcial" }
        : { cls: "no", label: "Sin cobrar" };
      c.pedidos.sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.id - b.id);
      return { ...c, neto, devengada, habilitada, pendiente, pctLabel, estado };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [pedidosMes]);

  const tot = useMemo(() => clientesMes.reduce((a, c) => ({ n: a.n + c.pedidos.length, neto: a.neto + c.neto, dev: a.dev + c.devengada, hab: a.hab + c.habilitada }), { n: 0, neto: 0, dev: 0, hab: 0 }), [clientesMes]);

  // Habilitadas del mes: el servidor suma cobranzas del mes + lo saldado por facturación (esquema anterior) de pedidos del mes
  const saldadasMes = pedidosMes.filter((p) => p.saldada).reduce((s, p) => s + comisionDe(p), 0);
  const habilitadasMes = data?.habilitadasPorMes?.[mes] ?? (mes === mesActual ? data?.resumen.habilitadasMes ?? 0 : 0);
  const devengadasMes = pedidosMes.filter((p) => !p.saldada).reduce((s, p) => s + p.devengada, 0);
  const liqDelMes = data?.liquidaciones.find((l) => l.periodo === mes);
  const mesNombre = mesLabel(mes).split(" ")[0].toLowerCase();

  const toggle = (id: number) => setAbiertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (isLoading || !data) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}</div>;
  }

  return (
    <div className={`vx${embed ? " vx-embed" : ""}`}>
      <style>{VX_CSS}</style>
      <div className="vx-wrap">
        <div className="vx-top">
          <div>
            <h1 className="vx-title">Mis comisiones</h1>
            <div className="vx-subtitle">5 % los primeros 6 meses de cada cliente, 1 % después. Se habilitan cuando el cliente paga.</div>
          </div>
          <div className="vx-mes" data-testid="selector-mes">
            <button type="button" onClick={() => setMes(sumarMes(mes, -1))} title="Mes anterior"><ChevronLeft className="h-4 w-4" /></button>
            <span>{mesLabel(mes)}</span>
            <button type="button" onClick={() => setMes(sumarMes(mes, 1))} disabled={mes >= mesActual} style={{ opacity: mes >= mesActual ? .35 : 1 }} title="Mes siguiente"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="vx-kpis">
          <div className="vx-kpi main">
            <div className="lab">Habilitadas en {mesNombre}</div>
            <div className="val" data-testid="text-habilitadas-mes">{fmt(habilitadasMes)}</div>
            <div className="note">{liqDelMes ? `Mes cerrado el ${fmtFechaCorta(String(liqDelMes.cerradaAt).slice(0, 10))}` : saldadasMes > 0 ? "Incluye lo pagado por facturación (esquema anterior)" : "Por cobranzas del mes · se liquidan al cerrar el mes"}</div>
          </div>
          <div className="vx-kpi">
            <div className="lab">Devengadas en {mesNombre}</div>
            <div className="val">{fmt(devengadasMes)}</div>
            <div className="note">Por los pedidos que hiciste este mes</div>
          </div>
          <div className="vx-kpi">
            <div className="lab">Pendientes de cobro</div>
            <div className="val" data-testid="text-pendientes">{fmt(data.resumen.pendientes)}</div>
            <div className="note">De pedidos que el cliente todavía no pagó · no vencen</div>
          </div>
        </div>

        <div className="vx-card">
          <div className="vx-chead">
            <span className="t">Clientes que pidieron en {mesNombre}</span>
            <span className="n">{clientesMes.length} cliente{clientesMes.length !== 1 ? "s" : ""} · {tot.n} pedido{tot.n !== 1 ? "s" : ""}{clientesMes.length > 0 ? " · tocá un cliente para ver sus pedidos" : ""}</span>
          </div>
          {clientesMes.length === 0 ? (
            <div style={{ padding: "36px 22px", textAlign: "center", fontSize: 14, ...gris }}>Sin pedidos en {mesNombre}</div>
          ) : (
            <div className="vx-tblwrap">
              <table className="vx-tbl">
                <thead><tr>
                  <th className="l">Cliente</th><th className="vx-hide-m">Pedidos</th><th>Facturado</th><th className="vx-hide-m">%</th><th>Comisión</th><th>Habilitada</th><th className="l">Cobro</th>
                </tr></thead>
                <tbody>
                  {clientesMes.map((c) => {
                    const open = abiertos.has(c.id);
                    return (
                      <Fragment key={c.id}>
                        <tr className="click" onClick={() => toggle(c.id)} data-testid={`row-cliente-${c.id}`}>
                          <td className="l cli"><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{open ? <ChevronDown className="h-3.5 w-3.5" style={gris} /> : <ChevronRight className="h-3.5 w-3.5" style={gris} />}{c.name}</span></td>
                          <td className="vx-hide-m">{c.pedidos.length}</td>
                          <td>{fmt(c.neto)}</td>
                          <td className="vx-hide-m mut">{c.pctLabel}</td>
                          <td className="pos">{fmt(c.devengada)}</td>
                          <td className={c.habilitada > 0 ? "" : "mut"}>{fmt(c.habilitada)}</td>
                          <td className="l"><Chip e={c.estado} /></td>
                        </tr>
                        {open && c.pedidos.map((p) => (
                          <tr className="sub" key={p.id} data-testid={`row-pedido-${p.id}`}>
                            <td className="l">
                              {fmtDiaMes(p.orderDate)}
                              <Link href={`/vendedor/orders/${p.id}`} className="vx-mono" style={{ fontSize: 12, marginLeft: 8, ...gris }} onClick={(e: React.MouseEvent) => e.stopPropagation()}>{formatRemito(p)}</Link>
                              {p.sinComision > 0 && <span style={{ fontSize: 11, marginLeft: 8, ...gris }} title="Parte cubierta con retenciones: no comisiona">ret. {fmt(p.sinComision)}</span>}
                            </td>
                            <td className="vx-hide-m" />
                            <td>{fmt(p.neto)}</td>
                            <td className="vx-hide-m mut">{p.pct != null ? `${p.pct} %` : "—"}</td>
                            <td>{fmt(comisionDe(p))}</td>
                            <td className={p.habilitada > 0 ? "" : "mut"}>{fmt(p.habilitada)}</td>
                            <td className="l"><Chip e={estadoPedido(p)} /></td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot><tr>
                  <td className="l">Total</td><td className="vx-hide-m">{tot.n}</td><td>{fmt(tot.neto)}</td><td className="vx-hide-m" /><td className="pos">{fmt(tot.dev)}</td><td>{fmt(tot.hab)}</td><td />
                </tr></tfoot>
              </table>
            </div>
          )}
        </div>

        <div className="vx-card">
          <div className="vx-chead"><span className="t">Liquidaciones</span><span className="n">lo que ya se cerró</span></div>
          {!liqDelMes && mes === mesActual && (
            <div className="vx-row" style={{ cursor: "default" }}>
              <div className="main">{mesLabel(mes)}<div className="sub">en curso · se cierra al terminar el mes</div></div>
              <div className="amt vx-num" style={{ color: "#c08a1e", fontSize: 17 }}>{fmt(habilitadasMes)}</div>
            </div>
          )}
          {data.liquidaciones.length === 0 && !(mes === mesActual && !liqDelMes) && (
            <div style={{ padding: "28px 22px", textAlign: "center", fontSize: 14, ...gris }}>Todavía no hay liquidaciones cerradas</div>
          )}
          {data.liquidaciones.map((l) => (
            <Fragment key={l.id}>
              <button type="button" className="vx-row" onClick={() => setLiqAbierta(liqAbierta === l.id ? null : l.id)} data-testid={`card-liquidacion-${l.id}`}>
                {liqAbierta === l.id ? <ChevronDown className="h-4 w-4" style={gris} /> : <ChevronRight className="h-4 w-4" style={gris} />}
                <div className="main">{mesLabel(l.periodo)}<div className="sub">cerrada el {fmtFechaCorta(String(l.cerradaAt).slice(0, 10))} · {l.items.length} cobranza{l.items.length !== 1 ? "s" : ""}</div></div>
                <div className="amt vx-num" style={{ color: "#5f8020", fontSize: 17 }}>{fmt(l.total)}</div>
              </button>
              {liqAbierta === l.id && (
                <div className="vx-tblwrap" style={{ borderTop: "1px solid #f5f5f2", background: "#fbfaf7" }}>
                  {l.items.length === 0 ? <div style={{ padding: "16px 22px", fontSize: 13, ...gris }}>Sin cobranzas en este cierre.</div> : (
                    <table className="vx-tbl" style={{ marginTop: 12 }}>
                      <thead><tr><th className="l">Fecha cobro</th><th className="l">Cliente</th><th className="l vx-hide-m">Remito</th><th>Cobrado</th><th className="vx-hide-m">%</th><th>Comisión</th></tr></thead>
                      <tbody>
                        {l.items.map((it, i) => (
                          <tr key={i}>
                            <td className="l">{fmtFechaCorta(it.fecha)}{it.ajuste && <span className="vx-chip line" style={{ marginLeft: 6 }}>ajuste</span>}{!it.ajuste && it.paymentId == null && <span className="vx-chip line" style={{ marginLeft: 6 }} title="Comisionado por facturación (esquema anterior)">facturado</span>}</td>
                            <td className="l">{it.customerName ?? "—"}</td>
                            <td className="l vx-hide-m vx-mono" style={{ fontSize: 12 }}>{formatRemito(it)}</td>
                            <td>{fmt(it.cobrado)}</td>
                            <td className="vx-hide-m mut">{it.pct} %</td>
                            <td className="pos">{fmt(it.comision)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </Fragment>
          ))}
        </div>
        <div className="vx-note">Facturado y comisión sobre el neto sin IVA. Las retenciones no comisionan.</div>
      </div>
    </div>
  );
}

export default function VendedorComisiones() {
  const { data, isLoading } = useQuery<ComisionesData>({
    queryKey: ["/api/vendedor/comisiones"],
    queryFn: () => fetchJson<ComisionesData>("/api/vendedor/comisiones"),
    staleTime: 30_000,
  });
  return (
    <VendedorLayout title="Comisiones">
      {isLoading || !data ? (
        <div className="vx"><style>{VX_CSS}</style><div className="vx-wrap"><ComisionesVista data={data} isLoading={isLoading} /></div></div>
      ) : (
        <ComisionesVista data={data} isLoading={false} />
      )}
    </VendedorLayout>
  );
}
