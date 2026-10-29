# AgroLogix — ESTADO

> Archivo vivo. Claude Code lo actualiza al cerrar cada tarea (y lo commitea con el cambio).
> Para retomar en un chat nuevo: pegá este archivo como primer mensaje.
> Última actualización: 2026-10-29 (cierre de rendimiento: aprobar 30 líneas 8 s → 1 s).

## Último trabajo (sep–oct 2026)
- 11-oct **A-01 · soporte para el agente de WhatsApp** (commit "feat(bot): A-01…"). Tablas `customer_contacts`
  (teléfonos de PEDIDO; `customers.phone` es administración y no se usa para identificar) y
  `wa_pending_numbers` (Números por asignar); `orders.source`; `order_intake_logs.external_id`; usuario
  "Bot pedidos" (operator, lista blanca mínima en `ROLE_API_WHITELIST`, entra con `Authorization: Bearer
  BOT_API_TOKEN` → `botBearerAuth` antes de express-session). Endpoints: `GET /api/customers/by-phone`,
  `GET /api/customers/names`, contactos CRUD, `/api/wa-pending*`, `GET /api/orders/dudas`, `/interpret` e
  `/intake` con `source`. Pantallas: "Números por asignar" (`/wa-pendientes`), "Teléfonos de pedido" en la
  ficha del cliente, chips WhatsApp / N dudas en Pedidos. `BOT_API_TOKEN` ya cargado en Render (verificado).
  Vista **"Bot por cliente"** (`/bot-clientes`, `GET /api/bot-clientes`; reemplaza a "Sombra WhatsApp"): por cliente, pedidos y renglones leídos, renglones con error vs lo
  cargado, dudas, % acierto, interruptor "Bot activo" — el número para activar el bot por cliente (≥95 %).
  El agente vive en `../asistente-vegex` (Render, modo SOMBRA).
  13-oct **auto-asignación de Números por asignar**: `GET /api/wa-pending` primero pasa a `assigned` los
  pendientes por "desconocido" cuyo teléfono ya figura en `customer_contacts` (cargado desde Bot por cliente o la
  ficha del cliente; 2 min de gracia por si se carga el mismo número en otra sede) y el bot los reprocesa en su
  próximo ciclo (1 min). Si el reproceso vuelve a dejarlo sin resolver, el pendiente se reabre con el motivo nuevo
  en vez de perderse. Los "repetido" (número conocido, texto ambiguo) siguen siendo manuales.
  29-oct **MIGRACIÓN DE LA BASE A SUPABASE US-WEST-1 (Oregón), misma región que Render.** Proyecto nuevo
  `agrologix-erp-oregon` (ref `kvvjutzqwhhkddszdizs`, org "Vegetales Argentinos", plan Free, Postgres 17). Corte 29/10:
  backup final 09:04:05, restauración 09:07, `DATABASE_URL` en Render cambiada y redeploy 09:14–09:18, producción
  sirviendo desde Oregón a las 09:18 (hora Argentina). Verificación: 61/61 tablas con mismo conteo y máximo de id,
  últimas filas iguales; login, pedidos, aprobar PRUEBA y sync MP probados en producción. Latencia por consulta desde
  Render: 175 ms → 20 ms. Aprobar pedido de PRUEBA: 0,85 s; editar línea: 0,5 s.
  **Proyecto viejo** (ref `inbqbzdrqzrggtnybwtt`, sa-east-1) **pausado el 29/10 09:24, se conserva hasta el 12/11**; Supabase
  permite reanudarlo desde el panel. **Vuelta atrás**: reanudar el viejo (pausando otro proyecto Free si hace falta),
  poner en Render la variable `DATABASE_URL` con la URL vieja (guardada en `.env.migracion` local y en `.env` local como
  `DATABASE_URL_VIEJA_SAO_PAULO`; nunca acá) y redeploy. `server/db.ts` ahora prioriza `DATABASE_URL` sobre `SUPABASE_URL`
  (el Secret File `.env` de Render quedó limpio el 29/10: sin URL de base; respaldo en `.env.secretfile-render.bak` local). Durante el corte se pausó el
  proyecto "Telma" (08:41–09:28) por el límite de 2 proyectos Free; volvió sano. Herramientas de la migración en el
  scratchpad de la sesión (ddl/copiar/verificar/supa/render/ensayo); tokens de Supabase y Render solo en `.env.migracion`.
  29-oct **CIERRE DE RENDIMIENTO** (`65f047a`, `d412b99`, `0191a85`; detalle y tabla completa en
  `docs/AUDITORIA-RENDIMIENTO-2026-10-29.md`). Medido en producción con un pedido de PRUEBA de 30 líneas reales:
  **aprobar 8,0 s → 0,97 s** (servidor 6,1 s → 0,55 s), lista de pedidos después de aprobar 11,9 s → 0,45 s, editar
  línea 1,2 s → 0,5 s, abrir pedido de 40 líneas 0,6–1,0 s → 0,3 s. Qué cambió: (3) remito/factura PDF en un worker
  thread (`server/pdf-worker.ts` → `dist/pdf-worker.cjs`, con caída al hilo principal si no existe) + logo
  `logo-small.jpg` 520 px + envío del remito 2 s después de responder; (4) `getOrder` en 2 consultas con JOIN;
  (5) la pantalla del pedido recarga solo el pedido al editar líneas (aprobar/borrar siguen recargando la lista);
  (6) `approveOrder` con lecturas en lote (`_costContext`: product_units + últimas compras en 3 consultas,
  `_costFromCtx` = misma lógica que `_getCostForUnit`, ahora función de módulo `costForUnitDb`), stock descontado en
  memoria y una sentencia por tabla al final. **Prueba comparativa antes del deploy del paso 6**: 20 pedidos reales
  clonados y aprobados con la versión vieja y la nueva en dos copias locales de producción (decisiones zero/rinde/
  prorate incluidas): 9 tablas idénticas al centavo. Render ya está en **Starter** (lo cambió Joaquín desde el panel;
  la API no permite Free→pago) y no hay arranques en frío en el log. Secret File `.env` de Render sin la URL de São
  Paulo. Queda: borrar un pedido aprobado tarda 5 s (mismo patrón, no estaba pedido). Log `[tiempos]` en Render para
  aprobar, editar línea y PDF.
  26-oct **Meta bloqueó la cuenta de WhatsApp** (error 131031 "Business account has been locked" en todos los envíos
  desde el 25/10 20:24; hasta el 24/10 todo entregado). El bot carga pedidos pero ninguna respuesta llega. Para verlo
  sin adivinar: `wa_outbound.delivery_status/delivery_error` (lo informa el bot desde el webhook
  `whatsapp.message.updated`, habilitado por API en el endpoint del bot el 29/10 13:25), `GET /api/wa-estado`
  y cartel rojo en Bot por cliente.
  19-oct **Lista de Precios**: `price_list_history` guarda cada alta/cambio/baja (antes/después, usuario). Motivo: Joaquín
  pidió volver atrás los cambios de un día y no había forma (la tabla no tenía historial ni updated_at).
  19-oct **bot**: sedes hermanas como candidatas (`findCustomersByPhone`), el pedido es del dueño del teléfono si el texto
  no nombra el local; el reproceso respeta el cliente asignado. Caso Master/St Catherine's dividido a mano (2653).
  La API de Anthropic rechazó llamadas a las 10:39 y 11:04 por saldo de créditos agotado ("credit balance too low").
  15-oct **intérprete (reglas de Joaquín)**: siempre carga aunque haya duda (sin cantidad → última del cliente o 1; producto
  no identificado → renglón con producto vacío, en duda); "planta"/"pieza" = ATADO o UNIDAD según el cliente, nunca KG;
  los encabezados ignorados no generan notas; **memoria por cliente aprende de cada confirmación (check) y corrección**
  de una línea en duda (`customer_product_memory`, source confirmacion/correccion) y manda sobre el modelo
  (`claveRenglon`: mismo texto sin números ni unidades → mismo producto/unidad, status ok).
  15-oct **A-13 · remito automático, facturación según cliente, mensajes automáticos** (ficha en
  `../asistente-vegex/AUTOMATIZACIONES.md`). E1 `f8eaa12` ficha de cliente (checks Remito/Factura por teléfono y
  administración, modo diaria/semanal/mensual/diaria con envío semanal, facturar a, tipo y condición IVA, detalle,
  precios incluyen IVA) + interruptores generales (OFF) en Bot por cliente + tablas `app_settings`, `order_snapshots`,
  `wa_outbound`, `invoice_orders`, `invoice_queue`, `message_templates`. E2 `3976cb9` resguardo del pedido original en
  la primera edición del galpón, notas del galpón, aviso de faltantes editable. E3–E6: `shared/pdf.ts` (generadores
  isomórficos; `client/src/lib/pdf.ts` re-exporta), `server/pdf-server.ts` (remito/factura/NC a Buffer, nombre
  "Remito {Cliente} {dd.mm}"), `server/ycloud.ts` (media, plantillas con header DOCUMENT, envío), `server/invoicing.ts`
  (`emitirFactura` con varios pedidos, facturar al padre, precios con IVA, fecha ARCA en hora Argentina; NC por
  diferencia), `server/automation.ts` (remito al aprobar, corte 14:00 con app_settings, viernes semanal + Black Pot,
  último día hábil mensual, cola "Facturas a emitir", envíos, plantillas), `server/blackpot-excel.ts`. Pantallas:
  /facturas-a-emitir, /configuracion/mensajes; en el pedido: estado del remito por WhatsApp + reenviar, "Emitir nota de
  crédito por $X". **Render: falta cargar `YCLOUD_API_KEY` en el .env del ERP** (sin eso, los envíos quedan en error
  "YCloud no configurado"). `/ejemplo.pdf` es el documento de ejemplo para las plantillas.
  Prueba 15/10 con PRUEBA (167) desde la máquina local con la key de YCloud del bot: pedido 2590 aprobado → remito
  "Remito PRUEBA 15.10.pdf" enviado al número de Joaquín (documento libre, dentro de 24 h) con aviso de faltantes;
  factura 921 enviada como documento de prueba; PRUEBA en modo diaria → ítem #2 en "Facturas a emitir" (aprobarlo
  emite una Factura B real a PRUEBA). 8 plantillas con documento creadas en Meta (`va_*_v1`), todas PENDING.
  **Pendiente de Joaquín:** `YCLOUD_API_KEY` en Render (ERP); marcar los checks Remito/Factura por cliente (hoy solo
  PRUEBA tiene); revisar modos de facturación asignados (33 clientes: 21 diaria, 12 diaria con envío semanal); prender
  los interruptores cuando quiera. Nadie quedó con "precios incluyen IVA" en sí.
  14-oct **intake idempotente**: `POST /api/orders/intake` con un `intakeLogId` que ya tiene `order_id` responde
  `{orderId, itemIds: [], yaCargado: true}` sin cargar líneas. Causa: el bot procesó dos veces el mismo mensaje de
  Brick Towers Del Viso (ciclos de reproceso solapados, ya con mutex) y el borrador 67 del 14/10 quedó con cada
  renglón duplicado; se borraron las 21 líneas repetidas a mano (ids 34206-34227).
  14-oct **`GET /api/wa-questions/open?phone&all=1`**: todas las preguntas abiertas de un teléfono (el equipo tiene
  varias a la vez y el agente elige cuál responde el mensaje).
  14-oct **Stock**: al buscar por nombre aparecen también los productos en cero, con etiqueta "Sin stock" y la fila
  desplegable de últimas compras / costos por proveedor (solo presentación; sin texto en el buscador se siguen
  ocultando). Un producto en cero se muestra una sola vez aunque tenga varias unidades base activas (`65e7f91`).
  Quedan 4 productos activos que no aparecen ni buscando porque no tienen unidad base activa:
  ACEITE OLIVA X2LT, ANANA, HINOJO, NARANJA JUGO.
  **Deuda de datos detectada (14/10):** 48 productos activos tienen 2 o 3 filas base activas (KG y UNIDAD, ATADO y
  KG…) cuando la regla es una fila base por producto; algunos tienen stock en dos unidades a la vez (REMOLACHA
  ATADO 14 + KG 7,3). Pide una limpieza por producto con Joaquín (qué unidad es la base, pasar el stock, desactivar
  la otra). No se tocó.
  14-oct **Bot por cliente**: filtro "Todos / Sin teléfono" (con cantidades) para ir cargando los números de pedido.
  14-oct **dudas del bot en el detalle del pedido**: lista numerada "Dudas del bot" debajo de Notas; la fila va en
  amarillo con "duda N"; el check la confirma al instante (optimista). la línea con `parse_status = 'duda'` sale en amarillo y un check verde "está bien así" (`PATCH /api/orders/:id/items/:itemId` con
  `parseStatus: "ok"`). Editar cantidad, unidad o producto de esa línea también la marca revisada. Así el
  recordatorio de las 23:00 y el chip "N dudas" dejan de contar lo que Joaquín ya revisó.
  14-oct **candado de envíos al cliente** (regla de Joaquín: nunca más de un mensaje): tabla `wa_client_sends` y
  `POST /api/wa-sent` {clave, phone, orderId, kind} → el bot reserva la clave única ANTES de mandar; `ok:false` si ya
  existía o si al mismo teléfono se le escribió hace menos de 2 min. Atómico (UNIQUE), sobrevive reinicios.
  13-oct **candado anti-repetición**: `GET /api/wa-inbox/confirmada?phone&orderId` devuelve la última confirmación
  ("pedido recibido"/"producto agregado") que el bot le mandó a ese teléfono por ese pedido según `wa_inbox`; el agente
  lo consulta antes de escribirle al cliente. Motivo: a Colegio St. Matthews le llegaron 4 "pedido recibido" por un reproceso solapado.
  12-oct **A-12** (`d208163`): tabla `wa_questions` + endpoints `/api/wa-questions*` para que el bot
  pregunte las dudas (al cliente o al equipo) y aplique la respuesta sobre el borrador; `/interpret`
  devuelve `dudaType`, `/intake` devuelve `itemIds`. Vista "Bot por cliente" lista solo los clientes elegidos.
  12-oct: **`customers.bot_activo`** ("Bot activo" en la ficha y badge en la lista): el agente actúa en ACTIVO
  solo para esos clientes. Cliente PRUEBA (167) con el número de Joaquín.
