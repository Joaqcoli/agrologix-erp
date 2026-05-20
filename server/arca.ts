import Afip from "@afipsdk/afip.js";

let _afip: any = null;

export function getAfip() {
  if (_afip) return _afip;
  const cert = process.env.ARCA_CERT;
  const key  = process.env.ARCA_KEY;
  if (!cert || !key) throw new Error("ARCA_CERT y ARCA_KEY son requeridas");
  _afip = new Afip({ CUIT: 30718551842, cert, key, production: true });
  return _afip;
}
