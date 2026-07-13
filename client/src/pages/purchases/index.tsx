import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Plus, ShoppingCart, Calendar, ChevronRight, Package, DollarSign, Users } from "lucide-react";
import type { Purchase } from "@shared/schema";

const fmtInt = (n: number) => Math.round(n).toLocaleString("es-AR");
// es-AR con 2 decimales (unifica formato con el resto del sistema): $682.999,97
const fmt2 = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Rediseño Compras (Claude Design) — CSS de diseno-caja/compras-rediseno.html ──
const CMX_CSS = `
.compras-rx{background:#f4f4f1;min-height:100%;padding:30px 24px 56px;font-family:'Inter',system-ui,sans-serif;color:#1e2420;}
.compras-rx *{box-sizing:border-box;}
.cmx-wrap{max-width:1240px;margin:0 auto;}
.cmx-num{font-family:'Bricolage Grotesque','Inter',sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.cmx-top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:22px;}
.cmx-title{font-family:'Bricolage Grotesque';font-size:27px;font-weight:700;margin:0;letter-spacing:-.02em;}
.cmx-subtitle{font-size:13.5px;color:#8b8f88;margin-top:5px;}
.cmx-topright{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.cmx-datepick{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #ecece8;border-radius:10px;padding:9px 13px;font-size:13.5px;color:#1e2420;}
.cmx-datepick>svg{color:#8b8f88;flex:0 0 auto;}
.cmx-datepick input{border:none;outline:none;font-family:'Inter';font-size:13.5px;color:#1e2420;background:transparent;}
.cmx-datepick:focus-within{border-color:#5f8020;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.cmx-btnnew{display:inline-flex;align-items:center;gap:8px;background:#6b8a2a;color:#fff;border:none;border-radius:11px;padding:11px 18px;font-family:'Inter';font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;}
.cmx-btnnew:hover{background:#5f7d24;}
.cmx-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px;}
@media(max-width:760px){.cmx-summary{grid-template-columns:1fr;}}
.cmx-sum{background:#fff;border:1px solid #ecece8;border-radius:16px;padding:20px 22px;}
.cmx-sum .head{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.cmx-sicon{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
.cmx-sicon.g{background:#eef3e3;color:#5f8020;}
.cmx-sicon.c{background:#f8ede8;color:#c05e42;}
.cmx-sicon.b{background:#e9eff7;color:#3a67a3;}
.cmx-sum .lab{font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9a9e96;}
.cmx-sum .val{font-family:'Bricolage Grotesque';font-size:30px;font-weight:700;letter-spacing:-.02em;margin-top:2px;}
.cmx-list{display:flex;flex-direction:column;gap:11px;}
.cmx-oc{display:flex;align-items:center;gap:16px;background:#fff;border:1px solid #ecece8;border-radius:14px;padding:15px 20px;cursor:pointer;transition:border-color .15s,box-shadow .15s;text-decoration:none;color:inherit;}
.cmx-oc:hover{border-color:#d9d9d3;box-shadow:0 3px 14px rgba(30,36,32,.05);}
.cmx-cart{width:44px;height:44px;border-radius:11px;background:#eef3e3;color:#5f8020;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
.cmx-ocmid{flex:1;min-width:0;}
.cmx-ocline{display:flex;align-items:center;gap:10px;margin-bottom:3px;flex-wrap:wrap;}
.cmx-occode{font-size:14px;font-weight:700;color:#1e2420;letter-spacing:-.01em;}
.cmx-pcount{font-size:11px;font-weight:500;color:#6f7469;background:#f1f2ee;border:1px solid #e6e7e1;padding:2px 9px;border-radius:20px;white-space:nowrap;}
.cmx-prov{font-family:'Bricolage Grotesque';font-size:17px;font-weight:600;letter-spacing:-.01em;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cmx-ocdate{display:flex;align-items:center;gap:6px;font-size:12.5px;color:#8b8f88;margin-top:5px;}
.cmx-octot{text-align:right;flex:0 0 auto;}
.cmx-octot .l{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9a9e96;margin-bottom:3px;}
.cmx-octot .v{font-family:'Bricolage Grotesque';font-size:19px;font-weight:700;letter-spacing:-.01em;}
.cmx-chev{color:#c4c7bf;flex:0 0 auto;display:flex;}
.cmx-empty{background:#fff;border:1px solid #ecece8;border-radius:16px;padding:48px 20px;text-align:center;color:#8b8f88;display:flex;flex-direction:column;align-items:center;gap:10px;}
.cmx-empty .big{font-size:15px;font-weight:600;color:#1e2420;}
.cmx-emptyic{width:48px;height:48px;border-radius:50%;background:#f1f1ec;display:flex;align-items:center;justify-content:center;color:#8b8f88;}
`;

