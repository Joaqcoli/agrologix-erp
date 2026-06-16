# Auditoría — Módulo "Ajustes de Stock" (vista unificada) — diagnóstico (solo lectura, 2026-06-16)

> **Solo lectura. No se construyó nada.** Diagnóstico de qué existe y qué falta para una vista unificada de cambios de stock (pre-venta + post-venta), admin y galpón.
> **Conclusión adelantada:** la mayor parte **ya existe** en `stock_movements` y se puede consolidar; lo único que **NO deja rastro hoy** es el **ajuste de peso del galpón** (pre-venta) — eso hay que grabarlo antes de poder mostrarlo.

---

## 1. Dónde se registran los ajustes hoy — todo en `stock_movements`

**Estructura de `stock_movements`** (shared/schema.ts):
| Campo | Tipo | Nota |
|---|---|---|
| `movement_type` | enum **`in` / `out` SOLO** | el "tipo" fino (merma/rinde/ajuste) NO está acá |
| `quantity` | numeric | en unidad BASE |
| `unit_cost` | numeric | costo por unidad (de acá sale la plata ganada/perdida) |
| `reference_type` | text | `purchase` / `order` / `adjustment` |
| `reference_id` | int | id de compra / pedido / **product_units** (en ajustes) |
| `notes` | text | **acá se codifica el tipo**: "Merma", "Rinde", "Rinde — Pedido X", "Reversión…", "REVERTIDO" |
| `created_at` | timestamp | fecha |

⚠️ **NO hay `created_by`** → hoy **no se registra QUIÉN** hizo el ajuste (no se puede distinguir admin vs galpón en el movimiento).

### Mapa de cada tipo de cambio
| Cambio | Cómo se graba | reference_type | notes | ¿En historial de ajustes? | ¿Revertible? |
|---|---|---|---|---|---|
| **Merma/Rinde manual** (Stock, "set" modo merma_rinde) | `stock_movement` | `adjustment` | "Merma" / "Rinde" | ✅ **Sí** | ✅ **Sí** (hoy/ayer) |
| **Corrección manual** (Stock, "set" modo correction) | solo cambia stock | — | — | ❌ no deja rastro | ❌ |
| **Agregar stock** (Stock, `/api/stock/adjust`) | solo suma stock | — | — | ❌ no deja rastro | ❌ |
| **Rinde al aprobar pedido** (`approveOrder`) | `stock_movement` | `order` | "Rinde — Pedido X" | ❌ no (filtra `adjustment`) | ❌ no (revert exige `adjustment`) |
| **Galpón corrige peso** (`galponSetPurchaseItemWeight`) | **UPDATE** del movimiento de la compra | `purchase` | "Compra … (editada)" | ❌ **no deja rastro de ajuste** | ❌ |
| Compra / Venta normal | `stock_movement` | `purchase` / `order` | — | ❌ | ❌ |

## 2. El historial reversible — SÍ está implementado (no quedó en diseño)

`getAdjustmentMovements()` (storage.ts:1042) lista `stock_movements WHERE reference_type='adjustment'` → es el **historial de la pantalla Stock** (solo merma/rinde/correcciones manuales).

`revertStockAdjustment(id, qty)` (storage.ts:2602) — **implementado tal como se diseñó**:
- Solo `reference_type='adjustment'` **y** notes exactamente **"Merma" o "Rinde"**.
- **Límite hoy/ayer** (`created_at::date >= CURRENT_DATE - 1`).
- **Reversión total** (qty = total) → marca el original `notes='REVERTIDO'` (sale de los totales, que son en vivo).
- **Reversión parcial** → reduce el `quantity` del original.
- **Contra-asiento de auditoría**: inserta un movimiento neutro "Reversión — …" que no matchea Merma/Rinde (no impacta totales).
- Revertir **Merma** devuelve stock (siempre seguro); revertir **Rinde** saca stock (valida que alcance).

→ **El "deshacer/devolver al stock" YA funciona**, pero **solo para merma/rinde de la pantalla Stock**. NO para el rinde de pedidos ni para el ajuste de peso del galpón.

## 3. Pre-venta: ajuste de peso del galpón — NO deja rastro (el gap real)

`galponSetPurchaseItemWeight` (storage.ts:2886) corrige el peso por envase y:
- UPDATEa la línea de compra + **UPDATEa el `stock_movement` de la compra** (`reference_type='purchase'`),
- aplica el delta de stock y recalcula costo (WMA) y peso.

**No inserta ningún movimiento de tipo "ajuste".** → Hoy **no hay forma de mostrar "el galpón ajustó este cajón de 17→16 kg"** en un historial. Es el dato que **falta registrar** para la parte pre-venta de la vista.

