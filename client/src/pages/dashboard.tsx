import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Package, Truck, AlertTriangle, Users, Download } from "lucide-react";
import { generateBolsaFvPDF, type BolsaFvRow } from "@/lib/pdf";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  "$" + Math.round(n).toLocaleString("es-MX");

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
type Stats = {
  ventas: number;
  ganancia_bruta: number;
  mermaTotal: number;
  rindeTotal: number;
  ganancia_real: number;
  diasPeriodo: number;
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

// ─── Main Page ────────────────────────────────────────────────────────────────
type Period = "hoy" | "semana" | "mes" | "año" | "custom";

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("mes");
  const [customFrom, setCustomFrom] = useState(() => monthRange()[0]);
  const [customTo, setCustomTo] = useState(() => monthRange()[1]);
  const [bolsaFilter, setBolsaFilter] = useState<"all" | "bolsa" | "bolsa_propia">("all");

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

  const { data: bolsaData, isLoading: bolsaLoading } = useQuery<{ rows: BolsaFvRow[]; grandTotal: number }>({
    queryKey: ["/api/dashboard/bolsa-fv", from, to, bolsaFilter],
    queryFn: () =>
      fetch(`/api/dashboard/bolsa-fv?from=${from}&to=${to}&type=${bolsaFilter}`, { credentials: "include" }).then((r) => r.json()),
    staleTime: 30_000,
  });

  const s = stats;
  const diasPeriodo = s?.diasPeriodo ?? 1;
  const ventasDia = s ? s.ventas / diasPeriodo : 0;
  const gananciaDia = s ? s.ganancia_real / diasPeriodo : 0;

  const PERIOD_LABELS: Record<Period, string> = {
    hoy: "Hoy", semana: "Esta semana", mes: "Este mes", año: "Este año", custom: "Personalizado",
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
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> Comisiones vendedores
                </CardTitle>
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
                            {new Date(row.orderDate).toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit" })}
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
    </Layout>
  );
}
