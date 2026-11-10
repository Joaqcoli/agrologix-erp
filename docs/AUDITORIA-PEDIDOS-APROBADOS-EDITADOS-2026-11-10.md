# Auditoría — ¿Se modifican los montos de pedidos aprobados? (2026-11-10)

Pregunta de Joaquín: entró a pedidos viejos y vio valores distintos a los que tenía antes. Una vez cerrado el remito,
los montos no deberían cambiar porque la cuenta corriente se arma con ellos.

Solo lectura: no se cambió código ni datos. Los listados con pedidos y clientes concretos quedaron fuera del repo
(se los pasé a Joaquín en el chat / scratchpad de la sesión).

## Respuesta corta

1. **No hay ningún proceso automático que reescriba precios de pedidos aprobados.** La propagación de precios entre
   clientes del mismo grupo (`updateOrderItem`, `approveOrder`) solo toca pedidos `draft`; el sync de costos de compras
   solo toca `draft`; el galpón solo puede editar `draft` (`galponAssertDraft`); facturación no escribe en `orders`.
2. **Lo que sí existe es la edición manual de pedidos aprobados desde la pantalla de Pedidos (admin y administrativo).**
   La pantalla lo permite explícitamente (`canEdit = isDraft || isApproved`, aviso "Pedido aprobado. Hacé clic en el
   lápiz o en cualquier celda para editar una línea. El stock se ajusta automáticamente") y el servidor no lo frena
   (`PATCH/POST/DELETE /api/orders/:id/items/*` con `requireAuth`, sin chequeo de estado). Precio, cantidad, unidad,
   producto, alta y baja de líneas: todo editable después del cierre, sin registro de quién ni de cuánto era antes.
3. **Pasa seguido**: en los últimos 6 meses, 161 de 1.676 pedidos aprobados (≈10 %) tuvieron una edición de precio
   después de aprobarse. Cambios reales (precio distinto al anterior): 24–29 pedidos por mes, la mayoría ya facturados.
4. **Efecto en la cuenta corriente**: la facturación de la CC se calcula en vivo desde las líneas del pedido
   (`cantidad × precio`, con IVA si corresponde), no desde un valor congelado. Cualquier edición posterior cambia la CC
   del mes del pedido de forma retroactiva, aunque el remito, la factura y los pagos ya existan.

## Evidencia (base de producción, 10/11/2026)

### Precio editado después de aprobar

Fuente: `price_history` del propio cliente con fecha > `approved_at` + 2 min. Se cuentan solo cambios **reales**
(precio nuevo ≠ último precio registrado para esa línea; re-guardar el mismo precio no cuenta).

| Mes | Pedidos | Líneas | De esos, ya facturados |
|---|---|---|---|
| 2026-05 | 14 | 31 | 10 |
| 2026-06 | 29 | 71 | 22 |
| 2026-07 | 6 | 8 | 6 |
| 2026-08 | 28 | 82 | 25 |
| 2026-09 | 24 | 84 | 13 |
| 2026-10 | 28 | 82 | 21 |
| 2026-11 (al 10) | 3 | 4 | 3 |

Patrón: tandas de varios pedidos y clientes en pocos minutos (p. ej. 30/10 entre 10:06 y 10:24 hora AR), casi siempre
subas de $1.000–$14.000 por unidad sobre pedidos ya facturados, algunas hasta 8 días después del cierre; también un
precio puesto en $0 después de facturar. El 70 % de las ediciones de los últimos 3 meses fue entre las 9 y las 10 de la
mañana. `price_history` no guarda usuario, así que no se puede decir quién las hizo; los únicos logins que pueden
hacerlo son los de rol admin y administrativo.

### Facturas cuyo total ya no coincide con lo que hoy suman sus pedidos

5 facturas en 6 meses (tolerancia $5), con diferencias de $30.000 a $55.000 por factura. Son pocas porque la mayoría de
las ediciones post-cierre se hacen antes de facturar, o la factura agrupa varios pedidos. El sistema incluso prevé el
caso: en un pedido facturado que hoy vale menos aparece "El pedido se modificó después de facturar" con botón para
emitir una nota de crédito por la diferencia (`NcDiferenciaBlock`). O sea: editar después de facturar es un flujo
contemplado por el diseño actual.

### Otros chequeos (descartados como causa)

- `orders.total` = suma de subtotales en el 100 % de los aprobados (0 diferencias). Las listas usan ese total.
- 20 líneas de 18 pedidos (ago–sep) con `subtotal ≠ cantidad × precio` ($35.705 en total): secuela de la condición
  de carrera vieja de `updateOrderItem` (ya corregida, ver comentario "brócoli VA-001203"). Para esos 18 pedidos, la
  lista de Pedidos (usa `subtotal`) y la CC (usa `cantidad × precio`) muestran totales levemente distintos. Los 18
  pedidos históricos importados (PV-HIST-*) tienen precio neto y subtotal con IVA a propósito; se excluyen de todo.
- Movimientos de stock de un pedido creados > 2 min después de aprobarlo: 0 (las ediciones de cantidad post-cierre
  ajustan stock sin dejar un movimiento fechado, así que no se pueden contar por esta vía).
- IVA: 43 clientes tienen `has_iva` sin `iva_since`. Para ellos el IVA se aplica a **todos** sus pedidos, también
  los anteriores. Si a un cliente se le marcó IVA después de tener pedidos, esos pedidos viejos pasaron a mostrarse
  con IVA en la CC sin que nadie los editara. No hay historial de cuándo se marcó, así que no se puede medir.
- Los dos pedidos a los que les cargué precios por script el 06/11 se tocaron antes de aprobarse (11:33 vs 12:30 AR).

## Causa raíz

El sistema trata al pedido aprobado como editable ("el stock se ajusta automáticamente") y la cuenta corriente lo
recalcula en vivo. No hay un "cierre" real: ni bloqueo, ni foto de los montos al aprobar o facturar, ni registro de
quién cambió qué. Cualquier edición posterior (intencional o por error, por ejemplo abrir un pedido viejo mientras se
cargan precios de hoy) mueve la CC del mes correspondiente sin dejar rastro.

## Plan propuesto (a confirmar antes de implementar)

1. **Bloquear precio, cantidad, unidad, producto, alta y baja de líneas en pedidos aprobados**, en el servidor
   (`updateOrderItem`, `addOrderItem`, `deleteOrderItem` → error "Pedido cerrado") y en la pantalla (las celdas dejan
   de ser editables; quedan alias y notas). Galpón ya está bloqueado.
2. **"Reabrir pedido"** solo para admin, con motivo obligatorio: pasa el pedido a un estado editable y, al volver a
   cerrar, guarda en una tabla de auditoría usuario, fecha, motivo y cada línea antes → después. El pedido muestra un
   aviso "Modificado después del cierre el DD/MM por X", visible también desde la CC.
3. Opcional: foto del total al aprobar (`orders.total` ya existe y hoy se mantiene igual a las líneas); con 1 y 2 el
   total deja de moverse sin pasar por reapertura.

Qué NO cambia: cobranzas, retenciones, facturación, remitos, propagación de precios a borradores, edición de borradores.
Las 161 ediciones pasadas no se revierten (no hay valor "antes" guardado para cantidades/líneas; para precios está en
`price_history`, revisable caso por caso si Joaquín lo pide).
