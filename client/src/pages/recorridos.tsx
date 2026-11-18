// Recorridos (18/11/2026): pedidos de un día en el mapa de Google, con horario de entrega y bultos para armar la
// camioneta. Admin y administrativo. Los clientes sin dirección o sin ubicar se listan aparte y se completan acá mismo
// (dirección, ciudad, horario) → PATCH /api/customers/:id con la geocodificación hecha en el navegador.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Clock, Truck, AlertTriangle, Pencil, Check, X, ExternalLink, LocateFixed } from "lucide-react";
import { VX_CSS, fetchJson, formatRemito } from "@/pages/vendedor/rx";
import { loadGoogleMaps, geocodeAddress, geoKey, GOOGLE_MAPS_KEY } from "@/lib/maps";

type Parada = {
  id: number; folio: string; remitoNum: number | null; status: "approved" | "draft"; notes: string | null;
  customerId: number; customerName: string; address: string | null; city: string | null; phone: string | null;
  lat: string | null; lng: string | null; geoAddress: string | null; deliveryFrom: string | null; deliveryTo: string | null;
  bultos: number; kg: number; atados: number; unidades: number; items: number;
};

const localStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtN = (v: number) => (Math.round(v * 10) / 10).toLocaleString("es-AR");
const horario = (p: { deliveryFrom: string | null; deliveryTo: string | null }) =>
  p.deliveryFrom && p.deliveryTo ? `${p.deliveryFrom}–${p.deliveryTo}` : p.deliveryFrom ? `desde ${p.deliveryFrom}` : p.deliveryTo ? `hasta ${p.deliveryTo}` : "sin horario";
const ubicada = (p: Parada) => p.lat != null && p.lng != null && !!(p.address ?? "").trim() && p.geoAddress === geoKey(p.address, p.city);
const CENTRO = { lat: -34.62, lng: -58.46 };

// Pin SVG con número (verde = antes de las 10, naranja = después, gris = sin horario)
function pinIcon(maps: any, n: number, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44"><path d="M17 1C8.2 1 1 8.2 1 17c0 11 16 26 16 26s16-15 16-26C33 8.2 25.8 1 17 1z" fill="${color}" stroke="#fff" stroke-width="2"/><text x="17" y="22" text-anchor="middle" font-family="Inter,Arial" font-size="13" font-weight="700" fill="#fff">${n}</text></svg>`;
  return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg), scaledSize: new maps.Size(34, 44), anchor: new maps.Point(17, 43) };
}
const colorDe = (p: Parada) => !p.deliveryFrom ? "#8b8f88" : p.deliveryFrom < "10:00" ? "#6b8a2a" : "#c08a1e";

