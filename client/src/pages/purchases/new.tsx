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
import { Plus, Trash2, ArrowLeft, PackagePlus, Calculator, Info } from "lucide-react";
import type { Product } from "@shared/schema";

const UNIT_OPTIONS = [
  { value: "kg",      label: "KG" },
  { value: "caja",    label: "CAJÓN" },
  { value: "saco",    label: "BOLSA" },
  { value: "pz",      label: "UNIDAD" },
  { value: "maple",   label: "MAPLE" },
  { value: "atado",   label: "ATADO" },
  { value: "bandeja", label: "BANDEJA" },
] as const;
type PurchaseItem = {
  productId: number;
  quantity: string;          // número de unidades de compra (ej. 10 cajones)
  unit: string;              // unidad de compra (ej. "caja")
  weightPerPackage: string;  // peso/cant. en unidad base por unidad de compra (ej. 18 kg/cajón)
  costPerUnit: string;       // costo por unidad de compra (ej. $360/cajón)
};

export default function NewPurchasePage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [folio, setFolio] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<PurchaseItem[]>([{ productId: 0, quantity: "", unit: "kg", weightPerPackage: "", costPerUnit: "" }]);

  const { data: products } = useQuery<Product[]>({ queryKey: ["/api/products"] });
  const { data: folioData } = useQuery<{ folio: string }>({ queryKey: ["/api/purchases/next-folio"] });

  useEffect(() => { if (folioData?.folio) setFolio(folioData.folio); }, [folioData]);

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/purchases", data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: `Compra ${folio} creada`, description: "Se actualizó el inventario y el costo promedio." });
      setLocation("/purchases");
    },
    onError: (e: any) => toast({ title: "Error al guardar", description: e.message, variant: "destructive" }),
  });

  const addItem = () => setItems([...items, { productId: 0, quantity: "", unit: "kg", weightPerPackage: "", costPerUnit: "" }]);

  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));

  const updateItem = (i: number, field: keyof PurchaseItem, value: string | number) => {
    const updated = [...items];
    updated[i] = { ...updated[i], [field]: value };
    if (field === "productId") {
      const product = (products ?? []).find((p) => p.id === Number(value));
      if (product) {
        updated[i].unit = product.unit as any;
      }
    }
    setItems(updated);
  };

  const activeProducts = (products ?? []).filter((p) => p.active);

  // Cuando hay conversión (weightPerPackage), calcula el total en unidad base (ej. kg).
  // Sin conversión, la cantidad es directamente el total.
  const getTotalStock = (item: PurchaseItem): number => {
    const q = parseFloat(item.quantity) || 0;
    const w = parseFloat(item.weightPerPackage);
    return item.weightPerPackage !== "" && !isNaN(w) && w > 0 ? q * w : q;
  };

  // Costo por unidad base = costPerUnit / weightPerPackage (ej. $360/cajón ÷ 18 kg = $20/kg)
  const getCostPerBaseUnit = (item: PurchaseItem): number => {
    const c = parseFloat(item.costPerUnit) || 0;
    const w = parseFloat(item.weightPerPackage);
    return item.weightPerPackage !== "" && !isNaN(w) && w > 0 ? c / w : c;
  };

  const hasConversion = (item: PurchaseItem): boolean => {
    const w = parseFloat(item.weightPerPackage);
    return item.weightPerPackage !== "" && !isNaN(w) && w > 0;
  };

  // Subtotal = lo que se paga = cantidad × costo por unidad de compra
  const itemTotal = (item: PurchaseItem) => {
    const q = parseFloat(item.quantity) || 0;
    const c = parseFloat(item.costPerUnit) || 0;
    return q * c;
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
    const newQty = getTotalStock(item);
    const newCost = getCostPerBaseUnit(item);
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
    createMutation.mutate({
      folio,
      supplierName,
      purchaseDate,
      notes: notes || undefined,
      items: validItems.map((i) => ({
        productId: i.productId,
        quantity: String(getTotalStock(i)),
        unit: hasConversion(i) ? "kg" : i.unit,
        costPerUnit: String(getCostPerBaseUnit(i)),
      })),
    });
  };

  return (
    <Layout title="Nueva Compra">
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/purchases")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-xl font-semibold text-foreground">Nueva Orden de Compra</h2>
            <p className="text-sm text-muted-foreground">Registra una nueva entrada de mercancía</p>
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
                  <Input
                    id="folio"
                    value={folio}
                    onChange={(e) => setFolio(e.target.value)}
                    required
                    data-testid="input-folio"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="date">Fecha de Compra</Label>
                  <Input
                    id="date"
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    required
                    data-testid="input-purchase-date"
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
                    data-testid="input-supplier"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notas</Label>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Opcional..." data-testid="input-purchase-notes" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-sm font-semibold">Productos</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addItem} data-testid="button-add-item">
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Agregar
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((item, idx) => {
                const product = activeProducts.find((p) => p.id === item.productId);
                const currentAvg = item.productId ? getProductAvgCost(item.productId) : null;
                const projectedAvg = item.productId && item.quantity && item.costPerUnit ? getProjectedAvgCost(item) : null;

                return (
                  <div key={idx} className="rounded-md border border-border bg-card/50 p-4 space-y-3" data-testid={`purchase-item-${idx}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Producto #{idx + 1}</span>
                      {items.length > 1 && (
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeItem(idx)} data-testid={`button-remove-item-${idx}`}>
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
                          <SelectTrigger data-testid={`select-product-${idx}`}>
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
                          <SelectTrigger data-testid={`select-unit-${idx}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {UNIT_OPTIONS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label>Cant. unidades *</Label>
                        <Input
                          type="number"
                          min="0.0001"
                          step="0.0001"
                          placeholder="0"
                          value={item.quantity}
                          onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                          required={item.productId > 0}
                          data-testid={`input-quantity-${idx}`}
                        />
                      </div>
                    </div>

                    {/* Conversión de envase a unidad base */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label className="flex items-center gap-1">
                          <PackagePlus className="h-3 w-3 text-muted-foreground" />
                          Peso/cant. por {UNIT_OPTIONS.find((u) => u.value === item.unit)?.label ?? item.unit}
                        </Label>
                        <div className="relative">
                          <Input
                            type="number"
                            min="0.0001"
                            step="0.0001"
                            placeholder="ej. 18 (kg por cajón)"
                            value={item.weightPerPackage}
                            onChange={(e) => updateItem(idx, "weightPerPackage", e.target.value)}
                            data-testid={`input-weight-per-package-${idx}`}
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-muted-foreground">
                          Total stock a agregar {hasConversion(item) ? "(kg)" : `(${item.unit})`}
                        </Label>
                        <div className={`flex h-9 items-center rounded-md border px-3 gap-2 ${hasConversion(item) ? "border-primary/40 bg-primary/5" : "border-border bg-muted/40"}`}>
                          <span className="text-sm font-semibold text-foreground">
                            {getTotalStock(item).toLocaleString("es-MX", { maximumFractionDigits: 4 })}
                          </span>
                          {hasConversion(item) && (
                            <span className="text-xs text-muted-foreground">
                              ({item.quantity} × {item.weightPerPackage})
                            </span>
                          )}
                        </div>
                      </div>

                      {hasConversion(item) && (
                        <div className="space-y-1.5">
                          <Label className="text-muted-foreground">Costo por kg (calculado)</Label>
                          <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3">
                            <span className="text-sm font-semibold text-foreground">
                              ${getCostPerBaseUnit(item).toLocaleString("es-MX", { minimumFractionDigits: 4 })}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label>Costo por {UNIT_OPTIONS.find((u) => u.value === item.unit)?.label ?? item.unit} *</Label>
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
                            data-testid={`input-cost-${idx}`}
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
                              ${projectedAvg.toLocaleString("es-MX", { minimumFractionDigits: 4 })}
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
                            ${currentAvg.toLocaleString("es-MX", { minimumFractionDigits: 4 })}
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
                <span className="text-xl font-bold text-foreground" data-testid="text-grand-total">
                  ${grandTotal.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setLocation("/purchases")}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !supplierName} data-testid="button-save-purchase">
              {createMutation.isPending ? (
                <>Guardando...</>
              ) : (
                <>
                  <PackagePlus className="mr-2 h-4 w-4" />
                  Registrar Compra
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
