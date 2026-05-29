import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  TrendingUp, TrendingDown, DollarSign, Plus, Trash2, ShoppingBag,
  ChevronLeft, ChevronRight, Wallet, Building2, CreditCard,
} from "lucide-react";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";

const fmt = (v: number) => "$" + Math.round(v).toLocaleString("es-AR");
const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const PIE_COLORS = ["#f87171","#fb923c","#fbbf24","#a3e635","#34d399","#38bdf8","#818cf8","#c084fc","#f472b6","#94a3b8"];

function getRange(
  viewMode: "day" | "week" | "month",
  monthOffset: number,
): { from: string; to: string; label: string } {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (viewMode === "day") {
    const s = iso(today);
    return { from: s, to: s, label: "Hoy" };
  }
  if (viewMode === "week") {
    const day = today.getDay();
    const diffToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(today);
    mon.setDate(today.getDate() + diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { from: iso(mon), to: iso(sun), label: "Esta semana" };
  }
  // month
  const d = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(lastDay)}`,
    label: `${MONTHS_ES[month - 1]} ${year}`,
  };
}

function fmtDate(d: string) {
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${day}/${m}`;
}

type MethodData = { method: string; ingresos: number; egresos: number };
type CategoryData = { category: string; ingresos: number; egresos: number };

type CajaSummary = {
  totalIngresos: number;
  totalEgresos: number;
  saldo: number;
  payments: { id: number; date: string; amount: string; method: string; notes: string | null; customerName: string }[];
  supplierPayments: { id: number; date: string; amount: string; method: string; notes: string | null; supplierName: string }[];
  manualMovements: { id: number; date: string; type: string; description: string; amount: string; category: string | null }[];
  approvedOrders: { id: number; folio: string; approvedAt: string; total: string; customerName: string }[];
  byMethod: MethodData[];
  byCategory: CategoryData[];
};

type TrendItem = { month: string; label: string; ingresos: number; egresos: number };
type BankCategory = { id: number; name: string };
type MovForm = { date: string; type: "ingreso" | "egreso"; description: string; amount: string; category: string };

const emptyForm = (): MovForm => ({
  date: new Date().toISOString().slice(0, 10),
  type: "egreso",
  description: "",
  amount: "",
  category: "",
});

const METHOD_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  efectivo:      { label: "Efectivo",       icon: <Wallet className="h-4 w-4 text-green-600" />,  color: "text-green-700" },
  transferencia: { label: "Banco/Transf.",  icon: <Building2 className="h-4 w-4 text-blue-600" />, color: "text-blue-700" },
  cheque:        { label: "Cheques",        icon: <CreditCard className="h-4 w-4 text-purple-600" />, color: "text-purple-700" },
};

