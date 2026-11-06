# Costo "manual" que no se cargó a mano — 06/11/2026

Caso: pedido 2869 (colegio del grupo Black Pot), ESPINACA 12 ATADO con costo $8.000 el atado. El costo real del atado hoy es
$541,67 (promedio ponderado: la última compra fue 14 cajones de 12 atados a $6.500). $8.000 es el costo del **cajón** de ayer
(12 × $666,67). Solo lectura; no se cambió nada.

## Cómo se decide el costo de una línea

1. Al crear la línea se guarda `cost_per_unit` con el costo vigente para esa unidad (`_getCostForUnit`).
2. Mientras el pedido es borrador, la pantalla **no** muestra ese valor guardado: lo recalcula en vivo según el stock actual
   (`getOrder` → `_costFromCtx`). Al aprobar se vuelve a calcular y se guarda definitivo (`approveOrder`).
3. Excepción: si la línea tiene `override_cost_per_unit` ("costo manual", se ve como *Manual* en la pantalla), ese valor
   manda sobre todo lo anterior, en borrador y aprobado, y en toda la ganancia.

## Qué pasó en el 2869

- El bot cargó anoche "1 cajón + 2 atados" de espinaca (snapshot `antes_galpon`). La línea del cajón quedó con costo $8.000
  (12 × $666,67, el promedio de ayer). Hoy pasó a ser 12 ATADO y quedó con **costo manual $8.000**.
- Nadie tipeó 8000. El editor de línea de la pantalla Pedido (`client/src/pages/orders/detail.tsx`, `handleFieldChange`)
  hace esto al cambiar la unidad: pide al servidor el costo de la unidad nueva (`/api/products/:id/cost-for-unit`) y lo
  escribe en el campo **Costo**. Al guardar, `changedDraftFields` compara cada campo con el valor inicial: el costo ya no es
  el inicial, así que lo manda como `overrideCostPerUnit`. El servidor lo guarda como costo manual (`updateOrderItem`).
  Es decir: **cambiar la unidad en pantalla congela el costo como "manual" sin que nadie lo haya tocado.**
- Las consultas al servidor son asincrónicas y no se cancelan: si la unidad se toca dos veces (cajón → atado, o se pasa por
  cajón en el desplegable), puede ganar la respuesta del cajón ($8.000) aunque la unidad final sea atado. Así quedó este caso.
- Desde ese momento ni el stock, ni la compra de hoy, ni la aprobación corrigen el costo: el manual manda.

## ¿Pasa con otros productos? Sí

Líneas aprobadas con costo manual, últimos 60 días (sin Bolsa FV): **527 líneas en 270 pedidos**.

| Grupo | Líneas | Lectura |
|---|---|---|
| Costo manual **igual** al costo automático de la línea | 357 | No fue una decisión: es el costo que la pantalla rellenó sola al cambiar unidad. Por ahora no distorsiona la ganancia (coincide), pero quedó congelado. |
| Costo manual **distinto** (> 1 %) | 149 | 147 parecen cargados a propósito (valores redondos: 40.000, 20.000, 5.333…). 2 coinciden con el costo de otra unidad del mismo producto (mismo mecanismo que espinaca, pedido 2181 del 08/09). |
| De los distintos, diferencia > 30 % | 57 (46 pedidos) | Mezcla de manuales deliberados y casos como el de espinaca; no se pueden separar con certeza. |

Productos con más costos manuales: cebolla de verdeo 44, apio 37, batata Brasil 26, tomate perita 21, morrón rojo 20, puerro 19,
papa blanca Jujuy 17, champignon 17, espinaca 16. Son justamente los que el galpón o la pantalla pasan de cajón/atado a kg
(o al revés): cada cambio de unidad en pantalla deja el costo "manual".

Borradores de hoy con costo manual: solo la espinaca del 2869.

Hallazgo secundario (no causa este caso): `updateOrderItem` solo recalcula `cost_per_unit` guardado cuando cambia el
**producto**, no cuando cambia la **unidad** (igual que pasaba con el precio hasta el arreglo `7670308`). En borradores no se
nota porque la pantalla y la aprobación recalculan en vivo; solo afecta el "costo" de la lista de pedidos (`getOrders` usa el
valor guardado) hasta que se aprueba.

## Plan propuesto (Fase 1)

1. **Pantalla** (`detail.tsx`): el costo que la pantalla rellena sola al cambiar la unidad no cuenta como cambio del usuario.
   Se actualiza también el valor de referencia (`orig.cost`), así solo viaja `overrideCostPerUnit` cuando alguien tipea un
   costo. Además, si llegan dos respuestas de costo, solo se usa la de la unidad que quedó seleccionada.
2. **Servidor** (`updateOrderItem`): al cambiar la unidad de una línea en borrador, recalcular también el `cost_per_unit`
   guardado (misma regla que el precio). Aprobados no se tocan.
3. **Datos**: en el 2869, quitar el costo manual de la espinaca y dejar el automático ($541,67 el atado). Los 357 aprobados con
   manual igual al automático no cambian nada en la ganancia y los pedidos aprobados son inmutables: no se tocan. Los 2 casos
   del 08/09 quedan como están salvo que Joaquín pida corregirlos.
