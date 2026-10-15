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
import { Plus, Search, Pencil, Trash2, Users, Building2, Phone, Mail, MapPin, MessageCircle, X, Check } from "lucide-react";
import type { Customer, CustomerContact } from "@shared/schema";
import { formatArPhone } from "@shared/phone";

// ── A-01: Teléfonos de PEDIDO (customer_contacts). Distintos del teléfono de administración. ──
function CustomerContactsSection({ customerId }: { customerId: number }) {
  const { toast } = useToast();
  const { data: contacts = [] } = useQuery<CustomerContact[]>({ queryKey: ["/api/customers", customerId, "contacts"], queryFn: async () => {
    const r = await fetch(`/api/customers/${customerId}/contacts`, { credentials: "include" });
    if (!r.ok) throw new Error("No se pudieron cargar los teléfonos");
    return r.json();
  } });
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPhone, setEditPhone] = useState("");
  const [editName, setEditName] = useState("");
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "contacts"] });
  const add = useMutation({
    mutationFn: () => apiRequest("POST", `/api/customers/${customerId}/contacts`, { phone, name: name.trim() || null }),
    onSuccess: () => { invalidate(); setPhone(""); setName(""); toast({ title: "Teléfono de pedido agregado" }); },
    onError: (e: any) => toast({ title: "No se pudo agregar", description: e.message, variant: "destructive" }),
  });
  const update = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/customer-contacts/${id}`, { phone: editPhone, name: editName.trim() || null }),
    onSuccess: () => { invalidate(); setEditingId(null); },
    onError: (e: any) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/customer-contacts/${id}`),
    onSuccess: () => invalidate(),
  });
  // A-13: a qué teléfono se manda el remito / la factura
  const flags = useMutation({
    mutationFn: ({ id, ...data }: { id: number; sendRemito?: boolean; sendFactura?: boolean }) => apiRequest("PATCH", `/api/customer-contacts/${id}`, data),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="sm:col-span-2 space-y-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-green-700" />
        <Label className="font-semibold">Teléfonos de pedido (WhatsApp)</Label>
      </div>
      <p className="text-[11px] text-muted-foreground">Quién manda los pedidos por WhatsApp. Puede haber varios (ej. "Juan - cocina"). El teléfono de arriba es el de administración y no se usa para identificar pedidos. Los checks Remito / Factura marcan a quién se le manda cada cosa: sin check no se envía.</p>
      {contacts.length === 0 && <p className="text-xs text-muted-foreground">Sin teléfonos de pedido cargados.</p>}
      {contacts.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
          {editingId === c.id ? (
            <>
              <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="h-7 w-40 text-xs font-mono" />
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-7 w-44 text-xs" placeholder="Nombre / rol" />
              <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => update.mutate(c.id)}><Check className="h-3 w-3" /></Button>
              <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setEditingId(null)}><X className="h-3 w-3" /></Button>
            </>
          ) : (
            <>
              <span className="font-mono text-xs">{formatArPhone(c.phone)}</span>
              {c.name && <span className="text-xs text-muted-foreground">{c.name}</span>}
              {c.origin === "whatsapp" && <Badge variant="outline" className="text-[10px]">asignado desde WhatsApp</Badge>}
              <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer" title="Le llega el remito por WhatsApp al aprobar el pedido">
                <input type="checkbox" checked={!!(c as any).sendRemito} onChange={(e) => flags.mutate({ id: c.id, sendRemito: e.target.checked })} data-testid={`check-remito-${c.id}`} /> Remito
              </label>
              <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer" title="Le llega la factura por WhatsApp">
                <input type="checkbox" checked={!!(c as any).sendFactura} onChange={(e) => flags.mutate({ id: c.id, sendFactura: e.target.checked })} data-testid={`check-factura-${c.id}`} /> Factura
              </label>
              <button type="button" className="text-[11px] underline text-muted-foreground" onClick={() => { setEditingId(c.id); setEditPhone(c.phone); setEditName(c.name ?? ""); }}>editar</button>
              <button type="button" className="text-[11px] underline text-destructive" onClick={() => remove.mutate(c.id)}>borrar</button>
            </>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11 2345 6789" className="h-7 w-40 text-xs font-mono" data-testid="input-contact-phone" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre / rol (ej. Juan - cocina)" className="h-7 w-52 text-xs" data-testid="input-contact-name" />
        <Button type="button" size="sm" variant="outline" className="h-7" disabled={!phone.trim() || add.isPending} onClick={() => add.mutate()} data-testid="button-add-contact">
          <Plus className="h-3 w-3 mr-1" /> Agregar
        </Button>
      </div>
    </div>
  );
}

const EMPTY: Partial<Customer> = { name: "", rfc: "", cuit: "", email: "", phone: "", address: "", city: "", notes: "", hasIva: false, ivaSince: null, ccType: "por_saldo", bolsaFv: false, blackPot: false, salespersonName: "", commissionPct: "0", parentCustomerId: null };

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
                        {(c as any).botActivo && <span className="clx-b clx-b-si"><MessageCircle className="h-[11px] w-[11px]" />Bot activo</span>}
                        {(c as any).billingMode && (c as any).billingMode !== "ninguna" && <span className="clx-b clx-b-grupo">Factura {({ diaria: "diaria", semanal: "semanal", mensual: "mensual", diaria_envio_semanal: "diaria · envío semanal" } as Record<string, string>)[(c as any).billingMode] ?? (c as any).billingMode}</span>}
                        {(c as any).pricesIncludeIva && <span className="clx-b clx-b-bolsa">Precios con IVA incl.</span>}
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
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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
                <Label htmlFor="phone">Teléfono (administración)</Label>
                <Input id="phone" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-customer-phone" />
              </div>
              {editing && <CustomerContactsSection customerId={editing.id} />}
              {/* A-13: envíos al teléfono de administración */}
              <div className="sm:col-span-2 flex flex-wrap items-center gap-4 rounded-md border p-3">
                <div className="flex-1 min-w-[200px]">
                  <Label className="font-semibold">Envíos al teléfono de administración</Label>
                  <p className="text-[11px] text-muted-foreground">Qué le llega por WhatsApp al número de arriba. Sin check no se envía.</p>
                </div>
                <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={!!(form as any).adminPhoneRemito} onChange={(e) => setForm({ ...form, adminPhoneRemito: e.target.checked } as any)} data-testid="check-admin-remito" /> Remito</label>
                <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={!!(form as any).adminPhoneFactura} onChange={(e) => setForm({ ...form, adminPhoneFactura: e.target.checked } as any)} data-testid="check-admin-factura" /> Factura</label>
              </div>
              {/* A-13: facturación */}
              <div className="sm:col-span-2 space-y-3 rounded-md border p-3">
                <div>
                  <Label className="font-semibold">Facturación automática</Label>
                  <p className="text-[11px] text-muted-foreground">Cómo y a quién se factura este cliente cuando la facturación automática está prendida (Bot por cliente). La primera factura automática de cada cliente la aprobás vos en "Facturas a emitir".</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Modo de facturación</Label>
                    <Select value={(form as any).billingMode ?? "ninguna"} onValueChange={(v) => setForm({ ...form, billingMode: v } as any)}>
                      <SelectTrigger data-testid="select-billing-mode"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ninguna">Sin factura</SelectItem>
                        <SelectItem value="diaria">Diaria (una factura por pedido, 14:00)</SelectItem>
                        <SelectItem value="semanal">Semanal (viernes 14:00, todos los pedidos juntos)</SelectItem>
                        <SelectItem value="mensual">Mensual (último día hábil, 14:00)</SelectItem>
                        <SelectItem value="diaria_envio_semanal">Diaria con envío semanal (Black Pot)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Facturar a</Label>
                    <Select value={(form as any).billTo ?? "cliente"} onValueChange={(v) => setForm({ ...form, billTo: v } as any)} disabled={!form.parentCustomerId}>
                      <SelectTrigger data-testid="select-bill-to"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cliente">Este cliente</SelectItem>
                        <SelectItem value="padre">Cliente padre{form.parentCustomerId ? ` (${getParentName(form.parentCustomerId)})` : ""}</SelectItem>
                      </SelectContent>
                    </Select>
                    {!form.parentCustomerId && <p className="text-[10px] text-muted-foreground">Sin cliente padre: se factura a este cliente.</p>}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Tipo de factura</Label>
                    <Select value={(form as any).invoiceType ?? "auto"} onValueChange={(v) => setForm({ ...form, invoiceType: v === "auto" ? null : v } as any)}>
                      <SelectTrigger data-testid="select-invoice-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automático (A si el facturado tiene CUIT, si no B)</SelectItem>
                        <SelectItem value="A">Factura A</SelectItem>
                        <SelectItem value="B">Factura B</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Condición IVA del receptor</Label>
                    <Select value={String((form as any).condicionIva ?? "auto")} onValueChange={(v) => setForm({ ...form, condicionIva: v === "auto" ? null : Number(v) } as any)}>
                      <SelectTrigger data-testid="select-condicion-iva"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automático (RI para A, Consumidor Final para B)</SelectItem>
                        <SelectItem value="1">Responsable Inscripto</SelectItem>
                        <SelectItem value="4">Exento</SelectItem>
                        <SelectItem value="5">Consumidor Final</SelectItem>
                        <SelectItem value="6">Monotributo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Detalle de factura</Label>
                    <Select value={(form as any).invoiceDetail ?? "agrupado"} onValueChange={(v) => setForm({ ...form, invoiceDetail: v } as any)}>
                      <SelectTrigger data-testid="select-invoice-detail"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="agrupado">Agrupada por alícuota (Frutas y verduras 10,5% / Huevos 21%)</SelectItem>
                        <SelectItem value="completo">Detallada por producto</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-border p-3 sm:col-span-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">Precios del remito incluyen IVA</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Sí: al facturar se desarma el total (neto = precio ÷ (1 + alícuota) por renglón) y la factura queda igual al remito. No: la factura suma el IVA sobre los precios del remito, como hoy.</p>
                    </div>
                    <Switch checked={!!(form as any).pricesIncludeIva} onCheckedChange={(v) => setForm({ ...form, pricesIncludeIva: v } as any)} data-testid="switch-prices-include-iva" />
                  </div>
                </div>
              </div>
              <div className="sm:col-span-2 flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label className="font-semibold">Bot activo (WhatsApp)</Label>
                  <p className="text-[11px] text-muted-foreground">Encendido: el agente crea el borrador y responde "pedido recibido" a este cliente. Apagado: solo registra la propuesta (modo sombra).</p>
                </div>
                <Switch
                  checked={!!(form as any).botActivo}
                  onCheckedChange={(v) => setForm({ ...form, botActivo: v } as any)}
                  data-testid="switch-bot-activo"
                />
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
                {form.hasIva && (
                  <div className="mt-2 flex items-center gap-3 rounded-md border border-border p-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">IVA desde</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Vacío = aplica a todos los pedidos, viejos incluidos. Con fecha = solo pedidos desde ese día; los anteriores y su cuenta corriente no cambian.</p>
                    </div>
                    <Input
                      type="date"
                      className="w-44"
                      value={(form.ivaSince as string | null) ?? ""}
                      onChange={(e) => setForm({ ...form, ivaSince: e.target.value || null })}
                      data-testid="input-iva-since"
                    />
                  </div>
                )}
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
