# Auditoría de Caja — diagnóstico (solo lectura, 2026-06-15)

> **Solo lectura. No se modificó nada.** Diagnóstico para ordenar la caja y decidir el plan.
> Reparto del negocio (Joaquín): ~70% MercadoPago (integrado), ~25% Galicia (a mano, sin API), ~5% efectivo.
> **Conclusión adelantada:** la caja "da cualquier número" por **3 causas sumadas** — (1) los saldos iniciales de las cuentas están todos en **$0**, (2) MercadoPago vive en un sistema **aparte** que no se suma a las cuentas, y (3) las **transferencias internas** ("Banco propio") se cuentan como ingreso/egreso del negocio.

---

## 1. Cómo está modelada la caja hoy — TRES sistemas paralelos

| Sistema | Tablas | Para qué sirve | Lo alimenta |
|---|---|---|---|
| **A) Cuentas financieras** ("dónde está mi plata") | `cuentas_financieras` (saldo_base) + `movimientos_cuenta` | Saldo por cuenta y **disponible total** | cobros, pagos, cheques, manual, obligaciones |
| **B) Caja ingresos/egresos** (reportes) | `caja_movements` + `payments` + `supplier_payments` | `/api/caja/summary`, `/balance`, `/trend` (por método/categoría) | cobros de clientes, pagos a proveedores, movimientos manuales |
| **C) MercadoPago** (integración) | `mp_xlsx_movements` + API MP en vivo | Vista MP propia (`/api/mp/*`), balance live | la **API de MercadoPago** (auto-sync) |

**El problema de fondo: estos 3 sistemas NO están integrados entre sí.** El "disponible total" sale de A; los reportes de ingresos/egresos salen de B; MP vive en C. Cada uno cuenta cosas distintas con tablas distintas.

### Cuentas que existen hoy (`cuentas_financieras`)
| # | Nombre | tipo | saldo_base | saldo_base_fecha |
|---|---|---|---|---|
| 1 | Mercado Pago | `mp` | **$0** | NULL |
| 2 | Galicia | `banco` | **$0** | NULL |
| 3 | Efectivo | `efectivo` | **$0** | 2026-06-01 |
| 4 | Cheques en cartera | `cheque` | **$0** | NULL |

### Cómo se calcula el saldo de cada cuenta
`getCuentasFinancieras` (storage.ts:5478): por cuenta,
```
saldo = saldo_base + Σ(movimientos_cuenta ingreso − egreso  con fecha > saldo_base_fecha)
```
En el front (`caja/index.tsx:333`), `getSaldoActual(c)`:
- `mp` → `saldo_base + ajuste + mpDelta` (mpDelta = balance live de la API MP)
- `cheque` → suma de cheques en cartera
- resto → `saldo_base + ajuste`

**Disponible total** (`caja/index.tsx:737`) = suma de `getSaldoActual` de las cuentas **que no son cheque** (MP + Galicia + Efectivo).

## 2. El problema del saldo inicial — el campo EXISTE, está en $0

**No falta el concepto: `cuentas_financieras` ya tiene `saldo_base` + `saldo_base_fecha`**, y existe todo el mecanismo para setearlo:
- Endpoint: `PUT /api/caja/cuentas/:id` con `{ saldo_base }` → `updateCuentaFinanciera` (storage.ts:5503), que setea `saldo_base` y `saldo_base_fecha = NOW()`.
- UI: en `caja/index.tsx` ya hay un botón de editar saldo por cuenta (línea 706).

**El problema es de DATO, no de modelo: las 4 cuentas tienen `saldo_base = $0`** y nunca se cargó el real. Como el saldo se descuenta sobre $0, da negativo/cualquier cosa.

**Cómo impacta el cálculo:** al setear `saldo_base = X` con fecha = hoy, el saldo pasa a contar **solo los movimientos posteriores a esa fecha** (el filtro `mc.fecha > saldo_base_fecha`). Es decir: "confío en este número HOY y de acá en adelante sumo/resto". Es el mecanismo correcto para arrancar de un saldo real sin arrastrar historia inconsistente. **(Solo hay que cargar el número real de cada cuenta a una fecha dada — no hace falta tabla/campo nuevo.)**

## 3. Cómo entra MercadoPago hoy (lo que ya funciona)

**Es API-driven, no upload manual** (`server/mp-report-sync.ts`, `syncMpReport`):
1. Pega a la **API de MercadoPago** (`api.mercadopago.com`) con el token: trae pagos (para identificar pagadores) y **genera un "release report" on-demand en XLSX**, lo descarga y lo parsea con la lib `xlsx`.
2. Extrae filas útiles (ingresos + extracciones de efectivo/CVU) y las **upsertea en `mp_xlsx_movements`** (hoy **824 filas**).
3. El balance MP se muestra en vivo desde la API (`/api/mp/balance`) + esa tabla.

