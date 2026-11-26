// Detalle de pedido del vendedor. 17/11: estilo del admin (solo presentación; misma lógica y mismo PDF).
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { VendedorLayout } from "./layout";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { generateRemitoPDF } from "@/lib/pdf";
import type { Customer } from "@shared/schema";
import { ivaRateOf, hasIvaOn } from "@shared/iva";
import { fmtDecimal, fmtCantidad } from "@/lib/format";
import { VX_CSS } from "./rx";

const fmtMoney = (v: string | number) => "$" + fmtDecimal(v);
// La tasa de IVA sale de product.iva_rate (helper compartido). Ver M6.

const STATUS_CONFIG = {
  draft:     { label: "Borrador",  cls: "par" },
  approved:  { label: "Aprobado",  cls: "ok" },
  cancelled: { label: "Cancelado", cls: "bad" },
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
  const [, setLocation] = useLocation();
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
        <div className="vx"><style>{VX_CSS}</style><div className="vx-wrap space-y-4">
          <Skeleton className="h-8 w-32" /><Skeleton className="h-32 w-full rounded-2xl" /><Skeleton className="h-64 w-full rounded-2xl" />
        </div></div>
      </VendedorLayout>
    );
  }

  if (!order) {
    return (
      <VendedorLayout title="Pedido">
        <div className="vx"><style>{VX_CSS}</style><div className="vx-wrap">
          <div className="vx-empty"><div className="vx-emptyic"><FileText className="h-6 w-6" /></div><div className="big">No se encontró el pedido.</div></div>
        </div></div>
      </VendedorLayout>
    );
  }

  const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.draft;
  const remitoStr =
    order.remitoNum != null
      ? `VA-${String(order.remitoNum).padStart(6, "0")}`
      : order.folio || "-";
  const conIva = hasIvaOn(order.customer, order.orderDate, (order as any).ivaOverride ?? null);

  const totalConIva = conIva
    ? order.items.reduce((sum, item) => {
        if (!item.pricePerUnit || parseFloat(item.pricePerUnit) === 0) return sum;
        const sub = parseFloat(item.quantity) * parseFloat(item.pricePerUnit);
        return sum + sub * (1 + ivaRateOf((item as any).product));
      }, 0)
    : parseFloat(order.total);

  const formatDate = (s: string) =>
    new Date(s.slice(0, 10) + "T12:00:00").toLocaleDateString("es-AR", {
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
        source: (order as any).source ?? null,
        customer: {
          name: order.customer.name,
          hasIva: conIva,
          rfc: order.customer.rfc,
          address: order.customer.address,
          city: order.customer.city,
          phone: order.customer.phone,
        },
        items: order.items.map((item) => ({
          product: item.product ?? null,
          productId: (item as any).productId ?? null,
          quantity: item.quantity,
          unit: item.unit,
          pricePerUnit: item.pricePerUnit ?? "0",
          subtotal: item.subtotal,
          isBonification: item.isBonification,
          aliasNombre: (item as any).aliasNombre ?? null,
        })),
        total: order.total,
      },
    });
  };

  return (
    <VendedorLayout title={`Pedido ${remitoStr}`}>
      <div className="vx">
        <style>{VX_CSS}</style>
        <div className="vx-wrap">
          <button className="vx-back" onClick={() => setLocation("/vendedor/orders")}><ArrowLeft className="h-4 w-4" /> Volver a pedidos</button>

          <div className="vx-card">
            <div className="vx-detail-head">
              <div style={{ minWidth: 0 }}>
                <div className="vx-ptags">
                  <span className={`vx-chip ${cfg.cls}`}><i />{cfg.label}</span>
                  <span className="vx-chip gris">{order.items.length} productos</span>
                  {conIva && <span className="vx-chip iva">Con IVA</span>}
                </div>
                <div className="name">{order.customer.name}</div>
                <div className="meta" style={{ textTransform: "capitalize" }}>
                  <span>{formatDate(order.orderDate)}</span>
                  <span style={{ textTransform: "none" }}>· Remito <b className="vx-mono" style={{ color: "#1e2420", fontWeight: 600 }}>{remitoStr}</b></span>
                  <span className="vx-mono" style={{ textTransform: "none" }}>· Folio {order.folio}</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
                <div className="tot" style={{ textAlign: "right" }}>
                  <div className="rl">{conIva ? "Total + IVA" : "Total"}</div>
                  <div className="rv">{fmtMoney(totalConIva)}</div>
                  {conIva && <div className="rs">Neto: {fmtMoney(order.total)}</div>}
                </div>
                {order.status === "approved" && (
                  <button className="vx-btn primary" onClick={handleDownloadRemito} data-testid="button-download-remito"><Download className="h-4 w-4" /> Descargar remito</button>
                )}
              </div>
            </div>
          </div>

          <div className="vx-card">
            <div className="vx-tblwrap">
              <table className="vx-tbl" style={{ marginTop: 14 }}>
                <thead><tr>
                  <th className="l">Producto</th><th>Cant.</th><th className="l">Un.</th><th>Precio</th><th>Subtotal</th>
                </tr></thead>
                <tbody>
                  {order.items.map((item) => {
                    const productName = item.product?.name ?? item.rawProductName ?? "—";
                    const isBonif = !!item.isBonification;
                    const isBolsa = !!item.bolsaType;
                    const price = parseFloat(item.pricePerUnit ?? "0");
                    const subtotal = parseFloat(item.subtotal);
                    const qty = parseFloat(item.quantity);
                    return (
                      <tr key={item.id}>
                        <td className="l" style={{ whiteSpace: "normal" }}>
                          <span style={isBolsa ? { color: "#8b8f88", fontStyle: "italic" } : undefined}>{productName}</span>
                          {isBolsa && <span className="vx-chip info" style={{ marginLeft: 6 }}>{item.bolsaType === "bolsa_propia" ? "Bolsa propia" : "Bolsa"}</span>}
                          {isBonif && <span className="vx-chip line" style={{ marginLeft: 6, color: "#7c5cbf", borderColor: "#d9cdf2" }}>Bonificación</span>}
                        </td>
                        <td>{fmtCantidad(qty)}</td>
                        <td className="l mut">{item.unit}</td>
                        <td className={isBonif ? "" : price === 0 ? "dash" : ""} style={isBonif ? { color: "#7c5cbf", fontWeight: 600 } : undefined}>
                          {isBonif ? "$0" : price === 0 ? "—" : fmtMoney(price)}
                        </td>
                        <td className={price === 0 && !isBonif ? "dash" : ""} style={{ fontWeight: 600 }}>
                          {price === 0 && !isBonif ? "—" : fmtMoney(subtotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr>
                  <td className="l" colSpan={4}>Total{conIva ? " c/IVA" : ""}</td>
                  <td className="vx-num" style={{ fontSize: 17 }}>{fmtMoney(totalConIva)}</td>
                </tr></tfoot>
              </table>
            </div>
          </div>

          {order.notes && (
            <div className="vx-notes"><b>Notas: </b><span style={{ color: "#4b5048" }}>{order.notes}</span></div>
          )}
        </div>
      </div>
    </VendedorLayout>
  );
}
