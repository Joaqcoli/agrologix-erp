import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { VendedorLayout } from "./layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Users } from "lucide-react";

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-MX");

function localStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayRange(): [string, string] {
  const d = new Date();
  return [localStr(d), localStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))];
}
function weekRange(): [string, string] {
  const d = new Date();
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return [localStr(mon), localStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff + 7))];
}
function monthRange(): [string, string] {
  const d = new Date();
  return [
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
    localStr(new Date(d.getFullYear(), d.getMonth() + 1, 1)),
  ];
}
function yearRange(): [string, string] {
  const y = new Date().getFullYear();
  return [`${y}-01-01`, `${y + 1}-01-01`];
}

type VendedorStats = { ventas: number; comisiones: number; clientesAsignados: number };
type RangeMode = "hoy" | "semana" | "mes" | "año" | "rango";

function getRange(mode: RangeMode, customFrom: string, customTo: string): [string, string] {
  if (mode === "hoy") return todayRange();
  if (mode === "semana") return weekRange();
  if (mode === "mes") return monthRange();
  if (mode === "año") return yearRange();
  return [customFrom, customTo];
}

const RANGE_BTNS: { label: string; value: RangeMode }[] = [
  { label: "Hoy", value: "hoy" },
  { label: "Semana", value: "semana" },
  { label: "Mes", value: "mes" },
  { label: "Año", value: "año" },
  { label: "Rango", value: "rango" },
];

export default function VendedorDashboard() {
  const [mode, setMode] = useState<RangeMode>("mes");
  const [customFrom, setCustomFrom] = useState(localStr(new Date()));
  const [customTo, setCustomTo] = useState(localStr(new Date()));

  const [from, to] = getRange(mode, customFrom, customTo);

  const { data: stats, isLoading } = useQuery<VendedorStats>({
    queryKey: ["/api/vendedor/dashboard", from, to],
    queryFn: () => fetch(`/api/vendedor/dashboard?from=${from}&to=${to}`).then((r) => r.json()),
  });


  return (
    <VendedorLayout title="Dashboard">
      <div className="p-6 space-y-6">

        {/* Header */}
        <div>
          <h2 className="text-xl font-semibold text-foreground">Mi Resumen</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Ventas y comisiones por período</p>
        </div>

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

        {/* Summary banner */}
        {!isLoading && stats && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-semibold text-primary flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> Resumen del período
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-md bg-background border border-border p-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Ventas</p>
                  <p className="text-lg font-bold text-foreground mt-1">{fmt(stats.ventas)}</p>
                </div>
                <div className="rounded-md bg-background border border-border p-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Comisión</p>
                  <p className="text-lg font-bold text-green-600 dark:text-green-400 mt-1">{fmt(stats.comisiones)}</p>
                </div>
                <div className="rounded-md bg-background border border-border p-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Clientes</p>
                  <p className="text-lg font-bold text-foreground mt-1">{stats.clientesAsignados}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground">asignados</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
          </div>
        )}
      </div>
    </VendedorLayout>
  );
}
