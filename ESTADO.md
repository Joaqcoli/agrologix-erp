# AgroLogix — ESTADO

> Archivo vivo. Claude Code lo actualiza al cerrar cada tarea (y lo commitea con el cambio).
> Para retomar en un chat nuevo: pegá este archivo como primer mensaje.
> Última actualización: 2026-10-11 (A-04 IA en Carga Pedido desplegado).

## Último trabajo (sep–oct 2026)
- 11-oct **A-01 · soporte para el agente de WhatsApp** (commit "feat(bot): A-01…"). Tablas `customer_contacts`
  (teléfonos de PEDIDO; `customers.phone` es administración y no se usa para identificar) y
  `wa_pending_numbers` (Números por asignar); `orders.source`; `order_intake_logs.external_id`; usuario
  "Bot pedidos" (operator, lista blanca mínima en `ROLE_API_WHITELIST`, entra con `Authorization: Bearer
  BOT_API_TOKEN` → `botBearerAuth` antes de express-session). Endpoints: `GET /api/customers/by-phone`,
  `GET /api/customers/names`, contactos CRUD, `/api/wa-pending*`, `GET /api/orders/dudas`, `/interpret` e
  `/intake` con `source`. Pantallas: "Números por asignar" (`/wa-pendientes`), "Teléfonos de pedido" en la
  ficha del cliente, chips WhatsApp / N dudas en Pedidos. **Falta en Render (ERP): `BOT_API_TOKEN` en el
  Secret File** (valor en el `.env` local). El agente vive en `../asistente-vegex`.
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
