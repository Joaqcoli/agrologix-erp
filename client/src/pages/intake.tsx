import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { ArrowLeft, Sparkles, CheckCircle2, AlertTriangle, XCircle, Search, ChevronRight } from "lucide-react";
import { parseOrderTextLocal, type ParsedLine, normalize } from "@/lib/orderParser";
import type { Customer, Product, ProductUnit } from "@shared/schema";
import { canonicalizeUnit, ALL_CANONICAL_UNITS } from "@shared/units";

const STATUS_ICON = {
  ok: <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />,
  ambiguous: <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />,
  no_product: <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />,
  no_qty: <XCircle className="h-4 w-4 text-destructive shrink-0" />,
};

const STATUS_LABEL: Record<string, string> = {
  ok: "OK",
  ambiguous: "Ambiguo",
  no_product: "Producto no encontrado",
  no_qty: "Sin cantidad",
};

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ok: "default",
  ambiguous: "outline",
  no_product: "secondary",
  no_qty: "destructive",
};

// ── Fuzzy product search (MEJORA 3) ────────────────────────────────────────────

// Prepositions and articles that carry no product identity
const STOP_WORDS = new Set(["de", "del", "la", "el", "lo", "los", "las", "un", "una", "y"]);

function fuzzyScore(query: string, target: string): number {
  const q = normalize(query);
  const t = normalize(target);
  if (!q) return 0;
  if (t === q) return 100;
  // Full-string includes only when query is long enough — prevents short words like "de", "a"
  // matching anything that contains them (e.g. "de" → "brote de alfalfa")
  if (q.length >= 4 && t.includes(q)) return 80;
  // Word-level matching — filter stop words and short words to avoid false positives
  const qWords = q.split(" ").filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  const tWords = t.split(" ").filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  if (qWords.length === 0 || tWords.length === 0) return 0;
  let score = 0;
  for (const qw of qWords) {
    if (tWords.some((tw) => tw === qw)) score += 10;
    else if (tWords.some((tw) => tw.startsWith(qw) || qw.startsWith(tw))) score += 5;
    // Substring only when both the query word AND match are long enough to be meaningful
    else if (qw.length >= 4 && tWords.some((tw) => tw.length >= 4 && (tw.includes(qw) || qw.includes(tw)))) score += 2;
  }
  return score;
}

