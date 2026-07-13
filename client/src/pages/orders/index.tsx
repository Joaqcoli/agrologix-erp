import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import { Plus, FileText, Calendar, ChevronRight, CheckCircle2, Clock, XCircle, TrendingUp, Download, Users, Trash2 } from "lucide-react";
import type { Order } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

type OrderSummary = Order & {
  customerName: string;
  itemCount: number;
  suggestedRemito: string;
  hasIva: boolean;
  totalConIva: string;
  totalCosto: string;
};

const STATUS_CONFIG = {
  draft:     { label: "Borrador", icon: Clock, variant: "secondary" as const },
  approved:  { label: "Aprobado", icon: CheckCircle2, variant: "default" as const },
  cancelled: { label: "Cancelado", icon: XCircle, variant: "destructive" as const },
};

import { fmtDecimal } from "@/lib/format";
const fmt = (v: number) => fmtDecimal(v);

const formatRemito = (order: { remitoNum?: number | null; folio?: string | null }) => {
  if (order.remitoNum != null) return `VA-${String(order.remitoNum).padStart(6, "0")}`;
  const f = order.folio ?? "";
  const m = f.match(/^(?:VA|PV)-?(\d+)$/);
  return m ? `VA-${m[1].padStart(6, "0")}` : (f || "-");
};

// ── Rediseño Pedidos (Claude Design) — CSS de diseno-caja/pedidos-rediseno.html ──
const PDX_CSS = `
.pedidos-rx{background:#f4f4f1;min-height:100%;padding:30px 24px 56px;font-family:'Inter',system-ui,sans-serif;color:#1e2420;}
.pedidos-rx *{box-sizing:border-box;}
.pdx-wrap{max-width:1180px;margin:0 auto;}
.pdx-num{font-family:'Bricolage Grotesque','Inter',sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.pdx-mono{font-family:ui-monospace,Menlo,Consolas,monospace;}
.pdx-pagehead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:24px;flex-wrap:wrap;}
.pdx-pagehead h1{font-family:'Bricolage Grotesque';font-size:27px;font-weight:700;margin:0;letter-spacing:-.02em;}
.pdx-pagehead .sub{font-size:14px;color:#8b8f88;margin:5px 0 0;}
.pdx-actions{display:flex;gap:10px;flex-wrap:wrap;}
.pdx-btn{border:1px solid #ecece8;background:#fff;color:#1e2420;font-family:'Inter';font-size:13.5px;font-weight:500;padding:10px 15px;border-radius:11px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;white-space:nowrap;text-decoration:none;}
.pdx-btn:hover{border-color:#cfcfc9;background:#f6f6f2;}
.pdx-btn:disabled{opacity:.55;cursor:default;}
.pdx-btn.primary{background:#6b8a2a;color:#fff;border:none;font-weight:600;}
.pdx-btn.primary:hover{background:#5f7d24;}
.pdx-datefield{margin-bottom:22px;}
.pdx-datefield label{display:block;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#9a9e96;margin-bottom:9px;}
.pdx-datewrap{display:inline-flex;align-items:center;gap:10px;}
.pdx-datewrap>svg{color:#8b8f88;flex:0 0 auto;}
.pdx-datewrap input{font-family:'Inter';font-size:14px;padding:10px 13px;border:1px solid #ecece8;border-radius:10px;background:#fff;color:#1e2420;}
.pdx-datewrap input:focus{outline:none;border-color:#6b8a2a;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.pdx-resumen{background:#fbfaf7;border:1px solid #ecece8;border-radius:16px;padding:20px 22px;margin-bottom:26px;}
.pdx-rhead{display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap;}
.pdx-rhead .ic{color:#5f8020;display:flex;}
.pdx-rhead .t{font-family:'Bricolage Grotesque';font-size:16px;font-weight:700;color:#5f8020;}
.pdx-rhead .d{font-size:13px;color:#8b8f88;text-transform:capitalize;}
.pdx-metrics{display:grid;grid-template-columns:repeat(4,1fr);}
@media(max-width:720px){.pdx-metrics{grid-template-columns:repeat(2,1fr);row-gap:18px;}}
.pdx-metric{padding:0 22px;border-left:1px solid #ecece6;}
.pdx-metric:first-child{padding-left:0;border-left:none;}
@media(max-width:720px){.pdx-metric{border-left:none;padding-left:0;}}
.pdx-metric .lab{font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9a9e96;margin-bottom:9px;}
.pdx-metric .val{font-size:24px;font-weight:700;line-height:1;}
.pdx-metric .val.pos{color:#5f8020;}
.pdx-metric .sub{font-size:12px;color:#8b8f88;margin-top:6px;}
.pdx-metric .sub.pos{color:#5f8020;font-weight:600;}
.pdx-plist{display:flex;flex-direction:column;gap:12px;}
.pdx-pwrap{position:relative;}
.pdx-pedido{display:grid;grid-template-columns:52px minmax(0,1fr) auto 24px;align-items:center;gap:16px;background:#fff;border:1px solid #ecece8;border-radius:15px;padding:18px 20px;cursor:pointer;transition:border-color .15s,box-shadow .15s;text-decoration:none;color:inherit;}
.pdx-pedido:hover{border-color:#d9d9d3;box-shadow:0 4px 14px -10px rgba(0,0,0,.25);}
.pdx-pic{width:46px;height:46px;border-radius:12px;background:#f2f2ec;color:#8f948a;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
.pdx-pmid{min-width:0;}
.pdx-ptags{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
.pdx-chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:20px;white-space:nowrap;}
.pdx-chip.aprob{background:#eef3e3;color:#5f8020;}
.pdx-chip.borr{background:#f9f1de;color:#c08a1e;}
.pdx-chip.canc{background:#fdf4f1;color:#c05e42;}
.pdx-chip.prod{background:#f1f1ec;color:#8b8f88;}
.pdx-chip.iva{background:#e9eff7;color:#3a67a3;}
.pdx-chip.galpon{background:#e9eff7;color:#3a67a3;}
.pdx-pname{font-family:'Bricolage Grotesque';font-size:18px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pdx-pmeta{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#8b8f88;margin-top:5px;flex-wrap:wrap;}
.pdx-pmeta .rem{color:#1e2420;font-weight:500;}
.pdx-pright{text-align:right;white-space:nowrap;}
.pdx-pright .rl{font-size:11.5px;color:#8b8f88;}
.pdx-pright .rv{font-size:19px;font-weight:700;margin-top:1px;}
.pdx-pright .neto{font-size:11.5px;color:#8b8f88;margin-top:2px;}
.pdx-chev{color:#c3c6be;display:flex;justify-content:flex-end;}
.pdx-del{position:absolute;top:12px;right:46px;opacity:0;transition:opacity .15s;padding:6px;border:none;background:none;color:#b3b6ae;cursor:pointer;border-radius:7px;z-index:2;}
.pdx-pwrap:hover .pdx-del{opacity:1;}
.pdx-del:hover{color:#c05e42;background:#fdf4f1;}
.pdx-empty{background:#fff;border:1px solid #ecece8;border-radius:16px;padding:48px 20px;text-align:center;color:#8b8f88;display:flex;flex-direction:column;align-items:center;gap:10px;}
.pdx-empty .big{font-size:15px;font-weight:600;color:#1e2420;}
.pdx-emptyic{width:48px;height:48px;border-radius:50%;background:#f1f1ec;display:flex;align-items:center;justify-content:center;color:#8b8f88;}
`;

