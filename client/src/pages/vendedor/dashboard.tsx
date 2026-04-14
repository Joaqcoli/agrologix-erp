import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { VendedorLayout } from "./layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Users, DollarSign } from "lucide-react";

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-MX");

function localStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayRange(): [string, string] {
  const d = new Date();
  const from = localStr(d);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return [from, localStr(next)];
}
function weekRange(): [string, string] {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  const sun = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff + 7);
  return [localStr(mon), localStr(sun)];
}
function monthRange(): [string, string] {
  const d = new Date();
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return [from, localStr(next)];
}
function yearRange(): [string, string] {
  const y = new Date().getFullYear();
  return [`${y}-01-01`, `${y + 1}-01-01`];
}

type VendedorStats = {
  ventas: number;
  comisiones: number;
  clientesAsignados: number;
};

type RangeMode = "hoy" | "semana" | "mes" | "año" | "rango";

function getRange(mode: RangeMode, customFrom: string, customTo: string): [string, string] {
  if (mode === "hoy") return todayRange();
  if (mode === "semana") return weekRange();
  if (mode === "mes") return monthRange();
  if (mode === "año") return yearRange();
  return [customFrom, customTo];
}

function MetricCard({
  title, value, sub, icon: Icon, loading,
}: {
  title: string; value: string; sub?: string; icon?: React.ElementType; loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-1 flex flex-row items-center justify-between gap-1">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <Skeleton className="h-7 w-32" />
        ) : (
          <>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function VendedorDashboard() {
  const [mode, setMode] = useState<RangeMode>("hoy");
  const [customFrom, setCustomFrom] = useState(localStr(new Date()));
  const [customTo, setCustomTo] = useState(localStr(new Date()));

  const [from, to] = getRange(mode, customFrom, customTo);

  const { data: stats, isLoading } = useQuery<VendedorStats>({
    queryKey: ["/api/vendedor/dashboard", from, to],
    queryFn: () => fetch(`/api/vendedor/dashboard?from=${from}&to=${to}`).then((r) => r.json()),
  });

  const RANGE_BTNS: { label: string; value: RangeMode }[] = [
    { label: "Hoy", value: "hoy" },
    { label: "Semana", value: "semana" },
    { label: "Mes", value: "mes" },
    { label: "Año", value: "año" },
    { label: "Rango", value: "rango" },
  ];

  return (
    <VendedorLayout title="Dashboard">
      <div className="p-6 space-y-6">
        {/* Period selector */}
        <div className="flex flex-wrap items-center gap-2">
          {RANGE_BTNS.map((b) => (
            <Button
              key={b.value}
              size="sm"
              variant={mode === b.value ? "default" : "outline"}
              onClick={() => setMode(b.value)}
            >
              {b.label}
            </Button>
          ))}
          {mode === "rango" && (
            <div className="flex items-center gap-2 ml-2">
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 w-36 text-sm"
              />
              <span className="text-muted-foreground text-sm">→</span>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 w-36 text-sm"
              />
            </div>
          )}
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            title="Total Ventas"
            value={fmt(stats?.ventas ?? 0)}
            icon={TrendingUp}
            loading={isLoading}
          />
          <MetricCard
            title="Total Comisionado"
            value={fmt(stats?.comisiones ?? 0)}
            sub="Según % comisión por cliente"
            icon={DollarSign}
            loading={isLoading}
          />
          <MetricCard
            title="Clientes Asignados"
            value={String(stats?.clientesAsignados ?? 0)}
            icon={Users}
            loading={isLoading}
          />
        </div>
      </div>
    </VendedorLayout>
  );
}
