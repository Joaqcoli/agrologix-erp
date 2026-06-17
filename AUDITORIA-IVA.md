# Auditoría M6 — IVA duplicado (diagnóstico, solo lectura, 2026-06-17)

> **Solo lectura. No se unificó nada.** El IVA afecta la facturación, así que esto es para entender antes de tocar.
> **Conclusión adelantada:** la tasa de IVA se decide en **~15 lugares con 3 criterios distintos**. Hoy **no hay divergencia en los datos** (todos los productos de huevo tienen "HUEVO" en el nombre), pero la inconsistencia es **latente**: el día que exista un huevo identificado solo por categoría o por "maple", **la factura cobraría 21% pero la pantalla y el PDF mostrarían 10,5%**. Además el criterio por nombre es frágil.

---

## 1. Inventario completo — dónde se decide el IVA

| # | Lugar | Ámbito | Criterio |
|---|---|---|---|
| 1 | `server/storage.ts:32` `ivaRate(name, cat)` | reportes/CC (itemBilling → CC summary, CC detalle, getOrders, dashboards vendedor) | **A** |
| 2 | `server/routes.ts:18` `getIvaRate(name)` | totales en algunos endpoints (24, 841, 900) | **C** |
| 3 | `server/routes.ts:2082` invoice create `isHuevo` | **FACTURA (CAE → ARCA)** 🧾 | **A** |
| 4 | `server/routes.ts:2213` nota de crédito `isHuevo` | **NOTA DE CRÉDITO (CAE)** 🧾 | **A** |
| 5 | `server/routes.ts:1024` export Excel pedido | export | **A** |
| 6 | `server/routes.ts:1685, 1770` (SQL) | endpoints vendedor | **B** |
| 7 | `server/storage.ts:1179, 1270` (SQL) | getOrders / vendedor | **B** |
| 8 | `server/storage.ts:3638, 4580, 4591, 4691, 4820` (SQL) | CC pendientes / dashboards / reportes | **A** |
| 9 | `client/src/pages/orders/detail.tsx:49` `getIvaRate(name)` | **pantalla del pedido (lo que ve el admin antes de facturar)** | **C** |
| 10 | `client/src/lib/pdf.ts:30` `itemIvaRate(name)` | **remito + PDF de la factura** 🧾 | **C** |
| 11 | `client/src/pages/vendedor/order-detail.tsx:16` `getIvaRate(name)` | pantalla pedido vendedor | **C** |

### Los 3 criterios
- **A — nombre `HUEVO` o `MAPLE`, o categoría `Huevos`** → 21%. (el más amplio)
- **B — nombre `HUEVO` o categoría `Huevos`** (sin maple) → 21%.
- **C — nombre `HUEVO` solamente** → 21%.
- En todos: el resto = **10,5%**. No hay otra tasa.

## 2. Las divergencias (criterios que NO coinciden)

| Producto que… | Criterio A | Criterio B | Criterio C |
|---|---|---|---|
| tiene "huevo" en el nombre | 21% | 21% | 21% |
| tiene "maple" en el nombre (sin "huevo") | **21%** | 10,5% | 10,5% |
| es categoría "Huevos" (sin "huevo"/"maple" en nombre) | **21%** | **21%** | 10,5% |

**El problema grave:** el **PDF de la factura** (pdf.ts, criterio **C**) calcula el desglose de IVA que se imprime, mientras que el **CAE enviado a ARCA** (routes, criterio **A**) se calculó distinto. Para un huevo-por-categoría o huevo-por-maple, **el PDF mostraría un IVA distinto al que se declaró a ARCA**. Y la **pantalla del pedido** (criterio C) mostraría 10,5% pero la **factura cobraría 21%** (criterio A) → el admin ve una cosa y factura otra.

## 3. ¿Hay inconsistencias HOY? — No en los datos, sí latente

Revisé el catálogo real. **Todos los productos de huevo tienen "HUEVO" en el nombre**:
```
HUEVO [Verdura], HUEVO N1 [Huevos], HUEVO N2 [Huevos], HUEVO NRO 1 [Verdura], HUEVOS [Verdura]
Productos con 'maple' en nombre sin 'huevo': 0
Productos categoría 'Huevos' sin 'huevo'/'maple' en nombre: 0
```
→ Como "HUEVO" en el nombre dispara los 3 criterios, **hoy los tres dan 21% para todos** → **0 divergencias reales**. (Dato de color: HUEVO/HUEVO NRO 1/HUEVOS están en categoría **Verdura**, no Huevos; el criterio por categoría hoy nunca se usa porque el nombre ya alcanza.)

**La inconsistencia es una bomba de tiempo:** apenas se cargue un huevo como "DOCENA BLANCA" (categoría Huevos, sin "huevo" en el nombre) o "MAPLE x30", la factura y la pantalla/PDF empezarían a discrepar — y es un error **fiscal**.

## 4. ¿Es confiable "huevo = 21% por nombre"? — No, es frágil

