// 25/11/2026 · Compras desde la foto de la boleta: lo que devolvió /api/purchases/interpret viaja de la pantalla
// "Cargar desde boleta" a "Nueva compra" por memoria (la foto en base64 no entra en sessionStorage). Se pierde al
// recargar la página, y en ese caso Nueva compra abre vacía como siempre.
export type BoletaLine = {
  rawLine: string; productId: number | null; productName: string | null; purchaseUnit: string; quantity: number | null;
  costPerPurchaseUnit: number | null; weightPerPackage: number | null; baseUnit: string | null; emptyCost: number | null;
  status: "ok" | "duda"; reason: string; candidates: { productId: number; name: string }[];
};
export type BoletaData = {
  logId: number | null;
  imageDataUrl: string;
  supplier: { id: number | null; name: string | null; nameRead: string; confidence: "alta" | "media" | "baja"; headerText: string; reason: string };
  purchaseDate: string;
  paymentMethod: string;
  paymentReason: string;
  receipt: { date: string | null; number: string | null; total: number | null; pagado: boolean };
  lines: BoletaLine[];
  globalEmptyCost: number;
  totalCheck: { receipt: number | null; computed: number; ok: boolean | null };
  warnings: string[];
  notes: string;
  ignoredLines: string[];
};

let pendiente: BoletaData | null = null;
export function setBoleta(d: BoletaData | null): void { pendiente = d; }
export function takeBoleta(): BoletaData | null { const d = pendiente; pendiente = null; return d; }

/** Achica la foto (lado mayor 1600 px, JPEG 0,85) para que pese poco y el modelo la lea igual. */
export async function achicarImagen(file: File): Promise<string> {
  const dataUrl: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("No se pudo leer la foto")); r.readAsDataURL(file); });
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("imagen")); i.src = dataUrl; });
    const max = 1600; const k = Math.min(1, max / Math.max(img.width, img.height));
    if (k >= 1 && file.size < 1_500_000) return dataUrl;
    const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch { return dataUrl; }
}
