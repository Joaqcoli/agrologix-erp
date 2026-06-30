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
import ChequesFlow from "./ChequesFlow";
import {
  TrendingUp, TrendingDown, DollarSign, Plus, Trash2,
  ChevronLeft, ChevronRight, Wallet, Building2, CreditCard,
  Landmark, Pencil, AlertCircle, CheckCircle2, Clock,
  ChevronDown, ChevronUp, Users,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

import { fmtPesos } from "@/lib/format";
const fmt = fmtPesos;

// Normaliza variaciones de nombres de categoría al mismo label canónico
function normalizeCategory(cat: string): string {
  const lower = cat.toLowerCase().trim();
  if (lower.includes("pago") && lower.includes("proveedor")) return "Pagos proveedores";
  if (lower.includes("cobro") && lower.includes("client")) return "Cobros clientes";
  return cat;
}
// B6 — FALLBACK por texto: solo se usa para categorías que NO tienen fila en bank_categories.
// La fuente de verdad ahora es bank_categories.afecta_egresos (el backfill replicó esta misma
// lista, así que el resultado es idéntico). Categorías excluidas del gráfico de egresos:
//  - proveedor / mercadería (ya en el costo de la bruta)
//  - "banco propio": pase entre cuentas propias (interno)
//  - "retiro": del dueño/socio y "retiro de efectivo" (interno Galicia→Efectivo)
//  - "cheque rechazado": cheque que se acreditó y rebotó (neto $0)
const EXCLUDE_FROM_PIE_TEXT = (cat: string) => {
  const l = cat.toLowerCase();
  return l.includes("proveedor") || l.includes("mercader") || l.includes("banco propio")
    || l.includes("retiro") || l.includes("cheque rechazado");
};
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

type BankCategory = { id: number; name: string; afectaEgresos?: boolean };

type CuentaFinanciera = {
  id: number;
  nombre: string;
  tipo: string;
  saldo_base: number;
  saldo_base_fecha: string | null;
  orden: number;
  ajuste: number;
};

const CUENTA_ICONS: Record<string, React.ReactNode> = {
  mp:       <Landmark  className="h-4 w-4 text-sky-600" />,
  banco:    <Building2 className="h-4 w-4 text-blue-600" />,
  efectivo: <Wallet    className="h-4 w-4 text-green-600" />,
  cheque:   <CreditCard className="h-4 w-4 text-purple-600" />,
};

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
  cuentaId: number | null;
  socioId: number | null;
};

