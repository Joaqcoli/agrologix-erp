/**
 * A-13 · "Facturas a emitir": la primera factura automática de cada cliente la aprueba Joaquín acá (desde entonces el
 * cliente queda en automático). También caen acá las que fallaron en ARCA, para reintentar.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Receipt, Check, X } from "lucide-react";

type Item = {
  id: number; billingCustomerId: number; billingCustomerName: string; mode: string; total: string | null; reason: string; error: string | null; createdAt: string;
  orders: { id: number; folio: string; remitoNum: number | null; customerName: string; orderDate: string; total: string }[];
};
const MODO: Record<string, string> = { diaria: "Diaria", semanal: "Semanal", mensual: "Mensual", diaria_envio_semanal: "Diaria · envío semanal" };
const fmt = (n: string | number | null) => n == null ? "—" : `$${Math.round(Number(n)).toLocaleString("es-AR")}`;
const fmtFecha = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };

export default function FacturasAEmitirPage() {
  const { toast } = useToast();
  const { data = [], isLoading } = useQuery<Item[]>({ queryKey: ["/api/invoice-queue"], refetchInterval: 30000 });
  const invalidate = () => { queryClient.invalidateQueries({ queryKey: ["/api/invoice-queue"] }); queryClient.invalidateQueries({ queryKey: ["/api/invoices"] }); };
  const aprobar = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/invoice-queue/${id}/aprobar`, {}).then((r) => r.json()),
    onSuccess: (inv: any) => { invalidate(); toast({ title: `Factura ${inv.invoiceNumber} emitida`, description: "El cliente queda en facturación automática." }); },
    onError: (e: any) => { invalidate(); toast({ title: "No se pudo emitir", description: e.message, variant: "destructive" }); },
  });
  const descartar = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/invoice-queue/${id}/descartar`, {}),
    onSuccess: () => { invalidate(); toast({ title: "Descartado" }); },
  });
  return (
    <Layout title="Facturas a emitir">
      <div className="p-4 sm:p-6 space-y-4 max-w-5xl">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Receipt className="h-5 w-5" /> Facturas a emitir</h1>
          <p className="text-sm text-muted-foreground mt-1">La primera factura automática de cada cliente la aprobás vos. Al aprobarla, ese cliente queda en automático. También aparecen acá las que ARCA rechazó, para reintentar.</p>
        </div>
        {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {!isLoading && data.length === 0 && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">No hay facturas pendientes de aprobación.</CardContent></Card>
        )}
        {data.map((q) => (
          <Card key={q.id} data-testid={`queue-${q.id}`}>
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-foreground">{q.billingCustomerName}</span>
                <Badge variant="secondary">{MODO[q.mode] ?? q.mode}</Badge>
                {q.reason === "primera_vez" ? <Badge variant="outline">Primera factura automática</Badge> : <Badge variant="destructive">Error de ARCA</Badge>}
                <span className="ml-auto text-sm font-semibold">{fmt(q.total)} <span className="text-xs text-muted-foreground font-normal">neto remitos</span></span>
              </div>
              {q.error && <p className="text-xs text-destructive bg-destructive/5 rounded px-2 py-1">{q.error}</p>}
              <table className="w-full text-xs">
                <thead><tr className="text-muted-foreground text-left"><th className="py-1">Fecha</th><th>Cliente / sede</th><th>Remito</th><th className="text-right">Total</th></tr></thead>
                <tbody>
                  {q.orders.map((o) => (
                    <tr key={o.id} className="border-t border-border">
                      <td className="py-1">{fmtFecha(o.orderDate)}</td>
                      <td>{o.customerName}</td>
                      <td><a className="underline" href={`/orders/${o.id}`}>{o.remitoNum ?? o.folio}</a></td>
                      <td className="text-right">{fmt(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => descartar.mutate(q.id)} disabled={descartar.isPending}><X className="h-3.5 w-3.5 mr-1" /> Descartar</Button>
                <Button size="sm" onClick={() => aprobar.mutate(q.id)} disabled={aprobar.isPending} data-testid={`button-aprobar-${q.id}`}><Check className="h-3.5 w-3.5 mr-1" /> {aprobar.isPending ? "Emitiendo…" : "Aprobar y emitir"}</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </Layout>
  );
}
