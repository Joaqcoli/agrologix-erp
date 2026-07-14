import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Scale, Sprout, Undo2, Info, TrendingUp, TrendingDown, Package, Calendar, Search, ChevronDown } from "lucide-react";

type Adj = {
  id: number; createdAt: string; productId: number; productName: string;
  category: string; unit: string; movementType: "in" | "out"; quantity: number;
  tipo: string; label: string; section: "pre" | "post";
  createdBy: number | null; createdByName: string | null;
  revertKind: "merma_rinde" | "galpon_weight" | null; revertible: boolean;
  notes: string; unitCost?: number; value?: number;
};

const fmtMoney = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("es-AR");
const fmtQty = (n: number) => Number(n.toFixed(2)).toLocaleString("es-AR");
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

const MONTHS_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const fmtDayChip = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
const fmtDayLong = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "long" });

// Color del chip de tipo según el tipo real (rinde verde, merma coral, ajuste_peso azul, resto gris)
function tipoClass(tipo: string): string {
  if (tipo === "rinde" || tipo === "rinde_pedido") return "rinde";
  if (tipo === "merma") return "merma";
  if (tipo === "ajuste_peso") return "peso";
  return "gris";
}

// ── Rediseño Ajustes de Stock (Claude Design) — CSS de diseno-caja/ajustes-stock-rediseno.html ──
const ASX_CSS = `
.ajustes-rx{background:#f4f4f1;min-height:100%;padding:30px 24px 56px;font-family:'Inter',system-ui,sans-serif;color:#1e2420;}
.ajustes-rx *{box-sizing:border-box;}
.asx-wrap{max-width:1360px;margin:0 auto;}
.asx-num{font-family:'Bricolage Grotesque','Inter',sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.asx-monthhead{display:flex;align-items:center;gap:9px;font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9a9e96;margin-bottom:12px;}
.asx-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:26px;}
@media(max-width:820px){.asx-metrics{grid-template-columns:1fr;}}
.asx-metric{background:#fff;border:1px solid #ecece8;border-radius:15px;padding:16px 20px;display:flex;align-items:center;gap:14px;}
.asx-micon{width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
.asx-micon.g{background:#eef3e3;color:#5f8020;}
.asx-micon.c{background:#f8ede8;color:#c05e42;}
.asx-micon.n{background:#f0f0ec;color:#6f7469;}
.asx-mlab{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#9a9e96;margin-bottom:3px;}
.asx-mval{font-family:'Bricolage Grotesque';font-size:25px;font-weight:700;letter-spacing:-.02em;}
.asx-mval.g{color:#5f8020;}
.asx-mval.c{color:#b0553f;}
.asx-filters{display:flex;gap:11px;flex-wrap:wrap;margin-bottom:28px;}
.asx-fsearch{position:relative;flex:1;min-width:220px;max-width:340px;}
.asx-fsearch>svg{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#8b8f88;pointer-events:none;}
.asx-fsearch input{width:100%;background:#fff;border:1px solid #ecece8;border-radius:10px;padding:11px 14px 11px 42px;font-family:'Inter';font-size:13.5px;color:#1e2420;}
.asx-fsearch input::placeholder{color:#a9ada4;}
.asx-fsearch input:focus{outline:none;border-color:#5f8020;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.asx-sel{position:relative;display:inline-flex;}
.asx-sel select{appearance:none;-webkit-appearance:none;background:#fff;border:1px solid #ecece8;border-radius:10px;padding:11px 34px 11px 14px;font-family:'Inter';font-size:13.5px;font-weight:500;color:#1e2420;cursor:pointer;min-width:150px;}
.asx-sel select:focus{outline:none;border-color:#5f8020;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.asx-sel svg{position:absolute;right:12px;top:50%;transform:translateY(-50%);pointer-events:none;color:#8b8f88;}
.asx-fdate{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #ecece8;border-radius:10px;padding:0 14px;}
.asx-fdate>svg{color:#8b8f88;flex:0 0 auto;}
.asx-fdate input{border:none;outline:none;font-family:'Inter';font-size:13.5px;color:#1e2420;background:transparent;padding:11px 0;}
.asx-fdate:focus-within{border-color:#5f8020;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.asx-section{margin-bottom:30px;}
.asx-shead{display:flex;align-items:center;gap:11px;margin-bottom:5px;flex-wrap:wrap;}
.asx-sicon{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
.asx-sicon.blue{background:#e9eff7;color:#3a67a3;}
.asx-sicon.green{background:#eef3e3;color:#5f8020;}
.asx-stitle{font-family:'Bricolage Grotesque';font-size:18px;font-weight:700;letter-spacing:-.01em;}
.asx-scount{font-size:12px;font-weight:600;color:#6f7469;background:#f1f2ee;border:1px solid #e6e7e1;padding:2px 10px;border-radius:20px;}
.asx-daychip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:#5f8020;background:#eef3e3;padding:3px 11px;border-radius:20px;margin-left:auto;}
.asx-sdesc{font-size:13px;color:#8b8f88;margin:0 0 16px 41px;}
.asx-empty{background:#fff;border:1px solid #ecece8;border-radius:14px;padding:44px;text-align:center;color:#8b8f88;font-size:13.5px;}
.asx-tcard{background:#fff;border:1px solid #ecece8;border-radius:15px;padding:4px 6px 8px;overflow:hidden;}
.asx-tblwrap{overflow-x:auto;}
table.asx-tbl{width:100%;border-collapse:collapse;}
.asx-tbl th{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#9a9e96;text-align:left;padding:14px 18px 12px;border-bottom:1px solid #eeeeea;white-space:nowrap;}
.asx-tbl th.r{text-align:right;}
.asx-tbl td{padding:13px 18px;border-bottom:1px solid #f5f5f2;font-size:13.5px;white-space:nowrap;}
.asx-tbl td.r{text-align:right;}
.asx-tbl tbody tr:last-child td{border-bottom:none;}
.asx-tbl tbody tr:hover td{background:#f8f8f5;}
.asx-fecha{color:#8b8f88;font-variant-numeric:tabular-nums;}
.asx-prod{font-weight:600;color:#1e2420;}
.asx-tipo{font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;white-space:nowrap;}
.asx-tipo.rinde{background:#eef3e3;color:#5f8020;}
.asx-tipo.merma{background:#f8ede8;color:#b0553f;}
.asx-tipo.peso{background:#e9eff7;color:#3a67a3;}
.asx-tipo.gris{background:#f1f2ee;color:#6f7469;}
.asx-qty{font-weight:700;font-variant-numeric:tabular-nums;}
.asx-val{font-weight:600;font-variant-numeric:tabular-nums;}
.asx-pos{color:#5f8020;}
.asx-neg{color:#b0553f;}
.asx-quien{color:#6f7469;}
.asx-origin{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:#8b8f88;}
.asx-origin svg{color:#c4c7bf;}
.asx-undo{display:inline-flex;align-items:center;gap:5px;background:#fff;border:1px solid #ecece8;color:#1e2420;font-family:'Inter';font-size:12px;font-weight:500;padding:5px 11px;border-radius:8px;cursor:pointer;}
.asx-undo:hover{border-color:#cfcfc9;background:#f6f6f2;}
`;

