import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Package, Download, ClipboardList, Users, AlertTriangle, Layers, ChevronDown, HelpCircle, Search,
} from "lucide-react";

type LoadListRow = {
  productId: number;
  productName: string;
  category: string;
  unit: string;
  totalQty: number;
  stockQty: number;
  diffQty: number;
  customersCount: number;
  customerNames: string[];
  allProductStock: Array<{ unit: string; qty: number }>;
  demandByUnit?: Array<{ unit: string; qty: number }>;
};

const CATEGORY_ORDER = [
  "Fruta", "Verdura", "Hortaliza Liviana", "Hortaliza Pesada", "Hongos/Hierbas", "Huevos",
];

type PendingRow = {
  orderId: number;
  orderFolio: string;
  customerName: string;
  rawText: string;
  qty: number | null;
  unit: string | null;
};

type LoadListData = {
  summary: {
    date: string;
    ordersCount: number;
    customersCount: number;
    rowsCount: number;
    shortagesCount: number;
  };
  rows: LoadListRow[];
  pending: PendingRow[];
};

type RowResolution = "ok" | "pending";

// Valor exacto para TODAS las unidades: entero si no hay fracción, 2 decimales si la hay.
// Nunca se redondea hacia arriba (un faltante de 0.5 cajón se muestra 0.5, no 1).
function fmtQty(qty: number, _unit: string) {
  const frac = qty % 1;
  return frac === 0 ? qty.toFixed(0) : qty.toFixed(2);
}

function fmtDiff(diff: number, _unit: string) {
  const frac = diff % 1;
  return frac === 0 ? diff.toFixed(0) : diff.toFixed(2);
}

const PACKAGED_UNITS = new Set(["CAJON", "BOLSA", "BANDEJA"]);
const BASE_UNITS     = new Set(["KG", "UNIDAD", "ATADO", "MAPLE"]);

// Un faltante es "duda" si hay stock REAL en OTRA unidad del mismo producto.
// Excepción: cuando el pedido es en CAJON/BOLSA/BANDEJA, el stock en unidades base
// ya está contabilizado en stockQty (vía conversión base/weightPerPackage), por lo
// que NO representa stock adicional y no debe marcar duda.
function isDudaRow(row: LoadListRow): boolean {
  if (row.diffQty >= 0) return false;
  const isPackaged = PACKAGED_UNITS.has(row.unit.toUpperCase());
  return row.allProductStock.some((s) => {
    if (s.unit === row.unit) return false;
    if ((s.qty ?? 0) <= 0) return false;
    if (isPackaged && BASE_UNITS.has(s.unit.toUpperCase())) return false;
    return true;
  });
}

