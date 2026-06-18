# Auditoría C2 — Ledger `stock_movements` mezcla unidades (diagnóstico, solo lectura, 2026-06-18)

> **Solo lectura. No se tocó nada.** Mapa de quién escribe en `stock_movements` y en qué unidad, dónde está la inconsistencia, qué la lee hoy, y el alcance/riesgo de unificar todo a **kg base**.
> **Conclusión adelantada:** hay **un solo** lugar que loguea mal — el descuento OUT al **aprobar pedido en flujo normal** (loguea la cantidad de **bultos** de la unidad de pedido, no los kg base). Todos los demás (compras, rinde, prorrateo, merma, ajustes, reconciliación, peso galpón) loguean en **kg base**. El dato para convertir (`wpuForBase`) **ya está disponible** en ese punto. **Ningún reporte/dashboard lee los OUT normales de pedido**, así que arreglarlos no descuadra nada. El insert es **puro registro de auditoría** (el stock real se descuenta aparte de `product_units`), por lo que tocarlo **no puede afectar stock ni costos**.

---

## 1. Mapa completo — quién ESCRIBE en `stock_movements` y en qué unidad

| # | Lugar (storage.ts) | Función | Tipo | quantity en… | Estado |
|---|---|---|---|---|---|
| 1 | `:405` | `createPurchase` | `in` | **kg base** (el front convííte; comentario `:322` "ya vienen en unidad base") | ✅ bien |
| 2 | `:1007` | `updatePurchase` (regenera) | `in` | **kg base** (`item.quantity` base) | ✅ bien |
| 3 | `:2246` rama `else` (`:2223-2228`) | `approveOrder` flujo normal | `out` | **BULTOS** (`outQty = item.quantity`, unidad de PEDIDO) | ❌ **MAL — única inconsistencia** |
| 4 | `:2201` | `approveOrder` rama **rinde** | `in` | **kg base** (`excessQty`) | ✅ bien |
| 5 | `:2246` ramas **rinde/prorate** (`:2195/2222`) | `approveOrder` | `out` | **kg base** (`outQty = deductFromStock`) | ✅ bien |
| 6 | `:2677` | `adjustProductUnitStock` | `in`/`out` | **kg base** (`adjustment` sobre la fila base) | ✅ bien |
| 7 | `:2759` | `revertStockAdjustment` (auditoría) | `in`/`out` | **kg base** | ✅ bien |
| 8 | `:2782` | `resetAllStock` | `out` | **kg base** (`stockQty` de fila base) | ✅ bien |
| 9 | `:3075` | `galponSetPurchaseItemWeight` (auditoría peso) | `in`/`out` | **kg base** (`deltaQty` en kg) | ✅ bien |
| 10 | `:3356` / `:3386` | `reconcileInventory` (merma/rinde por conteo) | `in`/`out` | **kg base** (`diff`/`currentQty` de fila base) | ✅ bien |

