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
