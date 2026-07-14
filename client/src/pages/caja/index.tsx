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
  ChevronDown, ChevronUp, Users, Calendar, ArrowLeftRight, X,
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

// ── Rediseño Caja (Claude Design) ─────────────────────────────────────────────
// CSS portado de diseno-caja/*.html. Clases prefijadas `crx-` con colores literales
// (no CSS vars) para que apliquen también dentro de los modales portaleados fuera de .caja-rx.
const CAJA_RX_CSS = `
.caja-rx{background:#f4f4f1;min-height:100%;padding:28px 22px 56px;font-family:'Inter',system-ui,sans-serif;color:#1e2420;}
.caja-rx *{box-sizing:border-box;}
.crx-wrap{max-width:1120px;margin:0 auto;display:flex;flex-direction:column;gap:30px;}
.crx-num{font-family:'Bricolage Grotesque','Inter',sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.crx-pagetitle{font-family:'Bricolage Grotesque';font-size:27px;font-weight:700;letter-spacing:-.02em;margin:0;}
.crx-seclabel{font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#9a9e96;margin:0 0 12px 2px;}
.crx-h2{font-family:'Bricolage Grotesque';font-size:22px;font-weight:700;margin:0;letter-spacing:-.01em;color:#1e2420;}
.crx-sechead{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;gap:16px;flex-wrap:wrap;}
.crx-block{display:flex;flex-direction:column;}
.crx-addbtn{background:#fff;border:1px solid #ecece8;color:#1e2420;font-family:'Inter';font-size:13px;font-weight:500;padding:9px 14px;border-radius:10px;cursor:pointer;display:flex;align-items:center;gap:7px;}
.crx-addbtn:hover{border-color:#d6d6d1;}
.crx-navbtn{width:31px;height:31px;border-radius:8px;border:1px solid #ecece8;background:#fff;color:#1e2420;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.crx-navbtn:hover:not(:disabled){border-color:#cfcfc9;background:#f6f6f2;}
.crx-navbtn:disabled{opacity:.35;cursor:default;}
.crx-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
@media(max-width:640px){.crx-grid2{grid-template-columns:1fr;}}

/* Efectivo banner */
.crx-efectivo{background:linear-gradient(140deg,#6d9130 0%,#4f6d1f 100%);border-radius:20px;padding:26px 30px;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:20px;box-shadow:0 6px 20px -10px rgba(79,109,31,.55);}
.crx-efectivo .l{display:flex;flex-direction:column;gap:6px;}
.crx-efectivo .cap{font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.78);display:flex;align-items:center;gap:8px;}
.crx-efectivo .val{font-size:44px;font-weight:700;line-height:1;}
.crx-efectivo .sub{font-size:13px;color:rgba(255,255,255,.72);}
.crx-editbtn{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28);color:#fff;font-family:'Inter';font-size:13px;font-weight:500;padding:9px 14px;border-radius:10px;cursor:pointer;display:flex;align-items:center;gap:7px;transition:background .15s;flex:0 0 auto;}
.crx-editbtn:hover{background:rgba(255,255,255,.26);}

/* cards por cobrar / pagar */
.crx-card{background:#fff;border:1px solid #ecece8;border-radius:16px;padding:20px 22px;position:relative;overflow:hidden;}
.crx-card.green::before,.crx-card.coral::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;}
.crx-card.green::before{background:#6b8a2a;}
.crx-card.coral::before{background:#c05e42;}
.crx-card .head{display:flex;align-items:center;gap:9px;color:#8b8f88;font-size:14px;font-weight:500;margin-bottom:14px;}
.crx-card .ico{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
.crx-card.green .ico{background:#eef3e3;color:#5f8020;}
.crx-card.coral .ico{background:#f8ede8;color:#c05e42;}
.crx-card .amount{font-size:30px;font-weight:700;line-height:1;}
.crx-card.green .amount{color:#5f8020;}
.crx-card.coral .amount{color:#c05e42;}
.crx-card .foot{font-size:12.5px;color:#8b8f88;margin-top:9px;}

/* filtros vencimientos */
.crx-filters{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px;}
@media(max-width:640px){.crx-filters{grid-template-columns:1fr;}}
.crx-fcard{background:#fff;border:1.5px solid #ecece8;border-radius:16px;padding:15px 18px;cursor:pointer;transition:.15s;text-align:left;font-family:inherit;}
.crx-fcard:hover{border-color:#d6d6d1;}
.crx-fcard.active.vencido{border-color:#bf4a35;background:#fbf1ef;}
.crx-fcard.active.semana{border-color:#c08a1e;background:#f9f1de;}
.crx-fcard.active.futuro{border-color:#6b8a2a;background:#eef3e3;}
.crx-ftop{display:flex;align-items:center;justify-content:space-between;margin-bottom:11px;}
.crx-flabel{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;}
.crx-fcard.vencido .crx-flabel{color:#bf4a35;}
.crx-fcard.semana .crx-flabel{color:#c08a1e;}
.crx-fcard.futuro .crx-flabel{color:#5f8020;}
.crx-fbadge{font-size:12px;font-weight:600;padding:2px 9px;border-radius:20px;color:#fff;}
.crx-fcard.vencido .crx-fbadge{background:#bf4a35;}
.crx-fcard.semana .crx-fbadge{background:#c08a1e;}
.crx-fcard.futuro .crx-fbadge{background:#6b8a2a;}
.crx-fars{font-size:23px;font-weight:700;line-height:1.1;}
.crx-fusd{font-size:13px;color:#8b8f88;margin-top:2px;font-weight:500;}

/* listas */
.crx-list{background:#fff;border:1px solid #ecece8;border-radius:16px;overflow:hidden;}
.crx-lhead{padding:13px 20px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#9a9e96;border-bottom:1px solid #f1f1ee;}
.crx-lhead .r{text-align:right;}
.crx-row{padding:15px 20px;border-top:1px solid #f4f4f1;}
.crx-row:first-of-type{border-top:none;}
.crx-obl-grid{display:grid;grid-template-columns:88px minmax(0,1fr) 118px 144px 184px;align-items:center;gap:12px;}
.crx-ract{flex-wrap:nowrap;}
.crx-chq-grid{display:grid;grid-template-columns:96px minmax(0,1fr) 150px 270px;align-items:center;gap:12px;}
.crx-rdate{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:500;white-space:nowrap;}
.crx-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;}
.crx-dot.vencido,.crx-dot.venc{background:#bf4a35;}
.crx-dot.semana{background:#c08a1e;}
.crx-dot.futuro,.crx-dot.fut{background:#6b8a2a;}
.crx-rconcept{font-size:14.5px;font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;}
.crx-rconcept .tt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.crx-parcial{font-size:11px;font-weight:600;color:#c08a1e;background:#f9f1de;padding:2px 8px;border-radius:20px;flex:0 0 auto;}
.crx-pill{font-size:12px;font-weight:600;padding:3px 11px;border-radius:20px;justify-self:start;white-space:nowrap;}
.crx-ramount{text-align:right;font-size:15px;font-weight:700;white-space:nowrap;}
.crx-ramount.vencido{color:#bf4a35;}
.crx-ract{display:flex;align-items:center;justify-content:flex-end;gap:6px;}
.crx-pay{background:#eef3e3;color:#5f8020;border:none;font-family:'Inter';font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:5px;}
.crx-pay:hover{background:#e4eed3;}
.crx-btnp{background:#eef3e3;color:#5f8020;border:none;font-family:'Inter';font-size:12.5px;font-weight:600;padding:6px 13px;border-radius:8px;cursor:pointer;}
.crx-btnp:hover{background:#e4eed3;}
.crx-btns{background:#fff;color:#1e2420;border:1px solid #ecece8;font-family:'Inter';font-size:12.5px;font-weight:500;padding:6px 12px;border-radius:8px;cursor:pointer;}
.crx-btns:hover{border-color:#cfcfc9;background:#f8f8f5;}
.crx-iconbtn{background:none;border:none;color:#b3b6ae;cursor:pointer;padding:4px;border-radius:6px;display:flex;}
.crx-iconbtn:hover{color:#1e2420;background:#f2f2ef;}
.crx-iconbtn.del:hover{color:#bf4a35;}
.crx-empty{padding:34px 20px;text-align:center;color:#8b8f88;font-size:14px;}

/* cheques en cartera */
.crx-count{font-size:12px;font-weight:600;color:#5f8020;background:#eef3e3;padding:3px 10px;border-radius:20px;}
.crx-totalwrap{display:flex;align-items:center;gap:14px;}
.crx-totalbox{text-align:right;}
.crx-totalbox .cap{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#9a9e96;}
.crx-totalbox .val{font-size:26px;font-weight:700;color:#5f8020;line-height:1.1;}
.crx-weekbar{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#fbfaf7;border:1px solid #ecece8;border-radius:12px;margin-bottom:14px;gap:12px;}
.crx-weeknav{display:flex;align-items:center;gap:14px;}
.crx-weekrange{display:flex;flex-direction:column;line-height:1.15;}
.crx-weekrange .rg{font-family:'Bricolage Grotesque';font-size:16px;font-weight:600;}
.crx-weekrange .hint{font-size:11.5px;color:#8b8f88;}
.crx-weeksum{text-align:right;}
.crx-weeksum .s{font-size:16px;font-weight:700;}
.crx-weeksum .c{font-size:11.5px;color:#8b8f88;}
.crx-who{display:flex;align-items:center;min-width:0;}
.crx-whopill{display:inline-flex;align-items:center;max-width:100%;background:#eef3e3;color:#5f8020;font-size:13.5px;font-weight:600;padding:5px 14px;border-radius:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

/* cartera vs emisiones (ChequesFlow) */
.crx-panel{background:#fff;border:1px solid #ecece8;border-radius:18px;padding:24px 26px;}
.crx-titlewrap{display:flex;align-items:center;gap:13px;}
.crx-ticon{width:40px;height:40px;border-radius:12px;background:#eef3e3;color:#5f8020;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
.crx-titlewrap .sub{font-size:12.5px;color:#8b8f88;margin:1px 0 0;}
.crx-wknav{display:flex;align-items:center;gap:12px;}
.crx-wkrange{display:flex;flex-direction:column;align-items:center;line-height:1.15;min-width:104px;}
.crx-wkrange .rg{font-family:'Bricolage Grotesque';font-size:15px;font-weight:600;}
.crx-wkrange .hint{font-size:11px;color:#8b8f88;}
.crx-sums{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:24px;}
@media(max-width:640px){.crx-sums{grid-template-columns:1fr;}}
.crx-sumcard{border-radius:14px;padding:16px 18px;}
.crx-sumcard.acr{background:#eef3e3;}
.crx-sumcard.deb{background:#f8ede8;}
.crx-sumcard .lab{font-size:11.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;margin-bottom:9px;}
.crx-sumcard.acr .lab{color:#5f8020;}
.crx-sumcard.deb .lab{color:#b0553f;}
.crx-sumcard .amt{font-size:25px;font-weight:700;line-height:1;}
.crx-sumcard.acr .amt{color:#5f8020;}
.crx-sumcard.deb .amt{color:#b0553f;}
.crx-sumcard .sub{font-size:12px;margin-top:6px;color:#8b8f88;}
.crx-cols{display:grid;grid-template-columns:1fr 1fr;}
@media(max-width:640px){.crx-cols{grid-template-columns:1fr;}.crx-col.deb{padding-left:0!important;border-left:none!important;padding-top:16px;}}
.crx-col.acr{padding-right:28px;}
.crx-col.deb{padding-left:28px;border-left:1px solid #f0f0ec;}
.crx-colhead{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#9a9e96;margin-bottom:6px;}
.crx-cdot{width:8px;height:8px;border-radius:50%;}
.crx-col.acr .crx-cdot{background:#6b8a2a;}
.crx-col.deb .crx-cdot{background:#c05e42;}
.crx-flowrow{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;padding:12px 0;border-top:1px solid #f4f4f1;}
.crx-fdate{display:flex;flex-direction:column;line-height:1.2;min-width:52px;}
.crx-fdate .imp{font-size:13.5px;font-weight:600;}
.crx-fdate .chq{font-size:11px;color:#8b8f88;}
.crx-fname{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.crx-fname .ok{font-size:11px;color:#5f8020;font-weight:600;margin-left:6px;}
.crx-famt{font-weight:700;font-size:14.5px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;}
.crx-famt.done{color:#9a9e96;text-decoration:line-through;}
.crx-coltotal{display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:13px;border-top:1.5px solid #eaeae6;}
.crx-coltotal .l{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#9a9e96;}
.crx-coltotal .v{font-family:'Bricolage Grotesque';font-size:17px;font-weight:700;font-variant-numeric:tabular-nums;}
.crx-col.acr .crx-coltotal .v{color:#5f8020;}
.crx-col.deb .crx-coltotal .v{color:#b0553f;}
.crx-flowfoot{margin-top:22px;padding-top:15px;border-top:1px solid #f1f1ee;font-size:12px;color:#8b8f88;line-height:1.55;}
.crx-flowempty{padding:20px 0;color:#8b8f88;font-size:13px;}

/* control bar + egresos */
.crx-ctrlbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;gap:14px;flex-wrap:wrap;}
.crx-ctrlleft{display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
.crx-seg{display:inline-flex;background:#ecece6;border-radius:10px;padding:3px;}
.crx-seg button{border:none;background:none;font-family:'Inter';font-size:13px;font-weight:500;color:#8b8f88;padding:6px 16px;border-radius:8px;cursor:pointer;}
.crx-seg button.active{background:#fff;color:#1e2420;box-shadow:0 1px 2px rgba(0,0,0,.07);}
.crx-monthnav{display:inline-flex;align-items:center;gap:8px;}
.crx-mlabel{font-family:'Bricolage Grotesque';font-size:15px;font-weight:600;min-width:118px;text-align:center;}
.crx-addsolid{background:#6b8a2a;color:#fff;border:none;font-family:'Inter';font-size:13px;font-weight:500;padding:9px 16px;border-radius:10px;cursor:pointer;display:flex;align-items:center;gap:7px;}
.crx-addsolid:hover{background:#5f7d24;}
.crx-panelcard{background:#fff;border:1px solid #ecece8;border-radius:18px;padding:24px 26px;}
.crx-panelcard h2{font-family:'Bricolage Grotesque';font-size:19px;font-weight:700;margin:0 0 2px;letter-spacing:-.01em;}
.crx-per{font-size:12.5px;color:#8b8f88;margin:0 0 20px;}
.crx-egrid{display:flex;gap:34px;align-items:center;flex-wrap:wrap;}
.crx-donutwrap{position:relative;width:184px;height:184px;flex:0 0 auto;}
.crx-donut{width:100%;height:100%;border-radius:50%;}
.crx-donuthole{position:absolute;inset:27px;background:#fff;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;}
.crx-donuthole .t{font-size:10.5px;color:#9a9e96;text-transform:uppercase;letter-spacing:.06em;}
.crx-donuthole .v{font-family:'Bricolage Grotesque';font-size:19px;font-weight:700;color:#c05e42;}
.crx-legend{flex:1;min-width:240px;}
.crx-leg{display:grid;grid-template-columns:14px 1fr 40px 104px;align-items:center;gap:11px;padding:6px 0;border-bottom:1px solid #f5f5f2;font-size:13.5px;}
.crx-leg:last-child{border-bottom:none;}
.crx-legdot{width:10px;height:10px;border-radius:3px;}
.crx-legname{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.crx-legpct{color:#8b8f88;font-size:12px;text-align:right;}
.crx-legamt{font-weight:600;text-align:right;font-variant-numeric:tabular-nums;}
.crx-totalrow{display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:15px;border-top:1.5px solid #eaeae6;}
.crx-totalrow .tl{font-size:13.5px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:#9a9e96;}
.crx-totalrow .tv{font-family:'Bricolage Grotesque';font-size:19px;font-weight:700;color:#c05e42;}
.crx-accrow{border-top:1px solid #f4f4f1;}
.crx-accrow:first-child{border-top:none;}
.crx-acchead{display:grid;grid-template-columns:14px 1fr auto 22px;align-items:center;gap:12px;padding:15px 4px;cursor:pointer;background:none;border:none;width:100%;text-align:left;font-family:inherit;}
.crx-acchead .name{font-size:14.5px;font-weight:500;color:#1e2420;}
.crx-acchead .amt{font-weight:700;font-size:15px;font-variant-numeric:tabular-nums;color:#1e2420;}
.crx-acchead .chev{color:#b3b6ae;transition:transform .2s;display:flex;}
.crx-accrow.open .chev{transform:rotate(180deg);}
.crx-accbody{padding:2px 4px 14px 26px;}
.crx-mv{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px;color:#8b8f88;padding:7px 0;border-top:1px dashed #eeeeea;}
.crx-mv:first-child{border-top:none;}
.crx-mv .mtxt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.crx-mv .mamt{font-variant-numeric:tabular-nums;white-space:nowrap;display:flex;align-items:center;gap:6px;}

/* retiros de socios */
.crx-subline{font-size:12.5px;color:#8b8f88;margin:0 0 20px;}
.crx-subline b{color:#1e2420;font-weight:600;}
.crx-retgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;}
.crx-socio{background:#fff;border:1px solid #ecece8;border-radius:16px;padding:20px 22px;cursor:pointer;transition:border-color .15s,box-shadow .15s;text-align:left;font-family:inherit;width:100%;}
.crx-socio:hover{border-color:#dcc7d5;box-shadow:0 4px 14px -8px rgba(168,107,138,.4);}
.crx-stop{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:10px;}
.crx-sname{display:flex;align-items:center;gap:11px;font-size:14.5px;font-weight:500;min-width:0;}
.crx-sname .tt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.crx-sav{width:30px;height:30px;border-radius:50%;background:#f3ebf0;color:#a86b8a;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
.crx-spct{font-size:13px;font-weight:600;color:#a86b8a;flex:0 0 auto;}
.crx-samt{font-size:26px;font-weight:700;line-height:1;margin-bottom:15px;}
.crx-bar{height:8px;background:#f0edf0;border-radius:20px;overflow:hidden;}
.crx-fill{height:100%;background:#a86b8a;border-radius:20px;}
.crx-seemore{font-size:11.5px;color:#8b8f88;margin-top:11px;display:flex;align-items:center;gap:5px;}

/* modal retiros (dentro del Dialog shadcn) */
.crx-modalhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:10px;}
.crx-modalhead h3{font-family:'Bricolage Grotesque';font-size:19px;font-weight:700;margin:0;letter-spacing:-.01em;}
.crx-mrow{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-top:1px solid #f4f4f1;font-size:14px;}
.crx-mrow:first-of-type{border-top:none;}
.crx-mrow .mv{font-weight:600;font-variant-numeric:tabular-nums;}
.crx-mtotal{display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:14px;border-top:1.5px solid #eaeae6;}
.crx-mtotal .l{font-weight:700;font-size:14.5px;}
.crx-mtotal .v{font-family:'Bricolage Grotesque';font-size:18px;font-weight:700;color:#a86b8a;}
`;

