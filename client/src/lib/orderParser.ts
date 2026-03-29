/**
 * orderParser.ts — Deterministic order text parser (strategy pattern)
 *
 * Strategy interface:
 *   type ParseStrategy = (text: string, products: Product[]) => ParsedLine[]
 *
 * Current implementation: parseOrderTextLocal (no AI)
 * Future:                 parseOrderTextAI   (OpenAI)
 */

export type ParseStatus = "ok" | "no_qty" | "no_product" | "ambiguous";

export type ParsedLine = {
  raw: string;
  quantity: number | null;
  unit: string | null;
  rawProductName: string;
  productId: number | null;
  productName: string | null;
  status: ParseStatus;
  candidates: { id: number; name: string; sku?: string | null }[];
  selectedProductId?: number;
};

// Valid units for the enum (must match DB enum)
const VALID_UNITS = ["KG", "UNIDAD", "CAJON", "BOLSA", "ATADO", "MAPLE", "BANDEJA"] as const;
type ValidUnit = typeof VALID_UNITS[number];

// Map of keyword aliases → canonical unit
const UNIT_MAP: Record<string, ValidUnit> = {
  cajon: "CAJON", cajones: "CAJON", caja: "CAJON", cajas: "CAJON",
  bolsa: "BOLSA", bolsas: "BOLSA", saco: "BOLSA", sacos: "BOLSA",
  kg: "KG", kilo: "KG", kilos: "KG", kilogramo: "KG", kilogramos: "KG",
  pz: "UNIDAD", pieza: "UNIDAD", piezas: "UNIDAD",
  unidad: "UNIDAD", unidades: "UNIDAD", und: "UNIDAD", un: "UNIDAD",
  atado: "ATADO", at: "ATADO",
  maple: "MAPLE", maples: "MAPLE",
  bandeja: "BANDEJA", bandejas: "BANDEJA",
};

