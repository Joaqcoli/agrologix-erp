/**
 * parseQuantityAndUnit.ts — Robust quantity and unit extraction for Spanish order formats
 *
 * Handles:
 * - Grams: 800grs, 800gr, 600gra, 0,8 gr → KG (÷1000)
 * - Fractions: 1/2, 3/4, 1 1/2, ½
 * - Units: cajon, bolsa, kg, unidad, atado, maple + synonyms
 * - Quantity before or after unit: "2 kg banana", "banana 2kg"
 *
 * Canonical units: CAJON, BOLSA, KG, UNIDAD, ATADO, MAPLE
 */

export type ParseQuantityResult = {
  quantity: number | null;
  unit: string | null;
  rawProductName: string;
};

// Unit keywords (normalized) → canonical
const UNIT_ALIASES: Record<string, string> = {
  gr: "KG", grs: "KG", gramos: "KG", gramo: "KG", g: "KG", gra: "KG", "gr.": "KG",
  kg: "KG", kilo: "KG", kilos: "KG", kilogramo: "KG", kilogramos: "KG",
  cajon: "CAJON", cajón: "CAJON", cajones: "CAJON", caja: "CAJON", cajas: "CAJON",
  bolsa: "BOLSA", bolsas: "BOLSA", saco: "BOLSA", sacos: "BOLSA",
  unidad: "UNIDAD", unidades: "UNIDAD", u: "UNIDAD", ud: "UNIDAD", und: "UNIDAD",
  pieza: "UNIDAD", piezas: "UNIDAD", pza: "UNIDAD", pz: "UNIDAD",
  cabeza: "UNIDAD", cabezas: "UNIDAD",
  at: "ATADO", atado: "ATADO", atados: "ATADO",
  maple: "MAPLE", maples: "MAPLE",
  bandeja: "BANDEJA", bandejas: "BANDEJA",
};

function tokenize(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

function normalizeToken(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.$/, "");
}

/** Parse fraction: 1/2, 3/4, 1 1/2, ½ */
function parseFraction(s: string): number | null {
  const trimmed = s.trim();
  // Unicode fractions
  const unicode: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
  if (unicode[trimmed] !== undefined) return unicode[trimmed];
  // a/b
  const simple = trimmed.match(/^(\d+)\/(\d+)$/);
  if (simple) return parseInt(simple[1], 10) / parseInt(simple[2], 10);
  // n a/b
  const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / parseInt(mixed[3], 10);
  return null;
}

/** Check if token looks like grams (gr, grs, gramos, g, gra, etc.) */
function isGramsToken(t: string): boolean {
  const n = normalizeToken(t);
  return /^gr\.?s?$/.test(n) || n === "gramos" || n === "gramo" || n === "g" || n === "gra";
}

/** Parse decimal number, accepts comma as decimal separator */
function parseDecimal(s: string): number | null {
  const cleaned = s.replace(",", ".");
  const m = cleaned.match(/^[\d]+\.?\d*$/);
  if (!m) return null;
  const v = parseFloat(cleaned);
  return isNaN(v) ? null : v;
}

/**
 * Parse quantity and unit from a line of order text.
 * Returns { quantity, unit, rawProductName }.
 * Unit is canonical (KG, CAJON, BOLSA, UNIDAD, ATADO, MAPLE).
 */
