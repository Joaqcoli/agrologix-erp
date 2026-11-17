// Pedidos del vendedor. 17/11: mismo estilo que Pedidos del admin (solo presentación; misma lógica).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { VendedorLayout } from "./layout";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, FileText, Calendar, TrendingUp } from "lucide-react";
import { fmtPesos } from "@/lib/format";
import { VX_CSS, formatRemito } from "./rx";

const fmt = fmtPesos;

const STATUS_CONFIG = {
  draft:     { label: "Borrador",  cls: "par" },
  approved:  { label: "Aprobado",  cls: "ok" },
  cancelled: { label: "Cancelado", cls: "bad" },
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
  commissionPct: string;      // 16/11: % fijado en el pedido (5 | 1), ya no el del cliente
  comisionSaldada: boolean;   // pedidos de Juan hasta el 31/10/2026: comisionados por facturación
  itemCount: number;
  totalConIva: string;
};

function localStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(s: string) {
  return new Date(s.slice(0, 10) + "T12:00:00").toLocaleDateString("es-AR", {
    weekday: "long", day: "2-digit", month: "long",
  });
}

export default function VendedorOrders() {
  const today = localStr(new Date());
  const [date, setDate] = useState(today);

  const { data: orders = [], isLoading } = useQuery<VendedorOrder[]>({
    queryKey: ["/api/vendedor/orders", date],
    queryFn: () => fetch(`/api/vendedor/orders?date=${date}`).then((r) => r.json()),
  });

  const approved = orders.filter((o) => o.status === "approved");

  // All amounts in sin IVA (o.total = sum of subtotals without IVA)
  const totalVendido = approved.reduce((s, o) => s + parseFloat(o.total || "0"), 0);
  const totalComisiones = approved.reduce((s, o) => {
    const pct = parseFloat(o.commissionPct || "0") / 100;
    return s + parseFloat(o.total || "0") * pct;
  }, 0);
  const customerCount = new Set(approved.map((o) => o.customerName)).size;

  return (
    <VendedorLayout title="Pedidos">
      <div className="vx">
        <style>{VX_CSS}</style>
        <div className="vx-wrap">
          <div className="vx-top">
            <div>
              <h1 className="vx-title">Mis pedidos</h1>
              <div className="vx-subtitle" style={{ textTransform: "capitalize" }}>{formatDate(date)}</div>
            </div>
            <div className="vx-controls">
              <Calendar className="h-4 w-4" style={{ color: "#8b8f88" }} />
              <input type="date" className="vx-input" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-date" />
              <button className="vx-btn" onClick={() => setDate(today)}>Hoy</button>
            </div>
          </div>

          {!isLoading && approved.length > 0 && (
            <div className="vx-kpis">
              <div className="vx-kpi">
                <div className="lab">Total vendido</div>
                <div className="val">{fmt(totalVendido)}</div>
                <div className="note">neto sin IVA</div>
              </div>
              <div className="vx-kpi main">
                <div className="lab">Comisión devengada</div>
                <div className="val">{fmt(totalComisiones)}</div>
                <div className="note">se habilita cuando el cliente paga</div>
              </div>
              <div className="vx-kpi">
                <div className="lab">Pedidos</div>
                <div className="val">{approved.length}</div>
                <div className="note">{customerCount} cliente{customerCount !== 1 ? "s" : ""}</div>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="vx-plist">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}</div>
          ) : orders.length === 0 ? (
            <div className="vx-empty">
              <div className="vx-emptyic"><FileText className="h-6 w-6" /></div>
              <div className="big">Sin pedidos para esta fecha</div>
              <div>No hay pedidos registrados para el {formatDate(date)}.</div>
            </div>
          ) : (
            <div className="vx-plist">
              {orders.map((order) => {
                const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.draft;
                const commPct = parseFloat(order.commissionPct || "0");
                const comision = parseFloat(order.total || "0") * (commPct / 100);
                return (
                  <Link key={order.id} href={`/vendedor/orders/${order.id}`} className="vx-pedido" data-testid={`card-order-${order.id}`}>
                      <div className={`vx-pic${order.status === "approved" ? " ok" : ""}`}><FileText className="h-5 w-5" /></div>
                      <div className="vx-pmid">
                        <div className="vx-ptags">
                          <span className={`vx-chip ${cfg.cls}`}><i />{cfg.label}</span>
                          <span className="vx-chip gris">{order.itemCount} prod.</span>
                          {order.hasIva && <span className="vx-chip iva">IVA</span>}
                        </div>
                        <div className="vx-pname">{order.customerName}</div>
                        <div className="vx-pmeta">
                          <span>Remito <span className="rem vx-mono">{formatRemito(order)}</span></span>
                          {commPct > 0 && order.status === "approved" && (
                            <span className="com">Comisión {commPct} %: {fmt(comision)}{order.comisionSaldada ? " (saldada)" : ""}</span>
                          )}
                        </div>
                      </div>
                      <div className="vx-pright">
                        <div className="rl">Total</div>
                        <div className="rv vx-num">{fmt(order.total)}</div>
                      </div>
                      <div className="vx-chev"><ChevronRight className="h-5 w-5" /></div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </VendedorLayout>
  );
}
