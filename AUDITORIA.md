# Auditoría AgroLogix ERP — Fase 1: Radiografía + Inventario

> **Modo solo-lectura.** Este documento mapea el sistema y lista hallazgos. NO se modificó código.
> Las referencias `archivo:línea` son al estado del repo al momento de la auditoría y pueden correrse con el tiempo.

---

# ENTREGABLE 1 — Radiografía del sistema

## 1. Stack y arquitectura

| Capa | Tecnología |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind + shadcn/ui + wouter (routing) + TanStack Query |
| Backend | Node.js + Express + TypeScript (bundle con esbuild vía `script/build.ts`) |
| DB | PostgreSQL (Supabase) + Drizzle ORM |
| Sesión/Auth | `express-session` + `connect-pg-simple` (store en PG); bcryptjs para hash |
| Deploy | Render (auto-deploy desde `main`); migraciones idempotentes corren al arrancar (`server/migrate.ts`) |

**Tamaño/forma:** monolito. `server/storage.ts` (~5.7k LOC) concentra TODA la lógica de DB; `server/routes.ts` (~3.4k LOC, 152 endpoints) es la capa HTTP. Front con páginas grandes (caja 1.9k, orders/detail 1.9k, stock 1.3k, pdf 1.3k).

**Roles** (enum `role`): `admin`, `operator`, `vendedor`, `galpon`. Enforcement real en backend solo vía `requireVendedor` (9 endpoints) y `requireGalpon` (12 + middleware default-deny). Los otros **134 endpoints usan solo `requireAuth`** (logueado sí/no).

## 2. Mapa de módulos

| Módulo | Ruta | Qué hace |
|---|---|---|
| Dashboard | `/` | KPIs del período: ventas, ganancia, merma/rinde, vacíos, comisiones, ventas+bultos por semana |
| Clientes | `/customers` | ABM de clientes, IVA, vendedor asignado, grupos de precio, bolsa FV |
| Productos | `/products` | ABM de productos, categoría, unidad base |
| Stock | `/stock` | Stock por producto (product_units), costo, ajustes (Merma/Corrección), "Recalcular Costos" |
| Compras | `/purchases` | OC por día, resumen (bultos/total/proveedores), alta/edición |
| Pedidos | `/orders` | Pedidos por día, aprobar, remito, factura |
| Carga Pedido | `/intake` | Parser de texto libre → ítems de pedido |
| Lista de Carga | `/load-list` | Consolidado del día: faltantes vs stock, "duda", lista de compra |
| Cuentas Corrientes (AR) | `/cuentas-corrientes` | Saldos por cliente, cobros, retenciones, remitos/facturas |
| Proveedores (AP) | `/suppliers` | CC de proveedores, pagos, cheques propios/endosados |
| Caja | `/caja` | Cuentas financieras, movimientos, obligaciones, cheques en cartera |
| Bancos | `/bancos` | Movimientos MercadoPago (API + XLSX), categorización, comisiones |
| Facturas | `/invoices` | Facturación electrónica ARCA/AFIP (CAE) |
| Lista de Precios | `/price-list` | Precios por producto |
| Vendedor | `/vendedor/*` | Vista separada: su dashboard, pedidos, clientes (solo lo suyo) |
| Galpón | `/galpon/*` | Vista separada SIN dinero: stock, editar peso/envase, pedidos, confirmar, remitos sin precios |

## 3. Mapa de datos (35 tablas)

**Núcleo producto/stock/costo**
- `products` — producto, `unit` (base), `current_stock`, `average_cost` (resumen).
- `product_units` — **fila autoritativa de stock por producto**: `stock_qty`, `avg_cost`, `weight_per_unit`, `base_unit`. (El stock NO se deriva de movimientos.)
- `stock_movements` — **log** de entradas/salidas (`quantity`, `unit_cost`, `reference_type/id`, `notes`). Es auditoría; el botón "Recalcular Costos" lo usa para WMA.
- `product_cost_history` — historial de costo por compra.

