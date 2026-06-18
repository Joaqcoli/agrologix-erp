# Auditoría — Performance de carga inicial (diagnóstico, solo lectura, 2026-06-18)

> **Solo lectura. No se optimizó nada.** Por qué la app "tarda al ingresar", midiendo bundle + causas no-bundle (cold start, queries).
> **Conclusión adelantada:** la causa #1 más probable **NO es el bundle** — es el **cold start de Render** (si el servicio está en un plan con spin-down), amplificado porque el server corre **189 sentencias de migración en CADA arranque**. El bundle (516 KB gzip) explica un ~1–2 s adicional en la primera carga, secundario. Code-splitting ayuda pero **no** arregla el síntoma dramático de "entrar y esperar". El mayor beneficio por menor trabajo/riesgo es un **keep-alive** para que la instancia no se duerma + **gatear las migraciones** para que no corran enteras en cada boot.

---

## 1. Medición del bundle (lo que se descarga al abrir)

| Archivo | Raw | Gzip (lo que viaja) | ¿Carga inicial? |
|---|---|---|---|
| `index-*.js` (bundle principal) | 1878 KB | **516 KB** | **SÍ** |
| `index-*.css` | 91 KB | 15 KB | SÍ |
| `index.es-*.js` (jspdf core) | 155 KB | 52 KB | **NO** — chunk aparte (solo al generar PDF) |
| `html2canvas-*.js` | 196 KB | 46 KB | **NO** — chunk aparte (lazy de jspdf) |
| `purify.es-*.js` (DOMPurify) | 22 KB | 8 KB | **NO** — chunk aparte |

→ **La carga inicial real es ~531 KB gzip (JS+CSS).** El stack de PDF (jspdf/html2canvas/dompurify, ~106 KB gzip) **ya está separado** y solo carga cuando se genera un comprobante — no pesa al ingresar.

### Qué hace pesado al bundle principal
- **recharts**: importado **estático** (`components/ui/chart.tsx`, `dashboard`, `caja`, `vendedor/dashboard`). Es de lo más pesado (~150–200 KB raw) y **solo se usa en pantallas con gráficos** (dashboard/caja/vendedor) — entra al bundle inicial aunque la mayoría de las pantallas no lo necesiten.
- **27 paquetes `@radix-ui/*`** + `lucide-react` (íconos): suman bastante, pero son la base de toda la UI (difícil de evitar).
- **`framer-motion`**: está en `package.json` pero **NO se importa en ningún lado** → peso muerto (ya lo tree-shakea, no está en el bundle). Se puede sacar del package.json por prolijidad.
- **`xlsx` y `exceljs`**: **no se importan en el cliente** (uso server-side) → no están en el bundle del front.

## 2. Todas las causas posibles de la lentitud al ingresar

### 🔴 A — Cold start de Render (probable causa #1, NO se arregla con code-splitting)
- **No hay `render.yaml` ni keep-alive/ping** en el repo. Si el servicio está en un plan de Render con **spin-down** (free/starter), la instancia **se duerme tras ~15 min de inactividad**.
- La **primera** request después del idle espera: que Render **despierte** la instancia (~30–50 s en free) + boot de Node + las migraciones de arranque + seed.
- **Amplificador crítico:** `server/index.ts:100` corre `runMigrations()` + `seedDatabase()` + `runNcMigrations()` en **CADA** boot, y `migrate.ts` tiene **189 sentencias DDL** (`CREATE/ALTER ... IF NOT EXISTS`). Aunque son idempotentes, son **189 round-trips secuenciales a Supabase** en cada arranque → varios segundos extra **además** del wake de Render.
- **Firma del síntoma:** la **primera** entrada después de un rato es lentísima (decenas de segundos); recargar enseguida es rápido. Esto coincide exactamente con "tarda al INGRESAR".
- **Cómo confirmarlo (no se ve desde el repo):** mirar el **plan de Render** (si es free/starter → spin-down activo) y observar si la primera carga tras inactividad es lenta pero los reloads siguientes son rápidos.

### 🟡 B — Bundle de 531 KB gzip (secundario)
- Se descarga en la primera visita (después queda cacheado por el navegador).
- En una conexión normal (~10 Mbps): ~0,5–1 s de descarga + ~1–2 s de parse/exec en CPU media. Real pero **mucho menor** que un cold start.
- recharts (estático) es la mayor tajada evitable del inicial.

### 🟢 C — Queries al entrar (menor)
- El dashboard admin dispara **~6 queries en paralelo** al montar (`/dashboard/stats`, `rinde-detail`, `merma-detail`, `bolsa-fv`, `commissions/*`). Rango por defecto = **hoy** (`todayRange`), no todo el historial → acotado.
- `getDashboardStats` hace **~9 queries SECUENCIALES** (agregados), **sin N+1** (no hay loops con query adentro). En DB tibia ~100–300 ms total; se podrían correr en paralelo (`Promise.all`) para un pequeño ahorro. No es el cuello de botella de "entrar".

## 3. Qué porcentaje explica cada causa

