import { useState, useMemo } from "react";
import { fmtFecha } from "@/lib/format";
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
import { Plus, Search, Pencil, Trash2, Download, ChevronDown } from "lucide-react";
import type { Supplier } from "@shared/schema";

const EMPTY: Partial<Supplier> = { name: "", cuit: "", email: "", phone: "", address: "", notes: "" };

// ── Rediseño Proveedores (Claude Design) — CSS de diseno-caja/proveedores-rediseno.html ──
const PVX_CSS = `
.prov-rx{background:#f4f4f1;min-height:100%;padding:30px 24px 56px;font-family:'Inter',system-ui,sans-serif;color:#1e2420;}
.prov-rx *{box-sizing:border-box;}
.pvx-wrap{max-width:1360px;margin:0 auto;}
.pvx-num{font-family:'Bricolage Grotesque','Inter',sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.pvx-top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:18px;}
.pvx-title{font-family:'Bricolage Grotesque';font-size:27px;font-weight:700;margin:0;letter-spacing:-.02em;}
.pvx-subtitle{font-size:13.5px;color:#8b8f88;margin-top:5px;}
.pvx-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.pvx-seg{display:inline-flex;background:#eeeeea;border-radius:10px;padding:3px;gap:2px;}
.pvx-seg button{border:none;background:transparent;font-family:'Inter';font-size:13px;font-weight:600;color:#6f7469;padding:7px 15px;border-radius:8px;cursor:pointer;}
.pvx-seg button.on{background:#6b8a2a;color:#fff;box-shadow:0 1px 2px rgba(0,0,0,.12);}
.pvx-sel{position:relative;display:inline-flex;}
.pvx-sel select{appearance:none;-webkit-appearance:none;background:#fff;border:1px solid #ecece8;border-radius:10px;padding:9px 34px 9px 14px;font-family:'Inter';font-size:13.5px;font-weight:500;color:#1e2420;cursor:pointer;min-width:96px;}
.pvx-sel select:focus{outline:none;border-color:#5f8020;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.pvx-sel svg{position:absolute;right:12px;top:50%;transform:translateY(-50%);pointer-events:none;color:#8b8f88;}
.pvx-dateinput{background:#fff;border:1px solid #ecece8;border-radius:10px;padding:9px 13px;font-family:'Inter';font-size:13.5px;color:#1e2420;}
.pvx-dateinput:focus{outline:none;border-color:#5f8020;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.pvx-btn{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #ecece8;border-radius:10px;padding:9px 15px;font-family:'Inter';font-size:13.5px;font-weight:500;color:#1e2420;cursor:pointer;}
.pvx-btn:hover:not(:disabled){border-color:#cfcfc9;background:#f6f6f2;}
.pvx-btn:disabled{opacity:.5;cursor:default;}
.pvx-btn svg{color:#5f8020;}
.pvx-btnnew{display:inline-flex;align-items:center;gap:8px;background:#6b8a2a;color:#fff;border:none;border-radius:11px;padding:10px 17px;font-family:'Inter';font-size:14px;font-weight:600;cursor:pointer;}
.pvx-btnnew:hover{background:#5f7d24;}
.pvx-search{position:relative;max-width:620px;margin-bottom:22px;}
.pvx-search>svg{position:absolute;left:15px;top:50%;transform:translateY(-50%);color:#8b8f88;pointer-events:none;}
.pvx-search input{width:100%;background:#fff;border:1px solid #ecece8;border-radius:12px;padding:13px 15px 13px 44px;font-family:'Inter';font-size:14px;color:#1e2420;}
.pvx-search input::placeholder{color:#a9ada4;}
.pvx-search input:focus{outline:none;border-color:#5f8020;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.pvx-card{background:#fff;border:1px solid #ecece8;border-radius:16px;padding:6px 4px 8px;overflow:hidden;}
.pvx-cardhead{font-family:'Bricolage Grotesque';font-size:15px;font-weight:700;letter-spacing:-.01em;padding:18px 22px 14px;}
.pvx-tblwrap{overflow-x:auto;}
table.pvx-tbl{width:100%;border-collapse:collapse;}
.pvx-tbl th{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#9a9e96;text-align:right;padding:0 22px 13px;border-bottom:1px solid #eeeeea;white-space:nowrap;}
.pvx-tbl th.l{text-align:left;}
.pvx-tbl td{padding:14px 22px;border-bottom:1px solid #f5f5f2;font-size:14px;text-align:right;white-space:nowrap;}
.pvx-tbl td.l{text-align:left;}
.pvx-tbl tbody tr:hover td{background:#f8f8f5;cursor:pointer;}
.pvx-prov{font-weight:600;color:#1e2420;}
.pvx-cuit{font-size:11px;color:#8b8f88;margin-top:2px;}
.pvx-deb{color:#b0553f;font-weight:600;}
.pvx-fac{color:#1e2420;}
.pvx-pay{color:#5f8020;font-weight:600;}
.pvx-dash{color:#c8ccc3;}
.pvx-sal{color:#b0553f;font-weight:700;}
.pvx-sal.pos{color:#5f8020;}
.pvx-pct{color:#7a7f77;font-weight:500;}
.pvx-tbl tfoot td{border-top:1.5px solid #eaeae6;border-bottom:none;font-weight:700;padding-top:15px;}
.pvx-tbl tfoot td.l{font-family:'Bricolage Grotesque';text-transform:uppercase;}
.pvx-actions{display:inline-flex;align-items:center;gap:2px;opacity:0;transition:opacity .15s;}
.pvx-tbl tbody tr:hover .pvx-actions{opacity:1;}
.pvx-iconbtn{background:none;border:none;color:#b3b6ae;cursor:pointer;padding:6px;border-radius:7px;display:inline-flex;}
.pvx-iconbtn:hover{color:#1e2420;background:#f2f2ef;}
.pvx-iconbtn.del:hover{color:#c05e42;background:#f8ede8;}
.pvx-err{font-size:13.5px;color:#b0553f;padding:12px 16px;background:#f8ede8;border:1px solid #e6cdc4;border-radius:12px;margin-bottom:16px;}
`;

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const fmtInt = (v: number) => Math.round(v).toLocaleString("es-AR");
// % con coma decimal (es-AR): 28,77%
const fmtPct = (v: number) => v.toFixed(2).replace(".", ",") + "%";

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

