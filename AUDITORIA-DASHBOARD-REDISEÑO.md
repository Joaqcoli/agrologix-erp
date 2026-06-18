# Auditoría — Dashboard admin (diagnóstico pre-rediseño, solo lectura, 2026-06-18)

> **Solo lectura. No se tocó nada.** Cómo está hecho el dashboard actual para poder cambiarle **solo la apariencia** sin tocar datos ni lógica.
> **Conclusión adelantada:** **toda la lógica de cálculo vive en el backend** (`getDashboardStats` + 4 endpoints auxiliares). El front (`dashboard.tsx`) **solo muestra** esos números y hace unas pocas **derivaciones presentacionales** (margen = ganancia/ventas, promedios = total/días, sumas de detalle). **No usa librería de gráficos** (recharts NO está acá) — son cards y tablas con shadcn/ui. Rediseñar la presentación NO toca cómo se calculan los números.

---

## 1. El componente

- **Archivo:** `client/src/pages/dashboard.tsx` (893 líneas). Ruta `/` (admin). Export: `DashboardPage`.
- **Subcomponentes internos (en el mismo archivo):**
  - `MetricCard` (línea 74) — card reutilizable: `title`, `value`, `sub`, `icon`, `loading`, `highlight`, `green`. Es la card base de todas las métricas de arriba.
  - `ComisionesModal` (línea 98) — diálogo de comisiones por vendedor/mes (consume `/api/commissions/*`).
  - Helpers de fecha: `localStr`, `todayRange`, `weekRange`, `monthRange`, `yearRange`, `monthInputRange`, `buildMonthOptions`.
- **Estructura visual (secciones, de arriba abajo):**
  1. Header + **selector de período** (botones `hoy | semana | mes | año | pormes | custom`, default `mes`).
  2. **4 métricas principales** (grid): Ventas · Ganancia bruta (con margen) · Promedio venta/día · Promedio ganancia/día.
  3. Card **"Ganancia real del período"** (bruta + rinde − merma; rinde/merma clickeables → diálogos de detalle).
  4. Card **"Ventas y bultos por semana"** (tabla semanal).
  5. Grilla de cards de **finanzas**: Stock valorizado · Deuda clientes · Cheques en cartera · Deuda proveedores · Cheques emitidos · Ajuste neto (rinde−merma) · Vacíos en mi poder.
  6. Card **Comisiones** (botón → `ComisionesModal`).
  7. Card **Bolsa FV**.
- **Estado/controles:** `period` (tipo `Period`), `customFrom/customTo`, `selectedVendedor`, `selectedMonth`, `bolsaFilter`, y los `open` de los diálogos (`rindeOpen`, `mermaOpen`, `comisionesOpen`). El período arma `[from, to]` (useMemo, línea 268) que alimenta **todas** las queries.

## 2. Mapa de datos — qué número se muestra y de dónde sale

### Endpoint principal: `GET /api/dashboard/stats?from&to` → `storage.getDashboardStats` (`server/storage.ts:4561`)
Devuelve el objeto `Stats`. Cada campo sale de su propia query SQL en el backend:

| Métrica mostrada | Campo `Stats` | Origen en el backend |
|---|---|---|
| Ventas | `ventas` | `salesRow` (pedidos approved, IVA por producto) |
| Ganancia bruta | `ganancia_bruta` | `salesRow` |
| Margen % | *(derivado front)* | `ganancia_bruta / ventas × 100` (línea 391) |
| Promedio venta/día | *(derivado front)* | `ventas / diasTrabajados` (línea 308) |
| Promedio ganancia/día | *(derivado front)* | `ganancia_real / diasTrabajados` (línea 309) |
| Ganancia real | `ganancia_real` | backend: `ganancia_bruta + rinde − merma` |
| Merma / Rinde (totales) | `mermaTotal` / `rindeTotal` | `mermaRow` (`stock_movements` notes ILIKE Merma/Rinde) |
| Ajuste neto | *(derivado front)* | `rindeTotal − mermaTotal` (línea 316) |
| Días período / trabajados | `diasPeriodo` / `diasTrabajados` | backend (`ceil((to−from)/día)` / `diasRow`) |
| Ventas y bultos por semana | `semanas[]` | `ventasSemanaRow` + `bultosSemanaRow` |
| Bultos total | `bultosTotal` | backend |
| Vacíos recibidos / entregados / en poder | `vaciosRecibidosPeriodo` / `vaciosEntregadosPeriodo` / `vaciosEnPoder` | `vaciosRecibidosRow` / `vaciosEntregadosRow` / `vaciosHistRow` |
| Deuda proveedores | `deudaProveedores` | `deudaRow` |
| Deuda clientes | `deudaClientes` | `deudaClientesRow` (CTE `ventas_por_padre`) |
| Cheques emitidos / en cartera | `chequesEmitidos` / `chequesEnCartera` | `chequesRow` |
| Stock valorizado | `stockValorizado` | `stockValRow` (`Σ stock_qty × avg_cost`) |
| Comisiones por vendedor | `comisiones[]` | `comisionesRows` |

