import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import { ArrowLeft, Calendar, Package, Truck, Pencil, Trash2 } from "lucide-react";

const UNIT_LABELS: Record<string, string> = {
  kg: "KG", pz: "UNIDAD", caja: "CAJÓN", saco: "BOLSA",
  litro: "LITRO", tonelada: "TON", CAJON: "CAJÓN", maple: "MAPLE",
  atado: "ATADO", bandeja: "BANDEJA",
};

export default function PurchaseDetailPage({ id }: { id: number }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showDelete, setShowDelete] = useState(false);

  const { data: purchase, isLoading } = useQuery<any>({
    queryKey: ["/api/purchases", id],
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/purchases/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/stock"] });
      toast({ title: "Compra eliminada", description: "Se revirtió el stock correctamente." });
      setLocation("/purchases");
    },
    onError: (e: any) => toast({ title: "Error al eliminar", description: e.message, variant: "destructive" }),
  });

  const formatDate = (d: string | Date) =>
    new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });

  if (isLoading) {
    return (
      <Layout title="Detalle de Compra">
        <div className="p-6 max-w-3xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Layout>
    );
  }

  if (!purchase) {
    return (
      <Layout title="Compra no encontrada">
        <div className="p-6 text-center text-muted-foreground">
          <p>La orden de compra no existe.</p>
          <Button variant="outline" className="mt-4" onClick={() => setLocation("/purchases")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={`Compra ${purchase.folio}`}>
      <div className="p-6 max-w-3xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/purchases")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-foreground">{purchase.folio}</h2>
                <Badge variant="secondary">Registrada</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">Orden de compra completada</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/purchases/${id}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setShowDelete(true)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Eliminar
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Información General</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Proveedor</p>
              <div className="flex items-center gap-1.5 mt-1">
                <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">{purchase.supplierName}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Fecha</p>
              <div className="flex items-center gap-1.5 mt-1">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">{formatDate(purchase.purchaseDate)}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total</p>
              <p className="text-lg font-bold text-foreground mt-0.5">
                ${parseFloat(purchase.total).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
              </p>
            </div>
            {purchase.notes && (
              <div className="col-span-2 sm:col-span-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Notas</p>
                <p className="text-sm text-foreground mt-1">{purchase.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Package className="h-4 w-4" /> Productos ({purchase.items?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(purchase.items ?? []).map((item: any) => (
                <div key={item.id} className="flex items-center justify-between py-3 border-b border-border last:border-0 gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.product?.name}</p>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
                      {item.purchaseUnit && item.weightPerPackage ? (
                        <>
                          <span className="text-xs text-muted-foreground">
                            {parseFloat(item.purchaseQty ?? item.quantity).toLocaleString("es-MX", { maximumFractionDigits: 4 })} {UNIT_LABELS[item.purchaseUnit] ?? item.purchaseUnit.toUpperCase()}
                            {" × "}{parseFloat(item.weightPerPackage).toLocaleString("es-MX", { maximumFractionDigits: 4 })} {UNIT_LABELS[item.unit] ?? item.unit.toUpperCase()}
                            {" = "}<span className="font-medium text-foreground">{parseFloat(item.quantity).toLocaleString("es-MX", { maximumFractionDigits: 4 })} {UNIT_LABELS[item.unit] ?? item.unit.toUpperCase()}</span>
                            {" a $"}{parseFloat(item.costPerUnit).toLocaleString("es-MX", { minimumFractionDigits: 2 })}/{UNIT_LABELS[item.unit] ?? item.unit}
                          </span>
                          {item.emptyCost && parseFloat(item.emptyCost) > 0 && (() => {
                            const pkgQty = parseFloat(item.purchaseQty ?? item.quantity);
                            const ec = parseFloat(item.emptyCost);
                            return (
                              <span className="text-xs text-amber-600 dark:text-amber-400 block mt-0.5">
                                + vacío ${ec.toLocaleString("es-MX")}/{UNIT_LABELS[item.purchaseUnit] ?? item.purchaseUnit} × {pkgQty.toLocaleString("es-MX", { maximumFractionDigits: 0 })} = ${(ec * pkgQty).toLocaleString("es-MX", { minimumFractionDigits: 0 })} total vacíos
                              </span>
                            );
                          })()}
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-muted-foreground">
                            {parseFloat(item.quantity).toLocaleString("es-MX", { maximumFractionDigits: 4 })} {UNIT_LABELS[item.unit] ?? item.unit.toUpperCase()}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            × ${parseFloat(item.costPerUnit).toLocaleString("es-MX", { minimumFractionDigits: 2 })}/u
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-foreground">
                      ${parseFloat(item.subtotal).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <Separator className="my-3" />
            {parseFloat(purchase.totalEmptyCost ?? "0") > 0 ? (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Subtotal productos</span>
                  <span className="text-sm text-foreground">
                    ${(parseFloat(purchase.total) - parseFloat(purchase.totalEmptyCost)).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-amber-600 dark:text-amber-400">Total vacíos</span>
                  <span className="text-sm text-amber-600 dark:text-amber-400">
                    ${parseFloat(purchase.totalEmptyCost).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <Separator className="my-1" />
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-foreground">Total</span>
                  <span className="text-xl font-bold text-foreground">
                    ${parseFloat(purchase.total).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-xl font-bold text-foreground">
                  ${parseFloat(purchase.total).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {purchase.folio}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción revertirá el stock de todos los productos incluidos en esta compra. Si el stock resultante es negativo, se establecerá en 0. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
