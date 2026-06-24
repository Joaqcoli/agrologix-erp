# Auditoría Caja / Banco — diagnóstico para el rediseño (solo lectura, 2026-06-24)

> **Solo lectura. Nada tocado.** Mapa completo de Caja y Banco antes de rediseñar. Objetivo del rediseño: **(A)** trackear y **categorizar cada movimiento** de cada banco, **(B)** llegar a la **GANANCIA NETA** real (ingresos − costo mercadería − todos los gastos operativos).
> **Conclusión adelantada:** **el corazón ya existe y funciona** — hay un sistema de categorización de gastos (`bank_categories` + `mp_movement_overrides` → `caja_movements`) con 22 categorías y **506 gastos operativos ya categorizados ($37,4M)**. **No hay que construirlo, hay que (1) extenderlo a Galicia, (2) restar esos gastos para la neta, y (3) excluir las transferencias internas ("Banco propio", $7,9M).** Obligaciones (67) y cheques (46) están cargados y funcionando.

---

## 1. Los dos módulos hoy

| Módulo | Archivo | LOC | Qué muestra |
|---|---|---|---|
| **Caja** | `client/src/pages/caja/index.tsx` | 1991 | Cuentas + disponible (MP/Galicia/Efectivo/Cheques), obligaciones a pagar, cheques en cartera, retiros de socios, ingresos/egresos del período, movimiento manual |
| **Banco** | `client/src/pages/bancos/index.tsx` | 1333 | Movimientos de MP (de la API), **categorización** de cada movimiento, "Cobrado/Comisiones del período", saldo (cuando responde), sincronizar reporte |

**Endpoints (resumen):**
- **Caja:** `/api/caja/{cuentas,summary,movements,trend,balance,cheques,obligaciones,retiros,socios}` (+ PUT/POST/PATCH/DELETE).
- **Banco/MP:** `/api/mp/{balance,movements,sync-report}`, `/api/mp/movements/:mpId/category`, `/api/bank-categories`, `/api/bank-contacts`, `/api/bank-payment-links`.
- **AP (proveedores):** `/api/ap/{cc/summary,cc/:id,payments,pending-purchases,empties}`.

## 2. Mapa de tablas — dónde vive la plata (con conteos reales)

| Tabla | Registros | Qué guarda | Se llena de |
|---|---|---|---|
| `cuentas_financieras` | 4 | MP, Galicia, Efectivo, Cheques (saldo_base) | manual |
| `movimientos_cuenta` | 26 | ajustes de saldo por cuenta (Sistema A) | cobros/pagos/obligaciones/cheques |
| **`caja_movements`** | **593** | **ingresos/egresos CATEGORIZADOS** (Sistema B) | **576 sync de MP** + 17 manuales |
| `payments` | 250 | cobros de clientes | CC / cobros |
| `supplier_payments` | 325 | pagos a proveedores | AP / pagos |
| `mp_xlsx_movements` | 913 | reporte settlement de MP | sync API (XLSX) |
| **`bank_categories`** | **22** | **catálogo de categorías** | manual |
| **`mp_movement_overrides`** | **263** | **categoría asignada a c/ movimiento MP** | al categorizar en Banco |
| `mp_movement_identifiers` | 256 | pagador de c/ movimiento MP | sync settlement |
| `bank_contacts` | 141 | identidad de pagadores (email/CBU/MP id) | sync + manual |
| `bank_payment_links` | 60 | link movimiento MP ↔ pedido | manual |
| `obligaciones` | 67 | vencimientos a pagar | manual |
| `obligacion_pagos` | 7 | historial de pagos parciales | al pagar |
| `cheques` | 46 | cheques recibidos/emitidos | manual |
| `socios` / `retiros` | 2 / 24 | retiros de socios | manual / sync |

**3 sistemas (ya conocido):** A=`cuentas_financieras`+`movimientos_cuenta` (disponible), B=`caja_movements`+`payments`+`supplier_payments` (reportes/categorías), C=`mp_xlsx_movements`+API (MP). **Para la ganancia neta, el sistema relevante es B (`caja_movements` categorizados).**