→ **10 puntos de escritura, 1 solo mal (#3).** No hay otros casos ocultos: merma, rinde, ajustes, reconciliación y peso del galpón **ya van en kg base**.

## 2. Dónde está la inconsistencia, exactamente

`approveOrder`, rama **normal** (stock suficiente, sin decisión rinde/prorate), `storage.ts:2223-2228`:

```ts
} else {
  effectiveCostStr = baseCostStr;
  movementCostStr  = baseCostStr;      // costo por unidad de PEDIDO
  deductFromStock  = deductQty;        // kg base → así se descuenta el stock (bien)
  outQty           = item.quantity;    // ❌ unidad de PEDIDO (bultos) → así se loguea el movimiento (mal)
}
```

- El **stock real** baja por `deductFromStock = deductQty` = `qty × wpuForBase` → **kg base, correcto** (líneas `:2258-2269`).
- El **movimiento** loguea `outQty = item.quantity` = los **bultos** de la unidad de pedido.
- Resultado: "1 BOLSA" → el stock baja 17 kg pero el movimiento queda `quantity=1`. El `unitCost` que lo acompaña (`movementCostStr`) es por bulto, así que `quantity×unitCost` = valor correcto de la línea, pero **la cantidad está en la unidad equivocada**.

Las ramas **rinde** y **prorate** NO tienen el problema: ahí `outQty = deductFromStock` (base) y `movementCostStr` ya se divide por `wpuForBase` (`:2193/2220`). Solo el flujo normal quedó en unidad de pedido.

**Verificado en datos reales (read-only, hoy):**
- OUT de pedido por envase (CAJON/BOLSA/BANDEJA, sin Rinde): **1925 movimientos, 1800 (93%) loguean bultos** (`sm.quantity = order_item.quantity`).
- Ejemplos: ZUCCINI CAJON oi=2 → sm=2; ZAPALLO ANCO BOLSA oi=10 → sm=10; TOMATE PERITA CAJON oi=1 → sm=1.
- (Los ~125 que difieren son los que pasaron por rinde/prorate o cambio de unidad → ya en base.)
- Inventario total: `purchase in=1848` · `order out=7920` · `order in=96` (rinde) · `adjustment in=133/out=309`.

## 3. El fix conceptual (de acá en adelante)

**Un solo cambio, en la rama `else` de `approveOrder` (`:2223-2228`):** convertir la cantidad (y el costo) a unidad base **antes** de insertar, igual que ya hacen rinde/prorate.

```ts
} else {
  effectiveCostStr = baseCostStr;                                   // por unidad de pedido (order_items + margen) — NO cambia
  movementCostStr  = (parseFloat(baseCostStr) / wpuForBase).toFixed(4); // ← por unidad base
  deductFromStock  = deductQty;                                     // ya estaba base
  outQty           = deductQty.toFixed(4);                          // ← kg base (antes: item.quantity)
}
```

- **`wpuForBase` ya está disponible** en ese scope (se calculó en `:2113/2146` para el descuento). **No hay ningún lugar donde falte el dato** al momento de loguear: el mismo número que ya se usa para bajar el stock sirve para loguear el movimiento.
- Hay que cambiar **quantity y unitCost juntos** para conservar `quantity×unitCost = valor de la línea`.
- **No tocar** `effectiveCostStr` (sigue por unidad de pedido → `order_items.cost_per_unit` y margen quedan igual). **No tocar** las ramas rinde/prorate (ya están bien).
- Alcance: **~6 líneas en una sola función.** El resto de los 9 puntos de escritura no se tocan.

## 4. Los movimientos históricos — ¿se pueden arreglar?

**Análisis honesto: NO conviene; dejarlos y arrancar limpio.**

- **Path-dependence (la misma trampa que los costos).** Para convertir un OUT viejo de bultos→kg habría que saber el `wpuForBase` **que se usó en el momento exacto de aprobar** ese pedido. Pero `wpuForBase` sale del `weightPerPackage` del `purchase_item` más reciente de ese envase **a esa fecha**, y ese valor cambió con el tiempo (se editaron pesos del galpón, entraron compras nuevas). Reconstruirlo hoy daría un número **aproximado, no el real**.
- **El stock ya está bien.** El descuento de stock siempre fue correcto (`deductFromStock` en kg). Lo único mal es el **registro** del movimiento. O sea: corregir históricos = reescribir auditoría con cifras reconstruidas imperfectas, para una tabla que **nada lee para plata/stock**.
- **Riesgo de "precisión falsa".** Backfillear con el `wpu` actual maquillaría los movimientos viejos como si fueran exactos, cuando no lo son → peor que dejarlos visiblemente "viejos".

→ **Recomendación: (a) dejar los históricos como están y arreglar solo de acá en adelante.** El ledger viejo queda "sucio" pero inerte; el nuevo es limpio y consistente. (Opción (b) backfill = reconstrucción best-effort con datos imperfectos, mismo problema que vimos con los costos — no vale la pena.)

## 5. ¿Algo LEE el ledger hoy y se vería afectado?

Mapa de **lectores** y si los toca el cambio:

| Lector | Filtro | ¿Lee los OUT normales de pedido? | ¿Afectado? |
|---|---|---|---|
| `getStockMovements` (`:1037`) | — | — | **CÓDIGO MUERTO** (sin callers) |
| `/api/debug/product-cost` (routes `:150`) | dump crudo por nombre | sí (raw) | solo debug; no calcula plata |
| `/api/dashboard/rinde-detail` (`:174`) | `notes ILIKE '%Rinde%'` | **no** | ✅ no |
| `/api/dashboard/merma-detail` (`:213`) | `notes ILIKE '%Merma%'` | **no** | ✅ no |
| `getAdjustmentMovements` → `/api/stock-movements` (`:459`) | `reference_type='adjustment'` | **no** | ✅ no |
| `getStockAdjustments` → dashboard ajustes + galpón (`:477/:1873`) | `adjustment` OR `order+Rinde` | **no** | ✅ no |
| KPIs merma/rinde del período (`:4606`) | `notes ILIKE '%Merma%'/'%Rinde%'` | **no** | ✅ no |
| `syncProductUnits` chequeo de historial (`:3499`) | `COUNT(*) > 0` | solo existencia | ✅ no |

→ **Ningún reporte, dashboard o cálculo lee la `quantity` de los OUT normales de pedido.** El "botón de costos" que usaba el ledger ya se eliminó. **No hay ningún consumidor "compensando" el error** que se vaya a descuadrar. Arreglar el logging no rompe ni arregla ningún número visible — solo deja la auditoría coherente para el futuro.

## 6. Riesgo del refactor

**Muy bajo / acotado.**

- **El insert es puro registro.** El stock real se descuenta en `:2258-2269` desde `product_units`/`products.currentStock` con `deductFromStock` (kg) — **independiente** del `insert` en `stock_movements`. El costo (WMA) tampoco usa el ledger. Cambiar `quantity`/`unitCost` del movimiento **no puede mover el stock ni el costo**.
- **Cambio localizado:** ~6 líneas en una rama de `approveOrder`. No toca las otras 9 escrituras ni ningún lector.
- **Único cuidado:** cambiar `outQty` **y** `movementCostStr` juntos (conservar `qty×costo = valor`), y **no** tocar `effectiveCostStr` (margen/`order_items` quedan igual) ni las ramas rinde/prorate.
- **Verificación natural (cuando se aplique):** aprobar un pedido por envase y confirmar que (1) el stock baja lo mismo que antes, (2) el nuevo movimiento queda en kg, (3) `order_items.cost_per_unit`/margen idénticos, (4) los dashboards de rinde/merma/ajustes sin cambios.

## 7. Recomendación

- **De acá en adelante:** aplicar el fix de la §3 (rama normal de `approveOrder` → loguear `deductQty` en kg y `baseCostStr/wpuForBase` como unitCost). Una función, ~6 líneas, sin tocar el resto.
- **Históricos:** **dejarlos** (opción (a)). Son auditoría inerte; reconstruirlos cae en path-dependence con datos imperfectos.
- **Bonus opcional (no requerido):** borrar `getStockMovements` (`:1037`), que es código muerto.

**Solo lectura. Nada tocado.**

---

## 8. ✅ C2 RESUELTO (2026-06-18, commit `32d4e9a`)

- **Fix (`approveOrder` rama normal, `storage.ts:2218-2227`):** el movimiento OUT se loguea en **kg base** igual que rinde/prorate. `outQty = deductQty.toFixed(4)` (antes `item.quantity` en bultos) y `movementCostStr = baseCostStr / wpuForBase` (costo por kg). `wpuForBase` ya estaba disponible (mismo número del descuento de stock). **`effectiveCostStr` NO cambió** → order_items/margen idénticos. Ramas rinde/prorate intactas.
- **Históricos:** se dejaron como están (opción a). Reconstruir = path-dependence / precisión falsa, y nada los lee.
- **Limpieza:** borrado `getStockMovements` (código muerto sin callers) + `type StockMovement` colgado del import.

**Verificado (apply+restore en pedido real por envase VA-000201):** stock baja igual (prod81 BOLSA×3 → 45 kg; prod74 KG → 1.5 kg); movimiento nuevo en kg con **valor conservado** (45×657.88 = 29.604,47 = 3×9.868,16 por BOLSA); order_items/margen idénticos (el cambio 7999→9868 es el refresh de costo que `approveOrder` ya hacía, no el fix); dashboards merma/rinde/KPIs sin cambio (notes "Pedido…", no los leen); restore exacto (estado idéntico al inicial). Build ✓, sin referencias colgadas.
