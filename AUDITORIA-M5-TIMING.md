# Auditoría M5 — Flujos async / timing (diagnóstico, solo lectura, 2026-06-18)

> **Solo lectura. No se tocó nada.** Mapa de flujos asíncronos que dependen de orden/timing.
> **Conclusión adelantada:** **la mayoría ya está mitigado** — el prefill de precios tiene fix server-side determinístico, el recálculo de `orders.total` se hizo secuencial, y los botones de guardar/aprobar/pagar están deshabilitados mientras mutan. Lo que **queda real** son los **"overwrite" de prefill/sugerencia** (peso y precio en intake) que pueden pisar un valor recién tipeado en una ventana angosta — editable y visible, severidad media-baja. **No queda ninguna race de plata ni de corrupción de datos.**

---

## 1. Casos encontrados (ubicación + qué podría salir mal)

| # | Caso | Ubicación | Tipo | Estado |
|---|---|---|---|---|
| A | **Prefill de precios server-side** | `storage.ts:1434` (createOrder) + 1488 (addOrderItem) | (c) prefill vs edición | ✅ **RESUELTO** |
| B | **Sugerencia de peso** `suggestSupplierWeight` | `purchases/new.tsx:226` (disparado en 220/221/392) | (c) prefill pisa lo tipeado | ⚠️ **REAL (medio-bajo)** |
| C | **Prefill de precio en intake** | `intake.tsx:254` (background) vs `:590` (edición usuario) | (c) prefill pisa lo tipeado | ⚠️ **REAL (bajo)** |
| D | Reset de precio al cambiar unidad | `orders/detail.tsx:873` ("always update price on unit change") | (c) | 🟡 por diseño / bajo |
| E | **Recálculo de `orders.total`** | `orders/detail.tsx:717` ("Sequential … to avoid race condition") | (d) recálculo post-mutación | ✅ **RESUELTO** (secuencial) |
| F | Doble-submit guardar/aprobar/pagar | order save, purchase save, approve, pagar obligación | (a) doble disparo | ✅ **GUARDADO** (`disabled={isPending}`) |
| G | Doble-click en `.mutate()` sin `disabled` | varios (mayoría diálogos/eliminar); `galpon/order-detail.tsx:181` add línea | (a) doble disparo | 🟡 bajo (mayoría idempotente/diálogo) |

## 2. El riesgo concreto de cada uno

- **A — Prefill de precios (RESUELTO):** el bug histórico era "cargás un ítem y, si el prefill async no volvió a tiempo, el precio se guardaba mal / saltaba ítems". **Ya está arreglado en el server** (Bug A): al crear pedido / agregar ítem, si el front **no** mandó un precio >0, el server lo busca él mismo (`getLastPriceByUnit`, cliente+peers del grupo, unidad exacta) → el precio guardado es **determinístico, independiente del timing del navegador**. Si el front sí mandó precio, se respeta. → el síntoma "saltaba ítems" no ocurre más.
- **B — Sugerencia de peso (REAL):** al elegir producto/unidad/proveedor se dispara `suggestSupplierWeight` (fire-and-forget). Usa `setItems` funcional y guarda que el producto/unidad sigan igual, **pero NO chequea si el usuario ya tipeó un peso**. Síntoma: elegís el cajón, **tipeás rápido el peso real (16)** y, ~200ms después, vuelve la sugerencia del último peso (17) y **te pisa el 16**. Pasa solo si tipeás dentro de la ventana del fetch; es editable y visible, pero si no lo notás, **se guarda el peso pisado** (y eso mueve el costo por kg). Medio-bajo.
- **C — Prefill de precio en intake (REAL):** el fetch de fondo escribe en `pricePrefills[idx]` y la edición del usuario también escribe ahí (`:590`). Si el fetch vuelve **después** de que tipeaste el precio, te lo pisa. Ventana angosta (~250ms post-parseo). Bajo.
- **D — Reset de precio al cambiar unidad:** al cambiar la unidad de una línea, el precio se re-busca y se sobrescribe **siempre**. Es semi-intencional (unidad nueva = precio nuevo), pero si cambiás unidad y tipeás precio antes de que vuelva, te lo pisa. Bajo / por diseño.
- **E — Recálculo de `orders.total` (RESUELTO):** había una race al recalcular el total tras editar ítems; se arregló haciéndolo **secuencial** (no en paralelo). Comentario explícito en el código.
- **F — Doble-submit (GUARDADO):** los botones de **guardar pedido**, **registrar compra**, **aprobar** (con `// prevenir doble-click` explícito) y **confirmar pago de obligación** tienen `disabled={…isPending}` → no se puede disparar dos veces.
- **G — `.mutate()` sin `disabled`:** la mayoría son **diálogos de confirmación** (se cierran al clickear) o **eliminaciones** (idempotentes: borrar dos veces = no-op/404). El más expuesto es **agregar línea en el pedido del galpón** (`galpon/order-detail.tsx:181`, botón plano): doble-click podría duplicar la línea. Menor (galpón, editable).

