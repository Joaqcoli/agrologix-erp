import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Plus, ShoppingCart, Calendar, ChevronRight, User } from "lucide-react";
import type { Purchase } from "@shared/schema";

export default function PurchasesPage() {
  const { data: purchases, isLoading } = useQuery<(Purchase & { itemCount: number })[]>({ queryKey: ["/api/purchases"] });

  const formatDate = (d: string | Date) =>
    new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <Layout title="Compras">
      <div className="p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Órdenes de Compra</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {purchases?.length ?? 0} orden{(purchases?.length ?? 0) !== 1 ? "es" : ""} registrada{(purchases?.length ?? 0) !== 1 ? "s" : ""}
            </p>
          </div>
          <Link href="/purchases/new">
            <Button data-testid="button-new-purchase">
              <Plus className="mr-2 h-4 w-4" /> Nueva Compra
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
          </div>
        ) : (purchases ?? []).length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <ShoppingCart className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Sin órdenes de compra</p>
              <p className="text-sm text-muted-foreground text-center">Registra tu primera compra para comenzar el inventario.</p>
              <Link href="/purchases/new">
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" /> Nueva Compra
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {(purchases ?? []).map((p) => (
              <Link key={p.id} href={`/purchases/${p.id}`}>
                <Card className="hover-elevate cursor-pointer" data-testid={`card-purchase-${p.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 shrink-0">
                          <ShoppingCart className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-foreground">{p.folio}</span>
                            <Badge variant="secondary" className="text-[10px]">
                              {p.itemCount} producto{p.itemCount !== 1 ? "s" : ""}
                            </Badge>
                          </div>
                          <p className="text-sm text-foreground mt-0.5 truncate">{p.supplierName}</p>
                          <div className="flex flex-wrap items-center gap-3 mt-1">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              {formatDate(p.purchaseDate)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Total</p>
                          <p className="text-base font-bold text-foreground">
                            ${parseFloat(p.total).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
