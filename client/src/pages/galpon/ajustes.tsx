import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { GalponLayout } from "./layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Scale, Sprout, Undo2, Info } from "lucide-react";

// SIN plata: la respuesta de /api/galpon/stock-adjustments NO trae unitCost ni value.
type Adj = {
  id: number; createdAt: string; productId: number; productName: string;
  category: string; unit: string; movementType: "in" | "out"; quantity: number;
  tipo: string; label: string; section: "pre" | "post";
  createdBy: number | null; createdByName: string | null;
  revertKind: "merma_rinde" | "galpon_weight" | null; revertible: boolean;
  notes: string;
};

const fmtQty = (n: number) => Number(n.toFixed(2)).toLocaleString("es-AR");
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
const TIPO_STYLE: Record<string, string> = {
  ajuste_peso: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  merma: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  rinde: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  rinde_pedido: "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400",
  correccion: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

export default function GalponAjustes() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");

  const { data: rows = [], isLoading } = useQuery<Adj[]>({
    queryKey: ["/api/galpon/stock-adjustments"],
    queryFn: () => fetch("/api/galpon/stock-adjustments", { credentials: "include" }).then((r) => r.json()),
  });

  // El galpón solo puede deshacer SUS ajustes de peso (no merma/rinde, que son del admin).
  const revertWeight = useMutation({
    mutationFn: ({ id }: { id: number }) =>
      apiRequest("POST", `/api/galpon/stock-adjustments/${id}/revert-weight`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/galpon/stock-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/galpon/stock"] });
      toast({ title: "Ajuste de peso deshecho", description: "Se volvió al peso anterior." });
    },
    onError: (e: any) => toast({ title: "No se pudo deshacer", description: e.message, variant: "destructive" }),
  });

  const handleUndo = (a: Adj) => {
    if (!confirm(`Deshacer el ajuste de peso de ${a.productName} (volver al peso anterior).\n\nOjo: si el stock se movió desde el ajuste, el peso/costo puede quedar levemente distinto.\n\n¿Continuar?`)) return;
    revertWeight.mutate({ id: a.id });
  };

  const filtered = useMemo(() => rows.filter((r) => {
    if (search && !r.productName.toLowerCase().includes(search.toLowerCase())) return false;
    if (tipoFilter !== "all" && r.tipo !== tipoFilter) return false;
    if (dateFilter && r.createdAt.slice(0, 10) !== dateFilter) return false;
    return true;
  }), [rows, search, tipoFilter, dateFilter]);

  const pre = filtered.filter((r) => r.section === "pre");
  const post = filtered.filter((r) => r.section === "post");

  const renderTable = (items: Adj[], emptyMsg: string, allowUndo: boolean) => (
    items.length === 0 ? (
      <p className="text-sm text-muted-foreground py-6 text-center">{emptyMsg}</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left py-2 pr-3">Fecha</th>
              <th className="text-left py-2 pr-3">Producto</th>
              <th className="text-left py-2 pr-3">Tipo</th>
              <th className="text-right py-2 pr-3">Δ Cantidad</th>
              <th className="text-left py-2 pr-3">Quién</th>
              <th className="text-right py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-b last:border-0 hover:bg-muted/40" data-testid={`adj-row-${a.id}`}>
                <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{fmtDate(a.createdAt)}</td>
                <td className="py-2 pr-3 font-medium">{a.productName}</td>
                <td className="py-2 pr-3">
                  <Badge className={`text-[10px] ${TIPO_STYLE[a.tipo] ?? ""}`} variant="secondary">{a.label}</Badge>
                </td>
                <td className={`py-2 pr-3 text-right tabular-nums font-medium ${a.movementType === "out" ? "text-red-600" : "text-green-600"}`}>
                  {a.movementType === "out" ? "−" : "+"}{fmtQty(a.quantity)} {a.unit}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">{a.createdByName ?? "—"}</td>
                <td className="py-2 text-right">
                  {allowUndo && a.revertible && a.revertKind === "galpon_weight" ? (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => handleUndo(a)} data-testid={`undo-${a.id}`}>
                      <Undo2 className="h-3.5 w-3.5 mr-1" /> Deshacer
                    </Button>
                  ) : a.section === "post" ? (
                    <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1" title="Merma/rinde se manejan desde la cuenta admin">
                      <Info className="h-3 w-3" /> informativo
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );

  return (
    <GalponLayout title="Ajustes de stock">
      {/* Filtros (sin plata) */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Input placeholder="Buscar producto…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-48" data-testid="filter-search" />
        <Select value={tipoFilter} onValueChange={setTipoFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            <SelectItem value="ajuste_peso">Ajuste de peso</SelectItem>
            <SelectItem value="merma">Merma</SelectItem>
            <SelectItem value="rinde">Rinde</SelectItem>
            <SelectItem value="rinde_pedido">Rinde (pedido)</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-40" data-testid="filter-date" />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Cargando…</p>
      ) : (
        <div className="space-y-4">
          {/* Pre-venta: el galpón puede deshacer sus ajustes de peso */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Scale className="h-4 w-4 text-blue-600" />
                <h2 className="font-semibold">Pre-venta — ajustes de peso</h2>
                <Badge variant="outline" className="text-[10px]">{pre.length}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Correcciones de kilaje por envase. Podés deshacer las de hoy/ayer si te equivocaste.</p>
              {renderTable(pre, "Sin ajustes de peso en este filtro.", true)}
            </CardContent>
          </Card>

          {/* Post-venta: informativo (merma/rinde se manejan desde admin) */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Sprout className="h-4 w-4 text-green-600" />
                <h2 className="font-semibold">Post-venta — merma y rinde</h2>
                <Badge variant="outline" className="text-[10px]">{post.length}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Lo que se perdió (merma) o apareció (rinde). Informativo.</p>
              {renderTable(post, "Sin merma/rinde en este filtro.", false)}
            </CardContent>
          </Card>
        </div>
      )}
    </GalponLayout>
  );
}