export default function AjustesStockPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState("all");
  const [whoFilter, setWhoFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  const { data: rows = [], isLoading } = useQuery<Adj[]>({
    queryKey: ["/api/stock-adjustments"],
    queryFn: () => fetch("/api/stock-adjustments", { credentials: "include" }).then((r) => r.json()),
  });

  const revertMermaRinde = useMutation({
    mutationFn: ({ id, qty }: { id: number; qty: number }) =>
      apiRequest("POST", `/api/stock-movements/${id}/revert`, { qty }),
    onSuccess: () => { invalidate(); toast({ title: "Ajuste deshecho", description: "El stock se devolvió." }); },
    onError: (e: any) => toast({ title: "No se pudo deshacer", description: e.message, variant: "destructive" }),
  });
  const revertWeight = useMutation({
    mutationFn: ({ id }: { id: number }) =>
      apiRequest("POST", `/api/stock-adjustments/${id}/revert-weight`, {}),
    onSuccess: () => { invalidate(); toast({ title: "Ajuste de peso deshecho", description: "Se volvió al peso anterior." }); },
    onError: (e: any) => toast({ title: "No se pudo deshacer", description: e.message, variant: "destructive" }),
  });
  function invalidate() {
    for (const k of ["/api/stock-adjustments", "/api/products", "/api/product-units", "/api/dashboard/stats"])
      queryClient.invalidateQueries({ queryKey: [k] });
  }

  const handleUndo = (a: Adj) => {
    if (a.revertKind === "galpon_weight") {
      if (!confirm(`Deshacer el ajuste de peso de ${a.productName} (volver al peso anterior).\n\nOjo: si el stock se movió desde el ajuste, el costo puede quedar levemente distinto (por el promedio ponderado).\n\n¿Continuar?`)) return;
      revertWeight.mutate({ id: a.id });
    } else if (a.revertKind === "merma_rinde") {
      if (!confirm(`Deshacer ${a.label.toLowerCase()} de ${a.productName} (${fmtQty(a.quantity)} ${a.unit}) y devolver al stock. ¿Continuar?`)) return;
      revertMermaRinde.mutate({ id: a.id, qty: a.quantity });
    }
  };

  const whoOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.createdByName).filter(Boolean))) as string[], [rows]);

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const monthStartISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const monthLabel = `${MONTHS_ES[now.getMonth()]} ${now.getFullYear()}`;
  // Cambios 2 y 3: las listas muestran SOLO el día elegido (o hoy), combinado con buscar/tipo/quién
  const shownDay = dateFilter || todayISO;

  const dayRows = useMemo(() => rows.filter((r) => {
    if (search && !r.productName.toLowerCase().includes(search.toLowerCase())) return false;
    if (tipoFilter !== "all" && r.tipo !== tipoFilter) return false;
    if (whoFilter !== "all" && (r.createdByName ?? "—") !== whoFilter) return false;
    return r.createdAt.slice(0, 10) === shownDay;
  }), [rows, search, tipoFilter, whoFilter, shownDay]);

  const pre = dayRows.filter((r) => r.section === "pre");
  const post = dayRows.filter((r) => r.section === "post");

  // Cambio 1: métricas FIJAS del mes en curso (mismas fórmulas que las 3 tarjetas de antes,
  // solo cambia el período; NO reaccionan a buscar/tipo/quién).
  const monthRows = useMemo(
    () => rows.filter((r) => { const d = r.createdAt.slice(0, 10); return d >= monthStartISO && d <= todayISO; }),
    [rows, monthStartISO, todayISO],
  );
  // MISMA definición que el dashboard: rinde = movimientos "Rinde" (manual + rinde de pedido:
  // producto vendido sin stock, al último costo); merma = movimientos "Merma" (ajuste a la baja).
  // Se excluye la VENTA del rinde ("Stock insuficiente…"), correcciones y ajuste de peso.
  const isRindeNote = (r: Adj) => /^Rinde/i.test(r.notes ?? "");
  const isMermaNote = (r: Adj) => /^Merma/i.test(r.notes ?? "");
  const rinde = monthRows.filter(isRindeNote).reduce((s, r) => s + (r.value ?? 0), 0);
  const merma = monthRows.filter(isMermaNote).reduce((s, r) => s + (r.value ?? 0), 0);
  const diferencia = rinde + merma;

  const renderTable = (items: Adj[], emptyMsg: string) => (
    items.length === 0 ? (
      <div className="asx-empty">{emptyMsg}</div>
    ) : (
      <div className="asx-tcard">
        <div className="asx-tblwrap">
          <table className="asx-tbl">
            <thead>
              <tr>
                <th>Fecha</th><th>Producto</th><th>Tipo</th>
                <th className="r">Δ Cantidad</th><th className="r">Valor</th><th>Quién</th><th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const isOut = a.movementType === "out";
                return (
                  <tr key={a.id} data-testid={`adj-row-${a.id}`}>
                    <td className="asx-fecha">{fmtDate(a.createdAt)}</td>
                    <td><span className="asx-prod">{a.productName}</span></td>
                    <td><span className={`asx-tipo ${tipoClass(a.tipo)}`}>{a.label}</span></td>
                    <td className={`r asx-qty ${isOut ? "asx-neg" : "asx-pos"}`}>{isOut ? "−" : "+"}{fmtQty(a.quantity)} {a.unit}</td>
                    <td className={`r asx-val ${(a.value ?? 0) < 0 ? "asx-neg" : "asx-pos"}`}>{a.value != null ? fmtMoney(a.value) : "—"}</td>
                    <td className="asx-quien">{a.createdByName ?? "—"}</td>
                    <td>
                      {a.revertible ? (
                        <button className="asx-undo" onClick={() => handleUndo(a)} data-testid={`undo-${a.id}`}>
                          <Undo2 className="h-3.5 w-3.5" /> Deshacer
                        </button>
                      ) : a.tipo === "rinde_pedido" ? (
                        <span className="asx-origin" title="El rinde de un pedido se maneja editando/des-aprobando el pedido">
                          <Info className="h-3 w-3" /> desde el pedido
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  );

  return (
    <Layout title="Ajustes de Stock">
      <div className="ajustes-rx">
        <style>{ASX_CSS}</style>
        <div className="asx-wrap">
          {/* Métricas del mes en curso */}
          <div className="asx-monthhead"><Calendar className="h-[15px] w-[15px]" /> Este mes — {monthLabel}</div>
          <div className="asx-metrics">
            <div className="asx-metric">
              <div className="asx-micon g"><TrendingUp className="h-5 w-5" /></div>
              <div><div className="asx-mlab">Rinde</div><div className="asx-mval g asx-num">{rinde > 0 ? "+" : ""}{fmtMoney(rinde)}</div></div>
            </div>
            <div className="asx-metric">
              <div className="asx-micon c"><TrendingDown className="h-5 w-5" /></div>
              <div><div className="asx-mlab">Merma</div><div className="asx-mval c asx-num">{fmtMoney(merma)}</div></div>
            </div>
            <div className="asx-metric">
              <div className="asx-micon n"><Package className="h-5 w-5" /></div>
              <div><div className="asx-mlab">Diferencia</div><div className={`asx-mval ${diferencia < 0 ? "c" : "g"} asx-num`}>{fmtMoney(diferencia)}</div></div>
            </div>
          </div>

          {/* Filtros */}
          <div className="asx-filters">
            <div className="asx-fsearch">
              <Search className="h-4 w-4" />
              <input placeholder="Buscar producto..." value={search} onChange={(e) => setSearch(e.target.value)} data-testid="filter-search" />
            </div>
            <div className="asx-sel">
              <select value={tipoFilter} onChange={(e) => setTipoFilter(e.target.value)}>
                <option value="all">Todos los tipos</option>
                <option value="ajuste_peso">Ajuste de peso</option>
                <option value="merma">Merma</option>
                <option value="rinde">Rinde</option>
                <option value="rinde_pedido">Rinde (pedido)</option>
                <option value="correccion">Corrección</option>
              </select>
              <ChevronDown className="h-3.5 w-3.5" />
            </div>
            <div className="asx-sel">
              <select value={whoFilter} onChange={(e) => setWhoFilter(e.target.value)}>
                <option value="all">Todos</option>
                {whoOptions.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
              <ChevronDown className="h-3.5 w-3.5" />
            </div>
            <div className="asx-fdate">
              <Calendar className="h-[15px] w-[15px]" />
              <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} data-testid="filter-date" />
            </div>
          </div>

          {isLoading ? (
            <div className="asx-empty">Cargando…</div>
          ) : (
            <>
              {/* Pre-venta */}
              <div className="asx-section">
                <div className="asx-shead">
                  <div className="asx-sicon blue"><Scale className="h-[17px] w-[17px]" /></div>
                  <div className="asx-stitle">Pre-venta — ajustes de peso del galpón</div>
                  <div className="asx-scount">{pre.length}</div>
                  <div className="asx-daychip"><Calendar className="h-3 w-3" /> {fmtDayChip(shownDay)}</div>
                </div>
                <p className="asx-sdesc">Correcciones de kilaje por envase antes de vender (a tener en cuenta para próximas compras).</p>
                {renderTable(pre, `Sin ajustes de peso el ${fmtDayLong(shownDay)}.`)}
              </div>

              {/* Post-venta */}
              <div className="asx-section">
                <div className="asx-shead">
                  <div className="asx-sicon green"><Sprout className="h-[17px] w-[17px]" /></div>
                  <div className="asx-stitle">Post-venta — merma y rinde</div>
                  <div className="asx-scount">{post.length}</div>
                  <div className="asx-daychip"><Calendar className="h-3 w-3" /> {fmtDayChip(shownDay)}</div>
                </div>
                <p className="asx-sdesc">Lo que se perdió (merma) o apareció (rinde) — manual y de pedidos.</p>
                {renderTable(post, `Sin merma/rinde el ${fmtDayLong(shownDay)}.`)}
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
