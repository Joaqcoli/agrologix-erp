/**
 * Integración directa con AFIP/ARCA
 * WSAA (autenticación) + WSFE v1 (factura electrónica)
 * Sin dependencias de servicios externos — node-forge + axios
 */
import forge from "node-forge";
import axios from "axios";

const CUIT        = 30718551842;
const PUNTO_VENTA = 4;

const WSAA_URL = "https://wsaa.afip.gov.ar/ws/services/LoginCms";
const WSFE_URL = "https://servicios1.afip.gov.ar/wsfev1/service.asmx";
const WSFE_NS  = "http://ar.gov.afip.dif.FEV1/";

// Token cache — válido 12 horas con 5 min de margen
let _ta: { token: string; sign: string; expiresAt: Date } | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convierte PEM con \n literales (Render env vars) a saltos reales */
function normalizePem(pem: string): string {
  // Render puede guardar el PEM con \n literales (\\n), con \r\n, o correcto.
  // También puede envolver todo en comillas extras o agregar espacios.
  let pem2 = pem.trim();
  // Quitar comillas externas si las hay
  if ((pem2.startsWith('"') && pem2.endsWith('"')) || (pem2.startsWith("'") && pem2.endsWith("'"))) {
    pem2 = pem2.slice(1, -1);
  }
  // Convertir \n literales (dos chars) a salto real
  pem2 = pem2.replace(/\\n/g, "\n");
  // Normalizar \r\n a \n
  pem2 = pem2.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return pem2.trim();
}

/** Extrae el texto de un tag XML (con o sin prefijo de namespace) */
function extractXml(xml: string, tag: string): string {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, "i");
  return xml.match(re)?.[1]?.trim() ?? "";
}

/** Extrae TODOS los matches de un tag (para errores múltiples de AFIP) */
function extractAllXml(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, "gi");
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

/** Desescapa entidades HTML básicas */
function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&amp;/g,  "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'");
}

/** Formatea fecha a ISO 8601 con offset Argentina (UTC-3).
 *  Render corre en UTC, por eso restamos 3h y usamos getUTC* para no
 *  depender del timezone del servidor. */
function isoAR(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ar = new Date(d.getTime() - 3 * 3600_000); // UTC → AR (UTC-3)
  return (
    `${ar.getUTCFullYear()}-${pad(ar.getUTCMonth() + 1)}-${pad(ar.getUTCDate())}` +
    `T${pad(ar.getUTCHours())}:${pad(ar.getUTCMinutes())}:${pad(ar.getUTCSeconds())}-03:00`
  );
}

// ── PKCS7 CMS Signing ─────────────────────────────────────────────────────────

function signTRA(tra: string, certPem: string, keyPem: string): string {
  const cert = forge.pki.certificateFromPem(certPem);
  const key  = forge.pki.privateKeyFromPem(keyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType,  value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime,  value: new Date() },
    ],
  });
  p7.sign();

  const der = forge.asn1.toDer(p7.toAsn1()).bytes();
  return forge.util.encode64(der);
}

// ── WSAA: obtener Ticket de Acceso ────────────────────────────────────────────