// Strip accents and normalize
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Tokenize a string
function words(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

// Check if all words of `needle` appear in `haystack`
function containsAllWords(haystack: string[], needle: string[]): boolean {
  return needle.every((w) => haystack.includes(w));
}

type SimpleProduct = { id: number; name: string; sku?: string | null; unit: string };

function matchProduct(
  rawName: string,
  products: SimpleProduct[]
): { id: number; name: string; sku?: string | null }[] {
  const normRaw = normalize(rawName);
  const rawWords = words(rawName);

  const matches: { id: number; name: string; sku?: string | null; score: number }[] = [];

  for (const p of products) {
    const normName = normalize(p.name);
    const pWords = words(p.name);

    if (normName === normRaw) {
      // Exact match — best possible score
      return [{ id: p.id, name: p.name, sku: p.sku }];
    }

    let score = 0;

    // All raw words appear in product name
    if (containsAllWords(pWords, rawWords)) score += 3;
    // All product words appear in raw query
    else if (containsAllWords(rawWords, pWords)) score += 2;
    // Any word overlap
    else {
      const overlap = rawWords.filter((w) => pWords.includes(w));
      if (overlap.length > 0) score += overlap.length;
    }

    // SKU match (only if sku exists — sku is optional)
    if (p.sku && normalize(p.sku) === normRaw) score += 5;

    if (score > 0) {
      matches.push({ id: p.id, name: p.name, sku: p.sku, score });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  if (matches.length === 0) return [];

  // Return all matches with max score (could be multiple if tied)
  const maxScore = matches[0].score;
  return matches
    .filter((m) => m.score === maxScore)
    .map(({ id, name, sku }) => ({ id, name, sku }));
}

/**
 * Parse a single line of text into a ParsedLine.
 */
function parseLine(line: string, products: SimpleProduct[]): ParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Normalize unicode fractions before tokenizing
  const UNICODE_FRACS: Record<string, string> = {
    "\u00BD": "1/2", "\u00BC": "1/4", "\u00BE": "3/4",
    "\u2153": "1/3", "\u2154": "2/3",
  };
  const preprocessed = trimmed.replace(/[\u00BD\u00BC\u00BE\u2153\u2154]/g, (m) => UNICODE_FRACS[m] ?? m);
  const tokens = preprocessed.split(/\s+/);

  let quantity: number | null = null;
  let unit: string | null = null;
  const usedIndices = new Set<number>();

  // Pass 1: find quantity — handles integers, decimals, fractions ("1/2"), and mixed numbers ("1 1/2")
  for (let i = 0; i < tokens.length && quantity === null; i++) {
    const token = tokens[i];

    // Simple fraction: "1/2", "3/4"
    const fracMatch = token.match(/^(\d+)\/(\d+)$/);
    if (fracMatch && parseInt(fracMatch[2]) > 0) {
      quantity = parseInt(fracMatch[1]) / parseInt(fracMatch[2]);
      usedIndices.add(i);
      continue;
    }

    // Plain number (int or decimal) — optionally followed by a fraction for mixed numbers "1 1/2"
    if (/^(\d+)([.,]\d+)?$/.test(token)) {
      const val = parseFloat(token.replace(",", "."));
      if (i + 1 < tokens.length) {
        const nextFrac = tokens[i + 1].match(/^(\d+)\/(\d+)$/);
        if (nextFrac && parseInt(nextFrac[2]) > 0) {
          quantity = val + parseInt(nextFrac[1]) / parseInt(nextFrac[2]);
          usedIndices.add(i);
          usedIndices.add(i + 1);
          i++; // skip fraction token; loop condition stops after this iteration
          continue;
        }
      }
      quantity = val;
      usedIndices.add(i);
      continue;
    }
  }

  const remainingTokens = tokens.filter((_, i) => !usedIndices.has(i));

  // Pass 2: find unit from remaining tokens
  const productTokens: string[] = [];
  for (const token of remainingTokens) {
    const normToken = normalize(token);
    if (UNIT_MAP[normToken]) {
      unit = UNIT_MAP[normToken];
    } else {
      productTokens.push(token);
    }
  }

  const rawProductName = productTokens.join(" ").trim();

  // No quantity found
  if (quantity === null) {
    return {
      raw: trimmed,
      quantity: null,
      unit,
      rawProductName,
      productId: null,
      productName: null,
      status: "no_qty",
      candidates: [],
    };
  }

  // Try to match product
  if (!rawProductName) {
    return {
      raw: trimmed,
      quantity,
      unit,
      rawProductName: "",
      productId: null,
      productName: null,
      status: "no_product",
      candidates: [],
    };
  }

  const matched = matchProduct(rawProductName, products);

  if (matched.length === 0) {
    return {
      raw: trimmed,
      quantity,
      unit,
      rawProductName,
      productId: null,
      productName: null,
      status: "no_product",
      candidates: [],
    };
  }

  if (matched.length === 1) {
    // Use product's default unit if none provided
    const product = products.find((p) => p.id === matched[0].id);
    if (!unit && product) unit = product.unit;

    return {
      raw: trimmed,
      quantity,
      unit: unit ?? "KG",
      rawProductName,
      productId: matched[0].id,
      productName: matched[0].name,
      status: "ok",
      candidates: matched,
    };
  }

  // Multiple candidates — ambiguous
  return {
    raw: trimmed,
    quantity,
    unit: unit ?? "kg",
    rawProductName,
    productId: null,
    productName: null,
    status: "ambiguous",
    candidates: matched,
  };
}

/**
 * Main local parser strategy.
 * Splits text by newlines and parses each line.
 */
export function parseOrderTextLocal(
  text: string,
  products: SimpleProduct[]
): ParsedLine[] {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const results: ParsedLine[] = [];

  for (const line of lines) {
    const parsed = parseLine(line, products);
    if (parsed) results.push(parsed);
  }

  return results;
}

/**
 * Placeholder for future AI strategy.
 * Signature intentionally matches parseOrderTextLocal.
 */
export async function parseOrderTextAI(
  _text: string,
  _products: SimpleProduct[]
): Promise<ParsedLine[]> {
  throw new Error("AI parser not yet implemented");
}