export function parseQuantityAndUnit(line: string): ParseQuantityResult {
  const trimmed = line.trim();
  if (!trimmed) return { quantity: null, unit: null, rawProductName: "" };

  const tokens = tokenize(trimmed);
  let quantity: number | null = null;
  let unit: string | null = null;
  const usedIndices = new Set<number>();

  // ─── 1) Grams: 800grs, 800 grs, 600gra, 0,8 gr (→ KG) ──────────────────────
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // Combined: 800grs, 800gr, 600gra
    const combinedGram = t.match(/^(\d+(?:[.,]\d+)?)\s*(gr|grs|gramos?|g|gra|gr\.?)\.?$/i);
    if (combinedGram) {
      const q = parseFloat(combinedGram[1].replace(",", "."));
      if (!isNaN(q)) {
        quantity = q / 1000;
        unit = "KG";
        usedIndices.add(i);
        break;
      }
    }
    // Separate: "800" + "grs" or "0,8" + "gr"
    if (i < tokens.length - 1 && isGramsToken(tokens[i + 1])) {
      const q = parseDecimal(t);
      if (q !== null && q >= 0) {
        quantity = q / 1000;
        unit = "KG";
        usedIndices.add(i);
        usedIndices.add(i + 1);
        break;
      }
    }
  }

  if (quantity !== null && unit !== null) {
    const rawProductName = tokens.filter((_, i) => !usedIndices.has(i)).join(" ").replace(/\bde\b/gi, "").trim().replace(/\s+/g, " ");
    return { quantity, unit, rawProductName };
  }

  usedIndices.clear();

  // ─── 2) Number + kg (no space or space): 2kg, 18kg, 2 kg ───────────────────
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const combinedKg = t.match(/^(\d+(?:[.,]\d+)?)\s*(kg|kilo|kilos)$/i);
    if (combinedKg) {
      const q = parseFloat(combinedKg[1].replace(",", "."));
      if (!isNaN(q)) {
        quantity = q;
        unit = "KG";
        usedIndices.add(i);
        break;
      }
    }
    if (i < tokens.length - 1) {
      const normNext = normalizeToken(tokens[i + 1]);
      if ((normNext === "kg" || normNext === "kilo" || normNext === "kilos") && parseDecimal(t) !== null) {
        quantity = parseFloat(t.replace(",", "."));
        unit = "KG";
        usedIndices.add(i);
        usedIndices.add(i + 1);
        break;
      }
    }
  }

  if (quantity !== null && unit !== null) {
    const rawProductName = tokens.filter((_, i) => !usedIndices.has(i)).join(" ").replace(/\bde\b/gi, "").trim().replace(/\s+/g, " ");
    return { quantity, unit, rawProductName };
  }

  usedIndices.clear();

  // ─── 3) Fraction + unit: 1/2 atado, 1/2 cajón, ½ atado ───────────────────
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const frac = parseFraction(t);
    if (frac !== null && i < tokens.length - 1) {
      const normNext = normalizeToken(tokens[i + 1]);
      const canonical = UNIT_ALIASES[normNext];
      if (canonical && !isGramsToken(tokens[i + 1])) {
        quantity = frac;
        unit = canonical;
        usedIndices.add(i);
        usedIndices.add(i + 1);
        break;
      }
    }
  }

  if (quantity !== null && unit !== null) {
    const rawProductName = tokens.filter((_, i) => !usedIndices.has(i)).join(" ").replace(/\bde\b/gi, "").trim().replace(/\s+/g, " ");
    return { quantity, unit, rawProductName };
  }

  usedIndices.clear();

  // ─── 4) Integer + unit word: 2 cabezas, 1 bolsa, 2 cajones, 1 at ───────────
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const q = parseDecimal(t);
    if (q !== null && q >= 0 && Number.isInteger(q) && i < tokens.length - 1) {
      const normNext = normalizeToken(tokens[i + 1]);
      const canonical = UNIT_ALIASES[normNext];
      if (canonical) {
        quantity = q;
        unit = canonical;
        usedIndices.add(i);
        usedIndices.add(i + 1);
        break;
      }
    }
  }

  if (quantity !== null && unit !== null) {
    const rawProductName = tokens.filter((_, i) => !usedIndices.has(i)).join(" ").replace(/\bde\b/gi, "").trim().replace(/\s+/g, " ");
    return { quantity, unit, rawProductName };
  }

  usedIndices.clear();

  // ─── 5) Decimal + unit word: 0,8 kg, 1.5 cajon ───────────────────────────
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const q = parseDecimal(t);
    if (q !== null && q >= 0 && i < tokens.length - 1) {
      const normNext = normalizeToken(tokens[i + 1]);
      const canonical = UNIT_ALIASES[normNext];
      if (canonical) {
        quantity = q;
        unit = canonical;
        usedIndices.add(i);
        usedIndices.add(i + 1);
        break;
      }
    }
  }

  if (quantity !== null && unit !== null) {
    const rawProductName = tokens.filter((_, i) => !usedIndices.has(i)).join(" ").replace(/\bde\b/gi, "").trim().replace(/\s+/g, " ");
    return { quantity, unit, rawProductName };
  }

  usedIndices.clear();

  // ─── 6) Number only (first number, default unit KG) ───────────────────────
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const q = parseDecimal(t) ?? parseFraction(t);
    if (q !== null && q >= 0) {
      quantity = q;
      unit = "KG";
      usedIndices.add(i);
      // Check if next token is a unit
      if (i + 1 < tokens.length) {
        const normNext = normalizeToken(tokens[i + 1]);
        const canonical = UNIT_ALIASES[normNext];
        if (canonical) {
          unit = canonical;
          usedIndices.add(i + 1);
        }
      }
      break;
    }
  }

  if (quantity !== null) {
    const rawProductName = tokens.filter((_, i) => !usedIndices.has(i)).join(" ").replace(/\bde\b/gi, "").trim().replace(/\s+/g, " ");
    return { quantity, unit: unit ?? "KG", rawProductName };
  }

  // ─── 7) Quantity at end: "banana 2kg", "manzana 2 kg" ─────────────────────
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    const combinedKg = t.match(/^(\d+(?:[.,]\d+)?)\s*(kg|kilo|kilos)$/i);
    if (combinedKg) {
      const q = parseFloat(combinedKg[1].replace(",", "."));
      if (!isNaN(q)) {
        quantity = q;
        unit = "KG";
        usedIndices.add(i);
        const rawProductName = tokens.filter((_, idx) => !usedIndices.has(idx)).join(" ").replace(/\bde\b/gi, "").trim().replace(/\s+/g, " ");
        return { quantity, unit, rawProductName };
      }
    }
    if (i > 0) {
      const q = parseDecimal(t);
      const normPrev = normalizeToken(tokens[i - 1]);
      const canonical = UNIT_ALIASES[normPrev];
      if (q !== null && q >= 0 && canonical) {
        quantity = q;
        unit = canonical;
        usedIndices.add(i - 1);
        usedIndices.add(i);
        const rawProductName = tokens.filter((_, idx) => !usedIndices.has(idx)).join(" ").replace(/\bde\b/gi, "").trim().replace(/\s+/g, " ");
        return { quantity, unit, rawProductName };
      }
    }
  }

  return { quantity: null, unit: null, rawProductName: trimmed };
}