async function getTA(certPem: string, keyPem: string): Promise<{ token: string; sign: string }> {
  if (_ta && _ta.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
    return { token: _ta.token, sign: _ta.sign };
  }

  // Usar hora local Argentina (UTC-3) para el TRA
  const now  = new Date();
  const gen  = new Date(now.getTime() - 60_000);         // 1 min antes
  const exp  = new Date(now.getTime() + 12 * 3600_000);  // 12h después

  const tra = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<loginTicketRequest version="1.0">`,
    `  <header>`,
    `    <uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>`,
    `    <generationTime>${isoAR(gen)}</generationTime>`,
    `    <expirationTime>${isoAR(exp)}</expirationTime>`,
    `  </header>`,
    `  <service>wsfe</service>`,
    `</loginTicketRequest>`,
  ].join("\n");

  const cms = signTRA(tra, certPem, keyPem);

  const soapEnv = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<soapenv:Envelope`,
    `  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"`,
    `  xmlns:xsd="http://www.w3.org/2001/XMLSchema"`,
    `  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    `  <soapenv:Body>`,
    `    <loginCms xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov">`,
    `      <in0 xsi:type="xsd:string">${cms}</in0>`,
    `    </loginCms>`,
    `  </soapenv:Body>`,
    `</soapenv:Envelope>`,
  ].join("\n");

  let respData: string;
  try {
    const resp = await axios.post(WSAA_URL, soapEnv, {
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
      timeout: 30_000,
    });
    respData = resp.data as string;
  } catch (e: any) {
    const body = e.response?.data ?? "(sin cuerpo)";
    throw new Error(`WSAA HTTP error: ${e.message} — ${String(body).slice(0, 2000)}`);
  }

  // Detectar SOAPFault
  if (respData.includes("faultstring")) {
    const fault = extractXml(respData, "faultstring");
    throw new Error(`WSAA SOAP fault: ${fault}`);
  }

  // loginCmsReturn puede tener el XML escapado como HTML
  const rawReturn  = extractXml(respData, "loginCmsReturn");
  const innerXml   = unescapeHtml(rawReturn);

  const token = extractXml(innerXml, "token");
  const sign  = extractXml(innerXml, "sign");
  const expStr = extractXml(innerXml, "expirationTime");

  if (!token || !sign) {
    throw new Error(`WSAA: no se obtuvo token/sign. Respuesta: ${respData.slice(0, 500)}`);
  }

  const expiresAt = expStr ? new Date(expStr) : exp;
  _ta = { token, sign, expiresAt };
  return { token, sign };
}

// ── WSFE: SOAP genérico ────────────────────────────────────────────────────────

