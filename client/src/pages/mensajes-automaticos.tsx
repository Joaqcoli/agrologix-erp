/**
 * A-13 · Configuración → Mensajes automáticos: textos de todos los mensajes que manda el sistema por WhatsApp.
 * Al guardar un cambio se manda la plantilla nueva a aprobar a Meta (vía YCloud) y se sigue usando la aprobada
 * hasta que la nueva esté aprobada. Estado: aprobado / pendiente / rechazado (con motivo).
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { MessageSquareText, RefreshCw, Save } from "lucide-react";

type Tpl = { key: string; label: string; text: string; hasDocument: boolean; approvedName: string | null; pendingName: string | null; pendingStatus: string | null; pendingReason: string | null; version: number; metaPreview: string };
const VARIABLES: Record<string, string> = { saludo: "«Buen día» antes de las 13, «Buenas tardes» después", faltantes: "el aviso de faltantes del pedido (vacío si no hay)", fecha: "fecha del pedido (dd/mm/aaaa)", cantidad: "cantidad de líneas en duda" };

function Estado({ t }: { t: Tpl }) {
  if (!t.hasDocument && !t.pendingName && !t.approvedName) return <Badge variant="outline">Texto libre (sin plantilla)</Badge>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {t.approvedName ? <Badge className="bg-green-100 text-green-800 border-green-300" variant="outline">Aprobada: {t.approvedName}</Badge> : <Badge variant="destructive">Sin plantilla aprobada</Badge>}
      {t.pendingName && (t.pendingStatus === "REJECTED"
        ? <Badge variant="destructive" title={t.pendingReason ?? undefined}>Rechazada: {t.pendingName}{t.pendingReason ? ` — ${t.pendingReason}` : ""}</Badge>
        : <Badge variant="secondary">Pendiente en Meta: {t.pendingName}{t.pendingStatus && t.pendingStatus !== "PENDING" ? ` (${t.pendingStatus})` : ""}</Badge>)}
    </div>
  );
}

function Fila({ t, ycloud }: { t: Tpl; ycloud: boolean }) {
  const { toast } = useToast();
  const [text, setText] = useState(t.text);
  useEffect(() => setText(t.text), [t.text]);
  const guardar = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/message-templates/${t.key}`, { text }).then((r) => r.json()),
    onSuccess: (r: { publicado: { name: string; status: string } | null; aviso: string | null }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/message-templates"] });
      toast(r.aviso ? { title: "Guardado", description: r.aviso } : { title: "Guardado y enviado a aprobar", description: `Plantilla ${r.publicado?.name} (${r.publicado?.status}). Hasta que Meta la apruebe se usa la anterior.` });
    },
    onError: (e: any) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });
  const publicar = useMutation({
    mutationFn: () => apiRequest("POST", `/api/message-templates/${t.key}/publicar`, {}).then((r) => r.json()),
    onSuccess: (r: { name: string; status: string }) => { queryClient.invalidateQueries({ queryKey: ["/api/message-templates"] }); toast({ title: "Enviada a aprobar", description: `${r.name} (${r.status})` }); },
    onError: (e: any) => toast({ title: "No se pudo enviar a Meta", description: e.message, variant: "destructive" }),
  });
  const vars = Array.from(text.matchAll(/\{(\w+)\}/g)).map((m) => m[1]);
  const cambiado = text.trim() !== t.text.trim();
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-foreground">{t.label} <span className="text-xs text-muted-foreground font-normal">· {t.hasDocument ? "con el PDF adjunto" : "solo texto"}</span></p>
          <Estado t={t} />
        </div>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="text-sm" data-testid={`textarea-tpl-${t.key}`} />
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[11px] text-muted-foreground flex-1 min-w-[240px]">
            {vars.length ? <>Variables: {vars.map((v) => <span key={v} className="mr-2"><code>{`{${v}}`}</code> = {VARIABLES[v] ?? "?"}</span>)}</> : "Sin variables."}
            {t.hasDocument && <> · En Meta: <code>{t.metaPreview}</code></>}
          </p>
          {t.hasDocument && !t.approvedName && !t.pendingName && ycloud && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => publicar.mutate()} disabled={publicar.isPending}>Mandar a aprobar a Meta</Button>
          )}
          <Button size="sm" className="h-7 text-xs" onClick={() => guardar.mutate()} disabled={!cambiado || guardar.isPending} data-testid={`button-save-tpl-${t.key}`}><Save className="h-3.5 w-3.5 mr-1" /> {guardar.isPending ? "Guardando…" : "Guardar"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MensajesAutomaticosPage() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ ycloud: boolean; templates: Tpl[] }>({ queryKey: ["/api/message-templates"] });
  const revisar = useMutation({
    mutationFn: () => apiRequest("POST", "/api/message-templates/revisar", {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/message-templates"] }); toast({ title: "Estados actualizados" }); },
    onError: (e: any) => toast({ title: "No se pudo consultar a Meta", description: e.message, variant: "destructive" }),
  });
  return (
    <Layout title="Mensajes automáticos">
      <div className="p-4 sm:p-6 space-y-4 max-w-4xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2"><MessageSquareText className="h-5 w-5" /> Mensajes automáticos</h1>
            <p className="text-sm text-muted-foreground mt-1">Textos de lo que manda el sistema por WhatsApp. Al guardar, la plantilla nueva se manda a aprobar a Meta y se sigue usando la anterior hasta que esté aprobada. Mientras un mensaje no tiene plantilla aprobada, solo le llega a quien escribió al número en las últimas 24 h.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => revisar.mutate()} disabled={revisar.isPending}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Consultar estados en Meta</Button>
        </div>
        {data && !data.ycloud && <p className="text-sm text-destructive bg-destructive/5 rounded px-3 py-2">YCloud no está configurado en el ERP (falta YCLOUD_API_KEY en Render): los textos se guardan pero no se mandan a aprobar ni se envían documentos.</p>}
        {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {data?.templates.map((t) => <Fila key={t.key} t={t} ycloud={data.ycloud} />)}
      </div>
    </Layout>
  );
}
