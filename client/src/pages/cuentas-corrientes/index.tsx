import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { fmtFecha } from "@/lib/format";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, TrendingUp, Package, DollarSign, ChevronDown, Search } from "lucide-react";
import { useState, useMemo } from "react";

// ── Rediseño Cuentas Corrientes (Claude Design) — CSS de diseno-caja/cuentas-corrientes-rediseno.html ──
const CCX_CSS = `
.cc-rx{background:#f4f4f1;min-height:100%;padding:30px 24px 56px;font-family:'Inter',system-ui,sans-serif;color:#1e2420;}
.cc-rx *{box-sizing:border-box;}
.ccx-wrap{max-width:1360px;margin:0 auto;}
.ccx-num{font-family:'Bricolage Grotesque','Inter',sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.ccx-top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:22px;}
.ccx-title{font-family:'Bricolage Grotesque';font-size:27px;font-weight:700;margin:0;letter-spacing:-.02em;}
.ccx-subtitle{font-size:13.5px;color:#8b8f88;margin-top:5px;}
.ccx-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.ccx-seg{display:inline-flex;background:#eeeeea;border-radius:10px;padding:3px;gap:2px;}
.ccx-seg button{border:none;background:transparent;font-family:'Inter';font-size:13px;font-weight:600;color:#6f7469;padding:7px 15px;border-radius:8px;cursor:pointer;}
.ccx-seg button.on{background:#6b8a2a;color:#fff;box-shadow:0 1px 2px rgba(0,0,0,.12);}
.ccx-sel{position:relative;display:inline-flex;}
.ccx-sel select{appearance:none;-webkit-appearance:none;background:#fff;border:1px solid #ecece8;border-radius:10px;padding:9px 34px 9px 14px;font-family:'Inter';font-size:13.5px;font-weight:500;color:#1e2420;cursor:pointer;min-width:96px;}
.ccx-sel select:focus{outline:none;border-color:#5f8020;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.ccx-sel svg{position:absolute;right:12px;top:50%;transform:translateY(-50%);pointer-events:none;color:#8b8f88;}
.ccx-dateinput{background:#fff;border:1px solid #ecece8;border-radius:10px;padding:9px 13px;font-family:'Inter';font-size:13.5px;color:#1e2420;}
.ccx-dateinput:focus{outline:none;border-color:#5f8020;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.ccx-btn{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #ecece8;border-radius:10px;padding:9px 15px;font-family:'Inter';font-size:13.5px;font-weight:500;color:#1e2420;cursor:pointer;}
.ccx-btn:hover:not(:disabled){border-color:#cfcfc9;background:#f6f6f2;}
.ccx-btn:disabled{opacity:.5;cursor:default;}
.ccx-btn svg{color:#5f8020;}
.ccx-card{background:#fff;border:1px solid #ecece8;border-radius:16px;padding:6px 4px 8px;overflow:hidden;}
.ccx-cardhead{font-family:'Bricolage Grotesque';font-size:15px;font-weight:700;letter-spacing:-.01em;padding:18px 22px 14px;}
.ccx-tblwrap{overflow-x:auto;}
table.ccx-tbl{width:100%;border-collapse:collapse;}
.ccx-tbl th{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#9a9e96;text-align:right;padding:0 22px 13px;border-bottom:1px solid #eeeeea;white-space:nowrap;}
.ccx-tbl th.l{text-align:left;}
.ccx-tbl td{padding:13px 22px;border-bottom:1px solid #f5f5f2;font-size:14px;text-align:right;white-space:nowrap;}
.ccx-tbl td.l{text-align:left;}
.ccx-tbl tbody tr:hover td{background:#f8f8f5;cursor:pointer;}
.ccx-cli{font-weight:600;color:#1e2420;display:inline-flex;align-items:center;gap:9px;}
.ccx-iva{font-size:10px;font-weight:700;letter-spacing:.02em;color:#3a67a3;background:#e9eff7;border:1px solid #d7e2f0;padding:1px 7px;border-radius:5px;}
.ccx-deb{color:#b0553f;font-weight:600;}
.ccx-fac{color:#1e2420;}
.ccx-cob{color:#5f8020;font-weight:600;}
.ccx-ret{color:#3a67a3;font-weight:500;}
.ccx-dash{color:#c8ccc3;}
.ccx-sal{color:#b0553f;font-weight:700;}
.ccx-sal.pos{color:#5f8020;}
.ccx-fiado{color:#7a7f77;font-weight:500;}
.ccx-tbl tfoot td{border-top:1.5px solid #eaeae6;border-bottom:none;font-weight:700;padding-top:15px;}
.ccx-tbl tfoot td.l{font-family:'Bricolage Grotesque';text-transform:uppercase;}
.ccx-search{position:relative;max-width:620px;margin-bottom:22px;}
.ccx-search>svg{position:absolute;left:15px;top:50%;transform:translateY(-50%);color:#8b8f88;pointer-events:none;}
.ccx-search input{width:100%;background:#fff;border:1px solid #ecece8;border-radius:12px;padding:13px 15px 13px 44px;font-family:'Inter';font-size:14px;color:#1e2420;}
.ccx-search input::placeholder{color:#a9ada4;}
.ccx-search input:focus{outline:none;border-color:#5f8020;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.ccx-empty{padding:40px 22px;text-align:center;color:#8b8f88;font-size:14px;}
.ccx-err{font-size:13.5px;color:#b0553f;padding:12px 16px;background:#f8ede8;border:1px solid #e6cdc4;border-radius:12px;margin-bottom:16px;}
`;

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// Búsqueda sin acentos ni mayúsculas: "resi" encuentra RESIDENCIA ESTILO
const normTxt = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const fmtInt = (v: number) => Math.round(v).toLocaleString("es-AR");
// % con coma decimal (es-AR): 49,94%
const fmtPct = (v: number) => v.toFixed(2).replace(".", ",") + "%";

