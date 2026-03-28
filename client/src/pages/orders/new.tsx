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
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Plus, Trash2, ArrowLeft, Send, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import type { Customer, Product } from "@shared/schema";

const UNITS = ["KG", "UNIDAD", "CAJON", "BOLSA", "ATADO", "MAPLE", "BANDEJA"] as const;

type OrderItem = {
  productId: number;
  quantity: string;
  unit: typeof UNITS[number];
  pricePerUnit: string;
  suggestedPrice?: string;
};

const LOW_MARGIN_THRESHOLD = 0.30;

function calcMargin(price: number, cost: number): number {
  if (price <= 0) return 0;
  return (price - cost) / price;
}

export default function NewOrderPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [customerId, setCustomerId] = useState<number>(0);
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lowMarginConfirmed, setLowMarginConfirmed] = useState(false);
  const [items, setItems] = useState<OrderItem[]>([{ productId: 0, quantity: "", unit: "KG", pricePerUnit: "" }]);

  const { data: customers } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: products } = useQuery<Product[]>({ queryKey: ["/api/products"] });

  const activeCustomers = (customers ?? []).filter((c) => c.active);
  const activeProducts = (products ?? []).filter((p) => p.active);

  // Fetch suggested price when customer or product changes
  const fetchSuggestedPrice = async (idx: number, pId: number, cId: number) => {
    if (!pId || !cId) return;
    try {
      const res = await fetch(`/api/price-history/${cId}/${pId}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (data?.pricePerUnit) {
          setItems((prev) => {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], suggestedPrice: data.pricePerUnit };
            if (!updated[idx].pricePerUnit) {
              updated[idx].pricePerUnit = data.pricePerUnit;
            }
            return updated;
          });
        }
      }
    } catch {}
  };

  const addItem = () => setItems([...items, { productId: 0, quantity: "", unit: "KG", pricePerUnit: "" }]);

  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));

  const updateItem = (i: number, field: keyof OrderItem, value: string | number) => {
    const updated = [...items];
    updated[i] = { ...updated[i], [field]: value };
    if (field === "productId") {
      const product = activeProducts.find((p) => p.id === Number(value));
      if (product) updated[i].unit = product.unit as any;
      if (customerId && Number(value)) {
        fetchSuggestedPrice(i, Number(value), customerId);
      }
    }
    setItems(updated);
  };

  const getProduct = (productId: number) => activeProducts.find((p) => p.id === productId);

  const itemMargin = (item: OrderItem) => {
    const product = getProduct(item.productId);
    if (!product || !item.pricePerUnit) return null;
    const cost = parseFloat(product.averageCost as string);
    const price = parseFloat(item.pricePerUnit);
    return calcMargin(price, cost);
  };

  const hasLowMargin = items.some((item) => {
    const m = itemMargin(item);
    return m !== null && m < LOW_MARGIN_THRESHOLD;
  });

  const itemTotal = (item: OrderItem) => {
    const q = parseFloat(item.quantity) || 0;
    const p = parseFloat(item.pricePerUnit) || 0;
    return q * p;
  };

  const grandTotal = items.reduce((sum, item) => sum + itemTotal(item), 0);

  const canSubmit = customerId > 0 && items.some((i) => i.productId && i.quantity && i.pricePerUnit)
    && (!hasLowMargin || lowMarginConfirmed);

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/orders", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Pedido creado", description: "El pedido quedó en estado borrador." });
      setLocation("/orders");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = items.filter((i) => i.productId && parseFloat(i.quantity) > 0 && parseFloat(i.pricePerUnit) > 0);
    if (!validItems.length) {
      toast({ title: "Sin productos válidos", description: "Agrega al menos un producto con cantidad y precio.", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      customerId,
      orderDate,
      notes: notes || undefined,
      lowMarginConfirmed,
      items: validItems.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unit: i.unit,
        pricePerUnit: i.pricePerUnit,
      })),
    });
  };

  return (
    <Layout title="Nuevo Pedido">
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/orders")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-xl font-semibold text-foreground">Nuevo Pedido de Venta</h2>
            <p className="text-sm text-muted-foreground">Crea un pedido y luego apruébalo para generar el remito</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Datos Generales</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="customer">Cliente *</Label>
                  <Select value={customerId ? String(customerId) : ""} onValueChange={(v) => {
                    setCustomerId(Number(v));
                    items.forEach((item, idx) => {
                      if (item.productId) fetchSuggestedPrice(idx, item.productId, Number(v));
                    });
                  }}>
                    <SelectTrigger id="customer" data-testid="select-customer">
                      <SelectValue placeholder="Seleccionar cliente..." />
                    </SelectTrigger>
                    <SelectContent>
                      {activeCustomers.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="date">Fecha del Pedido</Label>
                  <Input id="date" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} required data-testid="input-order-date" />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label htmlFor="notes">Notas</Label>
                  <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Opcional..." data-testid="input-order-notes" />
                </div>
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
                const product = getProduct(item.productId);
                const cost = product ? parseFloat(product.averageCost as string) : 0;
                const price = parseFloat(item.pricePerUnit) || 0;
                const margin = product && price ? itemMargin(item) : null;
                const isLowMargin = margin !== null && margin < LOW_MARGIN_THRESHOLD;

                return (
                  <div
                    key={idx}
                    className={`rounded-md border p-4 space-y-3 ${isLowMargin ? "border-destructive/50 bg-destructive/5" : "border-border bg-card/50"}`}
                    data-testid={`order-item-${idx}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Producto #{idx + 1}</span>
                        {isLowMargin && (
                          <Badge variant="destructive" className="text-[10px] flex items-center gap-1">
                            <AlertTriangle className="h-2.5 w-2.5" /> Margen bajo
                          </Badge>
                        )}
                      </div>
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
                        <Label>Unidad</Label>
                        <Select value={item.unit} onValueChange={(v) => updateItem(idx, "unit", v)}>
                          <SelectTrigger data-testid={`select-unit-${idx}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label>Cantidad *</Label>
                        <Input
                          type="number"
                          min="0.0001"
                          step="0.0001"
                          placeholder="0.00"
                          value={item.quantity}
                          onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                          data-testid={`input-quantity-${idx}`}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label className="flex items-center gap-1">
                          Precio por unidad *
                          {item.suggestedPrice && (
                            <button
                              type="button"
                              className="text-[10px] text-primary underline ml-1"
                              onClick={() => updateItem(idx, "pricePerUnit", item.suggestedPrice!)}
                            >
                              Usar último: ${parseFloat(item.suggestedPrice).toFixed(2)}
                            </button>
                          )}
                        </Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                          <Input
                            type="number"
                            min="0"
                            step="0.0001"
                            placeholder="0.0000"
                            value={item.pricePerUnit}
                            onChange={(e) => updateItem(idx, "pricePerUnit", e.target.value)}
                            className="pl-7"
                            data-testid={`input-price-${idx}`}
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-muted-foreground">Costo Prom.</Label>
                        <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3">
                          <span className="text-sm text-muted-foreground">
                            {product ? `$${cost.toLocaleString("es-MX", { minimumFractionDigits: 2 })}` : "—"}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-muted-foreground">Margen</Label>
                        <div className={`flex h-9 items-center gap-2 rounded-md border px-3 ${isLowMargin ? "border-destructive/50 bg-destructive/10" : "border-border bg-muted/40"}`}>
                          {margin !== null ? (
                            <>
                              {isLowMargin
                                ? <TrendingDown className="h-3.5 w-3.5 text-destructive shrink-0" />
                                : <TrendingUp className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
                              }
                              <span className={`text-sm font-semibold ${isLowMargin ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                                {(margin * 100).toFixed(1)}%
                              </span>
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {item.productId > 0 && item.pricePerUnit && (
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs text-muted-foreground">Subtotal</span>
                        <span className="text-sm font-semibold text-foreground">
                          ${itemTotal(item).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

              <Separator />

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total del pedido</span>
                <span className="text-xl font-bold text-foreground" data-testid="text-grand-total">
                  ${grandTotal.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </CardContent>
          </Card>

          {hasLowMargin && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="flex flex-col gap-3">
                <span>
                  Uno o más productos tienen un margen inferior al 30%. Confirma para continuar.
                </span>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="low-margin-confirm"
                    checked={lowMarginConfirmed}
                    onCheckedChange={(v) => setLowMarginConfirmed(!!v)}
                    data-testid="checkbox-low-margin"
                  />
                  <label htmlFor="low-margin-confirm" className="text-sm cursor-pointer font-medium">
                    Confirmo que apruebo el margen bajo
                  </label>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setLocation("/orders")}>Cancelar</Button>
            <Button type="submit" disabled={createMutation.isPending || !canSubmit} data-testid="button-save-order">
              {createMutation.isPending ? "Guardando..." : <><Send className="mr-2 h-4 w-4" /> Crear Pedido</>}
            </Button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