- 11-oct `b2f04ba` **A-04 · IA en Carga Pedido** (desplegado y verificado: tabla creada en prod a los ~2 min,
  endpoint responde 401 sin sesión). `POST /api/orders/interpret`
  (`server/interpret-order.ts`: Anthropic, `ANTHROPIC_MODEL` default `claude-sonnet-5-5`, structured outputs,
  caché 1 h del catálogo, timeout 30 s + 1 reintento, reglas validadas en el server). Tabla nueva `order_intake_logs`.
  `intake.tsx`: IA con fallback al parser local (banner "IA no disponible"), dudas en amarillo + candidatos,
  ignorados, aviso multi-local, nota precargada, foto. Merge/replace, precios, stock: sin cambios.
  **Prueba offline (40 pedidos del grupo de WhatsApp, historial cortado antes del mensaje):** 75,1 % de líneas
  iguales (producto+unidad+cantidad), 13,8 % con producto bien y unidad/cantidad distinta, 25,9 % dudas,
  mediana 5,4 s, USD 0,018 por pedido.
  **Ajuste de variantes (mismo día, segundo commit):** si el cliente no aclara la variante (anco, palta,
  naranja…), va la que más se repite en sus últimos 5 pedidos con ese producto (empate → la más reciente) y la
  línea queda **ok**; solo es duda si nunca compró ninguna variante. El modelo devuelve `dudaType` y el server
  fuerza "ok" en las dudas de variante con historial. Misma prueba: dudas **25,9 % → 13,8 %**, iguales 76,9 %,
  USD 0,022 por pedido (el historial ahora lleva las últimas 5 fechas por producto).
  **Ojo con la métrica:** comparar contra el pedido final NO mide variantes ni unidades pesadas (la variante
  final cambia según lo que se compra; "1 atado de verdeo" se carga como KG pesado). La métrica que vale es
  `order_intake_logs`: propuesta (`proposal`) vs lo que se creó (`final`).
