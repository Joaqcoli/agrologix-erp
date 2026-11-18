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
import { loadGoogleMaps, geoParaGuardar, geoKey, GOOGLE_MAPS_KEY, esPrecisa, precisionLabel } from "@/lib/maps";
import { normalizarHora } from "@/lib/hora";

type Parada = {
  id: number; folio: string; remitoNum: number | null; status: "approved" | "draft"; notes: string | null;
  customerId: number; customerName: string; address: string | null; city: string | null; phone: string | null;
  lat: string | null; lng: string | null; geoAddress: string | null; geoPrecision: string | null; deliveryFrom: string | null; deliveryTo: string | null;
  bultos: number; kg: number; atados: number; atadosBultos: number; maples: number; unidades: number; items: number;
};

const localStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtN = (v: number) => (Math.round(v * 10) / 10).toLocaleString("es-AR");
const horario = (p: { deliveryFrom: string | null; deliveryTo: string | null }) =>
  p.deliveryFrom && p.deliveryTo ? `${p.deliveryFrom}–${p.deliveryTo}` : p.deliveryFrom ? `desde ${p.deliveryFrom}` : p.deliveryTo ? `hasta ${p.deliveryTo}` : "sin horario";
const ubicada = (p: Parada) => p.lat != null && p.lng != null && !!(p.address ?? "").trim() && p.geoAddress === geoKey(p.address, p.city);
const CENTRO = { lat: -34.62, lng: -58.46 };
// 18/11: punto de salida (galpón). Coordenada EXACTA tomada de Google Maps para "Cap. Giachino 2380, B1616AJY Ingeniero
// Pablo Nogués" (fija, no se geocodifica: la primera versión geocodificaba en vivo y caía ~1,5 km corrido).
const SALIDA = { label: "Capitán Giachino 2380, Malvinas Argentinas", pos: { lat: -34.468853, lng: -58.6917694 } };
function salidaIcon(maps: any) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50" viewBox="0 0 40 50"><path d="M20 1C10 1 2 9 2 19c0 12.5 18 30 18 30s18-17.5 18-30C38 9 30 1 20 1z" fill="#293C4B" stroke="#fff" stroke-width="2.5"/><path d="M12 24v-7l8-6 8 6v7h-5v-5h-6v5z" fill="#fff"/></svg>`;
  return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg), scaledSize: new maps.Size(40, 50), anchor: new maps.Point(20, 49) };
}

