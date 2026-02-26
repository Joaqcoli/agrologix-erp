import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { ArrowLeft, Calendar, CheckCircle2, Download, TrendingDown, TrendingUp, AlertTriangle } from "lucide-react";
import { generateRemitoPDF } from "@/lib/pdf";
import type { Order, Customer, Product, OrderItem, Remito } from "@shared/schema";

const LOW_MARGIN = 0.30;

export default function OrderDetailPage({ id }: { id: number }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: order, isLoading } = useQuery<Order & { customer: Customer; items: (OrderItem & { product: Product })[] }>({
    queryKey: ["/api/orders", id],
  });

  const approveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/orders/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Pedido aprobado", description: "Se generó el remito y se descontó el stock." });
    },
    onError: (e: any) => toast({ title: "Error al aprobar", description: e.message, variant: "destructive" }),
  });

  const formatDate = (d: string | Date) =>
    new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });

  if (isLoading) {
    return (
      <Layout title="Detalle de Pedido">
        <div className="p-6 max-w-3xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Layout>
    );
  }

  if (!order) {
    return (
      <Layout title="Pedido no encontrado">
        <div className="p-6 text-center text-muted-foreground">
          <p>El pedido no existe.</p>
          <Button variant="outline" className="mt-4" onClick={() => setLocation("/orders")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver
          </Button>
        </div>
      </Layout>
    );
  }

  const isDraft = order.status === "draft";
  const isApproved = order.status === "approved";

  const handleDownloadRemito = async () => {
    if (!order.remitoId) return;
    try {
      const res = await fetch(`/api/remitos/${order.remitoId}`, { credentials: "include" });
      if (!res.ok) throw new Error("No se pudo obtener el remito");
      const remito = await res.json();
      generateRemitoPDF(remito);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    draft: { label: "Borrador", variant: "secondary" },
    approved: { label: "Aprobado", variant: "default" },
    cancelled: { label: "Cancelado", variant: "destructive" },
  };
  const sc = statusConfig[order.status] ?? { label: order.status, variant: "secondary" as const };

  const hasLowMargin = order.items.some((item) => {
    const m = parseFloat(item.margin as string);
    return !isNaN(m) && m < LOW_MARGIN;
  });

  return (
    <Layout title={`Pedido ${order.folio}`}>
      <div className="p-6 max-w-3xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/orders")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-foreground">{order.folio}</h2>
              <Badge variant={sc.variant}>{sc.label}</Badge>
              {order.lowMarginConfirmed && (
                <Badge variant="outline" className="text-[10px] text-destructive border-destructive/50">
                  <AlertTriangle className="h-2.5 w-2.5 mr-1" /> Margen bajo confirmado
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{order.customer?.name}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isApproved && order.remitoId && (
              <Button variant="outline" size="sm" onClick={handleDownloadRemito} data-testid="button-download-remito">
                <Download className="mr-2 h-4 w-4" /> Remito PDF
              </Button>
            )}
            {isDraft && (
              <Button
                size="sm"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                data-testid="button-approve-order"
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {approveMutation.isPending ? "Aprobando..." : "Aprobar"}
              </Button>
            )}
          </div>
        </div>

        {isDraft && hasLowMargin && !order.lowMarginConfirmed && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Este pedido tiene productos con margen inferior al 30%. El operador confirmó el margen bajo al crearlo.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Información General</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Cliente</p>
              <p className="text-sm font-medium text-foreground mt-1">{order.customer?.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Fecha</p>
              <div className="flex items-center gap-1.5 mt-1">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">{formatDate(order.orderDate)}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total</p>
              <p className="text-lg font-bold text-foreground mt-0.5">
                ${parseFloat(order.total).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
              </p>
            </div>
            {order.notes && (
              <div className="col-span-2 sm:col-span-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Notas</p>
                <p className="text-sm text-foreground mt-1">{order.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              Productos ({order.items?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              {(order.items ?? []).map((item) => {
                const margin = parseFloat(item.margin as string);
                const isLow = !isNaN(margin) && margin < LOW_MARGIN;
                return (
                  <div key={item.id} className="py-3 border-b border-border last:border-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground">{item.product?.name}</p>
                          {isLow ? (
                            <Badge variant="destructive" className="text-[10px] flex items-center gap-0.5">
                              <TrendingDown className="h-2.5 w-2.5" /> {(margin * 100).toFixed(1)}%
                            </Badge>
                          ) : (
                            !isNaN(margin) && (
                              <Badge variant="secondary" className="text-[10px] flex items-center gap-0.5 text-green-700 dark:text-green-400">
                                <TrendingUp className="h-2.5 w-2.5" /> {(margin * 100).toFixed(1)}%
                              </Badge>
                            )
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 mt-0.5">
                          <span className="text-xs text-muted-foreground">
                            {parseFloat(item.quantity as string).toLocaleString("es-MX", { maximumFractionDigits: 4 })} {item.unit}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            × ${parseFloat(item.pricePerUnit as string).toLocaleString("es-MX", { minimumFractionDigits: 4 })}/u
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Costo: ${parseFloat(item.costPerUnit as string).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-foreground">
                          ${parseFloat(item.subtotal as string).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <Separator className="my-3" />
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-xl font-bold text-foreground">
                ${parseFloat(order.total).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
