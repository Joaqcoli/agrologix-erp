/**
 * A-01 · "Bot por cliente": un renglón por cliente con lo que leyó el bot de WhatsApp contra lo que quedó
 * cargado, y el interruptor "Bot activo" para encender/apagar el bot por cliente desde acá.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { fmtFechaHoraAR } from "@/lib/format";

type Det = { fecha: string; folio: string | null; raw: string; bot: string; erp: string; duda: boolean };
type Row = { customerId: number; cliente: string; botActivo: boolean; pedidos: number; renglones: number; comparables: number; errores: number; dudas: number; pct: number | null; ultimoPedido: string | null; detalle: Det[] };
type Data = { resumen: { dias: number; pedidos: number; renglones: number; pct: number | null }; clientes: Row[] };

const pctClass = (p: number | null) => p == null ? "text-muted-foreground" : p >= 95 ? "text-green-700 font-semibold" : p >= 90 ? "text-yellow-700 font-semibold" : "text-red-700 font-semibold";

export default function BotClientesPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState<number | null>(null);
  const { data, isLoading, error } = useQuery<Data>({ queryKey: ["/api/bot-clientes"], queryFn: async () => {
    const r = await fetch("/api/bot-clientes", { credentials: "include" });
    if (!r.ok) throw new Error((await r.json()).error ?? "Error");
    return r.json();
  } });
  const toggle = useMutation({
    mutationFn: ({ id, botActivo }: { id: number; botActivo: boolean }) => apiRequest("PATCH", `/api/customers/${id}`, { botActivo }),
    onSuccess: (_r, v) => { queryClient.invalidateQueries({ queryKey: ["/api/bot-clientes"] }); queryClient.invalidateQueries({ queryKey: ["/api/customers"] }); toast({ title: v.botActivo ? "Bot activado" : "Bot apagado" }); },
    onError: (e: any) => toast({ title: "No se pudo cambiar", description: e.message, variant: "destructive" }),
  });

  return (
    <Layout title="Bot por cliente">
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Bot por cliente</h1>
          <p className="text-sm text-muted-foreground">Lo que leyó el bot de WhatsApp contra lo que quedó cargado. "Renglón con error" = producto, unidad o cantidad distintos. Activá el bot por cliente desde el interruptor.</p>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Calculando...</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {data && (
          <>
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4 grid grid-cols-3 gap-3 text-sm">
                <div><div className="text-xs text-muted-foreground">Pedidos leídos · {data.resumen.dias} días</div><div className="text-2xl">{data.resumen.pedidos}</div></div>
                <div><div className="text-xs text-muted-foreground">Renglones leídos · {data.resumen.dias} días</div><div className="text-2xl">{data.resumen.renglones}</div></div>
                <div><div className="text-xs text-muted-foreground">% acierto · {data.resumen.dias} días</div><div className={`text-2xl ${pctClass(data.resumen.pct)}`}>{data.resumen.pct == null ? "—" : `${data.resumen.pct} %`}</div></div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0 overflow-x-auto">
                {data.clientes.length === 0 ? <p className="text-sm text-muted-foreground p-4">El bot todavía no leyó ningún pedido.</p> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2 px-3">Cliente</th><th className="py-2 px-3">Bot activo</th><th className="py-2 px-3">Pedidos leídos</th><th className="py-2 px-3">Renglones leídos</th><th className="py-2 px-3">Con error</th><th className="py-2 px-3">Dudas</th><th className="py-2 px-3">% acierto</th><th className="py-2 px-3">Último pedido</th>
                    </tr></thead>
                    <tbody>
                      {data.clientes.map((c) => (
                        <>
                          <tr key={c.customerId} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => setOpen(open === c.customerId ? null : c.customerId)} data-testid={`bot-row-${c.customerId}`}>
                            <td className="py-2 px-3 font-medium">{c.cliente}</td>
                            <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                              <Switch checked={c.botActivo} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate({ id: c.customerId, botActivo: v })} data-testid={`switch-bot-${c.customerId}`} />
                            </td>
                            <td className="py-2 px-3">{c.pedidos}</td>
                            <td className="py-2 px-3">{c.renglones}</td>
                            <td className="py-2 px-3">{c.errores}{c.comparables < c.renglones ? <span className="text-xs text-muted-foreground"> / {c.comparables} comparables</span> : null}</td>
                            <td className="py-2 px-3">{c.dudas}</td>
                            <td className={`py-2 px-3 ${pctClass(c.pct)}`}>{c.pct == null ? "—" : `${c.pct} %`}</td>
                            <td className="py-2 px-3 text-xs text-muted-foreground font-mono">{c.ultimoPedido ?? ""}</td>
                          </tr>
                          {open === c.customerId && (
                            <tr key={`${c.customerId}-det`} className="border-b bg-muted/20">
                              <td colSpan={8} className="p-3">
                                {c.detalle.length === 0 ? <p className="text-xs text-muted-foreground">Sin renglones con error{c.comparables === 0 ? " (todavía no hay pedido cargado para comparar)" : ""}.</p> : (
                                  <table className="w-full text-xs">
                                    <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">Cuándo</th><th className="py-1 pr-3">Pedido</th><th className="py-1 pr-3">El cliente escribió</th><th className="py-1 pr-3">El bot leyó</th><th className="py-1 pr-3">Quedó cargado</th></tr></thead>
                                    <tbody>
                                      {c.detalle.map((d, i) => (
                                        <tr key={i} className="border-t border-border/50">
                                          <td className="py-1 pr-3 font-mono whitespace-nowrap">{d.fecha}</td>
                                          <td className="py-1 pr-3">{d.folio ?? ""}</td>
                                          <td className="py-1 pr-3 font-mono">{d.raw}</td>
                                          <td className="py-1 pr-3">{d.bot} {d.duda && <Badge variant="outline" className="text-[9px] py-0 text-yellow-700 border-yellow-500/40">duda</Badge>}</td>
                                          <td className="py-1 pr-3">{d.erp}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
            <p className="text-[11px] text-muted-foreground">Tabla: últimos 60 días. Último pedido: hora de Argentina. {fmtFechaHoraAR(new Date()) && ""}</p>
          </>
        )}
      </div>
    </Layout>
  );
}