export default function RecorridosPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const hoy = localStr(new Date());
  const [date, setDate] = useState(hoy);
  const [sel, setSel] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ customerId: number; address: string; city: string; deliveryFrom: string; deliveryTo: string } | null>(null);
  const [ubicando, setUbicando] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [listo, setListo] = useState(0); // sube cuando el mapa quedó creado → dibuja los marcadores
  // El div del mapa recién existe cuando Layout termina de cargar la sesión (antes muestra un spinner): por eso es
  // estado y no ref, así el efecto de inicialización corre cuando el div aparece y no antes.
  const [mapDiv, setMapDiv] = useState<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<number, any>>(new Map());
  const infoRef = useRef<any>(null);

  const { data: paradas = [], isLoading, error } = useQuery<Parada[]>({
    queryKey: ["/api/recorridos", date],
    queryFn: () => fetchJson<Parada[]>(`/api/recorridos?date=${date}`),
  });

  const manana = localStr(new Date(Date.now() + 86400000));
  const ubicadas = useMemo(() => paradas.filter(ubicada).sort((a, b) => (a.deliveryFrom ?? "99").localeCompare(b.deliveryFrom ?? "99") || a.customerName.localeCompare(b.customerName)), [paradas]);
  const sinUbicar = useMemo(() => paradas.filter((p) => !ubicada(p)), [paradas]);
  const tot = useMemo(() => paradas.reduce((a, p) => ({ bultos: a.bultos + p.bultos, kg: a.kg + p.kg, atados: a.atados + p.atados, unidades: a.unidades + p.unidades }), { bultos: 0, kg: 0, atados: 0, unidades: 0 }), [paradas]);
  const orden = useMemo(() => new Map(ubicadas.map((p, i) => [p.id, i + 1])), [ubicadas]);

  // Mapa: se crea cuando el div está en pantalla (una sola vez)
  useEffect(() => {
    if (!mapDiv || mapRef.current) return;
    let vivo = true;
    loadGoogleMaps().then((maps) => {
      if (!vivo || mapRef.current) return;
      mapRef.current = new maps.Map(mapDiv, { center: CENTRO, zoom: 12, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, clickableIcons: false });
      infoRef.current = new maps.InfoWindow();
      // Google avisa en consola si la clave no está habilitada para este sitio; lo mostramos en pantalla
      (window as any).gm_authFailure = () => setMapError("Google rechazó la clave para este sitio (revisá la restricción de sitios web en Google Cloud).");
      setMapError(null);
      setListo((n) => n + 1);
    }).catch((e) => setMapError(e.message));
    return () => { vivo = false; };
  }, [mapDiv]);

  // Marcadores: se rehacen cuando cambian las paradas
  useEffect(() => {
    const maps = (window as any).google?.maps;
    const map = mapRef.current;
    if (!maps || !map) return;
    Array.from(markersRef.current.values()).forEach((m) => m.setMap(null));
    markersRef.current.clear();
    const bounds = new maps.LatLngBounds();
    ubicadas.forEach((p, i) => {
      const pos = { lat: Number(p.lat), lng: Number(p.lng) };
      const m = new maps.Marker({ position: pos, map, icon: pinIcon(maps, i + 1, colorDe(p)), title: p.customerName, zIndex: 1000 - i });
      m.addListener("click", () => abrir(p));
      markersRef.current.set(p.id, m);
      bounds.extend(pos);
    });
    if (ubicadas.length > 1) map.fitBounds(bounds, 60);
    else if (ubicadas.length === 1) { map.setCenter(bounds.getCenter()); map.setZoom(15); }
  }, [ubicadas, listo]);

  const abrir = (p: Parada) => {
    setSel(p.id);
    const maps = (window as any).google?.maps; const map = mapRef.current; const m = markersRef.current.get(p.id);
    if (!maps || !map || !m) return;
    map.panTo(m.getPosition());
    if (map.getZoom() < 14) map.setZoom(15);
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
    infoRef.current.setContent(`<div style="font-family:Inter,system-ui;font-size:13px;min-width:220px">
      <div style="font-family:'Bricolage Grotesque',Inter;font-size:15px;font-weight:700;margin-bottom:4px">${orden.get(p.id)}. ${esc(p.customerName)}</div>
      <div style="color:#5f8020;font-weight:600">Entrega ${esc(horario(p))}</div>
      <div style="margin-top:4px"><b>${fmtN(p.bultos)} bultos</b> · ${fmtN(p.kg)} kg sueltos · ${fmtN(p.atados)} atados${p.unidades ? ` · ${fmtN(p.unidades)} un.` : ""}</div>
      <div style="color:#8b8f88;font-size:12px;margin-top:4px">${esc([p.address, p.city].filter(Boolean).join(", "))}</div>
      <div style="color:#8b8f88;font-size:12px">Remito ${esc(formatRemito(p))}${p.status === "draft" ? " · borrador" : ""}${p.phone ? ` · ${esc(p.phone)}` : ""}</div>
      <a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" target="_blank" rel="noopener" style="display:inline-block;margin-top:8px;color:#3a67a3;font-weight:600;text-decoration:none">Cómo llegar ↗</a>
    </div>`);
    infoRef.current.open({ map, anchor: m });
  };

  const guardar = useMutation({
    mutationFn: async (e: NonNullable<typeof edit>) => {
      setUbicando(true);
      let lat: string | null = null, lng: string | null = null, geoAddress: string | null = null, aviso: string | undefined;
      try {
        if (e.address.trim()) {
          const g = await geocodeAddress(e.address, e.city);
          if (g) { lat = g.lat.toFixed(7); lng = g.lng.toFixed(7); geoAddress = geoKey(e.address, e.city); if (g.partial) aviso = `Ubicación aproximada: Google interpretó "${g.formatted}".`; }
          else aviso = "Google no encontró esa dirección. Probá con calle, número y localidad.";
        }
      } catch (err: any) { aviso = `No se pudo ubicar: ${err?.message ?? "error de Google Maps"}`; }
      finally { setUbicando(false); }
      await apiRequest("PATCH", `/api/customers/${e.customerId}`, { address: e.address || null, city: e.city || null, deliveryFrom: e.deliveryFrom || null, deliveryTo: e.deliveryTo || null, lat, lng, geoAddress });
      return aviso;
    },
    onSuccess: (aviso) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recorridos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({ title: aviso ? "Guardado con aviso" : "Cliente actualizado", description: aviso });
      setEdit(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const abrirEdicion = (p: Parada) => setEdit({ customerId: p.customerId, address: p.address ?? "", city: p.city ?? "", deliveryFrom: p.deliveryFrom ?? "", deliveryTo: p.deliveryTo ?? "" });
  const fechaLabel = new Date(date + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "long" });

  // Función (no componente): si fuera un componente definido adentro del render, cada tecla lo remontaría y perdería el foco
  const renderEditor = (p: Parada) => edit && edit.customerId === p.customerId ? (
    <div className="rc-edit" onClick={(e) => e.stopPropagation()}>
      <input className="vx-input" placeholder="Calle y número" value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
      <input className="vx-input" placeholder="Localidad / barrio" value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} />
      <div className="rc-hor">
        <label>Desde <input className="vx-input" type="time" value={edit.deliveryFrom} onChange={(e) => setEdit({ ...edit, deliveryFrom: e.target.value })} /></label>
        <label>Hasta <input className="vx-input" type="time" value={edit.deliveryTo} onChange={(e) => setEdit({ ...edit, deliveryTo: e.target.value })} /></label>
      </div>
      <div className="rc-acts">
        <button className="vx-btn primary" disabled={guardar.isPending || ubicando} onClick={() => guardar.mutate(edit)}><Check className="h-4 w-4" /> {ubicando ? "Ubicando..." : guardar.isPending ? "Guardando..." : "Guardar y ubicar"}</button>
        <button className="vx-btn" onClick={() => setEdit(null)}><X className="h-4 w-4" /> Cancelar</button>
      </div>
    </div>
  ) : null;

  return (
    <Layout title="Recorridos">
      <div className="vx">
        <style>{VX_CSS}{RC_CSS}</style>
        <div className="vx-wrap" style={{ maxWidth: 1400 }}>
          <div className="vx-top">
            <div>
              <h1 className="vx-title">Recorridos</h1>
              <div className="vx-subtitle" style={{ textTransform: "capitalize" }}>{fechaLabel}</div>
            </div>
            <div className="vx-controls">
              <input type="date" className="vx-input" value={date} onChange={(e) => setDate(e.target.value || hoy)} data-testid="input-date" />
              <button className={`vx-btn${date === hoy ? " primary" : ""}`} onClick={() => setDate(hoy)}>Hoy</button>
              <button className={`vx-btn${date === manana ? " primary" : ""}`} onClick={() => setDate(manana)}>Mañana</button>
            </div>
          </div>

          <div className="vx-kpis c4">
            <div className="vx-kpi main"><div className="lab">Pedidos del día</div><div className="val">{paradas.length}</div><div className="note">{ubicadas.length} ubicados{sinUbicar.length ? ` · ${sinUbicar.length} sin ubicar` : ""}</div></div>
            <div className="vx-kpi"><div className="lab">Bultos</div><div className="val">{fmtN(tot.bultos)}</div><div className="note">cajones, bolsas y bandejas</div></div>
            <div className="vx-kpi"><div className="lab">Kilos sueltos</div><div className="val">{fmtN(tot.kg)} kg</div><div className="note">no cuentan como bulto</div></div>
            <div className="vx-kpi"><div className="lab">Atados</div><div className="val">{fmtN(tot.atados)}</div><div className="note">{tot.unidades ? `+ ${fmtN(tot.unidades)} unidades / maples` : "verdura de hoja"}</div></div>
          </div>

          {error && <div className="vx-err">Error al cargar: {String((error as any).message ?? error)}</div>}

          <div className="rc-grid">
            <div className="rc-mapwrap">
              <div ref={setMapDiv} className="rc-map" />
              {mapError && (
                <div className="rc-maperr">
                  <AlertTriangle className="h-5 w-5" />
                  <div><b>No se pudo mostrar el mapa.</b><div>{mapError}</div>{!GOOGLE_MAPS_KEY && <div>Falta configurar VITE_GOOGLE_MAPS_KEY.</div>}</div>
                </div>
              )}
              {!isLoading && paradas.length === 0 && !mapError && <div className="rc-mapmsg">Sin pedidos para esta fecha</div>}
            </div>

            <div className="vx-card rc-list">
              <div className="vx-chead"><span className="t"><Truck className="h-4 w-4" /> Orden sugerido por horario</span><span className="n">tocá uno para verlo en el mapa</span></div>
              <div className="rc-rows">
                {isLoading ? <div style={{ padding: 16 }}><Skeleton className="h-24 w-full" /></div> : ubicadas.length === 0 && sinUbicar.length === 0 ? (
                  <div style={{ padding: "28px 18px", textAlign: "center", color: "#8b8f88", fontSize: 14 }}>No hay pedidos para {fechaLabel}</div>
                ) : ubicadas.map((p) => (
                  <div key={p.id} className={`rc-row${sel === p.id ? " on" : ""}`} onClick={() => abrir(p)} data-testid={`row-parada-${p.id}`}>
                    <div className="rc-num" style={{ background: colorDe(p) }}>{orden.get(p.id)}</div>
                    <div className="rc-main">
                      <b>{p.customerName}{p.status === "draft" && <span className="vx-chip par" style={{ marginLeft: 6 }}>borrador</span>}</b>
                      <span><Clock className="h-3 w-3" /> {horario(p)} · {formatRemito(p)}</span>
                      <span className="rc-dir"><MapPin className="h-3 w-3" /> {[p.address, p.city].filter(Boolean).join(", ")}</span>
                      {renderEditor(p)}
                    </div>
                    <div className="rc-bul">{fmtN(p.bultos)} bultos<small>{fmtN(p.kg)} kg · {fmtN(p.atados)} at.</small></div>
                    <button className="vx-ic" title="Editar dirección y horario" onClick={(e) => { e.stopPropagation(); abrirEdicion(p); }}><Pencil className="h-4 w-4" /></button>
                  </div>
                ))}
                {sinUbicar.length > 0 && (
                  <>
                    <div className="rc-sec"><AlertTriangle className="h-3.5 w-3.5" /> Sin ubicar ({sinUbicar.length}): cargá la dirección para que aparezcan en el mapa</div>
                    {sinUbicar.map((p) => (
                      <div key={p.id} className="rc-row" data-testid={`row-sin-${p.id}`}>
                        <div className="rc-num sin">!</div>
                        <div className="rc-main">
                          <b>{p.customerName}{p.status === "draft" && <span className="vx-chip par" style={{ marginLeft: 6 }}>borrador</span>}</b>
                          <span><Clock className="h-3 w-3" /> {horario(p)} · {formatRemito(p)}</span>
                          <span className="rc-dir">{(p.address ?? "").trim() ? <><MapPin className="h-3 w-3" /> {[p.address, p.city].filter(Boolean).join(", ")} · <i>no se pudo ubicar, revisá la dirección</i></> : <i>sin dirección cargada</i>}</span>
                          {renderEditor(p)}
                        </div>
                        <div className="rc-bul">{fmtN(p.bultos)} bultos<small>{fmtN(p.kg)} kg · {fmtN(p.atados)} at.</small></div>
                        {!(edit && edit.customerId === p.customerId) && (
                          <button className="vx-btn" style={{ padding: "6px 10px", fontSize: 12.5 }} onClick={() => abrirEdicion(p)}><LocateFixed className="h-3.5 w-3.5" /> Ubicar</button>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
              {ubicadas.length > 0 && (
                <div className="rc-foot">
                  <a className="vx-btn" href={`https://www.google.com/maps/dir/?api=1&destination=${ubicadas[ubicadas.length - 1].lat},${ubicadas[ubicadas.length - 1].lng}&waypoints=${ubicadas.slice(0, -1).slice(0, 9).map((p) => `${p.lat},${p.lng}`).join("|")}&travelmode=driving`} target="_blank" rel="noopener noreferrer" title="Abre Google Maps con las primeras 10 paradas en este orden">
                    <ExternalLink className="h-4 w-4" /> Abrir recorrido en Google Maps
                  </a>
                  <span className="n">Ver pedido: <button className="vx-link" onClick={() => sel && setLocation(`/orders/${sel}`)} disabled={!sel}>{sel ? formatRemito(paradas.find((p) => p.id === sel)!) : "elegí una parada"}</button></span>
                </div>
              )}
            </div>
          </div>
          <div className="vx-note">Verde: entrega antes de las 10 · Naranja: después de las 10 · Gris: sin horario. Los bultos son cajones, bolsas y bandejas; las líneas de Bolsa FV no cuentan. Pedidos en borrador incluidos.</div>
        </div>
      </div>
    </Layout>
  );
}

const RC_CSS = `
.rc-grid{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:16px;}
.rc-mapwrap{position:relative;}
.rc-map{height:640px;border-radius:16px;border:1px solid #ecece8;background:#e9eae5;overflow:hidden;}
.rc-maperr{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:12px;padding:24px;background:rgba(244,244,241,.92);border-radius:16px;color:#b0553f;font-size:13.5px;text-align:left;}
.rc-maperr b{display:block;color:#1e2420;margin-bottom:2px;}
.rc-mapmsg{position:absolute;left:50%;top:16px;transform:translateX(-50%);background:#fff;border:1px solid #ecece8;border-radius:10px;padding:8px 14px;font-size:13px;color:#8b8f88;}
.rc-list{display:flex;flex-direction:column;max-height:640px;margin-bottom:0;}
.rc-rows{overflow:auto;flex:1;}
.rc-row{display:flex;gap:10px;align-items:flex-start;padding:11px 16px;border-top:1px solid #f5f5f2;font-size:13px;cursor:pointer;}
.rc-row:hover{background:#f8f8f5;}
.rc-row.on{background:#eef3e3;}
.rc-num{width:26px;height:26px;border-radius:50%;background:#6b8a2a;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 auto;margin-top:1px;}
.rc-num.sin{background:#c05e42;}
.rc-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
.rc-main b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rc-main span{font-size:12px;color:#8b8f88;display:flex;align-items:center;gap:4px;}
.rc-main .rc-dir{white-space:normal;}
.rc-bul{font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right;}
.rc-bul small{display:block;font-weight:400;font-size:11px;color:#8b8f88;}
.rc-sec{display:flex;align-items:center;gap:6px;padding:10px 16px 6px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#c05e42;border-top:1px solid #f5f5f2;background:#fdf4f1;}
.rc-edit{display:flex;flex-direction:column;gap:6px;margin-top:8px;padding:10px;background:#fbfaf7;border:1px solid #ecece8;border-radius:10px;cursor:default;}
.rc-edit .vx-input{width:100%;font-size:13px;padding:7px 10px;}
.rc-hor{display:flex;gap:8px;}
.rc-hor label{flex:1;font-size:11.5px;color:#8b8f88;display:flex;flex-direction:column;gap:3px;}
.rc-acts{display:flex;gap:8px;margin-top:2px;}
.rc-acts .vx-btn{padding:7px 11px;font-size:12.5px;}
.rc-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-top:1px solid #eeeeea;flex-wrap:wrap;}
.rc-foot .n{font-size:12.5px;color:#8b8f88;}
.vx-link{background:none;border:none;color:#3a67a3;font-weight:600;cursor:pointer;font-family:inherit;font-size:12.5px;padding:0;}
.vx-link:disabled{color:#b3b6ae;cursor:default;}
@media(max-width:1000px){.rc-grid{grid-template-columns:1fr}.rc-map{height:420px}.rc-list{max-height:none}}
`;