- 08-oct `1385258` CC: sin tope de 500 pedidos al calcular pendientes.
- 07-oct `09fda70` Carga de pedido: el servidor decide el precio; la vista previa rebusca al corregir producto.
- 02-oct `ca8a6e1` Clientes: IVA desde una fecha (`customers.iva_since`).
- 30-sep Pedidos/costos: recálculo de `orders.total` al propagar precios de grupo; stock en una sola unidad por producto + alertas al cargar compras.
- 28/29-sep Grupos de precio nuevos: PLANTA COLEGIOS + COLEGIO SIMBRON · BORGO + NISI MASA · BRASOV + ENTRE BRASAS.
- 21-sep Pedidos: subtotal atómico + lock `FOR UPDATE`; facturas modo agrupado/detallado; CC: diferencia de cobro para cerrar pagos.
- 15-sep Compras: borrar el pago automático vinculado al eliminar una compra.

## En curso / próximo
- A-04 recién desplegado: **verificar en producción** (ver "Verificaciones manuales"). Descartado: pasarle el
  stock al modelo (no se trabaja con stock; la variante final cambia según lo que se compra).
- **Automatizaciones (Asistente Vegex): desde el 11-oct se debaten e implementan en ESTA sesión.** Fichas en
  `../asistente-vegex/AUTOMATIZACIONES.md` (solo se implementan fichas `decidida`); reglas en su `CLAUDE.md`.