## 3. La categorización HOY — ✅ existe y funciona (el corazón del rediseño)

**Catálogo:** `bank_categories` = **22 categorías** en uso: Cobro de cliente, Mercaderia, Banco propio, Combustible, Uber, Sueldo, Retiro, Pago a proveedor, Peaje, Prestamo, Carga, Mecanico, Comisiones, Monotributo, Flete, Mejora galpón, Limpieza, Fumigación, etc. **Cubre prácticamente todos los tipos de gasto operativo.**

**Flujo (solo MP hoy):** en Banco, cada movimiento de MP se categoriza con `PUT /api/mp/movements/:mpId/category` (`routes.ts:3204`). Eso hace dos cosas:
1. `setMpMovementCategory` → guarda la categoría en `mp_movement_overrides` (mp_id → category_id).
2. `reconcileMpCajaMovement` → **crea/actualiza un `caja_movement`** con `source_id='mp:{mpId}'`, `type` ingreso/egreso, `category` = nombre, monto = gross. La comisión va aparte con `syncMpFee` → otro `caja_movement` categoría "Comisiones".

→ **Categorizar un movimiento MP = se vuelve un `caja_movement` categorizado.** Por eso `caja_movements` tiene 576 de origen MP (sync) + 17 manuales, todos con su categoría. **Este es exactamente el modelo que el rediseño necesita** — solo que hoy se alimenta **solo de MP**.

## 4. MercadoPago — trackeo completo (conservar)

- Movimientos: API en vivo (`/v1/payments/search`) + settlement XLSX (`mp_xlsx_movements`, 913). Pagadores identificados (`mp_movement_identifiers` 256, `bank_contacts` 141).
- Categorización: 263 movimientos categorizados (`mp_movement_overrides`), 0 sin categoría → **el usuario ya categoriza prolijo.**
- Comisiones: registradas como gasto (`caja_movements` categoría "Comisiones", 314 movs, $1,17M). ✅ ya entra como gasto operativo.
- **Esta parte está completa y funcionando — se conserva tal cual.** (El único punto abierto es el *saldo disponible* exacto, que ya decidimos dejar con `saldo_base` manual; ver `AUDITORIA-CAJA.md`.)

## 5. Galicia — casi vacío, sin upload (a construir)

- **Solo 7 `movimientos_cuenta` a mano**; **0 categorización** (la categorización vive en `mp_movement_overrides`, atada a MP). Galicia no tiene movimientos en `caja_movements`.
- **No hay upload** (sin `multer`, sin endpoint de subida de archivo).
- **Parser reusable:** `server/mp-report-sync.ts` tiene `normHeader` (normaliza encabezados), `parseXlsxDate`/`parseXlsxTimestamp`, `parseNum` (coma decimal), y el patrón de mapeo de columnas por nombre. **Sirve de base para el parser de Galicia** (cambia el mapeo de columnas y el origen del archivo).

## 6. Ganancia bruta vs neta — qué falta

- **Hoy el dashboard calcula `ganancia_bruta` = ventas − costo de mercadería** (`oi.cost_per_unit`), en `getDashboardStats` (`storage.ts:4561`). **NO resta ningún gasto operativo** (no toca `caja_movements`).
- **Pero los gastos operativos YA están capturados y categorizados:** **506 egresos categorizados = $37.371.681** (combustible, sueldos, comisiones, peajes, mercadería de gasto, seguros si se cargan, etc.), excluyendo "Banco propio".
- → **Para la NETA falta solo el cálculo:** `ganancia_neta = ganancia_bruta + rinde − merma − Σ(gastos operativos categorizados del período, excluyendo transferencias internas)`. **Los datos existen; falta sumarlos y mostrarlos.** (Los seguros de camionetas, etc. se cargarán como un `caja_movement`/categoría más — el modelo ya lo soporta.)

## 7. Transferencias internas ("Banco propio") — el punto crítico de la neta

