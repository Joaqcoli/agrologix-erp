import { useState, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertCircle, ChevronDown, Plus, Pencil, ArrowDownLeft, ArrowUpRight, Landmark } from "lucide-react";
import { fmtPesos } from "@/lib/format";

// ─── shared helpers (reusados por la vista de Banco MP + Galicia) ───────────────
// Muestra el valor absoluto; el signo +/- se agrega aparte.
export const fmt = (v: number) => fmtPesos(Math.abs(v));

export function pad(n: number) { return String(n).padStart(2, "0"); }
export function isoDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export function fmtDateLong(iso: string | null | undefined) {
  if (!iso) return "";
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "long" });
}

export function fmtTime(s: string) {
  if (!s) return "";
  const d = new Date(s);
  return d.toLocaleTimeString("es-AR", {
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  }) + " hs";
}

export function getDefaultRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: isoDate(from), to: isoDate(now) };
}

// Convierte una fecha UTC (ISO string) a fecha en Argentina (UTC-3)
export function toArgDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const ar = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const y = ar.getUTCFullYear();
  const m = String(ar.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ar.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const TYPE_LABELS: Record<string, string> = {
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

// ─── shared types ───────────────────────────────────────────────────────────────

export type BankCategory = { id: number; name: string };

export type BankPaymentLink = {
  id: number;
  pedidoId: number | null;
  montoAplicado: string;
  folio: string | null;
  remitoNum: number | null;
  invoiceNumber: string | null;
};

export type MpMovement = {
  id: string | number;
  date_created: string;
  type: string;
  description?: string;
  status: string;
  total?: number;
  amount?: number;
  fee?: { amount?: number };
  categoryId?: number | null;
  categoryName?: string | null;
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
  operation_type?: string | null;
  source?: "xlsx" | "galicia" | string | null;
  // campos propios de Galicia
  comprobante?: string | null;
  yaContabilizado?: boolean;
  asignacionCc?: string | null;
  categoriaAuto?: boolean;
  leyendas?: string | null;
  // asignación de cobros Galicia (cliente sugerido por CUIT)
  suggestedCustomerId?: number | null;
  suggestedCustomerName?: string | null;
  suggestedCuit?: string | null;
  // pago a proveedor pendiente de aplicar a CC
  esPagoProvPend?: boolean;
  yaAplicadoProv?: boolean;
  yaRegistradoProv?: boolean;
  suggestedSupplierId?: number | null;
  suggestedSupplierName?: string | null;
};

export type MpMovementsResponse = { results?: MpMovement[]; error?: string };

// ─── CategoryPicker (desplegable de categorizar — compartido) ────────────────────

export function CategoryPicker({
  movId, categoryId, categoryName, categories, onSelect, onAddNew,
}: {
  movId: string | number;
  categoryId: number | null | undefined;
  categoryName?: string | null;   // fallback si la categoría no está en el catálogo
  categories: BankCategory[];
  onSelect: (movId: string | number, catId: number | null) => void;
  onAddNew: () => void;
}) {
  const current = categories.find(c => c.id === categoryId);
  const label = current?.name ?? categoryName ?? "Categorizar";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <span className={current || categoryName ? "text-foreground font-medium" : ""}>{label}</span>
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

// ─── BankSection: tarjetas + filtros + lista, parametrizado por banco ────────────

export type CardSpec = { label: string; value: number; icon?: ReactNode; color?: string };

export type BankSectionProps = {
  source: "mp" | "galicia";
  title: string;
  titleIcon?: ReactNode;
  headerAction?: ReactNode;               // ej: botón Sincronizar (MP)
  banner?: ReactNode;                     // ej: resultado de sync (MP)
  // datos
  queryKeyBase: string;                   // ej: "/api/mp/movements"
  fetchMovements: (p: { from: string; to: string; status: string }) => Promise<MpMovement[]>;
  errorLabel: string;                     // ej: "Mercado Pago"
  // tarjetas (calculadas en el cliente sobre los movimientos filtrados)
  computeCards: (filtered: MpMovement[]) => CardSpec[];
  extraCardsLeft?: ReactNode;             // ej: tarjeta Saldo disponible (MP)
  // filtros
  showStatusFilter?: boolean;             // MP sí, Galicia no
  categories: BankCategory[];
  onAddCategory: () => void;              // abre diálogo nueva categoría
  onEditCategory: (cat: BankCategory) => void;
  // categorización por movimiento (el guardado real lo maneja el padre)
  onCategorize: (m: MpMovement, catId: number | null) => void;
  onAddNewForMov: (movId: string | number) => void;
  // render de la fila (partes específicas por banco)
  renderName: (m: MpMovement) => ReactNode;     // nombre + (MP: identificar/editar contacto)
  renderRowExtra?: (m: MpMovement) => ReactNode; // MP: Aplicar pago · Galicia: badges
};

export function BankSection(props: BankSectionProps) {
  const { from: defFrom, to: defTo } = getDefaultRange();
  const [from, setFrom] = useState(defFrom);
  const [to, setTo] = useState(defTo);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCatId, setFilterCatId] = useState<number | null>(null);
  const [onlyUncategorized, setOnlyUncategorized] = useState(false);

  const { data, isLoading, error } = useQuery<MpMovementsResponse>({
    queryKey: [props.queryKeyBase, from, to, filterStatus],
    queryFn: () => props.fetchMovements({ from, to, status: filterStatus }).then(results => ({ results })),
    retry: false,
  });

  const movements: MpMovement[] = (data as any)?.results ?? [];
  const errMsg = (data as any)?.error ?? (error as Error)?.message ?? null;

  const filtered = useMemo(() => movements.filter(m => {
    if (props.showStatusFilter && filterStatus !== "all" && m.status !== filterStatus) return false;
    if (filterCatId !== null && m.categoryId !== filterCatId) return false;
    if (onlyUncategorized && m.categoryId != null) return false;
    return true;
  }), [movements, filterStatus, filterCatId, onlyUncategorized, props.showStatusFilter]);

  const cards = props.computeCards(filtered);

  const grouped = useMemo(() => {
    const map = new Map<string, MpMovement[]>();
    for (const m of filtered) {
      const dateKey = toArgDate(m.date_created ?? "");
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(m);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const nCards = (props.extraCardsLeft ? 1 : 0) + cards.length;
  // clases literales para que Tailwind JIT las detecte (no construir dinámicamente)
  const gridColsClass = nCards >= 3 ? "sm:grid-cols-3" : nCards === 2 ? "sm:grid-cols-2" : "sm:grid-cols-1";

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          {props.titleIcon ?? <Landmark className="h-5 w-5" />} {props.title}
        </h2>
        {props.headerAction}
      </div>

      {props.banner}

      {errMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Error en {props.errorLabel}: {errMsg}</span>
        </div>
      )}

      {/* Cards */}
      <div className={`grid gap-4 grid-cols-1 ${gridColsClass}`}>
        {props.extraCardsLeft}
        {cards.map((c, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                {c.icon} {c.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${c.color ?? ""}`}>{isLoading ? "..." : fmt(c.value)}</p>
            </CardContent>
          </Card>
        ))}
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
        {props.showStatusFilter && (
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
        )}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground font-medium">Categoría</label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={`h-8 px-3 text-sm rounded-md border flex items-center gap-1.5 min-w-[9rem] justify-between transition-colors
                ${filterCatId !== null
                  ? "border-foreground/30 bg-muted font-medium text-foreground"
                  : "border-input bg-background text-muted-foreground hover:text-foreground"}`}
              >
                <span className="truncate">
                  {filterCatId !== null ? (props.categories.find(c => c.id === filterCatId)?.name ?? "Categoría") : "Todas"}
                </span>
                <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={() => setFilterCatId(null)} className={filterCatId === null ? "font-semibold" : ""}>
                Todas las categorías
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {props.categories.map(cat => (
                <DropdownMenuItem
                  key={cat.id}
                  onClick={() => setFilterCatId(cat.id)}
                  className={`flex items-center justify-between ${cat.id === filterCatId ? "font-semibold" : ""}`}
                >
                  <span>{cat.name}</span>
                  <button
                    onClick={e => { e.stopPropagation(); props.onEditCategory(cat); }}
                    className="text-muted-foreground/40 hover:text-muted-foreground transition-colors ml-2"
                    title="Editar"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={props.onAddCategory} className="text-blue-600 font-medium">
                <Plus className="h-3.5 w-3.5 mr-1" /> Agregar categoría
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* B3: filtro "sin categorizar" */}
        <button
          onClick={() => setOnlyUncategorized(v => !v)}
          className={`h-8 px-3 text-xs rounded-md border self-end transition-colors
            ${onlyUncategorized
              ? "border-amber-400 bg-amber-50 text-amber-700 font-medium"
              : "border-input bg-background text-muted-foreground hover:text-foreground"}`}
        >
          Sin categorizar
        </button>
        {filterCatId !== null && (
          <button onClick={() => setFilterCatId(null)} className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors self-end">
            × Limpiar
          </button>
        )}
      </div>

      {/* Movements */}
      {isLoading ? (
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
                  const isOutgoing = m.isOutgoing ?? false;
                  const gross = m.grossAmount ?? Math.abs(parseFloat(String(m.total ?? m.amount ?? 0)));
                  const fee = m.feeAmount ?? 0;
                  const net = m.netAmount ?? (isOutgoing ? gross + fee : gross - fee);
                  return (
                    <div key={m.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${isOutgoing ? "bg-red-50" : "bg-green-50"}`}>
                        {isOutgoing ? <ArrowUpRight className="h-5 w-5 text-red-500" /> : <ArrowDownLeft className="h-5 w-5 text-green-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        {props.renderName(m)}
                        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                          <CategoryPicker
                            movId={m.id}
                            categoryId={m.categoryId}
                            categoryName={m.categoryName}
                            categories={props.categories}
                            onSelect={(_id, catId) => props.onCategorize(m, catId)}
                            onAddNew={() => props.onAddNewForMov(m.id)}
                          />
                          {props.renderRowExtra?.(m)}
                        </div>
                      </div>
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
  );
}
