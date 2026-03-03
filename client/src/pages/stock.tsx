import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { Search, Package, Plus, CheckCircle2, AlertCircle, Warehouse, ChevronDown, ChevronUp, History, TrendingDown, TrendingUp } from "lucide-react";
import type { Product, ProductUnit } from "@shared/schema";
import { PRODUCT_CATEGORIES } from "@shared/schema";
import { parseQuantityAndUnit } from "@/lib/parseQuantityAndUnit";

const fmt = (v: number) => Math.round(v).toLocaleString("es-MX");
const fmtStock = (v: number) => v.toLocaleString("es-MX", { maximumFractionDigits: 2 });
const fmtPesos = (v: number) => `${v >= 0 ? "+" : ""}$${fmt(Math.abs(v))}`;

type ProductUnitWithProduct = ProductUnit & { product: Product };

const CATEGORY_ORDER = [
  "Fruta", "Verdura", "Hortaliza Liviana", "Hortaliza Pesada", "Hongos/Hierbas", "Huevos",
];

type AdjustmentMovement = {
  id: number;
  productId: number;
  productName: string;
  category: string;
  unit: string;
  movementType: "in" | "out";
  quantity: string;
  avgCost: string | null;
  notes: string | null;
  createdAt: string;
};

const MOTIVOS = ["Merma", "Rinde", "Otro"] as const;
type Motivo = typeof MOTIVOS[number];