export default function PurchasesPage() {
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });

  const { data: purchases, isLoading } = useQuery<(Purchase & { itemCount: number; bultos: number })[]>({
    queryKey: ["/api/purchases", date],
    queryFn: () => apiRequest("GET", `/api/purchases?date=${date}`).then((r) => r.json()),
  });

  const list = purchases ?? [];
  const bultosTotal = list.reduce((s, p) => s + (p.bultos ?? 0), 0);
  const totalComprado = list.reduce((s, p) => s + (parseFloat(p.total) || 0), 0);
  const proveedoresCount = new Set(list.map((p) => p.supplierId ?? `n:${p.supplierName}`)).size;

  const formatDate = (d: string | Date) => {
    const s = typeof d === "string" ? d.slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    return new Date(s + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
  };

  const formatDateLong = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
  };

  return (
    <Layout title="Compras">
      <div className="compras-rx">
        <style>{CMX_CSS}</style>
        <div className="cmx-wrap">
          {/* Encabezado */}
          <div className="cmx-top">
            <div>
              <h1 className="cmx-title">Órdenes de Compra</h1>
              <div className="cmx-subtitle">
                {purchases?.length ?? 0} orden{(purchases?.length ?? 0) !== 1 ? "es" : ""} el {formatDateLong(date)}
              </div>
            </div>
            <div className="cmx-topright">
              <div className="cmx-datepick">
                <Calendar className="h-4 w-4" />
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-date-filter" />
              </div>
              <Link href="/purchases/new" className="cmx-btnnew" data-testid="button-new-purchase">
                <Plus className="h-[17px] w-[17px]" /> Nueva Compra
              </Link>
            </div>
          </div>

          {/* Resumen del día (mismos cálculos) */}
          {!isLoading && list.length > 0 && (
            <div className="cmx-summary">
              <div className="cmx-sum">
                <div className="head"><span className="cmx-sicon g"><Package className="h-[18px] w-[18px]" /></span><span className="lab">Bultos comprados</span></div>
                <div className="val cmx-num">{fmtInt(bultosTotal)}</div>
              </div>
              <div className="cmx-sum">
                <div className="head"><span className="cmx-sicon c"><DollarSign className="h-[18px] w-[18px]" /></span><span className="lab">Total comprado</span></div>
                <div className="val cmx-num">${fmtInt(totalComprado)}</div>
              </div>
              <div className="cmx-sum">
                <div className="head"><span className="cmx-sicon b"><Users className="h-[18px] w-[18px]" /></span><span className="lab">Proveedores</span></div>
                <div className="val cmx-num">{proveedoresCount}</div>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="cmx-list">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[74px] w-full rounded-2xl" />)}
            </div>
          ) : list.length === 0 ? (
            <div className="cmx-empty">
              <div className="cmx-emptyic"><ShoppingCart className="h-6 w-6" /></div>
              <div className="big">Sin órdenes de compra</div>
              <div>Registra tu primera compra para comenzar el inventario.</div>
              <Link href="/purchases/new" className="cmx-btnnew" style={{ marginTop: 6 }}>
                <Plus className="h-[17px] w-[17px]" /> Nueva Compra
              </Link>
            </div>
          ) : (
            <div className="cmx-list">
              {list.map((p) => (
                <Link key={p.id} href={`/purchases/${p.id}`} className="cmx-oc" data-testid={`card-purchase-${p.id}`}>
                  <span className="cmx-cart"><ShoppingCart className="h-5 w-5" /></span>
                  <div className="cmx-ocmid">
                    <div className="cmx-ocline">
                      <span className="cmx-occode">{p.folio}</span>
                      <span className="cmx-pcount">{p.itemCount} producto{p.itemCount !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="cmx-prov">{p.supplierName}</div>
                    <div className="cmx-ocdate"><Calendar className="h-[14px] w-[14px]" /> {formatDate(p.purchaseDate)}</div>
                  </div>
                  <div className="cmx-octot">
                    <div className="l">Total</div>
                    <div className="v cmx-num">${fmt2(parseFloat(p.total))}</div>
                  </div>
                  <span className="cmx-chev"><ChevronRight className="h-5 w-5" /></span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
