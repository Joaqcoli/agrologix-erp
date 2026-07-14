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

import { fmtMiles } from "@/lib/format";
const fmt = fmtMiles;
const fmtStock = (v: number) => v.toLocaleString("es-MX", { maximumFractionDigits: 2 });

type ProductUnitWithProduct = ProductUnit & { product: Product };

// ── Rediseño Productos (Claude Design) — CSS de diseno-caja/productos-rediseno.html ──
const PRX_CSS = `
.prods-rx{background:#f4f4f1;min-height:100%;padding:30px 24px 56px;font-family:'Inter',system-ui,sans-serif;color:#1e2420;}
.prods-rx *{box-sizing:border-box;}
.prx-wrap{max-width:1360px;margin:0 auto;}
.prx-top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:18px;}
.prx-title{font-family:'Bricolage Grotesque';font-size:27px;font-weight:700;margin:0;letter-spacing:-.02em;}
.prx-subtitle{font-size:13.5px;color:#8b8f88;margin-top:5px;}
.prx-hbtns{display:flex;gap:10px;flex-wrap:wrap;}
.prx-btn{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #ecece8;border-radius:10px;padding:10px 16px;font-family:'Inter';font-size:14px;font-weight:500;color:#1e2420;cursor:pointer;}
.prx-btn:hover{border-color:#cfcfc9;background:#f6f6f2;}
.prx-btn svg{color:#8b8f88;}
.prx-btnnew{display:inline-flex;align-items:center;gap:8px;background:#6b8a2a;color:#fff;border:none;border-radius:11px;padding:11px 18px;font-family:'Inter';font-size:14px;font-weight:600;cursor:pointer;}
.prx-btnnew:hover{background:#5f7d24;}
.prx-search{position:relative;margin-bottom:16px;}
.prx-search>svg{position:absolute;left:16px;top:50%;transform:translateY(-50%);color:#8b8f88;pointer-events:none;}
.prx-search input{width:100%;background:#fff;border:1px solid #ecece8;border-radius:12px;padding:13px 16px 13px 46px;font-family:'Inter';font-size:14px;color:#1e2420;}
.prx-search input::placeholder{color:#a9ada4;}
.prx-search input:focus{outline:none;border-color:#5f8020;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.prx-filters{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:22px;}
.prx-filters button{border:1px solid #ecece8;background:#fff;color:#5d625a;font-family:'Inter';font-size:13.5px;font-weight:500;padding:8px 16px;border-radius:20px;cursor:pointer;}
.prx-filters button:hover{border-color:#cfcfc9;}
.prx-filters button.on{background:#6b8a2a;color:#fff;border-color:#6b8a2a;}
.prx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;}
.prx-pcard{display:flex;align-items:center;gap:13px;background:#fff;border:1px solid #ecece8;border-radius:14px;padding:13px 15px;transition:border-color .15s,box-shadow .15s;}
.prx-pcard:hover{border-color:#dcdcd6;box-shadow:0 2px 10px rgba(30,36,32,.05);}
.prx-cube{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
.prx-pinfo{flex:1;min-width:0;}
.prx-pname{font-weight:600;font-size:14.5px;letter-spacing:-.01em;line-height:1.25;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.prx-pbadges{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.prx-cat{font-size:10.5px;font-weight:600;padding:2px 9px;border-radius:20px;white-space:nowrap;}
.prx-unit{font-size:10.5px;font-weight:600;color:#6f7469;background:#f1f2ee;border:1px solid #e6e7e1;padding:2px 8px;border-radius:20px;white-space:nowrap;}
.prx-unit.none{color:#adb1a8;background:#f6f6f3;border-color:#eeeeea;font-weight:500;}
.prx-pacts{display:flex;gap:2px;flex:0 0 auto;}
.prx-ic{width:30px;height:30px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#8b8f88;}
.prx-ic:hover{background:#f1f1ee;color:#1e2420;}
.prx-ic.del:hover{background:#f8ede8;color:#b0553f;}
.prx-c-verdura{background:#eef3e3;color:#5f8020;}
.prx-c-fruta{background:#f8ede8;color:#b0553f;}
.prx-c-hliviana{background:#e9eff7;color:#3a67a3;}
.prx-c-hpesada{background:#f9f1de;color:#c08a1e;}
.prx-c-hongos{background:#f3ebf0;color:#a86b8a;}
.prx-c-huevos{background:#f0eee6;color:#8a7a3e;}
.prx-empty{background:#fff;border:1px solid #ecece8;border-radius:16px;padding:48px 20px;text-align:center;color:#8b8f88;display:flex;flex-direction:column;align-items:center;gap:10px;}
.prx-empty .big{font-size:15px;font-weight:600;color:#1e2420;}
.prx-emptyic{width:48px;height:48px;border-radius:50%;background:#f1f1ec;display:flex;align-items:center;justify-content:center;color:#8b8f88;}
`;

