// Dashboard del vendedor. 17/11: estilo del admin (solo presentación; mismas consultas y rangos).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { VendedorLayout } from "./layout";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Users, AlertTriangle, Trophy, ListOrdered, MessageCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart, Line, Legend } from "recharts";
import { fmtPesos } from "@/lib/format";
import { VX_CSS, fmtDiaMes } from "./rx";

const fmt = fmtPesos;

type ExtraData = {
  inactivos: { id: number; name: string; phone: string | null; dias: number; bucket: "naranja" | "roja" }[];
  ventasPorDia: { dia: string; total: number }[];
  ultimosPedidos: { id: number; folio: string; fecha: string; status: string; cliente: string; total: number }[];
  topClientes: { id: number; name: string; total: number }[];
};

function localStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayRange(): [string, string] {
  const d = new Date();
  return [localStr(d), localStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))];
}
function weekRange(): [string, string] {
  const d = new Date();
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return [localStr(mon), localStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff + 7))];
}
function monthRange(): [string, string] {
  const d = new Date();
  return [
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
    localStr(new Date(d.getFullYear(), d.getMonth() + 1, 1)),
  ];
}
function yearRange(): [string, string] {
  const y = new Date().getFullYear();
  return [`${y}-01-01`, `${y + 1}-01-01`];
}

type VendedorStats = { ventas: number; comisiones: number; comisionTotal: number; comisionPendiente: number; clientesAsignados: number };
type MonthlyData = { month: string; label: string; facturacion: number; comisiones: number; comisionTotal: number }[];
const SERIE: Record<string, string> = { facturacion: "Facturación", comisiones: "Comisión habilitada", comisionTotal: "Comisión total" };
type RangeMode = "hoy" | "semana" | "mes" | "pormes" | "año" | "rango";

function currentYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthRangeFromStr(ym: string): [string, string] {
  const [y, m] = ym.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return [`${ym}-01`, next];
}

function getRange(mode: RangeMode, customFrom: string, customTo: string, selectedMonth: string): [string, string] {
  if (mode === "hoy") return todayRange();
  if (mode === "semana") return weekRange();
  if (mode === "mes") return monthRange();
  if (mode === "pormes") return monthRangeFromStr(selectedMonth);
  if (mode === "año") return yearRange();
  return [customFrom, customTo];
}

const RANGE_BTNS: { label: string; value: RangeMode }[] = [
  { label: "Hoy", value: "hoy" },
  { label: "Semana", value: "semana" },
  { label: "Mes", value: "mes" },
  { label: "Por mes", value: "pormes" },
  { label: "Año", value: "año" },
  { label: "Rango", value: "rango" },
];

