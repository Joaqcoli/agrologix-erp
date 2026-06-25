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

---

# 🔧 Lector Galicia + vista compartida — diagnóstico técnico de construcción (solo lectura, 2026-06-24)

> **Solo lectura. Nada construido.** Cómo construir el lector de extractos Galicia + vista MP/Galicia sobre lo que ya existe. **Resumen:** la mayor parte de la infraestructura ya está (parser reusable, categorización editable, entrada a `caja_movements`, gráfico de egresos). Lo nuevo es: upload de archivo, tabla staging Galicia, reglas de clasificación, y unificar la vista.

## 1. Reusar lo existente — encaje del lector de Galicia

| Pieza que ya existe | Dónde | Reuso para Galicia |
|---|---|---|
| **Parser de extractos** | `mp-report-sync.ts`: `normHeader`, `parseXlsxDate`, `parseNum`, `col(exact,fallback)`, lee CSV/XLSX (`XLSX.read` + `sheet_to_json`) | **Base del parser Galicia.** Cambia: mapeo de columnas (Fecha/Débitos/Créditos/Concepto/Leyendas), separador `;`, encoding `utf-8-sig`. Conviene **extraer estos helpers a un módulo compartido** (`server/xlsx-helpers.ts`) y usarlos en ambos. |
| **Entrada a `caja_movements`** | `reconcileMpCajaMovement` (`storage.ts:5344`): borra por `source_id` + inserta `{source_id, date, type, amount, category, method}` | **Mismo patrón.** Galicia usa `source_id = 'galicia:{clave}'` → upsert idempotente, dedup automático. |
| **Catálogo de categorías** | `bank_categories` (22) + endpoints GET/POST/PUT | **Tal cual.** "Comisiones Galicia", "Seguros", "Impuestos bancarios", etc. = filas nuevas en `bank_categories`. |
| **Gráfico de egresos** | `caja/index.tsx:688` (Pie + acordeón) lee de `feed` (= `caja_movements`) | **Automático:** todo `caja_movement` con categoría aparece. Galicia entra ahí → aparece solo. |

### ¿Tabla `galicia_movements` o directo a `caja_movements`?
**Recomendación: tabla staging `galicia_movements`** (espejo de `mp_xlsx_movements`), y de ahí reconciliar a `caja_movements`. Razones:
- **Dedup robusto** (clave del extracto, ver §4).
- **Guardar el crudo** (concepto, leyendas, comprobante, saldo) → necesario para las reglas y para re-clasificar si cambian.
- **Re-clasificar** sin re-subir el archivo.
- Mismo modelo de dos capas que MP (staging `mp_xlsx_movements` → categorizado `caja_movements`). Consistencia.

Estructura sugerida `galicia_movements`: `id (clave dedup, PK)`, `fecha`, `descripcion`, `concepto`, `leyendas` (concat), `comprobante`, `debito`, `credito`, `saldo`, `tipo_movimiento`, `category_id` (FK, nullable), `synced_at`. La reconciliación a `caja_movements` usa `source_id='galicia:{id}'`, `type` = débito→egreso / crédito→ingreso, `amount`, `category`.

## 2. La vista compartida MP + Galicia

**Hoy:** Banco muestra solo MP (de `/api/mp/movements`, live). MP se categoriza con `PUT /api/mp/movements/:mpId/category` (que escribe `mp_movement_overrides` + `caja_movements`).

**Para la vista unificada**, dos opciones:
- **(a) Endpoint unificado** `/api/bank/movements?from&to` que devuelve **MP (live) + Galicia (de `galicia_movements`)** con un campo `origen: 'mp'|'galicia'`, cada uno con su `categoryId` y los campos para el picker. El front renderiza una sola lista; el `CategoryPicker` (ya existe, `bancos:190`) sirve igual; al categorizar, según `origen` llama al endpoint de MP o al nuevo de Galicia.
- **(b) Todo desde `caja_movements`** — pero MP se categoriza en vivo y no todos los movimientos MP están en `caja_movements` (solo los ya categorizados). → **(a) es la correcta:** unificar en un endpoint que junta ambas fuentes para la vista, manteniendo cada origen con su flujo de categorización.

**Estructura de datos de la vista (unificada):**
```
{ id, origen: 'mp'|'galicia', fecha, descripcion, contraparte, monto, isOutgoing,
  categoryId, categoryName, comprobante?, conceptoRaw? }
```

## 3. Categorías editables — ✅ ya existe, casi nada que tocar

