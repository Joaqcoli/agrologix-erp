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
import { Plus, Search, Pencil, Trash2, Users, Building2, Phone, Mail, MapPin } from "lucide-react";
import type { Customer } from "@shared/schema";

const EMPTY: Partial<Customer> = { name: "", rfc: "", cuit: "", email: "", phone: "", address: "", city: "", notes: "", hasIva: false, ccType: "por_saldo", bolsaFv: false, blackPot: false, salespersonName: "", commissionPct: "0", parentCustomerId: null };

// ── Rediseño Clientes (Claude Design) — CSS de diseno-caja/clientes-rediseno.html ──
const CLX_CSS = `
.clientes-rx{background:#f4f4f1;min-height:100%;padding:30px 24px 56px;font-family:'Inter',system-ui,sans-serif;color:#1e2420;}
.clientes-rx *{box-sizing:border-box;}
.clx-wrap{max-width:1360px;margin:0 auto;}
.clx-top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:18px;}
.clx-title{font-family:'Bricolage Grotesque';font-size:27px;font-weight:700;margin:0;letter-spacing:-.02em;}
.clx-subtitle{font-size:13.5px;color:#8b8f88;margin-top:5px;}
.clx-btnnew{display:inline-flex;align-items:center;gap:8px;background:#6b8a2a;color:#fff;border:none;border-radius:11px;padding:11px 18px;font-family:'Inter';font-size:14px;font-weight:600;cursor:pointer;}
.clx-btnnew:hover{background:#5f7d24;}
.clx-search{position:relative;margin-bottom:22px;}
.clx-search>svg{position:absolute;left:16px;top:50%;transform:translateY(-50%);color:#8b8f88;pointer-events:none;}
.clx-search input{width:100%;background:#fff;border:1px solid #ecece8;border-radius:12px;padding:13px 16px 13px 46px;font-family:'Inter';font-size:14px;color:#1e2420;}
.clx-search input::placeholder{color:#a9ada4;}
.clx-search input:focus{outline:none;border-color:#5f8020;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.clx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(370px,1fr));gap:12px;}
.clx-ccard{display:flex;align-items:flex-start;gap:13px;background:#fff;border:1px solid #ecece8;border-radius:14px;padding:14px 15px;transition:border-color .15s,box-shadow .15s;}
.clx-ccard:hover{border-color:#dcdcd6;box-shadow:0 2px 10px rgba(30,36,32,.05);}
.clx-cube{width:38px;height:38px;border-radius:10px;background:#eef3e3;color:#5f8020;display:flex;align-items:center;justify-content:center;flex:0 0 auto;margin-top:1px;}
.clx-cinfo{flex:1;min-width:0;}
.clx-cname{font-weight:600;font-size:14.5px;letter-spacing:-.01em;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.clx-csub{font-size:12px;color:#8b8f88;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.clx-cbadges{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;}
.clx-b{font-size:10.5px;font-weight:600;padding:2px 9px;border-radius:20px;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;}
.clx-b-si{background:#e9eff7;color:#3a67a3;}
.clx-b-no{background:transparent;color:#9a9e96;border:1px solid #e2e2dd;}
.clx-b-grupo{background:#eef3e3;color:#5f8020;}
.clx-b-sede{background:#f1f2ee;color:#6f7469;}
.clx-b-grp{background:#f8ede8;color:#b0553f;}
.clx-b-loc{background:#f1f2ee;color:#6f7469;}
.clx-b-bolsa{background:#eef3e3;color:#5f8020;}
.clx-ctel{display:flex;align-items:center;gap:7px;font-size:12.5px;color:#8b8f88;margin-top:10px;font-variant-numeric:tabular-nums;}
.clx-ctel.mail{margin-top:5px;}
.clx-ctel>svg{flex:0 0 auto;}
.clx-ctel>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.clx-cacts{display:flex;gap:2px;flex:0 0 auto;}
.clx-ic{width:30px;height:30px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#8b8f88;}
.clx-ic:hover{background:#f1f1ee;color:#1e2420;}
.clx-ic.del:hover{background:#f8ede8;color:#b0553f;}
.clx-empty{background:#fff;border:1px solid #ecece8;border-radius:16px;padding:48px 20px;text-align:center;color:#8b8f88;display:flex;flex-direction:column;align-items:center;gap:10px;}
.clx-empty .big{font-size:15px;font-weight:600;color:#1e2420;}
.clx-emptyic{width:48px;height:48px;border-radius:50%;background:#f1f1ec;display:flex;align-items:center;justify-content:center;color:#8b8f88;}
`;

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
      <div className="clientes-rx">
        <style>{CLX_CSS}</style>
        <div className="clx-wrap">
          {/* Encabezado */}
          <div className="clx-top">
            <div>
              <h1 className="clx-title">Clientes</h1>
              <div className="clx-subtitle">{filtered.length} cliente{filtered.length !== 1 ? "s" : ""} registrado{filtered.length !== 1 ? "s" : ""}</div>
            </div>
            <button className="clx-btnnew" onClick={openCreate} data-testid="button-add-customer">
              <Plus className="h-[17px] w-[17px]" /> Nuevo Cliente
            </button>
          </div>

          {/* Buscador */}
          <div className="clx-search">
            <Search className="h-[18px] w-[18px]" />
            <input placeholder="Buscar por nombre, RFC o ciudad..." value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-customers" />
          </div>

          {isLoading ? (
            <div className="clx-grid">
              {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="clx-empty">
              <div className="clx-emptyic"><Users className="h-6 w-6" /></div>
              <div className="big">Sin clientes</div>
              <div>Agrega tu primer cliente para comenzar.</div>
              <button className="clx-btnnew" style={{ marginTop: 6 }} onClick={openCreate}><Plus className="h-[17px] w-[17px]" /> Agregar Cliente</button>
            </div>
          ) : (
            <div className="clx-grid">
              {grouped.map((c) => {
                const isChild = !!c.parentCustomerId;
                const isGroup = hasChildren(c.id);
                return (
                  <div key={c.id} className="clx-ccard" data-testid={`card-customer-${c.id}`}>
                    <div className="clx-cube"><Building2 className="h-[19px] w-[19px]" /></div>
                    <div className="clx-cinfo">
                      <div className="clx-cname" title={c.name}>{c.name}</div>
                      {isChild ? (
                        <div className="clx-csub">Sede de {getParentName(c.parentCustomerId)}</div>
                      ) : c.rfc ? (
                        <div className="clx-csub">{c.rfc}</div>
                      ) : null}
                      <div className="clx-cbadges">
                        {isGroup && <span className="clx-b clx-b-grupo">Grupo</span>}
                        {isChild && <span className="clx-b clx-b-sede">Sede</span>}
                        <span className={`clx-b ${c.hasIva ? "clx-b-si" : "clx-b-no"}`}>{c.hasIva ? "Con IVA" : "Sin IVA"}</span>
                        {c.blackPot && <span className="clx-b clx-b-grp">Black Pot</span>}
                        {c.bolsaFv && <span className="clx-b clx-b-bolsa">Bolsa FV</span>}
                        {c.city && <span className="clx-b clx-b-loc"><MapPin className="h-[11px] w-[11px]" />{c.city}</span>}
                      </div>
                      {c.phone && <div className="clx-ctel"><Phone className="h-[13px] w-[13px]" /><span>{c.phone}</span></div>}
                      {c.email && <div className="clx-ctel mail"><Mail className="h-[13px] w-[13px]" /><span>{c.email}</span></div>}
                    </div>
                    <div className="clx-cacts">
                      <button className="clx-ic" onClick={() => openEdit(c)} data-testid={`button-edit-customer-${c.id}`} title="Editar"><Pencil className="h-4 w-4" /></button>
                      <button className="clx-ic del" onClick={() => setDeleteId(c.id)} data-testid={`button-delete-customer-${c.id}`} title="Eliminar"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
                <Label htmlFor="cuit">CUIT (para Factura A)</Label>
                <Input id="cuit" value={(form as any).cuit ?? ""} onChange={(e) => setForm({ ...form, cuit: e.target.value } as any)} placeholder="30-12345678-9" data-testid="input-customer-cuit" />
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
                    <p className="text-sm font-medium text-foreground">Black Pot</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Habilita exportación Excel multi-hoja por colegio</p>
                  </div>
                  <Switch
                    checked={!!form.blackPot}
                    onCheckedChange={(v) => setForm({ ...form, blackPot: v })}
                    data-testid="switch-black-pot"
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
