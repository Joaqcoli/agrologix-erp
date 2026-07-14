import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Download, Pencil, Trash2 } from "lucide-react";
import type { PriceListItem } from "@shared/schema";
import { generatePriceListPDF } from "@/lib/pdf";

const CATEGORY_ORDER = [
  "Fruta", "Verdura", "Hortaliza Liviana", "Hortaliza Pesada", "Hongos/Hierbas", "Huevos",
];

// ── Rediseño Lista de Precios (Claude Design) — misma identidad que Productos/Clientes ──
const PLX_CSS = `
.pricelist-rx{background:#f4f4f1;min-height:100%;padding:30px 24px 56px;font-family:'Inter',system-ui,sans-serif;color:#1e2420;}
.pricelist-rx *{box-sizing:border-box;}
.plx-wrap{max-width:1000px;margin:0 auto;}
.plx-num{font-family:'Bricolage Grotesque','Inter',sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.plx-top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:22px;}
.plx-title{font-family:'Bricolage Grotesque';font-size:27px;font-weight:700;margin:0;letter-spacing:-.02em;}
.plx-subtitle{font-size:13.5px;color:#8b8f88;margin-top:5px;}
.plx-hbtns{display:flex;gap:10px;flex-wrap:wrap;}
.plx-btn{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #ecece8;border-radius:10px;padding:10px 16px;font-family:'Inter';font-size:14px;font-weight:500;color:#1e2420;cursor:pointer;}
.plx-btn:hover:not(:disabled){border-color:#cfcfc9;background:#f6f6f2;}
.plx-btn:disabled{opacity:.5;cursor:default;}
.plx-btn svg{color:#5f8020;}
.plx-btnnew{display:inline-flex;align-items:center;gap:8px;background:#6b8a2a;color:#fff;border:none;border-radius:11px;padding:11px 18px;font-family:'Inter';font-size:14px;font-weight:600;cursor:pointer;}
.plx-btnnew:hover{background:#5f7d24;}
.plx-catcard{background:#fff;border:1px solid #ecece8;border-radius:16px;overflow:hidden;margin-bottom:14px;}
.plx-cathead{padding:13px 20px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid #f1f1ee;}
.plx-c-verdura{background:#eef3e3;color:#5f8020;}
.plx-c-fruta{background:#f8ede8;color:#b0553f;}
.plx-c-hliviana{background:#e9eff7;color:#3a67a3;}
.plx-c-hpesada{background:#f9f1de;color:#c08a1e;}
.plx-c-hongos{background:#f3ebf0;color:#a86b8a;}
.plx-c-huevos{background:#f0eee6;color:#8a7a3e;}
.plx-tblwrap{overflow-x:auto;}
.plx-tbl{width:100%;border-collapse:collapse;}
.plx-tbl th{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#9a9e96;text-align:right;padding:11px 20px;border-bottom:1px solid #f1f1ee;white-space:nowrap;}
.plx-tbl th.l{text-align:left;}
.plx-tbl td{padding:12px 20px;border-bottom:1px solid #f5f5f2;font-size:14px;text-align:right;white-space:nowrap;}
.plx-tbl td.l{text-align:left;}
.plx-tbl tbody tr:last-child td{border-bottom:none;}
.plx-tbl tbody tr:hover td{background:#f8f8f5;}
.plx-pname{font-weight:500;color:#1e2420;}
.plx-price{font-weight:700;color:#5f8020;}
.plx-dash{color:#c8ccc3;}
.plx-acts{display:inline-flex;gap:2px;justify-content:flex-end;}
.plx-ic{width:30px;height:30px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;color:#8b8f88;}
.plx-ic:hover{background:#f1f1ee;color:#1e2420;}
.plx-ic.del:hover{background:#f8ede8;color:#b0553f;}
.plx-empty{background:#fff;border:1px solid #ecece8;border-radius:16px;padding:48px 20px;text-align:center;color:#8b8f88;}
.plx-empty .big{font-size:15px;font-weight:600;color:#1e2420;margin-bottom:4px;}
`;

function plxCatClass(cat: string): string {
  switch (cat) {
    case "Verdura": return "plx-c-verdura";
    case "Fruta": return "plx-c-fruta";
    case "Hortaliza Liviana": return "plx-c-hliviana";
    case "Hortaliza Pesada": return "plx-c-hpesada";
    case "Hongos/Hierbas": return "plx-c-hongos";
    case "Huevos": return "plx-c-huevos";
    default: return "plx-c-verdura";
  }
}

import { fmtPesos } from "@/lib/format";
// Particularidad de price-list: muestra "—" si el precio es 0 o inválido.
const fmt = (v: string | number) => {
  const n = parseFloat(String(v));
  return n ? fmtPesos(n) : "—";
};

type ItemFormState = {
  category: string;
  productName: string;
  pricePerCajon: string;
  pricePerKg: string;
};