- **A-01 (días de entrega)**: últimos 90 días (sin históricos ni cancelados): Lun 150 · Mar 191 · Mié 100 ·
  Jue 59 · Vie 280 · Sáb 1 · Dom 0 pedidos.
- Próximo sugerido: **Caja Paso 2 (MP automático)**, que sigue abierto desde julio.

## Datos que conviene saber (medidos el 2026-10-11)
- `product_units.is_active` NO refleja lo vendible: desde la consolidación de stock, los envases quedaron
  inactivos pero se venden (PAPA LAVADA en BOLSA: 488 líneas en 180 días; 69 de 264 pares producto-unidad
  vendidos están "inactivos"). Para "unidades disponibles" usar activas ∪ vendidas en 180 días
  (`storage.getActiveCatalogWithUnits`). Ojo: el aviso "unidad nueva" del intake usa `/api/products/stock`.
- El texto completo pegado en /intake no se guardaba (solo `order_items.raw_product_name`, el fragmento de
  producto). Desde A-04 queda en `order_intake_logs.raw_text` cuando se usa la IA.
- En el grupo de WhatsApp el cliente va en la **primera línea** del mensaje (texto libre). Hay encabezados sin
  cliente en el ERP: "colegio sworn (Virrey del Pino)", "Verazzi", "Colegio san xavier", "Fabric sushi Gorriti",
  "Washington Lacroze 1973", "Sourhex"; "Hogar" es ambiguo (San Marino / Cardales).

