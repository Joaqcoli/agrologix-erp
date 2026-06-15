import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { GalponLayout } from "./layout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { generateArmadoPDF } from "@/lib/pdf";
import { Printer, ChevronRight, CheckCircle2, FileText } from "lucide-react";

// Sin precios: esta vista nunca muestra ni recibe total/costo/margen.
type GalponOrderRow = {
  id: number; folio: string; customerName: string; createdByName: string | null;
  orderDate: string; status: "draft" | "approved" | "cancelled"; itemCount: number; galponConfirmed: boolean;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  draft:     { label: "Borrador", cls: "bg-muted text-muted-foreground" },
  approved:  { label: "Aprobado", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  cancelled: { label: "Cancelado", cls: "bg-red-100 text-red-700" },
};

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

export default function GalponOrders() {
  const [date, setDate] = useState(todayStr);
  const [, setLocation] = useLocation();
  const [printing, setPrinting] = useState(false);

  const { data: orders = [], isLoading } = useQuery<GalponOrderRow[]>({
    queryKey: ["/api/galpon/orders", date],
    queryFn: () => fetch(`/api/galpon/orders?date=${date}`, { credentials: "include" }).then((r) => r.json()),
  });

  const dateLabel = (() => { const [y,m,d] = date.split("-"); return `${d}/${m}/${y}`; })();

  const handlePrintAll = async () => {
    if (orders.length === 0) return;
    setPrinting(true);
    try {
      const details = await Promise.all(
        orders.map((o) => fetch(`/api/galpon/orders/${o.id}`, { credentials: "include" }).then((r) => r.json()))
      );
      generateArmadoPDF(
        details.map((d: any) => ({ folio: d.folio, customerName: d.customerName, createdByName: d.createdByName, items: d.items })),
        dateLabel,
      );
    } finally { setPrinting(false); }
  };

  return (
    <GalponLayout title="Pedidos">
      <div className="p-6 space-y-4 max-w-4xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{orders.length} pedido{orders.length !== 1 ? "s" : ""} — {dateLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
            <Button variant="outline" onClick={handlePrintAll} disabled={printing || orders.length === 0}>
              <Printer className="h-4 w-4 mr-2" /> {printing ? "Generando..." : "Imprimir pedidos"}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
        ) : orders.length === 0 ? (
          <Card><CardContent className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <FileText className="h-8 w-8" /><p className="text-sm">No hay pedidos para esta fecha.</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => {
              const st = STATUS[o.status] ?? STATUS.draft;
              const hora = new Date(o.orderDate).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
              return (
                <Card key={o.id} className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setLocation(`/galpon/orders/${o.id}`)}>
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground truncate">{o.customerName}</span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                        {o.galponConfirmed && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Confirmado
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {o.folio} · {hora} · {o.itemCount} ítem{o.itemCount !== 1 ? "s" : ""}
                        {o.createdByName ? ` · ${o.createdByName}` : ""}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </GalponLayout>
  );
}