function FuzzyProductPicker({
  products,
  initialQuery,
  selectedId,
  onSelect,
  onCustom,
}: {
  products: Array<{ id: number; name: string; sku?: string | null }>;
  initialQuery: string;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCustom: (name: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const ranked = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return [...products]
      .map((p) => ({ ...p, score: fuzzyScore(q, p.name) }))
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }, [query, products]);

  const selected = selectedId ? products.find((p) => p.id === selectedId) : null;

  if (selected && !open) {
    return (
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs font-medium">{selected.name}</span>
        <button
          type="button"
          onClick={() => { setOpen(true); setQuery(""); }}
          className="text-[10px] text-muted-foreground underline"
        >cambiar</button>
      </div>
    );
  }

  return (
    <div className="w-full mt-1 relative" ref={containerRef}>
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Buscar producto..."
        className="h-7 text-xs"
        data-testid="fuzzy-product-input"
      />
      {open && (
        <div className="absolute z-50 w-full border border-border rounded-md bg-background shadow-md mt-0.5 max-h-44 overflow-y-auto">
          {ranked.length === 0 && query.trim().length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Escribe para buscar...</p>
          )}
          {ranked.length === 0 && query.trim().length > 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Sin coincidencias.</p>
          )}
          {ranked.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={() => { onSelect(p.id); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 flex items-center justify-between"
            >
              <span>{p.name}</span>
              {p.sku && <span className="text-[10px] text-muted-foreground">{p.sku}</span>}
            </button>
          ))}
          {query.trim().length > 0 && (
            <button
              type="button"
              onMouseDown={() => { onCustom(query.trim()); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground italic hover:bg-muted/50 border-t border-border"
            >
              Usar nombre: "{query.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function IntakePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Step: "input" or "preview"
  const [step, setStep] = useState<"input" | "preview">("input");

  // Form state
  const [customerId, setCustomerId] = useState<number>(0);
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });
  const [rawText, setRawText] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");

  // Parsed results
  const [parsed, setParsed] = useState<ParsedLine[]>([]);
  // Manual overrides for ambiguous lines (index → selectedProductId)
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  // Unit overrides for mismatched lines (parsedIdx → canonical unit)
  const [unitOverrides, setUnitOverrides] = useState<Record<number, string>>({});

  // Merge dialog state
  const [mergeDialog, setMergeDialog] = useState<{ existingId: number; folio: string } | null>(null);
  const [pendingMode, setPendingMode] = useState<"new" | "merge" | "replace">("new");
  // Custom product names typed by user when no product matches (MEJORA 3)
  const [customNames, setCustomNames] = useState<Record<number, string>>({});
  // Manual quantity overrides for no_qty lines (MEJORA 1)
  const [qtyOverrides, setQtyOverrides] = useState<Record<number, string>>({});

  const { data: customers } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: products } = useQuery<Product[]>({ queryKey: ["/api/products"] });
  const { data: stockData } = useQuery<(ProductUnit & { product: Product })[]>({ queryKey: ["/api/products/stock"] });
  // Unit history from order_items — most recently used unit per product (MEJORA 1)
  const { data: unitHistoryRaw = [] } = useQuery<{ productId: number; unit: string }[]>({
    queryKey: ["/api/products/unit-history"],
    staleTime: 5 * 60 * 1000,
  });
  const unitHistoryMap = useMemo(
    () => new Map(unitHistoryRaw.map((r) => [r.productId, r.unit])),
    [unitHistoryRaw]
  );

  const activeCustomers = (customers ?? []).filter((c) => c.active);
  const filteredCustomers = useMemo(() =>
    activeCustomers.filter((c) => c.name.toLowerCase().includes(customerSearch.toLowerCase())),
    [activeCustomers, customerSearch]
  );
  const activeProducts = (products ?? []).filter((p) => p.active);

  // Parse the text
  const handleParse = () => {
    if (!customerId) { toast({ title: "Selecciona un cliente", variant: "destructive" }); return; }
    if (!rawText.trim()) { toast({ title: "Pega el texto del pedido", variant: "destructive" }); return; }

    const simpleProducts = activeProducts.map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit }));
    const result = parseOrderTextLocal(rawText, simpleProducts);
    setParsed(result);
    setOverrides({});
    setCustomNames({});
    setQtyOverrides({});

    // Pre-fill unit overrides: DB order history first, then localStorage
    // SOLO cuando el usuario NO escribió una unidad en el texto (line.unitFromText = false)
    const initialUnitOverrides: Record<number, string> = {};
    result.forEach((line, idx) => {
      if (line.status === "no_qty" || !line.productId) return;
      if (line.unitFromText) return; // respetar lo que el usuario escribió
      const histUnit = unitHistoryMap.get(line.productId);
      if (histUnit) {
        initialUnitOverrides[idx] = histUnit;
        try { localStorage.setItem(`lastUnit_${line.productId}`, histUnit); } catch {}
        return;
      }
      const last = localStorage.getItem(`lastUnit_${line.productId}`);
      if (last) initialUnitOverrides[idx] = last;
    });
    setUnitOverrides(initialUnitOverrides);
    setStep("preview");
  };

  // Lines that will actually be sent (no_qty excluded unless user provided a manual qty)
  const validLines = useMemo(() =>
    parsed
      .map((line, parsedIdx) => ({ ...line, parsedIdx }))
      .filter((l) => l.status !== "no_qty" || qtyOverrides[l.parsedIdx] !== undefined)
      .map(({ parsedIdx, ...line }) => {
        const customName = customNames[parsedIdx];
        const resolvedProductId = customName ? null
          : (overrides[parsedIdx] !== undefined ? overrides[parsedIdx] : line.productId);
        const resolvedProduct = activeProducts.find((p) => p.id === resolvedProductId);
        const effectiveName = customName ?? resolvedProduct?.name ?? line.rawProductName;
        const effectiveQty = qtyOverrides[parsedIdx] !== undefined
          ? (parseFloat(qtyOverrides[parsedIdx]) || null)
          : line.quantity;
        return {
          ...line,
          parsedIdx,
          quantity: effectiveQty,
          resolvedProductId,
          resolvedProductName: effectiveName,
          rawProductName: effectiveName,
          unit: unitOverrides[parsedIdx] ?? line.unit ?? resolvedProduct?.unit ?? "KG",
        };
      }),
    [parsed, overrides, activeProducts, unitOverrides, customNames, qtyOverrides]
  );

  const submitMutation = useMutation({
    mutationFn: async (payload: {
      mode: "new" | "merge" | "replace";
      existingOrderId?: number;
    }) => {
      const items = [...validLines]
        .sort((a, b) =>
          (a.resolvedProductName ?? a.rawProductName ?? "").localeCompare(
            b.resolvedProductName ?? b.rawProductName ?? "",
            "es",
            { sensitivity: "base" }
          )
        )
        .map((line) => ({
          productId: line.resolvedProductId ?? null,
          quantity: String(line.quantity ?? 1),
          unit: line.unit, // already has unitOverride applied
          rawProductName: line.rawProductName,
          parseStatus: line.resolvedProductId ? "ok" : line.status,
        }));

      const res = await apiRequest("POST", "/api/orders/intake", {
        customerId,
        orderDate: date,
        mode: payload.mode,
        existingOrderId: payload.existingOrderId,
        items,
      });
      return res.json();
    },
    onSuccess: (data: { orderId: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/load-list"] });
      toast({ title: "Pedido creado", description: "Redirigiendo al detalle para completar precios..." });
      setLocation(`/orders/${data.orderId}`);
    },
    onError: (e: any) => toast({ title: "Error al crear pedido", description: e.message, variant: "destructive" }),
  });

  const handleCreate = async (mode: "new" | "merge" | "replace" = "new", existingOrderId?: number) => {
    if (mode === "new") {
      // Check for existing draft
      try {
        const res = await fetch(`/api/orders/draft?customerId=${customerId}&date=${date}`, { credentials: "include" });
        if (res.ok) {
          const existing = await res.json();
          if (existing && existing.id) {
            setMergeDialog({ existingId: existing.id, folio: existing.folio });
            return;
          }
        }
      } catch {}
    }
    submitMutation.mutate({ mode, existingOrderId });
  };

  const handleMergeConfirm = (mode: "merge" | "replace") => {
    if (!mergeDialog) return;
    setMergeDialog(null);
    submitMutation.mutate({ mode, existingOrderId: mergeDialog.existingId });
  };

  const selectedCustomer = activeCustomers.find((c) => c.id === customerId);

  const hasAmbiguous = validLines.some(
    (l) => l.status === "ambiguous" && !overrides[l.parsedIdx] && !customNames[l.parsedIdx]
  );
  const okCount = validLines.filter(
    (l) => l.status === "ok" || overrides[l.parsedIdx] !== undefined || customNames[l.parsedIdx]
  ).length;
  const unresolved = validLines.filter(
    (l) => !l.resolvedProductId && !customNames[l.parsedIdx]
  ).length;

  // Unit validation: check if resolved product has the requested unit in product_units
  // We iterate `parsed` (same index as render) so the Set stores parsed indices
  const unitMismatchIndices = useMemo<Set<number>>(() => {
    if (!stockData || stockData.length === 0) return new Set();
    const bad = new Set<number>();
    parsed.forEach((line, idx) => {
      if (line.status === "no_qty" || !line.unit) return;
      if (unitOverrides[idx]) return; // user already resolved this
      const resolvedProductId = overrides[idx] !== undefined ? overrides[idx] : line.productId;
      if (!resolvedProductId) return;
      const canonical = canonicalizeUnit(line.unit);
      const hasUnit = stockData.some(
        (pu) => pu.productId === resolvedProductId && pu.unit === canonical
      );
      if (!hasUnit) bad.add(idx);
    });
    return bad;
  }, [parsed, overrides, unitOverrides, stockData]);

  return (
    <Layout title="Carga Pedido">
      <div className="p-6 max-w-2xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => step === "preview" ? setStep("input") : setLocation("/orders")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-xl font-semibold text-foreground">Carga de Pedido</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {step === "input" ? "Pega el texto del pedido y procesaremos las líneas automáticamente" : "Revisa las líneas detectadas y confirma"}
            </p>
          </div>
        </div>

        {step === "input" ? (
          <Card>
            <CardContent className="pt-5 space-y-4">
              {/* Customer selector with search */}
              <div className="space-y-1.5">
                <Label>Cliente *</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Buscar cliente..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="pl-8 mb-1"
                    data-testid="input-customer-search"
                  />
                </div>
                <div className="border border-border rounded-md overflow-hidden max-h-36 overflow-y-auto">
                  {filteredCustomers.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-3">Sin resultados</p>
                  ) : (
                    filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setCustomerId(c.id); setCustomerSearch(""); }}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-muted/50 transition-colors ${customerId === c.id ? "bg-primary/10 text-primary font-medium" : "text-foreground"}`}
                        data-testid={`customer-option-${c.id}`}
                      >
                        <span>{c.name}</span>
                        {customerId === c.id && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
                      </button>
                    ))
                  )}
                </div>
                {selectedCustomer && (
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="default" className="text-xs">{selectedCustomer.name}</Badge>
                    {selectedCustomer.hasIva && <Badge variant="outline" className="text-xs">Con IVA</Badge>}
                  </div>
                )}
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <Label htmlFor="intake-date">Fecha</Label>
                <Input
                  id="intake-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  data-testid="input-intake-date"
                />
              </div>

              {/* Raw text */}
              <div className="space-y-1.5">
                <Label htmlFor="raw-text">Texto del pedido *</Label>
                <Textarea
                  id="raw-text"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={"5 cajon limon\n2 kg tomate perita\n10 saco papa\nlechuga francesa 2 cajon"}
                  rows={8}
                  className="font-mono text-sm resize-none"
                  data-testid="textarea-raw-text"
                />
                <p className="text-xs text-muted-foreground">Una línea por producto. Formato: cantidad unidad producto (el orden es flexible)</p>
              </div>

              <Button
                className="w-full"
                onClick={handleParse}
                disabled={!customerId || !rawText.trim()}
                data-testid="button-parse"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Analizar pedido
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Preview header info */}
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{selectedCustomer?.name}</p>
                    <p className="text-xs text-muted-foreground">{new Date(date).toLocaleDateString("es-MX", { weekday: "long", day: "2-digit", month: "long" })}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-right">
                    <Badge variant="default">{okCount} OK</Badge>
                    {unresolved > 0 && <Badge variant="secondary">{unresolved} sin producto</Badge>}
                    {unitMismatchIndices.size > 0 && (
                      <Badge variant="outline" className="text-yellow-600 border-yellow-500/40">{unitMismatchIndices.size} unidad sin registrar</Badge>
                    )}
                    {parsed.filter((l) => l.status === "no_qty").length > 0 && (
                      <Badge variant="destructive">{parsed.filter((l) => l.status === "no_qty").length} ignoradas</Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Parsed lines */}
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold">Líneas detectadas ({parsed.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pb-4">
                {parsed.map((line, idx) => {
                  const resolvedProductId = overrides[idx] !== undefined ? overrides[idx] : (line.productId ?? 0);
                  const resolvedProduct = activeProducts.find((p) => p.id === resolvedProductId);
                  const isResolved = !!(resolvedProductId || customNames[idx]);
                  const effectiveStatus = (line.status === "ambiguous" || line.status === "no_product") && isResolved ? "ok" : line.status;

                  return (
                    <div
                      key={idx}
                      className={`rounded-md border p-3 ${
                        effectiveStatus === "ok" ? "border-border bg-card/50"
                        : effectiveStatus === "no_qty" ? "border-destructive/30 bg-destructive/5"
                        : effectiveStatus === "ambiguous" ? "border-yellow-400/50 bg-yellow-50/10 dark:bg-yellow-900/10"
                        : "border-orange-400/30 bg-orange-50/10 dark:bg-orange-900/10"
                      }`}
                      data-testid={`parsed-line-${idx}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5">{STATUS_ICON[effectiveStatus as keyof typeof STATUS_ICON] ?? STATUS_ICON.no_product}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground font-mono truncate">{line.raw}</span>
                            <Badge variant={STATUS_BADGE_VARIANT[effectiveStatus] ?? "secondary"} className="text-[10px]">
                              {STATUS_LABEL[effectiveStatus] ?? effectiveStatus}
                            </Badge>
                          </div>

                          {line.status === "no_qty" ? (
                            /* no_qty: show editable quantity field so staff can fix it */
                            line.rawProductName ? (
                              <div className="flex flex-wrap items-center gap-3 mt-1.5">
                                <div className="flex items-center gap-1.5">
                                  <Input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={qtyOverrides[idx] ?? ""}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      if (v !== "") setQtyOverrides({ ...qtyOverrides, [idx]: v });
                                      else { const q = { ...qtyOverrides }; delete q[idx]; setQtyOverrides(q); }
                                    }}
                                    placeholder="Cant."
                                    className="h-6 w-20 text-xs"
                                  />
                                  <span className="text-xs text-muted-foreground">{line.unit ?? "—"}</span>
                                </div>
                                <span className="text-xs font-medium text-foreground">{line.rawProductName}</span>
                              </div>
                            ) : null
                          ) : (
                            <div className="flex flex-wrap items-center gap-3 mt-1.5">
                              {line.quantity !== null && (
                                <span className="text-xs font-semibold text-foreground">
                                  {line.quantity} {unitOverrides[idx] ?? line.unit ?? "—"}
                                  {unitMismatchIndices.has(idx) && (
                                    <Badge variant="outline" className="ml-2 text-[10px] text-yellow-600 border-yellow-500/40 align-middle">
                                      unidad sin registrar
                                    </Badge>
                                  )}
                                </span>
                              )}
                              {unitMismatchIndices.has(idx) && (
                                <div className="w-full mt-1">
                                  <Select
                                    value={unitOverrides[idx] ?? ""}
                                    onValueChange={(v) => {
                                      setUnitOverrides({ ...unitOverrides, [idx]: v });
                                      if (resolvedProductId) {
                                        // Immediately register the unit for the product
                                        apiRequest("POST", `/api/products/${resolvedProductId}/units`, { unit: v }).catch(() => {});
                                        try { localStorage.setItem(`lastUnit_${resolvedProductId}`, v); } catch { /* quota exceeded */ }
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-7 text-xs w-48" data-testid={`select-unit-${idx}`}>
                                      <SelectValue placeholder="Registrar como..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {ALL_CANONICAL_UNITS.map((u) => (
                                        <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}

                              {/* Product display / picker */}
                              {(effectiveStatus === "ok" || resolvedProductId || customNames[idx]) ? (
                                <span className="text-xs text-foreground font-medium">
                                  {customNames[idx] ?? resolvedProduct?.name ?? line.productName ?? line.rawProductName}
                                </span>
                              ) : null}

                              {(line.status === "ambiguous" || line.status === "no_product") && (
                                <FuzzyProductPicker
                                  products={activeProducts}
                                  initialQuery={line.rawProductName}
                                  selectedId={resolvedProductId || null}
                                  onSelect={(pid) => {
                                    setOverrides({ ...overrides, [idx]: pid });
                                    const n = { ...customNames }; delete n[idx]; setCustomNames(n);
                                  }}
                                  onCustom={(name) => {
                                    setCustomNames({ ...customNames, [idx]: name });
                                    const o = { ...overrides }; delete o[idx]; setOverrides(o);
                                  }}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {validLines.length === 0 && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>No hay líneas válidas para crear el pedido. Todas requieren al menos una cantidad.</AlertDescription>
              </Alert>
            )}

            <div className="flex items-center gap-3 justify-end">
              <Button variant="outline" onClick={() => setStep("input")}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Editar texto
              </Button>
              <Button
                onClick={() => handleCreate("new")}
                disabled={validLines.length === 0 || submitMutation.isPending}
                data-testid="button-create-order"
              >
                {submitMutation.isPending ? "Creando..." : (
                  <>Crear Pedido <ChevronRight className="ml-2 h-4 w-4" /></>
                )}
              </Button>
            </div>
          </>
        )}

        {/* Merge/Replace dialog */}
        <Dialog open={!!mergeDialog} onOpenChange={(o) => !o && setMergeDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Pedido borrador existente</DialogTitle>
              <DialogDescription>
                Ya existe un pedido en borrador para este cliente en esta fecha (<span className="font-semibold">{mergeDialog?.folio}</span>).
                ¿Qué deseas hacer?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => handleMergeConfirm("merge")} data-testid="button-merge">
                Agregar a existente
              </Button>
              <Button variant="outline" className="text-destructive border-destructive/50" onClick={() => handleMergeConfirm("replace")} data-testid="button-replace">
                Reemplazar líneas
              </Button>
              <Button onClick={() => { setMergeDialog(null); submitMutation.mutate({ mode: "new" }); }} data-testid="button-new-anyway">
                Crear nuevo pedido
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
