import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2, FileText, Download, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { jsPDF } from "jspdf";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const PAYMENT_METHODS = ["EFECTIVO", "TRANSFERENCIA", "CHEQUE", "CUENTA_CORRIENTE", "OTRO"] as const;

const fmtInt = (v: number) => Math.round(v).toLocaleString("es-AR");
const todayStr = () => new Date().toISOString().split("T")[0];

type PurchaseRow = {
  id: number;
  folio: string;
  purchaseDate: string;
  total: number;
  paymentMethod: string;
  isPaid: boolean;
};

type PaymentRow = {
  id: number;
  supplierId: number;
  date: string;
  amount: number;
  method: string;
  notes?: string | null;
  purchaseId?: number | null;
};

type APCCDetail = {
  supplier: {
    id: number;
    name: string;
    phone?: string | null;
    email?: string | null;
    cuit?: string | null;
    ccType?: string | null;
  };
  month: number;
  year: number;
  saldoMesAnterior: number;
  facturacion: number;
  cobranza: number;
  saldo: number;
  purchases: PurchaseRow[];
  payments: PaymentRow[];
};

type PendingPurchase = { id: number; folio: string; total: string; purchaseDate: string };

// ── PDF generation ─────────────────────────────────────────────────────────────
function buildPDF(data: APCCDetail, monthLabel: string) {
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
  doc.text(data.supplier.name, margin, y);
  if (data.supplier.cuit) {
    setH(8);
    y += 4;
    doc.text(`CUIT: ${data.supplier.cuit}`, margin, y);
  }
  y += 4;
  doc.setDrawColor(180, 180, 180);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  const fmtDate = (d: string) => {
    const dt = new Date(d.replace(/\s.+$/, "T00:00:00"));
    return dt.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };
  const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

  setH(9, true);
  doc.text("Saldo anterior", margin, y);
  doc.text(fmtMoney(data.saldoMesAnterior), pageW - margin, y, { align: "right" });
  y += 7;

  doc.setFillColor(240, 240, 240);
  doc.rect(margin, y - 4, pageW - margin * 2, 6, "F");
  setH(8, true);
  doc.text("Fecha", margin + 1, y);
  doc.text("Folio", margin + 22, y);
  doc.text("Método Pago", margin + 70, y);
  doc.text("Monto", pageW - margin - 1, y, { align: "right" });
  y += 4;
  setH(8);

  for (const p of data.purchases) {
    if (y > 270) { doc.addPage(); y = margin; }
    doc.text(fmtDate(p.purchaseDate), margin + 1, y);
    doc.text(p.folio, margin + 22, y);
    doc.text(p.paymentMethod.replace(/_/g, " "), margin + 70, y);
    doc.text(fmtMoney(p.total), pageW - margin - 1, y, { align: "right" });
    y += 5;
  }

  doc.setTextColor(22, 163, 74);
  for (const pmt of data.payments) {
    if (y > 270) { doc.addPage(); y = margin; doc.setTextColor(22, 163, 74); }
    doc.text(pmt.date, margin + 1, y);
    doc.text(`Pago ${pmt.method.replace(/_/g, " ")}`, margin + 22, y);
    doc.text("-" + fmtMoney(pmt.amount), pageW - margin - 1, y, { align: "right" });
    y += 5;
  }
  doc.setTextColor(0, 0, 0);

  y += 2;
  doc.setDrawColor(120, 120, 120);
  doc.line(margin, y, pageW - margin, y);
  y += 5;
  setH(10, true);
  doc.text("SALDO ACTUAL", margin, y);
  if (data.saldo > 0) doc.setTextColor(220, 38, 38);
  else if (data.saldo < 0) doc.setTextColor(22, 163, 74);
  doc.text(fmtMoney(data.saldo), pageW - margin, y, { align: "right" });
  doc.setTextColor(0, 0, 0);

  return doc;
}