**Compras (AP)**
- `purchases` — cabecera (proveedor, fecha, total, `is_paid`, `supplier_id`).
- `purchase_items` — línea: `quantity`+`unit` (base), `cost_per_unit` (base), `purchase_qty`+`purchase_unit`+`weight_per_package`+`cost_per_purchase_unit` (envase). **El peso por envase está horneado en `quantity` y `cost_per_unit`.**
- `suppliers`, `supplier_payments`.

**Pedidos (AR)**
- `orders` — cabecera (`status` draft/approved/cancelled, `total`, `remito_num` (correlativo por cliente), `remito_id`, `galpon_confirmed`, `approved_at/by`, `invoice_number`).
- `order_items` — línea: `quantity`+`unit`, `price_per_unit`, `cost_per_unit`, `override_cost_per_unit`, `margin`, `subtotal`, `bolsa_type`, `is_bonification`.
- `remitos`, `payments`, `payment_order_links`, `withholdings`, `invoices`, `credit_notes`.

**Precios**
- `price_history` — precio por (cliente, producto, unidad).
- `price_list_items` — lista de precios.
- `client_groups` + `client_group_members` — grupos de precio compartido.

**Caja / Bancos / Tesorería**
- `cuentas_financieras` — cuentas (efectivo, banco, mp, cheque); saldo de la cuenta "cheque" se DERIVA de cheques en cartera.
- `movimientos_cuenta` — movimientos por cuenta (ingreso/egreso, origen).
- `caja_movements` — feed de egresos/ingresos (categorías, sync MP).
- `obligaciones` + `obligacion_pagos` (esta última creada SOLO en migrate, no en schema.ts) — deudas/cuotas + historial de pagos.
- `cheques` — recibidos/emitidos, estados; `supplier_payment_id` para limpieza.
- `bank_categories`, `bank_contacts`, `bank_payment_links`, `mp_xlsx_movements`, `mp_movement_overrides`, `mp_movement_identifiers`.
- `socios`, `retiros`.

## 4. Flujos críticos (alto nivel)

**Compra → stock + costo**
`createPurchase`: inserta `purchases`+`purchase_items` → suma a `product_units.stock_qty` (unidad base) → WMA sobre `avg_cost`/`average_cost` → inserta `stock_movements` (in) + `product_cost_history` → **al final `_recomputeCostFromStock` (FIFO) sobrescribe el costo**. Si `payment_method` efectivo/transferencia → `is_paid=true` + auto-crea `supplier_payment`.

**Pedido: carga → aprobar → stock → CC**
- Carga (`intake`/`createOrder`): pedido en `draft`, ítems con precio (de `price_history`), `remito_num` por cliente. **NO toca stock.**
- Editar línea draft: recomputa total, no toca stock.
- `approveOrder`: **descuenta `product_units.stock_qty`** (según unidad/envase), inserta `stock_movements` (out), re-fetch costo via `_getCostForUnit`, calcula margin, maneja faltantes (zero/rinde/prorate). El stock que falta sale por **rinde** (movimiento "in" con costo 0) o se marca.
- CC (AR): el saldo del cliente = `Σ facturación (order_items aprobados, con IVA dif.) − Σ cobros − Σ retenciones + saldo apertura` (`getCCSummary`). Se calcula **en vivo** (no hay columna saldo).

**Cobro / Pago**
- Cobro cliente (`/api/payments`): inserta `payments`, vincula a pedidos (`payment_order_links`), ajusta `movimientos_cuenta`; si cheque → crea `cheques` recibido en cartera.
- Pago proveedor (`/api/ap/payments`): inserta `supplier_payment` + `movimiento_cuenta`; si cheque propio → crea `obligacion` + `cheque` emitido (linkeados al pago para limpieza al borrar).

**Facturación (ARCA)**
`/api/invoices/create`: arma totales desde `order_items`, llama AFIP (`@afipsdk/afip.js`) por CAE, guarda en `invoices`, setea `orders.invoice_number`. PDF "agrupado"/"detallado" es presentación (el CAE solo guarda totales/IVA).

## 5. Dónde vive cada cálculo clave

