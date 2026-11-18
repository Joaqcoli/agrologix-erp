// Recorridos (18/11/2026): pedidos de un día en el mapa de Google, con horario de entrega y bultos para armar la
// camioneta. Admin y administrativo. Pestañas: Mapa (pines + lista con asignación de camioneta / recorrido / orden
// de entrega por pedido) y Camionetas (flota fija con disponibilidad + carga de hoy por recorrido con hora de salida).
// Los clientes sin dirección o sin ubicar se completan acá mismo (dirección, ciudad, horario) → PATCH /api/customers/:id
// con la geocodificación hecha en el navegador. Los pines se pueden ajustar a mano (arrastre → precisión MANUAL).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Clock, Truck, AlertTriangle, Pencil, Check, X, ExternalLink, LocateFixed, Plus, Trash2, ChevronDown } from "lucide-react";
import { VX_CSS, fetchJson } from "@/pages/vendedor/rx";
import { loadGoogleMaps, geoParaGuardar, geoKey, GOOGLE_MAPS_KEY, esPrecisa, precisionLabel } from "@/lib/maps";
import { normalizarHora } from "@/lib/hora";
import { useAuth } from "@/lib/auth";

type Parada = {
  id: number; folio: string; remitoNum: number | null; status: "approved" | "draft"; notes: string | null;
  camionetaId: number | null; recorrido: number | null; ordenEntrega: number | null;
  customerId: number; customerName: string; address: string | null; city: string | null; phone: string | null;
  lat: string | null; lng: string | null; geoAddress: string | null; geoPrecision: string | null; deliveryFrom: string | null; deliveryTo: string | null;
  bultos: number; kg: number; atados: number; atadosBultos: number; maples: number; unidades: number; items: number;
};
type Camioneta = { id: number; nombre: string; patente: string | null; capacidad: number; disponible: boolean };
type Salida = { camionetaId: number; recorrido: number; salida: string | null };

const localStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtN = (v: number) => (Math.round(v * 10) / 10).toLocaleString("es-AR");
const horario = (p: { deliveryFrom: string | null; deliveryTo: string | null }) =>
  p.deliveryFrom && p.deliveryTo ? `${p.deliveryFrom}–${p.deliveryTo}` : p.deliveryFrom ? `desde ${p.deliveryFrom}` : p.deliveryTo ? `hasta ${p.deliveryTo}` : "sin horario";
const ubicada = (p: Parada) => p.lat != null && p.lng != null && !!(p.address ?? "").trim() && p.geoAddress === geoKey(p.address, p.city);
// 18/11: punto de salida (galpón), coordenada FIJA (no se geocodifica). Joaquín: "Capitán Giachino entre República
// Argentina y Luis Piedra Buena, a mitad de cuadra" → punto medio entre las dos esquinas según Google Maps
// (Giachino & Rep. Argentina -34.4591877,-58.6989118 · Giachino & Piedrabuena -34.4602485,-58.6980774).
const SALIDA = { label: "Capitán Giachino e/ República Argentina y Luis Piedra Buena, Pablo Nogués", pos: { lat: -34.4597181, lng: -58.6984946 } };
// Equivalencias a bultos (18/11, Joaquín): 10 kg sueltos = 1 bulto; atados según producto (lo calcula el servidor);
// 12 maples de huevos = 1 cajón. Las unidades sueltas no se convierten.
const KG_POR_BULTO = 10, MAPLES_POR_CAJON = 12;
const equivalentes = (p: { kg: number; atadosBultos: number; maples: number }) => p.kg / KG_POR_BULTO + p.atadosBultos + p.maples / MAPLES_POR_CAJON;
const totalAprox = (p: { bultos: number; kg: number; atadosBultos: number; maples: number }) => p.bultos + equivalentes(p);
const fmtAprox = (v: number) => (Math.round(v * 2) / 2).toLocaleString("es-AR"); // a medio bulto
const detalle = (p: Parada) => `${fmtN(p.bultos)} bultos · ${fmtN(p.kg)} kg · ${fmtN(p.atados)} at.${p.maples ? ` · ${fmtN(p.maples)} mp.` : ""}${p.unidades ? ` · ${fmtN(p.unidades)} un.` : ""}`;
// Colores por recorrido (camioneta × recorrido); gris = sin asignar
const COLORES = ["#6b8a2a", "#3a67a3", "#c08a1e", "#7c5cbf", "#c05e42", "#1f7a3a", "#b0553f", "#2a8a8a"];
const GRIS = "#8b8f88";

