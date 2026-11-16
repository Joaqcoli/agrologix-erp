# Comisiones de vendedores: de "por facturado" a "devengada por pedido, habilitada por cobranza"

Fecha: 2026-11-16 · Fase 0 (diagnóstico y plan, sin cambios de código ni de datos).
Datos medidos en producción el 16/11 (agregados; sin nombres de clientes).

## 1. Cómo funciona hoy

- La comisión es un **% fijo por cliente** (`customers.commission_pct`, hoy 5 % en todos los asignados) y el
  vendedor es `customers.salesperson_name` (texto, tiene que coincidir con `users.name`).
- Se calcula **sobre lo facturado**: `% × cantidad × precio` (neto, sin IVA) de pedidos aprobados, por fecha de
  pedido. No existe ninguna relación con la cobranza.
- Lugares que la calculan (todos con la misma fórmula, repetida):
  - `GET /api/vendedor/dashboard` (KPI "Comisión" del período) · `storage.getVendedorMonthly` (gráfico mes a mes,
    con override histórico `VENDEDOR_HIST` para ene–mar 2026) · `GET /api/vendedor/orders` (comisión por pedido en
    la lista del vendedor, calculada en el front con `commissionPct × total`).
  - Admin: `storage.getDashboardStats` punto 9 ("Comisiones vendedores" del período) y
    `storage.getCommissionDetail` + `getSalespersons` (modal "Detalle de Comisiones" con PDF).
- No hay tabla de liquidaciones ni registro de qué se pagó al vendedor.
- No hay "fecha de alta" del cliente a efectos de comisión. `customers.created_at` no sirve: los clientes
  importados tienen `created_at` 09/03/2026 y pedidos desde el 31/01/2026.

## 2. Cobranza e imputación a pedidos (lo que el esquema nuevo necesita)

- Cada pago (`payments`) se vincula a pedidos en `payment_order_links` con `amount_applied`.
  - **Desde octubre 2026, el 100 % de los pagos tiene vínculos** (178/178). Si en el modal no se eligen
    remitos, `autoApplyPaymentToOrders` lo imputa solo al pedido impago más viejo (FIFO). **La regla 3 del
    pedido ("pago sin imputación clara → pedido impago más viejo") ya está implementada en la carga.**
  - Los vínculos con `amount_applied` NULL (48 desde octubre) son casi todos de pagos tipo `RETENCION` o
    `DIFERENCIA` y de un efectivo grande; el motor de la CC los resuelve con un reparto secuencial.
  - Antes de octubre hay pagos sin vínculo (Juan: 20 pagos, $18,7 M): no afectan porque los pedidos de Juan
    hasta el 31/10 quedan saldados y Ceci arranca en octubre.
- El cálculo de "cuánto cobrado tiene cada pedido" ya existe en `storage.getPendingOrdersForCustomer`:
  vínculos explícitos primero, el resto (pagos sin vínculo, sobrantes y `opening_balance`) como pool FIFO
  del pedido más viejo al más nuevo, sobre el **total con IVA** del pedido. Las sedes se resuelven ahí
  (padre + hijos): el pago está en el padre y el pedido en la sede (21 pagos / 197 vínculos así desde octubre).
- Limitación de ese motor para comisiones: el pool FIFO se aplica como un monto único, **no sabe qué pago
  (y por lo tanto qué fecha de cobranza) cubrió cada pedido**. Para liquidar por mes de cobranza hace falta
  repartir el pool pago por pago, en orden de fecha. El total cubierto por pedido es el mismo, así que la CC
  no cambia.

## 3. Datos de los dos vendedores

Juan (usuario id 3, rol vendedor): 47 clientes asignados (44 activos). Uno está cargado como `JUAN` en
mayúsculas (queda fuera de su vista hoy) y 3 tienen 0 % (ninguno con pedidos).

| Juan, pedidos aprobados | cantidad | total neto |
|---|---|---|
| Octubre 2026 | 86 | $21,8 M |
| Noviembre (al 16/11) | 46 | $8,4 M |

| Cobranza de noviembre de clientes de Juan, según a qué pedido se imputó | pagos | monto |
|---|---|---|
| Pedidos de octubre o anteriores (saldados → sin comisión) | 10 | $3,25 M |
| Pedidos de noviembre (comisionan) | 3 | $0,62 M |

Antigüedad: 41 de los 47 clientes de Juan tienen su primer pedido antes de octubre → alta 01/10/2026 (5 % hasta
el 31/03/2027). Los 5 con primer pedido desde octubre arrancan ese día; 1 no tiene pedidos.

Ceci: **no tiene usuario**. Hay 3 clientes con `salesperson_name = 'Ceci'` (5 %), los tres con primer pedido el
09/10/2026, 10 pedidos aprobados desde octubre por $3,08 M y 6 pagos ($1,6 M: $1,4 M en octubre, $0,2 M en
noviembre). Los tres están dentro de los 6 meses → 5 %.

## 4. Diseño propuesto

### 4.1 Datos nuevos (migración en `server/migrate.ts`, aditiva)

| Dónde | Campo | Para qué |
|---|---|---|
| `customers` | `comision_alta date` | Fecha de alta a efectos de comisión. Se fija una vez y no se recalcula. |
| `orders` | `comision_pct numeric(5,2)` | % fijado al crear el pedido (5 o 1). NULL = cliente sin vendedor. |
| `orders` | `comision_saldada boolean` | Transición Juan: pedidos hasta el 31/10 marcados, no generan comisión por cobranza. |
| `comision_liquidaciones` | id, vendedor, periodo `YYYY-MM`, total, cerrada_at, cerrada_by | Cabecera de cada cierre mensual. |
| `comision_liquidacion_items` | liquidacion_id, order_id, payment_id, fecha_cobro, cobrado, pct, comision | Detalle congelado del cierre. |

