import { useState, useMemo } from "react";
import { ArrowLeftRight, ChevronLeft, ChevronRight } from "lucide-react";

// ── Fecha de IMPACTO (acreditación/débito real en el banco) ──────────────────
// EMITIDOS (débito): 24hs hábiles (+1 día hábil). Lun→Mar, Mar→Mié, Mié→Jue, Jue→Vie;
//   Vie→Lun, Sáb→Mar, Dom→Mar.
// RECIBIDOS (acreditación): 48hs hábiles (+2 días hábiles). Lun→Mié, Mar→Jue, Mié→Vie, Jue→Lun;
//   Vie→Mar, Sáb→Mié, Dom→Mié.
// offset en días calendario por getDay() (0=Dom .. 6=Sáb). AISLADO y documentado: para sumar
// feriados después, ajustar acá saltando los días no hábiles.
const OFFSET_EMITIDO  = [2, 1, 1, 1, 1, 3, 3]; // +1 día hábil (24hs)
const OFFSET_RECIBIDO = [3, 2, 2, 2, 4, 4, 4]; // +2 días hábiles (48hs)
function parseYMD(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function fechaImpacto(fechaCheque: string, tipo: "emitido" | "recibido"): Date {
  const base = parseYMD(fechaCheque);
  const off = tipo === "recibido" ? OFFSET_RECIBIDO : OFFSET_EMITIDO;
  const out = new Date(base);
  out.setDate(out.getDate() + off[base.getDay()]);
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

// Rediseño (usa las clases crx-* definidas en caja/index.tsx, este componente se renderiza adentro)
const fmtMoneySigned = (n: number) => (n < 0 ? "−" : "+") + "$" + Math.round(Math.abs(n)).toLocaleString("es-AR");
const MESES_ABBR = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
function fmtRange(l: Date, d: Date): string {
  const m1 = MESES_ABBR[l.getMonth()], m2 = MESES_ABBR[d.getMonth()];
  return m1 === m2 ? `${l.getDate()} – ${d.getDate()} ${m1}` : `${l.getDate()} ${m1} – ${d.getDate()} ${m2}`;
}

function FlowRow({ impacto, fechaCheque, nombre, monto, cobrado }: { impacto: Date; fechaCheque: string; nombre: string; monto: number; cobrado?: boolean }) {
  return (
    <div className="crx-flowrow">
      <div className="crx-fdate">
        <span className="imp" style={{ textTransform: "capitalize" }}>{fmtRowDate(impacto)}</span>
        <span className="chq">cheq {fmtDM(parseYMD(fechaCheque))}</span>
      </div>
      <div className="crx-fname" title={nombre}>{nombre}{cobrado && <span className="ok">✓ Cobrado</span>}</div>
      <div className={`crx-famt${cobrado ? " done" : ""}`}>{fmtMoney(monto)}</div>
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
      const imp = fechaImpacto(c.fecha_cobro, c.tipo);
      return imp >= lunes && imp < finSemana;
    };
    // en_cartera = pendiente; cobrado/depositado = confirmado por el banco (badge "Cobrado")
    const relevantes = (cheques ?? []).filter(c => ["en_cartera", "cobrado", "depositado"].includes(c.estado));
    const conFlags = (c: Cheque) => ({ ...c, _imp: fechaImpacto(c.fecha_cobro, c.tipo), _cobrado: c.estado !== "en_cartera" });
    const acr = relevantes.filter(c => c.tipo === "recibido" && enRango(c)).map(conFlags)
      .sort((a, b) => a._imp.getTime() - b._imp.getTime());
    const deb = relevantes.filter(c => c.tipo === "emitido" && enRango(c)).map(conFlags)
      .sort((a, b) => a._imp.getTime() - b._imp.getTime());
    return {
      acredita: acr, debita: deb,
      totalAcr: acr.reduce((s, c) => s + c.monto, 0),
      totalDeb: deb.reduce((s, c) => s + c.monto, 0),
    };
  }, [cheques, lunes, domingo]);

  const neto = totalAcr - totalDeb;

  return (
    <div className="crx-panel">
      <div className="crx-sechead" style={{ marginBottom: 22 }}>
        <div className="crx-titlewrap">
          <span className="crx-ticon"><ArrowLeftRight style={{ width: 19, height: 19 }} /></span>
          <div>
            <h2 className="crx-h2" style={{ fontSize: 20 }}>Cheques: cartera vs emisiones</h2>
            <p className="sub">por fecha de acreditación real</p>
          </div>
        </div>
        <div className="crx-wknav">
          <button className="crx-navbtn" onClick={() => setWeekOffset(w => Math.max(0, w - 1))} disabled={weekOffset === 0} title="Semana anterior"><ChevronLeft className="h-4 w-4" /></button>
          <div className="crx-wkrange">
            <span className="rg">{fmtRange(lunes, domingo)}</span>
            <span className="hint">{weekOffset === 0 ? "semana actual" : weekOffset === 1 ? "próxima semana" : `en ${weekOffset} semanas`}</span>
          </div>
          <button className="crx-navbtn" onClick={() => setWeekOffset(w => w + 1)} title="Semana siguiente"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="crx-sums">
        <div className="crx-sumcard acr"><div className="lab">Se acredita</div><div className="amt crx-num">{fmtMoney(totalAcr)}</div><div className="sub">{acredita.length} cheque{acredita.length === 1 ? "" : "s"} entran</div></div>
        <div className="crx-sumcard deb"><div className="lab">Se debita</div><div className="amt crx-num">{fmtMoney(totalDeb)}</div><div className="sub">{debita.length} cheque{debita.length === 1 ? "" : "s"} salen</div></div>
        <div className="crx-sumcard" style={{ background: neto >= 0 ? "#eef3e3" : "#f8ede8" }}>
          <div className="lab" style={{ color: neto >= 0 ? "#5f8020" : "#b0553f" }}>Neto semana</div>
          <div className="amt crx-num" style={{ color: neto >= 0 ? "#5f8020" : "#b0553f" }}>{fmtMoneySigned(neto)}</div>
          <div className="sub">{neto > 0 ? "te sobra" : neto < 0 ? "te falta" : "queda igual"}</div>
        </div>
      </div>

      <div className="crx-cols">
        <div className="crx-col acr">
          <div className="crx-colhead"><span className="crx-cdot" />Se acredita</div>
          {acredita.length === 0 ? (
            <div className="crx-flowempty">Sin cheques esta semana</div>
          ) : acredita.map(c => (
            <FlowRow key={c.id} impacto={c._imp} fechaCheque={c.fecha_cobro} nombre={c.contraparte} monto={c.monto} cobrado={c._cobrado} />
          ))}
          <div className="crx-coltotal"><span className="l">Total que entra</span><span className="v crx-num">{fmtMoney(totalAcr)}</span></div>
        </div>
        <div className="crx-col deb">
          <div className="crx-colhead"><span className="crx-cdot" />Se debita</div>
          {debita.length === 0 ? (
            <div className="crx-flowempty">Sin cheques esta semana</div>
          ) : debita.map(c => (
            <FlowRow key={c.id} impacto={c._imp} fechaCheque={c.fecha_cobro} nombre={`${c.contraparte}${c.numero ? ` · Nº ${c.numero}` : ""}`} monto={c.monto} cobrado={c._cobrado} />
          ))}
          <div className="crx-coltotal"><span className="l">Total que sale</span><span className="v crx-num">{fmtMoney(totalDeb)}</span></div>
        </div>
      </div>

      <p className="crx-flowfoot">
        Emitidos: se debitan a las 24hs hábiles (viernes → lunes; fin de semana → martes). Recibidos: se acreditan a las 48hs hábiles (viernes → martes; fin de semana → miércoles). No contempla feriados.
      </p>
    </div>
  );
}
