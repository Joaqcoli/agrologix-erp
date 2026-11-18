// 18/11/2026 Recorridos: carga perezosa de Google Maps JavaScript API y geocodificación desde el navegador.
// La clave (VITE_GOOGLE_MAPS_KEY) es pública y está restringida por sitio en Google Cloud; va en el .env de Render.
declare global {
  interface Window { google?: any; __gmapsLoading?: Promise<any> }
}

export const GOOGLE_MAPS_KEY: string = (import.meta as any).env?.VITE_GOOGLE_MAPS_KEY ?? "";

/** Carga el script de Google Maps una sola vez y devuelve `google.maps`. */
export function loadGoogleMaps(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("sin window"));
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (window.__gmapsLoading) return window.__gmapsLoading;
  if (!GOOGLE_MAPS_KEY) return Promise.reject(new Error("Falta la clave de Google Maps (VITE_GOOGLE_MAPS_KEY)"));
  window.__gmapsLoading = new Promise((resolve, reject) => {
    // Google llama al callback cuando la API está lista (con loading=async las clases recién existen después de
    // importar cada librería: Map/InfoWindow en "maps", Marker en "marker", Geocoder en "geocoding").
    (window as any).__gmapsReady = async () => {
      try {
        const g = window.google.maps;
        await Promise.all([g.importLibrary("maps"), g.importLibrary("marker"), g.importLibrary("geocoding")]);
        resolve(window.google.maps);
      } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
    };
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&v=weekly&language=es&region=AR&loading=async&callback=__gmapsReady`;
    s.async = true;
    s.onerror = () => reject(new Error("No se pudo cargar Google Maps"));
    document.head.appendChild(s);
  });
  return window.__gmapsLoading;
}

/** locationType de Google: ROOFTOP (número exacto) · RANGE_INTERPOLATED (estimado entre números de la cuadra) ·
 *  GEOMETRIC_CENTER (centro de una calle/zona) · APPROXIMATE (solo la localidad). */
export type GeoPrecision = "ROOFTOP" | "RANGE_INTERPOLATED" | "GEOMETRIC_CENTER" | "APPROXIMATE" | "MANUAL";
export type GeoResult = { lat: number; lng: number; formatted: string; partial: boolean; precision: GeoPrecision; tieneNumero: boolean };
export const precisionLabel = (p: string | null | undefined) =>
  p === "ROOFTOP" ? "exacta" : p === "MANUAL" ? "ajustada a mano" : p === "RANGE_INTERPOLATED" ? "estimada en la cuadra" : p === "GEOMETRIC_CENTER" ? "aproximada (centro de la calle)" : p === "APPROXIMATE" ? "aproximada (solo localidad)" : "sin precisión conocida";
export const esPrecisa = (p: string | null | undefined) => p === "ROOFTOP" || p === "MANUAL";

/** Geocodifica "dirección, ciudad" sesgado al AMBA (Argentina). Devuelve null si Google no encuentra nada. */
export async function geocodeAddress(address: string, city?: string | null): Promise<GeoResult | null> {
  const q = [address, city, "Argentina"].filter((s) => s && String(s).trim()).join(", ");
  if (!address || !address.trim()) return null;
  const maps = await loadGoogleMaps();
  const geocoder = new maps.Geocoder();
  const bounds = new maps.LatLngBounds({ lat: -35.1, lng: -59.0 }, { lat: -34.3, lng: -58.2 }); // AMBA
  const res: any = await geocoder.geocode({ address: q, region: "AR", bounds, componentRestrictions: { country: "AR" } }).catch((e: any) => {
    if (String(e?.code ?? e).includes("ZERO_RESULTS")) return { results: [] };
    throw e;
  });
  const r = res?.results?.[0];
  if (!r) return null;
  const loc = r.geometry.location;
  const tipos: string[] = r.address_components?.flatMap((c: any) => c.types ?? []) ?? [];
  return {
    lat: typeof loc.lat === "function" ? loc.lat() : loc.lat, lng: typeof loc.lng === "function" ? loc.lng() : loc.lng,
    formatted: r.formatted_address, partial: !!r.partial_match,
    precision: (r.geometry.location_type ?? "APPROXIMATE") as GeoPrecision,
    tieneNumero: tipos.includes("street_number"),
  };
}

/** Clave de "dirección + ciudad" para saber si hay que volver a geocodificar. */
export const geoKey = (address?: string | null, city?: string | null) => `${(address ?? "").trim().toLowerCase()}|${(city ?? "").trim().toLowerCase()}`;

type GeoFields = { address?: string | null; city?: string | null; lat?: string | number | null; lng?: string | number | null; geoAddress?: string | null; geoPrecision?: string | null };
export type GeoGuardar = { lat: string | null; lng: string | null; geoAddress: string | null; geoPrecision: string | null; aviso?: string };

/**
 * Qué coordenadas guardar con el cliente. Si la dirección está vacía → sin coordenadas. Si la dirección o la ciudad
 * cambiaron respecto de lo geocodificado (o nunca se ubicó) → geocodifica. Reglas de precisión (18/11, pedido de
 * Joaquín): solo se guarda un pin si Google encontró la ALTURA (número de calle); si solo encontró la calle o la
 * localidad NO se guarda (un pin en el centro de la calle arma mal el recorrido) y se avisa. ROOFTOP = exacta;
 * RANGE_INTERPOLATED = estimada en la cuadra (se guarda, marcada como aproximada, se puede ajustar a mano).
 * Un pin ajustado a mano (MANUAL) se conserva mientras no cambie la dirección.
 */
export async function geoParaGuardar(form: GeoFields, prev?: GeoFields | null): Promise<GeoGuardar> {
  const addr = (form.address ?? "").trim();
  if (!addr) return { lat: null, lng: null, geoAddress: null, geoPrecision: null };
  const key = geoKey(form.address, form.city);
  const prevKey = prev?.geoAddress ?? null;
  if (prevKey === key && prev?.lat != null && prev?.lng != null) return { lat: String(prev.lat), lng: String(prev.lng), geoAddress: key, geoPrecision: prev?.geoPrecision ?? null };
  try {
    const g = await geocodeAddress(addr, form.city);
    if (!g) return { lat: null, lng: null, geoAddress: null, geoPrecision: null, aviso: "Google no encontró esa dirección. El cliente se guardó sin ubicar; revisá calle, altura y localidad o ubicalo a mano desde Recorridos." };
    if (!g.tieneNumero || g.precision === "APPROXIMATE" || g.precision === "GEOMETRIC_CENTER") {
      return { lat: null, lng: null, geoAddress: null, geoPrecision: null, aviso: `Google solo encontró "${g.formatted}", sin la altura exacta. No se ubicó en el mapa: revisá la dirección o ubicalo a mano desde Recorridos.` };
    }
    return {
      lat: g.lat.toFixed(7), lng: g.lng.toFixed(7), geoAddress: key, geoPrecision: g.precision,
      aviso: g.precision !== "ROOFTOP" || g.partial ? `Ubicación estimada en la cuadra (Google interpretó "${g.formatted}"). Verificala en Recorridos y ajustá el pin si hace falta.` : undefined,
    };
  } catch (e: any) {
    return { lat: null, lng: null, geoAddress: null, geoPrecision: null, aviso: `No se pudo ubicar la dirección (${e?.message ?? "error de Google Maps"}). El cliente se guardó sin ubicar.` };
  }
}
