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