// Pin SVG con número (verde = antes de las 10, naranja = después, gris = sin horario)
function pinIcon(maps: any, n: number, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44"><path d="M17 1C8.2 1 1 8.2 1 17c0 11 16 26 16 26s16-15 16-26C33 8.2 25.8 1 17 1z" fill="${color}" stroke="#fff" stroke-width="2"/><text x="17" y="22" text-anchor="middle" font-family="Inter,Arial" font-size="13" font-weight="700" fill="#fff">${n}</text></svg>`;
  return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg), scaledSize: new maps.Size(34, 44), anchor: new maps.Point(17, 43) };
}
// Equivalencias a bultos (18/11, Joaquín): 10 kg sueltos = 1 bulto; atados según producto (lo calcula el servidor);
// 12 maples de huevos = 1 cajón. Las unidades sueltas no se convierten.
const KG_POR_BULTO = 10, MAPLES_POR_CAJON = 12;
const equivalentes = (p: { kg: number; atadosBultos: number; maples: number }) => p.kg / KG_POR_BULTO + p.atadosBultos + p.maples / MAPLES_POR_CAJON;
const fmtAprox = (v: number) => (Math.round(v * 2) / 2).toLocaleString("es-AR"); // a medio bulto
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
  const salidaMarkerRef = useRef<any>(null);
  const infoRef = useRef<any>(null);
  // Ajuste manual: id del pedido cuyo pin está en modo arrastre (se guarda al soltarlo como precisión MANUAL)
  const [ajustando, setAjustando] = useState<number | null>(null);

  const { data: paradas = [], isLoading, error } = useQuery<Parada[]>({
    queryKey: ["/api/recorridos", date],
    queryFn: () => fetchJson<Parada[]>(`/api/recorridos?date=${date}`),
  });

  const manana = localStr(new Date(Date.now() + 86400000));
  const ubicadas = useMemo(() => paradas.filter(ubicada).sort((a, b) => (a.deliveryFrom ?? "99").localeCompare(b.deliveryFrom ?? "99") || a.customerName.localeCompare(b.customerName)), [paradas]);
  const sinUbicar = useMemo(() => paradas.filter((p) => !ubicada(p)), [paradas]);
  const tot = useMemo(() => paradas.reduce((a, p) => ({ bultos: a.bultos + p.bultos, kg: a.kg + p.kg, atados: a.atados + p.atados, atadosBultos: a.atadosBultos + p.atadosBultos, maples: a.maples + p.maples, unidades: a.unidades + p.unidades }), { bultos: 0, kg: 0, atados: 0, atadosBultos: 0, maples: 0, unidades: 0 }), [paradas]);
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
    // Punto de salida (pin azul oscuro con casita)
    if (salidaMarkerRef.current) salidaMarkerRef.current.setMap(null);
    salidaMarkerRef.current = new maps.Marker({ position: SALIDA.pos, map, icon: salidaIcon(maps), title: `Salida: ${SALIDA.label}`, zIndex: 2000 });
    salidaMarkerRef.current.addListener("click", () => {
      infoRef.current.setContent(`<div style="font-family:Inter,system-ui;font-size:13px"><div style="font-family:'Bricolage Grotesque',Inter;font-size:15px;font-weight:700;margin-bottom:4px">Punto de salida</div><div>${SALIDA.label}</div></div>`);
      infoRef.current.open({ map, anchor: salidaMarkerRef.current });
    });
    bounds.extend(SALIDA.pos);
    ubicadas.forEach((p, i) => {
      const pos = { lat: Number(p.lat), lng: Number(p.lng) };
      const enAjuste = ajustando === p.id;
      const m = new maps.Marker({ position: pos, map, icon: pinIcon(maps, i + 1, enAjuste ? "#3a67a3" : colorDe(p)), title: p.customerName, zIndex: enAjuste ? 1500 : 1000 - i, draggable: enAjuste, animation: enAjuste ? maps.Animation.BOUNCE : null });
      m.addListener("click", () => abrir(p));
      if (enAjuste) {
        m.addListener("dragstart", () => m.setAnimation(null));
        m.addListener("dragend", () => { const q = m.getPosition(); moverPin.mutate({ p, lat: q.lat(), lng: q.lng() }); });
      }
      markersRef.current.set(p.id, m);
      bounds.extend(pos);
    });
    // Sin ajuste en curso: encuadrar todo. En ajuste: no mover el mapa (el usuario está arrastrando).
    if (ajustando == null) {
      if (ubicadas.length >= 1) map.fitBounds(bounds, 60);
      else { map.setCenter(SALIDA.pos); map.setZoom(12); }
    }
  }, [ubicadas, listo, ajustando]);

  // Desde el popup (HTML plano) se llama a esta función global para entrar en modo ajuste
  useEffect(() => {
    (window as any).__rcAjustar = (id: number) => { setAjustando(id); infoRef.current?.close(); const m = markersRef.current.get(id); if (m && mapRef.current) { mapRef.current.panTo(m.getPosition()); if (mapRef.current.getZoom() < 17) mapRef.current.setZoom(18); } };
    return () => { delete (window as any).__rcAjustar; };
  }, []);

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
      <div style="margin-top:4px"><b>≈ ${fmtAprox(p.bultos + equivalentes(p))} bultos en la camioneta</b></div>
      <div style="font-size:12px;color:#8b8f88">${fmtN(p.bultos)} bultos · ${fmtN(p.kg)} kg sueltos · ${fmtN(p.atados)} atados${p.maples ? ` · ${fmtN(p.maples)} maples` : ""}${p.unidades ? ` · ${fmtN(p.unidades)} un.` : ""}</div>
      <div style="color:#8b8f88;font-size:12px;margin-top:4px">${esc([p.address, p.city].filter(Boolean).join(", "))}</div>
      <div style="color:#8b8f88;font-size:12px">Remito ${esc(formatRemito(p))}${p.status === "draft" ? " · borrador" : ""}${p.phone ? ` · ${esc(p.phone)}` : ""}</div>
      <div style="font-size:12px;margin-top:4px;color:${esPrecisa(p.geoPrecision) ? "#5f8020" : "#c08a1e"}">Ubicación ${esc(precisionLabel(p.geoPrecision))}</div>
      <div style="display:flex;gap:12px;margin-top:8px">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" target="_blank" rel="noopener" style="color:#3a67a3;font-weight:600;text-decoration:none">Cómo llegar ↗</a>
        <a href="#" onclick="window.__rcAjustar && window.__rcAjustar(${p.id}); return false;" style="color:#3a67a3;font-weight:600;text-decoration:none">Ajustar pin</a>
      </div>
    </div>`);
    infoRef.current.open({ map, anchor: m });
  };

  const guardar = useMutation({
    mutationFn: async (e: NonNullable<typeof edit>) => {
      setUbicando(true);
      // Mismas reglas de precisión que la ficha del cliente: sin altura exacta no se ubica (ver geoParaGuardar)
      const geo = await geoParaGuardar({ address: e.address, city: e.city }, null).finally(() => setUbicando(false));
      await apiRequest("PATCH", `/api/customers/${e.customerId}`, { address: e.address || null, city: e.city || null, deliveryFrom: normalizarHora(e.deliveryFrom) || null, deliveryTo: normalizarHora(e.deliveryTo) || null, lat: geo.lat, lng: geo.lng, geoAddress: geo.geoAddress, geoPrecision: geo.geoPrecision });
      return geo.aviso;
    },
    onSuccess: (aviso) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recorridos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({ title: aviso ? "Guardado con aviso" : "Cliente actualizado", description: aviso });
      setEdit(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Pin movido a mano: se guarda tal cual, con precisión MANUAL (no se vuelve a geocodificar mientras no cambie la dirección)
  const moverPin = useMutation({
    mutationFn: async ({ p, lat, lng }: { p: Parada; lat: number; lng: number }) => {
      await apiRequest("PATCH", `/api/customers/${p.customerId}`, { lat: lat.toFixed(7), lng: lng.toFixed(7), geoAddress: geoKey(p.address, p.city), geoPrecision: "MANUAL" });
      return p;
    },
    onSuccess: (p) => { setAjustando(null); queryClient.invalidateQueries({ queryKey: ["/api/recorridos"] }); queryClient.invalidateQueries({ queryKey: ["/api/customers"] }); toast({ title: "Pin ajustado", description: `${p.customerName}: posición guardada como exacta.` }); },
    onError: (e: any) => { setAjustando(null); toast({ title: "Error", description: e.message, variant: "destructive" }); },
  });

  const abrirEdicion = (p: Parada) => setEdit({ customerId: p.customerId, address: p.address ?? "", city: p.city ?? "", deliveryFrom: p.deliveryFrom ?? "", deliveryTo: p.deliveryTo ?? "" });
  const fechaLabel = new Date(date + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "long" });

  // Función (no componente): si fuera un componente definido adentro del render, cada tecla lo remontaría y perdería el foco
  const renderEditor = (p: Parada) => edit && edit.customerId === p.customerId ? (
    <div className="rc-edit" onClick={(e) => e.stopPropagation()}>
      <input className="vx-input" placeholder="Calle y número" value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
      <input className="vx-input" placeholder="Localidad / barrio" value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} />
      <div className="rc-hor">
        <label>Desde <input className="vx-input" inputMode="numeric" placeholder="08:00" value={edit.deliveryFrom} onChange={(e) => setEdit({ ...edit, deliveryFrom: e.target.value })} onBlur={(e) => setEdit({ ...edit, deliveryFrom: normalizarHora(e.target.value) })} /></label>
        <label>Hasta <input className="vx-input" inputMode="numeric" placeholder="10:00" value={edit.deliveryTo} onChange={(e) => setEdit({ ...edit, deliveryTo: e.target.value })} onBlur={(e) => setEdit({ ...edit, deliveryTo: normalizarHora(e.target.value) })} /></label>
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
            <div className="vx-kpi"><div className="lab">Bultos</div><div className="val">{fmtN(tot.bultos)}</div><div className="note">cajones, bolsas y bandejas · <b>≈ {fmtAprox(tot.bultos + equivalentes(tot))} en total</b> sumando kilos, atados y maples</div></div>
            <div className="vx-kpi"><div className="lab">Kilos sueltos</div><div className="val">{fmtN(tot.kg)} kg</div><div className="note">Aproximadamente {fmtAprox(tot.kg / KG_POR_BULTO)} bultos (10 kg = 1 bulto)</div></div>
            <div className="vx-kpi"><div className="lab">Atados</div><div className="val">{fmtN(tot.atados)}</div><div className="note">Aproximadamente {fmtAprox(tot.atadosBultos)} bultos según producto{tot.maples ? ` · ${fmtN(tot.maples)} maples ≈ ${fmtAprox(tot.maples / MAPLES_POR_CAJON)} cajones` : ""}{tot.unidades ? ` · ${fmtN(tot.unidades)} unidades` : ""}</div></div>
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
              <div className="rc-salida"><span className="rc-salida-dot" /> Salida: {SALIDA.label}</div>
              <div className="rc-rows">
                {isLoading ? <div style={{ padding: 16 }}><Skeleton className="h-24 w-full" /></div> : ubicadas.length === 0 && sinUbicar.length === 0 ? (
                  <div style={{ padding: "28px 18px", textAlign: "center", color: "#8b8f88", fontSize: 14 }}>No hay pedidos para {fechaLabel}</div>
                ) : ubicadas.map((p) => (
                  <div key={p.id} className={`rc-row${sel === p.id ? " on" : ""}`} onClick={() => abrir(p)} data-testid={`row-parada-${p.id}`}>
                    <div className="rc-num" style={{ background: colorDe(p) }}>{orden.get(p.id)}</div>
                    <div className="rc-main">
                      <div className="rc-top">
                        <b>{p.customerName}{p.status === "draft" && <span className="vx-chip par" style={{ marginLeft: 6 }}>borrador</span>}</b>
                        <div className="rc-right">
                          <span className="rc-tot">≈ {fmtAprox(p.bultos + equivalentes(p))} bultos</span>
                          <span className="rc-icons">
                            <button className="vx-ic" title="Ajustar el pin a mano en el mapa" onClick={(e) => { e.stopPropagation(); (window as any).__rcAjustar?.(p.id); }}><LocateFixed className="h-4 w-4" /></button>
                            <button className="vx-ic" title="Editar dirección y horario" onClick={(e) => { e.stopPropagation(); abrirEdicion(p); }}><Pencil className="h-4 w-4" /></button>
                          </span>
                        </div>
                      </div>
                      <span><Clock className="h-3 w-3" /> {horario(p)} · {formatRemito(p)}</span>
                      <span className="rc-dir"><MapPin className="h-3 w-3" /> {[p.address, p.city].filter(Boolean).join(", ")}{!esPrecisa(p.geoPrecision) && <span className="vx-chip par" title={`Ubicación ${precisionLabel(p.geoPrecision)}`}>{p.geoPrecision ? "aprox." : "verificar"}</span>}</span>
                      <span className="rc-det">{fmtN(p.bultos)} bultos · {fmtN(p.kg)} kg · {fmtN(p.atados)} at.{p.maples ? ` · ${fmtN(p.maples)} mp.` : ""}{p.unidades ? ` · ${fmtN(p.unidades)} un.` : ""}</span>
                      {ajustando === p.id && <span style={{ color: "#3a67a3", fontWeight: 600 }}>Arrastrá el pin azul en el mapa hasta el lugar exacto y soltalo · <button className="vx-link" onClick={(e) => { e.stopPropagation(); setAjustando(null); }}>cancelar</button></span>}
                      {renderEditor(p)}
                    </div>
                  </div>
                ))}
                {sinUbicar.length > 0 && (
                  <>
                    <div className="rc-sec"><AlertTriangle className="h-3.5 w-3.5" /> Sin ubicar ({sinUbicar.length}): cargá la dirección para que aparezcan en el mapa</div>
                    {sinUbicar.map((p) => (
                      <div key={p.id} className="rc-row" data-testid={`row-sin-${p.id}`}>
                        <div className="rc-num sin">!</div>
                        <div className="rc-main">
                          <div className="rc-top">
                            <b>{p.customerName}{p.status === "draft" && <span className="vx-chip par" style={{ marginLeft: 6 }}>borrador</span>}</b>
                            <div className="rc-right">
                              <span className="rc-tot">≈ {fmtAprox(p.bultos + equivalentes(p))} bultos</span>
                              {!(edit && edit.customerId === p.customerId) && (
                                <button className="vx-btn" style={{ padding: "5px 9px", fontSize: 12 }} onClick={() => abrirEdicion(p)}><LocateFixed className="h-3.5 w-3.5" /> Ubicar</button>
                              )}
                            </div>
                          </div>
                          <span><Clock className="h-3 w-3" /> {horario(p)} · {formatRemito(p)}</span>
                          <span className="rc-dir">{(p.address ?? "").trim() ? <><MapPin className="h-3 w-3" /> {[p.address, p.city].filter(Boolean).join(", ")} · <i>sin ubicar: Google no encontró la altura exacta, revisá la dirección</i></> : <i>sin dirección cargada</i>}</span>
                          <span className="rc-det">{fmtN(p.bultos)} bultos · {fmtN(p.kg)} kg · {fmtN(p.atados)} at.{p.maples ? ` · ${fmtN(p.maples)} mp.` : ""}{p.unidades ? ` · ${fmtN(p.unidades)} un.` : ""}</span>
                          {renderEditor(p)}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
              {ubicadas.length > 0 && (
                <div className="rc-foot">
                  <a className="vx-btn" href={`https://www.google.com/maps/dir/?api=1&origin=${SALIDA.pos.lat},${SALIDA.pos.lng}&destination=${ubicadas[ubicadas.length - 1].lat},${ubicadas[ubicadas.length - 1].lng}&waypoints=${ubicadas.slice(0, -1).slice(0, 9).map((p) => `${p.lat},${p.lng}`).join("|")}&travelmode=driving`} target="_blank" rel="noopener noreferrer" title="Abre Google Maps saliendo del galpón con las primeras 10 paradas en este orden">
                    <ExternalLink className="h-4 w-4" /> Abrir recorrido en Google Maps
                  </a>
                  <span className="n">Ver pedido: <button className="vx-link" onClick={() => sel && setLocation(`/orders/${sel}`)} disabled={!sel}>{sel ? formatRemito(paradas.find((p) => p.id === sel)!) : "elegí una parada"}</button></span>
                </div>
              )}
            </div>
          </div>
          <div className="vx-note">Azul oscuro: punto de salida · Verde: entrega antes de las 10 · Naranja: después de las 10 · Gris: sin horario. Los bultos son cajones, bolsas y bandejas; las líneas de Bolsa FV no cuentan. Equivalencias aproximadas: 10 kg sueltos = 1 bulto; atados: puerro, verdeo, perejil y cilantro 5 = 1, espinaca, remolacha, tomillo, orégano, ciboulette y acelga 10 = 1, albahaca 12 = 1, rúcula 24 = 1 (otros atados 10 = 1); 12 maples de huevos = 1 cajón. Pedidos en borrador incluidos. "aprox." = Google estimó la altura dentro de la cuadra: verificá el pin y ajustalo a mano si hace falta (icono de mira).</div>
        </div>
      </div>
    </Layout>
  );
}

