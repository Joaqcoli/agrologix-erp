// 25/11/2026 · Cargar una compra desde la foto de la boleta del proveedor. Claude la lee (proveedor, renglones, envases,
// forma de pago, total) y la pantalla "Nueva compra" se abre precargada para revisar y confirmar. Nada se guarda acá.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Camera, ImageIcon, Loader2, Sparkles } from "lucide-react";
import type { Supplier } from "@shared/schema";
import { achicarImagen, setBoleta, type BoletaData } from "@/lib/boleta-store";

export default function BoletaPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [image, setImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const { data: suppliers } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const activos = (suppliers ?? []).filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name));

  const elegir = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { toast({ title: "La foto supera 12 MB", variant: "destructive" }); return; }
    try { setImage({ name: f.name, dataUrl: await achicarImagen(f) }); }
    catch (e: any) { toast({ title: "No se pudo leer la foto", description: e.message, variant: "destructive" }); }
  };

  const analizar = async () => {
    if (!image) return;
    setAnalizando(true);
    try {
      const res = await fetch("/api/purchases/interpret", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ imageBase64: image.dataUrl, supplierId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
      const b: BoletaData = { ...data, imageDataUrl: image.dataUrl };
      setBoleta(b);
      setLocation("/purchases/new?boleta=1");
    } catch (e: any) {
      toast({ title: "No se pudo leer la boleta", description: e.message, variant: "destructive" });
    } finally { setAnalizando(false); }
  };

  return (
    <Layout title="Cargar desde boleta">
      <div className="p-6 max-w-2xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/purchases")} data-testid="button-back"><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h2 className="text-xl font-semibold text-foreground">Cargar desde boleta</h2>
            <p className="text-sm text-muted-foreground">Sacale una foto a la boleta del proveedor. Claude la lee y abre la compra precargada para que la revises.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-[#ecece8] bg-white p-5 space-y-5">
          <div className="space-y-2">
            <Label>Foto de la boleta</Label>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer border border-[#ecece8] rounded-[11px] px-3 py-2 bg-white hover:bg-[#f6f6f2]">
                <Camera className="h-4 w-4" /> Sacar foto
                <input type="file" accept="image/*" capture="environment" className="hidden" data-testid="input-boleta-camera" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void elegir(f); }} />
              </label>
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer border border-[#ecece8] rounded-[11px] px-3 py-2 bg-white hover:bg-[#f6f6f2]">
                <ImageIcon className="h-4 w-4" /> {image ? "Cambiar foto" : "Subir foto"}
                <input type="file" accept="image/*" className="hidden" data-testid="input-boleta-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void elegir(f); }} />
              </label>
              {image && <button type="button" className="text-xs underline text-muted-foreground" onClick={() => setImage(null)}>quitar</button>}
            </div>
            {image && <img src={image.dataUrl} alt="Boleta" className="max-h-[420px] rounded-xl border border-[#ecece8] object-contain" data-testid="img-boleta-preview" />}
            <p className="text-xs text-muted-foreground">Una boleta por foto, entera y derecha. Si hay dos boletas en la misma hoja, sacá una foto por cada una.</p>
          </div>

          <div className="space-y-2">
            <Label>Proveedor <span className="text-muted-foreground font-normal">(opcional: si lo elegís acá, no se adivina)</span></Label>
            <Select value={supplierId ? String(supplierId) : "auto"} onValueChange={(v) => setSupplierId(v === "auto" ? null : Number(v))}>
              <SelectTrigger data-testid="select-boleta-supplier"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="auto">— Reconocerlo de la boleta —</SelectItem>
                {activos.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name.trim()}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Button className="w-full" size="lg" onClick={analizar} disabled={!image || analizando} data-testid="button-analizar-boleta">
            {analizando ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {analizando ? "Leyendo la boleta..." : "Leer boleta y precargar la compra"}
          </Button>
          <p className="text-xs text-muted-foreground">Tarda entre 20 y 40 segundos. Después revisás todo en "Nueva compra" y recién ahí se guarda.</p>
        </div>
      </div>
    </Layout>
  );
}