| Cálculo | Dónde |
|---|---|
| **Costo (FIFO)** | `_recomputeCostFromStock` (`storage.ts:637`): promedio ponderado de compras recientes que cubren el stock actual, desde `purchase_items`. Lo llaman create/update purchase y galponSetPurchaseItemWeight. |
| **Costo (WMA replay)** | `recalcAllStockCosts` (`storage.ts:2620`): replaya `stock_movements` → WMA. Lo dispara el botón "Recalcular Costos". |
| **Costo (WMA incremental)** | `createPurchase`/`updatePurchase` mientras suman stock (luego lo pisa el FIFO). |
| **Resumen producto** | `_recalcProductSummary` (`storage.ts:612`): `products.current_stock`+`average_cost` = ponderado de filas `product_units`. |
| **Peso por envase agregado** | `_recomputeWeightPerUnitFromStock`: ponderado por envases de las compras que cubren el stock. |
| **Costo por unidad en pedidos** | `_getCostForUnit` (`storage.ts:469`). |
| **Descuento de stock** | `approveOrder` (`storage.ts:~1918`) + ajustes en `updateOrderItem`/`deleteOrderItem` (solo si aprobado). |
| **Saldo CC clientes (AR)** | `getCCSummary` (en vivo: compras−cobros−retenciones+apertura, con rollup de sedes por `parent_customer_id`). |
| **Saldo CC proveedores (AP)** | `getAPCCSummary` (compras por `supplier_id` − pagos). |
| **Precios por grupo** | `client_group_members` + `_getGroupPeerIds`; replicación al guardar precio (ver [precio-venta-flujo]). |
| **IVA** | 10.5% general, 21% huevos — lógica duplicada (`getIvaRate` en routes y orders/detail, y embebida en SQL del dashboard). |

---

# ENTREGABLE 2 — Inventario de hallazgos (titulares, priorizados)

> Solo títulos + ubicación + por qué. Sin arreglar. A profundizar área por área después.

## 🔴 CRÍTICO

**C1 — Dos (en realidad tres) modelos de costo conviviendo y divergiendo.** `recalcAllStockCosts` (botón "Recalcular Costos", `storage.ts:2620`) calcula **WMA desde `stock_movements`**, mientras create/edit compra calcula **FIFO desde `purchase_items`** (`_recomputeCostFromStock`, `storage.ts:637`), y `_recalcProductSummary` (`612`) propaga un tercer promedio ponderado de `product_units`. **Confirmado que divergen**: apretar el botón pisa el costo FIFO con el WMA (ej. ya visto: tomate 1719 WMA vs 1600 FIFO). Riesgo: el costo "verdadero" depende de cuál corrió último → márgenes inconsistentes. **Sospechoso #1.**

**C2 — `recalcAllStockCosts` lee de un ledger (`stock_movements`) que NO cuadra con el stock autoritativo (`product_units.stock_qty`).** Los movimientos "stock agotado por rinde/merma" y los reverts floored no mantienen el ledger == stock_qty (visto en bloques previos: la suma de movimientos no da el stock real). Entonces el WMA del botón parte de cantidades que no reflejan la realidad → costo mal. Integridad + costo.

**C3 — Bug de piso-en-0 en `updatePurchase` (revert).** Al revertir una línea cuyo stock actual es menor que la cantidad de la línea, floorea a 0 y la reaplicación suma de más → **infla el stock** (probado: banana 10.9 → 48). Latente para cualquier edición de compra que cambie cantidad/peso cuando `stock < qty_línea`. (En el flujo del galpón se esquivó con un método targeted, pero el bug sigue en `updatePurchase` para el admin.) `storage.ts` PHASE 1 de `updatePurchase`.

## 🟠 MEDIO

**M1 — Enforcement de roles incompleto en backend.** 134 endpoints con solo `requireAuth`. Solo `galpon` tiene default-deny real; `vendedor`/`operator` están contenidos por redirects del front, pero un `vendedor`/`operator` con sesión podría llamar `/api/caja/*`, `/api/products` (costos), `/api/ap/*`, etc. y recibir datos. No hay `requireAdmin`. Seguridad.

