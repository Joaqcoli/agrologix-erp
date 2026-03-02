import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Package, Download, ClipboardList, Users, AlertTriangle, Layers, ChevronDown,
} from "lucide-react";

type LoadListRow = {
  productId: number;
  productName: string;
  category: string;
  unit: string;
  totalQty: number;
  stockQty: number;
  diffQty: number;
  customersCount: number;
  customerNames: string[];
};

const CATEGORY_ORDER = [
  "Fruta", "Verdura", "Hortaliza Liviana", "Hortaliza Pesada", "Hongos/Hierbas", "Huevos",
];

type PendingRow = {
  orderId: number;
  orderFolio: string;
  customerName: string;
  rawText: string;
  qty: number | null;
  unit: string | null;
};

type LoadListData = {
  summary: {
    date: string;
    ordersCount: number;
    customersCount: number;
    rowsCount: number;
    shortagesCount: number;
  };
  rows: LoadListRow[];
  pending: PendingRow[];
};

function fmtQty(qty: number, unit: string) {
  const u = unit.toUpperCase();
  if (u === "KG") {
    const frac = qty % 1;
    return frac === 0 ? qty.toFixed(0) : qty.toFixed(2);
  }
  return Math.round(qty).toString();
}

function fmtDiff(diff: number, unit: string) {
  const frac = diff % 1;
  const u = unit.toUpperCase();
  if (u === "KG") return (frac === 0 ? diff.toFixed(0) : diff.toFixed(2));
  return Math.round(diff).toString();
}

