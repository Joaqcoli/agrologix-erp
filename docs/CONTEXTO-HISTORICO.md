# AgroLogix ERP — Contexto del Proyecto

Documento de contexto para Claude. Resume el estado del sistema, decisiones tomadas, convenciones, problemas resueltos y pendientes. Cubre desde la construcción de los módulos core hasta el deploy en producción y la carga de datos reales de enero–abril 2026.

---

## 1. Qué es el sistema

ERP a medida para **Vegetales Argentinos SRL**, distribuidora de frutas y verduras en Argentina. El dueño (Joaquín) no programa: usa Claude (chat) para generar prompts detallados que pega en Claude Code, que ejecuta los cambios. El flujo de trabajo típico es: Joaquín describe el problema → Claude arma el prompt → Claude Code diagnostica/implementa → Joaquín verifica en localhost → sube a producción.

**Stack:** Node/Express + PostgreSQL en Supabase (transaction pooler, puerto 6543, región sa-east-1) + React/Vite + Drizzle ORM + jsPDF para PDFs + TanStack Query en el frontend.

**Producción:** https://agrologix-erp.onrender.com (Render.com)
**Repo:** github.com/Joaqcoli/agrologix-erp

**Usuarios:** admin (`admin@erp.com`, rol admin) y vendedor Juan (`juan@vegetalesargentinos.com`, rol vendedor). Las contraseñas por defecto quedaron pendientes de cambiar. Los hashes son bcryptjs con salt 10, columna `users.password_hash`.

---

## 2. Infraestructura y deploy

### Historia del deploy
1. **Railway (abandonado):** las variables de entorno configuradas en el dashboard nunca llegaron al proceso (`/health` mostraba todas ausentes). Se sospechó de un plugin de Postgres de Railway inyectando su propia `DATABASE_URL` a localhost. Nunca se resolvió; se migró.
2. **Render (actual):** funciona, con particularidades importantes:
   - Las env vars del dashboard **tampoco** llegaban de forma confiable. La solución definitiva fue usar **Secret Files** de Render: un archivo `.env` montado en runtime con `DATABASE_URL` y `SESSION_SECRET`.
   - `server/env.ts` es el **primer import** de `server/index.ts` y carga dotenv desde `cwd/.env` y `cwd/dist/.env` antes de que cualquier módulo lea `process.env`.
   - `server/db.ts` lee `process.env.SUPABASE_URL || process.env.DATABASE_URL` y lanza error explícito si no hay ninguna (para evitar el fallback silencioso a localhost que causaba ECONNREFUSED 127.0.0.1:5432).
   - Endpoint `GET /health` devuelve status + qué variables de entorno ve el proceso. Se usó mucho para diagnóstico; se mantuvo para monitoreo.

### Configuración de Render
- **Build Command:** `npm install && npm run build` (Render no siempre corre install solo).
- **Start Command:** `npm run start` → `NODE_ENV=production node dist/index.cjs`.
- Todos los paquetes que el build necesita están en **`dependencies`** (no devDependencies), porque Render los omitía: `tsx`, `esbuild`, `vite`, `typescript`, `@vitejs/plugin-react`, `autoprefixer`, `postcss`, `tailwindcss`, `@tailwindcss/vite`, `@tailwindcss/typography`. Si aparece "Cannot find module X" en el build de Render, mover X a dependencies y hacer "Clear build cache & deploy".
- El build usa `script/build.ts` (vite para cliente + esbuild bundle CJS para servidor, con `define: process.env.NODE_ENV = "production"` únicamente — no inlinea otras vars).

### Sesiones en producción
Express-session detrás del proxy de Render requiere:
- `app.set('trust proxy', 1)`
- Cookie: `secure: true` en producción, `httpOnly: true`, `sameSite: 'none'`

Sin esto, el login devolvía "Not authenticated" en cada request aunque las credenciales fueran correctas.

