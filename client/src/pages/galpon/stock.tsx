import { useState, useMemo, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { GalponLayout } from "./layout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Package, ChevronDown, Pencil, Check, X } from "lucide-react";

// REGLA DE ORO: esta vista NO muestra ningún costo/precio. El endpoint /api/galpon/stock
// tampoco los devuelve (seguridad real en backend, no solo ocultar acá).

type StockRow = {
  productId: number;
  productName: string;
  category: string | null;
  unit: string;
  stockQty: string;
  weightPerUnit: string | null;
};

type HistRow = {
  itemId: number;
  purchaseDate: string;
  supplierName: string;
  purchaseQty: string | null;
  purchaseUnit: string | null;
  weightPerPackage: string | null;
  quantity: string;
};

const CATEGORY_ORDER = ["Fruta", "Verdura", "Hortaliza Liviana", "Hortaliza Pesada", "Hongos/Hierbas", "Huevos"];

const fmtStock = (v: number) => v.toLocaleString("es-MX", { maximumFractionDigits: 2 });
const fmtDate = (d: string) => {
  const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, day || 1).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
};

export default function GalponStock() {
  const [search, setSearch] = useState("");
  const [expandedProductId, setExpandedProductId] = useState<number | null>(null);

  const { data: stock = [], isLoading } = useQuery<StockRow[]>({
    queryKey: ["/api/galpon/stock"],
    queryFn: () => fetch("/api/galpon/stock", { credentials: "include" }).then((r) => r.json()),
  });

  const { data: history = [], isLoading: histLoading } = useQuery<HistRow[]>({
    queryKey: ["/api/galpon/products", expandedProductId, "purchase-history"],
    queryFn: () => fetch(`/api/galpon/products/${expandedProductId}/purchase-history`, { credentials: "include" }).then((r) => r.json()),
    enabled: expandedProductId != null,
  });

  const { toast } = useToast();
  const [editItemId, setEditItemId] = useState<number | null>(null);
  const [editWeight, setEditWeight] = useState("");

  const weightMut = useMutation({
    mutationFn: ({ itemId, weight }: { itemId: number; weight: number }) =>
      apiRequest("PATCH", `/api/galpon/purchase-item/${itemId}`, { weightPerPackage: weight }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/galpon/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/galpon/products", expandedProductId, "purchase-history"] });
      setEditItemId(null);
      toast({ title: "Peso actualizado", description: "Se recalculó el stock y el costo." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = useMemo(
    () => stock.filter((r) => r.productName.toLowerCase().includes(search.toLowerCase())),
    [stock, search]
  );

  const { grouped, sortedCats } = useMemo(() => {
    const g: Record<string, StockRow[]> = {};
    for (const r of filtered) {
      const cat = r.category ?? "Sin categoría";
      (g[cat] ??= []).push(r);
    }
    const cats = Object.keys(g).sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    return { grouped: g, sortedCats: cats };
  }, [filtered]);

  return (
    <GalponLayout title="Stock">
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
              <Package className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Sin stock disponible.</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-border bg-muted/40">
                      <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wide text-xs">Producto</th>
                      <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wide text-xs">Unidad</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wide text-xs">Stock</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wide text-xs">KG/envase</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCats.map((cat) => (
                      <Fragment key={cat}>
                        <tr className="border-b border-border bg-muted/50">
                          <td colSpan={4} className="py-1.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                            {cat}
                          </td>
                        </tr>
                        {grouped[cat].map((pu) => {
                          const stockQty = parseFloat(pu.stockQty);
                          const wpu = parseFloat(pu.weightPerUnit ?? "0");
                          const isExpanded = expandedProductId === pu.productId;
                          return (
                            <Fragment key={`${pu.productId}-${pu.unit}`}>
                              <tr
                                className={`border-b border-border transition-colors cursor-pointer ${isExpanded ? "bg-muted/40" : "hover:bg-muted/30"}`}
                                onClick={() => setExpandedProductId(isExpanded ? null : pu.productId)}
                              >
                                <td className="py-2.5 px-4">
                                  <div className="flex items-center gap-2">
                                    <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-180" : ""}`} />
                                    <span className="font-medium text-foreground">{pu.productName}</span>
                                  </div>
                                </td>
                                <td className="py-2.5 px-4">
                                  <Badge variant="secondary" className="text-[10px]">{pu.unit}</Badge>
                                </td>
                                <td className="py-2.5 px-4 text-right font-semibold whitespace-nowrap text-foreground">
                                  {fmtStock(stockQty)}
                                  {wpu > 0 && stockQty > 0 && (
                                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                                      (~{(stockQty / wpu).toFixed(1)} cajones)
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-right text-muted-foreground whitespace-nowrap">
                                  {wpu > 0 ? `${fmtStock(wpu)} ${pu.unit}` : "—"}
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="border-b border-border">
                                  <td colSpan={4} className="p-0">
                                    <div className="px-8 py-4 bg-muted/10 border-t border-border/40">
                                      {histLoading ? (
                                        <Skeleton className="h-20 w-full" />
                                      ) : history.length === 0 ? (
                                        <p className="text-xs text-muted-foreground py-2">Sin compras registradas para este producto.</p>
                                      ) : (
                                        <div className="space-y-3">
                                          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Últimas compras</p>
                                          <div className="overflow-x-auto">
                                            <table className="w-full text-xs">
                                              <thead>
                                                <tr className="border-b border-border">
                                                  <th className="text-left pb-2 font-medium text-muted-foreground">Fecha</th>
                                                  <th className="text-left pb-2 font-medium text-muted-foreground">Proveedor</th>
                                                  <th className="text-right pb-2 font-medium text-muted-foreground">Cantidad</th>
                                                  <th className="text-right pb-2 font-medium text-muted-foreground">KG/envase</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {history.map((ph) => {
                                                  const wpp = parseFloat(ph.weightPerPackage ?? "0");
                                                  const pqty = ph.purchaseQty ? parseFloat(ph.purchaseQty) : null;
                                                  const qty = parseFloat(ph.quantity);
                                                  const isPackage = !!ph.purchaseUnit && pqty != null;
                                                  const isEditing = editItemId === ph.itemId;
                                                  return (
                                                    <tr key={ph.itemId} className="border-b border-border/50 last:border-0">
                                                      <td className="py-1.5 pr-4 text-muted-foreground whitespace-nowrap">{fmtDate(ph.purchaseDate)}</td>
                                                      <td className="py-1.5 pr-4 font-medium">{ph.supplierName}</td>
                                                      <td className="py-1.5 pr-4 text-right whitespace-nowrap">
                                                        {pqty != null && ph.purchaseUnit
                                                          ? `${pqty} ${ph.purchaseUnit.toLowerCase()}`
                                                          : `${fmtStock(qty)} ${pu.unit}`}
                                                      </td>
                                                      <td className="py-1.5 text-right whitespace-nowrap">
                                                        {isEditing ? (
                                                          <div className="flex items-center justify-end gap-1">
                                                            <Input
                                                              type="number" min="0.01" step="0.01" autoFocus
                                                              value={editWeight}
                                                              onChange={(e) => setEditWeight(e.target.value)}
                                                              className="h-7 w-20 text-xs text-right px-1.5"
                                                            />
                                                            <span className="text-muted-foreground">KG</span>
                                                            <Button size="icon" variant="ghost" className="h-7 w-7"
                                                              disabled={!(parseFloat(editWeight) > 0) || weightMut.isPending}
                                                              onClick={() => weightMut.mutate({ itemId: ph.itemId, weight: parseFloat(editWeight) })}>
                                                              <Check className="h-3.5 w-3.5 text-green-600" />
                                                            </Button>
                                                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditItemId(null)}>
                                                              <X className="h-3.5 w-3.5 text-muted-foreground" />
                                                            </Button>
                                                          </div>
                                                        ) : (
                                                          <div className="flex items-center justify-end gap-1.5">
                                                            <span className="text-muted-foreground">{wpp > 0 ? `${wpp} KG` : "—"}</span>
                                                            {isPackage && (
                                                              <Button size="icon" variant="ghost" className="h-6 w-6" title="Corregir kg por envase"
                                                                onClick={() => { setEditItemId(ph.itemId); setEditWeight(wpp > 0 ? String(wpp) : ""); }}>
                                                                <Pencil className="h-3 w-3 text-muted-foreground" />
                                                              </Button>
                                                            )}
                                                          </div>
                                                        )}
                                                      </td>
                                                    </tr>
                                                  );
                                                })}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </GalponLayout>
  );
}