/*
 * Sample verification (run manually or add to tests):
 *
 * parseQuantityAndUnit("800grs de apio")     → { quantity: 0.8, unit: "KG", rawProductName: "apio" }
 * parseQuantityAndUnit("800gr de puerro")    → { quantity: 0.8, unit: "KG", rawProductName: "puerro" }
 * parseQuantityAndUnit("600gra de verdeo")   → { quantity: 0.6, unit: "KG", rawProductName: "verdeo" }
 * parseQuantityAndUnit("1/2 atado perejil")  → { quantity: 0.5, unit: "ATADO", rawProductName: "perejil" }
 * parseQuantityAndUnit("1/2 cajón de manzana roja") → { quantity: 0.5, unit: "CAJON", rawProductName: "manzana roja" }
 * parseQuantityAndUnit("2kg morron rojo")    → { quantity: 2, unit: "KG", rawProductName: "morron rojo" }
 * parseQuantityAndUnit("4kg repollo blanco") → { quantity: 4, unit: "KG", rawProductName: "repollo blanco" }
 * parseQuantityAndUnit("18kg de tomate")     → { quantity: 18, unit: "KG", rawProductName: "tomate" }
 * parseQuantityAndUnit("2 cabezas de ajo")   → { quantity: 2, unit: "UNIDAD", rawProductName: "ajo" }
 * parseQuantityAndUnit("1 bolsa de anco")    → { quantity: 1, unit: "BOLSA", rawProductName: "anco" }
 * parseQuantityAndUnit("2 cajones de naranja para jugo elegida") → { quantity: 2, unit: "CAJON", rawProductName: "naranja para jugo elegida" }
 * parseQuantityAndUnit("1 AT cilantro")      → { quantity: 1, unit: "ATADO", rawProductName: "cilantro" }
 */
