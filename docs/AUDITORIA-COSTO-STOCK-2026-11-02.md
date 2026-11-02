# Cómo se calcula hoy el costo del stock — 02/11/2026

Diagnóstico de solo lectura, pedido por Joaquín para decidir si el método es el correcto.

## Respuesta corta

El sistema usa **promedio ponderado móvil** (WMA) desde el 15/06/2026 (commit `ed155da`, ver `AUDITORIA-COSTOS.md` §21).
FIFO quedó eliminado: la función vieja `_recomputeCostFromStock` sigue en `server/storage.ts` pero nadie la llama.
El comentario de `storage.ts` que dice "El modelo de costo único del sistema es FIFO" (sobre `recalcAllStockCosts`)
quedó viejo: es anterior al cambio.

## Las reglas, tal como están en el código

| Momento | Qué pasa con el stock | Qué pasa con el costo | Dónde |
|---|---|---|---|
| Compra | suma los kg (o la unidad base) | nuevo costo = (stock × costo actual + cantidad × precio) ÷ (stock + cantidad) | `createPurchase` |
| Compra con stock en 0 | suma | arranca de cero con el precio de esa compra | misma fórmula |
| Compra a $0 (bonificación) | suma | no cambia | `newCost === 0` conserva |
| Venta (aprobar pedido) | resta (piso 0) | no cambia; la línea guarda el costo vigente | `approveOrder` |
| Pedido borrador | — | muestra el costo del momento (se recalcula) | `getOrder` |
| Pedido aprobado | — | costo congelado (remito inmutable en costos) | regla de negocio |
| Venta en envase (bolsa, cajón) | resta kg = envases × kg por envase | costo por envase = costo del kg × kg que trae (de la última compra en ese envase) | `_getCostForUnit` |
| Aprobar sin stock suficiente | — | el sistema pregunta: costo $0, rinde (costo histórico) o prorrateo | `checkOrderStock` |
| Editar una compra | ajusta stock por diferencia | des-mezcla el promedio; si esa mercadería ya se vendió, conserva el costo | `updatePurchase` |

## Ejemplo real: MORRON ROJO, 22/10 al 30/10

Compras (cada una cambia el costo promedio; el stock previo sale del historial de costos):

| Fecha | Stock antes | Compra | Precio $/kg | Costo antes | Costo después |
|---|---|---|---|---|---|
| 22/10 | 11,4 kg | 32 kg | 12.500 | 11.320 | 12.190 |
| 23/10 | 39,4 kg | 14 kg | 8.571 | 12.190 | 11.241 |
| 26/10 | 23,9 kg | 40 kg | 5.625 | 11.241 | 7.726 |
| 28/10 | 19,0 kg | 21 kg | 3.571 | 7.726 | 5.545 |
| 29/10 | 18,0 kg | 35 kg | 3.714 | 5.545 | 4.336 |
| 02/11 | ~3 kg | 42 kg | 5.714 | 4.336 | 5.622 |

Ventas del mismo período, costo con el método actual vs. cómo habría dado con FIFO (simulado sobre los mismos
movimientos):

| Día | Kg vendidos | Promedio $/kg | FIFO $/kg |
|---|---|---|---|
| 22/10 | 4,0 | 12.190 | 11.320 |
| 23/10 | 29,5 | 11.241 | 12.204 |
| 26/10 | 22,2 | 7.726 | 10.323 |
| 27/10 | 22,7 | 7.726 | 5.846 |
| 28/10 | 22,0 | 5.545 | 5.345 |
| 29/10 | 2,0 | 4.336 | 3.571 |
| 30/10 | 50,5 | 4.336 | 3.669 |
| **Total** | **152,9** | **$1.076.877** | **$1.077.188** |

Diferencia total: $311 sobre $1,08 millones (0,03 %). Día por día, en cambio, la diferencia llega a ±30 %.

## Lectura

- Cuando el stock rota (se vende y se repone en días), los dos métodos terminan dando el mismo costo total.
  Lo que cambia es **cómo se reparte entre los días**: el promedio suaviza; FIFO sigue el precio de cada lote.
- Con promedio, el margen de un pedido puntual puede verse peor (o mejor) que el "real" del lote que salió,
  durante uno o dos días después de un salto de precio. En la semana se compensa.
- FIFO exige que el orden físico de salida coincida con el del sistema y que el stock esté exacto; un error de
  carga del galpón lo desvía. El promedio tolera mejor esos errores.
- El punto que más afecta la exactitud en cualquiera de los dos métodos es que **el stock del sistema sea el
  real**: si no se carga la merma, el sistema cree tener más kg viejos y el precio viejo pesa más en el promedio.
  También conviene cargar la compra antes de aprobar los pedidos que la usan.
