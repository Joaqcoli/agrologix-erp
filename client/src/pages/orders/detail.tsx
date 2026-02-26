import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { ArrowLeft, Calendar, CheckCircle2, Download, AlertTriangle } from "lucide-react";
import { generateRemitoPDF } from "@/lib/pdf";
import { useState } from "react";
import type { Order, Customer, Product, OrderItem, Remito } from "@shared/schema";

const IVA_DEFAULT = 0.105;
const IVA_HUEVO = 0.21;
const LOW_MARGIN = 0.30;

function getIvaRate(productName: string) {
  return productName.toUpperCase().includes("HUEVO") ? IVA_HUEVO : IVA_DEFAULT;
}

const fmt = (v: number, dec = 2) => v.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtPct = (v: number) => (v * 100).toFixed(1) + "%";

type FullOrder = Order & { customer: Customer; items: (OrderItem & { product: Product })[] };

export default function OrderDetailPage({ id }: { id: number }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [lowMarginOk, setLowMarginOk] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { data: order, isLoading } = useQuery<FullOrder>({
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

  const handleDownloadRemito = async () => {
    if (!order?.remitoId) return;
    try {
      const res = await fetch(`/api/remitos/${order.remitoId}`, { credentials: "include" });
      if (!res.ok) throw new Error("No se pudo obtener el remito");
      const remito = await res.json();
      generateRemitoPDF(remito);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleExportXlsx = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/orders/${id}/export`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al exportar");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Pedido-${order?.folio ?? id}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) {
    return (
      <Layout title="Detalle de Pedido">
        <div className="p-6 max-w-4xl mx-auto space-y-4">
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
  const hasIva = order.customer.hasIva;

  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    draft:     { label: "Borrador", variant: "secondary" },
    approved:  { label: "Aprobado", variant: "default" },
    cancelled: { label: "Cancelado", variant: "destructive" },
  };
  const sc = statusConfig[order.status] ?? { label: order.status, variant: "secondary" as const };

  // Per-item calculations
  type ItemCalc = {
    id: number;
    name: string;
    sku: string;
    qty: number;
    unit: string;
    pricePerUnit: number;
    subtotal: number;
    totalConIva: number;
    ivaRate: number;
    costPerUnit: number;
    totalCompra: number;
    base: number;    // totalConIva if hasIva else subtotal
    diferencia: number;
    pct: number;
    isLowMargin: boolean;
  };

  const calcs: ItemCalc[] = order.items.map((item) => {
    const qty = parseFloat(item.quantity as string);
    const price = parseFloat(item.pricePerUnit as string);
    const cost = parseFloat(item.costPerUnit as string);
    const subtotal = qty * price;
    const ivaRate = getIvaRate(item.product.name);
    const totalConIva = subtotal * (1 + ivaRate);
    const totalCompra = qty * cost;
    const base = hasIva ? totalConIva : subtotal;
    const diferencia = base - totalCompra;
    const pct = base > 0 ? diferencia / base : 0;
    return {
      id: item.id,
      name: item.product.name,
      sku: item.product.sku,
      qty,
      unit: item.unit,
      pricePerUnit: price,
      subtotal,
      totalConIva,
      ivaRate,
      costPerUnit: cost,
      totalCompra,
      base,
      diferencia,
      pct,
      isLowMargin: pct < LOW_MARGIN,
    };
  });

  const hasAnyLowMargin = calcs.some((c) => c.isLowMargin);

  const grandTotal = calcs.reduce((s, c) => s + c.subtotal, 0);
  const grandTotalConIva = calcs.reduce((s, c) => s + c.totalConIva, 0);
  const grandTotalCompra = calcs.reduce((s, c) => s + c.totalCompra, 0);
  const grandBase = hasIva ? grandTotalConIva : grandTotal;
  const grandDiff = grandBase - grandTotalCompra;
  const grandPct = grandBase > 0 ? grandDiff / grandBase : 0;

  const canApprove = isDraft && (!hasAnyLowMargin || lowMarginOk);

  return (
    <Layout title={`Pedido ${order.folio}`}>
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/orders")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-foreground">{order.folio}</h2>
              <Badge variant={sc.variant}>{sc.label}</Badge>
              {hasIva && <Badge variant="outline" className="text-[10px] text-primary border-primary/40">Con IVA</Badge>}
              {order.lowMarginConfirmed && (
                <Badge variant="outline" className="text-[10px] text-destructive border-destructive/50">
                  <AlertTriangle className="h-2.5 w-2.5 mr-1" /> Margen bajo confirmado
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{order.customer?.name}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <Button variant="outline" size="sm" onClick={handleExportXlsx} disabled={exporting} data-testid="button-export-order">
              <Download className="mr-2 h-4 w-4" /> {exporting ? "..." : "Exportar cliente"}
            </Button>
            {isApproved && order.remitoId && (
              <Button variant="outline" size="sm" onClick={handleDownloadRemito} data-testid="button-download-remito">
                <Download className="mr-2 h-4 w-4" /> Remito PDF
              </Button>
            )}
            {isDraft && (
              <Button
                size="sm"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending || !canApprove}
                data-testid="button-approve-order"
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {approveMutation.isPending ? "Aprobando..." : "Generar Remito"}
              </Button>
            )}
          </div>
        </div>

        {/* Low margin warning */}
        {isDraft && hasAnyLowMargin && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex flex-col gap-3">
              <span>Una o más líneas tienen margen inferior al 30%. Confirma para aprobar.</span>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="low-margin-ok"
                  checked={lowMarginOk}
                  onCheckedChange={(v) => setLowMarginOk(!!v)}
                  data-testid="checkbox-low-margin-detail"
                />
                <label htmlFor="low-margin-ok" className="text-sm cursor-pointer font-medium">
                  Confirmo el margen bajo y autorizo la aprobación
                </label>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* General info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Información General</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Neto</p>
              <p className="text-lg font-bold text-foreground mt-0.5">
                ${fmt(grandTotal)}
              </p>
            </div>
            {hasIva && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Total + IVA</p>
                <p className="text-lg font-bold text-primary mt-0.5">
                  ${fmt(grandTotalConIva)}
                </p>
                <p className="text-[10px] text-muted-foreground">IVA: ${fmt(grandTotalConIva - grandTotal)}</p>
              </div>
            )}
            {order.notes && (
              <div className="col-span-2 sm:col-span-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Notas</p>
                <p className="text-sm text-foreground mt-1">{order.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Products table - Excel style */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Detalle de Productos ({order.items?.length ?? 0})
              {hasIva && <span className="text-xs text-muted-foreground font-normal ml-2">· IVA aplicado por producto (10.5% / 21% huevo)</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b-2 border-border bg-muted/40">
                    <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Cant.</th>
                    <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">U.</th>
                    <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground uppercase tracking-wide">Producto</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">P. Venta</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Total</th>
                    {hasIva && (
                      <th className="text-right py-2.5 px-3 font-semibold text-primary uppercase tracking-wide whitespace-nowrap">Total + IVA</th>
                    )}
                    <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap border-l border-border">P. Compra</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">T. Compra</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Dif.</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">%</th>
                  </tr>
                </thead>
                <tbody>
                  {calcs.map((c) => (
                    <tr
                      key={c.id}
                      className={`border-b border-border last:border-0 ${c.isLowMargin ? "bg-destructive/5" : "hover:bg-muted/30"} transition-colors`}
                      data-testid={`row-item-${c.id}`}
                    >
                      <td className="py-2.5 px-3 font-medium text-foreground whitespace-nowrap">{fmt(c.qty, 4).replace(/\.?0+$/, '')}</td>
                      <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{c.unit}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-foreground">{c.name}</span>
                          {c.isLowMargin && (
                            <Badge variant="destructive" className="text-[9px] py-0 px-1">Margen bajo</Badge>
                          )}
                          {hasIva && (
                            <span className="text-[10px] text-muted-foreground">IVA {(c.ivaRate * 100).toFixed(1)}%</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right text-foreground whitespace-nowrap">${fmt(c.pricePerUnit, 4)}</td>
                      <td className="py-2.5 px-3 text-right text-foreground whitespace-nowrap">${fmt(c.subtotal)}</td>
                      {hasIva && (
                        <td className="py-2.5 px-3 text-right font-semibold text-primary whitespace-nowrap">${fmt(c.totalConIva)}</td>
                      )}
                      <td className="py-2.5 px-3 text-right text-muted-foreground whitespace-nowrap border-l border-border">${fmt(c.costPerUnit, 4)}</td>
                      <td className="py-2.5 px-3 text-right text-muted-foreground whitespace-nowrap">${fmt(c.totalCompra)}</td>
                      <td className={`py-2.5 px-3 text-right font-semibold whitespace-nowrap ${c.diferencia >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                        ${fmt(c.diferencia)}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-bold whitespace-nowrap ${c.isLowMargin ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                        {fmtPct(c.pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/20">
                    <td colSpan={hasIva ? 4 : 4} className="py-3 px-3 font-bold text-foreground uppercase tracking-wide text-xs">Total</td>
                    <td className="py-3 px-3 text-right font-bold text-foreground whitespace-nowrap">${fmt(grandTotal)}</td>
                    {hasIva && (
                      <td className="py-3 px-3 text-right font-bold text-primary whitespace-nowrap">${fmt(grandTotalConIva)}</td>
                    )}
                    <td className="py-3 px-3 border-l border-border"></td>
                    <td className="py-3 px-3 text-right font-bold text-muted-foreground whitespace-nowrap">${fmt(grandTotalCompra)}</td>
                    <td className={`py-3 px-3 text-right font-bold whitespace-nowrap ${grandDiff >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                      ${fmt(grandDiff)}
                    </td>
                    <td className={`py-3 px-3 text-right font-bold whitespace-nowrap ${grandPct < LOW_MARGIN ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                      {fmtPct(grandPct)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
