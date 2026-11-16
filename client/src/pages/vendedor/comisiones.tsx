// Comisiones del vendedor (16/11/2026): devengada por pedido al crearse (5 % primeros 6 meses del cliente,
// después 1 %), habilitada a medida que entra la cobranza, liquidada por mes calendario de cobranza.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { VendedorLayout } from "./layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet, Clock, Users, FileText, Archive, ChevronDown, ChevronRight } from "lucide-react";
import { fmtPesos } from "@/lib/format";

const fmt = fmtPesos;
const fmtFecha = (s: string | null | undefined) => {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const mesLabel = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${MESES[m - 1] ?? ym} ${y}`; };

type Cliente = { id: number; name: string; alta: string | null; fechaBaja: string | null; pctVigente: number; pedidos: number; facturado: number; cobrado: number; saldo: number; habilitada: number; pendiente: number };
type Pedido = { id: number; folio: string; remitoNum: number | null; orderDate: string; customerId: number; customerName: string; neto: number; totalConIva: number; pct: number | null; saldada: boolean; devengada: number; habilitada: number; sinComision: number; pendiente: number; cobrado: number; cubierto: number; saldo: number };
type LiqItem = { orderId: number; paymentId: number | null; fecha: string; cobrado: number; pct: number; comision: number; ajuste: boolean; folio: string | null; remitoNum: number | null; orderDate: string | null; customerName: string | null };
type Liquidacion = { id: number; periodo: string; total: number; cerradaAt: string; items: LiqItem[] };
export type ComisionesData = {
  hoy: string; mes: string;
  resumen: { habilitadasMes: number; pendientes: number; habilitadasTotal: number; liquidado: number; sinLiquidar: number };
  clientes: Cliente[]; pedidos: Pedido[]; liquidaciones: Liquidacion[];
};

const remitoDe = (p: { remitoNum: number | null; folio: string | null }) =>
  p.remitoNum != null ? `VA-${String(p.remitoNum).padStart(6, "0")}` : (p.folio ?? "—");

type Tab = "resumen" | "clientes" | "pedidos" | "liquidaciones";

/** Vista reutilizable: el vendedor la ve en su sesión; admin la puede abrir por vendedor. */
export function ComisionesVista({ data, isLoading }: { data?: ComisionesData; isLoading: boolean }) {
  const [tab, setTab] = useState<Tab>("resumen");
  const [mesPedidos, setMesPedidos] = useState<string>(() => data?.mes ?? new Date().toISOString().slice(0, 7));
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);

  const pedidosVisibles = useMemo(() => {
    const all = data?.pedidos ?? [];
    return soloPendientes ? all.filter((p) => p.pendiente > 0) : all.filter((p) => p.orderDate.startsWith(mesPedidos));
  }, [data, mesPedidos, soloPendientes]);
  const totPed = useMemo(() => pedidosVisibles.reduce((a, p) => ({ neto: a.neto + p.neto, hab: a.hab + p.habilitada, pen: a.pen + p.pendiente }), { neto: 0, hab: 0, pen: 0 }), [pedidosVisibles]);
  const totCli = useMemo(() => (data?.clientes ?? []).reduce((a, c) => ({ fac: a.fac + c.facturado, cob: a.cob + c.cobrado, sal: a.sal + c.saldo, hab: a.hab + c.habilitada, pen: a.pen + c.pendiente }), { fac: 0, cob: 0, sal: 0, hab: 0, pen: 0 }), [data]);

  if (isLoading || !data) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>;
  }

  const TABS: { v: Tab; label: string; icon: any }[] = [
    { v: "resumen", label: "Resumen", icon: Wallet },
    { v: "clientes", label: "Por cliente", icon: Users },
    { v: "pedidos", label: "Por pedido", icon: FileText },
    { v: "liquidaciones", label: "Liquidaciones", icon: Archive },
  ];
  const th = "text-left pb-1.5 text-xs text-muted-foreground font-medium whitespace-nowrap";
  const thR = th + " text-right";
  const td = "py-1.5 pr-3 text-sm";
  const tdR = "py-1.5 pl-3 text-right text-sm tabular-nums";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button key={t.v} size="sm" variant={tab === t.v ? "default" : "outline"} onClick={() => setTab(t.v)} data-testid={`tab-comisiones-${t.v}`}>
            <t.icon className="h-3.5 w-3.5 mr-1.5" />{t.label}
          </Button>
        ))}
      </div>

      {tab === "resumen" && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Comisiones habilitadas este mes</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1" data-testid="text-habilitadas-mes">{fmt(data.resumen.habilitadasMes)}</p>
                <p className="text-xs text-muted-foreground mt-1">Cobranzas de {mesLabel(data.mes).toLowerCase()}. Se liquidan al cierre del mes.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Comisiones pendientes de cobranza</p>
                <p className="text-2xl font-bold text-foreground mt-1" data-testid="text-pendientes">{fmt(data.resumen.pendientes)}</p>
                <p className="text-xs text-muted-foreground mt-1">Devengadas en pedidos que el cliente todavía no pagó. No vencen: se habilitan cuando entra el pago.</p>
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Habilitadas en total</p>
              <p className="text-base font-semibold tabular-nums mt-0.5">{fmt(data.resumen.habilitadasTotal)}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Ya liquidadas (cierres)</p>
              <p className="text-base font-semibold tabular-nums mt-0.5">{fmt(data.resumen.liquidado)}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Habilitadas sin liquidar</p>
              <p className="text-base font-semibold tabular-nums mt-0.5">{fmt(data.resumen.sinLiquidar)}</p>
            </div>
          </div>
          <Card>
            <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Cómo se calcula</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1 pb-4">
              <p>Cada pedido fija su % al crearse: <b>5 %</b> durante los primeros 6 meses desde el alta del cliente (su primer pedido) y <b>1 %</b> después. La comisión es sobre el neto sin IVA.</p>
              <p>Se habilita cuando entra la cobranza, en proporción a lo cobrado. Las retenciones no comisionan. Al cierre de cada mes se liquida todo lo habilitado por las cobranzas de ese mes.</p>
            </CardContent>
          </Card>
        </>
      )}

      {tab === "clientes" && (
        <Card>
          <CardContent className="p-4 overflow-x-auto">
            {data.clientes.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">Sin clientes asignados</p> : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border">
                  <th className={th}>Cliente</th><th className={th}>Alta</th><th className={thR}>% vigente</th><th className={th}>Pasa al 1 %</th>
                  <th className={thR}>Facturado</th><th className={thR}>Cobrado</th><th className={thR}>Saldo</th><th className={thR}>Com. habilitada</th><th className={thR}>Com. pendiente</th>
                </tr></thead>
                <tbody>
                  {data.clientes.map((c, i) => (
                    <tr key={c.id} className={`border-b border-border/50 last:border-0 ${i % 2 ? "bg-muted/20" : ""}`} data-testid={`row-cliente-${c.id}`}>
                      <td className={td + " font-medium"}>{c.name}</td>
                      <td className={td + " whitespace-nowrap"}>{fmtFecha(c.alta)}</td>
                      <td className={tdR}><Badge variant={c.pctVigente >= 5 ? "default" : "secondary"} className="text-[10px]">{c.alta ? `${c.pctVigente} %` : "sin pedidos"}</Badge></td>
                      <td className={td + " whitespace-nowrap text-muted-foreground"}>{fmtFecha(c.fechaBaja)}</td>
                      <td className={tdR}>{fmt(c.facturado)}</td>
                      <td className={tdR}>{fmt(c.cobrado)}</td>
                      <td className={tdR + (c.saldo > 0 ? " text-amber-600 font-medium" : "")}>{fmt(c.saldo)}</td>
                      <td className={tdR + " text-green-600 font-medium"}>{fmt(c.habilitada)}</td>
                      <td className={tdR}>{fmt(c.pendiente)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-border font-semibold">
                  <td className={td} colSpan={4}>Total</td>
                  <td className={tdR}>{fmt(totCli.fac)}</td><td className={tdR}>{fmt(totCli.cob)}</td><td className={tdR}>{fmt(totCli.sal)}</td>
                  <td className={tdR + " text-green-600"}>{fmt(totCli.hab)}</td><td className={tdR}>{fmt(totCli.pen)}</td>
                </tr></tfoot>
              </table>
            )}
            <p className="text-xs text-muted-foreground mt-3">Facturado, cobrado y saldo con IVA (como la cuenta corriente). Las sedes se cobran por la cuenta del padre.</p>
          </CardContent>
        </Card>
      )}

      {tab === "pedidos" && (
        <Card>
          <CardContent className="p-4 space-y-3 overflow-x-auto">
            <div className="flex flex-wrap items-center gap-3">
              <input type="month" value={mesPedidos} disabled={soloPendientes} onChange={(e) => setMesPedidos(e.target.value || data.mes)}
                className="h-8 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50" data-testid="input-mes-pedidos" />
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} data-testid="check-solo-pendientes" />
                Solo pedidos con comisión pendiente (todos los meses)
              </label>
            </div>
            {pedidosVisibles.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">Sin pedidos</p> : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border">
                  <th className={th}>Fecha</th><th className={th}>Cliente</th><th className={th}>Remito</th><th className={thR}>Monto neto</th><th className={thR}>%</th>
                  <th className={thR}>Com. habilitada</th><th className={thR}>Com. pendiente</th><th className={th}>Cobranza</th>
                </tr></thead>
                <tbody>
                  {pedidosVisibles.map((p, i) => {
                    const estado = p.saldada ? { l: "Saldado", v: "outline" as const }
                      : p.saldo <= 0 ? { l: "Cobrado", v: "default" as const }
                      : p.cubierto > 0 ? { l: `Parcial ${fmt(p.cubierto)} de ${fmt(p.totalConIva)}`, v: "secondary" as const }
                      : { l: "Sin cobrar", v: "secondary" as const };
                    return (
                      <tr key={p.id} className={`border-b border-border/50 last:border-0 ${i % 2 ? "bg-muted/20" : ""}`} data-testid={`row-pedido-${p.id}`}>
                        <td className={td + " whitespace-nowrap"}>{fmtFecha(p.orderDate)}</td>
                        <td className={td + " font-medium"}><Link href={`/vendedor/orders/${p.id}`}><a className="hover:underline">{p.customerName}</a></Link></td>
                        <td className={td + " font-mono text-xs"}>{remitoDe(p)}</td>
                        <td className={tdR}>{fmt(p.neto)}</td>
                        <td className={tdR + " text-muted-foreground"}>{p.pct != null ? `${p.pct} %` : "—"}</td>
                        <td className={tdR + " text-green-600 font-medium"}>{fmt(p.habilitada)}</td>
                        <td className={tdR}>{fmt(p.pendiente)}</td>
                        <td className={td}>
                          <Badge variant={estado.v} className="text-[10px] whitespace-nowrap" title={p.saldada ? "Comisionado por facturación antes del esquema nuevo" : undefined}>{estado.l}</Badge>
                          {p.sinComision > 0 && <span className="text-[10px] text-muted-foreground ml-1" title="Parte cubierta con retenciones: no comisiona">ret. {fmt(p.sinComision)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr className="border-t-2 border-border font-semibold">
                  <td className={td} colSpan={3}>Total</td><td className={tdR}>{fmt(totPed.neto)}</td><td />
                  <td className={tdR + " text-green-600"}>{fmt(totPed.hab)}</td><td className={tdR}>{fmt(totPed.pen)}</td><td />
                </tr></tfoot>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "liquidaciones" && (
        <div className="space-y-3">
          {data.liquidaciones.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Todavía no hay liquidaciones cerradas</CardContent></Card>
          ) : data.liquidaciones.map((l) => (
            <Card key={l.id} data-testid={`card-liquidacion-${l.id}`}>
              <button type="button" className="w-full text-left p-4 flex items-center justify-between gap-3" onClick={() => setAbierta(abierta === l.id ? null : l.id)}>
                <div className="flex items-center gap-2">
                  {abierta === l.id ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="font-semibold">{mesLabel(l.periodo)}</span>
                  <span className="text-xs text-muted-foreground">cerrada el {fmtFecha(String(l.cerradaAt).slice(0, 10))} · {l.items.length} cobranza{l.items.length !== 1 ? "s" : ""}</span>
                </div>
                <span className="text-base font-bold text-green-600 tabular-nums">{fmt(l.total)}</span>
              </button>
              {abierta === l.id && (
                <CardContent className="pt-0 pb-4 overflow-x-auto">
                  {l.items.length === 0 ? <p className="text-sm text-muted-foreground">Sin cobranzas en este cierre.</p> : (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-border">
                        <th className={th}>Fecha cobro</th><th className={th}>Cliente</th><th className={th}>Remito</th><th className={th}>Fecha pedido</th><th className={thR}>Cobrado</th><th className={thR}>%</th><th className={thR}>Comisión</th>
                      </tr></thead>
                      <tbody>
                        {l.items.map((it, i) => (
                          <tr key={i} className={`border-b border-border/50 last:border-0 ${i % 2 ? "bg-muted/20" : ""}`}>
                            <td className={td + " whitespace-nowrap"}>{fmtFecha(it.fecha)}{it.ajuste && <Badge variant="outline" className="text-[10px] ml-1">ajuste</Badge>}</td>
                            <td className={td}>{it.customerName ?? "—"}</td>
                            <td className={td + " font-mono text-xs"}>{remitoDe(it)}</td>
                            <td className={td + " whitespace-nowrap text-muted-foreground"}>{fmtFecha(it.orderDate)}</td>
                            <td className={tdR}>{fmt(it.cobrado)}</td>
                            <td className={tdR + " text-muted-foreground"}>{it.pct} %</td>
                            <td className={tdR + " font-medium"}>{fmt(it.comision)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VendedorComisiones() {
  const { data, isLoading } = useQuery<ComisionesData>({
    queryKey: ["/api/vendedor/comisiones"],
    queryFn: () => fetch("/api/vendedor/comisiones").then((r) => r.json()),
    staleTime: 30_000,
  });
  return (
    <VendedorLayout title="Comisiones">
      <div className="p-6 space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Mis Comisiones</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Devengadas por pedido, habilitadas por cobranza, liquidadas por mes</p>
        </div>
        <ComisionesVista data={data} isLoading={isLoading} />
      </div>
    </VendedorLayout>
  );
}
