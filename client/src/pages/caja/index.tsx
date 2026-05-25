import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, DollarSign, Plus, Trash2 } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";

const fmt = (v: number) =>
  "$" + Math.round(v).toLocaleString("es-AR");

function getRange(period: "day" | "week" | "month"): { from: string; to: string } {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (period === "day") {
    const s = iso(today);
    return { from: s, to: s };
  }
  if (period === "week") {
    const day = today.getDay(); // 0=Sun
    const diffToMon = (day === 0 ? -6 : 1 - day);
    const mon = new Date(today);
    mon.setDate(today.getDate() + diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { from: iso(mon), to: iso(sun) };
  }
  // month
  const from = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const to = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(lastDay)}`;
  return { from, to };
}

function fmtDate(d: string) {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}`;
}

type CajaSummary = {
  totalIngresos: number;
  totalEgresos: number;
  saldo: number;
  payments: { id: number; date: string; amount: string; method: string; notes: string | null; customerName: string }[];
  supplierPayments: { id: number; date: string; amount: string; method: string; notes: string | null; supplierName: string }[];
  manualMovements: { id: number; date: string; type: string; description: string; amount: string; category: string | null }[];
};

type MovForm = { date: string; type: "ingreso" | "egreso"; description: string; amount: string; category: string };

const emptyForm = (): MovForm => ({
  date: new Date().toISOString().slice(0, 10),
  type: "ingreso",
  description: "",
  amount: "",
  category: "",
});

export default function CajaPage() {
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<MovForm>(emptyForm());

  const { from, to } = getRange(period);

  const { data, isLoading } = useQuery<CajaSummary>({
    queryKey: ["/api/caja/summary", from, to],
    queryFn: () =>
      fetch(`/api/caja/summary?from=${from}&to=${to}`, { credentials: "include" }).then(r => r.json()),
  });

  const addMutation = useMutation({
    mutationFn: (body: MovForm) => apiRequest("POST", "/api/caja/movements", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/caja/summary"] });
      setDialogOpen(false);
      setForm(emptyForm());
    },
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/caja/movements/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/caja/summary"] }),
  });

  const handleAdd = () => {
    if (!form.description || !form.amount || !form.date) return;
    addMutation.mutate(form);
  };

  return (
    <Layout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Caja</h1>
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            {(["day", "week", "month"] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  period === p ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p === "day" ? "Hoy" : p === "week" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-600" /> Ingresos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-700">{isLoading ? "..." : fmt(data?.totalIngresos ?? 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-600" /> Egresos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-700">{isLoading ? "..." : fmt(data?.totalEgresos ?? 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-blue-600" /> Saldo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${(data?.saldo ?? 0) >= 0 ? "text-blue-700" : "text-red-700"}`}>
                {isLoading ? "..." : fmt(data?.saldo ?? 0)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Cobros de clientes */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold text-base">Cobros de clientes</h2>
            <Badge variant="secondary">{data?.payments?.length ?? 0}</Badge>
          </div>
          {(data?.payments?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Sin cobros en este período.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Fecha</th>
                    <th className="text-left px-3 py-2 font-medium">Cliente</th>
                    <th className="text-left px-3 py-2 font-medium">Método</th>
                    <th className="text-right px-3 py-2 font-medium">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.payments ?? []).map(p => (
                    <tr key={p.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(p.date)}</td>
                      <td className="px-3 py-2">{p.customerName}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-xs">{p.method}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-green-700">{fmt(parseFloat(p.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Pagos a proveedores */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold text-base">Pagos a proveedores</h2>
            <Badge variant="secondary">{data?.supplierPayments?.length ?? 0}</Badge>
          </div>
          {(data?.supplierPayments?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Sin pagos en este período.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Fecha</th>
                    <th className="text-left px-3 py-2 font-medium">Proveedor</th>
                    <th className="text-left px-3 py-2 font-medium">Método</th>
                    <th className="text-right px-3 py-2 font-medium">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.supplierPayments ?? []).map(p => (
                    <tr key={p.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(p.date)}</td>
                      <td className="px-3 py-2">{p.supplierName}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-xs">{p.method}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-red-700">{fmt(parseFloat(p.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Movimientos manuales */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold text-base">Movimientos manuales</h2>
            <Badge variant="secondary">{data?.manualMovements?.length ?? 0}</Badge>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Agregar
            </Button>
          </div>
          {(data?.manualMovements?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos manuales en este período.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Fecha</th>
                    <th className="text-left px-3 py-2 font-medium">Descripción</th>
                    <th className="text-left px-3 py-2 font-medium">Categoría</th>
                    <th className="text-right px-3 py-2 font-medium">Monto</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {(data?.manualMovements ?? []).map(m => (
                    <tr key={m.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(m.date)}</td>
                      <td className="px-3 py-2">{m.description}</td>
                      <td className="px-3 py-2 text-muted-foreground">{m.category ?? "—"}</td>
                      <td className={`px-3 py-2 text-right font-medium ${m.type === "ingreso" ? "text-green-700" : "text-red-700"}`}>
                        {m.type === "egreso" ? "-" : ""}{fmt(parseFloat(m.amount))}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => delMutation.mutate(m.id)}
                          disabled={delMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Dialog agregar movimiento */}
      <Dialog open={dialogOpen} onOpenChange={v => { setDialogOpen(v); if (!v) setForm(emptyForm()); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar movimiento manual</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as "ingreso" | "egreso" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ingreso">Ingreso</SelectItem>
                    <SelectItem value="egreso">Egreso</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Fecha</Label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Descripción</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Ej: Compra de materiales" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Monto ($)</Label>
                <Input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
              </div>
              <div className="space-y-1">
                <Label>Categoría</Label>
                <Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="Opcional" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleAdd} disabled={addMutation.isPending || !form.description || !form.amount}>
              {addMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
