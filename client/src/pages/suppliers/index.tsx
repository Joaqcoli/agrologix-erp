import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Pencil, Trash2, Building2, Phone, Mail, Wallet } from "lucide-react";
import type { Supplier } from "@shared/schema";

const EMPTY: Partial<Supplier> = { name: "", cuit: "", email: "", phone: "", address: "", notes: "" };

type SupplierWithBalance = Supplier & { saldo?: number };

export default function SuppliersPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<Partial<Supplier>>(EMPTY);

  const today = new Date();
  const month = today.getMonth() + 1;
  const year = today.getFullYear();

  const { data: suppliers, isLoading } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });

  const { data: ccSummary } = useQuery<{
    suppliers: { supplierId: number; supplierName: string; saldo: number }[];
  }>({
    queryKey: ["/api/ap/cc/summary", month, year],
    queryFn: async () => {
      const res = await fetch(`/api/ap/cc/summary?month=${month}&year=${year}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 60_000,
  });

  const saldoMap = new Map<number, number>();
  const supplierRows = Array.isArray(ccSummary?.suppliers) ? ccSummary.suppliers : [];
  supplierRows.forEach((row) => saldoMap.set(row.supplierId, row.saldo));

  const createMutation = useMutation({
    mutationFn: (data: Partial<Supplier>) => apiRequest("POST", "/api/suppliers", data),
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

  const filtered = (Array.isArray(suppliers) ? suppliers : []).filter((s) =>
    s.active && (
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.cuit ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (s.phone ?? "").includes(search)
    )
  );

  const isPending = createMutation.isPending || updateMutation.isPending;
  const fmtInt = (v: number) => Math.round(v).toLocaleString("es-AR");

  return (
    <Layout title="Proveedores">
      <div className="p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Proveedores</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {filtered.length} proveedor{filtered.length !== 1 ? "es" : ""} registrado{filtered.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button onClick={openCreate} data-testid="button-add-supplier">
            <Plus className="mr-2 h-4 w-4" /> Nuevo Proveedor
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, CUIT o teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-suppliers"
          />
        </div>

        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-36 w-full rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Building2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Sin proveedores</p>
              <p className="text-sm text-muted-foreground text-center">Agrega tu primer proveedor para comenzar.</p>
              <Button size="sm" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Agregar Proveedor
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((s) => {
              const saldo = saldoMap.get(s.id) ?? 0;
              return (
                <Card key={s.id} className="hover-elevate" data-testid={`card-supplier-${s.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 shrink-0">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate" title={s.name}>{s.name}</p>
                          {s.cuit && <p className="text-xs text-muted-foreground mt-0.5">CUIT: {s.cuit}</p>}
                          {saldo !== 0 && (
                            <div className="mt-1.5">
                              <Badge
                                variant="outline"
                                className={`text-[10px] cursor-pointer ${saldo > 0 ? "text-destructive border-destructive/30" : "text-green-600 border-green-200"}`}
                                onClick={() => setLocation(`/suppliers/${s.id}/cc`)}
                              >
                                <Wallet className="h-2.5 w-2.5 mr-1" />
                                CC: ${fmtInt(Math.abs(saldo))} {saldo > 0 ? "a pagar" : "a favor"}
                              </Badge>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => setLocation(`/suppliers/${s.id}/cc`)}
                          title="Ver cuenta corriente"
                          data-testid={`button-cc-supplier-${s.id}`}
                        >
                          <Wallet className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(s)} data-testid={`button-edit-supplier-${s.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(s.id)} data-testid={`button-delete-supplier-${s.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1">
                      {s.phone && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3 shrink-0" /> <span className="truncate">{s.phone}</span>
                        </div>
                      )}
                      {s.email && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{s.email}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
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
                <Input
                  id="name"
                  value={form.name ?? ""}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  data-testid="input-supplier-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cuit">CUIT</Label>
                <Input
                  id="cuit"
                  value={form.cuit ?? ""}
                  onChange={(e) => setForm({ ...form, cuit: e.target.value })}
                  data-testid="input-supplier-cuit"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Teléfono</Label>
                <Input
                  id="phone"
                  value={form.phone ?? ""}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  data-testid="input-supplier-phone"
                />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="email">Correo</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email ?? ""}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  data-testid="input-supplier-email"
                />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="address">Dirección</Label>
                <Input
                  id="address"
                  value={form.address ?? ""}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  data-testid="input-supplier-address"
                />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="notes">Notas</Label>
                <Textarea
                  id="notes"
                  value={form.notes ?? ""}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  data-testid="input-supplier-notes"
                />
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
