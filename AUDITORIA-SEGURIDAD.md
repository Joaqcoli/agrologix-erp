# Auditoría de Seguridad — M1: Enforcement de roles incompleto (solo lectura, 2026-06-15)

> **Solo lectura. No se modificó código, no se agregaron middlewares.** Diagnóstico para decidir el enfoque.
> Hallazgo central: hay **seguridad real solo para el rol `galpon`**. El rol **`vendedor` (y `operator`) puede llegar al backend de caja, bancos, costos, proveedores, facturación y comisiones**, porque 131 de 152 endpoints usan solo `requireAuth` (chequea sesión, no rol). La UI lo esconde; el backend no.

---

## 1. Mapa de protección de los 152 endpoints

| Nivel | Cantidad | Qué chequea | Quién pasa |
|---|---|---|---|
| `requireGalpon` | 10 | sesión + rol | `galpon` o `admin` |
| `requireVendedor` | 8 | sesión + rol | `vendedor` o `admin` |
| `requireAuth` | **131** | **solo sesión (NO rol)** | **cualquier usuario logueado** |
| Sin middleware (público) | 3 | nada | todos (`/api/auth/login`, `/logout`, `/me`) |

**Los middlewares (server/routes.ts:35-73):**
- `requireAuth` → solo `if (!req.session.userId) 401`. **No mira el rol.**
- `requireVendedor` / `requireGalpon` → rol específico **o admin**.
- **Default-deny SOLO para `galpon`** (routes.ts:67-73): si el rol es `galpon`, solo se permite `/api/galpon/*` y `/api/auth/*`; todo lo demás 403 — **aunque el endpoint use solo `requireAuth`**. Esta es la pieza de seguridad real.
- **NO existe `requireAdmin`.** **NO existe default-deny para `vendedor`.** → el vendedor NO está contenido en el backend.

## 2. Qué puede ver hoy un VENDEDOR (Juan) que no debería

Juan, logueado, **NO está bloqueado por ningún default-deny**. Puede pegarle a mano (curl / DevTools / cambiar la URL) a cualquiera de los 131 endpoints `requireAuth` y **el backend le responde con los datos**. Lo más sensible accesible hoy:

| Grupo | # | Ejemplos concretos | Dato expuesto |
|---|---|---|---|
| **caja** | 21 | `/api/caja/summary`, `/balance`, `/movements`, `/cuentas`, `/cheques`, `/obligaciones`, **`/retiros`**, **`/socios`** | Caja completa, cuentas, cheques, **retiros y datos de socios** |
| **mp** | 6 | `/api/mp/balance`, `/movements`, `/income-diag` | Saldo y movimientos de MercadoPago |
| **bank-*** | 8 | `/api/bank-contacts`, `/bank-categories`, `/bank-payment-links` | Contactos, categorías y links de pago bancarios |
| **ap** | 7 | `/api/ap/cc/summary`, `/cc/:id`, `/payments`, `/pending-purchases/:id` | Deuda con proveedores (cuentas por pagar) |
| **suppliers** | 5 | `/api/suppliers`, `/suppliers/:id` | Proveedores y su CC |
| **invoices** | 5 | `/api/invoices`, `/invoices/create`, `/:id/credit-note` | Facturación electrónica (¡puede emitir/ver facturas!) |
| **products** | 14 | `/api/products` (incluye `averageCost`) | **Costos de productos** |
| **dashboard** | 5 | `/api/dashboard/stats`, `/bolsa-fv` | Ventas globales, **márgenes** |
| **purchases** | 7 | `/api/purchases`, `/purchases/:id` | Compras con **costos** y proveedor |
| **commissions** | 2 | `/api/commissions/salespersons`, `/detail` | Comisiones de todos los vendedores |
| **withholdings** | 2 | `/api/withholdings` | Retenciones |
| **ar / payments** | 7 | `/api/ar/*`, `/api/payments/:id` | Cuentas por cobrar / pagos |

→ **En criollo:** un vendedor con un mínimo de curiosidad técnica puede leer la **caja, los retiros de socios, el saldo de MercadoPago, la deuda con proveedores, los costos y márgenes de todos los productos, y la facturación**. Es el hallazgo que más pesa.

## 3. El rol OPERATOR