| Causa | Cuándo pega | Magnitud | ¿Code-splitting lo arregla? |
|---|---|---|---|
| **A — Cold start** (si plan con spin-down) | 1ª entrada tras idle | **decenas de segundos** (domina) | **NO** |
| **B — Bundle 531 KB** | 1ª carga (sin caché) | ~1–2 s | Sí (parcial) |
| **C — Queries dashboard** | al abrir dashboard | ~0,1–0,3 s | No (es backend) |

→ Si el servicio está en plan con spin-down, **A explica la mayor parte** del "tarda al ingresar" (el caso dramático). B es el "siempre tarda un poquito". C es marginal.

## 4. Solución y tamaño por causa

- **A — Cold start (mayor impacto, menor riesgo):**
  - **Keep-alive:** un ping externo cada ~10 min a un endpoint liviano (`/api/health` o el login GET) desde un cron gratuito (cron-job.org / UptimeRobot / GitHub Action). Mantiene la instancia despierta. **~0 código, riesgo nulo, gran efecto** si hay spin-down. (Un self-ping interno NO sirve: Render suspende toda la instancia.)
  - **Gatear migraciones:** no correr las 189 DDL en cada boot — guardarlas detrás de una marca de versión / variable, o un endpoint manual. Recorta varios segundos de cada arranque. Riesgo bajo (cuidar que las migraciones nuevas igual se apliquen al deployar).
  - **Plan sin spin-down:** upgrade de Render (cuesta plata, no es código).
- **B — Bundle:** code-splitting con `React.lazy` por ruta + lazy de **recharts** (cargar solo en dashboard/caja/vendedor). Trabajo **moderado** (envolver rutas en `lazy()` + `Suspense`, mover recharts a import dinámico). Reduciría el inicial ~30–40 % (recharts es una tajada grande). Ayuda a la carga normal, **no** al cold start.
- **C — Queries:** `Promise.all` en `getDashboardStats` (9 secuenciales → paralelo). Trabajo bajo, ahorro chico, solo en dashboard.

## 5. Prioridad — mayor beneficio / menor trabajo y riesgo

1. **Keep-alive contra el cold start** (si el plan tiene spin-down) — **el que más se nota, casi sin trabajo ni riesgo.** Es lo primero a confirmar y atacar. Mata las "decenas de segundos al entrar".
2. **Gatear las 189 migraciones de boot** — recorta segundos de cada arranque (y de cada cold start). Riesgo bajo.
3. **`Promise.all` en getDashboardStats** — quick win chico, sin riesgo.
4. **Code-splitting (recharts + rutas)** — el de más trabajo; mejora la carga normal pero **no** el síntoma dramático. Vale la pena después de A/B, no antes.
5. **Sacar `framer-motion` de package.json** — prolijidad (ya no pesa en el bundle).

→ **Recomendación:** NO empezar por el code-splitting. Primero **confirmar el plan de Render**: si hay spin-down, el keep-alive (+ gatear migraciones) ataca el 80 % del problema percibido con casi nada de trabajo. El code-splitting queda para mejorar la carga steady-state después.

**Solo lectura. Nada tocado.**

---

# Apéndice — Lentitud generalizada ~2–5 s por acción (diagnóstico, solo lectura, 2026-06-18)

> **Nuevo dato:** NO es cold start (ya hay keep-alive) ni el bundle. **TODAS** las acciones tardan parejo ~2–5 s. Patrón uniforme → algo que afecta **cada round-trip a la base por igual**.
> **Conclusión:** la causa es **latencia por query alta × muchas queries secuenciales por request**. La latencia alta viene de **región cruzada: la base está en Supabase `sa-east-1` (São Paulo) y Render no tiene región en Sudamérica** → el server corre lejos de la DB y cada query paga ~100–180 ms de ida y vuelta. Un request hace 1 query de auth (M1) + N queries de la lógica, **en serie** → 2–5 s. El pooling y el pooler **están bien**; el cuello es la distancia × cantidad de round-trips.

## 1. Región y pooling (sospecha #1)

- **Supabase:** host `aws-1-sa-east-1.pooler.supabase.com`, **puerto 6543**, `?pgbouncer=true` → **usa el pooler (pgbouncer), región `sa-east-1` (São Paulo)**. ✅ El pooler está bien configurado — NO es falta de pooling.
- **Pool de la app** (`server/db.ts`): `pg.Pool` con `max: 5`, `idleTimeoutMillis: 30000`, sin `keepAlive`. Reutiliza conexiones (bien), pero las cierra tras 30 s de idle.
- **Render:** la región no se ve desde el repo (**hay que confirmarla en el dashboard de Render**). Dato decisivo: **Render no ofrece región en Sudamérica** (sus regiones son Oregon, Ohio, Virginia, Frankfurt, Singapur). Por lo tanto, esté donde esté, **el server está en otro continente respecto de São Paulo** → latencia cruzada en cada query.

## 2. Medición real del round-trip (desde una máquina en Sudamérica)