export default function VendedorDashboard() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<RangeMode>("mes");
  const [customFrom, setCustomFrom] = useState(localStr(new Date()));
  const [customTo, setCustomTo] = useState(localStr(new Date()));
  const [selectedMonth, setSelectedMonth] = useState(currentYM());

  const [from, to] = getRange(mode, customFrom, customTo, selectedMonth);

  const { data: stats, isLoading } = useQuery<VendedorStats>({
    queryKey: ["/api/vendedor/dashboard", from, to],
    queryFn: () => fetch(`/api/vendedor/dashboard?from=${from}&to=${to}`).then((r) => r.json()),
  });

  const { data: monthly } = useQuery<MonthlyData>({
    queryKey: ["/api/vendedor/dashboard-monthly"],
    queryFn: () => fetch("/api/vendedor/dashboard-monthly").then((r) => r.json()),
    staleTime: 60_000,
  });

  // Elementos extra (siempre actual: inactividad, mes en curso, últimos pedidos) — filtrados por el vendedor logueado
  const { data: extra } = useQuery<ExtraData>({
    queryKey: ["/api/vendedor/dashboard-extra"],
    queryFn: () => fetch("/api/vendedor/dashboard-extra").then((r) => r.json()),
    staleTime: 60_000,
  });

  const verCliente = (name: string) => setLocation(`/vendedor/customers?q=${encodeURIComponent(name)}`);
  const waLink = (phone: string | null) => {
    const d = (phone ?? "").replace(/\D/g, "");
    return d.length >= 8 ? `https://wa.me/${d}` : null;
  };
  const inacNaranja = (extra?.inactivos ?? []).filter((c) => c.bucket === "naranja");
  const inacRoja = (extra?.inactivos ?? []).filter((c) => c.bucket === "roja");
  const fmtFecha = (s: string) => fmtDiaMes(s);

  return (
    <VendedorLayout title="Dashboard">
      <div className="vx">
        <style>{VX_CSS}</style>
        <div className="vx-wrap">
          <div className="vx-top">
            <div>
              <h1 className="vx-title">Mi resumen</h1>
              <div className="vx-subtitle">Ventas y comisiones por período</div>
            </div>
            <div className="vx-controls">
              <div className="vx-seg">
                {RANGE_BTNS.map((b) => (
                  <button key={b.value} className={mode === b.value ? "on" : ""} onClick={() => setMode(b.value)}>{b.label}</button>
                ))}
              </div>
              {mode === "rango" && (
                <>
                  <input type="date" className="vx-input" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                  <span style={{ color: "#8b8f88" }}>→</span>
                  <input type="date" className="vx-input" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                </>
              )}
              {mode === "pormes" && (
                <input type="month" className="vx-input" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value || currentYM())} />
              )}
            </div>
          </div>

          {isLoading || !stats ? (
            <div className="vx-kpis c4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}</div>
          ) : (
            <div className="vx-kpis c4">
              <div className="vx-kpi">
                <div className="lab">Total ventas</div>
                <div className="val">{fmt(stats.ventas)}</div>
                <div className="note">neto sin IVA · {stats.clientesAsignados} clientes asignados</div>
              </div>
              <div className="vx-kpi">
                <div className="lab">Comisión total</div>
                <div className="val">{fmt(stats.comisionTotal)}</div>
                <div className="note">devengada por los pedidos del período</div>
              </div>
              <div className="vx-kpi main">
                <div className="lab">Comisión habilitada</div>
                <div className="val">{fmt(stats.comisiones)}</div>
                <div className="note">por cobranzas del período</div>
              </div>
              <div className={`vx-kpi${stats.comisionPendiente > 0 ? " warn" : ""}`}>
                <div className="lab">Pendiente de cobro</div>
                <div className="val">{fmt(stats.comisionPendiente)}</div>
                <div className="note">de los pedidos del período que aún no se pagaron</div>
              </div>
            </div>
          )}

          {extra && extra.ventasPorDia.length > 0 && (
            <div className="vx-card">
              <div className="vx-chead"><span className="t"><BarChart3 className="h-4 w-4" /> Mis ventas del mes (por día)</span><span className="n">neto sin IVA</span></div>
              <div className="vx-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={extra.ventasPorDia} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eeeeea" />
                    <XAxis dataKey="dia" tickFormatter={fmtFecha} fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(v) => "$" + Math.round(Number(v) / 1000) + "k"} fontSize={11} tickLine={false} axisLine={false} width={48} />
                    <Tooltip formatter={(v: number) => [fmt(v), "Ventas"]} labelFormatter={(l) => fmtFecha(String(l))} />
                    <Bar dataKey="total" fill="#6b8a2a" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {monthly && monthly.length > 0 && (
            <div className="vx-card">
              <div className="vx-chead"><span className="t"><BarChart3 className="h-4 w-4" /> Facturación y comisiones por mes</span></div>
              <div className="vx-chart" style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthly} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eeeeea" />
                    <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="fact" tickFormatter={(v) => "$" + Math.round(Number(v) / 1000) + "k"} fontSize={11} tickLine={false} axisLine={false} width={50} />
                    <YAxis yAxisId="com" orientation="right" tickFormatter={(v) => "$" + Math.round(Number(v) / 1000) + "k"} fontSize={11} tickLine={false} axisLine={false} width={50} />
                    <Tooltip formatter={(v: number, name: string) => [fmt(v), SERIE[name] ?? name]} />
                    <Legend formatter={(val) => SERIE[val] ?? val} wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="fact" dataKey="facturacion" fill="#bcc79e" radius={[3, 3, 0, 0]} maxBarSize={36} />
                    <Line yAxisId="com" type="monotone" dataKey="comisionTotal" stroke="#c08a1e" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
                    <Line yAxisId="com" type="monotone" dataKey="comisiones" stroke="#5f8020" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="vx-two">
            <div className="vx-card">
              <div className="vx-chead"><span className="t"><ListOrdered className="h-4 w-4" /> Últimos pedidos</span></div>
              {!extra ? (
                <div style={{ padding: "0 22px 16px" }} className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : extra.ultimosPedidos.length === 0 ? (
                <div style={{ padding: "20px 22px", textAlign: "center", color: "#8b8f88", fontSize: 13.5 }}>Sin pedidos</div>
              ) : (
                <div className="vx-rows">
                  {extra.ultimosPedidos.map((o) => (
                    <button key={o.id} className="vx-row" onClick={() => setLocation(`/vendedor/orders/${o.id}`)}>
                      <div className="main">{o.cliente}<div className="sub">{fmtFecha(o.fecha)} · {o.folio}</div></div>
                      <span className={`vx-chip ${o.status === "approved" ? "ok" : o.status === "draft" ? "par" : "gris"}`}>{o.status === "approved" ? "Aprobado" : o.status === "draft" ? "Borrador" : o.status}</span>
                      <span className="amt">{fmt(o.total)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="vx-card">
              <div className="vx-chead"><span className="t"><Trophy className="h-4 w-4" style={{ color: "#c08a1e" }} /> Top clientes del mes</span></div>
              {!extra ? (
                <div style={{ padding: "0 22px 16px" }} className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : extra.topClientes.length === 0 ? (
                <div style={{ padding: "20px 22px", textAlign: "center", color: "#8b8f88", fontSize: 13.5 }}>Sin ventas este mes</div>
              ) : (
                <div className="vx-rows">
                  {extra.topClientes.map((c, i) => (
                    <button key={c.id} className="vx-row" onClick={() => verCliente(c.name)}>
                      <span className={`rank${i === 0 ? " top" : ""}`}>{i + 1}</span>
                      <span className="main">{c.name}</span>
                      <span className="amt">{fmt(c.total)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {extra && extra.inactivos.length > 0 && (
            <div className="vx-card" style={{ marginTop: 18, borderColor: "#f3d9d0" }}>
              <div className="vx-chead">
                <span className="t"><AlertTriangle className="h-4 w-4" style={{ color: "#d4742e" }} /> Clientes sin pedir</span>
                <span className="n"><b style={{ color: "#d4742e" }}>{inacNaranja.length}</b> hace 1 semana · <b style={{ color: "#c05e42" }}>{inacRoja.length}</b> hace 2+ semanas</span>
              </div>
              <div className="vx-rows">
                {[...inacRoja, ...inacNaranja].map((c) => {
                  const roja = c.bucket === "roja";
                  const wa = waLink(c.phone);
                  return (
                    <div key={c.id} className="vx-row" style={{ cursor: "default" }}>
                      <span className={`dot ${roja ? "roja" : "naranja"}`} />
                      <span className="main">{c.name}</span>
                      <span className={`dias ${roja ? "roja" : "naranja"}`}>hace {c.dias} días</span>
                      {wa ? (
                        <a href={wa} target="_blank" rel="noopener noreferrer" className="vx-btn wa"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a>
                      ) : (
                        <span style={{ fontSize: 11, color: "#8b8f88", fontStyle: "italic" }}>sin teléfono</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, fontSize: 12.5, color: "#8b8f88" }}><Users className="h-3.5 w-3.5" /> Total ventas, ventas por día y comisiones: neto sin IVA. El gráfico mensual y los top clientes van con IVA, como la cuenta corriente.</div>
        </div>
      </div>
    </VendedorLayout>
  );
}