## 3. Reales vs teóricos (priorización)

**Ya resueltos (no hacer nada):**
- **A** prefill de precios (server-side determinístico) — era el que causaba el bug observable de "saltar ítems". **Resuelto.**
- **E** recálculo de `orders.total` (secuencial). **Resuelto.**
- **F** doble-submit en los flujos críticos (guardar/aprobar/pagar). **Guardado.**

**Reales que valen la pena (menores, editable/visible, pero pueden guardar un valor pisado):**
1. **B — sugerencia de peso pisa el peso tipeado.** El más concreto (afecta el costo por kg si no se nota). Prioridad 1.
2. **C — prefill de precio en intake pisa el precio tipeado.** Prioridad 2 (ventana más angosta).
3. **G — doble-click agrega línea duplicada en pedido galpón.** Prioridad 3 (menor).

**Teóricos / por diseño (no urgentes):**
- **D** reset de precio al cambiar unidad (semi-intencional).
- Resto de `.mutate()` sin disabled en diálogos/eliminar (idempotentes).

→ **¿Alguno causó un bug observable?** Sí: el **prefill de precios que saltaba ítems** — y **ya está arreglado** (A). Los que quedan (B/C) son del mismo tipo (overwrite) pero **no se reportaron** como bug todavía; son de "a veces" y editables.

## 4. Enfoque de fix por tipo (conceptual, sin implementar)

- **Overwrite de prefill/sugerencia (B, C, D):** marcar el campo como **"tocado por el usuario"** (un flag `touched` por ítem/campo) y, cuando vuelve la respuesta async, **aplicar solo si el campo NO fue tocado** (o sigue vacío). Alternativa: **token de request** — guardar el último request disparado y, al volver, aplicar solo si es el más reciente y el valor objetivo no cambió. Para B alcanza con "no pisar si ya hay un peso tipeado distinto del genérico".
- **Doble-submit (G):** `disabled={mutation.isPending}` en los pocos botones de ADD que no lo tienen (galpón add línea), o idempotencia en el server.
- **Ya cubiertos:** A (server-side fallback), E (secuencial), F (disabled) — no requieren cambios.

## 5. Recomendación

- **Arreglar solo los reales (B, C, y opcional G).** B primero (es el que puede mover un costo si pisa el peso sin que se note). El patrón es el mismo: **no pisar un valor que el usuario ya tipeó** (flag touched / token).
- **No tocar** lo ya resuelto (A, E, F) ni lo teórico/por diseño (D, diálogos idempotentes).
- Es un fix **acotado y de bajo riesgo** (sólo agrega un guard "no pisar si tocado" en el front; no toca el guardado ni el server).

**Solo lectura. Nada tocado.**

---

## 7. ✅ M5 RESUELTO (2026-06-18, commit `c7b935c`) — B + C (G ya estaba cubierto)

- **B — sugerencia de peso (`purchases/new.tsx`):** flag `wpuTouched` por ítem. Se marca `true` al tipear el peso a mano; se resetea a `false` al cambiar producto/unidad. `suggestSupplierWeight` aplica **solo si `!wpuTouched`** (guard dentro del `setItems` funcional → lee el estado al resolver el fetch). Campo vacío → precarga igual que antes; peso tipeado → ya no se pisa (eso movía el costo por kg).
- **C — prefill de precio en intake (`intake.tsx`):** no hay input manual de precio (se completan en el detalle). El race era entre **dos fetches** del mismo ítem (el de fondo al abrir preview + el de cambio de unidad): ganaba el que resolvía último. Fix: token `priceFetchSeq[idx]` (useRef) que incrementa en cada fetch disparado; al resolver, aplica **solo si su token sigue siendo el último**. Reset del map en cada parseo nuevo (invalida fetches en vuelo).
- **G — doble-click add línea galpón:** **falso positivo del diagnóstico.** El botón (`galpon/order-detail.tsx:182`) ya tenía `disabled={… || addMut.isPending}` desde el commit de la feature (d3c3b6c, 15/06), confirmado con `git blame`. Sin cambio.
- **A / E / F:** ya estaban resueltos (prefill server-side / recálculo secuencial / disabled). Sin cambio.

**Verificado:** build (vite+esbuild) ✓; tsc 100 errores baseline = 100 con cambios, 0 en los 2 archivos. Trazas de los 3 escenarios de B (vacío precarga / tipeado no se pisa / cambio de unidad re-precarga) y de los 3 de C (prefill solo / unidad nueva gana al de fondo / parseo nuevo descarta viejos). Solo guards en el front: no toca guardado, server ni cálculo de costo/precio.
