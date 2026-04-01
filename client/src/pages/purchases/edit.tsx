import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Plus, Trash2, ArrowLeft, Save, Calculator, Info, PackagePlus } from "lucide-react";
import type { Product } from "@shared/schema";

const UNIT_OPTIONS = [
  { value: "KG",      label: "KG" },
  { value: "CAJON",   label: "CAJÓN" },
  { value: "BOLSA",   label: "BOLSA" },
  { value: "UNIDAD",  label: "UNIDAD" },
  { value: "MAPLE",   label: "MAPLE" },
  { value: "ATADO",   label: "ATADO" },
  { value: "BANDEJA", label: "BANDEJA" },
] as const;

const PACKAGE_UNIT_SET = new Set(["CAJON", "BOLSA", "BANDEJA"]);

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
const isPackageUnit = (unit: string) => PACKAGE_UNIT_SET.has(unit);
const labelFor = (unit: string) => UNIT_OPTIONS.find((u) => u.value === unit)?.label ?? unit;

type PurchaseItem = {
  productId: number;
  quantity: string;
  unit: string;
  costPerUnit: string;
  weightPerPackage: string;
  baseUnit: string; // actual base unit stored in DB (for submit conversion)
};

export default function EditPurchasePage({ id }: { id: number }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [supplierName, setSupplierName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayLocal);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<PurchaseItem[]>([{ productId: 0, quantity: "", unit: "KG", costPerUnit: "", weightPerPackage: "", baseUnit: "KG" }]);
  const [initialized, setInitialized] = useState(false);

  const { data: purchase, isLoading: loadingPurchase } = useQuery<any>({
    queryKey: ["/api/purchases", id],
  });

  const { data: products } = useQuery<Product[]>({ queryKey: ["/api/products"] });

  useEffect(() => {
    if (purchase && !initialized) {
      setSupplierName(purchase.supplierName ?? "");
      setPurchaseDate(purchase.purchaseDate ? String(purchase.purchaseDate).slice(0, 10) : todayLocal());
      setNotes(purchase.notes ?? "");
      if (purchase.items?.length) {
        setItems(purchase.items.map((item: any) => {
          const isPackage = item.purchaseUnit && item.purchaseUnit !== item.unit;
          const wpp = parseFloat(item.weightPerPackage ?? "0") || 0;
          return {
            productId: item.productId,
            quantity: isPackage
              ? String(parseFloat(item.purchaseQty ?? item.quantity))
              : String(parseFloat(item.quantity)),
            unit: isPackage ? item.purchaseUnit : item.unit,
            costPerUnit: item.costPerPurchaseUnit
              ? String(parseFloat(item.costPerPurchaseUnit))
              : isPackage && wpp > 0
              ? String(Math.round(parseFloat(item.costPerUnit) * wpp * 100) / 100)
              : String(Math.round(parseFloat(item.costPerUnit) * 100) / 100),
            weightPerPackage: item.weightPerPackage ? String(parseFloat(item.weightPerPackage)) : "",
            baseUnit: item.unit, // preserve DB base unit for submit
          };
        }));
      }
      setInitialized(true);
    }
  }, [purchase, initialized]);

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/purchases/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/stock"] });
      toast({ title: "Compra actualizada", description: "Se ajustó el inventario y el costo promedio." });
      setLocation(`/purchases/${id}`);
    },
    onError: (e: any) => toast({ title: "Error al guardar", description: e.message, variant: "destructive" }),
  });

  // Fix 1: unshift so new item appears at top
  const addItem = () => setItems([{ productId: 0, quantity: "", unit: "KG", costPerUnit: "", weightPerPackage: "", baseUnit: "KG" }, ...items]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));

  const updateItem = (i: number, field: keyof PurchaseItem, value: string | number) => {
    const updated = [...items];
    updated[i] = { ...updated[i], [field]: String(value) };
    if (field === "productId") {
      const product = (products ?? []).find((p) => p.id === Number(value));
      if (product) {
        updated[i].unit = product.unit as string;
        updated[i].baseUnit = product.unit as string;
      }
    }
    if (field === "unit") {
      const unit = String(value);
      if (!isPackageUnit(unit)) {
        updated[i].weightPerPackage = "";
        updated[i].baseUnit = unit;
      }
    }
    setItems(updated);
  };

  const activeProducts = (products ?? []).filter((p) => p.active);

  const itemTotal = (item: PurchaseItem) => {
    const q = parseFloat(item.quantity) || 0;
    const c = parseFloat(item.costPerUnit) || 0;
    return Math.round(q * c * 100) / 100;
  };

  const grandTotal = items.reduce((sum, item) => sum + itemTotal(item), 0);

  const getProductAvgCost = (productId: number) => {
    const p = activeProducts.find((x) => x.id === productId);
    return p ? parseFloat(p.averageCost as string) : null;
  };

  const getProjectedAvgCost = (item: PurchaseItem) => {
    const p = activeProducts.find((x) => x.id === item.productId);
    if (!p) return null;
    const currentStock = parseFloat(p.currentStock as string);
    const currentAvg = parseFloat(p.averageCost as string);
    const wpp = parseFloat(item.weightPerPackage) || 0;
    const isPackage = isPackageUnit(item.unit) && wpp > 0;
    const newQty = isPackage ? (parseFloat(item.quantity) || 0) * wpp : (parseFloat(item.quantity) || 0);
    const newCost = isPackage ? (parseFloat(item.costPerUnit) || 0) / wpp : (parseFloat(item.costPerUnit) || 0);
    if (newQty <= 0 || newCost <= 0) return null;
    if (currentStock + newQty === 0) return newCost;
    return (currentStock * currentAvg + newQty * newCost) / (currentStock + newQty);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = items.filter((i) => i.productId && parseFloat(i.quantity) > 0 && parseFloat(i.costPerUnit) > 0);
    if (!validItems.length) {
      toast({ title: "Sin productos válidos", description: "Agrega al menos un producto con cantidad y costo.", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      supplierName,
      purchaseDate,
      notes: notes || undefined,
      items: validItems.map((i) => {
        const wpp = parseFloat(i.weightPerPackage) || 0;
        const isPackage = isPackageUnit(i.unit) && wpp > 0;
        if (isPackage) {
          const baseQty = (parseFloat(i.quantity) * wpp).toFixed(4);
          const baseCost = (parseFloat(i.costPerUnit) / wpp).toFixed(4);
          return {
            productId: Number(i.productId),
            quantity: baseQty,
            unit: i.baseUnit || "KG",
            costPerUnit: baseCost,
            costPerPurchaseUnit: parseFloat(i.costPerUnit).toFixed(2),
            purchaseQty: parseFloat(i.quantity).toFixed(4),
            purchaseUnit: i.unit,
            weightPerPackage: i.weightPerPackage,
          };
        }
        return {
          productId: Number(i.productId),
          quantity: parseFloat(i.quantity).toFixed(4),
          unit: i.unit,
          costPerUnit: parseFloat(i.costPerUnit).toFixed(4),
        };
      }),
    });
  };

  if (loadingPurchase) {
    return (
      <Layout title="Editar Compra">
        <div className="p-6 max-w-4xl mx-auto">
          <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={`Editar ${purchase?.folio ?? "Compra"}`}>
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation(`/purchases/${id}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-xl font-semibold text-foreground">Editar Orden de Compra</h2>
            <p className="text-sm text-muted-foreground">{purchase?.folio} — Los cambios ajustarán el inventario</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Datos Generales</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="folio">Folio</Label>
                  <Input id="folio" value={purchase?.folio ?? ""} readOnly className="bg-muted/40" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="date">Fecha de Compra</Label>
                  <Input
                    id="date"
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="supplier">Proveedor *</Label>
                  <Input
                    id="supplier"
                    placeholder="Nombre del proveedor"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notas</Label>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Opcional..." />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-sm font-semibold">Productos</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Agregar
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((item, idx) => {
                const product = activeProducts.find((p) => p.id === item.productId);
                const currentAvg = item.productId ? getProductAvgCost(item.productId) : null;
                const projectedAvg = item.productId && item.quantity && item.costPerUnit ? getProjectedAvgCost(item) : null;
                const packageMode = isPackageUnit(item.unit);
                const wpp = parseFloat(item.weightPerPackage) || 0;

                return (
                  <div key={idx} className="rounded-md border border-border bg-card/50 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Producto #{idx + 1}</span>
                      {items.length > 1 && (
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeItem(idx)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                      <div className="sm:col-span-2 space-y-1.5">
                        <Label>Producto *</Label>
                        <Select
                          value={item.productId ? String(item.productId) : ""}
                          onValueChange={(v) => updateItem(idx, "productId", Number(v))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar producto..." />
                          </SelectTrigger>
                          <SelectContent>
                            {activeProducts.map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.name} <span className="text-muted-foreground ml-1">({p.sku})</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label>Unidad de compra</Label>
                        <Select value={item.unit} onValueChange={(v) => updateItem(idx, "unit", v)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {UNIT_OPTIONS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label>Cant. {labelFor(item.unit)} *</Label>
                        <Input
                          type="number"
                          min="0.0001"
                          step="0.0001"
                          placeholder="0.00"
                          value={item.quantity}
                          onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                          required={item.productId > 0}
                        />
                      </div>
                    </div>

                    {packageMode && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="flex items-center gap-1">
                            <PackagePlus className="h-3 w-3 text-muted-foreground" />
                            Cant. base por {labelFor(item.unit)}
                          </Label>
                          <Input
                            type="number" min="0.0001" step="0.0001"
                            placeholder="ej. 18"
                            value={item.weightPerPackage}
                            onChange={(e) => updateItem(idx, "weightPerPackage", e.target.value)}
                          />
                        </div>
                        {wpp > 0 && parseFloat(item.quantity) > 0 && (
                          <div className="space-y-1.5">
                            <Label className="text-muted-foreground">Total base ({item.baseUnit})</Label>
                            <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3">
                              <span className="text-sm font-semibold text-foreground">
                                {(parseFloat(item.quantity) * wpp).toLocaleString("es-MX", { maximumFractionDigits: 4 })}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label>Costo por {labelFor(item.unit)} *</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                          <Input
                            type="number"
                            min="0"
                            step="0.0001"
                            placeholder="0.0000"
                            value={item.costPerUnit}
                            onChange={(e) => updateItem(idx, "costPerUnit", e.target.value)}
                            className="pl-7"
                            required={item.productId > 0}
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-muted-foreground">Subtotal</Label>
                        <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3">
                          <span className="text-sm font-semibold text-foreground">
                            ${itemTotal(item).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>

                      {projectedAvg !== null && (
                        <div className="space-y-1.5">
                          <Label className="flex items-center gap-1 text-muted-foreground">
                            <Calculator className="h-3 w-3" /> Nuevo Costo Prom.
                          </Label>
                          <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-muted/40 px-3">
                            <span className="text-sm font-semibold text-foreground">
                              ${projectedAvg.toLocaleString("es-MX", { maximumFractionDigits: 2 })}
                            </span>
                            {currentAvg !== null && (
                              <Badge variant={projectedAvg > currentAvg ? "destructive" : "secondary"} className="text-[10px]">
                                {projectedAvg > currentAvg ? "+" : ""}{((projectedAvg - currentAvg) / (currentAvg || 1) * 100).toFixed(1)}%
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {product && currentAvg !== null && (
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Info className="h-3 w-3" />
                          Stock actual: <span className="font-medium text-foreground">{parseFloat(product.currentStock as string).toLocaleString("es-MX", { maximumFractionDigits: 2 })} {product.unit}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          Costo actual:
                          <span className="font-medium text-foreground">
                            ${currentAvg.toLocaleString("es-MX", { maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <Separator />

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total de la compra</span>
                <span className="text-xl font-bold text-foreground">
                  ${grandTotal.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setLocation(`/purchases/${id}`)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={updateMutation.isPending || !supplierName}>
              {updateMutation.isPending ? (
                <>Guardando...</>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Guardar Cambios
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
