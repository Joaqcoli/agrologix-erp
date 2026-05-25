import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertCircle, Landmark, TrendingUp, Percent, ArrowDownLeft, ArrowUpRight, ChevronDown, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: number) => "$" + Math.round(Math.abs(v)).toLocaleString("es-AR");

function pad(n: number) { return String(n).padStart(2, "0"); }
function isoDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function fmtDateShort(s: string) {
  if (!s) return "";
  const d = new Date(s);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

function fmtDateLong(iso: string) {
  // iso = "YYYY-MM-DD"
  const [y, m, day] = iso.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "long" });
}

function fmtTime(s: string) {
  if (!s) return "";
  const d = new Date(s);
  return d.toLocaleTimeString("es-AR", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }) + " hs";
}

function getLast30() {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 29);
  return { from: isoDate(from), to: isoDate(to) };
}

const TYPE_LABELS: Record<string, string> = {
  account_money: "Saldo MP",
  credit_card: "Tarjeta de crédito",
  debit_card: "Tarjeta de débito",
  ticket: "Efectivo",
  bank_transfer: "Transferencia bancaria",
  atm: "Cajero automático",
  digital_wallet: "Billetera digital",
  payment: "Pago",
  transfer: "Transferencia",
  withdrawal: "Retiro",
};

// ─── types ─────────────────────────────────────────────────────────────────────

type BankCategory = { id: number; name: string };

type MpBalance = {
  available_balance?: number | null;
  unavailable?: boolean;
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
  categoryId?: number | null;
  // campos normalizados en el servidor
  isOutgoing?: boolean;
  grossAmount?: number;
  feeAmount?: number;
  payerName?: string | null;
};

type MpMovementsResponse = {
  results?: MpMovement[];
  error?: string;
};

// ─── subcomponent: category picker ────────────────────────────────────────────