## Pendiente — Caja (orden acordado)
- **Paso 2 · Mercado Pago al disponible — ABIERTO.** El saldo del sistema no coincide con la app de MP.
  Causa raíz: `mpDelta` suma por `date_created`, MP libera por `money_release_date`.
  Sub-bugs diagnosticados y **no aplicados**: (1) no filtra `status` (cuenta authorized/pending);
  (2) fecha UTC en el front (salta después de ~21 hs); (3) monto gross±fee en vez de `transaction_details`;
  (4) `isOutgoing` mal para pagos a comercio/QR/peajes (se suman como ingreso).
  Joaquín quiere **sincronización automática**: no proponer `saldo_base` manual como primera opción.
- **Paso 3 · Galicia por extracto — HECHO** (jun-jul: upload CSV, categorización, cruce de cheques, nuevo formato CSV).
- **Paso 4 · Marcar transferencias internas** ("Banco propio") para que no inflen ingresos (~$5M) — ABIERTO.
- **Paso 5 · Conciliar los tres sistemas paralelos** + doble conteo payments vs caja_movements (M7) — ABIERTO.

## Pendiente — Otros
- **Performance**: latencia por server (Render) y base (Supabase São Paulo) en regiones distintas.
  Decisión pendiente: mover el server a São Paulo. Después: `Promise.all` en `getDashboardStats`, batch en `approveOrder`.
