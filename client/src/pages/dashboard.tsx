import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download } from "lucide-react";
import { generateBolsaFvPDF, generateComisionesPDF, type BolsaFvRow, type ComisionRow } from "@/lib/pdf";

// ─── Helpers ──────────────────────────────────────────────────────────────────
import { fmtPesos, fmtMiles } from "@/lib/format";
const fmt = fmtPesos;
const fmtInt = fmtMiles;

function localStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function todayRange(): [string, string] {
  const d = new Date();
  const from = localStr(d);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return [from, localStr(next)];
}

function weekRange(): [string, string] {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  const sun = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff + 7);
  return [localStr(mon), localStr(sun)];
}

function monthRange(): [string, string] {
  const d = new Date();
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return [from, localStr(nextMonth)];
}

function yearRange(): [string, string] {
  const y = new Date().getFullYear();
  return [`${y}-01-01`, `${y + 1}-01-01`];
}

const MES_ABBR = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
function monthAbbrev(ym: string): string {
  const m = parseInt((ym ?? "").split("-")[1] || "0", 10);
  return MES_ABBR[m - 1] ?? ym;
}
const fmtFechaCorta = (ymd: string) =>
  new Date(ymd + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
const fmtMill = (v: number) => (v / 1_000_000).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtPct1 = (v: number) => v.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// ─── Types ────────────────────────────────────────────────────────────────────
type Stats = {
  ventas: number;
  ganancia_bruta: number;
  mermaTotal: number;
  rindeTotal: number;
  ganancia_real: number;
  diasPeriodo: number;
  diasTrabajados: number;
  semanas: { label: string; ventas: number; bultos: number }[];
  bultosTotal: number;
  vaciosRecibidosPeriodo: { qty: number; pesos: number };
  vaciosEntregadosPeriodo: { pesos: number; qty: number };
  vaciosEnPoder: { qty: number; pesos: number };
  deudaProveedores: number;
  deudaClientes: number;
  chequesEmitidos: number;
  chequesEnCartera: number;
  stockValorizado: number;
  comisiones: { vendedor: string; total: number }[];
};

type TrendPoint = { ym: string; ventas: number; margen: number };

// ─── Comisiones Modal (sin cambios — misma lógica/datos) ──────────────────────
function ComisionesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const d0 = new Date();
  const [selectedVendedor, setSelectedVendedor] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(
    `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}`
  );

  const { data: salespersons } = useQuery<string[]>({
    queryKey: ["/api/commissions/salespersons"],
    queryFn: () => fetch("/api/commissions/salespersons", { credentials: "include" }).then((r) => r.json()),
    enabled: open,
  });

  useEffect(() => {
    if (salespersons && salespersons.length > 0 && !selectedVendedor) {
      setSelectedVendedor(salespersons[0]);
    }
  }, [salespersons, selectedVendedor]);

  const [y, m] = selectedMonth.split("-").map(Number);
  const { data: detail, isLoading: detailLoading } = useQuery<{
    rows: ComisionRow[];
    totalVentas: number;
    totalComision: number;
  }>({
    queryKey: ["/api/commissions/detail", selectedVendedor, selectedMonth],
    queryFn: () =>
      fetch(`/api/commissions/detail?salesperson=${encodeURIComponent(selectedVendedor)}&month=${m}&year=${y}`, {
        credentials: "include",
      }).then((r) => r.json()),
    enabled: open && !!selectedVendedor,
  });

  const monthOptions = buildMonthOptions();
  const monthLabel = monthOptions.find((o) => o.value === selectedMonth)?.label ?? selectedMonth;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Detalle de Comisiones</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Vendedor</label>
            <Select value={selectedVendedor} onValueChange={setSelectedVendedor}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Seleccionar vendedor" />
              </SelectTrigger>
              <SelectContent>
                {(salespersons ?? []).map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Período</label>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {detail && (detail.rows ?? []).length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => generateComisionesPDF(selectedVendedor, monthLabel, detail.rows, detail.totalVentas, detail.totalComision)}
            >
              <Download className="h-3.5 w-3.5 mr-1" /> PDF
            </Button>
          )}
        </div>

        <div className="overflow-y-auto flex-1">
          {detailLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : !detail || (detail.rows ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sin pedidos en el período</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left pb-1.5 text-xs text-muted-foreground font-medium">Fecha</th>
                  <th className="text-left pb-1.5 text-xs text-muted-foreground font-medium">Cliente</th>
                  <th className="text-right pb-1.5 text-xs text-muted-foreground font-medium">Total</th>
                  <th className="text-right pb-1.5 text-xs text-muted-foreground font-medium">%</th>
                  <th className="text-right pb-1.5 text-xs text-muted-foreground font-medium">Comisión</th>
                </tr>
              </thead>
              <tbody>
                {(detail.rows ?? []).map((row, i) => (
                  <tr key={i} className={`border-b border-border/50 last:border-0 ${i % 2 !== 0 ? "bg-muted/20" : ""}`}>
                    <td className="py-1.5 text-xs text-muted-foreground whitespace-nowrap pr-3">
                      {new Date(row.orderDate + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
                    </td>
                    <td className="py-1.5 pr-2">{row.customerName}</td>
                    <td className="py-1.5 text-right text-xs tabular-nums">{fmt(row.total)}</td>
                    <td className="py-1.5 text-right text-xs text-muted-foreground tabular-nums pl-3">{row.commissionPct.toFixed(1)}%</td>
                    <td className="py-1.5 text-right font-medium tabular-nums pl-3">{fmt(row.commissionAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border">
                  <td colSpan={2} className="pt-2 text-xs font-semibold">Total</td>
                  <td className="pt-2 text-right text-xs font-bold tabular-nums">{fmt(detail.totalVentas)}</td>
                  <td />
                  <td className="pt-2 text-right font-bold text-green-600 tabular-nums">{fmt(detail.totalComision)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type Period = "hoy" | "semana" | "mes" | "año" | "pormes" | "custom";

const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                     "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function monthInputRange(ym: string): [string, string] {
  const [y, m] = ym.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  const to = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  return [from, to];
}

function buildMonthOptions() {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  const endY = now.getFullYear();
  const endM = now.getMonth() + 1;
  let y = 2026, m = 1;
  while (y < endY || (y === endY && m <= endM)) {
    opts.push({ value: `${y}-${String(m).padStart(2, "0")}`, label: `${MONTH_NAMES[m - 1]} ${y}` });
    m++; if (m > 12) { m = 1; y++; }
  }
  return opts;
}

// Estilos olivo del rediseño (scoped a .va-dash). Variables de marca + hovers.
const DASH_CSS = `
.va-dash{
  --bg:#f3f4f0;--surface:#fff;--ink:#14270D;--muted:#869178;--line:rgba(20,39,13,.07);
  --primary:#6D8B28;--primary-deep:#5a7521;--primary-soft:#eef3e1;--bar-dim:#bcc79e;
  --grad-a:#7a9a2e;--grad-mid:#5f7d20;--grad-b:#2c4715;
  --pos:#5a7521;--pos-soft:#eef3e1;--neg:#bf5a2c;--neg-soft:#fbeee8;
  --alt:#293C4B;--alt-soft:#e9eef5;--orange:#d4742e;--orange-soft:rgba(237,133,68,.14);
  background:var(--bg);color:var(--ink);min-height:100%;
  font-variant-numeric:tabular-nums;
}
.va-dash *{box-sizing:border-box}
.va-card{border-radius:14px;background:var(--surface);border:1px solid var(--line);box-shadow:0 1px 2px rgba(20,39,13,.04)}
.va-fin{transition:box-shadow .18s ease,transform .18s ease}
.va-fin:hover{box-shadow:0 12px 30px rgba(20,39,13,.1);transform:translateY(-2px)}
.va-row{transition:background .12s ease}
.va-row:hover{background:var(--primary-soft)}
.va-barcol .va-bar{transition:transform .12s ease}
.va-barcol:hover .va-bar{transform:scaleY(1.03);transform-origin:bottom}
.va-pbtn{border:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;padding:7px 13px;border-radius:9px;background:transparent;color:var(--muted);transition:background .12s,color .12s}
.va-pbtn:hover{color:var(--ink)}
.va-pbtn.active{background:var(--ink);color:#fff;font-weight:700}
.va-link{font-size:12.5px;font-weight:600;color:var(--primary);text-decoration:none;cursor:pointer;background:none;border:none;padding:0}
`;

const LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" };

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("mes");
  const [customFrom, setCustomFrom] = useState(() => monthRange()[0]);
  const [customTo, setCustomTo] = useState(() => monthRange()[1]);
  const d0 = new Date();
  const [selectedMonth, setSelectedMonth] = useState(
    `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}`
  );
  const [bolsaFilter, setBolsaFilter] = useState<"all" | "bolsa" | "bolsa_propia">("all");
  const [comisionesOpen, setComisionesOpen] = useState(false);
  const [rindeOpen, setRindeOpen] = useState(false);
  const [mermaOpen, setMermaOpen] = useState(false);

  const [from, to] = useMemo((): [string, string] => {
    if (period === "hoy") return todayRange();
    if (period === "semana") return weekRange();
    if (period === "mes") return monthRange();
    if (period === "año") return yearRange();
    if (period === "pormes") return monthInputRange(selectedMonth);
    return [customFrom, customTo];
  }, [period, customFrom, customTo, selectedMonth]);

  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ["/api/dashboard/stats", from, to],
    queryFn: () =>
      fetch(`/api/dashboard/stats?from=${from}&to=${to}`, { credentials: "include" }).then((r) => r.json()),
    staleTime: 30_000,
  });

  // Serie fija de evolución mensual (Etapa 1) — NO depende del selector de período.
  const { data: trendData } = useQuery<TrendPoint[]>({
    queryKey: ["/api/dashboard/monthly-trend"],
    queryFn: () => fetch("/api/dashboard/monthly-trend", { credentials: "include" }).then((r) => r.json()),
    staleTime: 60_000,
  });

  const { data: rindeDetail } = useQuery<{ id: number; created_at: string; product_name: string; quantity: number; unit: string; unit_cost: number; total: number; notes: string }[]>({
    queryKey: ["/api/dashboard/rinde-detail", from, to],
    queryFn: () => fetch(`/api/dashboard/rinde-detail?from=${from}&to=${to}`, { credentials: "include" }).then(r => r.json()),
    enabled: rindeOpen,
    staleTime: 30_000,
  });

  const { data: mermaDetail } = useQuery<{ id: number; created_at: string; product_name: string; quantity: number; unit: string; unit_cost: number; total: number; notes: string }[]>({
    queryKey: ["/api/dashboard/merma-detail", from, to],
    queryFn: () => fetch(`/api/dashboard/merma-detail?from=${from}&to=${to}`, { credentials: "include" }).then(r => r.json()),
    enabled: mermaOpen,
    staleTime: 30_000,
  });

  const { data: bolsaData, isLoading: bolsaLoading } = useQuery<{ rows: BolsaFvRow[]; grandTotal: number }>({
    queryKey: ["/api/dashboard/bolsa-fv", from, to, bolsaFilter],
    queryFn: () =>
      fetch(`/api/dashboard/bolsa-fv?from=${from}&to=${to}&type=${bolsaFilter}`, { credentials: "include" }).then((r) => r.json()),
    staleTime: 30_000,
  });

  const s = stats;
  const diasPeriodo = s?.diasPeriodo ?? 1;
  const diasTrabajados = s?.diasTrabajados ?? 1;
  const ventasDia = s ? s.ventas / diasTrabajados : 0;
  const gananciaDia = s ? s.ganancia_real / diasTrabajados : 0;
  const margenPct = s && s.ventas > 0 ? (s.ganancia_bruta / s.ventas) * 100 : 0;

  const ajusteNeto = (s?.rindeTotal ?? 0) - (s?.mermaTotal ?? 0);
  const ajustePositivo = ajusteNeto >= 0;
  const recibidos = s?.vaciosRecibidosPeriodo ?? { qty: 0, pesos: 0 };
  const entregados = s?.vaciosEntregadosPeriodo ?? { pesos: 0, qty: 0 };
  const enPoder = s?.vaciosEnPoder ?? { qty: 0, pesos: 0 };

  const PERIOD_LABELS: Record<Period, string> = {
    hoy: "Hoy", semana: "Semana", mes: "Mes", año: "Año", pormes: "Por mes", custom: "Personalizado",
  };
  const RESUMEN: Record<Period, string> = {
    hoy: "Resumen de hoy", semana: "Resumen de la semana", mes: "Resumen del mes",
    año: "Resumen del año", pormes: "Resumen del mes", custom: "Resumen del período",
  };

  // Saludo + fecha
  const hora = d0.getHours();
  const saludo = hora < 12 ? "Buen día" : hora < 19 ? "Buenas tardes" : "Buenas noches";
  const hoyLargo = d0.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  const toDisp = (() => { const d = new Date(to + "T12:00:00"); d.setDate(d.getDate() - 1); return localStr(d); })();

  // ── Datos de los gráficos (serie monthly-trend) ──
  const trend = trendData ?? [];
  const nT = trend.length;
  const maxV = Math.max(...trend.map((t) => t.ventas), 1);
  const lastT = trend[nT - 1];
  const prevT = trend[nT - 2];
  const margenActual = lastT?.margen ?? 0;
  const margenDelta = lastT && prevT ? lastT.margen - prevT.margen : 0;
  const margenes = trend.map((t) => t.margen);
  const maxM = Math.max(...margenes, 0);
  const minM = Math.min(...margenes, maxM);
  const lineX = (i: number) => (nT <= 1 ? 150 : 10 + (280 * i) / (nT - 1));
  const lineY = (m: number) => (maxM === minM ? 73 : 110 - ((m - minM) / (maxM - minM)) * 74);
  const linePts = trend.map((t, i) => `${lineX(i).toFixed(1)},${lineY(t.margen).toFixed(1)}`).join(" ");
  const areaPts = nT > 0 ? `${linePts} ${lineX(nT - 1).toFixed(1)},110 ${lineX(0).toFixed(1)},110` : "";

  // ── Cascada ganancia real ──
  const wfBase = Math.max(s?.ganancia_bruta ?? 0, s?.ganancia_real ?? 0, 1);
  const wPct = (v: number) => `${Math.max(2, Math.min(100, (v / wfBase) * 100))}%`;
  const realText = (() => {
    const r = s?.rindeTotal ?? 0, mr = s?.mermaTotal ?? 0;
    if (r === 0 && mr === 0) return "Sin merma ni rinde en el período: la ganancia real quedó igual a la bruta.";
    if (r > mr) return `El rinde superó a la merma: ganaste ${fmt(ajusteNeto)} netos por encima de la ganancia bruta.`;
    if (mr > r) return `La merma superó al rinde: perdiste ${fmt(Math.abs(ajusteNeto))} por debajo de la ganancia bruta.`;
    return "Rinde y merma se compensaron: la ganancia real quedó igual a la bruta.";
  })();

  // ── Ventas por semana ──
  const maxWeek = Math.max(...(s?.semanas ?? []).map((w) => w.ventas), 1);
  // ── Bolsa FV: últimos movimientos (preview) ──
  const bolsaRows = bolsaData?.rows ?? [];
  const bolsaPreview = bolsaRows.slice(0, 6);
  const comisionesTotal = (s?.comisiones ?? []).reduce((acc, c) => acc + c.total, 0);

  return (
    <Layout title="Dashboard">
      <style dangerouslySetInnerHTML={{ __html: DASH_CSS }} />
      <div className="va-dash" style={{ padding: "26px 28px 56px" }}>
        <div style={{ maxWidth: 1480, margin: "0 auto" }}>

          {/* ── Header ── */}
          <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 18, marginBottom: 22 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: ".02em", color: "var(--muted)", marginBottom: 6, textTransform: "capitalize" }}>{saludo} · {hoyLargo}</div>
              <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1 }}>{RESUMEN[period]}</h1>
              <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 7 }}>{fmtFechaCorta(from)} — {fmtFechaCorta(toDisp)}</div>
            </div>
            <div style={{ display: "flex", gap: 4, background: "var(--surface)", padding: 5, borderRadius: 13, border: "1px solid var(--line)", boxShadow: "0 1px 2px rgba(20,39,13,.04)" }}>
              {(["hoy", "semana", "mes", "año", "pormes", "custom"] as Period[]).map((p) => (
                <button key={p} className={`va-pbtn ${period === p ? "active" : ""}`} onClick={() => setPeriod(p)}>{PERIOD_LABELS[p]}</button>
              ))}
            </div>
          </header>

          {/* Selectores de pormes / custom (misma funcionalidad que antes) */}
          {period === "pormes" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>Mes</label>
              <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}
                style={{ height: 32, fontSize: 13, borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", padding: "0 8px" }}>
                {buildMonthOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
          {period === "custom" && (
            <div className="flex flex-wrap items-center gap-3" style={{ marginBottom: 16 }}>
              <div className="flex items-center gap-2">
                <label style={{ fontSize: 12, color: "var(--muted)" }}>Desde</label>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 text-xs w-36" />
              </div>
              <div className="flex items-center gap-2">
                <label style={{ fontSize: 12, color: "var(--muted)" }}>Hasta</label>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 text-xs w-36" />
              </div>
            </div>
          )}

          {/* ── Hero KPIs ── */}
          <section style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 18 }}>
            {/* Ventas */}
            <div style={{ position: "relative", overflow: "hidden", borderRadius: 14, padding: "17px 19px", background: "linear-gradient(135deg,var(--grad-a) 0%,var(--grad-mid) 55%,var(--grad-b) 100%)", color: "#fff", boxShadow: "0 10px 26px rgba(20,39,13,.2)" }}>
              <span style={{ ...LABEL, color: "rgba(255,255,255,.85)", letterSpacing: ".1em" }}>Ventas</span>
              <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", marginTop: 13 }}>{isLoading ? "…" : (s ? fmt(s.ventas) : "—")}</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,.8)", marginTop: 5 }}>{diasPeriodo} día{diasPeriodo !== 1 ? "s" : ""} en el período</div>
            </div>
            {/* Ganancia bruta */}
            <div className="va-card" style={{ padding: "17px 19px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={LABEL}>Ganancia bruta</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--pos)" }}>{isLoading ? "" : `${fmtPct1(margenPct)}%`}</span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em", marginTop: 13, color: "var(--pos)" }}>{isLoading ? "…" : (s ? fmt(s.ganancia_bruta) : "—")}</div>
              <div style={{ marginTop: 9, height: 5, borderRadius: 99, background: "var(--primary-soft)", overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, margenPct)}%`, height: "100%", background: "linear-gradient(90deg,var(--primary),var(--grad-a))" }} />
              </div>
            </div>
            {/* Venta prom diario */}
            <div className="va-card" style={{ padding: "17px 19px" }}>
              <span style={LABEL}>Venta · prom. diario</span>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em", marginTop: 13 }}>{isLoading ? "…" : (s ? fmt(ventasDia) : "—")}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 7 }}>sobre {diasTrabajados} día{diasTrabajados !== 1 ? "s" : ""} operado{diasTrabajados !== 1 ? "s" : ""}</div>
            </div>
            {/* Ganancia prom diario */}
            <div className="va-card" style={{ padding: "17px 19px" }}>
              <span style={LABEL}>Ganancia · prom. diario</span>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em", marginTop: 13 }}>{isLoading ? "…" : (s ? fmt(gananciaDia) : "—")}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 7 }}>real neto promedio por día</div>
            </div>
          </section>

          {/* ── Gráficos mes a mes (serie monthly-trend) ── */}
          <section style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 18, marginBottom: 18 }}>
            {/* Ventas mes a mes (barras) */}
            <div className="va-card" style={{ padding: "22px 24px", borderRadius: 18 }}>
              <div>
                <span style={{ ...LABEL, fontSize: 12.5 }}>Ventas mes a mes</span>
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>últimos {nT || ""} meses · en millones</div>
              </div>
              {nT === 0 ? <Skeleton className="h-[200px] w-full mt-4" /> : (
                <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 200, marginTop: 18, paddingTop: 10 }}>
                  {trend.map((t, i) => {
                    const last = i === nT - 1;
                    return (
                      <div key={t.ym} className="va-barcol" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 9 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: last ? "var(--ink)" : "var(--muted)" }}>{fmtMill(t.ventas)}</span>
                        <div className="va-bar" style={{ width: "100%", maxWidth: 46, height: `${(t.ventas / maxV) * 100}%`, borderRadius: "8px 8px 4px 4px", background: last ? "var(--primary)" : "var(--bar-dim)" }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: last ? "var(--ink)" : "var(--muted)" }}>{monthAbbrev(t.ym)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Margen bruto (línea) */}
            <div className="va-card" style={{ padding: "22px 24px", borderRadius: 18 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <span style={{ ...LABEL, fontSize: 12.5 }}>Margen bruto</span>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>evolución del % de margen</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 23, fontWeight: 800, color: "var(--pos)", lineHeight: 1 }}>{nT ? `${fmtPct1(margenActual)}%` : "—"}</div>
                  {nT > 1 && <div style={{ fontSize: 12, color: margenDelta >= 0 ? "var(--pos)" : "var(--neg)", fontWeight: 600, marginTop: 2 }}>{margenDelta >= 0 ? "+" : "−"}{fmtPct1(Math.abs(margenDelta))} pts</div>}
                </div>
              </div>
              {nT === 0 ? <Skeleton className="h-[170px] w-full mt-5" /> : (
                <div style={{ marginTop: 20 }}>
                  <svg viewBox="0 0 300 130" width="100%" height="170" preserveAspectRatio="none" style={{ overflow: "visible" }}>
                    <line x1="10" y1="36.5" x2="290" y2="36.5" stroke="var(--line)" strokeWidth="1" />
                    <line x1="10" y1="73" x2="290" y2="73" stroke="var(--line)" strokeWidth="1" />
                    <line x1="10" y1="110" x2="290" y2="110" stroke="var(--line)" strokeWidth="1" />
                    {nT > 1 && <polygon points={areaPts} fill="var(--primary-soft)" />}
                    {nT > 1 && <polyline points={linePts} fill="none" style={{ stroke: "var(--primary)" }} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
                    {trend.map((t, i) => (
                      <circle key={t.ym} cx={lineX(i)} cy={lineY(t.margen)} r={i === nT - 1 ? 4.5 : 3.2} fill={i === nT - 1 ? "var(--primary)" : "var(--surface)"} style={{ stroke: "var(--primary)" }} strokeWidth="2.2" />
                    ))}
                  </svg>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>
                    {trend.map((t, i) => <span key={t.ym} style={{ color: i === nT - 1 ? "var(--ink)" : "var(--muted)" }}>{monthAbbrev(t.ym)}</span>)}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ── Ganancia real (cascada) ── */}
          <section className="va-card" style={{ padding: "22px 26px", borderRadius: 18, marginBottom: 18, display: "grid", gridTemplateColumns: "300px 1fr", gap: 44, alignItems: "center" }}>
            <div>
              <span style={{ ...LABEL, fontSize: 12.5 }}>Ganancia real del período</span>
              <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-.025em", marginTop: 12, lineHeight: 1 }}>{isLoading ? "…" : (s ? fmt(s.ganancia_real) : "—")}</div>
              {s && Math.abs(ajusteNeto) > 0 && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 14, fontSize: 13, fontWeight: 700, color: ajustePositivo ? "var(--pos)" : "var(--neg)", background: ajustePositivo ? "var(--pos-soft)" : "var(--neg-soft)", padding: "7px 13px", borderRadius: 999 }}>
                  {ajustePositivo ? "▲" : "▼"} {ajustePositivo ? "+" : "−"}{fmt(Math.abs(ajusteNeto))} sobre la bruta
                </div>
              )}
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12, lineHeight: 1.5 }}>{isLoading ? "" : realText}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              <div style={{ display: "grid", gridTemplateColumns: "78px 1fr 132px", alignItems: "center", gap: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>Bruta</span>
                <div style={{ height: 22, borderRadius: 6, background: "var(--bar-dim)", width: wPct(s?.ganancia_bruta ?? 0) }} />
                <span style={{ textAlign: "right", fontSize: 14.5, fontWeight: 700 }}>{s ? fmt(s.ganancia_bruta) : "—"}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "78px 1fr 132px", alignItems: "center", gap: 14 }}>
                <button className="va-link" style={{ fontSize: 13, fontWeight: 600, color: "var(--pos)", textAlign: "left" }} onClick={() => setRindeOpen(true)}>+ Rinde</button>
                <div style={{ height: 22, borderRadius: 6, background: "var(--pos)", width: wPct(s?.rindeTotal ?? 0) }} />
                <span style={{ textAlign: "right", fontSize: 14.5, fontWeight: 700, color: "var(--pos)" }}>+{s ? fmt(s.rindeTotal) : "—"}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "78px 1fr 132px", alignItems: "center", gap: 14 }}>
                <button className="va-link" style={{ fontSize: 13, fontWeight: 600, color: "var(--neg)", textAlign: "left" }} onClick={() => setMermaOpen(true)}>− Merma</button>
                <div style={{ height: 22, borderRadius: 6, background: "var(--neg)", width: wPct(s?.mermaTotal ?? 0) }} />
                <span style={{ textAlign: "right", fontSize: 14.5, fontWeight: 700, color: "var(--neg)" }}>−{s ? fmt(s.mermaTotal) : "—"}</span>
              </div>
              <div style={{ height: 1, background: "var(--line)", margin: "2px 0" }} />
              <div style={{ display: "grid", gridTemplateColumns: "78px 1fr 132px", alignItems: "center", gap: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)" }}>= Real</span>
                <div style={{ height: 26, borderRadius: 6, background: "linear-gradient(90deg,var(--grad-mid),var(--grad-b))", width: wPct(s?.ganancia_real ?? 0) }} />
                <span style={{ textAlign: "right", fontSize: 15, fontWeight: 800 }}>{s ? fmt(s.ganancia_real) : "—"}</span>
              </div>
            </div>
          </section>

          {/* ── Estado financiero ── */}
          <section style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18, marginBottom: 18 }}>
            <FinCard color="var(--pos)" soft="var(--pos-soft)" title="Por cobrar"
              a={{ label: "Deuda de clientes", value: s ? fmt(s.deudaClientes) : "—" }}
              b={{ label: "Cheques en cartera", value: s ? fmt(s.chequesEnCartera) : "—" }} loading={isLoading} />
            <FinCard color="var(--neg)" soft="var(--neg-soft)" title="Por pagar"
              a={{ label: "Deuda a proveedores", value: s ? fmt(s.deudaProveedores) : "—" }}
              b={{ label: "Cheques emitidos", value: s ? fmt(s.chequesEmitidos) : "—" }} loading={isLoading} />
            <FinCard color="var(--orange)" soft="var(--orange-soft)" title="Inventario y vacíos"
              a={{ label: "Vacíos en mi poder", value: s ? fmt(enPoder.pesos) : "—" }}
              b={{ label: "Stock valorizado", value: s ? fmt(s.stockValorizado) : "—" }} loading={isLoading} />
          </section>

          {/* ── Ventas y bultos por semana ── */}
          <section className="va-card" style={{ padding: "22px 26px", borderRadius: 18, marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <span style={{ ...LABEL, fontSize: 12.5 }}>Ventas y bultos por semana</span>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Bultos del período <b style={{ color: "var(--ink)", fontSize: 15 }}>{isLoading ? "…" : fmtInt(s?.bultosTotal ?? 0)}</b></span>
            </div>
            {isLoading ? <Skeleton className="h-24 w-full" /> : (s?.semanas ?? []).length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--muted)" }}>Sin datos en el período.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {s?.semanas.map((w) => (
                  <div key={w.label}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{w.label}</span>
                      <span style={{ fontSize: 14.5, fontWeight: 700 }}>{fmt(w.ventas)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ flex: 1, height: 11, borderRadius: 99, background: "var(--primary-soft)", overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 99, background: w.ventas > 0 ? "var(--primary)" : "var(--bar-dim)", width: `${Math.max(2, (w.ventas / maxWeek) * 100)}%` }} />
                      </div>
                      <span style={{ flex: "none", width: 92, textAlign: "right", fontSize: 13, color: "var(--muted)" }}>{fmtInt(w.bultos)} bultos</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Total del período</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: "var(--pos)" }}>{isLoading ? "…" : fmt(s?.ventas ?? 0)}</span>
            </div>
          </section>

          {/* ── Bolsa FV + Comisiones + Bultos ── */}
          <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            {/* Bolsa FV */}
            <div style={{ borderRadius: 18, border: "1px solid var(--line)", overflow: "hidden", background: "var(--surface)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 10px", flexWrap: "wrap", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>Bolsa FV <span style={{ fontWeight: 500, opacity: .8 }}>· últimos movimientos</span></span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {(["all", "bolsa", "bolsa_propia"] as const).map((f) => (
                    <button key={f} className={`va-pbtn ${bolsaFilter === f ? "active" : ""}`} style={{ fontSize: 11.5, padding: "5px 9px" }} onClick={() => setBolsaFilter(f)}>
                      {f === "all" ? "Total" : f === "bolsa" ? "Bolsa" : "Propia"}
                    </button>
                  ))}
                  {bolsaRows.length > 0 && (
                    <button className="va-link" onClick={() => generateBolsaFvPDF(bolsaRows, bolsaData!.grandTotal, from, to)} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Download className="h-3 w-3" /> PDF
                    </button>
                  )}
                </div>
              </div>
              <div style={{ padding: "0 20px 14px" }}>
                {bolsaLoading ? <Skeleton className="h-24 w-full" /> : bolsaRows.length === 0 ? (
                  <p style={{ fontSize: 12.5, color: "var(--muted)", padding: "16px 0", textAlign: "center" }}>Sin líneas Bolsa FV en este período</p>
                ) : (
                  <>
                    {bolsaPreview.map((row, i) => {
                      const propia = row.bolsaType === "bolsa_propia";
                      return (
                        <div key={i} className="va-row" style={{ display: "grid", gridTemplateColumns: "50px 1fr 92px 64px", gap: 10, alignItems: "center", padding: "9px 8px", borderTop: "1px solid var(--line)" }}>
                          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{new Date(String(row.orderDate).slice(0, 10) + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}</span>
                          <span style={{ fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.productName ?? "—"}</span>
                          <span style={{ textAlign: "right", fontSize: 13.5, fontWeight: 600 }}>${Math.round(parseFloat(row.subtotal)).toLocaleString("es-AR")}</span>
                          <span style={{ textAlign: "right" }}><span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: propia ? "var(--alt-soft)" : "var(--pos-soft)", color: propia ? "var(--alt)" : "var(--pos)" }}>{propia ? "Propia" : "Bolsa"}</span></span>
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 8px 2px", borderTop: "1px solid var(--line)", marginTop: 2 }}>
                      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{bolsaRows.length > bolsaPreview.length ? `+${bolsaRows.length - bolsaPreview.length} más` : `${bolsaRows.length} movimiento${bolsaRows.length !== 1 ? "s" : ""}`}</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "var(--pos)" }}>${Math.round(bolsaData?.grandTotal ?? 0).toLocaleString("es-AR")}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Comisiones + Bultos */}
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div className="va-card" style={{ padding: "20px 22px", borderRadius: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ ...LABEL, fontSize: 11.5, letterSpacing: ".1em" }}>Comisiones vendedores</span>
                  <button className="va-link" onClick={() => setComisionesOpen(true)}>Detalle</button>
                </div>
                {isLoading ? <Skeleton className="h-12 w-full mt-3" /> : (s?.comisiones ?? []).length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 12 }}>Sin comisiones en el período</p>
                ) : (
                  <>
                    {(s?.comisiones ?? []).map((c) => (
                      <div key={c.vendedor} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--primary-soft)", color: "var(--pos)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 }}>{c.vendedor.charAt(0).toUpperCase()}</div>
                          <span style={{ fontSize: 14.5, fontWeight: 600 }}>{c.vendedor}</span>
                        </div>
                        <span style={{ fontSize: 16, fontWeight: 800 }}>{fmt(c.total)}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 13, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>Total comisiones</span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: "var(--pos)" }}>{fmt(comisionesTotal)}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="va-card" style={{ padding: "20px 22px", borderRadius: 18, flex: 1 }}>
                <span style={{ ...LABEL, fontSize: 11.5, letterSpacing: ".1em" }}>Bultos del período</span>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 14 }}>
                  <div>
                    <div style={{ fontSize: 29, fontWeight: 800 }}>{isLoading ? "…" : fmtInt(s?.bultosTotal ?? 0)}</div>
                    <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>≈ {isLoading ? "…" : fmtInt(Math.round((s?.bultosTotal ?? 0) / diasTrabajados))} bultos/día operado</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

        </div>
      </div>

      {/* Rinde detail dialog */}
      <Dialog open={rindeOpen} onOpenChange={setRindeOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Detalle de Rinde — {from} al {to}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1">
            {!rindeDetail ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : rindeDetail.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Sin movimientos de rinde en el período</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left pb-1.5 text-xs text-muted-foreground font-medium">Fecha</th>
                    <th className="text-left pb-1.5 text-xs text-muted-foreground font-medium">Producto</th>
                    <th className="text-right pb-1.5 text-xs text-muted-foreground font-medium">Cantidad</th>
                    <th className="text-right pb-1.5 text-xs text-muted-foreground font-medium">Costo unit.</th>
                    <th className="text-right pb-1.5 text-xs text-muted-foreground font-medium">Total</th>
                    <th className="text-left pb-1.5 text-xs text-muted-foreground font-medium">Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {rindeDetail.map((row, i) => (
                    <tr key={row.id} className={`border-b border-border/50 last:border-0 ${i % 2 !== 0 ? "bg-muted/20" : ""}`}>
                      <td className="py-1.5 text-xs text-muted-foreground whitespace-nowrap pr-3">
                        {new Date(row.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                      </td>
                      <td className="py-1.5 pr-2 font-medium">{row.product_name}</td>
                      <td className="py-1.5 text-right tabular-nums text-xs pr-2">
                        {row.quantity.toLocaleString("es-AR", { maximumFractionDigits: 2 })} {row.unit ?? ""}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-xs pr-2">{fmt(row.unit_cost)}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums text-green-600 dark:text-green-400">{fmt(row.total)}</td>
                      <td className="py-1.5 text-xs text-muted-foreground pl-2 max-w-[180px] truncate">{row.notes}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border">
                    <td colSpan={4} className="pt-2 text-xs font-semibold">Total</td>
                    <td className="pt-2 text-right font-bold text-green-600 tabular-nums">
                      {fmt(rindeDetail.reduce((s, r) => s + r.total, 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Merma detail dialog */}
      <Dialog open={mermaOpen} onOpenChange={setMermaOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Detalle de Merma — {from} al {to}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1">
            {!mermaDetail ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : mermaDetail.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Sin movimientos de merma en el período</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left pb-1.5 text-xs text-muted-foreground font-medium">Fecha</th>
                    <th className="text-left pb-1.5 text-xs text-muted-foreground font-medium">Producto</th>
                    <th className="text-right pb-1.5 text-xs text-muted-foreground font-medium">Cantidad</th>
                    <th className="text-right pb-1.5 text-xs text-muted-foreground font-medium">Costo unit.</th>
                    <th className="text-right pb-1.5 text-xs text-muted-foreground font-medium">Total</th>
                    <th className="text-left pb-1.5 text-xs text-muted-foreground font-medium">Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {mermaDetail.map((row, i) => (
                    <tr key={row.id} className={`border-b border-border/50 last:border-0 ${i % 2 !== 0 ? "bg-muted/20" : ""}`}>
                      <td className="py-1.5 text-xs text-muted-foreground whitespace-nowrap pr-3">
                        {new Date(row.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                      </td>
                      <td className="py-1.5 pr-2 font-medium">{row.product_name}</td>
                      <td className="py-1.5 text-right tabular-nums text-xs pr-2">
                        {row.quantity.toLocaleString("es-AR", { maximumFractionDigits: 2 })} {row.unit ?? ""}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-xs pr-2">{fmt(row.unit_cost)}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums text-red-600 dark:text-red-400">{fmt(row.total)}</td>
                      <td className="py-1.5 text-xs text-muted-foreground pl-2 max-w-[180px] truncate">{row.notes}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border">
                    <td colSpan={4} className="pt-2 text-xs font-semibold">Total</td>
                    <td className="pt-2 text-right font-bold text-red-600 tabular-nums">
                      {fmt(mermaDetail.reduce((s, r) => s + r.total, 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ComisionesModal open={comisionesOpen} onClose={() => setComisionesOpen(false)} />
    </Layout>
  );
}

// ─── Card de estado financiero (Por cobrar / Por pagar / Inventario) ──────────
function FinCard({ color, soft, title, a, b, loading }: {
  color: string; soft: string; title: string;
  a: { label: string; value: string }; b: { label: string; value: string }; loading: boolean;
}) {
  return (
    <div className="va-card va-fin" style={{ padding: "20px 22px", borderRadius: 16, borderTop: `3px solid ${color}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 18 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: soft, color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>$</div>
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color }}>{title}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {[a, b].map((x, i) => (
          <div key={i}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>{x.label}</div>
            {loading ? <Skeleton className="h-6 w-20" /> : <div style={{ fontSize: 21, fontWeight: 800, color, letterSpacing: "-.015em" }}>{x.value}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
