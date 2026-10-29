// ─── Hilo aparte para generar PDFs (29/10) ────────────────────────────────────
// jsPDF es puro CPU (0,5–2 s por remito en Render): corriendo en el hilo principal frenaba todas las
// demás respuestas del servidor mientras se armaba. Este worker recibe los datos YA armados (sin base
// de datos) y devuelve los bytes. Se bundlea aparte en script/build.ts → dist/pdf-worker.cjs.
import { parentPort, workerData } from "worker_threads";
import { generateRemitoPDF, generateInvoicePDF, type RemitoData, type InvoicePdfData } from "@shared/pdf";

export type PdfJob =
  | { kind: "remito"; data: RemitoData; hidePrecios: boolean; logoDataUrl: string | null }
  | { kind: "invoice"; detail: InvoicePdfData; detailMode: "completo" | "agrupado"; isNotaCredito: boolean; logoDataUrl: string | null };

(async () => {
  const job = workerData as PdfJob;
  const bytes = job.kind === "remito"
    ? await generateRemitoPDF(job.data, { hidePrecios: job.hidePrecios, output: "buffer", logoDataUrl: job.logoDataUrl ?? undefined })
    : await generateInvoicePDF(job.detail, job.detailMode, { isNotaCredito: job.isNotaCredito, output: "buffer", logoDataUrl: job.logoDataUrl ?? undefined });
  if (!bytes) throw new Error("El generador de PDF no devolvió bytes");
  const copy = new Uint8Array(bytes); // copia propia para transferir el buffer
  parentPort!.postMessage(copy, [copy.buffer]);
})().catch((e) => { throw e; });