- **Cheques**: el pago con múltiples cheques ya existe (25-jun) y el composer multi-método (28-jun) — confirmar que cubre lo que faltaba.
  Actualizar el registro de cheques cargados (impacta "Cheques en cartera" / "Cheques emitidos" de Caja).
- **Auditoría (no críticos)**: M8 schema drift (`obligacion_pagos` solo en migrate.ts) · M5 timing async ·
  C2 ledger mezcla kg y bultos · menores (storage.ts ~5.7k líneas, bundle sin code-splitting, `/debug`, console.logs).
- Cambiar contraseñas por defecto de admin y Juan; no hay "cambiar contraseña" en la UI.

## Verificaciones manuales (las hace Joaquín)
- (29-oct rendimiento) Aprobar un pedido real grande desde la pantalla y confirmar que tarda ~1 s y que el remito por
  WhatsApp llega igual (cuando Meta destrabe la cuenta). Subir a YCloud la documentación que pide Meta (cuenta bloqueada
  desde el 25/10). El evento `whatsapp.message.updated` ya está suscripto en el webhook del bot (29/10, por API).
- **A-01**: Clientes → editar uno → aparece "Teléfonos de pedido" (agregar, editar, borrar). Menú "Números por
  asignar" abre vacío. Pedidos muestra chip "WhatsApp"/"N dudas" cuando el bot cargue algo. El rol operator ya
  no tiene acceso total (solo el bot, por token).
- **A-04**: en /intake pegar un pedido real de WhatsApp → "Analizar pedido" tiene que mostrar "Interpretado por IA"
  (si sale el banner amarillo "IA no disponible", falta `ANTHROPIC_API_KEY` en el Secret File de Render).
  Probar: una duda → elegir candidato o "Confirmar"; subir una foto de pedido; crear el pedido y ver que la
  nota precargada quedó en el pedido. Un pedido con dos locales tiene que mostrar el aviso naranja.
- Login como Juan (vendedor) → `/caja` redirige bien. `operador@erp.com` deshabilitado. Vista galpón OK.
- Costo promedio en una compra con stock existente; edición de peso en galpón actualiza costo.
- Hoja de armado no parte pedidos entre páginas y muestra Nº de remito.

## Decisiones tomadas (no re-discutir)
- Costo = WMA; FIFO y botón "Recalcular costos" eliminados; no se resincronizan costos viejos.
- `/v1/account/balance` de MP no sirve con esta credencial; el saldo sale de movimientos.
- Bolsa FV: se cobra y factura, costo $0, no descuenta stock.
- Revalidación de cuenta por request con caché de 8 s (trade-off aceptado).
- Se trabaja sobre `main` con deploy directo; `develop` abandonada.
- A-04: el modelo propone, el servidor valida; una línea con unidad no vendible, sin cantidad o sin producto
  activo siempre queda "duda". En la vía IA no se pisa la unidad con unit-history ni localStorage.

## Higiene pendiente del repo
- `enero.xlsx` está commiteado en el repo (datos del negocio). Evaluar sacarlo del tracking.
- `replit.md` está desactualizado (dice Replit/Neon). Reemplazado por `CLAUDE.md`.
