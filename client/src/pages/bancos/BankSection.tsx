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

// ─── Rediseño Bancos (Claude Design) — CSS portado de diseno-caja/bancos-rediseno.html ──
// Clases `brx-` con colores literales. Se inyecta una vez desde index.tsx.
export const BANCOS_CSS = `
.bancos-rx{background:#f4f4f1;min-height:100%;padding:28px 22px 52px;font-family:'Inter',system-ui,sans-serif;color:#1e2420;}
.bancos-rx *{box-sizing:border-box;}
.brx-wrap{max-width:1240px;margin:0 auto;}
.brx-num{font-family:'Bricolage Grotesque','Inter',sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.brx-topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;gap:12px;flex-wrap:wrap;}
.brx-topbar h1{font-family:'Bricolage Grotesque';font-size:26px;font-weight:700;margin:0;letter-spacing:-.02em;}
.brx-btn{background:#fff;border:1px solid #ecece8;color:#1e2420;font-family:'Inter';font-size:13px;font-weight:500;padding:9px 14px;border-radius:10px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;}
.brx-btn:hover{border-color:#d6d6d1;}
.brx-seg{display:inline-flex;background:#ecece6;border-radius:10px;padding:3px;}
.brx-seg button{border:none;background:none;font-family:'Inter';font-size:13px;font-weight:500;color:#8b8f88;padding:6px 16px;border-radius:8px;cursor:pointer;}
.brx-seg button.active{background:#fff;color:#1e2420;box-shadow:0 1px 2px rgba(0,0,0,.07);}
.brx-banks{display:grid;grid-template-columns:1fr 1fr;gap:22px;}
@media(max-width:1000px){.brx-banks{grid-template-columns:1fr;}}
.brx-bank{background:#fff;border:1px solid #ecece8;border-radius:18px;padding:20px 22px;}
.brx-bankhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;gap:12px;}
.brx-logo{height:46px;width:auto;display:block;}
.brx-logo.mp{height:52px;}
.brx-bankaction{background:#fff;border:1px solid #ecece8;color:#1e2420;font-family:'Inter';font-size:12.5px;font-weight:500;padding:8px 13px;border-radius:9px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;}
.brx-bankaction:hover{border-color:#cfcfc9;background:#f8f8f5;}
.brx-bankaction:disabled{opacity:.55;cursor:default;}
.brx-sums2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px;}
.brx-scard{border-radius:13px;padding:14px 16px;}
.brx-scard.acr{background:#eef3e3;}
.brx-scard.deb{background:#f8ede8;}
.brx-scard .lab{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;margin-bottom:7px;display:flex;align-items:center;gap:6px;}
.brx-scard.acr .lab{color:#5f8020;}
.brx-scard.deb .lab{color:#b0553f;}
.brx-scard .amt{font-size:21px;font-weight:700;line-height:1;}
.brx-scard.acr .amt{color:#5f8020;}
.brx-scard.deb .amt{color:#b0553f;}
.brx-filters{display:flex;gap:9px;flex-wrap:wrap;align-items:flex-end;margin-bottom:18px;}
.brx-fld{display:flex;flex-direction:column;gap:4px;}
.brx-fld label{font-size:10.5px;font-weight:600;color:#9a9e96;text-transform:uppercase;letter-spacing:.05em;}
.brx-fld input,.brx-fld select{font-family:'Inter';font-size:12.5px;padding:7px 9px;border:1px solid #ecece8;border-radius:9px;background:#fff;color:#1e2420;height:34px;}
.brx-fld.grow{flex:1;min-width:120px;}
.brx-fld.grow select{width:100%;}
.brx-catbtn{font-family:'Inter';font-size:12.5px;padding:7px 9px;border:1px solid #ecece8;border-radius:9px;background:#fff;color:#1e2420;cursor:pointer;display:flex;align-items:center;gap:6px;justify-content:space-between;min-width:130px;}
.brx-catbtn.on{border-color:#8fae4a;background:#f2f6ea;font-weight:600;}
.brx-catbtn:hover{border-color:#cfcfc9;}
.brx-nocat{align-self:flex-end;background:#fff;border:1px solid #ecece8;color:#8b8f88;font-family:'Inter';font-size:12px;font-weight:500;padding:8px 12px;border-radius:9px;cursor:pointer;}
.brx-nocat:hover{border-color:#cfcfc9;color:#1e2420;}
.brx-nocat.on{border-color:#c08a1e;background:#f9f1de;color:#c08a1e;}
.brx-clear{align-self:flex-end;background:none;border:none;color:#8b8f88;font-size:12px;padding:8px 4px;cursor:pointer;}
.brx-clear:hover{color:#1e2420;}
.brx-daygroup{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#9a9e96;margin:14px 0 2px;}
.brx-mv{display:grid;grid-template-columns:38px 1fr auto;align-items:center;gap:13px;padding:13px 2px;border-top:1px solid #f4f4f1;}
.brx-mv:first-of-type{border-top:none;}
.brx-dir{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
.brx-dir.in{background:#eef3e3;color:#5f8020;}
.brx-dir.out{background:#f8ede8;color:#c05e42;}
.brx-mvmid{min-width:0;}
.brx-mvrow1{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;}
.brx-mvname{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;}
.brx-mvrow2{display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
.brx-ref{font-size:11px;color:#8b8f88;font-variant-numeric:tabular-nums;white-space:nowrap;}
.brx-idraw{font-size:11px;color:#8b8f88;font-family:ui-monospace,monospace;}
.brx-chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:20px;white-space:nowrap;border:none;font-family:'Inter';line-height:1.35;}
.brx-chip.btn{cursor:pointer;}
.brx-chip svg{opacity:.75;}
.brx-c-verde{background:#eef3e3;color:#5f8020;}
.brx-c-coral{background:#f8ede8;color:#b0553f;}
.brx-c-ambar{background:#f9f1de;color:#c08a1e;}
.brx-c-malva{background:#f3ebf0;color:#a86b8a;}
.brx-c-azul{background:#e9eff7;color:#3a67a3;}
.brx-c-gris{background:#eef0ec;color:#6a6f66;}
.brx-c-ok{background:#eef3e3;color:#5f8020;}
.brx-tag{background:#f1f1ec;color:#8b8f88;font-weight:600;font-size:10.5px;padding:2px 8px;border-radius:20px;white-space:nowrap;}
.brx-pen{background:none;border:none;color:#b3b6ae;cursor:pointer;padding:2px;display:inline-flex;border-radius:5px;}
.brx-pen:hover{color:#1e2420;background:#f2f2ef;}
.brx-act{background:#fff;border:1px solid #ecece8;color:#1e2420;font-weight:500;}
.brx-act:hover{border-color:#cfcfc9;background:#f8f8f5;}
.brx-act.ident{color:#3a67a3;border-color:#cfdcee;}
.brx-act.pay{color:#a86b8a;border-color:#e2cfda;}
.brx-act.cobro{color:#5f8020;border-color:#cfe0bf;}
.brx-amtblock{text-align:right;white-space:nowrap;}
.brx-amtline1{display:flex;align-items:baseline;justify-content:flex-end;gap:8px;}
.brx-gross{font-size:12px;color:#8b8f88;}
.brx-net{font-size:15px;font-weight:700;}
.brx-net.pos{color:#5f8020;}
.brx-net.neg{color:#b0553f;}
.brx-amtline2{display:flex;justify-content:flex-end;gap:12px;font-size:11px;margin-top:3px;}
.brx-fee{color:#c05e42;}
.brx-time{color:#8b8f88;}
.brx-empty{padding:26px 4px;text-align:center;color:#8b8f88;font-size:13.5px;}
.brx-banner{margin-bottom:14px;}
`;