- **"Banco propio" = $7.906.000** (30 movs: 25 ingreso $5,0M + 5 egreso $2,9M). Son pases entre cuentas propias (Galicia↔MP), **no ingresos ni gastos del negocio.**
- Hoy **existe como categoría**, pero `getCajaSummary` (`storage.ts:5190`) los suma como ingreso/egreso del negocio (no los excluye). Para la **ganancia neta serían un gasto falso de $2,9M** si se contaran.
- **No hay un flag de "transferencia interna"** — se distingue solo por el nombre de la categoría. **Para la neta hay que excluir explícitamente esa categoría** (o, mejor, marcar el movimiento como interno). Es central para que el número sea real.

## 8. Obligaciones y cheques — cargados y funcionando

- **Obligaciones: 67** (53 pendientes $68,7M + 14 pagadas $20,9M). Flujo de cargar/pagar funciona (`obligacion_pagos` registra parciales; M8 lo dejó atómico). El usuario "quiere volver a cargar" → ya hay base; sumará nuevas.
- **Cheques: 46** (emitidos en cartera 24/$41M, recibidos en cartera 8/$33,9M, etc.). Cargado y con flujos (depositar/endosar).
- → **No están vacíos ni rotos.** El rediseño los conserva; a lo sumo se revisan detalles al integrarlos a la vista de neta.

## 9. Recomendación de arquitectura — qué conservar, qué construir

### ✅ CONSERVAR (funciona, es la base)
1. **El sistema de categorización** (`bank_categories` + `mp_movement_overrides` + `reconcileMpCajaMovement` → `caja_movements`). Es exactamente lo que se necesita.
2. **El trackeo de MP** (API + settlement + identificación de pagadores + comisiones como gasto).
3. **Obligaciones y cheques** (cargados y funcionando).
4. **`saldo_base` manual para el disponible de MP** (ya decidido; el saldo exacto no se reconstruye por API).

### 🔧 EXTENDER / CONSTRUIR (en orden)
1. **Calcular la GANANCIA NETA (mayor impacto, datos ya existen):** `neta = bruta + rinde − merma − Σ(gastos operativos categorizados, excluyendo "Banco propio"/internas)`. Mostrarla en el Dashboard (cadena bruta → ajuste → −gastos = neta) y en un reporte de rentabilidad en Caja/Banco. **Es sumar lo que ya está categorizado.**
2. **Marca de transferencia interna:** un flag (o categoría reservada tratada como tal) que excluya "Banco propio" de ingresos/gastos/neta. Acotado y central.
3. **Galicia por upload:** `multer` + parser (reusando `mp-report-sync`) → inserta los movimientos del extracto como `caja_movements` **categorizables con el mismo flujo que MP** (extender la categorización para que no sea solo `mp_movement_overrides`, sino aplicable a cualquier `caja_movement`).
4. **Categorización unificada:** hoy la categoría de un movimiento vive en dos lugares (`mp_movement_overrides.category_id` para MP y `caja_movements.category` texto). Al sumar Galicia, conviene que **la categoría viva en `caja_movements`** (un solo lugar, texto o FK), y que MP siga alimentándolo. Evita duplicación.
5. **(Revisar) doble conteo** `payments` vs `caja_movements` "Cobro de cliente" en `getCajaSummary` (paso 5 del plan viejo) — al armar el reporte de neta, definir qué tabla es la fuente de ingresos para no contar doble.

### Orden sugerido (impacto / riesgo)
**1. Definir categorías con Joaquín** (ya hay 22; ajustar/agrupar en "ingreso" vs tipos de gasto) → **2. Ganancia neta** (sumar gastos categorizados, datos existen) → **3. Excluir transferencias internas** → **4. Galicia upload + categorización** → **5. Conciliar ingresos (doble conteo)**.

→ **El 80% del trabajo ya está hecho** (categorización + gastos capturados). El rediseño es sobre todo **(a) calcular y mostrar la neta**, **(b) excluir lo interno**, y **(c) sumar Galicia al mismo modelo.**

**Solo lectura. Nada tocado.**