// Paleta tierra/oliva apagada del donut (de diseno-caja/caja-rediseno-parte4.html)
const CRX_PIE_COLORS = [
  "#6b8a2a","#c8894a","#cbb23f","#7ba05a","#5f8020","#6a9b8f","#a86b8a","#9c7bb0",
  "#c26247","#8a8f88","#b5985a","#d98c40","#7d8b5a","#b0553f","#6a8f8a","#a3b565",
];

// Color de la pill de categoría de obligación (según diseno parte2)
function crxPillStyle(tipo: string): React.CSSProperties {
  const t = (tipo || "").toLowerCase();
  if (t.includes("cuota")) return { background: "#e9eff7", color: "#3a67a3" };
  if (t.includes("alquiler")) return { background: "#f9f1de", color: "#c08a1e" };
  if (t.includes("impuesto")) return { background: "#efeaf7", color: "#6a4a95" };
  if (t.includes("servicio")) return { background: "#e3f0ea", color: "#2f7a5f" };
  if (t.includes("sueldo")) return { background: "#efeaf7", color: "#6a4a95" };
  if (t.includes("proveedor")) return { background: "#f8ede8", color: "#c05e42" };
  return { background: "#eef0ec", color: "#6a6f66" };
}

function crxInitials(name: string): string {
  const p = (name || "").replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ ]/g, "").trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || p[0]?.[1] || "")).toUpperCase();
}