type CCCustomerRow = {
  customerId: number;
  customerName: string;
  hasIva: boolean;
  saldoMesAnterior: number;
  facturacion: number;
  cobranza: number;
  retenciones: number;
  saldo: number;
  fiado: number;
  pctFiado: number;
};

type CCTotals = {
  saldoMesAnterior: number;
  facturacion: number;
  cobranza: number;
  retenciones: number;
  saldo: number;
  fiado: number;
};

type CCSemana = {
  label: string;
  start: number;
  end: number;
  total: number;
};

type CCSummary = {
  month: number;
  year: number;
  daysInMonth: number;
  customers: CCCustomerRow[];
  totals: CCTotals;
  semanas: CCSemana[];
  ventaMes: number;
  bultosMes: number;
  gananciaMes: number;
  promedioDia: number;
  promedioGanancia: number;
  margenPct: number;
};

function SaldoBadge({ saldo }: { saldo: number }) {
  // Solo cambia el color según el signo (mismo valor/cálculo): >0 coral (deuda), <0 verde (a favor)
  if (saldo > 0) return <span className="ccx-sal ccx-num">${fmtInt(saldo)}</span>;
  if (saldo < 0) return <span className="ccx-sal pos ccx-num">${fmtInt(saldo)}</span>;
  return <span className="ccx-dash ccx-num">$0</span>;
}

type FilterType = "mes" | "semana" | "dia";

function weekRange(weekStr: string): [string, string] {
  const [ys, ws] = weekStr.split("-W");
  const year = parseInt(ys), week = parseInt(ws);
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = (jan4.getDay() + 6) % 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + (week - 1) * 7);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  const fmt = fmtFecha;
  return [fmt(monday), fmt(nextMonday)];
}

