/**
 * shared/units.ts — Unit canonicalization and mapping utilities
 * Used by both server and client.
 */

export type CanonicalUnit = "KG" | "CAJON" | "BOLSA" | "UNIDAD" | "ATADO" | "MAPLE" | "BANDEJA";

export const ALL_CANONICAL_UNITS: CanonicalUnit[] = [
  "KG", "CAJON", "BOLSA", "UNIDAD", "ATADO", "MAPLE", "BANDEJA",
];

/** Normalize accents and whitespace */
function norm(s: string): string {
  return s.trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

const INPUT_TO_CANONICAL: Record<string, CanonicalUnit> = {
  CAJA: "CAJON", CAJON: "CAJON", CAJONES: "CAJON", CAJAS: "CAJON",
  SACO: "BOLSA", SACOS: "BOLSA", BOLSA: "BOLSA", BOLSAS: "BOLSA",
  KG: "KG", KILO: "KG", KILOS: "KG", KILOGRAMO: "KG", KILOGRAMOS: "KG",
  PZ: "UNIDAD", PIEZA: "UNIDAD", PIEZAS: "UNIDAD",
  UNIDAD: "UNIDAD", UNIDADES: "UNIDAD", UN: "UNIDAD", U: "UNIDAD", UND: "UNIDAD",
  ATADO: "ATADO", ATADOS: "ATADO", AT: "ATADO",
  MAPLE: "MAPLE", MAPLES: "MAPLE",
  BANDEJA: "BANDEJA", BANDEJAS: "BANDEJA",
};

/** Convert any unit string to its canonical uppercase form */
export function canonicalizeUnit(input: string): CanonicalUnit {
  const n = norm(input);
  return INPUT_TO_CANONICAL[n] ?? (n as CanonicalUnit);
}

/** Map from Drizzle unit enum values to canonical forms */
export function dbEnumToCanonical(unit: string): CanonicalUnit {
  const MAP: Record<string, CanonicalUnit> = {
    // Legacy lowercase values (pre-migration compat)
    kg: "KG", kilo: "KG", kilos: "KG",
    pz: "UNIDAD", pieza: "UNIDAD", piezas: "UNIDAD",
    caja: "CAJON", cajon: "CAJON",
    saco: "BOLSA", bolsa: "BOLSA",
    atado: "ATADO",
    maple: "MAPLE",
    bandeja: "BANDEJA",
    // Canonical uppercase values (identity map)
    kg_upper: "KG",
  };
  const lower = unit.toLowerCase();
  return MAP[lower] ?? (unit.toUpperCase() as CanonicalUnit);
}

/** Map canonical back to the DB enum value (now canonical IS the DB enum value) */
export function canonicalToDbEnum(canonical: string): string {
  // After unit standardization, canonical values are stored directly in the DB
  return canonical.toUpperCase();
}

/** Display label for canonical units */
export const CANONICAL_UNIT_LABEL: Record<string, string> = {
  KG: "Kilogramo",
  CAJON: "Cajón",
  BOLSA: "Bolsa/Saco",
  UNIDAD: "Unidad",
  ATADO: "Atado",
  MAPLE: "Maple",
  BANDEJA: "Bandeja",
  LITRO: "Litro",
  TONELADA: "Tonelada",
  PZ: "Pieza",
};
