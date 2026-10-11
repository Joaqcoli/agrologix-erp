# AgroLogix — ESTADO

> Archivo vivo. Claude Code lo actualiza al cerrar cada tarea (y lo commitea con el cambio).
> Para retomar en un chat nuevo: pegá este archivo como primer mensaje.
> Última actualización: 2026-10-11 (reordenamiento; armado desde el historial de git y la memoria de Claude).

## Último trabajo (sep–oct 2026)
- 08-oct `1385258` CC: sin tope de 500 pedidos al calcular pendientes.
- 07-oct `09fda70` Carga de pedido: el servidor decide el precio; la vista previa rebusca al corregir producto.
- 02-oct `ca8a6e1` Clientes: IVA desde una fecha (`customers.iva_since`).
- 30-sep Pedidos/costos: recálculo de `orders.total` al propagar precios de grupo; stock en una sola unidad por producto + alertas al cargar compras.
- 28/29-sep Grupos de precio nuevos: PLANTA COLEGIOS + COLEGIO SIMBRON · BORGO + NISI MASA · BRASOV + ENTRE BRASAS.
- 21-sep Pedidos: subtotal atómico + lock `FOR UPDATE`; facturas modo agrupado/detallado; CC: diferencia de cobro para cerrar pagos.
- 15-sep Compras: borrar el pago automático vinculado al eliminar una compra.

## En curso / próximo
- Nada a medio hacer en el código: al 11-oct el repo no tenía cambios sin commitear.
  Último frente tocado (7–8 oct): precios al crear pedido y pendientes de CC.
- Próximo sugerido: **Caja Paso 2 (MP automático)**, que sigue abierto desde julio.

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
- Login como Juan (vendedor) → `/caja` redirige bien. `operador@erp.com` deshabilitado. Vista galpón OK.
- Costo promedio en una compra con stock existente; edición de peso en galpón actualiza costo.
- Hoja de armado no parte pedidos entre páginas y muestra Nº de remito.

## Decisiones tomadas (no re-discutir)
- Costo = WMA; FIFO y botón "Recalcular costos" eliminados; no se resincronizan costos viejos.
- `/v1/account/balance` de MP no sirve con esta credencial; el saldo sale de movimientos.
- Bolsa FV: se cobra y factura, costo $0, no descuenta stock.
- Revalidación de cuenta por request con caché de 8 s (trade-off aceptado).
- Se trabaja sobre `main` con deploy directo; `develop` abandonada.

## Higiene pendiente del repo
- `enero.xlsx` está commiteado en el repo (datos del negocio). Evaluar sacarlo del tracking.
- `replit.md` está desactualizado (dice Replit/Neon). Reemplazado por `CLAUDE.md`.
