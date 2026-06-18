import { useState, useMemo, Fragment } from "react";
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
import { Search, Package, Plus, CheckCircle2, AlertCircle, Warehouse, ChevronDown, ChevronUp, History, TrendingDown, TrendingUp, Trash2, RefreshCw, AlertTriangle } from "lucide-react";
import type { Product, ProductUnit } from "@shared/schema";
import { PRODUCT_CATEGORIES } from "@shared/schema";
import { parseQuantityAndUnit } from "@/lib/parseQuantityAndUnit";
import { normalize } from "@/lib/orderParser";
import { fmtMiles } from "@/lib/format";

const fmt = fmtMiles;
function formatDate(s: string) {
  try { return new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" }); }
  catch { return s.slice(0, 10); }
}
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

type PurchaseHistoryEntry = {
  purchaseDate: string;
  supplierName: string;
  purchaseQty: string | null;
  purchaseUnit: string | null;
  weightPerPackage: string | null;
  quantity: string;
  costPerUnit: string;
  costPerPurchaseUnit: string | null;
};

const MOTIVOS = ["Merma", "Rinde", "Corrección", "Otro"] as const;
type Motivo = typeof MOTIVOS[number];

// ─── Date helpers ─────────────────────────────────────────────────────────────
function localStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function todayStr() {
  return localStr(new Date());
}
function weekStartStr() {
  const d = new Date();
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  return localStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff));
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
  const [newCost, setNewCost] = useState("");
  const [newWpu, setNewWpu] = useState("");

  const finalNotes = reason === "Otro" ? otherText.trim() : reason;

  const adjustMutation = useMutation({
    mutationFn: async (data: { adjustment: number; notes?: string; avgCost?: number; weightPerUnit?: number }) => {
      const res = await apiRequest("PATCH", `/api/product-units/${pu!.id}/adjust`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-movements"] });
      toast({ title: "Stock actualizado" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleClose = () => {
    setAdjustment("");
    setReason("Merma");
    setOtherText("");
    setNewCost("");
    setNewWpu("");
    onClose();
  };

  if (!pu) return null;
  const adj = parseFloat(adjustment);
  const currentStock = parseFloat(pu.stockQty as string);
  const currentCost = parseFloat(pu.avgCost as string);
  const currentWpu = parseFloat(pu.weightPerUnit as string ?? "0");
  const newStock = isNaN(adj) ? currentStock : currentStock + adj;
  const hasValidAdj = !!adjustment && !isNaN(adj);
  const hasValidCost = !!newCost && !isNaN(parseFloat(newCost)) && parseFloat(newCost) >= 0;
  const hasValidWpu = !!newWpu && !isNaN(parseFloat(newWpu)) && parseFloat(newWpu) > 0;
  const isDisabled =
    (!hasValidAdj && !hasValidCost && !hasValidWpu) ||
    adjustMutation.isPending ||
    (hasValidAdj && reason === "Otro" && !otherText.trim());

  const handleConfirm = () => {
    const payload: { adjustment: number; notes?: string; avgCost?: number; weightPerUnit?: number } = {
      adjustment: hasValidAdj ? adj : 0,
    };
    if (hasValidAdj) payload.notes = finalNotes || undefined;
    if (hasValidCost) payload.avgCost = parseFloat(newCost);
    if (hasValidWpu) payload.weightPerUnit = parseFloat(newWpu);
    adjustMutation.mutate(payload);
  };

  return (
    <Dialog open={!!pu} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Ajustar Stock</DialogTitle>
          <DialogDescription>{pu.product.name} · {pu.unit}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">

          {/* ── Cantidad ── */}
          <div className="space-y-3 pb-3 border-b border-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Stock actual:</span>
              <span className="font-semibold">{fmtStock(currentStock)} {pu.unit}</span>
            </div>
            <div className="space-y-1.5">
              <Label>Ajuste de cantidad (+/-)</Label>
              <Input type="number" value={adjustment} onChange={(e) => setAdjustment(e.target.value)} placeholder="Ej: 10 o -3" />
            </div>
            {hasValidAdj && (
              <p className="text-xs text-muted-foreground">Nuevo stock: <strong>{fmtStock(newStock)}</strong> {pu.unit}</p>
            )}
            {hasValidAdj && (
              <>
                <div className="space-y-1.5">
                  <Label>Motivo</Label>
                  <Select value={reason} onValueChange={(v) => setReason(v as Motivo)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Merma">Merma — pérdida natural del producto</SelectItem>
                      <SelectItem value="Rinde">Rinde — se obtuvo más de lo esperado</SelectItem>
                      <SelectItem value="Corrección">Corrección — ajuste de conteo, sin impacto en informes</SelectItem>
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
              </>
            )}
          </div>

          {/* ── Costo ── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Costo promedio</Label>
              <span className="text-xs text-muted-foreground">
                {currentCost > 0 ? `Actual: $${fmt(currentCost)}` : <span className="text-yellow-600 font-medium">Sin costo cargado</span>}
              </span>
            </div>
            <Input
              type="number"
              value={newCost}
              onChange={(e) => setNewCost(e.target.value)}
              placeholder={currentCost > 0 ? `$${fmt(currentCost)}` : "Ingresar costo..."}
              min={0}
            />
          </div>

          {/* ── Unidades por envase ── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Unidades por envase (opcional)</Label>
              <span className="text-xs text-muted-foreground">
                {currentWpu > 0
                  ? `Actual: ${fmtStock(currentWpu)} ${pu.unit}/cajón`
                  : <span className="text-yellow-600 font-medium">Sin configurar</span>}
              </span>
            </div>
            <Input
              type="number"
              value={newWpu}
              onChange={(e) => setNewWpu(e.target.value)}
              placeholder={currentWpu > 0 ? `${fmtStock(currentWpu)}` : "Ej: 30 (para cajón de 30 unidades)"}
              min={0}
            />
            <p className="text-xs text-muted-foreground">
              Cuántas {pu.unit} hay en un cajón/bolsa. Permite calcular el costo al vender por envase.
            </p>
          </div>

        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={isDisabled}>
            {adjustMutation.isPending ? "Guardando..." : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reset Stock Dialog ───────────────────────────────────────────────────────
function ResetStockDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"merma" | "silent" | null>(null);

  const resetMutation = useMutation({
    mutationFn: (asMerma: boolean) =>
      apiRequest("POST", "/api/stock/reset", { asMerma }).then((r) => r.json()),
    onSuccess: (data: { affected: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-movements"] });
      toast({
        title: "Stock limpiado",
        description: `${data.affected} producto${data.affected !== 1 ? "s" : ""} llevado${data.affected !== 1 ? "s" : ""} a 0${mode === "merma" ? " — registrado como merma" : ""}`,
      });
      setMode(null);
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleClose = () => { setMode(null); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" /> Limpiar Stock
          </DialogTitle>
          <DialogDescription>
            Esta acción pondrá en <strong>0</strong> el stock de todos los productos.
            ¿Querés registrarlo como merma o solo limpiar sin registrar?
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 mt-2">
          <button
            onClick={() => setMode("merma")}
            className={`rounded-lg border-2 p-3 text-left transition-colors focus:outline-none ${
              mode === "merma"
                ? "border-destructive bg-destructive/5"
                : "border-border hover:border-destructive/50 hover:bg-muted/40"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className={`h-4 w-4 ${mode === "merma" ? "text-destructive" : "text-muted-foreground"}`} />
              <span className="text-sm font-semibold">Como merma</span>
            </div>
            <p className="text-xs text-muted-foreground">Registra la baja en el historial de ajustes con motivo "Merma"</p>
          </button>
          <button
            onClick={() => setMode("silent")}
            className={`rounded-lg border-2 p-3 text-left transition-colors focus:outline-none ${
              mode === "silent"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/40"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Trash2 className={`h-4 w-4 ${mode === "silent" ? "text-primary" : "text-muted-foreground"}`} />
              <span className="text-sm font-semibold">Solo limpiar</span>
            </div>
            <p className="text-xs text-muted-foreground">Pone el stock en 0 sin registrar ningún movimiento</p>
          </button>
        </div>

        <DialogFooter className="gap-2 mt-2">
          <Button variant="outline" onClick={handleClose}>Cancelar</Button>
          <Button
            variant="destructive"
            disabled={!mode || resetMutation.isPending}
            onClick={() => mode && resetMutation.mutate(mode === "merma")}
          >
            {resetMutation.isPending ? "Limpiando..." : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Adjustment History Section ───────────────────────────────────────────────
function AdjustmentHistory() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [motiveFilter, setMotiveFilter] = useState<"all" | Motivo>("all");
  const [dateFrom, setDateFrom] = useState(monthStartStr);
  const [dateTo, setDateTo] = useState(todayStr);
  const [revertTarget, setRevertTarget] = useState<AdjustmentMovement | null>(null);
  const [revertQty, setRevertQty] = useState("");

  // Ventana de reversión: hoy o ayer (fechas UTC, igual que como se muestran)
  const todayISO = new Date().toISOString().slice(0, 10);
  const yestISO = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const isRevertible = (m: AdjustmentMovement) => {
    if (m.notes !== "Merma" && m.notes !== "Rinde") return false;
    const d = m.createdAt.slice(0, 10);
    return d === todayISO || d === yestISO;
  };

  const { data: movements = [], isLoading } = useQuery<AdjustmentMovement[]>({
    queryKey: ["/api/stock-movements"],
    enabled: open,
    staleTime: 30_000,
  });

  const revertMut = useMutation({
    mutationFn: ({ id, qty }: { id: number; qty: number }) =>
      apiRequest("POST", `/api/stock-movements/${id}/revert`, { qty }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-units"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Ajuste revertido" });
      setRevertTarget(null);
      setRevertQty("");
    },
    onError: (e: any) => toast({ title: "No se pudo revertir", description: e?.message ?? "Error", variant: "destructive" }),
  });

  const openRevert = (m: AdjustmentMovement) => { setRevertTarget(m); setRevertQty(parseFloat(m.quantity).toString()); };

  // Apply date + motive filters
  const filtered = useMemo(() => {
    return movements.filter((m) => {
      const date = m.createdAt.slice(0, 10);
      if (date < dateFrom || date > dateTo) return false;
      if (motiveFilter === "all") return true;
      const note = m.notes ?? "";
      if (motiveFilter === "Otro") return note !== "Merma" && note !== "Rinde" && note !== "Corrección";
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
    <>
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
                            const isCorreccion = m.notes === "Corrección";
                            const isReverted = m.notes === "REVERTIDO";
                            const isReversion = (m.notes ?? "").startsWith("Reversión");
                            const revertible = isRevertible(m);
                            return (
                              <tr key={m.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                                <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{formatDate(m.createdAt)}</td>
                                <td className="py-2 px-3 font-medium">{m.productName}</td>
                                <td className="py-2 px-3">
                                  <Badge variant="secondary" className="text-[10px]">{m.unit}</Badge>
                                </td>
                                <td className={`py-2 px-3 text-right font-semibold whitespace-nowrap ${isReverted ? "text-muted-foreground line-through" : isIn ? "text-green-600" : "text-red-600"}`}>
                                  {isIn ? "+" : "-"}{fmtStock(qty)}
                                </td>
                                <td className="py-2 px-3">
                                  <div className="flex items-center gap-1.5">
                                    {isReverted ? (
                                      <Badge variant="outline" className="text-[10px] text-muted-foreground border-muted-foreground/40 line-through">
                                        {m.movementType === "out" ? "Merma" : "Rinde"}
                                      </Badge>
                                    ) : isReversion ? (
                                      <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-400/40">Reversión</Badge>
                                    ) : isMerma ? (
                                      <Badge variant="outline" className="text-[10px] text-red-600 border-red-400/40">Merma</Badge>
                                    ) : isRinde ? (
                                      <Badge variant="outline" className="text-[10px] text-green-600 border-green-400/40">Rinde</Badge>
                                    ) : isCorreccion ? (
                                      <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-400/40">Corrección</Badge>
                                    ) : (
                                      <span className="text-muted-foreground">{m.notes || "—"}</span>
                                    )}
                                    {isReverted && <span className="text-[10px] text-muted-foreground italic">Revertido</span>}
                                    {revertible && (
                                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground" onClick={() => openRevert(m)}>
                                        <RefreshCw className="h-3 w-3 mr-1" /> Revertir
                                      </Button>
                                    )}
                                  </div>
                                </td>
                                <td className={`py-2 px-3 text-right font-semibold whitespace-nowrap ${isReverted ? "text-muted-foreground line-through" : pesos > 0 ? "text-green-600" : pesos < 0 ? "text-red-600" : "text-muted-foreground"}`}>
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

    {/* Diálogo: revertir ajuste (total o parcial) */}
    <Dialog open={revertTarget !== null} onOpenChange={(v) => { if (!v) { setRevertTarget(null); setRevertQty(""); } }}>
      <DialogContent className="max-w-sm">
        {revertTarget && (() => {
          const origQty = parseFloat(revertTarget.quantity);
          const tipo = revertTarget.notes === "Merma" ? "Merma" : "Rinde";
          const n = parseFloat(revertQty);
          const invalid = !(n > 0) || n > origQty + 1e-6;
          const esTotal = Math.abs(n - origQty) < 1e-6;
          return (
            <>
              <DialogHeader>
                <DialogTitle>Revertir {tipo} — {revertTarget.productName}</DialogTitle>
                <DialogDescription>
                  Ajuste original: {fmtStock(origQty)} {revertTarget.unit}. Indicá cuánto revertir (todo o una parte).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 py-1">
                <Label>¿Cuánto revertir? ({revertTarget.unit})</Label>
                <Input
                  type="number" min="0" max={origQty} step="0.01" autoFocus
                  value={revertQty}
                  onChange={(e) => setRevertQty(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Máximo {fmtStock(origQty)}. {esTotal ? "Reversión total (sale completa de los totales)." : !invalid ? `Reversión parcial: quedan ${fmtStock(origQty - n)} ${revertTarget.unit} de ${tipo.toLowerCase()}.` : ""}
                  {tipo === "Rinde" && " Si la mercadería ya se vendió/usó, se bloqueará."}
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setRevertTarget(null); setRevertQty(""); }}>Cancelar</Button>
                <Button
                  disabled={invalid || revertMut.isPending}
                  onClick={() => revertMut.mutate({ id: revertTarget.id, qty: n })}
                >
                  {revertMut.isPending ? "Revirtiendo..." : "Revertir"}
                </Button>
              </DialogFooter>
            </>
          );
        })()}
      </DialogContent>
    </Dialog>
    </>
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


function matchProduct(rawName: string, products: Product[]): Product | null {
  const normRaw = normalize(rawName);
  const rawWords = normRaw.split(" ").filter(Boolean);
  let best: { product: Product; score: number } | null = null;
  for (const p of products) {
    if (!p.active) continue;
    const normName = normalize(p.name);
    const pWords = normName.split(" ").filter(Boolean);
    let score = 0;
    if (normName === normRaw) {
      score = 1000;
    } else {
      const matched = rawWords.filter((w) => pWords.includes(w)).length;
      if (matched === 0) continue;
      // coverage of product words (0-1) + coverage of input words (0-1), scaled to 0-100
      // Prefers products with more matching words relative to their length.
      // "Cebolla Verdeo" (2/2 + 2/3 = 83) beats "Cebolla" (1/1 + 1/3 = 67) for input "cebolla de verdeo"
      score = (matched / pWords.length) * 50 + (matched / rawWords.length) * 50;
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
  const [resetOpen, setResetOpen] = useState(false);

  // Free-text entry state
  const [step, setStep] = useState<"input" | "preview">("input");
  const [rawText, setRawText] = useState("");
  const [staged, setStaged] = useState<StagedItem[]>([]);

  const { data: stockData, isLoading: stockLoading, isFetching: stockFetching } = useQuery<ProductUnitWithProduct[]>({
    queryKey: ["/api/products/stock"],
    queryFn: () => fetch("/api/products/stock?onlyInStock=false", { credentials: "include" }).then((r) => r.json()),
  });

  const { data: productsData } = useQuery<Product[]>({ queryKey: ["/api/products"] });

  const [expandedProductId, setExpandedProductId] = useState<number | null>(null);

  const { data: purchaseHistory = [], isLoading: phLoading } = useQuery<PurchaseHistoryEntry[]>({
    queryKey: ["/api/products", expandedProductId, "purchase-history"],
    queryFn: () =>
      fetch(`/api/products/${expandedProductId}/purchase-history`, { credentials: "include" }).then((r) => r.json()),
    enabled: expandedProductId !== null,
    staleTime: 60_000,
  });

  // null = cerrado | "step1" = ¿es stock total? | "step2b" = advertencia productos a zerear | "step2" = merma/rinde vs corrección
  const [intentDialog, setIntentDialog] = useState<null | "step1" | "step2b" | "step2">(null);
  const [productsToZero, setProductsToZero] = useState<ProductUnitWithProduct[]>([]);

  const onStockSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/products/stock"] });
    queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    queryClient.invalidateQueries({ queryKey: ["/api/stock-movements"] });
    toast({ title: "Stock actualizado", description: `${staged.filter((s) => s.status === "ok").length} producto(s) actualizados` });
    setStep("input"); setRawText(""); setStaged([]); setLoadOpen(false); setIntentDialog(null);
  };

  const addMutation = useMutation({
    mutationFn: (items: { productId: number; unit: string; qty: number }[]) =>
      apiRequest("POST", "/api/stock/adjust", { items }).then((r) => r.json()),
    onSuccess: onStockSuccess,
    onError: (e: any) => toast({ title: "Error al cargar stock", description: e.message, variant: "destructive" }),
  });

  const setMutation = useMutation({
    mutationFn: ({ items, mode }: { items: { productId: number; unit: string; qty: number }[]; mode: "merma_rinde" | "correction" }) =>
      apiRequest("POST", "/api/stock/set", { items, mode }).then((r) => r.json()),
    onSuccess: onStockSuccess,
    onError: (e: any) => toast({ title: "Error al cargar stock", description: e.message, variant: "destructive" }),
  });

  // Always hide zero-stock rows
  const filteredStock = useMemo(() => {
    const all = Array.isArray(stockData) ? stockData : [];
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

  const handleAssignProduct = (index: number, productId: string) => {
    const product = (productsData ?? []).find((p) => String(p.id) === productId);
    if (!product) return;
    setStaged((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, productId: product.id, productName: product.name, status: "ok" as const } : item,
      ),
    );
  };

  const handleConfirm = () => {
    const validItems = staged
      .filter((s) => s.status === "ok" && s.productId && s.qty && s.qty > 0)
      .map((s) => ({ productId: s.productId!, unit: s.unit!, qty: s.qty! }));
    if (validItems.length === 0) {
      toast({ title: "Sin ítems válidos", description: "Corrige los errores antes de confirmar.", variant: "destructive" });
      return;
    }
    setIntentDialog("step1");
  };

  const validItems = staged
    .filter((s) => s.status === "ok" && s.productId && s.qty && s.qty > 0)
    .map((s) => ({ productId: s.productId!, unit: s.unit!, qty: s.qty! }));

  const isMutating = addMutation.isPending || setMutation.isPending;

  const okCount = staged.filter((s) => s.status === "ok").length;
  const errCount = staged.filter((s) => s.status !== "ok").length;

  return (
    <Layout title="Stock">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Warehouse className="h-5 w-5 text-primary" /> Stock
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">Stock actual por producto y unidad</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
              onClick={() => setResetOpen(true)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Limpiar Stock
            </Button>
          </div>
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
                      Ingresá uno o varios productos por línea. Formato: <code className="bg-muted px-1 rounded">10 KG tomate</code> o <code className="bg-muted px-1 rounded">2 CAJON naranja</code>. Los cajones/bolsas se convierten automáticamente a la unidad base del producto.
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
                                {item.status === "no_qty" ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <Select
                                    value={item.productId ? String(item.productId) : undefined}
                                    onValueChange={(v) => handleAssignProduct(i, v)}
                                  >
                                    <SelectTrigger className={`h-7 text-xs w-48 ${item.status === "no_product" ? "border-destructive/50 text-destructive" : ""}`}>
                                      <SelectValue placeholder={`"${item.rawProductName}"`} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {(productsData ?? [])
                                        .filter((p) => p.active)
                                        .sort((a, b) => a.name.localeCompare(b.name))
                                        .map((p) => (
                                          <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                  </Select>
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
                        disabled={okCount === 0 || isMutating}
                        data-testid="button-confirm-stock"
                      >
                        {isMutating ? "Cargando..." : `Confirmar ${okCount} producto${okCount !== 1 ? "s" : ""}`}
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
                      <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wide text-xs">Costo/Cajón</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground uppercase tracking-wide text-xs">Valor stock</th>
                      <th className="py-2.5 px-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCats.map((cat) => (
                      <Fragment key={cat}>
                        <tr className="border-b border-border bg-muted/50">
                          <td colSpan={7} className="py-1.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                            {cat}
                          </td>
                        </tr>
                        {grouped[cat].map((pu) => {
                          const stock = parseFloat(pu.stockQty as string);
                          const cost = parseFloat(pu.avgCost as string);
                          const valorStock = stock * cost;
                          const isNegative = stock < 0;
                          const noCost = stock > 0 && cost === 0;
                          const wpu = parseFloat(pu.weightPerUnit as string ?? "0");
                          const isExpanded = expandedProductId === pu.product.id;
                          return (
                            <Fragment key={pu.id}>
                              <tr
                                className={`border-b border-border transition-colors cursor-pointer ${isNegative ? "bg-destructive/5" : noCost ? "bg-yellow-50/30 dark:bg-yellow-900/10" : isExpanded ? "bg-muted/40" : "hover:bg-muted/30"}`}
                                onClick={() => setExpandedProductId(isExpanded ? null : pu.product.id)}
                                data-testid={`row-stock-${pu.id}`}
                              >
                                <td className="py-2.5 px-4">
                                  <div className="flex items-center gap-2">
                                    <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-180" : ""}`} />
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
                                  {wpu > 0 && stock > 0 && (
                                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                                      (~{(stock / wpu).toFixed(1)} cajones)
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-right text-muted-foreground whitespace-nowrap">
                                  {cost > 0 ? `$${fmt(cost)}` : "—"}
                                </td>
                                <td className="py-2.5 px-4 text-right text-muted-foreground whitespace-nowrap">
                                  {wpu > 0 && cost > 0 ? `$${fmt(cost * wpu)}` : "—"}
                                </td>
                                <td className="py-2.5 px-4 text-right text-muted-foreground whitespace-nowrap">
                                  {cost > 0 ? `$${fmt(valorStock)}` : "—"}
                                </td>
                                <td className="py-2.5 px-4">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={(e) => { e.stopPropagation(); setAdjustTarget(pu); }}
                                    data-testid={`button-adjust-${pu.id}`}
                                  >
                                    Ajustar
                                  </Button>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="border-b border-border">
                                  <td colSpan={7} className="p-0">
                                    <div className="px-8 py-4 bg-muted/10 border-t border-border/40">
                                      {phLoading ? (
                                        <Skeleton className="h-20 w-full" />
                                      ) : purchaseHistory.length === 0 ? (
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
                                                  <th className="text-right pb-2 font-medium text-muted-foreground">Precio/cajón</th>
                                                  <th className="text-right pb-2 font-medium text-muted-foreground">Precio/KG</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {purchaseHistory.map((ph, i) => {
                                                  const wpp = parseFloat(ph.weightPerPackage ?? "0");
                                                  const cpp = parseFloat(ph.costPerPurchaseUnit ?? "0");
                                                  const cpu = parseFloat(ph.costPerUnit);
                                                  const pqty = ph.purchaseQty ? parseFloat(ph.purchaseQty) : null;
                                                  const qty = parseFloat(ph.quantity);
                                                  return (
                                                    <tr key={i} className="border-b border-border/50 last:border-0">
                                                      <td className="py-1.5 pr-4 text-muted-foreground whitespace-nowrap">{formatDate(ph.purchaseDate)}</td>
                                                      <td className="py-1.5 pr-4 font-medium">{ph.supplierName}</td>
                                                      <td className="py-1.5 pr-4 text-right whitespace-nowrap">
                                                        {pqty != null && ph.purchaseUnit
                                                          ? `${pqty} ${ph.purchaseUnit}`
                                                          : `${fmtStock(qty)} ${pu.unit}`}
                                                      </td>
                                                      <td className="py-1.5 pr-4 text-right whitespace-nowrap text-muted-foreground">
                                                        {wpp > 0 ? `${wpp} KG` : "—"}
                                                      </td>
                                                      <td className="py-1.5 pr-4 text-right whitespace-nowrap">
                                                        {cpp > 0 ? `$${fmt(cpp)}` : "—"}
                                                      </td>
                                                      <td className="py-1.5 text-right whitespace-nowrap font-semibold">
                                                        ${fmt(cpu)}
                                                      </td>
                                                    </tr>
                                                  );
                                                })}
                                              </tbody>
                                            </table>
                                          </div>
                                          <div className="flex flex-wrap gap-6 text-xs pt-2 border-t border-border/40">
                                            {cost > 0 && (
                                              <span className="text-muted-foreground">
                                                Costo prom. {pu.unit}: <strong className="text-foreground">${fmt(cost)}</strong>
                                              </span>
                                            )}
                                            {wpu > 0 && cost > 0 && (
                                              <span className="text-muted-foreground">
                                                Costo prom. cajón: <strong className="text-foreground">${fmt(cost * wpu)}</strong>
                                              </span>
                                            )}
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

        {/* ── ADJUSTMENT HISTORY ── */}
        <AdjustmentHistory />
      </div>

      <AdjustStockDialog pu={adjustTarget} onClose={() => setAdjustTarget(null)} />
      <ResetStockDialog open={resetOpen} onClose={() => setResetOpen(false)} />

      {/* ── Intent Dialog — step 1: ¿es stock total o suma? ── */}
      <Dialog open={intentDialog === "step1"} onOpenChange={(o) => { if (!o) setIntentDialog(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Cómo querés cargar el stock?</DialogTitle>
            <DialogDescription>
              Estás por cargar <strong>{okCount}</strong> producto{okCount !== 1 ? "s" : ""}. ¿Es el stock total actualizado o querés sumar al actual?
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 mt-2">
            <button
              onClick={() => { setIntentDialog(null); addMutation.mutate(validItems); }}
              className="rounded-lg border-2 border-border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40 focus:outline-none"
            >
              <div className="flex items-center gap-2 mb-1">
                <Plus className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">No, agregar al actual</span>
              </div>
              <p className="text-xs text-muted-foreground">Suma la cantidad ingresada al stock que ya figura en el sistema</p>
            </button>
            <button
              onClick={() => {
                const allStocked = (Array.isArray(stockData) ? stockData as ProductUnitWithProduct[] : [])
                  .filter(pu => parseFloat(pu.stockQty as string) > 0);
                const toZero = allStocked.filter(pu => !validItems.some(vi => vi.productId === pu.product.id));
                setProductsToZero(toZero);
                setIntentDialog(toZero.length > 0 ? "step2b" : "step2");
              }}
              className="rounded-lg border-2 border-border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40 focus:outline-none"
            >
              <div className="flex items-center gap-2 mb-1">
                <Warehouse className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Sí, reemplazar stock actual</span>
              </div>
              <p className="text-xs text-muted-foreground">El stock ingresado reemplaza al existente (ideal para inventario físico)</p>
            </button>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setIntentDialog(null)}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Intent Dialog — step 2b: advertencia de productos que quedarán en 0 ── */}
      <Dialog open={intentDialog === "step2b"} onOpenChange={(o) => { if (!o) setIntentDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Productos que quedarán en 0
            </DialogTitle>
            <DialogDescription>
              Los siguientes <strong>{productsToZero.length}</strong> productos tienen stock y <strong>no están en tu conteo</strong>. Al reemplazar quedarán en 0. Verificá que no falte ninguno antes de continuar.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-52 overflow-y-auto border border-border rounded-md">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Producto</th>
                  <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Stock actual</th>
                </tr>
              </thead>
              <tbody>
                {productsToZero.map(pu => (
                  <tr key={pu.id} className="border-b border-border last:border-0">
                    <td className="py-1.5 px-3 font-medium">{pu.product.name}</td>
                    <td className="py-1.5 px-3 text-right text-muted-foreground whitespace-nowrap">
                      {fmtStock(parseFloat(pu.stockQty as string))} {pu.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter className="flex gap-2 mt-2">
            <Button variant="outline" onClick={() => setIntentDialog("step1")}>Volver al conteo</Button>
            <Button
              variant="destructive"
              onClick={() => setIntentDialog("step2")}
            >
              Llevar {productsToZero.length} producto{productsToZero.length !== 1 ? "s" : ""} a 0 y continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Intent Dialog — step 2: ¿merma/rinde o corrección? ── */}
      <Dialog open={intentDialog === "step2"} onOpenChange={(o) => { if (!o) setIntentDialog(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Qué hacer con la diferencia?</DialogTitle>
            <DialogDescription>
              El sistema calculará la diferencia entre el stock actual y el nuevo y te dará opciones para registrarla.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 mt-2">
            <button
              onClick={() => { setIntentDialog(null); setMutation.mutate({ items: validItems, mode: "merma_rinde" }); }}
              className="rounded-lg border-2 border-border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40 focus:outline-none"
            >
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Calcular Merma / Rinde</span>
              </div>
              <p className="text-xs text-muted-foreground">Menos que antes → se registra como <strong>Merma</strong>. Más que antes → se registra como <strong>Rinde</strong>.</p>
            </button>
            <button
              onClick={() => { setIntentDialog(null); setMutation.mutate({ items: validItems, mode: "correction" }); }}
              className="rounded-lg border-2 border-border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40 focus:outline-none"
            >
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Solo corrección (sin impacto)</span>
              </div>
              <p className="text-xs text-muted-foreground">Reemplaza el stock sin registrar ningún movimiento. Ideal para correcciones de conteo.</p>
            </button>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setIntentDialog("step1")}>Volver</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
