import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { VendedorLayout } from "./layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Users, AlertTriangle, Trophy, ListOrdered, ChevronRight, Clock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-MX");

type ExtraData = {
  inactivos: { id: number; name: string; dias: number; bucket: "naranja" | "roja" }[];
  ventasPorDia: { dia: string; total: number }[];
  ultimosPedidos: { id: number; folio: string; fecha: string; status: string; cliente: string; total: number }[];
  topClientes: { id: number; name: string; total: number }[];
};

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
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<RangeMode>("mes");
  const [customFrom, setCustomFrom] = useState(localStr(new Date()));
  const [customTo, setCustomTo] = useState(localStr(new Date()));

  const [from, to] = getRange(mode, customFrom, customTo);

  const { data: stats, isLoading } = useQuery<VendedorStats>({
    queryKey: ["/api/vendedor/dashboard", from, to],
    queryFn: () => fetch(`/api/vendedor/dashboard?from=${from}&to=${to}`).then((r) => r.json()),
  });

  // Elementos extra (siempre actual: inactividad, mes en curso, últimos pedidos) — filtrados por el vendedor logueado
  const { data: extra } = useQuery<ExtraData>({
    queryKey: ["/api/vendedor/dashboard-extra"],
    queryFn: () => fetch("/api/vendedor/dashboard-extra").then((r) => r.json()),
    staleTime: 60_000,
  });

  const verCliente = (name: string) => setLocation(`/vendedor/customers?q=${encodeURIComponent(name)}`);
  const inacNaranja = (extra?.inactivos ?? []).filter((c) => c.bucket === "naranja");
  const inacRoja = (extra?.inactivos ?? []).filter((c) => c.bucket === "roja");
  const fmtFecha = (s: string) => { const [y, m, d] = s.split("-"); return `${d}/${m}`; };


  return (
    <VendedorLayout title="Dashboard">
      <div className="p-6 space-y-6">

        {/* Header */}
        <div>
          <h2 className="text-xl font-semibold text-foreground">Mi Resumen</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Ventas y comisiones por período</p>
        </div>

        {/* Clientes inactivos (arriba de todo) */}
        {extra && extra.inactivos.length > 0 && (
          <Card className="border-amber-300/50">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" /> Clientes sin pedir
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-amber-600">{inacNaranja.length}</span> sin pedir hace 1 semana
                {" · "}
                <span className="font-semibold text-red-600">{inacRoja.length}</span> hace 2+ semanas
              </p>
            </CardHeader>
            <CardContent className="pb-4 space-y-1.5">
              {[...inacRoja, ...inacNaranja].map((c) => {
                const roja = c.bucket === "roja";
                return (
                  <div
                    key={c.id}
                    className={`flex items-center gap-2 rounded-md border px-3 py-2 ${roja ? "border-red-300/50 bg-red-50/40 dark:bg-red-950/10" : "border-amber-300/50 bg-amber-50/40 dark:bg-amber-950/10"}`}
                  >
                    <span className={`h-2 w-2 rounded-full shrink-0 ${roja ? "bg-red-500" : "bg-amber-500"}`} />
                    <span className="font-medium text-sm text-foreground truncate flex-1">{c.name}</span>
                    <span className={`text-xs whitespace-nowrap flex items-center gap-1 ${roja ? "text-red-600" : "text-amber-600"}`}>
                      <Clock className="h-3 w-3" /> hace {c.dias} días
                    </span>
                    <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => verCliente(c.name)}>
                      Ver <ChevronRight className="h-3 w-3 ml-0.5" />
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

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

        {/* Gráfico de ventas por día del mes */}
        {extra && extra.ventasPorDia.length > 0 && (
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" /> Mis ventas del mes (por día)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={extra.ventasPorDia} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                    <XAxis dataKey="dia" tickFormatter={fmtFecha} fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(v) => "$" + Math.round(Number(v) / 1000) + "k"} fontSize={11} tickLine={false} axisLine={false} width={48} />
                    <Tooltip formatter={(v: number) => [fmt(v), "Ventas"]} labelFormatter={(l) => fmtFecha(String(l))} />
                    <Bar dataKey="total" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Últimos pedidos + Top clientes */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Últimos pedidos */}
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ListOrdered className="h-4 w-4 text-primary" /> Últimos pedidos
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!extra ? (
                <div className="p-4 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : extra.ultimosPedidos.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Sin pedidos</p>
              ) : (
                <div className="divide-y divide-border">
                  {extra.ultimosPedidos.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => setLocation(`/vendedor/orders/${o.id}`)}
                      className="w-full flex items-center gap-2 px-4 py-2 hover:bg-muted/30 transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{o.cliente}</p>
                        <p className="text-[11px] text-muted-foreground">{fmtFecha(o.fecha)} · {o.folio}</p>
                      </div>
                      <Badge variant="outline" className={`text-[9px] ${o.status === "approved" ? "text-green-600 border-green-400/40" : "text-muted-foreground"}`}>
                        {o.status === "approved" ? "Aprobado" : o.status === "draft" ? "Borrador" : o.status}
                      </Badge>
                      <span className="text-sm font-semibold tabular-nums whitespace-nowrap">{fmt(o.total)}</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top clientes del mes */}
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" /> Top clientes del mes
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!extra ? (
                <div className="p-4 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : extra.topClientes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Sin ventas este mes</p>
              ) : (
                <div className="divide-y divide-border">
                  {extra.topClientes.map((c, i) => (
                    <button
                      key={c.id}
                      onClick={() => verCliente(c.name)}
                      className="w-full flex items-center gap-2.5 px-4 py-2 hover:bg-muted/30 transition-colors text-left"
                    >
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shrink-0 ${i === 0 ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                        {i + 1}
                      </span>
                      <span className="text-sm font-medium text-foreground truncate flex-1">{c.name}</span>
                      <span className="text-sm font-semibold tabular-nums whitespace-nowrap">{fmt(c.total)}</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </VendedorLayout>
  );
}
