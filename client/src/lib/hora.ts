// 18/11/2026: horario de entrega como texto "HH:MM" (24 h). No usamos <input type="time"> porque en navegadores en
// inglés muestra AM/PM y, si el usuario no lo completa, el valor queda vacío y se guarda nada (le pasó a Joaquín).
/** Normaliza lo tipeado a "HH:MM": "8" → 08:00, "830" → 08:30, "8:5" → 08:05, "13.45" → 13:45. Inválido → "". */
export function normalizarHora(v: string | null | undefined): string {
  const s = (v ?? "").trim().toLowerCase().replace(/\s*hs?\.?$/, "");
  if (!s) return "";
  let h: number, m: number;
  const sep = s.match(/^(\d{1,2})[:.,h](\d{1,2})$/);
  if (sep) { h = Number(sep[1]); m = Number(sep[2]); }
  else if (/^\d{1,2}$/.test(s)) { h = Number(s); m = 0; }
  else if (/^\d{3,4}$/.test(s)) { h = Number(s.slice(0, s.length - 2)); m = Number(s.slice(-2)); }
  else return "";
  if (h > 23 || m > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
