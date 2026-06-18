# Auditoría — Hallazgos MENORES (m1–m7) — clasificación (solo lectura, 2026-06-18)

> **Solo lectura. No se tocó nada.** Estado real hoy de cada menor + clasificación por riesgo/esfuerzo/beneficio.
> **Conclusión adelantada:** **ningún bug latente grave**. Varios menores ya se resolvieron de paso (timezone casi todo mitigado con ancla `T12:00`, comisión MP derivada del fee real, históricos de vendedor son DB-backed no hardcodeados). Los `/api/debug` y `/api/mp/*` **NO son agujero de seguridad**: el default-deny por rol (M1) los deja solo para admin (vendedor/galpón → 403). Lo que queda son limpiezas rápidas (console.logs/endpoints debug, helpers duplicados) y dos refactors grandes de bajo beneficio (partir archivos, code-splitting).

---

## 1. Estado real de cada menor

### m1 — Archivos gigantes
- `storage.ts` **5899 LOC**, `routes.ts` **3434 LOC**, `migrate.ts` 1306, `schema.ts` 577. **Sigue presente** (crecieron con los módulos nuevos). No es un bug; es mantenibilidad.

### m2 — Bundle front >500kB sin code-splitting
- **Sigue presente.** `vite.config.ts` sin `manualChunks`/`rollupOptions`; **0 `React.lazy`/`import()` dinámicos** en el cliente. Todo el front es un solo chunk → warning de >500kB en cada build. Solo afecta el tiempo de carga inicial.

### m3 — N+1 potenciales
- **Presente pero acotado.** ~63 loops `for…of` en `storage.ts`; varios hacen una query por iteración (ej. `approveOrder` por ítem, `reconcileInventory` resuelve costo por ítem, sync de precios a peers). **N es chico** (ítems de un pedido / productos de un inventario), así que el impacto práctico es bajo. No hay N+1 sobre listados grandes servidos a alta frecuencia.

### m4 — Helpers duplicados + mezcla fetch/apiRequest
- `fmt` definido **localmente en 14 archivos** (mismo formateo de moneda). `normalize` en **2** (`orderParser.ts` lo **exporta**; `stock.tsx` tiene su propia copia). Mezcla `fetch()` directo (**28 archivos**) vs `apiRequest()` (**23**). **Presente.** Pura prolijidad; sin efecto funcional.

### m5 — Restos de `new Date(str)` con timezone
- **Casi todo MITIGADO.** La gran mayoría de los display usa el patrón anti-corrida `new Date(fecha + "T12:00:00")` / `"T00:00:00"` (ancla a mediodía/medianoche local → no se corre el día). Restos sin ancla encontrados:
  - `dashboard.tsx:809/863` → `new Date(row.created_at)`: `created_at` es **timestamp real con hora** → `toLocaleDateString` da la fecha AR correcta. **Sin riesgo.**
  - `caja/index.tsx:717` → `new Date(cuenta.saldo_base_fecha)`: `saldo_base_fecha` es **TIMESTAMP** (no date-only), así que tiene hora real → sin corrida. **Sin riesgo.**
  - Server: `new Date(data.purchaseDate)` / `new Date(body.orderDate)` al **guardar** — conversión de entrada, comportamiento histórico estable.
- → **No encontré ningún lugar que hoy muestre una fecha corrida un día.** El patrón de bug (date-only sin ancla en display) ya no está vivo en los puntos calientes.

### m6 — Valores hardcodeados
- **CUIT empresa** (`arca.ts:9` = `30718551842`) y **Punto de Venta 4** (`routes.ts:2106/2221/2239`): **constantes de la empresa** (un solo CUIT/PV). Hardcodear está **OK** — no cambian salvo que la empresa cambie de CUIT/PV (evento rarísimo que igual requeriría revisión fiscal). No es un bug; a lo sumo moverlos a env/config por prolijidad.
- **Comisión MP "0.6%"**: **NO existe como tasa hardcodeada.** La comisión se **deriva del `feeAmount` real** que reporta MP (charges de la API / fee del XLSX). No hay un `0.006` mágico. **Resuelto / nunca fue un problema.**
- **Históricos de vendedor**: **NO hardcodeados.** Son override **en DB** (`storage.ts:1249` "Override de histórico para un vendedor en un mes"; `routes.ts:1708-1714` los usa si el rango es un mes con histórico cargado). **Resuelto.**