La UI **ya está completa** (`bancos/index.tsx`): `CategoryPicker` (dropdown + "Agregar categoría", L190/236), dialog de nueva categoría (L910), mutación `POST /api/bank-categories` (L377). Endpoints GET/POST/PUT `/api/bank-categories`. **El usuario ya puede crear categorías y categorizar desde la UI.**

- **"Comisiones MP" vs "Comisiones Galicia":** son **dos filas distintas en `bank_categories`** (hoy hay una sola "Comisiones" con 314 movs = las de MP). Se crea "Comisiones Galicia" nueva; opcional renombrar la actual a "Comisiones MP". El modelo lo soporta sin cambios.
- **Corrección de categoría:** cambiar el `category_id` del movimiento (MP: `mp_movement_overrides` + reconcile; Galicia: `galicia_movements.category_id` + reconcile a `caja_movements`).

## 4. Detección de duplicados (período solapado)

Campos del extracto que identifican un movimiento: **Número de Comprobante + Fecha + monto (débito/crédito) + Saldo**. El **Saldo** (running balance) es casi único por línea, pero el comprobante puede venir vacío en algunos. **Clave de dedup propuesta (PK de `galicia_movements`):**
```
galicia:{fecha}:{comprobante|'-'}:{debito|credito}:{saldo}
```
o un **hash SHA1 de la fila completa** (fecha+desc+concepto+leyendas+débito+crédito+saldo) si el comprobante no es confiable. Al subir un período solapado, el `INSERT ... ON CONFLICT (id) DO NOTHING` ignora los ya cargados → **idempotente** (igual que `mp_xlsx_movements` dedupe por `mp_id`).

## 5. Clasificación automática + "aprendizaje"

**Recomendación: tabla de reglas `galicia_rules`** (no código), para que el usuario "enseñe":
```
galicia_rules: { id, match_concepto (texto/patrón), match_leyenda (texto/patrón, nullable),
                 category_id (FK), prioridad, origen: 'seed'|'aprendida', createdAt }
```
- **Seed inicial:** se cargan las reglas del alcance (DEB.AUTOM.→Seguros, COMITO→Comisiones Galicia, DEBITO DEBIN→Banco propio, LEY 25413→Impuestos bancarios, TRF…FEDERICO/JOAQUIN→Retiro socio, CREDITO PRESTAMO→Préstamo, etc.).
- **Al parsear:** por cada movimiento, buscar la primera regla que matchee (concepto + leyenda) por prioridad → asignar `category_id`. Si ninguna matchea → categoría vacía (el usuario la pone).
- **Aprendizaje:** cuando el usuario **corrige** la categoría de un movimiento, se **crea/actualiza una regla** `aprendida` (match por su concepto/leyenda → la categoría elegida) con prioridad alta. La próxima vez, ese concepto se sugiere solo. Es el mismo patrón que `bank_contacts` (identifica pagadores aprendidos).

## 6. El gráfico de egresos por categoría — automático

Sale de `caja/index.tsx:688` (`pieData`/`categoriaData`) que recorre `feed` (= `caja_movements` del período, filtrando `type==='egreso'` y excluyendo mercadería/proveedores con `EXCLUDE_FROM_PIE`). **Como Galicia entra a `caja_movements` con su categoría, aparece automáticamente** en el pie y el acordeón, con "Comisiones MP" y "Comisiones Galicia" separadas (son categorías distintas). **No hay que tocar el gráfico** — solo asegurar que el reconcile de Galicia escriba la categoría correcta.

## 7. Plan de construcción por partes (local, verificable)

| Paso | Qué | Toca plata/datos | Verificación |
|---|---|---|---|
| **1** | **Extraer helpers de parsing** a `server/xlsx-helpers.ts` (normHeader/parseDate/parseNum) sin cambiar MP | No (refactor) | MP sigue sincronizando igual |
| **2** | **Tabla `galicia_movements`** + migración idempotente | Esquema (sin datos) | tabla creada, MP intacto |
| **3** | **Parser Galicia** (CSV `;`/utf-8-sig + XLSX → filas normalizadas) — SIN guardar aún, solo devuelve el parseo | No (lectura) | subir el extracto de ejemplo → parsea 194 movs correctos (débito/crédito/concepto/leyendas) |
| **4** | **Tabla `galicia_rules` + seed** de las reglas del alcance | Esquema + datos seed | reglas cargadas |
| **5** | **Clasificador**: aplica reglas al parseo → categoría sugerida | No (lectura) | los 194 movs clasificados; mostrar cuántos por categoría y cuántos sin clasificar |
| **6** | **Upload + guardar**: endpoint con `multer` (o archivo en body) → inserta en `galicia_movements` con dedup + reconcilia a `caja_movements` | **SÍ (escribe caja_movements)** | subir ejemplo → N movs en caja; re-subir solapado → 0 duplicados |
| **7** | **Vista compartida**: endpoint unificado MP+Galicia + front que lista ambos categorizables | Lectura (categorizar sí escribe) | ver MP y Galicia juntos; categorizar uno de cada origen |
| **8** | **Aprendizaje**: al corregir categoría → crear/actualizar `galicia_rules` aprendida | SÍ (reglas) | corregir un concepto → re-subir → se sugiere la categoría aprendida |
| **9** | **Categorías nuevas** ("Comisiones Galicia", "Seguros", etc.) + separar "Comisiones MP" | Datos (categorías) | aparecen en el gráfico separadas |