> **Override histórico:** para meses históricos (ene/feb/mar 2026) ventas/ganancia se reemplazan por valores cargados (backend, líneas ~211-219). Eso es lógica de negocio del backend — no la toca el front.

### Endpoints auxiliares (mismos `from/to`)
| Endpoint | Para qué | Dónde se muestra |
|---|---|---|
| `GET /api/dashboard/rinde-detail?from&to` | detalle de movimientos de rinde | diálogo (click en Rinde) |
| `GET /api/dashboard/merma-detail?from&to` | detalle de movimientos de merma | diálogo (click en Merma) |
| `GET /api/dashboard/bolsa-fv?from&to&type` | stats de Bolsa FV | card Bolsa FV |
| `GET /api/commissions/salespersons` | lista de vendedores | `ComisionesModal` |
| `GET /api/commissions/detail?vendedor&month` | detalle de comisión de un vendedor | `ComisionesModal` |

→ **Total: 5 endpoints** al cargar/usar el dashboard (stats + rinde + merma + bolsa + commissions/salespersons; el commissions/detail solo al abrir el modal).

## 3. Librerías / componentes usados hoy

- **Gráficos: NINGUNO.** El dashboard admin **no usa recharts** ni SVG charts — son **cards numéricas + tablas** (la tabla semanal es HTML puro). (recharts sí se usa en *otras* páginas: caja, vendedor/dashboard — no acá.)
- **UI (shadcn/ui):** `Card/CardContent/CardHeader/CardTitle`, `Badge`, `Button`, `Input`, `Skeleton` (loading), `Dialog`, `Select`.
- **Íconos:** `lucide-react` (`TrendingUp`, `Package`, `Truck`, `AlertTriangle`, `Users`, `Download`, `Info`, `CreditCard`).
- **Datos:** `@tanstack/react-query` (`useQuery`).
- **Formato:** `fmtPesos`/`fmtMiles` de `@/lib/format` (ver [[formateadores-compartidos]]).
- **PDF:** `generateBolsaFvPDF`, `generateComisionesPDF` de `@/lib/pdf` (export de reportes).

→ El diseño nuevo se puede reconstruir con **los mismos componentes shadcn** (o nuevos), y si querés gráficos, recharts **ya está en el proyecto** (se usa en otras páginas).

## 4. Qué hace al cargar

- Calcula `[from, to]` según el `period` (default `mes`) y dispara las queries de react-query con ese rango.
- `useQuery` cachea por `queryKey` (incluye from/to) → al cambiar el período, refetch.
- Estados de carga: `isLoading` (stats) y `bolsaLoading` → `Skeleton` en las cards.
- Los diálogos (rinde/merma/comisiones) y sus queries se activan al abrirlos.

## 5. Qué NO hay que tocar (la lógica)

- **Toda la lógica de cálculo vive en el backend:** `getDashboardStats` (ventas, ganancia, merma/rinde, deudas, cheques, stock valorizado, vacíos, comisiones, semanas, override histórico) + los endpoints de rinde/merma/bolsa/commissions. El SQL y las fórmulas están del lado del server.
- **El front solo MUESTRA** + hace derivaciones **presentacionales** (no de negocio): margen = ganancia/ventas, promedios = total/días, ajuste = rinde−merma, sumas de los arrays de detalle. Son divisiones/restas de números que ya vienen del backend — NO recalculan nada.
- → **Rediseñar la presentación (`dashboard.tsx`) NO cambia ningún número.** Mientras el diseño nuevo:
  - consuma los **mismos 5 endpoints** con el mismo `[from, to]`,
  - lea los **mismos campos** de `Stats` (y los arrays de detalle),
  - mantenga las derivaciones presentacionales (o las recalcule igual desde los mismos campos),
  …los datos quedan idénticos. Lo único que cambia es el layout/estilo.

## 6. Para el rediseño (paso 2, cuando se decida)

- Reemplazar el JSX de `DashboardPage` por el diseño nuevo, **conectándolo a los mismos hooks `useQuery`** (mismas `queryKey`) y a los mismos campos de `Stats`.
- Conservar: el **selector de período** (alimenta from/to → todas las queries), los **estados de loading** (Skeleton), los **diálogos** de rinde/merma/comisiones y la card de Bolsa FV (o reubicarlos en el diseño nuevo).
- No tocar: `server/storage.ts:getDashboardStats`, los endpoints `/api/dashboard/*` y `/api/commissions/*`, ni `@/lib/pdf`.
- Riesgo del rediseño = solo visual/JSX. Verificación natural: que cada número del diseño nuevo coincida con el actual para un mismo período.

**Solo lectura. Nada tocado.**
