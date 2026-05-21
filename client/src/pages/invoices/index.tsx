import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Download, Receipt, Search } from "lucide-react";
import { generateInvoicePDF } from "@/lib/pdf";
import type { Customer } from "@shared/schema";

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
  orderRemitoNum: string | null;
};

const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
const fmtMoney = (v: string | number) =>
  `$${parseFloat(String(v)).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function InvoicesPage() {
  const { toast } = useToast();
  const [customerFilter, setCustomerFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

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
      await generateInvoicePDF(detail);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
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
                    <td className="px-4 py-3 font-mono text-xs">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 text-right font-medium">{fmtMoney(inv.total)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{inv.cae}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{inv.orderRemitoNum ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => handleDownloadPDF(inv)}>
                        <Download className="h-3.5 w-3.5 mr-1" /> PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
