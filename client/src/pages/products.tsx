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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Pencil, Trash2, Package, Upload } from "lucide-react";
import type { Product, ProductUnit } from "@shared/schema";
import { PRODUCT_CATEGORIES, type ProductCategory } from "@shared/schema";
import { canonicalizeUnit, ALL_CANONICAL_UNITS, CANONICAL_UNIT_LABEL } from "@shared/units";

const fmt = (v: number) => Math.round(v).toLocaleString("es-MX");
const fmtStock = (v: number) => v.toLocaleString("es-MX", { maximumFractionDigits: 2 });

type ProductUnitWithProduct = ProductUnit & { product: Product };

// ─── Import Dialog ────────────────────────────────────────────────────────────
type PreviewLine = { raw: string; name: string; unit: string; productExists: boolean; unitExists: boolean };

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewLine[] | null>(null);

  const { data: allUnits } = useQuery<ProductUnitWithProduct[]>({ queryKey: ["/api/products/stock", { onlyInStock: false }], queryFn: () => fetch("/api/products/stock?onlyInStock=false", { credentials: "include" }).then(r => r.json()) });
  const { data: allProducts } = useQuery<Product[]>({ queryKey: ["/api/products"] });

  const importMutation = useMutation({
    mutationFn: async (lines: { name: string; unit: string }[]) => {
      const res = await apiRequest("POST", "/api/products/import", { lines });
      return res.json();
    },
    onSuccess: (data: { created: number; unitsAdded: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/stock"] });
      toast({ title: "Importación completa", description: `${data.created} productos creados, ${data.unitsAdded} unidades agregadas` });
      setText(""); setPreview(null); onClose();
    },
    onError: (e: any) => toast({ title: "Error al importar", description: e.message, variant: "destructive" }),
  });

  const handlePreview = () => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const result: PreviewLine[] = lines.map((raw) => {
      const parts = raw.split(/\s+/);
      const unitCandidate = canonicalizeUnit(parts[parts.length - 1]);
      const isValidUnit = ALL_CANONICAL_UNITS.includes(unitCandidate as any);
      let name: string, unit: string;
      if (isValidUnit && parts.length > 1) {
        name = parts.slice(0, -1).join(" ").toUpperCase().trim();
        unit = unitCandidate;
      } else {
        name = raw.toUpperCase().trim();
        unit = "KG";
      }
      const productExists = (allProducts ?? []).some((p) => p.name.toUpperCase().trim() === name);
      const unitExists = (allUnits ?? []).some((pu) => pu.product.name.toUpperCase().trim() === name && pu.unit === unit);
      return { raw, name, unit, productExists, unitExists };
    });
    setPreview(result);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setPreview(null); onClose(); } }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar Productos</DialogTitle>
          <DialogDescription>
            Un producto por línea. Formato: <code className="bg-muted px-1 rounded text-xs">NOMBRE UNIDAD</code> — ej: <code className="bg-muted px-1 rounded text-xs">ACELGA CAJON</code>
          </DialogDescription>
        </DialogHeader>
        {!preview ? (
          <div className="space-y-3 mt-2">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"ACELGA CAJON\nJITOMATE KG\nPAPA CEPILLADA BOLSA"} rows={10} className="font-mono text-sm" data-testid="textarea-import-text" />
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={handlePreview} disabled={!text.trim()} data-testid="button-preview-import">Previsualizar</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 mt-2">
            <div className="overflow-x-auto border border-border rounded-md">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Producto</th>
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Unidad</th>
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Producto</th>
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Unidad</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((line, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="py-2 px-3 font-medium">{line.name}</td>
                      <td className="py-2 px-3"><Badge variant="secondary" className="text-[10px]">{line.unit}</Badge></td>
                      <td className="py-2 px-3">
                        {line.productExists ? <Badge variant="outline" className="text-[10px] text-green-600 border-green-600/30">Existe</Badge> : <Badge variant="outline" className="text-[10px] text-primary border-primary/30">Crear</Badge>}
                      </td>
                      <td className="py-2 px-3">
                        {line.unitExists ? <Badge variant="secondary" className="text-[10px]">Existe</Badge> : <Badge variant="outline" className="text-[10px] text-primary border-primary/30">Agregar</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">{preview.filter((l) => !l.productExists).length} productos nuevos · {preview.filter((l) => !l.unitExists).length} unidades nuevas</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreview(null)}>Volver</Button>
              <Button onClick={() => importMutation.mutate(preview.map((l) => ({ name: l.name, unit: l.unit })))} disabled={importMutation.isPending} data-testid="button-confirm-import">
                {importMutation.isPending ? "Importando..." : `Importar ${preview.length} líneas`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Category Filter Bar ─────────────────────────────────────────────────────
function CategoryFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button
        size="sm"
        variant={value === "all" ? "default" : "outline"}
        className="h-7 text-xs"
        onClick={() => onChange("all")}
        data-testid="cat-filter-all"
      >Todas</Button>
      {PRODUCT_CATEGORIES.map((cat) => (
        <Button
          key={cat}
          size="sm"
          variant={value === cat ? "default" : "outline"}
          className="h-7 text-xs"
          onClick={() => onChange(cat)}
          data-testid={`cat-filter-${cat.toLowerCase().replace(/\//g, "-").replace(/\s+/g, "-")}`}
        >{cat}</Button>
      ))}
    </div>
  );
}

// ─── Product Card (Tab 1) ─────────────────────────────────────────────────────
function ProductCard({ product, productUnitMap, onEdit, onDelete }: {
  product: Product;
  productUnitMap: Map<number, ProductUnitWithProduct[]>;
  onEdit: (p: Product) => void;
  onDelete: (id: number) => void;
}) {
  const units = productUnitMap.get(product.id) ?? [];
  return (
    <Card data-testid={`card-product-${product.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 shrink-0">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate" title={product.name}>{product.name}</p>
              {product.category && (
                <Badge variant="outline" className="text-[10px] mt-0.5">{product.category}</Badge>
              )}
              <div className="flex flex-wrap gap-1 mt-1.5">
                {units.length === 0 ? (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">Sin unidades</Badge>
                ) : (
                  units.map((pu) => <Badge key={pu.id} variant="secondary" className="text-[10px]">{pu.unit}</Badge>)
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onEdit(product)} data-testid={`button-edit-product-${product.id}`}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => onDelete(product.id)} data-testid={`button-delete-product-${product.id}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {units.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border space-y-1.5">
            {units.map((pu) => {
              const stock = parseFloat(pu.stockQty as string);
              const cost = parseFloat(pu.avgCost as string);
              return (
                <div key={pu.id} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground w-14 shrink-0">{pu.unit}</span>
                  <span className={`font-semibold ${stock < 0 ? "text-destructive" : "text-foreground"}`}>{fmtStock(stock)}</span>
                  <span className="text-muted-foreground">{cost > 0 ? `$${fmt(cost)}` : "—"}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Unit Selector (multi-checkbox) ──────────────────────────────────────────
function UnitSelector({ selected, onChange }: { selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const toggle = (unit: string) => {
    const next = new Set(selected);
    if (next.has(unit)) next.delete(unit);
    else next.add(unit);
    onChange(next);
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      {ALL_CANONICAL_UNITS.map((unit) => (
        <label key={unit} className={`flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer transition-colors ${selected.has(unit) ? "border-primary bg-primary/5" : "border-border"}`}>
          <Checkbox checked={selected.has(unit)} onCheckedChange={() => toggle(unit)} data-testid={`checkbox-unit-${unit}`} />
          <span className="text-sm font-medium">{unit}</span>
          <span className="text-xs text-muted-foreground ml-auto">{CANONICAL_UNIT_LABEL[unit]}</span>
        </label>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const EMPTY_FORM = { name: "", description: "", unit: "kg" as const, category: "Verdura" as ProductCategory };

export default function ProductsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set());
  const [isSavingUnits, setIsSavingUnits] = useState(false);

  const { data: products, isLoading } = useQuery<Product[]>({ queryKey: ["/api/products"] });

  // All units (for product cards) — never filtered by stock
  const { data: allUnitsData } = useQuery<ProductUnitWithProduct[]>({
    queryKey: ["/api/products/stock", { onlyInStock: false }],
    queryFn: () => fetch("/api/products/stock?onlyInStock=false", { credentials: "include" }).then((r) => r.json()),
  });

  // Map productId → units (from allUnitsData for cards)
  const productUnitMap = useMemo(() => {
    const map = new Map<number, ProductUnitWithProduct[]>();
    (allUnitsData ?? []).forEach((pu) => {
      if (!map.has(pu.productId)) map.set(pu.productId, []);
      map.get(pu.productId)!.push(pu);
    });
    return map;
  }, [allUnitsData]);

  const activeProducts = (products ?? []).filter((p) => p.active);

  const filteredProducts = useMemo(() =>
    activeProducts.filter((p) => {
      const matchName = p.name.toLowerCase().includes(search.toLowerCase());
      const matchCat = categoryFilter === "all" || p.category === categoryFilter;
      return matchName && matchCat;
    }), [activeProducts, search, categoryFilter]
  );

  const createMutation = useMutation({
    mutationFn: async ({ data, units }: { data: typeof EMPTY_FORM; units: string[] }) => {
      const res = await apiRequest("POST", "/api/products", { ...data, units });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/stock"] });
      toast({ title: "Producto creado" });
      setDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<typeof EMPTY_FORM> }) => {
      const res = await apiRequest("PATCH", `/api/products/${id}`, data);
      if (!res.ok) throw new Error("Error al actualizar producto");
      return res.json();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/stock"] });
      toast({ title: "Producto desactivado" });
      setDeleteId(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setSelectedUnits(new Set());
    setDialogOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({ name: p.name, description: p.description ?? "", unit: p.unit as any, category: (p.category as ProductCategory) ?? "Verdura" });
    // Pre-select active units for this product
    const units = productUnitMap.get(p.id) ?? [];
    setSelectedUnits(new Set(units.map((pu) => pu.unit)));
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const units = Array.from(selectedUnits);
    const snapshot = { ...form };
    const editingId = editing?.id;
    if (editingId !== undefined) {
      setIsSavingUnits(true);
      try {
        await updateMutation.mutateAsync({ id: editingId, data: snapshot });
        const res = await apiRequest("PUT", `/api/products/${editingId}/units`, { units });
        if (!res.ok) throw new Error("Error al guardar unidades");
        queryClient.invalidateQueries({ queryKey: ["/api/products"] });
        queryClient.invalidateQueries({ queryKey: ["/api/products/stock"] });
        toast({ title: "Producto actualizado" });
        setDialogOpen(false);
      } catch (err: any) {
        toast({ title: "Error al guardar", description: (err as Error).message, variant: "destructive" });
      } finally {
        setIsSavingUnits(false);
      }
    } else {
      createMutation.mutate({ data: snapshot, units });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending || isSavingUnits;

  return (
    <Layout title="Productos">
      <div className="p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Productos</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{activeProducts.length} productos activos</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="button-import-products">
              <Upload className="mr-2 h-4 w-4" /> Importar
            </Button>
            <Button onClick={openCreate} data-testid="button-add-product">
              <Plus className="mr-2 h-4 w-4" /> Nuevo Producto
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por nombre..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-products" />
            </div>
            <CategoryFilter value={categoryFilter} onChange={setCategoryFilter} />
          </div>

          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[1,2,3,4,5,6].map((i) => <Skeleton key={i} className="h-36 w-full rounded-lg" />)}
            </div>
          ) : filteredProducts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Package className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground">Sin productos</p>
                <p className="text-sm text-muted-foreground">Agrega tu primer producto o cambia los filtros.</p>
                <Button size="sm" onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Agregar</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredProducts.map((p) => (
                <ProductCard key={p.id} product={p} productUnitMap={productUnitMap} onEdit={openEdit} onDelete={(id) => setDeleteId(id)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Product Create/Edit Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Producto" : "Nuevo Producto"}</DialogTitle>
            <DialogDescription>{editing ? "Modifica los datos y unidades del producto." : "Completa la información del nuevo producto."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="pname">Nombre *</Label>
              <Input id="pname" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-product-name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pcategory">Categoría *</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as ProductCategory })}>
                <SelectTrigger id="pcategory" data-testid="select-product-category">
                  <SelectValue placeholder="Selecciona una categoría" />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat} data-testid={`select-category-option-${cat.toLowerCase().replace(/[^a-z]/g, "-")}`}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Unidades de medida *</Label>
              <p className="text-xs text-muted-foreground">Seleccioná todas las unidades en las que se maneja este producto.</p>
              <UnitSelector selected={selectedUnits} onChange={setSelectedUnits} />
              {selectedUnits.size === 0 && (
                <p className="text-xs text-destructive">Selecciona al menos una unidad.</p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={isPending || selectedUnits.size === 0} data-testid="button-save-product">
                {isPending ? "Guardando..." : editing ? "Guardar cambios" : "Crear producto"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar producto?</AlertDialogTitle>
            <AlertDialogDescription>El producto dejará de aparecer en compras y pedidos.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} className="bg-destructive text-destructive-foreground" data-testid="button-confirm-delete-product">
              Desactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </Layout>
  );
}
