// Formateadores compartidos. Los MONTOS van en formato argentino (es-AR):
// separador de miles con punto y decimal con coma → 1.234.568 / 1.234,50.
// Las CANTIDADES (campos editables que se reparsean) van SIN localizar (ver fmtCantidad).

const AR = "es-AR";

/** Monto con $ en formato argentino, redondeado sin decimales: $1.234.568 */
export function fmtPesos(v: string | number): string {
  return "$" + Math.round(Number(v)).toLocaleString(AR);
}

/** Número sin $ en formato argentino, redondeado sin decimales: 1.234.568 */
export function fmtMiles(v: string | number): string {
  return Math.round(Number(v)).toLocaleString(AR);
}

/** Monto con decimales en formato argentino: 1.234,50 (cantidad de decimales configurable) */
export function fmtDecimal(v: string | number, dec = 2): string {
  return Number(v).toLocaleString(AR, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** Fecha → YYYY-MM-DD (no es un monto: no se localiza) */
export function fmtFecha(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Cantidad NO localizada: punto decimal, sin separador de miles, sin ceros sobrantes
 * → "2.5", "3", "1234.5". Para campos editables que se reparsean con parseFloat y se
 * mandan al backend: el punto decimal mantiene parseFloat correcto y evita la coma de
 * miles que rompía el parseo para cantidades ≥ 1000.
 */
export function fmtCantidad(v: string | number): string {
  const n = Number(v);
  if (!isFinite(n)) return "";
  return n.toFixed(4).replace(/\.?0+$/, "");
}
