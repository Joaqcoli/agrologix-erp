/**
 * A-01 · "Bot por cliente" — misma estética que Pedidos (rediseño Claude Design).
 * Desde el desplegable se eligen los clientes con bot; cada tarjeta tiene el interruptor "Bot activo",
 * los teléfonos de pedido (varios por cliente; un mismo número puede estar en varios clientes) y las
 * métricas de lo que leyó el bot contra lo que quedó cargado. Tocar la tarjeta abre los renglones con error.
 */
import { useMemo, useRef, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Bot, Search, Plus, X, Phone, ChevronDown, ChevronRight, TrendingUp, Check } from "lucide-react";
import type { Customer } from "@shared/schema";
import { formatArPhone } from "@shared/phone";

type Det = { fecha: string; folio: string | null; raw: string; bot: string; erp: string; duda: boolean };
type Contacto = { id: number; phone: string; name: string | null };
type Alias = { id: number; alias: string };
type Row = { customerId: number; cliente: string; botActivo: boolean; pedidos: number; renglones: number; comparables: number; errores: number; dudas: number; pct: number | null; ultimoPedido: string | null; detalle: Det[]; contactos: Contacto[]; aliases: Alias[] };
type Rule = { id: number; scope: string; customerId: number | null; rule: string; source: string };

