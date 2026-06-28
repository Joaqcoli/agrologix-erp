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
import { ArrowLeft, Plus, Trash2, FileText, Download, CheckCircle2, Wallet } from "lucide-react";
import React, { useState } from "react";
import { jsPDF } from "jspdf";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const PAYMENT_METHODS = ["EFECTIVO", "TRANSFERENCIA", "CHEQUE", "VALE", "CUENTA_CORRIENTE", "OTRO"] as const;

const fmtInt = (v: number) => Math.round(v).toLocaleString("es-AR");
const todayStr = () => new Date().toISOString().split("T")[0];

type PurchaseRow = {
  id: number;
  folio: string;
  purchaseDate: string;
  total: number;
  paymentMethod: string;
  isPaid: boolean;
  status?: "pagada" | "parcial" | "pendiente";
  paidAmount?: number;
  totalEmptyCost: number;
};

type EmptiesDetail = {
  empties: { purchaseId: number; folio: string; purchaseDate: string; productName: string; qty: number; emptyCostPerUnit: number; total: number }[];
  vales: { id: number; date: string; amount: number; notes?: string | null }[];
  totalEmptyQty: number;
  totalEmptyAmount: number;
  totalValesQty: number;
  totalValesAmount: number;
  avgEmptyCost: number;
  saldoVacios: number;
};

type PaymentRow = {
  id: number;
  supplierId: number;
  date: string;
  amount: number;
  method: string;
  notes?: string | null;
  purchaseId?: number | null;
  chequeFechaCobro?: string;   // solo en pagos con método CHEQUE (emitido propio)
  chequePlazoDias?: number;    // fecha_cobro − fecha de emisión
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
  plazoPromedioChequesDias?: number | null;
  cheques?: ChequeRow[];
  purchases: PurchaseRow[];
  payments: PaymentRow[];
};

type ChequeRow = {
  id: number;
  numero: string | null;
  fechaEmision: string; // YYYY-MM-DD
  fechaCobro: string;   // YYYY-MM-DD
  monto: number;
  plazoDias: number;
  estado: string;       // en_cartera | depositado | endosado | cobrado
};

