/**
 * A-01 · Números por asignar — mensajes de WhatsApp que llegaron de un teléfono que no está en
 * customer_contacts (o que está en varios clientes y la IA no pudo elegir). 23/11/2026: una fila por TELÉFONO
 * (no por mensaje): perfil, cantidad, primero/último, vista previa, sugerencia de la IA por número, "Ver mensajes"
 * con tildes para elegir cuáles se cargan como pedidos al asignar (hoy tildados, anteriores destildados).
 * Asignar: contacto + Bot activo + mensajes elegidos a reprocesar; Ignorar: todos los mensajes del número.
 * El bot sigue usando las rutas por mensaje (no cambiaron).
 */
import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, fetchJson } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import { Phone, Check, X, MessageSquare, Search, PhoneIncoming, Plus, ChevronDown, ChevronRight } from "lucide-react";
import type { Customer } from "@shared/schema";
import { formatArPhone } from "@shared/phone";
import { fmtFechaHoraAR } from "@/lib/format";

type Sugerencia = { customerId: number; name: string; reason?: string; veces: number };
type Mensaje = { id: number; texto: string | null; fecha: string | null; status: string; reason: string | null; profileName: string | null };
type Numero = {
  phone: string; profileName: string | null; cantidad: number; primero: string | null; ultimo: string | null; ultimoTexto: string | null;
  sugerencias: Sugerencia[]; contactName: string | null; assignedCustomerIds: number[]; reasons: string[]; mensajes: Mensaje[];
};
type Tab = "pending" | "assigned" | "ignored";

const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const diaAR = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }) : "");
const fmtCorta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit" }) : "—");
const REASON_LABEL: Record<string, string> = { repetido: "teléfono en varios clientes", audio: "audio", adjunto: "adjunto", sin_cargar: "sin cargar" };