**MP NO crea `movimientos_cuenta`.** Es más: los cobros de cliente se asignan a cuenta **"solo banco/efectivo, nunca MP"** (routes.ts:1342, comentario explícito). → La cuenta "Mercado Pago" del Sistema A **no recibe los ingresos de MP**; su `ajuste` solo tiene 4 `pago` (egresos, neto −$1.013.700). El MP real está en C, no en A.

## 4. La carga por XLSX que ya existe — ¿reusable para Galicia?

**El PARSING es reusable; el ORIGEN no.** Lo reusable (en `mp-report-sync.ts`): la lib `xlsx`, `normHeader` (normaliza encabezados), `parseXlsxDate`/`parseXlsxTimestamp` (fechas DD/MM/YYYY e ISO), `parseNum` (coma decimal), y el patrón de **mapeo de columnas por nombre** (`col(exact, fallback)`).

**Lo que NO sirve tal cual:** MP **descarga su propio archivo desde la API**; Galicia **no tiene API** → su extracto lo baja Joaquín a mano. Para Galicia haría falta:
- Un **endpoint de UPLOAD** (multer / archivo en el body) que reciba el Excel de Galicia. **Hoy NO existe** (no hay `multer` ni endpoint de subida de archivo; `xlsx`/`exceljs` solo se usan para el reporte MP y para exportar).
- Un **mapeo de columnas propio de Galicia** (fecha, descripción, débito/crédito, saldo) — el del MP es específico de su formato.
- Insertar las filas como `movimientos_cuenta` de la cuenta Galicia (#2) con `origen_tipo` (ej. `galicia_xlsx`) y dedupe por un id de fila (como `mp_xlsx_movements` dedupe por `mp_id`).

→ **Es factible y el patrón está**, pero es desarrollo nuevo (upload + parser Galicia + dedupe), no un "reusar el de MP tal cual".

## 5. Cómo se carga Galicia hoy (a mano)

Por el formulario de **movimiento manual**: `POST /api/caja/movements` (routes.ts:2301). Crea un `caja_movement` (Sistema B) y —si se elige una cuenta— **también** un `movimiento_cuenta` (Sistema A, `origen_tipo='manual'`). Joaquín tipea **uno por uno**: fecha, tipo (ingreso/egreso), monto, descripción, categoría y cuenta. Hoy Galicia (#2) tiene solo **6 `movimientos_cuenta`** (cobros/obligaciones/cheques) → claramente **incompleta** (un extracto de Galicia tiene decenas de líneas por mes). El trabajo manual es alto y por eso está sub-cargada.

## 6. Movimientos entre cuentas propias (transferencias internas)

**No existe el concepto de "transferencia interna" en el modelo.** `movimientos_cuenta.origen_tipo` admite `cobro|pago|manual|cheque|deposito|obligacion` — no hay `transferencia`. `caja_movements` solo tiene `type=ingreso|egreso` + `category` (texto libre), sin flag de "interno".

**Cómo se maneja hoy (ad-hoc):** con la categoría de texto **"Banco propio"**. En los datos: `[ingreso] Banco propio: 15 mov ($3.435.000)` y `[egreso] Banco propio: 2 mov ($370.000)`. Son pases entre cuentas propias (ej. Galicia → MP de Vegetales).

**El problema:** `getCajaSummary` (Sistema B) suma **TODOS** los `caja_movements` como ingreso/egreso del negocio (storage.ts:4981-4986), **sin excluir "Banco propio"**. → esos $3.435.000 de "Banco propio" **inflan los ingresos reales** del negocio, aunque no sean ventas. Para el saldo POR CUENTA (Sistema A) está bien que sean egreso de una + ingreso de otra; pero para ingresos/egresos del NEGOCIO no deberían contar. **Falta una marca de "transferencia interna" que las excluya de los totales de negocio.**

## 7. Por qué da "cualquier número" — causas concretas

1. **Saldos iniciales en $0** (las 4 cuentas). El disponible se descuenta sobre cero → da negativo/irreal. *(Causa principal del "disponible total".)*
2. **MercadoPago no está en las cuentas.** La cuenta MP (Sistema A) no recibe los ingresos de MP (los cobros saltean MP a propósito); el MP real (70% del negocio, 824 movs) vive en el Sistema C aparte. El "disponible total" prácticamente **ignora MP** salvo el `mpDelta` live, que arranca de un `saldo_base=$0`/fecha NULL.
3. **Galicia sub-cargada** (solo 6 movimientos a mano vs. un extracto completo). Faltan movimientos → el saldo de Galicia es parcial.
4. **Transferencias internas contadas como negocio.** "Banco propio" ($3,4M ingresos) infla los ingresos en los reportes (Sistema B).
5. **Tres sistemas que no concilian** (A vs B vs C cuentan cosas distintas con tablas distintas) → según qué pantalla mires, el número no coincide.
6. **Posible doble conteo en reportes:** hay `caja_movements` categoría "Cobro de cliente" (20, $6,9M) **y** la tabla `payments` (203). Si un cobro se registró en ambos lados, `getCajaSummary` lo cuenta dos veces. *(A verificar en detalle al armar el plan.)*

## 8. Hacia el plan (para decidir juntos — nada aplicado)

1. **Saldos iniciales:** cargar el `saldo_base` real de cada cuenta a una fecha de corte (el mecanismo ya existe: `PUT /api/caja/cuentas/:id` + UI). Es lo de **mayor impacto y menor riesgo**.
2. **MercadoPago en el disponible:** decidir si la cuenta MP toma su saldo del balance live de la API (ya hay `mpDelta`) con un `saldo_base`/fecha bien seteados, para que MP entre al "disponible total" de forma correcta.
3. **Galicia por Excel:** construir el **upload + parser de Galicia** (reusando el parsing del MP) → cargar el extracto como `movimientos_cuenta` de Galicia, con dedupe. Reemplaza la carga a mano.
4. **Transferencias internas:** agregar una **marca de "transferencia interna"** (categoría reservada o flag) que mueva saldo entre cuentas (Sistema A) **sin** contar como ingreso/egreso del negocio (Sistema B).
5. **(Conciliación)** evaluar unificar/concordar los 3 sistemas y revisar el posible doble conteo cobros (`caja_movements` vs `payments`).

**Solo lectura. Nada tocado.**

---

# 🔄 FOTO ACTUAL (re-diagnóstico solo lectura, 2026-06-22)

> **Solo lectura. Nada tocado/conciliado.** Estado real de la base HOY vs. el diagnóstico del 2026-06-15. **Conclusión:** el modelo no cambió; se cargaron 2 saldos de prueba ínfimos pero **Galicia sigue en $0** y el **disponible total da −$3,3M (negativo, sin sentido)**. Los 6 problemas siguen vigentes; ninguno se resolvió.

## 1. Cuentas financieras HOY (`cuentas_financieras`)

| # | Nombre | tipo | saldo_base ANTES (15-jun) | **saldo_base HOY** | fecha | Cambió |
|---|---|---|---|---|---|---|
| 1 | Mercado Pago | `mp` | $0 / NULL | **$4.398** | 15-jun | ✅ cargado, pero **ínfimo** (MP es ~70% del negocio) |
| 2 | Galicia | `banco` | $0 / NULL | **$0** | NULL | ❌ **SIGUE EN $0** |
| 3 | Efectivo | `efectivo` | $0 | **$35.000** | 15-jun | ✅ cargado |
| 4 | Cheques en cartera | `cheque` | $0 / NULL | **$0** | NULL | ❌ sigue $0 |

→ **El usuario cargó saldos de prueba el 15-jun (MP $4.398, Efectivo $35.000)** pero NO los reales (MP debería ser millones). **Galicia y Cheques siguen en $0.**

## 2. Disponible total HOY = **−$3.292.269** (negativo, irreal)

| Cuenta | saldo_base | + movimientos | = saldo |
|---|---|---|---|
| Mercado Pago | $4.398 | 2 movs −$114.000 | **−$109.602** |
| Galicia | $0 | 7 movs −$3.217.667 | **−$3.217.667** |
| Efectivo | $35.000 | 0 movs | $35.000 |
| Cheques en cartera | $0 | 10 movs +$33.957.852 | $33.957.852 *(no entra al disponible)* |
| **DISPONIBLE TOTAL** (sin cheques, sin mpDelta live) | | | **−$3.292.269** |

→ **Galicia arrastra el disponible a negativo**: su `saldo_base=$0` pero tiene obligaciones/cobros (−$3,2M) cargados a mano sin el saldo real que los respalde. Sigue dando "cualquier número".

## 3. MercadoPago — sigue VIVIENDO APARTE

- **Cobros siguen "nunca MP"** (`routes.ts:1369`: "solo banco/efectivo, nunca MP"). La cuenta MP del Sistema A no recibe los ingresos de MP.
- `mp_xlsx_movements` hoy: **893 filas** (antes 824), rango hasta 2026-06-21, bruto **$76.966.077**. Ese MP real **NO entra al disponible** (la cuenta MP solo tiene base $4.398 + 2 pagos).
- **`mp_xlsx_movements.comision` está TODA en $0** (0 filas con comisión ≠ 0). Las comisiones reales se sincronizan a `caja_movements` categoría **"Comisiones"** (283 mov, $1.087.869) vía la reconciliación de Bancos.

## 4. Galicia — sigue sub-cargada, sin upload

- **7 `movimientos_cuenta`** hoy (antes 6): 4 obligación, 2 cobro, 1 cheque-destino. Un extracto Galicia mensual tiene decenas de líneas → **sigue incompleta**.
- **NO existe upload de Excel** (sin `multer` en package.json, sin endpoint de subida). Se sigue cargando **a mano** (`POST /api/caja/movements`).

## 5. Transferencias internas "Banco propio" — CRECIERON, siguen inflando

- Hoy: **`[ingreso] Banco propio: 25 mov $5.016.000`** + **`[egreso] Banco propio: 5 mov $2.890.000`** (antes ingreso 15/$3,4M + egreso 2/$370k → **creció**).
- **`getCajaSummary` (storage.ts:5190) las cuenta como ingreso/egreso del negocio**: `totalIngresos = sumPayments + sumManualIn` donde `sumManualIn` = TODOS los `caja_movements` ingreso **sin excluir "Banco propio"**. → infla los ingresos $5M. **Sigue sin marca de "transferencia interna"** (origen_tipo no tiene `transferencia`).

## 6. M7 / Doble conteo — mecanismo CONFIRMADO

- **`caja_movements` categoría "Cobro de cliente": 40 filas ($11.453.011), TODAS con `source_id`** → vienen del **sync de Bancos/MP** (ej. "Bank Transfer", "Viva Fit", "TODO CASERITO").
- **`payments`: 244 filas ($310.231.822)** — TRANSFERENCIA 170/$213M, CHEQUE 19/$73M, EFECTIVO 32/$18M, RETENCION 23/$5M.
- **`getCajaSummary` suma `payments` (todos) + `caja_movements` ingreso (todos, incl. los 40 "Cobro de cliente" del sync)** → si un cobro por transferencia/MP entró **como `payment` Y como `caja_movement` sincronizado**, se cuenta **dos veces**. El mecanismo de doble conteo está confirmado (falta el match 1-a-1 para cuantificar, pero la summary no deduplica).

## 7. ¿Qué cambió vs. 2026-06-15 y qué sigue?

| Problema (2026-06-15) | Estado HOY |
|---|---|
| Saldos iniciales en $0 | **Parcial**: MP/Efectivo con valores de prueba; **Galicia y Cheques siguen $0** → disponible aún negativo |
| MP no entra al disponible | ❌ **Igual** (cobros "nunca MP"; MP real aparte) |
| Galicia sub-cargada, sin Excel | ❌ **Igual** (7 movs a mano, sin upload) |
| "Banco propio" como negocio | ❌ **Peor** (creció a $5M ingreso + $2,9M egreso) |
| 3 sistemas no concilian | ❌ Igual |
| Doble conteo cobros | ⚠️ **Confirmado el mecanismo** (summary no deduplica payments vs caja_movements sync) |

→ **Ninguno se resolvió.** El modelo es el mismo; solo se tantearon 2 saldos.

## 8. Plan actualizado — el orden previo SIGUE siendo el correcto

1. **Saldos iniciales (mayor impacto / menor riesgo).** Cargar `saldo_base` REAL de cada cuenta a una fecha de corte — **empezando por Galicia (en $0) y corrigiendo MP/Efectivo** (hoy de prueba). Mecanismo ya existe (`PUT /api/caja/cuentas/:id` + UI). Esto solo ya arregla el "disponible total" negativo.
2. **MP al disponible.** Que la cuenta MP tome su saldo del balance live de la API (`mpDelta`) con `saldo_base`/fecha bien seteados, para que MP (70%) entre al disponible de forma correcta.
3. **Galicia por Excel.** Construir upload (`multer`) + parser de Galicia (reusa el parsing de MP) + dedupe → cargar el extracto como `movimientos_cuenta`. Reemplaza la carga a mano.
4. **Marca de transferencia interna.** Categoría/flag reservada que mueva saldo entre cuentas (Sistema A) **sin** contar como ingreso/egreso del negocio (Sistema B) → excluir "Banco propio" de `getCajaSummary`.
5. **Conciliar + doble conteo.** Deduplicar `payments` vs `caja_movements` sincronizados en `getCajaSummary`; evaluar unificar los 3 sistemas.

**Orden confirmado: 1 → 2 → 3 → 4 → 5** (impacto/riesgo). El #1 (saldos, sobre todo Galicia) es el arranque obvio: bajo riesgo, alto impacto, y desbloquea ver si el disponible empieza a tener sentido.

**Solo lectura. Nada tocado.**
