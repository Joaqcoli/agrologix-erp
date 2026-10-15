// ─── Cliente mínimo de YCloud (WhatsApp Cloud API) para el ERP ───────────────
// Mismo patrón que asistente-vegex/src/ycloud.ts. Se usa para mandar remitos/facturas
// (PDF) por WhatsApp: subir el medio, enviar plantilla con documento en el header,
// o documento libre dentro de la ventana de 24 h. Docs: https://docs.ycloud.com
const BASE = "https://api.ycloud.com/v2";
const WABA_ID = process.env.YCLOUD_WABA_ID || "926315877155702";
const WA_NUMERO = process.env.WA_NUMERO || "+5491171232459";

function apiKey(): string {
  const k = process.env.YCLOUD_API_KEY;
  if (!k) throw new Error("YCloud no configurado");
  return k;
}

export function ycloudConfigured(): boolean {
  return !!process.env.YCLOUD_API_KEY;
}

async function parseResponse(path: string, r: Response): Promise<any> {
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* texto plano */ }
  if (!r.ok) {
    const message = json?.error?.message ?? json?.message ?? text.slice(0, 300);
    const err = new Error(`YCloud ${path} → ${r.status}: ${message}`) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  return json;
}

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "X-API-Key": apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse(path, r);
}

async function get(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`, { headers: { "X-API-Key": apiKey() } });
  return parseResponse(path, r);
}

/** Sube un archivo (PDF por defecto) al número de WhatsApp. Devuelve el media id (vale 30 días). */
export async function uploadMedia(buffer: Buffer, filename: string, mime = "application/pdf"): Promise<string> {
  const path = `/whatsapp/media/${encodeURIComponent(WA_NUMERO)}/upload`;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), filename);
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "X-API-Key": apiKey() }, body: form });
  const json = await parseResponse(path, r);
  const id = json?.id ?? json?.mediaId;
  if (!id) throw new Error(`YCloud ${path} → sin id en la respuesta`);
  return String(id);
}

/** Plantilla aprobada (sirve fuera de la ventana de 24 h). bodyParams → {{1}}, {{2}}… */
export async function sendTemplate(p: {
  to: string;
  name: string;
  language?: string;
  bodyParams?: string[];
  headerDocument?: { mediaId: string; filename: string };
  externalId?: string;
}): Promise<{ id: string; status: string }> {
  const components: any[] = [];
  if (p.headerDocument) {
    components.push({
      type: "header",
      parameters: [{ type: "document", document: { id: p.headerDocument.mediaId, filename: p.headerDocument.filename } }],
    });
  }
  if (p.bodyParams && p.bodyParams.length > 0) {
    components.push({ type: "body", parameters: p.bodyParams.map((t) => ({ type: "text", text: t })) });
  }
  return post("/whatsapp/messages", {
    from: WA_NUMERO,
    to: p.to,
    type: "template",
    externalId: p.externalId,
    template: { name: p.name, language: { code: p.language ?? "es_AR" }, components },
  });
}

/** Documento libre (solo dentro de la ventana de 24 h del destinatario). */
export async function sendDocument(p: {
  to: string;
  mediaId: string;
  filename: string;
  caption?: string;
  externalId?: string;
}): Promise<{ id: string; status: string }> {
  return post("/whatsapp/messages", {
    from: WA_NUMERO,
    to: p.to,
    type: "document",
    externalId: p.externalId,
    document: { id: p.mediaId, filename: p.filename, ...(p.caption ? { caption: p.caption } : {}) },
  });
}

/** Texto libre (solo dentro de la ventana de 24 h). */
export async function sendText(to: string, body: string, externalId?: string): Promise<{ id: string; status: string }> {
  return post("/whatsapp/messages", { from: WA_NUMERO, to, type: "text", text: { body }, externalId });
}

/** Crea una plantilla en la WABA (queda PENDING hasta que Meta la apruebe). */
export async function createTemplate(p: {
  name: string;
  language?: string;
  category?: "UTILITY";
  bodyText: string;
  bodyExample: string[];
  headerDocumentExampleUrl?: string;
}): Promise<{ name: string; status: string; reason?: string }> {
  const components: any[] = [];
  if (p.headerDocumentExampleUrl) {
    components.push({ type: "HEADER", format: "DOCUMENT", example: { header_url: [p.headerDocumentExampleUrl] } });
  }
  components.push({ type: "BODY", text: p.bodyText, example: { body_text: [p.bodyExample] } });
  const json = await post("/whatsapp/templates", {
    wabaId: WABA_ID,
    name: p.name,
    language: p.language ?? "es_AR",
    category: p.category ?? "UTILITY",
    components,
  });
  return { name: json?.name ?? p.name, status: json?.status ?? "UNKNOWN", reason: json?.reason ?? undefined };
}

/** Estado de una plantilla (APPROVED / PENDING / REJECTED…) o null si no existe. */
export async function getTemplateStatus(name: string, language = "es_AR"): Promise<{ status: string; reason?: string } | null> {
  try {
    const json = await get(`/whatsapp/templates/${WABA_ID}/${encodeURIComponent(name)}/${language}`);
    if (json?.status) return { status: json.status, reason: json.reason ?? undefined };
  } catch (e: any) {
    if (e?.status !== 404) throw e;
  }
  const list = await get(`/whatsapp/templates?filter.wabaId=${encodeURIComponent(WABA_ID)}&filter.name=${encodeURIComponent(name)}`);
  const items: any[] = Array.isArray(list?.items) ? list.items : Array.isArray(list) ? list : [];
  const t = items.find((x) => x?.name === name && (x?.language === language || !x?.language));
  return t ? { status: t.status ?? "UNKNOWN", reason: t.reason ?? undefined } : null;
}