const emptyForm = (): MovForm => ({
  date: new Date().toISOString().slice(0, 10),
  type: "egreso",
  description: "",
  amount: "",
  category: "",
  method: "",
  cuentaId: null,
  socioId: null,
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

type Cheque = {
  id: number;
  tipo: "recibido" | "emitido";
  numero: string | null;
  monto: number;
  fecha_cobro: string;
  estado: "en_cartera" | "depositado" | "endosado" | "cobrado";
  contraparte: string;
  cuenta_destino_id: number | null;
  comision: number;
  obligacion_id: number | null;
  notas: string | null;
};

type Obligacion = {
  id: number;
  concepto: string;
  tipo: string;
  monto: number;
  moneda: string; // "ARS" | "USD"
  pago_parcial: boolean;
  fecha_vencimiento: string;
  estado: "pendiente" | "pagado";
  grupo_cuota: string | null;
  numero_cuota: number | null;
  total_cuotas: number | null;
  notas: string | null;
  pagado_at: string | null;
  cuenta_pago_id: number | null;
};

const TIPO_BADGE: Record<string, string> = {
  proveedor: "bg-orange-100 text-orange-800",
  impuesto:  "bg-red-100 text-red-800",
  cuota:     "bg-blue-100 text-blue-800",
  servicio:  "bg-sky-100 text-sky-800",
  sueldo:    "bg-purple-100 text-purple-800",
  alquiler:  "bg-yellow-100 text-yellow-800",
  otro:      "bg-gray-100 text-gray-700",
};

const BASE_TIPOS = ["proveedor","impuesto","alquiler","cuota","servicio","sueldo","otro"];

// Etiqueta de la cuota: usa numero_cuota/total_cuotas (fuente de verdad) en vez del
// texto fijo grabado en concepto (que puede tener el número mal si se cargó a mano).
function oblLabel(ob: Obligacion): string {
  if (ob.numero_cuota != null && ob.total_cuotas != null && ob.total_cuotas > 1) {
    const base = ob.concepto.replace(/\s*\d+\s*de\s*\d+\s*$/i, "").trim();
    return `${base.length > 0 ? base : ob.concepto} ${ob.numero_cuota} de ${ob.total_cuotas}`;
  }
  return ob.concepto;
}

function oblSemaforoClass(fechaVenc: string): "vencido" | "semana" | "futuro" {
  const today = new Date(); today.setHours(0,0,0,0);
  const venc = new Date(fechaVenc + "T00:00:00");
  const diff = Math.ceil((venc.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "vencido";
  if (diff <= 7) return "semana";
  return "futuro";
}

type OblForm = {
  concepto: string; tipo: string; moneda: "ARS" | "USD"; monto: string;
  fechaVencimiento: string; notas: string; cuotas: string; cuotaInicial: string; mensual: boolean;
};
const emptyOblForm = (): OblForm => ({
  concepto: "", tipo: "otro", moneda: "ARS", monto: "",
  fechaVencimiento: new Date().toISOString().slice(0, 10),
  notas: "", cuotas: "1", cuotaInicial: "1", mensual: false,
});

type EditOblForm = {
  concepto: string; tipo: string; moneda: "ARS" | "USD"; monto: string;
  fechaVencimiento: string; notas: string; pagoParcial: boolean;
};

export default function CajaPage() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("month");
  const [monthOffset, setMonthOffset] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<MovForm>(emptyForm());
  const [editCuentaOpen, setEditCuentaOpen] = useState(false);
  const [editCuenta, setEditCuenta] = useState<CuentaFinanciera | null>(null);
  const [editSaldo, setEditSaldo] = useState("");

  // Retiros
  const [retiroDialogOpen, setRetiroDialogOpen] = useState(false);
  const [retiroForm, setRetiroForm] = useState({ socioId: "", monto: "", fecha: new Date().toISOString().slice(0,10), notas: "" });
  const [socioDetailId, setSocioDetailId] = useState<number | null>(null);

  // Acordeón categorías
  const [expandedCat, setExpandedCat] = useState<string | null>(null);

  // Cheques
  const [depositarChequeOpen, setDepositarChequeOpen] = useState(false);
  const [endosarChequeOpen, setEndosarChequeOpen] = useState(false);
  const [activeCheque, setActiveCheque] = useState<Cheque | null>(null);
  const [chequeComision, setChequeComision] = useState("");
  const [chequeEndosarA, setChequeEndosarA] = useState("");
  const [chequeCuentaDestinoId, setChequeCuentaDestinoId] = useState<number | null>(null);
  // Editar / agregar cheque en cartera
  const [editChequeOpen, setEditChequeOpen] = useState(false);
  const [addChequeOpen, setAddChequeOpen] = useState(false);
  const [chequeForm, setChequeForm] = useState({ monto: "", fechaCobro: "", contraparte: "", numero: "" });

  // Obligaciones
  const [oblDialogOpen, setOblDialogOpen] = useState(false);
  const [oblForm, setOblForm] = useState<OblForm>(emptyOblForm());
  const [oblTipoCustom, setOblTipoCustom] = useState(false); // show custom input in add form
  const [pagarOblOpen, setPagarOblOpen] = useState(false);
  const [pagarObl, setPagarObl] = useState<Obligacion | null>(null);
  const [pagarCuentaId, setPagarCuentaId] = useState<number | null>(null);
  const [pagarMonto, setPagarMonto] = useState<string>("");      // en moneda de la obligación
  const [pagarMontoARS, setPagarMontoARS] = useState<string>(""); // solo para USD: equiv ARS
  const [pagarCotizacion, setPagarCotizacion] = useState<string>("");
  // Edit
  const [editOblOpen, setEditOblOpen] = useState(false);
  const [editObl, setEditObl] = useState<Obligacion | null>(null);
  const [editForm, setEditForm] = useState<EditOblForm>({ concepto: "", tipo: "", moneda: "ARS", monto: "", fechaVencimiento: "", notas: "", pagoParcial: false });
  const [editTipoCustom, setEditTipoCustom] = useState(false);
  const [propagateDialogOpen, setPropagateDialogOpen] = useState(false);
  const [propagatePendingData, setPropagatePendingData] = useState<{ id: number; form: EditOblForm } | null>(null);

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

  const { data: cuentas } = useQuery<CuentaFinanciera[]>({
    queryKey: ["/api/caja/cuentas"],
    queryFn: () => fetch("/api/caja/cuentas", { credentials: "include" }).then(r => r.json()),
  });

  const todayIso = new Date().toISOString().slice(0, 10);

  // MercadoPago: el saldo = saldo_base + ajuste + mpDelta, donde mpDelta = movimientos
  // de la API (/api/mp/movements, /v1/payments/search — la fuente que SÍ responde; el
  // /v1/account/balance NO responde para esta credencial, ver AUDITORIA-CAJA.md).
  // RANGO ACOTADO: el fetch arranca en max(saldo_base_fecha, hoy−60d). Mientras el
  // usuario recargue el saldo_base cada ≤60 días, from = saldo_base_fecha → cuenta TODOS
  // los movimientos posteriores al corte (exacto, no deja afuera ninguno). El tope de 60
  // días es solo una salvaguarda de performance si el saldo quedara viejo (evita repaginar
  // meses). Si el saldo está a >45 días, se avisa para recargar (mpStale).
  const mpCuenta = cuentas?.find(c => c.tipo === "mp");
  const mpBaseFechaRaw = mpCuenta?.saldo_base_fecha ?? null;
  const RANGO_DIAS = 60;
  const mpFrom = useMemo(() => {
    const cap = new Date(Date.now() - RANGO_DIAS * 86400000);            // hoy − 60 días
    const baseF = mpBaseFechaRaw ? new Date(mpBaseFechaRaw) : null;
    const from = baseF && baseF > cap ? baseF : cap;                     // max(saldo_base_fecha, hoy−60d)
    return from.toISOString().slice(0, 10);
  }, [mpBaseFechaRaw]);
  // Antigüedad del saldo_base (para avisar de recargar antes de que el tope subcuente)
  const mpDiasDesdeBase = mpBaseFechaRaw
    ? Math.floor((Date.now() - new Date(mpBaseFechaRaw).getTime()) / 86400000) : null;
  const mpStale = mpDiasDesdeBase != null && mpDiasDesdeBase > 45;

  const { data: mpMovData, isError: mpMovError } = useQuery<{ results?: any[] }>({
    queryKey: ["/api/mp/movements/cuentas", mpFrom, todayIso],
    queryFn: () => fetch(`/api/mp/movements?from=${mpFrom}&to=${todayIso}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!mpBaseFechaRaw,
    retry: false,
    staleTime: 3 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
  const mpDelta = useMemo(() => {
    if (!Array.isArray(mpMovData?.results)) return 0;
    let delta = 0;
    for (const m of mpMovData!.results!) {
      const net = m.netAmount ?? 0;
      if (m.isOutgoing) delta -= net; else delta += net;
    }
    return delta;
  }, [mpMovData]);
  // ¿la fuente de movimientos respondió? (para el fallback)
  const mpLive = !mpMovError && Array.isArray(mpMovData?.results);

  function getSaldoActual(c: CuentaFinanciera): number {
    const base = parseFloat(String(c.saldo_base ?? 0));
    const ajuste = c.ajuste ?? 0;
    if (c.tipo === "mp") {
      // Fuente principal: saldo_base + ajuste + mpDelta (movimientos de la API, rango acotado).
      // Fallback robusto: si la API de movimientos fallara, usar saldo_base + ajuste (último
      // conocido, sin el delta) → número razonable, NO rompe el disponible. Cuando la API
      // vuelve, suma el delta de nuevo.
      return mpLive ? base + ajuste + mpDelta : base + ajuste;
    }
    if (c.tipo === "cheque") return chequesEnCartera.reduce((s, ch) => s + ch.monto, 0);
    return base + ajuste;
  }

  const updateCuentaMut = useMutation({
    mutationFn: (vars: { id: number; saldo_base: number }) =>
      apiRequest("PUT", `/api/caja/cuentas/${vars.id}`, { saldo_base: vars.saldo_base }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/cuentas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mp/movements/cuentas"] });
      setEditCuentaOpen(false);
    },
  });

  const addMutation = useMutation({
    mutationFn: (body: MovForm) => apiRequest("POST", "/api/caja/movements", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/cuentas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/retiros"] });
      setDialogOpen(false);
      setForm(emptyForm());
    },
    onError: (e: any) => toast({ title: "No se pudo guardar el movimiento", description: e?.message ?? "Error", variant: "destructive" }),
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/caja/movements/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/cuentas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/retiros"] });
    },
  });

  const handleAdd = () => {
    if (!form.amount || !form.date || !form.method) return;
    // La categoría es suficiente: si no hay descripción, se usa la categoría. Pero algo tiene que identificarlo.
    if (!form.description.trim() && !form.category) return;
    // Categoría Retiro requiere socio asignado, así el monto siempre suma en la card del socio
    if (form.category === "Retiro" && form.socioId == null) return;
    const description = form.description.trim() || form.category;
    addMutation.mutate({ ...form, description });
  };

  // ── Retiros queries & mutations ───────────────────────────────────────────────
  const { data: socios } = useQuery<any[]>({
    queryKey: ["/api/caja/socios"],
    queryFn: () => fetch("/api/caja/socios", { credentials: "include" }).then(r => r.json()),
  });

  const { data: retiros } = useQuery<any[]>({
    queryKey: ["/api/caja/retiros"],
    queryFn: () => fetch("/api/caja/retiros", { credentials: "include" }).then(r => r.json()),
  });

  const addRetiroMut = useMutation({
    mutationFn: (body: typeof retiroForm) => apiRequest("POST", "/api/caja/retiros", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/retiros"] });
      setRetiroDialogOpen(false);
      setRetiroForm({ socioId: "", monto: "", fecha: new Date().toISOString().slice(0,10), notas: "" });
    },
  });

  const delRetiroMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/caja/retiros/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/caja/retiros"] }),
  });

  const retirosPeriodo = useMemo(() =>
    (retiros ?? []).filter((r: any) => r.fecha >= from && r.fecha <= to),
  [retiros, from, to]);

  const retirosBySocio = useMemo(() => {
    const map: Record<number, number> = {};
    for (const r of retirosPeriodo) map[r.socio_id] = (map[r.socio_id] ?? 0) + r.monto;
    return map;
  }, [retirosPeriodo]);

  const retirosTotalPeriodo = Object.values(retirosBySocio).reduce((s, v) => s + v, 0);

  const retirosMensuales = useMemo(() => {
    const map: Record<number, Record<string, number>> = {};
    for (const r of (retiros ?? [])) {
      const mes = (r.fecha as string).slice(0, 7);
      if (!map[r.socio_id]) map[r.socio_id] = {};
      map[r.socio_id][mes] = (map[r.socio_id][mes] ?? 0) + r.monto;
    }
    return map;
  }, [retiros]);

  // ── Cheques queries & mutations ───────────────────────────────────────────────
  const { data: cheques } = useQuery<Cheque[]>({
    queryKey: ["/api/caja/cheques"],
    queryFn: () => fetch("/api/caja/cheques", { credentials: "include" }).then(r => r.json()),
  });

  const chequesEnCartera = useMemo(() =>
    (cheques ?? []).filter(c => c.tipo === "recibido" && c.estado === "en_cartera"),
  [cheques]);

  // Cheques emitidos en circulación (tipo=emitido, en_cartera) — lee en vivo; baja solo al marcar cobrado
  const chequesEmitidosTotal = useMemo(() =>
    (cheques ?? []).filter(c => c.tipo === "emitido" && c.estado === "en_cartera").reduce((s, c) => s + c.monto, 0),
  [cheques]);
  const chequesEnCarteraTotal = useMemo(() => chequesEnCartera.reduce((s, c) => s + c.monto, 0), [chequesEnCartera]);

  // Deudas (all-time) + Ganancia neta del MES COMPLETO (mismo cálculo del Dashboard)
  const monthStart = todayIso.slice(0, 8) + "01";
  const monthEndExcl = (() => { const d = new Date(todayIso + "T00:00:00"); return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 10); })();
  const { data: deudaStats } = useQuery<{
    deudaClientes: number; deudaProveedores: number;
    ganancia_real: number; ganancia_neta: number; egresosOperativos: number;
    cantidadMovimientosEgresos: number; fechaCoberturaEgresos: string | null;
  }>({
    queryKey: ["/api/dashboard/stats", monthStart, monthEndExcl],
    queryFn: () => fetch(`/api/dashboard/stats?from=${monthStart}&to=${monthEndExcl}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });

  const depositarMut = useMutation({
    mutationFn: ({ id, comision, cuentaDestinoId }: { id: number; comision: number; cuentaDestinoId: number | null }) =>
      apiRequest("PATCH", `/api/caja/cheques/${id}`, { accion: "depositar", comision, cuentaDestinoId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/cheques"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/cuentas"] });
      setDepositarChequeOpen(false); setActiveCheque(null); setChequeComision(""); setChequeCuentaDestinoId(null);
    },
  });

  const endosarMut = useMutation({
    mutationFn: ({ id, contraparte }: { id: number; contraparte: string }) =>
      apiRequest("PATCH", `/api/caja/cheques/${id}`, { accion: "endosar", contraparte }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/cheques"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/cuentas"] });
      setEndosarChequeOpen(false); setActiveCheque(null); setChequeEndosarA("");
    },
  });

  const invalidateCheques = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/caja/cheques"] });
    queryClient.invalidateQueries({ queryKey: ["/api/caja/cuentas"] });
  };

  const editChequeMut = useMutation({
    mutationFn: ({ id, monto, fechaCobro, contraparte, numero }: { id: number; monto: number; fechaCobro: string; contraparte: string; numero?: string }) =>
      apiRequest("PATCH", `/api/caja/cheques/${id}`, { accion: "editar", monto, fechaCobro, contraparte, numero }),
    onSuccess: () => { invalidateCheques(); setEditChequeOpen(false); setActiveCheque(null); },
    onError: (e: any) => toast({ title: "Error al editar", description: e.message, variant: "destructive" }),
  });

  const addChequeMut = useMutation({
    mutationFn: (body: { monto: number; fechaCobro: string; contraparte: string; numero?: string }) =>
      apiRequest("POST", `/api/caja/cheques`, body),
    onSuccess: () => { invalidateCheques(); setAddChequeOpen(false); setChequeForm({ monto: "", fechaCobro: "", contraparte: "", numero: "" }); },
    onError: (e: any) => toast({ title: "Error al agregar", description: e.message, variant: "destructive" }),
  });

  const deleteChequeMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/caja/cheques/${id}`),
    onSuccess: () => invalidateCheques(),
    onError: (e: any) => toast({ title: "Error al eliminar", description: e.message, variant: "destructive" }),
  });

  // ── Obligaciones queries & mutations ─────────────────────────────────────────
  const { data: obligaciones } = useQuery<Obligacion[]>({
    queryKey: ["/api/caja/obligaciones"],
    queryFn: () => fetch("/api/caja/obligaciones", { credentials: "include" }).then(r => r.json()),
  });

  // Historial de pagos de la obligación que se está pagando (para mostrarlo en el diálogo)
  const { data: oblPagos } = useQuery<any[]>({
    queryKey: ["/api/caja/obligaciones", pagarObl?.id, "pagos"],
    queryFn: () => fetch(`/api/caja/obligaciones/${pagarObl!.id}/pagos`, { credentials: "include" }).then(r => r.json()),
    enabled: pagarOblOpen && !!pagarObl,
  });

  const addOblMutation = useMutation({
    mutationFn: (body: OblForm) => apiRequest("POST", "/api/caja/obligaciones", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/obligaciones"] });
      setOblDialogOpen(false);
      setOblForm(emptyOblForm());
      setOblTipoCustom(false);
    },
  });

  const pagarOblMutation = useMutation({
    mutationFn: ({ id, cuentaPagoId, montoPagado, cotizacion }: { id: number; cuentaPagoId: number | null; montoPagado: number; cotizacion?: number }) =>
      apiRequest("PATCH", `/api/caja/obligaciones/${id}`, { cuentaPagoId, montoPagado, cotizacion }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/obligaciones"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/cuentas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/summary", from, to] });
      setPagarOblOpen(false);
      setPagarObl(null);
      setPagarCuentaId(null);
      setPagarMonto("");
      setPagarMontoARS("");
      setPagarCotizacion("");
    },
  });

  const editOblMutation = useMutation({
    mutationFn: ({ id, form, propagate }: { id: number; form: EditOblForm; propagate: boolean }) =>
      apiRequest("PUT", `/api/caja/obligaciones/${id}`, { ...form, monto: parseFloat(form.monto), propagate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/obligaciones"] });
      setEditOblOpen(false);
      setEditObl(null);
      setPropagateDialogOpen(false);
      setPropagatePendingData(null);
    },
  });

  const delOblMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/caja/obligaciones/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/obligaciones"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/cuentas"] });
    },
  });

  // All unique tipos from DB + base list (for dropdown)
  const allTipos = useMemo(() => {
    const fromDb = (obligaciones ?? []).map((o: Obligacion) => o.tipo).filter(t => !BASE_TIPOS.includes(t));
    return [...BASE_TIPOS, ...Array.from(new Set(fromDb))];
  }, [obligaciones]);

  const oblPendientes = useMemo(() => (obligaciones ?? []).filter((o: Obligacion) => o.estado === "pendiente"), [obligaciones]);

  const today = new Date(); today.setHours(0,0,0,0);
  const endOfWeek = new Date(today); endOfWeek.setDate(today.getDate() + 7);
  const next30 = new Date(today); next30.setDate(today.getDate() + 30);

  // List: all pending that are overdue OR due within the next 30 days
  const oblVisible = useMemo(() => {
    return (oblPendientes as Obligacion[]).filter(ob => {
      const venc = new Date(ob.fecha_vencimiento + "T00:00:00");
      return venc <= next30; // includes past (vencidas) + next 30 days
    });
  }, [oblPendientes]);

  const oblVencido = oblPendientes.filter((o: Obligacion) => oblSemaforoClass(o.fecha_vencimiento) === "vencido");
  const oblSemana  = oblPendientes.filter((o: Obligacion) => oblSemaforoClass(o.fecha_vencimiento) === "semana");
  const oblFuturo  = oblPendientes.filter((o: Obligacion) => {
    const venc = new Date(o.fecha_vencimiento + "T00:00:00");
    return venc > endOfWeek && venc <= next30;
  });

  // Totals split by currency
  const sumByCurrency = (arr: Obligacion[]) => ({
    ars: arr.filter(o => (o.moneda ?? "ARS") === "ARS").reduce((s, o) => s + o.monto, 0),
    usd: arr.filter(o => (o.moneda ?? "ARS") === "USD").reduce((s, o) => s + o.monto, 0),
  });
  const totVencido = sumByCurrency(oblVencido);
  const totSemana  = sumByCurrency(oblSemana);
  const totFuturo  = sumByCurrency(oblFuturo);

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

  // Pie: egresos by category for the selected period
  // B6: mapa nombre(lower) → afecta_egresos (fuente de verdad). Excluida si afecta_egresos=false;
  // si la categoría no está en el catálogo, fallback al texto (mantiene el comportamiento anterior).
  const afectaEgresosMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const c of (bankCats ?? [])) m.set(c.name.toLowerCase(), c.afectaEgresos !== false);
    return m;
  }, [bankCats]);

  const isExcludedFromPie = (cat: string) => {
    const flag = afectaEgresosMap.get((cat ?? "").toLowerCase());
    if (flag === undefined) return EXCLUDE_FROM_PIE_TEXT(cat); // sin fila en catálogo → texto
    return flag === false;                                     // afecta_egresos=false → excluida
  };

  const pieData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of feed) {
      if (item.type !== "egreso") continue;
      if (isExcludedFromPie(item.category)) continue; // excluida si afecta_egresos=false (o fallback texto)
      map[item.category] = (map[item.category] ?? 0) + item.amount;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [feed, afectaEgresosMap]);

  // Accordion: egresos agrupados por categoría del período
  const categoriaData = useMemo(() => {
    const map: Record<string, { total: number; items: FeedItem[] }> = {};
    for (const item of feed) {
      if (item.type !== "egreso") continue;
      if (!map[item.category]) map[item.category] = { total: 0, items: [] };
      map[item.category].total += item.amount;
      map[item.category].items.push(item);
    }
    return Object.entries(map)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([cat, d]) => ({ cat, total: d.total, items: d.items.sort((a, b) => b.date.localeCompare(a.date)) }));
  }, [feed]);

  const bankCatNames = (bankCats ?? []).map(c => c.name);

  return (
    <Layout>
      <div className="p-6 space-y-6">
        {/* ── Ganancia neta del mes (simple — Caja se rediseña después) ─────── */}
        {deudaStats && (
          <section className="rounded-xl border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Ganancia neta del mes</p>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <span>Ganancia real <b className="tabular-nums">{fmt(deudaStats.ganancia_real ?? 0)}</b></span>
              <span className="text-muted-foreground">−</span>
              <span>Egresos operativos <b className="tabular-nums">{fmt(deudaStats.egresosOperativos ?? 0)}</b>
                <span className="text-muted-foreground"> ({deudaStats.cantidadMovimientosEgresos ?? 0} movs)</span></span>
              <span className="text-muted-foreground">=</span>
              <span className="text-green-700 dark:text-green-400">Neta <b className="tabular-nums text-base">{fmt(deudaStats.ganancia_neta ?? 0)}</b></span>
            </div>
            {deudaStats.fechaCoberturaEgresos && (
              <p className="text-[11px] text-amber-700 dark:text-amber-500 mt-2">
                ⏱ Gastos cargados hasta el {(() => { const p = deudaStats.fechaCoberturaEgresos!.split("-"); return `${p[2]}/${p[1]}`; })()} · la neta puede no incluir gastos posteriores
              </p>
            )}
          </section>
        )}

        {/* ── Posición financiera ─────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-base font-semibold">¿Dónde está mi plata hoy?</h2>

          {/* ── Grupo 1: Lo que tengo (plata líquida) ───────────────────── */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lo que tengo</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {(cuentas ?? []).filter(c => c.tipo !== "cheque").map(cuenta => {
                const saldo = getSaldoActual(cuenta);
                return (
                  <Card
                    key={cuenta.id}
                    className="cursor-pointer hover:border-primary/40 transition-colors"
                    onClick={() => { setEditCuenta(cuenta); setEditSaldo(String(cuenta.saldo_base ?? 0)); setEditCuentaOpen(true); }}
                  >
                    <CardContent className="pt-4 pb-3 px-4">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        {CUENTA_ICONS[cuenta.tipo]}
                        <span className="text-xs font-medium text-muted-foreground truncate flex-1">{cuenta.nombre}</span>
                        <Pencil className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
                      </div>
                      <p className={`text-xl font-bold ${saldo >= 0 ? "text-foreground" : "text-red-600"}`}>{fmt(saldo)}</p>
                      {cuenta.tipo === "mp" ? (
                        // MP = saldo_base + movimientos de la API (rango acotado a 60 días).
                        !mpLive ? (
                          <p className="text-[10px] text-amber-600 mt-0.5">⚠ MP no disponible — último saldo conocido</p>
                        ) : mpStale ? (
                          <p className="text-[10px] text-amber-600 mt-0.5">↻ recargá el saldo de MP (base de hace {mpDiasDesdeBase} días)</p>
                        ) : (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {cuenta.saldo_base_fecha && <>base {new Date(cuenta.saldo_base_fecha).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}</>}
                            {mpDelta !== 0 && (
                              <span className={mpDelta > 0 ? " text-green-600" : " text-red-600"}>
                                {" "}{mpDelta > 0 ? "+" : ""}{fmt(mpDelta)}
                              </span>
                            )}
                          </p>
                        )
                      ) : (
                        cuenta.saldo_base_fecha && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            base {new Date(cuenta.saldo_base_fecha).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                          </p>
                        )
                      )}
                    </CardContent>
                  </Card>
                );
              })}
              {/* Disponible total — SOLO plata líquida (MP + Galicia + Efectivo), sin cheques */}
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <DollarSign className="h-4 w-4 text-primary" />
                    <span className="text-xs font-semibold text-primary">Disponible total</span>
                  </div>
                  <p className="text-xl font-bold text-primary">
                    {cuentas ? fmt(cuentas.filter(c => c.tipo !== "cheque").reduce((s, c) => s + getSaldoActual(c), 0)) : "…"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">solo plata líquida</p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ── Grupo 2: Por cobrar (cada card su número, sin sumar entre sí) ── */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por cobrar</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <CreditCard className="h-4 w-4 text-purple-600" />
                    <span className="text-xs font-medium text-muted-foreground truncate flex-1">Cheques en cartera</span>
                  </div>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">{fmt(chequesEnCarteraTotal)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{chequesEnCartera.length} recibido{chequesEnCartera.length !== 1 ? "s" : ""} por cobrar</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Users className="h-4 w-4 text-green-600" />
                    <span className="text-xs font-medium text-muted-foreground truncate flex-1">Deuda de clientes</span>
                  </div>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">{deudaStats ? fmt(deudaStats.deudaClientes) : "…"}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">a cobrar de clientes activos</p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ── Grupo 3: Por pagar (cada card su número, sin sumar entre sí) ── */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por pagar</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <CreditCard className="h-4 w-4 text-purple-600" />
                    <span className="text-xs font-medium text-muted-foreground truncate flex-1">Cheques emitidos</span>
                  </div>
                  <p className="text-xl font-bold text-red-600 dark:text-red-400">{fmt(chequesEmitidosTotal)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">comprometido, aún no salió de Galicia</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Building2 className="h-4 w-4 text-red-600" />
                    <span className="text-xs font-medium text-muted-foreground truncate flex-1">Deuda a proveedores</span>
                  </div>
                  <p className="text-xl font-bold text-red-600 dark:text-red-400">{deudaStats ? fmt(deudaStats.deudaProveedores) : "…"}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">compras pendientes de pago</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* ── Edit saldo base ──────────────────────────────────────────────── */}
        <Dialog open={editCuentaOpen} onOpenChange={setEditCuentaOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Ajustar saldo — {editCuenta?.nombre}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Label>Saldo actual</Label>
              <Input
                type="number"
                value={editSaldo}
                onChange={e => setEditSaldo(e.target.value)}
                placeholder="0"
                autoFocus
              />
              {editCuenta?.tipo === "mp" && (
                <p className="text-xs text-muted-foreground">
                  Ingresá el saldo exacto de MP de <b>ahora</b> (o el cierre de ayer). A partir de esta fecha el sistema le suma automáticamente los movimientos de MP. Recargalo aprox. una vez por mes para mantenerlo preciso.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditCuentaOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => {
                  if (!editCuenta) return;
                  updateCuentaMut.mutate({ id: editCuenta.id, saldo_base: parseFloat(editSaldo) || 0 });
                }}
                disabled={updateCuentaMut.isPending}
              >
                Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Próximos pagos y vencimientos ─────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-base font-semibold">Próximos pagos y vencimientos</h2>
            <Button size="sm" variant="outline" onClick={() => { setOblForm(emptyOblForm()); setOblDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Agregar obligación
            </Button>
          </div>

          {/* Resumen */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="border-red-200 bg-red-50/40">
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <span className="text-xs font-medium text-red-700">Vencido</span>
                  {oblVencido.length > 0 && <Badge className="ml-auto bg-red-600 text-white text-[10px] h-4 px-1">{oblVencido.length}</Badge>}
                </div>
                {totVencido.ars > 0 && <p className="text-xl font-bold text-red-700">{fmt(totVencido.ars)}</p>}
                {totVencido.usd > 0 && <p className={`font-bold text-red-700 ${totVencido.ars > 0 ? "text-sm" : "text-xl"}`}>USD {totVencido.usd.toLocaleString("es-AR", { minimumFractionDigits: 0 })}</p>}
                {totVencido.ars === 0 && totVencido.usd === 0 && <p className="text-xl font-bold text-red-700">$0</p>}
              </CardContent>
            </Card>
            <Card className="border-yellow-200 bg-yellow-50/40">
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-4 w-4 text-yellow-600" />
                  <span className="text-xs font-medium text-yellow-700">Esta semana</span>
                  {oblSemana.length > 0 && <Badge className="ml-auto bg-yellow-500 text-white text-[10px] h-4 px-1">{oblSemana.length}</Badge>}
                </div>
                {totSemana.ars > 0 && <p className="text-xl font-bold text-yellow-700">{fmt(totSemana.ars)}</p>}
                {totSemana.usd > 0 && <p className={`font-bold text-yellow-700 ${totSemana.ars > 0 ? "text-sm" : "text-xl"}`}>USD {totSemana.usd.toLocaleString("es-AR", { minimumFractionDigits: 0 })}</p>}
                {totSemana.ars === 0 && totSemana.usd === 0 && <p className="text-xl font-bold text-yellow-700">$0</p>}
              </CardContent>
            </Card>
            <Card className="border-gray-200">
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Próximos 30 días</span>
                  {oblFuturo.length > 0 && <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">{oblFuturo.length}</Badge>}
                </div>
                {totFuturo.ars > 0 && <p className="text-xl font-bold text-foreground">{fmt(totFuturo.ars)}</p>}
                {totFuturo.usd > 0 && <p className={`font-bold text-foreground ${totFuturo.ars > 0 ? "text-sm" : "text-xl"}`}>USD {totFuturo.usd.toLocaleString("es-AR", { minimumFractionDigits: 0 })}</p>}
                {totFuturo.ars === 0 && totFuturo.usd === 0 && <p className="text-xl font-bold text-foreground">$0</p>}
              </CardContent>
            </Card>
          </div>

          {/* Lista pendientes */}
          {oblVisible.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium w-6" />
                    <th className="text-left px-3 py-2 font-medium">Vencimiento</th>
                    <th className="text-left px-3 py-2 font-medium">Concepto</th>
                    <th className="text-left px-3 py-2 font-medium">Categoría</th>
                    <th className="text-right px-3 py-2 font-medium">Monto</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {(oblVisible as Obligacion[]).map(ob => {
                    const sem = oblSemaforoClass(ob.fecha_vencimiento);
                    const rowColor = sem === "vencido" ? "bg-red-50/60" : sem === "semana" ? "bg-yellow-50/40" : "";
                    const dotColor = sem === "vencido" ? "bg-red-500" : sem === "semana" ? "bg-yellow-400" : "bg-gray-300";
                    const isUSD = (ob.moneda ?? "ARS") === "USD";
                    return (
                      <tr key={ob.id} className={`border-t hover:bg-muted/20 ${rowColor}`}>
                        <td className="px-3 py-2">
                          <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotColor}`} />
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                          {ob.fecha_vencimiento.slice(5).split("-").reverse().join("/")}
                        </td>
                        <td className="px-3 py-2 font-medium">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="truncate max-w-[180px]">{oblLabel(ob)}</span>
                            {ob.pago_parcial && (
                              <Badge className="bg-amber-100 text-amber-700 border border-amber-300 text-[10px] px-1.5 py-0 h-4 font-medium">pago parcial</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${TIPO_BADGE[ob.tipo] ?? TIPO_BADGE.otro}`}>
                            {ob.tipo}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-red-700 whitespace-nowrap">
                          {isUSD ? `USD ${ob.monto.toLocaleString("es-AR")}` : fmt(ob.monto)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 text-xs text-green-700 hover:text-green-800 hover:bg-green-50"
                              onClick={() => { setPagarObl(ob); setPagarCuentaId(null); setPagarMonto(String(ob.monto)); setPagarCotizacion(""); setPagarOblOpen(true); }}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Pagar
                            </Button>
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => {
                                setEditObl(ob);
                                setEditForm({ concepto: ob.concepto, tipo: ob.tipo, moneda: (ob.moneda ?? "ARS") as "ARS" | "USD", monto: String(ob.monto), fechaVencimiento: ob.fecha_vencimiento, notas: ob.notas ?? "", pagoParcial: ob.pago_parcial ?? false });
                                setEditTipoCustom(!allTipos.includes(ob.tipo));
                                setEditOblOpen(true);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => delOblMutation.mutate(ob.id)}
                              disabled={delOblMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </div>
          )}
          {oblVisible.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin obligaciones pendientes.</p>
          )}
        </section>

        {/* Dialog: agregar obligación */}
        <Dialog open={oblDialogOpen} onOpenChange={v => { setOblDialogOpen(v); if (!v) { setOblForm(emptyOblForm()); setOblTipoCustom(false); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Agregar obligación</DialogTitle></DialogHeader>
            <div className="space-y-3 py-1">
              <div className="space-y-1">
                <Label>Concepto <span className="text-red-500">*</span></Label>
                <Input value={oblForm.concepto} onChange={e => setOblForm(f => ({ ...f, concepto: e.target.value }))} placeholder="Ej: Alquiler galpón, IVA junio..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Categoría <span className="text-red-500">*</span></Label>
                  <Select
                    value={oblTipoCustom ? "__nueva__" : (allTipos.includes(oblForm.tipo) ? oblForm.tipo : (oblForm.tipo ? "__nueva__" : ""))}
                    onValueChange={v => {
                      if (v === "__nueva__") { setOblTipoCustom(true); setOblForm(f => ({ ...f, tipo: "" })); }
                      else { setOblTipoCustom(false); setOblForm(f => ({ ...f, tipo: v })); }
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                    <SelectContent>
                      {allTipos.map(t => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
                      <SelectItem value="__nueva__">+ Nueva categoría...</SelectItem>
                    </SelectContent>
                  </Select>
                  {oblTipoCustom && (
                    <Input
                      autoFocus
                      value={oblForm.tipo}
                      onChange={e => setOblForm(f => ({ ...f, tipo: e.target.value }))}
                      placeholder="Nombre de la categoría"
                    />
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Moneda</Label>
                  <Select value={oblForm.moneda} onValueChange={v => setOblForm(f => ({ ...f, moneda: v as "ARS" | "USD" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARS">ARS — Pesos</SelectItem>
                      <SelectItem value="USD">USD — Dólares</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Monto <span className="text-red-500">*</span></Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{oblForm.moneda === "USD" ? "USD" : "$"}</span>
                  <Input type="number" min="0" step="0.01" className="pl-12" value={oblForm.monto} onChange={e => setOblForm(f => ({ ...f, monto: e.target.value }))} placeholder="0.00" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Vencimiento <span className="text-red-500">*</span></Label>
                  <Input type="date" value={oblForm.fechaVencimiento} onChange={e => setOblForm(f => ({ ...f, fechaVencimiento: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Total de cuotas</Label>
                  <Input
                    type="number" min="1" max="60" step="1"
                    value={oblForm.mensual ? "12" : oblForm.cuotas}
                    disabled={oblForm.mensual}
                    onChange={e => setOblForm(f => ({ ...f, cuotas: e.target.value }))}
                    placeholder="1"
                  />
                </div>
              </div>
              {!oblForm.mensual && parseInt(oblForm.cuotas) > 1 && (
                <div className="space-y-1">
                  <Label>Cuota inicial <span className="text-xs text-muted-foreground font-normal">(si ya pagaste algunas)</span></Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min="1" max={oblForm.cuotas} step="1"
                      value={oblForm.cuotaInicial}
                      onChange={e => setOblForm(f => ({ ...f, cuotaInicial: e.target.value }))}
                      className="w-24"
                      placeholder="1"
                    />
                    <span className="text-sm text-muted-foreground">de {oblForm.cuotas} — vencimiento del {oblForm.fechaVencimiento.slice(5).split("-").reverse().join("/")} en adelante</span>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  id="obl-mensual"
                  type="checkbox"
                  checked={oblForm.mensual}
                  onChange={e => setOblForm(f => ({ ...f, mensual: e.target.checked, cuotas: e.target.checked ? "12" : "1" }))}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="obl-mensual" className="cursor-pointer font-normal">
                  Se repite todos los meses — mismo monto cada mes (ej: alquiler, sueldo)
                </Label>
              </div>
              <div className="space-y-1">
                <Label>Notas (opcional)</Label>
                <Input value={oblForm.notas} onChange={e => setOblForm(f => ({ ...f, notas: e.target.value }))} placeholder="Referencia, nro. expte., etc." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOblDialogOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => addOblMutation.mutate({ ...oblForm, cuotas: oblForm.mensual ? "12" : oblForm.cuotas, mensual: oblForm.mensual })}
                disabled={addOblMutation.isPending || !oblForm.concepto || !oblForm.monto || !oblForm.fechaVencimiento || !oblForm.tipo}
              >
                {addOblMutation.isPending ? "Guardando..." : oblForm.mensual ? "Crear 12 meses" : (parseInt(oblForm.cuotas) > 1 ? `Crear cuotas ${oblForm.cuotaInicial || 1} a ${oblForm.cuotas}` : "Guardar")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog: pagar obligación */}
        <Dialog open={pagarOblOpen} onOpenChange={v => { setPagarOblOpen(v); if (!v) { setPagarObl(null); setPagarCuentaId(null); setPagarMonto(""); setPagarMontoARS(""); setPagarCotizacion(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Registrar pago</DialogTitle></DialogHeader>
            <div className="py-2 space-y-3">
              {pagarObl && (() => {
                const isUSD = (pagarObl.moneda ?? "ARS") === "USD";
                const cotz = parseFloat(pagarCotizacion) || 0;
                const montoNum = parseFloat(pagarMonto) || 0;
                const pendiente = pagarObl.monto - montoNum;
                const isPartial = montoNum > 0 && montoNum < pagarObl.monto;

                const handleUSDChange = (val: string) => {
                  setPagarMonto(val);
                  if (cotz > 0 && val) setPagarMontoARS(String(Math.round(parseFloat(val) * cotz * 100) / 100));
                  else if (!val) setPagarMontoARS("");
                };
                const handleARSChange = (val: string) => {
                  setPagarMontoARS(val);
                  if (cotz > 0 && val) setPagarMonto(String(Math.round((parseFloat(val) / cotz) * 100) / 100));
                  else if (!val) setPagarMonto("");
                };
                const handleCotzChange = (val: string) => {
                  setPagarCotizacion(val);
                  const c = parseFloat(val) || 0;
                  if (c > 0) {
                    if (pagarMonto) setPagarMontoARS(String(Math.round(parseFloat(pagarMonto) * c * 100) / 100));
                    else if (pagarMontoARS) setPagarMonto(String(Math.round((parseFloat(pagarMontoARS) / c) * 100) / 100));
                  }
                };

                return (
                  <>
                    <p className="text-sm font-medium">
                      {oblLabel(pagarObl)} — <span className="text-red-700">{isUSD ? `USD ${pagarObl.monto.toLocaleString("es-AR")}` : fmt(pagarObl.monto)}</span>
                      {pagarObl.pago_parcial && <span className="text-xs text-amber-600 ml-1">(saldo restante)</span>}
                    </p>

                    {(oblPagos ?? []).length > 0 && (
                      <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pagos realizados</p>
                        {(oblPagos ?? []).map((p: any) => (
                          <div key={p.id} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{String(p.fecha).slice(5).split("-").reverse().join("/")}</span>
                            <span className="font-medium tabular-nums">
                              {p.moneda === "USD"
                                ? `USD ${p.monto.toLocaleString("es-AR")} · ${fmt(p.monto_ars)}`
                                : fmt(p.monto_ars)}
                            </span>
                          </div>
                        ))}
                        <div className="border-t border-border pt-1 flex justify-between text-xs font-semibold">
                          <span>Total pagado</span>
                          <span className="tabular-nums">{fmt((oblPagos ?? []).reduce((a: number, p: any) => a + (p.monto_ars ?? 0), 0))}</span>
                        </div>
                      </div>
                    )}

                    {isUSD ? (
                      <>
                        <div className="space-y-1">
                          <Label className="text-xs">Cotización (ARS por USD) <span className="text-red-500">*</span></Label>
                          <Input type="number" min="0" step="1" value={pagarCotizacion} onChange={e => handleCotzChange(e.target.value)} placeholder="Ej: 1200" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Monto en USD</Label>
                            <Input type="number" min="0" step="0.01" value={pagarMonto} onChange={e => handleUSDChange(e.target.value)} placeholder="0.00" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Equivalente en ARS</Label>
                            <Input type="number" min="0" step="1" value={pagarMontoARS} onChange={e => handleARSChange(e.target.value)} placeholder="0" />
                          </div>
                        </div>
                        {isPartial && (
                          <p className="text-xs text-amber-600 font-medium">
                            Pago parcial — queda pendiente: USD {pendiente.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="space-y-1">
                        <Label className="text-xs">Monto pagado ($)</Label>
                        <Input type="number" min="0" step="0.01" value={pagarMonto} onChange={e => setPagarMonto(e.target.value)} />
                        {isPartial && (
                          <p className="text-xs text-amber-600 font-medium">Pago parcial — queda pendiente: {fmt(pendiente)}</p>
                        )}
                      </div>
                    )}

                    <div className="space-y-1">
                      <Label className="text-xs">Cuenta de pago (ajusta saldo)</Label>
                      <Select
                        value={pagarCuentaId ? String(pagarCuentaId) : "none"}
                        onValueChange={v => setPagarCuentaId(v === "none" ? null : Number(v))}
                      >
                        <SelectTrigger><SelectValue placeholder="Sin ajuste" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sin ajuste de saldo</SelectItem>
                          {(cuentas ?? []).map(c => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.nombre}{c.tipo === "mp" ? " (solo registra, no ajusta saldo)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">MP: el saldo se refleja por el feed automático. Pago por banco/cheque: no suma gasto (ya lo trae el extracto); solo efectivo registra el gasto.</p>
                    </div>
                  </>
                );
              })()}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPagarOblOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => {
                  if (!pagarObl) return;
                  const montoNum = parseFloat(pagarMonto);
                  if (!montoNum || montoNum <= 0) return;
                  const isUSD = (pagarObl.moneda ?? "ARS") === "USD";
                  const cotz = isUSD ? parseFloat(pagarCotizacion) : undefined;
                  if (isUSD && (!cotz || cotz <= 0)) return;
                  pagarOblMutation.mutate({ id: pagarObl.id, cuentaPagoId: pagarCuentaId, montoPagado: montoNum, cotizacion: cotz });
                }}
                disabled={pagarOblMutation.isPending || !parseFloat(pagarMonto) || ((pagarObl?.moneda ?? "ARS") === "USD" && !parseFloat(pagarCotizacion))}
              >
                {pagarOblMutation.isPending ? "Guardando..." : "Confirmar pago"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog: editar obligación */}
        <Dialog open={editOblOpen} onOpenChange={v => { setEditOblOpen(v); if (!v) { setEditObl(null); setEditTipoCustom(false); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Editar obligación</DialogTitle></DialogHeader>
            <div className="space-y-3 py-1">
              <div className="space-y-1">
                <Label>Concepto</Label>
                <Input value={editForm.concepto} onChange={e => setEditForm(f => ({ ...f, concepto: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Categoría</Label>
                  <Select
                    value={editTipoCustom ? "__nueva__" : (allTipos.includes(editForm.tipo) ? editForm.tipo : (editForm.tipo ? "__nueva__" : ""))}
                    onValueChange={v => {
                      if (v === "__nueva__") { setEditTipoCustom(true); setEditForm(f => ({ ...f, tipo: "" })); }
                      else { setEditTipoCustom(false); setEditForm(f => ({ ...f, tipo: v })); }
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                    <SelectContent>
                      {allTipos.map(t => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
                      <SelectItem value="__nueva__">+ Nueva categoría...</SelectItem>
                    </SelectContent>
                  </Select>
                  {editTipoCustom && (
                    <Input autoFocus value={editForm.tipo} onChange={e => setEditForm(f => ({ ...f, tipo: e.target.value }))} placeholder="Nombre de la categoría" />
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Moneda</Label>
                  <Select value={editForm.moneda} onValueChange={v => setEditForm(f => ({ ...f, moneda: v as "ARS" | "USD" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARS">ARS — Pesos</SelectItem>
                      <SelectItem value="USD">USD — Dólares</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Monto</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{editForm.moneda === "USD" ? "USD" : "$"}</span>
                  <Input type="number" min="0" step="0.01" className="pl-12" value={editForm.monto} onChange={e => setEditForm(f => ({ ...f, monto: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Vencimiento</Label>
                <Input type="date" value={editForm.fechaVencimiento} onChange={e => setEditForm(f => ({ ...f, fechaVencimiento: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Notas</Label>
                <Input value={editForm.notas} onChange={e => setEditForm(f => ({ ...f, notas: e.target.value }))} />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input type="checkbox" id="editPagoParcial" checked={editForm.pagoParcial} onChange={e => setEditForm(f => ({ ...f, pagoParcial: e.target.checked }))} className="h-4 w-4" />
                <Label htmlFor="editPagoParcial" className="cursor-pointer font-normal">Marcar como pago parcial</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOblOpen(false)}>Cancelar</Button>
              <Button
                disabled={editOblMutation.isPending || !editForm.concepto || !editForm.monto || !editForm.tipo}
                onClick={() => {
                  if (!editObl) return;
                  if (editObl.grupo_cuota) {
                    // Ask about propagation first
                    setPropagatePendingData({ id: editObl.id, form: editForm });
                    setEditOblOpen(false);
                    setPropagateDialogOpen(true);
                  } else {
                    editOblMutation.mutate({ id: editObl.id, form: editForm, propagate: false });
                  }
                }}
              >
                {editOblMutation.isPending ? "Guardando..." : "Guardar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog: propagar cambios al grupo */}
        <Dialog open={propagateDialogOpen} onOpenChange={v => { if (!v) { setPropagateDialogOpen(false); setPropagatePendingData(null); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Aplicar cambios</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground py-2">
              Esta obligación pertenece a un grupo recurrente. ¿Querés aplicar los cambios también a los próximos vencimientos pendientes del mismo grupo?
            </p>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="flex-1"
                onClick={() => { if (propagatePendingData) editOblMutation.mutate({ ...propagatePendingData, propagate: false }); }}
                disabled={editOblMutation.isPending}
              >
                Solo esta
              </Button>
              <Button className="flex-1"
                onClick={() => { if (propagatePendingData) editOblMutation.mutate({ ...propagatePendingData, propagate: true }); }}
                disabled={editOblMutation.isPending}
              >
                Todos los futuros
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Flujo semanal de cheques (cartera vs emisiones, por fecha de impacto) ── */}
        <ChequesFlow cheques={cheques ?? []} />

        {/* ── Cheques en cartera ────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Cheques en cartera</h2>
            <Badge variant="secondary">{chequesEnCartera.length}</Badge>
            <span className="text-sm text-muted-foreground ml-auto font-medium">
              Total: {fmt(chequesEnCartera.reduce((s, c) => s + c.monto, 0))}
            </span>
            <Button size="sm" variant="outline" className="h-7"
              onClick={() => { setChequeForm({ monto: "", fechaCobro: "", contraparte: "", numero: "" }); setAddChequeOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Agregar
            </Button>
          </div>
          {chequesEnCartera.length === 0 ? (
            <p className="text-sm text-muted-foreground border rounded-lg px-3 py-4 text-center">No hay cheques en cartera.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Cobro</th>
                    <th className="text-left px-3 py-2 font-medium">De quién</th>
                    <th className="text-right px-3 py-2 font-medium">Monto</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {chequesEnCartera.map(ch => (
                    <tr key={ch.id} className="border-t hover:bg-muted/20">
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{ch.fecha_cobro.slice(5).split("-").reverse().join("/")}/{ch.fecha_cobro.slice(2,4)}</td>
                      <td className="px-3 py-2 font-medium">{ch.contraparte}</td>
                      <td className="px-3 py-2 text-right font-semibold text-purple-700">{fmt(ch.monto)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => { setActiveCheque(ch); setChequeCuentaDestinoId(null); setChequeComision(""); setDepositarChequeOpen(true); }}>
                            Depositar
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs"
                            onClick={() => { setActiveCheque(ch); setChequeEndosarA(""); setEndosarChequeOpen(true); }}>
                            Endosar
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Editar"
                            onClick={() => { setActiveCheque(ch); setChequeForm({ monto: String(Math.round(ch.monto)), fechaCobro: ch.fecha_cobro.slice(0, 10), contraparte: ch.contraparte, numero: ch.numero ?? "" }); setEditChequeOpen(true); }}>
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Eliminar"
                            disabled={deleteChequeMut.isPending}
                            onClick={() => { if (window.confirm(`¿Eliminar el cheque de ${ch.contraparte} por ${fmt(ch.monto)}?`)) deleteChequeMut.mutate(ch.id); }}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}
        </section>

        {/* Dialog: agregar / editar cheque en cartera */}
        <Dialog open={addChequeOpen || editChequeOpen} onOpenChange={v => { if (!v) { setAddChequeOpen(false); setEditChequeOpen(false); setActiveCheque(null); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{editChequeOpen ? "Editar cheque" : "Agregar cheque en cartera"}</DialogTitle></DialogHeader>
            <div className="py-2 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">De quién</Label>
                <Input value={chequeForm.contraparte} onChange={e => setChequeForm(f => ({ ...f, contraparte: e.target.value }))} placeholder="Nombre del cliente/emisor" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Número de cheque</Label>
                <Input inputMode="numeric" value={chequeForm.numero} onChange={e => setChequeForm(f => ({ ...f, numero: e.target.value }))} placeholder="Ej. 122" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Monto</Label>
                <Input type="number" min="0" step="0.01" value={chequeForm.monto} onChange={e => setChequeForm(f => ({ ...f, monto: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fecha de cobro</Label>
                <Input type="date" value={chequeForm.fechaCobro} onChange={e => setChequeForm(f => ({ ...f, fechaCobro: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setAddChequeOpen(false); setEditChequeOpen(false); setActiveCheque(null); }}>Cancelar</Button>
              <Button
                disabled={!chequeForm.contraparte || !parseFloat(chequeForm.monto) || !chequeForm.fechaCobro || addChequeMut.isPending || editChequeMut.isPending}
                onClick={() => {
                  const body = { monto: parseFloat(chequeForm.monto), fechaCobro: chequeForm.fechaCobro, contraparte: chequeForm.contraparte, numero: chequeForm.numero.trim() || undefined };
                  if (editChequeOpen && activeCheque) editChequeMut.mutate({ id: activeCheque.id, ...body });
                  else addChequeMut.mutate(body);
                }}
              >
                {editChequeOpen ? "Guardar" : "Agregar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog: depositar cheque */}
        <Dialog open={depositarChequeOpen} onOpenChange={v => { setDepositarChequeOpen(v); if (!v) { setActiveCheque(null); setChequeComision(""); setChequeCuentaDestinoId(null); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Depositar cheque</DialogTitle></DialogHeader>
            <div className="py-2 space-y-3">
              {activeCheque && (
                <p className="text-sm font-medium">{activeCheque.contraparte} — <span className="text-purple-700">{fmt(activeCheque.monto)}</span></p>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Cuenta destino</Label>
                <Select
                  value={chequeCuentaDestinoId ? String(chequeCuentaDestinoId) : (cuentas?.find(c => c.tipo === "banco")?.id ? String(cuentas.find(c => c.tipo === "banco")!.id) : "")}
                  onValueChange={v => setChequeCuentaDestinoId(Number(v))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(cuentas ?? []).filter(c => c.tipo === "banco" || c.tipo === "mp").map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Comisión / gastos bancarios (opcional)</Label>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input type="number" min="0" step="0.01" value={chequeComision} onChange={e => setChequeComision(e.target.value)} placeholder="0" className="flex-1" />
                </div>
                {parseFloat(chequeComision || "0") > 0 && activeCheque && (
                  <p className="text-xs text-muted-foreground">Acreditado: {fmt(activeCheque.monto - parseFloat(chequeComision))}</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDepositarChequeOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => activeCheque && depositarMut.mutate({
                  id: activeCheque.id,
                  comision: parseFloat(chequeComision || "0") || 0,
                  cuentaDestinoId: chequeCuentaDestinoId ?? (cuentas?.find(c => c.tipo === "banco")?.id ?? null),
                })}
                disabled={depositarMut.isPending}
              >
                {depositarMut.isPending ? "Guardando..." : "Confirmar depósito"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog: endosar cheque */}
        <Dialog open={endosarChequeOpen} onOpenChange={v => { setEndosarChequeOpen(v); if (!v) { setActiveCheque(null); setChequeEndosarA(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Endosar cheque</DialogTitle></DialogHeader>
            <div className="py-2 space-y-3">
              {activeCheque && (
                <p className="text-sm font-medium">{activeCheque.contraparte} — <span className="text-purple-700">{fmt(activeCheque.monto)}</span></p>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Endosar a (proveedor u otro) <span className="text-red-500">*</span></Label>
                <Input value={chequeEndosarA} onChange={e => setChequeEndosarA(e.target.value)} placeholder="Nombre del proveedor" className="mt-1" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEndosarChequeOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => activeCheque && endosarMut.mutate({ id: activeCheque.id, contraparte: chequeEndosarA || activeCheque.contraparte })}
                disabled={endosarMut.isPending || !chequeEndosarA}
              >
                {endosarMut.isPending ? "Guardando..." : "Confirmar endoso"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Retiros de socios ─────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" /> Retiros de socios
            </h2>
            <span className="text-xs text-muted-foreground">— {label}</span>
            <Button size="sm" variant="outline" className="ml-auto"
              onClick={() => setRetiroDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Cargar retiro
            </Button>
          </div>
          {(socios ?? []).filter((s: any) => s.activo).length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {(socios ?? []).filter((s: any) => s.activo).map((s: any) => {
                const total = retirosBySocio[s.id] ?? 0;
                const pct = retirosTotalPeriodo > 0 ? Math.round((total / retirosTotalPeriodo) * 100) : 0;
                return (
                  <Card key={s.id} className="cursor-pointer hover:border-primary/40 transition-colors"
                    onClick={() => setSocioDetailId(s.id)}>
                    <CardContent className="pt-4 pb-3 px-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold">{s.nombre}</span>
                        {pct > 0 && <span className="text-[10px] text-muted-foreground ml-auto">{pct}%</span>}
                      </div>
                      <p className="text-xl font-bold text-orange-700">{fmt(total)}</p>
                      {retirosTotalPeriodo > 0 && (
                        <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          {retirosPeriodo.length === 0 && (
            <p className="text-xs text-muted-foreground">Sin retiros en este período.</p>
          )}
        </section>

        {/* Dialog: agregar retiro manual */}
        <Dialog open={retiroDialogOpen} onOpenChange={v => { setRetiroDialogOpen(v); if (!v) setRetiroForm({ socioId: "", monto: "", fecha: new Date().toISOString().slice(0,10), notas: "" }); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Cargar retiro manual</DialogTitle></DialogHeader>
            <div className="space-y-3 py-1">
              <div className="space-y-1">
                <Label className="text-xs">Socio <span className="text-red-500">*</span></Label>
                <Select value={retiroForm.socioId} onValueChange={v => setRetiroForm(f => ({ ...f, socioId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar socio" /></SelectTrigger>
                  <SelectContent>
                    {(socios ?? []).filter((s: any) => s.activo).map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Monto ($) <span className="text-red-500">*</span></Label>
                  <Input type="number" min="0" step="0.01" value={retiroForm.monto} onChange={e => setRetiroForm(f => ({ ...f, monto: e.target.value }))} placeholder="0.00" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Fecha <span className="text-red-500">*</span></Label>
                  <Input type="date" value={retiroForm.fecha} onChange={e => setRetiroForm(f => ({ ...f, fecha: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notas (opcional)</Label>
                <Input value={retiroForm.notas} onChange={e => setRetiroForm(f => ({ ...f, notas: e.target.value }))} placeholder="Referencia..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRetiroDialogOpen(false)}>Cancelar</Button>
              <Button onClick={() => addRetiroMut.mutate(retiroForm)}
                disabled={addRetiroMut.isPending || !retiroForm.socioId || !retiroForm.monto}>
                {addRetiroMut.isPending ? "Guardando..." : "Guardar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog: detalle mensual de socio */}
        {socioDetailId !== null && (() => {
          const socio = (socios ?? []).find((s: any) => s.id === socioDetailId);
          const mensual = retirosMensuales[socioDetailId] ?? {};
          const meses = Object.entries(mensual).sort((a, b) => a[0].localeCompare(b[0]));
          const totalSocio = meses.reduce((s, [, v]) => s + (v as number), 0);
          return (
            <Dialog open onOpenChange={v => { if (!v) setSocioDetailId(null); }}>
              <DialogContent className="max-w-sm">
                <DialogHeader><DialogTitle>Retiros — {socio?.nombre}</DialogTitle></DialogHeader>
                <div className="py-1 space-y-1 max-h-72 overflow-y-auto">
                  {meses.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2 text-center">Sin retiros registrados.</p>
                  ) : meses.map(([mes, total]) => {
                    const [y, m] = mes.split("-");
                    const label2 = `${MONTHS_ES[parseInt(m) - 1]} ${y}`;
                    return (
                      <div key={mes} className="flex items-center justify-between px-1 py-1.5 border-b last:border-0">
                        <span className="text-sm text-muted-foreground">{label2}</span>
                        <span className="text-sm font-semibold text-orange-700">{fmt(total as number)}</span>
                      </div>
                    );
                  })}
                </div>
                {meses.length > 0 && (
                  <div className="flex items-center justify-between px-1 pt-2 border-t">
                    <span className="text-sm font-bold">Total acumulado</span>
                    <span className="text-sm font-bold text-orange-700">{fmt(totalSocio)}</span>
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setSocioDetailId(null)}>Cerrar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          );
        })()}

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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                <div className="border-t border-border pt-2 mt-1 flex items-center gap-2 font-bold">
                  <span className="flex-1 text-foreground uppercase text-xs">Total</span>
                  <span className="tabular-nums w-24 text-right text-red-600 dark:text-red-400">
                    {fmt(pieData.reduce((acc, x) => acc + x.value, 0))}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Acordeón: egresos por categoría ─────────────────────────── */}
        {categoriaData.length > 0 && (
          <section className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Detalle por categoría — {label}
            </p>
            <div className="border rounded-lg overflow-hidden divide-y">
              {categoriaData.map(({ cat, total, items }, ci) => {
                const isOpen = expandedCat === cat;
                const color = PIE_COLORS[ci % PIE_COLORS.length];
                return (
                  <div key={cat}>
                    <button
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors text-left"
                      onClick={() => setExpandedCat(isOpen ? null : cat)}
                    >
                      <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="flex-1 text-sm font-medium truncate">{cat}</span>
                      <span className="text-sm font-semibold text-red-700 tabular-nums">{fmt(total)}</span>
                      {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                    </button>
                    {isOpen && (
                      <div className="bg-muted/20 divide-y">
                        {items.map(item => (
                          <div key={item.id} className="flex items-center gap-3 px-6 py-1.5 text-xs">
                            <span className="text-muted-foreground tabular-nums w-10 flex-shrink-0">{fmtDate(item.date)}</span>
                            <span className="flex-1 truncate text-muted-foreground">{item.description}{item.counterpart ? ` — ${item.counterpart}` : ""}</span>
                            <span className="font-medium text-red-700 tabular-nums">{fmt(item.amount)}</span>
                            {item.sourceType === "manual" && !item.isBankSync && (
                              <Button size="icon" variant="ghost" className="h-5 w-5 -my-0.5"
                                onClick={() => delMutation.mutate(item.sourceId)} disabled={delMutation.isPending}>
                                <Trash2 className="h-3 w-3 text-muted-foreground" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
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
              <Select value={form.method || "_none"} onValueChange={v => {
                const m = v === "_none" ? "" : v;
                const ef = cuentas?.find(c => c.tipo === "efectivo");
                const autoCuenta = m === "EFECTIVO" ? (ef?.id ?? null) : null;
                setForm(f => ({ ...f, method: m, cuentaId: autoCuenta }));
              }}>
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
            {/* Cuenta a ajustar (excluye MP) */}
            {(form.method === "EFECTIVO" || form.method === "TRANSFERENCIA") && cuentas && (
              <div className="space-y-1">
                <Label className="text-xs">Ajusta saldo de cuenta</Label>
                {form.method === "EFECTIVO" ? (
                  <p className="text-xs text-muted-foreground py-1">
                    → {cuentas.find(c => c.tipo === "efectivo")?.nombre ?? "Efectivo"}
                  </p>
                ) : (
                  <Select
                    value={form.cuentaId != null ? String(form.cuentaId) : "none"}
                    onValueChange={v => setForm(f => ({ ...f, cuentaId: v === "none" ? null : Number(v) }))}
                  >
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="No ajustar" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No ajustar saldo</SelectItem>
                      {cuentas.filter(c => c.tipo === "banco").map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <div className="space-y-1">
              <Label>Descripción <span className="text-muted-foreground font-normal">(opcional si elegís categoría)</span></Label>
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
                    onValueChange={v => setForm(f => ({ ...f, category: v === "_none" ? "" : v, socioId: null }))}
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
            {form.category === "Retiro" && (
              <div className="space-y-1">
                <Label className="text-xs">Socio que retira <span className="text-destructive">*</span></Label>
                <Select value={form.socioId != null ? String(form.socioId) : "_none"}
                  onValueChange={v => setForm(f => ({ ...f, socioId: v === "_none" ? null : Number(v) }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Elegí un socio" /></SelectTrigger>
                  <SelectContent>
                    {(socios ?? []).filter((s: any) => s.activo).map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.socioId == null && (
                  <p className="text-[10px] text-muted-foreground">Obligatorio para que el retiro sume en la card del socio.</p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleAdd}
              disabled={addMutation.isPending || !form.amount || !form.method || (!form.description.trim() && !form.category) || (form.category === "Retiro" && form.socioId == null)}
            >
              {addMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