export default function OrdersPage() {
  const { toast } = useToast();
  const d0 = new Date();
  const today = `${d0.getFullYear()}-${String(d0.getMonth()+1).padStart(2,"0")}-${String(d0.getDate()).padStart(2,"0")}`;
  const [date, setDate] = useState(today);
  const [exporting, setExporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OrderSummary | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", date] });
      queryClient.invalidateQueries({ queryKey: ["/api/load-list"] });
      toast({ title: "Pedido eliminado" });
      setDeleteTarget(null);
    },
    onError: (e: any) => {
      toast({ title: "Error al eliminar", description: e.message, variant: "destructive" });
      setDeleteTarget(null);
    },
  });

  const { data: orders, isLoading } = useQuery<OrderSummary[]>({
    queryKey: ["/api/orders", date],
    queryFn: async () => {
      const res = await fetch(`/api/orders?date=${date}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    enabled: !!date,
  });

  const formatDate = (d: string | Date) => {
    const s = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
    return new Date(s + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
  };

  // Day summary
  const dayOrders = orders ?? [];
  const totalVendido = dayOrders.reduce((sum, o) => {
    const val = o.hasIva ? parseFloat(o.totalConIva) : parseFloat(o.total);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);
  const totalCosto = dayOrders.reduce((sum, o) => sum + (parseFloat(o.totalCosto) || 0), 0);
  const margenDollar = totalVendido - totalCosto;
  const margenPct = totalVendido > 0 ? (margenDollar / totalVendido) * 100 : 0;
  const customerCount = new Set(dayOrders.map((o) => o.customerId)).size;

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/orders/export?date=${date}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al exportar");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Pedidos-${date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Error al exportar", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Layout title="Pedidos">
      <div className="pedidos-rx">
        <style>{PDX_CSS}</style>
        <div className="pdx-wrap">
          {/* Header */}
          <div className="pdx-pagehead">
            <div>
              <h1>Pedidos de Venta</h1>
              <p className="sub">Vista por fecha</p>
            </div>
            <div className="pdx-actions">
              <Link href="/load-list" className="pdx-btn" data-testid="button-load-list">
                <FileText className="h-[15px] w-[15px]" /> Lista de Carga
              </Link>
              <button className="pdx-btn" onClick={handleExport} disabled={exporting || dayOrders.length === 0} data-testid="button-export-day">
                <Download className="h-[15px] w-[15px]" /> {exporting ? "Exportando..." : "Exportar día"}
              </button>
              <Link href="/orders/new" className="pdx-btn primary" data-testid="button-new-order">
                <Plus className="h-[15px] w-[15px]" /> Nuevo Pedido
              </Link>
            </div>
          </div>

          {/* Fecha */}
          <div className="pdx-datefield">
            <label htmlFor="date-filter">Fecha</label>
            <div className="pdx-datewrap">
              <Calendar className="h-[17px] w-[17px]" />
              <input id="date-filter" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-date-filter" />
            </div>
          </div>

          {/* Resumen del Día (mismos números que hoy) */}
          {!isLoading && dayOrders.length > 0 && (
            <div className="pdx-resumen">
              <div className="pdx-rhead">
                <span className="ic"><TrendingUp className="h-[18px] w-[18px]" /></span>
                <span className="t">Resumen del día</span>
                <span className="d">{new Date(date + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "2-digit", month: "long" })}</span>
              </div>
              <div className="pdx-metrics">
                <div className="pdx-metric">
                  <div className="lab">Total vendido</div>
                  <div className="val pdx-num" data-testid="text-total-vendido">${fmt(totalVendido)}</div>
                  <div className="sub">incl. IVA según cliente</div>
                </div>
                <div className="pdx-metric">
                  <div className="lab">Total costo</div>
                  <div className="val pdx-num" data-testid="text-total-costo">${fmt(totalCosto)}</div>
                  <div className="sub">costo promedio ponderado</div>
                </div>
                <div className="pdx-metric">
                  <div className="lab">Margen</div>
                  <div className="val pos pdx-num" data-testid="text-margen-dia">${fmt(margenDollar)}</div>
                  <div className="sub pos pdx-num">{margenPct.toFixed(1)}%</div>
                </div>
                <div className="pdx-metric">
                  <div className="lab">Pedidos / clientes</div>
                  <div className="val pdx-num">{dayOrders.length}</div>
                  <div className="sub">{customerCount} cliente{customerCount !== 1 ? "s" : ""}</div>
                </div>
              </div>
            </div>
          )}

          {/* Lista de pedidos */}
          {isLoading ? (
            <div className="pdx-plist">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
            </div>
          ) : dayOrders.length === 0 ? (
            <div className="pdx-empty">
              <div className="pdx-emptyic"><FileText className="h-6 w-6" /></div>
              <div className="big">Sin pedidos para esta fecha</div>
              <div>No hay pedidos registrados para el {formatDate(date + "T12:00:00")}.</div>
              <Link href="/orders/new" className="pdx-btn primary" style={{ marginTop: 6 }}>
                <Plus className="h-[15px] w-[15px]" /> Nuevo Pedido
              </Link>
            </div>
          ) : (
            <div className="pdx-plist">
              {dayOrders.map((o) => {
                const statusCfg = STATUS_CONFIG[o.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
                const StatusIcon = statusCfg.icon;
                const vendido = o.hasIva ? parseFloat(o.totalConIva) : parseFloat(o.total);
                const chipClass = o.status === "approved" ? "aprob" : o.status === "cancelled" ? "canc" : "borr";
                return (
                  <div key={o.id} className="pdx-pwrap">
                    <Link href={`/orders/${o.id}`} className="pdx-pedido" data-testid={`card-order-${o.id}`}>
                      <span className="pdx-pic"><FileText className="h-[22px] w-[22px]" /></span>
                      <div className="pdx-pmid">
                        <div className="pdx-ptags">
                          <span className={`pdx-chip ${chipClass}`}><StatusIcon className="h-3 w-3" />{statusCfg.label}</span>
                          <span className="pdx-chip prod">{o.itemCount} prod.</span>
                          {o.hasIva && <span className="pdx-chip iva">Con IVA</span>}
                          {(o as any).galponConfirmed && <span className="pdx-chip galpon">Confirmado galpón</span>}
                        </div>
                        <div className="pdx-pname">{o.customerName}</div>
                        <div className="pdx-pmeta">
                          <Calendar className="h-[13px] w-[13px]" />
                          {formatDate(o.orderDate)}
                          <span>·</span>
                          {o.status === "approved" ? (
                            <span>Remito: <span className="rem pdx-mono">{formatRemito(o)}</span></span>
                          ) : (
                            <span>{o.status === "cancelled" ? "cancelado" : "pendiente de aprobar"}</span>
                          )}
                        </div>
                      </div>
                      <div className="pdx-pright">
                        <div className="rl">{o.hasIva ? "Total + IVA" : "Total"}</div>
                        <div className="rv pdx-num">${fmt(vendido)}</div>
                        {o.hasIva && <div className="neto pdx-num">Neto: ${fmt(parseFloat(o.total))}</div>}
                      </div>
                      <span className="pdx-chev"><ChevronRight className="h-[18px] w-[18px]" /></span>
                    </Link>
                    <button
                      onClick={(e) => { e.preventDefault(); setDeleteTarget(o); }}
                      className="pdx-del"
                      data-testid={`button-delete-order-${o.id}`}
                      title="Eliminar pedido"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {/* Confirm delete dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar pedido?</AlertDialogTitle>
            <AlertDialogDescription>
              Estás por eliminar el pedido de <strong>{deleteTarget?.customerName}</strong>{" "}
              ({deleteTarget ? formatRemito(deleteTarget) : ""}). Esta acción no se puede deshacer.
              Los ítems del pedido también serán eliminados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
