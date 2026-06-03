import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Pencil, Trash2, Download } from "lucide-react";
import type { Supplier } from "@shared/schema";

const EMPTY: Partial<Supplier> = { name: "", cuit: "", email: "", phone: "", address: "", notes: "" };

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const fmtInt = (v: number) => Math.round(v).toLocaleString("es-AR");
const fmtPct = (v: number) => v.toFixed(2) + "%";

type APRow = {
  supplierId: number;
  supplierName: string;
  saldoMesAnterior: number;
  facturacion: number;
  cobranza: number;
  saldo: number;
  pct: number;
};
type APTotals = { saldoMesAnterior: number; facturacion: number; cobranza: number; saldo: number };
type APSummary = { fromDate: string; toDate: string; suppliers: APRow[]; totals: APTotals };

// Para proveedores, saldo positivo = lo que les debemos (a pagar)
function SaldoBadge({ saldo }: { saldo: number }) {
  if (saldo > 0) return <span className="font-bold text-destructive">${fmtInt(saldo)}</span>;
  if (saldo < 0) return <span className="font-bold text-green-600 dark:text-green-400">${fmtInt(saldo)}</span>;
  return <span className="text-muted-foreground">$0</span>;
}

type FilterType = "mes" | "semana" | "dia";

function weekRange(weekStr: string): [string, string] {
  const [ys, ws] = weekStr.split("-W");
  const year = parseInt(ys), week = parseInt(ws);
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = (jan4.getDay() + 6) % 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + (week - 1) * 7);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return [fmt(monday), fmt(nextMonday)];
}