const WPX_CSS = `
.wa-rx{background:#f4f4f1;min-height:100%;padding:30px 24px 56px;font-family:'Inter',system-ui,sans-serif;color:#1e2420;}
.wa-rx *{box-sizing:border-box;}
.wpx-wrap{max-width:1180px;margin:0 auto;}
.wpx-mono{font-family:ui-monospace,Menlo,Consolas,monospace;}
.wpx-pagehead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:24px;flex-wrap:wrap;}
.wpx-pagehead h1{font-family:'Bricolage Grotesque';font-size:27px;font-weight:700;margin:0;letter-spacing:-.02em;}
.wpx-pagehead .sub{font-size:14px;color:#8b8f88;margin:5px 0 0;}
.wpx-tabs{display:flex;gap:8px;flex-wrap:wrap;}
.wpx-btn{border:1px solid #ecece8;background:#fff;color:#1e2420;font-family:'Inter';font-size:13.5px;font-weight:500;padding:10px 15px;border-radius:11px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;white-space:nowrap;}
.wpx-btn:hover{border-color:#cfcfc9;background:#f6f6f2;}
.wpx-btn:disabled{opacity:.55;cursor:default;}
.wpx-btn.primary{background:#6b8a2a;color:#fff;border:none;font-weight:600;}
.wpx-btn.primary:hover{background:#5f7d24;}
.wpx-btn.active{background:#eef3e3;color:#5f8020;border-color:#d9e3c3;font-weight:600;}
.wpx-btn.sm{padding:7px 12px;font-size:13px;border-radius:10px;}
.wpx-btn.link{border:none;background:transparent;color:#3a67a3;padding:4px 0;font-weight:600;}
.wpx-list{display:flex;flex-direction:column;gap:12px;}
.wpx-card{background:#fff;border:1px solid #ecece8;border-radius:15px;padding:18px 20px;display:grid;grid-template-columns:52px minmax(0,1fr);gap:16px;}
.wpx-pic{width:46px;height:46px;border-radius:12px;background:#f2f2ec;color:#8f948a;display:flex;align-items:center;justify-content:center;flex:0 0 auto;position:relative;}
.wpx-pic .n{position:absolute;top:-6px;right:-6px;min-width:20px;height:20px;border-radius:10px;background:#6b8a2a;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;}
.wpx-mid{min-width:0;}
.wpx-tags{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
.wpx-chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:20px;white-space:nowrap;}
.wpx-chip.perfil{background:#e9eff7;color:#3a67a3;}
.wpx-chip.rep{background:#fff3cd;color:#8a6d0b;}
.wpx-chip.ok{background:#eef3e3;color:#5f8020;}
.wpx-chip.off{background:#f1f1ec;color:#8b8f88;}
.wpx-chip.hora{background:#f1f1ec;color:#8b8f88;font-weight:500;}
.wpx-name{font-family:'Bricolage Grotesque';font-size:18px;font-weight:700;letter-spacing:-.01em;}
.wpx-meta{font-size:12.5px;color:#8b8f88;margin-top:3px;}
.wpx-prev{margin-top:10px;background:#fbfaf7;border:1px solid #ecece8;border-radius:12px;padding:10px 14px;font-size:13px;line-height:1.5;color:#1e2420;display:flex;gap:8px;align-items:flex-start;}
.wpx-prev .t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}
.wpx-msgs{margin-top:8px;border:1px solid #ecece8;border-radius:12px;overflow:hidden;}
.wpx-msg{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:flex-start;padding:9px 14px;border-top:1px solid #f1f1ec;font-size:13px;}
.wpx-msg:first-child{border-top:none;}
.wpx-msg.old{background:#fbfaf7;}
.wpx-msg .txt{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.5;}
.wpx-msg .when{font-size:11.5px;color:#8b8f88;white-space:nowrap;}
.wpx-msg input[type=checkbox]{width:16px;height:16px;margin-top:2px;accent-color:#6b8a2a;cursor:pointer;}
.wpx-msgsbar{display:flex;gap:12px;align-items:center;padding:8px 14px;background:#f6f6f2;font-size:12px;color:#6f7469;border-top:1px solid #ecece8;flex-wrap:wrap;}
.wpx-sect{font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9a9e96;margin:14px 0 8px;}
.wpx-sugs{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
.wpx-sug{border:1px solid #ecece8;background:#fff;border-radius:20px;padding:6px 12px;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;}
.wpx-sug:hover{border-color:#cfcfc9;background:#f6f6f2;}
.wpx-sug.sel{background:#6b8a2a;color:#fff;border-color:#6b8a2a;font-weight:600;}
.wpx-sug small{font-weight:400;opacity:.75;}
.wpx-form{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;margin-top:6px;}
.wpx-combo{position:relative;flex:1;min-width:220px;}
.wpx-inputwrap{position:relative;}
.wpx-inputwrap>svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#8b8f88;pointer-events:none;}
.wpx-input{width:100%;font-family:'Inter';font-size:13.5px;color:#1e2420;background:#fff;border:1px solid #ecece8;border-radius:10px;padding:9px 12px;}
.wpx-inputwrap .wpx-input{padding-left:36px;}
.wpx-input:focus{outline:none;border-color:#6b8a2a;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.wpx-dropdown{position:absolute;left:0;right:0;top:calc(100% + 6px);background:#fff;border:1px solid #ecece8;border-radius:12px;box-shadow:0 12px 34px -12px rgba(0,0,0,.22);padding:6px;z-index:30;max-height:240px;overflow:auto;}
.wpx-opt{padding:9px 12px;border-radius:9px;font-size:13.5px;cursor:pointer;}
.wpx-opt:hover{background:#eef3e3;color:#5f8020;}
.wpx-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap;align-items:center;}
.wpx-actions .hint{font-size:12.5px;color:#8b8f88;margin-right:auto;}
.wpx-info{font-size:13px;color:#8b8f88;margin-top:10px;}
.wpx-empty{background:#fff;border:1px solid #ecece8;border-radius:16px;padding:48px 20px;text-align:center;color:#8b8f88;display:flex;flex-direction:column;align-items:center;gap:10px;}
.wpx-empty .big{font-size:15px;font-weight:600;color:#1e2420;}
.wpx-emptyic{width:48px;height:48px;border-radius:50%;background:#f1f1ec;display:flex;align-items:center;justify-content:center;color:#8b8f88;}
@media(max-width:640px){.wpx-card{grid-template-columns:1fr;padding:14px}.wpx-pic{display:none}}
`;