### m7 — console.logs de debug y endpoints /debug
- **console.log server: 26.** Desglose:
  - **Debug leftover (borrables):** `storage.ts:5409/5410/5412/5479` (`[contacts-storage]`, `[upsert-verify]`), `routes.ts:3051/3052/3053` (`[contacts] matched keys / candidatos`). → ~7 puramente de debug.
  - **Logging operativo (útil, intencional):** `[mp] paginación`, `[caja reconcile]`, `[mp-xlsx merge]`, `[mp-sync]`, `index.ts:70` (request logger), `seed.ts` (script). → observabilidad de la integración MP; conviene **dejar** (o gatear con flag).
  - **Sensibles en logs:** `arca.ts:191/210` loguean el **SOAP completo** (payload + respuesta de ARCA: CUIT, montos, CAE). Va solo a **logs del servidor** (no al usuario), pero es verboso/sensible → conviene gatearlo detrás de un flag de debug.
- **console.log cliente: 0** (solo un `.test-examples.ts`, no entra al bundle).
- **Endpoints diagnósticos:** `/api/debug/product-cost` (`:150`), `/api/mp/test` (`:2677`), `/api/mp/raw`, `/api/mp/balance`, `/api/mp/income-diag`. **Todos `requireAuth` + admin-only** por el default-deny (ver §4).

---

## 2. Clasificación en 3 grupos

### 🟢 RÁPIDOS Y SEGUROS (riesgo casi nulo)
| Item | Qué | Esfuerzo |
|---|---|---|
| m7 | Borrar los ~7 `console.log` de debug puro (`[contacts-storage]`, `[upsert-verify]`, `[contacts] matched/candidatos`) | Muy bajo |
| m7 | Gatear los logs sensibles de ARCA (`arca.ts:191/210`) detrás de `if (process.env.ARCA_DEBUG)` | Bajo |
| m7 | Borrar/cerrar los endpoints diagnósticos que ya no se usan (`/api/mp/test`, `/api/debug/product-cost`, `/api/mp/raw`, `/api/mp/income-diag`) — reduce superficie aunque sean admin-only | Bajo |
| m4 | Unificar `fmt` → un helper compartido (`lib/format.ts`) y reemplazar en los 14 archivos | Bajo-medio (mecánico, 14 archivos) |
| m4 | Unificar `normalize` (usar el exportado de `orderParser`, borrar la copia de `stock.tsx`) | Muy bajo |

### 🟡 TOCAN ALGO SUTIL (riesgo bajo-medio, verificar)
| Item | Qué | Por qué cuidado |
|---|---|---|
| m5 | Repasar los `new Date()` sin ancla restantes (los 3 identificados son seguros hoy; si se quieren blindar, agregar ancla) | Cambia cómo se muestra una fecha → verificar visualmente que no se corre |
| m3 | Optimizar N+1 puntuales (batch de queries en loops de `approveOrder`/`reconcile`) | Toca flujos críticos (aprobar/inventario); hay que verificar que el resultado no cambie. Beneficio real bajo (N chico) |
| m4 | Migrar `fetch()` directo → `apiRequest()` en los 28 archivos | Cambia manejo de errores/credenciales; verificar caso por caso |
| m6 | Mover CUIT/PV de ARCA a env/config | Es fiscal: un error de PV emite con punto de venta equivocado → verificar contra ARCA |

### 🔴 REFACTORS GRANDES (mucho trabajo, beneficio práctico bajo hoy)
| Item | Qué | Realidad |
|---|---|---|
| m1 | Partir `storage.ts` (5.9k) y `routes.ts` (3.4k) en módulos | No cambia nada para el usuario; mucho riesgo de romper imports/transacciones. Solo mantenibilidad |
| m2 | Code-splitting del bundle (`React.lazy` por ruta + `manualChunks`) | Mejora la carga inicial, pero la app es interna (pocos usuarios, red estable) → beneficio marginal |

---

## 3. ¿Algún bug latente escondido entre los menores?