// ─── Date helpers ─────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function weekStartStr() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1)); // Monday
  return d.toISOString().slice(0, 10);
}
function monthStartStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// ─── Adjust Stock Modal ───────────────────────────────────────────────────────
function AdjustStockDialog({ pu, onClose }: { pu: ProductUnitWithProduct | null; onClose: () => void }) {
  const { toast } = useToast();
  const [adjustment, setAdjustment] = useState("");
  const [reason, setReason] = useState<Motivo>("Merma");
  const [otherText, setOtherText] = useState("");

  const finalNotes = reason === "Otro" ? otherText.trim() : reason;

  const adjustMutation = useMutation({
    mutationFn: async (data: { adjustment: number; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/product-units/${pu!.id}/adjust`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-movements"] });
      toast({ title: "Stock ajustado" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleClose = () => {
    setAdjustment("");
    setReason("Merma");
    setOtherText("");
    onClose();
  };

  if (!pu) return null;
  const adj = parseFloat(adjustment);
  const currentStock = parseFloat(pu.stockQty as string);
  const newStock = isNaN(adj) ? currentStock : currentStock + adj;

  return (
    <Dialog open={!!pu} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Ajustar Stock</DialogTitle>
          <DialogDescription>{pu.product.name} · {pu.unit}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Stock actual:</span>
            <span className="font-semibold">{fmtStock(currentStock)} {pu.unit}</span>
          </div>
          <div className="space-y-1.5">
            <Label>Ajuste (+/-)</Label>
            <Input type="number" value={adjustment} onChange={(e) => setAdjustment(e.target.value)} placeholder="Ej: 10 o -3" />
          </div>
          <p className="text-xs text-muted-foreground">Nuevo stock: <strong>{fmtStock(newStock)}</strong> {pu.unit}</p>
          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as Motivo)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Merma">Merma — pérdida natural del producto</SelectItem>
                <SelectItem value="Rinde">Rinde — se obtuvo más de lo esperado</SelectItem>
                <SelectItem value="Otro">Otro — especificar</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {reason === "Otro" && (
            <div className="space-y-1.5">
              <Label>Detalle</Label>
              <Input value={otherText} onChange={(e) => setOtherText(e.target.value)} placeholder="Describir el motivo..." />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>Cancelar</Button>
          <Button
            onClick={() => adjustMutation.mutate({ adjustment: adj, notes: finalNotes || undefined })}
            disabled={!adjustment || isNaN(adj) || adjustMutation.isPending || (reason === "Otro" && !otherText.trim())}
          >
            {adjustMutation.isPending ? "Ajustando..." : "Confirmar ajuste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Adjustment History Section ───────────────────────────────────────────────
function AdjustmentHistory() {
  const [open, setOpen] = useState(false);
  const [motiveFilter, setMotiveFilter] = useState<"all" | Motivo>("all");
  const [dateFrom, setDateFrom] = useState(monthStartStr);
  const [dateTo, setDateTo] = useState(todayStr);

  const { data: movements = [], isLoading } = useQuery<AdjustmentMovement[]>({
    queryKey: ["/api/stock-movements"],
    enabled: open,
    staleTime: 30_000,
  });

  // Apply date + motive filters
  const filtered = useMemo(() => {
    return movements.filter((m) => {
      const date = m.createdAt.slice(0, 10);
      if (date < dateFrom || date > dateTo) return false;
      if (motiveFilter === "all") return true;
      const note = m.notes ?? "";
      if (motiveFilter === "Otro") return note !== "Merma" && note !== "Rinde";
      return note === motiveFilter;
    });
  }, [movements, dateFrom, dateTo, motiveFilter]);

  // Peso impact: positive = ganado, negative = perdido
  const pesoImpact = (m: AdjustmentMovement) => {
    const qty = parseFloat(m.quantity);
    const cost = parseFloat(m.avgCost ?? "0");
    const signed = m.movementType === "in" ? qty : -qty;
    return signed * cost;
  };

  // Totals (within current date range, all motivos)
  const dateFiltered = useMemo(() =>
    movements.filter((m) => {
      const date = m.createdAt.slice(0, 10);
      return date >= dateFrom && date <= dateTo;
    }),
    [movements, dateFrom, dateTo]
  );

  const totalMermaPesos = useMemo(() =>
    dateFiltered.filter((m) => m.notes === "Merma").reduce((acc, m) => acc + pesoImpact(m), 0),
    [dateFiltered]
  );
  const totalRindePesos = useMemo(() =>
    dateFiltered.filter((m) => m.notes === "Rinde").reduce((acc, m) => acc + pesoImpact(m), 0),
    [dateFiltered]
  );

  // Group by category
  const grouped = useMemo(() => {
    const g: Record<string, AdjustmentMovement[]> = {};
    for (const m of filtered) {
      const cat = m.category ?? "Sin categoría";
      if (!g[cat]) g[cat] = [];
      g[cat].push(m);
    }
    return g;
  }, [filtered]);

  const sortedCats = [
    ...CATEGORY_ORDER.filter((c) => grouped[c]?.length > 0),
    ...Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c) && grouped[c]?.length > 0),
  ];

  const formatDate = (s: string) => {
    try { return new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" }); }
    catch { return s.slice(0, 10); }
  };

  const setQuick = (preset: "today" | "week" | "month") => {
    const to = todayStr();
    setDateTo(to);
    if (preset === "today") setDateFrom(to);
    else if (preset === "week") setDateFrom(weekStartStr());
    else setDateFrom(monthStartStr());
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 rounded-t-lg transition-colors select-none">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span className="flex items-center gap-2">
                <History className="h-4 w-4" /> Historial de Ajustes
              </span>
              {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">

            {/* ── Filters row ── */}
            <div className="flex flex-wrap gap-3 items-end">
              {/* Date pickers */}
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium">Desde</label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs w-36" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium">Hasta</label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs w-36" />
                </div>
              </div>
              {/* Quick presets */}
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setQuick("today")}>Hoy</Button>
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setQuick("week")}>Esta semana</Button>
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setQuick("month")}>Este mes</Button>
              </div>
              {/* Motive filter */}
              <div className="flex gap-1 ml-auto">
                {(["all", ...MOTIVOS] as const).map((f) => (
                  <Button
                    key={f}
                    size="sm"
                    variant={motiveFilter === f ? "default" : "outline"}
                    className="h-8 text-xs"
                    onClick={() => setMotiveFilter(f)}
                  >
                    {f === "all" ? "Todos" : f}
                  </Button>
                ))}
              </div>
            </div>

            {/* ── Totals chips ── */}
            {dateFiltered.length > 0 && (
              <div className="flex gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 px-3 py-1.5 rounded-full border border-red-200 dark:border-red-800">
                  <TrendingDown className="h-3 w-3" />
                  Total Merma: <strong>{fmtPesos(totalMermaPesos)}</strong>
                </div>
                <div className="flex items-center gap-1.5 text-xs bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-full border border-green-200 dark:border-green-800">
                  <TrendingUp className="h-3 w-3" />
                  Total Rinde: <strong>{fmtPesos(totalRindePesos)}</strong>
                </div>
              </div>
            )}

            {/* ── Table ── */}
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Sin ajustes en el período seleccionado.</p>
            ) : (
              <div className="overflow-x-auto border border-border rounded-md">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Fecha</th>
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Producto</th>
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Unidad</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Ajuste</th>
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Motivo</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Resultado ($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCats.map((cat) => {
                      const rows = grouped[cat];
                      const catMerma = rows.filter((m) => m.notes === "Merma").reduce((a, m) => a + pesoImpact(m), 0);
                      const catRinde = rows.filter((m) => m.notes === "Rinde").reduce((a, m) => a + pesoImpact(m), 0);
                      return (
                        <>
                          {/* Category header */}
                          <tr key={`cat-${cat}`} className="border-b border-border bg-muted/50">
                            <td colSpan={4} className="py-1.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                              {cat}
                            </td>
                            <td colSpan={2} className="py-1.5 px-3 text-right text-xs text-muted-foreground">
                              {catMerma !== 0 && (
                                <span className="text-red-600 mr-2">Merma: {fmtPesos(catMerma)}</span>
                              )}
                              {catRinde !== 0 && (
                                <span className="text-green-600">Rinde: {fmtPesos(catRinde)}</span>
                              )}
                            </td>
                          </tr>
                          {/* Category rows */}
                          {rows.map((m) => {
                            const qty = parseFloat(m.quantity);
                            const isIn = m.movementType === "in";
                            const pesos = pesoImpact(m);
                            const isMerma = m.notes === "Merma";
                            const isRinde = m.notes === "Rinde";
                            return (
                              <tr key={m.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                                <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{formatDate(m.createdAt)}</td>
                                <td className="py-2 px-3 font-medium">{m.productName}</td>
                                <td className="py-2 px-3">
                                  <Badge variant="secondary" className="text-[10px]">{m.unit}</Badge>
                                </td>
                                <td className={`py-2 px-3 text-right font-semibold whitespace-nowrap ${isIn ? "text-green-600" : "text-red-600"}`}>
                                  {isIn ? "+" : "-"}{fmtStock(qty)}
                                </td>
                                <td className="py-2 px-3">
                                  {isMerma ? (
                                    <Badge variant="outline" className="text-[10px] text-red-600 border-red-400/40">Merma</Badge>
                                  ) : isRinde ? (
                                    <Badge variant="outline" className="text-[10px] text-green-600 border-green-400/40">Rinde</Badge>
                                  ) : (
                                    <span className="text-muted-foreground">{m.notes || "—"}</span>
                                  )}
                                </td>
                                <td className={`py-2 px-3 text-right font-semibold whitespace-nowrap ${pesos > 0 ? "text-green-600" : pesos < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                                  {parseFloat(m.avgCost ?? "0") > 0 ? fmtPesos(pesos) : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ─── Category Filter Bar ──────────────────────────────────────────────────────
function CategoryFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant={value === "all" ? "default" : "outline"} className="h-7 text-xs" onClick={() => onChange("all")}>Todas</Button>
      {PRODUCT_CATEGORIES.map((cat) => (
        <Button key={cat} size="sm" variant={value === cat ? "default" : "outline"} className="h-7 text-xs" onClick={() => onChange(cat)}>{cat}</Button>
      ))}
    </div>
  );
}

// ─── Staged item from free-text parsing ──────────────────────────────────────
type StagedItem = {
  raw: string;
  qty: number | null;
  unit: string | null;
  rawProductName: string;
  productId: number | null;
  productName: string | null;
  status: "ok" | "no_product" | "no_qty";
};

function normalize(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function matchProduct(rawName: string, products: Product[]): Product | null {
  const normRaw = normalize(rawName);
  const rawWords = normRaw.split(" ").filter(Boolean);
  let best: { product: Product; score: number } | null = null;
  for (const p of products) {
    if (!p.active) continue;
    const normName = normalize(p.name);
    const pWords = normName.split(" ").filter(Boolean);
    let score = 0;
    if (normName === normRaw) score = 100;
    else if (normName.includes(normRaw) || normRaw.includes(normName)) score = 80;
    else {
      const hits = rawWords.filter((w) => pWords.includes(w)).length;
      if (hits === rawWords.length) score = 60 + hits;
      else if (hits > 0) score = 10 + hits;
    }
    if (score > 0 && (!best || score > best.score)) best = { product: p, score };
  }
  return best && best.score >= 60 ? best.product : null;
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function StockPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [adjustTarget, setAdjustTarget] = useState<ProductUnitWithProduct | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);

  // Free-text entry state
  const [step, setStep] = useState<"input" | "preview">("input");
  const [rawText, setRawText] = useState("");
  const [staged, setStaged] = useState<StagedItem[]>([]);

  const { data: stockData, isLoading: stockLoading, isFetching: stockFetching } = useQuery<ProductUnitWithProduct[]>({
    queryKey: ["/api/products/stock"],
    queryFn: () => fetch("/api/products/stock?onlyInStock=false", { credentials: "include" }).then((r) => r.json()),
  });

  const { data: productsData } = useQuery<Product[]>({ queryKey: ["/api/products"] });

  const submitMutation = useMutation({
    mutationFn: (items: { productId: number; unit: string; qty: number }[]) =>
      apiRequest("POST", "/api/stock/adjust", { items }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Stock actualizado", description: `${staged.filter((s) => s.status === "ok").length} producto(s) actualizados` });
      setStep("input");
      setRawText("");
      setStaged([]);
      setLoadOpen(false);
    },
    onError: (e: any) => toast({ title: "Error al cargar stock", description: e.message, variant: "destructive" }),
  });

  // Always hide zero-stock rows
  const filteredStock = useMemo(() => {
    const all = stockData ?? [];
    return all.filter((pu) => {
      const matchName = pu.product.name.toLowerCase().includes(search.toLowerCase());
      const matchCat = categoryFilter === "all" || pu.product.category === categoryFilter;
      const hasStock = parseFloat(pu.stockQty as string) > 0;
      return matchName && matchCat && hasStock;
    });
  }, [stockData, search, categoryFilter]);

  const grouped = useMemo(() => {
    const g: Record<string, ProductUnitWithProduct[]> = {};
    for (const pu of filteredStock) {
      const cat = pu.product.category ?? "Sin categoría";
      if (!g[cat]) g[cat] = [];
      g[cat].push(pu);
    }
    return g;
  }, [filteredStock]);

  const sortedCats = [
    ...CATEGORY_ORDER.filter((c) => grouped[c]?.length > 0),
    ...Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c) && grouped[c]?.length > 0),
  ];

  const handlePreview = () => {
    if (!rawText.trim()) return;
    const lines = rawText.split("\n").filter((l) => l.trim());
    const products = (productsData ?? []).filter((p) => p.active);
    const items: StagedItem[] = lines.map((line) => {
      const { quantity, unit, rawProductName } = parseQuantityAndUnit(line.trim());
      if (!quantity || quantity <= 0) {
        return { raw: line, qty: null, unit: null, rawProductName: line.trim(), productId: null, productName: null, status: "no_qty" as const };
      }
      const matched = matchProduct(rawProductName, products);
      if (!matched) {
        return { raw: line, qty: quantity, unit: unit ?? "KG", rawProductName, productId: null, productName: null, status: "no_product" as const };
      }
      return { raw: line, qty: quantity, unit: unit ?? "KG", rawProductName, productId: matched.id, productName: matched.name, status: "ok" as const };
    });
    setStaged(items);
    setStep("preview");
  };

  const handleConfirm = () => {
    const validItems = staged
      .filter((s) => s.status === "ok" && s.productId && s.qty && s.qty > 0)
      .map((s) => ({ productId: s.productId!, unit: s.unit!, qty: s.qty! }));
    if (validItems.length === 0) {
      toast({ title: "Sin ítems válidos", description: "Corrige los errores antes de confirmar.", variant: "destructive" });
      return;
    }
    submitMutation.mutate(validItems);
  };

  const okCount = staged.filter((s) => s.status === "ok").length;
  const errCount = staged.filter((s) => s.status !== "ok").length;

  return (
    <Layout title="Stock">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Warehouse className="h-5 w-5 text-primary" /> Stock
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">Stock actual por producto y unidad</p>
        </div>

        {/* ── FREE-TEXT STOCK ENTRY (collapsible) ── */}
        <Collapsible open={loadOpen} onOpenChange={(o) => { setLoadOpen(o); if (!o) { setStep("input"); setRawText(""); setStaged([]); } }}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 rounded-t-lg transition-colors select-none">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Plus className="h-4 w-4" /> Cargar Stock
                  </span>
                  {loadOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent>
                {step === "input" ? (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Ingresá uno o varios productos por línea. Formato: <code className="bg-muted px-1 rounded">10 KG tomate</code> o <code className="bg-muted px-1 rounded">2 CAJON naranja</code>
                    </p>
                    <Textarea
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                      placeholder={"10 KG tomate\n2 CAJON naranja\n5 bolsa papa"}
                      rows={3}
                      className="font-mono text-sm"
                      data-testid="textarea-stock-entry"
                    />
                    <div className="flex justify-end gap-2">
                      <Button onClick={handlePreview} disabled={!rawText.trim()} data-testid="button-preview-stock">
                        Previsualizar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex gap-2 flex-wrap">
                      {okCount > 0 && (
                        <div className="flex items-center gap-1.5 text-xs bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 px-2.5 py-1 rounded-full border border-green-200 dark:border-green-800">
                          <CheckCircle2 className="h-3 w-3" /> {okCount} OK
                        </div>
                      )}
                      {errCount > 0 && (
                        <div className="flex items-center gap-1.5 text-xs bg-destructive/10 text-destructive px-2.5 py-1 rounded-full border border-destructive/20">
                          <AlertCircle className="h-3 w-3" /> {errCount} con error
                        </div>
                      )}
                    </div>

                    <div className="overflow-x-auto border border-border rounded-md">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border bg-muted/40">
                            <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Texto original</th>
                            <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Cant.</th>
                            <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Unidad</th>
                            <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Producto</th>
                            <th className="text-center py-2 px-3 font-semibold text-muted-foreground">Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {staged.map((item, i) => (
                            <tr key={i} className={`border-b border-border last:border-0 ${item.status !== "ok" ? "bg-destructive/5" : ""}`}>
                              <td className="py-2 px-3 text-muted-foreground italic">{item.raw}</td>
                              <td className="py-2 px-3 text-right font-semibold">
                                {item.qty != null ? item.qty : <span className="text-destructive">—</span>}
                              </td>
                              <td className="py-2 px-3">
                                {item.unit ? (
                                  <Badge variant="secondary" className="text-[10px]">{item.unit}</Badge>
                                ) : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="py-2 px-3 font-medium">
                                {item.productName ?? (
                                  <span className="text-destructive">No encontrado: "{item.rawProductName}"</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-center">
                                {item.status === "ok" ? (
                                  <Badge variant="outline" className="text-[10px] text-green-600 border-green-500/40">OK</Badge>
                                ) : item.status === "no_qty" ? (
                                  <Badge variant="destructive" className="text-[10px]">Sin cantidad</Badge>
                                ) : (
                                  <Badge variant="destructive" className="text-[10px]">Sin producto</Badge>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {errCount > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Los ítems con error serán ignorados. Solo se cargarán los {okCount} ítems marcados como OK.
                      </p>
                    )}

                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setStep("input")}>Volver</Button>
                      <Button
                        onClick={handleConfirm}
                        disabled={okCount === 0 || submitMutation.isPending}
                        data-testid="button-confirm-stock"
                      >
                        {submitMutation.isPending ? "Cargando..." : `Confirmar ${okCount} producto${okCount !== 1 ? "s" : ""}`}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* ── FILTERS & SEARCH ── */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar producto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-stock"
            />
          </div>
          <CategoryFilter value={categoryFilter} onChange={setCategoryFilter} />
        </div>

        {/* ── STOCK TABLE ── */}
        {stockLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : filteredStock.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
              <Package className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Sin stock disponible.</p>
            </CardContent>
          </Card>
        ) : (
          <Card className={stockFetching && !stockLoading ? "opacity-60 transition-opacity" : ""}>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-border bg-muted/40">
                      <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wide text-xs">Producto</th>
                      <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wide text-xs">Unidad</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wide text-xs">Stock</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wide text-xs">Costo prom.</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wide text-xs">Valor stock</th>
                      <th className="py-2.5 px-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCats.map((cat) => (
                      <>
                        <tr key={`cat-${cat}`} className="border-b border-border bg-muted/50">
                          <td colSpan={6} className="py-1.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                            {cat}
                          </td>
                        </tr>
                        {grouped[cat].map((pu) => {
                          const stock = parseFloat(pu.stockQty as string);
                          const cost = parseFloat(pu.avgCost as string);
                          const valorStock = stock * cost;
                          const isNegative = stock < 0;
                          const noCost = stock > 0 && cost === 0;
                          return (
                            <tr
                              key={pu.id}
                              className={`border-b border-border last:border-0 transition-colors ${isNegative ? "bg-destructive/5" : noCost ? "bg-yellow-50/30 dark:bg-yellow-900/10" : "hover:bg-muted/30"}`}
                              data-testid={`row-stock-${pu.id}`}
                            >
                              <td className="py-2.5 px-4">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-foreground">{pu.product.name}</span>
                                  {isNegative && <Badge variant="destructive" className="text-[9px] py-0 px-1">Negativo</Badge>}
                                  {noCost && <Badge variant="outline" className="text-[9px] py-0 px-1 text-yellow-600 border-yellow-500/40">Sin costo</Badge>}
                                </div>
                              </td>
                              <td className="py-2.5 px-4">
                                <Badge variant="secondary" className="text-[10px]">{pu.unit}</Badge>
                              </td>
                              <td className={`py-2.5 px-4 text-right font-semibold whitespace-nowrap ${isNegative ? "text-destructive" : "text-foreground"}`}>
                                {fmtStock(stock)}
                                {(() => {
                                  const wpu = parseFloat(pu.weightPerUnit as string ?? "0");
                                  if (wpu > 0 && stock > 0) {
                                    return (
                                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                                        (~{(stock / wpu).toFixed(1)} cajones)
                                      </span>
                                    );
                                  }
                                  return null;
                                })()}
                              </td>
                              <td className="py-2.5 px-4 text-right text-muted-foreground whitespace-nowrap">
                                {cost > 0 ? `$${fmt(cost)}` : "—"}
                              </td>
                              <td className="py-2.5 px-4 text-right text-muted-foreground whitespace-nowrap">
                                {cost > 0 ? `$${fmt(valorStock)}` : "—"}
                              </td>
                              <td className="py-2.5 px-4">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => setAdjustTarget(pu)}
                                  data-testid={`button-adjust-${pu.id}`}
                                >
                                  Ajustar
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── ADJUSTMENT HISTORY ── */}
        <AdjustmentHistory />
      </div>

      <AdjustStockDialog pu={adjustTarget} onClose={() => setAdjustTarget(null)} />
    </Layout>
  );
}
