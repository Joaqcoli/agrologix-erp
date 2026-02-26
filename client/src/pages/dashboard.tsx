import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Package, ShoppingCart, TrendingUp, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import type { Customer, Product, Purchase } from "@shared/schema";

function StatCard({
  title,
  value,
  icon: Icon,
  href,
  loading,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  href: string;
  loading: boolean;
}) {
  return (
    <Card className="hover-elevate">
      <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="text-3xl font-bold text-foreground">{value}</div>
        )}
        <Link href={href}>
          <button className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors">
            Ver todos <ArrowRight className="h-3 w-3" />
          </button>
        </Link>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: customers, isLoading: loadingC } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: products, isLoading: loadingP } = useQuery<Product[]>({ queryKey: ["/api/products"] });
  const { data: purchases, isLoading: loadingPu } = useQuery<Purchase[]>({ queryKey: ["/api/purchases"] });

  const activeCustomers = customers?.filter((c) => c.active).length ?? 0;
  const activeProducts = products?.filter((p) => p.active).length ?? 0;
  const totalPurchases = purchases?.length ?? 0;

  const recentPurchases = (purchases ?? []).slice(0, 5);

  return (
    <Layout title="Dashboard">
      <div className="p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Resumen General</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Vista general del sistema</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard title="Clientes Activos" value={activeCustomers} icon={Users} href="/customers" loading={loadingC} />
          <StatCard title="Productos Activos" value={activeProducts} icon={Package} href="/products" loading={loadingP} />
          <StatCard title="Órdenes de Compra" value={totalPurchases} icon={ShoppingCart} href="/purchases" loading={loadingPu} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 pb-3">
              <CardTitle className="text-sm font-semibold">Compras Recientes</CardTitle>
              <Link href="/purchases">
                <Button variant="ghost" size="sm" className="text-xs h-7">Ver todas</Button>
              </Link>
            </CardHeader>
            <CardContent>
              {loadingPu ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : recentPurchases.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No hay compras registradas aún.
                </div>
              ) : (
                <div className="space-y-2">
                  {recentPurchases.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-foreground">{p.folio}</span>
                        <span className="text-xs text-muted-foreground">{p.supplierName}</span>
                      </div>
                      <span className="text-sm font-semibold text-foreground">
                        ${parseFloat(p.total).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 pb-3">
              <CardTitle className="text-sm font-semibold">Productos con Stock</CardTitle>
              <Link href="/products">
                <Button variant="ghost" size="sm" className="text-xs h-7">Ver todos</Button>
              </Link>
            </CardHeader>
            <CardContent>
              {loadingP ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : (products ?? []).filter((p) => p.active && parseFloat(p.currentStock as string) > 0).length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Registra una compra para ver el inventario.
                </div>
              ) : (
                <div className="space-y-2">
                  {(products ?? [])
                    .filter((p) => p.active && parseFloat(p.currentStock as string) > 0)
                    .slice(0, 5)
                    .map((p) => (
                      <div key={p.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-foreground">{p.name}</span>
                          <span className="text-xs text-muted-foreground">
                            Stock: {parseFloat(p.currentStock as string).toLocaleString("es-MX")} {p.unit}
                          </span>
                        </div>
                        <span className="text-sm font-semibold text-foreground">
                          ${parseFloat(p.averageCost as string).toLocaleString("es-MX", { minimumFractionDigits: 2 })}/u
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
