# Auditoría Fase 2 — Nudo Costo + Stock (C1/C2/C3/M4)

> **Solo lectura. No se modificó código.** Datos reales de la base al momento del análisis.
> Conclusión adelantada: los tres críticos son **el mismo nudo con tres caras**, y la decisión
> de fondo es una sola: **adoptar un único modelo de costo (FIFO) y neutralizar el botón
> "Recalcular Costos"**. Detalle y números abajo. **No se decide ni se toca todavía.**

---

## 1. Los tres modelos de costo, lado a lado (productos reales)

| Producto | Almacenado | FIFO (purchase_items) | WMA-mov (botón) | stock real (stock_qty) | stock del ledger (Σ movs) |
|---|---|---|---|---|---|
| BANANA ECUADOR | $1.647 | $1.647 | $1.668 | 185 | **1.363** |
| LIMON | $571 | $571 | **$736** (+29%) | 44 | **577** |
| MANZANA ROJA ELEGIDA | $2.941 | $2.941 | $2.917 | 169,5 | **898** |
| NARANJA JUGO | $867 | $867 | $835 | 356 | **4.422** |
| PAPA LAVADA | $1.723 | $1.724 | **$1.382** (−20%) | 260 | **8.995** |
| TOMATE PERITA | $1.719 | **$1.600** | **$1.962** (+23%) | 22 | **511** |

**Lecturas:**
- **Almacenado ≈ FIFO** en casi todos → hoy el sistema ya usa FIFO de hecho (lo setea cada compra/edición). La excepción (tomate $1.719 vs FIFO $1.600) es un valor viejo que quedó de una restauración manual; el FIFO real es $1.600.
- **WMA difiere del FIFO hasta ±29%** (papa −20%, tomate +23%, limón +29%). **C1 confirmado: divergen, y feo.**
- **El "stock del ledger" (suma de stock_movements) NO tiene nada que ver con el stock real**: papa 8.995 vs 260 (34×), banana 1.363 vs 185 (7×). Esto es **C2**, y explica por qué el WMA da cualquier cosa.

## 2. Qué representa cada modelo (en criollo) y cuál tiene más sentido

- **WMA (promedio móvil ponderado, el del botón):** "promedio histórico de todo lo que entró, que nunca olvida". Cada compra mueve el promedio un poquito y queda para siempre. Problema para una verdulería: arrastra precios viejos eternamente (un pico de hace 3 meses sigue pesando), y **acá además lee un ledger roto** (ver C2) → da valores sin sentido.
- **FIFO-cubre-stock (el actual de crear/editar compra):** "lo que pagué por la mercadería que tengo HOY en la góndola". Recorre las compras más recientes hasta cubrir el stock actual y promedia esas. Para una verdulería que **rota rápido** (lo que tenés es casi siempre de las últimas compras), esto = el precio reciente = **lo más cercano al costo de reposición real**.
- **`_recalcProductSummary` (ponderado de product_units):** no es un modelo propio; solo propaga a `products.average_cost` el `avg_cost` que ya tenga la fila base. Hereda el modelo que haya corrido último.

**Mi análisis (vos decidís):** para este negocio (varios proveedores, precios cambiantes, stock que rota rápido) **el FIFO-cubre-stock es el que mejor refleja el costo real.** El WMA tiene sentido conceptual en industrias de stock estable y trazable, pero acá (a) lag de precios viejos y (b) depende de un ledger inconsistente → no sirve. Además el sistema **ya está parado en FIFO**; el WMA solo aparece si alguien aprieta el botón.

## 3. C2 ↔ C3: ¿es el mismo problema? — con números

**Magnitud del desfasaje (C2):** de **249 productos, 96 (39%)** tienen el ledger (Σ stock_movements) distinto del stock real (stock_qty). **Exceso total del ledger: ~42.985 kg** por encima de la realidad.

