// Lector de extractos del Banco Galicia (paso 3 + 5 del lector de Galicia).
// Parser (CSV ';'/utf-8-sig y XLSX) + clasificador por reglas. NO escribe a la base
// (eso es el paso 6); solo parsea y clasifica.
import { normHeader, parseXlsxDate, parseNumAr, readSheet } from "./xlsx-helpers";

export type GaliciaParsedMovement = {
  id: string;                 // clave de dedup
  fecha: string;              // YYYY-MM-DD
  descripcion: string;
  debito: number | null;      // egreso (salió plata)
  credito: number | null;     // ingreso (entró plata)
  grupoConcepto: string;
  concepto: string;
  comprobante: string;
  leyendas: string;           // Leyendas Adicionales 1-4 concatenadas
  saldo: number | null;
  tipoMovimiento: string;
  monto: number;              // |debito| o |credito|
  direccion: "egreso" | "ingreso";
};

/** Quita acentos y pasa a mayúsculas (para matchear conceptos/leyendas). */
function up(s: string): string {
  return String(s ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

/**
 * Parsea el buffer de un extracto Galicia (CSV ';'/utf-8-sig o XLSX) y devuelve los
 * movimientos normalizados. Mapea columnas por nombre (tolerante a variaciones).
 */
export function parseGaliciaExtracto(buffer: Buffer): GaliciaParsedMovement[] {
  const { headers, dataRows } = readSheet(buffer, { csvDelimiter: ";" });
  const H = headers.map(normHeader);

  // Índice de columna por nombre: prefiere match EXACTO sobre substring (evita que
  // "CONCEPTO" matchee "GRUPO DE CONCEPTOS"). Recorre los needles en orden.
  const col = (...needles: string[]): number => {
    for (const needle of needles) {
      const n = normHeader(needle);
      const exact = H.findIndex(h => h === n);
      if (exact >= 0) return exact;
    }
    for (const needle of needles) {
      const n = normHeader(needle);
      const i = H.findIndex(h => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iFecha   = col("FECHA");
  const iDesc    = col("DESCRIPCION");
  const iDebito  = col("DEBITOS", "DEBITO");
  const iCredito = col("CREDITOS", "CREDITO");
  const iGrupo   = col("GRUPO DE CONCEPTOS", "GRUPO");
  const iConcepto= col("CONCEPTO");
  const iComprob = col("NUMERO DE COMPROBANTE", "COMPROBANTE");
  const iSaldo   = col("SALDO");
  const iTipoMov = col("TIPO DE MOVIMIENTO", "TIPO");
  // Leyendas Adicionales 1-4 (todas las columnas que matcheen)
  const iLeyendas = H.map((h, i) => h.includes(normHeader("LEYENDAS ADICIONALES")) ? i : -1).filter(i => i >= 0);

  const out: GaliciaParsedMovement[] = [];
  for (const row of dataRows) {
    const get = (i: number) => (i >= 0 ? String(row[i] ?? "").trim() : "");
    const fecha = parseXlsxDate(get(iFecha));
    if (!fecha) continue;                              // fila sin fecha = no es movimiento

    const debRaw = get(iDebito);
    const credRaw = get(iCredito);
    const debito = debRaw ? parseNumAr(debRaw) : 0;
    const credito = credRaw ? parseNumAr(credRaw) : 0;
    if (debito === 0 && credito === 0) continue;       // fila sin monto = ignorar

    const esEgreso = debito > 0;
    const monto = esEgreso ? Math.abs(debito) : Math.abs(credito);
    const comprobante = get(iComprob);
    const saldo = iSaldo >= 0 && get(iSaldo) ? parseNumAr(get(iSaldo)) : null;
    const leyendas = iLeyendas.map(i => get(i)).filter(Boolean).join(" | ");

    // Clave de dedup: fecha + comprobante + monto + saldo (el saldo es el running balance,
    // casi único por línea; el comprobante puede repetirse/venir vacío).
    const id = `galicia:${fecha}:${comprobante || "-"}:${monto.toFixed(2)}:${saldo ?? "x"}`;

    out.push({
      id, fecha,
      descripcion: get(iDesc),
      debito: esEgreso ? Math.abs(debito) : null,
      credito: esEgreso ? null : Math.abs(credito),
      grupoConcepto: get(iGrupo),
      concepto: get(iConcepto),
      comprobante,
      leyendas,
      saldo,
      tipoMovimiento: get(iTipoMov),
      monto,
      direccion: esEgreso ? "egreso" : "ingreso",
    });
  }
  return out;
}

// ─── Clasificador (paso 5) ────────────────────────────────────────────────────
export type GaliciaRuleLite = { matchConcepto: string; matchLeyenda: string | null; categoryName: string; prioridad: number };

/**
 * Aplica las reglas a un movimiento y devuelve la categoría sugerida (o null si
 * ninguna matchea). Evalúa por prioridad descendente: la primera que matchee gana.
 * Una regla matchea si su matchConcepto está en el concepto Y (si tiene matchLeyenda)
 * está en las leyendas.
 */
export function classifyGaliciaMovement(
  mov: { concepto: string; leyendas: string },
  rules: GaliciaRuleLite[],
): string | null {
  const concepto = up(mov.concepto);
  const leyendas = up(mov.leyendas);
  const sorted = [...rules].sort((a, b) => b.prioridad - a.prioridad);
  for (const r of sorted) {
    const mc = up(r.matchConcepto);
    if (mc && !concepto.includes(mc)) continue;
    if (r.matchLeyenda) {
      const ml = up(r.matchLeyenda);
      if (!leyendas.includes(ml)) continue;
    }
    return r.categoryName;
  }
  return null;
}

// ─── Seed de reglas (paso 4) ──────────────────────────────────────────────────
// Reglas con leyenda (más específicas) → prioridad 10; solo concepto → prioridad 5.
export const GALICIA_SEED_RULES: GaliciaRuleLite[] = [
  // Seguros (débito automático de servicio a aseguradoras)
  { matchConcepto: "DEB. AUTOM. DE SERV", matchLeyenda: "RIO URUGUAY",       categoryName: "Seguros",            prioridad: 10 },
  { matchConcepto: "DEB. AUTOM. DE SERV", matchLeyenda: "MERCANTIL ANDINA",  categoryName: "Seguros",            prioridad: 10 },
  // Alquiler
  { matchConcepto: "TRF INMED PROVEED",   matchLeyenda: "STEFAN HERMANSSON",  categoryName: "Alquiler",           prioridad: 10 },
  // Retiro de socio (transferencias a Joaquín / Federico) → categoría "Retiro" (ya existe). NO es gasto.
  { matchConcepto: "TRF INMED PROVEED",   matchLeyenda: "FEDERICO",           categoryName: "Retiro",             prioridad: 10 },
  { matchConcepto: "TRF INMED PROVEED",   matchLeyenda: "JOAQUIN",            categoryName: "Retiro",             prioridad: 10 },
  // Comisiones Galicia (separadas de "Comisiones" de MP)
  { matchConcepto: "COMISION",            matchLeyenda: null,                 categoryName: "Comisiones Galicia", prioridad: 5 },
  { matchConcepto: "COM. DEPOSITO",       matchLeyenda: null,                 categoryName: "Comisiones Galicia", prioridad: 5 },
  // Impuestos bancarios
  { matchConcepto: "IVA",                 matchLeyenda: null,                 categoryName: "Impuestos bancarios", prioridad: 5 },
  { matchConcepto: "LEY 25413",           matchLeyenda: null,                 categoryName: "Impuestos bancarios", prioridad: 5 },
  { matchConcepto: "ING. BRUTOS",         matchLeyenda: null,                 categoryName: "Impuestos bancarios", prioridad: 5 },
  { matchConcepto: "INGRESOS BRUTOS",     matchLeyenda: null,                 categoryName: "Impuestos bancarios", prioridad: 5 },
  { matchConcepto: "SELLOS",              matchLeyenda: null,                 categoryName: "Impuestos bancarios", prioridad: 5 },
  { matchConcepto: "PERCEP",              matchLeyenda: null,                 categoryName: "Impuestos bancarios", prioridad: 5 },
  // Intereses
  { matchConcepto: "INTERES",             matchLeyenda: null,                 categoryName: "Intereses",          prioridad: 5 },
  // Transferencias internas (Galicia↔MP) — ni ingreso ni gasto
  { matchConcepto: "DEBITO DEBIN",        matchLeyenda: null,                 categoryName: "Banco propio",       prioridad: 5 },
  { matchConcepto: "TRANSFERENCIA DE CUENTA PROPIA", matchLeyenda: null,      categoryName: "Banco propio",       prioridad: 5 },
  { matchConcepto: "CTAS PROPIAS",        matchLeyenda: null,                 categoryName: "Banco propio",       prioridad: 5 },
  // Préstamo recibido (no es ingreso del negocio)
  { matchConcepto: "CREDITO PRESTAMO",    matchLeyenda: null,                 categoryName: "Préstamo",           prioridad: 5 },
  // Cheques acreditados / cobros ya contados (no suman a la ganancia)
  { matchConcepto: "G.DE CHEQUE",         matchLeyenda: null,                 categoryName: "Cobro cliente ya contabilizado", prioridad: 5 },
  { matchConcepto: "G.DE ECHEQ",          matchLeyenda: null,                 categoryName: "Cobro cliente ya contabilizado", prioridad: 5 },
  { matchConcepto: "CREDITO DESCUENTO DOCUMENTO", matchLeyenda: null,         categoryName: "Cobro ya contado",   prioridad: 5 },
  // Cobros de cliente vía cash/SNP (no suman: el cobro ya se cuenta en ventas)
  { matchConcepto: "TRANSFERENCIAS CASH PROVEEDORES", matchLeyenda: null,     categoryName: "Cobro de cliente",   prioridad: 5 },
  { matchConcepto: "SNP PAGO A PROVEEDORES", matchLeyenda: null,              categoryName: "Cobro de cliente",   prioridad: 5 },
  // Pago a proveedor (genérico, prioridad baja: las reglas con leyenda ganan)
  { matchConcepto: "ECHEQ",               matchLeyenda: null,                 categoryName: "Pago a proveedor",   prioridad: 3 },
  { matchConcepto: "TRF INMED PROVEED",   matchLeyenda: null,                 categoryName: "Pago a proveedor",   prioridad: 3 },
];

// ─── Tratamiento de cobros de cliente (paso 6) ────────────────────────────────
// Deriva el tratamiento de un movimiento según su categoría sugerida:
//  - "Cobro cliente ya contabilizado" (cheques G.DE CHEQUE) → yaContabilizado: NO suma
//    a la ganancia, NO toca cuenta corriente (ya se registró al recibir el cheque).
//  - "Cobro de cliente" (transferencias entrantes) → asignacion 'pendiente': es un cobro
//    nuevo a asignar a cliente/factura en el paso siguiente.
export function tratamientoCobro(categoryName: string | null): {
  yaContabilizado: boolean;
  asignacionCc: "pendiente" | null;
} {
  if (categoryName === "Cobro cliente ya contabilizado") return { yaContabilizado: true, asignacionCc: null };
  if (categoryName === "Cobro de cliente") return { yaContabilizado: false, asignacionCc: "pendiente" };
  return { yaContabilizado: false, asignacionCc: null };
}

// Categorías nuevas que el lector de Galicia necesita en bank_categories (paso 6).
// "Retiro", "Banco propio", "Pago a proveedor", "Cobro de cliente" YA existen (de MP).
export const GALICIA_NEW_CATEGORIES = [
  "Seguros", "Alquiler", "Comisiones Galicia", "Impuestos bancarios",
  "Intereses", "Préstamo", "Cobro cliente ya contabilizado",
];
