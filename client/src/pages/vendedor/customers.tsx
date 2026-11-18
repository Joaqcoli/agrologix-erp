// Clientes del vendedor. 17/11: estilo del admin (solo presentación; misma lógica de alta/edición).
// La info de comisión (alta, % vigente, fecha de paso al 1 %) vive acá, no en Comisiones.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { VendedorLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Pencil, Phone, Mail, MapPin, Users } from "lucide-react";
import { comisionPctEn, fechaBajaComision } from "@shared/comisiones";
import { VX_CSS, fmtFechaCorta, hoyAR, fetchJson } from "./rx";
import { geoParaGuardar, geoKey } from "@/lib/maps";
import { normalizarHora } from "@/lib/hora";

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
  comisionAlta: string | null; // 16/11: fecha de alta a efectos de comisión (primer pedido)
  salespersonName: string | null;
  active: boolean;
  // 18/11 Recorridos
  lat: string | null;
  lng: string | null;
  geoAddress: string | null;
  deliveryFrom: string | null;
  deliveryTo: string | null;
};

const EMPTY: Partial<Customer> = {
  name: "", rfc: "", email: "", phone: "", address: "", city: "",
  notes: "", hasIva: false, bolsaFv: false, commissionPct: "0",
};

// Búsqueda sin acentos ni mayúsculas
const normTxt = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export default function VendedorCustomers() {
  const { toast } = useToast();
  // Prefiltrar por ?q= (ej. al venir desde "Ver" en el dashboard)
  const [search, setSearch] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("q") ?? ""; } catch { return ""; }
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<Partial<Customer>>(EMPTY);

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["/api/vendedor/customers"],
    queryFn: () => fetchJson<Customer[]>("/api/vendedor/customers"),
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

  const [ubicando, setUbicando] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 18/11 Recorridos: al guardar, si la dirección cambió se geocodifica desde el navegador (Google)
    setUbicando(true);
    const geo = await geoParaGuardar(form, editing);
    setUbicando(false);
    if (geo.aviso) toast({ title: "Ubicación", description: geo.aviso });
    const data = { ...form, lat: geo.lat, lng: geo.lng, geoAddress: geo.geoAddress, deliveryFrom: normalizarHora(form.deliveryFrom) || null, deliveryTo: normalizarHora(form.deliveryTo) || null };
    if (editing) updateMutation.mutate({ id: editing.id, data });
    else createMutation.mutate(data);
  };

  const q = normTxt(search);
  const filtered = customers.filter(
    (c) => !q || normTxt(c.name).includes(q) || normTxt(c.city ?? "").includes(q)
  );

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const hoy = hoyAR();

  return (
    <VendedorLayout title="Mis Clientes">
      <div className="vx">
        <style>{VX_CSS}</style>
        <div className="vx-wrap">
          <div className="vx-top">
            <div>
              <h1 className="vx-title">Mis clientes</h1>
              <div className="vx-subtitle">{customers.length} cliente{customers.length !== 1 ? "s" : ""} asignado{customers.length !== 1 ? "s" : ""}</div>
            </div>
            <button className="vx-btn primary" onClick={openCreate} data-testid="button-add-customer"><Plus className="h-4 w-4" /> Nuevo cliente</button>
          </div>

          <div className="vx-search">
            <Search className="h-[17px] w-[17px]" />
            <input placeholder="Buscar por nombre o ciudad..." value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-customers" />
          </div>

          {isLoading ? (
            <div className="vx-grid">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="vx-empty">
              <div className="vx-emptyic"><Users className="h-6 w-6" /></div>
              <div className="big">{search ? "Sin resultados" : "No tenés clientes asignados"}</div>
              {!search && <button className="vx-btn primary" style={{ marginTop: 6 }} onClick={openCreate}><Plus className="h-4 w-4" /> Crear primer cliente</button>}
            </div>
          ) : (
            <div className="vx-grid">
              {filtered.map((c) => {
                const initials = c.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
                const pctVigente = c.comisionAlta ? comisionPctEn(c.comisionAlta, hoy) : null;
                const baja = c.comisionAlta ? fechaBajaComision(c.comisionAlta) : null;
                return (
                  <div key={c.id} className="vx-ccard" data-testid={`card-customer-${c.id}`}>
                    <div className="vx-cube">{initials}</div>
                    <div className="vx-cinfo">
                      <div className="vx-cname" title={c.name}>{c.name}</div>
                      {c.city && <div className="vx-csub">{c.city}</div>}
                      <div className="vx-cbadges">
                        {c.hasIva && <span className="vx-chip iva">Con IVA</span>}
                        {c.comisionAlta ? (
                          <span className={`vx-chip ${pctVigente === 5 ? "ok" : "gris"}`} title="Alta = primer pedido. 5 % los primeros 6 meses, después 1 %" data-testid={`badge-comision-${c.id}`}>
                            Comisión {pctVigente} %
                          </span>
                        ) : (
                          <span className="vx-chip line" title="La fecha de alta se fija con el primer pedido">sin pedidos aún</span>
                        )}
                      </div>
                      {c.comisionAlta && (
                        <div className="vx-csub" style={{ marginTop: 6 }}>
                          Alta {fmtFechaCorta(c.comisionAlta)} · {pctVigente === 5 ? `5 % hasta el ${fmtFechaCorta(baja && new Date(baja + "T12:00:00").getTime() ? restarDia(baja) : baja)}` : `1 % desde el ${fmtFechaCorta(baja)}`}
                        </div>
                      )}
                      {c.phone && <div className="vx-ctel"><Phone className="h-[13px] w-[13px]" /><span>{c.phone}</span></div>}
                      {c.email && <div className="vx-ctel" style={{ marginTop: 4 }}><Mail className="h-[13px] w-[13px]" /><span>{c.email}</span></div>}
                      {c.address && <div className="vx-ctel" style={{ marginTop: 4 }}><MapPin className="h-[13px] w-[13px]" /><span>{c.address}</span></div>}
                    </div>
                    <button className="vx-ic" onClick={() => openEdit(c)} title="Editar cliente" data-testid={`button-edit-${c.id}`}><Pencil className="h-4 w-4" /></button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <p className="text-[11px] text-muted-foreground">
                  {form.lat && form.lng && form.geoAddress === geoKey(form.address, form.city) ? "Ubicado en el mapa ✓" : (form.address ?? "").trim() ? "Se ubica en el mapa al guardar" : "Sin dirección: no aparece en Recorridos"}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Entrega desde</Label>
                <Input inputMode="numeric" placeholder="08:00" value={form.deliveryFrom ?? ""} onChange={(e) => setForm((f) => ({ ...f, deliveryFrom: e.target.value || null }))} onBlur={(e) => setForm((f) => ({ ...f, deliveryFrom: normalizarHora(e.target.value) || null }))} data-testid="input-delivery-from" />
              </div>
              <div className="space-y-1.5">
                <Label>Entrega hasta</Label>
                <Input inputMode="numeric" placeholder="10:00" value={form.deliveryTo ?? ""} onChange={(e) => setForm((f) => ({ ...f, deliveryTo: e.target.value || null }))} onBlur={(e) => setForm((f) => ({ ...f, deliveryTo: normalizarHora(e.target.value) || null }))} data-testid="input-delivery-to" />
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
              <Button type="submit" disabled={isSaving || ubicando}>
                {ubicando ? "Ubicando dirección..." : isSaving ? "Guardando..." : editing ? "Guardar cambios" : "Crear cliente"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </VendedorLayout>
  );
}

/** Día anterior a YYYY-MM-DD (el último día al 5 % es el anterior a la fecha de baja). */
function restarDia(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
