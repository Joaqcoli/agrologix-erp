# Chequeo de pedidos: unidades mal cargadas y precios de venta — 04/11/2026

Diagnóstico de solo lectura (Fase 0). Joaquín reportó tres cosas: (1) pedidos que piden bolsas y se cargan
en kg, (2) precios de venta que "se traen mal" para algunos productos/clientes, (3) los colegios de Black Pot
no reciben el último precio. Medido sobre la base de producción, últimos 45–60 días. No se cambió nada.

## Resumen

| # | Qué pasa | Causa raíz | Dónde | Cuánto |
|---|---|---|---|---|
| 1 | El bot carga "1 cajón" como 1 KG o 1 UNIDAD | La **memoria del cliente** pisa la unidad escrita por el cliente | `server/interpret-order.ts:242-250` | 6 renglones en 45 días, todos por memoria; el resto de las 4.689 líneas interpretadas respeta la unidad escrita |
| 2 | Al cambiar la unidad de una línea (galpón o pantalla), el precio queda el de la unidad vieja | `updateOrderItem` conserva el precio cuando cambia `unit` | `server/storage.ts:1962-1974` | 358 cambios de unidad en 45 días; 7 aprobados con el precio de la unidad vieja. El peor: pedido 2834, manzana roja elegida, 1 cajón cobrado a $6.000 (precio del kg) en vez de $86.000 |
| 3 | Black Pot: colegios del mismo día con precios distintos | La propagación de precios al aprobar solo toca **borradores**; los pedidos ya aprobados ese día quedan con el precio viejo. Y el punto 2 | `server/storage.ts:2508-2530` | 4 casos en 779 combinaciones día+producto+unidad (30 días): manzana roja 04/11 (punto 2), repollo colorado 20/10, manzana granny y pepino 12/10 |

Lo que NO encontré: un error sistemático en el precio que el servidor asigna al crear el pedido. En 60 días,
8.190 líneas aprobadas tenían un precio previo del grupo; 2.380 (29 %) se crearon con un precio distinto al
último aprobado, pero eso es casi siempre un cambio de precio deliberado (los precios cambian a diario). Solo 69
líneas "volvieron" a un precio anterior al último (reversión), repartidas entre 30 clientes, y varias son bajas de
precio intencionales. Para afinar esto hacen falta 2 o 3 ejemplos concretos (cliente, producto, fecha).

## 1. Unidades: cómo se decide hoy

1. **El bot / Carga Pedido (IA)**: `interpretOrder` recibe el texto, el catálogo con las unidades de cada producto,
   el historial del cliente y la **memoria del cliente** (`customer_product_memory`: renglones que el equipo ya
   confirmó o corrigió al responder una duda). Regla del prompt: la unidad escrita por el cliente se respeta.
2. **Validación** (`validateProposal`): si el renglón coincide con una entrada de memoria, **la memoria manda**:
   reemplaza producto **y unidad**, y marca la línea como "ok" sin duda. La comparación (`claveRenglon`) borra
   números y unidades del texto, así que "Mandarina 1 cajón" y "mandarina 1 kg" son el mismo renglón.
