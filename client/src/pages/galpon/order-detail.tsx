import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { GalponLayout } from "./layout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { generateRemitoPDF } from "@/lib/pdf";
import { ArrowLeft, Trash2, Plus, CheckCircle2, Printer } from "lucide-react";

const UNITS = ["KG", "UNIDAD", "CAJON", "BOLSA", "ATADO", "MAPLE", "BANDEJA"];

type Item = { id: number; productId: number | null; productName: string | null; quantity: string; unit: string };
type GalponOrder = {
  id: number; folio: string; orderDate: string; status: string; notes: string | null;
  galponConfirmed: boolean; customerName: string; address: string | null; city: string | null;
  phone: string | null; createdByName: string | null; items: Item[];
};
type Prod = { id: number; name: string; unit: string };

export default function GalponOrderDetail({ id }: { id: number }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [newProd, setNewProd] = useState<string>("");
  const [newQty, setNewQty] = useState("");
  const [newUnit, setNewUnit] = useState("KG");

  const { data: order, isLoading } = useQuery<GalponOrder>({
    queryKey: ["/api/galpon/orders", id],
    queryFn: () => fetch(`/api/galpon/orders/${id}`, { credentials: "include" }).then((r) => r.json()),
  });
  const { data: products = [] } = useQuery<Prod[]>({
    queryKey: ["/api/galpon/products"],
    queryFn: () => fetch(`/api/galpon/products`, { credentials: "include" }).then((r) => r.json()),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/galpon/orders", id] });
  const onErr = (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" });

  const editMut = useMutation({
    mutationFn: ({ itemId, patch }: { itemId: number; patch: any }) =>
      apiRequest("PATCH", `/api/galpon/orders/${id}/items/${itemId}`, patch),
    onSuccess: invalidate, onError: onErr,
  });
  const addMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", `/api/galpon/orders/${id}/items`, body),
    onSuccess: () => { invalidate(); setNewProd(""); setNewQty(""); setNewUnit("KG"); }, onError: onErr,
  });
  const delMut = useMutation({
    mutationFn: (itemId: number) => apiRequest("DELETE", `/api/galpon/orders/${id}/items/${itemId}`),
    onSuccess: invalidate, onError: onErr,
  });
  const confirmMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/galpon/orders/${id}/confirm`, {}),
    onSuccess: () => { invalidate(); toast({ title: "Pedido confirmado" }); }, onError: onErr,
  });

  const printRemito = () => {
    if (!order) return;
    generateRemitoPDF({
      folio: order.folio,
      issuedAt: new Date(),
      order: {
        folio: order.folio,
        orderDate: order.orderDate,
        notes: order.notes,
        customer: { name: order.customerName, address: order.address, city: order.city, phone: order.phone },
        items: order.items.map((it) => ({
          product: it.productName ? ({ name: it.productName } as any) : null,
          quantity: it.quantity, unit: it.unit,
          pricePerUnit: "0", subtotal: "0", isBonification: false,
        })),
        total: "0",
      },
    }, { hidePrecios: true });
  };

  if (isLoading || !order) {
    return <GalponLayout title="Pedido"><div className="p-6 max-w-3xl mx-auto"><Skeleton className="h-40 w-full" /></div></GalponLayout>;
  }

  const isDraft = order.status === "draft";

  return (
    <GalponLayout title={`Pedido ${order.folio}`}>
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/galpon/orders")}><ArrowLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-foreground">{order.customerName}</h2>
              {order.galponConfirmed && <Badge className="bg-blue-100 text-blue-700 border-blue-300"><CheckCircle2 className="h-3 w-3 mr-1" /> Confirmado</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">{order.folio}{order.createdByName ? ` · Pedido por: ${order.createdByName}` : ""}</p>
          </div>
        </div>

        {!isDraft && (
          <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 rounded px-3 py-2">
            Este pedido ya no está en borrador ({order.status}); no se puede editar.
          </p>
        )}

        {/* Ítems — SIN precios */}
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="text-left py-2 px-3 w-24">Cant.</th>
                  <th className="text-left py-2 px-3 w-28">Unidad</th>
                  <th className="text-left py-2 px-3">Producto</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((it) => (
                  <tr key={it.id} className="border-b border-border/60">
                    <td className="py-1.5 px-3">
                      {isDraft ? (
                        <Input type="number" min="0" step="0.01" defaultValue={String(parseFloat(it.quantity))}
                          className="h-8 w-20 text-sm"
                          onBlur={(e) => { const v = e.target.value; if (v !== "" && parseFloat(v) !== parseFloat(it.quantity)) editMut.mutate({ itemId: it.id, patch: { quantity: v } }); }} />
                      ) : String(parseFloat(it.quantity))}
                    </td>
                    <td className="py-1.5 px-3">
                      {isDraft ? (
                        <Select value={it.unit} onValueChange={(v) => editMut.mutate({ itemId: it.id, patch: { unit: v } })}>
                          <SelectTrigger className="h-8 w-24 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : it.unit}
                    </td>
                    <td className="py-1.5 px-3">
                      {isDraft ? (
                        <Select value={it.productId ? String(it.productId) : ""} onValueChange={(v) => editMut.mutate({ itemId: it.id, patch: { productId: Number(v) } })}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={it.productName ?? "Elegir producto..."} /></SelectTrigger>
                          <SelectContent className="max-h-72">{products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : (it.productName ?? "—")}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      {isDraft && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={delMut.isPending}
                          onClick={() => { if (window.confirm("¿Eliminar esta línea?")) delMut.mutate(it.id); }}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {order.items.length === 0 && (
                  <tr><td colSpan={4} className="py-4 px-3 text-center text-xs text-muted-foreground">Sin ítems.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Agregar línea */}
        {isDraft && (
          <div className="flex items-end gap-2 flex-wrap">
            <div className="w-24">
              <Input type="number" min="0" step="0.01" value={newQty} onChange={(e) => setNewQty(e.target.value)} placeholder="Cant." className="h-9" />
            </div>
            <Select value={newUnit} onValueChange={setNewUnit}>
              <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
            <div className="flex-1 min-w-[160px]">
              <Select value={newProd} onValueChange={setNewProd}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Producto..." /></SelectTrigger>
                <SelectContent className="max-h-72">{products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={() => addMut.mutate({ quantity: newQty, unit: newUnit, productId: newProd ? Number(newProd) : null })}
              disabled={!(parseFloat(newQty) > 0) || addMut.isPending}>
              <Plus className="h-4 w-4 mr-1" /> Agregar
            </Button>
          </div>
        )}

        {/* Acciones */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          {isDraft && !order.galponConfirmed && (
            <Button onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending}>
              <CheckCircle2 className="h-4 w-4 mr-2" /> Confirmar pedido
            </Button>
          )}
          {order.galponConfirmed && (
            <Button variant="outline" onClick={printRemito}>
              <Printer className="h-4 w-4 mr-2" /> Imprimir remito
            </Button>
          )}
        </div>
      </div>
    </GalponLayout>
  );
}