function CategoryPicker({
  movId,
  categoryId,
  categories,
  onSelect,
  onAddNew,
}: {
  movId: string | number;
  categoryId: number | null | undefined;
  categories: BankCategory[];
  onSelect: (movId: string | number, catId: number | null) => void;
  onAddNew: () => void;
}) {
  const current = categories.find(c => c.id === categoryId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <span className={current ? "text-foreground font-medium" : ""}>
            {current?.name ?? "Categorizar"}
          </span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {categories.map(cat => (
          <DropdownMenuItem
            key={cat.id}
            onClick={() => onSelect(movId, cat.id)}
            className={cat.id === categoryId ? "font-semibold" : ""}
          >
            {cat.name}
          </DropdownMenuItem>
        ))}
        {categoryId != null && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onSelect(movId, null)} className="text-muted-foreground">
              Quitar categoría
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onAddNew} className="text-blue-600 font-medium">
          <Plus className="h-3.5 w-3.5 mr-1" /> Agregar categoría
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── main component ────────────────────────────────────────────────────────────

export default function BancosPage() {
  const qc = useQueryClient();
  const { from: defaultFrom, to: defaultTo } = getLast30();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [filterStatus, setFilterStatus] = useState("all");

  // New category dialog
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  // Pending assignment: when user clicks "+ Agregar categoría" we store which mov is waiting
  const [pendingMovId, setPendingMovId] = useState<string | number | null>(null);

  // ── queries ──────────────────────────────────────────────────────────────────

  const { data: balance, isLoading: balanceLoading } = useQuery<MpBalance>({
    queryKey: ["/api/mp/balance"],
    queryFn: () => fetch("/api/mp/balance", { credentials: "include" }).then(r => r.json()),
    retry: false,
  });

  const { data: movData, isLoading: movLoading, error: movErr } = useQuery<MpMovementsResponse>({
    queryKey: ["/api/mp/movements", from, to, filterStatus],
    queryFn: () => {
      const p = new URLSearchParams({ from, to });
      if (filterStatus !== "all") p.set("status", filterStatus);
      return fetch(`/api/mp/movements?${p}`, { credentials: "include" }).then(r => r.json());
    },
    retry: false,
  });

  const { data: categories = [] } = useQuery<BankCategory[]>({
    queryKey: ["/api/bank-categories"],
    queryFn: () =>
      fetch("/api/bank-categories", { credentials: "include" })
        .then(r => r.json())
        .then(d => (Array.isArray(d) ? d : [])),
  });

  // ── mutations ─────────────────────────────────────────────────────────────────

  const setCategoryMut = useMutation({
    mutationFn: ({ mpId, categoryId }: { mpId: string | number; categoryId: number | null }) =>
      apiRequest("PUT", `/api/mp/movements/${mpId}/category`, { categoryId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/mp/movements"] }),
  });

  const createCategoryMut = useMutation({
    mutationFn: (name: string) => apiRequest("POST", "/api/bank-categories", { name }),
    onSuccess: async (res: any) => {
      await qc.invalidateQueries({ queryKey: ["/api/bank-categories"] });
      // Auto-assign to the pending movement if any
      if (pendingMovId != null && res?.id) {
        setCategoryMut.mutate({ mpId: pendingMovId, categoryId: res.id });
      }
      setPendingMovId(null);
      setNewCatOpen(false);
      setNewCatName("");
    },
  });

  const handleAddNew = (movId: string | number) => {
    setPendingMovId(movId);
    setNewCatOpen(true);
  };

  // ── derived data ──────────────────────────────────────────────────────────────

  const movements: MpMovement[] = movData?.results ?? [];
  const mpError = movData?.error ?? (movErr as Error)?.message ?? null;

  const filtered = filterStatus === "all"
    ? movements
    : movements.filter(m => m.status === filterStatus);

  // Stats
  const { cobradoMes, comisionesMes } = useMemo(() => {
    let cobradoMes = 0;
    let comisionesMes = 0;
    for (const m of filtered) {
      const raw = parseFloat(String(m.total ?? m.amount ?? 0));
      const fee = Math.abs(parseFloat(String(m.fee?.amount ?? 0)));
      if (raw > 0) cobradoMes += raw;
      comisionesMes += fee;
    }
    return { cobradoMes, comisionesMes };
  }, [filtered]);

  // Chart
  const chartData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of filtered) {
      const raw = parseFloat(String(m.total ?? m.amount ?? 0));
      if (raw <= 0) continue;
      const d = fmtDateShort(m.date_created);
      if (!d) continue;
      map[d] = (map[d] ?? 0) + raw;
    }
    return Object.entries(map)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, total]) => ({ date, total }));
  }, [filtered]);

  // Group by date descending
  const grouped = useMemo(() => {
    const map = new Map<string, MpMovement[]>();
    for (const m of filtered) {
      const dateKey = (m.date_created ?? "").slice(0, 10);
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(m);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">Bancos</h1>

        {/* ── Mercado Pago ── */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Landmark className="h-5 w-5" /> Mercado Pago
          </h2>

          {mpError && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Error conectando con Mercado Pago: {mpError}</span>
            </div>
          )}

          {/* Cards */}
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Saldo disponible</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {balanceLoading ? "..." : (balance?.unavailable || balance?.available_balance == null)
                    ? <span className="text-base text-muted-foreground font-normal">No disponible</span>
                    : fmt(balance.available_balance ?? 0)}
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
                <CardTitle className="text-sm font-medium">Cobros por día</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
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
              <label className="text-xs text-muted-foreground font-medium">Estado</label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-sm w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="approved">Aprobado</SelectItem>
                  <SelectItem value="pending">Pendiente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Movements — estilo MP ── */}
          {movLoading ? (
            <p className="text-sm text-muted-foreground">Cargando movimientos...</p>
          ) : grouped.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos para los filtros seleccionados.</p>
          ) : (
            <div className="space-y-5">
              {grouped.map(([dateKey, movs]) => (
                <div key={dateKey}>
                  {/* Date header */}
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                    {fmtDateLong(dateKey)}
                  </p>

                  <div className="bg-card border rounded-2xl overflow-hidden divide-y">
                    {movs.map(m => {
                      const isOutgoing = m.isOutgoing
                        ?? ((m.description ?? "").toLowerCase().startsWith("transferencia a") || m.type === "withdrawal");
                      const gross  = m.grossAmount ?? Math.abs(parseFloat(String(m.total ?? m.amount ?? 0)));
                      const fee    = m.feeAmount   ?? Math.abs(parseFloat(String(m.fee?.amount ?? 0)));
                      const net    = isOutgoing ? gross + fee : gross - fee;
                      const typeLabel = TYPE_LABELS[m.type] ?? m.type;
                      // Nombre: payerName del servidor, o descripción si no es genérica, o typeLabel
                      const genericDescs = ["varios", "pago debin", "pago qr", ""];
                      const rawDesc = (m.description ?? "").trim();
                      const displayName = m.payerName
                        ?? (genericDescs.includes(rawDesc.toLowerCase()) ? null : rawDesc)
                        ?? typeLabel;

                      return (
                        <div key={m.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                          {/* Icon */}
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                            isOutgoing ? "bg-red-50" : "bg-green-50"
                          }`}>
                            {isOutgoing
                              ? <ArrowUpRight className="h-5 w-5 text-red-500" />
                              : <ArrowDownLeft className="h-5 w-5 text-green-500" />
                            }
                          </div>

                          {/* Name + type + category */}
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm leading-tight">{displayName}</p>
                            <p className="text-xs text-muted-foreground leading-tight mt-0.5">{typeLabel}</p>
                            <div className="mt-1.5">
                              <CategoryPicker
                                movId={m.id}
                                categoryId={m.categoryId}
                                categories={categories}
                                onSelect={(id, catId) => setCategoryMut.mutate({ mpId: id, categoryId: catId })}
                                onAddNew={() => handleAddNew(m.id)}
                              />
                            </div>
                          </div>

                          {/* Monto / Comisión / Total / Hora */}
                          <div className="text-right flex-shrink-0 space-y-0.5">
                            <p className="text-sm text-foreground">
                              {fmt(gross)}
                            </p>
                            {fee > 0 && (
                              <p className="text-xs text-orange-600">
                                comisión {fmt(fee)}
                              </p>
                            )}
                            <p className={`font-bold text-sm ${isOutgoing ? "text-red-600" : "text-green-700"}`}>
                              {isOutgoing ? "-" : "+"}{fmt(net)}
                            </p>
                            <p className="text-xs text-muted-foreground">{fmtTime(m.date_created)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
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
          </div>
        </section>
      </div>

      {/* ── Dialog nueva categoría ── */}
      <Dialog open={newCatOpen} onOpenChange={v => { setNewCatOpen(v); if (!v) { setNewCatName(""); setPendingMovId(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nueva categoría</DialogTitle>
          </DialogHeader>
          <Input
            value={newCatName}
            onChange={e => setNewCatName(e.target.value)}
            placeholder="Ej: Retiro propio"
            onKeyDown={e => { if (e.key === "Enter" && newCatName.trim()) createCategoryMut.mutate(newCatName.trim()); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCatOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => { if (newCatName.trim()) createCategoryMut.mutate(newCatName.trim()); }}
              disabled={!newCatName.trim() || createCategoryMut.isPending}
            >
              {createCategoryMut.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
