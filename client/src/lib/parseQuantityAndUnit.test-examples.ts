/**
 * Verification examples for parseQuantityAndUnit.
 * Run with: npx tsx client/src/lib/parseQuantityAndUnit.test-examples.ts
 *
 * Expected: all assertions pass.
 */

import { parseQuantityAndUnit } from "./parseQuantityAndUnit";

const EXAMPLES: Array<{ input: string; expected: { q: number; u: string; product: string } }> = [
  { input: "800grs de apio", expected: { q: 0.8, u: "KG", product: "apio" } },
  { input: "800gr de puerro", expected: { q: 0.8, u: "KG", product: "puerro" } },
  { input: "600gra de verdeo", expected: { q: 0.6, u: "KG", product: "verdeo" } },
  { input: "1/2 atado perejil", expected: { q: 0.5, u: "ATADO", product: "perejil" } },
  { input: "1/2 cajón de manzana roja", expected: { q: 0.5, u: "CAJON", product: "manzana roja" } },
  { input: "2kg morron rojo", expected: { q: 2, u: "KG", product: "morron rojo" } },
  { input: "4kg repollo blanco", expected: { q: 4, u: "KG", product: "repollo blanco" } },
  { input: "18kg de tomate", expected: { q: 18, u: "KG", product: "tomate" } },
  { input: "2 cabezas de ajo", expected: { q: 2, u: "UNIDAD", product: "ajo" } },
  { input: "1 bolsa de anco", expected: { q: 1, u: "BOLSA", product: "anco" } },
  { input: "2 cajones de naranja para jugo elegida", expected: { q: 2, u: "CAJON", product: "naranja para jugo elegida" } },
  { input: "1 AT cilantro", expected: { q: 1, u: "ATADO", product: "cilantro" } },
  { input: "1 at cilantro", expected: { q: 1, u: "ATADO", product: "cilantro" } },
];

function run() {
  let ok = 0;
  let fail = 0;
  for (const { input, expected } of EXAMPLES) {
    const r = parseQuantityAndUnit(input);
    const match = r.quantity === expected.q && r.unit === expected.u && r.rawProductName === expected.product;
    if (match) {
      ok++;
      console.log(`✓ "${input}" → ${r.quantity} ${r.unit} "${r.rawProductName}"`);
    } else {
      fail++;
      console.error(`✗ "${input}" → got ${r.quantity} ${r.unit} "${r.rawProductName}", expected ${expected.q} ${expected.u} "${expected.product}"`);
    }
  }
  console.log(`\n${ok} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