export default function CajaPage() {
  const [, navigate] = useLocation();
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("month");
  const [monthOffset, setMonthOffset] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<MovForm>(emptyForm());

  const { from, to, label } = getRange(viewMode, monthOffset);

  const { data, isLoading } = useQuery<CajaSummary>({
    queryKey: ["/api/caja/summary", from, to],
    queryFn: () =>
      fetch(`/api/caja/summary?from=${from}&to=${to}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: trend } = useQuery<TrendItem[]>({
    queryKey: ["/api/caja/trend"],
    queryFn: () => fetch("/api/caja/trend?months=6", { credentials: "include" }).then(r => r.json()),
  });

  const { data: bankCats } = useQuery<BankCategory[]>({
    queryKey: ["/api/bank-categories"],
    queryFn: () => fetch("/api/bank-categories", { credentials: "include" }).then(r => r.json()),
  });

  const addMutation = useMutation({
    mutationFn: (body: MovForm) => apiRequest("POST", "/api/caja/movements", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/trend"] });
      setDialogOpen(false);
      setForm(emptyForm());
    },
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/caja/movements/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/trend"] });
    },
  });

  const handleAdd = () => {
    if (!form.description || !form.amount || !form.date) return;
    addMutation.mutate(form);
  };

  // Pie chart: egresos by category, sorted desc
  const pieData = (data?.byCategory ?? [])
    .filter(c => c.egresos > 0)
    .sort((a, b) => b.egresos - a.egresos)
    .map(c => ({ name: c.category, value: Math.round(c.egresos) }));

  // Category options from bank_categories + any already used in movements
  const bankCatNames = (bankCats ?? []).map(c => c.name);
  const existingCatNames = (data?.byCategory ?? []).map(c => c.category).filter(Boolean);
  const catOptions = Array.from(new Set([...bankCatNames, ...existingCatNames]));

  // Methods that have data
  const methodKeys = ["efectivo", "transferencia", "cheque"];
  const activeMethodData = methodKeys
    .map(k => ({ key: k, data: (data?.byMethod ?? []).find(m => m.method.toLowerCase() === k) }))
    .filter(x => x.data);

  const hasTrendData = (trend ?? []).some(t => t.ingresos > 0 || t.egresos > 0);

  return (
    <Layout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold">Caja</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1 bg-muted rounded-lg p-1">
              {(["day", "week", "month"] as const).map(p => (
                <button
                  key={p}
                  onClick={() => { setViewMode(p); if (p !== "month") setMonthOffset(0); }}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    viewMode === p ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p === "day" ? "Hoy" : p === "week" ? "Semana" : "Mes"}
                </button>
              ))}
            </div>
            {viewMode === "month" && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8"
                  onClick={() => setMonthOffset(o => o - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-semibold min-w-36 text-center">{label}</span>
                <Button variant="ghost" size="icon" className="h-8 w-8"
                  onClick={() => setMonthOffset(o => o + 1)}
                  disabled={monthOffset >= 0}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                {monthOffset < 0 && (
                  <Button variant="ghost" size="sm" className="text-xs h-7 ml-1"
                    onClick={() => setMonthOffset(0)}>
                    Hoy
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-600" /> Ingresos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-700">{isLoading ? "..." : fmt(data?.totalIngresos ?? 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-600" /> Egresos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-700">{isLoading ? "..." : fmt(data?.totalEgresos ?? 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-blue-600" /> Saldo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${(data?.saldo ?? 0) >= 0 ? "text-blue-700" : "text-red-700"}`}>
                {isLoading ? "..." : fmt(data?.saldo ?? 0)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Method breakdown (liquidity by payment method) */}
        {activeMethodData.length > 0 && (
          <section>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Movimientos por método — {label}
            </p>
            <div className="grid grid-cols-3 gap-3">
              {activeMethodData.map(({ key, data: md }) => {
                if (!md) return null;
                const net = md.ingresos - md.egresos;
                const cfg = METHOD_CONFIG[key] ?? { label: key, icon: null, color: "text-foreground" };
                return (
                  <Card key={key}>
                    <CardContent className="px-4 pt-4 pb-3">
                      <div className="flex items-center gap-2 mb-1">
                        {cfg.icon}
                        <span className="text-sm font-medium">{cfg.label}</span>
                      </div>
                      <p className={`text-xl font-bold ${net >= 0 ? "text-green-700" : "text-red-700"}`}>{fmt(net)}</p>
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="text-green-600">↑ {fmt(md.ingresos)}</span>
                        <span className="text-red-600">↓ {fmt(md.egresos)}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* Charts row */}
        {(hasTrendData || pieData.length > 0) && (
          <div className="grid grid-cols-2 gap-6">
            {hasTrendData && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Evolución mensual (6 meses)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart data={trend ?? []} margin={{ top: 0, right: 4, left: -16, bottom: 0 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
                      <Tooltip
                        formatter={(v: number, name: string) => [fmt(v), name === "ingresos" ? "Ingresos" : "Egresos"]}
                        labelStyle={{ fontWeight: 600 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="ingresos" name="Ingresos" fill="#4ade80" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="egresos" name="Egresos" fill="#f87171" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {pieData.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Egresos por categoría — {label}</CardTitle>
                </CardHeader>
                <CardContent className="flex gap-4 items-center">
                  <ResponsiveContainer width="45%" height={190}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={72} innerRadius={30}>
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmt(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1.5 text-xs overflow-hidden">
                    {pieData.slice(0, 8).map((d, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="truncate text-muted-foreground flex-1">{d.name}</span>
                        <span className="font-semibold tabular-nums ml-1">{fmt(d.value)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Cobros de clientes */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold text-base">Cobros de clientes</h2>
            <Badge variant="secondary">{data?.payments?.length ?? 0}</Badge>
          </div>
          {(data?.payments?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Sin cobros en este período.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Fecha</th>
                    <th className="text-left px-3 py-2 font-medium">Cliente</th>
                    <th className="text-left px-3 py-2 font-medium">Método</th>
                    <th className="text-right px-3 py-2 font-medium">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.payments ?? []).map(p => (
                    <tr key={p.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(p.date)}</td>
                      <td className="px-3 py-2">{p.customerName}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-xs">{p.method}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-green-700">{fmt(parseFloat(p.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Pedidos aprobados */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold text-base flex items-center gap-1">
              <ShoppingBag className="h-4 w-4 text-green-600" /> Pedidos aprobados
            </h2>
            <Badge variant="secondary">{data?.approvedOrders?.length ?? 0}</Badge>
          </div>
          {(data?.approvedOrders?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Sin pedidos aprobados en este período.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Fecha</th>
                    <th className="text-left px-3 py-2 font-medium">Folio</th>
                    <th className="text-left px-3 py-2 font-medium">Cliente</th>
                    <th className="text-right px-3 py-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.approvedOrders ?? []).map(o => (
                    <tr
                      key={o.id}
                      className="border-t hover:bg-muted/30 cursor-pointer"
                      onClick={() => navigate(`/orders/${o.id}`)}
                    >
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(o.approvedAt)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{o.folio}</td>
                      <td className="px-3 py-2">{o.customerName}</td>
                      <td className="px-3 py-2 text-right font-medium text-green-700">{fmt(parseFloat(o.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Pagos a proveedores */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold text-base">Pagos a proveedores</h2>
            <Badge variant="secondary">{data?.supplierPayments?.length ?? 0}</Badge>
          </div>
          {(data?.supplierPayments?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Sin pagos en este período.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Fecha</th>
                    <th className="text-left px-3 py-2 font-medium">Proveedor</th>
                    <th className="text-left px-3 py-2 font-medium">Método</th>
                    <th className="text-right px-3 py-2 font-medium">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.supplierPayments ?? []).map(p => (
                    <tr key={p.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(p.date)}</td>
                      <td className="px-3 py-2">{p.supplierName}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-xs">{p.method}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-red-700">{fmt(parseFloat(p.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Movimientos manuales */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold text-base">Movimientos manuales</h2>
            <Badge variant="secondary">{data?.manualMovements?.length ?? 0}</Badge>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Agregar
            </Button>
          </div>
          {(data?.manualMovements?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos manuales en este período.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Fecha</th>
                    <th className="text-left px-3 py-2 font-medium">Descripción</th>
                    <th className="text-left px-3 py-2 font-medium">Categoría</th>
                    <th className="text-right px-3 py-2 font-medium">Monto</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {(data?.manualMovements ?? []).map(m => (
                    <tr key={m.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(m.date)}</td>
                      <td className="px-3 py-2">{m.description}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{m.category ?? "—"}</td>
                      <td className={`px-3 py-2 text-right font-medium ${m.type === "ingreso" ? "text-green-700" : "text-red-700"}`}>
                        {m.type === "egreso" ? "-" : ""}{fmt(parseFloat(m.amount))}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7"
                          onClick={() => delMutation.mutate(m.id)}
                          disabled={delMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Dialog agregar movimiento */}
      <Dialog open={dialogOpen} onOpenChange={v => { setDialogOpen(v); if (!v) setForm(emptyForm()); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar movimiento manual</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as "ingreso" | "egreso" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="egreso">Egreso</SelectItem>
                    <SelectItem value="ingreso">Ingreso</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Fecha</Label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Descripción</Label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Ej: Compra de materiales"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Monto ($)</Label>
                <Input
                  type="number" min="0" step="0.01"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1">
                <Label>Categoría</Label>
                {catOptions.length > 0 ? (
                  <Select
                    value={form.category || "_none"}
                    onValueChange={v => setForm(f => ({ ...f, category: v === "_none" ? "" : v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Sin categoría" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Sin categoría</SelectItem>
                      {catOptions.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    placeholder="Opcional"
                  />
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleAdd} disabled={addMutation.isPending || !form.description || !form.amount}>
              {addMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