**Partes que tocan plata/datos (más cuidado):** paso 6 (escribe `caja_movements` — verificar dedup y montos), paso 8 (reglas que afectan clasificaciones futuras). Los pasos 1-5 son lectura/refactor (bajo riesgo). **Cada paso se prueba en local antes de seguir; el upload (6) con un extracto de ejemplo y verificación de que no duplica ni descuadra el gráfico.**

→ **Orden recomendado: 1→2→3→4→5 (todo lectura/esquema, sin riesgo) → 6 (el que escribe, con verificación de dedup) → 7 (vista) → 8-9 (aprendizaje + categorías).** El grueso del valor (clasificar Galicia y verlo en el gráfico de egresos para la neta) llega en el paso 6-7.

**Solo lectura. Nada construido.**

---

# 🔴 Doble conteo de obligaciones + categorías duplicadas (diagnóstico, solo lectura, 2026-06-24)

> **Solo lectura.** El usuario vio el alquiler dos veces en el gráfico de egresos. Causa: **marcar una obligación como pagada crea un `caja_movement` (gasto), y el MISMO pago vuelve a entrar por el extracto de Galicia** → doble. Decisión B2: obligaciones = **recordatorio** (no gasto); el gasto lo cuenta solo el banco (Galicia/MP).

## 1. Categorías duplicadas

- **En `bank_categories`: ninguna duplicada** por may/min.
- **En `caja_movements` SÍ:** `"alquiler"` y `"Alquiler"` (2 movs, $4.739.135). De dónde sale cada una:
  - `"Alquiler"` ($2.369.568) → **de Galicia** (`caja_movement #1293`, `source_id=galicia:…`, concepto "TRF INMED PROVEED" a STEFAN).
  - `"alquiler"` ($2.369.567) → **de la obligación #15 pagada** (`caja_movement #377`, manual, sin source_id).
- **La causa de la duplicación de categoría:** las obligaciones crean el `caja_movement` con `category = ob.tipo` (texto libre del tipo, ej. `"alquiler"`, `"proveedor"`), mientras Galicia usa las categorías formales (`"Alquiler"`, `"Pago a proveedor"`). → mismo gasto, dos nombres.

## 2. Cómo funciona hoy el pago de una obligación (`PATCH /api/caja/obligaciones/:id`, routes.ts:2516)

Al marcar pagada (modo `montoPagado`):
1. `storage.payObligacion` → UPDATE obligación (`estado='pagado'`) + INSERT `obligacion_pagos` (atómico, M8).
2. Si la cuenta de pago **no es MP**: `createMovimientoCuenta` (egreso) → afecta el **saldo** de la cuenta (Sistema A).
3. Si **no es MP**: **`createCajaMovement({ type:'egreso', category: ob.tipo, amount: montoARS })`** (routes.ts:2594) → **ESTE es el gasto** que aparece en el feed/gráfico de egresos (Sistema B).

→ **El paso 3 es el que genera el doble conteo:** crea un gasto por cada obligación pagada por banco, y ese mismo pago vuelve a entrar como movimiento de Galicia.

## 3. El doble conteo real en los datos