**No encontré ninguno activo.**
- **Timezone (m5):** el patrón de corrida (date-only sin ancla en display) **ya no está vivo** en los puntos calientes; los restos sin ancla operan sobre **timestamps reales** (con hora) → la fecha AR sale bien. No hay fecha corrida un día hoy.
- **Hardcodeados (m6):** CUIT/PV son constantes legítimas de la empresa (no cambian); comisión MP se deriva del fee real (no hay tasa mágica); históricos de vendedor son DB-backed. Nada que se rompa "si cambia un número".
- El único riesgo *fiscal* teórico sería el **PV hardcodeado**: si algún día se factura desde otro punto de venta, hay que tocar 3 lugares en código. Hoy con PV único, **está bien**.

## 4. Seguridad — ¿endpoints /debug exponen datos sensibles en prod?

**No hay agujero.** Detalle:

| Endpoint | Qué expone | Auth | Alcance real |
|---|---|---|---|
| `/api/debug/product-cost` | costos/compras/movimientos por nombre de producto | `requireAuth` | **admin-only** |
| `/api/mp/test` | status de 3 URLs de la API de MP (balance/payments/merchant_orders) con el token | `requireAuth` | **admin-only** |
| `/api/mp/raw`, `/api/mp/balance`, `/api/mp/income-diag` | datos crudos/diagnóstico de MP | `requireAuth` | **admin-only** |

- El **default-deny por rol** (M1, `ROLE_API_WHITELIST` en `routes.ts:63`) limita **vendedor** a `/api/vendedor/` y **galpón** a `/api/galpon/`. Cualquier otro `/api/*` → **403**. Por lo tanto `/api/debug` y `/api/mp/*` **devuelven 403 a vendedor/galpón**; solo **admin** (que ya ve todo) los alcanza.
- → **No es escalada de privilegios ni fuga de datos** hacia roles restringidos. Son **restos diagnósticos** que conviene **borrar por higiene** (reducir superficie, no dejar `/api/mp/test` con el token), pero **no son una vulnerabilidad hoy**.
- Ningún endpoint diagnóstico es público (todos pasan por `requireAuth` + el middleware de sesión activa).

## 5. Recomendación

- **Hacer ya los 🟢 RÁPIDOS Y SEGUROS** (borrar console.logs de debug, gatear ARCA, borrar endpoints diagnósticos sin uso, unificar `fmt`/`normalize`). Riesgo casi nulo, dejan el código y los logs más limpios y reducen superficie.
- **Mirar con lupa los 🟡** solo si molestan: m5 ya está sano (opcional blindar), m3 beneficio bajo, m6 (CUIT/PV a config) solo si se planea multi-PV.
- **Dejar documentados los 🔴** (partir archivos, code-splitting) — como se hizo con la evaluación de C2: laburo grande, beneficio marginal para una app interna. No tocar salvo que duela.

**Solo lectura. Nada tocado.**

---

## 6. ✅ TANDA 1 (🟢 limpieza) RESUELTA (2026-06-18, commit `e7b3626`)

- **Endpoints diagnósticos borrados (sin callers):** `/api/debug/product-cost`, `/api/mp/test`, `/api/mp/raw`, `/api/mp/income-diag`. **Conservados** `/api/mp/balance` (usado en `bancos/index.tsx:282`) y `/api/mp/movements` (usado). 0 referencias colgadas.
- **console.log de debug borrados (7):** `[contacts-storage]` ×3 + `[upsert-verify]` (con su query extra) en storage.ts; `[contacts]` resumen/matched/candidatos ×3 en routes.ts. **Conservados** los logs operativos de la sync MP (`[mp]`, `[caja reconcile]`, `[mp-xlsx merge]`, `[xlsx-contacts]`, request logger) y todos los `console.warn`/`console.error`.
- **Logs de ARCA gateados:** los 2 `console.log` que imprimían el SOAP completo (CUIT + montos) ahora corren solo con `DEBUG_ARCA` seteado. Apagado por defecto → sin datos fiscales en logs de prod. Lógica de emisión intacta.

**Verificado:** build (vite+esbuild) ✓; 0 referencias colgadas; diff de `arca.ts` solo toca las condiciones de log (axios.post/return intactos) → facturación idéntica. −150 líneas, +4. Sin lógica de negocio tocada.

**Pendiente (cuando se decida):** Tanda 2 🟢 (unificar `fmt` en 14 archivos + `normalize` ×2). 🟡 y 🔴 quedan documentados.