// ── Payment modal ──────────────────────────────────────────────────────────────
function PaymentModal({
  supplierId,
  open,
  onClose,
  pendingPurchases,
}: {
  supplierId: number;
  open: boolean;
  onClose: () => void;
  pendingPurchases: PendingPurchase[];
}) {
  const { toast } = useToast();
  const [date, setDate] = useState(todayStr());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("EFECTIVO");
  const [notes, setNotes] = useState("");
  const [selectedPurchaseIds, setSelectedPurchaseIds] = useState<number[]>([]);

  const togglePurchase = (id: number) => {
    setSelectedPurchaseIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectedTotal = pendingPurchases
    .filter((p) => selectedPurchaseIds.includes(p.id))
    .reduce((s, p) => s + parseFloat(p.total), 0);

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/ap/payments", {
        supplierId,
        date,
        amount,
        method,
        notes: notes || null,
        purchaseId: selectedPurchaseIds.length === 1 ? selectedPurchaseIds[0] : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ap/cc"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ap/cc/supplier", supplierId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ap/cc/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ap/pending-purchases", supplierId] });
      toast({ title: "Pago registrado" });
      setAmount(""); setNotes(""); setMethod("EFECTIVO"); setSelectedPurchaseIds([]);
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Pago a Proveedor</DialogTitle>
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
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="flex-1"
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
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs">Asociar a compra (opcional)</Label>
              {selectedPurchaseIds.length > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {selectedPurchaseIds.length} seleccionada{selectedPurchaseIds.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {pendingPurchases.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 text-center border rounded-md">
                Sin compras pendientes
              </p>
            ) : (
              <ScrollArea className="h-36 rounded-md border bg-muted/20 p-2">
                <div className="space-y-1.5">
                  {pendingPurchases.map((p) => {
                    const checked = selectedPurchaseIds.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className={`flex items-center gap-2.5 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                          checked ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => togglePurchase(p.id)}
                          className="shrink-0"
                        />
                        <span className="text-xs font-mono font-medium">{p.folio}</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          ${Math.round(parseFloat(p.total)).toLocaleString("es-AR")}
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
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !amount || parseFloat(amount) <= 0}
          >
            {mutation.isPending ? "Guardando..." : "Guardar Pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Detail Page ───────────────────────────────────────────────────────────
export default function SupplierCCPage({
  supplierId,
  month: initMonth,
  year: initYear,
}: {
  supplierId: number;
  month: number;
  year: number;
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [month, setMonth] = useState(initMonth);
  const [year, setYear] = useState(initYear);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const today2 = new Date();
  const years = Array.from({ length: 4 }, (_, i) => today2.getFullYear() - i);

  const { data, isLoading } = useQuery<APCCDetail>({
    queryKey: ["/api/ap/cc/supplier", supplierId, month, year],
    queryFn: async () => {
      const res = await fetch(`/api/ap/cc/${supplierId}?month=${month}&year=${year}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const { data: pendingPurchases = [] } = useQuery<PendingPurchase[]>({
    queryKey: ["/api/ap/pending-purchases", supplierId],
    queryFn: async () => {
      const res = await fetch(`/api/ap/pending-purchases/${supplierId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 60_000,
  });

  const deletePaymentMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/ap/payments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ap/cc/supplier", supplierId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ap/cc/summary"] });
      toast({ title: "Pago eliminado" });
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
    doc.save(`CC-Proveedor-${data.supplier.name.replace(/\s+/g, "_")}-${MONTHS[month - 1]}-${year}.pdf`);
  };

  const backUrl = `/suppliers`;
  const title = data?.supplier.name ? `CC Proveedor — ${data.supplier.name}` : "CC Proveedor";

  const pendingPurchasesTotal = (data?.purchases ?? [])
    .filter((p) => !p.isPaid)
    .reduce((s, p) => s + p.total, 0);

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
                <h2 className="text-xl font-bold text-foreground">{data?.supplier.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {data?.supplier.cuit ? `CUIT: ${data.supplier.cuit}` : ""}
                  {data?.supplier.phone ? ` · ${data.supplier.phone}` : ""}
                </p>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="h-8 w-32 text-sm">
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

          <Button size="sm" variant="outline" onClick={() => setShowPaymentModal(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Pago
          </Button>
          <Button size="sm" variant="outline" onClick={handleDownloadPDF} disabled={isLoading || !data}>
            <Download className="mr-1 h-3.5 w-3.5" /> Descargar CC
          </Button>
        </div>

        {/* Balance summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Saldo Anterior", value: data?.saldoMesAnterior ?? 0, key: "saldo-anterior" },
            { label: "Facturación", value: data?.facturacion ?? 0, key: "facturacion" },
            { label: "Pagos", value: data?.cobranza ?? 0, key: "cobranza", green: true },
            { label: "Saldo Actual", value: data?.saldo ?? 0, key: "saldo", big: true },
          ].map((item) => (
            <Card key={item.key} className={item.big ? "border-2 border-primary/30" : ""}>
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
                        : "text-foreground"
                    }`}
                  >
                    ${fmtInt(item.value ?? 0)}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Purchases in period */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Compras del Período ({data?.purchases.length ?? 0})
              {!isLoading && (data?.purchases ?? []).some((p) => p.isPaid) && (
                <Badge className="text-[9px] bg-green-100 text-green-700 border-green-200 ml-1">
                  {(data?.purchases ?? []).filter((p) => p.isPaid).length} pagada{(data?.purchases ?? []).filter((p) => p.isPaid).length > 1 ? "s" : ""}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : (data?.purchases.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground p-4 text-center">Sin compras en este período</p>
            ) : (
              <>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Folio</th>
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Fecha</th>
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Método</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Total</th>
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.purchases.map((p) => (
                      <tr
                        key={p.id}
                        className={`border-b border-border last:border-0 transition-colors ${
                          p.isPaid ? "bg-green-50/50 dark:bg-green-950/20" : "hover:bg-muted/20"
                        }`}
                      >
                        <td
                          className="py-2 px-3 font-mono font-medium text-primary cursor-pointer hover:underline"
                          onClick={() => setLocation(`/purchases/${p.id}`)}
                        >
                          {p.folio}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">{fmtDate(p.purchaseDate)}</td>
                        <td className="py-2 px-3 text-muted-foreground capitalize">
                          {p.paymentMethod.replace(/_/g, " ")}
                        </td>
                        <td className={`py-2 px-3 text-right font-semibold ${p.isPaid ? "text-muted-foreground line-through" : "text-foreground"}`}>
                          ${fmtInt(p.total)}
                        </td>
                        <td className="py-2 px-3">
                          {p.isPaid ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded-full">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              Pagada
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">Pendiente</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pendingPurchasesTotal > 0 && (
                  <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/20 text-xs">
                    <span className="text-muted-foreground font-medium">
                      {(data?.purchases ?? []).filter((p) => !p.isPaid).length} pendiente{(data?.purchases ?? []).filter((p) => !p.isPaid).length > 1 ? "s" : ""}
                    </span>
                    <span className="font-bold text-destructive">${fmtInt(pendingPurchasesTotal)}</span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Payments */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span>Pagos registrados ({data?.payments.length ?? 0})</span>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowPaymentModal(true)}>
                <Plus className="h-3 w-3 mr-1" /> Agregar
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(data?.payments.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground p-3 text-center">Sin pagos registrados</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    <th className="text-left py-1.5 px-3 font-semibold text-muted-foreground">Fecha</th>
                    <th className="text-left py-1.5 px-3 font-semibold text-muted-foreground">Método / Notas</th>
                    <th className="text-right py-1.5 px-3 font-semibold text-muted-foreground">Monto</th>
                    <th className="w-7"></th>
                  </tr>
                </thead>
                <tbody>
                  {data?.payments.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="py-1.5 px-3 text-muted-foreground">{p.date}</td>
                      <td className="py-1.5 px-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          <Badge variant="outline" className="text-[9px] py-0">{p.method}</Badge>
                          {p.notes && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{p.notes}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 px-3 text-right font-semibold text-green-600">${fmtInt(p.amount)}</td>
                      <td className="py-1.5 px-3">
                        <button
                          onClick={() => deletePaymentMutation.mutate(p.id)}
                          disabled={deletePaymentMutation.isPending}
                          className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
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

      <PaymentModal
        supplierId={supplierId}
        open={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        pendingPurchases={pendingPurchases}
      />
    </Layout>
  );
}
