import { useState, useMemo } from "react";
import { ArrowLeftRight, ChevronLeft, ChevronRight } from "lucide-react";

// ── Fecha de IMPACTO (acreditación/débito real en el banco) ──────────────────
// Regla: fecha del cheque + 1 día hábil. Sin feriados (solo fines de semana):
//   Lun→Mar, Mar→Mié, Mié→Jue, Jue→Vie (todos +1)
//   Vie→Lun (+3), Sáb→Mar (+3), Dom→Mar (+2)
// AISLADA y documentada: para sumar feriados después, restar/saltar acá los días no hábiles.
const OFFSET_POR_DIA = [2, 1, 1, 1, 1, 3, 3]; // index = getDay() (0=Dom .. 6=Sáb)
function parseYMD(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function fechaImpacto(fechaCheque: string): Date {
  const base = parseYMD(fechaCheque);
  const out = new Date(base);
  out.setDate(out.getDate() + OFFSET_POR_DIA[base.getDay()]);
  out.setHours(0, 0, 0, 0);
  return out;
}

// Lunes 00:00 de la semana de `date` (semanas lunes→domingo)
function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0=Lun .. 6=Dom
  d.setDate(d.getDate() - dow);
  return d;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
const dd = (d: Date) => String(d.getDate()).padStart(2, "0");
const mm = (d: Date) => String(d.getMonth() + 1).padStart(2, "0");
const fmtDM = (d: Date) => `${dd(d)}/${mm(d)}`;
const fmtRowDate = (d: Date) => `${d.toLocaleDateString("es-AR", { weekday: "short" }).replace(/\.$/, "")} ${d.getDate()}`;
const fmtMoney = (n: number) => "$" + Math.round(n).toLocaleString("es-AR");

type Cheque = {
  id: number; tipo: "recibido" | "emitido"; numero: string | null;
  monto: number; fecha_cobro: string; estado: string; contraparte: string;
};

// Paleta sobria del mockup
const C = {
  green: "#6b8a2a", greenBar: "#8fae4a", greenTrack: "#eef2e3",
  coral: "#b06a5d", coralBar: "#c98a7d", coralTrack: "#f1e4e0",
};

function ResumenCard({ label, valor, sub, barColor, trackColor, valorColor }: {
  label: string; valor: string; sub: string; barColor: string; trackColor: string; valorColor?: string;
}) {
  return (
    <div className="flex-1 min-w-[140px] rounded-xl border border-border bg-card p-4">
      <p className="text-[11.5px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-[22px] font-medium tabular-nums leading-none" style={valorColor ? { color: valorColor } : undefined}>{valor}</p>
      <div className="mt-2 h-1 w-full rounded-[3px]" style={{ background: trackColor }}>
        <div className="h-1 rounded-[3px]" style={{ width: "100%", background: barColor }} />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function ChequeRow({ impacto, fechaCheque, nombre, monto }: { impacto: Date; fechaCheque: string; nombre: string; monto: number }) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-t border-border py-2 first:border-t-0">
      <div className="leading-tight">
        <p className="text-[12px] font-medium tabular-nums capitalize">{fmtRowDate(impacto)}</p>
        <p className="text-[9.5px] text-muted-foreground tabular-nums">cheq {fmtDM(parseYMD(fechaCheque))}</p>
      </div>
      <p className="text-[13px] truncate" title={nombre}>{nombre}</p>
      <p className="text-[13px] font-medium tabular-nums text-foreground">{fmtMoney(monto)}</p>
    </div>
  );
}

export default function ChequesFlow({ cheques }: { cheques: Cheque[] }) {
  const [weekOffset, setWeekOffset] = useState(0); // 0 = semana actual; solo hacia adelante

  const semanaActualLunes = useMemo(() => mondayOf(new Date()), []);
  const lunes = useMemo(() => addDays(semanaActualLunes, weekOffset * 7), [semanaActualLunes, weekOffset]);
  const domingo = useMemo(() => addDays(lunes, 6), [lunes]);

  // Cheques en cartera ubicados en la semana mostrada por su fecha de impacto
  const { acredita, debita, totalAcr, totalDeb } = useMemo(() => {
    const finSemana = addDays(domingo, 1); // exclusivo (lunes siguiente 00:00)
    const enRango = (c: Cheque) => {
      const imp = fechaImpacto(c.fecha_cobro);
      return imp >= lunes && imp < finSemana;
    };
    const enCartera = (cheques ?? []).filter(c => c.estado === "en_cartera");
    const acr = enCartera.filter(c => c.tipo === "recibido" && enRango(c))
      .map(c => ({ ...c, _imp: fechaImpacto(c.fecha_cobro) }))
      .sort((a, b) => a._imp.getTime() - b._imp.getTime());
    const deb = enCartera.filter(c => c.tipo === "emitido" && enRango(c))
      .map(c => ({ ...c, _imp: fechaImpacto(c.fecha_cobro) }))
      .sort((a, b) => a._imp.getTime() - b._imp.getTime());
    return {
      acredita: acr, debita: deb,
      totalAcr: acr.reduce((s, c) => s + c.monto, 0),
      totalDeb: deb.reduce((s, c) => s + c.monto, 0),
    };
  }, [cheques, lunes, domingo]);

  const neto = totalAcr - totalDeb;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center" style={{ width: 34, height: 34, borderRadius: 9, background: C.greenTrack }}>
            <ArrowLeftRight style={{ width: 17, height: 17, color: C.green }} />
          </div>
          <div>
            <h3 className="text-[15px] font-medium leading-tight">Cheques: cartera vs emisiones</h3>
            <p className="text-[12.5px] text-muted-foreground leading-tight">por fecha de acreditación real</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset(w => Math.max(0, w - 1))}
            disabled={weekOffset === 0}
            className="flex items-center justify-center rounded-lg border border-border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            style={{ width: 32, height: 32 }} title="Semana anterior"
          ><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-[12.5px] text-muted-foreground tabular-nums min-w-[88px] text-center">{fmtDM(lunes)} – {fmtDM(domingo)}</span>
          <button
            onClick={() => setWeekOffset(w => w + 1)}
            className="flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors"
            style={{ width: 32, height: 32 }} title="Semana siguiente"
          ><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      {/* 3 cards resumen (mismo tamaño) */}
      <div className="mt-4 flex gap-3 flex-wrap">
        <ResumenCard label="Se acredita" valor={fmtMoney(totalAcr)} sub={`${acredita.length} cheque${acredita.length === 1 ? "" : "s"} entran`} barColor={C.greenBar} trackColor={C.greenTrack} />
        <ResumenCard label="Se debita" valor={fmtMoney(totalDeb)} sub={`${debita.length} cheque${debita.length === 1 ? "" : "s"} salen`} barColor={C.coralBar} trackColor={C.coralTrack} />
        <ResumenCard label="Neto semana" valor={(neto < 0 ? "−" : "") + fmtMoney(Math.abs(neto))} sub={neto >= 0 ? "te sobra" : "te falta"} barColor={neto >= 0 ? C.greenBar : C.coralBar} trackColor={neto >= 0 ? C.greenTrack : C.coralTrack} valorColor={neto >= 0 ? C.green : C.coral} />
      </div>

      {/* Detalle: dos columnas */}
      <div className="mt-4 rounded-xl border border-border bg-card grid grid-cols-1 md:grid-cols-2 md:divide-x divide-border">
        {/* Se acredita */}
        <div className="p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: C.greenBar }} />
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Se acredita</span>
          </div>
          {acredita.length === 0 ? (
            <p className="text-[12px] text-muted-foreground py-3">Sin cheques esta semana</p>
          ) : acredita.map(c => (
            <ChequeRow key={c.id} impacto={c._imp} fechaCheque={c.fecha_cobro} nombre={c.contraparte} monto={c.monto} />
          ))}
          <div className="mt-1 pt-2 flex items-center justify-between" style={{ borderTop: "1.5px solid hsl(var(--border))" }}>
            <span className="text-[13.5px] font-medium" style={{ color: C.green }}>Total que entra</span>
            <span className="text-[13.5px] font-medium tabular-nums" style={{ color: C.green }}>{fmtMoney(totalAcr)}</span>
          </div>
        </div>
        {/* Se debita */}
        <div className="p-4 border-t border-border md:border-t-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: C.coralBar }} />
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Se debita</span>
          </div>
          {debita.length === 0 ? (
            <p className="text-[12px] text-muted-foreground py-3">Sin cheques esta semana</p>
          ) : debita.map(c => (
            <ChequeRow key={c.id} impacto={c._imp} fechaCheque={c.fecha_cobro} nombre={`${c.contraparte}${c.numero ? ` · Nº ${c.numero}` : ""}`} monto={c.monto} />
          ))}
          <div className="mt-1 pt-2 flex items-center justify-between" style={{ borderTop: "1.5px solid hsl(var(--border))" }}>
            <span className="text-[13.5px] font-medium" style={{ color: C.coral }}>Total que sale</span>
            <span className="text-[13.5px] font-medium tabular-nums" style={{ color: C.coral }}>{fmtMoney(totalDeb)}</span>
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground leading-snug">
        Acreditación = fecha del cheque + 1 día hábil (los de viernes impactan el lunes; sábado y domingo, el martes). No contempla feriados.
      </p>
    </div>
  );
}