### Limitaciones conocidas
- **Render free tier se duerme** tras ~15 min de inactividad; la primera request tarda ~30 s. Opciones evaluadas: upgrade a Render Starter (~USD 7/mes) o migrar a Fly.io región São Paulo (mejor latencia desde Argentina). Sin decisión tomada en esta etapa.
- Supabase free tier pausa proyectos inactivos (pasó una vez; se reactivó manualmente desde el dashboard).

---

## 3. Flujo de trabajo Git

- **Rama `develop`** = desarrollo local. `git checkout develop && PORT=3001 npm run dev` (puerto 3001 porque macOS AirPlay ocupa el 5000).
- **Rama `main`** = producción. Render auto-deploya en cada push a main.
- **Subir a producción:** `git checkout main && git merge develop && git push origin main && git checkout develop`.
- Claude Code suele commitear solo, pero a veces deja archivos modificados sin commit. Si el merge dice "Already up to date" con archivos `M` listados, hacer `git add . && git commit` en develop antes del merge.
- El `.env` con credenciales estuvo commiteado en el historial de git en algún momento (se removió y se corrigió `.gitignore`); Claude Code recomendó rotar la contraseña de Supabase por precaución.

---

## 4. Modelo de datos y convenciones clave

### Unidades de medida
Las únicas 7 unidades válidas en todo el sistema, **siempre en MAYÚSCULAS**:
`BOLSA, CAJON, KG, UNIDAD, ATADO, MAPLE, BANDEJA`

- **Unidades de envase** (CAJON, BOLSA, MAPLE, BANDEJA) tienen una **unidad base** (KG, UNIDAD, ATADO, o MAPLE para huevos) y un `weight_per_unit` (promedio ponderado de unidades base por envase).
- **El stock se almacena SIEMPRE en unidad base** con un único `avg_cost` (costo promedio ponderado móvil / WMA) en `product_units`. Una sola fila base por producto.
- Costo mostrado del envase = `avg_cost × weight_per_unit`.
- Caso especial huevos: unidad base MAPLE; 1 CAJON = 12 MAPLES siempre.
- CAJON y KG son independientes en pedidos: no hay conversión automática de precios de venta entre unidades (sí de stock al descontar).

### Costos (reglas críticas)
- **WMA:** `nuevoAvgCost = (stockActual × costoActual + qtyComprada × costoCompra) / (stockActual + qtyComprada)`, siempre en unidad base. El frontend de compras convierte cajón→KG antes de enviar (`quantity = cajones × kgPorCajón`, `costPerUnit = $porCajón / kgPorCajón`); esa conversión está verificada correcta.
- **El SYNC de compras solo toca pedidos `draft`.** Tanto `createPurchase` como `updatePurchase` tenían un bug donde el bloque SYNC actualizaba `costPerUnit` también en pedidos `approved` del mismo día, modificando retroactivamente remitos cerrados. Corregido en ambos: filtro `orders.status = 'draft'`.
- **`override_cost_per_unit` tiene prioridad** sobre `cost_per_unit` en TODOS los cálculos de ganancia (getOrders, dashboard, CC). Los costos editados manualmente en un pedido se guardan como override; ignorarlo causaba ganancias infladas (bug del 13/04).
- **Compra con costo $0:** válida. Suma stock normalmente pero NO modifica el avg_cost existente.
- Al editar una compra, `updatePurchase` también actualiza `weightPerUnit` y convierte el costo para items en unidad de envase (alineado con createPurchase).

### IVA
- Clientes con `has_iva = true` pagan IVA adicional que **no está en `orders.total`** (el total guarda el neto).
- Tasas: **21% para huevos/maples** (producto con nombre o categoría que matchee huevo/maple), **10.5% para todo lo demás**.
- **Ventas y ganancia en dashboard/CC se calculan CON IVA**: ganancia = venta con IVA − costo. El cálculo se hace por `order_item` (no por pedido) para aplicar la tasa correcta por producto.
- **Excepción:** los datos históricos importados del Excel (facturación ene/feb/mar) YA incluyen IVA; no se les aplica de nuevo.

