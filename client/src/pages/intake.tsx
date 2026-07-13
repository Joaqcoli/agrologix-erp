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

// ── Rediseño Carga de Pedido (Claude Design) — CSS de diseno-caja/carga-pedido-rediseno.html ──
const CPX_CSS = `
.cpx-wrap{max-width:760px;margin:0 auto;}
.cpx-pagehead{display:flex;align-items:flex-start;gap:16px;margin-bottom:22px;}
.cpx-back{width:40px;height:40px;border-radius:11px;border:1px solid #ecece8;background:#fff;color:#1e2420;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto;margin-top:3px;}
.cpx-back:hover{border-color:#cfcfc9;background:#f6f6f2;}
.cpx-pagehead h1{font-family:'Bricolage Grotesque';font-size:27px;font-weight:700;margin:0;letter-spacing:-.02em;line-height:1.1;color:#1e2420;}
.cpx-pagehead .sub{font-size:14px;color:#8b8f88;margin:5px 0 0;}
.cpx-formcard{background:#fff;border:1px solid #ecece8;border-radius:18px;padding:28px 30px;font-family:'Inter',system-ui,sans-serif;}
.cpx-field{margin-bottom:22px;}
.cpx-field:last-of-type{margin-bottom:0;}
.cpx-label{display:block;font-size:14.5px;font-weight:600;color:#3a3f38;margin-bottom:9px;}
.cpx-label .req{color:#5f8020;}
.cpx-input,.cpx-textarea{width:100%;font-family:'Inter';font-size:14.5px;color:#1e2420;background:#fff;border:1px solid #ecece8;border-radius:11px;padding:12px 14px;transition:border-color .15s,box-shadow .15s;}
.cpx-input:focus,.cpx-textarea:focus{outline:none;border-color:#6b8a2a;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.cpx-combo{position:relative;}
.cpx-inputwrap{position:relative;}
.cpx-inputwrap>svg{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#8b8f88;pointer-events:none;}
.cpx-inputwrap .cpx-input{padding-left:40px;}
.cpx-dropdown{position:absolute;left:0;right:0;top:calc(100% + 6px);background:#fff;border:1px solid #ecece8;border-radius:12px;box-shadow:0 12px 34px -12px rgba(0,0,0,.22);padding:6px;z-index:20;max-height:250px;overflow:auto;}
.cpx-opt{padding:11px 13px;border-radius:9px;font-size:14.5px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;}
.cpx-opt:hover{background:#eef3e3;color:#5f8020;}
.cpx-opt.empty{color:#8b8f88;cursor:default;}
.cpx-opt.empty:hover{background:none;color:#8b8f88;}
.cpx-textarea{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:14px;line-height:1.7;resize:vertical;min-height:170px;}
.cpx-hint{font-size:12.5px;color:#8b8f88;margin:9px 0 0;}
.cpx-ivachip{display:inline-flex;align-items:center;font-size:11.5px;font-weight:600;padding:2px 9px;border-radius:20px;background:#eef3e3;color:#5f8020;margin-top:10px;}
.cpx-analyze{width:100%;margin-top:26px;background:#6b8a2a;color:#fff;border:none;font-family:'Inter';font-size:15px;font-weight:600;padding:14px;border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px;transition:background .15s;}
.cpx-analyze:hover{background:#5f7d24;}
.cpx-analyze:disabled{opacity:.5;cursor:default;}
`;

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
  // Rediseño: desplegable del combo de cliente (solo presentación; la búsqueda/lista no cambia)
  const [comboOpen, setComboOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!comboOpen) return;
    const h = (e: MouseEvent) => { if (!comboRef.current?.contains(e.target as Node)) setComboOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [comboOpen]);

  // Parsed results
  const [parsed, setParsed] = useState<ParsedLine[]>([]);
  // Manual overrides for ambiguous lines (index → selectedProductId)
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  // Unit overrides for mismatched lines (parsedIdx → canonical unit)
  const [unitOverrides, setUnitOverrides] = useState<Record<number, string>>({});

  // Last-price prefills: parsedIdx → price string
  const [pricePrefills, setPricePrefills] = useState<Record<number, string>>({});
  // Token de request por ítem: solo aplica la respuesta del ÚLTIMO fetch disparado
  // (evita que el prefill de fondo pise el precio re-buscado al cambiar la unidad, o viceversa).
  const priceFetchSeq = useRef<Record<number, number>>({});

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
    setPricePrefills({});
    priceFetchSeq.current = {}; // invalida fetches en vuelo de un parseo anterior
    setStep("preview");

    // Background-fetch last price per product+unit for this customer
    result.forEach((line, idx) => {
      if (!line.productId || line.status === "no_qty") return;
      const effectiveUnit = initialUnitOverrides[idx] ?? line.unit ?? "KG";
      const seq = (priceFetchSeq.current[idx] ?? 0) + 1;
      priceFetchSeq.current[idx] = seq;
      fetch(`/api/products/${line.productId}/last-price?customerId=${customerId}&unit=${encodeURIComponent(effectiveUnit)}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (priceFetchSeq.current[idx] !== seq) return; // un fetch más nuevo ya ganó
          if (data?.price != null) {
            setPricePrefills((prev) => ({ ...prev, [idx]: String(Math.round(parseFloat(data.price))) }));
          }
        })
        .catch(() => {});
    });
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
          pricePerUnit: pricePrefills[line.parsedIdx] ?? null,
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
    if (!Array.isArray(stockData) || stockData.length === 0) return new Set();
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
      <div style={{ background: "#f4f4f1", minHeight: "100%" }}>
        <style>{CPX_CSS}</style>
        {step === "input" ? (
          <div className="cpx-wrap" style={{ padding: "34px 24px 56px" }}>
            <div className="cpx-pagehead">
              <button className="cpx-back" onClick={() => setLocation("/orders")} aria-label="Volver">
                <ArrowLeft className="h-[18px] w-[18px]" />
              </button>
              <div>
                <h1>Carga de pedido</h1>
                <p className="sub">Pegá el texto del pedido y procesamos las líneas automáticamente</p>
              </div>
            </div>

            <div className="cpx-formcard">
              {/* Cliente — buscador con desplegable (misma lista/búsqueda que hoy) */}
              <div className="cpx-field">
                <label className="cpx-label">Cliente <span className="req">*</span></label>
                <div className="cpx-combo" ref={comboRef}>
                  <div className="cpx-inputwrap">
                    <Search className="h-4 w-4" />
                    <input
                      className="cpx-input"
                      placeholder="Buscar cliente..."
                      autoComplete="off"
                      value={customerSearch}
                      onFocus={() => setComboOpen(true)}
                      onChange={(e) => { setCustomerSearch(e.target.value); setComboOpen(true); }}
                      data-testid="input-customer-search"
                    />
                  </div>
                  {comboOpen && (
                    <div className="cpx-dropdown">
                      {filteredCustomers.length === 0 ? (
                        <div className="cpx-opt empty">Sin resultados</div>
                      ) : (
                        filteredCustomers.map((c) => (
                          <div
                            key={c.id}
                            className="cpx-opt"
                            onMouseDown={() => { setCustomerId(c.id); setCustomerSearch(c.name); setComboOpen(false); }}
                            data-testid={`customer-option-${c.id}`}
                          >
                            <span>{c.name}</span>
                            {customerId === c.id && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {selectedCustomer?.hasIva && <span className="cpx-ivachip">Con IVA</span>}
              </div>

              {/* Fecha */}
              <div className="cpx-field">
                <label className="cpx-label">Fecha</label>
                <input
                  type="date"
                  className="cpx-input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  data-testid="input-intake-date"
                />
              </div>

              {/* Texto del pedido */}
              <div className="cpx-field">
                <label className="cpx-label">Texto del pedido <span className="req">*</span></label>
                <textarea
                  className="cpx-textarea"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={"5 cajon limon\n2 kg tomate perita\n10 saco papa\nlechuga francesa 2 cajon"}
                  data-testid="textarea-raw-text"
                />
                <p className="cpx-hint">Una línea por producto. Formato: cantidad unidad producto (el orden es flexible).</p>
              </div>

              <button
                className="cpx-analyze"
                onClick={handleParse}
                disabled={!customerId || !rawText.trim()}
                data-testid="button-parse"
              >
                <Sparkles className="h-[17px] w-[17px]" />
                Analizar pedido
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 max-w-2xl mx-auto space-y-5">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setStep("input")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h2 className="text-xl font-semibold text-foreground">Carga de Pedido</h2>
                <p className="text-sm text-muted-foreground mt-0.5">Revisa las líneas detectadas y confirma</p>
              </div>
            </div>
          <>
            {/* Preview header info */}
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{selectedCustomer?.name}</p>
                    <p className="text-xs text-muted-foreground">{new Date(date + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "2-digit", month: "long" })}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-right">
                    <Badge variant="default">{okCount} OK</Badge>
                    {unresolved > 0 && <Badge variant="secondary">{unresolved} sin producto</Badge>}
                    {unitMismatchIndices.size > 0 && (
                      <Badge variant="outline" className="text-yellow-600 border-yellow-500/40">{unitMismatchIndices.size} con unidad nueva</Badge>
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
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                value={qtyOverrides[idx] !== undefined ? qtyOverrides[idx] : (line.quantity !== null ? String(line.quantity) : "")}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v !== "") setQtyOverrides({ ...qtyOverrides, [idx]: v });
                                  else { const q = { ...qtyOverrides }; delete q[idx]; setQtyOverrides(q); }
                                }}
                                placeholder="Cant."
                                className="h-6 w-20 text-xs"
                              />
                              {(
                                <div className="w-full mt-1">
                                  <Select
                                    value={unitOverrides[idx] ?? line.unit ?? ""}
                                    onValueChange={(v) => {
                                      setUnitOverrides({ ...unitOverrides, [idx]: v });
                                      if (resolvedProductId) {
                                        apiRequest("POST", `/api/products/${resolvedProductId}/units`, { unit: v }).catch(() => {});
                                        try { localStorage.setItem(`lastUnit_${resolvedProductId}`, v); } catch { /* quota exceeded */ }
                                        // Re-fetch last price for the new unit
                                        if (customerId) {
                                          const seq = (priceFetchSeq.current[idx] ?? 0) + 1;
                                          priceFetchSeq.current[idx] = seq;
                                          fetch(`/api/products/${resolvedProductId}/last-price?customerId=${customerId}&unit=${encodeURIComponent(v)}`, { credentials: "include" })
                                            .then((r) => (r.ok ? r.json() : null))
                                            .then((data) => {
                                              if (priceFetchSeq.current[idx] !== seq) return; // un fetch más nuevo ya ganó
                                              setPricePrefills((prev) => {
                                                const next = { ...prev };
                                                if (data?.price != null) next[idx] = String(Math.round(parseFloat(data.price)));
                                                else delete next[idx];
                                                return next;
                                              });
                                            })
                                            .catch(() => {});
                                        }
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-7 text-xs w-40" data-testid={`select-unit-${idx}`}>
                                      <SelectValue placeholder="Unidad..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {ALL_CANONICAL_UNITS.map((u) => (
                                        <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}

                              {/* Product — always editable */}
                              <FuzzyProductPicker
                                products={activeProducts}
                                initialQuery={customNames[idx] ?? resolvedProduct?.name ?? line.rawProductName ?? ""}
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
          </div>
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
