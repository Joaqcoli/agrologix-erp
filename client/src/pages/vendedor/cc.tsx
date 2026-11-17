// Cuentas corrientes del vendedor (17/11/2026): la misma tabla que ve el admin, solo lectura y solo sus clientes
// (GET /api/vendedor/cc/summary). Sin ganancia ni márgenes. Las sedes se ven por la cuenta del padre.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { VendedorLayout } from "./layout";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, Search } from "lucide-react";
import { fmtPesos } from "@/lib/format";
import { VX_CSS, MESES } from "./rx";

const fmt = fmtPesos;
const normTxt = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const fmtPct = (v: number) => v.toFixed(2).replace(".", ",") + "%";

type Row = {
  customerId: number; customerName: string; hasIva: boolean;
  saldoMesAnterior: number; facturacion: number; cobranza: number; retenciones: number; saldo: number; fiado: number; pctFiado: number;
};
type Totals = { saldoMesAnterior: number; facturacion: number; cobranza: number; retenciones: number; saldo: number; fiado: number };
type Summary = { month: number; year: number; customers: Row[]; totals: Totals };

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
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return [f(monday), f(nextMonday)];
}
function toISOWeek(d: Date): string {
  const tmp = new Date(d.getTime());
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const week1 = new Date(tmp.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${tmp.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}
const localStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function Saldo({ v }: { v: number }) {
  if (v > 0) return <span style={{ color: "#b0553f", fontWeight: 700 }}>{fmt(v)}</span>;
  if (v < 0) return <span style={{ color: "#5f8020", fontWeight: 700 }}>{fmt(v)}</span>;
  return <span style={{ color: "#c8ccc3" }}>$0</span>;
}

export default function VendedorCC() {
  const [, setLocation] = useLocation();
  const today = new Date();
  const [filterType, setFilterType] = useState<FilterType>("mes");
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState(() => localStr(today));
  const [selectedWeek, setSelectedWeek] = useState(() => toISOWeek(today));
  const [search, setSearch] = useState("");
  const years = Array.from({ length: 3 }, (_, i) => today.getFullYear() - i);

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
      return [selectedDate, localStr(d)];
    }
    return weekRange(selectedWeek);
  }, [filterType, selectedMonth, selectedYear, selectedDate, selectedWeek]);

  const { data, isLoading, error } = useQuery<Summary>({
    queryKey: ["/api/vendedor/cc/summary", dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`/api/vendedor/cc/summary?dateFrom=${dateFrom}&dateTo=${dateTo}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const q = normTxt(search);
  const rows = useMemo(() => {
    const all = data?.customers ?? [];
    return q ? all.filter((r) => normTxt(r.customerName).includes(q)) : all;
  }, [data, q]);
  const totals = useMemo<Totals | null>(() => {
    if (!data) return null;
    if (!q) return data.totals;
    return rows.reduce<Totals>((a, r) => ({
      saldoMesAnterior: a.saldoMesAnterior + r.saldoMesAnterior, facturacion: a.facturacion + r.facturacion, cobranza: a.cobranza + r.cobranza,
      retenciones: a.retenciones + r.retenciones, saldo: a.saldo + r.saldo, fiado: a.fiado + r.fiado,
    }), { saldoMesAnterior: 0, facturacion: 0, cobranza: 0, retenciones: 0, saldo: 0, fiado: 0 });
  }, [data, q, rows]);

  const deudores = (data?.customers ?? []).filter((r) => r.saldo > 0).length;
  const label = filterType === "mes"
    ? `${MESES[selectedMonth - 1]} ${selectedYear}`
    : filterType === "dia"
      ? new Date(selectedDate + "T00:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })
      : (() => { const [f, t] = weekRange(selectedWeek); const d1 = new Date(f + "T00:00:00"); const d2 = new Date(new Date(t + "T00:00:00").getTime() - 86400000); return `${d1.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} – ${d2.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}`; })();

  return (
    <VendedorLayout title="Cuentas Corrientes">
      <div className="vx">
        <style>{VX_CSS}</style>
        <div className="vx-wrap">
          <div className="vx-top">
            <div>
              <h1 className="vx-title">Cuentas corrientes</h1>
              <div className="vx-subtitle">{label} · lo que te deben tus clientes y lo que fueron pagando</div>
            </div>
            <div className="vx-controls">
              <div className="vx-seg">
                {(["mes", "semana", "dia"] as FilterType[]).map((t) => (
                  <button key={t} className={filterType === t ? "on" : ""} onClick={() => setFilterType(t)}>{t === "mes" ? "Mes" : t === "semana" ? "Semana" : "Día"}</button>
                ))}
              </div>
              {filterType === "mes" && (
                <>
                  <div className="vx-sel">
                    <select value={String(selectedMonth)} onChange={(e) => setSelectedMonth(Number(e.target.value))} data-testid="select-month">
                      {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                    </select>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </div>
                  <div className="vx-sel">
                    <select value={String(selectedYear)} onChange={(e) => setSelectedYear(Number(e.target.value))} data-testid="select-year">
                      {years.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </div>
                </>
              )}
              {filterType === "dia" && <input type="date" className="vx-input" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />}
              {filterType === "semana" && <input type="week" className="vx-input" value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)} />}
            </div>
          </div>

          {data && (
            <div className="vx-kpis">
              <div className={`vx-kpi${data.totals.saldo > 0 ? " warn" : ""}`}>
                <div className="lab">Te deben hoy</div>
                <div className="val">{fmt(data.totals.saldo)}</div>
                <div className="note">{deudores} cliente{deudores !== 1 ? "s" : ""} con saldo</div>
              </div>
              <div className="vx-kpi">
                <div className="lab">Facturado en el período</div>
                <div className="val">{fmt(data.totals.facturacion)}</div>
                <div className="note">con IVA, como la cuenta corriente</div>
              </div>
              <div className="vx-kpi main">
                <div className="lab">Cobrado en el período</div>
                <div className="val">{fmt(data.totals.cobranza)}</div>
                <div className="note">{data.totals.retenciones > 0 ? `+ ${fmt(data.totals.retenciones)} en retenciones` : "pagos registrados"}</div>
              </div>
            </div>
          )}

          <div className="vx-search">
            <Search className="h-[17px] w-[17px]" />
            <input placeholder="Buscar cliente..." value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-cc" />
          </div>

          {error && <div className="vx-err">Error al cargar: {String(error)}</div>}

          <div className="vx-card">
            <div className="vx-chead"><span className="t">Por cliente</span><span className="n">tocá un cliente para ver el detalle</span></div>
            <div className="vx-tblwrap">
              <table className="vx-tbl">
                <thead><tr>
                  <th className="l">Cliente</th><th className="vx-hide-m">Saldo ant.</th><th>Facturación</th><th>Cobranza</th><th className="vx-hide-m">Retenciones</th><th>Saldo</th><th className="vx-hide-m">% fiado</th>
                </tr></thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 7 }).map((_, j) => <td key={j} className={j === 0 ? "l" : j === 1 || j === 4 || j === 6 ? "vx-hide-m" : ""}><Skeleton className="h-4 w-full" /></td>)}</tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: "center", padding: "40px 22px", color: "#8b8f88" }}>{search ? "Ningún cliente coincide con la búsqueda" : "Sin movimientos en este período"}</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.customerId} className="click" onClick={() => setLocation(`/vendedor/cc/${r.customerId}?dateFrom=${dateFrom}&dateTo=${dateTo}&month=${selectedMonth}&year=${selectedYear}`)} data-testid={`row-customer-${r.customerId}`}>
                      <td className="l cli">{r.customerName}{r.hasIva && <span className="vx-chip iva" style={{ marginLeft: 8 }}>IVA</span>}</td>
                      <td className="vx-hide-m">{r.saldoMesAnterior !== 0 ? <Saldo v={r.saldoMesAnterior} /> : <span style={{ color: "#c8ccc3" }}>—</span>}</td>
                      <td>{r.facturacion > 0 ? fmt(r.facturacion) : <span style={{ color: "#c8ccc3" }}>—</span>}</td>
                      <td className={r.cobranza > 0 ? "pos" : "dash"}>{r.cobranza > 0 ? fmt(r.cobranza) : "—"}</td>
                      <td className="vx-hide-m" style={{ color: r.retenciones > 0 ? "#3a67a3" : "#c8ccc3" }}>{r.retenciones > 0 ? fmt(r.retenciones) : "—"}</td>
                      <td><Saldo v={r.saldo} /></td>
                      <td className="vx-hide-m mut">{r.pctFiado > 0 ? fmtPct(r.pctFiado) : "0,00%"}</td>
                    </tr>
                  ))}
                </tbody>
                {totals && rows.length > 0 && (
                  <tfoot><tr>
                    <td className="l">Total</td>
                    <td className="vx-hide-m"><Saldo v={totals.saldoMesAnterior} /></td>
                    <td>{fmt(totals.facturacion)}</td>
                    <td className={totals.cobranza > 0 ? "pos" : "dash"}>{totals.cobranza > 0 ? fmt(totals.cobranza) : "—"}</td>
                    <td className="vx-hide-m" style={{ color: totals.retenciones > 0 ? "#3a67a3" : "#c8ccc3" }}>{totals.retenciones > 0 ? fmt(totals.retenciones) : "—"}</td>
                    <td><Saldo v={totals.saldo} /></td>
                    <td className="vx-hide-m" />
                  </tr></tfoot>
                )}
              </table>
            </div>
          </div>
          <div className="vx-note">Montos con IVA (como la cuenta corriente). Saldo en rojo = el cliente debe; en verde = tiene a favor.</div>
        </div>
      </div>
    </VendedorLayout>
  );
}