// Color del chip de categoría según su nombre (identidad compartida con Caja)
export function chipColorClass(name: string | null | undefined): string {
  const n = (name || "").toLowerCase();
  if ((n.includes("cobro") && n.includes("client")) || n.includes("venta")) return "brx-c-verde";
  if (n.includes("alquiler")) return "brx-c-ambar";
  if (n.includes("retiro") || n.includes("uber") || n.includes("combustible") || n.includes("nafta")
    || n.includes("flete") || n.includes("peaje") || n.includes("mecanic") || n.includes("carga")) return "brx-c-malva";
  if (n.includes("interes") || n.includes("interés") || n.includes("sueldo") || n.includes("honorar")
    || n.includes("contador") || n.includes("monotributo")) return "brx-c-azul";
  // banco propio / proveedor / mercadería / impuestos / default → gris
  return "brx-c-gris";
}

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
  const hasCat = !!(current || categoryName);
  const label = current?.name ?? categoryName ?? "Categorizar";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={hasCat ? `brx-chip btn ${chipColorClass(label)}` : "brx-chip btn brx-act"}>
          {label} <ChevronDown className="h-3 w-3" />
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
  logoSrc: string;                        // logo real del banco (reemplaza ícono + nombre)
  logoTall?: boolean;                     // MP un poco más alto
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
    <section className="brx-bank">
      <div className="brx-bankhead">
        <img className={`brx-logo${props.logoTall ? " mp" : ""}`} src={props.logoSrc} alt={props.title} />
        {props.headerAction}
      </div>

      {props.banner && <div className="brx-banner">{props.banner}</div>}

      {errMsg && (
        <div className="brx-banner flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Error en {props.errorLabel}: {errMsg}</span>
        </div>
      )}

      {/* Cards resumen (verde = entra / coral = sale) */}
      <div className="brx-sums2">
        {cards.map((c, i) => {
          const isAcr = (c.color ?? "").includes("green");
          return (
            <div key={i} className={`brx-scard ${isAcr ? "acr" : "deb"}`}>
              <div className="lab">{c.label}</div>
              <div className="amt brx-num">{isLoading ? "…" : fmt(c.value)}</div>
            </div>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="brx-filters">
        <div className="brx-fld">
          <label>Desde</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="brx-fld">
          <label>Hasta</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        {props.showStatusFilter && (
          <div className="brx-fld grow">
            <label>Estado</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="all">Todos</option>
              <option value="approved">Aprobado</option>
              <option value="pending">Pendiente</option>
            </select>
          </div>
        )}
        <div className="brx-fld grow">
          <label>Categoría</label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={`brx-catbtn${filterCatId !== null ? " on" : ""}`}>
                <span className="truncate">
                  {filterCatId !== null ? (props.categories.find(c => c.id === filterCatId)?.name ?? "Categoría") : "Todas"}
                </span>
                <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" style={{ opacity: 0.6 }} />
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
        <button onClick={() => setOnlyUncategorized(v => !v)} className={`brx-nocat${onlyUncategorized ? " on" : ""}`}>
          Sin categorizar
        </button>
        {filterCatId !== null && (
          <button onClick={() => setFilterCatId(null)} className="brx-clear">× Limpiar</button>
        )}
      </div>

      {/* Feed */}
      {isLoading ? (
        <div className="brx-empty">Cargando movimientos…</div>
      ) : grouped.length === 0 ? (
        <div className="brx-empty">Sin movimientos para los filtros seleccionados.</div>
      ) : (
        <div>
          {grouped.map(([dateKey, movs]) => (
            <div key={dateKey}>
              <div className="brx-daygroup">{fmtDateLong(dateKey)}</div>
              {movs.map(m => {
                const isOutgoing = m.isOutgoing ?? false;
                const gross = m.grossAmount ?? Math.abs(parseFloat(String(m.total ?? m.amount ?? 0)));
                const fee = m.feeAmount ?? 0;
                const net = m.netAmount ?? (isOutgoing ? gross + fee : gross - fee);
                return (
                  <div key={m.id} className="brx-mv">
                    <span className={`brx-dir ${isOutgoing ? "out" : "in"}`}>
                      {isOutgoing ? <ArrowUpRight className="h-[17px] w-[17px]" /> : <ArrowDownLeft className="h-[17px] w-[17px]" />}
                    </span>
                    <div className="brx-mvmid">
                      <div className="brx-mvrow1">{props.renderName(m)}</div>
                      <div className="brx-mvrow2">
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
                    <div className="brx-amtblock">
                      <div className="brx-amtline1">
                        {fee > 0 && <span className="brx-gross brx-num">{fmt(gross)}</span>}
                        <span className={`brx-net brx-num ${isOutgoing ? "neg" : "pos"}`}>{isOutgoing ? "-" : "+"}{fmt(net)}</span>
                      </div>
                      <div className="brx-amtline2">
                        {fee > 0 && <span className="brx-fee brx-num">comisión {fmt(fee)}</span>}
                        <span className="brx-time">{fmtTime(m.date_created)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