const RC_CSS = `
.rc-grid{display:grid;grid-template-columns:minmax(0,1fr) 440px;gap:16px;}
.rc-mapwrap{position:relative;}
.rc-map{height:640px;border-radius:16px;border:1px solid #ecece8;background:#e9eae5;overflow:hidden;}
.rc-maperr{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:12px;padding:24px;background:rgba(244,244,241,.92);border-radius:16px;color:#b0553f;font-size:13.5px;text-align:left;}
.rc-maperr b{display:block;color:#1e2420;margin-bottom:2px;}
.rc-mapmsg{position:absolute;left:50%;top:16px;transform:translateX(-50%);background:#fff;border:1px solid #ecece8;border-radius:10px;padding:8px 14px;font-size:13px;color:#8b8f88;}
.rc-list{display:flex;flex-direction:column;max-height:640px;margin-bottom:0;}
.rc-rows{overflow:auto;flex:1;}
.rc-salida{display:flex;align-items:center;gap:8px;padding:0 16px 10px;font-size:12.5px;color:#4b5048;font-weight:500;}
.rc-salida-dot{width:12px;height:12px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#293C4B;border:2px solid #fff;box-shadow:0 0 0 1px #d9d9d3;flex:0 0 auto;}
.rc-row{display:flex;gap:10px;align-items:flex-start;padding:11px 16px;border-top:1px solid #f5f5f2;font-size:13px;cursor:pointer;}
.rc-row:hover{background:#f8f8f5;}
.rc-row.on{background:#eef3e3;}
.rc-num{width:26px;height:26px;border-radius:50%;background:#6b8a2a;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 auto;margin-top:1px;}
.rc-num.sin{background:#c05e42;}
.rc-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;}
.rc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}
.rc-main b{font-weight:600;line-height:1.3;min-width:0;}
.rc-right{display:flex;align-items:center;gap:6px;flex:0 0 auto;}
.rc-tot{font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums;font-size:13.5px;color:#1e2420 !important;}
.rc-icons{display:inline-flex;gap:0;}
.rc-icons .vx-ic{width:26px;height:26px;}
.rc-main span{font-size:12px;color:#8b8f88;display:flex;align-items:flex-start;gap:4px;line-height:1.35;}
.rc-main span svg{margin-top:2px;flex:0 0 auto;}
.rc-main .rc-dir{white-space:normal;flex-wrap:wrap;}
.rc-main .rc-det{color:#4b5048;font-variant-numeric:tabular-nums;}
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
