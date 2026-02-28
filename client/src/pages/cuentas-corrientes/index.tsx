import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, TrendingUp, TrendingDown, Package, DollarSign } from "lucide-react";
import { useState } from "react";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const fmtInt = (v: number) => Math.round(v).toLocaleString("es-AR");
const fmtPct = (v: number) => v.toFixed(2) + "%";

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
  if (saldo > 0) return <span className="font-bold text-destructive">${fmtInt(saldo)}</span>;
  if (saldo < 0) return <span className="font-bold text-green-600 dark:text-green-400">${fmtInt(saldo)}</span>;
  return <span className="text-muted-foreground">$0</span>;
}

export default function CuentasCorrientesPage() {
  const [, setLocation] = useLocation();
  const today = new Date();
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [exporting, setExporting] = useState(false);

  const years = Array.from({ length: 4 }, (_, i) => today.getFullYear() - i);

  const { data, isLoading, error } = useQuery<CCSummary>({
    queryKey: ["/api/ar/cc/summary", selectedMonth, selectedYear],
    queryFn: async () => {
      const res = await fetch(`/api/ar/cc/summary?month=${selectedMonth}&year=${selectedYear}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

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

  const monthLabel = `${MONTHS[selectedMonth - 1]} ${selectedYear}`;

  return (
    <Layout title="Cuentas Corrientes">
      <div className="p-5 max-w-[1400px] mx-auto space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-foreground">Cuentas Corrientes</h2>
            <p className="text-sm text-muted-foreground">{monthLabel}</p>
          </div>

          {/* Period selector */}
          <div className="flex items-center gap-2">
            <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
              <SelectTrigger className="h-9 w-36 text-sm" data-testid="select-month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="h-9 w-24 text-sm" data-testid="select-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || isLoading} data-testid="button-export-cc">
              <Download className="mr-2 h-4 w-4" />
              {exporting ? "..." : "Exportar XLSX"}
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="text-sm text-destructive p-3 bg-destructive/10 rounded-md">
            Error al cargar: {String(error)}
          </div>
        )}

        {/* Main layout: left table + right panel */}
        <div className="flex gap-4 items-start">
          {/* ── Left: Table ─────────────────────────────── */}
          <Card className="flex-1 min-w-0 overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Por Cliente — {monthLabel}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b-2 border-border bg-muted/40">
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground uppercase tracking-wide">Cliente</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Saldo Ant.</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Facturación</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Cobranza</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Retenciones</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Saldo</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">% Fiado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-border">
                          {Array.from({ length: 7 }).map((_, j) => (
                            <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                          ))}
                        </tr>
                      ))
                    ) : data?.customers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-muted-foreground">
                          Sin movimientos en este período
                        </td>
                      </tr>
                    ) : data?.customers.map((row) => (
                      <tr
                        key={row.customerId}
                        className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer group"
                        onClick={() => setLocation(`/cuentas-corrientes/${row.customerId}?month=${selectedMonth}&year=${selectedYear}`)}
                        data-testid={`row-customer-${row.customerId}`}
                      >
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-foreground group-hover:text-primary transition-colors">{row.customerName}</span>
                            {row.hasIva && <Badge variant="outline" className="text-[9px] py-0 px-1 text-primary border-primary/30">IVA</Badge>}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right text-muted-foreground whitespace-nowrap">
                          {row.saldoMesAnterior !== 0 ? <SaldoBadge saldo={row.saldoMesAnterior} /> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2 px-3 text-right text-foreground whitespace-nowrap font-medium">
                          {row.facturacion > 0 ? `$${fmtInt(row.facturacion)}` : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {row.cobranza > 0
                            ? <span className="text-green-600 dark:text-green-400">${fmtInt(row.cobranza)}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {row.retenciones > 0
                            ? <span className="text-blue-600">${fmtInt(row.retenciones)}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          <SaldoBadge saldo={row.saldo} />
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {row.pctFiado > 0
                            ? <span className="text-muted-foreground font-mono">{fmtPct(row.pctFiado)}</span>
                            : <span className="text-muted-foreground">0.00%</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {data && data.customers.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/20">
                        <td className="py-2.5 px-3 font-bold text-foreground uppercase tracking-wide">TOTAL</td>
                        <td className="py-2.5 px-3 text-right font-bold whitespace-nowrap">
                          <SaldoBadge saldo={data.totals.saldoMesAnterior} />
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-foreground whitespace-nowrap">
                          ${fmtInt(data.totals.facturacion)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-green-600 dark:text-green-400 whitespace-nowrap">
                          {data.totals.cobranza > 0 ? `$${fmtInt(data.totals.cobranza)}` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-blue-600 whitespace-nowrap">
                          {data.totals.retenciones > 0 ? `$${fmtInt(data.totals.retenciones)}` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold whitespace-nowrap">
                          <SaldoBadge saldo={data.totals.saldo} />
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap text-muted-foreground">—</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </CardContent>
          </Card>

          {/* ── Right: Summary panel ─────────────────────── */}
          <div className="w-64 shrink-0 space-y-3">
            {/* Ventas por semana */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ventas por Semana</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 pt-0">
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)
                ) : data?.semanas.map((s) => (
                  <div key={s.label} className="flex justify-between items-center" data-testid={`semana-${s.label.replace(/\s/g, "-")}`}>
                    <span className="text-xs text-muted-foreground">{s.label} <span className="text-[10px]">({s.start}-{s.end})</span></span>
                    <span className="text-xs font-semibold text-foreground">${fmtInt(s.total)}</span>
                  </div>
                ))}
                <div className="border-t border-border pt-1.5 mt-1 flex justify-between">
                  <span className="text-xs font-bold text-foreground uppercase">Venta del Mes</span>
                  <span className="text-sm font-bold text-primary">${fmtInt(data?.ventaMes ?? 0)}</span>
                </div>
              </CardContent>
            </Card>

            {/* KPIs */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Indicadores</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Bultos Mes</span>
                  </div>
                  <span className="text-sm font-semibold text-foreground" data-testid="text-bultos-mes">
                    {isLoading ? "..." : fmtInt(data?.bultosMes ?? 0)}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Prom. Venta/día</span>
                  </div>
                  <span className="text-sm font-semibold text-foreground" data-testid="text-promedio-venta">
                    {isLoading ? "..." : `$${fmtInt(data?.promedioDia ?? 0)}`}
                  </span>
                </div>

                <div className="border-t border-border pt-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                      <span className="text-xs text-muted-foreground">Ganancia Bruta</span>
                    </div>
                    <span className={`text-sm font-bold ${(data?.gananciaMes ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`} data-testid="text-ganancia-mes">
                      {isLoading ? "..." : `$${fmtInt(data?.gananciaMes ?? 0)}`}
                    </span>
                  </div>

                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Prom. Ganancia/día</span>
                    </div>
                    <span className="text-sm font-semibold text-foreground" data-testid="text-promedio-ganancia">
                      {isLoading ? "..." : `$${fmtInt(data?.promedioGanancia ?? 0)}`}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Margen Bruto</span>
                    <Badge
                      variant="outline"
                      className={`text-xs font-bold ${(data?.margenPct ?? 0) >= 30 ? "text-green-600 border-green-300" : "text-destructive border-destructive/30"}`}
                      data-testid="text-margen-pct"
                    >
                      {isLoading ? "..." : `${(data?.margenPct ?? 0).toFixed(1)}%`}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
