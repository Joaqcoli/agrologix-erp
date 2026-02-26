import { useState, useMemo } from "react";
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
import { parseOrderTextLocal, type ParsedLine } from "@/lib/orderParser";
import type { Customer, Product, ProductUnit } from "@shared/schema";
import { canonicalizeUnit } from "@shared/units";

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
  no_qty: "Sin cantidad (ignorado)",
};

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ok: "default",
  ambiguous: "outline",
  no_product: "secondary",
  no_qty: "destructive",
};

export default function IntakePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Step: "input" or "preview"
  const [step, setStep] = useState<"input" | "preview">("input");

  // Form state
  const [customerId, setCustomerId] = useState<number>(0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [rawText, setRawText] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");

  // Parsed results
  const [parsed, setParsed] = useState<ParsedLine[]>([]);
  // Manual overrides for ambiguous lines (index → selectedProductId)
  const [overrides, setOverrides] = useState<Record<number, number>>({});

  // Merge dialog state
  const [mergeDialog, setMergeDialog] = useState<{ existingId: number; folio: string } | null>(null);
  const [pendingMode, setPendingMode] = useState<"new" | "merge" | "replace">("new");

  const { data: customers } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: products } = useQuery<Product[]>({ queryKey: ["/api/products"] });
  const { data: stockData } = useQuery<(ProductUnit & { product: Product })[]>({ queryKey: ["/api/products/stock"] });

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
    setStep("preview");
  };

  // Lines that will actually be sent (excluding no_qty)
  const validLines = useMemo(() =>
    parsed.filter((l) => l.status !== "no_qty").map((line, idx) => {
      const resolvedProductId = overrides[idx] !== undefined ? overrides[idx] : line.productId;
      const resolvedProduct = activeProducts.find((p) => p.id === resolvedProductId);
      return {
        ...line,
        resolvedProductId,
        resolvedProductName: resolvedProduct?.name ?? line.rawProductName,
        unit: line.unit ?? resolvedProduct?.unit ?? "kg",
      };
    }),
    [parsed, overrides, activeProducts]
  );

  const submitMutation = useMutation({
    mutationFn: async (payload: {
      mode: "new" | "merge" | "replace";
      existingOrderId?: number;
    }) => {
      const items = validLines.map((line) => ({
        productId: line.resolvedProductId ?? null,
        quantity: String(line.quantity ?? 1),
        unit: line.unit,
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

  const hasAmbiguous = validLines.some((l) => l.status === "ambiguous" && !overrides[parsed.indexOf(l)]);
  const okCount = validLines.filter((l) => (overrides[parsed.indexOf(l)] !== undefined && overrides[parsed.indexOf(l)] > 0) || l.status === "ok").length;
  const unresolved = validLines.filter((l) => !l.resolvedProductId).length;

  // Unit validation: check if resolved product has the requested unit in product_units
  // We iterate `parsed` (same index as render) so the Set stores parsed indices
  const unitMismatchIndices = useMemo<Set<number>>(() => {
    if (!stockData || stockData.length === 0) return new Set();
    const bad = new Set<number>();
    parsed.forEach((line, idx) => {
      if (line.status === "no_qty" || !line.unit) return;
      const resolvedProductId = overrides[idx] !== undefined ? overrides[idx] : line.productId;
      if (!resolvedProductId) return;
      const canonical = canonicalizeUnit(line.unit);
      const hasUnit = stockData.some(
        (pu) => pu.productId === resolvedProductId && pu.unit === canonical
      );
      if (!hasUnit) bad.add(idx);
    });
    return bad;
  }, [parsed, overrides, stockData]);

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
                  const effectiveStatus = line.status === "ambiguous" && resolvedProductId ? "ok" : line.status;

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

                          {line.status !== "no_qty" && (
                            <div className="flex flex-wrap items-center gap-3 mt-1.5">
                              {line.quantity !== null && (
                                <span className="text-xs font-semibold text-foreground">
                                  {line.quantity} {line.unit ?? "—"}
                                  {unitMismatchIndices.has(idx) && (
                                    <Badge variant="outline" className="ml-2 text-[10px] text-yellow-600 border-yellow-500/40 align-middle">
                                      unidad sin registrar
                                    </Badge>
                                  )}
                                </span>
                              )}

                              {/* Product display / picker */}
                              {effectiveStatus === "ok" || resolvedProductId ? (
                                <span className="text-xs text-foreground font-medium">
                                  {resolvedProduct?.name ?? line.productName ?? line.rawProductName}
                                </span>
                              ) : null}

                              {(line.status === "ambiguous" || line.status === "no_product") && (
                                <div className="w-full mt-1">
                                  <Select
                                    value={String(resolvedProductId || "")}
                                    onValueChange={(v) => setOverrides({ ...overrides, [idx]: Number(v) })}
                                  >
                                    <SelectTrigger className="h-7 text-xs" data-testid={`select-resolve-${idx}`}>
                                      <SelectValue placeholder="Seleccionar producto..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {line.status === "ambiguous"
                                        ? line.candidates.map((c) => (
                                            <SelectItem key={c.id} value={String(c.id)} className="text-xs">
                                              {c.name} <span className="text-muted-foreground ml-1">({c.sku})</span>
                                            </SelectItem>
                                          ))
                                        : activeProducts.map((p) => (
                                            <SelectItem key={p.id} value={String(p.id)} className="text-xs">
                                              {p.name} <span className="text-muted-foreground ml-1">({p.sku})</span>
                                            </SelectItem>
                                          ))
                                      }
                                    </SelectContent>
                                  </Select>
                                </div>
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