// Lunes de la semana de una fecha (YYYY-MM-DD) — para agrupar cheques por semana de cobro
function crxMonday(ymd: string): Date {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const g = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - g);
  dt.setHours(0, 0, 0, 0);
  return dt;
}
const crxWeekKey = (dt: Date) => `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
const CRX_MESES_ABBR = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
function crxWeekRange(ws: Date): string {
  const we = new Date(ws); we.setDate(we.getDate() + 6);
  const d1 = ws.getDate(), m1 = CRX_MESES_ABBR[ws.getMonth()], d2 = we.getDate(), m2 = CRX_MESES_ABBR[we.getMonth()];
  return m1 === m2 ? `${d1} – ${d2} ${m1}` : `${d1} ${m1} – ${d2} ${m2}`;
}

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

  // Rediseño: filtro de vencimientos (sección 2) y semana de cheques en cartera (sección 4)
  const [oblFilter, setOblFilter] = useState<"vencido" | "semana" | "futuro">("vencido");
  const [chequeWeekIdx, setChequeWeekIdx] = useState<number | null>(null);

  // Cheques
  const [depositarChequeOpen, setDepositarChequeOpen] = useState(false);
  const [endosarChequeOpen, setEndosarChequeOpen] = useState(false);
  const [activeCheque, setActiveCheque] = useState<Cheque | null>(null);
  const [chequeComision, setChequeComision] = useState("");
  const [chequeEndosarA, setChequeEndosarA] = useState("");
  const [chequeEndosarGasto, setChequeEndosarGasto] = useState(false);
  const [chequeEndosarCategoria, setChequeEndosarCategoria] = useState("");
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

  // Sección 4: cheques en cartera agrupados por semana de FECHA DE COBRO (navegación bidireccional).
  const chequeWeeks = useMemo(() => {
    const map: Record<string, { ws: Date; items: Cheque[] }> = {};
    for (const c of chequesEnCartera) {
      const mon = crxMonday(c.fecha_cobro);
      const k = crxWeekKey(mon);
      (map[k] = map[k] ?? { ws: mon, items: [] }).items.push(c);
    }
    return Object.values(map)
      .sort((a, b) => a.ws.getTime() - b.ws.getTime())
      .map(w => ({ ...w, items: w.items.slice().sort((a, b) => a.fecha_cobro.localeCompare(b.fecha_cobro)) }));
  }, [chequesEnCartera]);
  const chequeCurrentWeekIdx = useMemo(() => {
    if (chequeWeeks.length === 0) return 0;
    const todayMon = crxWeekKey(crxMonday(new Date().toISOString().slice(0, 10)));
    const i = chequeWeeks.findIndex(w => crxWeekKey(w.ws) === todayMon);
    if (i >= 0) return i;
    // sin cheques esta semana: primera semana con cobro >= hoy, si no la última
    const future = chequeWeeks.findIndex(w => crxWeekKey(w.ws) >= todayMon);
    return future >= 0 ? future : chequeWeeks.length - 1;
  }, [chequeWeeks]);

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
    mutationFn: ({ id, contraparte, gastoCategoria, gastoFecha }: { id: number; contraparte: string; gastoCategoria: string | null; gastoFecha: string }) =>
      apiRequest("PATCH", `/api/caja/cheques/${id}`, { accion: "endosar", contraparte, gastoCategoria, gastoFecha }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/cheques"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/cuentas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/summary"] });
      setEndosarChequeOpen(false); setActiveCheque(null); setChequeEndosarA("");
      setChequeEndosarGasto(false); setChequeEndosarCategoria("");
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

  // Se FILTRAN de la vista las obligaciones tipo 'proveedor' (no se borran de la base) — la deuda
  // a proveedores ya vive en su propia card. Cards de resumen y lista excluyen 'proveedor' para cuadrar.
  const oblPendientes = useMemo(
    () => (obligaciones ?? []).filter((o: Obligacion) => o.estado === "pendiente" && o.tipo !== "proveedor"),
    [obligaciones],
  );

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
      // Retención impositiva: el cliente la pagó (a AFIP, no a mí) → queda como cobro (ingreso),
      // y además es un gasto impositivo para mí → suma como egreso "Retenciones impositivas".
      // Nunca se cruzan en un mismo gráfico (RETENCION no entra en el desglose por método).
      if ((p.method ?? "").toUpperCase() === "RETENCION") {
        items.push({
          id: `ret-${p.id}`,
          date: p.date,
          description: "Retención impositiva",
          counterpart: p.customerName,
          method: p.method,
          category: "Retenciones impositivas",
          type: "egreso",
          amount: parseFloat(p.amount),
          sourceType: "payment",
          sourceId: p.id,
          isBankSync: false,
        });
      }
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

  // Accordion: egresos agrupados por categoría del período.
  // Excluye lo mismo que la dona (afecta_egresos=false): retiros, banco propio, mercadería,
  // pago a proveedor, cheque rechazado — no son gastos operativos.
  const categoriaData = useMemo(() => {
    const map: Record<string, { total: number; items: FeedItem[] }> = {};
    for (const item of feed) {
      if (item.type !== "egreso") continue;
      if (isExcludedFromPie(item.category)) continue;
      if (!map[item.category]) map[item.category] = { total: 0, items: [] };
      map[item.category].total += item.amount;
      map[item.category].items.push(item);
    }
    return Object.entries(map)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([cat, d]) => ({ cat, total: d.total, items: d.items.sort((a, b) => b.date.localeCompare(a.date)) }));
  }, [feed, afectaEgresosMap]);

  const bankCatNames = (bankCats ?? []).map(c => c.name);

  return (
    <Layout>
      <div className="caja-rx">
        <style>{CAJA_RX_CSS}</style>
        <div className="crx-wrap">
          <h1 className="crx-pagetitle">Caja</h1>

          {/* ── Sección 1 — Efectivo + Por cobrar + Por pagar ───────────────── */}
          {(() => {
            const efc = (cuentas ?? []).find(c => c.tipo === "efectivo");
            const saldoEf = efc ? getSaldoActual(efc) : null;
            return (
              <div className="crx-efectivo">
                <div className="l">
                  <div className="cap"><Wallet className="h-3.5 w-3.5" /> Efectivo en caja</div>
                  <div className="val crx-num">{saldoEf == null ? "…" : fmt(saldoEf)}</div>
                  <div className="sub">Plata líquida en mano · actualizado hoy</div>
                </div>
                <button className="crx-editbtn" disabled={!efc}
                  onClick={() => { if (!efc) return; setEditCuenta(efc); setEditSaldo(String(efc.saldo_base ?? 0)); setEditCuentaOpen(true); }}>
                  <Pencil className="h-3.5 w-3.5" /> Editar saldo
                </button>
              </div>
            );
          })()}

          {/* Por cobrar */}
          <div className="crx-block">
            <p className="crx-seclabel">Por cobrar</p>
            <div className="crx-grid2">
              <div className="crx-card green">
                <div className="head"><span className="ico"><CreditCard className="h-4 w-4" /></span> Cheques en cartera</div>
                <div className="amount crx-num">{fmt(chequesEnCarteraTotal)}</div>
                <div className="foot">{chequesEnCartera.length} recibido{chequesEnCartera.length !== 1 ? "s" : ""} por cobrar</div>
              </div>
              <div className="crx-card green">
                <div className="head"><span className="ico"><Users className="h-4 w-4" /></span> Deuda de clientes</div>
                <div className="amount crx-num">{deudaStats ? fmt(deudaStats.deudaClientes) : "…"}</div>
                <div className="foot">a cobrar de clientes activos</div>
              </div>
            </div>
          </div>

          {/* Por pagar */}
          <div className="crx-block">
            <p className="crx-seclabel">Por pagar</p>
            <div className="crx-grid2">
              <div className="crx-card coral">
                <div className="head"><span className="ico"><CreditCard className="h-4 w-4" /></span> Cheques emitidos</div>
                <div className="amount crx-num">{fmt(chequesEmitidosTotal)}</div>
                <div className="foot">comprometido, aún no salió de Galicia</div>
              </div>
              <div className="crx-card coral">
                <div className="head"><span className="ico"><Building2 className="h-4 w-4" /></span> Deuda a proveedores</div>
                <div className="amount crx-num">{deudaStats ? fmt(deudaStats.deudaProveedores) : "…"}</div>
                <div className="foot">compras pendientes de pago</div>
              </div>
            </div>
          </div>

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

        {/* ── Sección 2 — Próximos pagos y vencimientos ──────────────────── */}
        <div className="crx-block">
          <div className="crx-sechead">
            <h2 className="crx-h2">Próximos pagos y vencimientos</h2>
            <button className="crx-addbtn" onClick={() => { setOblForm(emptyOblForm()); setOblDialogOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> Agregar obligación
            </button>
          </div>

          {/* Filtros clickeables (recalculados EXCLUYENDO 'proveedor') */}
          <div className="crx-filters">
            {([
              { g: "vencido" as const, label: "Vencido", icon: <AlertCircle className="h-3.5 w-3.5" />, count: oblVencido.length, tot: totVencido },
              { g: "semana" as const, label: "Esta semana", icon: <Clock className="h-3.5 w-3.5" />, count: oblSemana.length, tot: totSemana },
              { g: "futuro" as const, label: "Próximos 30 días", icon: <Calendar className="h-3.5 w-3.5" />, count: oblFuturo.length, tot: totFuturo },
            ]).map(f => (
              <button key={f.g} className={`crx-fcard ${f.g}${oblFilter === f.g ? " active" : ""}`} onClick={() => setOblFilter(f.g)}>
                <div className="crx-ftop">
                  <span className="crx-flabel">{f.icon}{f.label}</span>
                  <span className="crx-fbadge">{f.count}</span>
                </div>
                <div className="crx-fars crx-num">{fmt(f.tot.ars)}</div>
                {f.tot.usd > 0 && <div className="crx-fusd crx-num">USD {f.tot.usd.toLocaleString("es-AR")}</div>}
              </button>
            ))}
          </div>

          {/* Lista del grupo seleccionado */}
          {(() => {
            const groups: Record<typeof oblFilter, Obligacion[]> = { vencido: oblVencido, semana: oblSemana, futuro: oblFuturo };
            const items = (groups[oblFilter] as Obligacion[]).slice().sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento));
            return (
              <div className="crx-list">
                <div className="crx-lhead crx-obl-grid">
                  <span>Vencimiento</span><span>Concepto</span><span>Categoría</span><span className="r">Monto</span><span></span>
                </div>
                {items.length === 0 ? (
                  <div className="crx-empty">No hay vencimientos en este período.</div>
                ) : items.map(ob => {
                  const sem = oblSemaforoClass(ob.fecha_vencimiento);
                  const isUSD = (ob.moneda ?? "ARS") === "USD";
                  return (
                    <div key={ob.id} className="crx-row crx-obl-grid">
                      <div className="crx-rdate"><span className={`crx-dot ${sem}`} />{ob.fecha_vencimiento.slice(5).split("-").reverse().join("/")}</div>
                      <div className="crx-rconcept"><span className="tt">{oblLabel(ob)}</span>{ob.pago_parcial && <span className="crx-parcial">pago parcial</span>}</div>
                      <span className="crx-pill" style={crxPillStyle(ob.tipo)}>{ob.tipo}</span>
                      <div className={`crx-ramount${sem === "vencido" ? " vencido" : ""}`}>{isUSD ? `USD ${ob.monto.toLocaleString("es-AR")}` : fmt(ob.monto)}</div>
                      <div className="crx-ract">
                        <button className="crx-pay" onClick={() => { setPagarObl(ob); setPagarCuentaId(null); setPagarMonto(String(ob.monto)); setPagarCotizacion(""); setPagarOblOpen(true); }}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Pagar
                        </button>
                        <button className="crx-iconbtn" title="Editar"
                          onClick={() => {
                            setEditObl(ob);
                            setEditForm({ concepto: ob.concepto, tipo: ob.tipo, moneda: (ob.moneda ?? "ARS") as "ARS" | "USD", monto: String(ob.monto), fechaVencimiento: ob.fecha_vencimiento, notas: ob.notas ?? "", pagoParcial: ob.pago_parcial ?? false });
                            setEditTipoCustom(!allTipos.includes(ob.tipo));
                            setEditOblOpen(true);
                          }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button className="crx-iconbtn del" title="Eliminar" onClick={() => delOblMutation.mutate(ob.id)} disabled={delOblMutation.isPending}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

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

        {/* ── Sección 4 — Cheques en cartera (por semana de cobro) ───────── */}
        <div className="crx-block">
          {(() => {
            const total = chequesEnCartera.reduce((s, c) => s + c.monto, 0);
            const hasWeeks = chequeWeeks.length > 0;
            const idx = Math.min(Math.max(chequeWeekIdx ?? chequeCurrentWeekIdx, 0), Math.max(chequeWeeks.length - 1, 0));
            const wk = hasWeeks ? chequeWeeks[idx] : null;
            const todayStr = new Date().toISOString().slice(0, 10);
            const todayMon = crxWeekKey(crxMonday(todayStr));
            const wkSum = wk ? wk.items.reduce((s, c) => s + c.monto, 0) : 0;
            return (
              <>
                <div className="crx-sechead">
                  <div className="crx-titlewrap">
                    <h2 className="crx-h2">Cheques en cartera</h2>
                    <span className="crx-count">{chequesEnCartera.length} cheque{chequesEnCartera.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="crx-totalwrap">
                    <div className="crx-totalbox">
                      <div className="cap">Total en cartera</div>
                      <div className="val crx-num">{fmt(total)}</div>
                    </div>
                    <button className="crx-addbtn" onClick={() => { setChequeForm({ monto: "", fechaCobro: "", contraparte: "", numero: "" }); setAddChequeOpen(true); }}>
                      <Plus className="h-3.5 w-3.5" /> Agregar
                    </button>
                  </div>
                </div>

                {!hasWeeks ? (
                  <div className="crx-list"><div className="crx-empty">No hay cheques en cartera.</div></div>
                ) : (
                  <>
                    <div className="crx-weekbar">
                      <div className="crx-weeknav">
                        <button className="crx-navbtn" disabled={idx === 0} onClick={() => setChequeWeekIdx(Math.max(idx - 1, 0))}><ChevronLeft className="h-4 w-4" /></button>
                        <div className="crx-weekrange">
                          <span className="rg">{crxWeekRange(wk!.ws)}</span>
                          <span className="hint">{crxWeekKey(wk!.ws) === todayMon ? "semana actual" : (crxWeekKey(wk!.ws) < todayMon ? "semana pasada" : "")}</span>
                        </div>
                        <button className="crx-navbtn" disabled={idx >= chequeWeeks.length - 1} onClick={() => setChequeWeekIdx(Math.min(idx + 1, chequeWeeks.length - 1))}><ChevronRight className="h-4 w-4" /></button>
                      </div>
                      <div className="crx-weeksum">
                        <div className="s crx-num">{fmt(wkSum)}</div>
                        <div className="c">{wk!.items.length} cheque{wk!.items.length !== 1 ? "s" : ""}</div>
                      </div>
                    </div>
                    <div className="crx-list">
                      <div className="crx-lhead crx-chq-grid"><span>Cobro</span><span>De quién</span><span className="r">Monto</span><span></span></div>
                      {wk!.items.map(ch => {
                        const venc = ch.fecha_cobro.slice(0, 10) < todayStr;
                        const dd = ch.fecha_cobro.slice(5).split("-").reverse().join("/");
                        return (
                          <div key={ch.id} className="crx-row crx-chq-grid">
                            <div className="crx-rdate"><span className={`crx-dot ${venc ? "venc" : "fut"}`} />{dd}</div>
                            <div className="crx-who"><span className="crx-whopill">{ch.contraparte}</span></div>
                            <div className="crx-ramount">{fmt(ch.monto)}</div>
                            <div className="crx-ract">
                              <button className="crx-btnp" onClick={() => { setActiveCheque(ch); setChequeCuentaDestinoId(null); setChequeComision(""); setDepositarChequeOpen(true); }}>Depositar</button>
                              <button className="crx-btns" onClick={() => { setActiveCheque(ch); setChequeEndosarA(""); setEndosarChequeOpen(true); }}>Endosar</button>
                              <button className="crx-iconbtn" title="Editar" onClick={() => { setActiveCheque(ch); setChequeForm({ monto: String(Math.round(ch.monto)), fechaCobro: ch.fecha_cobro.slice(0, 10), contraparte: ch.contraparte, numero: ch.numero ?? "" }); setEditChequeOpen(true); }}><Pencil className="h-3.5 w-3.5" /></button>
                              <button className="crx-iconbtn del" title="Eliminar" disabled={deleteChequeMut.isPending} onClick={() => { if (window.confirm(`¿Eliminar el cheque de ${ch.contraparte} por ${fmt(ch.monto)}?`)) deleteChequeMut.mutate(ch.id); }}><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            );
          })()}
        </div>

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
        <Dialog open={endosarChequeOpen} onOpenChange={v => { setEndosarChequeOpen(v); if (!v) { setActiveCheque(null); setChequeEndosarA(""); setChequeEndosarGasto(false); setChequeEndosarCategoria(""); } }}>
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
              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input type="checkbox" className="h-4 w-4 accent-purple-700"
                  checked={chequeEndosarGasto}
                  onChange={e => setChequeEndosarGasto(e.target.checked)} />
                <span className="text-xs">Registrar como gasto (egreso por categoría)</span>
              </label>
              {chequeEndosarGasto && (
                <div className="space-y-1">
                  <Label className="text-xs">Categoría del gasto <span className="text-red-500">*</span></Label>
                  <Select value={chequeEndosarCategoria || "_none"} onValueChange={v => setChequeEndosarCategoria(v === "_none" ? "" : v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Elegí una categoría" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Elegí una categoría</SelectItem>
                      {bankCatNames.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">Suma en "Egresos por categoría". No mueve la cuenta de nuevo (ya la descuenta el endoso).</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEndosarChequeOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => activeCheque && endosarMut.mutate({
                  id: activeCheque.id,
                  contraparte: chequeEndosarA || activeCheque.contraparte,
                  gastoCategoria: chequeEndosarGasto ? (chequeEndosarCategoria || null) : null,
                  gastoFecha: todayIso,
                })}
                disabled={endosarMut.isPending || !chequeEndosarA || (chequeEndosarGasto && !chequeEndosarCategoria)}
              >
                {endosarMut.isPending ? "Guardando..." : "Confirmar endoso"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Retiros de socios (malva) ──────────────────────────────────── */}
        <div className="crx-block">
          <div className="crx-sechead" style={{ marginBottom: 6 }}>
            <h2 className="crx-h2">Retiros de socios</h2>
            <button className="crx-addbtn" onClick={() => setRetiroDialogOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Cargar retiro
            </button>
          </div>
          <p className="crx-subline">Total retirado en {label.toLowerCase()} · <b className="crx-num">{fmt(retirosTotalPeriodo)}</b> · tocá un socio para ver el histórico</p>
          {(socios ?? []).filter((s: any) => s.activo).length === 0 ? (
            <p className="crx-subline" style={{ marginBottom: 0 }}>Sin socios activos.</p>
          ) : (
            <div className="crx-retgrid">
              {(socios ?? []).filter((s: any) => s.activo).map((s: any) => {
                const total = retirosBySocio[s.id] ?? 0;
                const pct = retirosTotalPeriodo > 0 ? Math.round((total / retirosTotalPeriodo) * 100) : 0;
                return (
                  <button key={s.id} className="crx-socio" onClick={() => setSocioDetailId(s.id)}>
                    <div className="crx-stop">
                      <span className="crx-sname"><span className="crx-sav">{crxInitials(s.nombre)}</span><span className="tt">{s.nombre}</span></span>
                      <span className="crx-spct">{pct}%</span>
                    </div>
                    <div className="crx-samt crx-num">{fmt(total)}</div>
                    <div className="crx-bar"><div className="crx-fill" style={{ width: `${pct}%` }} /></div>
                    <div className="crx-seemore"><Calendar className="h-3 w-3" /> Ver histórico mensual</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

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
              <DialogContent className="max-w-[440px]">
                <div className="crx-modalhead"><h3>Retiros — {socio?.nombre}</h3></div>
                <div style={{ maxHeight: 340, overflowY: "auto" }}>
                  {meses.length === 0 ? (
                    <p className="crx-subline" style={{ margin: "8px 0", textAlign: "center" }}>Sin retiros registrados.</p>
                  ) : meses.map(([mes, total]) => {
                    const [y, m] = mes.split("-");
                    const label2 = `${MONTHS_ES[parseInt(m) - 1]} ${y}`;
                    return (
                      <div key={mes} className="crx-mrow"><span className="mm">{label2}</span><span className="mv crx-num">{fmt(total as number)}</span></div>
                    );
                  })}
                </div>
                {meses.length > 0 && (
                  <div className="crx-mtotal"><span className="l">Total acumulado</span><span className="v crx-num">{fmt(totalSocio)}</span></div>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
                  <button className="crx-btns" style={{ padding: "9px 18px" }} onClick={() => setSocioDetailId(null)}>Cerrar</button>
                </div>
              </DialogContent>
            </Dialog>
          );
        })()}

        {/* ── Sección 5 — Egresos por categoría + Detalle ─────────────────── */}
        {/* Control bar: selector de período (reubicado) + Agregar movimiento */}
        <div className="crx-ctrlbar">
          <div className="crx-ctrlleft">
            <div className="crx-seg">
              {(["day", "week", "month"] as const).map(p => (
                <button key={p} className={viewMode === p ? "active" : ""}
                  onClick={() => { setViewMode(p); if (p !== "month") setMonthOffset(0); }}>
                  {p === "day" ? "Hoy" : p === "week" ? "Semana" : "Mes"}
                </button>
              ))}
            </div>
            {viewMode === "month" && (
              <div className="crx-monthnav">
                <button className="crx-navbtn" onClick={() => setMonthOffset(o => o - 1)}><ChevronLeft className="h-4 w-4" /></button>
                <span className="crx-mlabel">{label}</span>
                <button className="crx-navbtn" onClick={() => setMonthOffset(o => o + 1)} disabled={monthOffset >= 0}><ChevronRight className="h-4 w-4" /></button>
              </div>
            )}
          </div>
          <button className="crx-addsolid" onClick={() => setDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Agregar movimiento
          </button>
        </div>

        {/* Egresos por categoría (donut conic-gradient) */}
        <div className="crx-panelcard">
          <h2>Egresos por categoría</h2>
          <p className="crx-per">{label}</p>
          {pieData.length === 0 ? (
            <div className="crx-empty">Sin egresos en este período.</div>
          ) : (() => {
            const total = pieData.reduce((a, x) => a + x.value, 0);
            let acc = 0;
            const stops = pieData.map((d, i) => {
              const s = total > 0 ? (acc / total) * 360 : 0; acc += d.value; const e = total > 0 ? (acc / total) * 360 : 0;
              return `${CRX_PIE_COLORS[i % CRX_PIE_COLORS.length]} ${s}deg ${e}deg`;
            }).join(",");
            return (
              <>
                <div className="crx-egrid">
                  <div className="crx-donutwrap">
                    <div className="crx-donut" style={{ background: `conic-gradient(${stops})` }} />
                    <div className="crx-donuthole"><span className="t">Total egresos</span><span className="v crx-num">{fmt(total)}</span></div>
                  </div>
                  <div className="crx-legend">
                    {pieData.map((d, i) => {
                      const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
                      return (
                        <div key={d.name} className="crx-leg">
                          <span className="crx-legdot" style={{ background: CRX_PIE_COLORS[i % CRX_PIE_COLORS.length] }} />
                          <span className="crx-legname">{d.name}</span>
                          <span className="crx-legpct">{pct}%</span>
                          <span className="crx-legamt crx-num">{fmt(d.value)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="crx-totalrow"><span className="tl">Total</span><span className="tv crx-num">{fmt(total)}</span></div>
              </>
            );
          })()}
        </div>

        {/* Detalle por categoría (acordeón) */}
        <div className="crx-panelcard">
          <h2>Detalle por categoría</h2>
          <p className="crx-per">{label}</p>
          {categoriaData.length === 0 ? (
            <div className="crx-empty">Sin egresos en este período.</div>
          ) : categoriaData.map(({ cat, total, items }, ci) => {
            const isOpen = expandedCat === cat;
            const color = CRX_PIE_COLORS[ci % CRX_PIE_COLORS.length];
            return (
              <div key={cat} className={`crx-accrow${isOpen ? " open" : ""}`}>
                <button className="crx-acchead" onClick={() => setExpandedCat(isOpen ? null : cat)}>
                  <span className="crx-legdot" style={{ background: color }} />
                  <span className="name">{cat}</span>
                  <span className="amt crx-num">{fmt(total)}</span>
                  <span className="chev"><ChevronDown className="h-4 w-4" /></span>
                </button>
                {isOpen && (
                  <div className="crx-accbody">
                    {items.map(item => (
                      <div key={item.id} className="crx-mv">
                        <span className="mtxt">{fmtDate(item.date)} · {item.description}{item.counterpart ? ` — ${item.counterpart}` : ""}</span>
                        <span className="mamt crx-num">{fmt(item.amount)}
                          {item.sourceType === "manual" && !item.isBankSync && (
                            <button className="crx-iconbtn del" title="Eliminar" onClick={() => delMutation.mutate(item.sourceId)} disabled={delMutation.isPending}><Trash2 className="h-3 w-3" /></button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </div>
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