**M2 — `stock_qty` autoritativo escrito desde muchos lugares.** createPurchase, updatePurchase, approveOrder, updateOrderItem, deleteOrderItem, adjustProductUnitStock, galponSetPurchaseItemWeight, reset/import. Cada uno con su lógica de delta/floor. Riesgo de desincronización entre `product_units.stock_qty`, `products.current_stock` y `stock_movements`. Integridad.

**M3 — Costo se escribe en ~8 lugares con fórmulas distintas** (`storage.ts:361,378,400,415,626,666-667,2509-2521,2673`). Sin una única fuente de verdad → propenso a divergencia (ver C1). Duplicación de lógica.

**M4 — Override de costo en pedidos ("Manual").** `override_cost_per_unit` puede pisar el costo automático; ya hubo 816 overrides espurios por un bug de UI (corregido). Quedan overrides "genuinos" que congelan el costo aunque cambie el real. Revisar consistencia con el modelo FIFO. Integridad/costo.

**M5 — Flujos async que dependen de timing.** El prefill de precios server-side (visto antes), y ahora la sugerencia de peso (`suggestSupplierWeight`) y los recálculos post-mutación. Riesgo de pisar valores o aplicar sobre estado viejo si el usuario actúa rápido. Orden/timing.

**M6 — Lógica de IVA duplicada en 3+ lugares** (`getIvaRate` en `routes.ts` y `orders/detail.tsx`, + embebida en el SQL del dashboard `getDashboardStats` con `ILIKE '%huevo%'`). Si cambia una tasa o un criterio, hay que tocar varios lados. Duplicación.

**M7 — Reconciliación MP / comisiones frágil.** El cálculo de comisiones (caja) vs Bancos dependía de que se sincronicen movimientos XLSX (ya corregido un gap). La numeración/identificación MP (`mp_movement_identifiers`, overrides) es compleja y propensa a duplicados. Integridad.

**M8 — `obligacion_pagos` existe solo en `migrate.ts`, no en `shared/schema.ts`.** Schema drift: la tabla no está tipada en Drizzle (se usa por SQL crudo). Riesgo de inconsistencia tipos↔DB. Mantenibilidad.

## 🟡 MENOR

**m1 — Performance: `storage.ts` y `routes.ts` gigantes** (5.7k / 3.4k LOC) sin separación por dominio. Mantenibilidad.

**m2 — Bundle front > 500 kB** (warning de Vite; `index-*.js` ~1.9 MB). Sin code-splitting. Performance de carga.

**m3 — `getOrders`/`getCCSummary` recalculan en vivo con loops y N+1 potenciales** (ej. `getProductPurchaseHistory` por producto, rollups de sedes en memoria). A revisar a alto volumen. Performance.

**m4 — Helpers duplicados**: `fmt()`/`fmtInt()` definidos localmente en muchas páginas; `normalize()` en stock y orderParser; mezcla de `fetch()` directo vs `apiRequest()`. Duplicación/consistencia.

**m5 — Fechas: histórico de bugs de timezone** (`new Date("YYYY-MM-DD")` = UTC → corre un día). Ya se arreglaron varios (CC proveedores, intake) pero el patrón `new Date(str)` aparece en varios lados. Revisar que no queden más. Integridad de visualización.

**m6 — Valores hardcodeados** (históricos de vendedor Ene-Mar 2026, CUIT/punto de venta ARCA, comisión MP 0.6%) embebidos en código. Mantenibilidad.

**m7 — `console.log` de debug** en migrate y algún endpoint de diagnóstico (`/api/debug/*`, `/api/mp/income-diag`) que podrían quedar en prod. Limpieza.

---

## Sugerencia de orden para Fase 2 (a confirmar juntos)
1. **Costos (C1, C2, C3, M3, M4)** — el área de mayor riesgo y la que más impacta plata. Definir UN modelo único y qué hace el botón "Recalcular Costos".
2. **Integridad stock (C2, C3, M2)** — ligado a lo anterior.
3. **Seguridad de roles (M1)** — acotado y de bajo esfuerzo.
4. **Duplicación/timing (M5, M6, m4)** — mantenibilidad.
5. **Performance/limpieza (m1–m7)** — al final.
