import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { VendedorLayout } from "./layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronRight, CheckCircle2, Clock, XCircle,
  FileText, Calendar, TrendingUp, Users,
} from "lucide-react";

const fmt = (v: string | number) => "$" + Math.round(Number(v)).toLocaleString("es-MX");

const STATUS_CONFIG = {
  draft:     { label: "Borrador",  icon: Clock,         variant: "secondary"    as const },
  approved:  { label: "Aprobado",  icon: CheckCircle2,  variant: "default"      as const },
  cancelled: { label: "Cancelado", icon: XCircle,       variant: "destructive"  as const },
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

function formatDate(s: string) {
  return new Date(s.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", {
    weekday: "long", day: "2-digit", month: "long",
  });
}

function formatRemito(order: VendedorOrder) {
  if (order.remitoNum != null) return `VA-${String(order.remitoNum).padStart(6, "0")}`;
  const m = (order.folio ?? "").match(/^(?:VA|PV)-?(\d+)$/);
  return m ? `VA-${m[1].padStart(6, "0")}` : (order.folio || "-");
}

export default function VendedorOrders() {
  const today = localStr(new Date());
  const [date, setDate] = useState(today);

  const { data: orders = [], isLoading } = useQuery<VendedorOrder[]>({
    queryKey: ["/api/vendedor/orders", date],
    queryFn: () => fetch(`/api/vendedor/orders?date=${date}`).then((r) => r.json()),
  });

  const approved = orders.filter((o) => o.status === "approved");

  // Commission always on total sin IVA (o.total = sum of subtotals without IVA)
  const totalVendido = approved.reduce((s, o) => s + parseFloat(o.total || "0"), 0);
  const totalConIvaSum = approved.reduce((s, o) => {
    return s + (o.hasIva ? parseFloat(o.totalConIva || "0") : parseFloat(o.total || "0"));
  }, 0);
  const totalComisiones = approved.reduce((s, o) => {
    const pct = parseFloat(o.commissionPct || "0") / 100;
    return s + parseFloat(o.total || "0") * pct;
  }, 0);
  const customerCount = new Set(approved.map((o) => o.customerName)).size;

  return (
    <VendedorLayout title="Pedidos">
      <div className="p-6 space-y-5">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Mis Pedidos</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Vista por fecha</p>
          </div>
        </div>

        {/* Date picker */}
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Fecha</Label>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-40"
              />
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setDate(today)}>Hoy</Button>
        </div>

        {/* Day summary */}
        {!isLoading && approved.length > 0 && (
          <Card className="border-primary/20 bg-primary/5">
            <div className="px-4 pt-4 pb-2">
              <p className="text-sm font-semibold text-primary flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Resumen del Día
                <span className="text-xs font-normal text-muted-foreground ml-1">
                  {formatDate(date)}
                </span>
              </p>
            </div>
            <CardContent className="pb-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-md bg-background border border-border p-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Vendido</p>
                  <p className="text-lg font-bold text-foreground mt-1">{fmt(totalConIvaSum)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">incl. IVA según cliente</p>
                </div>
                <div className="rounded-md bg-background border border-border p-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Comisión</p>
                  <p className="text-lg font-bold text-green-600 dark:text-green-400 mt-1">{fmt(totalComisiones)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">sobre neto sin IVA</p>
                </div>
                <div className="rounded-md bg-background border border-border p-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Pedidos / Clientes</p>
                  <p className="text-lg font-bold text-foreground mt-1">{approved.length}</p>
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
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
          </div>
        ) : orders.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-14 gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Sin pedidos para esta fecha</p>
              <p className="text-sm text-muted-foreground">No hay pedidos registrados para el {formatDate(date)}.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => {
              const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.draft;
              const StatusIcon = cfg.icon;
              const commPct = parseFloat(order.commissionPct || "0");
              // Commission on total without IVA
              const comision = parseFloat(order.total || "0") * (commPct / 100);
              const vendidoDisplay = order.hasIva
                ? parseFloat(order.totalConIva || "0")
                : parseFloat(order.total || "0");

              return (
                <Link key={order.id} href={`/vendedor/orders/${order.id}`}>
                  <Card className="hover-elevate cursor-pointer">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-start gap-4 flex-1 min-w-0">
                          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 shrink-0">
                            <FileText className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={cfg.variant} className="text-[10px] flex items-center gap-1">
                                <StatusIcon className="h-2.5 w-2.5" />
                                {cfg.label}
                              </Badge>
                              <Badge variant="secondary" className="text-[10px]">
                                {order.itemCount} prod.
                              </Badge>
                              {order.hasIva && (
                                <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
                                  Con IVA
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm font-semibold text-foreground mt-1 truncate">
                              {order.customerName}
                            </p>
                            <div className="flex flex-wrap items-center gap-3 mt-0.5">
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Calendar className="h-3 w-3" />
                                {formatDate(order.orderDate)}
                              </span>
                              <span className="text-xs text-muted-foreground font-mono">
                                Remito: <span className="font-semibold text-foreground">{formatRemito(order)}</span>
                              </span>
                              {commPct > 0 && order.status === "approved" && (
                                <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                                  Comisión: {fmt(comision)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">
                              {order.hasIva ? "Total + IVA" : "Total"}
                            </p>
                            <p className="text-base font-bold text-foreground">{fmt(vendidoDisplay)}</p>
                            {order.hasIva && (
                              <p className="text-[10px] text-muted-foreground">
                                Neto: {fmt(order.total)}
                              </p>
                            )}
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
    </VendedorLayout>
  );
}
