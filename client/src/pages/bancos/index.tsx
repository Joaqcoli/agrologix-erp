import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertCircle, Landmark, TrendingUp, Percent, ArrowDownLeft, ArrowUpRight, ChevronDown, Plus, User, Building2, UserCheck, Pencil, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: number) => "$" + Math.round(Math.abs(v)).toLocaleString("es-AR");

// Formatea el identificador único para mostrar en UI
function fmtRawId(id: string | null | undefined): string {
  if (!id) return "";
  if (id.startsWith("mp:")) {
    const num = id.slice(3);
    return `ID MP: ${num}`;
  }
  // CBU/CVU: número largo, mostrar recortado
  if (/^\d{15,}$/.test(id)) return `CBU: ${id.slice(0, 8)}…${id.slice(-4)}`;
  if (id.length > 30) return id.slice(0, 15) + "…" + id.slice(-8);
  return id;
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function isoDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function fmtDateLong(iso: string | null | undefined) {
  if (!iso) return "";
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "long" });
}

function fmtTime(s: string) {
  if (!s) return "";
  const d = new Date(s);
  return d.toLocaleTimeString("es-AR", {
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  }) + " hs";
}

function getDefaultRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: isoDate(from), to: isoDate(now) };
}

// Convierte una fecha UTC (ISO string de MP) a fecha en Argentina (UTC-3)
function toArgDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  // Restar 3 horas (UTC-3) para obtener hora argentina
  const ar = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const y = ar.getUTCFullYear();
  const m = String(ar.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ar.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

type BankPaymentLink = {
  id: number;
  pedidoId: number | null;
  montoAplicado: string;
  folio: string | null;
  remitoNum: number | null;
  invoiceNumber: string | null;
};

type PendingOrder = {
  id: number;
  folio: string;
  remitoNum: number | null;
  total: string;
  paidAmount: string;
  pendingAmount: string;
  orderDate: string;
  invoiceNumber: string | null;
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
  bankPaymentLinks?: BankPaymentLink[];
};

type MpMovementsResponse = {
  results?: MpMovement[];
  error?: string;
};

type SimpleEntity = { id: number; name: string };

function fmtList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + " y " + items[items.length - 1];
}

