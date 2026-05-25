import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Landmark, TrendingUp, Percent } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

const fmt = (v: number) => "$" + Math.round(v).toLocaleString("es-AR");

function pad(n: number) { return String(n).padStart(2, "0"); }
function isoDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fmtDate(s: string) {
  if (!s) return "";
  const d = new Date(s);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

function getLast30() {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 29);
  return { from: isoDate(from), to: isoDate(to) };
}

type MpBalance = {
  available_balance?: number | null;
  total_amount?: number;
  unavailable?: boolean; // true cuando el endpoint no está disponible para este token
  error?: string;
};

type MpMovement = {
  id: string | number;
  date_created: string;
  type: string;
  description?: string;
  status: string;
  total?: number;
  amount?: number;
  fee?: { amount?: number };
  linkedOrderId?: number | null;
  linkedOrderFolio?: string | null;
};

type MpMovementsResponse = {
  results?: MpMovement[];
  error?: string;
};

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export default function BancosPage() {
  const [, navigate] = useLocation();
  const { from: defaultFrom, to: defaultTo } = getLast30();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const { data: balance, isLoading: balanceLoading, error: balanceErr } = useQuery<MpBalance>({
    queryKey: ["/api/mp/balance"],
    queryFn: () => fetch("/api/mp/balance", { credentials: "include" }).then(r => r.json()),
    retry: false,
  });

  const { data: movData, isLoading: movLoading, error: movErr } = useQuery<MpMovementsResponse>({
    queryKey: ["/api/mp/movements", from, to, filterType, filterStatus],
    queryFn: () => {
      const p = new URLSearchParams({ from, to });
      if (filterType !== "all") p.set("type", filterType);
      if (filterStatus !== "all") p.set("status", filterStatus);
      return fetch(`/api/mp/movements?${p}`, { credentials: "include" }).then(r => r.json());
    },
    retry: false,
  });

  const movements: MpMovement[] = movData?.results ?? [];

  // Stats for current period
  const { cobradoMes, comisionesMes } = useMemo(() => {
    let cobradoMes = 0;
    let comisionesMes = 0;
    for (const m of movements) {
      const amt = Math.abs(parseFloat(String(m.total ?? m.amount ?? 0)));
      const fee = Math.abs(parseFloat(String(m.fee?.amount ?? 0)));
      if (m.type === "payment") cobradoMes += amt;
      comisionesMes += fee;
    }
    return { cobradoMes, comisionesMes };
  }, [movements]);

  // Chart data: group payments by date
  const chartData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of movements) {
      if (m.type !== "payment") continue;
      const d = fmtDate(m.date_created);
      if (!d) continue;
      map[d] = (map[d] ?? 0) + Math.abs(parseFloat(String(m.total ?? m.amount ?? 0)));
    }
    return Object.entries(map)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, total]) => ({ date, total }));
  }, [movements]);

  // Filtered rows
  const filtered = movements.filter(m => {
    if (filterType !== "all" && m.type !== filterType) return false;
    if (filterStatus !== "all" && m.status !== filterStatus) return false;
    return true;
  });

  // Solo mostrar error si fallan los movimientos (balance indisponible es degradación silenciosa)
  const mpError = movData?.error ?? (movErr as Error)?.message ?? null;

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">Bancos</h1>

        {/* ── Mercado Pago ── */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Landmark className="h-5 w-5" /> Mercado Pago
          </h2>

          {mpError && <ErrorBanner message={`Error conectando con Mercado Pago: ${mpError}`} />}

          {/* Cards */}
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Saldo disponible</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {balanceLoading ? "..." : (balance?.unavailable || balance?.available_balance == null) ? (
                    <span className="text-base text-muted-foreground font-normal">No disponible</span>
                  ) : fmt(balance.available_balance ?? 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-4 w-4 text-green-600" /> Cobrado (período)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-700">{movLoading ? "..." : fmt(cobradoMes)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <Percent className="h-4 w-4 text-orange-600" /> Comisiones (período)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-orange-700">{movLoading ? "..." : fmt(comisionesMes)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Chart */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Cobros por día (pagos)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => "$" + Math.round(v / 1000) + "k"} />
                    <Tooltip formatter={(v: number) => [fmt(v), "Cobrado"]} />
                    <Bar dataKey="total" fill="#2E7D32" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Desde</label>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 text-sm w-36" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Hasta</label>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-8 text-sm w-36" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Tipo</label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-8 text-sm w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="payment">Pago</SelectItem>
                  <SelectItem value="transfer">Transferencia</SelectItem>
                  <SelectItem value="withdrawal">Retiro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Estado</label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-sm w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="settled">Acreditado</SelectItem>
                  <SelectItem value="pending">Pendiente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Movements table */}
          {movLoading ? (
            <p className="text-sm text-muted-foreground">Cargando movimientos...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos para los filtros seleccionados.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Fecha</th>
                    <th className="text-left px-3 py-2 font-medium">Tipo</th>
                    <th className="text-left px-3 py-2 font-medium">Descripción</th>
                    <th className="text-right px-3 py-2 font-medium">Monto</th>
                    <th className="text-right px-3 py-2 font-medium">Comisión</th>
                    <th className="text-right px-3 py-2 font-medium">Neto</th>
                    <th className="text-left px-3 py-2 font-medium">Estado</th>
                    <th className="text-left px-3 py-2 font-medium">Pedido</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(m => {
                    const gross = Math.abs(parseFloat(String(m.total ?? m.amount ?? 0)));
                    const fee   = Math.abs(parseFloat(String(m.fee?.amount ?? 0)));
                    const net   = gross - fee;
                    return (
                      <tr key={m.id} className="border-t hover:bg-muted/30">
                        <td className="px-3 py-2 text-muted-foreground">{fmtDate(m.date_created)}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-xs uppercase">{m.type}</Badge>
                        </td>
                        <td className="px-3 py-2">{m.description ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{fmt(gross)}</td>
                        <td className="px-3 py-2 text-right text-orange-700">{fee > 0 ? `-${fmt(fee)}` : "—"}</td>
                        <td className="px-3 py-2 text-right font-medium">{fmt(net)}</td>
                        <td className="px-3 py-2">
                          <Badge variant={m.status === "settled" ? "default" : "secondary"} className="text-xs">
                            {m.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          {m.linkedOrderFolio ? (
                            <Button
                              size="sm"
                              variant="link"
                              className="h-auto p-0 text-xs text-blue-600"
                              onClick={() => navigate(`/orders/${m.linkedOrderId}`)}
                            >
                              #{m.linkedOrderFolio} →
                            </Button>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Cuenta Bancaria ── */}
        <section>
          <div className="flex items-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/20 bg-muted/30 px-6 py-5">
            <Landmark className="h-5 w-5 text-muted-foreground/50" />
            <div>
              <p className="font-medium text-muted-foreground">Cuenta Bancaria</p>
              <p className="text-sm text-muted-foreground/70">Próximamente — integración con banco.</p>
            </div>
            <Badge variant="secondary" className="ml-auto">Próximamente</Badge>
          </div>
        </section>
      </div>
    </Layout>
  );
}