function salidaIcon(maps: any) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50" viewBox="0 0 40 50"><path d="M20 1C10 1 2 9 2 19c0 12.5 18 30 18 30s18-17.5 18-30C38 9 30 1 20 1z" fill="#293C4B" stroke="#fff" stroke-width="2.5"/><path d="M12 24v-7l8-6 8 6v7h-5v-5h-6v5z" fill="#fff"/></svg>`;
  return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg), scaledSize: new maps.Size(40, 50), anchor: new maps.Point(20, 49) };
}
function pinIcon(maps: any, label: string, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44"><path d="M17 1C8.2 1 1 8.2 1 17c0 11 16 26 16 26s16-15 16-26C33 8.2 25.8 1 17 1z" fill="${color}" stroke="#fff" stroke-width="2"/><text x="17" y="22" text-anchor="middle" font-family="Inter,Arial" font-size="13" font-weight="700" fill="#fff">${label}</text></svg>`;
  return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg), scaledSize: new maps.Size(34, 44), anchor: new maps.Point(17, 43) };
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export default function RecorridosPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const hoy = localStr(new Date());
  const [date, setDate] = useState(hoy);
  const [tab, setTab] = useState<"mapa" | "camionetas">("mapa");
  const [sel, setSel] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ customerId: number; address: string; city: string; deliveryFrom: string; deliveryTo: string } | null>(null);
  const [ubicando, setUbicando] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [listo, setListo] = useState(0); // sube cuando el mapa quedó creado → dibuja los marcadores
  const [mapDiv, setMapDiv] = useState<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<number, any>>(new Map());
  const salidaMarkerRef = useRef<any>(null);
  const infoRef = useRef<any>(null);
  const [ajustando, setAjustando] = useState<number | null>(null);
  // Camionetas: alta y edición
  const [nueva, setNueva] = useState({ nombre: "", patente: "", capacidad: "" });
  const [editCam, setEditCam] = useState<{ id: number; nombre: string; patente: string; capacidad: string } | null>(null);
  const [salidaDraft, setSalidaDraft] = useState<Record<string, string>>({});

  const { data: paradas = [], isLoading, error } = useQuery<Parada[]>({ queryKey: ["/api/recorridos", date], queryFn: () => fetchJson<Parada[]>(`/api/recorridos?date=${date}`) });
  const { data: camionetas = [] } = useQuery<Camioneta[]>({ queryKey: ["/api/camionetas"], queryFn: () => fetchJson<Camioneta[]>("/api/camionetas") });
  const { data: salidas = [] } = useQuery<Salida[]>({ queryKey: ["/api/recorridos/salidas", date], queryFn: () => fetchJson<Salida[]>(`/api/recorridos/salidas?date=${date}`) });

  const manana = localStr(new Date(Date.now() + 86400000));
  const disponibles = useMemo(() => camionetas.filter((c) => c.disponible), [camionetas]);
  const camDe = (id: number | null) => camionetas.find((c) => c.id === id) ?? null;
  const colorRec = (camId: number | null, rec: number | null) => {
    if (camId == null) return GRIS;
    const i = disponibles.findIndex((c) => c.id === camId);
    return i < 0 ? GRIS : COLORES[(i * 2 + ((rec ?? 1) - 1)) % COLORES.length];
  };
  const recsDe = (camId: number) => {
    const s = new Set<number>([1]);
    paradas.forEach((p) => { if (p.camionetaId === camId && p.recorrido) s.add(p.recorrido); });
    salidas.forEach((x) => { if (x.camionetaId === camId) s.add(x.recorrido); });
    return Array.from(s).sort((a, b) => a - b);
  };
  const salidaDe = (camId: number, rec: number) => salidas.find((x) => x.camionetaId === camId && x.recorrido === rec)?.salida ?? "";
  const pedidosDe = (camId: number, rec: number) => paradas.filter((p) => p.camionetaId === camId && p.recorrido === rec).sort((a, b) => (a.ordenEntrega ?? 99) - (b.ordenEntrega ?? 99));
  const cargaDe = (camId: number, rec: number) => pedidosDe(camId, rec).reduce((s, p) => s + totalAprox(p), 0);

  const ubicadas = useMemo(() => paradas.filter(ubicada), [paradas]);
  const sinUbicar = useMemo(() => paradas.filter((p) => !ubicada(p)), [paradas]);
  // Lista del mapa: asignados agrupados por camioneta / recorrido / orden; después los sin asignar por horario
  const listaMapa = useMemo(() => {
    const idx = (p: Parada) => (p.camionetaId == null ? 999 : Math.max(0, disponibles.findIndex((c) => c.id === p.camionetaId)));
    return [...ubicadas].sort((a, b) => idx(a) - idx(b) || (a.recorrido ?? 99) - (b.recorrido ?? 99) || (a.ordenEntrega ?? 99) - (b.ordenEntrega ?? 99) || (a.deliveryFrom ?? "99").localeCompare(b.deliveryFrom ?? "99") || a.customerName.localeCompare(b.customerName));
  }, [ubicadas, disponibles]);
  const tot = useMemo(() => paradas.reduce((a, p) => ({ bultos: a.bultos + p.bultos, kg: a.kg + p.kg, atados: a.atados + p.atados, atadosBultos: a.atadosBultos + p.atadosBultos, maples: a.maples + p.maples, unidades: a.unidades + p.unidades }), { bultos: 0, kg: 0, atados: 0, atadosBultos: 0, maples: 0, unidades: 0 }), [paradas]);
  const sinAsignar = paradas.filter((p) => p.camionetaId == null).length;
  const etiquetaPin = (p: Parada) => (p.camionetaId != null && p.ordenEntrega != null ? String(p.ordenEntrega) : "·");

  // Mapa: se crea cuando el div está en pantalla (una sola vez)
  useEffect(() => {
    if (!mapDiv || mapRef.current) return;
    let vivo = true;
    loadGoogleMaps().then((maps) => {
      if (!vivo || mapRef.current) return;
      mapRef.current = new maps.Map(mapDiv, { center: SALIDA.pos, zoom: 12, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, clickableIcons: false });
      infoRef.current = new maps.InfoWindow();
      (window as any).gm_authFailure = () => setMapError("Google rechazó la clave para este sitio (revisá la restricción de sitios web en Google Cloud).");
      setMapError(null);
      setListo((n) => n + 1);
    }).catch((e) => setMapError(e.message));
    return () => { vivo = false; };
  }, [mapDiv]);

  // Al volver a la pestaña Mapa el contenedor estuvo oculto: Google necesita un resize
  useEffect(() => {
    const maps = (window as any).google?.maps; const map = mapRef.current;
    if (tab === "mapa" && maps && map) setTimeout(() => { maps.event.trigger(map, "resize"); setListo((n) => n + 1); }, 50);
  }, [tab]);

  // Marcadores
  useEffect(() => {
    const maps = (window as any).google?.maps;
    const map = mapRef.current;
    if (!maps || !map) return;
    Array.from(markersRef.current.values()).forEach((m) => m.setMap(null));
    markersRef.current.clear();
    const bounds = new maps.LatLngBounds();
    if (salidaMarkerRef.current) salidaMarkerRef.current.setMap(null);
    salidaMarkerRef.current = new maps.Marker({ position: SALIDA.pos, map, icon: salidaIcon(maps), title: `Salida: ${SALIDA.label}`, zIndex: 2000 });
    salidaMarkerRef.current.addListener("click", () => {
      infoRef.current.setContent(`<div style="font-family:Inter,system-ui;font-size:13px"><div style="font-family:'Bricolage Grotesque',Inter;font-size:15px;font-weight:700;margin-bottom:4px">Punto de salida</div><div>${SALIDA.label}</div></div>`);
      infoRef.current.open({ map, anchor: salidaMarkerRef.current });
    });
    bounds.extend(SALIDA.pos);
    ubicadas.forEach((p) => {
      const pos = { lat: Number(p.lat), lng: Number(p.lng) };
      const enAjuste = ajustando === p.id;
      const m = new maps.Marker({ position: pos, map, icon: pinIcon(maps, etiquetaPin(p), enAjuste ? "#3a67a3" : colorRec(p.camionetaId, p.recorrido)), title: p.customerName, zIndex: enAjuste ? 1500 : 1000, draggable: enAjuste, animation: enAjuste ? maps.Animation.BOUNCE : null });
      m.addListener("click", () => abrir(p));
      if (enAjuste) {
        m.addListener("dragstart", () => m.setAnimation(null));
        m.addListener("dragend", () => { const q = m.getPosition(); moverPin.mutate({ p, lat: q.lat(), lng: q.lng() }); });
      }
      markersRef.current.set(p.id, m);
      bounds.extend(pos);
    });
    if (ajustando == null) {
      if (ubicadas.length >= 1) map.fitBounds(bounds, 60);
      else { map.setCenter(SALIDA.pos); map.setZoom(12); }
    }
  }, [ubicadas, listo, ajustando, camionetas, salidas]);

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
    const c = camDe(p.camionetaId);
    const asig = c ? `${c.nombre} · Recorrido ${p.recorrido} · entrega ${p.ordenEntrega}ª${salidaDe(c.id, p.recorrido ?? 1) ? ` · sale ${salidaDe(c.id, p.recorrido ?? 1)}` : ""}` : "Sin asignar a camioneta";
    infoRef.current.setContent(`<div style="font-family:Inter,system-ui;font-size:13px;min-width:230px">
      <div style="font-family:'Bricolage Grotesque',Inter;font-size:15px;font-weight:700;margin-bottom:4px">${esc(p.customerName)}</div>
      <div style="color:#5f8020;font-weight:600">Entrega ${esc(horario(p))}</div>
      <div style="margin-top:4px"><b>≈ ${fmtAprox(totalAprox(p))} bultos en la camioneta</b></div>
      <div style="font-size:12px;color:#8b8f88">${esc(detalle(p))}</div>
      <div style="color:#8b8f88;font-size:12px;margin-top:4px">${esc([p.address, p.city].filter(Boolean).join(", "))}${p.phone ? ` · ${esc(p.phone)}` : ""}${p.status === "draft" ? " · borrador" : ""}</div>
      <div style="margin-top:6px;font-weight:600;color:${colorRec(p.camionetaId, p.recorrido)}">${esc(asig)}</div>
      <div style="font-size:12px;margin-top:4px;color:${esPrecisa(p.geoPrecision) ? "#5f8020" : "#c08a1e"}">Ubicación ${esc(precisionLabel(p.geoPrecision))}</div>
      <div style="display:flex;gap:12px;margin-top:8px">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" target="_blank" rel="noopener" style="color:#3a67a3;font-weight:600;text-decoration:none">Cómo llegar ↗</a>
        <a href="#" onclick="window.__rcAjustar && window.__rcAjustar(${p.id}); return false;" style="color:#3a67a3;font-weight:600;text-decoration:none">Ajustar pin</a>
      </div>
    </div>`);
    infoRef.current.open({ map, anchor: m });
  };

  const invalidar = () => { queryClient.invalidateQueries({ queryKey: ["/api/recorridos"] }); queryClient.invalidateQueries({ queryKey: ["/api/customers"] }); };
  const guardar = useMutation({
    mutationFn: async (e: NonNullable<typeof edit>) => {
      setUbicando(true);
      const geo = await geoParaGuardar({ address: e.address, city: e.city }, null).finally(() => setUbicando(false));
      await apiRequest("PATCH", `/api/customers/${e.customerId}`, { address: e.address || null, city: e.city || null, deliveryFrom: normalizarHora(e.deliveryFrom) || null, deliveryTo: normalizarHora(e.deliveryTo) || null, lat: geo.lat, lng: geo.lng, geoAddress: geo.geoAddress, geoPrecision: geo.geoPrecision });
      return geo.aviso;
    },
    onSuccess: (aviso) => { invalidar(); toast({ title: aviso ? "Guardado con aviso" : "Cliente actualizado", description: aviso }); setEdit(null); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const moverPin = useMutation({
    mutationFn: async ({ p, lat, lng }: { p: Parada; lat: number; lng: number }) => { await apiRequest("PATCH", `/api/customers/${p.customerId}`, { lat: lat.toFixed(7), lng: lng.toFixed(7), geoAddress: geoKey(p.address, p.city), geoPrecision: "MANUAL" }); return p; },
    onSuccess: (p) => { setAjustando(null); invalidar(); toast({ title: "Pin ajustado", description: `${p.customerName}: posición guardada como exacta.` }); },
    onError: (e: any) => { setAjustando(null); toast({ title: "Error", description: e.message, variant: "destructive" }); },
  });
  // Asignación con actualización OPTIMISTA: la lista y los pines cambian al instante con la misma regla que aplica el
  // servidor (renumerar 1..n el recorrido destino y el de origen); si el servidor falla, se vuelve atrás.
  type Asig = { id: number; camionetaId: number | null; recorrido?: number | null; ordenEntrega?: number | null };
  const aplicarLocal = (lista: Parada[], a: Asig): Parada[] => {
    const cur = lista.find((p) => p.id === a.id);
    if (!cur) return lista;
    const out = lista.map((p) => ({ ...p }));
    const renum = (cam: number, rec: number, primero?: number, pos?: number) => {
      const grupo = out.filter((p) => p.camionetaId === cam && p.recorrido === rec && p.id !== a.id).sort((x, y) => (x.ordenEntrega ?? 99) - (y.ordenEntrega ?? 99) || x.id - y.id);
      const ids = grupo.map((p) => p.id);
      if (primero != null) ids.splice(Math.min(Math.max((pos ?? ids.length + 1) - 1, 0), ids.length), 0, primero);
      ids.forEach((id, i) => { const p = out.find((x) => x.id === id)!; p.ordenEntrega = i + 1; });
    };
    const me = out.find((p) => p.id === a.id)!;
    const oldCam = cur.camionetaId, oldRec = cur.recorrido ?? 1;
    if (a.camionetaId == null) {
      me.camionetaId = null; me.recorrido = null; me.ordenEntrega = null;
      if (oldCam != null) renum(oldCam, oldRec);
    } else {
      const rec = a.recorrido ?? (oldCam === a.camionetaId && cur.recorrido != null ? cur.recorrido : 1);
      me.camionetaId = a.camionetaId; me.recorrido = rec;
      renum(a.camionetaId, rec, a.id, a.ordenEntrega ?? undefined);
      if (oldCam != null && (oldCam !== a.camionetaId || oldRec !== rec)) renum(oldCam, oldRec);
    }
    return out;
  };
  const asignar = useMutation({
    mutationFn: async ({ id, camionetaId, recorrido, ordenEntrega }: Asig) => {
      await apiRequest("PATCH", `/api/recorridos/pedido/${id}`, { camionetaId, recorrido: recorrido ?? null, ordenEntrega: ordenEntrega ?? null });
    },
    onMutate: async (a) => {
      const key = ["/api/recorridos", date];
      await queryClient.cancelQueries({ queryKey: key });
      const previo = queryClient.getQueryData<Parada[]>(key);
      if (previo) queryClient.setQueryData<Parada[]>(key, aplicarLocal(previo, a));
      return { previo, key };
    },
    onError: (e: any, _a, ctx) => { if (ctx?.previo) queryClient.setQueryData(ctx.key, ctx.previo); toast({ title: "No se pudo asignar", description: e.message, variant: "destructive" }); },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/recorridos"] }),
  });
  const setSalida = useMutation({
    mutationFn: async ({ camionetaId, recorrido, salida }: { camionetaId: number; recorrido: number; salida: string }) => { await apiRequest("PUT", "/api/recorridos/salidas", { date, camionetaId, recorrido, salida: normalizarHora(salida) || null }); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/recorridos/salidas"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const camMut = useMutation({
    mutationFn: async (a: { tipo: "crear"; body: any } | { tipo: "editar"; id: number; body: any } | { tipo: "borrar"; id: number }) => {
      if (a.tipo === "crear") await apiRequest("POST", "/api/camionetas", a.body);
      else if (a.tipo === "editar") await apiRequest("PATCH", `/api/camionetas/${a.id}`, a.body);
      else await apiRequest("DELETE", `/api/camionetas/${a.id}`);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/camionetas"] }); queryClient.invalidateQueries({ queryKey: ["/api/recorridos"] }); setNueva({ nombre: "", patente: "", capacidad: "" }); setEditCam(null); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const abrirEdicion = (p: Parada) => setEdit({ customerId: p.customerId, address: p.address ?? "", city: p.city ?? "", deliveryFrom: p.deliveryFrom ?? "", deliveryTo: p.deliveryTo ?? "" });
  const fechaLabel = new Date(date + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "long" });

  // Funciones (no componentes): si fueran componentes definidos adentro del render, cada tecla los remontaría y perderían el foco
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

  // Controles de asignación de un pedido (camioneta · recorrido · orden)
  const renderAsignacion = (p: Parada) => {
    const c = camDe(p.camionetaId);
    const recs = c ? recsDe(c.id) : [];
    const n = c ? pedidosDe(c.id, p.recorrido ?? 1).length : 0;
    const carga = c ? cargaDe(c.id, p.recorrido ?? 1) : 0;
    const cls = !c ? "sin" : carga > c.capacidad ? "bad" : carga > c.capacidad * 0.9 ? "par" : "ok";
    return (
      <div className="rc-asig" onClick={(e) => e.stopPropagation()}>
        <label className="rc-field"><span>Camioneta</span>
          <span className="vx-sel"><select value={p.camionetaId ?? ""} onChange={(e) => asignar.mutate({ id: p.id, camionetaId: e.target.value ? Number(e.target.value) : null })} data-testid={`sel-cam-${p.id}`}>
            <option value="">Sin asignar</option>{disponibles.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select><ChevronDown className="h-3.5 w-3.5" /></span>
        </label>
        {c && (
          <>
            <label className="rc-field"><span>Recorrido</span>
              <span className="vx-sel"><select value={p.recorrido ?? 1} onChange={(e) => asignar.mutate({ id: p.id, camionetaId: c.id, recorrido: e.target.value === "nuevo" ? Math.max(...recs) + 1 : Number(e.target.value) })}>
                {recs.map((r) => <option key={r} value={r}>{r}</option>)}<option value="nuevo">+ nuevo</option>
              </select><ChevronDown className="h-3.5 w-3.5" /></span>
            </label>
            <label className="rc-field"><span>Orden</span>
              <span className="vx-sel"><select value={p.ordenEntrega ?? n} onChange={(e) => asignar.mutate({ id: p.id, camionetaId: c.id, recorrido: p.recorrido ?? 1, ordenEntrega: Number(e.target.value) })}>
                {Array.from({ length: Math.max(n, 1) }, (_, i) => i + 1).map((i) => <option key={i} value={i}>{i}º</option>)}
              </select><ChevronDown className="h-3.5 w-3.5" /></span>
            </label>
          </>
        )}
        <span className={`vx-chip ${cls}`} style={{ marginLeft: "auto" }}>{c ? `${fmtAprox(carga)} / ${c.capacidad}${carga > c.capacidad ? " · se pasa" : ""}` : "sin camioneta"}</span>
      </div>
    );
  };

  const linkRecorrido = (camId: number, rec: number) => {
    const ps = pedidosDe(camId, rec).filter(ubicada);
    if (!ps.length) return null;
    const last = ps[ps.length - 1];
    return `https://www.google.com/maps/dir/?api=1&origin=${SALIDA.pos.lat},${SALIDA.pos.lng}&destination=${last.lat},${last.lng}&waypoints=${ps.slice(0, -1).slice(0, 9).map((p) => `${p.lat},${p.lng}`).join("|")}&travelmode=driving`;
  };

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

          <div className="vx-seg" style={{ marginBottom: 16 }}>
            <button className={tab === "mapa" ? "on" : ""} onClick={() => setTab("mapa")}>Mapa</button>
            <button className={tab === "camionetas" ? "on" : ""} onClick={() => setTab("camionetas")}>Camionetas</button>
          </div>

          <div className="vx-kpis c4">
            <div className="vx-kpi main"><div className="lab">Pedidos del día</div><div className="val">{paradas.length}</div><div className="note">{paradas.length - sinAsignar} asignados{sinAsignar ? <> · <b style={{ color: "#c05e42" }}>{sinAsignar} sin asignar</b></> : paradas.length ? " · todos asignados ✓" : ""}{sinUbicar.length ? ` · ${sinUbicar.length} sin ubicar` : ""}</div></div>
            <div className="vx-kpi"><div className="lab">Bultos</div><div className="val">{fmtN(tot.bultos)}</div><div className="note">cajones, bolsas y bandejas · <b>≈ {fmtAprox(totalAprox(tot))} en total</b> con kilos, atados y maples</div></div>
            <div className="vx-kpi"><div className="lab">Kilos sueltos</div><div className="val">{fmtN(tot.kg)} kg</div><div className="note">≈ {fmtAprox(tot.kg / KG_POR_BULTO)} bultos · atados: {fmtN(tot.atados)} ≈ {fmtAprox(tot.atadosBultos)} bultos{tot.maples ? ` · ${fmtN(tot.maples)} maples ≈ ${fmtAprox(tot.maples / MAPLES_POR_CAJON)} cajones` : ""}</div></div>
            <div className="vx-kpi"><div className="lab">Camionetas hoy</div><div className="val">{disponibles.length}</div><div className="note">{disponibles.length ? `capacidad ${disponibles.reduce((s, c) => s + c.capacidad, 0)} bultos por vuelta` : "cargalas en la pestaña Camionetas"}</div></div>
          </div>

          {error && <div className="vx-err">Error al cargar: {String((error as any).message ?? error)}</div>}

          {/* ===== MAPA (siempre montado para no recrear el mapa; oculto en la otra pestaña) ===== */}
          <div className={tab === "mapa" ? "" : "rc-hidden"}>
            <div className="rc-grid">
              <div>
                <div className="rc-mapwrap">
                  <div ref={setMapDiv} className="rc-map" />
                  {mapError && (
                    <div className="rc-maperr"><AlertTriangle className="h-5 w-5" /><div><b>No se pudo mostrar el mapa.</b><div>{mapError}</div>{!GOOGLE_MAPS_KEY && <div>Falta configurar VITE_GOOGLE_MAPS_KEY.</div>}</div></div>
                  )}
                  {!isLoading && paradas.length === 0 && !mapError && <div className="rc-mapmsg">Sin pedidos para esta fecha</div>}
                </div>
                <div className="rc-leg">
                  <span><i style={{ background: "#293C4B" }} /> Salida</span>
                  {disponibles.map((c) => recsDe(c.id).filter((r) => pedidosDe(c.id, r).length).map((r) => (
                    <span key={`${c.id}-${r}`}><i style={{ background: colorRec(c.id, r) }} /> {c.nombre} · R{r}{salidaDe(c.id, r) ? ` (sale ${salidaDe(c.id, r)})` : ""}</span>
                  )))}
                  {sinAsignar > 0 && <span><i style={{ background: GRIS }} /> sin asignar</span>}
                </div>
              </div>

              <div className="vx-card rc-list">
                <div className="vx-chead"><span className="t"><Truck className="h-4 w-4" /> Pedidos del día</span><span className="n">elegí camioneta, recorrido y orden de entrega</span></div>
                <div className="rc-rows">
                  {isLoading ? <div style={{ padding: 16 }}><Skeleton className="h-24 w-full" /></div> : listaMapa.length === 0 && sinUbicar.length === 0 ? (
                    <div style={{ padding: "28px 18px", textAlign: "center", color: "#8b8f88", fontSize: 14 }}>No hay pedidos para {fechaLabel}</div>
                  ) : listaMapa.map((p) => (
                    <div key={p.id} className={`rc-row${sel === p.id ? " on" : ""}`} onClick={() => abrir(p)} data-testid={`row-parada-${p.id}`}>
                      <div className="rc-num" style={{ background: colorRec(p.camionetaId, p.recorrido) }}>{etiquetaPin(p)}</div>
                      <div className="rc-main">
                        <div className="rc-top">
                          <b>{p.customerName}{p.status === "draft" && <span className="vx-chip par" style={{ marginLeft: 6 }}>borrador</span>}</b>
                          <div className="rc-right">
                            <span className="rc-tot">≈ {fmtAprox(totalAprox(p))} bultos</span>
                            <span className="rc-icons">
                              <button className="vx-ic" title="Ajustar el pin a mano en el mapa" onClick={(e) => { e.stopPropagation(); (window as any).__rcAjustar?.(p.id); }}><LocateFixed className="h-4 w-4" /></button>
                              <button className="vx-ic" title="Editar dirección y horario" onClick={(e) => { e.stopPropagation(); abrirEdicion(p); }}><Pencil className="h-4 w-4" /></button>
                            </span>
                          </div>
                        </div>
                        <span><Clock className="h-3 w-3" /> {horario(p)} · {detalle(p)}</span>
                        <span className="rc-dir"><MapPin className="h-3 w-3" /> {[p.address, p.city].filter(Boolean).join(", ")}{!esPrecisa(p.geoPrecision) && <span className="vx-chip par" title={`Ubicación ${precisionLabel(p.geoPrecision)}`}>{p.geoPrecision ? "aprox." : "verificar"}</span>}</span>
                        {renderAsignacion(p)}
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
                                <span className="rc-tot">≈ {fmtAprox(totalAprox(p))} bultos</span>
                                {!(edit && edit.customerId === p.customerId) && <button className="vx-btn" style={{ padding: "5px 9px", fontSize: 12 }} onClick={() => abrirEdicion(p)}><LocateFixed className="h-3.5 w-3.5" /> Ubicar</button>}
                              </div>
                            </div>
                            <span><Clock className="h-3 w-3" /> {horario(p)} · {detalle(p)}</span>
                            <span className="rc-dir">{(p.address ?? "").trim() ? <><MapPin className="h-3 w-3" /> {[p.address, p.city].filter(Boolean).join(", ")} · <i>sin ubicar: Google no encontró la altura exacta, revisá la dirección</i></> : <i>sin dirección cargada</i>}</span>
                            {renderAsignacion(p)}
                            {renderEditor(p)}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                {sel != null && (
                  <div className="rc-foot"><span className="n">Pedido seleccionado: <b>{paradas.find((p) => p.id === sel)?.customerName}</b></span><button className="vx-btn" onClick={() => setLocation(`/orders/${sel}`)}><ExternalLink className="h-4 w-4" /> Abrir pedido</button></div>
                )}
              </div>
            </div>
          </div>

          {/* ===== CAMIONETAS ===== */}
          {tab === "camionetas" && (
            <div className="rc-flota">
              <div className="vx-card">
                <div className="vx-chead"><span className="t"><Truck className="h-4 w-4" /> Mis camionetas</span></div>
                {camionetas.length === 0 && <div style={{ padding: "20px 18px", color: "#8b8f88", fontSize: 13.5 }}>Todavía no hay camionetas cargadas. Agregá la primera abajo.</div>}
                {camionetas.map((c) => (
                  <div key={c.id} className={`rc-camrow${c.disponible ? "" : " off"}`} data-testid={`camioneta-${c.id}`}>
                    {editCam?.id === c.id ? (
                      <div className="rc-camform">
                        <label>Nombre <input className="vx-input" value={editCam.nombre} onChange={(e) => setEditCam({ ...editCam, nombre: e.target.value })} /></label>
                        <label>Patente <input className="vx-input" value={editCam.patente} onChange={(e) => setEditCam({ ...editCam, patente: e.target.value })} /></label>
                        <label>Capacidad (bultos) <input className="vx-input" type="number" min={1} value={editCam.capacidad} onChange={(e) => setEditCam({ ...editCam, capacidad: e.target.value })} /></label>
                        <div className="rc-acts">
                          <button className="vx-btn primary" disabled={camMut.isPending || !editCam.nombre.trim() || !Number(editCam.capacidad)} onClick={() => camMut.mutate({ tipo: "editar", id: c.id, body: { nombre: editCam.nombre.trim(), patente: editCam.patente.trim() || null, capacidad: Number(editCam.capacidad) } })}><Check className="h-4 w-4" /> Guardar</button>
                          <button className="vx-btn" onClick={() => setEditCam(null)}><X className="h-4 w-4" /> Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ minWidth: 0 }}>
                          <span className="nom">{c.nombre}</span>{c.patente && <span className="pat">{c.patente}</span>}
                          <div className="cap">Capacidad {c.capacidad} bultos por vuelta{c.disponible ? ` · hoy ${paradas.filter((p) => p.camionetaId === c.id).length} pedido${paradas.filter((p) => p.camionetaId === c.id).length !== 1 ? "s" : ""}` : " · no disponible (taller, sin chofer)"}</div>
                        </div>
                        <div className="rc-camacts">
                          <label className="rc-sw">disponible <input type="checkbox" checked={c.disponible} onChange={(e) => { if (!e.target.checked && paradas.some((p) => p.camionetaId === c.id) && !confirm(`${c.nombre} tiene pedidos asignados hoy. Al marcarla no disponible vuelven a "sin asignar". ¿Seguir?`)) return; camMut.mutate({ tipo: "editar", id: c.id, body: { disponible: e.target.checked } }); }} /></label>
                          <button className="vx-ic" title="Editar" onClick={() => setEditCam({ id: c.id, nombre: c.nombre, patente: c.patente ?? "", capacidad: String(c.capacidad) })}><Pencil className="h-4 w-4" /></button>
                          {user?.role === "admin" && <button className="vx-ic" title="Eliminar" onClick={() => { if (confirm(`¿Eliminar ${c.nombre}? Sus pedidos asignados quedan sin camioneta.`)) camMut.mutate({ tipo: "borrar", id: c.id }); }}><Trash2 className="h-4 w-4" /></button>}
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <div className="rc-nueva">
                  <div className="rc-nueva-t">Agregar camioneta</div>
                  <div className="rc-camform">
                    <label>Nombre <input className="vx-input" placeholder="Camioneta blanca" value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} data-testid="input-cam-nombre" /></label>
                    <label>Patente <input className="vx-input" placeholder="AD 123 XY" value={nueva.patente} onChange={(e) => setNueva({ ...nueva, patente: e.target.value })} /></label>
                    <label>Capacidad (bultos) <input className="vx-input" type="number" min={1} placeholder="120" value={nueva.capacidad} onChange={(e) => setNueva({ ...nueva, capacidad: e.target.value })} /></label>
                  </div>
                  <button className="vx-btn primary rc-addbtn" disabled={camMut.isPending || !nueva.nombre.trim() || !Number(nueva.capacidad)} onClick={() => camMut.mutate({ tipo: "crear", body: { nombre: nueva.nombre.trim(), patente: nueva.patente.trim() || null, capacidad: Number(nueva.capacidad) } })} data-testid="button-add-cam"><Plus className="h-4 w-4" /> Agregar camioneta</button>
                </div>
              </div>

              <div className="vx-card">
                <div className="vx-chead"><span className="t">Carga de {date === hoy ? "hoy" : fechaLabel}</span><span className="n">por camioneta y recorrido · hora de salida y orden de entrega</span></div>
                {disponibles.length === 0 && <div style={{ padding: "20px 18px", color: "#8b8f88", fontSize: 13.5 }}>No hay camionetas disponibles.</div>}
                {disponibles.map((c) => {
                  const total = paradas.filter((p) => p.camionetaId === c.id).reduce((s, p) => s + totalAprox(p), 0);
                  return (
                    <div key={c.id} className="rc-cam">
                      <div className="rc-camh"><span className="nom">{c.nombre}</span><span className="vx-chip gris">capacidad {c.capacidad} bultos por vuelta</span><span style={{ marginLeft: "auto", fontSize: 12, color: "#8b8f88" }}>{fmtAprox(total)} bultos en el día</span></div>
                      {recsDe(c.id).map((r) => {
                        const ps = pedidosDe(c.id, r);
                        const carga = cargaDe(c.id, r), pct = Math.min(100, Math.round((carga / c.capacidad) * 100));
                        const cls = carga > c.capacidad ? "bad" : carga > c.capacidad * 0.9 ? "warn" : "";
                        const col = colorRec(c.id, r), k = `${c.id}:${r}`;
                        const link = linkRecorrido(c.id, r);
                        return (
                          <div key={r} className="rc-rec">
                            <div className="rc-rech">
                              <span className="rc-dot" style={{ background: col }} /><b>Recorrido {r}</b>
                              <span className="rc-hora">sale <input className="vx-input" inputMode="numeric" placeholder="07:00" value={salidaDraft[k] ?? salidaDe(c.id, r)} onChange={(e) => setSalidaDraft({ ...salidaDraft, [k]: e.target.value })} onBlur={(e) => { const v = normalizarHora(e.target.value); setSalidaDraft((d) => { const n = { ...d }; delete n[k]; return n; }); if (v !== salidaDe(c.id, r)) setSalida.mutate({ camionetaId: c.id, recorrido: r, salida: v }); }} /></span>
                              <span className={`vx-chip ${cls === "bad" ? "bad" : cls === "warn" ? "par" : "ok"}`}>{fmtAprox(carga)} / {c.capacidad}{carga > c.capacidad ? ` · se pasa ${fmtAprox(carga - c.capacidad)}` : ""}</span>
                              <span style={{ marginLeft: "auto", fontSize: 12, color: "#8b8f88" }}>{ps.length} pedido{ps.length !== 1 ? "s" : ""}</span>
                              {link && <a className="vx-btn" style={{ padding: "4px 9px", fontSize: 12 }} href={link} target="_blank" rel="noopener noreferrer" title="Abre Google Maps desde la salida con hasta 10 paradas en este orden"><ExternalLink className="h-3.5 w-3.5" /> Ver en Google Maps</a>}
                            </div>
                            <div className="rc-bar"><i className={cls} style={{ width: `${pct}%` }} /></div>
                            {ps.length === 0 ? <div className="rc-vacio">Sin pedidos: asignalos desde el Mapa.</div> : ps.map((p) => (
                              <div key={p.id} className="rc-ped">
                                <span className="rc-ord" style={{ background: col }}>{p.ordenEntrega}</span>
                                <span className="cli">{p.customerName}<small>entrega {horario(p)} · {detalle(p)}{!ubicada(p) ? " · sin ubicar" : ""}</small></span>
                                <span className="bul">≈ {fmtAprox(totalAprox(p))}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </Layout>
  );
}

const RC_CSS = `
.rc-hidden{display:none;}
.vx-chip.sin{background:#fdf4f1;color:#c05e42;}
.rc-grid{display:grid;grid-template-columns:minmax(0,1fr) 470px;gap:16px;}
.rc-mapwrap{position:relative;}
.rc-map{height:640px;border-radius:16px;border:1px solid #ecece8;background:#e9eae5;overflow:hidden;}
.rc-maperr{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:12px;padding:24px;background:rgba(244,244,241,.92);border-radius:16px;color:#b0553f;font-size:13.5px;text-align:left;}
.rc-maperr b{display:block;color:#1e2420;margin-bottom:2px;}
.rc-mapmsg{position:absolute;left:50%;top:16px;transform:translateX(-50%);background:#fff;border:1px solid #ecece8;border-radius:10px;padding:8px 14px;font-size:13px;color:#8b8f88;}
.rc-leg{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:#4b5048;margin-top:10px;}
.rc-leg i{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:5px;}
.rc-list{display:flex;flex-direction:column;max-height:700px;margin-bottom:0;}
.rc-rows{overflow:auto;flex:1;}
.rc-row{display:flex;gap:10px;align-items:flex-start;padding:11px 16px;border-top:1px solid #f5f5f2;font-size:13px;cursor:pointer;}
.rc-row:hover{background:#f8f8f5;}
.rc-row.on{background:#eef3e3;}
.rc-num{width:26px;height:26px;border-radius:50%;background:#8b8f88;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 auto;margin-top:1px;}
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
.rc-sec{display:flex;align-items:center;gap:6px;padding:10px 16px 6px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#c05e42;border-top:1px solid #f5f5f2;background:#fdf4f1;}
/* asignación: camioneta · recorrido · orden */
.rc-asig{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;margin-top:6px;padding:8px 10px;background:#fbfaf7;border:1px solid #ecece8;border-radius:12px;cursor:default;}
.rc-field{display:flex;flex-direction:column;gap:3px;}
.rc-field>span:first-child{font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9a9e96;}
.rc-asig .vx-sel select{padding:6px 28px 6px 10px;font-size:12.5px;min-width:0;border-radius:9px;}
.rc-asig .vx-sel svg{right:9px;}
.rc-asig .vx-chip{align-self:center;}
.rc-edit{display:flex;flex-direction:column;gap:6px;margin-top:8px;padding:10px;background:#fbfaf7;border:1px solid #ecece8;border-radius:10px;cursor:default;}
.rc-edit .vx-input{width:100%;font-size:13px;padding:7px 10px;}
.rc-hor{display:flex;gap:8px;}
.rc-hor label{flex:1;font-size:11.5px;color:#8b8f88;display:flex;flex-direction:column;gap:3px;}
.rc-acts{display:flex;gap:8px;margin-top:2px;}
.rc-acts .vx-btn{padding:7px 11px;font-size:12.5px;}
.rc-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-top:1px solid #eeeeea;flex-wrap:wrap;}
.rc-foot .n{font-size:12.5px;color:#8b8f88;}
.vx-link{background:none;border:none;color:#3a67a3;font-weight:600;cursor:pointer;font-family:inherit;font-size:12.5px;padding:0;}
/* camionetas */
.rc-flota{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:16px;align-items:start;}
.rc-camrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:12px 18px;border-top:1px solid #f1f1ec;}
.rc-camrow .nom{font-family:'Bricolage Grotesque','Inter',sans-serif;font-size:15px;font-weight:700;}
.rc-camrow .pat{font-size:12px;color:#8b8f88;font-family:ui-monospace,Menlo,monospace;margin-left:8px;}
.rc-camrow .cap{font-size:12.5px;color:#4b5048;margin-top:2px;}
.rc-camrow.off .nom,.rc-camrow.off .cap{color:#a9ada4;}
.rc-camacts{display:flex;align-items:center;gap:6px;}
.rc-sw{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#8b8f88;cursor:pointer;}
.rc-sw input{width:36px;height:20px;appearance:none;-webkit-appearance:none;background:#dcdcd6;border-radius:12px;position:relative;cursor:pointer;outline:none;margin:0;}
.rc-sw input:checked{background:#6b8a2a;}
.rc-sw input::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s;}
.rc-sw input:checked::after{left:18px;}
.rc-camform{display:grid;grid-template-columns:1.4fr 1fr .9fr auto;gap:8px;align-items:end;grid-column:1 / -1;}
.rc-nueva .rc-camform{grid-template-columns:1.4fr 1fr .9fr;}
.rc-nueva-t{font-family:'Bricolage Grotesque','Inter',sans-serif;font-size:14px;font-weight:700;margin-bottom:10px;}
.rc-addbtn{margin-top:12px;width:100%;justify-content:center;padding:10px 14px;}
.rc-camform label{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9a9e96;display:flex;flex-direction:column;gap:4px;}
.rc-camform .vx-input{font-size:13px;padding:7px 10px;}
.rc-nueva{padding:14px 18px 18px;border-top:1px solid #f1f1ec;background:#fbfaf7;}
.rc-cam{border-top:1px solid #f1f1ec;padding:14px 18px;}
.rc-camh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.rc-camh .nom{font-family:'Bricolage Grotesque','Inter',sans-serif;font-size:15px;font-weight:700;}
.rc-rec{margin-top:10px;background:#fbfaf7;border:1px solid #ecece8;border-radius:12px;padding:10px 12px;}
.rc-rech{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.rc-rech b{font-size:13.5px;}
.rc-hora{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:#4b5048;}
.rc-hora .vx-input{width:66px;padding:4px 8px;font-size:13px;font-weight:600;text-align:center;}
.rc-dot{width:10px;height:10px;border-radius:50%;display:inline-block;flex:0 0 auto;}
.rc-bar{height:7px;border-radius:4px;background:#eeeeea;overflow:hidden;margin:8px 0 6px;}
.rc-bar i{display:block;height:100%;background:#6b8a2a;border-radius:4px;}
.rc-bar i.warn{background:#c08a1e;} .rc-bar i.bad{background:#c05e42;}
.rc-ped{display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid #f1f1ec;font-size:13px;}
.rc-ped:first-of-type{border-top:none;}
.rc-ord{width:22px;height:22px;border-radius:50%;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
.rc-ped .cli{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.rc-ped .cli small{display:block;font-weight:400;color:#8b8f88;font-size:11.5px;white-space:normal;}
.rc-ped .bul{font-weight:700;white-space:nowrap;}
.rc-vacio{font-size:12.5px;color:#a9ada4;padding:6px 0;font-style:italic;}
@media(max-width:1000px){.rc-grid,.rc-flota{grid-template-columns:1fr}.rc-map{height:420px}.rc-list{max-height:none}.rc-camform,.rc-nueva .rc-camform{grid-template-columns:1fr 1fr}}
`;
