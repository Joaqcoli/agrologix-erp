import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import { Plus, FileText, Calendar, ChevronRight, CheckCircle2, Clock, XCircle, TrendingUp, Download, Users, Trash2 } from "lucide-react";
import type { Order } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

type OrderSummary = Order & {
  customerName: string;
  itemCount: number;
  suggestedRemito: string;
  hasIva: boolean;
  totalConIva: string;
  totalCosto: string;
};

const STATUS_CONFIG = {
  draft:     { label: "Borrador", icon: Clock, variant: "secondary" as const },
  approved:  { label: "Aprobado", icon: CheckCircle2, variant: "default" as const },
  cancelled: { label: "Cancelado", icon: XCircle, variant: "destructive" as const },
};

const fmt = (v: number) => v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function OrdersPage() {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [exporting, setExporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OrderSummary | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", date] });
      queryClient.invalidateQueries({ queryKey: ["/api/load-list"] });
      toast({ title: "Pedido eliminado" });
      setDeleteTarget(null);
    },
    onError: (e: any) => {
      toast({ title: "Error al eliminar", description: e.message, variant: "destructive" });
      setDeleteTarget(null);
    },
  });

  const { data: orders, isLoading } = useQuery<OrderSummary[]>({
    queryKey: ["/api/orders", date],
    queryFn: async () => {
      const res = await fetch(`/api/orders?date=${date}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    enabled: !!date,
  });

  const formatDate = (d: string | Date) => {
    const s = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
    return new Date(s + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
  };

  // Day summary
  const dayOrders = orders ?? [];
  const totalVendido = dayOrders.reduce((sum, o) => {
    const val = o.hasIva ? parseFloat(o.totalConIva) : parseFloat(o.total);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);
  const totalCosto = dayOrders.reduce((sum, o) => sum + (parseFloat(o.totalCosto) || 0), 0);
  const margenDollar = totalVendido - totalCosto;
  const margenPct = totalVendido > 0 ? (margenDollar / totalVendido) * 100 : 0;
  const customerCount = new Set(dayOrders.map((o) => o.customerId)).size;

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/orders/export?date=${date}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al exportar");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Pedidos-${date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Error al exportar", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Layout title="Pedidos">
      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Pedidos de Venta</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Vista por fecha</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/load-list">
              <Button variant="outline" size="sm" data-testid="button-load-list">
                <FileText className="mr-2 h-4 w-4" /> Lista de Carga
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || dayOrders.length === 0} data-testid="button-export-day">
              <Download className="mr-2 h-4 w-4" /> {exporting ? "Exportando..." : "Exportar día"}
            </Button>
            <Link href="/orders/new">
              <Button size="sm" data-testid="button-new-order">
                <Plus className="mr-2 h-4 w-4" /> Nuevo Pedido
              </Button>
            </Link>
          </div>
        </div>

        {/* Date picker */}
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="date-filter" className="text-xs text-muted-foreground uppercase tracking-wide">Fecha</Label>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                id="date-filter"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-40"
                data-testid="input-date-filter"
              />
            </div>
          </div>
        </div>

        {/* Resumen del Día */}
        {!isLoading && dayOrders.length > 0 && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-semibold text-primary flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Resumen del Día
                <span className="text-xs font-normal text-muted-foreground ml-1">
                  {new Date(date + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "2-digit", month: "long" })}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md bg-background border border-border p-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Vendido</p>
                  <p className="text-lg font-bold text-foreground mt-1" data-testid="text-total-vendido">
                    ${fmt(totalVendido)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">incl. IVA según cliente</p>
                </div>
                <div className="rounded-md bg-background border border-border p-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Costo</p>
                  <p className="text-lg font-bold text-foreground mt-1" data-testid="text-total-costo">
                    ${fmt(totalCosto)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">costo promedio ponderado</p>
                </div>
                <div className={`rounded-md bg-background border p-3 ${margenPct < 30 ? "border-destructive/50" : "border-border"}`}>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Margen</p>
                  <p className={`text-lg font-bold mt-1 ${margenPct < 30 ? "text-destructive" : "text-green-600 dark:text-green-400"}`} data-testid="text-margen-dia">
                    ${fmt(margenDollar)}
                  </p>
                  <p className={`text-xs font-semibold mt-0.5 ${margenPct < 30 ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                    {margenPct.toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-md bg-background border border-border p-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Pedidos / Clientes</p>
                  <p className="text-lg font-bold text-foreground mt-1">{dayOrders.length}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">{customerCount} cliente{customerCount !== 1 ? "s" : ""}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Orders list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
          </div>
        ) : dayOrders.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Sin pedidos para esta fecha</p>
              <p className="text-sm text-muted-foreground text-center">No hay pedidos registrados para el {formatDate(date + "T12:00:00")}.</p>
              <Link href="/orders/new">
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" /> Nuevo Pedido
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {dayOrders.map((o) => {
              const statusCfg = STATUS_CONFIG[o.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
              const StatusIcon = statusCfg.icon;
              const vendido = o.hasIva ? parseFloat(o.totalConIva) : parseFloat(o.total);
              return (
                <div key={o.id} className="relative group">
                  <Link href={`/orders/${o.id}`}>
                    <Card className="hover-elevate cursor-pointer" data-testid={`card-order-${o.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-start gap-4 flex-1 min-w-0">
                            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 shrink-0">
                              <FileText className="h-5 w-5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={statusCfg.variant} className="text-[10px] flex items-center gap-1">
                                  <StatusIcon className="h-2.5 w-2.5" />
                                  {statusCfg.label}
                                </Badge>
                                <Badge variant="secondary" className="text-[10px]">{o.itemCount} prod.</Badge>
                                {o.hasIva && (
                                  <Badge variant="outline" className="text-[10px] text-primary border-primary/40">Con IVA</Badge>
                                )}
                              </div>
                              <p className="text-sm font-semibold text-foreground mt-1 truncate">{o.customerName}</p>
                              <div className="flex flex-wrap items-center gap-3 mt-0.5">
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Calendar className="h-3 w-3" />
                                  {formatDate(o.orderDate)}
                                </span>
                                <span className="text-xs text-muted-foreground font-mono">
                                  Remito: <span className="font-semibold text-foreground">{o.suggestedRemito}</span>
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground">{o.hasIva ? "Total + IVA" : "Total"}</p>
                              <p className="text-base font-bold text-foreground">
                                ${fmt(vendido)}
                              </p>
                              {o.hasIva && (
                                <p className="text-[10px] text-muted-foreground">Neto: ${fmt(parseFloat(o.total))}</p>
                              )}
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                  {/* Delete button — outside Link to avoid navigation */}
                  <button
                    onClick={(e) => { e.preventDefault(); setDeleteTarget(o); }}
                    className="absolute top-3 right-10 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    data-testid={`button-delete-order-${o.id}`}
                    title="Eliminar pedido"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* Confirm delete dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar pedido?</AlertDialogTitle>
            <AlertDialogDescription>
              Estás por eliminar el pedido de <strong>{deleteTarget?.customerName}</strong>{" "}
              ({deleteTarget?.folio}). Esta acción no se puede deshacer.
              Los ítems del pedido también serán eliminados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