- El enum `role` arrancó como `('admin', 'operator')` (migrate.ts:9); `operator` es el rol "staff" histórico, anterior a `vendedor`/`galpon`.
- **No hay NINGUNA lógica específica de `operator`** en el código (solo aparece en el seed y en tipos). No lo bloquea ningún default-deny, y pasa todos los `requireAuth`.
- → **Hoy `operator` = acceso total de datos, igual que admin** (solo no entra a `/api/vendedor/*` ni `/api/galpon/*`). Parece ser el diseño asumido (operador = personal de confianza con acceso pleno), pero **conviene que lo confirmes**: si el operador también debe limitarse, hay que definir su lista blanca (decisión de producto, aparte de cerrar al vendedor).

## 4. Qué NO hay que romper (lo más importante para no joder al vendedor)

**La vista del vendedor consume EXCLUSIVAMENTE `/api/vendedor/*` + `/api/auth/*`.** Verificado barriendo `client/src/pages/vendedor/`:
- `/api/vendedor/dashboard`, `/dashboard-monthly`, `/dashboard-extra`
- `/api/vendedor/orders`, `/orders/:id`
- `/api/vendedor/customers`, `/customers/:id`
- (`/api/auth/me` vía `lib/auth.tsx`, global a todos los roles)

**No consume ningún endpoint general** (`/api/orders`, `/api/products`, `/api/caja`, etc.). → Cerrar al vendedor con una lista blanca `/api/vendedor/*` + `/api/auth/*` **no rompe nada de su trabajo normal**. (Esto es exactamente lo que ya hicimos con el galpón.)

## 5. Opciones para cerrar M1

### (a) `requireAdmin` selectivo en los endpoints sensibles
Crear un middleware `requireAdmin` y ponerlo en caja, bancos, costos, proveedores, facturación, etc.
- **Riesgo de romper:** bajo para admin/operator (es aditivo), pero **alto de dejar un agujero**: hay que enumerar y no olvidar ninguno de ~80 endpoints sensibles; cualquiera que falte sigue filtrando. Whack-a-mole.
- **Esfuerzo:** medio-alto (triage de los 131, decidir caso por caso, y mantenerlo en cada endpoint nuevo).

### (b) Default-deny por rol (como el galpón) — **RECOMENDADA**
Un middleware: si `rol === 'vendedor'`, solo permitir `/api/vendedor/*` + `/api/auth/*`; el resto 403. Idéntico al bloque que ya corre para `galpon`.
- **Riesgo de romper:** **casi nulo** — está **probado** que la vista del vendedor solo usa esa lista blanca. Y es **a prueba de futuro**: cualquier endpoint nuevo queda denegado por defecto (no hay que acordarse de protegerlo).
- **Esfuerzo:** mínimo (~5 líneas, copiar el patrón del galpón).

### (c) Tabla rol→whitelist (generalización de (b))
Unificar los dos default-deny (galpon + vendedor) en un solo middleware con un mapa `{ galpon: ['/api/galpon/','/api/auth/'], vendedor: ['/api/vendedor/','/api/auth/'] }`.
- **Riesgo:** igual de bajo que (b); además deja un único lugar para sumar roles/limitar al `operator` después.
- **Esfuerzo:** chico (un pelín más que (b), refactor del galpón incluido).

## 6. Endpoints MÁS sensibles (prioridad si se hace por etapas)

1. **`/api/caja/*`** (21) — caja, cuentas, cheques, obligaciones, **`/caja/retiros` y `/caja/socios`** (retiros de socios). *Lo primero.*
2. **`/api/mp/*`, `/api/bank-contacts/*`, `/api/bank-categories/*`, `/api/bank-payment-links/*`** (14) — bancos / MercadoPago.
3. **`/api/ap/*`, `/api/suppliers/*`** (12) — deuda y datos de proveedores.
4. **`/api/invoices/*`** (5) — facturación electrónica y notas de crédito.
5. **`/api/withholdings/*`, `/api/commissions/*`, `/api/payments/*`, `/api/ar/*`** — fiscal / financiero.
6. **`/api/products/*`** (costos/márgenes), **`/api/dashboard/*`** (stats), **`/api/purchases/*`** (costos).

## 7. Recomendación

**Opción (b)/(c): default-deny por rol, igual que el galpón.** Para el vendedor es **airtight y está probado que no rompe su vista** (solo usa `/api/vendedor/*` + `/api/auth/*`). Es el **mismo patrón ya en producción** para galpón → consistente, mínimo código, y a prueba de olvidos (a diferencia de (a), que es whack-a-mole). Con (c) además queda un solo lugar para, más adelante, decidir qué limitar del `operator`.

**Sobre etapas:** con default-deny **no hace falta etapas para el vendedor** — es un solo middleware que cierra todo de una. El `operator` es una **decisión aparte** (definir si se limita y con qué lista blanca).

**Solo lectura. Nada tocado.**