// ── Rediseño Lista de Carga (Claude Design) — CSS de diseno-caja/lista-carga-rediseno.html ──
const LLX_CSS = `
.loadlist-rx{background:#f4f4f1;min-height:100%;padding:30px 24px 56px;font-family:'Inter',system-ui,sans-serif;color:#1e2420;}
.loadlist-rx *{box-sizing:border-box;}
.llx-wrap{max-width:1180px;margin:0 auto;}
.llx-num{font-family:'Bricolage Grotesque','Inter',sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.llx-pagehead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:22px;flex-wrap:wrap;}
.llx-pagehead h1{font-family:'Bricolage Grotesque';font-size:27px;font-weight:700;margin:0;letter-spacing:-.02em;}
.llx-pagehead .sub{font-size:14px;color:#8b8f88;margin:5px 0 0;}
.llx-buycompra{background:#fff;border:1px solid #ecece8;color:#1e2420;font-family:'Inter';font-size:13.5px;font-weight:500;padding:10px 16px;border-radius:11px;cursor:pointer;display:flex;align-items:center;gap:8px;white-space:nowrap;}
.llx-buycompra:hover{border-color:#cfcfc9;background:#f6f6f2;}
.llx-controls{display:flex;align-items:flex-end;gap:26px;flex-wrap:wrap;margin-bottom:22px;}
.llx-fld{display:flex;flex-direction:column;gap:6px;}
.llx-fld label{font-size:12.5px;font-weight:600;color:#9a9e96;}
.llx-fld input{font-family:'Inter';font-size:14px;padding:10px 13px;border:1px solid #ecece8;border-radius:10px;background:#fff;color:#1e2420;}
.llx-fld input:focus{outline:none;border-color:#6b8a2a;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.llx-switch{display:inline-flex;align-items:center;gap:11px;cursor:pointer;font-size:14px;font-weight:500;user-select:none;}
.llx-switch input{display:none;}
.llx-track{width:42px;height:24px;border-radius:20px;background:#d9d9d3;position:relative;transition:.2s;flex:0 0 auto;}
.llx-track::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 2px rgba(0,0,0,.25);}
.llx-switch input:checked + .llx-track{background:#6b8a2a;}
.llx-switch input:checked + .llx-track::after{transform:translateX(18px);}
.llx-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:22px;}
@media(max-width:720px){.llx-stats{grid-template-columns:repeat(2,1fr);}}
.llx-stat{background:#fff;border:1px solid #ecece8;border-radius:14px;padding:15px 18px;}
.llx-stat .lab{display:flex;align-items:center;gap:8px;font-size:13px;color:#8b8f88;margin-bottom:9px;}
.llx-stat .val{font-size:26px;font-weight:700;line-height:1;}
.llx-stat.alert .lab{color:#c05e42;}
.llx-stat.alert .val{color:#c05e42;}
.llx-searchrow{display:flex;gap:12px;margin-bottom:18px;flex-wrap:wrap;}
.llx-searchwrap{flex:1;position:relative;min-width:200px;}
.llx-searchwrap>svg{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#8b8f88;pointer-events:none;}
.llx-searchwrap input{width:100%;font-family:'Inter';font-size:14px;padding:11px 14px 11px 40px;border:1px solid #ecece8;border-radius:11px;background:#fff;color:#1e2420;}
.llx-searchwrap input:focus{outline:none;border-color:#6b8a2a;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.llx-catsel{font-family:'Inter';font-size:14px;padding:11px 14px;border:1px solid #ecece8;border-radius:11px;background:#fff;color:#1e2420;min-width:170px;}
.llx-catsel:focus{outline:none;border-color:#6b8a2a;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.llx-tablecard{background:#fff;border:1px solid #ecece8;border-radius:16px;overflow:hidden;}
.llx-tabletop{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #f1f1ee;gap:10px;flex-wrap:wrap;}
.llx-tabletop .t{display:flex;align-items:center;gap:10px;font-family:'Bricolage Grotesque';font-weight:700;font-size:15px;}
.llx-tabletop .badge{font-size:12px;font-weight:600;color:#8b8f88;background:#f1f1ec;padding:4px 11px;border-radius:20px;white-space:nowrap;}
.llx-grid{display:grid;align-items:center;gap:12px;}
.llx-g7{grid-template-columns:38px minmax(0,1fr) 96px 108px 92px 168px 96px;}
.llx-g5{grid-template-columns:38px minmax(0,1fr) 96px 108px 96px;}
.llx-thead{padding:11px 20px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9a9e96;border-bottom:1px solid #f1f1ee;}
.llx-thead .r{text-align:right;}
.loadlist-rx .r{text-align:right;}
.llx-catrow{padding:9px 20px;background:#faf9f6;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#8b8f88;}
.llx-prow{padding:14px 20px;border-top:1px solid #f4f4f1;cursor:pointer;}
.llx-prow:hover{background:#f7f7f4;}
.llx-prow.buy{background:#fdf4f1;}
.llx-prow.buy:hover{background:#fbeee9;}
.llx-prow.duda{background:#fbf7e8;}
.llx-prow.duda:hover{background:#f7f1da;}
.llx-pidx{color:#8b8f88;font-size:13px;}
.llx-pname{font-size:14.5px;font-weight:500;display:flex;align-items:center;gap:6px;}
.llx-pdesg{font-size:12px;color:#8b8f88;margin-top:2px;}
.llx-uchip{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.03em;color:#5f645b;background:#eef0ec;border:1px solid #e3e5df;padding:3px 9px;border-radius:7px;}
.llx-ptot{font-weight:700;font-size:14.5px;}
.llx-pstk{color:#8b8f88;font-size:14px;}
.llx-pneto{display:flex;flex-direction:column;align-items:flex-end;line-height:1.15;}
.llx-pneto .n{font-weight:700;font-size:14.5px;color:#b0553f;}
.llx-pneto .tag{font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#c05e42;}
.llx-pneto.ok .n{color:#5f8020;font-size:14px;}
.llx-pneto.duda .n{color:#c08a1e;font-size:12.5px;display:inline-flex;align-items:center;gap:4px;}
.llx-pclients{display:inline-flex;align-items:center;gap:6px;justify-content:flex-end;font-size:13px;font-weight:600;color:#8b8f88;background:none;border:none;cursor:pointer;font-family:inherit;width:100%;}
.llx-pclients:hover{color:#1e2420;}
.llx-empty{padding:44px 20px;text-align:center;color:#8b8f88;font-size:14px;}
.llx-empty .big{font-size:15px;font-weight:600;color:#1e2420;margin-bottom:4px;}
.llx-pending{background:#fff;border:1px solid #eecf9a;border-radius:16px;overflow:hidden;margin-bottom:22px;}
.llx-pending .ph{display:flex;align-items:center;gap:8px;padding:14px 20px;font-weight:600;font-size:14px;color:#c08a1e;border-bottom:1px solid #f5ecd6;background:#fdf7e6;}
.llx-pending table{width:100%;border-collapse:collapse;font-size:13.5px;}
.llx-pending th{text-align:left;padding:9px 20px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#9a9e96;border-bottom:1px solid #f1f1ee;}
.llx-pending th.r,.llx-pending td.r{text-align:right;}
.llx-pending td{padding:10px 20px;border-top:1px solid #f4f4f1;}
.llx-pending .raw{color:#c08a1e;font-style:italic;}
`;

