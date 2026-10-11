# AgroLogix ERP — instrucciones para Claude Code

ERP a medida de **Vegetales Argentinos SRL** (distribuidora de frutas y verduras, Argentina).
El dueño, Joaquín, **no programa**: describe lo que necesita, Claude (chat) arma el prompt y
vos lo ejecutás. Hablale en español argentino (voseo), corto y directo.

**Al arrancar cada sesión leé `ESTADO.md`**: ahí está en qué estamos, qué falta y qué ya se decidió.

## Stack y despliegue
- Node/Express + TypeScript · React 18 + Vite + Tailwind + shadcn/ui + TanStack Query · Drizzle ORM.
- PostgreSQL en **Supabase** (São Paulo, transaction pooler 6543). Server en **Render**.
- Producción: https://sistema.vegetalesargentinos.com · Repo: github.com/Joaqcoli/agrologix-erp
- **Se trabaja directo sobre `main` y Render auto-deploya cada push.** La rama `develop` quedó
  abandonada (no usarla). Para cambios grandes, rama corta → merge fast-forward a `main`.
- Joaquín no quiere flujo local-first: el cierre normal de una tarea es commit + push a `main`.
- Credenciales: Render Secret File `.env`. Nunca commitear `.env`, certificados ARCA ni extractos.
  Nunca escribir passwords o connection strings en comandos (quedan guardados en `.claude/settings.local.json`):
  para psql/node usar la variable del `.env` (`psql "$DATABASE_URL"`, `node -r dotenv/config`).

## Cómo trabajar (obligatorio)
1. **Fase 0 — diagnóstico (solo lectura).** Antes de tocar nada: leer el código involucrado,
   medir con datos reales de la base, explicar causa raíz y plan. Esperar el OK.
2. **Fase 1 — implementación** con salvaguardas: cambio mínimo, sin efectos colaterales en
   otros módulos, build OK (`npm run build`), y verificación con datos reales después del deploy.
3. **Al terminar, actualizá `ESTADO.md`** (qué se hizo con hash del commit, qué quedó pendiente,
   qué tiene que verificar Joaquín a mano) y commitealo junto con el cambio.
- Causa raíz, no parches de síntoma. Pensar el flujo del sistema completo.
- Diagnósticos largos van a un `docs/AUDITORIA-*.md`, no al chat.
- **Rediseños visuales = solo presentación**: no tocar, quitar, agregar ni cambiar lógica. Si el
  módulo real tiene algo que la maqueta no muestra, se reestiliza conservando su función.
  (Esta regla aplica solo a tareas de rediseño.)

## Reglas de negocio que no se rompen
- **Unidades** (siempre MAYÚSCULAS): BOLSA, CAJON, KG, UNIDAD, ATADO, MAPLE, BANDEJA.
  Stock siempre en **unidad base**, una fila base por producto, envase = base × `weight_per_unit`.
- **Costo = promedio ponderado móvil (WMA).** FIFO eliminado. Compra a $0 suma stock sin tocar el costo.
- **Remitos aprobados son inmutables en costos**: el sync de compras solo toca pedidos `draft`.
  `override_cost_per_unit` tiene prioridad sobre `cost_per_unit` en toda ganancia.
- **IVA**: `products.iva_rate` + `shared/iva.ts` (10,5% general, 21% huevos/maple), solo clientes
  con IVA (`customers.iva_since`). `orders.total` guarda el neto. La ganancia se mide contra venta con IVA.
- **Precios**: por cliente **y unidad**; nunca cruzar unidades. Grupos de precio compartido
  (`client_groups`) replican el último precio aprobado. El servidor decide el precio al crear pedido.
- **Cuenta corriente**: saldo = `opening_balance` + facturación − cobranza − retenciones.
  Cobranza = `payments.method != 'RETENCION'`. Sedes cargan a la sede; la CC se unifica en el padre.
- **Remito**: `orders.remito_num`, formato `VA-XXXXX` correlativo por cliente, editable.
- **Bolsa FV**: se cobra y factura, costo $0, no descuenta stock (intencional).
- **Fechas**: zona Argentina. Nunca `new Date('YYYY-MM-DD')` ni `toISOString()` para fechas puras.
- **Roles**: `ROLE_API_WHITELIST`, vendedor default-deny, el vendedor nunca ve costos ni márgenes;
  la vista galpón no ve montos.
- Pedidos históricos importados (`notes LIKE '%Facturación histórica importada%'`) se excluyen de estadísticas.

## Integraciones
- **ARCA/AFIP**: WSAA + WSFE directo, punto de venta 4.
- **Mercado Pago**: `/v1/payments/search` funciona; `/v1/account/balance` NO (404/403 con esta credencial).
- **Galicia**: extracto CSV subido desde Bancos (parser con cruce automático de cheques).

## Dónde está cada cosa
- `server/storage.ts` (lógica + queries, muy grande), `server/routes.ts`, `shared/schema.ts`.
- `client/src/pages/<módulo>`: bancos, caja, cuentas-corrientes, orders, purchases, suppliers, galpon, vendedor…
- Auditorías y diagnósticos previos: `AUDITORIA-*.md` en la raíz. Maquetas de rediseño: `diseno-caja/`.
- Historia larga del proyecto (deploy, migraciones de datos, bugs viejos): `docs/CONTEXTO-HISTORICO.md`.
