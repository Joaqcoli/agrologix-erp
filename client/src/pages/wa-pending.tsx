/**
 * A-01 · Números por asignar — mensajes de WhatsApp que llegaron de un teléfono que no está en
 * customer_contacts (o que está en varios clientes y la IA no pudo elegir). Joaquín asigna el número a
 * uno o varios clientes con un clic; el agente reprocesa el mensaje solo.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Phone, Check, X, MessageSquare } from "lucide-react";
import type { Customer, WaPendingNumber } from "@shared/schema";
import { formatArPhone } from "@shared/phone";

type Suggestion = { customerId: number; name: string; reason?: string };

export default function WaPendingPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"pending" | "assigned" | "ignored">("pending");
  const { data: rows = [], isLoading } = useQuery<WaPendingNumber[]>({ queryKey: ["/api/wa-pending", tab], queryFn: async () => {
    const r = await fetch(`/api/wa-pending?status=${tab}`, { credentials: "include" });
    if (!r.ok) throw new Error("No se pudo cargar");
    return r.json();
  } });
  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const activeCustomers = useMemo(() => customers.filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name, "es")), [customers]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/wa-pending"] });
  const assign = useMutation({
    mutationFn: ({ id, customerIds, contactName }: { id: number; customerIds: number[]; contactName: string | null }) =>
      apiRequest("POST", `/api/wa-pending/${id}/assign`, { customerIds, contactName }),
    onSuccess: () => { invalidate(); toast({ title: "Número asignado", description: "El mensaje se reprocesa solo en unos minutos." }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const ignore = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/wa-pending/${id}/ignore`, {}),
    onSuccess: () => { invalidate(); toast({ title: "Ignorado" }); },
  });

  return (
    <Layout title="Números por asignar">
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">Números por asignar</h1>
            <p className="text-sm text-muted-foreground">Mensajes de WhatsApp de teléfonos que el sistema no reconoce. Asignalos a un cliente (o varios) y el pedido se carga solo.</p>
          </div>
          <div className="flex gap-1">
            {(["pending", "assigned", "ignored"] as const).map((t) => (
              <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>
                {t === "pending" ? "Pendientes" : t === "assigned" ? "Asignados" : "Ignorados"}
              </Button>
            ))}
          </div>
        </div>

        {isLoading ? <p className="text-sm text-muted-foreground">Cargando...</p>
          : rows.length === 0 ? <p className="text-sm text-muted-foreground">No hay números {tab === "pending" ? "pendientes" : tab === "assigned" ? "asignados" : "ignorados"}.</p>
          : rows.map((row) => <PendingCard key={row.id} row={row} customers={activeCustomers} onAssign={(customerIds, contactName) => assign.mutate({ id: row.id, customerIds, contactName })} onIgnore={() => ignore.mutate(row.id)} busy={assign.isPending || ignore.isPending} readOnly={tab !== "pending"} />)}
      </div>
    </Layout>
  );
}

function PendingCard({ row, customers, onAssign, onIgnore, busy, readOnly }: {
  row: WaPendingNumber; customers: Customer[]; onAssign: (ids: number[], contactName: string | null) => void; onIgnore: () => void; busy: boolean; readOnly: boolean;
}) {
  const suggestions = (row.suggestions as Suggestion[] | null) ?? [];
  const [selected, setSelected] = useState<number[]>([]);
  const [contactName, setContactName] = useState(row.profileName ?? "");
  const [search, setSearch] = useState("");
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const results = search.trim().length >= 2
    ? customers.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : [];
  const assignedIds = (row.assignedCustomerIds as number[] | null) ?? [];

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Phone className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-sm">{formatArPhone(row.phone)}</span>
          {row.profileName && <Badge variant="secondary">{row.profileName}</Badge>}
          {row.reason === "repetido" && <Badge variant="outline" className="text-yellow-600 border-yellow-500/40">teléfono en varios clientes</Badge>}
          <span className="text-xs text-muted-foreground ml-auto">{row.receivedAt ? new Date(row.receivedAt).toLocaleString("es-AR") : ""}</span>
        </div>
        <pre className="text-xs whitespace-pre-wrap bg-muted/40 rounded-md p-3 max-h-48 overflow-auto font-mono"><MessageSquare className="inline h-3 w-3 mr-1" />{row.messageText}</pre>

        {readOnly ? (
          <p className="text-xs text-muted-foreground">
            {row.status === "assigned" || row.status === "processed"
              ? `Asignado a: ${assignedIds.map((id) => customers.find((c) => c.id === id)?.name ?? id).join(", ")}${row.status === "processed" ? " · pedido reprocesado" : " · esperando reproceso"}`
              : "Ignorado"}
          </p>
        ) : (
          <>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Sugeridos:</span>
                {suggestions.map((s) => (
                  <button key={s.customerId} type="button" title={s.reason} onClick={() => toggle(s.customerId)}
                    className={`text-xs px-2 py-0.5 rounded-full border ${selected.includes(s.customerId) ? "bg-green-700 text-white border-green-700" : "border-border hover:bg-muted"}`}>
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 items-start">
              <div className="relative flex-1 min-w-[200px]">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar otro cliente..." className="h-8 text-sm" />
                {results.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 mt-1 border rounded-md bg-background shadow-md max-h-48 overflow-auto">
                    {results.map((c) => (
                      <button key={c.id} type="button" onMouseDown={() => { toggle(c.id); setSearch(""); }}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50">{c.name}</button>
                    ))}
                  </div>
                )}
              </div>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nombre / rol (ej. Juan - cocina)" className="h-8 text-sm w-56" />
            </div>
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selected.map((id) => (
                  <Badge key={id} variant="default" className="cursor-pointer" onClick={() => toggle(id)}>
                    {customers.find((c) => c.id === id)?.name ?? id} <X className="h-3 w-3 ml-1" />
                  </Badge>
                ))}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" disabled={busy} onClick={onIgnore}><X className="h-4 w-4 mr-1" /> Ignorar</Button>
              <Button size="sm" disabled={busy || selected.length === 0} onClick={() => onAssign(selected, contactName.trim() || null)} data-testid={`assign-${row.id}`}>
                <Check className="h-4 w-4 mr-1" /> Asignar{selected.length > 1 ? ` a ${selected.length} clientes` : ""}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
