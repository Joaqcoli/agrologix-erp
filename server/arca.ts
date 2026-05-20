/**
 * Integración directa con AFIP/ARCA
 * WSAA (autenticación) + WSFE v1 (factura electrónica)
 * Sin dependencias de terceros — solo node-forge + axios
 */
import forge from "node-forge";
import axios from "axios";

const CUIT = 30718551842;
const PUNTO_VENTA = 1;

const WSAA_URL  = "https://wsaa.afip.gov.ar/ws/services/LoginCms";
const WSFE_URL  = "https://servicios1.afip.gov.ar/wsfev1/service.asmx";
const WSFE_NS   = "http://ar.gov.afip.dif.FEV1/";

// ── Token cache (válido 12 horas) ─────────────────────────────────────────────
let _ta: { token: string; sign: string; expiresAt: Date } | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function isoAR(d: Date) {
  // WSAA acepta ISO 8601 con offset
  return d.toISOString().replace("Z", "-03:00");
}

function extractXml(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, "i"));
  return m?.[1]?.trim() ?? "";
}

// ── Firmar TRA con PKCS7 CMS ──────────────────────────────────────────────────
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
    authenticatedAttributes: [],
  });
  p7.sign({ detached: false });

  const der = forge.asn1.toDer(p7.toAsn1()).bytes();
  return forge.util.encode64(der);
}

// ── WSAA: obtener ticket de acceso ────────────────────────────────────────────
async function getTA(certPem: string, keyPem: string): Promise<{ token: string; sign: string }> {
  // Usar cache si no expiró (con 5 min de margen)
  if (_ta && _ta.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
    return { token: _ta.token, sign: _ta.sign };
  }

  const now  = new Date();
  const gen  = new Date(now.getTime() - 10_000);       // 10s antes
  const exp  = new Date(now.getTime() + 12 * 3600_000); // 12h después

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
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"`,
    `  xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">`,
    `  <soapenv:Header/>`,
    `  <soapenv:Body>`,
    `    <wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms>`,
    `  </soapenv:Body>`,
    `</soapenv:Envelope>`,
  ].join("\n");

  const resp = await axios.post(WSAA_URL, soapEnv, {
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
    timeout: 30_000,
  });

  // WSAA devuelve un XML dentro de <loginCmsReturn>...</loginCmsReturn>
  const inner = extractXml(resp.data, "loginCmsReturn");
  const token = extractXml(inner, "token");
  const sign  = extractXml(inner, "sign");
  const expStr = extractXml(inner, "expirationTime");

  if (!token || !sign) {
    throw new Error(`WSAA: respuesta inesperada — ${resp.data.slice(0, 400)}`);
  }

  const expiresAt = expStr ? new Date(expStr) : exp;
  _ta = { token, sign, expiresAt };
  return { token, sign };
}

// ── WSFE: llamada SOAP genérica ────────────────────────────────────────────────
async function wsfeSoap(action: string, bodyInner: string): Promise<string> {
  const envelope = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"`,
    `               xmlns:ar="${WSFE_NS}">`,
    `  <soap:Body>`,
    `    <ar:${action}>`,
    bodyInner,
    `    </ar:${action}>`,
    `  </soap:Body>`,
    `</soap:Envelope>`,
  ].join("\n");

  const resp = await axios.post(WSFE_URL, envelope, {
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `${WSFE_NS}${action}`,
    },
    timeout: 30_000,
  });
  return resp.data as string;
}

// ── Auth XML fragment ─────────────────────────────────────────────────────────
function authXml(token: string, sign: string) {
  return [
    `      <ar:Auth>`,
    `        <ar:Token>${token}</ar:Token>`,
    `        <ar:Sign>${sign}</ar:Sign>`,
    `        <ar:Cuit>${CUIT}</ar:Cuit>`,
    `      </ar:Auth>`,
  ].join("\n");
}

// ── Público: obtener último comprobante autorizado ────────────────────────────
export async function getLastVoucher(cbteTipo: number): Promise<number> {
  const cert = process.env.ARCA_CERT;
  const key  = process.env.ARCA_KEY;
  if (!cert || !key) throw new Error("ARCA_CERT y ARCA_KEY son requeridas");

  const { token, sign } = await getTA(cert, key);

  const xml = await wsfeSoap("FECompUltimoAutorizado", [
    authXml(token, sign),
    `      <ar:PtoVta>${PUNTO_VENTA}</ar:PtoVta>`,
    `      <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`,
  ].join("\n"));

  const cbteNro = extractXml(xml, "CbteNro");
  return parseInt(cbteNro ?? "0", 10) || 0;
}

// ── Público: crear comprobante y obtener CAE ───────────────────────────────────
export type VoucherData = {
  CantReg: number;
  PtoVta: number;
  CbteTipo: number;
  Concepto: number;
  DocTipo: number;
  DocNro: number;
  CbteDesde: number;
  CbteHasta: number;
  CbteFch: number;            // YYYYMMDD como entero
  ImpTotal: number;
  ImpTotConc: number;
  ImpNeto: number;
  ImpOpEx: number;
  ImpIVA: number;
  ImpTrib: number;
  MonId: string;
  MonCotiz: number;
  Iva: { Id: number; BaseImp: number; Importe: number }[];
};

export async function createVoucher(data: VoucherData): Promise<{ CAE: string; CAEFchVto: string }> {
  const cert = process.env.ARCA_CERT;
  const key  = process.env.ARCA_KEY;
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
    data.Iva.length > 0 ? [
      `            <ar:Iva>`,
      ivaItems,
      `            </ar:Iva>`,
    ].join("\n") : "",
    `          </ar:FECAEDetRequest>`,
    `        </ar:FeDetReq>`,
    `      </ar:FeCAEReq>`,
  ].join("\n");

  const xml = await wsfeSoap("FECAESolicitar", body);

  // Verificar errores AFIP
  const errMsg = extractXml(xml, "Msg");
  const resultado = extractXml(xml, "Resultado");
  if (resultado === "R" || (errMsg && errMsg !== "")) {
    const errCode = extractXml(xml, "Code");
    throw new Error(`AFIP WSFE error ${errCode}: ${errMsg || resultado}`);
  }

  const CAE      = extractXml(xml, "CAE");
  const CAEFchVto = extractXml(xml, "CAEFchVto");

  if (!CAE) {
    throw new Error(`WSFE: no se obtuvo CAE — ${xml.slice(0, 600)}`);
  }

  return { CAE, CAEFchVto };
}