export default function LoadListPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [includeStock, setIncludeStock] = useState(false);
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState("all");
  const [detailRow, setDetailRow] = useState<LoadListRow | null>(null);

  const { data, isLoading } = useQuery<LoadListData>({
    queryKey: ["/api/load-list", date],
    queryFn: async () => {
      const res = await fetch(
        `/api/load-list?date=${date}&includeDrafts=1`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Error fetching load list");
      return res.json();
    },
    enabled: !!date,
  });

  const allUnits = useMemo(() => {
    if (!data?.rows) return [];
    return Array.from(new Set(data.rows.map((r) => r.unit))).sort();
  }, [data]);

  const filteredRows = useMemo(() => {
    if (!data?.rows) return [];
    return data.rows.filter((r) => {
      const matchesSearch = r.productName.toLowerCase().includes(search.toLowerCase());
      const matchesUnit = unitFilter === "all" || r.unit === unitFilter;
      return matchesSearch && matchesUnit;
    });
  }, [data, search, unitFilter]);

  const handleExport = () => {
    window.open(
      `/api/load-list/export?date=${date}&includeDrafts=1`,
      "_blank"
    );
  };

  const formattedDate = date
    ? new Date(date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })
    : "";

  return (
    <Layout title="Lista de Carga">
      <div className="p-6 max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Lista de Carga</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Consolidado por producto y unidad — stock y faltantes
            </p>
          </div>
          <Button onClick={handleExport} variant="outline" data-testid="button-export-load-list">
            <Download className="mr-2 h-4 w-4" /> Exportar XLSX
          </Button>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="date-filter">Fecha</Label>
            <Input
              id="date-filter"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
              data-testid="input-load-list-date"
            />
          </div>
          <div className="flex items-center gap-2 pb-0.5">
            <Switch
              id="toggle-stock"
              checked={includeStock}
              onCheckedChange={setIncludeStock}
              data-testid="toggle-include-stock"
            />
            <Label htmlFor="toggle-stock" className="cursor-pointer text-sm">
              Incluir Stock
            </Label>
          </div>
        </div>

        {/* Summary cards */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
          </div>
        ) : data ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <ClipboardList className="h-3.5 w-3.5" /> Pedidos
                </div>
                <p className="text-2xl font-bold text-foreground" data-testid="summary-orders-count">{data.summary.ordersCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Users className="h-3.5 w-3.5" /> Clientes
                </div>
                <p className="text-2xl font-bold text-foreground" data-testid="summary-customers-count">{data.summary.customersCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Layers className="h-3.5 w-3.5" /> Productos/ítems
                </div>
                <p className="text-2xl font-bold text-foreground" data-testid="summary-rows-count">{data.summary.rowsCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> Faltantes
                </div>
                <p className={`text-2xl font-bold ${data.summary.shortagesCount > 0 ? "text-destructive" : "text-foreground"}`} data-testid="summary-shortages-count">
                  {data.summary.shortagesCount}
                </p>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {/* Pending section */}
        {data && data.pending.length > 0 && (
          <Card className="border-amber-300 dark:border-amber-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" />
                Pendientes de asignación ({data.pending.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-1.5 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cliente</th>
                      <th className="text-left py-1.5 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pedido</th>
                      <th className="text-left py-1.5 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Texto original</th>
                      <th className="text-right py-1.5 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cant.</th>
                      <th className="text-left py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pending.map((p, idx) => (
                      <tr key={idx} className="border-b border-border last:border-0" data-testid={`pending-row-${idx}`}>
                        <td className="py-2 pr-3 text-foreground font-medium">{p.customerName}</td>
                        <td className="py-2 pr-3 text-muted-foreground text-xs">{p.orderFolio}</td>
                        <td className="py-2 pr-3 text-amber-700 dark:text-amber-400 italic">{p.rawText}</td>
                        <td className="py-2 pr-3 text-right text-foreground">{p.qty ?? "—"}</td>
                        <td className="py-2 text-muted-foreground text-xs">{p.unit ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        {data && data.rows.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-40">
              <Input
                placeholder="Buscar producto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-product"
              />
            </div>
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="w-36" data-testid="select-unit-filter">
                <SelectValue placeholder="Unidad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las unidades</SelectItem>
                {allUnits.map((u) => (
                  <SelectItem key={u} value={u}>{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Main table */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}
          </div>
        ) : !data || data.rows.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <ClipboardList className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Sin pedidos para esta fecha</p>
              <p className="text-sm text-muted-foreground text-center">
                No hay ítems cargados para el {formattedDate}.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Lista de Carga — Galpón — {formattedDate}
                </CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {filteredRows.length} {filteredRows.length === 1 ? "producto" : "productos"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">#</th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Producto</th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unidad</th>
                      <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total Pedido</th>
                      {includeStock && <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stock</th>}
                      {includeStock && <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Neto a Comprar</th>}
                      <th className="text-center py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Clientes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Group filtered rows by category preserving backend sort order
                      const grouped: Record<string, LoadListRow[]> = {};
                      for (const row of filteredRows) {
                        const cat = row.category || "Sin categoría";
                        if (!grouped[cat]) grouped[cat] = [];
                        grouped[cat].push(row);
                      }
                      const sortedCats = [
                        ...CATEGORY_ORDER.filter((c) => grouped[c]?.length > 0),
                        ...Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c) && grouped[c]?.length > 0),
                      ];
                      let globalIdx = 0;
                      return sortedCats.map((cat) => (
                        <>
                          <tr key={`cat-${cat}`} className="border-b border-border bg-muted/50">
                            <td colSpan={includeStock ? 7 : 5} className="py-1.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                              {cat}
                            </td>
                          </tr>
                          {grouped[cat].map((row) => {
                            globalIdx++;
                            const isShortage = row.diffQty < 0;
                            return (
                              <tr
                                key={`${row.productId}-${row.unit}`}
                                className={`border-b border-border last:border-0 hover:bg-muted/20 transition-colors cursor-pointer ${includeStock && isShortage ? "bg-red-50 dark:bg-red-950/20" : ""}`}
                                onClick={() => setDetailRow(row)}
                                data-testid={`load-row-${row.productId}-${row.unit}`}
                              >
                                <td className="py-3 px-4 text-muted-foreground text-xs">{globalIdx}</td>
                                <td className="py-3 px-3 font-medium text-foreground">{row.productName}</td>
                                <td className="py-3 px-3">
                                  <Badge variant="outline" className="text-[10px] font-mono">{row.unit}</Badge>
                                </td>
                                <td className="py-3 px-3 text-right font-semibold text-foreground">
                                  {fmtQty(row.totalQty, row.unit)}
                                </td>
                                {includeStock && (
                                  <td className="py-3 px-3 text-right text-muted-foreground">
                                    {fmtQty(row.stockQty, row.unit)}
                                  </td>
                                )}
                                {includeStock && (
                                  <td className="py-3 px-3 text-right font-bold">
                                    {isShortage ? (
                                      <span className="text-destructive">
                                        {fmtDiff(Math.abs(row.diffQty), row.unit)} <span className="text-[10px] font-normal">A COMPRAR</span>
                                      </span>
                                    ) : (
                                      <span className="text-green-600 dark:text-green-400 text-xs font-medium">OK</span>
                                    )}
                                  </td>
                                )}
                                <td className="py-3 px-4 text-center">
                                  <button
                                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={(e) => { e.stopPropagation(); setDetailRow(row); }}
                                    data-testid={`button-detail-${row.productId}-${row.unit}`}
                                  >
                                    <Users className="h-3.5 w-3.5" />
                                    {row.customersCount}
                                    <ChevronDown className="h-3 w-3" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailRow(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              {detailRow?.productName} — {detailRow?.unit}
            </DialogTitle>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Total pedido</p>
                  <p className="font-bold text-foreground">{fmtQty(detailRow.totalQty, detailRow.unit)}</p>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Stock</p>
                  <p className="font-bold text-foreground">{fmtQty(detailRow.stockQty, detailRow.unit)}</p>
                </div>
                <div className={`rounded-lg p-3 ${detailRow.diffQty < 0 ? "bg-red-100 dark:bg-red-950/40" : "bg-green-100 dark:bg-green-950/40"}`}>
                  <p className="text-xs text-muted-foreground mb-0.5">Diferencia</p>
                  <p className={`font-bold ${detailRow.diffQty < 0 ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                    {detailRow.diffQty > 0 ? "+" : ""}{fmtDiff(detailRow.diffQty, detailRow.unit)}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Clientes que lo piden ({detailRow.customersCount})
                </p>
                <ul className="space-y-1">
                  {detailRow.customerNames.map((name, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
