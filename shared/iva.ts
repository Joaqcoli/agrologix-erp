// ─── IVA — única fuente de la tasa ───────────────────────────────────────────
// La tasa de IVA es un DATO del producto (products.iva_rate), no se adivina por el
// nombre. Este es el único lugar que decide la tasa; back y front lo usan.
// Ver AUDITORIA-IVA.md (M6).
export const IVA_DEFAULT = 0.105;

// Lee la tasa de IVA del producto. Acepta el producto entero o un objeto con ivaRate.
// Fallback al general (10,5%) solo si falta el dato (la columna es NOT NULL → no debería).
export function ivaRateOf(product?: { ivaRate?: string | number | null } | null): number {
  if (product == null) return IVA_DEFAULT;
  const r = parseFloat(String(product.ivaRate ?? ""));
  return Number.isFinite(r) && r > 0 ? r : IVA_DEFAULT;
}

// ─── ¿Este pedido lleva IVA? ──────────────────────────────────────────────────
// Regla ÚNICA (back y front): el cliente tiene IVA (has_iva) y, si tiene fecha de inicio
// (iva_since), el pedido es de esa fecha o posterior. Sin fecha → aplica a todos sus pedidos,
// viejos incluidos (ej. Bonafide Paso del Rey). Con fecha → solo desde ese día (ej. Fabric
// Sushi desde 2026-10-02), los pedidos anteriores y su cuenta corriente no cambian.
// Excepción por pedido (orders.iva_override, 26/11/2026): true/false manda sobre el cliente; NULL = según el cliente.
// Sirve para facturar con IVA remitos sueltos de un cliente que lleva la cuenta corriente sin IVA (ej. Laguna):
// se pasa ESE pedido a "+ IVA", se factura y el cobro coincide con el total facturado.
// En SQL la misma regla es: COALESCE(o.iva_override, (c.has_iva AND (c.iva_since IS NULL OR o.order_date::date >= c.iva_since))).
export function hasIvaOn(
  customer: { hasIva?: boolean | null; ivaSince?: string | Date | null } | null | undefined,
  orderDate: string | Date | null | undefined,
  ivaOverride?: boolean | null,
): boolean {
  if (typeof ivaOverride === "boolean") return ivaOverride;
  if (!customer?.hasIva) return false;
  if (!customer.ivaSince) return true;
  const since = customer.ivaSince instanceof Date ? customer.ivaSince.toISOString().slice(0, 10) : String(customer.ivaSince).slice(0, 10);
  if (!orderDate) return true;
  const day = orderDate instanceof Date ? orderDate.toISOString().slice(0, 10) : String(orderDate).slice(0, 10);
  return day >= since;
}