## 4. Post-venta: merma y rinde — trazas parciales

- **Merma/Rinde de la pantalla Stock**: `reference_type='adjustment'`, notes "Merma"/"Rinde" → en el historial, **revertibles**.
- **Rinde al aprobar pedido**: `reference_type='order'`, notes "Rinde — Pedido X" → **NO** en el historial de ajustes, **NO** revertible por el endpoint, pero **SÍ** se cuenta en el dashboard.
- **Dashboard merma/rinde** (`/api/dashboard/merma-detail`, `rinde-detail`): agregan `stock_movements WHERE notes ILIKE '%Merma%' / '%Rinde%'` → **unen** los de `adjustment` y los de `order` (por patrón de notes). Con `unit_cost` calculan la plata. Ya tenés el "qué se gana/pierde" ahí.

## 5. Qué mostraría la vista unificada y de dónde sale cada dato

| Sección | Fuente hoy | ¿Existe? |
|---|---|---|
| **Pre-venta — ajuste de peso galpón** | (ninguna: no se graba) | ❌ **falta registrar** |
| **Post-venta — merma** | `stock_movements` notes ILIKE '%Merma%' | ✅ existe |
| **Post-venta — rinde** (manual + de pedidos) | `stock_movements` notes ILIKE '%Rinde%' | ✅ existe |
| **Ajustes manuales** (merma/rinde/correcciones) | `getAdjustmentMovements` (`reference_type='adjustment'`) | ✅ existe |
| **Deshacer / devolver al stock** | `revertStockAdjustment` (merma/rinde, hoy/ayer) | ✅ existe (acotado) |
| **Plata ganada/perdida** | `quantity × unit_cost` (como el dashboard) | ✅ existe |
| **Quién lo hizo** | (no hay `created_by`) | ❌ **falta** |

→ **Es casi todo "juntar consultas que ya existen"** (UNION sobre `stock_movements` por `reference_type` + patrón de notes). Los **dos faltantes** son: (1) **grabar el ajuste de peso del galpón**, y (2) opcional, **`created_by`** para saber quién (y separar galpón/admin).

## 6. Versión galpón vs admin

- **Admin (todo):** producto, tipo (merma/rinde/ajuste peso/corrección), cantidad, fecha, **quién**, y **plata** (`quantity × unit_cost` = ganado/perdido), con botón **deshacer**.
- **Galpón (REGLA DE ORO — sin plata):** producto, tipo, cantidad, fecha. **NUNCA** `unit_cost`, `avg_cost`, ni total $. Igual que su Stock y Pedidos (endpoints `/api/galpon/*`, sin dinero). Probablemente también con "deshacer" acotado (hoy/ayer) sobre lo que él generó.
- El galpón ya tiene el ítem "Ajustes de stock" en su menú (placeholder del Bloque 1) y ya genera ajustes de peso vía `galponSetPurchaseItemWeight`.

## 7. Enfoque recomendado

**Híbrido (a) + un poco de (b):**
1. **(a) Vista nueva que consolida lo existente** — el 80%. Una consulta/endpoint que une `stock_movements` por `reference_type`/notes: merma, rinde (manual + pedido), correcciones, reversiones. Reutiliza `getAdjustmentMovements` + el patrón del dashboard merma/rinde-detail. Dos endpoints: `/api/stock-adjustments` (admin, con plata) y `/api/galpon/stock-adjustments` (sin plata).
2. **(b) Registrar lo que falta:**
   - **Ajuste de peso del galpón** → que `galponSetPurchaseItemWeight` **inserte un `stock_movement` de auditoría** (ej. `reference_type='adjustment'` o un tipo nuevo `weight_adjust`, notes "Ajuste peso galpón: CAJÓN 17→16 (Δ -X kg)"). Sin esto, la sección pre-venta no tiene qué mostrar.
   - **(opcional) `created_by`** en `stock_movements` → para "quién" y separar galpón/admin. Hoy no existe.
3. **Deshacer:** reutilizar `revertStockAdjustment` (ya anda para merma/rinde hoy/ayer). Si se quiere deshacer también el ajuste de peso del galpón o el rinde de pedidos, hay que **extender** el revert (hoy exige `reference_type='adjustment'` + notes "Merma"/"Rinde").

**Resumen:** construir es **menos de lo que parece** — la mayoría es consolidar consultas que ya existen. Lo nuevo concreto es: **(1) grabar el ajuste de peso del galpón** (imprescindible para la parte pre-venta), **(2) opcional `created_by`**, y **(3) opcional extender el revert** a esos tipos. La separación admin/galpón es la misma de siempre (con/sin plata, endpoint `/api/galpon/*`).

**Solo lectura. Nada tocado.**