// Para proveedores, saldo positivo = lo que les debemos (a pagar). Solo cambia el color por signo.
function SaldoBadge({ saldo }: { saldo: number }) {
  if (saldo > 0) return <span className="pvx-sal pvx-num">${fmtInt(saldo)}</span>;
  if (saldo < 0) return <span className="pvx-sal pos pvx-num">${fmtInt(saldo)}</span>;
  return <span className="pvx-dash pvx-num">$0</span>;
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
  const fmt = fmtFecha;
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
      <div className="prov-rx">
        <style>{PVX_CSS}</style>
        <div className="pvx-wrap">
          {/* Encabezado */}
          <div className="pvx-top">
            <div>
              <h1 className="pvx-title">Proveedores</h1>
              <div className="pvx-subtitle">{periodLabel}</div>
            </div>
            <div className="pvx-controls">
              <div className="pvx-seg">
                {(["mes", "semana", "dia"] as FilterType[]).map((t) => (
                  <button key={t} className={filterType === t ? "on" : ""} onClick={() => setFilterType(t)}>
                    {t === "mes" ? "Mes" : t === "semana" ? "Semana" : "Día"}
                  </button>
                ))}
              </div>
              {filterType === "mes" && (
                <>
                  <div className="pvx-sel">
                    <select value={String(selectedMonth)} onChange={(e) => setSelectedMonth(Number(e.target.value))} data-testid="select-month">
                      {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                    </select>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </div>
                  <div className="pvx-sel">
                    <select value={String(selectedYear)} onChange={(e) => setSelectedYear(Number(e.target.value))} data-testid="select-year">
                      {years.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </div>
                </>
              )}
              {filterType === "dia" && (
                <input type="date" className="pvx-dateinput" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} data-testid="input-filter-date" />
              )}
              {filterType === "semana" && (
                <input type="week" className="pvx-dateinput" value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)} data-testid="input-filter-week" />
              )}
              <button className="pvx-btn" onClick={handleExport} disabled={exporting || isLoading || filterType !== "mes"} title={filterType !== "mes" ? "Exportar solo disponible para vista mensual" : ""} data-testid="button-export-ap-cc">
                <Download className="h-4 w-4" /> {exporting ? "..." : "Exportar XLSX"}
              </button>
              <button className="pvx-btnnew" onClick={openCreate} data-testid="button-add-supplier">
                <Plus className="h-[17px] w-[17px]" /> Nuevo Proveedor
              </button>
            </div>
          </div>

          {/* Buscador */}
          <div className="pvx-search">
            <Search className="h-[17px] w-[17px]" />
            <input placeholder="Buscar por nombre, CUIT o teléfono..." value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-suppliers" />
          </div>

          {error && <div className="pvx-err">Error al cargar: {String(error)}</div>}

          {/* Tabla */}
          <div className="pvx-card">
            <div className="pvx-cardhead">Por proveedor — {periodLabel}</div>
            <div className="pvx-tblwrap">
              <table className="pvx-tbl">
                <thead>
                  <tr>
                    <th className="l">Proveedor</th>
                    <th>Saldo anterior</th><th>Facturación</th><th>Pagos</th><th>Saldo actual</th><th>%</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 7 }).map((_, j) => (
                          <td key={j} className={j === 0 ? "l" : ""}><Skeleton className="h-4 w-full" /></td>
                        ))}
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: "center", padding: "40px 22px", color: "#8b8f88" }}>{search ? "Sin proveedores que coincidan" : "Sin movimientos en este período"}</td></tr>
                  ) : rows.map((row) => {
                    const s = supplierMap.get(row.supplierId);
                    return (
                      <tr key={row.supplierId} onClick={() => setLocation(`/suppliers/${row.supplierId}/cc`)} data-testid={`row-supplier-${row.supplierId}`}>
                        <td className="l">
                          <div className="pvx-prov">{row.supplierName}</div>
                          {s?.cuit && <div className="pvx-cuit">CUIT: {s.cuit}</div>}
                        </td>
                        <td>{row.saldoMesAnterior !== 0 ? <SaldoBadge saldo={row.saldoMesAnterior} /> : <span className="pvx-dash">—</span>}</td>
                        <td>{row.facturacion > 0 ? <span className="pvx-fac pvx-num">${fmtInt(row.facturacion)}</span> : <span className="pvx-dash">—</span>}</td>
                        <td>{row.cobranza > 0 ? <span className="pvx-pay pvx-num">${fmtInt(row.cobranza)}</span> : <span className="pvx-dash">—</span>}</td>
                        <td><SaldoBadge saldo={row.saldo} /></td>
                        <td>{row.pct > 0 ? <span className="pvx-pct pvx-num">{fmtPct(row.pct)}</span> : <span className="pvx-dash pvx-num">0,00%</span>}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {s && (
                            <span className="pvx-actions">
                              <button className="pvx-iconbtn" onClick={() => openEdit(s)} data-testid={`button-edit-supplier-${s.id}`} title="Editar"><Pencil className="h-3.5 w-3.5" /></button>
                              <button className="pvx-iconbtn del" onClick={() => setDeleteId(s.id)} data-testid={`button-delete-supplier-${s.id}`} title="Eliminar"><Trash2 className="h-3.5 w-3.5" /></button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {data && rows.length > 0 && !search && (
                  <tfoot>
                    <tr>
                      <td className="l">Total</td>
                      <td><SaldoBadge saldo={data.totals.saldoMesAnterior} /></td>
                      <td><span className="pvx-fac pvx-num">${fmtInt(data.totals.facturacion)}</span></td>
                      <td>{data.totals.cobranza > 0 ? <span className="pvx-pay pvx-num">${fmtInt(data.totals.cobranza)}</span> : <span className="pvx-dash">—</span>}</td>
                      <td><SaldoBadge saldo={data.totals.saldo} /></td>
                      <td><span className="pvx-dash">—</span></td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
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