### Remitos y folios
- `orders.remito_num` (integer) = número de remito real del negocio. **No confundir con `remito_id`**, que es FK a la tabla `remitos` (remitos formales del sistema); por eso se creó columna nueva.
- **Folio `VA-XXXXX` correlativo POR CLIENTE** (reemplazó el contador global PV-XXXXX). Cada cliente tiene su propia secuencia.
- Formato visible en toda la UI y PDFs: `VA-${remitoNum padStart 5}`. Fallback al folio si remitoNum es null. No debe verse "PV-..." en ningún lado.
- El número de remito es **editable manualmente** en el pedido; al cambiarlo, el contador de ese cliente continúa desde ese número + 1.

### Grupos de clientes (dos sistemas distintos)

**a) Sedes / cliente padre** (`customers.parent_customer_id`):
- Cliente padre agrupa sedes; la **cuenta corriente es unificada en el padre** con desglose por sede.
- LUSQTOFF → sedes "LUSQTOFF - SEDE IRALA" y "LUSQTOFF - SEDE MORENO".
- BLACK POT → 11 colegios (todos con "COLEGIO" en el nombre).
- Los pedidos se cargan siempre a la sede específica; la CC del padre suma pedidos y pagos de todos los hijos + propios.
- Cada sede puede tener su propio pedido el mismo día (la detección de duplicados lo contempla).
- En CC del padre: los pedidos del período muestran a qué sede pertenecen; al clickear una sede se ve su estado de cuenta (solo lectura, sin cargar pagos, con PDF exportable).
- Máximo 2 niveles de jerarquía (el dropdown de padre solo muestra clientes sin padre).

**b) Grupos de precios compartidos** (tablas `client_groups` + `client_group_members`):
- Grupos: **BLACK POT** (los colegios), **LUSQTOFF** (padre + 2 sedes), **QUINQUELA-MARQUESA**, **COMO SIEMPRE-MESTIZO**.
- Al buscar el último precio de venta para un cliente del grupo, si no tiene precio propio se busca el más reciente entre TODOS los miembros.
- Al aprobar un remito, los precios se replican a los peers del grupo vía `priceHistory`.
- **La replicación es por producto + UNIDAD** (bug corregido): el priceMap usa clave `productId:unit`, el UPDATE filtra `AND unit = X`, y priceHistory guarda la unidad. Nunca replicar precio de KG a BOLSA.

### Cuentas corrientes
- **Cobranza** = `payments WHERE method != 'RETENCION'`.
- **Retenciones** = `payments WHERE method = 'RETENCION'`. La tabla `withholdings` existe pero está **vacía y no se usa** — todo vive en `payments`.
- **Saldo inicial** de cada cliente = `customers.opening_balance` (NO como payment; se intentó como payment con method SALDO_ANTERIOR y se descartó porque sumaba mal).
- Fórmula: `saldo = opening_balance + facturación − cobranza − retenciones`, todo acumulado hasta la fecha.
- Filtros: por mes, semana o día (el backend recibe dateFrom/dateTo).
- Métodos de pago vistos en payments: EFECTIVO, TRANSFERENCIA, RETENCION (y CHEQUE contemplado).

---

## 5. Módulos construidos / modificados en esta etapa