```
1er SELECT 1 (abrir conexión: TLS + auth):   857 ms
SELECT 1 sobre conexión tibia (x8):          ~103 ms promedio
```
- **Abrir una conexión nueva cuesta ~850 ms** (TLS + auth por el pooler). Con `idleTimeoutMillis: 30000`, si el tráfico es esporádico el pool se vacía y el próximo request paga esos ~850 ms.
- **Cada query sobre conexión tibia ya cuesta ~100 ms** desde acá (Sudamérica, *cerca* de São Paulo). **Desde Render (otro continente) será peor (~120–180 ms).** En una DB en la MISMA región el round-trip sería ~1–5 ms — o sea, hoy se paga ~20–100× de más por query.

## 3. Cuántos round-trips paga un request (la latencia se multiplica)

- **Middleware M1 (cada `/api/*`):** `storage.getUserById(req.session.userId)` en **CADA** request (revalidación de `active`). Es un PK lookup trivial **en CPU**, pero es **1 round-trip de red completo por request**. A ~150 ms, son 150 ms fijos antes de hacer nada.
- **Lógica del endpoint, en serie:**
  - `getDashboardStats`: **9 `db.execute` secuenciales** → ~9 × 150 ms ≈ **1,35 s**.
  - `approveOrder`: **~22 queries awaited** dentro del loop de ítems → ~22 × 150 ms ≈ **3,3 s** solo de latencia.
  - Hasta un GET "simple" paga auth (1) + sus 2–4 queries → ~0,5–0,8 s.
- **Fórmula del síntoma:** `tiempo ≈ (1 auth + N queries del endpoint) × latencia_por_query`. Con latencia cruzada (~150 ms) y N entre 3 y 22, da **~0,5 a 3,3 s**, más reconexiones ocasionales de ~850 ms → **2–5 s parejos**. Coincide exacto con lo que se ve.

## 4. Separando "base lejos" de "demasiada lógica"

- **Query trivial tibia = ~100 ms** (debería ser ~1–5 ms en misma región) → el grueso del tiempo es **transporte de red, no procesamiento**. Confirma que la base está *lejos*, no que las queries sean pesadas en sí.
- Las queries en sí no son patológicas (sin N+1 sobre listados gigantes; `getDashboardStats` son agregados acotados a "hoy"). El problema es **cuántos round-trips se hacen en serie a una base lejana**, no una query lenta puntual.

## 5. Causas, en orden de impacto

| # | Causa | Efecto | Fix |
|---|---|---|---|
| 1 | **Región cruzada Render↔Supabase (sa-east-1)** | ~100–180 ms POR query × N queries → **2–5 s** | **Co-locar**: mismo continente/región server↔DB |
| 2 | **Muchas queries secuenciales/request** (approveOrder ~22, stats 9) | multiplica la latencia de (1) | Paralelizar (`Promise.all`) / batch / reducir round-trips |
| 3 | **Auth M1: 1 query/request** | +1 round-trip fijo a cada acción | Cachear el `active` unos segundos / no re-fetch innecesario |
| 4 | **`idleTimeoutMillis: 30000`, sin keepAlive** | reconexión de ~850 ms tras idle | Subir idle timeout / `keepAlive: true` para conservar conexiones tibias |

## 6. Solución y prioridad (mayor impacto / menor riesgo)

1. **Co-locar server y base en la misma región (EL fix de fondo).** Pasa la latencia por query de ~150 ms a ~1–5 ms → un dashboard de 9 queries cae de ~1,35 s a ~50 ms; un approveOrder de 22 queries de ~3,3 s a ~150 ms. Opciones:
   - Deployar el server en un proveedor **con región en São Paulo / sa-east-1** (ej. **Fly.io tiene `gru` São Paulo**, o AWS sa-east-1), **manteniendo** Supabase donde está. **O** mover la base a la región donde corra el server. Es un cambio de **infraestructura, no de código** — el de mayor impacto por lejos.
   - **Cómo confirmar la causa antes de mover nada:** ver la **región del servicio en el dashboard de Render**; y medir un `SELECT 1` **desde el server de Render** (un log de timing en el endpoint de keep-alive). Si desde Render el round-trip tibio es ≫ 100 ms y desde un server co-locado sería ~1–5 ms, queda confirmado.
2. **Reducir round-trips por request** (sin mover infra, ayuda ya): `Promise.all` en `getDashboardStats` (9→1 ronda), y revisar los loops de `approveOrder`/`createOrder` para batchear. Mitiga el síntoma incluso con la base lejos. Riesgo medio (tocar flujos críticos — con verificación).
3. **Cachear la revalidación de auth M1** unos segundos (o por request) para sacar 1 round-trip de cada acción. Riesgo bajo.
4. **Pool: `keepAlive: true` + subir `idleTimeoutMillis`** para no pagar los ~850 ms de reconexión. Riesgo bajo, ayuda al tráfico esporádico.

→ **Recomendación:** el fix real es **(1) co-locar server y DB en la misma región** — explica casi todo el 2–5 s parejo y es infra, no código. Mientras tanto, (2)+(3)+(4) son mitigaciones de código/config de bajo riesgo que recortan round-trips. Confirmar primero la región de Render y medir el `SELECT 1` desde el server.

**Solo lectura. Nada tocado.**
