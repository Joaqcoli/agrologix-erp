/**
 * shared/units.ts — Unit canonicalization and mapping utilities
 * Used by both server and client.
 */

export type CanonicalUnit = "KG" | "CAJON" | "BOLSA" | "UNIDAD" | "ATADO" | "LITRO" | "TONELADA" | "PZ";

export const ALL_CANONICAL_UNITS: CanonicalUnit[] = [
  "KG", "CAJON", "BOLSA", "UNIDAD", "ATADO", "LITRO", "TONELADA", "PZ",
];

/** Normalize accents and whitespace */
function norm(s: string): string {
  return s.trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

const INPUT_TO_CANONICAL: Record<string, CanonicalUnit> = {
  CAJA: "CAJON", CAJON: "CAJON", CAJONES: "CAJON", CAJAS: "CAJON",
  SACO: "BOLSA", SACOS: "BOLSA", BOLSA: "BOLSA", BOLSAS: "BOLSA",
  KG: "KG", KILO: "KG", KILOS: "KG", KILOGRAMO: "KG", KILOGRAMOS: "KG",
  PZ: "PZ", PIEZA: "PZ", PIEZAS: "PZ",
  UNIDAD: "UNIDAD", UNIDADES: "UNIDAD", UN: "UNIDAD", U: "UNIDAD", UND: "UNIDAD",
  LITRO: "LITRO", LITROS: "LITRO", LT: "LITRO", LTS: "LITRO",
  TONELADA: "TONELADA", TONELADAS: "TONELADA", TON: "TONELADA", TONS: "TONELADA",
  ATADO: "ATADO", ATADOS: "ATADO", AT: "ATADO",
};

/** Convert any unit string to its canonical uppercase form */
export function canonicalizeUnit(input: string): CanonicalUnit {
  const n = norm(input);
  return INPUT_TO_CANONICAL[n] ?? (n as CanonicalUnit);
}

/** Map from Drizzle unit enum values to canonical forms */
export function dbEnumToCanonical(unit: string): CanonicalUnit {
  const MAP: Record<string, CanonicalUnit> = {
    caja: "CAJON",
    saco: "BOLSA",
    kg: "KG",
    pz: "PZ",
    litro: "LITRO",
    tonelada: "TONELADA",
    // extended values that may be added later
    cajon: "CAJON",
    bolsa: "BOLSA",
    unidad: "UNIDAD",
    atado: "ATADO",
  };
  return MAP[unit.toLowerCase()] ?? (unit.toUpperCase() as CanonicalUnit);
}

/** Map canonical back to the DB enum value used in order_items/purchase_items */
export function canonicalToDbEnum(canonical: string): string {
  const MAP: Record<string, string> = {
    CAJON: "caja",
    BOLSA: "saco",
    KG: "kg",
    PZ: "pz",
    LITRO: "litro",
    TONELADA: "tonelada",
    UNIDAD: "pz",   // no enum value — closest is pz
    ATADO: "pz",    // no enum value — closest is pz
  };
  return MAP[canonical.toUpperCase()] ?? canonical.toLowerCase();
}

/** Display label for canonical units */
export const CANONICAL_UNIT_LABEL: Record<string, string> = {
  KG: "Kilogramo",
  CAJON: "Cajón",
  BOLSA: "Bolsa/Saco",
  UNIDAD: "Unidad",
  ATADO: "Atado",
  LITRO: "Litro",
  TONELADA: "Tonelada",
  PZ: "Pieza",
};