- **Falsos negativos:** un huevo sin "huevo" en el nombre (maple, docena, marca) → se factura 10,5% cuando debería 21% (o al revés según el lugar). Error fiscal.
- **Falsos positivos:** un producto no-huevo con "huevo" en el nombre (poco probable, pero ej. "PLANTA HUEVO DE TORO") → 21% indebido.
- **Errores de tipeo / sinónimos** (WEVO, docena, cartón) no se detectan.
- Depende de una **convención de nombres**, no de un dato. Para algo **fiscal**, eso es frágil.

→ **La tasa de IVA debería ser un dato del producto** (un campo), no adivinarse del nombre. El IVA es una propiedad fiscal del producto, no de cómo se escribe.

## 5. Opciones para unificar (NO implementado)

### (a) Una sola función `ivaRate(name, category)` compartida
Mover la lógica a `shared/` (importable por client y server) y que TODOS los JS la llamen; alinear los criterios SQL a uno solo.
- **Invasividad:** media (reemplazar 5 funciones JS por 1 import + alinear ~8 SQL).
- **Riesgo:** bajo-medio (toca facturación → hay que verificar que el criterio único reproduzca el comportamiento actual de la factura).
- **Fragilidad:** **NO la resuelve** — sigue adivinando por nombre. Solo elimina la divergencia entre lugares.

### (b) Guardar la tasa como campo del producto — RECOMENDADA
Agregar `products.iva_rate` (o `iva_pct`, default 0.105). Backfill de los existentes con el criterio actual (así no cambia nada hoy). Todos los lugares leen el campo (`p.iva_rate` en SQL, `product.ivaRate` en JS).
- **Invasividad:** alta-media (columna + migración + backfill + cambiar ~15 lugares + UI para setear la tasa al crear/editar producto).
- **Riesgo:** medio (fiscal → el backfill debe reproducir EXACTO las tasas de hoy; como hoy todos los huevos tienen "huevo" en el nombre, backfillear con criterio A da lo mismo → factura sin cambios). Después, estable.
- **Fragilidad:** **la resuelve del todo** — el IVA pasa a ser un dato explícito; nombres/typos dejan de importar; un huevo nuevo se marca a mano.

### (c) Híbrido: campo + helper compartido con fallback
`shared/ivaRate(product)` que usa `product.iva_rate` si está seteado, si no cae al criterio por nombre/categoría. Permite migrar gradualmente (agregás el campo, backfilleás, y el helper prefiere el campo).
- **Invasividad:** media (helper + campo nullable; los lugares pasan a usar el helper).
- **Riesgo:** bajo (fallback = comportamiento actual; el campo solo mejora donde se setea).
- **Fragilidad:** la resuelve donde se setee el campo; el resto sigue por nombre hasta backfillear.

## 6. Recomendación

- **Destino: (b)** — el IVA debe ser **un campo del producto** (`iva_rate`), porque es un dato fiscal, no una adivinanza por nombre. Es lo único que mata la fragilidad.
- **Camino seguro (combinando b+c):**
  1. Agregar `products.iva_rate` (default 10,5%) + UI para elegir 10,5%/21% al crear/editar producto.
  2. **Backfill** con el criterio actual (A: name|maple|cat → 21%) → **factura idéntica a hoy** (verificable: ningún producto cambia de tasa, porque hoy todos coinciden).
  3. Un **único helper compartido** `ivaRate(product)` (en `shared/`) que lee `product.iva_rate`; SQL usa `p.iva_rate`. Reemplaza las ~15 copias.
- **Lo sensible (no romper la factura):** antes de aplicar, verificar producto por producto que la tasa backfilleada == la tasa que la factura aplica hoy → cero cambios en comprobantes existentes. Recién después unificar los lugares de display/reporte.

**Solo lectura. Nada tocado.**

---

## 7. ✅ M6 RESUELTO (2026-06-17) — Bloque 1 (d071db5) + Bloque 2 (a7ecb83)

- **Bloque 1:** `products.iva_rate` (default 0,105) + selector 10,5%/21% en Productos + backfill con el criterio de la factura (criterio A). Verificado: 250 productos, 0 mismatches, 5 en 21% (los huevos).
- **Bloque 2:** única fuente = `products.iva_rate` vía `shared/iva.ts` (`ivaRateOf`). Se eliminó la lógica por nombre en los ~15 lugares (back JS, SQL `(1 + COALESCE(p.iva_rate,0.105))`, factura/NC/CAE, front pdf/orders/vendedor).
- **Verificación fiscal:** NEW(campo) == OLD(nombre) en el 100% de las 230 facturas, en el total facturado c/IVA de todos los aprobados, y a nivel producto. Cero cambios en comprobantes. (Nota: discrepancias recompute-vs-declarado en algunas facturas son artefactos del script de verificación —bolsa/ivaIncluido—, presentes igual en old y new; no son del cambio.)

**Fragilidad resuelta:** el IVA ya no se adivina por nombre; es un dato del producto. Un huevo "DOCENA" o "MAPLE" ahora se marca con el selector y factura bien.
