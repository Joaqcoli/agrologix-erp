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
  Landmark, Pencil, AlertCircle, CheckCircle2, Clock,
  ChevronDown, ChevronUp, Users,
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
  fechaVencimiento: string; notas: string; cuotas: string; mensual: boolean;
};
const emptyOblForm = (): OblForm => ({
  concepto: "", tipo: "otro", moneda: "ARS", monto: "",
  fechaVencimiento: new Date().toISOString().slice(0, 10),
  notas: "", cuotas: "1", mensual: false,
});

type EditOblForm = {
  concepto: string; tipo: string; moneda: "ARS" | "USD"; monto: string;
  fechaVencimiento: string; notas: string;
};

export default function CajaPage() {
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

  // Obligaciones
  const [oblDialogOpen, setOblDialogOpen] = useState(false);
  const [oblForm, setOblForm] = useState<OblForm>(emptyOblForm());
  const [oblTipoCustom, setOblTipoCustom] = useState(false); // show custom input in add form
  const [pagarOblOpen, setPagarOblOpen] = useState(false);
  const [pagarObl, setPagarObl] = useState<Obligacion | null>(null);
  const [pagarCuentaId, setPagarCuentaId] = useState<number | null>(null);
  const [pagarMonto, setPagarMonto] = useState<string>("");
  const [pagarCotizacion, setPagarCotizacion] = useState<string>("");
  // Edit
  const [editOblOpen, setEditOblOpen] = useState(false);
  const [editObl, setEditObl] = useState<Obligacion | null>(null);
  const [editForm, setEditForm] = useState<EditOblForm>({ concepto: "", tipo: "", moneda: "ARS", monto: "", fechaVencimiento: "", notas: "" });
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

  const mpCuenta = cuentas?.find(c => c.tipo === "mp");
  const mpBaseFecha = mpCuenta?.saldo_base_fecha ? mpCuenta.saldo_base_fecha.slice(0, 10) : null;
  const todayIso = new Date().toISOString().slice(0, 10);

  const { data: mpMovData } = useQuery<{ results?: any[] }>({
    queryKey: ["/api/mp/movements/cuentas", mpBaseFecha, todayIso],
    queryFn: () =>
      fetch(`/api/mp/movements?from=${mpBaseFecha}&to=${todayIso}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!mpBaseFecha,
    staleTime: 3 * 60 * 1000,
  });

  const mpDelta = useMemo(() => {
    if (!mpBaseFecha || !mpMovData?.results) return 0;
    let delta = 0;
    for (const m of mpMovData.results) {
      const net = m.netAmount ?? 0;
      if (m.isOutgoing) delta -= net;
      else delta += net;
    }
    return delta;
  }, [mpBaseFecha, mpMovData]);

  function getSaldoActual(c: CuentaFinanciera): number {
    const base = parseFloat(String(c.saldo_base ?? 0));
    const ajuste = c.ajuste ?? 0;
    if (c.tipo === "mp") return base + ajuste + mpDelta;
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
    if (!form.description || !form.amount || !form.date || !form.method) return;
    addMutation.mutate(form);
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

  // ── Obligaciones queries & mutations ─────────────────────────────────────────
  const { data: obligaciones } = useQuery<Obligacion[]>({
    queryKey: ["/api/caja/obligaciones"],
    queryFn: () => fetch("/api/caja/obligaciones", { credentials: "include" }).then(r => r.json()),
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

  // Show only first pending per grupo_cuota (collapse recurring)
  const oblVisible = useMemo(() => {
    const seen = new Set<string>();
    return oblPendientes.filter((ob: Obligacion) => {
      if (!ob.grupo_cuota) return true;
      if (seen.has(ob.grupo_cuota)) return false;
      seen.add(ob.grupo_cuota);
      return true;
    });
  }, [oblPendientes]);

  // Count pending per group
  const grupoCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ob of oblPendientes as Obligacion[]) {
      if (ob.grupo_cuota) counts[ob.grupo_cuota] = (counts[ob.grupo_cuota] ?? 0) + 1;
    }
    return counts;
  }, [oblPendientes]);

  const today = new Date(); today.setHours(0,0,0,0);
  const endOfWeek = new Date(today); endOfWeek.setDate(today.getDate() + 7);
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const oblVencido = oblPendientes.filter((o: Obligacion) => oblSemaforoClass(o.fecha_vencimiento) === "vencido");
  const oblSemana  = oblPendientes.filter((o: Obligacion) => oblSemaforoClass(o.fecha_vencimiento) === "semana");
  const oblFuturo  = oblPendientes.filter((o: Obligacion) => {
    const venc = new Date(o.fecha_vencimiento + "T00:00:00");
    return oblSemaforoClass(o.fecha_vencimiento) === "futuro" && venc <= endOfMonth;
  });
  const totalVencido = oblVencido.reduce((s: number, o: Obligacion) => s + o.monto, 0);
  const totalSemana  = oblSemana.reduce((s: number, o: Obligacion) => s + o.monto, 0);
  const totalFuturo  = oblFuturo.reduce((s: number, o: Obligacion) => s + o.monto, 0);

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
        {/* ── Posición financiera ─────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold">¿Dónde está mi plata hoy?</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {(cuentas ?? []).map(cuenta => {
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
                    {cuenta.saldo_base_fecha && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        base {new Date(cuenta.saldo_base_fecha).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                        {cuenta.tipo === "mp" && mpDelta !== 0 && (
                          <span className={mpDelta > 0 ? " text-green-600" : " text-red-600"}>
                            {" "}{mpDelta > 0 ? "+" : ""}{fmt(mpDelta)}
                          </span>
                        )}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {/* Total */}
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <DollarSign className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold text-primary">Disponible total</span>
                </div>
                <p className="text-xl font-bold text-primary">
                  {cuentas ? fmt((cuentas).reduce((s, c) => s + getSaldoActual(c), 0)) : "…"}
                </p>
              </CardContent>
            </Card>
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
                  Ingresá el saldo exacto de MP ahora. A partir de esta fecha los movimientos del feed se suman automáticamente.
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
          <div className="grid grid-cols-3 gap-3">
            <Card className="border-red-200 bg-red-50/40">
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <span className="text-xs font-medium text-red-700">Vencido</span>
                  {oblVencido.length > 0 && <Badge className="ml-auto bg-red-600 text-white text-[10px] h-4 px-1">{oblVencido.length}</Badge>}
                </div>
                <p className="text-xl font-bold text-red-700">{fmt(totalVencido)}</p>
              </CardContent>
            </Card>
            <Card className="border-yellow-200 bg-yellow-50/40">
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-4 w-4 text-yellow-600" />
                  <span className="text-xs font-medium text-yellow-700">Esta semana</span>
                  {oblSemana.length > 0 && <Badge className="ml-auto bg-yellow-500 text-white text-[10px] h-4 px-1">{oblSemana.length}</Badge>}
                </div>
                <p className="text-xl font-bold text-yellow-700">{fmt(totalSemana)}</p>
              </CardContent>
            </Card>
            <Card className="border-gray-200">
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Resto del mes</span>
                  {oblFuturo.length > 0 && <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">{oblFuturo.length}</Badge>}
                </div>
                <p className="text-xl font-bold text-foreground">{fmt(totalFuturo)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Lista pendientes */}
          {oblVisible.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
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
                    const pendingCount = ob.grupo_cuota ? (grupoCounts[ob.grupo_cuota] ?? 1) : 1;
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
                          <span className="truncate max-w-[180px] inline-block align-middle">{ob.concepto}</span>
                          {pendingCount > 1 && (
                            <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">+{pendingCount - 1} más</Badge>
                          )}
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
                                setEditForm({ concepto: ob.concepto, tipo: ob.tipo, moneda: (ob.moneda ?? "ARS") as "ARS" | "USD", monto: String(ob.monto), fechaVencimiento: ob.fecha_vencimiento, notas: ob.notas ?? "" });
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
              </table>
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
                  <Label>Cuotas</Label>
                  <Input
                    type="number" min="1" max="60" step="1"
                    value={oblForm.mensual ? "12" : oblForm.cuotas}
                    disabled={oblForm.mensual}
                    onChange={e => setOblForm(f => ({ ...f, cuotas: e.target.value }))}
                    placeholder="1"
                  />
                  <p className="text-[10px] text-muted-foreground">1 = sin cuotas. Fechas mensuales consecutivas.</p>
                </div>
              </div>
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
                {addOblMutation.isPending ? "Guardando..." : oblForm.mensual ? "Crear 12 meses" : (parseInt(oblForm.cuotas) > 1 ? `Crear ${oblForm.cuotas} cuotas` : "Guardar")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog: pagar obligación */}
        <Dialog open={pagarOblOpen} onOpenChange={v => { setPagarOblOpen(v); if (!v) { setPagarObl(null); setPagarCuentaId(null); setPagarMonto(""); setPagarCotizacion(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Registrar pago</DialogTitle></DialogHeader>
            <div className="py-2 space-y-3">
              {pagarObl && (() => {
                const isUSD = (pagarObl.moneda ?? "ARS") === "USD";
                const cotz = parseFloat(pagarCotizacion) || 0;
                const montoNum = parseFloat(pagarMonto) || 0;
                const pendiente = pagarObl.monto - montoNum;
                const isPartial = montoNum > 0 && montoNum < pagarObl.monto;
                const totalARS = isUSD ? montoNum * cotz : montoNum;
                return (
                  <>
                    <p className="text-sm font-medium">
                      {pagarObl.concepto} — <span className="text-red-700">{isUSD ? `USD ${pagarObl.monto.toLocaleString("es-AR")}` : fmt(pagarObl.monto)}</span>
                    </p>
                    <div className="space-y-1">
                      <Label className="text-xs">Monto pagado ({isUSD ? "USD" : "ARS $"})</Label>
                      <Input type="number" min="0" step="0.01" value={pagarMonto} onChange={e => setPagarMonto(e.target.value)} />
                      {isPartial && (
                        <p className="text-xs text-amber-600 font-medium">
                          Pago parcial — queda pendiente: {isUSD ? `USD ${(pendiente).toLocaleString("es-AR", {minimumFractionDigits: 2})}` : fmt(pendiente)}
                        </p>
                      )}
                    </div>
                    {isUSD && (
                      <div className="space-y-1">
                        <Label className="text-xs">Cotización USD → ARS <span className="text-red-500">*</span></Label>
                        <Input type="number" min="0" step="1" value={pagarCotizacion} onChange={e => setPagarCotizacion(e.target.value)} placeholder="Ej: 1200" />
                        {montoNum > 0 && cotz > 0 && (
                          <p className="text-xs text-muted-foreground">Total en ARS: {fmt(totalARS)}</p>
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
                      <p className="text-[10px] text-muted-foreground">MP: el saldo se refleja por el feed automático.</p>
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

        {/* ── Cheques en cartera ────────────────────────────────────────── */}
        {chequesEnCartera.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">Cheques en cartera</h2>
              <Badge variant="secondary">{chequesEnCartera.length}</Badge>
              <span className="text-sm text-muted-foreground ml-auto font-medium">
                Total: {fmt(chequesEnCartera.reduce((s, c) => s + c.monto, 0))}
              </span>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
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
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{ch.fecha_cobro.slice(5).replace("-","/")}/{ch.fecha_cobro.slice(0,4).slice(2)}</td>
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
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

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
                <Label className="text-xs">Socio que retira</Label>
                <Select value={form.socioId != null ? String(form.socioId) : "_none"}
                  onValueChange={v => setForm(f => ({ ...f, socioId: v === "_none" ? null : Number(v) }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Sin asignar</SelectItem>
                    {(socios ?? []).filter((s: any) => s.activo).map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
