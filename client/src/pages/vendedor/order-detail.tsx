import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { VendedorLayout } from "./layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Download, CheckCircle2, Clock, XCircle, FileText, Calendar } from "lucide-react";
import { generateRemitoPDF } from "@/lib/pdf";
import type { Customer } from "@shared/schema";

const fmt = (v: string | number, dec = 2) =>
  Number(v).toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtMoney = (v: string | number) => "$" + fmt(v);

function getIvaRate(name: string) {
  return /huevo/i.test(name) ? 0.21 : 0.105;
}

const STATUS_CONFIG = {
  draft:     { label: "Borrador",  icon: Clock,        variant: "secondary"   as const },
  approved:  { label: "Aprobado",  icon: CheckCircle2, variant: "default"     as const },
  cancelled: { label: "Cancelado", icon: XCircle,      variant: "destructive" as const },
};

type SafeItem = {
  id: number;
  productId: number | null;
  quantity: string;
  unit: string;
  pricePerUnit: string | null;
  subtotal: string;
  rawProductName: string | null;
  bolsaType: string | null;
  isBonification: boolean | null;
  product?: { name: string; sku: string } | null;
};

type FullOrder = {
  id: number;
  folio: string;
  orderDate: string;
  status: "draft" | "approved" | "cancelled";
  total: string;
  remitoNum: number | null;
  notes: string | null;
  customer: Customer;
  items: SafeItem[];
};

export default function VendedorOrderDetail({ id }: { id: number }) {
  const { data: order, isLoading } = useQuery<FullOrder>({
    queryKey: ["/api/vendedor/orders", id],
    queryFn: () =>
      fetch(`/api/vendedor/orders/${id}`).then((r) => {
        if (!r.ok) throw new Error("No autorizado");
        return r.json();
      }),
  });

  if (isLoading) {
    return (
      <VendedorLayout title="Pedido">
        <div className="p-6 space-y-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </VendedorLayout>
    );
  }

  if (!order) {
    return (
      <VendedorLayout title="Pedido">
        <div className="p-6 flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <FileText className="h-10 w-10" />
          <p className="text-sm">No se encontró el pedido.</p>
        </div>
      </VendedorLayout>
    );
  }

  const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.draft;
  const StatusIcon = cfg.icon;
  const remitoStr =
    order.remitoNum != null
      ? `VA-${String(order.remitoNum).padStart(6, "0")}`
      : order.folio || "-";

  const totalConIva = order.customer.hasIva
    ? order.items.reduce((sum, item) => {
        if (!item.pricePerUnit || parseFloat(item.pricePerUnit) === 0) return sum;
        const sub = parseFloat(item.quantity) * parseFloat(item.pricePerUnit);
        const name = item.product?.name ?? item.rawProductName ?? "";
        return sum + sub * (1 + getIvaRate(name));
      }, 0)
    : parseFloat(order.total);

  const formatDate = (s: string) =>
    new Date(s.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });

  const handleDownloadRemito = async () => {
    await generateRemitoPDF({
      folio: remitoStr,
      issuedAt: new Date(),
      order: {
        folio: order.folio,
        orderDate: order.orderDate,
        notes: order.notes,
        customer: {
          name: order.customer.name,
          hasIva: order.customer.hasIva,
          rfc: order.customer.rfc,
          address: order.customer.address,
          city: order.customer.city,
          phone: order.customer.phone,
        },
        items: order.items.map((item) => ({
          product: item.product ?? null,
          quantity: item.quantity,
          unit: item.unit,
          pricePerUnit: item.pricePerUnit ?? "0",
          subtotal: item.subtotal,
          isBonification: item.isBonification,
        })),
        total: order.total,
      },
    });
  };

  return (
    <VendedorLayout title={`Pedido ${remitoStr}`}>
      <div className="p-6 space-y-4">

        {/* Back */}
        <Link href="/vendedor/orders">
          <Button variant="ghost" size="sm" className="-ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Volver a pedidos
          </Button>
        </Link>

        {/* Order header card */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 shrink-0">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Badge variant={cfg.variant} className="flex items-center gap-1">
                      <StatusIcon className="h-3 w-3" />
                      {cfg.label}
                    </Badge>
                    <Badge variant="secondary">{order.items.length} productos</Badge>
                    {order.customer.hasIva && (
                      <Badge variant="outline" className="text-primary border-primary/40">Con IVA</Badge>
                    )}
                  </div>
                  <p className="text-lg font-semibold text-foreground">{order.customer.name}</p>
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(order.orderDate)}
                    </span>
                    <span className="font-mono">
                      Remito: <span className="font-semibold text-foreground">{remitoStr}</span>
                    </span>
                    <span className="font-mono text-muted-foreground">
                      Folio: {order.folio}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">{order.customer.hasIva ? "Total + IVA" : "Total"}</p>
                  <p className="text-2xl font-bold text-foreground">{fmtMoney(totalConIva)}</p>
                  {order.customer.hasIva && (
                    <p className="text-xs text-muted-foreground">Neto: {fmtMoney(order.total)}</p>
                  )}
                </div>
                {order.status === "approved" && (
                  <Button size="sm" onClick={handleDownloadRemito}>
                    <Download className="h-4 w-4 mr-1.5" />
                    Descargar Remito
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Items table */}
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="py-2.5 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Producto</th>
                  <th className="py-2.5 px-3 text-right font-medium text-muted-foreground text-xs uppercase tracking-wide">Cant.</th>
                  <th className="py-2.5 px-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Un.</th>
                  <th className="py-2.5 px-3 text-right font-medium text-muted-foreground text-xs uppercase tracking-wide">Precio</th>
                  <th className="py-2.5 px-4 text-right font-medium text-muted-foreground text-xs uppercase tracking-wide">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => {
                  const productName = item.product?.name ?? item.rawProductName ?? "—";
                  const isBonif = !!item.isBonification;
                  const isBolsa = !!item.bolsaType;
                  const price = parseFloat(item.pricePerUnit ?? "0");
                  const subtotal = parseFloat(item.subtotal);
                  const qty = parseFloat(item.quantity);

                  return (
                    <tr key={item.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-4">
                        <span className={isBolsa ? "text-muted-foreground italic" : ""}>
                          {productName}
                        </span>
                        {isBolsa && (
                          <span className="ml-1.5 text-xs text-blue-500">
                            ({item.bolsaType === "bolsa_propia" ? "Bolsa propia" : "Bolsa"})
                          </span>
                        )}
                        {isBonif && (
                          <Badge variant="outline" className="ml-1.5 text-purple-600 border-purple-300 text-[10px]">
                            Bonificación
                          </Badge>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {fmt(qty, qty % 1 === 0 ? 0 : 2)}
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground">{item.unit}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {isBonif ? (
                          <span className="text-purple-600 font-medium">$0</span>
                        ) : price === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          fmtMoney(price)
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-medium">
                        {price === 0 && !isBonif ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          fmtMoney(subtotal)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30 border-t border-border">
                  <td colSpan={3} className="py-3 px-4" />
                  <td className="py-3 px-3 text-right font-semibold text-sm">Total</td>
                  <td className="py-3 px-4 text-right">
                    <span className="text-lg font-bold">{fmtMoney(totalConIva)}</span>
                    {order.customer.hasIva && (
                      <span className="text-xs text-muted-foreground ml-1">c/IVA</span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>

        {order.notes && (
          <Card>
            <CardContent className="py-3 px-4 text-sm">
              <span className="font-medium text-foreground">Notas: </span>
              <span className="text-muted-foreground">{order.notes}</span>
            </CardContent>
          </Card>
        )}
      </div>
    </VendedorLayout>
  );
}
