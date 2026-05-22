import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2, FileText, Download, CheckCircle2, Building2, Pencil, Clock } from "lucide-react";
import { useState, useRef, useMemo, useEffect } from "react";
import type { Payment, Withholding } from "@shared/schema";
import { PAYMENT_METHODS } from "@shared/schema";
import { jsPDF } from "jspdf";
import { generateInvoicePDF } from "@/lib/pdf";

const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const fmtWaPhone = (phone: string): string | null => {
  const d = phone.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("54")) return d;
  if (d.startsWith("0")) return "54" + d.slice(1);
  if (d.startsWith("15")) return "549" + d.slice(2);
  return "54" + d;
};

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const fmtInt = (v: number) => Math.round(v).toLocaleString("es-AR");
/** Muestra solo el número secuencial de la factura: "B-0004-00000003" → "03" */
const fmtFacturaSeq = (n: string | null | undefined): string => {
  if (!n) return "—";
  const seq = n.split("-").at(-1);
  if (!seq) return n;
  const num = parseInt(seq, 10);
  return isNaN(num) ? n : String(num).padStart(2, "0");
};
const today = () => new Date().toISOString().split("T")[0];

type FilterType = "mes" | "semana" | "dia";

type OrderRow = {
  id: number;
  folio: string;
  remitoNum: number | null;
  orderDate: string;
  total: number;
  invoiceNumber?: string | null;
  isPaid: boolean;
  paidAmount: number;
  customerId?: number;
};
type PaymentRow = Payment & { orderFolio?: string | null };

// ── Date range helpers ──────────────────────────────────────────────────────────

function monthRange(month: number, year: number): [string, string] {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const em = month === 12 ? 1 : month + 1;
  const ey = month === 12 ? year + 1 : year;
  return [from, `${ey}-${String(em).padStart(2, "0")}-01`];
}

function dayRange(dateStr: string): [string, string] {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return [dateStr, d.toISOString().split("T")[0]];
}

function weekRange(weekStr: string): [string, string] {
  // weekStr = "2026-W12"
  const [ys, ws] = weekStr.split("-W");
  const year = parseInt(ys), week = parseInt(ws);
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = (jan4.getDay() + 6) % 7; // 0=Mon
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + (week - 1) * 7);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return [fmt(monday), fmt(nextMonday)];
}

