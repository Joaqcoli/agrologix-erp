import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Package, Truck, AlertTriangle, Users } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  "$" + Math.round(n).toLocaleString("es-MX");

const fmtShort = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return "$" + (n / 1_000).toFixed(0) + "k";
  return fmt(n);
};

function todayRange(): [string, string] {
  const d = new Date();
  const from = d.toISOString().slice(0, 10);
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  return [from, next.toISOString().slice(0, 10)];
}

function weekRange(): [string, string] {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 7);
  return [mon.toISOString().slice(0, 10), sun.toISOString().slice(0, 10)];
}

function monthRange(): [string, string] {
  const d = new Date();
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return [from, nextMonth.toISOString().slice(0, 10)];
}

function yearRange(): [string, string] {
  const y = new Date().getFullYear();
  return [`${y}-01-01`, `${y + 1}-01-01`];
}

// ─── Types ────────────────────────────────────────────────────────────────────
type DayRow = {
  date: string;
  ventas: number;
  ganancia_bruta: number;
  ajuste_merma: number;
  ajuste_rinde: number;
  ganancia_real: number;
};

type Stats = {
  ventas: number;
  ganancia_bruta: number;
  mermaTotal: number;
  rindeTotal: number;
  ganancia_real: number;
  diasPeriodo: number;
  ventasPorDia: DayRow[];
  vaciosTotal: number;
  valesTotal: number;
  deudaProveedores: number;
  stockValorizado: number;
  comisiones: { vendedor: string; total: number }[];
};

// ─── Sub-components ───────────────────────────────────────────────────────────
function MetricCard({
  title, value, sub, icon: Icon, loading, highlight,
}: {
  title: string; value: string; sub?: string; icon?: React.ElementType; loading: boolean; highlight?: boolean;
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
            <p className={`text-2xl font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Custom tooltip for chart ─────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-background p-2.5 text-xs shadow-md space-y-1">
      <p className="font-semibold text-foreground">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {fmt(p.value)}</p>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type Period = "hoy" | "semana" | "mes" | "año" | "custom";

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("mes");
  const [customFrom, setCustomFrom] = useState(() => monthRange()[0]);
  const [customTo, setCustomTo] = useState(() => monthRange()[1]);

  const [from, to] = useMemo((): [string, string] => {
    if (period === "hoy") return todayRange();
    if (period === "semana") return weekRange();
    if (period === "mes") return monthRange();
    if (period === "año") return yearRange();
    return [customFrom, customTo];
  }, [period, customFrom, customTo]);

  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ["/api/dashboard/stats", from, to],
    queryFn: () =>
      fetch(`/api/dashboard/stats?from=${from}&to=${to}`, { credentials: "include" }).then((r) => r.json()),
    staleTime: 30_000,
  });

  const s = stats;
  const diasPeriodo = s?.diasPeriodo ?? 1;
  const ventasDia = s ? s.ventas / diasPeriodo : 0;
  const gananciaDia = s ? s.ganancia_real / diasPeriodo : 0;
  const saldoVacios = s ? s.vaciosTotal - s.valesTotal : 0;

  const PERIOD_LABELS: Record<Period, string> = {
    hoy: "Hoy", semana: "Esta semana", mes: "Este mes", año: "Este año", custom: "Personalizado",
  };

  // Chart: label short date
  const chartData = (s?.ventasPorDia ?? []).map((d) => ({
    ...d,
    label: d.date.slice(5), // MM-DD
  }));

  const ajusteNeto = (s?.rindeTotal ?? 0) - (s?.mermaTotal ?? 0);
  const ajustePositivo = ajusteNeto >= 0;

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
            {(["hoy", "semana", "mes", "año"] as Period[]).map((p) => (
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
            <Button
              size="sm"
              variant={period === "custom" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setPeriod("custom")}
            >
              Personalizado
            </Button>
          </div>
        </div>

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
          />
          <MetricCard
            title="Venta/día"
            value={s ? fmtShort(ventasDia) : "—"}
            loading={isLoading}
          />
          <MetricCard
            title="Ganancia/día"
            value={s ? fmtShort(gananciaDia) : "—"}
            loading={isLoading}
          />
        </div>

        {/* ── Ganancia real (bruta + merma/rinde) ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Ganancia real del período</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-16 w-full" /> : (
              <div className="flex flex-wrap items-start gap-6">
                <div>
                  <p className="text-xs text-muted-foreground">Ganancia bruta</p>
                  <p className="text-xl font-bold text-foreground">{s ? fmt(s.ganancia_bruta) : "—"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">solo margen de pedidos</p>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground self-center text-sm">→</div>
                {s && s.rindeTotal > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">+ Rinde</p>
                    <p className="text-lg font-semibold text-green-600 dark:text-green-400">+{fmt(s.rindeTotal)}</p>
                  </div>
                )}
                {s && s.mermaTotal > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">- Merma</p>
                    <p className="text-lg font-semibold text-red-600 dark:text-red-400">-{fmt(s.mermaTotal)}</p>
                  </div>
                )}
                <div className="flex items-center gap-2 text-muted-foreground self-center text-sm">→</div>
                <div>
                  <p className="text-xs text-muted-foreground">Ganancia real</p>
                  <p className="text-xl font-bold text-primary">{s ? fmt(s.ganancia_real) : "—"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">ajustada por merma/rinde</p>
                </div>
                {s && Math.abs(ajusteNeto) > 0 && (
                  <Badge
                    variant="outline"
                    className={`self-center text-xs ${ajustePositivo ? "text-green-600 border-green-400/50" : "text-red-600 border-red-400/50"}`}
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

          {/* Vacíos en mi poder */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Vacíos en mi poder</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? <Skeleton className="h-8 w-28" /> : (
                <>
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{s ? fmt(saldoVacios) : "—"}</p>
                  <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                    <p>Entregados: {s ? fmt(s.vaciosTotal) : "—"}</p>
                    <p>Vales: {s ? fmt(s.valesTotal) : "—"}</p>
                  </div>
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

          {/* Comisiones */}
          {(!s || s.comisiones.length > 0) && (
            <Card className={s && s.comisiones.length > 1 ? "sm:col-span-2" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> Comisiones vendedores
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {isLoading ? <Skeleton className="h-12 w-full" /> : s && s.comisiones.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin comisiones en el período</p>
                ) : (
                  <div className="space-y-2">
                    {(s?.comisiones ?? []).map((c) => (
                      <div key={c.vendedor} className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{c.vendedor}</span>
                        <span className="text-sm font-bold text-foreground">{fmt(c.total)}</span>
                      </div>
                    ))}
                    {s && s.comisiones.length > 0 && (
                      <div className="flex items-center justify-between border-t border-border pt-1.5 mt-1.5">
                        <span className="text-xs text-muted-foreground">Total comisiones</span>
                        <span className="text-sm font-bold text-foreground">
                          {fmt(s.comisiones.reduce((acc, c) => acc + c.total, 0))}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Chart ── */}
        {chartData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Ventas y ganancia real por día</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={(v) => fmtShort(v)} tick={{ fontSize: 10 }} width={55} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="ventas" name="Ventas" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="ganancia_real" name="Ganancia real" fill="hsl(142 71% 45%)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
