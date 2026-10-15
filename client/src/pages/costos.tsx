/**
 * A-15 · Costos de automatización (solo admin): Claude + WhatsApp + fijos, mes actual y anterior, calculados desde
 * los datos propios × tarifas editables. Saldo de YCloud por API con aviso si baja del umbral.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Coins, AlertTriangle, Save } from "lucide-react";

type Concepto = { clave: string; label: string; cantidad: number; unidad: string; costo: number; nota?: string };
type Mes = { mes: string; pedidos: number; costoTotal: number; costoPorPedido: number | null; conceptos: Concepto[]; porCliente: { customerId: number | null; nombre: string; tokens: number; mensajes: number; costo: number }[]; advertencias: string[] };
type Resumen = { actual: Mes; anterior: Mes; saldo: { amount: number; currency: string } | null; saldoError: string | null; umbralSaldo: number; saldoBajo: boolean; anthropicReal: { usd: number; detalle: string } | null; anthropicError: string | null; anthropicDisponible: boolean };
type Rate = { key: string; label: string; value: string; unit: string; validFrom: string | null };

const usd = (n: number | null | undefined, d = 2) => n == null ? "—" : `USD ${n.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const mesLindo = (m: string) => { const [y, mm] = m.split("-"); return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" }); };

function TablaMes({ m }: { m: Mes }) {
  const claude = m.conceptos.filter((c) => c.clave.startsWith("claude")).reduce((s, c) => s + c.costo, 0);
  const wa = m.conceptos.filter((c) => c.clave.startsWith("wa_")).reduce((s, c) => s + c.costo, 0);
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold capitalize">{mesLindo(m.mes)}</p>
          <p className="text-lg font-bold">{usd(m.costoTotal)}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border p-2"><p className="text-[11px] text-muted-foreground uppercase">Pedidos procesados</p><p className="text-lg font-semibold">{m.pedidos}</p></div>
          <div className="rounded-md border p-2"><p className="text-[11px] text-muted-foreground uppercase">Costo por pedido</p><p className="text-lg font-semibold">{usd(m.costoPorPedido, 3)}</p></div>
          <div className="rounded-md border p-2"><p className="text-[11px] text-muted-foreground uppercase">Claude / WhatsApp</p><p className="text-sm font-semibold">{usd(claude)} / {usd(wa)}</p></div>
        </div>
        <table className="w-full text-xs">
          <thead><tr className="text-muted-foreground text-left"><th className="py-1">Concepto</th><th className="text-right">Cantidad</th><th className="text-right">Costo</th></tr></thead>
          <tbody>
            {m.conceptos.map((c) => (
              <tr key={c.clave} className="border-t border-border">
                <td className="py-1.5">{c.label}{c.nota && <div className="text-[10px] text-muted-foreground">{c.nota}</div>}</td>
                <td className="text-right whitespace-nowrap">{c.cantidad.toLocaleString("es-AR")} {c.unidad}</td>
                <td className="text-right font-medium whitespace-nowrap">{usd(c.costo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {m.advertencias.map((a, i) => <p key={i} className="text-[11px] text-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1">{a}</p>)}
        {m.porCliente.length > 0 && (
          <details>
            <summary className="text-xs font-semibold cursor-pointer">Por cliente ({m.porCliente.length})</summary>
            <table className="w-full text-xs mt-2">
              <thead><tr className="text-muted-foreground text-left"><th className="py-1">Cliente</th><th className="text-right">Tokens</th><th className="text-right">Mensajes</th><th className="text-right">Costo</th></tr></thead>
              <tbody>
                {m.porCliente.map((c) => (
                  <tr key={c.customerId ?? "none"} className="border-t border-border">
                    <td className="py-1">{c.nombre}</td>
                    <td className="text-right">{c.tokens.toLocaleString("es-AR")}</td>
                    <td className="text-right">{c.mensajes}</td>
                    <td className="text-right font-medium">{usd(c.costo, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function Tarifas() {
  const { toast } = useToast();
  const { data = [] } = useQuery<Rate[]>({ queryKey: ["/api/cost-rates"] });
  const [edit, setEdit] = useState<Record<string, { value: string; validFrom: string }>>({});
  const save = useMutation({
    mutationFn: ({ key, value, validFrom }: { key: string; value: number; validFrom: string | null }) => apiRequest("PUT", `/api/cost-rates/${key}`, { value, validFrom }),
    onSuccess: (_r, v) => { queryClient.invalidateQueries({ queryKey: ["/api/cost-rates"] }); queryClient.invalidateQueries({ queryKey: ["/api/costos"] }); setEdit((e) => { const n = { ...e }; delete n[v.key]; return n; }); toast({ title: "Tarifa guardada" }); },
    onError: (e: any) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <p className="font-semibold">Precios y tarifas</p>
        <p className="text-[11px] text-muted-foreground">En USD. Claude por millón de tokens; WhatsApp por mensaje (tarifa Argentina); fijos por mes. Cuando YCloud informa el precio exacto de un mensaje, se usa ese y no la tarifa.</p>
        <table className="w-full text-xs">
          <thead><tr className="text-muted-foreground text-left"><th className="py-1">Concepto</th><th>Valor</th><th>Unidad</th><th>Vigente desde</th><th></th></tr></thead>
          <tbody>
            {data.map((r) => {
              const e = edit[r.key] ?? { value: String(parseFloat(r.value)), validFrom: r.validFrom ?? "" };
              const dirty = !!edit[r.key];
              return (
                <tr key={r.key} className="border-t border-border">
                  <td className="py-1.5 pr-2">{r.label}</td>
                  <td><Input className="h-7 w-28 text-xs" type="number" step="any" value={e.value} onChange={(ev) => setEdit({ ...edit, [r.key]: { ...e, value: ev.target.value } })} data-testid={`rate-${r.key}`} /></td>
                  <td className="text-muted-foreground px-2">{r.unit}</td>
                  <td><Input className="h-7 w-36 text-xs" type="date" value={e.validFrom} onChange={(ev) => setEdit({ ...edit, [r.key]: { ...e, validFrom: ev.target.value } })} /></td>
                  <td><Button size="sm" variant="outline" className="h-7 text-xs" disabled={!dirty || save.isPending} onClick={() => save.mutate({ key: r.key, value: parseFloat(e.value) || 0, validFrom: e.validFrom || null })}><Save className="h-3 w-3 mr-1" /> Guardar</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export default function CostosPage() {
  const { data, isLoading, error } = useQuery<Resumen>({ queryKey: ["/api/costos"], refetchInterval: 5 * 60_000 });
  return (
    <Layout title="Costos de automatización">
      <div className="p-4 sm:p-6 space-y-4 max-w-6xl">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Coins className="h-5 w-5" /> Costos de automatización</h1>
          <p className="text-sm text-muted-foreground mt-1">Calculado desde los datos propios: tokens de Claude por pedido y por llamada del bot, mensajes de WhatsApp por tipo, y fijos mensuales, a las tarifas de abajo.</p>
        </div>
        {isLoading && <p className="text-sm text-muted-foreground">Calculando…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Costo por pedido (mes)</p><p className="text-xl font-bold">{usd(data.actual.costoPorPedido, 3)}</p></CardContent></Card>
              <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Pedidos procesados</p><p className="text-xl font-bold">{data.actual.pedidos}</p></CardContent></Card>
              <Card className={data.saldoBajo ? "border-destructive" : ""}><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Saldo YCloud</p><p className={`text-xl font-bold ${data.saldoBajo ? "text-destructive" : ""}`}>{data.saldo ? `${data.saldo.currency} ${data.saldo.amount.toFixed(2)}` : "—"}</p>{data.saldoError && <p className="text-[10px] text-destructive">{data.saldoError}</p>}{data.saldoBajo && <p className="text-[11px] text-destructive flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Por debajo de USD {data.umbralSaldo}: recargar</p>}</CardContent></Card>
              <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground uppercase">Anthropic real (mes)</p><p className="text-xl font-bold">{data.anthropicReal ? usd(data.anthropicReal.usd) : "—"}</p><p className="text-[10px] text-muted-foreground">{data.anthropicDisponible ? (data.anthropicError ?? data.anthropicReal?.detalle ?? "") : "Sin clave de administración de Anthropic: solo calculado"}</p></CardContent></Card>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <TablaMes m={data.actual} />
              <TablaMes m={data.anterior} />
            </div>
            <Tarifas />
          </>
        )}
      </div>
    </Layout>
  );
}