function fmtBankLinks(links: BankPaymentLink[]): string {
  const invoices = links.filter(l => l.invoiceNumber).map(l => {
    // Extraer solo el número final de "A-0004-00000125" → "125"
    const parts = l.invoiceNumber!.split("-");
    return String(parseInt(parts[parts.length - 1] ?? "0", 10));
  });
  const remitos = links.filter(l => !l.invoiceNumber && l.remitoNum != null).map(l => String(l.remitoNum));

  if (invoices.length > 0 && remitos.length === 0) return `FC ${fmtList(invoices)}`;
  if (remitos.length > 0 && invoices.length === 0) return `Remito ${fmtList(remitos)}`;
  if (invoices.length > 0 && remitos.length > 0) return `FC ${fmtList(invoices)}, Remito ${fmtList(remitos)}`;
  return links.map(l => l.folio ?? `#${l.pedidoId}`).join(", ");
}

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
  const { from: defaultFrom, to: defaultTo } = getDefaultRange();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCatId, setFilterCatId] = useState<number | null>(null);

  // New category dialog
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [pendingMovId, setPendingMovId] = useState<string | number | null>(null);

  // Edit category dialog
  const [editCatOpen, setEditCatOpen] = useState(false);
  const [editCat, setEditCat] = useState<BankCategory | null>(null);
  const [editCatName, setEditCatName] = useState("");

  // Aplicar pago dialog
  const [applyPayOpen, setApplyPayOpen] = useState(false);
  const [applyPayMov, setApplyPayMov] = useState<MpMovement | null>(null);
  // orderId → monto a aplicar (string para input controlado)
  const [applyAmounts, setApplyAmounts] = useState<Map<number, string>>(new Map());

  // Identificar / Editar contacto dialog
  const [identifyOpen, setIdentifyOpen] = useState(false);
  const [identifyMov, setIdentifyMov] = useState<MpMovement | null>(null);
  const [idName, setIdName] = useState("");
  const [idIdentifier, setIdIdentifier] = useState("");  // editable cuando no hay rawIdentifier
  const [idType, setIdType] = useState("otro");
  const [idEntityId, setIdEntityId] = useState<number | null>(null);
  const [entitySearch, setEntitySearch] = useState("");
  const [idError, setIdError] = useState<string | null>(null);
  const [idEditMode, setIdEditMode] = useState(false); // true = editar contacto existente

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

  const { data: pendingOrders = [], isLoading: pendingOrdersLoading } = useQuery<PendingOrder[]>({
    queryKey: ["/api/customers/pedidos-pendientes", applyPayMov?.entityId],
    queryFn: () => fetch(`/api/customers/${applyPayMov!.entityId}/pedidos-pendientes`, { credentials: "include" }).then(r => r.json()),
    enabled: applyPayOpen && !!applyPayMov?.entityId,
  });

  const { data: suppliers = [] } = useQuery<SimpleEntity[]>({
    queryKey: ["/api/suppliers"],
    queryFn: () => fetch("/api/suppliers", { credentials: "include" }).then(r => r.json()),
    enabled: identifyOpen && (idType === "proveedor"),
  });

  // ── mutations ─────────────────────────────────────────────────────────────────

  const setCategoryMut = useMutation({
    mutationFn: ({ mpId, categoryId, amount, date, isOutgoing, description }: {
      mpId: string | number;
      categoryId: number | null;
      amount?: number;
      date?: string;
      isOutgoing?: boolean;
      description?: string;
    }) => apiRequest("PUT", `/api/mp/movements/${mpId}/category`, { categoryId, amount, date, isOutgoing, description }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/mp/movements"] });
      qc.invalidateQueries({ queryKey: ["/api/caja/summary"] });
    },
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

  const updateContactMut = useMutation({
    mutationFn: ({ id, ...data }: { id: number; displayName: string; type: string; entityId: number | null }) =>
      apiRequest("PUT", `/api/bank-contacts/${id}`, data).then(r => r.json()) as Promise<BankContact>,
    onError: (e: Error) => setIdError(e.message),
  });

  const deleteContactMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/bank-contacts/${id}`),
    onSuccess: () => {
      // Unidentify all movements that had this contact
      const deletedContactId = identifyMov?.contactId;
      qc.setQueriesData<MpMovementsResponse>(
        { queryKey: ["/api/mp/movements"] },
        (old) => {
          if (!old?.results) return old;
          return {
            ...old,
            results: old.results.map(m =>
              m.contactId === deletedContactId
                ? { ...m, identified: false, displayName: null, contactType: null, entityId: null, contactId: null }
                : m
            ),
          };
        }
      );
      closeIdentifyDialog();
    },
    onError: (e: Error) => setIdError(e.message),
  });

  const updateCategoryMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      apiRequest("PUT", `/api/bank-categories/${id}`, { name }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/bank-categories"] });
      setEditCatOpen(false);
      setEditCat(null);
      setEditCatName("");
    },
  });

  const [applyPayError, setApplyPayError] = useState<string | null>(null);

  const applyPayMut = useMutation({
    mutationFn: (data: { movementId: string; customerId: number; date: string; notes?: string; links: Array<{ pedidoId: number; montoAplicado: number }> }) =>
      apiRequest("POST", "/api/bank-payment-links", data).then(r => r.json()),
    onError: (e: Error) => setApplyPayError(e.message),
  });

  const [syncResult, setSyncResult] = useState<string | null>(null);
  const syncReportMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/mp/sync-report").then(r => r.json()),
    onSuccess: (data: { synced: number; skipped: number; reportFile: string | null; details?: string }) => {
      const msg = data.synced > 0
        ? `${data.synced} movimientos identificados`
        : `0 identificados — ${data.details ?? `skipped: ${data.skipped}`}`;
      setSyncResult(msg);
      if (data.synced > 0) qc.invalidateQueries({ queryKey: ["/api/mp/movements"] });
      setTimeout(() => setSyncResult(null), 12000);
    },
    onError: (e: Error) => {
      setSyncResult(`Error: ${e.message}`);
      setTimeout(() => setSyncResult(null), 8000);
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
    setIdEditMode(false);
    setIdentifyOpen(true);
  };

  const openEditContactDialog = (mov: MpMovement) => {
    setIdentifyMov(mov);
    setIdName(mov.displayName ?? "");
    setIdIdentifier(mov.rawIdentifier ?? "");
    setIdType(mov.contactType ?? "otro");
    setIdEntityId(mov.entityId ?? null);
    setEntitySearch("");
    setIdError(null);
    setIdEditMode(true);
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
    setIdEditMode(false);
  };

  const applyContactToCache = (contact: BankContact, movId?: string | number) => {
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
            // En edición también matchear por contactId
            const byContactId = idEditMode && m.contactId === contact.id;
            if (!byId && !byIdentifier && !byContactId) return m;
            return { ...m, identified: true, displayName: contact.displayName, contactType: contact.type, entityId: contact.entityId, contactId: contact.id };
          }),
        };
      }
    );
  };

  const handleSaveContact = () => {
    if (!idName.trim()) return;
    setIdError(null);
    const movId = identifyMov?.id;
    const contactId = identifyMov?.contactId;

    if (idEditMode && contactId) {
      // Modo edición — PUT /api/bank-contacts/:id
      updateContactMut.mutate(
        { id: contactId, displayName: idName.trim(), type: idType, entityId: idEntityId },
        {
          onSuccess: (contact: BankContact) => {
            applyContactToCache(contact, movId);
            closeIdentifyDialog();
          },
        }
      );
    } else {
      // Modo creación — POST /api/bank-contacts
      if (!idIdentifier.trim()) return;
      createContactMut.mutate(
        { identifier: idIdentifier.trim(), displayName: idName.trim(), type: idType, entityId: idEntityId },
        {
          onSuccess: (contact: BankContact) => {
            applyContactToCache(contact, movId);
            closeIdentifyDialog();
          },
        }
      );
    }
  };

  // ── derived data ──────────────────────────────────────────────────────────────

  const movements: MpMovement[] = movData?.results ?? [];
  const mpError = movData?.error ?? (movErr as Error)?.message ?? null;

  const filtered = movements.filter(m => {
    if (filterStatus !== "all" && m.status !== filterStatus) return false;
    if (filterCatId !== null && m.categoryId !== filterCatId) return false;
    return true;
  });

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

  const grouped = useMemo(() => {
    const map = new Map<string, MpMovement[]>();
    for (const m of filtered) {
      const dateKey = toArgDate(m.date_created ?? "");
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
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Landmark className="h-5 w-5" /> Mercado Pago
            </h2>
            <Button variant="outline" size="sm" onClick={() => syncReportMut.mutate()} disabled={syncReportMut.isPending}>
              <RefreshCw className={`h-4 w-4 mr-1 ${syncReportMut.isPending ? "animate-spin" : ""}`} />
              {syncReportMut.isPending ? "Sincronizando…" : "Sincronizar"}
            </Button>
          </div>

          {syncResult && (
            <div className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground break-all">
              {syncResult}
            </div>
          )}

          {mpError && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Error conectando con Mercado Pago: {mpError}</span>
            </div>
          )}

          {/* Cards — solo mostrar saldo si está disponible, siempre cobrado/comisiones */}
          <div className={`grid gap-4 ${!balance?.unavailable && balance?.available_balance != null ? "grid-cols-3" : "grid-cols-2"}`}>
            {!balanceLoading && !balance?.unavailable && balance?.available_balance != null && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Saldo disponible</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{fmt(balance.available_balance ?? 0)}</p>
                </CardContent>
              </Card>
            )}
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
            {/* Dropdown de categorías — filtra y permite agregar nuevas */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Categoría</label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={`h-8 px-3 text-sm rounded-md border flex items-center gap-1.5 min-w-[9rem] justify-between transition-colors
                    ${filterCatId !== null
                      ? "border-foreground/30 bg-muted font-medium text-foreground"
                      : "border-input bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="truncate">
                      {filterCatId !== null
                        ? (categories.find(c => c.id === filterCatId)?.name ?? "Categoría")
                        : "Todas"}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem
                    onClick={() => setFilterCatId(null)}
                    className={filterCatId === null ? "font-semibold" : ""}
                  >
                    Todas las categorías
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {categories.map(cat => (
                    <DropdownMenuItem
                      key={cat.id}
                      onClick={() => setFilterCatId(cat.id)}
                      className={`flex items-center justify-between ${cat.id === filterCatId ? "font-semibold" : ""}`}
                    >
                      <span>{cat.name}</span>
                      <button
                        onClick={e => { e.stopPropagation(); setEditCat(cat); setEditCatName(cat.name); setEditCatOpen(true); }}
                        className="text-muted-foreground/40 hover:text-muted-foreground transition-colors ml-2"
                        title="Editar"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => { setPendingMovId(null); setNewCatOpen(true); }}
                    className="text-blue-600 font-medium"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Agregar categoría
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {filterCatId !== null && (
              <button
                onClick={() => setFilterCatId(null)}
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors self-end"
              >
                × Limpiar
              </button>
            )}
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
                              /* ── Identificado — nombre + badge + editar ── */
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <ContactTypeIcon type={m.contactType ?? "otro"} />
                                <p className="font-semibold text-sm leading-tight">{m.displayName}</p>
                                <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                                  {CONTACT_TYPE_LABELS[m.contactType ?? "otro"] ?? m.contactType}
                                </span>
                                <button
                                  onClick={() => openEditContactDialog(m)}
                                  className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                                  title="Editar contacto"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              /* ── Sin identificar ── */
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold text-sm leading-tight text-foreground">{subtitle}</p>
                                {fmtRawId(m.rawIdentifier) && (
                                  <span className="text-xs text-muted-foreground font-mono">
                                    {fmtRawId(m.rawIdentifier)}
                                  </span>
                                )}
                                <button
                                  onClick={() => openIdentifyDialog(m)}
                                  className="text-[11px] text-blue-600 hover:text-blue-800 font-medium border border-blue-200 rounded px-1.5 py-0.5 leading-tight hover:bg-blue-50 transition-colors flex-shrink-0"
                                >
                                  Identificar
                                </button>
                              </div>
                            )}
                            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                              <CategoryPicker
                                movId={m.id}
                                categoryId={m.categoryId}
                                categories={categories}
                                onSelect={(id, catId) => setCategoryMut.mutate({
                                  mpId: id,
                                  categoryId: catId,
                                  amount: m.netAmount,
                                  date: toArgDate(m.date_created ?? ""),
                                  isOutgoing: m.isOutgoing,
                                  description: m.displayName || m.description || "",
                                })}
                                onAddNew={() => handleAddNew(m.id)}
                              />
                              {/* Aplicar pago — solo para ingresos de clientes identificados */}
                              {!isOutgoing && m.contactType === "cliente" && m.entityId && (
                                (m.bankPaymentLinks && m.bankPaymentLinks.length > 0) ? (
                                  <span className="text-[10px] bg-green-100 text-green-700 rounded px-1.5 py-0.5 font-medium">
                                    ✓ {fmtBankLinks(m.bankPaymentLinks)}
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => { setApplyPayMov(m); setApplyAmounts(new Map()); setApplyPayOpen(true); }}
                                    className="text-[11px] text-green-700 hover:text-green-900 font-medium border border-green-300 rounded px-1.5 py-0.5 leading-tight hover:bg-green-50 transition-colors flex-shrink-0"
                                  >
                                    Aplicar pago
                                  </button>
                                )
                              )}
                            </div>
                          </div>

                          {/* Montos — layout 2×2: bruto+comisión | neto+hora */}
                          <div className="flex gap-3 items-start flex-shrink-0">
                            {fee > 0 && (
                              <div className="text-right space-y-0.5">
                                <p className="text-sm text-foreground">{fmt(gross)}</p>
                                <p className="text-xs text-orange-600">comisión {fmt(fee)}</p>
                              </div>
                            )}
                            <div className="text-right space-y-0.5">
                              <p className={`font-bold text-sm ${isOutgoing ? "text-red-600" : "text-green-700"}`}>
                                {isOutgoing ? "-" : "+"}{fmt(net)}
                              </p>
                              <p className="text-xs text-muted-foreground">{fmtTime(m.date_created)}</p>
                            </div>
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

      {/* ── Dialog editar categoría ── */}
      <Dialog open={editCatOpen} onOpenChange={v => { setEditCatOpen(v); if (!v) { setEditCat(null); setEditCatName(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Editar categoría</DialogTitle>
          </DialogHeader>
          <Input
            value={editCatName}
            onChange={e => setEditCatName(e.target.value)}
            placeholder="Nombre de la categoría"
            onKeyDown={e => { if (e.key === "Enter" && editCatName.trim() && editCat) updateCategoryMut.mutate({ id: editCat.id, name: editCatName.trim() }); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCatOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => { if (editCatName.trim() && editCat) updateCategoryMut.mutate({ id: editCat.id, name: editCatName.trim() }); }}
              disabled={!editCatName.trim() || updateCategoryMut.isPending}
            >
              {updateCategoryMut.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog identificar / editar contacto ── */}
      <Dialog open={identifyOpen} onOpenChange={v => { if (!v) closeIdentifyDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{idEditMode ? "Editar contacto" : "Identificar contacto"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {!idEditMode && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {identifyMov?.rawIdentifier
                    ? identifyMov.rawIdentifier.startsWith("mp:")
                      ? "Identificador único (ID Mercado Pago)"
                      : /^\d{15,}$/.test(identifyMov.rawIdentifier)
                        ? "Identificador único (CBU/CVU)"
                        : "Identificador"
                    : "Identificador (CBU, email o alias)"}
                </label>
                {identifyMov?.rawIdentifier ? (
                  <>
                    <p className="text-xs text-muted-foreground font-mono bg-muted rounded px-2 py-1.5 break-all">
                      {identifyMov.rawIdentifier}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Todas las transferencias desde este{" "}
                      {/^\d{15,}$/.test(identifyMov.rawIdentifier) ? "CBU" : "identificador"}{" "}
                      quedarán vinculadas a este contacto.
                    </p>
                  </>
                ) : (
                  <Input
                    value={idIdentifier}
                    onChange={e => { setIdIdentifier(e.target.value); setIdError(null); }}
                    placeholder="Ej: 0000003100099999999999 · juan@email.com"
                    autoFocus
                  />
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nombre a mostrar</label>
              <Input
                value={idName}
                onChange={e => setIdName(e.target.value)}
                placeholder="Ej: Juan García"
                autoFocus={idEditMode || !!identifyMov?.rawIdentifier}
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

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            {idEditMode && identifyMov?.contactId && (
              <Button
                variant="destructive"
                onClick={() => {
                  if (identifyMov.contactId) deleteContactMut.mutate(identifyMov.contactId);
                }}
                disabled={deleteContactMut.isPending}
                className="sm:mr-auto"
              >
                {deleteContactMut.isPending ? "Eliminando..." : "Eliminar contacto"}
              </Button>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={closeIdentifyDialog}>Cancelar</Button>
              <Button
                onClick={handleSaveContact}
                disabled={
                  !idName.trim() ||
                  (!idEditMode && !idIdentifier.trim() && !identifyMov?.rawIdentifier) ||
                  createContactMut.isPending ||
                  updateContactMut.isPending
                }
              >
                {(createContactMut.isPending || updateContactMut.isPending)
                  ? "Guardando..."
                  : idEditMode ? "Actualizar" : "Guardar"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog aplicar pago ── */}
      {applyPayOpen && applyPayMov && (() => {
        // El cliente paga el monto BRUTO (antes de comisiones MP)
        const gross = applyPayMov.grossAmount ?? Math.abs(parseFloat(String(applyPayMov.total ?? applyPayMov.amount ?? 0)));
        const totalAssigned = [...applyAmounts.values()].reduce((s, v) => s + (parseFloat(v) || 0), 0);
        const remaining = gross - totalAssigned;
        const canConfirm = applyAmounts.size > 0 && totalAssigned > 0 && totalAssigned <= gross + 0.01;

        const toggleOrder = (orderId: number, pendingAmt: number) => {
          const next = new Map(applyAmounts);
          if (next.has(orderId)) {
            next.delete(orderId);
          } else {
            const alreadyAssigned = [...next.values()].reduce((s, v) => s + (parseFloat(v) || 0), 0);
            const rem = gross - alreadyAssigned;
            next.set(orderId, Math.min(pendingAmt, Math.max(0, rem)).toFixed(2));
          }
          setApplyAmounts(next);
        };

        const handleConfirm = () => {
          setApplyPayError(null);
          const movId = applyPayMov.id;
          const links = [...applyAmounts.entries()].map(([pedidoId, monto]) => ({ pedidoId, montoAplicado: parseFloat(monto) }));
          const date = (applyPayMov.date_created ?? new Date().toISOString()).slice(0, 10);
          applyPayMut.mutate(
            { movementId: String(movId), customerId: applyPayMov.entityId!, date, links },
            {
              onSuccess: (result: { paymentId: number; bankLinks: BankPaymentLink[] }) => {
                qc.setQueriesData<MpMovementsResponse>(
                  { queryKey: ["/api/mp/movements"] },
                  (old) => {
                    if (!old?.results) return old;
                    return {
                      ...old,
                      results: old.results.map(m =>
                        String(m.id) === String(movId)
                          ? { ...m, bankPaymentLinks: result.bankLinks }
                          : m
                      ),
                    };
                  }
                );
                setApplyPayOpen(false);
                setApplyPayMov(null);
                setApplyAmounts(new Map());
                setApplyPayError(null);
              },
            }
          );
        };

        return (
          <Dialog open={applyPayOpen} onOpenChange={v => { if (!v) { setApplyPayOpen(false); setApplyPayMov(null); setApplyAmounts(new Map()); } }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Aplicar pago</DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                {/* Info del movimiento */}
                <div className="bg-muted/50 rounded-lg px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm">{applyPayMov.displayName}</p>
                    <p className="text-xs text-muted-foreground">{fmtDateLong((applyPayMov.date_created ?? "").slice(0, 10))}</p>
                  </div>
                  <p className="text-lg font-bold text-green-700">+{fmt(gross)}</p>
                </div>

                {/* Lista de pedidos pendientes */}
                <div>
                  <p className="text-sm font-medium mb-2">Pedidos con saldo pendiente</p>
                  {pendingOrdersLoading ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">Cargando...</p>
                  ) : pendingOrders.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No hay pedidos con saldo pendiente.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                      {pendingOrders.map(order => {
                        const checked = applyAmounts.has(order.id);
                        const pendingAmt = parseFloat(order.pendingAmount);
                        return (
                          <div
                            key={order.id}
                            onClick={() => toggleOrder(order.id, pendingAmt)}
                            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                              checked ? "border-green-400 bg-green-50" : "border-input hover:bg-muted/40"
                            }`}
                          >
                            {/* Checkbox */}
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                              checked ? "border-green-500 bg-green-500" : "border-muted-foreground/40"
                            }`}>
                              {checked && <span className="text-white text-[9px] leading-none">✓</span>}
                            </div>

                            {/* Info del pedido */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {order.remitoNum && (
                                  <span className="text-sm font-medium">Remito {order.remitoNum}</span>
                                )}
                                {order.invoiceNumber && (
                                  <span className="text-xs text-muted-foreground bg-muted rounded px-1 py-0.5">{order.invoiceNumber}</span>
                                )}
                                {!order.remitoNum && !order.invoiceNumber && (
                                  <span className="text-sm text-muted-foreground">Sin remito</span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">{fmtDateLong(order.orderDate)}</p>
                            </div>

                            {/* Monto pendiente — mismo formato, cambia color al seleccionar */}
                            <p className={`text-sm font-semibold flex-shrink-0 ${checked ? "text-green-700" : "text-orange-700"}`}>
                              {fmt(pendingAmt)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Resumen */}
                {applyAmounts.size > 0 && (
                  <div className="border-t pt-3 flex items-center justify-between text-sm">
                    <div className="flex gap-4">
                      <span className="text-muted-foreground">Asignado: <span className="font-semibold text-foreground">{fmt(totalAssigned)}</span></span>
                      <span className={`${remaining < -0.01 ? "text-destructive" : "text-muted-foreground"}`}>
                        Restante: <span className="font-semibold">{fmt(remaining)}</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {applyPayError && (
                <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{applyPayError}</p>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => { setApplyPayOpen(false); setApplyPayMov(null); setApplyAmounts(new Map()); setApplyPayError(null); }}>
                  Cancelar
                </Button>
                <Button onClick={handleConfirm} disabled={!canConfirm || applyPayMut.isPending}>
                  {applyPayMut.isPending ? "Aplicando..." : "Confirmar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
    </Layout>
  );
}
