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
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2, FileText, Download } from "lucide-react";
import { useState, useRef } from "react";
import type { Payment, Withholding } from "@shared/schema";
import { PAYMENT_METHODS } from "@shared/schema";
import { jsPDF } from "jspdf";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const fmtInt = (v: number) => Math.round(v).toLocaleString("es-AR");
const today = () => new Date().toISOString().split("T")[0];

type OrderRow = { id: number; folio: string; orderDate: string; total: number; invoiceNumber?: string | null };
type PaymentRow = Payment & { orderFolio?: string | null };

type CCDetail = {
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
};

type PendingOrder = { id: number; folio: string; total: string; orderDate: string };

// ── PDF generation ─────────────────────────────────────────────────────────────

function buildPDF(data: CCDetail, monthLabel: string) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const margin = 14;
  const colW = pageW - margin * 2;
  let y = margin;

  const setH = (size: number, bold = false) => {
    doc.setFontSize(size);
    doc.setFont("helvetica", bold ? "bold" : "normal");
  };

  // ── Header ────────────────────────────────────────────────────────────────
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
    // ── Por Remito: only pending orders table ────────────────────────────────
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
    for (const o of data.orders) {
      if (y > 270) { doc.addPage(); y = margin; }
      doc.text(fmtDate(o.orderDate), margin, y);
      doc.text(o.folio, margin + 20, y);
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
    doc.text("TOTAL", margin, y);
    doc.text(fmtMoney(total), pageW - margin, y, { align: "right" });

  } else {
    // ── Por Saldo: saldo anterior + movimientos + saldo final ────────────────

    // Saldo anterior
    setH(9, true);
    doc.text("Saldo anterior", margin, y);
    doc.text(fmtMoney(data.saldoMesAnterior), pageW - margin, y, { align: "right" });
    y += 7;

    // Table header
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, y - 4, colW, 6, "F");
    setH(8, true);
    doc.text("Fecha", margin + 1, y);
    doc.text("Descripción", margin + 22, y);
    doc.text("Nro. Factura", margin + 90, y);
    doc.text("Monto", pageW - margin - 1, y, { align: "right" });
    y += 4;

    setH(8);
    // Orders
    for (const o of data.orders) {
      if (y > 270) { doc.addPage(); y = margin; }
      doc.text(fmtDate(o.orderDate), margin + 1, y);
      doc.text(o.folio, margin + 22, y);
      doc.text(o.invoiceNumber ?? "—", margin + 90, y);
      doc.text(fmtMoney(o.total), pageW - margin - 1, y, { align: "right" });
      y += 5;
    }

    // Payments (shown in green as negative)
    doc.setTextColor(22, 163, 74); // green-600
    for (const p of data.payments) {
      if (y > 270) { doc.addPage(); y = margin; doc.setTextColor(22, 163, 74); }
      const amt = parseFloat(p.amount as string);
      doc.text(p.date, margin + 1, y);
      const desc = `Pago ${p.method.replace(/_/g, " ")}${p.orderFolio ? ` (${p.orderFolio})` : ""}`;
      doc.text(desc, margin + 22, y);
      doc.text("", margin + 90, y);
      doc.text(`-${fmtMoney(amt)}`, pageW - margin - 1, y, { align: "right" });
      y += 5;
    }
    doc.setTextColor(0, 0, 0);

    // Withholdings (shown in blue)
    doc.setTextColor(37, 99, 235); // blue-600
    for (const w of data.withholdings) {
      if (y > 270) { doc.addPage(); y = margin; doc.setTextColor(37, 99, 235); }
      const amt = parseFloat(w.amount as string);
      doc.text(w.date, margin + 1, y);
      doc.text(`Retención ${w.type}`, margin + 22, y);
      doc.text("", margin + 90, y);
      doc.text(`-${fmtMoney(amt)}`, pageW - margin - 1, y, { align: "right" });
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
  month,
  year,
  open,
  onClose,
}: {
  customerId: number;
  month: number;
  year: number;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("EFECTIVO");
  const [notes, setNotes] = useState("");
  const [orderId, setOrderId] = useState<string>("none");

  const { data: pendingOrders } = useQuery<PendingOrder[]>({
    queryKey: ["/api/ar/pending-orders", customerId],
    queryFn: async () => {
      const res = await fetch(`/api/ar/pending-orders/${customerId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/payments", {
        customerId,
        date,
        amount,
        method,
        notes: notes || null,
        orderId: orderId !== "none" ? Number(orderId) : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc/customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc/summary"] });
      toast({ title: "Pago registrado" });
      setAmount(""); setNotes(""); setMethod("EFECTIVO"); setOrderId("none");
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
          <div>
            <Label className="text-xs">Asociar a pedido (opcional)</Label>
            <Select value={orderId} onValueChange={setOrderId}>
              <SelectTrigger className="mt-1" data-testid="select-payment-order">
                <SelectValue placeholder="Sin asociar (descuento general)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin asociar (descuento general)</SelectItem>
                {(pendingOrders ?? []).map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>
                    {o.folio} — ${Math.round(parseFloat(o.total)).toLocaleString("es-AR")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
      queryClient.invalidateQueries({ queryKey: ["/api/ar/cc/customer", customerId] });
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
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setVal(order.invoiceNumber ?? ""); setEditing(false); } }}
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
}: {
  customerId: number;
  month: number;
  year: number;
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [month, setMonth] = useState(initMonth);
  const [year, setYear] = useState(initYear);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showWithholdingModal, setShowWithholdingModal] = useState(false);
  const today2 = new Date();
  const years = Array.from({ length: 4 }, (_, i) => today2.getFullYear() - i);

  const { data, isLoading } = useQuery<CCDetail>({
    queryKey: ["/api/ar/cc/customer", customerId, month, year],
    queryFn: async () => {
      const res = await fetch(`/api/ar/cc/customer/${customerId}?month=${month}&year=${year}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
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
    const monthLabel = `${MONTHS[month - 1]} ${year}`;
    const doc = buildPDF(data, monthLabel);
    doc.save(`CC-${data.customer.name.replace(/\s+/g, "_")}-${MONTHS[month - 1]}-${year}.pdf`);
  };

  const backUrl = `/cuentas-corrientes?month=${month}&year=${year}`;
  const title = data?.customer.name ? `CC — ${data.customer.name}` : "Cuenta Corriente";

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
                  {data?.customer.city ?? ""} {data?.customer.hasIva && "· Con IVA"}
                </p>
              </>
            )}
          </div>

          {/* Period */}
          <div className="flex items-center gap-2">
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
                        : item.green
                        ? "text-green-600"
                        : item.blue
                        ? "text-blue-600"
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
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Folio</th>
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Fecha</th>
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Nro. Factura</th>
                    <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {data?.orders.map((o) => (
                    <tr
                      key={o.id}
                      className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                      data-testid={`row-order-${o.id}`}
                    >
                      <td
                        className="py-2 px-3 font-mono font-medium text-primary cursor-pointer"
                        onClick={() => setLocation(`/orders/${o.id}`)}
                      >
                        {o.folio}
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{fmtDate(o.orderDate)}</td>
                      <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                        <InvoiceCell order={o} customerId={customerId} />
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-foreground">${fmtInt(o.total)}</td>
                      <td className="py-2 px-3"></td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                      <th className="text-left py-1.5 px-3 font-semibold text-muted-foreground">Método</th>
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
                              <Badge className="text-[9px] py-0 bg-primary/10 text-primary border-primary/20 font-mono">
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
      </div>

      <PaymentModal
        customerId={customerId}
        month={month}
        year={year}
        open={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
      />
      <WithholdingModal
        customerId={customerId}
        open={showWithholdingModal}
        onClose={() => setShowWithholdingModal(false)}
      />
    </Layout>
  );
}