**La causa RAÍZ de C2 NO es el floor bug — es que los movimientos mezclan unidades:**
- Las **compras** loguean el movimiento en **kg base** (ej. papa: 49 movs, 9.967 kg).
- Las **ventas por envase** loguean la **cantidad de bultos, NO los kg**. Verificado: mov `9843` = `1 BOLSA` quedó como `quantity = 1` cuando el stock real bajó **17 kg**. Papa se vendió en **476 BOLSAS** pero el ledger sumó ~649 "unidades" (mezcla de bolsas + kg).
- Resultado: el ledger suma **kg (compras) con bultos (ventas)** → es **inservible para reconciliar o para el WMA**.

**El floor bug (C3) es OTRA causa, separada:** infla el `stock_qty` real (no el ledger) cuando se edita una compra con `stock_actual < cantidad_línea`. Contribuye a que algunos `stock_qty` queden mal, pero **no es el motor del desfasaje del ledger** (ese es la mezcla de unidades).

**Entonces, ¿arreglando "la raíz" se resuelven los tres juntos?** Parcialmente, y por una vía mejor que "arreglar el ledger":
- **C1 se resuelve adoptando FIFO y retirando el WMA.** El FIFO **no usa el ledger** (usa `purchase_items` + `stock_qty`), así que es inmune a C2.
- **C2 (ledger roto) deja de importar para el costo** apenas se retire el botón WMA. Como *log de auditoría* sigue siendo imperfecto (se podría arreglar logueando kg base en las salidas), pero no es urgente.
- **C3 (floor bug) sí conviene arreglarlo** porque el FIFO depende de `stock_qty`: si el floor bug infla el stock, el FIFO cubre más compras de la cuenta y el costo se corre un poco. Es independiente del ledger, pero impacta el costo por esa vía.

→ **No es un solo arreglo que resuelve todo, pero sí una sola DECISIÓN central (FIFO + matar el WMA) que desactiva C1 y C2, más un fix acotado de C3.**

## 4. ¿Qué pasa si aprieto "Recalcular Costos" hoy? (simulado, sin ejecutar)

**Es peligroso.** De **53 productos con stock, le cambiaría el costo a 50 (94%)**; **23 con cambios ≥10%**:

| Producto | Actual | Con botón | Δ |
|---|---|---|---|
| CILANTRO | $500 | $1.650 | **+230%** |
| ZAPALLITO REDONDO | $1.071 | $1.997 | +86% |
| PALTA HASS CHILE | $1.500 | $670 | **−55%** |
| RUCULA | $472 | $248 | −48% |
| CEBOLLA DE VERDEO | $2.500 | $1.432 | −43% |
| MANZANA GALA | $1.529 | $2.188 | +43% |
| LIMON | $571 | $736 | +29% |
| TOMATE CHERRY | $5.000 | $3.704 | −26% |
| …y 15 más (±10–35%) | | | |

**Riesgo operativo:** el botón está en la pantalla de Stock detrás de un simple confirm. **Cualquiera podría apretarlo sin querer y corromper el costo de casi todo el catálogo** (y con eso, los márgenes de todos los pedidos nuevos). Es una bomba.

## 5. C3 — el floor bug para el ADMIN: escenario concreto

Se dispara cuando el admin **edita una compra vieja cuya mercadería ya se vendió** (stock actual < cantidad de esa línea):
1. Compra del 12/06: 3 cajones de banana = 51 kg. Con el tiempo se vende casi todo → stock actual de banana ~11 kg.
2. El admin entra a esa compra y corrige algo (cantidad, peso, producto) → `updatePurchase`.
3. **PHASE 1 (revertir):** `stock − 51 = 11 − 51 = −40` → **floorea a 0**.
4. **PHASE 2 (reaplicar):** `0 + (nueva cantidad, ej. 48) = 48`.
5. **Resultado: el stock de banana salta de 11 a 48** (debería haber quedado ~8). Probado en vivo en el bloque anterior (10,9 → 48).

El bug vive en la PHASE 1 de `updatePurchase` (`storage.ts`), que floorea en 0 en vez de permitir el negativo intermedio. El método targeted del galpón (`galponSetPurchaseItemWeight`) lo esquiva aplicando el delta exacto; el admin sigue expuesto.

## 6. M4 — overrides de costo "Manual": menos grave de lo temido

