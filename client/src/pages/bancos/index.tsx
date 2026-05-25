import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertCircle, Landmark, TrendingUp, Percent, ArrowDownLeft, ArrowUpRight, ChevronDown, Plus, User, Building2, UserCheck } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: number) => "$" + Math.round(Math.abs(v)).toLocaleString("es-AR");

// Formatea el rawIdentifier para mostrar en UI (trunca emails, formatea IDs de MP)
function fmtRawId(id: string | null | undefined): string {
  if (!id) return "";
  if (id.startsWith("mp:")) return `ID MP: ${id.slice(3)}`;
  if (id.length > 28) return id.slice(0, 14) + "…" + id.slice(-8);
  return id;
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function isoDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function fmtDateShort(s: string) {
  if (!s) return "";
  const d = new Date(s);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

function fmtDateLong(iso: string) {
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

const CONTACT_TYPE_LABELS: Record<string, string> = {
  cliente: "Cliente",
  proveedor: "Proveedor",
  banco: "Banco",
  otro: "Otro",
};

// ─── types ─────────────────────────────────────────────────────────────────────

type BankCategory = { id: number; name: string };

type BankContact = {
  id: number;
  identifier: string;
  displayName: string;
  type: string;
  entityId: number | null;
};

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
  netAmount?: number;
  displayName?: string | null;
  rawIdentifier?: string | null;
  identified?: boolean;
  contactType?: string | null;
  entityId?: number | null;
  contactId?: number | null;
};

type MpMovementsResponse = {
  results?: MpMovement[];
  error?: string;
};

type SimpleEntity = { id: number; name: string };

// ─── subcomponent: contact type icon ─────────────────────────────────────────

function ContactTypeIcon({ type }: { type: string }) {
  if (type === "cliente") return <User className="h-3.5 w-3.5 text-blue-500" />;
  if (type === "proveedor") return <Building2 className="h-3.5 w-3.5 text-purple-500" />;
  if (type === "banco") return <Landmark className="h-3.5 w-3.5 text-blue-400" />;
  return <UserCheck className="h-3.5 w-3.5 text-gray-400" />;
}

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
  const [pendingMovId, setPendingMovId] = useState<string | number | null>(null);

  // Identificar dialog
  const [identifyOpen, setIdentifyOpen] = useState(false);
  const [identifyMov, setIdentifyMov] = useState<MpMovement | null>(null);
  const [idName, setIdName] = useState("");
  const [idIdentifier, setIdIdentifier] = useState("");  // editable cuando no hay rawIdentifier
  const [idType, setIdType] = useState("otro");
  const [idEntityId, setIdEntityId] = useState<number | null>(null);
  const [entitySearch, setEntitySearch] = useState("");
  const [idError, setIdError] = useState<string | null>(null);

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

  const { data: customers = [] } = useQuery<SimpleEntity[]>({
    queryKey: ["/api/customers"],
    queryFn: () => fetch("/api/customers", { credentials: "include" }).then(r => r.json()),
    enabled: identifyOpen && (idType === "cliente"),
  });

  const { data: suppliers = [] } = useQuery<SimpleEntity[]>({
    queryKey: ["/api/suppliers"],
    queryFn: () => fetch("/api/suppliers", { credentials: "include" }).then(r => r.json()),
    enabled: identifyOpen && (idType === "proveedor"),
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
      if (pendingMovId != null && res?.id) {
        setCategoryMut.mutate({ mpId: pendingMovId, categoryId: res.id });
      }
      setPendingMovId(null);
      setNewCatOpen(false);
      setNewCatName("");
    },
  });

  const createContactMut = useMutation({
    mutationFn: (data: { identifier: string; displayName: string; type: string; entityId: number | null }) =>
      apiRequest("POST", "/api/bank-contacts", data).then(r => r.json()) as Promise<BankContact>,
    onError: (e: Error) => {
      const msg = e.message.includes("23505") || e.message.includes("409")
        ? "Ese identificador ya está registrado"
        : e.message;
      setIdError(msg);
    },
  });

  // ── handlers ─────────────────────────────────────────────────────────────────

  const handleAddNew = (movId: string | number) => {
    setPendingMovId(movId);
    setNewCatOpen(true);
  };

  const openIdentifyDialog = (mov: MpMovement) => {
    setIdentifyMov(mov);
    setIdName("");
    setIdIdentifier(mov.rawIdentifier ?? "");
    setIdType("otro");
    setIdEntityId(null);
    setEntitySearch("");
    setIdError(null);
    setIdentifyOpen(true);
  };

  const closeIdentifyDialog = () => {
    setIdentifyOpen(false);
    setIdentifyMov(null);
    setIdName("");
    setIdIdentifier("");
    setIdType("otro");
    setIdEntityId(null);
    setEntitySearch("");
    setIdError(null);
  };

  const handleSaveContact = () => {
    if (!idIdentifier.trim() || !idName.trim()) return;
    setIdError(null);
    const movId = identifyMov?.id;
    createContactMut.mutate(
      { identifier: idIdentifier.trim(), displayName: idName.trim(), type: idType, entityId: idEntityId },
      {
        onSuccess: (contact: BankContact) => {
          // Actualizar caché de forma optimista — sin re-fetch (staleTime: Infinity)
          // Matchear por: rawIdentifier (case-insensitive) O por movement ID cuando no hay rawIdentifier
          qc.setQueriesData<MpMovementsResponse>(
            { queryKey: ["/api/mp/movements"] },
            (old) => {
              if (!old?.results) return old;
              return {
                ...old,
                results: old.results.map(m => {
                  const byId = !m.rawIdentifier && m.id === movId;
                  const byIdentifier = m.rawIdentifier &&
                    m.rawIdentifier.toLowerCase() === contact.identifier.toLowerCase();
                  if (!byId && !byIdentifier) return m;
                  return { ...m, identified: true, displayName: contact.displayName, contactType: contact.type, entityId: contact.entityId, contactId: contact.id };
                }),
              };
            }
          );
          closeIdentifyDialog();
        },
      }
    );
  };

  // ── derived data ──────────────────────────────────────────────────────────────

  const movements: MpMovement[] = movData?.results ?? [];
  const mpError = movData?.error ?? (movErr as Error)?.message ?? null;

  const filtered = filterStatus === "all"
    ? movements
    : movements.filter(m => m.status === filterStatus);

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

  const grouped = useMemo(() => {
    const map = new Map<string, MpMovement[]>();
    for (const m of filtered) {
      const dateKey = (m.date_created ?? "").slice(0, 10);
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(m);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  // Entity list for modal (customers or suppliers based on idType)
  const entityList: SimpleEntity[] = idType === "cliente" ? customers : idType === "proveedor" ? suppliers : [];
  const filteredEntities = entitySearch.trim()
    ? entityList.filter(e => e.name.toLowerCase().includes(entitySearch.toLowerCase()))
    : entityList;

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
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                    {fmtDateLong(dateKey)}
                  </p>

                  <div className="bg-card border rounded-2xl overflow-hidden divide-y">
                    {movs.map(m => {
                      const isOutgoing  = m.isOutgoing ?? false;
                      const gross       = m.grossAmount ?? Math.abs(parseFloat(String(m.total ?? m.amount ?? 0)));
                      const fee         = m.feeAmount   ?? 0;
                      const net         = m.netAmount   ?? (isOutgoing ? gross + fee : gross - fee);
                      const typeLabel   = TYPE_LABELS[m.type] ?? m.type;
                      const identified  = m.identified ?? false;
                      // Subtitle: prefer MP description over typeLabel
                      const subtitle    = m.description || typeLabel;

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

                          {/* Name + subtitle + category */}
                          <div className="flex-1 min-w-0">
                            {identified ? (
                              /* ── Identificado ── */
                              <>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <ContactTypeIcon type={m.contactType ?? "otro"} />
                                  <p className="font-semibold text-sm leading-tight">{m.displayName}</p>
                                  <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                                    {CONTACT_TYPE_LABELS[m.contactType ?? "otro"] ?? m.contactType}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground leading-tight mt-0.5">{subtitle}</p>
                                {m.rawIdentifier && (
                                  <p className="text-[11px] text-muted-foreground/60 font-mono leading-tight">
                                    {fmtRawId(m.rawIdentifier)}
                                  </p>
                                )}
                              </>
                            ) : (
                              /* ── Sin identificar ── */
                              <>
                                <p className="font-semibold text-sm leading-tight text-foreground">{subtitle}</p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  <span className="text-xs text-muted-foreground">
                                    {m.rawIdentifier ? fmtRawId(m.rawIdentifier) : "Sin identificar"}
                                  </span>
                                  <button
                                    onClick={() => openIdentifyDialog(m)}
                                    className="text-[11px] text-blue-600 hover:text-blue-800 font-medium border border-blue-200 rounded px-1.5 py-0.5 leading-tight hover:bg-blue-50 transition-colors flex-shrink-0"
                                  >
                                    Identificar
                                  </button>
                                </div>
                              </>
                            )}
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

      {/* ── Dialog identificar contacto ── */}
      <Dialog open={identifyOpen} onOpenChange={v => { if (!v) closeIdentifyDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Identificar contacto</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Identificador (email, CBU, alias)</label>
              {identifyMov?.rawIdentifier ? (
                <p className="text-xs text-muted-foreground font-mono bg-muted rounded px-2 py-1.5 break-all">
                  {fmtRawId(identifyMov.rawIdentifier)}
                </p>
              ) : (
                <Input
                  value={idIdentifier}
                  onChange={e => { setIdIdentifier(e.target.value); setIdError(null); }}
                  placeholder="Ej: juan@email.com · 0000003100..."
                  autoFocus
                />
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nombre a mostrar</label>
              <Input
                value={idName}
                onChange={e => setIdName(e.target.value)}
                placeholder="Ej: Juan García"
                autoFocus={!!identifyMov?.rawIdentifier}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tipo</label>
              <Select value={idType} onValueChange={v => { setIdType(v); setIdEntityId(null); setEntitySearch(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cliente">Cliente</SelectItem>
                  <SelectItem value="proveedor">Proveedor</SelectItem>
                  <SelectItem value="banco">Banco</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(idType === "cliente" || idType === "proveedor") && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Vincular a {idType === "cliente" ? "cliente" : "proveedor"} (opcional)
                </label>
                <Input
                  value={entitySearch}
                  onChange={e => { setEntitySearch(e.target.value); setIdEntityId(null); }}
                  placeholder="Buscar por nombre..."
                />
                {entitySearch.trim() && filteredEntities.length > 0 && idEntityId == null && (
                  <div className="border rounded-md overflow-hidden max-h-40 overflow-y-auto">
                    {filteredEntities.slice(0, 8).map(e => (
                      <button
                        key={e.id}
                        onClick={() => { setIdEntityId(e.id); setEntitySearch(e.name); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors border-b last:border-b-0"
                      >
                        {e.name}
                      </button>
                    ))}
                  </div>
                )}
                {idEntityId != null && (
                  <p className="text-xs text-green-600 font-medium">✓ Vinculado correctamente</p>
                )}
              </div>
            )}
          </div>

          {idError && (
            <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{idError}</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeIdentifyDialog}>Cancelar</Button>
            <Button
              onClick={handleSaveContact}
              disabled={!idName.trim() || !idIdentifier.trim() || createContactMut.isPending}
            >
              {createContactMut.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
