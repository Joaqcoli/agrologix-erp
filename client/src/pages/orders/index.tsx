import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Plus, FileText, Calendar, ChevronRight, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { Order } from "@shared/schema";

const STATUS_CONFIG = {
  draft: { label: "Borrador", icon: Clock, variant: "secondary" as const },
  approved: { label: "Aprobado", icon: CheckCircle2, variant: "default" as const },
  cancelled: { label: "Cancelado", icon: XCircle, variant: "destructive" as const },
};

export default function OrdersPage() {
  const { data: orders, isLoading } = useQuery<(Order & { customerName: string; itemCount: number })[]>({
    queryKey: ["/api/orders"],
  });

  const formatDate = (d: string | Date) =>
    new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <Layout title="Pedidos">
      <div className="p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Pedidos de Venta</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {orders?.length ?? 0} pedido{(orders?.length ?? 0) !== 1 ? "s" : ""} registrado{(orders?.length ?? 0) !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/load-list">
              <Button variant="outline" data-testid="button-load-list">
                <FileText className="mr-2 h-4 w-4" /> Lista de Carga
              </Button>
            </Link>
            <Link href="/orders/new">
              <Button data-testid="button-new-order">
                <Plus className="mr-2 h-4 w-4" /> Nuevo Pedido
              </Button>
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
          </div>
        ) : (orders ?? []).length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Sin pedidos</p>
              <p className="text-sm text-muted-foreground text-center">Registra tu primer pedido de venta.</p>
              <Link href="/orders/new">
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" /> Nuevo Pedido
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {(orders ?? []).map((o) => {
              const statusCfg = STATUS_CONFIG[o.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
              const StatusIcon = statusCfg.icon;
              return (
                <Link key={o.id} href={`/orders/${o.id}`}>
                  <Card className="hover-elevate cursor-pointer" data-testid={`card-order-${o.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-start gap-4 flex-1 min-w-0">
                          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 shrink-0">
                            <FileText className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-foreground">{o.folio}</span>
                              <Badge variant={statusCfg.variant} className="text-[10px] flex items-center gap-1">
                                <StatusIcon className="h-2.5 w-2.5" />
                                {statusCfg.label}
                              </Badge>
                              <Badge variant="secondary" className="text-[10px]">
                                {o.itemCount} prod.
                              </Badge>
                            </div>
                            <p className="text-sm text-foreground mt-0.5 truncate">{o.customerName}</p>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                              <Calendar className="h-3 w-3" />
                              {formatDate(o.orderDate)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Total</p>
                            <p className="text-base font-bold text-foreground">
                              ${parseFloat(o.total).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
