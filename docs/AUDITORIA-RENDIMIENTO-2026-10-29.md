# Cierre de rendimiento — 29/10/2026

Después de la migración de la base a Oregón (misma región que Render) quedaban cuatro causas de lentitud:
aprobar un pedido hacía 8–12 consultas por línea, abrir un pedido una consulta por línea, el PDF del remito
se generaba en el mismo hilo que atiende las pantallas, y la pantalla del pedido recargaba la lista entera
después de cada edición. Se atacaron en orden, con deploy directo a producción y medición antes/después.

## Cómo se midió

Script `medir.cjs` (scratchpad de la sesión) contra **producción** (https, usuario admin temporal que se borra al
final): crea un pedido de **PRUEBA con 30 líneas reales** (copiadas del pedido 2693, Colegio St. Matthews, 40 líneas),
lo edita, lo aprueba, lo lee como lo hace la pantalla, y lo borra (el borrado de un pedido aprobado revierte el stock).
Tiempos de punta a punta desde una máquina en Argentina (incluyen ~150 ms de red hasta Oregón).

| Operación (producción, 30 líneas)            | Antes   | Paso 3  | Paso 4–5 | Paso 6 (final) |
|----------------------------------------------|---------|---------|----------|----------------|
| Abrir pedido aprobado de 40 líneas           | 0,6–1,0 s | 0,5 s | 0,3 s    | 0,3 s          |
| Abrir borrador de 30 líneas                  | 0,75 s  | 0,63 s  | 0,52 s   | 0,58 s         |
| Editar una línea ("Confirmar")               | 1,17 s  | 0,82 s  | 0,71 s   | 0,52 s         |
| **Aprobar pedido de 30 líneas**              | **8,0 s** | 7,2 s | 6,6 s    | **0,97 s**     |
| Leer el pedido justo después de aprobar      | 0,75 s  | 0,47 s  | 0,33 s   | 0,28 s         |
| Lista de pedidos justo después de aprobar    | **11,9 s** | 0,50 s | 0,48 s | 0,45 s         |
| Editar línea de pedido aprobado              | 1,03 s  | 0,90 s  | 0,72 s   | 0,76 s         |
| Borrar pedido aprobado (revierte stock)      | 5,1 s   | 4,8 s   | 4,7 s    | 5,0 s (no se tocó) |

Tiempos del lado del servidor (log `[tiempos]`): aprobar 30 líneas 6.115 ms → **548 ms**; editar línea 194–426 ms;
PDF del remito en hilo aparte 188–219 ms.

## Qué se hizo

1. **Render Starter** — la API no permite pasar de Free a pago (`cannot change between free and paid plans`); Joaquín lo
   cambió desde el panel (hoy el servicio reporta plan `0.5c-512mb`). En los últimos 100 renglones de log con "spinning"
   no aparece ningún arranque en frío.
2. **Secret File `.env` de Render** — tenía `DATABASE_URL` apuntando a São Paulo (no se usaba porque la variable de
   entorno manda, pero era una vuelta atrás silenciosa). Quedó solo `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `BOT_API_TOKEN`.
   `GET /api/diag/env` confirma: sin `SUPABASE_URL`, `DATABASE_URL` en `aws-0-us-west-1`. Respaldo local del archivo
   original en `.env.secretfile-render.bak` (gitignored).
3. **PDF fuera del camino crítico** (`65f047a`) — `server/pdf-worker.ts` (bundle `dist/pdf-worker.cjs`) genera remito y
   factura en un worker thread con los datos ya armados; `pdf-server.ts` cae al hilo principal si el bundle no existe.
   Logo pre-reducido `logo-small.jpg` (520 px, 23 KB) en vez del PNG 1920×1080 que jsPDF comprimía en modo SLOW.
   El envío del remito y la facturación arrancan 2 s después de responder al aprobar. La lista después de aprobar pasó
   de 11,9 s a 0,5 s.
4. **Abrir pedido en 2 consultas** (`d412b99`) — `getOrder` hace pedido+cliente y líneas+producto con JOIN.
5. **La pantalla recarga solo lo que cambió** (`d412b99`) — editar/confirmar/agregar/borrar líneas invalida solo
   `/api/orders/:id`; aprobar y borrar pedido siguen recargando la lista; "Pasar pedido" recarga lista y lista de carga.
6. **Aprobar en lote** (`0191a85`) — `_costContext` carga `product_units` y las últimas compras de todos los productos
   del pedido en 3 consultas; `_costFromCtx` replica `_getCostForUnit` sobre esas filas (la versión con consultas quedó
   como `costForUnitDb`). `approveOrder` bloquea los productos con un solo `FOR UPDATE`, descuenta stock en memoria
   (cada línea ve el mismo estado que veía consulta por consulta) y escribe una sentencia por tabla al final.
   Pares de grupo, remito y cambio de estado no se tocaron. Los borradores (`getOrder`) usan el mismo contexto.

## Prueba comparativa (antes de deployar el paso 6)

Dos copias idénticas de producción en un Postgres local (`pg_dump` 29/10 13:00, restauradas en `va_vieja` y
`va_nueva`). En cada una se clonaron como borradores los **20 pedidos aprobados más recientes con ≥ 10 líneas**
(mismo cliente, líneas, unidades y precios; 403 líneas en total) y se aprobaron con decisiones deterministas
(1 de cada 3 líneas con `zero`/`rinde`/`prorate`): la copia vieja con el código de `d412b99`, la nueva con el refactor.
Comparación fila por fila (sin columnas de fecha/hora): `orders`, `order_items` (costo, margen, subtotal),
`stock_movements` (322 filas: cantidad, costo unitario, tipo, notas), `product_units` (stock y costo promedio, 558
filas), `products` (272), `price_history` (3.409 filas, incluye réplica a pares), `remitos` y los borradores de pares
sincronizados → **todo idéntico al centavo**. Scripts: `comparativa/preparar.cjs`, `aprobar.ts`, `comparar.cjs` en el
scratchpad de la sesión.

Verificaciones previas que sostienen la equivalencia: no hay `(product_id, unit)` duplicados en `product_units` ni
empates de stock entre filas base del mismo producto (el desempate por id replica el orden de las consultas sin
`ORDER BY`).

## Qué queda

- **Borrar un pedido aprobado tarda 5 s** (revierte stock línea por línea): mismo patrón, no estaba en el pedido de hoy.
- `updateOrderItem` sigue haciendo ~10 consultas secuenciales (0,2–0,4 s de servidor): aceptable.
- `npx tsc` con la caché incremental (`tsBuildInfo`) puede mostrar 7 errores fantasma en métodos de clientes de
  `storage.ts`; con `--incremental false` da los 96 preexistentes. Ningún error nuevo en el código tocado.
