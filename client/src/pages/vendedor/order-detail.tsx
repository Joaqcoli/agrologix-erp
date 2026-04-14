import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { VendedorLayout } from "./layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Download, CheckCircle2, Clock, XCircle } from "lucide-react";
import { generateRemitoPDF } from "@/lib/pdf";
import type { Customer } from "@shared/schema";

const fmt = (v: string | number, dec = 2) =>
  Number(v).toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtMoney = (v: string | number) => "$" + fmt(v);

const IVA_HUEVO = 0.21;
const IVA_DEFAULT = 0.105;
function getIvaRate(name: string) {
  return /huevo/i.test(name) ? IVA_HUEVO : IVA_DEFAULT;
}

const STATUS_CONFIG = {
  draft:     { label: "Borrador", icon: Clock, variant: "secondary" as const },
  approved:  { label: "Aprobado", icon: CheckCircle2, variant: "default" as const },
  cancelled: { label: "Cancelado", icon: XCircle, variant: "destructive" as const },
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
    queryFn: () => fetch(`/api/vendedor/orders/${id}`).then((r) => {
      if (!r.ok) throw new Error("No autorizado");
      return r.json();
    }),
  });

  if (isLoading) {
    return (
      <VendedorLayout title="Pedido">
        <div className="p-6 space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 w-full" />
        </div>
      </VendedorLayout>
    );
  }

  if (!order) {
    return (
      <VendedorLayout title="Pedido">
        <div className="p-6 text-muted-foreground">No se encontró el pedido.</div>
      </VendedorLayout>
    );
  }

  const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.draft;
  const StatusIcon = cfg.icon;
  const remitoStr = order.remitoNum != null
    ? `VA-${String(order.remitoNum).padStart(6, "0")}`
    : order.folio || "-";

  // Calculate total with IVA
  const totalConIva = order.customer.hasIva
    ? order.items.reduce((sum, item) => {
        if (!item.pricePerUnit || parseFloat(item.pricePerUnit) === 0) return sum;
        const subtotal = parseFloat(item.quantity) * parseFloat(item.pricePerUnit);
        const productName = item.product?.name ?? item.rawProductName ?? "";
        return sum + subtotal * (1 + getIvaRate(productName));
      }, 0)
    : parseFloat(order.total);

  const handleDownloadRemito = async () => {
    const folio = remitoStr;
    await generateRemitoPDF({
      folio,
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
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/vendedor/orders">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Volver
            </Button>
          </Link>
        </div>

        {/* Order summary */}
        <Card>
          <CardContent className="py-4 px-4 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="font-semibold text-lg">{order.customer.name}</p>
                <p className="text-sm text-muted-foreground">
                  {new Date(order.orderDate).toLocaleDateString("es-MX", {
                    weekday: "long", year: "numeric", month: "long", day: "numeric",
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={cfg.variant}>
                  <StatusIcon className="h-3 w-3 mr-1" />
                  {cfg.label}
                </Badge>
                {order.status === "approved" && (
                  <Button size="sm" variant="outline" onClick={handleDownloadRemito}>
                    <Download className="h-4 w-4 mr-1" />
                    Remito PDF
                  </Button>
                )}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Folio: {order.folio} · Remito: {remitoStr}
            </div>
          </CardContent>
        </Card>

        {/* Items table */}
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="py-2 px-3 text-left font-medium text-muted-foreground">Producto</th>
                  <th className="py-2 px-3 text-right font-medium text-muted-foreground">Cant.</th>
                  <th className="py-2 px-3 text-left font-medium text-muted-foreground">Un.</th>
                  <th className="py-2 px-3 text-right font-medium text-muted-foreground">Precio</th>
                  <th className="py-2 px-3 text-right font-medium text-muted-foreground">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => {
                  const productName = item.product?.name ?? item.rawProductName ?? "—";
                  const isBonif = !!item.isBonification;
                  const isBolsa = !!item.bolsaType;
                  const price = parseFloat(item.pricePerUnit ?? "0");
                  const subtotal = parseFloat(item.subtotal);

                  return (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="py-2 px-3">
                        <span className={isBolsa ? "text-muted-foreground italic" : ""}>
                          {productName}
                          {isBolsa && (
                            <span className="ml-1 text-xs text-blue-500">
                              ({item.bolsaType === "bolsa_propia" ? "Bolsa propia" : "Bolsa"})
                            </span>
                          )}
                          {isBonif && (
                            <Badge variant="outline" className="ml-1 text-purple-600 border-purple-300 text-[10px]">
                              Bonificación
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right">
                        {fmt(item.quantity, Number(item.quantity) % 1 === 0 ? 0 : 2)}
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{item.unit}</td>
                      <td className="py-2 px-3 text-right">
                        {isBonif ? (
                          <span className="text-purple-600">$0</span>
                        ) : price === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          fmtMoney(price)
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-medium">
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
                <tr className="bg-muted/30">
                  <td colSpan={3} className="py-2 px-3" />
                  <td className="py-2 px-3 text-right font-semibold text-sm">Total</td>
                  <td className="py-2 px-3 text-right font-bold text-base">
                    {fmtMoney(totalConIva)}
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
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Notas:</span> {order.notes}
          </div>
        )}
      </div>
    </VendedorLayout>
  );
}
