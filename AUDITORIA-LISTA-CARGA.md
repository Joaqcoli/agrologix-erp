# Auditoría — Lista de Carga: doble conteo de stock entre unidades (solo lectura, 2026-06-15)

> **Solo lectura. No se tocó nada.** Diagnóstico de un bug crítico (define qué comprás).
> **Bug confirmado:** cuando un producto se pide el mismo día en varias unidades (cajón, kg, unidad), el MISMO stock físico se cuenta una vez por cada unidad → el sistema subestima (o esconde) el faltante.

---

## 1. Cómo calcula hoy la Lista de Carga (`storage.getLoadListByDate`, storage.ts:2243)

1. Junta los `order_items` de los pedidos del día (aprobados + borradores si se pide).
2. **Consolida en filas con clave `${productId}-${unit}`** (línea 2386) → **una fila por cada unidad** en que se pidió el producto. Manzana en cajón y en kg = **dos filas**.
3. Por fila: `stockQty = stockForUnit(pid, unidad)` (2391) y `diffQty = stockQty − totalQty` (2399). `diffQty < 0` = faltante.

## 2. Cómo descuenta el stock — acá está el bug

**NO descuenta una sola vez.** Cada fila compara su demanda contra el **stock ENTERO** del producto convertido a la unidad de esa fila. `stockForUnit` (2360):
```
si unidad ∈ {CAJON,BOLSA,BANDEJA}:  stock = stock_base / wpu   (todo el stock, en cajones)
si unidad base (KG/UNIDAD/...):      stock = stock_base         (todo el stock, en kg)
```
→ Las dos filas (cajón y kg) leen **el mismo `stock_base`**, cada una "como si tuviera todo el stock disponible". **No hay partición ni descuento entre unidades.** Es el doble conteo: el stock se reparte mentalmente para cubrir la demanda en cajón Y otra vez para la demanda en kg.

## 3. La conversión de unidades — la raíz

`stockForUnit` **sí** convierte el stock a la unidad pedida (base/wpu para envases). Pero convierte **el mismo stock base para cada unidad por separado**. Lo que **falta** es lo inverso: **convertir toda la DEMANDA a una unidad común (kg base), sumarla, y restar el stock UNA vez**. Hoy:
- ✅ stock → convertido por unidad (bien hecho a nivel de una fila aislada)
- ❌ demanda → NO se consolida a unidad común; se compara unidad por unidad contra el stock completo

→ **Raíz: se compara "stock entero" contra "demanda de cada unidad", en vez de "stock" contra "demanda total consolidada".**

## 4. Confirmación con datos reales (pedidos del 16/06)

**BANANA ECUADOR** — pedida en 3 unidades (triple conteo). Stock 185 kg, wpp 17 kg/cajón.
| Unidad | Pedido | Stock que "ve" la fila | diff (actual) | en kg |
|---|---|---|---|---|
| CAJON | 9 | 10,88 cajón | +1,88 → no compra | 153 |
| KG | 16 | 185 kg | +169 → no compra | 16 |
| UNIDAD | 25 | 185 unid | +160 → no compra | 25 |

- **Hoy dice: no hace falta comprar.** ❌
- **Correcto:** demanda = 153+16+25 = **194 kg** vs stock **185 kg** → **FALTAN 9 kg.** El bug **esconde** el faltante.

**ZAPALLITO REDONDO** — 2 CAJON + 4 KG, stock 28 kg (wpp 14).
- Hoy: cajón diff 0 (justo), kg diff +24 → no compra. **Correcto:** 28+4 = 32 vs 28 → **FALTAN 4 kg** (escondido).

**MANZANA ROJA ELEGIDA** — 6,5 CAJON + 15 KG, stock 169,5 kg. Demanda real 110,5+15 = 125,5 < 169,5 → en este caso alcanza, pero el mecanismo de doble conteo es idéntico (si el stock fuera menor, lo escondería).

> **Magnitud:** el 16/06 hay **12 productos** pedidos en ≥2 unidades (BANANA, APIO, ESPINACA, REPOLLO, LIMON, POMELO, MANZANA GRANNY/ROJA, MORRON ROJO, ZUCCINI, ZAPALLITO, BATATA) → todos sujetos a este doble conteo.

## 5. Cuál sería el enfoque correcto

**Consolidar la demanda en unidad base antes de comparar:**
1. Por producto, convertir **toda** la demanda a kg base: `cajón × wpu(cajón) + bolsa × wpu(bolsa) + kg + unidad×… → demanda_total_base`.
2. `faltante_base = demanda_total_base − stock_base` (**el stock se resta UNA sola vez**).
3. Expresar el faltante en la unidad que el usuario compra (ej. cajones = `faltante_base / wpu`).

La pantalla puede seguir **mostrando el desglose por unidad** (cuántos cajones, cuántos kg pidió cada cliente), pero el **número de "faltante/comprar" tiene que salir del total consolidado menos stock una vez**, no de comparar cada unidad contra el stock entero.

**Hoy vs debería:**
| | Hoy | Debería |
|---|---|---|
| Agrupación | por `(producto, unidad)` | por `producto` (con desglose por unidad solo informativo) |
| Stock vs demanda | stock entero vs demanda de cada unidad (N veces) | stock vs demanda total consolidada (1 vez) |
| Unidad de comparación | la de cada fila | kg base común |
| Resultado | esconde/subestima faltantes | faltante real |

**Cuidado para el fix:** toca exactamente cómo se descuenta el stock entre unidades (define qué se compra). El punto delicado es la **conversión con `wpu` por tipo de envase** (cajón vs bolsa pueden tener distinto peso) y productos sin `wpu` confiable (`NaN`, ya hay guardas). El fix debe consolidar en base usando el `wpu` correcto por unidad y manejar el faltante negativo/positivo con claridad.

**Solo lectura. Nada tocado.**

---

## 6. ✅ APLICADO (2026-06-16, commit `53722c1`)

`getLoadListByDate` ahora **consolida por producto**: suma toda la demanda en kg base, resta el stock UNA vez, y expresa el faltante en la unidad de compra (envase si se pidió en envase; si no, la base). Una fila por producto; el desglose por unidad queda informativo (`demandByUnit`). Los exports (PDF lista y compra) heredan el fix (usan la misma función).

**Bonus:** se corrigió un bug latente en `baseStockMap` (tomaba la "última" fila base → una fila vieja en 0 de otra unidad base podía pisar la real y generar un **faltante falso**). Ahora toma la fila base de **más stock** (coherente con `approveOrder`).

**Confirmado aparte:** el descuento de stock al aprobar (`approveOrder`) **NO** tenía este bug — descuenta acumulativo (cada línea relee el stock ya reducido). El stock real nunca estuvo en riesgo.

**Verificado en vivo (función real, 16-06):** BANANA/ZAPALLITO consolidan al total correcto; LIMON (multi-unidad con excedente) → NO comprar (no inventa faltante); KIWI (una sola unidad) → idéntico al cálculo previo; sin NaN.