function toISOWeek(d: Date): string {
  const tmp = new Date(d.getTime());
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const week1 = new Date(tmp.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${tmp.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export default function CuentasCorrientesPage() {
  const [, setLocation] = useLocation();
  const today = new Date();
  const [filterType, setFilterType] = useState<FilterType>("mes");
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState(() => today.toISOString().split("T")[0]);
  const [selectedWeek, setSelectedWeek] = useState(() => toISOWeek(today));
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");

  const years = Array.from({ length: 4 }, (_, i) => today.getFullYear() - i);

  const [dateFrom, dateTo] = useMemo<[string, string]>(() => {
    if (filterType === "mes") {
      const from = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-01`;
      const em = selectedMonth === 12 ? 1 : selectedMonth + 1;
      const ey = selectedMonth === 12 ? selectedYear + 1 : selectedYear;
      return [from, `${ey}-${String(em).padStart(2, "0")}-01`];
    }
    if (filterType === "dia") {
      const d = new Date(selectedDate + "T00:00:00");
      d.setDate(d.getDate() + 1);
      return [selectedDate, d.toISOString().split("T")[0]];
    }
    return weekRange(selectedWeek);
  }, [filterType, selectedMonth, selectedYear, selectedDate, selectedWeek]);

  const { data, isLoading, error } = useQuery<CCSummary>({
    queryKey: ["/api/ar/cc/summary", dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`/api/ar/cc/summary?dateFrom=${dateFrom}&dateTo=${dateTo}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  // Filtro por nombre de cliente (solo presentación: no vuelve a consultar el servidor)
  const q = normTxt(search);
  const rows = useMemo(() => {
    const all = data?.customers ?? [];
    if (!q) return all;
    return all.filter((r) => normTxt(r.customerName).includes(q));
  }, [data, q]);
  // Con búsqueda activa, el Total suma solo los clientes visibles; sin búsqueda, usa el total del servidor
  const totals = useMemo<CCTotals | null>(() => {
    if (!data) return null;
    if (!q) return data.totals;
    return rows.reduce<CCTotals>((acc, r) => ({
      saldoMesAnterior: acc.saldoMesAnterior + r.saldoMesAnterior,
      facturacion: acc.facturacion + r.facturacion,
      cobranza: acc.cobranza + r.cobranza,
      retenciones: acc.retenciones + r.retenciones,
      saldo: acc.saldo + r.saldo,
      fiado: acc.fiado + r.fiado,
    }), { saldoMesAnterior: 0, facturacion: 0, cobranza: 0, retenciones: 0, saldo: 0, fiado: 0 });
  }, [data, q, rows]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/ar/cc/export?month=${selectedMonth}&year=${selectedYear}`, { credentials: "include" });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `CC-${MONTHS[selectedMonth - 1]}-${selectedYear}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const monthLabel = filterType === "mes"
    ? `${MONTHS[selectedMonth - 1]} ${selectedYear}`
    : filterType === "dia"
      ? new Date(selectedDate + "T00:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })
      : (() => { const [f, t] = weekRange(selectedWeek); const d1 = new Date(f + "T00:00:00"); const d2 = new Date(new Date(t + "T00:00:00").getTime() - 86400000); return `${d1.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} – ${d2.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}`; })();

  return (
    <Layout title="Cuentas Corrientes">
      <div className="cc-rx">
        <style>{CCX_CSS}</style>
        <div className="ccx-wrap">
          {/* Encabezado */}
          <div className="ccx-top">
            <div>
              <h1 className="ccx-title">Cuentas Corrientes</h1>
              <div className="ccx-subtitle">{monthLabel}</div>
            </div>
            <div className="ccx-controls">
              {/* Toggle Mes/Semana/Día */}
              <div className="ccx-seg">
                {(["mes", "semana", "dia"] as FilterType[]).map((t) => (
                  <button key={t} className={filterType === t ? "on" : ""} onClick={() => setFilterType(t)}>
                    {t === "mes" ? "Mes" : t === "semana" ? "Semana" : "Día"}
                  </button>
                ))}
              </div>

              {filterType === "mes" && (
                <>
                  <div className="ccx-sel">
                    <select value={String(selectedMonth)} onChange={(e) => setSelectedMonth(Number(e.target.value))} data-testid="select-month">
                      {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                    </select>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </div>
                  <div className="ccx-sel">
                    <select value={String(selectedYear)} onChange={(e) => setSelectedYear(Number(e.target.value))} data-testid="select-year">
                      {years.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </div>
                </>
              )}
              {filterType === "dia" && (
                <input type="date" className="ccx-dateinput" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} data-testid="input-filter-date" />
              )}
              {filterType === "semana" && (
                <input type="week" className="ccx-dateinput" value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)} data-testid="input-filter-week" />
              )}

              <button className="ccx-btn" onClick={handleExport} disabled={exporting || isLoading || filterType !== "mes"} title={filterType !== "mes" ? "Exportar solo disponible para vista mensual" : ""} data-testid="button-export-cc">
                <Download className="h-4 w-4" /> {exporting ? "..." : "Exportar XLSX"}
              </button>
            </div>
          </div>

          {/* Buscador */}
          <div className="ccx-search">
            <Search className="h-[17px] w-[17px]" />
            <input placeholder="Buscar cliente..." value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-cc" />
          </div>

          {error && <div className="ccx-err">Error al cargar: {String(error)}</div>}

          <div className="ccx-card">
            <div className="ccx-cardhead">Por cliente — {monthLabel}</div>
            <div className="ccx-tblwrap">
              <table className="ccx-tbl">
                <thead>
                  <tr>
                    <th className="l">Cliente</th>
                    <th>Saldo ant.</th><th>Facturación</th><th>Cobranza</th><th>Retenciones</th><th>Saldo</th><th>% fiado</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 7 }).map((_, j) => (
                          <td key={j} className={j === 0 ? "l" : ""}><Skeleton className="h-4 w-full" /></td>
                        ))}
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: "center", padding: "40px 22px", color: "#8b8f88" }}>{search ? "Ningún cliente coincide con la búsqueda" : "Sin movimientos en este período"}</td></tr>
                  ) : rows.map((row) => (
                    <tr
                      key={row.customerId}
                      onClick={() => setLocation(`/cuentas-corrientes/${row.customerId}?dateFrom=${dateFrom}&dateTo=${dateTo}&month=${selectedMonth}&year=${selectedYear}`)}
                      data-testid={`row-customer-${row.customerId}`}
                    >
                      <td className="l"><span className="ccx-cli">{row.customerName}{row.hasIva && <span className="ccx-iva">IVA</span>}</span></td>
                      <td>{row.saldoMesAnterior !== 0 ? <SaldoBadge saldo={row.saldoMesAnterior} /> : <span className="ccx-dash">—</span>}</td>
                      <td>{row.facturacion > 0 ? <span className="ccx-fac ccx-num">${fmtInt(row.facturacion)}</span> : <span className="ccx-dash">—</span>}</td>
                      <td>{row.cobranza > 0 ? <span className="ccx-cob ccx-num">${fmtInt(row.cobranza)}</span> : <span className="ccx-dash">—</span>}</td>
                      <td>{row.retenciones > 0 ? <span className="ccx-ret ccx-num">${fmtInt(row.retenciones)}</span> : <span className="ccx-dash">—</span>}</td>
                      <td><SaldoBadge saldo={row.saldo} /></td>
                      <td>{row.pctFiado > 0 ? <span className="ccx-fiado ccx-num">{fmtPct(row.pctFiado)}</span> : <span className="ccx-dash ccx-num">0,00%</span>}</td>
                    </tr>
                  ))}
                </tbody>
                {totals && rows.length > 0 && (
                  <tfoot>
                    <tr>
                      <td className="l">Total</td>
                      <td><SaldoBadge saldo={totals.saldoMesAnterior} /></td>
                      <td><span className="ccx-fac ccx-num">${fmtInt(totals.facturacion)}</span></td>
                      <td>{totals.cobranza > 0 ? <span className="ccx-cob ccx-num">${fmtInt(totals.cobranza)}</span> : <span className="ccx-dash">—</span>}</td>
                      <td>{totals.retenciones > 0 ? <span className="ccx-ret ccx-num">${fmtInt(totals.retenciones)}</span> : <span className="ccx-dash">—</span>}</td>
                      <td><SaldoBadge saldo={totals.saldo} /></td>
                      <td><span className="ccx-dash">—</span></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
