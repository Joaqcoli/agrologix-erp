import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { ArrowLeft, Calendar, CheckCircle2, Download, AlertTriangle, Pencil, Check, X, Lock, ChevronsUpDown, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { generateRemitoPDF } from "@/lib/pdf";
import { useState } from "react";
import type { Customer, Product, ProductUnit } from "@shared/schema";
import type { Order, OrderItem } from "@shared/schema";
import { canonicalToDbEnum, dbEnumToCanonical, CANONICAL_UNIT_LABEL } from "@shared/units";

const IVA_DEFAULT = 0.105;
const IVA_HUEVO = 0.21;
const LOW_MARGIN = 0.30;

function getIvaRate(productName: string) {
  return productName.toUpperCase().includes("HUEVO") ? IVA_HUEVO : IVA_DEFAULT;
}

const fmt = (v: number, dec = 2) => v.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtPct = (v: number) => (v * 100).toFixed(1) + "%";
const fmtInt = (v: number) => Math.round(v).toLocaleString("es-MX");

type FullOrderItem = OrderItem & {
  overrideCostPerUnit?: string | null;
  product?: (Product & { [key: string]: any }) | null;
};

type FullOrder = Order & {
  customer: Customer;
  items: FullOrderItem[];
};

// DB enum values that can appear in order_items
const DB_UNITS = ["kg", "pz", "caja", "saco", "litro", "tonelada", "CAJON"] as const;
type DbUnit = typeof DB_UNITS[number];

const DB_UNIT_LABEL: Record<DbUnit, string> = {
  kg: "KG", pz: "PZ", caja: "CAJÓN", saco: "BOLSA/SACO", litro: "LITRO", tonelada: "TONELADA", CAJON: "CAJÓN",
};

function canonicalToDb(canonical: string): DbUnit | null {
  const db = canonicalToDbEnum(canonical) as DbUnit;
  return DB_UNITS.includes(db) ? db : null;
}

// ─── ProductCombobox ───────────────────────────────────────────────────────────
function ProductCombobox({
  value,
  onSelect,
  allProducts,
}: {
  value: number | null;
  onSelect: (id: number | null, name: string) => void;
  allProducts: Product[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = allProducts.find((p) => p.id === value);
  const filtered = allProducts
    .filter((p) => p.active && p.name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 30);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-7 text-xs justify-between px-2 min-w-[140px] max-w-[200px]"
          data-testid="combobox-product"
        >
          <span className="truncate">{selected?.name ?? "Sin producto"}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar producto..."
            value={search}
            onValueChange={setSearch}
            className="h-8 text-xs"
          />
          <CommandList className="max-h-48">
            <CommandEmpty className="py-2 text-xs text-center text-muted-foreground">Sin resultados</CommandEmpty>
            {filtered.map((p) => (
              <CommandItem
                key={p.id}
                value={p.name}
                onSelect={() => {
                  onSelect(p.id, p.name);
                  setOpen(false);
                  setSearch("");
                }}
                className="text-xs"
                data-testid={`product-option-${p.id}`}
              >
                {p.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── ItemRow ───────────────────────────────────────────────────────────────────
function ItemRow({
  calc,
  order,
  allProducts,
  hasIva,
  isDraft,
  isApproved,
}: {
  calc: {
    id: number;
    item: FullOrderItem;
    name: string;
    qty: number;
    unit: string;
    pricePerUnit: number | null;
    hasPrice: boolean;
    subtotal: number;
    totalConIva: number;
    ivaRate: number;
    costPerUnit: number;
    effectiveCostPerUnit: number;
    hasOverride: boolean;
    totalCompra: number;
    base: number;
    diferencia: number;
    pct: number;
    isLowMargin: boolean;
  };
  order: FullOrder;
  allProducts: Product[];
  hasIva: boolean;
  isDraft: boolean;
  isApproved: boolean;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draftQty, setDraftQty] = useState("");
  const [draftUnit, setDraftUnit] = useState<string>("kg");
  const [draftProductId, setDraftProductId] = useState<number | null>(null);
  const [draftPrice, setDraftPrice] = useState("");
  const [draftOverride, setDraftOverride] = useState("");

  const canEditStructural = isDraft || isApproved;
  const canEdit = isDraft || isApproved;

  const { data: productUnitsList = [] } = useQuery<ProductUnit[]>({
    queryKey: [`/api/products/${draftProductId}/units`],
    enabled: editing && draftProductId != null,
  });

  const availableDbUnits: DbUnit[] = editing && draftProductId != null
    ? productUnitsList
        .filter((pu) => pu.isActive)
        .map((pu) => canonicalToDb(pu.unit))
        .filter((u): u is DbUnit => u !== null)
    : DB_UNITS.filter(() => true);

  const enterEdit = () => {
    setDraftQty(fmt(calc.qty, 4).replace(/\.?0+$/, ""));
    setDraftUnit(calc.unit as DbUnit);
    setDraftProductId(calc.item.productId);
    setDraftPrice(calc.hasPrice ? String(Math.round(calc.pricePerUnit!)) : "");
    const override = calc.item.overrideCostPerUnit;
    setDraftOverride(override && parseFloat(override) > 0 ? String(Math.round(parseFloat(override))) : "");
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const patchMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiRequest("PATCH", `/api/orders/${order.id}/items/${calc.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", order.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/load-list"] });
      setEditing(false);
      toast({ title: "Línea guardada" });
    },
    onError: (e: any) => toast({ title: "Error al guardar", description: e.message, variant: "destructive" }),
  });

  const handleProductSelect = async (productId: number | null, name: string) => {
    setDraftProductId(productId);
    // Auto-fill override cost from product_units for current unit
    if (productId) {
      try {
        const res = await fetch(`/api/products/${productId}/units`, { credentials: "include" });
        if (res.ok) {
          const units: ProductUnit[] = await res.json();
          const canonical = dbEnumToCanonical(draftUnit);
          const pu = units.find((u) => u.unit === canonical && u.isActive);
          if (pu && parseFloat(pu.avgCost as string) > 0) {
            setDraftOverride(String(Math.round(parseFloat(pu.avgCost as string))));
          }
        }
      } catch { /* noop */ }
      // Try to fetch last price for this customer + product
      try {
        const res = await fetch(`/api/price-history/${order.customerId}/${productId}`, { credentials: "include" });
        if (res.ok) {
          const history = await res.json();
          if (history?.pricePerUnit && !draftPrice) {
            setDraftPrice(String(Math.round(parseFloat(history.pricePerUnit))));
          }
        }
      } catch { /* noop */ }
    }
  };

  const handleSave = () => {
    const qtyNum = parseFloat(draftQty);
    if (canEditStructural && (isNaN(qtyNum) || qtyNum <= 0)) {
      toast({ title: "Cantidad inválida", variant: "destructive" });
      return;
    }

    const patch: Record<string, any> = {};
    if (canEditStructural) {
      if (draftQty && !isNaN(qtyNum)) patch.quantity = String(qtyNum);
      if (draftUnit !== calc.unit) patch.unit = draftUnit;
      if (draftProductId !== calc.item.productId) patch.productId = draftProductId;
    }
    if (draftPrice !== "") patch.pricePerUnit = draftPrice;
    patch.overrideCostPerUnit = draftOverride !== "" ? draftOverride : null;

    patchMutation.mutate(patch);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleSave(); }
    if (e.key === "Escape") cancelEdit();
  };

  const allowDecimals = draftUnit.toLowerCase() === "kg" || draftUnit.toLowerCase() === "litro";

  // ── Display mode ──────────────────────────────────────────────────────────
  if (!editing) {
    return (
      <tr
        className={`border-b border-border last:border-0 group ${
          !calc.hasPrice ? "bg-yellow-50/30 dark:bg-yellow-900/10"
          : calc.isLowMargin ? "bg-destructive/5"
          : "hover:bg-muted/30"
        } transition-colors`}
        data-testid={`row-item-${calc.id}`}
      >
        <td className="py-2 px-2 font-medium text-foreground whitespace-nowrap text-xs">
          {fmt(calc.qty, 4).replace(/\.?0+$/, "")}
        </td>
        <td className="py-2 px-2 text-muted-foreground whitespace-nowrap text-xs">{calc.unit}</td>
        <td className="py-2 px-2 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`font-medium ${calc.item.product ? "text-foreground" : "text-muted-foreground italic"}`}>
              {calc.name}
            </span>
            {!calc.item.product && <Badge variant="outline" className="text-[9px] py-0">Sin producto</Badge>}
            {calc.isLowMargin && <Badge variant="destructive" className="text-[9px] py-0 px-1">Margen bajo</Badge>}
            {hasIva && calc.hasPrice && (
              <span className="text-[10px] text-muted-foreground">IVA {(calc.ivaRate * 100).toFixed(1)}%</span>
            )}
          </div>
        </td>
        <td className="py-2 px-2 text-right whitespace-nowrap text-xs">
          {!calc.hasPrice ? (
            <Badge variant="destructive" className="text-[9px]">Sin precio</Badge>
          ) : (
            <span className="text-foreground">${fmtInt(calc.pricePerUnit!)}</span>
          )}
        </td>
        <td className="py-2 px-2 text-right text-foreground whitespace-nowrap text-xs">
          {calc.hasPrice ? `$${fmtInt(calc.subtotal)}` : <span className="text-muted-foreground">—</span>}
        </td>
        {hasIva && (
          <td className="py-2 px-2 text-right font-semibold text-primary whitespace-nowrap text-xs">
            {calc.hasPrice ? `$${fmtInt(calc.totalConIva)}` : <span className="text-muted-foreground">—</span>}
          </td>
        )}
        <td className="py-2 px-2 text-right text-muted-foreground whitespace-nowrap border-l border-border text-xs">
          <span>${fmtInt(calc.effectiveCostPerUnit)}</span>
          {calc.hasOverride && (
            <Badge variant="outline" className="text-[8px] py-0 px-1 ml-1 text-orange-600 border-orange-300">Manual</Badge>
          )}
        </td>
        <td className="py-2 px-2 text-right text-muted-foreground whitespace-nowrap text-xs">${fmtInt(calc.totalCompra)}</td>
        <td className={`py-2 px-2 text-right font-semibold whitespace-nowrap text-xs ${!calc.hasPrice ? "text-muted-foreground" : calc.diferencia >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
          {calc.hasPrice ? `$${fmtInt(calc.diferencia)}` : "—"}
        </td>
        <td className={`py-2 px-2 text-right font-bold whitespace-nowrap text-xs ${!calc.hasPrice ? "text-muted-foreground" : calc.isLowMargin ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
          {calc.hasPrice ? fmtPct(calc.pct) : "—"}
        </td>
        <td className="py-2 px-2 text-center w-8">
          {canEdit && (
            <button
              onClick={enterEdit}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
              data-testid={`button-edit-row-${calc.id}`}
            >
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </td>
      </tr>
    );
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────
  return (
    <tr className="border-b border-border bg-blue-50/30 dark:bg-blue-900/10" data-testid={`row-item-${calc.id}-editing`}>
      {/* Qty */}
      <td className="py-1.5 px-2">
        {canEditStructural ? (
          <Input
            type="number"
            value={draftQty}
            onChange={(e) => setDraftQty(e.target.value)}
            onKeyDown={handleKeyDown}
            step={allowDecimals ? "0.01" : "1"}
            min="0"
            className="h-7 w-16 text-xs px-1.5 py-0"
            autoFocus
            data-testid={`input-qty-${calc.id}`}
          />
        ) : (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            <span>{fmt(calc.qty, 4).replace(/\.?0+$/, "")}</span>
          </div>
        )}
      </td>
      {/* Unit */}
      <td className="py-1.5 px-2">
        {canEditStructural ? (
          <Input
            type="text"
            value={draftUnit}
            onChange={(e) => setDraftUnit(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-7 w-20 text-xs px-1.5 py-0"
            placeholder="unidad"
            data-testid={`input-unit-${calc.id}`}
          />
        ) : (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            <span>{calc.unit}</span>
          </div>
        )}
      </td>
      {/* Product */}
      <td className="py-1.5 px-2">
        {canEditStructural ? (
          <ProductCombobox value={draftProductId} onSelect={handleProductSelect} allProducts={allProducts} />
        ) : (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            <span className="font-medium text-foreground">{calc.name}</span>
          </div>
        )}
      </td>
      {/* P. Venta */}
      <td className="py-1.5 px-2">
        <div className="flex items-center gap-0.5">
          <span className="text-xs text-muted-foreground">$</span>
          <Input
            type="number"
            value={draftPrice}
            onChange={(e) => setDraftPrice(e.target.value)}
            onKeyDown={handleKeyDown}
            step="1"
            min="0"
            className="h-7 w-24 text-xs px-1.5 py-0"
            placeholder="Precio"
            data-testid={`input-price-${calc.id}`}
          />
        </div>
      </td>
      {/* Total preview */}
      <td className="py-1.5 px-2 text-right text-xs text-muted-foreground whitespace-nowrap">
        {draftPrice && draftQty ? `$${fmtInt(parseFloat(draftQty) * parseFloat(draftPrice))}` : "—"}
      </td>
      {hasIva && <td className="py-1.5 px-2 text-xs text-muted-foreground">—</td>}
      {/* P. Compra override */}
      <td className="py-1.5 px-2 border-l border-border">
        <div className="flex items-center gap-0.5">
          <span className="text-xs text-muted-foreground">$</span>
          <Input
            type="number"
            value={draftOverride}
            onChange={(e) => setDraftOverride(e.target.value)}
            onKeyDown={handleKeyDown}
            step="1"
            min="0"
            className="h-7 w-24 text-xs px-1.5 py-0"
            placeholder={String(Math.round(calc.costPerUnit))}
            data-testid={`input-cost-${calc.id}`}
          />
        </div>
      </td>
      {/* Blanks for T.Compra, Dif, % */}
      <td className="py-1.5 px-2 text-xs text-muted-foreground text-right">—</td>
      <td className="py-1.5 px-2 text-xs text-muted-foreground text-right">—</td>
      <td className="py-1.5 px-2 text-xs text-muted-foreground text-right">—</td>
      {/* Actions */}
      <td className="py-1.5 px-2">
        <div className="flex items-center gap-1">
          <button
            onClick={handleSave}
            disabled={patchMutation.isPending}
            className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900 text-green-600"
            data-testid={`button-save-row-${calc.id}`}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={cancelEdit}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            data-testid={`button-cancel-row-${calc.id}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function OrderDetailPage({ id }: { id: number }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [lowMarginOk, setLowMarginOk] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/load-list"] });
      toast({ title: "Pedido eliminado" });
      setLocation("/orders");
    },
    onError: (e: any) => {
      toast({ title: "Error al eliminar", description: e.message, variant: "destructive" });
    },
  });

  const { data: order, isLoading } = useQuery<FullOrder>({
    queryKey: ["/api/orders", id],
  });

  const { data: allProducts = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const approveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/orders/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Pedido aprobado", description: "Se generó el remito y se descontó el stock." });
    },
    onError: (e: any) => toast({ title: "Error al aprobar", description: e.message, variant: "destructive" }),
  });

  const formatDate = (d: string | Date) =>
    new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });

  const handleDownloadRemito = async () => {
    if (!order?.remitoId) return;
    try {
      const res = await fetch(`/api/remitos/${order.remitoId}`, { credentials: "include" });
      if (!res.ok) throw new Error("No se pudo obtener el remito");
      const remito = await res.json();
      generateRemitoPDF(remito);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleExportXlsx = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/orders/${id}/export`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al exportar");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Pedido-${order?.folio ?? id}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) {
    return (
      <Layout title="Detalle de Pedido">
        <div className="p-6 max-w-5xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Layout>
    );
  }

  if (!order) {
    return (
      <Layout title="Pedido no encontrado">
        <div className="p-6 text-center text-muted-foreground">
          <p>El pedido no existe.</p>
          <Button variant="outline" className="mt-4" onClick={() => setLocation("/orders")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver
          </Button>
        </div>
      </Layout>
    );
  }

  const isDraft = order.status === "draft";
  const isApproved = order.status === "approved";
  const hasIva = order.customer.hasIva;

  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    draft:     { label: "Borrador", variant: "secondary" },
    approved:  { label: "Aprobado", variant: "default" },
    cancelled: { label: "Cancelado", variant: "destructive" },
  };
  const sc = statusConfig[order.status] ?? { label: order.status, variant: "secondary" as const };

  const getItemName = (item: FullOrderItem) =>
    item.product?.name ?? (item as any).rawProductName ?? "Producto sin nombre";

  // Per-item calculations using effectiveCostPerUnit (override ?? stored cost)
  const calcs = order.items.map((item) => {
    const qty = parseFloat(item.quantity as string);
    const hasPrice = item.pricePerUnit != null && parseFloat(item.pricePerUnit as string) > 0;
    const price = hasPrice ? parseFloat(item.pricePerUnit as string) : 0;
    const storedCost = parseFloat((item.costPerUnit as string) ?? "0");
    const override = item.overrideCostPerUnit;
    const hasOverride = override != null && parseFloat(override as string) > 0;
    const effectiveCostPerUnit = hasOverride ? parseFloat(override as string) : storedCost;
    const name = getItemName(item);
    const subtotal = qty * price;
    const ivaRate = getIvaRate(name);
    const totalConIva = subtotal * (1 + ivaRate);
    const totalCompra = qty * effectiveCostPerUnit;
    const base = hasIva ? totalConIva : subtotal;
    const diferencia = base - totalCompra;
    const pct = base > 0 ? diferencia / base : 0;
    return {
      id: item.id,
      item,
      name,
      qty,
      unit: item.unit as string,
      pricePerUnit: hasPrice ? price : null,
      hasPrice,
      subtotal,
      totalConIva,
      ivaRate,
      costPerUnit: storedCost,
      effectiveCostPerUnit,
      hasOverride,
      totalCompra,
      base,
      diferencia,
      pct,
      isLowMargin: hasPrice && pct < LOW_MARGIN,
    };
  });

  const unpricedCount = calcs.filter((c) => !c.hasPrice).length;
  const hasAnyLowMargin = calcs.some((c) => c.isLowMargin);

  const grandTotal = calcs.reduce((s, c) => s + c.subtotal, 0);
  const grandTotalConIva = calcs.reduce((s, c) => s + c.totalConIva, 0);
  const grandTotalCompra = calcs.reduce((s, c) => s + c.totalCompra, 0);
  const grandBase = hasIva ? grandTotalConIva : grandTotal;
  const grandDiff = grandBase - grandTotalCompra;
  const grandPct = grandBase > 0 ? grandDiff / grandBase : 0;

  const canApprove = isDraft && unpricedCount === 0 && (!hasAnyLowMargin || lowMarginOk);

  const editHint = isDraft || isApproved ? "· Hover → lápiz para editar fila" : "";

  return (
    <Layout title={`Pedido ${order.folio}`}>
      <div className="p-6 max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/orders")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-foreground">{order.folio}</h2>
              <Badge variant={sc.variant}>{sc.label}</Badge>
              {hasIva && <Badge variant="outline" className="text-[10px] text-primary border-primary/40">Con IVA</Badge>}
              {order.lowMarginConfirmed && (
                <Badge variant="outline" className="text-[10px] text-destructive border-destructive/50">
                  <AlertTriangle className="h-2.5 w-2.5 mr-1" /> Margen bajo confirmado
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{order.customer?.name}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
              data-testid="button-delete-order"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Eliminar
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportXlsx} disabled={exporting} data-testid="button-export-order">
              <Download className="mr-2 h-4 w-4" /> {exporting ? "..." : "Exportar"}
            </Button>
            {isApproved && order.remitoId && (
              <Button variant="outline" size="sm" onClick={handleDownloadRemito} data-testid="button-download-remito">
                <Download className="mr-2 h-4 w-4" /> Remito PDF
              </Button>
            )}
            {isDraft && (
              <Button
                size="sm"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending || !canApprove}
                data-testid="button-approve-order"
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {approveMutation.isPending ? "Aprobando..." : "Generar Remito"}
              </Button>
            )}
          </div>
        </div>

        {/* Alerts */}
        {isDraft && unpricedCount > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="text-sm">
              <strong>{unpricedCount} producto(s) sin precio.</strong> Pasá el mouse sobre la fila y hacé clic en el lápiz para editar.
            </AlertDescription>
          </Alert>
        )}
        {isDraft && hasAnyLowMargin && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex flex-col gap-3">
              <span>Una o más líneas tienen margen inferior al 30%. Confirma para aprobar.</span>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="low-margin-ok"
                  checked={lowMarginOk}
                  onCheckedChange={(v) => setLowMarginOk(!!v)}
                  data-testid="checkbox-low-margin-detail"
                />
                <label htmlFor="low-margin-ok" className="text-sm cursor-pointer font-medium">
                  Confirmo el margen bajo y autorizo la aprobación
                </label>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {isApproved && (
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertDescription className="text-sm">
              Pedido aprobado. Podés editar cualquier campo de cada línea — el stock se ajusta automáticamente al cambiar cantidades, unidades o productos.
            </AlertDescription>
          </Alert>
        )}

        {/* General info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Información General</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Cliente</p>
              <p className="text-sm font-medium text-foreground mt-1">{order.customer?.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Fecha</p>
              <div className="flex items-center gap-1.5 mt-1">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">{formatDate(order.orderDate)}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Neto</p>
              <p className="text-lg font-bold text-foreground mt-0.5">${fmtInt(grandTotal)}</p>
            </div>
            {hasIva && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Total + IVA</p>
                <p className="text-lg font-bold text-primary mt-0.5">${fmtInt(grandTotalConIva)}</p>
                <p className="text-[10px] text-muted-foreground">IVA: ${fmtInt(grandTotalConIva - grandTotal)}</p>
              </div>
            )}
            {order.notes && (
              <div className="col-span-2 sm:col-span-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Notas</p>
                <p className="text-sm text-foreground mt-1">{order.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Products table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Detalle de Productos ({order.items?.length ?? 0})
              {editHint && <span className="text-xs text-muted-foreground font-normal ml-2">{editHint}</span>}
              {hasIva && <span className="text-xs text-muted-foreground font-normal ml-2">· IVA 10.5% / 21% huevo</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b-2 border-border bg-muted/40">
                    <th className="text-left py-2 px-2 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Cant.</th>
                    <th className="text-left py-2 px-2 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">U.</th>
                    <th className="text-left py-2 px-2 font-semibold text-muted-foreground uppercase tracking-wide">Producto</th>
                    <th className="text-right py-2 px-2 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">P. Venta</th>
                    <th className="text-right py-2 px-2 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Total</th>
                    {hasIva && (
                      <th className="text-right py-2 px-2 font-semibold text-primary uppercase tracking-wide whitespace-nowrap">+ IVA</th>
                    )}
                    <th className="text-right py-2 px-2 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap border-l border-border">P. Compra</th>
                    <th className="text-right py-2 px-2 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">T. Compra</th>
                    <th className="text-right py-2 px-2 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Dif.</th>
                    <th className="text-right py-2 px-2 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">%</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {calcs.map((c) => (
                    <ItemRow
                      key={c.id}
                      calc={c}
                      order={order}
                      allProducts={allProducts}
                      hasIva={hasIva}
                      isDraft={isDraft}
                      isApproved={isApproved}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/20">
                    <td colSpan={4} className="py-3 px-2 font-bold text-foreground uppercase tracking-wide text-xs">Total</td>
                    <td className="py-3 px-2 text-right font-bold text-foreground whitespace-nowrap">${fmtInt(grandTotal)}</td>
                    {hasIva && (
                      <td className="py-3 px-2 text-right font-bold text-primary whitespace-nowrap">${fmtInt(grandTotalConIva)}</td>
                    )}
                    <td className="py-3 px-2 border-l border-border"></td>
                    <td className="py-3 px-2 text-right font-bold text-muted-foreground whitespace-nowrap">${fmtInt(grandTotalCompra)}</td>
                    <td className={`py-3 px-2 text-right font-bold whitespace-nowrap ${grandDiff >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                      ${fmtInt(grandDiff)}
                    </td>
                    <td className={`py-3 px-2 text-right font-bold whitespace-nowrap ${grandPct < LOW_MARGIN ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                      {fmtPct(grandPct)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar pedido?</AlertDialogTitle>
            <AlertDialogDescription>
              Estás por eliminar el pedido <strong>{order.folio}</strong> ({order.customer?.name}). Esta acción no se puede deshacer.
              {isApproved && " El stock descargado será restituido automáticamente."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate()}
              data-testid="button-confirm-delete-detail"
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
