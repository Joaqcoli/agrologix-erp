import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2, FileText, Download, CheckCircle2, Building2 } from "lucide-react";
import { useState, useRef, useMemo } from "react";
import type { Payment, Withholding } from "@shared/schema";
import { PAYMENT_METHODS } from "@shared/schema";
import { jsPDF } from "jspdf";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const fmtInt = (v: number) => Math.round(v).toLocaleString("es-AR");
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

  const handleDownloadPDF = () => {
    if (!subsidiary) return;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = 210;
    const margin = 14;
    let y = margin;
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("AgroLogix", margin, y);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(periodLabel, pageW - margin, y, { align: "right" });
    y += 5;
    doc.setFontSize(10); doc.setFont("helvetica", "bold");
    doc.text(subsidiary.customerName + " (Sede)", margin, y);
    y += 5; doc.setDrawColor(180, 180, 180); doc.line(margin, y, pageW - margin, y); y += 5;
    doc.setFontSize(8); doc.setFont("helvetica", "bold");
    doc.text("Fecha", margin, y); doc.text("Folio", margin + 22, y);
    doc.text("Nro. Factura", margin + 80, y);
    doc.text("Total", pageW - margin, y, { align: "right" });
    y += 4; doc.line(margin, y, pageW - margin, y); y += 4;
    doc.setFont("helvetica", "normal");
    for (const o of subOrders) {
      if (y > 270) { doc.addPage(); y = margin; }
      doc.text(fmtDate(o.orderDate), margin, y);
      doc.text(formatRemito(o), margin + 22, y);
      doc.text(o.invoiceNumber ?? "—", margin + 80, y);
      doc.text(`$${Math.round(o.total).toLocaleString("es-AR")}`, pageW - margin, y, { align: "right" });
      y += 5;
    }
    y += 3; doc.setDrawColor(120, 120, 120); doc.line(margin, y, pageW - margin, y); y += 5;
    doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text("TOTAL FACTURADO", margin, y);
    doc.text(`$${Math.round(subsidiary.facturacion).toLocaleString("es-AR")}`, pageW - margin, y, { align: "right" });
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
                    <td className="py-1.5 px-3 text-muted-foreground">{o.invoiceNumber || "—"}</td>
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

type PendingOrder = { id: number; folio: string; remitoNum: number | null; total: string; orderDate: string };

function formatRemito(order: { remitoNum?: number | null; folio?: string | null }): string {
  if (order.remitoNum != null) return `VA-${String(order.remitoNum).padStart(6, "0")}`;
  const f = order.folio ?? "";
  const m = f.match(/^(?:VA|PV)-?(\d+)$/);
  return m ? `VA-${m[1].padStart(6, "0")}` : (f || "-");
}

// ── PDF generation ─────────────────────────────────────────────────────────────

function buildPDF(data: CCDetail, monthLabel: string) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const margin = 14;
  let y = margin;

  const setH = (size: number, bold = false) => {
    doc.setFontSize(size);
    doc.setFont("helvetica", bold ? "bold" : "normal");
  };

  setH(14, true);
  doc.text("AgroLogix", margin, y);
  setH(9);
  doc.text(monthLabel, pageW - margin, y, { align: "right" });
  y += 5;
  setH(10, true);
  doc.text(data.customer.name, margin, y);
  y += 4;
  doc.setDrawColor(180, 180, 180);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  const fmtDate = (d: string) => {
    const dt = new Date(d.replace(/\s.+$/, "T00:00:00"));
    return dt.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };
  const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
  const isPorRemito = data.customer.ccType === "por_remito";

  if (isPorRemito) {
    const unpaidOrders = data.orders.filter((o) => !o.isPaid);
    setH(9, true);
    doc.text("Fecha", margin, y);
    doc.text("Descripción", margin + 20, y);
    doc.text("Nro. Factura", margin + 90, y);
    doc.text("Monto", pageW - margin, y, { align: "right" });
    y += 4;
    doc.setDrawColor(120, 120, 120);
    doc.line(margin, y, pageW - margin, y);
    y += 5;
    setH(9);
    let total = 0;
    for (const o of unpaidOrders) {
      if (y > 270) { doc.addPage(); y = margin; }
      doc.text(fmtDate(o.orderDate), margin, y);
      doc.text(formatRemito(o), margin + 20, y);
      doc.text(o.invoiceNumber ?? "—", margin + 90, y);
      doc.text(fmtMoney(o.total), pageW - margin, y, { align: "right" });
      y += 6;
      total += o.total;
    }
    y += 2;
    doc.setDrawColor(120, 120, 120);
    doc.line(margin, y, pageW - margin, y);
    y += 5;
    setH(10, true);
    doc.text("TOTAL PENDIENTE", margin, y);
    doc.text(fmtMoney(total), pageW - margin, y, { align: "right" });
  } else {
    setH(9, true);
    doc.text("Saldo anterior", margin, y);
    doc.text(fmtMoney(data.saldoMesAnterior), pageW - margin, y, { align: "right" });
    y += 7;
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, y - 4, pageW - margin * 2, 6, "F");
    setH(8, true);
    doc.text("Fecha", margin + 1, y);
    doc.text("Descripción", margin + 22, y);
    doc.text("Nro. Factura", margin + 90, y);
    doc.text("Monto", pageW - margin - 1, y, { align: "right" });
    y += 4;
    setH(8);
    for (const o of data.orders) {
      if (y > 270) { doc.addPage(); y = margin; }
      doc.text(fmtDate(o.orderDate), margin + 1, y);
      doc.text(formatRemito(o), margin + 22, y);
      doc.text(o.invoiceNumber ?? "—", margin + 90, y);
      doc.text(fmtMoney(o.total), pageW - margin - 1, y, { align: "right" });
      y += 5;
    }
    doc.setTextColor(22, 163, 74);
    for (const p of data.payments) {
      if (y > 270) { doc.addPage(); y = margin; doc.setTextColor(22, 163, 74); }
      const amt = parseFloat(p.amount as string);
      doc.text(p.date, margin + 1, y);
      const desc = `Pago ${p.method.replace(/_/g, " ")}${(p as PaymentRow).orderFolio ? ` (${(p as PaymentRow).orderFolio})` : ""}`;
      doc.text(desc, margin + 22, y);
      doc.text("-" + fmtMoney(amt), pageW - margin - 1, y, { align: "right" });
      y += 5;
    }
    doc.setTextColor(37, 99, 235);
    for (const w of data.withholdings) {
      if (y > 270) { doc.addPage(); y = margin; doc.setTextColor(37, 99, 235); }
      const amt = parseFloat(w.amount as string);
      doc.text(w.date, margin + 1, y);
      doc.text(`Retención ${w.type}`, margin + 22, y);
      doc.text("-" + fmtMoney(amt), pageW - margin - 1, y, { align: "right" });
      y += 5;
    }
    doc.setTextColor(0, 0, 0);
    y += 2;
    doc.setDrawColor(120, 120, 120);
    doc.line(margin, y, pageW - margin, y);
    y += 5;
    setH(10, true);
    doc.text("SALDO ACTUAL", margin, y);
    const saldo = data.saldo;
    if (saldo > 0) doc.setTextColor(220, 38, 38);
    else if (saldo < 0) doc.setTextColor(22, 163, 74);
    doc.text(fmtMoney(saldo), pageW - margin, y, { align: "right" });
    doc.setTextColor(0, 0, 0);
  }

  return doc;
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

  const toggleOrder = (id: number) => {
    setSelectedOrderIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Sum of selected order totals (for amount hint)
  const selectedTotal = pendingOrders
    .filter((o) => selectedOrderIds.includes(o.id))
    .reduce((s, o) => s + parseFloat(o.total), 0);

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/payments", {
        customerId,
        date,
        amount,
        method,
        notes: notes || null,
        orderIds: selectedOrderIds,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc/customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc/summary"] });
      toast({ title: "Pago registrado" });
      setAmount(""); setNotes(""); setMethod("EFECTIVO"); setSelectedOrderIds([]);
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
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>{m.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Multi-select order checkboxes */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs">Asociar a pedidos (opcional)</Label>
              {selectedOrderIds.length > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {selectedOrderIds.length} seleccionado{selectedOrderIds.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {pendingOrders.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 text-center border rounded-md">
                Sin pedidos aprobados
              </p>
            ) : (
              <ScrollArea className="h-40 rounded-md border bg-muted/20 p-2">
                <div className="space-y-1.5">
                  {pendingOrders.map((o) => {
                    const checked = selectedOrderIds.includes(o.id);
                    return (
                      <label
                        key={o.id}
                        className={`flex items-center gap-2.5 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                          checked ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                        }`}
                        data-testid={`check-order-${o.id}`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleOrder(o.id)}
                          className="shrink-0"
                        />
                        <span className="text-xs font-mono font-medium">{formatRemito(o)}</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          ${Math.round(parseFloat(o.total)).toLocaleString("es-AR")}
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
  const [selectedSubsidiary, setSelectedSubsidiary] = useState<CCDetail["subsidiaries"] extends (infer T)[] ? T : never | null>(null);

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
    const dt = new Date(d.replace(/\s.+$/, ""));
    return dt.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const handleDownloadPDF = () => {
    if (!data) return;
    const doc = buildPDF(data as CCDetail, periodLabel);
    doc.save(`CC-${data.customer.name.replace(/\s+/g, "_")}-${periodLabel.replace(/[\s/]/g, "_")}.pdf`);
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
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Pedidos del Período ({data?.orders.length ?? 0})
              {!isLoading && (data?.orders ?? []).some((o) => o.isPaid) && (
                <Badge className="text-[9px] bg-green-100 text-green-700 border-green-200 ml-1">
                  {(data?.orders ?? []).filter((o) => o.isPaid).length} pagado{(data?.orders ?? []).filter((o) => o.isPaid).length > 1 ? "s" : ""}
                </Badge>
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
                          o.isPaid ? "bg-green-50/50 dark:bg-green-950/20" : "hover:bg-muted/20"
                        }`}
                        data-testid={`row-order-${o.id}`}
                      >
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                          <button
                            onClick={() => deletePaymentMutation.mutate(p.id)}
                            disabled={deletePaymentMutation.isPending}
                            className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            data-testid={`button-delete-payment-${p.id}`}
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
                          <Badge variant="outline" className="text-[9px] py-0 text-blue-600 border-blue-200">{w.type}</Badge>
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
    </Layout>
  );
}