### Pedidos (orders)
- **Edición inline rediseñada:** hover muestra lápiz (editar) y X (eliminar); en edición aparece tilde verde para confirmar; Enter o tilde guardan. **Optimistic updates** (onMutate/onError/onSettled de React Query): el cambio se ve al instante y se revierte con toast si el servidor falla. Edición múltiple: filas con cambios pendientes (fondo amarillo sutil) se guardan todas juntas al confirmar cualquiera.
- **Precio $0 = bonificación:** dialog pregunta si es bonificación; si sí, `order_items.is_bonification = true` y el remito PDF muestra "(Bonificación)" junto al producto.
- **Costo $0:** dialog individual POR LÍNEA preguntando si esa línea descuenta stock o no.
- **Cliente FV** (`bolsa_fv = true`): marcar "bolsa" o "bolsa propia" en una línea pone costo $0 automático y no descuenta stock, sin dialog.
- **Cambio de unidad recalcula el costo automáticamente** (base → avg_cost; envase → avg_cost × weight_per_unit) y al aprobar descuenta stock en la unidad base correcta.
- **Último precio de venta automático:** al crear un pedido, cada producto trae el último `price_per_unit` cobrado a ese cliente (o su grupo de precios) **en esa unidad específica**. Endpoint `GET /api/products/:id/last-price?customerId=X&unit=Y`. Primera vez producto+unidad+cliente → sin precio.
- La ganancia del resumen del día se muestra **siempre en verde** (antes se ponía roja con margen < 30%).
- `orders.total` debe coincidir con la suma de items; hubo desfasajes que se corrigieron con UPDATE recalculando desde order_items.

### Carga de pedidos (load-list)
- **Parser de cantidades:** `1/2`→0.5, `1/4`→0.25, `3/4`→0.75, `3 1/2`→3.5, `200g`→0.2 (kg), `2k`/`2 k`/`2kg`→2, `1/2k`→0.5 kg. Si no parsea, el campo queda editable (nunca bloquear ni poner 0).
- **`unitFromText`:** el parser distingue si la unidad vino escrita en el texto del pedido o fue inferida. Si el usuario escribió "1 cajon limon", esa unidad se respeta y NUNCA se pisa con el historial. El historial de unidades solo pre-rellena cuando el texto no traía unidad.
- **Memoria de unidades:** la unidad confirmada para un producto queda guardada y no se vuelve a preguntar en pedidos posteriores.
- La unidad seleccionada se puede cambiar en cualquier momento (antes quedaba bloqueada).
- **Búsqueda de productos ambiguos:** filtrado por similitud real con el texto (antes mostraba siempre los primeros productos de la DB — brotes de alfalfa/rabanito/soja — sin relación). Si no hay similitud suficiente, lista vacía + escritura libre.

### Compras (purchases)
- Botón "Agregar" inserta el nuevo item **arriba** de la lista (unshift), no al fondo.
- Fix de redondeo: se eliminó `Math.round()` que truncaba el costo por unidad base (1 bolsa $13.000/18kg quedaba como $12.999,99).
- **Editar compra muestra las unidades ORIGINALES de compra** (`purchaseQty`/`purchaseUnit`: cajones, bolsas), no la conversión a kg.
- Campo "Costo vacío (seña por cajón)" para envases; total compra = productos + vacíos.
- Formas de pago: Efectivo/Transferencia → `is_paid=true` + supplier_payment automático; Cuenta Corriente → `is_paid=false`.
- **Fechas:** bug de timezone corregido (se guardaba/mostraba un día antes). Regla: nunca usar `new Date(str)` ni `toISOString()` para fechas puras; construir el string `YYYY-MM-DD` local al enviar y parsear con `new Date(y, m-1, d)` al mostrar. Aplica también a pedidos.