export default function WaPendingPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("pending");
  const { data: rows = [], isLoading } = useQuery<Numero[]>({ queryKey: ["/api/wa-pending/numeros", tab], queryFn: () => fetchJson<Numero[]>(`/api/wa-pending/numeros?status=${tab}`) });
  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const activeCustomers = useMemo(() => customers.filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name, "es")), [customers]);

  const invalidate = () => { queryClient.invalidateQueries({ queryKey: ["/api/wa-pending/numeros"] }); queryClient.invalidateQueries({ queryKey: ["/api/wa-pending/count"] }); queryClient.invalidateQueries({ queryKey: ["/api/customers"] }); };
  const assign = useMutation({
    mutationFn: ({ phone, customerIds, contactName, messageIds }: { phone: string; customerIds: number[]; contactName: string | null; messageIds: number[] }) =>
      apiRequest("POST", "/api/wa-pending/numero/assign", { phone, customerIds, contactName, messageIds }).then((r) => r.json()),
    onSuccess: (r: any) => { invalidate(); toast({ title: "Número asignado", description: `${r.asignados} mensaje${r.asignados !== 1 ? "s" : ""} se carga${r.asignados !== 1 ? "n" : ""} como pedido en unos minutos${r.ignorados ? ` · ${r.ignorados} ignorado${r.ignorados !== 1 ? "s" : ""}` : ""}.` }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const ignore = useMutation({
    mutationFn: (phone: string) => apiRequest("POST", "/api/wa-pending/numero/ignore", { phone }),
    onSuccess: () => { invalidate(); toast({ title: "Número ignorado", description: "Si vuelve a escribir, reaparece como pendiente." }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const TABS: { k: Tab; label: string }[] = [{ k: "pending", label: "Pendientes" }, { k: "assigned", label: "Asignados" }, { k: "ignored", label: "Ignorados" }];

  return (
    <Layout title="Números por asignar">
      <div className="wa-rx">
        <style>{WPX_CSS}</style>
        <div className="wpx-wrap">
          <div className="wpx-pagehead">
            <div>
              <h1>Números por asignar</h1>
              <p className="sub">Teléfonos que escribieron por WhatsApp y el sistema no reconoce. Una fila por número: asignalo a un cliente (o varios) y elegí qué mensajes se cargan como pedidos.</p>
            </div>
            <div className="wpx-tabs">
              {TABS.map((t) => (
                <button key={t.k} className={`wpx-btn ${tab === t.k ? "active" : ""}`} onClick={() => setTab(t.k)} data-testid={`tab-${t.k}`}>{t.label}{t.k === tab && !isLoading ? ` (${rows.length})` : ""}</button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <p className="wpx-info">Cargando...</p>
          ) : rows.length === 0 ? (
            <div className="wpx-empty">
              <div className="wpx-emptyic"><PhoneIncoming className="h-5 w-5" /></div>
              <div className="big">No hay números {tab === "pending" ? "pendientes" : tab === "assigned" ? "asignados" : "ignorados"}</div>
              <div>{tab === "pending" ? "Cuando escriba un teléfono desconocido, aparece acá." : ""}</div>
            </div>
          ) : (
            <div className="wpx-list">
              {rows.map((n) => (
                <NumeroCard key={n.phone} n={n} tab={tab} customers={activeCustomers}
                  onAssign={(customerIds, contactName, messageIds) => assign.mutate({ phone: n.phone, customerIds, contactName, messageIds })}
                  onIgnore={() => ignore.mutate(n.phone)} busy={assign.isPending || ignore.isPending} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

function NumeroCard({ n, tab, customers, onAssign, onIgnore, busy }: {
  n: Numero; tab: Tab; customers: Customer[]; onAssign: (ids: number[], contactName: string | null, messageIds: number[]) => void; onIgnore: () => void; busy: boolean;
}) {
  const hoy = hoyAR();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [contactName, setContactName] = useState(n.contactName ?? n.profileName ?? "");
  const [search, setSearch] = useState("");
  const [comboOpen, setComboOpen] = useState(false);
  // Por defecto se cargan los mensajes de HOY; los anteriores quedan destildados (se ignoran al asignar)
  const [tildados, setTildados] = useState<Set<number>>(() => new Set(n.mensajes.filter((m) => diaAR(m.fecha) === hoy).map((m) => m.id)));
  useEffect(() => { setTildados((prev) => { const s = new Set(prev); for (const m of n.mensajes) if (diaAR(m.fecha) === hoy && !prev.has(m.id) && !n.mensajes.some((x) => x.id === m.id && prev.size === 0)) s.add(m.id); return s; }); }, [n.cantidad]); // mensajes nuevos de hoy entran tildados
  const comboRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!comboOpen) return;
    const h = (e: MouseEvent) => { if (!comboRef.current?.contains(e.target as Node)) setComboOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [comboOpen]);
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleMsg = (id: number) => setTildados((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const results = search.trim().length >= 2 ? customers.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8) : [];
  const nameOf = (id: number) => customers.find((c) => c.id === id)?.name ?? String(id);
  const readOnly = tab !== "pending";
  const cuantosHoy = n.mensajes.filter((m) => diaAR(m.fecha) === hoy).length;

  return (
    <div className="wpx-card" data-testid={`numero-${n.phone}`}>
      <span className="wpx-pic"><Phone className="h-[20px] w-[20px]" /><span className="n">{n.cantidad}</span></span>
      <div className="wpx-mid">
        <div className="wpx-tags">
          {n.profileName && <span className="wpx-chip perfil">{n.profileName}</span>}
          {n.reasons.filter((r) => r !== "desconocido").map((r) => <span key={r} className="wpx-chip rep">{REASON_LABEL[r] ?? r}</span>)}
          {tab === "assigned" && <span className="wpx-chip ok">asignado{n.mensajes.some((m) => m.status === "assigned") ? " · esperando reproceso" : " · reprocesado"}</span>}
          {tab === "ignored" && <span className="wpx-chip off">ignorado</span>}
        </div>
        <div className="wpx-name wpx-mono">{formatArPhone(n.phone)}</div>
        <div className="wpx-meta">{n.cantidad} mensaje{n.cantidad !== 1 ? "s" : ""}{cuantosHoy && tab === "pending" ? ` (${cuantosHoy} de hoy)` : ""} · primero {fmtCorta(n.primero)} · último {fmtFechaHoraAR(n.ultimo)}</div>
        <div className="wpx-prev"><MessageSquare className="h-4 w-4 shrink-0" style={{ color: "#8b8f88", marginTop: 2 }} /><span className="t" title={n.ultimoTexto ?? ""}>{n.ultimoTexto}</span></div>

        <button type="button" className="wpx-btn link" onClick={() => setOpen((o) => !o)} data-testid={`ver-mensajes-${n.phone}`}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} {open ? "Ocultar mensajes" : `Ver mensajes (${n.cantidad})`}
        </button>
        {open && (
          <div className="wpx-msgs">
            {!readOnly && (
              <div className="wpx-msgsbar">
                <span>Tildá los que se cargan como pedido al asignar: {tildados.size} de {n.cantidad}</span>
                <button type="button" className="wpx-btn link" style={{ fontSize: 12 }} onClick={() => setTildados(new Set(n.mensajes.map((m) => m.id)))}>todos</button>
                <button type="button" className="wpx-btn link" style={{ fontSize: 12 }} onClick={() => setTildados(new Set(n.mensajes.filter((m) => diaAR(m.fecha) === hoy).map((m) => m.id)))}>solo hoy</button>
                <button type="button" className="wpx-btn link" style={{ fontSize: 12 }} onClick={() => setTildados(new Set())}>ninguno</button>
              </div>
            )}
            {n.mensajes.map((m) => (
              <div key={m.id} className={`wpx-msg${diaAR(m.fecha) !== hoy ? " old" : ""}`}>
                {!readOnly ? <input type="checkbox" checked={tildados.has(m.id)} onChange={() => toggleMsg(m.id)} data-testid={`msg-${m.id}`} /> : <span />}
                <div className="txt">{m.texto}{m.reason && m.reason !== "desconocido" ? <span className="wpx-chip rep" style={{ marginLeft: 8 }}>{REASON_LABEL[m.reason] ?? m.reason}</span> : null}{readOnly && m.status === "processed" ? <span className="wpx-chip ok" style={{ marginLeft: 8 }}>pedido cargado</span> : readOnly && m.status === "assigned" ? <span className="wpx-chip ok" style={{ marginLeft: 8 }}>esperando reproceso</span> : null}</div>
                <span className="when">{fmtFechaHoraAR(m.fecha)}</span>
              </div>
            ))}
          </div>
        )}

        {readOnly ? (
          <p className="wpx-info">
            {tab === "assigned" && n.assignedCustomerIds.length > 0
              ? <>Asignado a: <b style={{ color: "#1e2420" }}>{n.assignedCustomerIds.map(nameOf).join(", ")}</b>{n.contactName ? ` · ${n.contactName}` : ""}</>
              : tab === "ignored" ? "Todos los mensajes de este número se ignoraron. Si vuelve a escribir, reaparece en Pendientes." : ""}
          </p>
        ) : (
          <>
            {n.sugerencias.length > 0 && (
              <>
                <p className="wpx-sect">Sugerido por la IA</p>
                <div className="wpx-sugs">
                  {n.sugerencias.map((s) => (
                    <button key={s.customerId} type="button" title={s.reason} className={`wpx-sug ${selected.includes(s.customerId) ? "sel" : ""}`} onClick={() => toggle(s.customerId)} data-testid={`suggestion-${n.phone}-${s.customerId}`}>
                      {selected.includes(s.customerId) && <Check className="h-3.5 w-3.5" />}{s.name}{n.cantidad > 1 && <small>· {s.veces} de {n.cantidad}</small>}
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="wpx-sect">Asignar a</p>
            <div className="wpx-form">
              <div className="wpx-combo" ref={comboRef}>
                <div className="wpx-inputwrap">
                  <Search className="h-4 w-4" />
                  <input className="wpx-input" value={search} autoComplete="off" placeholder="Buscar cliente..." onFocus={() => setComboOpen(true)} onChange={(e) => { setSearch(e.target.value); setComboOpen(true); }} data-testid={`search-${n.phone}`} />
                </div>
                {comboOpen && results.length > 0 && (
                  <div className="wpx-dropdown">
                    {results.map((c) => (
                      <div key={c.id} className="wpx-opt" onMouseDown={() => { toggle(c.id); setSearch(""); setComboOpen(false); }}>{c.name}</div>
                    ))}
                  </div>
                )}
              </div>
              <input className="wpx-input" style={{ width: 240 }} value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nombre / rol (ej. Juan - cocina)" data-testid={`contact-name-${n.phone}`} />
            </div>
            {selected.length > 0 && (
              <div className="wpx-sugs" style={{ marginTop: 10 }}>
                {selected.map((id) => (
                  <button key={id} type="button" className="wpx-sug sel" onClick={() => toggle(id)}>{nameOf(id)} <X className="h-3.5 w-3.5" /></button>
                ))}
              </div>
            )}
            <div className="wpx-actions">
              <span className="hint">Al asignar se cargan {tildados.size} de {n.cantidad} mensajes como pedidos{tildados.size < n.cantidad ? "; el resto se ignora" : ""}.</span>
              <button type="button" className="wpx-btn sm" disabled={busy} onClick={() => { if (confirm(`¿Ignorar los ${n.cantidad} mensajes de ${formatArPhone(n.phone)}?`)) onIgnore(); }} data-testid={`ignore-${n.phone}`}><X className="h-4 w-4" /> Ignorar</button>
              <button type="button" className="wpx-btn sm primary" disabled={busy || selected.length === 0} onClick={() => onAssign(selected, contactName.trim() || null, Array.from(tildados))} data-testid={`assign-${n.phone}`}>
                <Plus className="h-4 w-4" /> Asignar{selected.length > 1 ? ` a ${selected.length} clientes` : ""}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