function toISOWeek(d: Date): string {
  const tmp = new Date(d.getTime());
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const week1 = new Date(tmp.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${tmp.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export default function SuppliersPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<Partial<Supplier>>(EMPTY);

  const today = new Date();
  const [filterType, setFilterType] = useState<FilterType>("mes");
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState(() => today.toISOString().split("T")[0]);
  const [selectedWeek, setSelectedWeek] = useState(() => toISOWeek(today));
  const [exporting, setExporting] = useState(false);

  const years = Array.from({ length: 4 }, (_, i) => today.getFullYear() - i);

  const [dateFrom, dateTo] = useMemo<[string, string]>(() => {
    if (filterType === "mes") {
      const from = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-01`;
      const em = selectedMonth === 12 ? 1 : selectedMonth + 1;
      const ey = selectedMonth === 12 ? selectedYear + 1 : selectedYear;
      return [from, `${ey}-${String(em).padStart(2, "0")}-01`];
    }
    if (filterType === "dia") {
      const d = new Date(selectedDate + "T00:00:00");
      d.setDate(d.getDate() + 1);
      return [selectedDate, d.toISOString().split("T")[0]];
    }
    return weekRange(selectedWeek);
  }, [filterType, selectedMonth, selectedYear, selectedDate, selectedWeek]);

  // Directorio de proveedores (para búsqueda por CUIT/teléfono y para editar/eliminar)
  const { data: suppliers } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const supplierMap = useMemo(() => {
    const m = new Map<number, Supplier>();
    (Array.isArray(suppliers) ? suppliers : []).forEach((s) => m.set(s.id, s));
    return m;
  }, [suppliers]);

  // Resumen CC del período
  const { data, isLoading, error } = useQuery<APSummary>({
    queryKey: ["/api/ap/cc/summary", dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`/api/ap/cc/summary?dateFrom=${dateFrom}&dateTo=${dateTo}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: (d: Partial<Supplier>) => apiRequest("POST", "/api/suppliers", d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Proveedor creado" });
      setDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Supplier> }) =>
      apiRequest("PATCH", `/api/suppliers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Proveedor actualizado" });
      setDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/suppliers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Proveedor eliminado" });
      setDeleteId(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openCreate = () => { setEditing(null); setForm(EMPTY); setDialogOpen(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setForm(s); setDialogOpen(true); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) updateMutation.mutate({ id: editing.id, data: form });
    else createMutation.mutate(form);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/ap/cc/export?month=${selectedMonth}&year=${selectedYear}`, { credentials: "include" });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `CC-Proveedores-${MONTHS[selectedMonth - 1]}-${selectedYear}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  // Filtro de búsqueda: nombre (del resumen) + CUIT/teléfono (del directorio)
  const q = search.toLowerCase();
  const rows = useMemo(() => {
    const all = data?.suppliers ?? [];
    if (!q) return all;
    return all.filter((r) => {
      const s = supplierMap.get(r.supplierId);
      return (
        r.supplierName.toLowerCase().includes(q) ||
        (s?.cuit ?? "").toLowerCase().includes(q) ||
        (s?.phone ?? "").includes(search)
      );
    });
  }, [data, q, search, supplierMap]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  const periodLabel = filterType === "mes"
    ? `${MONTHS[selectedMonth - 1]} ${selectedYear}`
    : filterType === "dia"
      ? new Date(selectedDate + "T00:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })
      : (() => { const [f, t] = weekRange(selectedWeek); const d1 = new Date(f + "T00:00:00"); const d2 = new Date(new Date(t + "T00:00:00").getTime() - 86400000); return `${d1.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} – ${d2.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}`; })();

  return (
    <Layout title="Proveedores">
      <div className="p-5 max-w-[1400px] mx-auto space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-foreground">Proveedores</h2>
            <p className="text-sm text-muted-foreground">{periodLabel}</p>
          </div>

          {/* Period selector */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {(["mes", "semana", "dia"] as FilterType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-2.5 py-1.5 capitalize transition-colors ${filterType === t ? "bg-primary text-primary-foreground" : "hover:bg-muted/50 text-muted-foreground"}`}
                >
                  {t === "mes" ? "Mes" : t === "semana" ? "Semana" : "Día"}
                </button>
              ))}
            </div>

            {filterType === "mes" && (
              <>
                <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                  <SelectTrigger className="h-9 w-36 text-sm" data-testid="select-month"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                  <SelectTrigger className="h-9 w-24 text-sm" data-testid="select-year"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </>
            )}
            {filterType === "dia" && (
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm" data-testid="input-filter-date" />
            )}
            {filterType === "semana" && (
              <input type="week" value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm" data-testid="input-filter-week" />
            )}

            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || isLoading || filterType !== "mes"} title={filterType !== "mes" ? "Exportar solo disponible para vista mensual" : ""} data-testid="button-export-ap-cc">
              <Download className="mr-2 h-4 w-4" />
              {exporting ? "..." : "Exportar XLSX"}
            </Button>

            <Button onClick={openCreate} data-testid="button-add-supplier">
              <Plus className="mr-2 h-4 w-4" /> Nuevo Proveedor
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, CUIT o teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-suppliers"
          />
        </div>

        {error && (
          <div className="text-sm text-destructive p-3 bg-destructive/10 rounded-md">
            Error al cargar: {String(error)}
          </div>
        )}

        {/* Table */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Por Proveedor — {periodLabel}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b-2 border-border bg-muted/40">
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground uppercase tracking-wide">Proveedor</th>
                    <th className="text-right py-2 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Saldo Anterior</th>
                    <th className="text-right py-2 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Facturación</th>
                    <th className="text-right py-2 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Pagos</th>
                    <th className="text-right py-2 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Saldo Actual</th>
                    <th className="text-right py-2 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">%</th>
                    <th className="py-2 px-3 w-px"></th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-b border-border">
                        {Array.from({ length: 7 }).map((_, j) => (
                          <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                        ))}
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        {search ? "Sin proveedores que coincidan" : "Sin movimientos en este período"}
                      </td>
                    </tr>
                  ) : rows.map((row) => {
                    const s = supplierMap.get(row.supplierId);
                    return (
                      <tr
                        key={row.supplierId}
                        className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer group"
                        onClick={() => setLocation(`/suppliers/${row.supplierId}/cc`)}
                        data-testid={`row-supplier-${row.supplierId}`}
                      >
                        <td className="py-2 px-3">
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground group-hover:text-primary transition-colors">{row.supplierName}</span>
                            {s?.cuit && <span className="text-[10px] text-muted-foreground">CUIT: {s.cuit}</span>}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {row.saldoMesAnterior !== 0 ? <SaldoBadge saldo={row.saldoMesAnterior} /> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2 px-3 text-right text-foreground whitespace-nowrap font-medium">
                          {row.facturacion > 0 ? `$${fmtInt(row.facturacion)}` : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {row.cobranza > 0
                            ? <span className="text-green-600 dark:text-green-400">${fmtInt(row.cobranza)}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          <SaldoBadge saldo={row.saldo} />
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {row.pct > 0
                            ? <span className="text-muted-foreground font-mono">{fmtPct(row.pct)}</span>
                            : <span className="text-muted-foreground">0.00%</span>}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          {s && (
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(s)} data-testid={`button-edit-supplier-${s.id}`} title="Editar">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteId(s.id)} data-testid={`button-delete-supplier-${s.id}`} title="Eliminar">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {data && rows.length > 0 && !search && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/20">
                      <td className="py-2.5 px-3 font-bold text-foreground uppercase tracking-wide">TOTAL</td>
                      <td className="py-2.5 px-3 text-right font-bold whitespace-nowrap"><SaldoBadge saldo={data.totals.saldoMesAnterior} /></td>
                      <td className="py-2.5 px-3 text-right font-bold text-foreground whitespace-nowrap">${fmtInt(data.totals.facturacion)}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-green-600 dark:text-green-400 whitespace-nowrap">
                        {data.totals.cobranza > 0 ? `$${fmtInt(data.totals.cobranza)}` : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold whitespace-nowrap"><SaldoBadge saldo={data.totals.saldo} /></td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap text-muted-foreground">—</td>
                      <td className="py-2.5 px-2"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Proveedor" : "Nuevo Proveedor"}</DialogTitle>
            <DialogDescription>
              {editing ? "Modifica los datos del proveedor." : "Completa la información del nuevo proveedor."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="name">Nombre / Razón Social *</Label>
                <Input id="name" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-supplier-name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cuit">CUIT</Label>
                <Input id="cuit" value={form.cuit ?? ""} onChange={(e) => setForm({ ...form, cuit: e.target.value })} data-testid="input-supplier-cuit" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Teléfono</Label>
                <Input id="phone" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-supplier-phone" />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="email">Correo</Label>
                <Input id="email" type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-supplier-email" />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="address">Dirección</Label>
                <Input id="address" value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="input-supplier-address" />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="notes">Notas</Label>
                <Textarea id="notes" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} data-testid="input-supplier-notes" />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-supplier">
                {isPending ? "Guardando..." : editing ? "Guardar cambios" : "Crear proveedor"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar proveedor?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción desactivará al proveedor. No se eliminarán sus datos.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