3. **Galpón**: al armar, pesa lo que vino en UNIDAD/ATADO y lo pasa a KG con el peso real (ej. "repollo 4
   unidades" → 5,3 KG). Es intencional. También corrige unidades mal cargadas (mandarina KG → CAJON).
4. **Pantalla Nuevo pedido** (manual, sin IA): 0 pedidos en 60 días, no influye.

### Casos encontrados (texto dice bolsa/cajón y se cargó otra unidad)

| Pedido | Texto del cliente | Cargó | Por qué |
|---|---|---|---|
| 2694, 2749, 2779 (×2), 2834 | "Mandarina 1 cajón" / "1 cajon mandarina" | 1 KG | memoria id 70: "mandarina 1 kg" → MANDARINA KG (confirmación del 21/10) |
| 2841 | "1 cajón de naranjas" | 1 UNIDAD | memoria id 133: "20 naranjas" → NARANJA JUGO ELEGIDA UNIDAD (corrección del 04/11) |

El mismo colegio (cliente 93) tiene tres memorias de naranja con unidades distintas (CAJON, UNIDAD, UNIDAD): la
que gana depende de cuál coincide primero. "Bolsa" en sí no aparece mal cargada en 45 días: papa, zanahoria,
batata, anco y cebollón se cargan en BOLSA (25 pedidos revisados). Si Joaquín vio "5 bolsas → 5 kg", lo más
probable es que sea el mismo mecanismo (memoria) o una edición en pantalla; con el número de pedido se confirma.

## 2. Precio cuando cambia la unidad

`updateOrderItem` (`server/storage.ts:1962-1974`): si el patch no trae `pricePerUnit`, el precio queda el que
estaba, aunque cambie la unidad o el producto. La única excepción es Bolsa FV. Entonces:

- Galpón pasa "1 KG manzana roja" a "1 CAJON" → el cajón queda a $6.000 (precio del kg). Pedido 2834, aprobado
  el 04/11; el precio vigente del cajón en el grupo era $86.000. Diferencia: $80.000 en una línea.
- Galpón pasa "6 ATADO puerro" a "10,7 KG" → queda $4.500 (precio del atado) por kg cuando el kg valía $4.000.
- Medido en 45 días: 358 líneas cambiaron de unidad después del original; 70 terminaron con un precio distinto
  al vigente del grupo para la unidad nueva; 7 conservaron exactamente el de la unidad vieja. El resto (63) son
  precios cargados a mano o corregidos por la propagación del grupo (ver punto 3).

En Black Pot este error se tapa solo a veces: cuando se aprueba otro colegio con la línea correcta, la
propagación corrige los **borradores** de los demás. Si el pedido con la unidad cambiada se aprueba primero, queda mal.

## 3. Black Pot: cómo se propaga el precio

- Al crear un pedido, el precio es el último **aprobado** del grupo (padre + sedes + grupo manual) para
  producto + unidad (`getLastPriceByUnit`, ordenado por fecha de aprobación).
- Al aprobar, el precio de cada línea se copia a los **borradores** de los demás miembros (mismo producto y
  unidad) y se guarda en `price_history` para todos.
- Lo que no cubre: pedidos de otros colegios **ya aprobados** ese día (quedan con el precio viejo) y pedidos
  creados después de editar un borrador pero antes de aprobarlo (toman el último aprobado, no el editado).

Medición 30 días: 779 combinaciones día + producto + unidad entre los 16 miembros; en 775 todos los colegios
pagaron lo mismo. Los 4 casos distintos:

| Día | Producto | Precios | Causa probable |
|---|---|---|---|
| 04/11 | Manzana roja elegida (cajón) | 6.000 / 86.000 | punto 2 (unidad cambiada en galpón) |
| 20/10 | Repollo colorado (kg) | 1.800 / 2.500 | precio corregido después de aprobar los primeros |
| 12/10 | Manzana granny elegida (cajón) | 82.000 / 96.000 | ídem |
| 12/10 | Pepino (kg) | 1.800 / 2.300 | ídem |

## Plan propuesto (Fase 1, a confirmar)

1. **Memoria no pisa la unidad escrita** (`interpret-order.ts`): si el cliente escribió una unidad válida para
   ese producto, la memoria aporta solo el producto; la unidad queda la escrita. Si la memoria dice otra unidad,
   la línea va como duda "unidad" en vez de "ok" silencioso.
2. **Re-resolver el precio al cambiar unidad o producto en un borrador** (`updateOrderItem`): buscar el último
   precio aprobado del grupo para la unidad nueva; si no hay, dejar la línea sin precio (así la ve Joaquín antes
   de aprobar, igual que hoy con las líneas nuevas). Solo en borradores; los aprobados no se tocan.
3. **Propagación también a aprobados del mismo día** (opcional, decide Joaquín): al aprobar con un precio nuevo,
   actualizar las líneas de los demás miembros del grupo aprobadas **ese mismo día de entrega** que aún no estén
   facturadas. Cambia montos de remitos ya emitidos: hay que decidirlo explícitamente.
4. **Datos**: limpiar las memorias contradictorias (cliente 93 naranja ×3, cliente 102 mandarina) y corregir
   la línea de manzana del pedido 2834 (−$80.000) si Joaquín confirma.

Cada punto es un cambio chico y acotado; 1 y 2 no tocan otros módulos.
