import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Pencil, Trash2, Users, Building2, Phone, Mail } from "lucide-react";
import type { Customer } from "@shared/schema";

const EMPTY: Partial<Customer> = { name: "", rfc: "", email: "", phone: "", address: "", city: "", notes: "", hasIva: false, ccType: "por_saldo", bolsaFv: false, salespersonName: "", commissionPct: "0", parentCustomerId: null };

export default function CustomersPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<Partial<Customer>>(EMPTY);

  const { data: customers, isLoading } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Customer>) => apiRequest("POST", "/api/customers", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/customers"] }); toast({ title: "Cliente creado" }); setDialogOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Customer> }) => apiRequest("PATCH", `/api/customers/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/customers"] }); toast({ title: "Cliente actualizado" }); setDialogOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/customers/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/customers"] }); toast({ title: "Cliente eliminado" }); setDeleteId(null); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openCreate = () => { setEditing(null); setForm(EMPTY); setDialogOpen(true); };
  const openEdit = (c: Customer) => { setEditing(c); setForm(c); setDialogOpen(true); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) updateMutation.mutate({ id: editing.id, data: form });
    else createMutation.mutate(form);
  };

  const filtered = (customers ?? []).filter((c) =>
    c.active && (
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.city ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.rfc ?? "").toLowerCase().includes(search.toLowerCase())
    )
  );

  // Group: parents/independents first, then their children immediately after
  const grouped: Customer[] = [];
  const parentRows = filtered.filter((c) => !c.parentCustomerId);
  const childRows = filtered.filter((c) => !!c.parentCustomerId);
  for (const parent of parentRows) {
    grouped.push(parent);
    grouped.push(...childRows.filter((c) => c.parentCustomerId === parent.id));
  }
  // Orphan children (parent filtered out by search)
  grouped.push(...childRows.filter((c) => !parentRows.find((p) => p.id === c.parentCustomerId)));

  const allCustomers = customers ?? [];
  const hasChildren = (id: number) => allCustomers.some((ch) => ch.active && ch.parentCustomerId === id);
  const getParentName = (parentId: number | null | undefined) => allCustomers.find((c) => c.id === parentId)?.name ?? "";

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Layout title="Clientes">
      <div className="p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Clientes</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{filtered.length} cliente{filtered.length !== 1 ? "s" : ""} registrado{filtered.length !== 1 ? "s" : ""}</p>
          </div>
          <Button onClick={openCreate} data-testid="button-add-customer">
            <Plus className="mr-2 h-4 w-4" /> Nuevo Cliente
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, RFC o ciudad..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-customers"
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
                <Users className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Sin clientes</p>
              <p className="text-sm text-muted-foreground text-center">Agrega tu primer cliente para comenzar.</p>
              <Button size="sm" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Agregar Cliente
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {grouped.map((c) => {
              const isChild = !!c.parentCustomerId;
              const isGroup = hasChildren(c.id);
              return (
                <Card
                  key={c.id}
                  className={`hover-elevate${isChild ? " ml-4 border-l-4 border-l-muted-foreground/20" : ""}`}
                  data-testid={`card-customer-${c.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 shrink-0">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate" title={c.name}>{c.name}</p>
                          {isChild && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">Sede de {getParentName(c.parentCustomerId)}</p>
                          )}
                          {c.rfc && !isChild && <p className="text-xs text-muted-foreground mt-0.5">{c.rfc}</p>}
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {isGroup && <Badge variant="secondary" className="text-[10px]">Grupo</Badge>}
                            {isChild && <Badge variant="outline" className="text-[10px] text-muted-foreground">Sede</Badge>}
                            {c.city && <Badge variant="secondary" className="text-[10px]">{c.city}</Badge>}
                            <Badge variant={c.hasIva ? "default" : "outline"} className="text-[10px]">
                              {c.hasIva ? "Con IVA" : "Sin IVA"}
                            </Badge>
                            {c.bolsaFv && (
                              <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">Bolsa FV</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(c)} data-testid={`button-edit-customer-${c.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(c.id)} data-testid={`button-delete-customer-${c.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1">
                      {c.phone && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3 shrink-0" /> <span className="truncate">{c.phone}</span>
                        </div>
                      )}
                      {c.email && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{c.email}</span>
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
            <DialogTitle>{editing ? "Editar Cliente" : "Nuevo Cliente"}</DialogTitle>
            <DialogDescription>
              {editing ? "Modifica los datos del cliente." : "Completa la información del nuevo cliente."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="name">Nombre / Razón Social *</Label>
                <Input id="name" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-customer-name" />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label>Cliente padre (opcional)</Label>
                <Select
                  value={form.parentCustomerId ? String(form.parentCustomerId) : "none"}
                  onValueChange={(v) => setForm({ ...form, parentCustomerId: v === "none" ? null : Number(v) })}
                >
                  <SelectTrigger data-testid="select-parent-customer">
                    <SelectValue placeholder="— Ninguno (cliente independiente) —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Ninguno (cliente independiente) —</SelectItem>
                    {allCustomers
                      .filter((p) => p.active && !p.parentCustomerId && p.id !== editing?.id)
                      .map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                      ))
                    }
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rfc">RFC</Label>
                <Input id="rfc" value={form.rfc ?? ""} onChange={(e) => setForm({ ...form, rfc: e.target.value })} data-testid="input-customer-rfc" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Teléfono</Label>
                <Input id="phone" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-customer-phone" />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="email">Correo</Label>
                <Input id="email" type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-customer-email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="city">Ciudad</Label>
                <Input id="city" value={form.city ?? ""} onChange={(e) => setForm({ ...form, city: e.target.value })} data-testid="input-customer-city" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="address">Dirección</Label>
                <Input id="address" value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="input-customer-address" />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="notes">Notas</Label>
                <Textarea id="notes" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} data-testid="input-customer-notes" />
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Factura con IVA</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Aplica IVA en pedidos y exportaciones (10.5% general, 21% para huevo)</p>
                  </div>
                  <Switch
                    checked={!!form.hasIva}
                    onCheckedChange={(v) => setForm({ ...form, hasIva: v })}
                    data-testid="switch-has-iva"
                  />
                </div>
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Bolsa FV</p>
                    <p className="text-xs text-muted-foreground mt-0.5">El cliente recibe productos con bolsa de feria verde</p>
                  </div>
                  <Switch
                    checked={!!form.bolsaFv}
                    onCheckedChange={(v) => setForm({ ...form, bolsaFv: v })}
                    data-testid="switch-bolsa-fv"
                  />
                </div>
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Tiene vendedor asignado</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Genera comisión sobre ventas de este cliente</p>
                  </div>
                  <Switch
                    checked={!!form.salespersonName}
                    onCheckedChange={(v) => setForm({ ...form, salespersonName: v ? " " : "", commissionPct: v ? (form.commissionPct ?? "0") : "0" })}
                  />
                </div>
              </div>
              {!!form.salespersonName && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="salesperson">Nombre del vendedor</Label>
                    <Input
                      id="salesperson"
                      value={form.salespersonName?.trim() ?? ""}
                      onChange={(e) => setForm({ ...form, salespersonName: e.target.value })}
                      placeholder="Ej: Juan"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="commission">% Comisión</Label>
                    <Input
                      id="commission"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={form.commissionPct ?? "0"}
                      onChange={(e) => setForm({ ...form, commissionPct: e.target.value as any })}
                      placeholder="Ej: 5"
                    />
                  </div>
                </>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-customer">
                {isPending ? "Guardando..." : editing ? "Guardar cambios" : "Crear cliente"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción desactivará al cliente. No se eliminarán sus datos.</AlertDialogDescription>
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