function toISOWeek(d: Date): string {
  const tmp = new Date(d.getTime());
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const week1 = new Date(tmp.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${tmp.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function detectFilterType(from: string, to: string): FilterType {
  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
  if (days === 1) return "dia";
  if (days === 7) return "semana";
  return "mes";
}

function formatPeriodLabel(filterType: FilterType, from: string, to: string, month: number, year: number): string {
  if (filterType === "mes") return `${MONTHS[month - 1]} ${year}`;
  if (filterType === "dia") {
    const d = new Date(from + "T00:00:00");
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
  }
  const d1 = new Date(from + "T00:00:00");
  const d2 = new Date(new Date(to + "T00:00:00").getTime() - 86400000);
  return `${d1.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} – ${d2.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}`;
}

// ── Subsidiary Detail Modal (MEJORA 2) ──────────────────────────────────────────

function SubsidiaryDetailModal({
  open,
  onClose,
  subsidiary,
  orders,
  periodLabel,
}: {
  open: boolean;
  onClose: () => void;
  subsidiary: { customerId: number; customerName: string; facturacion: number; cobranza: number; saldo: number } | null;
  orders: OrderRow[];
  periodLabel: string;
}) {
  const fmtDate = (d: string) => {
    const dt = new Date(d.replace(/\s.+$/, "T00:00:00"));
    return dt.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  const subOrders = useMemo(
    () => (orders ?? []).filter((o) => o.customerId === subsidiary?.customerId),
    [orders, subsidiary?.customerId]
  );

  const handleDownloadPDF = async () => {
    if (!subsidiary) return;
    const fmtD = (d: string) =>
      new Date(d.replace(/\s.+$/, "T00:00:00")).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
    const doc = await generateCCPDF({
      clientLabel: `Sede: ${subsidiary.customerName}`,
      saldoAnterior: 0,
      orderRows: subOrders.map((o) => ({
        fecha: fmtD(o.orderDate),
        remito: formatRemito(o),
        factura: fmtFacturaSeq(o.invoiceNumber),
        monto: o.total,
      })),
      total: subsidiary.facturacion,
      periodLabel,
    });
    doc.save(`CC-${subsidiary.customerName.replace(/\s+/g, "_")}-${periodLabel}.pdf`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {subsidiary?.customerName} — {periodLabel}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* Summary row */}
          <div className="flex gap-4 text-sm">
            <div className="flex-1 rounded-md bg-muted/40 p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Facturación</p>
              <p className="font-bold">${fmtInt(subsidiary?.facturacion ?? 0)}</p>
            </div>
            <div className="flex-1 rounded-md bg-muted/40 p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Cobranza</p>
              <p className="font-bold text-green-600">${fmtInt(subsidiary?.cobranza ?? 0)}</p>
            </div>
            <div className="flex-1 rounded-md bg-muted/40 p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Saldo</p>
              <p className={`font-bold ${(subsidiary?.saldo ?? 0) > 0 ? "text-destructive" : "text-green-600"}`}>
                ${fmtInt(Math.abs(subsidiary?.saldo ?? 0))} {(subsidiary?.saldo ?? 0) > 0 ? "a cobrar" : (subsidiary?.saldo ?? 0) < 0 ? "a favor" : ""}
              </p>
            </div>
          </div>
          {/* Orders table */}
          {subOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sin pedidos en este período</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left py-2 px-3">Folio</th>
                  <th className="text-left py-2 px-3">Fecha</th>
                  <th className="text-left py-2 px-3">Nro. Factura</th>
                  <th className="text-right py-2 px-3">Total</th>
                  <th className="text-left py-2 px-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {subOrders.map((o) => (
                  <tr key={o.id} className={`border-b border-border last:border-0 ${o.isPaid ? "bg-green-50/30" : ""}`}>
                    <td className="py-1.5 px-3 font-mono font-medium">{formatRemito(o)}</td>
                    <td className="py-1.5 px-3 text-muted-foreground">{fmtDate(o.orderDate)}</td>
                    <td className="py-1.5 px-3 text-muted-foreground">{fmtFacturaSeq(o.invoiceNumber)}</td>
                    <td className={`py-1.5 px-3 text-right font-semibold ${o.isPaid ? "line-through text-muted-foreground" : ""}`}>
                      ${fmtInt(o.total)}
                    </td>
                    <td className="py-1.5 px-3">
                      {o.isPaid
                        ? <span className="text-[10px] text-green-600 font-medium">Pagado</span>
                        : <span className="text-[10px] text-muted-foreground">Pendiente</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <Button variant="outline" onClick={handleDownloadPDF} disabled={subOrders.length === 0}>
            <Download className="mr-1 h-3.5 w-3.5" /> Descargar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type SubsidiaryRow = {
  customerId: number;
  customerName: string;
  facturacion: number;
  cobranza: number;
  saldo: number;
};

type CCDetail = {
  // Child redirect
  isChild?: boolean;
  parentId?: number;
  parentName?: string;
  // Normal detail
  customer: {
    id: number;
    name: string;
    hasIva: boolean;
    ccType?: string | null;
    phone?: string;
    email?: string;
    city?: string;
  };
  month: number;
  year: number;
  saldoMesAnterior: number;
  facturacion: number;
  cobranza: number;
  retenciones: number;
  saldo: number;
  orders: OrderRow[];
  payments: PaymentRow[];
  withholdings: Withholding[];
  isParent?: boolean;
  subsidiaries?: SubsidiaryRow[];
};

type PendingOrder = { id: number; folio: string; remitoNum: number | null; total: string; paidAmount: string; orderDate: string; invoiceNumber?: string | null };

function formatRemito(order: { remitoNum?: number | null; folio?: string | null }): string {
  if (order.remitoNum != null) return `VA-${String(order.remitoNum).padStart(6, "0")}`;
  const f = order.folio ?? "";
  const m = f.match(/^(?:VA|PV)-?(\d+)$/);
  return m ? `VA-${m[1].padStart(6, "0")}` : (f || "-");
}

// ── PDF generation ─────────────────────────────────────────────────────────────

async function loadLogoJpeg(): Promise<{ base64: string; aspect: number } | null> {
  try {
    const res = await fetch("/logo.png");
    if (!res.ok) return null;
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el); el.onerror = reject; el.src = objUrl;
    });
    URL.revokeObjectURL(objUrl);
    const cvs = document.createElement("canvas");
    cvs.width = img.naturalWidth; cvs.height = img.naturalHeight;
    const ctx = cvs.getContext("2d")!;
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.drawImage(img, 0, 0);
    return { base64: cvs.toDataURL("image/jpeg", 0.92), aspect: img.naturalWidth / img.naturalHeight };
  } catch { return null; }
}

async function generateCCPDF(opts: {
  clientLabel: string;
  saldoAnterior: number;
  orderRows: { fecha: string; remito: string; factura: string; monto: number }[];
  total: number;
  periodLabel: string;
  hideFactura?: boolean;
}): Promise<jsPDF> {
  const { clientLabel, saldoAnterior, orderRows, total, periodLabel, hideFactura = false } = opts;

  // ── Colors ─────────────────────────────────────────────────────────────────
  const OLIVE:     [number, number, number] = [61,  95,  47];   // table header + separator
  const FOOT_GRN:  [number, number, number] = [38,  68,  22];   // footer dark bar
  const WHITE:     [number, number, number] = [255, 255, 255];
  const GRAY_LITE: [number, number, number] = [245, 245, 245];  // alternate row bg
  const GRAY_LINE: [number, number, number] = [200, 200, 200];  // thin separators
  const GRAY_TEXT: [number, number, number] = [150, 150, 150];  // muted labels
  const BLACK:     [number, number, number] = [30,  30,  30];

  const pageW = 210;
  const pageH = 297;
  const mx    = 15;
  const tblW  = pageW - mx * 2;   // 180mm

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const fmtM = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
  const todayFmt = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

  // ── Column positions ────────────────────────────────────────────────────────
  // With factura:    FECHA 20% | N° REMITO 27% | N° FACTURA 27% | MONTO 26%
  // Without factura: FECHA 20% | N° REMITO 54%                  | MONTO 26%
  const fechaW   = tblW * 0.20;
  const remitoW  = hideFactura ? tblW * 0.54 : tblW * 0.27;
  const facturaW = hideFactura ? 0 : tblW * 0.27;
  const fechaX   = mx;
  const remitoX  = fechaX + fechaW;
  const facturaX = remitoX + remitoW;
  const montoX   = mx + tblW;     // 195mm — right-align anchor

  // ── Footer ──────────────────────────────────────────────────────────────────
  const footContactH = 20;
  const footBarH     = 12;
  const footH        = footContactH + footBarH;
  const footY        = pageH - footH;   // 265mm

  const drawFooter = () => {
    // Thin separator line above contact section
    doc.setDrawColor(...GRAY_LINE);
    doc.setLineWidth(0.4);
    doc.line(mx, footY, pageW - mx, footY);

    // Three contact columns (white bg, labels bold, values normal)
    const col3W = tblW / 3;
    const labels = ["WhatsApp", "Email", "Website"];
    const values = ["11-7123-2459", "vegetalesargentinos.srl@gmail.com", "www.vegetalesargentinos.com"];
    for (let i = 0; i < 3; i++) {
      const colX = mx + i * col3W;
      doc.setTextColor(...BLACK);
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
      doc.text(labels[i], colX, footY + 7);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
      doc.text(values[i], colX, footY + 13.5);
    }

    // Dark green bar at very bottom
    const barY = footY + footContactH;
    doc.setFillColor(...FOOT_GRN);
    doc.rect(0, barY, pageW, footBarH, "F");
    doc.setTextColor(...WHITE);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    doc.text("CUIT : 30-71855184-2", pageW - mx, barY + 4.5, { align: "right" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("VEGETALES ARGENTINOS SRL", pageW - mx, barY + 9.5, { align: "right" });
  };

  // ── Header (white background) ───────────────────────────────────────────────
  const logoData = await loadLogoJpeg();
  let logoW = 0;
  const logoH = 26;
  if (logoData) {
    logoW = Math.min(logoH * logoData.aspect, 80);
    doc.addImage(logoData.base64, "JPEG", mx, 8, logoW, logoH);
  }

  // Right: FECHA (gray small) → CTA. CTE. (bold large) → period (gray small)
  doc.setTextColor(...GRAY_TEXT);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text(`FECHA :  ${todayFmt}`, pageW - mx, 13, { align: "right" });
  doc.setTextColor(...BLACK);
  doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  doc.text("CTA. CTE.", pageW - mx, 26, { align: "right" });
  doc.setTextColor(...GRAY_TEXT);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text(periodLabel, pageW - mx, 34, { align: "right" });

  // ── Separator bar (dark olive) ───────────────────────────────────────────────
  const sepY = 41;
  doc.setFillColor(...OLIVE);
  doc.rect(0, sepY, pageW, 2.5, "F");

  // ── "Cliente: NAME" ─────────────────────────────────────────────────────────
  const clientY = sepY + 7;
  doc.setTextColor(...BLACK);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text(clientLabel, mx, clientY + 6);

  // Thin gray line below client label
  const clientLineY = clientY + 11;
  doc.setDrawColor(...GRAY_LINE);
  doc.setLineWidth(0.4);
  doc.line(mx, clientLineY, pageW - mx, clientLineY);

  // ── Table ───────────────────────────────────────────────────────────────────
  const TH = 13;   // table header height
  const RH = 14;   // data row height (tall rows as in template)
  // Reserve space for TOTAL (line + text ≈ 20mm) + 5mm gap above it
  const contentBottom = footY - 25;

  let y = clientLineY + 4;

  const drawTH = () => {
    doc.setFillColor(...OLIVE);
    doc.rect(mx, y, tblW, TH, "F");
    doc.setTextColor(...WHITE);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("FECHA",      fechaX + fechaW / 2,     y + 9, { align: "center" });
    doc.text("N° REMITO",  remitoX + remitoW / 2,   y + 9, { align: "center" });
    if (!hideFactura) doc.text("N° FACTURA", facturaX + facturaW / 2, y + 9, { align: "center" });
    doc.text("MONTO",      montoX - 5,              y + 9, { align: "right" });
    y += TH;
  };
  drawTH();

  // Build row list
  type FullRow = { fecha: string; remito: string; factura: string; monto: number; bold?: boolean };
  const allRows: FullRow[] = [];
  if (saldoAnterior > 0) {
    allRows.push({ fecha: "---", remito: "SALDO ANTERIOR", factura: "---", monto: saldoAnterior, bold: true });
  }
  for (const r of orderRows) {
    allRows.push({ fecha: r.fecha, remito: r.remito, factura: r.factura || "---", monto: r.monto });
  }

  for (let i = 0; i < allRows.length; i++) {
    if (y + RH > contentBottom) {
      drawFooter();
      doc.addPage();
      y = 10;
      drawTH();
    }
    const row = allRows[i];
    doc.setFillColor(...(i % 2 === 0 ? WHITE : GRAY_LITE));
    doc.rect(mx, y, tblW, RH, "F");
    doc.setFontSize(9);
    doc.setTextColor(...BLACK);

    // FECHA — centered
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    doc.text(row.fecha, fechaX + fechaW / 2, y + 9, { align: "center" });

    // N° REMITO — centrado en la columna
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    doc.text(row.remito, remitoX + remitoW / 2, y + 9, { align: "center" });

    // N° FACTURA — centrado en la columna (skip if hideFactura)
    if (!hideFactura) {
      doc.setFont("helvetica", "normal");
      doc.text(row.factura, facturaX + facturaW / 2, y + 9, { align: "center" });
    }

    // MONTO — right padded, bold
    doc.setFont("helvetica", "bold");
    doc.text(fmtM(row.monto), montoX - 5, y + 9, { align: "right" });

    y += RH;
  }

  // ── TOTAL — fixed near bottom (lots of white space above if few rows) ────────
  const totalLineY = footY - 22;
  doc.setDrawColor(...GRAY_LINE);
  doc.setLineWidth(0.4);
  doc.line(mx, totalLineY, pageW - mx, totalLineY);
  doc.setTextColor(...BLACK);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  const totalLabelX = hideFactura ? remitoX + remitoW - 2 : facturaX + facturaW - 2;
  doc.text("TOTAL:", totalLabelX, totalLineY + 11, { align: "right" });
  doc.text(fmtM(Math.max(0, total)), montoX - 5, totalLineY + 11, { align: "right" });

  // ── Footer on last page ─────────────────────────────────────────────────────
  drawFooter();

  doc.setTextColor(0, 0, 0);
  return doc;
}

// ── Resumen CC PDF (pedidos seleccionados con IVA desglosado) ──────────────────

async function generateResumenCCPDF(opts: {
  customerName: string;
  orders: { orderDate: string; remitoNum: number | null; folio: string; invoiceNumber: string | null; total: number }[];
}): Promise<void> {
  const { customerName, orders } = opts;

  const OLIVE:     [number, number, number] = [61,  95,  47];
  const FOOT_GRN:  [number, number, number] = [38,  68,  22];
  const WHITE:     [number, number, number] = [255, 255, 255];
  const GRAY_LITE: [number, number, number] = [245, 245, 245];
  const GRAY_LINE: [number, number, number] = [200, 200, 200];
  const GRAY_TEXT: [number, number, number] = [150, 150, 150];
  const BLACK:     [number, number, number] = [30,  30,  30];

  const pageW = 210, pageH = 297, mx = 15;
  const tblW = pageW - mx * 2;   // 180mm
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const fmtM = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
  const todayFmt = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

  // Columns: FECHA 18% | REMITO 20% | FACTURA 20% | NETO 18% | IVA 12% | TOTAL 12%
  const pct = (p: number) => tblW * p / 100;
  const fechaX   = mx;            const fechaW   = pct(18);
  const remitoX  = fechaX  + fechaW;  const remitoW  = pct(20);
  const factX    = remitoX + remitoW; const factW    = pct(20);
  const netoX    = factX   + factW;   const netoW    = pct(18);
  const ivaX     = netoX   + netoW;   const ivaW     = pct(12);
  const totX     = ivaX    + ivaW;    // right-anchor: totX + pct(12)
  const rightEdge = mx + tblW;

  const footContactH = 20, footBarH = 12;
  const footY = pageH - footContactH - footBarH;

  const drawFooter = () => {
    doc.setDrawColor(...GRAY_LINE); doc.setLineWidth(0.4);
    doc.line(mx, footY, pageW - mx, footY);
    const col3W = tblW / 3;
    const labels = ["WhatsApp", "Email", "Website"];
    const values = ["11-7123-2459", "vegetalesargentinos.srl@gmail.com", "www.vegetalesargentinos.com"];
    for (let i = 0; i < 3; i++) {
      const colX = mx + i * col3W;
      doc.setTextColor(...BLACK); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
      doc.text(labels[i], colX, footY + 7);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
      doc.text(values[i], colX, footY + 13.5);
    }
    const barY = footY + footContactH;
    doc.setFillColor(...FOOT_GRN); doc.rect(0, barY, pageW, footBarH, "F");
    doc.setTextColor(...WHITE); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    doc.text("CUIT : 30-71855184-2", pageW - mx, barY + 4.5, { align: "right" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("VEGETALES ARGENTINOS SRL", pageW - mx, barY + 9.5, { align: "right" });
  };

  // Header
  const logoData = await loadLogoJpeg();
  if (logoData) {
    const logoH = 26, logoW = Math.min(logoH * logoData.aspect, 80);
    doc.addImage(logoData.base64, "JPEG", mx, 8, logoW, logoH);
  }
  doc.setTextColor(...GRAY_TEXT); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text(`FECHA :  ${todayFmt}`, pageW - mx, 13, { align: "right" });
  doc.setTextColor(...BLACK); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text("RESUMEN DE CUENTA", pageW - mx, 25, { align: "right" });
  doc.setTextColor(...GRAY_TEXT); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text(`${orders.length} pedido${orders.length !== 1 ? "s" : ""} seleccionado${orders.length !== 1 ? "s" : ""}`, pageW - mx, 33, { align: "right" });

  const sepY = 41;
  doc.setFillColor(...OLIVE); doc.rect(0, sepY, pageW, 2.5, "F");

  const clientY = sepY + 7;
  doc.setTextColor(...BLACK); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text(customerName, mx, clientY + 6);
  doc.setDrawColor(...GRAY_LINE); doc.setLineWidth(0.4);
  doc.line(mx, clientY + 11, pageW - mx, clientY + 11);

  const TH = 11, RH = 12;
  const contentBottom = footY - 28;
  let y = clientY + 15;

  const drawTH = () => {
    doc.setFillColor(...OLIVE); doc.rect(mx, y, tblW, TH, "F");
    doc.setTextColor(...WHITE); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
    const cy = y + TH / 2 + 3;
    doc.text("FECHA",      fechaX  + fechaW  / 2, cy, { align: "center" });
    doc.text("NRO REMITO", remitoX + remitoW / 2, cy, { align: "center" });
    doc.text("NRO FACTURA",factX   + factW   / 2, cy, { align: "center" });
    doc.text("MONTO NETO", netoX   + netoW   - 2, cy, { align: "right" });
    doc.text("IVA",        ivaX    + ivaW    - 2, cy, { align: "right" });
    doc.text("TOTAL",      rightEdge          - 2, cy, { align: "right" });
    y += TH;
  };
  drawTH();

  const fmtD = (d: string) =>
    new Date(d.replace(/\s.+$/, "T00:00:00")).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });

  let sumNeto = 0, sumIva = 0, sumTotal = 0;

  for (let i = 0; i < orders.length; i++) {
    if (y + RH > contentBottom) {
      drawFooter(); doc.addPage(); y = 10; drawTH();
    }
    const o = orders[i];
    const total = o.total;
    const neto  = total / 1.105;
    const iva   = total - neto;
    sumNeto += neto; sumIva += iva; sumTotal += total;

    doc.setFillColor(...(i % 2 === 0 ? WHITE : GRAY_LITE));
    doc.rect(mx, y, tblW, RH, "F");
    doc.setTextColor(...BLACK); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    const ry = y + RH / 2 + 3;
    doc.text(fmtD(o.orderDate), fechaX + fechaW / 2, ry, { align: "center" });
    doc.text(formatRemito(o),   remitoX + remitoW / 2, ry, { align: "center" });
    doc.text(fmtFacturaSeq(o.invoiceNumber), factX + factW / 2, ry, { align: "center" });
    doc.text(fmtM(neto),  netoX    + netoW - 2, ry, { align: "right" });
    doc.text(fmtM(iva),   ivaX     + ivaW  - 2, ry, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(fmtM(total), rightEdge          - 2, ry, { align: "right" });
    y += RH;
  }

  // Totals bar
  const totalBarY = footY - 26;
  doc.setDrawColor(...GRAY_LINE); doc.setLineWidth(0.4);
  doc.line(mx, totalBarY, pageW - mx, totalBarY);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...BLACK);
  const ty = totalBarY + 9;
  doc.text("TOTALES:", factX + factW / 2, ty, { align: "center" });
  doc.text(fmtM(sumNeto),  netoX    + netoW - 2, ty, { align: "right" });
  doc.text(fmtM(sumIva),   ivaX     + ivaW  - 2, ty, { align: "right" });
  doc.setFontSize(10);
  doc.text(fmtM(sumTotal), rightEdge          - 2, ty, { align: "right" });

  drawFooter();
  const today2 = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
  doc.save(`Resumen-CC-${customerName.replace(/\s+/g, "_")}-${today2}.pdf`);
}

// ── Payment modal ──────────────────────────────────────────────────────────────
function PaymentModal({
  customerId,
  open,
  onClose,
  pendingOrders,
}: {
  customerId: number;
  open: boolean;
  onClose: () => void;
  pendingOrders: PendingOrder[];
}) {
  const { toast } = useToast();
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("EFECTIVO");
  const [notes, setNotes] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([]);
  const [retentionAmount, setRetentionAmount] = useState("");
  const [retentionType, setRetentionType] = useState("IIBB");

  const toggleOrder = (id: number) => {
    setSelectedOrderIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Saldo pendiente por pedido = total - ya pagado
  const orderRemaining = (o: PendingOrder) => parseFloat(o.total) - parseFloat(o.paidAmount ?? "0");

  // Sum of remaining balances for selected orders (for amount hint)
  const selectedTotal = pendingOrders
    .filter((o) => selectedOrderIds.includes(o.id))
    .reduce((s, o) => s + orderRemaining(o), 0);

  const retAmt = parseFloat(retentionAmount || "0");
  const combinedAmount = parseFloat(amount || "0") + (isNaN(retAmt) ? 0 : retAmt);
  const coversSelected = selectedTotal > 0 && combinedAmount >= selectedTotal - 0.5;

  const mutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/payments", {
        customerId,
        date,
        amount,
        method,
        notes: notes || null,
        orderIds: selectedOrderIds,
      });
      if (!isNaN(retAmt) && retAmt > 0) {
        await apiRequest("POST", "/api/payments", {
          customerId,
          date,
          amount: retentionAmount,
          method: "RETENCION",
          notes: retentionType,
          orderIds: selectedOrderIds,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc/customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/pending-orders", customerId] });
      toast({ title: "Pago registrado" });
      setAmount(""); setNotes(""); setMethod("EFECTIVO"); setSelectedOrderIds([]);
      setRetentionAmount(""); setRetentionType("IIBB");
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Pago</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Fecha</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" data-testid="input-payment-date" />
          </div>
          <div>
            <Label className="text-xs">Monto</Label>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-sm text-muted-foreground">$</span>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="flex-1"
                data-testid="input-payment-amount"
              />
              {selectedTotal > 0 && !amount && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-8 whitespace-nowrap"
                  onClick={() => setAmount(String(Math.round(selectedTotal)))}
                >
                  Usar ${fmtInt(selectedTotal)}
                </Button>
              )}
            </div>
          </div>
          <div>
            <Label className="text-xs">Método</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="mt-1" data-testid="select-payment-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.filter((m) => m !== "RETENCION").map((m) => (
                  <SelectItem key={m} value={m}>{m.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Multi-select order checkboxes */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs">Asociar a pedidos</Label>
              {selectedOrderIds.length > 0 ? (
                <span className="text-[10px] text-muted-foreground">
                  {selectedOrderIds.length} seleccionado{selectedOrderIds.length > 1 ? "s" : ""}
                </span>
              ) : pendingOrders.length > 0 ? (
                <span className="text-[10px] text-muted-foreground italic">se aplica automático del más viejo</span>
              ) : null}
            </div>
            {pendingOrders.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 text-center border rounded-md">
                Sin pedidos pendientes
              </p>
            ) : (
              <ScrollArea className="h-48 rounded-md border bg-muted/20 p-2">
                <div className="space-y-1">
                  {[...pendingOrders]
                    .sort((a, b) => a.orderDate < b.orderDate ? -1 : a.orderDate > b.orderDate ? 1 : a.id - b.id)
                    .map((o) => {
                      const checked = selectedOrderIds.includes(o.id);
                      const remaining = orderRemaining(o);
                      const isPartial = parseFloat(o.paidAmount ?? "0") > 0;
                      const fmtD = (d: string) =>
                        new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
                      return (
                        <label
                          key={o.id}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                            checked ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                          }`}
                          data-testid={`check-order-${o.id}`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleOrder(o.id)}
                            className="shrink-0"
                          />
                          <span className="text-[10px] text-muted-foreground shrink-0 w-10">{fmtD(o.orderDate)}</span>
                          <span className="text-xs font-mono font-medium shrink-0">{formatRemito(o)}</span>
                          {o.invoiceNumber && (
                            <span className="text-[10px] text-muted-foreground shrink-0">FC {fmtFacturaSeq(o.invoiceNumber)}</span>
                          )}
                          {isPartial && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">parcial</span>
                          )}
                          <span className="text-xs text-muted-foreground ml-auto shrink-0">
                            ${Math.round(remaining).toLocaleString("es-AR")}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </ScrollArea>
            )}
          </div>

          <div>
            <Label className="text-xs">Notas (opcional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Referencia, nro. cheque, etc."
              className="mt-1"
              data-testid="input-payment-notes"
            />
          </div>

          {/* ── Retención ── */}
          <div className="rounded-md border border-blue-200 bg-blue-50/40 dark:bg-blue-950/20 dark:border-blue-800 p-3 space-y-2">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">Retención (opcional)</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Monto retención</Label>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    type="number"
                    value={retentionAmount}
                    onChange={(e) => setRetentionAmount(e.target.value)}
                    placeholder="0"
                    className="flex-1"
                    data-testid="input-retention-amount"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Tipo</Label>
                <Select value={retentionType} onValueChange={setRetentionType}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["IIBB", "GANANCIAS", "IVA", "SIRTAC", "OTRO"].map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {!isNaN(retAmt) && retAmt > 0 && (
              <p className="text-[10px] text-muted-foreground">
                Pago <strong>${fmtInt(parseFloat(amount || "0"))}</strong> + Ret. <strong>${fmtInt(retAmt)}</strong> = <strong>${fmtInt(combinedAmount)}</strong>
                {coversSelected && selectedTotal > 0 && (
                  <span className="ml-1.5 text-green-600 font-medium">✓ Cubre el total seleccionado</span>
                )}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !amount || parseFloat(amount) <= 0}
            data-testid="button-confirm-payment"
          >
            {mutation.isPending ? "Guardando..." : "Guardar Pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Withholding modal ──────────────────────────────────────────────────────────
function WithholdingModal({
  customerId,
  open,
  onClose,
}: {
  customerId: number;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [type, setType] = useState("IIBB");
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/withholdings", { customerId, date, amount, type, notes: notes || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc/customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc/summary"] });
      toast({ title: "Retención registrada" });
      setAmount(""); setNotes(""); setType("IIBB");
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Retención</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Fecha</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" data-testid="input-withholding-date" />
          </div>
          <div>
            <Label className="text-xs">Monto</Label>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-sm text-muted-foreground">$</span>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="flex-1"
                data-testid="input-withholding-amount"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1" data-testid="select-withholding-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["IIBB", "GANANCIAS", "IVA", "SIRTAC", "OTRO"].map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Notas (opcional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas adicionales"
              className="mt-1"
              data-testid="input-withholding-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !amount || parseFloat(amount) <= 0}
            data-testid="button-confirm-withholding"
          >
            {mutation.isPending ? "Guardando..." : "Guardar Retención"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Payment modal ─────────────────────────────────────────────────────────
function EditPaymentModal({
  payment,
  customerId,
  open,
  onClose,
}: {
  payment: PaymentRow | null;
  customerId: number;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [date, setDate] = useState(payment?.date ?? today());
  const [amount, setAmount] = useState(payment ? String(Math.round(parseFloat(payment.amount as string))) : "");
  const [method, setMethod] = useState(payment?.method ?? "EFECTIVO");
  const [notes, setNotes] = useState(payment?.notes ?? "");

  // Sync form when payment changes
  useEffect(() => {
    if (payment) {
      setDate(payment.date ?? today());
      setAmount(String(Math.round(parseFloat(payment.amount as string))));
      setMethod(payment.method ?? "EFECTIVO");
      setNotes(payment.notes ?? "");
    }
  }, [payment?.id]);

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/payments/${payment!.id}`, { date, amount, method, notes: notes || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc/customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/pending-orders", customerId] });
      toast({ title: "Pago actualizado" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar Pago</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Fecha</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Monto</Label>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-sm text-muted-foreground">$</span>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="flex-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Método</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>{m.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Notas (opcional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referencia, nro. cheque, etc." className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !amount || parseFloat(amount) <= 0}>
            {mutation.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Inline invoice number cell ─────────────────────────────────────────────────
function InvoiceCell({ order, customerId }: { order: OrderRow; customerId: number }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(order.invoiceNumber ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: (invoiceNumber: string | null) =>
      apiRequest("PATCH", `/api/orders/${order.id}/invoice-number`, { invoiceNumber }),
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ["/api/ar/cc/customer", customerId] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const save = () => {
    setEditing(false);
    const trimmed = val.trim() || null;
    if (trimmed !== (order.invoiceNumber ?? null)) {
      mutation.mutate(trimmed);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        className="w-full px-1 py-0.5 text-xs border border-primary rounded outline-none bg-background"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") { setVal(order.invoiceNumber ?? ""); setEditing(false); }
        }}
        data-testid={`invoice-input-${order.id}`}
      />
    );
  }

  return (
    <span
      className="cursor-pointer hover:text-primary hover:underline text-muted-foreground"
      onClick={() => { setEditing(true); setVal(order.invoiceNumber ?? ""); }}
      title="Click para editar"
      data-testid={`invoice-cell-${order.id}`}
    >
      {order.invoiceNumber || <span className="text-border italic text-[10px]">FC —</span>}
    </span>
  );
}

// ── Main Detail Page ───────────────────────────────────────────────────────────
export default function CCCustomerDetailPage({
  customerId,
  month: initMonth,
  year: initYear,
  dateFrom: initDateFrom,
  dateTo: initDateTo,
}: {
  customerId: number;
  month: number;
  year: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const today2 = new Date();
  const years = Array.from({ length: 4 }, (_, i) => today2.getFullYear() - i);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showWithholdingModal, setShowWithholdingModal] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentRow | null>(null);
  const [selectedSubsidiary, setSelectedSubsidiary] = useState<CCDetail["subsidiaries"] extends (infer T)[] ? T : never | null>(null);
  const [waDialog, setWaDialog] = useState(false);
  const [waMessage, setWaMessage] = useState("");
  const [waSending, setWaSending] = useState(false);
  const [waOption, setWaOption] = useState<"cc" | "resumen">("cc");
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(new Set());

  // ── MEJORA 3: Date range filter state ─────────────────────────────────────────
  const initRange = useMemo<[string, string]>(() => {
    if (initDateFrom && initDateTo) return [initDateFrom, initDateTo];
    return monthRange(initMonth, initYear);
  }, []);

  const [filterType, setFilterType] = useState<FilterType>(() => detectFilterType(initRange[0], initRange[1]));
  const [month, setMonth] = useState(initMonth);
  const [year, setYear] = useState(initYear);
  const [selectedDate, setSelectedDate] = useState(initRange[0]);
  const [selectedWeek, setSelectedWeek] = useState(() => toISOWeek(new Date(initRange[0] + "T00:00:00")));

  const [queryDateFrom, queryDateTo] = useMemo<[string, string]>(() => {
    if (filterType === "mes") return monthRange(month, year);
    if (filterType === "dia") return dayRange(selectedDate);
    return weekRange(selectedWeek);
  }, [filterType, month, year, selectedDate, selectedWeek]);

  const periodLabel = formatPeriodLabel(filterType, queryDateFrom, queryDateTo, month, year);

  const { data, isLoading } = useQuery<CCDetail>({
    queryKey: ["/api/ar/cc/customer", customerId, queryDateFrom, queryDateTo],
    queryFn: async () => {
      const res = await fetch(`/api/ar/cc/customer/${customerId}?dateFrom=${queryDateFrom}&dateTo=${queryDateTo}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  // Fetch all invoices for this customer (needed for WA resumen flow)
  const { data: customerInvoices = [] } = useQuery<{ id: number; orderId: number; invoiceNumber: string }[]>({
    queryKey: ["/api/invoices", { customerId }],
    queryFn: () => fetch(`/api/invoices?customerId=${customerId}`, { credentials: "include" }).then((r) => r.json()),
  });

  // Fetch pending orders once (not gated on modal open, always available)
  const { data: pendingOrders = [] } = useQuery<PendingOrder[]>({
    queryKey: ["/api/ar/pending-orders", customerId],
    queryFn: async () => {
      const res = await fetch(`/api/ar/pending-orders/${customerId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 60_000,
  });

  const deletePaymentMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/payments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc/customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/pending-orders", customerId] });
      toast({ title: "Pago eliminado" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteWithholdingMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/withholdings/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc/customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc/summary"] });
      toast({ title: "Retención eliminada" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const fmtDate = (d: string) => {
    const dt = new Date(d.slice(0, 10) + "T00:00:00");
    return dt.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const handleDownloadPDF = async () => {
    if (!data) return;
    const fmtD = (d: string) =>
      new Date(d.replace(/\s.+$/, "T00:00:00")).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });

    // Pedidos pendientes de períodos anteriores (de pendingOrders que no están en el período actual)
    const inPeriodIds = new Set((data.orders ?? []).map((o) => o.id));
    const prevPendingRows = pendingOrders
      .filter((o) => !inPeriodIds.has(o.id))
      .map((o) => ({
        fecha: fmtD(o.orderDate),
        remito: formatRemito(o),
        factura: fmtFacturaSeq(o.invoiceNumber),
        monto: Math.round(parseFloat(o.total) - parseFloat(o.paidAmount ?? "0")),
        orderDate: o.orderDate,
      }));

    // Pedidos pendientes del período actual
    const currPendingRows = (data.orders ?? [])
      .filter((o) => !o.isPaid)
      .map((o) => ({
        fecha: fmtD(o.orderDate),
        remito: formatRemito(o),
        factura: fmtFacturaSeq(o.invoiceNumber),
        monto: Math.round(o.total - (o.paidAmount ?? 0)),
        orderDate: o.orderDate,
      }));

    // Combinar y ordenar de más viejo a más nuevo
    const allPendingRows = [...prevPendingRows, ...currPendingRows]
      .sort((a, b) => a.orderDate.localeCompare(b.orderDate))
      .map(({ orderDate: _d, ...rest }) => rest); // quitar campo auxiliar

    // cambio 3: ocultar columna N° FACTURA si ningún remito tiene factura asociada
    const hasInvoices = allPendingRows.some((r) => r.factura && r.factura !== "—");

    const todayLabel = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const doc = await generateCCPDF({
      clientLabel: `Cliente: ${data.customer.name}`,
      saldoAnterior: 0,
      orderRows: allPendingRows,
      total: Math.max(0, data.saldo),
      periodLabel: `Saldo al ${todayLabel}`,
      hideFactura: !hasInvoices,
    });
    doc.save(`CC-${data.customer.name.replace(/\s+/g, "_")}-${todayLabel.replace(/\//g, "-")}.pdf`);
  };

  const handleWaSend = async () => {
    const rawPhone = data?.customer?.phone ?? "";
    const waPhone = fmtWaPhone(rawPhone);
    if (!waPhone) { toast({ title: "Número de teléfono inválido", variant: "destructive" }); return; }
    setWaSending(true);
    try {
      await handleDownloadPDF();
      window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(waMessage)}`, "_blank");
      setWaDialog(false);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setWaSending(false);
    }
  };

  // Extract prevPending at component level (needed for selection + checkboxes)
  const prevPendingOrders = useMemo(
    () => pendingOrders.filter((o) => o.orderDate.slice(0, 10) < queryDateFrom),
    [pendingOrders, queryDateFrom],
  );

  const allVisibleOrderIds = useMemo(
    () => [...(data?.orders ?? []).map((o) => o.id), ...prevPendingOrders.map((o) => o.id)],
    [data?.orders, prevPendingOrders],
  );

  const toggleOrder = (id: number) =>
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const selectAll = () => setSelectedOrderIds(new Set(allVisibleOrderIds));
  const deselectAll = () => setSelectedOrderIds(new Set());

  // Orders data for resumen PDF (both sections merged)
  const selectedOrdersData = useMemo(() => {
    const periodOrders = (data?.orders ?? []).map((o) => ({
      id: o.id, orderDate: o.orderDate, remitoNum: o.remitoNum ?? null,
      folio: o.folio, invoiceNumber: o.invoiceNumber ?? null, total: o.total,
    }));
    const prevOrders = prevPendingOrders.map((o) => ({
      id: o.id, orderDate: o.orderDate, remitoNum: o.remitoNum ?? null,
      folio: o.folio, invoiceNumber: o.invoiceNumber ?? null, total: parseFloat(o.total),
    }));
    return [...periodOrders, ...prevOrders]
      .filter((o) => selectedOrderIds.has(o.id))
      .sort((a, b) => a.orderDate.localeCompare(b.orderDate));
  }, [data?.orders, prevPendingOrders, selectedOrderIds]);

  const selectedInvoiceCount = useMemo(
    () => customerInvoices.filter((inv) => selectedOrderIds.has(inv.orderId)).length,
    [customerInvoices, selectedOrderIds],
  );

  const handleDownloadResumen = async () => {
    if (!data || selectedOrdersData.length === 0) return;
    await generateResumenCCPDF({ customerName: data.customer.name, orders: selectedOrdersData });
  };

  const handleWaSendResumen = async () => {
    const rawPhone = data?.customer?.phone ?? "";
    const waPhone = fmtWaPhone(rawPhone);
    if (!waPhone) { toast({ title: "Número de teléfono inválido", variant: "destructive" }); return; }
    setWaSending(true);
    try {
      await handleDownloadResumen();
      // Download each invoice PDF for selected orders that have an invoice
      for (const inv of customerInvoices.filter((i) => selectedOrderIds.has(i.orderId))) {
        try {
          const res = await fetch(`/api/invoices/${inv.id}`, { credentials: "include" });
          if (res.ok) await generateInvoicePDF(await res.json(), "completo");
        } catch { /* skip if invoice fetch fails */ }
      }
      const msg = `Hola ${data?.customer?.name ?? ""}, te adjunto el resumen de cuenta y las facturas correspondientes.`;
      window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, "_blank");
      setWaDialog(false);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setWaSending(false);
    }
  };

  const backUrl = `/cuentas-corrientes?month=${month}&year=${year}`;
  const title = data?.customer?.name ? `CC — ${data.customer.name}` : "Cuenta Corriente";

  // ── Child redirect view ──────────────────────────────────────────────────────
  if (!isLoading && data?.isChild) {
    return (
      <Layout title="Cuenta Corriente — Sede">
        <div className="p-5 max-w-2xl mx-auto space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setLocation(backUrl)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-10">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Building2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-semibold text-foreground">Esta es una sede</p>
                <p className="text-sm text-muted-foreground">
                  Su cuenta corriente está unificada bajo <span className="font-medium text-foreground">{data.parentName}</span>
                </p>
              </div>
              <Button onClick={() => setLocation(`/cuentas-corrientes/${data.parentId}?dateFrom=${queryDateFrom}&dateTo=${queryDateTo}&month=${month}&year=${year}`)}>
                Ver CC del grupo — {data.parentName}
              </Button>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  // Pending (unpaid) orders sum — for footer
  const pendingOrdersTotal = (data?.orders ?? [])
    .filter((o) => !o.isPaid)
    .reduce((s, o) => s + o.total, 0);

  const SaldoVal = ({ v }: { v: number }) => {
    if (v > 0) return <span className="font-bold text-destructive">${fmtInt(v)}</span>;
    if (v < 0) return <span className="font-bold text-green-600">${fmtInt(v)}</span>;
    return <span className="text-muted-foreground">$0</span>;
  };

  return (
    <Layout title={title}>
      <div className="p-5 max-w-4xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation(backUrl)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            {isLoading ? (
              <Skeleton className="h-6 w-48" />
            ) : (
              <>
                <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                  {data?.customer.name}
                  {data?.customer.ccType === "por_remito" ? (
                    <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-200">Por remito</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">Por saldo</Badge>
                  )}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {periodLabel} {data?.customer.city ? `· ${data.customer.city}` : ""} {data?.customer.hasIva && "· Con IVA"}
                </p>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Filter type toggle */}
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {(["mes", "semana", "dia"] as FilterType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-2.5 py-1.5 capitalize transition-colors ${filterType === t ? "bg-primary text-primary-foreground" : "hover:bg-muted/50 text-muted-foreground"}`}
                >
                  {t === "mes" ? "Mes" : t === "semana" ? "Semana" : "Día"}
                </button>
              ))}
            </div>
            {filterType === "mes" && (
              <>
                <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                  <SelectTrigger className="h-8 w-32 text-sm" data-testid="select-detail-month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                  <SelectTrigger className="h-8 w-20 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </>
            )}
            {filterType === "dia" && (
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                data-testid="input-filter-date"
              />
            )}
            {filterType === "semana" && (
              <input
                type="week"
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                data-testid="input-filter-week"
              />
            )}
          </div>

          <Button size="sm" variant="outline" onClick={() => setShowPaymentModal(true)} data-testid="button-add-payment">
            <Plus className="mr-1 h-3.5 w-3.5" /> Pago
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowWithholdingModal(true)} data-testid="button-add-withholding">
            <Plus className="mr-1 h-3.5 w-3.5" /> Retención
          </Button>
          <Button size="sm" variant="outline" onClick={handleDownloadPDF} disabled={isLoading || !data} data-testid="button-download-pdf">
            <Download className="mr-1 h-3.5 w-3.5" /> Descargar CC
          </Button>
          {selectedOrderIds.size > 0 && (
            <Button size="sm" variant="outline" onClick={handleDownloadResumen} data-testid="button-download-resumen">
              <FileText className="mr-1 h-3.5 w-3.5" /> Bajar Resumen ({selectedOrderIds.size})
            </Button>
          )}
          <Button
            size="sm" variant="outline"
            className="border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-950"
            disabled={isLoading || !data}
            onClick={() => {
              setWaOption("cc");
              setWaMessage(`Hola, te adjunto el estado de cuenta corriente. Gracias!`);
              setWaDialog(true);
            }}
          >
            <WhatsAppIcon className="mr-1 h-3.5 w-3.5" /> WhatsApp
          </Button>
        </div>

        {/* Balance summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Saldo Anterior", value: data?.saldoMesAnterior ?? 0, key: "saldo-anterior" },
            { label: "Facturación", value: data?.facturacion ?? 0, key: "facturacion" },
            { label: "Cobranza", value: data?.cobranza ?? 0, key: "cobranza", green: true },
            { label: "Retenciones", value: data?.retenciones ?? 0, key: "retenciones", blue: true },
            { label: "Saldo Actual", value: data?.saldo ?? 0, key: "saldo", big: true },
          ].map((item) => (
            <Card key={item.key} className={item.big ? "sm:col-span-1 border-2 border-primary/30" : ""}>
              <CardContent className="p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{item.label}</p>
                {isLoading ? (
                  <Skeleton className="h-5 w-20 mt-1" />
                ) : (
                  <p
                    className={`text-base font-bold mt-0.5 ${
                      item.big
                        ? item.value > 0 ? "text-destructive" : item.value < 0 ? "text-green-600" : "text-foreground"
                        : item.green ? "text-green-600"
                        : item.blue ? "text-blue-600"
                        : "text-foreground"
                    }`}
                    data-testid={`value-${item.key}`}
                  >
                    ${fmtInt(item.value ?? 0)}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Orders in period */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 flex-wrap">
              <FileText className="h-4 w-4" />
              Pedidos del Período ({data?.orders.length ?? 0})
              {!isLoading && (data?.orders ?? []).some((o) => o.isPaid) && (
                <Badge className="text-[9px] bg-green-100 text-green-700 border-green-200 ml-1">
                  {(data?.orders ?? []).filter((o) => o.isPaid).length} pagado{(data?.orders ?? []).filter((o) => o.isPaid).length > 1 ? "s" : ""}
                </Badge>
              )}
              {!isLoading && (data?.orders.length ?? 0) > 0 && (
                <div className="ml-auto flex items-center gap-1">
                  <button className="text-[10px] text-primary hover:underline" onClick={selectAll}>Sel. todos</button>
                  <span className="text-muted-foreground text-[10px]">·</span>
                  <button className="text-[10px] text-muted-foreground hover:underline" onClick={deselectAll}>Ninguno</button>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : (data?.orders.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground p-4 text-center">Sin pedidos en este período</p>
            ) : (
              <>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="w-8 py-2 px-2"></th>
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Folio</th>
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Fecha</th>
                      {data?.isParent && <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Sede</th>}
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Nro. Factura</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Total</th>
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.orders.map((o) => (
                      <tr
                        key={o.id}
                        className={`border-b border-border last:border-0 transition-colors ${
                          selectedOrderIds.has(o.id) ? "bg-primary/5" : o.isPaid ? "bg-green-50/50 dark:bg-green-950/20" : "hover:bg-muted/20"
                        }`}
                        data-testid={`row-order-${o.id}`}
                      >
                        <td className="py-2 px-2 text-center">
                          <Checkbox checked={selectedOrderIds.has(o.id)} onCheckedChange={() => toggleOrder(o.id)} onClick={(e) => e.stopPropagation()} className="h-3.5 w-3.5" />
                        </td>
                        <td
                          className="py-2 px-3 font-mono font-medium text-primary cursor-pointer hover:underline"
                          onClick={() => setLocation(`/orders/${o.id}`)}
                        >
                          {formatRemito(o)}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">{fmtDate(o.orderDate)}</td>
                        {data?.isParent && (
                          <td className="py-2 px-3">
                            {o.customerId !== customerId
                              ? <Badge variant="outline" className="text-[9px] py-0">{(data.subsidiaries ?? []).find((s) => s.customerId === o.customerId)?.customerName ?? "—"}</Badge>
                              : <span className="text-[10px] text-muted-foreground italic">Principal</span>
                            }
                          </td>
                        )}
                        <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                          <InvoiceCell order={o} customerId={customerId} />
                        </td>
                        <td className={`py-2 px-3 text-right font-semibold ${o.isPaid ? "text-muted-foreground line-through" : "text-foreground"}`}>
                          ${fmtInt(o.total)}
                        </td>
                        <td className="py-2 px-3">
                          {o.isPaid ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded-full">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              Pagado
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">Pendiente</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* Footer: pending total */}
                {pendingOrdersTotal > 0 && (
                  <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/20 text-xs">
                    <span className="text-muted-foreground font-medium">
                      {(data?.orders ?? []).filter((o) => !o.isPaid).length} pendiente{(data?.orders ?? []).filter((o) => !o.isPaid).length > 1 ? "s" : ""}
                    </span>
                    <span className="font-bold text-destructive">${fmtInt(pendingOrdersTotal)}</span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Pending orders from previous periods */}
        {prevPendingOrders.length > 0 && (() => {
          const prevTotal = prevPendingOrders.reduce((s, o) => s + parseFloat(o.total) - parseFloat(o.paidAmount ?? "0"), 0);
          const fmtD = (d: string) => new Date(d.replace(/\s.+$/, "T00:00:00")).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
          return (
            <Card className="border-amber-200 dark:border-amber-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 flex-wrap text-amber-700 dark:text-amber-400">
                  <Clock className="h-4 w-4" />
                  Pendientes de períodos anteriores ({prevPendingOrders.length})
                  <div className="ml-auto flex items-center gap-1">
                    <button className="text-[10px] text-primary hover:underline" onClick={selectAll}>Sel. todos</button>
                    <span className="text-muted-foreground text-[10px]">·</span>
                    <button className="text-[10px] text-muted-foreground hover:underline" onClick={deselectAll}>Ninguno</button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="w-8 py-1.5 px-2"></th>
                      <th className="text-left py-1.5 px-3 font-semibold text-muted-foreground">Folio</th>
                      <th className="text-left py-1.5 px-3 font-semibold text-muted-foreground">Fecha</th>
                      <th className="text-left py-1.5 px-3 font-semibold text-muted-foreground">Nro. Factura</th>
                      <th className="text-right py-1.5 px-3 font-semibold text-muted-foreground">Total</th>
                      <th className="text-right py-1.5 px-3 font-semibold text-muted-foreground">Pendiente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prevPendingOrders.map((o) => {
                      const remaining = parseFloat(o.total) - parseFloat(o.paidAmount ?? "0");
                      return (
                        <tr
                          key={o.id}
                          className={`border-b border-border last:border-0 cursor-pointer transition-colors ${selectedOrderIds.has(o.id) ? "bg-primary/5" : "hover:bg-muted/20"}`}
                        >
                          <td className="py-1.5 px-2 text-center">
                            <Checkbox checked={selectedOrderIds.has(o.id)} onCheckedChange={() => toggleOrder(o.id)} onClick={(e) => e.stopPropagation()} className="h-3.5 w-3.5" />
                          </td>
                          <td className="py-1.5 px-3 font-mono font-medium text-primary" onClick={() => setLocation(`/orders/${o.id}`)}>{formatRemito(o)}</td>
                          <td className="py-1.5 px-3 text-muted-foreground" onClick={() => setLocation(`/orders/${o.id}`)}>{fmtD(o.orderDate)}</td>
                          <td className="py-1.5 px-3 text-muted-foreground" onClick={() => setLocation(`/orders/${o.id}`)}>{fmtFacturaSeq(o.invoiceNumber)}</td>
                          <td className="py-1.5 px-3 text-right" onClick={() => setLocation(`/orders/${o.id}`)}>${fmtInt(parseFloat(o.total))}</td>
                          <td className="py-1.5 px-3 text-right font-semibold text-destructive" onClick={() => setLocation(`/orders/${o.id}`)}>${fmtInt(remaining)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-amber-50/50 dark:bg-amber-950/20 text-xs">
                  <span className="text-muted-foreground font-medium">{prevPendingOrders.length} pedido{prevPendingOrders.length > 1 ? "s" : ""} de períodos anteriores</span>
                  <span className="font-bold text-destructive">${fmtInt(prevTotal)}</span>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        <div className="flex flex-col gap-4">
          {/* Payments */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span>Cobros ({data?.payments.length ?? 0})</span>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowPaymentModal(true)} data-testid="button-add-payment-2">
                  <Plus className="h-3 w-3 mr-1" /> Agregar
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(data?.payments.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground p-3 text-center">Sin cobros en el período</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="text-left py-1.5 px-3 font-semibold text-muted-foreground">Fecha</th>
                      <th className="text-left py-1.5 px-3 font-semibold text-muted-foreground">Método / Pedidos</th>
                      <th className="text-right py-1.5 px-3 font-semibold text-muted-foreground">Monto</th>
                      <th className="w-7"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.payments.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0" data-testid={`row-payment-${p.id}`}>
                        <td className="py-1.5 px-3 text-muted-foreground">{p.date}</td>
                        <td className="py-1.5 px-3">
                          <div className="flex items-center gap-1 flex-wrap">
                            <Badge variant="outline" className="text-[9px] py-0">{p.method}</Badge>
                            {(p as PaymentRow).orderFolio && (
                              <Badge className="text-[9px] py-0 bg-primary/10 text-primary border-primary/20 font-mono border">
                                {(p as PaymentRow).orderFolio}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-1.5 px-3 text-right font-semibold text-green-600">${fmtInt(parseFloat(p.amount as string))}</td>
                        <td className="py-1.5 px-3">
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={() => setEditingPayment(p as PaymentRow)}
                              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                              data-testid={`button-edit-payment-${p.id}`}
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => deletePaymentMutation.mutate(p.id)}
                              disabled={deletePaymentMutation.isPending}
                              className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                              data-testid={`button-delete-payment-${p.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* Withholdings */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span>Retenciones ({data?.withholdings.length ?? 0})</span>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowWithholdingModal(true)} data-testid="button-add-withholding-2">
                  <Plus className="h-3 w-3 mr-1" /> Agregar
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(data?.withholdings.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground p-3 text-center">Sin retenciones en el período</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="text-left py-1.5 px-3 font-semibold text-muted-foreground">Fecha</th>
                      <th className="text-left py-1.5 px-3 font-semibold text-muted-foreground">Tipo</th>
                      <th className="text-right py-1.5 px-3 font-semibold text-muted-foreground">Monto</th>
                      <th className="w-7"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.withholdings.map((w) => (
                      <tr key={w.id} className="border-b border-border last:border-0" data-testid={`row-withholding-${w.id}`}>
                        <td className="py-1.5 px-3 text-muted-foreground">{w.date}</td>
                        <td className="py-1.5 px-3">
                          <Badge variant="outline" className="text-[9px] py-0 text-blue-600 border-blue-200">{(w as any).notes || (w as any).type || "RET."}</Badge>
                        </td>
                        <td className="py-1.5 px-3 text-right font-semibold text-blue-600">${fmtInt(parseFloat(w.amount as string))}</td>
                        <td className="py-1.5 px-3">
                          <button
                            onClick={() => deleteWithholdingMutation.mutate(w.id)}
                            disabled={deleteWithholdingMutation.isPending}
                            className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            data-testid={`button-delete-withholding-${w.id}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Subsidiaries breakdown */}
        {data?.isParent && (data?.subsidiaries ?? []).length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Desglose por Sede
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Sede</th>
                    <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Facturación</th>
                    <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Cobranza</th>
                    <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subsidiaries!.map((s) => (
                    <tr key={s.customerId} className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer" onClick={() => setSelectedSubsidiary(s as any)}>
                      <td className="py-2 px-3 font-medium text-primary">
                        {s.customerName}
                      </td>
                      <td className="py-2 px-3 text-right">${fmtInt(s.facturacion)}</td>
                      <td className="py-2 px-3 text-right text-green-600">${fmtInt(s.cobranza)}</td>
                      <td className={`py-2 px-3 text-right font-semibold ${s.saldo > 0 ? "text-destructive" : s.saldo < 0 ? "text-green-600" : "text-muted-foreground"}`}>
                        ${fmtInt(Math.abs(s.saldo))} {s.saldo > 0 ? "a cobrar" : s.saldo < 0 ? "a favor" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      <SubsidiaryDetailModal
        open={selectedSubsidiary !== null}
        onClose={() => setSelectedSubsidiary(null)}
        subsidiary={selectedSubsidiary as any}
        orders={data?.orders ?? []}
        periodLabel={periodLabel}
      />

      <PaymentModal
        customerId={customerId}
        open={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        pendingOrders={pendingOrders}
      />
      <WithholdingModal
        customerId={customerId}
        open={showWithholdingModal}
        onClose={() => setShowWithholdingModal(false)}
      />
      <EditPaymentModal
        payment={editingPayment}
        customerId={customerId}
        open={editingPayment !== null}
        onClose={() => setEditingPayment(null)}
      />

      {/* WhatsApp dialog */}
      <Dialog open={waDialog} onOpenChange={setWaDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <WhatsAppIcon className="h-5 w-5 text-green-500" /> Enviar por WhatsApp
            </DialogTitle>
            <DialogDescription>
              Los PDF se descargarán automáticamente. Adjuntalos en WhatsApp manualmente.
            </DialogDescription>
          </DialogHeader>
          {!data?.customer?.phone ? (
            <Alert>
              <AlertDescription>El cliente no tiene número de teléfono registrado. Editalo desde la sección Clientes.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4 py-1">
              {/* Opciones */}
              <div className="space-y-2">
                <label className={`flex items-start gap-2.5 cursor-pointer p-2.5 rounded-md border transition-colors ${waOption === "cc" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}>
                  <input type="radio" name="waOpt" value="cc" checked={waOption === "cc"}
                    onChange={() => { setWaOption("cc"); setWaMessage(`Hola, te adjunto el estado de cuenta corriente. Gracias!`); }}
                    className="mt-0.5 shrink-0"
                  />
                  <div>
                    <p className="text-sm font-medium">Enviar cuenta corriente completa</p>
                    <p className="text-xs text-muted-foreground">Genera el PDF de estado de cuenta del período</p>
                  </div>
                </label>
                {selectedOrderIds.size > 0 && (
                  <label className={`flex items-start gap-2.5 cursor-pointer p-2.5 rounded-md border transition-colors ${waOption === "resumen" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}>
                    <input type="radio" name="waOpt" value="resumen" checked={waOption === "resumen"}
                      onChange={() => { setWaOption("resumen"); setWaMessage(`Hola ${data.customer.name}, te adjunto el resumen de cuenta y las facturas correspondientes.`); }}
                      className="mt-0.5 shrink-0"
                    />
                    <div>
                      <p className="text-sm font-medium">Enviar resumen de seleccionados + facturas</p>
                      <p className="text-xs text-muted-foreground">
                        {selectedOrderIds.size} pedido{selectedOrderIds.size !== 1 ? "s" : ""} seleccionado{selectedOrderIds.size !== 1 ? "s" : ""}
                        {selectedInvoiceCount > 0 ? ` · ${selectedInvoiceCount} factura${selectedInvoiceCount !== 1 ? "s" : ""}` : ""}
                      </p>
                    </div>
                  </label>
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Mensaje</p>
                <Textarea value={waMessage} onChange={(e) => setWaMessage(e.target.value)} rows={3} />
              </div>
              <p className="text-xs text-muted-foreground">Teléfono: {data.customer.phone}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaDialog(false)}>Cancelar</Button>
            {data?.customer?.phone && (
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                disabled={waSending}
                onClick={waOption === "cc" ? handleWaSend : handleWaSendResumen}
              >
                <WhatsAppIcon className="mr-2 h-4 w-4" />
                {waSending ? "Generando..." : "Descargar y abrir WhatsApp"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