type PendingPurchase = { id: number; folio: string; total: string; purchaseDate: string; paidAmount?: string; status?: string };

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
    // Tomar solo la parte de fecha (YYYY-MM-DD) y construirla en LOCAL para evitar
    // el corrimiento de un día por interpretación UTC.
    const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
    return new Date(y, (m || 1) - 1, day || 1).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
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
  const [cuentaId, setCuentaId] = useState<number | null>(null);
  const [chequeSubtipo, setChequeSubtipo] = useState<"cartera" | "propio">("cartera");
  const [chequeFechaCobro, setChequeFechaCobro] = useState("");
  const [chequeNumero, setChequeNumero] = useState("");
  const [chequeCarteraId, setChequeCarteraId] = useState<number | null>(null);

  const { data: cuentas } = useQuery<any[]>({
    queryKey: ["/api/caja/cuentas"],
    queryFn: () => fetch("/api/caja/cuentas", { credentials: "include" }).then((r) => r.json()),
  });

  const { data: todosCheques } = useQuery<any[]>({
    queryKey: ["/api/caja/cheques"],
    queryFn: () => fetch("/api/caja/cheques", { credentials: "include" }).then((r) => r.json()),
    enabled: method === "CHEQUE",
  });
  const chequesCartera = (todosCheques ?? []).filter((c: any) => c.tipo === "recibido" && c.estado === "en_cartera");

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
        cuentaId,
        chequeInfo: method === "CHEQUE" ? {
          tipo: chequeSubtipo,
          chequeCarteraId: chequeSubtipo === "cartera" ? chequeCarteraId : undefined,
          fechaCobro: chequeSubtipo === "propio" ? chequeFechaCobro : undefined,
          numero: chequeSubtipo === "propio" ? (chequeNumero.trim() || undefined) : undefined,
        } : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ap/cc"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ap/cc/supplier", supplierId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ap/cc/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ap/pending-purchases", supplierId] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/cuentas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/cheques"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caja/obligaciones"] });
      toast({ title: "Pago registrado" });
      setAmount(""); setNotes(""); setMethod("EFECTIVO"); setSelectedPurchaseIds([]); setCuentaId(null);
      setChequeSubtipo("cartera"); setChequeFechaCobro(""); setChequeNumero(""); setChequeCarteraId(null);
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
            <Select
              value={method}
              onValueChange={(v) => {
                setMethod(v);
                if (v === "EFECTIVO") {
                  const ef = cuentas?.find((c: any) => c.tipo === "efectivo");
                  setCuentaId(ef?.id ?? null);
                } else if (v !== "TRANSFERENCIA") {
                  setCuentaId(null);
                }
              }}
            >
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

          {(method === "EFECTIVO" || method === "TRANSFERENCIA") && cuentas && (
            <div>
              <Label className="text-xs">Cuenta a descontar</Label>
              <Select
                value={cuentaId ? String(cuentaId) : ""}
                onValueChange={(v) => setCuentaId(v ? Number(v) : null)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Sin ajuste de cuenta" />
                </SelectTrigger>
                <SelectContent>
                  {cuentas
                    .filter((c: any) => method === "EFECTIVO" ? c.tipo === "efectivo" : c.tipo !== "efectivo" && c.tipo !== "cheque")
                    .map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Cheque: subtipo cartera / propio */}
          {method === "CHEQUE" && (
            <div className="space-y-2">
              <div>
                <Label className="text-xs">Tipo de cheque</Label>
                <Select value={chequeSubtipo} onValueChange={(v) => { setChequeSubtipo(v as "cartera" | "propio"); setChequeCarteraId(null); setChequeFechaCobro(""); setChequeNumero(""); }}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cartera">De cartera (cheque recibido de cliente)</SelectItem>
                    <SelectItem value="propio">Propio (cheque del banco)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {chequeSubtipo === "cartera" && (
                <div>
                  <Label className="text-xs">Cheque a endosar <span className="text-red-500">*</span></Label>
                  {chequesCartera.length === 0 ? (
                    <p className="text-xs text-muted-foreground mt-1 py-2 border rounded-md text-center">Sin cheques en cartera</p>
                  ) : (
                    <Select value={chequeCarteraId ? String(chequeCarteraId) : ""} onValueChange={v => setChequeCarteraId(v ? Number(v) : null)}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Seleccionar cheque" /></SelectTrigger>
                      <SelectContent>
                        {chequesCartera.map((ch: any) => (
                          <SelectItem key={ch.id} value={String(ch.id)}>
                            {ch.contraparte} — ${Math.round(ch.monto).toLocaleString("es-AR")} — vence {ch.fecha_cobro.slice(5).replace("-","/")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
              {chequeSubtipo === "propio" && (
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Número de cheque <span className="text-red-500">*</span></Label>
                    <Input className="mt-1" inputMode="numeric" value={chequeNumero}
                      onChange={e => setChequeNumero(e.target.value)} placeholder="Ej. 122 (del talonario)" />
                    <p className="text-[10px] text-muted-foreground mt-1">Lo leés del talonario. Sirve para cruzarlo automáticamente con el extracto de Galicia cuando se debite.</p>
                  </div>
                  <div>
                    <Label className="text-xs">Fecha de cobro del cheque <span className="text-red-500">*</span></Label>
                    <Input type="date" className="mt-1" value={chequeFechaCobro} onChange={e => setChequeFechaCobro(e.target.value)} />
                    <p className="text-[10px] text-muted-foreground mt-1">Se crea una obligación en "Próximos vencimientos". Galicia se debita cuando la marcás pagada.</p>
                  </div>
                </div>
              )}
            </div>
          )}

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
            disabled={
              mutation.isPending || !amount || parseFloat(amount) <= 0 ||
              (method === "CHEQUE" && chequeSubtipo === "propio" && (!chequeNumero.trim() || !chequeFechaCobro)) ||
              (method === "CHEQUE" && chequeSubtipo === "cartera" && !chequeCarteraId)
            }
          >
            {mutation.isPending ? "Guardando..." : "Guardar Pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Detail Page ───────────────────────────────────────────────────────────
// Re-imputar un pago EXISTENTE a compras elegidas a mano (reasignar lo que el FIFO auto-imputó).
function ReimputeDialog({ payment, supplierName, onClose }: { payment: PaymentRow; supplierName: string; onClose: () => void }) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Compras pendientes IGNORANDO este pago (las muestra como si no estuviera aplicado)
  const { data: pending = [], isLoading } = useQuery<PendingPurchase[]>({
    queryKey: ["/api/ap/pending-purchases", payment.supplierId, "exclude", payment.id],
    queryFn: () => fetch(`/api/ap/pending-purchases/${payment.supplierId}?excludePaymentId=${payment.id}`, { credentials: "include" }).then((r) => r.json()),
  });

  const mut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/ap/payments/${payment.id}/impute`, { purchaseIds: [...selected] }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ap/cc/supplier"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ap/pending-purchases"] });
      toast({ title: "Pago imputado", description: `${selected.size} compra(s) actualizadas.` });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const dateFrom = `${payment.date.slice(0, 7)}-01`; // corte por el mes del pago
  const sortByDate = (a: PendingPurchase, b: PendingPurchase) => (a.purchaseDate < b.purchaseDate ? -1 : 1);
  const periodo = pending.filter((p) => p.purchaseDate.slice(0, 10) >= dateFrom).sort(sortByDate);
  const anteriores = pending.filter((p) => p.purchaseDate.slice(0, 10) < dateFrom).sort(sortByDate);
  const toggle = (id: number) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedPending = pending.filter((p) => selected.has(p.id)).reduce((s, p) => s + Math.max(0, parseFloat(p.total) - parseFloat(p.paidAmount ?? "0")), 0);

  const Row = (p: PendingPurchase) => {
    const pend = Math.max(0, parseFloat(p.total) - parseFloat(p.paidAmount ?? "0"));
    const parcial = parseFloat(p.paidAmount ?? "0") > 0;
    const checked = selected.has(p.id);
    return (
      <div key={p.id} onClick={() => toggle(p.id)}
        className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${checked ? "border-green-400 bg-green-50 dark:bg-green-950/20" : "border-input hover:bg-muted/40"}`}>
        <Checkbox checked={checked} className="pointer-events-none" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium font-mono">{p.folio}</span>
          <p className="text-xs text-muted-foreground">{p.purchaseDate.slice(0, 10)}{parcial && <span className="text-amber-600"> · parcial, pagado ${fmtInt(parseFloat(p.paidAmount ?? "0"))}</span>}</p>
        </div>
        <p className={`text-sm font-semibold flex-shrink-0 ${checked ? "text-green-700" : "text-orange-700"}`}>${fmtInt(pend)}</p>
      </div>
    );
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Imputar pago — {supplierName}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="bg-muted/50 rounded-lg px-3 py-2 text-xs flex items-center justify-between">
            <span className="text-muted-foreground">Pago {payment.date} · {payment.method}{payment.notes ? ` · ${payment.notes}` : ""}</span>
            <span className="font-semibold text-green-700">${fmtInt(payment.amount)}</span>
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-3 text-center">Cargando compras…</p>
          ) : pending.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center">No hay compras pendientes para imputar.</p>
          ) : (
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {periodo.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">Compras del período</p>
                  {periodo.map(Row)}
                </div>
              )}
              {anteriores.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-amber-600">Pendientes de períodos anteriores</p>
                  {anteriores.map(Row)}
                </div>
              )}
            </div>
          )}
          {selected.size > 0 && (
            <div className="border-t pt-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{selected.size} compra{selected.size > 1 ? "s" : ""} · pendiente ${fmtInt(selectedPending)}</span>
              <span className={selectedPending > payment.amount + 0.01 ? "text-amber-600" : "text-muted-foreground"}>
                {selectedPending > payment.amount + 0.01 ? "el pago no cubre todo → última queda parcial" : "el pago las cubre"}
              </span>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">Reasigna a qué compras va este pago (reparte por fecha, parcial la última). No cambia el saldo. Sin selección → vuelve a FIFO automático.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>{mut.isPending ? "Imputando…" : "Imputar a compras elegidas"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  const [reimputePayment, setReimputePayment] = useState<PaymentRow | null>(null);
  const [activeTab, setActiveTab] = useState<"cc" | "vacios">("cc");
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

  const { data: emptiesData } = useQuery<EmptiesDetail>({
    queryKey: ["/api/ap/empties", supplierId],
    queryFn: async () => {
      const res = await fetch(`/api/ap/empties/${supplierId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 60_000,
    enabled: activeTab === "vacios",
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
    const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
    return new Date(y, (m || 1) - 1, day || 1).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
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
    .reduce((s, p) => s + (p.total - (p.paidAmount ?? 0)), 0); // descuenta lo ya pagado en parciales

  const todayISO = new Date().toISOString().slice(0, 10);
  const chequeEstado = (c: ChequeRow): { label: string; vencido: boolean } => {
    if (c.estado === "cobrado") return { label: "Cobrado", vencido: false };
    if ((c.estado === "en_cartera" || c.estado === "endosado") && c.fechaCobro < todayISO) {
      return { label: "Vencido", vencido: true };
    }
    const labels: Record<string, string> = { en_cartera: "En cartera", depositado: "Depositado", endosado: "Endosado" };
    return { label: labels[c.estado] ?? c.estado, vencido: false };
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

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "cc" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab("cc")}
          >
            Cuenta Corriente
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "vacios" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab("vacios")}
          >
            Vacíos vs Vales
          </button>
        </div>

        {activeTab === "cc" && <>
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
                <div className="overflow-x-auto">
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
                      <React.Fragment key={p.id}>
                        <tr
                          className={`border-b ${p.totalEmptyCost > 0 ? "" : "border-border"} transition-colors ${
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
                            ) : p.status === "parcial" ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                Parcial · pagado ${fmtInt(p.paidAmount ?? 0)} / queda ${fmtInt(p.total - (p.paidAmount ?? 0))}
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">Pendiente</span>
                            )}
                          </td>
                        </tr>
                        {p.totalEmptyCost > 0 && (
                          <tr className="border-b border-border bg-amber-50/30 dark:bg-amber-950/10">
                            <td colSpan={5} className="py-1 px-3 pl-8 text-xs text-amber-600 dark:text-amber-400">
                              └─ Vacíos: ${fmtInt(p.totalEmptyCost)}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                </div>
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
              <div className="overflow-x-auto">
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
                          {p.method === "CHEQUE" && p.chequeFechaCobro && (
                            <span className="inline-flex items-center gap-1 text-[9px] py-0 px-1.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
                              Cobro {fmtDate(p.chequeFechaCobro)}
                              {p.chequePlazoDias != null && ` · ${p.chequePlazoDias} días`}
                            </span>
                          )}
                          {p.notes && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{p.notes}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 px-3 text-right font-semibold text-green-600">${fmtInt(p.amount)}</td>
                      <td className="py-1.5 px-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => setReimputePayment(p)}
                            title="Elegir a qué compras imputar este pago"
                            className="p-0.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                          >
                            <Wallet className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => deletePaymentMutation.mutate(p.id)}
                            disabled={deletePaymentMutation.isPending}
                            className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Indicador: plazo promedio de cheques emitidos a este proveedor */}
        {!isLoading && data?.plazoPromedioChequesDias != null && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" />
            Plazo promedio cheques: <span className="font-semibold text-foreground">{data.plazoPromedioChequesDias} días</span>
          </div>
        )}

        {/* Cheques emitidos (solo lectura — no afecta saldos) */}
        {!isLoading && (data?.cheques?.length ?? 0) > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                Cheques emitidos ({data?.cheques?.length ?? 0})
                {(() => {
                  const venc = (data?.cheques ?? []).filter((c) => chequeEstado(c).vencido).length;
                  return venc > 0 ? (
                    <Badge className="text-[9px] bg-red-100 text-red-700 border-red-200 ml-1">
                      {venc} vencido{venc > 1 ? "s" : ""}
                    </Badge>
                  ) : null;
                })()}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Nº</th>
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Emisión</th>
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Cobro</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Monto</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Plazo</th>
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.cheques ?? []).map((c) => {
                      const est = chequeEstado(c);
                      return (
                        <tr key={c.id} className={`border-b border-border last:border-0 ${est.vencido ? "bg-red-50/60 dark:bg-red-950/20" : ""}`}>
                          <td className="py-1.5 px-3 font-medium text-foreground">{c.numero ?? "—"}</td>
                          <td className="py-1.5 px-3 text-muted-foreground">{fmtDate(c.fechaEmision)}</td>
                          <td className={`py-1.5 px-3 ${est.vencido ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{fmtDate(c.fechaCobro)}</td>
                          <td className="py-1.5 px-3 text-right font-semibold text-foreground">${fmtInt(c.monto)}</td>
                          <td className="py-1.5 px-3 text-right text-muted-foreground">{c.plazoDias} días</td>
                          <td className="py-1.5 px-3">
                            <span className={`inline-flex items-center text-[9px] py-0.5 px-1.5 rounded-full ${
                              est.vencido
                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                : c.estado === "cobrado"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  : "bg-muted text-muted-foreground"
                            }`}>
                              {est.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/20">
                      <td className="py-2 px-3 font-bold text-foreground" colSpan={3}>TOTAL ({data?.cheques?.length ?? 0})</td>
                      <td className="py-2 px-3 text-right font-bold text-foreground">
                        ${fmtInt((data?.cheques ?? []).reduce((s, c) => s + c.monto, 0))}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
        </> /* end activeTab === "cc" */}

        {activeTab === "vacios" && (
          <div className="space-y-4">
            {/* Resumen */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: "Vacíos entregados", value: emptiesData?.totalEmptyQty ?? 0, suffix: " u.", color: "text-amber-600" },
                { label: "Vales pagados", value: emptiesData?.totalValesQty ?? 0, suffix: " u.", color: "text-blue-600" },
                { label: "Saldo en tu poder", value: emptiesData?.saldoVacios ?? 0, suffix: " u.", color: "text-foreground", big: true },
              ].map((item) => (
                <Card key={item.label} className={item.big ? "border-2 border-primary/30" : ""}>
                  <CardContent className="p-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{item.label}</p>
                    <p className={`text-base font-bold mt-0.5 ${item.color}`}>
                      {(item.value).toLocaleString("es-AR", { maximumFractionDigits: 1 })}{item.suffix}
                    </p>
                    {item.label === "Vacíos entregados" && emptiesData && emptiesData.totalEmptyAmount > 0 && (
                      <p className="text-[10px] text-muted-foreground">${fmtInt(emptiesData.totalEmptyAmount)}</p>
                    )}
                    {item.label === "Vales pagados" && emptiesData && emptiesData.totalValesAmount > 0 && (
                      <p className="text-[10px] text-muted-foreground">${fmtInt(emptiesData.totalValesAmount)}</p>
                    )}
                    {item.label === "Saldo en tu poder" && emptiesData && emptiesData.avgEmptyCost > 0 && (
                      <p className="text-[10px] text-muted-foreground">Precio prom. ${fmtInt(emptiesData.avgEmptyCost)}/u.</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Detalle */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Detalle de movimientos</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {!emptiesData || (emptiesData.empties.length === 0 && emptiesData.vales.length === 0) ? (
                  <p className="text-sm text-muted-foreground p-4 text-center">Sin movimientos de vacíos registrados</p>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Fecha</th>
                        <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Tipo</th>
                        <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Descripción</th>
                        <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Cantidad</th>
                        <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...emptiesData.empties.map((e) => ({
                          date: e.purchaseDate,
                          tipo: "vacío" as const,
                          desc: `${e.folio} — ${e.productName}`,
                          qty: e.qty,
                          amount: e.total,
                        })),
                        ...emptiesData.vales.map((v) => ({
                          date: v.date,
                          tipo: "vale" as const,
                          desc: v.notes ?? `Pago #${v.id}`,
                          qty: emptiesData.avgEmptyCost > 0 ? v.amount / emptiesData.avgEmptyCost : null,
                          amount: v.amount,
                        })),
                      ]
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .map((row, i) => (
                          <tr key={i} className="border-b border-border last:border-0">
                            <td className="py-2 px-3 text-muted-foreground">{fmtDate(row.date)}</td>
                            <td className="py-2 px-3">
                              <Badge
                                variant="outline"
                                className={`text-[9px] py-0 ${row.tipo === "vacío" ? "text-amber-600 border-amber-200" : "text-blue-600 border-blue-200"}`}
                              >
                                {row.tipo === "vacío" ? "Vacío entregado" : "Vale pagado"}
                              </Badge>
                            </td>
                            <td className="py-2 px-3 text-muted-foreground truncate max-w-[160px]">{row.desc}</td>
                            <td className={`py-2 px-3 text-right font-medium ${row.tipo === "vacío" ? "text-amber-600" : "text-blue-600"}`}>
                              {row.tipo === "vacío" ? "+" : "-"}
                              {row.qty != null ? row.qty.toLocaleString("es-AR", { maximumFractionDigits: 1 }) : "—"} u.
                            </td>
                            <td className={`py-2 px-3 text-right font-semibold ${row.tipo === "vacío" ? "text-amber-600" : "text-blue-600"}`}>
                              {row.tipo === "vacío" ? "+" : "-"}${fmtInt(row.amount)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <PaymentModal
        supplierId={supplierId}
        open={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        pendingPurchases={pendingPurchases}
      />
      {reimputePayment && (
        <ReimputeDialog
          payment={reimputePayment}
          supplierName={data?.supplier.name ?? ""}
          onClose={() => setReimputePayment(null)}
        />
      )}
    </Layout>
  );
}
