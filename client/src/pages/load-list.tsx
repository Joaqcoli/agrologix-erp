import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, Printer, ClipboardList } from "lucide-react";

type LoadListItem = {
  productId: number;
  productName: string;
  sku: string;
  unit: string;
  totalQuantity: number;
  orderCount: number;
};

export default function LoadListPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);

  const { data: items, isLoading, refetch } = useQuery<LoadListItem[]>({
    queryKey: ["/api/load-list", date],
    queryFn: async () => {
      const res = await fetch(`/api/load-list?date=${date}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error fetching load list");
      return res.json();
    },
    enabled: !!date,
  });

  const totalWeight = (items ?? []).reduce((sum, i) => sum + i.totalQuantity, 0);

  const handlePrint = () => window.print();

  return (
    <Layout title="Lista de Carga">
      <div className="p-6 max-w-3xl mx-auto space-y-5 print:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Lista de Carga</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Consolidado de pedidos aprobados por fecha
            </p>
          </div>
          <Button variant="outline" onClick={handlePrint} data-testid="button-print">
            <Printer className="mr-2 h-4 w-4" /> Imprimir
          </Button>
        </div>

        <div className="flex items-end gap-3 print:hidden">
          <div className="space-y-1.5">
            <Label htmlFor="date-filter">Fecha</Label>
            <Input
              id="date-filter"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
              data-testid="input-load-list-date"
            />
          </div>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            Buscar
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full rounded-md" />)}
          </div>
        ) : !items || items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <ClipboardList className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Sin pedidos aprobados</p>
              <p className="text-sm text-muted-foreground text-center">
                No hay pedidos aprobados para el {new Date(date).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })}.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Lista de Carga — {new Date(date).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })}
                </CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {items.length} productos
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">#</th>
                      <th className="text-left py-2 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Producto</th>
                      <th className="text-left py-2 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">SKU</th>
                      <th className="text-right py-2 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cantidad</th>
                      <th className="text-left py-2 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unidad</th>
                      <th className="text-right py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pedidos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={item.productId} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`load-item-${item.productId}`}>
                        <td className="py-3 pr-3 text-muted-foreground text-xs">{idx + 1}</td>
                        <td className="py-3 pr-3 font-medium text-foreground">{item.productName}</td>
                        <td className="py-3 pr-3 text-muted-foreground text-xs">{item.sku}</td>
                        <td className="py-3 pr-3 text-right font-bold text-foreground">
                          {item.totalQuantity.toLocaleString("es-MX", { maximumFractionDigits: 4 })}
                        </td>
                        <td className="py-3 pr-3 text-muted-foreground text-xs">{item.unit}</td>
                        <td className="py-3 text-right">
                          <Badge variant="secondary" className="text-[10px]">{item.orderCount} ped.</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border">
                      <td colSpan={3} className="py-3 text-sm font-semibold text-foreground">Total</td>
                      <td className="py-3 text-right font-bold text-lg text-foreground">
                        {totalWeight.toLocaleString("es-MX", { maximumFractionDigits: 2 })}
                      </td>
                      <td colSpan={2} className="py-3 text-xs text-muted-foreground pl-2">unidades</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