- **Alquiler (confirmado, visible):** `obl#15 "Alquiler galpón" $2.369.567` pagada (11-jun, cuenta 2=Galicia) → `caja_movement #377 "alquiler"`. **Y** Galicia trae `#1293 "Alquiler"` (TRF a STEFAN, 10-jun). **$2.369.567 contado DOS veces** (y como "alquiler" no está excluido del pie, **se ve en el gráfico**).
- **14 obligaciones pagadas = $20.924.567 en `caja_movements` manuales** (category de tipo-obligación). **La mayoría son cheques a proveedores** (Sanjuaninos, JCB, Adrián Rotelli) que en Galicia aparecen como **"ECHEQ 48 HS"** categorizados **"Pago a proveedor"** → también doble conteo.
  - **PERO:** los de proveedor (`"proveedor"` y `"Pago a proveedor"`) **ya están EXCLUIDOS del gráfico de egresos** (ambos contienen "proveedor") y son costo de mercadería (excluidos de la neta). → su doble conteo **no se ve en el gráfico ni infla la neta**.
  - **El único doble conteo que IMPACTA hoy es el alquiler** (gasto operativo real, no excluido). Cualquier obligación futura de gasto operativo (servicios, impuestos, sueldos pagados por banco) tendría el mismo problema.

## 4. Impacto de cambiar a B2 (obligación = recordatorio, no gasto)

Si al pagar una obligación **por banco** ya no se crea el `caja_movement`:
- **Se elimina el doble conteo** (el gasto lo cuenta solo Galicia/MP). ✓
- **Lo que cambia:** el feed/gráfico de egresos deja de recibir el gasto desde la obligación; lo recibe desde el extracto. **Para gastos pagados por banco no se rompe nada** (el extracto los trae).
- **⚠️ El hueco a cuidar — pagos en EFECTIVO:** una obligación pagada con **efectivo NO viene en ningún extracto**. Si no se crea el `caja_movement`, ese gasto **desaparecería**. → **B2 debe distinguir:** pago por **banco** (Galicia/MP) = no crea gasto (lo trae el extracto); pago por **efectivo** = SÍ crea el gasto (es la única fuente). Hoy las 14 obligaciones pagadas son todas TRANSFERENCIA (banco), pero el flujo debe contemplar el efectivo.
- **Saldo (`movimiento_cuenta`):** solo importa para **Efectivo** (única cuenta con saldo real; Galicia no lleva saldo, MP va por API). Mantenerlo para efectivo; para banco es inocuo (no se muestra).
- **No hay reportes que dependan de la obligación-como-gasto** salvo el feed de egresos, que pasa a alimentarse del extracto.

## 5. Datos históricos ya cargados

- **14 `caja_movements` de obligaciones pagadas ($20,9M)** que duplican con Galicia. Para limpiar:
  - **Alquiler:** borrar `#377 "alquiler"` (queda el de Galicia `#1293 "Alquiler"`).
  - **Cheques a proveedores:** borrar los `caja_movements` de obligación `category="proveedor"` (quedan los ECHEQ de Galicia). *(Bajo riesgo visible: ya estaban excluidos del pie, pero conviene limpiar para que la neta no los cuente doble.)*
  - **Criterio de borrado seguro:** borrar los `caja_movements` **sin `source_id`** que correspondan a obligaciones pagadas **por banco** y que tengan su contraparte en Galicia. Los pagados por **efectivo** se conservan.
- **Categoría:** normalizar `"alquiler"` → `"Alquiler"` (y revisar otras variantes al unificar).

## 6. Propuesta de implementación B2 (limpia, sin romper ni doble-contar)

**A) Flujo nuevo de pago de obligación** (datos nuevos):
- Marcar pagada → UPDATE estado + `obligacion_pagos` (igual). **Saca del recordatorio.**
- **NO** crear `caja_movement` si la cuenta de pago es **banco** (Galicia/MP) → el gasto lo trae el extracto/API.
- **SÍ** crear `caja_movement` si la cuenta es **Efectivo** (única fuente para efectivo).
- `movimiento_cuenta` (saldo): solo para Efectivo.
- (Revertir a pendiente: borrar lo que se haya creado, como hoy.)

**B) Limpieza de históricos** (una vez, reversible/verificada):
- Borrar los `caja_movements` de obligaciones pagadas por banco que duplican con Galicia (empezando por el alquiler `#377`).
- Conservar los de efectivo (si los hubiera).

**C) Categorías:**
- Normalizar variantes may/min en `caja_movements` (`"alquiler"`→`"Alquiler"`).
- Con B2, las obligaciones dejan de crear categorías (ya no generan `caja_movement`), así que **no se generan más duplicados** de raíz. La obligación usa su `tipo` solo como recordatorio.

**Orden sugerido:** 1) cambiar el flujo de pago (no crea gasto para banco) → 2) limpiar los históricos duplicados (alquiler primero, verificar el gráfico) → 3) normalizar categorías. Cada paso con verificación de que el total de egresos baja exactamente lo esperado (sin el doble).

**Solo lectura. Nada tocado.**
