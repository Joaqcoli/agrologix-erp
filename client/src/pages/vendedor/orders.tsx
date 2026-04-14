import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { VendedorLayout } from "./layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ChevronRight, CheckCircle2, Clock, XCircle } from "lucide-react";

const fmt = (v: string | number) =>
  "$" + Math.round(Number(v)).toLocaleString("es-MX");

const STATUS_CONFIG = {
  draft:     { label: "Borrador", icon: Clock, variant: "secondary" as const },
  approved:  { label: "Aprobado", icon: CheckCircle2, variant: "default" as const },
  cancelled: { label: "Cancelado", icon: XCircle, variant: "destructive" as const },
};

type VendedorOrder = {
  id: number;
  folio: string;
  orderDate: string;
  status: "draft" | "approved" | "cancelled";
  total: string;
  remitoNum: number | null;
  customerName: string;
  hasIva: boolean;
  commissionPct: string;
  itemCount: number;
  totalConIva: string;
};

function localStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function VendedorOrders() {
  const d0 = new Date();
  const today = localStr(d0);
  const [date, setDate] = useState(today);

  const { data: orders = [], isLoading } = useQuery<VendedorOrder[]>({
    queryKey: ["/api/vendedor/orders", date],
    queryFn: () => fetch(`/api/vendedor/orders?date=${date}`).then((r) => r.json()),
  });

  const approved = orders.filter((o) => o.status === "approved");
  const totalVendido = approved.reduce((s, o) => s + parseFloat(o.totalConIva), 0);
  const totalComisiones = approved.reduce((s, o) => {
    const pct = parseFloat(o.commissionPct || "0") / 100;
    return s + parseFloat(o.totalConIva) * pct;
  }, 0);

  return (
    <VendedorLayout title="Pedidos">
      <div className="p-6 space-y-4">
        {/* Date picker */}
        <div className="flex items-center gap-3">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-44"
          />
          <Button variant="outline" size="sm" onClick={() => setDate(today)}>
            Hoy
          </Button>
        </div>

        {/* Day summary */}
        {approved.length > 0 && (
          <div className="flex gap-4 text-sm text-muted-foreground">
            <span>
              Vendido: <span className="font-semibold text-foreground">{fmt(totalVendido)}</span>
            </span>
            <span>·</span>
            <span>
              Comisión: <span className="font-semibold text-foreground">{fmt(totalComisiones)}</span>
            </span>
            <span>·</span>
            <span>{approved.length} pedido{approved.length !== 1 ? "s" : ""} aprobado{approved.length !== 1 ? "s" : ""}</span>
          </div>
        )}

        {/* Orders list */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : orders.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No hay pedidos para este día
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {orders.map((order) => {
              const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.draft;
              const StatusIcon = cfg.icon;
              const remitoStr = order.remitoNum != null
                ? `VA-${String(order.remitoNum).padStart(6, "0")}`
                : order.folio || "-";
              const commPct = parseFloat(order.commissionPct || "0");
              const comision = parseFloat(order.totalConIva) * (commPct / 100);

              return (
                <Link key={order.id} href={`/vendedor/orders/${order.id}`}>
                  <Card className="cursor-pointer hover:bg-muted/30 transition-colors">
                    <CardContent className="py-3 px-4 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-medium text-sm truncate">{order.customerName}</span>
                          <Badge variant={cfg.variant} className="text-xs shrink-0">
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {cfg.label}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span>{remitoStr}</span>
                          <span>·</span>
                          <span>{order.itemCount} ítem{order.itemCount !== 1 ? "s" : ""}</span>
                          {commPct > 0 && order.status === "approved" && (
                            <>
                              <span>·</span>
                              <span>Comisión: {fmt(comision)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-sm">{fmt(order.totalConIva)}</p>
                        {order.hasIva && (
                          <p className="text-xs text-muted-foreground">c/IVA</p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </VendedorLayout>
  );
}