Relleno inicial (una sola vez, con script verificable):
- `comision_alta`: primer pedido ≥ 01/10/2026 → esa fecha; cliente que ya existía antes de octubre → 01/10/2026;
  cliente nuevo sin pedidos → NULL (se fija con su primer pedido).
- `orders.comision_pct` para todos los pedidos existentes de clientes con vendedor, según alta y fecha de pedido.
- `comision_saldada = true` en los pedidos de clientes de Juan con fecha ≤ 31/10/2026.
- Normalizar `JUAN` → `Juan`. `customers.commission_pct` deja de usarse (queda, sin leerse).

Reglas en código:
- Al crear un pedido (los dos puntos de inserción en `storage.ts`): si el cliente no tiene `comision_alta`, se
  fija con la fecha del pedido; luego `comision_pct = 5` si `order_date < alta + 6 meses`, si no `1`. Red de
  seguridad: al aprobar, si quedó NULL y el cliente tiene vendedor, se fija ahí. Cambiar la fecha del pedido
  después no cambia el %.
- Fecha de paso al 1 % = `alta + 6 meses` (01/10/2026 → 01/04/2027: 5 % hasta el 31/03 inclusive).

### 4.2 Motor de cobranza por pedido (nuevo, en `storage.ts`)

`allocateCobranzas(customerIds)` devuelve filas `(payment_id, fecha_pago, order_id, aplicado)`:
1. Mismo paso 1 que la CC: vínculos explícitos con `amount_applied`; sin monto → reparto secuencial.
2. Pool (pagos sin vínculo, sobrantes, menos `opening_balance`) repartido **pago por pago en orden de fecha**
   al pedido más viejo con saldo. El total cubierto por pedido coincide con el motor actual, por eso
   `getPendingOrdersForCustomer` **no se toca** (se verifica con un script comparando ambos para los 102
   clientes antes del deploy).
3. Vendedor y % salen del pedido (cliente del pedido, no del pago → las sedes quedan bien).

Comisión habilitada de un pedido = `comision_pct × base × (aplicado / total con IVA)`, acumulada por pago.
Pendiente de cobranza = `comision_pct × base − habilitada`. Nunca vence.

### 4.3 Liquidación mensual

- Botón "Cerrar mes" (solo admin) en el modal "Detalle de Comisiones" del dashboard: toma, por vendedor, todas
  las habilitaciones con fecha de pago ≤ fin del período **que no estén en ningún cierre anterior** y las
  congela en `comision_liquidaciones` + items. Idempotente; un cobro cargado tarde entra en el cierre siguiente.
- Un cierre es inmutable. Si después se borra o edita un pago ya liquidado, la diferencia aparece como ajuste
  (negativo) en el cierre siguiente; se muestra en pantalla.
- El override `VENDEDOR_HIST` (ene–mar 2026) sigue solo para el gráfico histórico.

### 4.4 Pantallas

Vendedor (en su sesión, nueva entrada "Comisiones" en el menú):
- Resumen del mes: **habilitadas este mes** y **pendientes de cobranza**.
- Por cliente: alta, % vigente, fecha exacta de baja al 1 %, facturado, cobrado, saldo pendiente.
- Por pedido: monto, % aplicado, comisión habilitada, comisión pendiente (link al detalle del pedido).
- Histórico de liquidaciones cerradas con su detalle.
- Dashboard y lista de pedidos del vendedor: el KPI "Comisión" pasa a significar "habilitada por cobranza" (hoy
  es facturado × %); mismo lugar, otra fuente. La ficha de cliente del vendedor muestra alta y fecha de baja.
Admin:
- Ficha del cliente (`customers.tsx`): fecha de alta (editable) y fecha de paso al 1 % calculada; el campo
  "% Comisión" se reemplaza por eso.
- Dashboard "Comisiones vendedores" del período y modal de detalle: pasan a habilitadas por cobranzas del
  período + botón "Cerrar mes" + lista de cierres.
Roles: el vendedor sigue sin ver costos ni márgenes; las rutas nuevas van bajo `/api/vendedor/` (whitelist).

### 4.5 Orden de trabajo

1. Migración + relleno + motor + rutas + pantallas, con Juan como caso real. Verificación en producción con un
   usuario temporal y con la sesión de Juan: cada pedido de noviembre con su % y lo habilitado por los 3 pagos
   de noviembre; los de octubre en $0 por saldados.
2. Cuenta de Ceci (rol vendedor, `name = 'Ceci'` para que matchee sus 3 clientes), sin pedidos saldados: su
   primer cierre incluye las cobranzas de octubre.

## 5. Decisiones que necesita Joaquín (se asume la primera opción si no dice otra cosa)

1. **Base de la comisión**: neto sin IVA, como hoy. (Alternativa: con IVA.)
2. **Retenciones y "DIFERENCIA"** cuentan como cobranza: saldan el pedido, así que habilitan comisión por esa
   parte. (Alternativa: solo dinero que entra.)
3. **Cliente que existía antes de octubre pero sin pedidos**: alta 01/10/2026 (regla literal). (Alternativa:
   la fecha de su primer pedido; es más justo con el vendedor.)
4. **Cliente con vendedor y 0 % hoy** (uno activo, sin pedidos): con el esquema nuevo comisionaría al 5 %. Si
   no debe comisionar, hay que sacarle el vendedor.
5. **Si se reasigna un cliente a otro vendedor**, las cobranzas futuras de pedidos viejos van al vendedor
   actual (simple). (Alternativa: guardar el vendedor en el pedido al crearlo.)
6. **Contraseña de Ceci**: la creo con una provisoria y se la paso a Joaquín por el chat (no queda en el repo).