### Dashboard
- Ventas y ganancia con IVA por item (ver sección IVA).
- **Excluir siempre** pedidos con `notes LIKE '%Facturación histórica importada%'` de todos los cálculos.
- **Promedios por días TRABAJADOS**: `COUNT(DISTINCT order_date)` de pedidos aprobados no-históricos, no días de calendario. El backend retorna `diasTrabajados` y el frontend divide por eso.
- **Deuda clientes:** por cliente activo SIN padre (`parent_customer_id IS NULL`): opening_balance + facturación con IVA − cobranza − retenciones; solo suma los que tienen saldo > 0.
- **Deuda proveedores:** compras no pagadas / en cuenta corriente − supplier_payments.
- **Meses históricos (enero/febrero/marzo 2026):** no hay pedidos reales, así que los datos vienen del Excel vía `server/historical-stats.ts` (lee y cachea el archivo) y endpoint `GET /api/dashboard/historical?month=X&year=Y`. La ganancia bruta sale de la celda "GANANCIA BRUTA ACUMULADA" de cada pestaña de CC. getCCSummary y getDashboardStats hacen override con esos valores cuando el período es un mes histórico.
- **Detalle de comisiones por vendedor:** modal con filtro vendedor + mes/año; tabla por día con cliente, monto sin IVA, % comisión (`customers.commission_pct`), monto comisión; totales; export PDF. Endpoint `GET /api/commissions/detail?salesperson=X&month=Y&year=Z`.

### Cuentas Corrientes (frontend + PDF)
- El PDF se genera 100% client-side con jsPDF en `client/src/pages/cuentas-corrientes/detail.tsx`.
- **Diseño según plantilla Canva "VA CTA. CTE."** (ID DAHGjmAV9js): header verde oscuro #2d5016 con logo, datos de la empresa (CUIT 30-71855184-2, WhatsApp 11-7123-2459, email vegetalesargentinos.srl@gmail.com, web), título "CTA. CTE."; tabla FECHA | N REMITO | N FACTURA | MONTO (header verde #3a5f1e, filas alternadas); fila especial "SALDO ANTERIOR" cuando aplica; fila final "TOTAL A PAGAR"; footer con contacto.
- **Lógica del contenido:** remitos pagados en su totalidad NO se muestran (no aparecen como pago, directamente desaparecen); solo remitos pendientes. Si hay pagos parciales o saldo histórico, primera fila "SALDO ANTERIOR: $X" y debajo los remitos pendientes.
- Nro. de factura editable inline por pedido (`invoice_number`); si no hay, el PDF muestra "---".
- Existe también PDF por sede (SubsidiaryDialog), solo lectura.

### Vista Vendedor
- Rol `vendedor` en el enum + middleware `requireVendedor`.
- Login con rol vendedor redirige a `/vendedor/dashboard`. Sidebar propio con 3 módulos:
  - **Dashboard:** ventas del período (mismos filtros que admin), total comisionado, cantidad de clientes. SIN ganancias/costos/márgenes.
  - **Pedidos:** solo pedidos de sus clientes (`salesperson_name` = vendedor logueado); resumen diario de vendido + comisión; detalle read-only del pedido con descarga de remito PDF, sin costos.
  - **Clientes:** lista/crea/edita solo los propios; al crear, `salesperson_name` se auto-asigna. Los clientes creados aparecen también en la cuenta admin.
- Endpoints `/api/vendedor/dashboard`, `/api/vendedor/orders`, `/api/vendedor/orders/:id`, `/api/vendedor/customers` (GET/POST/PATCH) — todos filtran por el salesperson del usuario logueado y no exponen costPerUnit ni margen.

### Logo y branding
- Logo apaisado de la empresa en `client/public/logo.png`. Reemplaza texto "AgroLogix"/"Sistema de Distribución" en login (max-width 280px) y en el sidebar (max-width ~160-180px).

---

## 6. Scripts de migración de datos

### `scripts/migrate-sheets.ts` (primera generación — enero/febrero)
Script inicial. Aprendizajes que heredó el segundo script: import de xlsx vía `createRequire` (es CJS sin default export; `import * as XLSX` deja readFile undefined en tsx/ESM), inicializar contador de folios desde MAX en DB, `SELECT 1` de conexión al arrancar, y que los try/catch amplios silenciaban errores de constraint (el folio NOT NULL hacía fallar todos los INSERT de orders sin mostrar nada).

