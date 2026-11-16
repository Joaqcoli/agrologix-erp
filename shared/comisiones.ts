// ─── Comisiones de vendedores: reglas compartidas (back y front) ──────────────
// 16/11/2026. Cada pedido fija su % al crearse según la antigüedad del cliente a esa fecha:
// dentro de los primeros 6 meses exactos desde la fecha de alta → 5 %, después → 1 %.
// La fecha de alta (customers.comision_alta) es la del primer pedido del cliente y no se
// recalcula. Clientes que ya compraban antes de octubre 2026: alta 2026-10-01 (relleno en migrate).
// En SQL la misma regla es: o.order_date::date < (c.comision_alta + interval '6 months')::date → 5, si no 1.
// (Postgres suma meses y recorta al último día del mes si hace falta; fechaBajaComision hace lo mismo.)

export const COMISION_PCT_INICIAL = 5;
export const COMISION_PCT_POSTERIOR = 1;
export const COMISION_MESES_INICIALES = 6;

/** Métodos de pago que cubren el pedido pero NO comisionan (no es plata que entra). */
export const COBRANZA_SIN_COMISION = new Set(["RETENCION", "DIFERENCIA", "SALDO_INICIAL"]);

const diasDelMes = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1..12

/** Primer día en que el cliente pasa al 1 %: alta + 6 meses (YYYY-MM-DD). Hasta el día anterior inclusive es 5 %. */
export function fechaBajaComision(alta: string): string {
  const [y, m, d] = alta.slice(0, 10).split("-").map(Number);
  let mm = m + COMISION_MESES_INICIALES, yy = y;
  while (mm > 12) { mm -= 12; yy += 1; }
  const dd = Math.min(d, diasDelMes(yy, mm));
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** % que corresponde a un pedido con fecha `fecha` (YYYY-MM-DD) para un cliente con esa alta. Sin alta → 5 %. */
export function comisionPctEn(alta: string | null | undefined, fecha: string): number {
  if (!alta) return COMISION_PCT_INICIAL;
  return fecha.slice(0, 10) < fechaBajaComision(alta) ? COMISION_PCT_INICIAL : COMISION_PCT_POSTERIOR;
}
