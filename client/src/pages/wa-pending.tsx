/**
 * A-01 · Números por asignar — mensajes de WhatsApp que llegaron de un teléfono que no está en
 * customer_contacts (o que está en varios clientes y la IA no pudo elegir). Joaquín asigna el número a
 * uno o varios clientes con un clic; el agente reprocesa el mensaje solo.
 * Estética: la misma de Pedidos / Bot por cliente (solo presentación; la lógica no cambia).
 */
import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import { Phone, Check, X, MessageSquare, Search, PhoneIncoming, Plus } from "lucide-react";
import type { Customer, WaPendingNumber } from "@shared/schema";
import { formatArPhone } from "@shared/phone";
import { fmtFechaHoraAR } from "@/lib/format";

type Suggestion = { customerId: number; name: string; reason?: string };

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
.wpx-list{display:flex;flex-direction:column;gap:12px;}
.wpx-card{background:#fff;border:1px solid #ecece8;border-radius:15px;padding:18px 20px;display:grid;grid-template-columns:52px minmax(0,1fr);gap:16px;}
.wpx-pic{width:46px;height:46px;border-radius:12px;background:#f2f2ec;color:#8f948a;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
.wpx-mid{min-width:0;}
.wpx-tags{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
.wpx-chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:20px;white-space:nowrap;}
.wpx-chip.perfil{background:#e9eff7;color:#3a67a3;}
.wpx-chip.rep{background:#fff3cd;color:#8a6d0b;}
.wpx-chip.ok{background:#eef3e3;color:#5f8020;}
.wpx-chip.off{background:#f1f1ec;color:#8b8f88;}
.wpx-chip.hora{background:#f1f1ec;color:#8b8f88;font-weight:500;}
.wpx-name{font-family:'Bricolage Grotesque';font-size:18px;font-weight:700;letter-spacing:-.01em;}
.wpx-msg{margin-top:10px;background:#fbfaf7;border:1px solid #ecece8;border-radius:12px;padding:12px 14px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.55;white-space:pre-wrap;max-height:220px;overflow:auto;color:#1e2420;}
.wpx-sect{font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9a9e96;margin:14px 0 8px;}
.wpx-sugs{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
.wpx-sug{border:1px solid #ecece8;background:#fff;border-radius:20px;padding:6px 12px;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;}
.wpx-sug:hover{border-color:#cfcfc9;background:#f6f6f2;}
.wpx-sug.sel{background:#6b8a2a;color:#fff;border-color:#6b8a2a;font-weight:600;}
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
.wpx-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap;}
.wpx-info{font-size:13px;color:#8b8f88;margin-top:10px;}
.wpx-empty{background:#fff;border:1px solid #ecece8;border-radius:16px;padding:48px 20px;text-align:center;color:#8b8f88;display:flex;flex-direction:column;align-items:center;gap:10px;}
.wpx-empty .big{font-size:15px;font-weight:600;color:#1e2420;}
.wpx-emptyic{width:48px;height:48px;border-radius:50%;background:#f1f1ec;display:flex;align-items:center;justify-content:center;color:#8b8f88;}
`;

export default function WaPendingPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"pending" | "assigned" | "ignored">("pending");
  const { data: rows = [], isLoading } = useQuery<WaPendingNumber[]>({ queryKey: ["/api/wa-pending", tab], queryFn: async () => {
    const r = await fetch(`/api/wa-pending?status=${tab}`, { credentials: "include" });
    if (!r.ok) throw new Error("No se pudo cargar");
    return r.json();
  } });
  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const activeCustomers = useMemo(() => customers.filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name, "es")), [customers]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/wa-pending"] });
  const assign = useMutation({
    mutationFn: ({ id, customerIds, contactName }: { id: number; customerIds: number[]; contactName: string | null }) =>
      apiRequest("POST", `/api/wa-pending/${id}/assign`, { customerIds, contactName }),
    onSuccess: () => { invalidate(); toast({ title: "Número asignado", description: "El mensaje se reprocesa solo en unos minutos." }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const ignore = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/wa-pending/${id}/ignore`, {}),
    onSuccess: () => { invalidate(); toast({ title: "Ignorado" }); },
  });

  const TABS: { k: typeof tab; label: string }[] = [{ k: "pending", label: "Pendientes" }, { k: "assigned", label: "Asignados" }, { k: "ignored", label: "Ignorados" }];

  return (
    <Layout title="Números por asignar">
      <div className="wa-rx">
        <style>{WPX_CSS}</style>
        <div className="wpx-wrap">
          <div className="wpx-pagehead">
            <div>
              <h1>Números por asignar</h1>
              <p className="sub">Pedidos por WhatsApp de teléfonos que el sistema no reconoce. Asignalos a un cliente (o varios) y el pedido se carga solo.</p>
            </div>
            <div className="wpx-tabs">
              {TABS.map((t) => (
                <button key={t.k} className={`wpx-btn ${tab === t.k ? "active" : ""}`} onClick={() => setTab(t.k)} data-testid={`tab-${t.k}`}>{t.label}</button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <p className="wpx-info">Cargando...</p>
          ) : rows.length === 0 ? (
            <div className="wpx-empty">
              <div className="wpx-emptyic"><PhoneIncoming className="h-5 w-5" /></div>
              <div className="big">No hay números {tab === "pending" ? "pendientes" : tab === "assigned" ? "asignados" : "ignorados"}</div>
              <div>{tab === "pending" ? "Cuando llegue un pedido de un teléfono desconocido, aparece acá." : ""}</div>
            </div>
          ) : (
            <div className="wpx-list">
              {rows.map((row) => (
                <PendingCard key={row.id} row={row} customers={activeCustomers}
                  onAssign={(customerIds, contactName) => assign.mutate({ id: row.id, customerIds, contactName })}
                  onIgnore={() => ignore.mutate(row.id)} busy={assign.isPending || ignore.isPending} readOnly={tab !== "pending"} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

function PendingCard({ row, customers, onAssign, onIgnore, busy, readOnly }: {
  row: WaPendingNumber; customers: Customer[]; onAssign: (ids: number[], contactName: string | null) => void; onIgnore: () => void; busy: boolean; readOnly: boolean;
}) {
  const suggestions = (row.suggestions as Suggestion[] | null) ?? [];
  const [selected, setSelected] = useState<number[]>([]);
  const [contactName, setContactName] = useState(row.profileName ?? "");
  const [search, setSearch] = useState("");
  const [comboOpen, setComboOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!comboOpen) return;
    const h = (e: MouseEvent) => { if (!comboRef.current?.contains(e.target as Node)) setComboOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [comboOpen]);
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const results = search.trim().length >= 2 ? customers.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8) : [];
  const assignedIds = (row.assignedCustomerIds as number[] | null) ?? [];
  const nameOf = (id: number) => customers.find((c) => c.id === id)?.name ?? String(id);

  return (
    <div className="wpx-card" data-testid={`pending-${row.id}`}>
      <span className="wpx-pic"><Phone className="h-[20px] w-[20px]" /></span>
      <div className="wpx-mid">
        <div className="wpx-tags">
          {row.profileName && <span className="wpx-chip perfil">{row.profileName}</span>}
          {row.reason === "repetido" && <span className="wpx-chip rep">teléfono en varios clientes</span>}
          {row.reason === "audio" && <span className="wpx-chip rep">audio</span>}
          {row.status === "assigned" && <span className="wpx-chip ok">asignado · esperando reproceso</span>}
          {row.status === "processed" && <span className="wpx-chip ok">asignado · pedido reprocesado</span>}
          {row.status === "ignored" && <span className="wpx-chip off">ignorado</span>}
          <span className="wpx-chip hora">{fmtFechaHoraAR(row.receivedAt ?? row.createdAt)}</span>
        </div>
        <div className="wpx-name wpx-mono">{formatArPhone(row.phone)}</div>
        <div className="wpx-msg"><MessageSquare className="inline h-3 w-3 mr-1" style={{ color: "#8b8f88" }} />{row.messageText}</div>

        {readOnly ? (
          <p className="wpx-info">
            {(row.status === "assigned" || row.status === "processed") && assignedIds.length > 0
              ? <>Asignado a: <b style={{ color: "#1e2420" }}>{assignedIds.map(nameOf).join(", ")}</b>{row.contactName ? ` · ${row.contactName}` : ""}</>
              : row.status === "ignored" ? "Este mensaje se ignoró." : ""}
          </p>
        ) : (
          <>
            {suggestions.length > 0 && (
              <>
                <p className="wpx-sect">Sugeridos por la IA</p>
                <div className="wpx-sugs">
                  {suggestions.map((s) => (
                    <button key={s.customerId} type="button" title={s.reason} className={`wpx-sug ${selected.includes(s.customerId) ? "sel" : ""}`} onClick={() => toggle(s.customerId)} data-testid={`suggestion-${row.id}-${s.customerId}`}>
                      {selected.includes(s.customerId) && <Check className="h-3.5 w-3.5" />}{s.name}
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
                  <input className="wpx-input" value={search} autoComplete="off" placeholder="Buscar cliente..." onFocus={() => setComboOpen(true)} onChange={(e) => { setSearch(e.target.value); setComboOpen(true); }} data-testid={`search-${row.id}`} />
                </div>
                {comboOpen && results.length > 0 && (
                  <div className="wpx-dropdown">
                    {results.map((c) => (
                      <div key={c.id} className="wpx-opt" onMouseDown={() => { toggle(c.id); setSearch(""); setComboOpen(false); }}>{c.name}</div>
                    ))}
                  </div>
                )}
              </div>
              <input className="wpx-input" style={{ width: 240 }} value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nombre / rol (ej. Juan - cocina)" data-testid={`contact-name-${row.id}`} />
            </div>
            {selected.length > 0 && (
              <div className="wpx-sugs" style={{ marginTop: 10 }}>
                {selected.map((id) => (
                  <button key={id} type="button" className="wpx-sug sel" onClick={() => toggle(id)}>{nameOf(id)} <X className="h-3.5 w-3.5" /></button>
                ))}
              </div>
            )}
            <div className="wpx-actions">
              <button type="button" className="wpx-btn sm" disabled={busy} onClick={onIgnore} data-testid={`ignore-${row.id}`}><X className="h-4 w-4" /> Ignorar</button>
              <button type="button" className="wpx-btn sm primary" disabled={busy || selected.length === 0} onClick={() => onAssign(selected, contactName.trim() || null)} data-testid={`assign-${row.id}`}>
                <Plus className="h-4 w-4" /> Asignar{selected.length > 1 ? ` a ${selected.length} clientes` : ""}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