### `scripts/migrate-data-2026.ts` (script actual)
Lee `attached_assets/info 2026.xlsx`. **Flags:** `--dry-run` (simula), `--cc-only` (solo cuentas corrientes), `--dia-only` (solo pestañas de días nuevos, sin tocar payments/opening_balance/históricos).

**Estructura del Excel:**
- Pestañas `DD-MM-YYYY` = pedidos de un día. Cada hoja tiene bloques por cliente: fila de encabezado con nombre en col A y número de remito en col C, D o E (formato `rto: X` o número entero puro — ambos detectados); luego filas de productos (CANTIDAD | UNIDAD | PRODUCTO | PRECIO | TOTAL | TOTAL+IVA); col G puede decir BOLSA / BOLSA PROPIA; col I = precio de compra.
- Pestañas `CUENTAS CORRIENTES ENERO/FEBRERO/MARZO/ABRIL`: fila 2 headers [CLIENTE, SALDOS MES ANTERIOR, FACTURACION, COBRANZA, RETENCIONES, SALDO]; una fila por cliente. Contienen además celda "GANANCIA BRUTA ACUMULADA" y resúmenes semanales (usados por historical-stats).
- Pestañas ignoradas: "JUAN COMISION(ES)", "EXTRAS FV", filas de resumen (`CC_SKIP_NAMES`: CONTADO, TOTAL, "1° SEMANA...", VENTA DEL MES, PROMEDIO..., etc.).

**Reglas de importación:**
- Clientes/productos: fuzzy matching con normalización (sin acentos, lowercase, trim). **Similitud ≥80% → match automático; 50–80% → consulta interactiva por readline** (usar existente / crear nuevo / escribir nombre); <50% → crea nuevo. Los aliases confirmados se recuerdan durante la corrida.
- `CLIENT_ALIASES` (mapa hardcodeado, casos reales): PAULA CASEROS→PAULA CASERO; FV S.A(.)→FV; MARQUESA→LA MARQUESA; LUSQTOFF - IRALA/MORENO→LUSQTOFF - SEDE IRALA/MORENO; UNIVERSIDAD DE MORENO→UNIVERSIDAD MORENO; RAKUS (variantes)→RAKUS CAFE; CARLOTA VIANDAS / CARLOTA CARAF VIANDAS→CARLOTA CARAF VIANDAS (nota: en una corrida se confirmó "CARLOTA CARAF" como canónico — verificar en DB cuál quedó); FABRIC - MORENO / FABRIC SUSHI→FABRIC SUSHI - GORRITI; CAFE MARTINEZ - MORENO CENTRO→CAFE MARTINEZ - MORENO; CAFE MARTINEZ - MORENO GORRITI→CAFE MARTINEZ - CAAMAÑO; CATERING→ST CATERING (o S&T CATERING según DB); COLEGIOS (en CC)→BLACK POT. Los colegios del Excel vienen con dirección ("COLEGIO SJCB - VIRREY DEL PINO 3299") y en DB están con nombre corto.
- Duplicados: por customer_id + order_date, PERO cada sede puede tener su pedido el mismo día, y un mismo cliente puede tener 2 pedidos el mismo día (bloques separados del Excel) — ambos casos contemplados tras bugs.
- Pedidos importados: `status='approved'`, remito_num desde el Excel, folio VA correlativo por cliente.
- **Facturación histórica de ene/feb/mar:** un pedido por cliente-mes con folio `PV-HIST-{MES}-{id}`, fecha último día del mes, `notes='Facturación histórica importada'`, un solo item con producto "FACTURACIÓN HISTÓRICA" por el monto total. Estos pedidos existen SOLO para que el saldo de CC arrastre bien; se excluyen de dashboard y estadísticas. Los montos de clientes con IVA ya lo traen incluido (no recalcular).
- Saldos diciembre 2025 → `customers.opening_balance`. Cobranzas → payments TRANSFERENCIA con fecha último día del mes. Retenciones → payments RETENCION. Todos los montos con `Math.abs()`.