| Métrica | Valor |
|---|---|
| order_items con override | **2.184** |
| pedidos con override | **413** |
| redundantes (override == costo, restos del bug de UI) | **19** |
| genuinos (override ≠ costo) | **2.020** |
| override en 0 (bolsa/rinde/bonificación, legítimos) | **145** |
| **genuinos que están en pedidos BORRADOR** | **0** |

**Lectura clave:** los **2.020 overrides genuinos están TODOS en pedidos APROBADOS** (0 en borradores). Son costos históricos **congelados de pedidos ya cerrados** → el margen de esos pedidos quedó calculado con ese costo y es su foto histórica (correcto, no se toca lo facturado). **No hay ningún pedido pendiente con un override stale que vaya a ensuciar un margen futuro.** Los 19 redundantes son cosméticos (badge "Manual" de más). → **M4 es de riesgo BAJO**, casi todo histórico.

## 7. Mapa completo: quién toca el costo (los ~8 lugares)

| # | Ubicación | Modelo | Cuándo corre |
|---|---|---|---|
| 1 | `createPurchase` `storage.ts:361,378` (product_units.avg_cost) | WMA incremental | al crear compra (luego lo pisa #6) |
| 2 | `createPurchase` `storage.ts:400,415` (products.average_cost) | WMA incremental | al crear compra (luego lo pisa #6) |
| 3 | `_recalcProductSummary` `storage.ts:626` | Ponderado de product_units | al recalcular resumen (create/update/ajustes) |
| 4 | `_recomputeCostFromStock` `storage.ts:666-667` | **FIFO** | al final de create/update purchase y galpón editar peso |
| 5 | `updatePurchase` `storage.ts:888,905` | WMA incremental | al editar compra (luego lo pisa #4) |
| 6 | `recalcAllStockCosts` `storage.ts:2673` | **WMA replay desde stock_movements** | botón "Recalcular Costos" |
| 7 | `adjustProductUnitStock` `storage.ts:2509,2521` | Manual (lo que tipea el usuario) | dialog "Ajustar Stock" |
| 8 | `_getCostForUnit` `storage.ts:469` | Lectura (no escribe) | al aprobar pedido (cost del order_item) |

**Patrón:** create/update purchase escriben WMA incremental pero **lo sobrescriben con FIFO (#4)** al final → el sistema queda en FIFO. El botón (#6) escribe WMA-desde-ledger y **rompe esa coherencia**. El ajuste manual (#7) y el override de pedido (M4) son entradas humanas.

---

## Resumen ejecutivo para decidir juntos

1. **Modelo único:** adoptar **FIFO-cubre-stock** (el que el sistema ya usa de hecho). Es el que mejor refleja el costo de reposición para una verdulería que rota rápido.
2. **Botón "Recalcular Costos":** hoy es una **bomba** (94% de productos cambiarían, ±230%). Opciones a decidir: (a) eliminarlo, (b) reescribirlo para que corra el FIFO en vez del WMA, (c) dejarlo solo-admin con doble confirmación. **No debería quedar como está.**
3. **Ledger (`stock_movements`):** está roto como fuente de costo (mezcla kg con bultos). Apenas se retire el WMA, deja de impactar el costo. Arreglarlo como *audit log* (loguear kg base en las salidas) es deseable pero de menor prioridad.
4. **C3 (floor bug):** arreglar la PHASE 1 de `updatePurchase` (permitir negativo intermedio, floorear al final) → mantiene `stock_qty` correcto, de lo que depende el FIFO.
5. **M4 (overrides):** riesgo bajo. Solo limpiar los 19 redundantes (cosmético). Los genuinos son históricos y se dejan.

**Nada de esto está decidido ni aplicado.** Es el análisis para elegir el camino.

---

# Fase 3 · Paso 4 — Diagnóstico: costos guardados vs FIFO actual (solo lectura, 2026-06-15)

> Estado de la hoja de ruta: ✅ modelo FIFO adoptado · ✅ botón "Recalcular Costos" eliminado · ✅ C3 floor bug arreglado · ✅ M4 (19 redundantes) limpiados. Este paso **diagnostica** los costos guardados que quedaron desactualizados respecto del FIFO. **No se recalculó ni tocó nada.**

## 8. Magnitud del desfasaje

Repliqué `_recomputeCostFromStock` (el FIFO oficial) **en memoria, sin escribir**, para cada producto con stock, y lo comparé contra el `avg_cost` guardado de la fila base.

- **Productos con stock evaluados: 52**
- **Sin compras que matcheen (FIFO no calcula → preserva costo): 0** → todos tienen FIFO computable.
- **Difieren (> $0,50): 11** (los otros 41 ya están sincronizados).
  - **> 10%: 2** · **5–10%: 3** · **1–5%: 6** · **< 1%: 0**
  - **Desfasaje % mediano: 4,88%** · **Peor caso: +61,7% (PUERRO)**

→ No son "centavos" pero tampoco un descalabro: 9 de 11 están bajo 10%, y el grueso es ~5%. El único grande (PUERRO) es un caso de poco stock + un dato sospechoso (ver abajo).

## 9. Tabla completa de los 11 que difieren (por % desc)

| Producto | Unidad | Stock | Guardado | FIFO | Δ $ | Δ % | Causa |
|---|---|---|---|---|---|---|---|
| PUERRO | KG | 7,3 | $1.361 | $2.200 | +$839 | **+61,7%** | vendido-abajo + dato sospechoso ($230 en OC-00368) |
| PEPINO | KG | 5,3 | $1.750 | $1.571 | −$179 | −10,2% | vendido-abajo |
| TOMATE PERITA | KG | 22 | $1.719 | $1.600 | −$119 | −6,9% | **artefacto de test (bloque 2b)** |
| LECHUGA MORADA | KG | 0,5 | $2.407 | $2.250 | −$157 | −6,5% | vendido-abajo (stock 0,5 → impacto $ nulo) |
| MORRON VERDE | KG | 10 | $2.136 | $2.250 | +$114 | +5,3% | vendido-abajo |
| COLIFLOR | UNIDAD | 10 | $1.367 | $1.300 | −$67 | −4,9% | vendido-abajo |
| PALTA HASS BRASIL | UNIDAD | 62 | $635 | $661 | +$26 | +4,1% | **artefacto de test (Paso 2 C3)** |
| POMELO | KG | 36,5 | $793 | $824 | +$31 | +3,9% | vendido-abajo |
| ALBAHACA | ATADO | 19 | $639 | $625 | −$14 | −2,2% | vendido-abajo |
| KIWI | KG | 7,5 | $6.273 | $6.400 | +$127 | +2,0% | vendido-abajo |
| RUCULA | ATADO | 126 | $472 | $480 | +$8 | +1,7% | vendido-abajo |

## 10. ¿Por qué se desfasaron? (causa raíz)

**Causa dominante (9 de 11): "vendido-abajo" — un desfasaje ESTRUCTURAL, no un bug.**
`_recomputeCostFromStock` solo corre al **crear/editar compra** y al **editar peso del galpón** — NO corre al **vender** (aprobar pedido descuenta stock pero no recalcula el costo). El FIFO es "lo que pagué por el stock que tengo HOY": cuando un producto se vende por debajo de su última compra, la ventana FIFO se achica a los lotes más recientes y el costo FIFO cambia, pero el guardado quedó **congelado en el valor del día de la última compra**.
- Ej. PUERRO: última compra OC-00374 (12/06) 10 KG @ $2.200. Ese día el FIFO mezcló ese lote con otros más baratos → guardó $1.361. Después se vendió hasta 7,3 KG (todos del lote @ $2.200) → el FIFO de hoy es $2.200, pero nadie volvió a recalcular porque no hubo otra compra de puerro. (Además OC-00368 tiene **10 KG @ $230**, que parece un **error de carga** —debería ser ~$2.300— y arrastró hacia abajo el guardado viejo.)
- Mismo patrón en PEPINO, MORRON, COLIFLOR, POMELO, LECHUGA, ALBAHACA, KIWI, RUCULA: stock por debajo de la última compra → FIFO de hoy ≈ precio del último lote ≠ guardado del día de compra.

**Causa secundaria (2 de 11): artefactos de mis tests con apply+restore.**
- **TOMATE PERITA** ($1.719 vs $1.600) y **PALTA HASS BRASIL** ($635 vs $661): en los tests del bloque 2b y del Paso 2 (C3) restauré el `avg_cost` al valor **viejo** para "dejar producción igual que como la encontré". Ese valor viejo era justamente un costo stale → ahora figuran como desfasados. Honestidad: en parte yo los dejé así a propósito (para no alterar nada durante un test), pero el valor "correcto" según el modelo es el FIFO.

**Floor bug (C3) como causa: 0 casos visibles.** El floor bug inflaba `stock_qty` (no el costo directo). En el set actual ningún desfasaje se explica por stock inflado; se explican por ventana-vendida-abajo. Y el bug ya está arreglado para adelante.

**Dato de calidad a revisar aparte (no es del costo):** PUERRO OC-00368 `10 KG @ $230` huele a typo (faltó un dígito). PALTA tiene una fila base muerta KG con `$3.750` (compra OC-00352 de 8 KG, stock 0) que el FIFO ignora (la base viva es UNIDAD). Ninguno impide recalcular; son a chequear por separado.

## 11. ¿Recalcular al FIFO es seguro? — Sí, es "ponerlo al día", no "cambiar de modelo"

- Recalcular = correr `_recomputeCostFromStock` para estos productos → deja el guardado **exactamente** en lo que el sistema ya considera correcto y ya calcula en cada compra. No es un modelo nuevo.
- **Los 11 tienen FIFO computable** (nocalc = 0) → todos se actualizarían limpio, sin casos "raros sin dato".
- **No afecta los overrides genuinos:** esos viven en `order_items.override_cost_per_unit` (márgenes congelados de pedidos aprobados). Recalcular `product_units.avg_cost` / `products.average_cost` **no toca** los order_items ni sus márgenes históricos. Riesgo ahí: nulo.
- Único cuidado: PUERRO quedaría en $2.200 (FIFO limpio del lote actual), pero si se sigue vendiendo y la ventana llega al typo de $230, el FIFO bajaría → conviene **corregir el typo** antes o después, pero no bloquea el recalc.

## 12. Esto NO es revivir la bomba del botón — son cosas distintas

| | Botón viejo "Recalcular Costos" (ELIMINADO) | Recalcular al FIFO (lo de acá) |
|---|---|---|
| Modelo | **WMA** (promedio perpetuo) | **FIFO** (el oficial, ya en uso) |
| Fuente de datos | `stock_movements` (ledger **roto**, mezcla kg+bultos) | `purchase_items` + `stock_qty` (fuente limpia) |
| Cuántos cambiaban | **94% (50/53)** | **21% (11/52)** |
| Magnitud | ±230%, ±29% típico | mediana ~5%, peor 62% (un outlier de poco stock) |
| Efecto | **cambiaba el modelo** → corrompía | **alinea** al modelo ya vigente |

La bomba era peligrosa porque (a) usaba otro modelo, (b) leía un ledger roto, (c) movía casi todo el catálogo drásticamente. Recalcular-al-FIFO es lo opuesto en los tres ejes. **No es la bomba.** Si algún día se hace un "resincronizar todo", debe llamar a `_recomputeCostFromStock` (FIFO), **nunca** recrear un camino WMA-desde-ledger.

## 13. Opciones para decidir juntos (nada aplicado aún)

1. **Resincronizar los 11** corriendo `_recomputeCostFromStock` por producto (los 41 sincronizados no cambian). Bajo riesgo, trae todo al modelo oficial.
2. **Resincronizar solo los 2 artefactos de test** (TOMATE PERITA, PALTA) y dejar el resto, asumiendo que la próxima compra de cada producto los realinea sola.
3. **Dejarlo** — el desfasaje se autocorrige en la próxima compra de cada producto (cuando vuelve a correr el FIFO). El costo solo se usa para márgenes de pedidos NUEVOS; los aprobados ya tienen su costo congelado.
4. **(Estructural, aparte)** evaluar correr `_recomputeCostFromStock` también **al aprobar pedido** (no solo en compras) para que el costo no se quede atrás cuando se vende-abajo. Es un cambio de código, a decidir por separado.

**Solo lectura. Nada recalculado ni tocado.**
