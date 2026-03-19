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
import { ArrowLeft, Calendar, CheckCircle2, Download, AlertTriangle, Check, X, Lock, ChevronsUpDown, Trash2, Plus, RotateCcw } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { generateRemitoPDF } from "@/lib/pdf";
import { useState } from "react";
import type { Customer, Product } from "@shared/schema";
import type { Order, OrderItem } from "@shared/schema";
import { dbEnumToCanonical, ALL_CANONICAL_UNITS } from "@shared/units";

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
  bolsaType?: string | null;
  product?: (Product & { [key: string]: any }) | null;
};

type FullOrder = Order & {
  customer: Customer;
  items: FullOrderItem[];
};

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
  hasBolsaFv,
  onDelete,
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
    bolsaType: string | null;
  };
  order: FullOrder;
  allProducts: Product[];
  hasIva: boolean;
  isDraft: boolean;
  isApproved: boolean;
  hasBolsaFv: boolean;
  onDelete: (itemId: number) => void;
}) {
  const { toast } = useToast();
  const [editingCell, setEditingCell] = useState<"qty" | "unit" | "price" | "product" | "cost" | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [origValue, setOrigValue] = useState("");

  const canEdit = isDraft || isApproved;

  const startEdit = (cell: typeof editingCell, value: string) => {
    setEditingCell(cell); setDraftValue(value); setOrigValue(value);
  };
  const cancelEdit = () => { setDraftValue(origValue); setEditingCell(null); };

  const patchMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiRequest("PATCH", `/api/orders/${order.id}/items/${calc.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", order.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/load-list"] });
      toast({ title: "Línea guardada" });
    },
    onError: (e: any) => toast({ title: "Error al guardar", description: e.message, variant: "destructive" }),
  });

  const saveCellEdit = () => {
    if (patchMutation.isPending) return;
    const patch = ({
      qty: { quantity: draftValue },
      unit: { unit: draftValue },
      price: { pricePerUnit: draftValue || null },
      product: { productId: parseInt(draftValue) },
      cost: { overrideCostPerUnit: draftValue || null },
    } as Record<string, any>)[editingCell!];
    patchMutation.mutate(patch, { onSuccess: () => setEditingCell(null) });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); saveCellEdit(); }
    if (e.key === "Escape") cancelEdit();
  };

  const handleProductSelect = async (productId: number | null, _name: string) => {
    if (!productId) { setEditingCell(null); return; }
    let pricePerUnit: string | null = null;
    try {
      const res = await fetch(`/api/price-history/${order.customerId}/${productId}`, { credentials: "include" });
      if (res.ok) {
        const history = await res.json();
        if (history?.pricePerUnit) pricePerUnit = String(Math.round(parseFloat(history.pricePerUnit)));
      }
    } catch { /* noop */ }
    patchMutation.mutate({ productId, pricePerUnit }, { onSuccess: () => setEditingCell(null) });
  };

  // Bolsa FV toggle
  const handleBolsaToggle = (type: "bolsa" | "bolsa_propia") => {
    const newType = calc.bolsaType === type ? null : type;
    patchMutation.mutate({
      bolsaType: newType,
      overrideCostPerUnit: newType ? "0" : null,
    });
  };

  return (
    <tr
      className={`border-b border-border last:border-0 group ${
        !calc.hasPrice ? "bg-yellow-50/30 dark:bg-yellow-900/10"
        : calc.isLowMargin ? "bg-destructive/5"
        : "hover:bg-muted/30"
      } transition-colors`}
      data-testid={`row-item-${calc.id}`}
    >
      {/* Qty */}
      <td className="py-2 px-2 font-medium text-foreground whitespace-nowrap text-xs">
        {canEdit && editingCell === "qty" ? (
          <div className="flex items-center gap-1">
            <Input
              type="number" value={draftValue} onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={onKeyDown} step="0.01" min="0"
              className="h-7 w-16 text-xs px-1.5 py-0" autoFocus
              data-testid={`input-qty-${calc.id}`}
            />
            <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground">
              <RotateCcw className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <span
            className={canEdit ? "cursor-pointer hover:underline" : ""}
            onClick={canEdit ? () => startEdit("qty", fmt(calc.qty, 4).replace(/\.?0+$/, "")) : undefined}
          >
            {fmt(calc.qty, 4).replace(/\.?0+$/, "")}
          </span>
        )}
      </td>
      {/* Unit */}
      <td className="py-2 px-2 text-muted-foreground whitespace-nowrap text-xs">
        {canEdit && editingCell === "unit" ? (
          <Select
            value={draftValue}
            onValueChange={(v) => {
              setDraftValue(v);
              if (calc.item.productId) {
                apiRequest("POST", `/api/products/${calc.item.productId}/units`, { unit: v }).catch(() => {});
              }
              patchMutation.mutate({ unit: v }, { onSuccess: () => setEditingCell(null) });
            }}
          >
            <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ALL_CANONICAL_UNITS.map((u) => (
                <SelectItem key={u} value={u.toLowerCase()}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span
            className={canEdit ? "cursor-pointer hover:underline" : ""}
            onClick={canEdit ? () => startEdit("unit", dbEnumToCanonical(calc.unit).toLowerCase()) : undefined}
          >
            {calc.unit}
          </span>
        )}
      </td>
      {/* Product */}
      <td className="py-2 px-2 text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          {canEdit && editingCell === "product" ? (
            <ProductCombobox
              value={calc.item.productId}
              onSelect={(id, name) => handleProductSelect(id, name)}
              allProducts={allProducts}
            />
          ) : (
            <span
              className={`font-medium ${calc.item.product ? "text-foreground" : "text-muted-foreground italic"} ${canEdit ? "cursor-pointer hover:underline" : ""}`}
              onClick={canEdit ? () => startEdit("product", String(calc.item.productId ?? "")) : undefined}
            >
              {calc.name}
            </span>
          )}
          {!calc.item.product && editingCell !== "product" && <Badge variant="outline" className="text-[9px] py-0">Sin producto</Badge>}
          {calc.isLowMargin && <Badge variant="destructive" className="text-[9px] py-0 px-1">Margen bajo</Badge>}
          {calc.bolsaType && (
            <Badge variant="outline" className="text-[9px] py-0 px-1 text-green-600 border-green-300">
              {calc.bolsaType === "bolsa_propia" ? "Bolsa propia" : "Bolsa"}
            </Badge>
          )}
          {hasIva && calc.hasPrice && (
            <span className="text-[10px] text-muted-foreground">IVA {(calc.ivaRate * 100).toFixed(1)}%</span>
          )}
          {hasBolsaFv && (
            <div className="flex items-center gap-1 ml-1">
              <button
                onClick={() => handleBolsaToggle("bolsa")}
                disabled={patchMutation.isPending}
                className={`flex items-center gap-0.5 text-[10px] rounded px-1 py-0.5 border transition-colors ${calc.bolsaType === "bolsa" ? "bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "border-border text-muted-foreground hover:border-green-400"}`}
              >
                <span>Bolsa</span>
              </button>
              <button
                onClick={() => handleBolsaToggle("bolsa_propia")}
                disabled={patchMutation.isPending}
                className={`flex items-center gap-0.5 text-[10px] rounded px-1 py-0.5 border transition-colors ${calc.bolsaType === "bolsa_propia" ? "bg-blue-100 border-blue-400 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" : "border-border text-muted-foreground hover:border-blue-400"}`}
              >
                <span>Bolsa propia</span>
              </button>
            </div>
          )}
        </div>
      </td>
      {/* Price */}
      <td className="py-2 px-2 text-right whitespace-nowrap text-xs">
        {canEdit && editingCell === "price" ? (
          <div className="flex items-center gap-1 justify-end">
            <Input
              type="number" value={draftValue} onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={onKeyDown} step="1" min="0"
              className="h-7 w-24 text-xs px-1.5 py-0" autoFocus placeholder="Precio"
              data-testid={`input-price-${calc.id}`}
            />
            <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground">
              <RotateCcw className="h-3 w-3" />
            </button>
          </div>
        ) : !calc.hasPrice ? (
          <Badge
            variant="destructive"
            className={`text-[9px] ${canEdit ? "cursor-pointer" : ""}`}
            onClick={canEdit ? () => startEdit("price", "") : undefined}
          >Sin precio</Badge>
        ) : (
          <span
            className={`text-foreground ${canEdit ? "cursor-pointer hover:underline" : ""}`}
            onClick={canEdit ? () => startEdit("price", String(Math.round(calc.pricePerUnit!))) : undefined}
          >
            ${fmtInt(calc.pricePerUnit!)}
          </span>
        )}
      </td>
      {/* Subtotal */}
      <td className="py-2 px-2 text-right text-foreground whitespace-nowrap text-xs">
        {calc.hasPrice ? `$${fmtInt(calc.subtotal)}` : <span className="text-muted-foreground">—</span>}
      </td>
      {hasIva && (
        <td className="py-2 px-2 text-right font-semibold text-primary whitespace-nowrap text-xs">
          {calc.hasPrice ? `$${fmtInt(calc.totalConIva)}` : <span className="text-muted-foreground">—</span>}
        </td>
      )}
      {/* Costo */}
      <td className="py-2 px-2 text-right text-muted-foreground whitespace-nowrap border-l border-border text-xs">
        {canEdit && editingCell === "cost" ? (
          <div className="flex items-center gap-1 justify-end">
            <Input
              type="number" value={draftValue} onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={onKeyDown} step="1" min="0"
              className="h-7 w-24 text-xs px-1.5 py-0" autoFocus placeholder="Costo"
            />
            <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground">
              <RotateCcw className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <>
            <span
              className={canEdit ? "cursor-pointer hover:underline" : ""}
              onClick={canEdit ? () => startEdit("cost", String(Math.round(calc.effectiveCostPerUnit))) : undefined}
            >
              ${fmtInt(calc.effectiveCostPerUnit)}
            </span>
            {calc.hasOverride && (
              <Badge variant="outline" className="text-[8px] py-0 px-1 ml-1 text-orange-600 border-orange-300">Manual</Badge>
            )}
          </>
        )}
      </td>
      <td className="py-2 px-2 text-right text-muted-foreground whitespace-nowrap text-xs">${fmtInt(calc.totalCompra)}</td>
      <td className={`py-2 px-2 text-right font-semibold whitespace-nowrap text-xs ${!calc.hasPrice ? "text-muted-foreground" : calc.diferencia >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
        {calc.hasPrice ? `$${fmtInt(calc.diferencia)}` : "—"}
      </td>
      <td className={`py-2 px-2 text-right font-bold whitespace-nowrap text-xs ${!calc.hasPrice ? "text-muted-foreground" : calc.isLowMargin ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
        {calc.hasPrice ? fmtPct(calc.pct) : "—"}
      </td>
      {/* Delete */}
      <td className="py-2 px-2 text-center w-14">
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onDelete(calc.id)}
            className="p-0.5 rounded hover:bg-destructive/10 text-destructive"
            data-testid={`button-delete-row-${calc.id}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── AddItemRow ─────────────────────────────────────────────────────────────────
function AddItemRow({
  orderId,
  allProducts,
  hasIva,
  hasBolsaFv,
  onDone,
}: {
  orderId: number;
  allProducts: Product[];
  hasIva: boolean;
  hasBolsaFv: boolean;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("KG");
  const [productId, setProductId] = useState<number | null>(null);
  const [price, setPrice] = useState("");
  const [bolsaType, setBolsaType] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/orders/${orderId}/items`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/load-list"] });
      toast({ title: "Línea agregada" });
      onDone();
    },
    onError: (e: any) => toast({ title: "Error al agregar", description: e.message, variant: "destructive" }),
  });

  const handleProductSelect = async (id: number | null, _name: string) => {
    setProductId(id);
    if (id) {
      try {
        const res = await fetch(`/api/price-history/${orderId}/${id}`, { credentials: "include" });
        if (res.ok) {
          const history = await res.json();
          if (history?.pricePerUnit && !price) setPrice(String(Math.round(parseFloat(history.pricePerUnit))));
        }
      } catch { /* noop */ }
    }
  };

  const handleSave = async () => {
    const q = parseFloat(qty);
    if (isNaN(q) || q <= 0) { toast({ title: "Cantidad inválida", variant: "destructive" }); return; }
    if (productId) {
      try { await apiRequest("POST", `/api/products/${productId}/units`, { unit }); } catch { /* ya existe */ }
    }
    addMutation.mutate({
      productId: productId ?? null,
      quantity: String(q),
      unit,
      pricePerUnit: price || null,
      bolsaType: bolsaType || null,
    });
  };

  return (
    <tr className="border-b border-border bg-green-50/20 dark:bg-green-900/10">
      <td className="py-1.5 px-2">
        <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} step="1" min="0" className="h-7 w-16 text-xs px-1.5 py-0" placeholder="Cant." autoFocus />
      </td>
      <td className="py-1.5 px-2">
        <Select value={unit} onValueChange={setUnit}>
          <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ALL_CANONICAL_UNITS.map((u) => (
              <SelectItem key={u} value={u}>{u}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="py-1.5 px-2">
        <div className="flex items-center gap-2 flex-wrap">
          <ProductCombobox value={productId} onSelect={handleProductSelect} allProducts={allProducts} />
          {hasBolsaFv && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setBolsaType(bolsaType === "bolsa" ? null : "bolsa")}
                className={`text-[10px] rounded px-1 py-0.5 border transition-colors ${bolsaType === "bolsa" ? "bg-green-100 border-green-400 text-green-700" : "border-border text-muted-foreground"}`}
              >Bolsa</button>
              <button
                type="button"
                onClick={() => setBolsaType(bolsaType === "bolsa_propia" ? null : "bolsa_propia")}
                className={`text-[10px] rounded px-1 py-0.5 border transition-colors ${bolsaType === "bolsa_propia" ? "bg-blue-100 border-blue-400 text-blue-700" : "border-border text-muted-foreground"}`}
              >Bolsa propia</button>
            </div>
          )}
        </div>
      </td>
      <td className="py-1.5 px-2">
        <div className="flex items-center gap-0.5">
          <span className="text-xs text-muted-foreground">$</span>
          <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} step="1" min="0" className="h-7 w-24 text-xs px-1.5 py-0" placeholder="Precio" />
        </div>
      </td>
      <td className="py-1.5 px-2 text-right text-xs text-muted-foreground">
        {price && qty ? `$${fmtInt(parseFloat(qty) * parseFloat(price))}` : "—"}
      </td>
      {hasIva && <td />}
      <td className="border-l border-border" />
      <td /><td /><td />
      <td className="py-1.5 px-2">
        <div className="flex items-center gap-1">
          <button onClick={handleSave} disabled={addMutation.isPending} className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900 text-green-600">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDone} className="p-1 rounded hover:bg-muted text-muted-foreground">
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
  const [deleteItemId, setDeleteItemId] = useState<number | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const [hidePrecios, setHidePrecios] = useState(false);

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

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: number) => apiRequest("DELETE", `/api/orders/${id}/items/${itemId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/load-list"] });
      toast({ title: "Línea eliminada" });
      setDeleteItemId(null);
    },
    onError: (e: any) => toast({ title: "Error al eliminar línea", description: e.message, variant: "destructive" }),
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

  const formatDate = (d: string | Date) => {
    const s = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
    return new Date(s + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
  };

  const handleDownloadRemito = async () => {
    try {
      type RemitoItem = { product: { name: string; sku: string } | null; quantity: string; unit: string; pricePerUnit: string; subtotal: string; bolsaType?: string | null };

      let remitoItems: RemitoItem[];
      let remitoFolio: string;
      let remitoDate: string | Date;

      if (order.remitoId) {
        // Pedido con remito creado normalmente
        const res = await fetch(`/api/remitos/${order.remitoId}`, { credentials: "include" });
        if (!res.ok) throw new Error("No se pudo obtener el remito");
        const remito = await res.json();
        remitoItems = remito.order.items;
        remitoFolio = remito.folio;
        remitoDate = remito.issuedAt;
      } else {
        // Pedido importado sin remito — construir desde el pedido
        remitoItems = order.items.map((item) => ({
          product: item.product ? { name: item.product.name, sku: (item.product as any).sku ?? "" } : null,
          quantity: String(item.quantity),
          unit: String(item.unit),
          pricePerUnit: String(item.pricePerUnit ?? "0"),
          subtotal: String(item.subtotal),
          bolsaType: (item as any).bolsaType ?? null,
        }));
        remitoFolio = order.notes?.match(/Remito\s+(\S+)/i)?.[1] ?? order.folio;
        remitoDate = order.orderDate;
      }

      const remito = {
        folio: remitoFolio,
        issuedAt: remitoDate,
        order: {
          folio: order.folio,
          orderDate: order.orderDate,
          notes: order.notes,
          customer: {
            name: order.customer.name,
            hasIva: order.customer.hasIva,
            rfc: (order.customer as any).rfc ?? null,
            address: (order.customer as any).address ?? null,
            city: (order.customer as any).city ?? null,
            phone: (order.customer as any).phone ?? null,
          },
          items: remitoItems,
          total: String(order.total),
        },
      };

      // Merge bolsa lines for bolsaFv customers
      if (order.customer.bolsaFv) {
        const merged = new Map<string, RemitoItem>();
        for (const item of remito.order.items) {
          const key = String(item.product?.name ?? Math.random());
          if (merged.has(key)) {
            const existing = merged.get(key)!;
            merged.set(key, {
              ...existing,
              quantity: String(parseFloat(existing.quantity) + parseFloat(item.quantity)),
              subtotal: String(parseFloat(existing.subtotal) + parseFloat(item.subtotal)),
            });
          } else {
            merged.set(key, { ...item });
          }
        }
        remito.order.items = Array.from(merged.values());
        remito.order.total = String(remito.order.items.reduce((s, i) => s + parseFloat(i.subtotal), 0));
      }

      await generateRemitoPDF(remito, { hidePrecios });
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
  const hasBolsaFv = !!(order.customer as any).bolsaFv;

  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    draft:     { label: "Borrador", variant: "secondary" },
    approved:  { label: "Aprobado", variant: "default" },
    cancelled: { label: "Cancelado", variant: "destructive" },
  };
  const sc = statusConfig[order.status] ?? { label: order.status, variant: "secondary" as const };

  const getItemName = (item: FullOrderItem) =>
    item.product?.name ?? (item as any).rawProductName ?? "Producto sin nombre";

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
      bolsaType: (item as any).bolsaType ?? null,
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

  const editHint = isDraft || isApproved ? "· Clic en celda para editar" : "";

  const handleDeleteItem = (itemId: number) => {
    if (isApproved) {
      setDeleteItemId(itemId);
    } else {
      deleteItemMutation.mutate(itemId);
    }
  };

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
              {hasBolsaFv && <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">Bolsa FV</Badge>}
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
            {isApproved && (
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <Checkbox
                    checked={hidePrecios}
                    onCheckedChange={(v) => setHidePrecios(!!v)}
                    className="h-3.5 w-3.5"
                  />
                  Ocultar precios
                </label>
                <Button variant="outline" size="sm" onClick={handleDownloadRemito} data-testid="button-download-remito">
                  <Download className="mr-2 h-4 w-4" /> Remito PDF
                </Button>
              </div>
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
              <strong>{unpricedCount} producto(s) sin precio.</strong> Hacé clic en la celda de precio para editar.
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
                    <th className="w-14"></th>
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
                      hasBolsaFv={hasBolsaFv}
                      onDelete={handleDeleteItem}
                    />
                  ))}
                  {addingItem && (
                    <AddItemRow
                      orderId={id}
                      allProducts={allProducts}
                      hasIva={hasIva}
                      hasBolsaFv={hasBolsaFv}
                      onDone={() => setAddingItem(false)}
                    />
                  )}
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
            {!addingItem && (
              <div className="p-3 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setAddingItem(true)}
                  data-testid="button-add-item"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Agregar producto
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete order dialog */}
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

      {/* Delete item dialog (approved orders only) */}
      <AlertDialog open={deleteItemId !== null} onOpenChange={(o) => !o && setDeleteItemId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar línea?</AlertDialogTitle>
            <AlertDialogDescription>
              El pedido está aprobado. Eliminar esta línea restaurará el stock del producto automáticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteItemId && deleteItemMutation.mutate(deleteItemId)}
              disabled={deleteItemMutation.isPending}
            >
              {deleteItemMutation.isPending ? "Eliminando..." : "Eliminar línea"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
