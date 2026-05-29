import { useState, useMemo } from "react";
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
  TrendingUp, TrendingDown, DollarSign, Plus, Trash2,
  ChevronLeft, ChevronRight, Wallet, Building2, CreditCard,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const fmt = (v: number) => "$" + Math.round(v).toLocaleString("es-AR");

// Normaliza variaciones de nombres de categoría al mismo label canónico
function normalizeCategory(cat: string): string {
  const lower = cat.toLowerCase().trim();
  if (lower.includes("pago") && lower.includes("proveedor")) return "Pagos proveedores";
  if (lower.includes("cobro") && lower.includes("client")) return "Cobros clientes";
  return cat;
}
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

type CajaSummary = {
  totalIngresos: number;
  totalEgresos: number;
  saldo: number;
  payments: { id: number; date: string; amount: string; method: string; notes: string | null; customerName: string }[];
  supplierPayments: { id: number; date: string; amount: string; method: string; notes: string | null; supplierName: string }[];
  manualMovements: { id: number; date: string; type: string; description: string; amount: string; category: string | null; method: string | null; sourceId?: string | null }[];
};

type BankCategory = { id: number; name: string };

type FeedItem = {
  id: string;
  date: string;
  description: string;
  counterpart: string;
  method: string;
  category: string;
  type: "ingreso" | "egreso";
  amount: number;
  sourceType: "payment" | "supplierPayment" | "manual";
  sourceId: number;
  isBankSync: boolean;
};

type MovForm = {
  date: string;
  type: "ingreso" | "egreso";
  description: string;
  amount: string;
  category: string;
  method: string;
};

const emptyForm = (): MovForm => ({
  date: new Date().toISOString().slice(0, 10),
  type: "egreso",
  description: "",
  amount: "",
  category: "",
  method: "",
});

const METHOD_LABEL: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  CHEQUE: "Cheque",
  CUENTA_CORRIENTE: "Cta. Cte.",
  MP: "Mercado Pago",
  OTRO: "Otro",
  RETENCION: "Retención",
};

type MethodKey = "EFECTIVO" | "TRANSFERENCIA" | "CHEQUE";

function normalizeMethod(m: string): MethodKey | null {
  const k = (m || "").toUpperCase();
  if (k === "EFECTIVO") return "EFECTIVO";
  if (k === "TRANSFERENCIA" || k === "BANCO" || k === "MP") return "TRANSFERENCIA";
  if (k === "CHEQUE") return "CHEQUE";
  return null;
}

const METHOD_CONFIG: Record<MethodKey, { label: string; icon: React.ReactNode; color: string; mutedColor: string }> = {
  EFECTIVO:      { label: "Efectivo",      icon: <Wallet className="h-4 w-4 text-green-600" />,  color: "text-green-700",  mutedColor: "text-green-600" },
  TRANSFERENCIA: { label: "Banco/Transf.", icon: <Building2 className="h-4 w-4 text-blue-600" />, color: "text-blue-700",  mutedColor: "text-blue-600" },
  CHEQUE:        { label: "Cheques",       icon: <CreditCard className="h-4 w-4 text-purple-600" />, color: "text-purple-700", mutedColor: "text-purple-600" },
};