**Uso operativo diario:** Joaquín agrega la pestaña del día al Excel (editándolo directamente en la carpeta del proyecto) y corre `npx tsx scripts/migrate-data-2026.ts --dia-only --dry-run` y luego sin dry-run. Los días ya cargados se saltean.

---

## 7. Problemas encontrados y cómo se resolvieron

| Problema | Causa | Solución |
|---|---|---|
| `XLSX.readFile is not a function` | xlsx es CJS sin default export; tsx en ESM lo envuelve mal | `createRequire` para require explícito |
| Script importaba clientes pero no pedidos | `folio TEXT NOT NULL` violado, silenciado por try/catch | Incluir folio en el INSERT + logs explícitos + errores inmediatos |
| Railway: env vars nunca llegaban | Nunca confirmado (sospecha: plugin Postgres inyectando DATABASE_URL) | Migración a Render |
| Render: "tsx/esbuild/vite/autoprefixer not found" en build | Paquetes en devDependencies + cache viejo | Todo lo de build a dependencies + `npm install && npm run build` + Clear build cache |
| Render: env vars del dashboard no llegaban | Comportamiento de Render | Secret Files (.env) + server/env.ts como primer import |
| Login OK pero "Not authenticated" en cada request en producción | Cookies detrás de proxy HTTPS | `trust proxy 1` + `sameSite: 'none'` + `secure: true` |
| Pantalla en blanco en Productos/Stock | queryFn sin validar `r.ok`; respuesta `{error}` no es array → `.filter is not a function` → React desmonta todo | Guards `Array.isArray(data) ? data : []` + ErrorBoundary global en App.tsx |
| Fechas guardadas un día antes | `new Date(str)` interpreta UTC; Argentina UTC−3 | Strings YYYY-MM-DD locales al enviar; `new Date(y, m-1, d)` al mostrar |
| Retenciones infladas dentro de cobranza; retenciones en $0 | Queries de CC no filtraban `method`; tabla withholdings vacía | Cobranza: `method != 'RETENCION'`; retenciones: `payments WHERE method='RETENCION'` |
| Saldos anteriores sumaban en vez de deber | Se importaban como payment | Columna `opening_balance` en customers |
| Ventas/ganancia del dashboard no cuadraban | (a) sin IVA, (b) promedios por días de calendario, (c) pedidos históricos incluidos | IVA por item (10.5/21%), diasTrabajados, filtro de notes |
| Ganancia del 13/04 inflada | getOrders ignoraba `override_cost_per_unit` | `override_cost_per_unit ?? cost_per_unit` en todos los cálculos |
| Editar/crear compra modificaba costos de remitos cerrados | SYNC con `status IN ('draft','approved')` | Solo `'draft'` en createPurchase y updatePurchase |
| Costo promedio "raro" del limón ($12.558 vs $10.666 esperado) | No era bug: había stock previo que el WMA incluye correctamente | Verificado; conversión cajón→KG del frontend correcta |
| Precio de KG replicado a BOLSA en grupos de precios | priceMap con clave solo productId; UPDATE y priceHistory sin unit | Clave `productId:unit`, `AND unit=`, columna unit en priceHistory |
| Unidad escrita por el usuario pisada por historial ("1 cajon" → kg) | Pre-relleno de historial sin distinguir origen | Flag `unitFromText`; historial solo si false |
| Sugerencias de productos irrelevantes (siempre "brotes") | Lista sin filtrar por similitud (orden de inserción) | Fuzzy + orden por relevancia + escritura libre |
| Pedido de LUSQTOFF asignado al padre en vez de la sede | Alias apuntaba al padre; sedes en DB con prefijo "SEDE" | Reasignación por SQL + aliases a "LUSQTOFF - SEDE X"; cliente duplicado eliminado |
| Colegio ST CATHERINES con parent AUPA | Dato preexistente incorrecto | `UPDATE customers SET parent_customer_id = 92 (BLACK POT)` |
| "Cliente" COLEGIOS en CC | Nombre agregado en el Excel para el grupo | Alias COLEGIOS→BLACK POT |
| Merge a main "Already up to date" con cambios visibles | Archivos modificados sin commit en develop | `git add . && git commit` antes del merge |

