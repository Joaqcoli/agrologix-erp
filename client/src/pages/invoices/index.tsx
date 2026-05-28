import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Download, Receipt, Search, RotateCcw } from "lucide-react";
import { generateInvoicePDF, generateRemitoPDF } from "@/lib/pdf";
import { apiRequest } from "@/lib/queryClient";
import type { Customer } from "@shared/schema";

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

type InvoiceRow = {
  id: number;
  orderId: number;
  customerId: number;
  invoiceType: string;
  invoiceNumber: string;
  cae: string;
  caeExpiry: string;
  total: string;
  ivaAmount: string;
  description: string | null;
  createdAt: string;
  customerName: string;
  customerPhone: string | null;
  orderRemitoNum: string | null;
  creditNoteId: number | null;
  creditNoteNumber: string | null;
  creditNoteCae: string | null;
  creditNoteCaeExpiry: string | null;
  creditNoteCreatedAt: string | null;
};

const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
const fmtMoney = (v: string | number) =>
  `$${parseFloat(String(v)).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function InvoicesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [customerFilter, setCustomerFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Nota de crédito dialog
  const [ncRow, setNcRow] = useState<InvoiceRow | null>(null);
  const [ncLoading, setNcLoading] = useState(false);

  // WhatsApp dialog
  const [waRow, setWaRow] = useState<InvoiceRow | null>(null);
  const [waOption, setWaOption] = useState<"remito" | "factura" | "ambos">("factura");
  const [waMessage, setWaMessage] = useState("");
  const [waSending, setWaSending] = useState(false);

  const queryParams = new URLSearchParams();
  if (customerFilter !== "all") queryParams.set("customerId", customerFilter);
  if (from) queryParams.set("from", from);
  if (to) queryParams.set("to", to);
  const qs = queryParams.toString();

  const { data: invoices, isLoading } = useQuery<InvoiceRow[]>({
    queryKey: [`/api/invoices${qs ? `?${qs}` : ""}`],
  });

  const { data: customers } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });

  const filtered = (invoices ?? []).filter((inv) =>
    !search ||
    inv.customerName.toLowerCase().includes(search.toLowerCase()) ||
    (inv.invoiceNumber ?? "").toLowerCase().includes(search.toLowerCase()) ||
    inv.cae.includes(search)
  );

  const handleDownloadPDF = async (inv: InvoiceRow) => {
    try {
      const detail = await fetch(`/api/invoices/${inv.id}`).then((r) => r.json());
      await generateInvoicePDF(detail, "agrupado");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleDownloadNcPDF = async (inv: InvoiceRow) => {
    try {
      const detail = await fetch(`/api/invoices/${inv.id}`).then((r) => r.json());
      const ncDetail = {
        ...detail,
        invoice: {
          ...detail.invoice,
          invoiceNumber: inv.creditNoteNumber,
          cae: inv.creditNoteCae,
          caeExpiry: inv.creditNoteCaeExpiry,
          createdAt: inv.creditNoteCreatedAt ?? detail.invoice.createdAt,
        },
      };
      await generateInvoicePDF(ncDetail, "agrupado", { isNotaCredito: true });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleCreateNC = async () => {
    if (!ncRow) return;
    setNcLoading(true);
    try {
      const cn = await apiRequest("POST", `/api/invoices/${ncRow.id}/credit-note`, {}).then((r) => r.json());
      toast({ title: `Nota de Crédito ${cn.creditNoteNumber} emitida correctamente` });
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0] as string;
          return typeof k === "string" && (k.startsWith("/api/invoices") || k.startsWith("/api/orders") || k.startsWith("/api/ar/"));
        },
      });
      setNcRow(null);
    } catch (e: any) {
      toast({ title: "Error al emitir NC", description: e.message, variant: "destructive" });
    } finally {
      setNcLoading(false);
    }
  };

  const handleWaSend = async () => {
    if (!waRow) return;
    const rawPhone = waRow.customerPhone ?? "";
    const waPhone = fmtWaPhone(rawPhone);
    if (!waPhone) { toast({ title: "Número de teléfono inválido", variant: "destructive" }); return; }
    setWaSending(true);
    try {
      if (waOption === "remito" || waOption === "ambos") {
        const order = await fetch(`/api/orders/${waRow.orderId}`, { credentials: "include" }).then((r) => r.json());
        const remitoItems = order.items.map((item: any) => ({
          product: item.product ? { name: item.product.name, sku: item.product.sku ?? "" } : null,
          quantity: String(item.quantity),
          unit: String(item.unit),
          pricePerUnit: String(item.pricePerUnit ?? "0"),
          subtotal: String(item.subtotal),
          bolsaType: item.bolsaType ?? null,
          isBonification: item.isBonification ?? false,
        }));
        const remito = {
          folio: order.remitoNum != null ? String(order.remitoNum) : order.folio,
          issuedAt: order.orderDate,
          order: {
            folio: order.folio,
            orderDate: order.orderDate,
            notes: order.notes,
            customer: {
              name: order.customer.name,
              hasIva: order.customer.hasIva,
              rfc: order.customer.rfc ?? null,
              address: order.customer.address ?? null,
              city: order.customer.city ?? null,
              phone: order.customer.phone ?? null,
            },
            items: remitoItems,
            total: String(order.total),
          },
        };
        await generateRemitoPDF(remito, { hidePrecios: false });
      }
      if (waOption === "factura" || waOption === "ambos") {
        const detail = await fetch(`/api/invoices/${waRow.id}`, { credentials: "include" }).then((r) => r.json());
        await generateInvoicePDF(detail, "agrupado");
      }
      window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(waMessage)}`, "_blank");
      setWaRow(null);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setWaSending(false);
    }
  };

  const typeBadge = (t: string) => {
    const colors: Record<string, string> = { A: "bg-blue-100 text-blue-700", B: "bg-green-100 text-green-700", C: "bg-orange-100 text-orange-700" };
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${colors[t] ?? "bg-gray-100"}`}>
        Factura {t}
      </span>
    );
  };

  return (
    <Layout title="Facturas">
      <div className="p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Facturas Electrónicas</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{filtered.length} factura{filtered.length !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por cliente, número o CAE..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={customerFilter} onValueChange={setCustomerFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Todos los clientes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los clientes</SelectItem>
              {(customers ?? []).filter((c) => c.active).map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[140px]" placeholder="Desde" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[140px]" placeholder="Hasta" />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Receipt className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Sin facturas</p>
              <p className="text-sm text-muted-foreground text-center">Las facturas emitidas desde pedidos aprobados aparecerán aquí.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Número</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3">CAE</th>
                  <th className="px-4 py-3">Remito</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv, i) => (
                  <tr key={inv.id} className={`border-b border-border hover:bg-muted/30 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(inv.createdAt)}</td>
                    <td className="px-4 py-3 font-medium">{inv.customerName}</td>
                    <td className="px-4 py-3">{typeBadge(inv.invoiceType)}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <div>{inv.invoiceNumber}</div>
                      {inv.creditNoteNumber && (
                        <div className="text-orange-500 text-[10px]">{inv.creditNoteNumber}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{fmtMoney(inv.total)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{inv.cae}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{inv.orderRemitoNum ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => handleDownloadPDF(inv)}>
                          <Download className="h-3.5 w-3.5 mr-1" /> PDF
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 px-2 text-green-600 hover:text-green-700 hover:bg-green-50"
                          onClick={() => {
                            setWaOption("factura");
                            setWaMessage(`Hola, te adjunto la factura correspondiente al pedido. Gracias!`);
                            setWaRow(inv);
                          }}
                        >
                          <WhatsAppIcon className="h-3.5 w-3.5" />
                        </Button>
                        {inv.creditNoteId ? (
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 px-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                            title={`Descargar NC: ${inv.creditNoteNumber}`}
                            onClick={() => handleDownloadNcPDF(inv)}
                          >
                            <Download className="h-3.5 w-3.5 mr-1" /> NC
                          </Button>
                        ) : (
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                            title="Emitir Nota de Crédito"
                            onClick={() => setNcRow(inv)}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1" /> NC
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Nota de Crédito confirm dialog */}
      <Dialog open={!!ncRow} onOpenChange={(o) => { if (!o) setNcRow(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-red-500" /> Emitir Nota de Crédito
            </DialogTitle>
            <DialogDescription>
              Se emitirá una Nota de Crédito {ncRow?.invoiceType} ante AFIP por el total de la factura {ncRow?.invoiceNumber}.
              Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-1 text-sm">
            <p><span className="font-medium">Cliente:</span> {ncRow?.customerName}</p>
            <p><span className="font-medium">Factura:</span> {ncRow?.invoiceNumber}</p>
            <p><span className="font-medium">Total a acreditar:</span> {ncRow ? fmtMoney(ncRow.total) : ""}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNcRow(null)} disabled={ncLoading}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={ncLoading}
              onClick={handleCreateNC}
            >
              {ncLoading ? "Emitiendo..." : "Confirmar y emitir NC"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WhatsApp dialog */}
      <Dialog open={!!waRow} onOpenChange={(o) => { if (!o) setWaRow(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <WhatsAppIcon className="h-5 w-5 text-green-500" /> Enviar por WhatsApp
            </DialogTitle>
            <DialogDescription>
              Los PDFs se descargarán automáticamente. Adjuntalos en WhatsApp manualmente.
            </DialogDescription>
          </DialogHeader>
          {!waRow?.customerPhone ? (
            <Alert>
              <AlertDescription>El cliente no tiene número de teléfono registrado. Editalo desde la sección Clientes.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4 py-1">
              <div className="space-y-2">
                <p className="text-sm font-medium">¿Qué enviar?</p>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="waOptInv" value="factura" checked={waOption === "factura"} onChange={() => setWaOption("factura")} />
                    Solo Factura
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="waOptInv" value="remito" checked={waOption === "remito"} onChange={() => setWaOption("remito")} />
                    Solo Remito
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="waOptInv" value="ambos" checked={waOption === "ambos"} onChange={() => setWaOption("ambos")} />
                    Remito y Factura
                  </label>
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Mensaje</p>
                <Textarea value={waMessage} onChange={(e) => setWaMessage(e.target.value)} rows={3} />
              </div>
              <p className="text-xs text-muted-foreground">Teléfono: {waRow?.customerPhone}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaRow(null)}>Cancelar</Button>
            {waRow?.customerPhone && (
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                disabled={waSending}
                onClick={handleWaSend}
              >
                <WhatsAppIcon className="mr-2 h-4 w-4" />
                {waSending ? "Generando PDFs..." : "Descargar y abrir WhatsApp"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