export default function CajaPage() {
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("month");
  const [monthOffset, setMonthOffset] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<MovForm>(emptyForm());
  const [filterCat, setFilterCat] = useState("_all");
  const [filterType, setFilterType] = useState("_all");

  const { from, to, label } = getRange(viewMode, monthOffset);

  const { data, isLoading } = useQuery<CajaSummary>({
    queryKey: ["/api/caja/summary", from, to],
    queryFn: () =>
      fetch(`/api/caja/summary?from=${from}&to=${to}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: bankCats } = useQuery<BankCategory[]>({
    queryKey: ["/api/bank-categories"],
    queryFn: () => fetch("/api/bank-categories", { credentials: "include" }).then(r => r.json()),
  });

  const addMutation = useMutation({
    mutationFn: (body: MovForm) => apiRequest("POST", "/api/caja/movements", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/summary"] });
      setDialogOpen(false);
      setForm(emptyForm());
    },
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/caja/movements/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/summary"] });
    },
  });

  const handleAdd = () => {
    if (!form.description || !form.amount || !form.date || !form.method) return;
    addMutation.mutate(form);
  };

  // Build unified feed
  const feed = useMemo((): FeedItem[] => {
    const items: FeedItem[] = [];
    for (const p of data?.payments ?? []) {
      items.push({
        id: `pmt-${p.id}`,
        date: p.date,
        description: "Cobro",
        counterpart: p.customerName,
        method: p.method,
        category: "Cobros clientes",
        type: "ingreso",
        amount: parseFloat(p.amount),
        sourceType: "payment",
        sourceId: p.id,
        isBankSync: false,
      });
    }
    for (const p of data?.supplierPayments ?? []) {
      items.push({
        id: `sp-${p.id}`,
        date: p.date,
        description: p.notes || "Pago",
        counterpart: p.supplierName,
        method: p.method,
        category: "Pagos proveedores",
        type: "egreso",
        amount: parseFloat(p.amount),
        sourceType: "supplierPayment",
        sourceId: p.id,
        isBankSync: false,
      });
    }
    for (const m of data?.manualMovements ?? []) {
      const isBankSync = !!m.sourceId?.startsWith("mp:");
      items.push({
        id: `man-${m.id}`,
        date: m.date,
        description: m.description,
        counterpart: isBankSync ? "Banco MP" : "",
        method: m.method || "—",
        category: normalizeCategory(m.category || "Sin categoría"),
        type: m.type as "ingreso" | "egreso",
        amount: parseFloat(m.amount),
        sourceType: "manual",
        sourceId: m.id,
        isBankSync,
      });
    }
    return items.sort((a, b) => b.date.localeCompare(a.date));
  }, [data]);

  // Method breakdown for the selected period (from feed)
  const methodBreakdown = useMemo(() => {
    const result: Record<MethodKey, { ingresos: number; egresos: number }> = {
      EFECTIVO:      { ingresos: 0, egresos: 0 },
      TRANSFERENCIA: { ingresos: 0, egresos: 0 },
      CHEQUE:        { ingresos: 0, egresos: 0 },
    };
    for (const item of feed) {
      const k = normalizeMethod(item.method);
      if (!k) continue;
      if (item.type === "ingreso") result[k].ingresos += item.amount;
      else result[k].egresos += item.amount;
    }
    return result;
  }, [feed]);

  // Filter feed
  const filteredFeed = useMemo(() => {
    return feed.filter(item => {
      if (filterCat !== "_all" && item.category !== filterCat) return false;
      if (filterType !== "_all" && item.type !== filterType) return false;
      return true;
    });
  }, [feed, filterCat, filterType]);

  // Category options for filter (from feed)
  const feedCategories = useMemo(() => {
    const set = new Set(feed.map(i => i.category));
    return Array.from(set).sort();
  }, [feed]);

  // Pie: egresos by category for the selected period
  const pieData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of feed) {
      if (item.type !== "egreso") continue;
      map[item.category] = (map[item.category] ?? 0) + item.amount;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [feed]);

  const bankCatNames = (bankCats ?? []).map(c => c.name);

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
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Agregar
            </Button>
          </div>
        </div>

        {/* Totals row */}
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
                <DollarSign className="h-4 w-4 text-blue-600" /> Neto
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${(data?.saldo ?? 0) >= 0 ? "text-blue-700" : "text-red-700"}`}>
                {isLoading ? "..." : fmt(data?.saldo ?? 0)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Method breakdown for period */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Por método de pago — {label}
          </p>
          <div className="grid grid-cols-3 gap-4">
            {(["EFECTIVO", "TRANSFERENCIA", "CHEQUE"] as MethodKey[]).map(k => {
              const cfg = METHOD_CONFIG[k];
              const mb = methodBreakdown[k];
              const neto = mb.ingresos - mb.egresos;
              return (
                <Card key={k}>
                  <CardContent className="px-4 pt-4 pb-3">
                    <div className="flex items-center gap-2 mb-2">
                      {cfg.icon}
                      <span className="text-sm font-semibold">{cfg.label}</span>
                    </div>
                    <p className={`text-2xl font-bold mb-2 ${neto >= 0 ? cfg.color : "text-red-700"}`}>
                      {isLoading ? "..." : fmt(neto)}
                    </p>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span className="text-green-600">↑ {fmt(mb.ingresos)}</span>
                      <span className="text-red-600">↓ {fmt(mb.egresos)}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Pie: egresos por categoría */}
        {pieData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Egresos por categoría — {label}</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-6 items-center">
              <div className="w-48 h-48 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={80} innerRadius={32}>
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2 text-sm overflow-hidden">
                {pieData.map((d, i) => {
                  const total = pieData.reduce((acc, x) => acc + x.value, 0);
                  const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full flex-shrink-0"
                        style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="truncate text-muted-foreground flex-1">{d.name}</span>
                      <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                      <span className="font-semibold tabular-nums w-24 text-right">{fmt(d.value)}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Unified feed */}
        <section>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <h2 className="font-semibold text-base">Movimientos — {label}</h2>
            <Badge variant="secondary">{filteredFeed.length}</Badge>
            <div className="ml-auto flex items-center gap-2">
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-8 text-xs w-32">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  <SelectItem value="ingreso">Ingresos</SelectItem>
                  <SelectItem value="egreso">Egresos</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterCat} onValueChange={setFilterCat}>
                <SelectTrigger className="h-8 text-xs w-44">
                  <SelectValue placeholder="Categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas las categorías</SelectItem>
                  {feedCategories.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {filteredFeed.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos en este período.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Fecha</th>
                    <th className="text-left px-3 py-2 font-medium">Descripción</th>
                    <th className="text-left px-3 py-2 font-medium">Parte</th>
                    <th className="text-left px-3 py-2 font-medium">Método</th>
                    <th className="text-left px-3 py-2 font-medium">Categoría</th>
                    <th className="text-right px-3 py-2 font-medium">Monto</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filteredFeed.map(item => (
                    <tr key={item.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{fmtDate(item.date)}</td>
                      <td className="px-3 py-2 max-w-[180px] truncate">{item.description}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">{item.counterpart || "—"}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-xs">
                          {METHOD_LABEL[item.method.toUpperCase()] ?? item.method}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{item.category}</td>
                      <td className={`px-3 py-2 text-right font-medium ${item.type === "ingreso" ? "text-green-700" : "text-red-700"}`}>
                        {item.type === "egreso" ? "-" : "+"}{fmt(item.amount)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {item.sourceType === "manual" && !item.isBankSync && (
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => delMutation.mutate(item.sourceId)}
                            disabled={delMutation.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        )}
                        {item.isBankSync && (
                          <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">Banco</span>
                        )}
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
            <DialogTitle>Agregar movimiento</DialogTitle>
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
              <Label>Método <span className="text-red-500">*</span></Label>
              <Select value={form.method || "_none"} onValueChange={v => setForm(f => ({ ...f, method: v === "_none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccionar método" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EFECTIVO">Efectivo</SelectItem>
                  <SelectItem value="TRANSFERENCIA">Transferencia</SelectItem>
                  <SelectItem value="CHEQUE">Cheque</SelectItem>
                  <SelectItem value="MP">Mercado Pago</SelectItem>
                  <SelectItem value="OTRO">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Descripción</Label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Ej: Nafta, Sueldo chofer..."
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
                {bankCatNames.length > 0 ? (
                  <Select
                    value={form.category || "_none"}
                    onValueChange={v => setForm(f => ({ ...f, category: v === "_none" ? "" : v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Sin categoría" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Sin categoría</SelectItem>
                      {bankCatNames.map(cat => (
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
            <Button
              onClick={handleAdd}
              disabled={addMutation.isPending || !form.description || !form.amount || !form.method}
            >
              {addMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
