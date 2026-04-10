/**
 * Hardcoded historical stats for Jan/Feb/Mar 2026.
 * These values come from the Excel file attached_assets/info 2026.xlsx.
 * The DB has no real orders for these months — only synthetic PV-HIST orders
 * used to build Cuentas Corrientes balances.
 */

export interface HistoricalSemana {
  label: string;
  start: number;
  end: number;
  total: number;
}

export interface HistoricalMonthStats {
  ventas: number;
  ganancia_bruta: number;
  promedioDia: number;
  promedioGanancia: number;
  diasTrabajados: number;
  semanas: HistoricalSemana[];
}

const STATS: Record<string, HistoricalMonthStats> = {
  "2026-1": {
    ventas: 24913229.78,
    ganancia_bruta: 8924138.39,
    promedioDia: 1083183.9,
    promedioGanancia: 371839.1,
    diasTrabajados: 23,
    semanas: [
      { label: "1° Semana", start: 5,  end: 10, total: 8946212.5  },
      { label: "2° Semana", start: 12, end: 17, total: 7453574.15 },
      { label: "3° Semana", start: 19, end: 24, total: 3796089.5  },
      { label: "4° Semana", start: 26, end: 31, total: 4717353.63 },
    ],
  },
  "2026-2": {
    ventas: 56305007.86,
    ganancia_bruta: 19911264.47,
    promedioDia: 2963421.47,
    promedioGanancia: 1047961.29,
    diasTrabajados: 19,
    semanas: [
      { label: "1° Semana", start: 2,  end: 6,  total: 10328404.05 },
      { label: "2° Semana", start: 9,  end: 13, total: 14378852.96 },
      { label: "3° Semana", start: 16, end: 20, total: 12476758.18 },
      { label: "4° Semana", start: 23, end: 28, total: 19120992.68 },
    ],
  },
  "2026-3": {
    ventas: 73759478.38,
    ganancia_bruta: 25617880.5,
    promedioDia: 3512356.11,
    promedioGanancia: 1219899.07,
    diasTrabajados: 21,
    semanas: [
      { label: "1° Semana", start: 3,  end: 7,  total: 16622254.48 },
      { label: "2° Semana", start: 10, end: 14, total: 20237579.03 },
      { label: "3° Semana", start: 17, end: 21, total: 16262143.03 },
      { label: "4° Semana", start: 24, end: 28, total: 15779133.35 },
      { label: "5° Semana", start: 31, end: 31, total: 4858368.5  },
    ],
  },
};

/** Returns hardcoded stats for a historical month, or null if not found. */
export function getHistoricalMonthStats(month: number, year: number): HistoricalMonthStats | null {
  return STATS[`${year}-${month}`] ?? null;
}

/**
 * Returns { month, year } if [from, to) maps exactly to a full historical month,
 * or null otherwise.
 * Expects from/to in YYYY-MM-DD or ISO timestamp format.
 */
export function isHistoricalMonth(from: string, to: string): { month: number; year: number } | null {
  const f = from.slice(0, 10); // YYYY-MM-DD
  const t = to.slice(0, 10);

  const [fy, fm] = f.split("-").map(Number);
  const [ty, tm] = t.split("-").map(Number);

  // to must be the first day of the following month
  let expectedToYear = fy;
  let expectedToMonth = fm + 1;
  if (expectedToMonth > 12) { expectedToMonth = 1; expectedToYear++; }

  const fDay = parseInt(f.split("-")[2]);
  const tDay = parseInt(t.split("-")[2]);

  if (
    fDay === 1 &&
    ty === expectedToYear &&
    tm === expectedToMonth &&
    tDay === 1
  ) {
    const key = `${fy}-${fm}`;
    if (STATS[key]) return { month: fm, year: fy };
  }

  return null;
}
