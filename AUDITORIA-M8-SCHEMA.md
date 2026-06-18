# Auditoría M8 — Schema drift de `obligacion_pagos` (diagnóstico, solo lectura, 2026-06-18)

> **Solo lectura. No se tocó nada.** La tabla `obligacion_pagos` existe en la base (creada en `migrate.ts`) pero NO está tipada en `shared/schema.ts`, y se usa con SQL crudo.
> **Conclusión adelantada:** es **la única tabla con drift** (todas las demás de migrate están en schema.ts). Hoy **no hay inconsistencia activa** (el SQL crudo matchea la tabla exacta). El riesgo es **latente + un borde filoso**: el INSERT está envuelto en un try/catch que **traga el error** (`console.error` y sigue), así que un drift futuro haría que un pago **no se registre en silencio**.

---

## 1. Estructura real (base == migrate.ts)

`obligacion_pagos` = **historial de pagos (parciales/total) de una obligación** (vencimiento), con moneda, cotización y monto en ARS.

| Columna | Tipo | Nota |
|---|---|---|
| `id` | serial PK | |
| `obligacion_id` | int NOT NULL | **FK → obligaciones.id** (ON DELETE CASCADE) |
| `fecha` | text NOT NULL | YYYY-MM-DD |
| `monto` | numeric(14,2) NOT NULL | monto en la moneda del pago |
| `moneda` | text NOT NULL default 'ARS' | ARS \| USD |
| `cotizacion` | numeric(14,4) **nullable** | tipo de cambio (si USD) |
| `monto_ars` | numeric(14,2) NOT NULL | equivalente en pesos |
| `cuenta_pago_id` | int **nullable** | **FK → cuentas_financieras.id** |
| `created_at` | timestamp NOT NULL default now() | |
+ índice `obligacion_pagos_obl_idx` en `obligacion_id`.

Creada en `migrate.ts:1128` (`CREATE TABLE IF NOT EXISTS …`). 2 filas hoy (pagos en USD de la obligación 27).

## 2. Dónde se usa — solo 2 lugares, ambos SQL crudo

| Lugar | Qué hace | Cómo |
|---|---|---|
| `storage.ts:5792` `getObligacionPagos(id)` | **lee** el historial de una obligación | `db.execute(sql\`SELECT … FROM obligacion_pagos …\`)` → devuelve `any[]` |
| `storage.ts:5801` `addObligacionPago(data)` | **inserta** un pago | `db.execute(sql\`INSERT INTO obligacion_pagos …\`)` → devuelve `any` |

**Callers** (routes): `GET /api/caja/obligaciones/:id/pagos` (2466, lee) y dentro de `PATCH /api/caja/obligaciones/:id` al pagar (2583, escribe). **Ningún lugar usa Drizzle** para esta tabla; los dos métodos devuelven `any` (sin tipo).

Los dos SQL referencian **exactamente** las 9 columnas de la tabla → **hoy matchean perfecto, no hay inconsistencia**.

## 3. Riesgo real del drift

- **Hoy: sin inconsistencia activa.** El SQL crudo coincide con la tabla; funciona.
- **Riesgo latente (tipos):** al no estar en `schema.ts`, los métodos devuelven `any` → **cero seguridad de tipos**. Si alguien cambia la tabla en `migrate.ts` (renombrar/quitar/cambiar tipo de una columna), el SQL crudo **no falla en compilación** — falla en **runtime** (o devuelve una forma distinta sin avisar). Con Drizzle, ese cambio saltaría como error de tipos en los 2 usos.
- **Borde filoso (el riesgo más concreto):** el caller del INSERT (routes.ts:2583-2592) está envuelto en `try { … addObligacionPago … } catch (e) { console.error("addObligacionPago failed:", e); }` → **si el INSERT falla, el error se traga** y el flujo de pago sigue. O sea: ante un drift (o un dato inválido), **el pago se aplicaría a la obligación pero el registro en el historial NO se guardaría, en silencio**. Tiparlo no arregla el try/catch, pero un modelo tipado reduce la chance de que ese INSERT se rompa por un cambio de columna.
- **Herramientas:** drizzle-kit / introspección / generación de tipos no ven esta tabla → el modelo está incompleto.

→ **No es solo prolijidad:** hay un riesgo latente real (cambios futuros silenciosos) + el INSERT que traga errores. Pero **no hay un bug activo hoy**.

## 4. Cómo están las demás tablas (patrón a seguir)

Todas usan `pgTable("nombre", { … })` + tipos inferidos. Ej. la tabla **padre** `obligaciones` (que SÍ está):
```ts
export const obligaciones = pgTable("obligaciones", {
  id: serial("id").primaryKey(),
  monto: numeric("monto", { precision: 14, scale: 2 }).notNull(),
  moneda: text("moneda").notNull().default("ARS"),
  cuentaPagoId: integer("cuenta_pago_id").references(() => cuentasFinancieras.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  …
});
export type Obligacion = typeof obligaciones.$inferSelect;
```
`obligacion_pagos` quedaría idéntico en estilo (camelCase en TS ↔ snake_case en DB, `.references()` a obligaciones y cuentas_financieras, `$inferSelect`/`$inferInsert`).

## 5. Qué implicaría tiparla

- **Declarar el tipo en `schema.ts` que matchee la tabla existente** = NO toca la tabla (ya existe) ni obliga a cambiar las queries. Solo agrega el `pgTable` + tipos. Las 2 queries crudas **siguen funcionando igual**.
- **Migrar las queries a Drizzle** (opcional) = reescribir `getObligacionPagos` (→ `db.select().from(obligacionPagos).where(eq(...))`) y `addObligacionPago` (→ `db.insert(obligacionPagos).values(...).returning()`). Cuidado con los `::float` actuales (Drizzle devuelve numeric como string; habría que parsear) y la forma del RETURNING.
- **Riesgo de romper obligaciones/pagos:** declarar el tipo (solo) = **riesgo nulo** (no cambia comportamiento). Migrar las queries = riesgo bajo pero real (hay que reproducir exacto el casteo a float y el shape, y es el flujo de pagos de obligaciones).

## 6. Enfoque recomendado

| Opción | Qué | Trabajo | Riesgo |
|---|---|---|---|
| **(a) Solo declarar el tipo** | `pgTable("obligacion_pagos", {…})` + `$inferSelect/Insert`, matcheando la tabla. Tipar el retorno de los 2 métodos. Queries siguen crudas. | Bajo | **Nulo** (no toca tabla ni comportamiento) |
| (b) (a) + migrar queries a Drizzle | Además reescribir los 2 métodos con `db.select`/`db.insert` | Medio | Bajo-medio (reproducir floats/shape; toca pagos) |
| (c) (a) + tipar el retorno + revisar el try/catch que traga el error | (a) + que el INSERT fallido **no se trague** (loguear/propagar para que no quede un pago sin registrar) | Bajo-medio | Bajo (mejora real de robustez) |

**Recomendación: (a) como base obligatoria** — elimina el drift de tipos con riesgo nulo (solo declarás el tipo que ya existe en la base y tipás el retorno de los 2 métodos). Es exactamente lo que M8 pide. **(c) como complemento de valor:** el `catch` que traga el error del INSERT es el riesgo más concreto; conviene que un pago que no se registra **no pase desapercibido**. **(b) es opcional** (las queries crudas ya andan y matchean; migrarlas es prolijidad, no urgencia).

**Solo lectura. Nada tocado.**