// Clase de color por categoría (cubo + badge), según la maqueta
function catClass(cat: string | null | undefined): string {
  switch (cat) {
    case "Verdura": return "prx-c-verdura";
    case "Fruta": return "prx-c-fruta";
    case "Hortaliza Liviana": return "prx-c-hliviana";
    case "Hortaliza Pesada": return "prx-c-hpesada";
    case "Hongos/Hierbas": return "prx-c-hongos";
    case "Huevos": return "prx-c-huevos";
    default: return "prx-c-verdura";
  }
}

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
    <div className="prx-filters">
      <button className={value === "all" ? "on" : ""} onClick={() => onChange("all")} data-testid="cat-filter-all">Todas</button>
      {PRODUCT_CATEGORIES.map((cat) => (
        <button
          key={cat}
          className={value === cat ? "on" : ""}
          onClick={() => onChange(cat)}
          data-testid={`cat-filter-${cat.toLowerCase().replace(/\//g, "-").replace(/\s+/g, "-")}`}
        >{cat}</button>
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
  const cc = catClass(product.category);
  return (
    <div className="prx-pcard" data-testid={`card-product-${product.id}`}>
      <div className={`prx-cube ${cc}`}><Package className="h-[19px] w-[19px]" /></div>
      <div className="prx-pinfo">
        <div className="prx-pname" title={product.name}>{product.name}</div>
        <div className="prx-pbadges">
          {product.category && <span className={`prx-cat ${cc}`}>{product.category}</span>}
          {units.length === 0 ? (
            <span className="prx-unit none">Sin unidades</span>
          ) : (
            units.map((pu) => <span key={pu.id} className="prx-unit">{pu.unit}</span>)
          )}
        </div>
      </div>
      <div className="prx-pacts">
        <button className="prx-ic" onClick={() => onEdit(product)} data-testid={`button-edit-product-${product.id}`} title="Editar">
          <Pencil className="h-4 w-4" />
        </button>
        <button className="prx-ic del" onClick={() => onDelete(product.id)} data-testid={`button-delete-product-${product.id}`} title="Eliminar">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
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
const EMPTY_FORM = { name: "", description: "", unit: "KG" as const, category: "Verdura" as ProductCategory, ivaRate: "0.105" };

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
    (Array.isArray(allUnitsData) ? allUnitsData : []).forEach((pu) => {
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
    mutationFn: async ({ id, data, units }: { id: number; data: Partial<typeof EMPTY_FORM>; units?: string[] }) => {
      const res = await apiRequest("PATCH", `/api/products/${id}`, { ...data, units });
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

  const openEdit = async (p: Product) => {
    setEditing(p);
    setForm({ name: p.name, description: p.description ?? "", unit: p.unit as any, category: (p.category as ProductCategory) ?? "Verdura", ivaRate: parseFloat(String((p as any).ivaRate ?? "0.105")) >= 0.2 ? "0.21" : "0.105" });
    // Fetch all active units (including CAJON/BOLSA/BANDEJA) directly from the endpoint
    const res = await fetch(`/api/products/${p.id}/units`, { credentials: "include" });
    const units: { unit: string }[] = res.ok ? await res.json() : [];
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
        await updateMutation.mutateAsync({ id: editingId, data: snapshot, units });
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
      <div className="prods-rx">
        <style>{PRX_CSS}</style>
        <div className="prx-wrap">
          {/* Encabezado */}
          <div className="prx-top">
            <div>
              <h1 className="prx-title">Productos</h1>
              <div className="prx-subtitle">{activeProducts.length} productos activos</div>
            </div>
            <div className="prx-hbtns">
              <button className="prx-btn" onClick={() => setImportOpen(true)} data-testid="button-import-products">
                <Upload className="h-4 w-4" /> Importar
              </button>
              <button className="prx-btnnew" onClick={openCreate} data-testid="button-add-product">
                <Plus className="h-[17px] w-[17px]" /> Nuevo Producto
              </button>
            </div>
          </div>

          {/* Buscador */}
          <div className="prx-search">
            <Search className="h-[18px] w-[18px]" />
            <input placeholder="Buscar por nombre..." value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-products" />
          </div>

          {/* Filtros por categoría */}
          <CategoryFilter value={categoryFilter} onChange={setCategoryFilter} />

          {isLoading ? (
            <div className="prx-grid">
              {[1,2,3,4,5,6].map((i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="prx-empty">
              <div className="prx-emptyic"><Package className="h-6 w-6" /></div>
              <div className="big">Sin productos</div>
              <div>Agrega tu primer producto o cambia los filtros.</div>
              <button className="prx-btnnew" style={{ marginTop: 6 }} onClick={openCreate}><Plus className="h-[17px] w-[17px]" /> Agregar</button>
            </div>
          ) : (
            <div className="prx-grid">
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
            <div className="space-y-1.5">
              <Label htmlFor="piva">IVA *</Label>
              <Select value={form.ivaRate} onValueChange={(v) => setForm({ ...form, ivaRate: v })}>
                <SelectTrigger id="piva" data-testid="select-product-iva">
                  <SelectValue placeholder="Tasa de IVA" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.105" data-testid="select-iva-105">10,5% (general)</SelectItem>
                  <SelectItem value="0.21" data-testid="select-iva-21">21% (huevos)</SelectItem>
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