function ItemDialog({
  open,
  initial,
  onClose,
  onSave,
  loading,
}: {
  open: boolean;
  initial: ItemFormState;
  onClose: () => void;
  onSave: (data: ItemFormState) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState<ItemFormState>(initial);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); else setForm(initial); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{initial.productName ? "Editar producto" : "Agregar producto"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <Label>Categoría</Label>
            <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_ORDER.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Producto</Label>
            <Input
              className="mt-1"
              value={form.productName}
              onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))}
              placeholder="Ej: Tomate Redondo"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Precio x Cajón ($)</Label>
              <Input
                className="mt-1"
                type="number"
                min="0"
                step="1"
                value={form.pricePerCajon}
                onChange={(e) => setForm((f) => ({ ...f, pricePerCajon: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div>
              <Label className="text-xs">Precio x Kg/U ($)</Label>
              <Input
                className="mt-1"
                type="number"
                min="0"
                step="1"
                value={form.pricePerKg}
                onChange={(e) => setForm((f) => ({ ...f, pricePerKg: e.target.value }))}
                placeholder="0"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button
            onClick={() => onSave(form)}
            disabled={loading || !form.productName.trim()}
          >
            {loading ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PriceListPage() {
  const { toast } = useToast();

  const { data: items = [], isLoading } = useQuery<PriceListItem[]>({
    queryKey: ["/api/price-list"],
    queryFn: () => apiRequest("GET", "/api/price-list").then((r) => r.json()),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<PriceListItem | null>(null);

  const emptyForm: ItemFormState = {
    category: CATEGORY_ORDER[0],
    productName: "",
    pricePerCajon: "",
    pricePerKg: "",
  };

  const createMutation = useMutation({
    mutationFn: (data: ItemFormState) =>
      apiRequest("POST", "/api/price-list", {
        category: data.category,
        productName: data.productName,
        pricePerCajon: data.pricePerCajon || "0",
        pricePerKg: data.pricePerKg || "0",
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-list"] });
      toast({ title: "Producto agregado" });
      setDialogOpen(false);
    },
    onError: () => toast({ title: "Error al guardar", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ItemFormState }) =>
      apiRequest("PATCH", `/api/price-list/${id}`, {
        category: data.category,
        productName: data.productName,
        pricePerCajon: data.pricePerCajon || "0",
        pricePerKg: data.pricePerKg || "0",
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-list"] });
      toast({ title: "Producto actualizado" });
      setEditItem(null);
    },
    onError: () => toast({ title: "Error al actualizar", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/price-list/${id}`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-list"] });
      toast({ title: "Producto eliminado" });
    },
    onError: () => toast({ title: "Error al eliminar", variant: "destructive" }),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, PriceListItem[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const item of items) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    for (const [k, v] of map) { if (v.length === 0) map.delete(k); }
    return map;
  }, [items]);

  const handleDownload = async () => {
    const today = new Date().toLocaleDateString("es-AR", {
      day: "2-digit", month: "2-digit", year: "numeric",
    });
    await generatePriceListPDF(
      items.map((i) => ({
        category: i.category,
        productName: i.productName,
        pricePerCajon: i.pricePerCajon as string,
        pricePerKg: i.pricePerKg as string,
      })),
      today,
    );
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Layout>
      <div className="pricelist-rx">
        <style>{PLX_CSS}</style>
        <div className="plx-wrap">
          {/* Encabezado */}
          <div className="plx-top">
            <div>
              <h1 className="plx-title">Lista de Precios</h1>
              <div className="plx-subtitle">Precios semanales para clientes</div>
            </div>
            <div className="plx-hbtns">
              <button className="plx-btn" onClick={handleDownload} disabled={items.length === 0}>
                <Download className="h-4 w-4" /> Descargar PDF
              </button>
              <button className="plx-btnnew" onClick={() => setDialogOpen(true)}>
                <Plus className="h-[17px] w-[17px]" /> Agregar
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="plx-empty">Cargando…</div>
          ) : items.length === 0 ? (
            <div className="plx-empty">
              <div className="big">Sin productos en la lista</div>
              <div>Agregá productos con el botón de arriba.</div>
            </div>
          ) : (
            Array.from(grouped.entries()).map(([cat, catItems]) => (
              <div key={cat} className="plx-catcard">
                <div className={`plx-cathead ${plxCatClass(cat)}`}>{cat}</div>
                <div className="plx-tblwrap">
                  <table className="plx-tbl">
                    <thead>
                      <tr>
                        <th className="l">Producto</th>
                        <th>Precio x Cajón</th>
                        <th>Precio x Kg/U</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {catItems.map((item) => {
                        const pc = fmt(item.pricePerCajon as string);
                        const pk = fmt(item.pricePerKg as string);
                        return (
                          <tr key={item.id}>
                            <td className="l"><span className="plx-pname">{item.productName}</span></td>
                            <td>{pc === "—" ? <span className="plx-dash">—</span> : <span className="plx-price plx-num">{pc}</span>}</td>
                            <td>{pk === "—" ? <span className="plx-dash">—</span> : <span className="plx-price plx-num">{pk}</span>}</td>
                            <td>
                              <div className="plx-acts">
                                <button className="plx-ic" onClick={() => setEditItem(item)} title="Editar"><Pencil className="h-4 w-4" /></button>
                                <button className="plx-ic del" onClick={() => { if (confirm(`¿Eliminar "${item.productName}"?`)) deleteMutation.mutate(item.id); }} title="Eliminar"><Trash2 className="h-4 w-4" /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <ItemDialog
        open={dialogOpen}
        initial={emptyForm}
        onClose={() => setDialogOpen(false)}
        onSave={(data) => createMutation.mutate(data)}
        loading={isPending}
      />

      {editItem && (
        <ItemDialog
          open={true}
          initial={{
            category: editItem.category,
            productName: editItem.productName,
            pricePerCajon: editItem.pricePerCajon as string,
            pricePerKg: editItem.pricePerKg as string,
          }}
          onClose={() => setEditItem(null)}
          onSave={(data) => updateMutation.mutate({ id: editItem.id, data })}
          loading={isPending}
        />
      )}
    </Layout>
  );
}
