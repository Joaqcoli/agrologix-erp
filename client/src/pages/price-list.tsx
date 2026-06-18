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
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Lista de Precios</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Precios semanales para clientes</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleDownload} disabled={items.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Descargar PDF
            </Button>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Agregar
            </Button>
          </div>
        </div>

        {isLoading ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Cargando...</CardContent></Card>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <p className="font-medium">Sin productos en la lista</p>
              <p className="text-sm mt-1">Agregá productos con el botón de arriba.</p>
            </CardContent>
          </Card>
        ) : (
          Array.from(grouped.entries()).map(([cat, catItems]) => (
            <Card key={cat}>
              <CardHeader className="py-3 px-4 bg-green-50 border-b rounded-t-lg">
                <CardTitle className="text-sm font-semibold text-green-800 uppercase tracking-wide">
                  {cat}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-xs text-muted-foreground uppercase">
                      <th className="text-left px-4 py-2 font-medium">Producto</th>
                      <th className="text-right px-4 py-2 font-medium w-32">Precio x Cajón</th>
                      <th className="text-right px-4 py-2 font-medium w-28">Precio x Kg/U</th>
                      <th className="w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {catItems.map((item, i) => (
                      <tr key={item.id} className={i % 2 === 1 ? "bg-gray-50" : ""}>
                        <td className="px-4 py-2 font-medium">{item.productName}</td>
                        <td className="px-4 py-2 text-right font-semibold text-green-700">
                          {fmt(item.pricePerCajon as string)}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-green-700">
                          {fmt(item.pricePerKg as string)}
                        </td>
                        <td className="px-2 py-1 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => setEditItem(item)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => {
                                if (confirm(`¿Eliminar "${item.productName}"?`)) {
                                  deleteMutation.mutate(item.id);
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))
        )}
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
