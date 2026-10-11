/**
 * shared/phone.ts — normalización de teléfonos argentinos a E.164 móvil: +549 + 10 dígitos.
 * Usado por el ERP (customer_contacts, /api/customers/by-phone) y por el agente de WhatsApp.
 *
 * Acepta lo que se ve en la base y en WhatsApp: "541154255000", "1130209804", "+54 9 11 3361-7823",
 * "011 15 5165 9102", "5491171232459". Devuelve null si no queda un número de 10 dígitos.
 */
export function normalizeArPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = String(input).replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.startsWith("9") && d.length >= 11) d = d.slice(1);
  // "11 15 xxxx xxxx" (área + 15 + número) → sacar el 15 solo si sobran dígitos
  if (d.length === 12 && /^(11|\d{3})15/.test(d)) d = d.replace(/^(11|\d{3})15/, "$1");
  if (d.length === 11 && /^(\d{3,4})15/.test(d) && !d.startsWith("11")) d = d.replace(/^(\d{3,4})15/, "$1");
  if (d.length !== 10) return null;
  return "+549" + d;
}

/** Para mostrar: +54 9 11 3361-7823 */
export function formatArPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = e164.match(/^\+549(\d{2})(\d{4})(\d{4})$/);
  if (m) return `+54 9 ${m[1]} ${m[2]}-${m[3]}`;
  const m2 = e164.match(/^\+549(\d{3})(\d{3})(\d{4})$/);
  if (m2) return `+54 9 ${m2[1]} ${m2[2]}-${m2[3]}`;
  return e164;
}
