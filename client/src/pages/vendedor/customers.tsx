import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { VendedorLayout } from "./layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Pencil, Phone, Mail, MapPin, Users } from "lucide-react";

type Customer = {
  id: number;
  name: string;
  rfc: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  hasIva: boolean;
  bolsaFv: boolean | null;
  commissionPct: string | null;
  salespersonName: string | null;
  active: boolean;
};

const EMPTY: Partial<Customer> = {
  name: "", rfc: "", email: "", phone: "", address: "", city: "",
  notes: "", hasIva: false, bolsaFv: false, commissionPct: "0",
};

export default function VendedorCustomers() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<Partial<Customer>>(EMPTY);

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["/api/vendedor/customers"],
    queryFn: () => fetch("/api/vendedor/customers").then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Customer>) =>
      fetch("/api/vendedor/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => {
        if (!r.ok) return r.json().then((e: any) => Promise.reject(new Error(e.error)));
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendedor/customers"] });
      toast({ title: "Cliente creado" });
      setDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Customer> }) =>
      fetch(`/api/vendedor/customers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => {
        if (!r.ok) return r.json().then((e: any) => Promise.reject(new Error(e.error)));
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendedor/customers"] });
      toast({ title: "Cliente actualizado" });
      setDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openCreate = () => { setEditing(null); setForm(EMPTY); setDialogOpen(true); };
  const openEdit = (c: Customer) => { setEditing(c); setForm(c); setDialogOpen(true); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) updateMutation.mutate({ id: editing.id, data: form });
    else createMutation.mutate(form);
  };

  const filtered = customers.filter(
    (c) => !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.city ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <VendedorLayout title="Mis Clientes">
      <div className="p-6 space-y-5">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Mis Clientes</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {customers.length} cliente{customers.length !== 1 ? "s" : ""} asignado{customers.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1.5" />
            Nuevo Cliente
          </Button>
        </div>

        {/* Search */}
        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o ciudad..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-14 gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Users className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">
                {search ? "Sin resultados" : "No tenés clientes asignados"}
              </p>
              {!search && (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-1.5" /> Crear primer cliente
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((c) => {
              const initials = c.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
              const commPct = parseFloat(c.commissionPct ?? "0");
              return (
                <Card key={c.id} className="hover-elevate">
                  <CardContent className="p-4 flex items-center gap-4">
                    {/* Avatar */}
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 shrink-0">
                      <span className="text-sm font-semibold text-primary">{initials}</span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        <p className="font-semibold text-sm text-foreground truncate">{c.name}</p>
                        {c.hasIva && (
                          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">IVA</Badge>
                        )}
                        {commPct > 0 && (
                          <Badge variant="secondary" className="text-[10px]">{commPct}% comisión</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {c.city && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />{c.city}
                          </span>
                        )}
                        {c.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />{c.phone}
                          </span>
                        )}
                        {c.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />{c.email}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Edit button */}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={() => openEdit(c)}
                      title="Editar cliente"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3 mt-1">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input
                required
                placeholder="Nombre del cliente"
                value={form.name ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Teléfono</Label>
                <Input
                  placeholder="(011) 1234-5678"
                  value={form.phone ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="ejemplo@mail.com"
                  value={form.email ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ciudad</Label>
                <Input
                  placeholder="Buenos Aires"
                  value={form.city ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Dirección</Label>
                <Input
                  placeholder="Av. Corrientes 1234"
                  value={form.address ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Textarea
                rows={2}
                placeholder="Observaciones..."
                value={form.notes ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">¿Tiene IVA?</p>
                <p className="text-xs text-muted-foreground">Los totales se calculan con IVA</p>
              </div>
              <Switch
                checked={form.hasIva ?? false}
                onCheckedChange={(v) => setForm((f) => ({ ...f, hasIva: v }))}
              />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Guardando..." : editing ? "Guardar cambios" : "Crear cliente"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </VendedorLayout>
  );
}