async function wsfeSoap(action: string, bodyInner: string): Promise<string> {
  const envelope = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<soap:Envelope`,
    `  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"`,
    `  xmlns:ar="${WSFE_NS}">`,
    `  <soap:Body>`,
    `    <ar:${action}>`,
    bodyInner,
    `    </ar:${action}>`,
    `  </soap:Body>`,
    `</soap:Envelope>`,
  ].join("\n");

  // Gateado: el SOAP completo lleva CUIT y montos fiscales. Solo loguear si se pide
  // explícitamente (DEBUG_ARCA=1). Apagado en producción por defecto.
  if (action === "FECAESolicitar" && process.env.DEBUG_ARCA) {
    console.log(`[ARCA] FECAESolicitar payload:\n${envelope}`);
  }

  let respData: string;
  try {
    const resp = await axios.post(WSFE_URL, envelope, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"${WSFE_NS}${action}"`,
      },
      timeout: 30_000,
    });
    respData = resp.data as string;
  } catch (e: any) {
    const body = e.response?.data ?? "(sin cuerpo)";
    throw new Error(`WSFE HTTP error (${action}): ${e.message} — ${String(body).slice(0, 2000)}`);
  }

  if (action === "FECAESolicitar" && process.env.DEBUG_ARCA) {
    console.log(`[ARCA] FECAESolicitar respuesta:\n${respData}`);
  }

  return respData;
}

// Auth XML fragment
function authXml(token: string, sign: string): string {
  return [
    `      <ar:Auth>`,
    `        <ar:Token>${token}</ar:Token>`,
    `        <ar:Sign>${sign}</ar:Sign>`,
    `        <ar:Cuit>${CUIT}</ar:Cuit>`,
    `      </ar:Auth>`,
  ].join("\n");
}

// ── Modo test (ARCA_TEST_MODE=true) ──────────────────────────────────────────

let _testCounter: Record<number, number> = {};

function isTestMode() {
  return process.env.ARCA_TEST_MODE === "true";
}

// ── Público: último comprobante autorizado ────────────────────────────────────

export async function getLastVoucher(cbteTipo: number): Promise<number> {
  if (isTestMode()) {
    return _testCounter[cbteTipo] ?? 0;
  }

  const cert = normalizePem(process.env.ARCA_CERT ?? "");
  const key  = normalizePem(process.env.ARCA_KEY  ?? "");
  if (!cert || !key) throw new Error("ARCA_CERT y ARCA_KEY son requeridas");

  const { token, sign } = await getTA(cert, key);

  const xml = await wsfeSoap("FECompUltimoAutorizado", [
    authXml(token, sign),
    `      <ar:PtoVta>${PUNTO_VENTA}</ar:PtoVta>`,
    `      <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`,
  ].join("\n"));

  const cbteNro = extractXml(xml, "CbteNro");
  return parseInt(cbteNro || "0", 10) || 0;
}

// ── Público: crear comprobante y obtener CAE ──────────────────────────────────

export type VoucherData = {
  CantReg: number;
  PtoVta: number;
  CbteTipo: number;
  Concepto: number;
  DocTipo: number;
  DocNro: number;
  CbteDesde: number;
  CbteHasta: number;
  CbteFch: number;
  ImpTotal: number;
  ImpTotConc: number;
  ImpNeto: number;
  ImpOpEx: number;
  ImpIVA: number;
  ImpTrib: number;
  MonId: string;
  MonCotiz: number;
  /** Condición IVA del receptor (obligatorio desde 15/04/2025):
   *  1=Resp.Inscripto  4=Exento  5=ConsumidorFinal  6=Monotributista  13=MonotributistaSocial */
  CondicionIVAReceptorId: number;
  Iva: { Id: number; BaseImp: number; Importe: number }[];
  /** Comprobantes asociados (requerido para Notas de Crédito) */
  CbtesAsoc?: { Tipo: number; PtoVta: number; Nro: number }[];
};

export async function createVoucher(data: VoucherData): Promise<{ CAE: string; CAEFchVto: string }> {
  if (isTestMode()) {
    // Incrementar contador interno para que el nextNumber sea consistente
    _testCounter[data.CbteTipo] = (_testCounter[data.CbteTipo] ?? 0) + 1;
    const vto = new Date();
    vto.setDate(vto.getDate() + 30);
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const CAEFchVto = `${vto.getUTCFullYear()}${pad2(vto.getUTCMonth() + 1)}${pad2(vto.getUTCDate())}`;
    console.log(`[ARCA TEST MODE] CAE ficticio para CbteTipo=${data.CbteTipo} CbteDesde=${data.CbteDesde}`);
    return { CAE: "12345678901234", CAEFchVto };
  }

  const cert = normalizePem(process.env.ARCA_CERT ?? "");
  const key  = normalizePem(process.env.ARCA_KEY  ?? "");
  if (!cert || !key) throw new Error("ARCA_CERT y ARCA_KEY son requeridas");

  const { token, sign } = await getTA(cert, key);

  const ivaItems = data.Iva.map((a) => [
    `          <ar:AlicIva>`,
    `            <ar:Id>${a.Id}</ar:Id>`,
    `            <ar:BaseImp>${a.BaseImp.toFixed(2)}</ar:BaseImp>`,
    `            <ar:Importe>${a.Importe.toFixed(2)}</ar:Importe>`,
    `          </ar:AlicIva>`,
  ].join("\n")).join("\n");

  const body = [
    authXml(token, sign),
    `      <ar:FeCAEReq>`,
    `        <ar:FeCabReq>`,
    `          <ar:CantReg>${data.CantReg}</ar:CantReg>`,
    `          <ar:PtoVta>${data.PtoVta}</ar:PtoVta>`,
    `          <ar:CbteTipo>${data.CbteTipo}</ar:CbteTipo>`,
    `        </ar:FeCabReq>`,
    `        <ar:FeDetReq>`,
    `          <ar:FECAEDetRequest>`,
    `            <ar:Concepto>${data.Concepto}</ar:Concepto>`,
    `            <ar:DocTipo>${data.DocTipo}</ar:DocTipo>`,
    `            <ar:DocNro>${data.DocNro}</ar:DocNro>`,
    `            <ar:CbteDesde>${data.CbteDesde}</ar:CbteDesde>`,
    `            <ar:CbteHasta>${data.CbteHasta}</ar:CbteHasta>`,
    `            <ar:CbteFch>${data.CbteFch}</ar:CbteFch>`,
    `            <ar:ImpTotal>${data.ImpTotal.toFixed(2)}</ar:ImpTotal>`,
    `            <ar:ImpTotConc>${data.ImpTotConc.toFixed(2)}</ar:ImpTotConc>`,
    `            <ar:ImpNeto>${data.ImpNeto.toFixed(2)}</ar:ImpNeto>`,
    `            <ar:ImpOpEx>${data.ImpOpEx.toFixed(2)}</ar:ImpOpEx>`,
    `            <ar:ImpIVA>${data.ImpIVA.toFixed(2)}</ar:ImpIVA>`,
    `            <ar:ImpTrib>${data.ImpTrib.toFixed(2)}</ar:ImpTrib>`,
    `            <ar:MonId>${data.MonId}</ar:MonId>`,
    `            <ar:MonCotiz>${data.MonCotiz}</ar:MonCotiz>`,
    `            <ar:CondicionIVAReceptorId>${data.CondicionIVAReceptorId}</ar:CondicionIVAReceptorId>`,
    data.Iva.length > 0 ? [`            <ar:Iva>`, ivaItems, `            </ar:Iva>`].join("\n") : "",
    data.CbtesAsoc?.length ? [
      `            <ar:CbtesAsoc>`,
      data.CbtesAsoc.map((a) => [
        `              <ar:CbteAsoc>`,
        `                <ar:Tipo>${a.Tipo}</ar:Tipo>`,
        `                <ar:PtoVta>${a.PtoVta}</ar:PtoVta>`,
        `                <ar:Nro>${a.Nro}</ar:Nro>`,
        `              </ar:CbteAsoc>`,
      ].join("\n")).join("\n"),
      `            </ar:CbtesAsoc>`,
    ].join("\n") : "",
    `          </ar:FECAEDetRequest>`,
    `        </ar:FeDetReq>`,
    `      </ar:FeCAEReq>`,
  ].filter(Boolean).join("\n");

  const xml = await wsfeSoap("FECAESolicitar", body);

  // Detectar error AFIP en respuesta — extraer TODAS las observaciones/errores
  const resultado = extractXml(xml, "Resultado");
  if (resultado === "R") {
    // Cada <Obs> tiene <Code> y <Msg> — capturar todos
    const obsBlocks = extractAllXml(xml, "Obs");
    const errBlocks = extractAllXml(xml, "Err");
    const toMsg = (block: string) => {
      const code = extractXml(block, "Code");
      const msg  = extractXml(block, "Msg");
      return code ? `[${code}] ${msg}` : msg;
    };
    const allMsgs = [...obsBlocks, ...errBlocks].map(toMsg).filter(Boolean);
    const detail = allMsgs.length > 0 ? allMsgs.join(" | ") : extractXml(xml, "Msg") || "(sin detalle)";
    throw new Error(`AFIP rechazó el comprobante: ${detail}`);
  }

  const CAE       = extractXml(xml, "CAE");
  const CAEFchVto = extractXml(xml, "CAEFchVto");

  if (!CAE) {
    // Incluir fragmento de respuesta para diagnóstico
    const obs = extractXml(xml, "Msg") || extractXml(xml, "faultstring");
    throw new Error(`WSFE: no se obtuvo CAE${obs ? ` — ${obs}` : ""}. XML: ${xml.slice(0, 600)}`);
  }

  return { CAE, CAEFchVto };
}