---

## 8. Decisiones de negocio relevantes

- **Los remitos aprobados son inmutables en costos:** ninguna compra posterior (crear o editar) modifica el costo de un pedido ya aprobado. Solo borradores se sincronizan.
- **La ganancia se mide contra la venta CON IVA** porque el negocio contabiliza el IVA como parte del ingreso.
- **Bolsa FV:** las líneas bolsa/bolsa propia del cliente FV se cobran pero no tienen costo ni descuentan stock; en el remito se suman con la línea normal del mismo producto.
- **Precios por cliente Y unidad:** nunca se cruza el precio de una unidad a otra, ni siquiera dentro de un grupo de precios.
- **Sedes con remito propio, CC unificada:** cada sede/colegio pide y factura por separado, pero el pago es uno solo al padre.
- **CC en PDF muestra solo lo pendiente:** un remito pagado completo desaparece (no se lista como pago); los pagos parciales se reflejan como "SALDO ANTERIOR".
- **El vendedor no ve costos ni márgenes en ningún lado**, solo ventas y su comisión.
- **Comisiones se calculan sobre el monto sin IVA** del pedido × `commission_pct` del cliente.
- La numeración de remito la controla el negocio (editable), no el sistema.

---

## 9. Pendientes abiertos al cierre de esta etapa

1. **Diferencia ~$300.000 en abril:** la pestaña "CUENTAS CORRIENTES ABRIL" del Excel suma ~$77M de facturación pero los pedidos del sistema suman ~$76,7M. Se armó la query de diagnóstico (comparar clientes con facturación en Excel vs pedidos en DB) pero no se llegó a identificar qué pedido falta.
2. **Reimportación de fin de abril:** se pidió eliminar y reimportar los días 21, 22, 24, 27, 28, 29 y 30/04 (dejando el 23/04 intacto) desde el Excel actualizado, con consulta interactiva para clientes ambiguos. El prompt se envió; falta confirmar que la corrida quedó bien y que las CC de esos clientes cerraron.
3. **Hosting:** Render free se duerme (~30 s de arranque). Decidir entre Render Starter o migrar a algo con región São Paulo.
4. **Contraseñas por defecto** de admin y Juan sin cambiar; no existe aún un "cambiar contraseña" desde la UI.
5. **Bug heredado** (de la etapa anterior, sin retomar): agregar una unidad extra a un producto existente (ej. sumarle CAJON a un producto que solo tenía KG) se guarda en DB pero no se propaga bien al resto del sistema.
6. Verificar en DB el nombre canónico definitivo de CARLOTA (CARAF vs CARAF VIANDAS) y de CATERING (ST vs S&T) — hubo instrucciones ligeramente distintas en corridas sucesivas.
7. Limpieza de filas base duplicadas en `product_units` (se detectó en RUCULA y HUEVO N1 durante el diagnóstico de unidades; el fix se pidió junto con unitFromText — confirmar que se ejecutó).

---

## 10. Comandos de referencia

```bash
# Desarrollo local
git checkout develop
PORT=3001 npm run dev          # localhost:3001

# Subir a producción (Render auto-deploya main)
git add . && git commit -m "..."   # si hay cambios sin commitear
git checkout main && git merge develop && git push origin main && git checkout develop

# Migración de datos
npx tsx scripts/migrate-data-2026.ts --dry-run      # simular todo
npx tsx scripts/migrate-data-2026.ts --cc-only      # solo cuentas corrientes
npx tsx scripts/migrate-data-2026.ts --dia-only     # solo días nuevos (uso diario)

# Diagnóstico producción
# GET https://agrologix-erp.onrender.com/health
```