// A-12: reglas que le enseñaste al bot (generales o de un cliente)
function RulesBlock({ customerId, title, hint }: { customerId: number | null; title: string; hint: string }) {
  const { toast } = useToast();
  const key = ["/api/bot-rules", customerId ?? "general"];
  const { data: rules = [] } = useQuery<Rule[]>({ queryKey: key, queryFn: async () => {
    const r = await fetch(customerId ? `/api/bot-rules?customerId=${customerId}` : "/api/bot-rules", { credentials: "include" });
    if (!r.ok) throw new Error("No se pudieron cargar las reglas");
    const all: Rule[] = await r.json();
    return customerId ? all.filter((x) => x.scope === "cliente") : all;
  } });
  const [text, setText] = useState("");
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/bot-rules"] });
  const add = useMutation({
    mutationFn: () => apiRequest("POST", "/api/bot-rules", { scope: customerId ? "cliente" : "general", customerId, rule: text, source: "manual" }),
    onSuccess: () => { invalidate(); setText(""); toast({ title: "Regla guardada" }); },
    onError: (e: any) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({ mutationFn: (id: number) => apiRequest("DELETE", `/api/bot-rules/${id}`), onSuccess: () => invalidate() });
  return (
    <>
      <p className="bcx-dtitle">{title}</p>
      <div className="bcx-tels" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
        {rules.length === 0 && <span style={{ fontSize: 13, color: "#8b8f88" }}>{hint}</span>}
        {rules.map((r) => (
          <span key={r.id} className="bcx-tel" style={{ justifyContent: "space-between" }}>
            <span>{r.rule}{r.source === "respuesta" && <span className="n" style={{ marginLeft: 8 }}>(de una respuesta por WhatsApp)</span>}</span>
            <button type="button" title="Quitar" onClick={() => remove.mutate(r.id)}><X className="h-3.5 w-3.5" /></button>
          </span>
        ))}
        <span className="bcx-addtel">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder='Ej. "piezas de verdeo = atados"' style={{ width: 420, maxWidth: "100%" }} />
          <button type="button" className="bcx-btn" disabled={text.trim().length < 3 || add.isPending} onClick={() => add.mutate()}><Plus className="h-3.5 w-3.5" /> Agregar regla</button>
        </span>
      </div>
    </>
  );
}
type Data = { resumen: { dias: number; pedidos: number; renglones: number; pct: number | null }; clientes: Row[] };

// ── CSS (mismo lenguaje visual que Pedidos: diseno-caja/pedidos-rediseno.html) ──
const BCX_CSS = `
.bot-rx{background:#f4f4f1;min-height:100%;padding:30px 24px 56px;font-family:'Inter',system-ui,sans-serif;color:#1e2420;}
.bot-rx *{box-sizing:border-box;}
.bcx-wrap{max-width:1180px;margin:0 auto;}
.bcx-num{font-family:'Bricolage Grotesque','Inter',sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.bcx-mono{font-family:ui-monospace,Menlo,Consolas,monospace;}
.bcx-pagehead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:24px;flex-wrap:wrap;}
.bcx-pagehead h1{font-family:'Bricolage Grotesque';font-size:27px;font-weight:700;margin:0;letter-spacing:-.02em;}
.bcx-pagehead .sub{font-size:14px;color:#8b8f88;margin:5px 0 0;}
.bcx-combo{position:relative;min-width:300px;}
.bcx-inputwrap{position:relative;}
.bcx-inputwrap>svg{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#8b8f88;pointer-events:none;}
.bcx-input{width:100%;font-family:'Inter';font-size:14px;color:#1e2420;background:#fff;border:1px solid #ecece8;border-radius:11px;padding:10px 14px 10px 40px;}
.bcx-input:focus{outline:none;border-color:#6b8a2a;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.bcx-dropdown{position:absolute;left:0;right:0;top:calc(100% + 6px);background:#fff;border:1px solid #ecece8;border-radius:12px;box-shadow:0 12px 34px -12px rgba(0,0,0,.22);padding:6px;z-index:30;max-height:280px;overflow:auto;}
.bcx-opt{padding:10px 13px;border-radius:9px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;}
.bcx-opt:hover{background:#eef3e3;color:#5f8020;}
.bcx-opt .on{font-size:11px;color:#5f8020;font-weight:600;}
.bcx-opt.empty{color:#8b8f88;cursor:default;}
.bcx-resumen{background:#fbfaf7;border:1px solid #ecece8;border-radius:16px;padding:20px 22px;margin-bottom:26px;}
.bcx-rhead{display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap;}
.bcx-rhead .ic{color:#5f8020;display:flex;}
.bcx-rhead .t{font-family:'Bricolage Grotesque';font-size:16px;font-weight:700;color:#5f8020;}
.bcx-rhead .d{font-size:13px;color:#8b8f88;}
.bcx-metrics{display:grid;grid-template-columns:repeat(3,1fr);}
@media(max-width:720px){.bcx-metrics{grid-template-columns:1fr;row-gap:18px;}}
.bcx-metric{padding:0 22px;border-left:1px solid #ecece6;}
.bcx-metric:first-child{padding-left:0;border-left:none;}
@media(max-width:720px){.bcx-metric{border-left:none;padding-left:0;}}
.bcx-metric .lab{font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9a9e96;margin-bottom:9px;}
.bcx-metric .val{font-size:24px;font-weight:700;line-height:1;}
.bcx-metric .sub{font-size:12px;color:#8b8f88;margin-top:6px;}
.bcx-list{display:flex;flex-direction:column;gap:12px;}
.bcx-card{background:#fff;border:1px solid #ecece8;border-radius:15px;transition:border-color .15s,box-shadow .15s;}
.bcx-card:hover{border-color:#d9d9d3;box-shadow:0 4px 14px -10px rgba(0,0,0,.25);}
.bcx-row{display:grid;grid-template-columns:52px minmax(0,1fr) auto auto 24px;align-items:center;gap:16px;padding:18px 20px;cursor:pointer;}
@media(max-width:820px){.bcx-row{grid-template-columns:52px minmax(0,1fr) 24px;}.bcx-right,.bcx-switch{grid-column:2;justify-self:start;text-align:left;}}
.bcx-pic{width:46px;height:46px;border-radius:12px;background:#f2f2ec;color:#8f948a;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
.bcx-pic.on{background:#eef3e3;color:#5f8020;}
.bcx-mid{min-width:0;}
.bcx-tags{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
.bcx-chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:20px;white-space:nowrap;}
.bcx-chip.on{background:#eef3e3;color:#5f8020;}
.bcx-chip.off{background:#f1f1ec;color:#8b8f88;}
.bcx-chip.duda{background:#fff3cd;color:#8a6d0b;}
.bcx-chip.tel{background:#e9eff7;color:#3a67a3;}
.bcx-name{font-family:'Bricolage Grotesque';font-size:18px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bcx-meta{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#8b8f88;margin-top:5px;flex-wrap:wrap;}
.bcx-meta .k{color:#1e2420;font-weight:500;}
.bcx-switch{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11px;color:#8b8f88;white-space:nowrap;}
.bcx-right{text-align:right;white-space:nowrap;}
.bcx-right .rl{font-size:11.5px;color:#8b8f88;}
.bcx-right .rv{font-size:22px;font-weight:700;margin-top:1px;}
.bcx-right .rv.ok{color:#5f8020;}
.bcx-right .rv.mid{color:#c08a1e;}
.bcx-right .rv.bad{color:#c05e42;}
.bcx-right .rv.na{color:#b3b6ae;}
.bcx-right .sub{font-size:11.5px;color:#8b8f88;margin-top:2px;}
.bcx-chev{color:#c3c6be;display:flex;justify-content:flex-end;}
.bcx-detail{border-top:1px solid #ecece8;padding:16px 20px 18px 88px;background:#fbfaf7;border-radius:0 0 15px 15px;}
@media(max-width:820px){.bcx-detail{padding-left:20px;}}
.bcx-dtitle{font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9a9e96;margin:0 0 10px;}
.bcx-tels{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:16px;}
.bcx-tel{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #ecece8;border-radius:10px;padding:7px 11px;font-size:13px;}
.bcx-tel .n{color:#8b8f88;font-size:12px;}
.bcx-tel button{border:none;background:none;color:#b3b6ae;cursor:pointer;padding:0;display:flex;}
.bcx-tel button:hover{color:#c05e42;}
.bcx-addtel{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;}
.bcx-addtel input{font-family:'Inter';font-size:13px;padding:7px 11px;border:1px solid #ecece8;border-radius:10px;background:#fff;}
.bcx-addtel input:focus{outline:none;border-color:#6b8a2a;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.bcx-btn{border:1px solid #ecece8;background:#fff;color:#1e2420;font-family:'Inter';font-size:13px;font-weight:500;padding:7px 12px;border-radius:10px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;}
.bcx-btn:hover{border-color:#cfcfc9;background:#f6f6f2;}
.bcx-btn:disabled{opacity:.55;cursor:default;}
.bcx-btn.primary{background:#6b8a2a;color:#fff;border:none;font-weight:600;}
.bcx-btn.sel{background:#1e2420;color:#fff;border-color:#1e2420;}
.bcx-btn.sel:hover{background:#2c3430;}
.bcx-btn .n{font-size:11px;font-weight:600;padding:1px 7px;border-radius:10px;background:rgba(0,0,0,.08);}
.bcx-btn.sel .n{background:rgba(255,255,255,.2);}
.bcx-filtros{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 10px;}
.bcx-filtrohint{font-size:12px;color:#8b8f88;}
.bcx-btn.primary:hover{background:#5f7d24;}
.bcx-table{width:100%;border-collapse:collapse;font-size:12.5px;background:#fff;border:1px solid #ecece8;border-radius:12px;overflow:hidden;}
.bcx-table th{text-align:left;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9a9e96;padding:9px 12px;border-bottom:1px solid #ecece8;background:#fbfaf7;}
.bcx-table td{padding:8px 12px;border-bottom:1px solid #f1f1ec;vertical-align:top;}
.bcx-table tr:last-child td{border-bottom:none;}
.bcx-empty{background:#fff;border:1px solid #ecece8;border-radius:16px;padding:48px 20px;text-align:center;color:#8b8f88;display:flex;flex-direction:column;align-items:center;gap:10px;}
.bcx-empty .big{font-size:15px;font-weight:600;color:#1e2420;}
.bcx-emptyic{width:48px;height:48px;border-radius:50%;background:#f1f1ec;display:flex;align-items:center;justify-content:center;color:#8b8f88;}
.bcx-foot{font-size:12px;color:#8b8f88;margin-top:14px;}
`;

const pctClass = (p: number | null) => p == null ? "na" : p >= 95 ? "ok" : p >= 90 ? "mid" : "bad";

export default function BotClientesPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<"todos" | "sin_tel">("todos"); // "Sin teléfono": para ir cargando los números
  const [search, setSearch] = useState("");
  const [comboOpen, setComboOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!comboOpen) return;
    const h = (e: MouseEvent) => { if (!comboRef.current?.contains(e.target as Node)) setComboOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [comboOpen]);

  const { data, isLoading, error } = useQuery<Data>({ queryKey: ["/api/bot-clientes"], queryFn: async () => {
    const r = await fetch("/api/bot-clientes", { credentials: "include" });
    if (!r.ok) throw new Error((await r.json()).error ?? "Error");
    return r.json();
  } });
  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const invalidate = () => { queryClient.invalidateQueries({ queryKey: ["/api/bot-clientes"] }); queryClient.invalidateQueries({ queryKey: ["/api/customers"] }); };

  const toggle = useMutation({
    mutationFn: ({ id, botActivo }: { id: number; botActivo: boolean }) => apiRequest("PATCH", `/api/customers/${id}`, { botActivo }),
    onSuccess: (_r, v) => { invalidate(); toast({ title: v.botActivo ? "Bot activado" : "Bot apagado" }); },
    onError: (e: any) => toast({ title: "No se pudo cambiar", description: e.message, variant: "destructive" }),
  });

  const activeIds = useMemo(() => new Set((data?.clientes ?? []).filter((c) => c.botActivo).map((c) => c.customerId)), [data]);
  const sinTel = useMemo(() => (data?.clientes ?? []).filter((c) => c.contactos.length === 0).length, [data]);
  const visibles = useMemo(() => (data?.clientes ?? []).filter((c) => filtro === "todos" || c.contactos.length === 0), [data, filtro]);
  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => c.active && (!q || c.name.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name, "es")).slice(0, 12);
  }, [customers, search]);

  return (
    <Layout title="Bot por cliente">
      <div className="bot-rx">
        <style>{BCX_CSS}</style>
        <div className="bcx-wrap">
          <div className="bcx-pagehead">
            <div>
              <h1>Bot de WhatsApp</h1>
              <p className="sub">Clientes con el bot prendido, sus teléfonos de pedido y cómo le está yendo. Los que no están acá siguen en sombra.</p>
            </div>
            {/* Desplegable: elegir clientes para prender el bot */}
            <div className="bcx-combo" ref={comboRef}>
              <div className="bcx-inputwrap">
                <Search className="h-4 w-4" />
                <input
                  className="bcx-input"
                  placeholder="Agregar cliente al bot..."
                  autoComplete="off"
                  value={search}
                  onFocus={() => setComboOpen(true)}
                  onChange={(e) => { setSearch(e.target.value); setComboOpen(true); }}
                  data-testid="input-bot-customer-search"
                />
              </div>
              {comboOpen && (
                <div className="bcx-dropdown">
                  {options.length === 0 ? <div className="bcx-opt empty">Sin resultados</div> : options.map((c) => (
                    <div
                      key={c.id}
                      className="bcx-opt"
                      onMouseDown={() => {
                        if (!activeIds.has(c.id)) toggle.mutate({ id: c.id, botActivo: true });
                        setSearch(""); setComboOpen(false); setOpen(c.id);
                      }}
                      data-testid={`bot-option-${c.id}`}
                    >
                      <span>{c.name}</span>
                      {activeIds.has(c.id) ? <span className="on"><Check className="inline h-3 w-3" /> con bot</span> : <Plus className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {isLoading && <p className="text-sm text-muted-foreground">Calculando...</p>}
          {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

          {data && (
            <>
              <div className="bcx-resumen">
                <div className="bcx-rhead">
                  <span className="ic"><TrendingUp className="h-[18px] w-[18px]" /></span>
                  <span className="t">Últimos {data.resumen.dias} días</span>
                  <span className="d">todos los mensajes que leyó el bot, con bot prendido o en sombra</span>
                </div>
                <div className="bcx-metrics">
                  <div className="bcx-metric"><div className="lab">Pedidos leídos</div><div className="val bcx-num">{data.resumen.pedidos}</div><div className="sub">mensajes que el bot interpretó</div></div>
                  <div className="bcx-metric"><div className="lab">Renglones leídos</div><div className="val bcx-num">{data.resumen.renglones}</div><div className="sub">líneas de producto propuestas</div></div>
                  <div className="bcx-metric"><div className="lab">% acierto</div><div className={`val bcx-num ${data.resumen.pct == null ? "" : data.resumen.pct >= 95 ? "text-[#5f8020]" : data.resumen.pct >= 90 ? "text-[#c08a1e]" : "text-[#c05e42]"}`}>{data.resumen.pct == null ? "—" : `${data.resumen.pct}%`}</div><div className="sub">renglones iguales a lo que quedó cargado</div></div>
                </div>
              </div>

              {data.clientes.length > 0 && (
                <div className="bcx-filtros">
                  <button type="button" className={`bcx-btn ${filtro === "todos" ? "sel" : ""}`} onClick={() => setFiltro("todos")} data-testid="filtro-todos">Todos <span className="n">{data.clientes.length}</span></button>
                  <button type="button" className={`bcx-btn ${filtro === "sin_tel" ? "sel" : ""}`} onClick={() => setFiltro("sin_tel")} data-testid="filtro-sin-telefono"><Phone className="h-3.5 w-3.5" /> Sin teléfono <span className="n">{sinTel}</span></button>
                  {filtro === "sin_tel" && <span className="bcx-filtrohint">Clientes con bot que todavía no tienen ningún teléfono de pedido cargado: sus mensajes caen en Números por asignar.</span>}
                </div>
              )}
              {data.clientes.length === 0 ? (
                <div className="bcx-empty">
                  <div className="bcx-emptyic"><Bot className="h-5 w-5" /></div>
                  <div className="big">Ningún cliente con bot todavía</div>
                  <div>Buscá un cliente arriba para prenderle el bot.</div>
                </div>
              ) : visibles.length === 0 ? (
                <div className="bcx-empty">
                  <div className="bcx-emptyic"><Check className="h-5 w-5" /></div>
                  <div className="big">Todos los clientes con bot tienen teléfono</div>
                  <div>No queda ninguno por cargar.</div>
                </div>
              ) : (
                <div className="bcx-list">
                  {visibles.map((c) => (
                    <ClienteCard key={c.customerId} c={c} open={open === c.customerId} onOpen={() => setOpen(open === c.customerId ? null : c.customerId)}
                      onToggle={(v) => toggle.mutate({ id: c.customerId, botActivo: v })} busy={toggle.isPending} onChanged={invalidate} />
                  ))}
                </div>
              )}
              <div className="bcx-card" style={{ marginTop: 18, padding: "16px 20px" }}>
                <RulesBlock customerId={null} title="Reglas generales del bot (valen para todos los clientes)" hint='Ej. "piezas de verdeo, kale o ciboulette = atados", "ristra de ajo = 1 cajón". Se agregan solas cuando respondés una consulta con una instrucción general, o acá.' />
              </div>
              <p className="bcx-foot">Tabla: últimos 60 días. "Con error" = el bot leyó un producto, unidad o cantidad distintos de lo que quedó cargado. Un mismo teléfono puede estar en varios clientes (La Marquesa y Quinquela, por ejemplo). Horas de Argentina.</p>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

function ClienteCard({ c, open, onOpen, onToggle, busy, onChanged }: { c: Row; open: boolean; onOpen: () => void; onToggle: (v: boolean) => void; busy: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const add = useMutation({
    mutationFn: () => apiRequest("POST", `/api/customers/${c.customerId}/contacts`, { phone, name: name.trim() || null }),
    onSuccess: () => { onChanged(); setPhone(""); setName(""); toast({ title: "Teléfono agregado" }); },
    onError: (e: any) => toast({ title: "No se pudo agregar", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/customer-contacts/${id}`),
    onSuccess: () => onChanged(),
  });
  // A-12: alias ("Álvarez" = este cliente) — memoria para que el bot elija la sede por el texto
  const [alias, setAlias] = useState("");
  const addAlias = useMutation({
    mutationFn: () => apiRequest("POST", "/api/customer-aliases", { customerId: c.customerId, alias, source: "manual" }),
    onSuccess: () => { onChanged(); setAlias(""); toast({ title: "Alias guardado" }); },
    onError: (e: any) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });
  const removeAlias = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/customer-aliases/${id}`),
    onSuccess: () => onChanged(),
  });
  const cls = pctClass(c.pct);
  return (
    <div className="bcx-card">
      <div className="bcx-row" onClick={onOpen} data-testid={`bot-card-${c.customerId}`}>
        <span className={`bcx-pic ${c.botActivo ? "on" : ""}`}><Bot className="h-[22px] w-[22px]" /></span>
        <div className="bcx-mid">
          <div className="bcx-tags">
            <span className={`bcx-chip ${c.botActivo ? "on" : "off"}`}>{c.botActivo ? "Bot activo" : "En sombra"}</span>
            <span className="bcx-chip tel"><Phone className="h-3 w-3" />{c.contactos.length === 0 ? "sin teléfono" : c.contactos.length === 1 ? "1 teléfono" : `${c.contactos.length} teléfonos`}</span>
            {c.dudas > 0 && <span className="bcx-chip duda">{c.dudas} {c.dudas === 1 ? "duda" : "dudas"}</span>}
          </div>
          <div className="bcx-name">{c.cliente}</div>
          <div className="bcx-meta">
            <span><span className="k bcx-num">{c.pedidos}</span> pedidos leídos</span>
            <span>·</span>
            <span><span className="k bcx-num">{c.renglones}</span> renglones</span>
            <span>·</span>
            <span>con error <span className="k bcx-num">{c.errores} de {c.comparables}</span></span>
            {c.ultimoPedido && <><span>·</span><span>último <span className="k bcx-mono">{c.ultimoPedido}</span></span></>}
          </div>
        </div>
        <div className="bcx-switch" onClick={(e) => e.stopPropagation()}>
          <Switch checked={c.botActivo} disabled={busy} onCheckedChange={onToggle} data-testid={`switch-bot-${c.customerId}`} />
          <span>bot</span>
        </div>
        <div className="bcx-right">
          <div className="rl">% acierto</div>
          <div className={`rv bcx-num ${cls}`}>{c.pct == null ? "—" : `${c.pct}%`}</div>
          <div className="sub">{c.comparables === 0 ? "sin pedido para comparar" : `${c.comparables - c.errores} de ${c.comparables} iguales`}</div>
        </div>
        <span className="bcx-chev">{open ? <ChevronDown className="h-[18px] w-[18px]" /> : <ChevronRight className="h-[18px] w-[18px]" />}</span>
      </div>

      {open && (
        <div className="bcx-detail">
          <p className="bcx-dtitle">Teléfonos de pedido <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#8b8f88" }}>· podés cargar varios: el bot reconoce cualquiera de ellos</span></p>
          <div className="bcx-tels">
            {c.contactos.map((t) => (
              <span key={t.id} className="bcx-tel">
                <Phone className="h-3.5 w-3.5 text-[#3a67a3]" />
                <span className="bcx-mono">{formatArPhone(t.phone)}</span>
                {t.name && <span className="n">{t.name}</span>}
                <button type="button" title="Quitar" onClick={() => remove.mutate(t.id)} data-testid={`remove-contact-${t.id}`}><X className="h-3.5 w-3.5" /></button>
              </span>
            ))}
            <span className="bcx-addtel">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={c.contactos.length ? "Otro teléfono" : "11 2345 6789"} style={{ width: 140 }} data-testid={`input-phone-${c.customerId}`} />
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre / rol (Juan - cocina)" style={{ width: 210 }} />
              <button type="button" className="bcx-btn primary" disabled={!phone.trim() || add.isPending} onClick={() => add.mutate()} data-testid={`add-phone-${c.customerId}`}><Plus className="h-3.5 w-3.5" /> Agregar</button>
            </span>
          </div>

          <p className="bcx-dtitle">Cómo lo nombran en los mensajes (alias)</p>
          <div className="bcx-tels">
            {c.aliases.length === 0 && <span style={{ fontSize: 13, color: "#8b8f88" }}>Sin alias. Se agregan solos cuando asignás un caso en Números por asignar, o acá.</span>}
            {c.aliases.map((a) => (
              <span key={a.id} className="bcx-tel">
                <span>{a.alias}</span>
                <button type="button" title="Quitar" onClick={() => removeAlias.mutate(a.id)}><X className="h-3.5 w-3.5" /></button>
              </span>
            ))}
            <span className="bcx-addtel">
              <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder='Ej. "Álvarez"' style={{ width: 180 }} data-testid={`input-alias-${c.customerId}`} />
              <button type="button" className="bcx-btn" disabled={!alias.trim() || addAlias.isPending} onClick={() => addAlias.mutate()}><Plus className="h-3.5 w-3.5" /> Agregar alias</button>
            </span>
          </div>

          <RulesBlock customerId={c.customerId} title="Reglas para este cliente" hint='Lo que le enseñaste al bot sobre este cliente. Se agregan solas cuando respondés una consulta con una instrucción, o acá.' />

          <p className="bcx-dtitle">Renglones con error</p>
          {c.detalle.length === 0 ? (
            <p className="text-sm" style={{ color: "#8b8f88" }}>{c.comparables === 0 ? "Todavía no hay un pedido cargado contra el que comparar." : "Ninguno: todo lo que leyó el bot coincide con lo cargado."}</p>
          ) : (
            <table className="bcx-table">
              <thead><tr><th>Cuándo</th><th>Pedido</th><th>El cliente escribió</th><th>El bot leyó</th><th>Quedó cargado</th></tr></thead>
              <tbody>
                {c.detalle.map((d, i) => (
                  <tr key={i}>
                    <td className="bcx-mono" style={{ whiteSpace: "nowrap" }}>{d.fecha}</td>
                    <td>{d.folio ?? ""}</td>
                    <td className="bcx-mono">{d.raw}</td>
                    <td>{d.bot}{d.duda && <span className="bcx-chip duda" style={{ marginLeft: 6 }}>duda</span>}</td>
                    <td>{d.erp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
