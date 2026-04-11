import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, Package, Truck, AlertTriangle, Users, Download } from "lucide-react";
import { generateBolsaFvPDF, generateComisionesPDF, type BolsaFvRow, type ComisionRow } from "@/lib/pdf";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  "$" + Math.round(n).toLocaleString("es-MX");

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

// ─── Types ────────────────────────────────────────────────────────────────────
type Stats = {
  ventas: number;
  ganancia_bruta: number;
  mermaTotal: number;
  rindeTotal: number;
  ganancia_real: number;
  diasPeriodo: number;
  diasTrabajados: number;
  vaciosRecibidosPeriodo: { qty: number; pesos: number };
  vaciosEntregadosPeriodo: { pesos: number; qty: number };
  vaciosEnPoder: { qty: number; pesos: number };
  deudaProveedores: number;
  deudaClientes: number;
  stockValorizado: number;
  comisiones: { vendedor: string; total: number }[];
};

// ─── Sub-components ───────────────────────────────────────────────────────────
function MetricCard({
  title, value, sub, icon: Icon, loading, highlight, green,
}: {
  title: string; value: string; sub?: string; icon?: React.ElementType; loading: boolean; highlight?: boolean; green?: boolean;
}) {
  return (
    <Card className={highlight ? "border-primary/40 bg-primary/5" : ""}>
      <CardHeader className="pb-1 flex flex-row items-center justify-between gap-1">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? <Skeleton className="h-8 w-28" /> : (
          <>
            <p className={`text-2xl font-bold ${highlight ? "text-primary" : green ? "text-green-600 dark:text-green-400" : "text-foreground"}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Comisiones Modal ─────────────────────────────────────────────────────────
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

  const PERIOD_LABELS: Record<Period, string> = {
    hoy: "Hoy", semana: "Esta semana", mes: "Este mes", año: "Este año",
    pormes: "Por mes", custom: "Personalizado",
  };

  const ajusteNeto = (s?.rindeTotal ?? 0) - (s?.mermaTotal ?? 0);
  const ajustePositivo = ajusteNeto >= 0;
  const recibidos = s?.vaciosRecibidosPeriodo ?? { qty: 0, pesos: 0 };
  const entregados = s?.vaciosEntregadosPeriodo ?? { pesos: 0, qty: 0 };
  const enPoder = s?.vaciosEnPoder ?? { qty: 0, pesos: 0 };

  return (
    <Layout title="Dashboard">
      <div className="p-6 space-y-6">
        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Dashboard</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{from} — {to}</p>
          </div>

          {/* Period Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {(["hoy", "semana", "mes", "año", "pormes", "custom"] as Period[]).map((p) => (
              <Button
                key={p}
                size="sm"
                variant={period === p ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setPeriod(p)}
              >
                {PERIOD_LABELS[p]}
              </Button>
            ))}
          </div>
        </div>

        {/* Month dropdown */}
        {period === "pormes" && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Mes</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-7 text-xs rounded-md border border-input bg-background px-2 pr-6 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {buildMonthOptions().map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Custom date range */}
        {period === "custom" && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Desde</label>
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-7 text-xs w-36" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Hasta</label>
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-7 text-xs w-36" />
            </div>
          </div>
        )}

        {/* ── Main metrics ── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            title="Ventas"
            value={s ? fmt(s.ventas) : "—"}
            sub={`${diasPeriodo} día${diasPeriodo > 1 ? "s" : ""}`}
            icon={TrendingUp}
            loading={isLoading}
            highlight
          />
          <MetricCard
            title="Ganancia bruta"
            value={s ? fmt(s.ganancia_bruta) : "—"}
            sub={s ? `Margen ${s.ventas > 0 ? ((s.ganancia_bruta / s.ventas) * 100).toFixed(1) : 0}%` : undefined}
            loading={isLoading}
            green
          />
          <MetricCard
            title="Promedio de venta por día"
            value={s ? fmt(ventasDia) : "—"}
            loading={isLoading}
          />
          <MetricCard
            title="Promedio de ganancia por día"
            value={s ? fmt(gananciaDia) : "—"}
            loading={isLoading}
          />
        </div>

        {/* ── Ganancia real (bruta + merma/rinde) ── */}
        <Card>
          <CardHeader className="pb-1.5">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ganancia real del período</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? <Skeleton className="h-10 w-full" /> : (
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <p className="text-[10px] text-muted-foreground">Bruta</p>
                  <p className="text-base font-semibold text-foreground">{s ? fmt(s.ganancia_bruta) : "—"}</p>
                </div>
                <span className="text-xs text-muted-foreground">→</span>
                {s && s.rindeTotal > 0 && (
                  <div>
                    <p className="text-[10px] text-muted-foreground">+ Rinde</p>
                    <p className="text-sm font-semibold text-green-600 dark:text-green-400">+{fmt(s.rindeTotal)}</p>
                  </div>
                )}
                {s && s.mermaTotal > 0 && (
                  <div>
                    <p className="text-[10px] text-muted-foreground">- Merma</p>
                    <p className="text-sm font-semibold text-red-600 dark:text-red-400">-{fmt(s.mermaTotal)}</p>
                  </div>
                )}
                <span className="text-xs text-muted-foreground">→</span>
                <div>
                  <p className="text-[10px] text-muted-foreground">Real</p>
                  <p className="text-base font-bold text-primary">{s ? fmt(s.ganancia_real) : "—"}</p>
                </div>
                {s && Math.abs(ajusteNeto) > 0 && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${ajustePositivo ? "text-green-600 border-green-400/50" : "text-red-600 border-red-400/50"}`}
                  >
                    {ajustePositivo ? "+" : ""}{fmt(ajusteNeto)} por {ajustePositivo ? "rinde" : "merma"}
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Secondary cards ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Stock valorizado */}
          <Card className="border-blue-200/60 dark:border-blue-800/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" /> Stock valorizado
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? <Skeleton className="h-8 w-28" /> : (
                <>
                  <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{s ? fmt(s.stockValorizado) : "—"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Valor actual del inventario</p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Deuda de clientes */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Deuda de clientes
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? <Skeleton className="h-8 w-28" /> : (
                <>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{s ? fmt(s.deudaClientes) : "—"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Total a cobrar de clientes activos</p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Deuda proveedores */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5" /> Deuda a proveedores
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? <Skeleton className="h-8 w-28" /> : (
                <>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">{s ? fmt(s.deudaProveedores) : "—"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Compras pendientes de pago</p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Merma vs Rinde */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Merma vs Rinde
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? <Skeleton className="h-8 w-28" /> : (
                <>
                  <p className={`text-2xl font-bold ${ajustePositivo ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {s ? (ajustePositivo ? "+" : "") + fmt(ajusteNeto) : "—"}
                  </p>
                  <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                    <p>Merma: {s ? fmt(s.mermaTotal) : "—"}</p>
                    <p>Rinde: {s ? fmt(s.rindeTotal) : "—"}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Vacíos en mi poder */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Vacíos en mi poder</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? <Skeleton className="h-8 w-28" /> : (
                <>
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                    {s ? fmt(enPoder.pesos) : "—"}
                    {s && enPoder.qty > 0 && <span className="text-base font-normal ml-1">({Math.round(enPoder.qty)} cajones)</span>}
                  </p>
                  <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                    <p>Recibidos (período): {s ? Math.round(recibidos.qty) : "—"} cajones — {s ? fmt(recibidos.pesos) : "—"}</p>
                    <p>Entregados (período): {s ? Math.round(entregados.qty) : "—"} cajones — {s ? fmt(entregados.pesos) : "—"}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Comisiones */}
          {(!s || (s.comisiones ?? []).length > 0) && (
            <Card className={s && (s.comisiones ?? []).length > 1 ? "sm:col-span-2" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" /> Comisiones vendedores
                  </CardTitle>
                  <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={() => setComisionesOpen(true)}>
                    Ver detalle
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {isLoading ? <Skeleton className="h-12 w-full" /> : s && (s.comisiones ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin comisiones en el período</p>
                ) : (
                  <div className="space-y-2">
                    {(s?.comisiones ?? []).map((c) => (
                      <div key={c.vendedor} className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{c.vendedor}</span>
                        <span className="text-sm font-bold text-foreground">{fmt(c.total)}</span>
                      </div>
                    ))}
                    {s && (s.comisiones ?? []).length > 0 && (
                      <div className="flex items-center justify-between border-t border-border pt-1.5 mt-1.5">
                        <span className="text-xs text-muted-foreground">Total comisiones</span>
                        <span className="text-sm font-bold text-foreground">
                          {fmt((s.comisiones ?? []).reduce((acc, c) => acc + c.total, 0))}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Bolsa FV ── */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold text-green-700 dark:text-green-400">Bolsa FV</CardTitle>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {(["all", "bolsa", "bolsa_propia"] as const).map((f) => (
                    <Button
                      key={f}
                      size="sm"
                      variant={bolsaFilter === f ? "default" : "outline"}
                      className="h-6 text-[11px] px-2"
                      onClick={() => setBolsaFilter(f)}
                    >
                      {f === "all" ? "Total" : f === "bolsa" ? "Solo Bolsa" : "Solo Bolsa Propia"}
                    </Button>
                  ))}
                </div>
                {bolsaData && (bolsaData.rows ?? []).length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px] px-2"
                    onClick={() => generateBolsaFvPDF(bolsaData.rows, bolsaData.grandTotal, from, to)}
                  >
                    <Download className="h-3 w-3 mr-1" /> PDF
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {bolsaLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !bolsaData || (bolsaData.rows ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Sin líneas Bolsa FV en este período</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Fecha</th>
                        <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Cliente</th>
                        <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Producto</th>
                        <th className="text-right py-1.5 px-2 font-semibold text-muted-foreground">Cant.</th>
                        <th className="text-right py-1.5 px-2 font-semibold text-muted-foreground">Precio</th>
                        <th className="text-right py-1.5 px-2 font-semibold text-muted-foreground">Total</th>
                        <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Tipo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(bolsaData.rows ?? []).map((row, i) => (
                        <tr key={i} className={`border-b border-border last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                          <td className="py-1.5 px-2 text-muted-foreground whitespace-nowrap">
                            {new Date(String(row.orderDate).slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit" })}
                          </td>
                          <td className="py-1.5 px-2 font-medium truncate max-w-[120px]">{row.customerName}</td>
                          <td className="py-1.5 px-2 text-muted-foreground truncate max-w-[120px]">{row.productName ?? "—"}</td>
                          <td className="py-1.5 px-2 text-right whitespace-nowrap">
                            {parseFloat(row.quantity).toLocaleString("es-MX", { maximumFractionDigits: 2 })} {row.unit}
                          </td>
                          <td className="py-1.5 px-2 text-right whitespace-nowrap">
                            {row.pricePerUnit ? `$${Math.round(parseFloat(row.pricePerUnit)).toLocaleString("es-MX")}` : "—"}
                          </td>
                          <td className="py-1.5 px-2 text-right font-semibold whitespace-nowrap">
                            ${Math.round(parseFloat(row.subtotal)).toLocaleString("es-MX")}
                          </td>
                          <td className="py-1.5 px-2">
                            <Badge variant="outline" className={`text-[9px] ${row.bolsaType === "bolsa_propia" ? "text-blue-600 border-blue-300" : "text-green-600 border-green-300"}`}>
                              {row.bolsaType === "bolsa_propia" ? "Propia" : "Bolsa"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/30">
                        <td colSpan={5} className="py-2 px-2 font-bold text-xs uppercase tracking-wide">Total</td>
                        <td className="py-2 px-2 text-right font-bold text-sm">${Math.round(bolsaData.grandTotal).toLocaleString("es-MX")}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <ComisionesModal open={comisionesOpen} onClose={() => setComisionesOpen(false)} />
    </Layout>
  );
}