export default function LoadListPage() {
  const d0 = new Date();
  const today = `${d0.getFullYear()}-${String(d0.getMonth()+1).padStart(2,"0")}-${String(d0.getDate()).padStart(2,"0")}`;
  const [date, setDate] = useState(today);
  const [includeStock, setIncludeStock] = useState(false);
  const [showOnlyShortages, setShowOnlyShortages] = useState(false);
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState("all");
  const [detailRow, setDetailRow] = useState<LoadListRow | null>(null);
  const [dudaRow, setDudaRow] = useState<LoadListRow | null>(null);

  // Resoluciones del usuario para filas "duda": key = "productId-unit"
  const [resolvedRows, setResolvedRows] = useState<Map<string, RowResolution>>(new Map());

  // Limpiar resoluciones cuando cambia la fecha o los datos
  useEffect(() => {
    setResolvedRows(new Map());
  }, [date]);

  const { data, isLoading } = useQuery<LoadListData>({
    queryKey: ["/api/load-list", date],
    queryFn: async () => {
      const res = await fetch(
        `/api/load-list?date=${date}&includeDrafts=1`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Error fetching load list");
      return res.json();
    },
    enabled: !!date,
  });

  const rowKey = (row: LoadListRow) => `${row.productId}-${row.unit}`;

  const getRowStatus = (row: LoadListRow): "ok" | "shortage" | "duda-unresolved" | "duda-ok" | "duda-pending" => {
    if (row.diffQty >= 0) return "ok";
    if (!isDudaRow(row)) return "shortage";
    const res = resolvedRows.get(rowKey(row));
    if (res === "ok") return "duda-ok";
    if (res === "pending") return "duda-pending";
    return "duda-unresolved";
  };

  const allUnits = useMemo(() => {
    if (!data?.rows) return [];
    return Array.from(new Set(data.rows.map((r) => r.unit))).sort();
  }, [data]);

  const filteredRows = useMemo(() => {
    if (!data?.rows) return [];
    return data.rows.filter((r) => {
      if (!r.productName.toLowerCase().includes(search.toLowerCase())) return false;
      if (unitFilter !== "all" && r.unit !== unitFilter) return false;
      if (showOnlyShortages) {
        const status = getRowStatus(r);
        return status === "shortage" || status === "duda-unresolved" || status === "duda-pending";
      }
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, search, unitFilter, showOnlyShortages, resolvedRows]);

  const handleExport = () => {
    window.open(
      `/api/load-list/export?date=${date}&includeDrafts=1`,
      "_blank"
    );
  };

  const handleExportCompra = () => {
    // Excluir de la lista de compra los "duda" que el usuario confirmó como ya cubiertos por stock
    const excluded = Array.from(resolvedRows.entries())
      .filter(([, res]) => res === "ok")
      .map(([key]) => key);
    const params = new URLSearchParams({ date });
    if (excluded.length > 0) params.set("exclude", excluded.join(","));
    window.open(`/api/load-list/export-compra?${params.toString()}`, "_blank");
  };

  const formattedDate = date
    ? new Date(date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })
    : "";

  const resolveRow = (row: LoadListRow, resolution: RowResolution) => {
    setResolvedRows((prev) => {
      const next = new Map(prev);
      next.set(rowKey(row), resolution);
      return next;
    });
    setDudaRow(null);
  };

  return (
    <Layout title="Lista de Carga">
      <div className="loadlist-rx">
        <style>{LLX_CSS}</style>
        <div className="llx-wrap">
          {/* Header */}
          <div className="llx-pagehead">
            <div>
              <h1>Lista de Carga</h1>
              <p className="sub">Consolidado por producto y unidad — stock y faltantes</p>
            </div>
            <button className="llx-buycompra" onClick={handleExportCompra} data-testid="button-export-load-list">
              <Download className="h-[15px] w-[15px]" /> Lista de Compra
            </button>
          </div>

          {/* Controles: fecha + toggles verdes (misma lógica) */}
          <div className="llx-controls">
            <div className="llx-fld">
              <label htmlFor="date-filter">Fecha</label>
              <input id="date-filter" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-load-list-date" />
            </div>
            <label className="llx-switch">
              <input type="checkbox" checked={includeStock} onChange={(e) => setIncludeStock(e.target.checked)} data-testid="toggle-include-stock" />
              <span className="llx-track" /> Incluir stock
            </label>
            <label className="llx-switch">
              <input type="checkbox" checked={showOnlyShortages} onChange={(e) => setShowOnlyShortages(e.target.checked)} data-testid="toggle-show-only-shortages" />
              <span className="llx-track" /> Solo faltantes
            </label>
          </div>

          {/* 4 cards resumen — mismos valores de data.summary (sin recalcular) */}
          {data && (
            <div className="llx-stats">
              <div className="llx-stat">
                <div className="lab"><ClipboardList className="h-[15px] w-[15px]" /> Pedidos</div>
                <div className="val llx-num" data-testid="summary-orders-count">{data.summary.ordersCount}</div>
              </div>
              <div className="llx-stat">
                <div className="lab"><Users className="h-[15px] w-[15px]" /> Clientes</div>
                <div className="val llx-num" data-testid="summary-customers-count">{data.summary.customersCount}</div>
              </div>
              <div className="llx-stat">
                <div className="lab"><Layers className="h-[15px] w-[15px]" /> Productos/ítems</div>
                <div className="val llx-num" data-testid="summary-rows-count">{data.summary.rowsCount}</div>
              </div>
              <div className="llx-stat alert">
                <div className="lab"><AlertTriangle className="h-[15px] w-[15px]" /> Faltantes</div>
                <div className="val llx-num" data-testid="summary-shortages-count">{data.summary.shortagesCount}</div>
              </div>
            </div>
          )}

          {/* Pendientes de asignación (misma data) */}
          {data && data.pending.length > 0 && (
            <div className="llx-pending">
              <div className="ph"><AlertTriangle className="h-4 w-4" /> Pendientes de asignación ({data.pending.length})</div>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr><th>Cliente</th><th>Pedido</th><th>Texto original</th><th className="r">Cant.</th><th>Unidad</th></tr>
                  </thead>
                  <tbody>
                    {data.pending.map((p, idx) => (
                      <tr key={idx} data-testid={`pending-row-${idx}`}>
                        <td style={{ fontWeight: 500 }}>{p.customerName}</td>
                        <td style={{ color: "#8b8f88", fontSize: 12 }}>{p.orderFolio}</td>
                        <td className="raw">{p.rawText}</td>
                        <td className="r">{p.qty ?? "—"}</td>
                        <td style={{ color: "#8b8f88", fontSize: 12 }}>{p.unit ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Buscador + filtro por unidad (idéntico a hoy) */}
          {data && data.rows.length > 0 && (
            <div className="llx-searchrow">
              <div className="llx-searchwrap">
                <Search className="h-4 w-4" />
                <input placeholder="Buscar producto..." value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" data-testid="input-search-product" />
              </div>
              <select className="llx-catsel" value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} data-testid="select-unit-filter">
                <option value="all">Todas las unidades</option>
                {allUnits.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          )}

          {/* Tabla */}
          {isLoading ? (
            <div className="llx-tablecard"><div className="llx-empty">Cargando…</div></div>
          ) : !data || data.rows.length === 0 ? (
            <div className="llx-tablecard"><div className="llx-empty"><div className="big">Sin pedidos para esta fecha</div>No hay ítems cargados para el {formattedDate}.</div></div>
          ) : filteredRows.length === 0 ? (
            <div className="llx-tablecard"><div className="llx-empty"><div className="big">Sin faltantes</div>Todos los productos tienen stock suficiente.</div></div>
          ) : (
            <div className="llx-tablecard">
              <div className="llx-tabletop">
                <div className="t"><Package className="h-[17px] w-[17px]" /> Lista de Carga — Galpón — {formattedDate}</div>
                <span className="badge">{filteredRows.length} {filteredRows.length === 1 ? "producto" : "productos"}</span>
              </div>
              <div className={`llx-grid llx-thead ${includeStock ? "llx-g7" : "llx-g5"}`}>
                <span>#</span><span>Producto</span><span>Unidad</span>
                <span className="r">Total pedido</span>
                {includeStock && <span className="r">Stock</span>}
                {includeStock && <span className="r">Neto a comprar</span>}
                <span className="r">Clientes</span>
              </div>
              {(() => {
                const grouped: Record<string, LoadListRow[]> = {};
                for (const row of filteredRows) {
                  const cat = row.category || "Sin categoría";
                  if (!grouped[cat]) grouped[cat] = [];
                  grouped[cat].push(row);
                }
                const sortedCats = [
                  ...CATEGORY_ORDER.filter((c) => grouped[c]?.length > 0),
                  ...Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c) && grouped[c]?.length > 0),
                ];
                let globalIdx = 0;
                return sortedCats.map((cat) => (
                  <div key={`cat-${cat}`}>
                    <div className="llx-catrow">{cat}</div>
                    {grouped[cat].map((row) => {
                      globalIdx++;
                      const status = getRowStatus(row);
                      const isShortage = status === "shortage" || status === "duda-pending";
                      const isDuda = status === "duda-unresolved";
                      const isDudaOk = status === "duda-ok";
                      const rowClass = isDuda ? "duda" : (includeStock && isShortage ? "buy" : "");
                      return (
                        <div
                          key={`${row.productId}-${row.unit}`}
                          className={`llx-grid llx-prow ${includeStock ? "llx-g7" : "llx-g5"} ${rowClass}`}
                          onClick={() => {
                            if (isDuda || isDudaOk || status === "duda-pending") setDudaRow(row);
                            else setDetailRow(row);
                          }}
                          data-testid={`load-row-${row.productId}-${row.unit}`}
                        >
                          <span className="llx-pidx">{globalIdx}</span>
                          <div style={{ minWidth: 0 }}>
                            <div className="llx-pname">
                              {isDuda && <HelpCircle className="h-3.5 w-3.5" style={{ color: "#c08a1e" }} />}
                              {row.productName}
                            </div>
                            {row.demandByUnit && row.demandByUnit.length > 1 && (
                              <div className="llx-pdesg" data-testid={`demand-breakdown-${row.productId}`}>
                                {row.demandByUnit.map((d) => `${fmtQty(d.qty, d.unit)} ${d.unit.toLowerCase()}`).join(" + ")}
                              </div>
                            )}
                          </div>
                          <span><span className="llx-uchip">{row.unit}</span></span>
                          <span className="r llx-ptot llx-num">{fmtQty(row.totalQty, row.unit)}</span>
                          {includeStock && <span className="r llx-pstk llx-num">{fmtQty(row.stockQty, row.unit)}</span>}
                          {includeStock && (
                            <div className="r">
                              {isDudaOk ? (
                                <div className="llx-pneto ok"><span className="n">OK</span></div>
                              ) : isDuda ? (
                                <div className="llx-pneto duda"><span className="n"><HelpCircle className="h-3 w-3" /> DUDA</span></div>
                              ) : isShortage ? (
                                <div className="llx-pneto"><span className="n llx-num">{fmtDiff(Math.abs(row.diffQty), row.unit)}</span><span className="tag">a comprar</span></div>
                              ) : (
                                <div className="llx-pneto ok"><span className="n">OK</span></div>
                              )}
                            </div>
                          )}
                          <button
                            className="llx-pclients"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isDuda || isDudaOk || status === "duda-pending") setDudaRow(row);
                              else setDetailRow(row);
                            }}
                            data-testid={`button-detail-${row.productId}-${row.unit}`}
                          >
                            <Users className="h-[15px] w-[15px]" /> {row.customersCount} <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Detail dialog (filas normales) */}
      <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailRow(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              {detailRow?.productName} — {detailRow?.unit}
            </DialogTitle>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Total pedido</p>
                  <p className="font-bold text-foreground">{fmtQty(detailRow.totalQty, detailRow.unit)}</p>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Stock</p>
                  <p className="font-bold text-foreground">{fmtQty(detailRow.stockQty, detailRow.unit)}</p>
                </div>
                <div className={`rounded-lg p-3 ${detailRow.diffQty < 0 ? "bg-red-100 dark:bg-red-950/40" : "bg-green-100 dark:bg-green-950/40"}`}>
                  <p className="text-xs text-muted-foreground mb-0.5">Diferencia</p>
                  <p className={`font-bold ${detailRow.diffQty < 0 ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                    {detailRow.diffQty > 0 ? "+" : ""}{fmtDiff(detailRow.diffQty, detailRow.unit)}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Clientes que lo piden ({detailRow.customersCount})
                </p>
                <ul className="space-y-1">
                  {detailRow.customerNames.map((name, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Duda dialog */}
      <Dialog open={!!dudaRow} onOpenChange={(open) => !open && setDudaRow(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-yellow-500" />
              Stock en otra unidad — {dudaRow?.productName}
            </DialogTitle>
          </DialogHeader>
          {dudaRow && (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Se piden <strong>{fmtQty(dudaRow.totalQty, dudaRow.unit)} {dudaRow.unit}</strong>, pero el stock
                disponible en esa unidad es <strong>{fmtQty(dudaRow.stockQty, dudaRow.unit)}</strong>.
              </p>

              {/* Stock sobrante del producto (stock - pedidos ya asignados en la misma unidad) */}
              {(() => {
                // Para cada unidad con stock, calcular cuánto queda libre
                // después de restar los pedidos del día en esa misma unidad
                const netStock = dudaRow.allProductStock
                  .map((s) => {
                    const sameUnitRow = data?.rows.find(
                      (r) => r.productId === dudaRow.productId && r.unit === s.unit,
                    );
                    // Si hay pedidos en esa unidad, lo libre = max(0, diffQty de esa fila)
                    const free = sameUnitRow
                      ? Math.max(0, sameUnitRow.diffQty)
                      : s.qty;
                    return { unit: s.unit, free, total: s.qty };
                  })
                  .filter((s) => s.free > 0 || s.total > 0);

                return (
                  <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Stock libre (sin pedidos asignados)
                    </p>
                    {netStock.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">Sin stock libre</p>
                    ) : (
                      netStock.map((s) => (
                        <div key={s.unit} className="flex items-center justify-between">
                          <Badge variant="outline" className="text-[10px] font-mono">{s.unit}</Badge>
                          <span className="font-semibold">
                            {s.free % 1 === 0 ? s.free.toFixed(0) : s.free.toFixed(2)}
                            <span className="text-xs font-normal text-muted-foreground ml-1">
                              de {s.total % 1 === 0 ? s.total.toFixed(0) : s.total.toFixed(2)} total
                            </span>
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                );
              })()}

              <p className="text-xs text-muted-foreground">
                ¿Cómo querés manejar este producto?
              </p>

              <div className="grid grid-cols-1 gap-2">
                <Button
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => resolveRow(dudaRow, "ok")}
                >
                  Completamos con stock existente
                </Button>
                <Button
                  variant="outline"
                  className="w-full border-destructive text-destructive hover:bg-destructive/10"
                  onClick={() => resolveRow(dudaRow, "pending")}
                >
                  Marcar como pendiente de compra
                </Button>
              </div>

              {/* Clientes */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Clientes que lo piden
                </p>
                <ul className="space-y-0.5">
                  {dudaRow.customerNames.map((name, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 flex-shrink-0" />
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
