/**
 * A-01 · "Sombra WhatsApp": por día, lo que habría cargado el agente (order_intake_logs, source whatsapp)
 * contra el pedido que se cargó a mano para el mismo cliente y fecha de entrega. En modo ACTIVO compara
 * contra las líneas finales del pedido creado por el bot. Es el número para decidir el pase a ACTIVO (≥95 %).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

type Report = {
  dias: { dia: string; mensajes: number; conPedido: number; sinPedido: number; lineasErp: number; iguales: number; pct: number | null; lineasIa: number; dudas: number; noIdentificados: number }[];
  totales: { mensajes: number; conPedido: number; sinPedido: number; lineasErp: number; iguales: number; pct: number | null; lineasIa: number; dudas: number; noIdentificados: number };
  peores: { logId: number; dia: string; cliente: string; folio: string | null; fecha: string | null; lineasErp: number; iguales: number; pct: number; dudas: number; diff: string[] }[];
  noIdentificados: { id: number; dia: string; phone: string; profileName: string | null; texto: string; status: string; reason: string | null }[];
  clientes: { customerId: number; cliente: string; botActivo: boolean; mensajes: number; conPedido: number; lineasErp: number; iguales: number; pct: number | null; lineasIa: number; dudas: number }[];
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function SombraPage() {
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 13); return iso(d); });
  const [to, setTo] = useState(() => iso(new Date()));
  const [open, setOpen] = useState<number | null>(null);
  const { data, isLoading, error } = useQuery<Report>({ queryKey: ["/api/sombra", from, to], queryFn: async () => {
    const r = await fetch(`/api/sombra?from=${from}&to=${to}`, { credentials: "include" });
    if (!r.ok) throw new Error((await r.json()).error ?? "Error");
    return r.json();
  } });
  const pctClass = (p: number | null) => p == null ? "" : p >= 95 ? "text-green-700 font-semibold" : p >= 90 ? "text-yellow-700 font-semibold" : "text-red-700 font-semibold";

  return (
    <Layout title="Sombra WhatsApp">
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Sombra WhatsApp</h1>
            <p className="text-sm text-muted-foreground">Lo que habría cargado el agente vs. el pedido cargado a mano (mismo cliente y fecha de entrega). Se pasa a ACTIVO con ≥ 95 % sostenido; se apaga si baja de 90 %.</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded-md px-2 py-1" />
            <span>→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded-md px-2 py-1" />
          </div>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Calculando...</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {data && (
          <>
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <div><div className="text-xs text-muted-foreground">Líneas iguales</div><div className={`text-2xl ${pctClass(data.totales.pct)}`}>{data.totales.pct == null ? "—" : `${data.totales.pct} %`}</div><div className="text-xs text-muted-foreground">{data.totales.iguales} de {data.totales.lineasErp}</div></div>
                <div><div className="text-xs text-muted-foreground">Mensajes</div><div className="text-2xl">{data.totales.mensajes}</div><div className="text-xs text-muted-foreground">{data.totales.conPedido} con pedido · {data.totales.sinPedido} sin pedido</div></div>
                <div><div className="text-xs text-muted-foreground">Dudas</div><div className="text-2xl">{data.totales.dudas}</div><div className="text-xs text-muted-foreground">{data.totales.lineasIa ? Math.round(1000 * data.totales.dudas / data.totales.lineasIa) / 10 : 0} % de {data.totales.lineasIa} líneas IA</div></div>
                <div><div className="text-xs text-muted-foreground">No identificados</div><div className="text-2xl">{data.totales.noIdentificados}</div><div className="text-xs text-muted-foreground"><Link href="/wa-pendientes" className="underline">Números por asignar</Link></div></div>
                <div><div className="text-xs text-muted-foreground">Días</div><div className="text-2xl">{data.dias.length}</div></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold">Por día</CardTitle></CardHeader>
              <CardContent className="pb-4 overflow-x-auto">
                {data.dias.length === 0 ? <p className="text-sm text-muted-foreground">Sin mensajes del agente en el período.</p> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted-foreground border-b"><th className="py-1 pr-3">Día</th><th className="py-1 pr-3">Mensajes</th><th className="py-1 pr-3">Con pedido</th><th className="py-1 pr-3">Sin pedido</th><th className="py-1 pr-3">Líneas ERP</th><th className="py-1 pr-3">Iguales</th><th className="py-1 pr-3">%</th><th className="py-1 pr-3">Dudas</th><th className="py-1 pr-3">No identif.</th></tr></thead>
                    <tbody>
                      {data.dias.map((d) => (
                        <tr key={d.dia} className="border-b last:border-0">
                          <td className="py-1 pr-3 font-mono">{d.dia}</td><td className="py-1 pr-3">{d.mensajes}</td><td className="py-1 pr-3">{d.conPedido}</td><td className="py-1 pr-3">{d.sinPedido}</td>
                          <td className="py-1 pr-3">{d.lineasErp}</td><td className="py-1 pr-3">{d.iguales}</td><td className={`py-1 pr-3 ${pctClass(d.pct)}`}>{d.pct == null ? "—" : `${d.pct} %`}</td><td className="py-1 pr-3">{d.dudas}</td><td className="py-1 pr-3">{d.noIdentificados}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold">Por cliente (para decidir a quién activar)</CardTitle></CardHeader>
              <CardContent className="pb-4 overflow-x-auto">
                {data.clientes.length === 0 ? <p className="text-sm text-muted-foreground">Sin datos todavía.</p> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted-foreground border-b"><th className="py-1 pr-3">Cliente</th><th className="py-1 pr-3">Bot</th><th className="py-1 pr-3">Mensajes</th><th className="py-1 pr-3">Con pedido</th><th className="py-1 pr-3">Iguales</th><th className="py-1 pr-3">%</th><th className="py-1 pr-3">Dudas</th></tr></thead>
                    <tbody>
                      {data.clientes.map((c) => (
                        <tr key={c.customerId} className="border-b last:border-0">
                          <td className="py-1 pr-3"><Link href="/customers" className="hover:underline">{c.cliente}</Link></td>
                          <td className="py-1 pr-3">{c.botActivo ? <Badge variant="default" className="text-[10px]">activo</Badge> : <span className="text-xs text-muted-foreground">sombra</span>}</td>
                          <td className="py-1 pr-3">{c.mensajes}</td><td className="py-1 pr-3">{c.conPedido}</td><td className="py-1 pr-3">{c.iguales}/{c.lineasErp}</td>
                          <td className={`py-1 pr-3 ${pctClass(c.pct)}`}>{c.pct == null ? "—" : `${c.pct} %`}</td>
                          <td className="py-1 pr-3">{c.dudas}{c.lineasIa ? ` (${Math.round(1000 * c.dudas / c.lineasIa) / 10} %)` : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="text-[11px] text-muted-foreground mt-2">El interruptor "Bot activo" está en Clientes → editar cliente.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold">Peores casos (menor % de líneas iguales)</CardTitle></CardHeader>
              <CardContent className="pb-4 space-y-2">
                {data.peores.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay mensajes con pedido para comparar.</p>}
                {data.peores.map((p) => (
                  <div key={p.logId} className="rounded-md border p-2">
                    <button type="button" className="w-full text-left flex flex-wrap items-center gap-2 text-sm" onClick={() => setOpen(open === p.logId ? null : p.logId)}>
                      <span className="font-mono text-xs text-muted-foreground">{p.dia}</span>
                      <span className="font-medium">{p.cliente}</span>
                      {p.folio && <Badge variant="outline">{p.folio}</Badge>}
                      <span className={pctClass(p.pct)}>{p.iguales}/{p.lineasErp} = {p.pct} %</span>
                      {p.dudas > 0 && <Badge variant="outline" className="text-yellow-700 border-yellow-500/40">{p.dudas} dudas</Badge>}
                      <span className="ml-auto text-xs text-muted-foreground">{open === p.logId ? "ocultar" : "ver diferencias"}</span>
                    </button>
                    {open === p.logId && (
                      <pre className="mt-2 text-xs whitespace-pre-wrap font-mono bg-muted/40 rounded p-2 max-h-72 overflow-auto">{p.diff.length ? p.diff.join("\n") : "Sin diferencias"}</pre>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold">Clientes no identificados ({data.noIdentificados.length})</CardTitle></CardHeader>
              <CardContent className="pb-4 space-y-1">
                {data.noIdentificados.length === 0 && <p className="text-sm text-muted-foreground">Ninguno en el período.</p>}
                {data.noIdentificados.map((n) => (
                  <div key={n.id} className="text-xs flex flex-wrap gap-2 items-center border-b last:border-0 py-1">
                    <span className="font-mono text-muted-foreground">{n.dia}</span>
                    <span className="font-mono">{n.phone}</span>
                    {n.profileName && <span className="text-muted-foreground">{n.profileName}</span>}
                    <Badge variant="secondary" className="text-[10px]">{n.status}{n.reason ? ` · ${n.reason}` : ""}</Badge>
                    <span className="text-muted-foreground truncate max-w-[420px]">{n.texto}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
