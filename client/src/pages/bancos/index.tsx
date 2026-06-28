import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Landmark, TrendingUp, Percent, ArrowDownLeft, ArrowUpRight, User, Building2, UserCheck, Pencil, RefreshCw, Columns2, Rows2, Upload } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  BankSection, fmt, fmtDateLong, toArgDate,
  type MpMovement, type MpMovementsResponse, type BankCategory, type BankPaymentLink, type CardSpec,
} from "./BankSection";

// ─── helpers locales (específicos de MP: contactos / identificación) ─────────────

const OWN_EMAIL = "vegetalesargentinos.srl@gmail.com";

function fmtRawId(id: string | null | undefined): string {
  if (!id) return "";
  if (id === OWN_EMAIL) return "";
  if (id.startsWith("bank_transfer:")) return "";
  if (id.startsWith("mp:")) return `ID MP: ${id.slice(3)}`;
  if (/^\d{15,}$/.test(id)) return `CBU: ${id.slice(0, 8)}…${id.slice(-4)}`;
  if (id.length > 30) return id.slice(0, 15) + "…" + id.slice(-8);
  return id;
}

const CONTACT_TYPE_LABELS: Record<string, string> = {
  cliente: "Cliente", proveedor: "Proveedor", banco: "Banco", otro: "Otro",
};

type BankContact = { id: number; identifier: string; displayName: string; type: string; entityId: number | null };
type MpBalance = { available_balance?: number | null; unavailable?: boolean; error?: string };
type PendingOrder = {
  id: number; folio: string; remitoNum: number | null; total: string;
  paidAmount: string; pendingAmount: string; orderDate: string; invoiceNumber: string | null;
};
type SimpleEntity = { id: number; name: string };

function fmtList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + " y " + items[items.length - 1];
}

function fmtBankLinks(links: BankPaymentLink[]): string {
  const invoices = links.filter(l => l.invoiceNumber).map(l => {
    const parts = l.invoiceNumber!.split("-");
    return String(parseInt(parts[parts.length - 1] ?? "0", 10));
  });
  const remitos = links.filter(l => !l.invoiceNumber && l.remitoNum != null).map(l => String(l.remitoNum));
  if (invoices.length > 0 && remitos.length === 0) return `FC ${fmtList(invoices)}`;
  if (remitos.length > 0 && invoices.length === 0) return `Remito ${fmtList(remitos)}`;
  if (invoices.length > 0 && remitos.length > 0) return `FC ${fmtList(invoices)}, Remito ${fmtList(remitos)}`;
  return links.map(l => l.folio ?? `#${l.pedidoId}`).join(", ");
}

function ContactTypeIcon({ type }: { type: string }) {
  if (type === "cliente") return <User className="h-3.5 w-3.5 text-blue-500" />;
  if (type === "proveedor") return <Building2 className="h-3.5 w-3.5 text-purple-500" />;
  if (type === "banco") return <Landmark className="h-3.5 w-3.5 text-blue-400" />;
  return <UserCheck className="h-3.5 w-3.5 text-gray-400" />;
}

// ─── main component ──────────────────────────────────────────────────────────────

export default function BancosPage() {
  const qc = useQueryClient();

  // Layout de la vista: dividido (split) | pestañas (tabs) — fácil de alternar
  const [viewLayout, setViewLayout] = useState<"split" | "tabs">("split");
  const [activeTab, setActiveTab] = useState<"mp" | "galicia">("mp");

  // New category dialog
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatAfecta, setNewCatAfecta] = useState(true);   // B6: ¿afecta el gráfico de egresos? (default Sí)
  const [pendingMovId, setPendingMovId] = useState<string | number | null>(null);

  // Edit category dialog
  const [editCatOpen, setEditCatOpen] = useState(false);
  const [editCat, setEditCat] = useState<BankCategory | null>(null);
  const [editCatName, setEditCatName] = useState("");

  // Aplicar pago dialog
  const [applyPayOpen, setApplyPayOpen] = useState(false);
  const [applyPayMov, setApplyPayMov] = useState<MpMovement | null>(null);
  const [applyAmounts, setApplyAmounts] = useState<Map<number, string>>(new Map());

  // Asignación de cobros Galicia — picker manual de cliente (cobros sin CUIT/match)
  const [galiciaPickOpen, setGaliciaPickOpen] = useState(false);
  const [galiciaPickMov, setGaliciaPickMov] = useState<MpMovement | null>(null);
  const [galiciaPickSearch, setGaliciaPickSearch] = useState("");

  // Aplicar pago a PROVEEDOR (espejo del de clientes): movimiento + proveedor elegido
  const [provApplyOpen, setProvApplyOpen] = useState(false);
  const [provApplyMov, setProvApplyMov] = useState<MpMovement | null>(null);
  const [provSupplierId, setProvSupplierId] = useState<number | null>(null);
  const [provSearch, setProvSearch] = useState("");
  const [provError, setProvError] = useState<string | null>(null);

  // Identificar / Editar contacto dialog
  const [identifyOpen, setIdentifyOpen] = useState(false);
  const [identifyMov, setIdentifyMov] = useState<MpMovement | null>(null);
  const [idName, setIdName] = useState("");
  const [idIdentifier, setIdIdentifier] = useState("");
  const [idType, setIdType] = useState("otro");
  const [idEntityId, setIdEntityId] = useState<number | null>(null);
  const [entitySearch, setEntitySearch] = useState("");
  const [idError, setIdError] = useState<string | null>(null);
  const [idEditMode, setIdEditMode] = useState(false);
  const [contactPickSearch, setContactPickSearch] = useState("");

  // ── queries ──────────────────────────────────────────────────────────────────

  const { data: balance, isLoading: balanceLoading } = useQuery<MpBalance>({
    queryKey: ["/api/mp/balance"],
    queryFn: () => fetch("/api/mp/balance", { credentials: "include" }).then(r => r.json()),
    retry: false,
  });

  const { data: categories = [] } = useQuery<BankCategory[]>({
    queryKey: ["/api/bank-categories"],
    queryFn: () =>
      fetch("/api/bank-categories", { credentials: "include" }).then(r => r.json()).then(d => (Array.isArray(d) ? d : [])),
  });

  const { data: customers = [] } = useQuery<SimpleEntity[]>({
    queryKey: ["/api/customers"],
    queryFn: () => fetch("/api/customers", { credentials: "include" }).then(r => r.json()),
    enabled: (identifyOpen && (idType === "cliente")) || galiciaPickOpen,
  });

  const { data: pendingOrders = [], isLoading: pendingOrdersLoading } = useQuery<PendingOrder[]>({
    queryKey: ["/api/customers/pedidos-pendientes", applyPayMov?.entityId],
    queryFn: () => fetch(`/api/customers/${applyPayMov!.entityId}/pedidos-pendientes`, { credentials: "include" }).then(r => r.json()),
    enabled: applyPayOpen && !!applyPayMov?.entityId,
  });

  const { data: suppliers = [] } = useQuery<SimpleEntity[]>({
    queryKey: ["/api/suppliers"],
    queryFn: () => fetch("/api/suppliers", { credentials: "include" }).then(r => r.json()),
    enabled: (identifyOpen && (idType === "proveedor")) || provApplyOpen,
  });

  // Preview del saldo CC del proveedor elegido (dry-run, no escribe)
  const { data: provPreview } = useQuery<{ saldoAntes: number; saldoDespues: number; supplierName: string } | null>({
    queryKey: ["/api/bank/supplier-payment", "dry", provApplyMov?.id, provSupplierId],
    queryFn: () => apiRequest("POST", "/api/bank/supplier-payment", {
      movementId: String(provApplyMov!.id), supplierId: provSupplierId, amount: provApplyMov!.grossAmount, dryRun: true,
    }).then(r => r.json()),
    enabled: provApplyOpen && !!provApplyMov && provSupplierId != null,
  });

  // Aplicar el pago a la CC del proveedor (baja la deuda)
  const provApplyMut = useMutation({
    mutationFn: (data: { movementId: string; supplierId: number; amount: number; date: string; method?: string; galiciaId?: string }) =>
      apiRequest("POST", "/api/bank/supplier-payment", data).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/galicia/movements"] });
      qc.invalidateQueries({ queryKey: ["/api/ap/cc"] });
      setProvApplyOpen(false); setProvApplyMov(null); setProvSupplierId(null); setProvSearch(""); setProvError(null);
    },
    onError: (e: Error) => setProvError(e.message),
  });

  // Marcar pago a proveedor como ya registrado (NO toca CC)
  const provYaRegistradoMut = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/galicia/pago-proveedor/ya-registrado", { id }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/galicia/movements"] });
      setProvApplyOpen(false); setProvApplyMov(null); setProvSupplierId(null); setProvSearch(""); setProvError(null);
    },
    onError: (e: Error) => setProvError(e.message),
  });

  const openProvApply = (m: MpMovement) => {
    setProvApplyMov(m); setProvSupplierId(m.suggestedSupplierId ?? null); setProvSearch(""); setProvError(null); setProvApplyOpen(true);
  };

  const { data: allBankContacts = [] } = useQuery<BankContact[]>({
    queryKey: ["/api/bank-contacts"],
    queryFn: () => fetch("/api/bank-contacts", { credentials: "include" }).then(r => r.json()),
    enabled: identifyOpen && !idEditMode,
  });

  // ── mutations ─────────────────────────────────────────────────────────────────

  const setCategoryMut = useMutation({
    mutationFn: ({ mpId, categoryId, amount, fee, date, isOutgoing, description, socioId }: {
      mpId: string | number; categoryId: number | null; amount?: number; fee?: number;
      date?: string; isOutgoing?: boolean; description?: string; socioId?: number | null;
    }) => apiRequest("PUT", `/api/mp/movements/${mpId}/category`, { categoryId, amount, fee, date, isOutgoing, description, socioId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/mp/movements"] });
      qc.invalidateQueries({ queryKey: ["/api/caja/summary"] });
      qc.invalidateQueries({ queryKey: ["/api/caja/retiros"] });
    },
  });

  const { data: socios = [] } = useQuery<{ id: number; nombre: string; activo: boolean }[]>({
    queryKey: ["/api/caja/socios"],
    queryFn: () => fetch("/api/caja/socios", { credentials: "include" }).then(r => r.json()),
  });

  // El diálogo "¿a qué socio?" se reusa para MP y Galicia (discriminado por source)
  const [retiroPrompt, setRetiroPrompt] = useState<
    | { source: "mp"; mpId: string | number; categoryId: number; amount?: number; fee?: number; date?: string; isOutgoing?: boolean; description?: string }
    | { source: "galicia"; id: string; categoryId: number }
    | null
  >(null);
  const [retiroSocioId, setRetiroSocioId] = useState<number | null>(null);

  // Categoriza un movimiento MP; si es "Retiro" pide socio antes de guardar
  const handleCategorizeMp = (m: MpMovement, catId: number | null) => {
    const payload = {
      mpId: m.id,
      categoryId: catId,
      amount: m.grossAmount ?? m.netAmount,
      fee: m.feeAmount ?? 0,
      date: toArgDate(m.date_created ?? ""),
      isOutgoing: m.isOutgoing,
      description: m.displayName || m.description || "",
    };
    const catName = catId != null ? categories.find(c => c.id === catId)?.name : null;
    if (catName === "Retiro" && catId != null) {
      setRetiroPrompt({ source: "mp", ...payload, categoryId: catId });
      setRetiroSocioId(null);
    } else {
      setCategoryMut.mutate(payload);
    }
  };

  // Categoriza un movimiento de Galicia; si es "Retiro" pide socio (mismo diálogo que MP)
  const handleCategorizeGalicia = (m: MpMovement, catId: number | null) => {
    const catName = catId != null ? categories.find(c => c.id === catId)?.name : null;
    if (catName === "Retiro" && catId != null) {
      setRetiroPrompt({ source: "galicia", id: String(m.id), categoryId: catId });
      setRetiroSocioId(null);
    } else {
      galiciaSetCategoryMut.mutate({ id: m.id, categoryId: catId });
    }
  };

  const createCategoryMut = useMutation({
    mutationFn: ({ name, afectaEgresos }: { name: string; afectaEgresos: boolean }) =>
      apiRequest("POST", "/api/bank-categories", { name, afectaEgresos }),
    onSuccess: async (res: any) => {
      await qc.invalidateQueries({ queryKey: ["/api/bank-categories"] });
      if (pendingMovId != null && res?.id) {
        setCategoryMut.mutate({ mpId: pendingMovId, categoryId: res.id });
      }
      setPendingMovId(null);
      setNewCatOpen(false);
      setNewCatName("");
      setNewCatAfecta(true);
    },
  });

  const createContactMut = useMutation({
    mutationFn: (data: { identifier: string; displayName: string; type: string; entityId: number | null }) =>
      apiRequest("POST", "/api/bank-contacts", data).then(r => r.json()) as Promise<BankContact>,
    onError: (e: Error) => {
      const msg = e.message.includes("23505") || e.message.includes("409") ? "Ese identificador ya está registrado" : e.message;
      setIdError(msg);
    },
  });

  const updateContactMut = useMutation({
    mutationFn: ({ id, ...data }: { id: number; displayName: string; type: string; entityId: number | null }) =>
      apiRequest("PUT", `/api/bank-contacts/${id}`, data).then(r => r.json()) as Promise<BankContact>,
    onError: (e: Error) => setIdError(e.message),
  });

  const deleteContactMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/bank-contacts/${id}`),
    onSuccess: () => {
      const deletedContactId = identifyMov?.contactId;
      qc.setQueriesData<MpMovementsResponse>(
        { queryKey: ["/api/mp/movements"] },
        (old) => {
          if (!old?.results) return old;
          return {
            ...old,
            results: old.results.map(m =>
              m.contactId === deletedContactId
                ? { ...m, identified: false, displayName: null, contactType: null, entityId: null, contactId: null }
                : m
            ),
          };
        }
      );
      closeIdentifyDialog();
    },
    onError: (e: Error) => setIdError(e.message),
  });

  const updateCategoryMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      apiRequest("PUT", `/api/bank-categories/${id}`, { name }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/bank-categories"] });
      setEditCatOpen(false);
      setEditCat(null);
      setEditCatName("");
    },
  });

  // B-upload: subir extracto de Galicia (CSV/XLSX) al endpoint existente
  const galiciaFileRef = useRef<HTMLInputElement>(null);
  type GaliciaUploadState =
    | { kind: "ok"; nuevos: number; duplicados: number; sinCategoria: number; total: number; chequesConciliados: number; chequesBaja: number; chequesEmitidosDespues: number }
    | { kind: "empty" }
    | { kind: "error"; msg: string }
    | null;
  const [galiciaUpload, setGaliciaUpload] = useState<GaliciaUploadState>(null);

  const galiciaUploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/galicia/upload", { method: "POST", body: fd, credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "No se pudo subir el archivo");
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/galicia/movements"] });
      qc.invalidateQueries({ queryKey: ["/api/caja/summary"] });
      qc.invalidateQueries({ queryKey: ["/api/caja/cheques"] });  // el cruce pudo cobrar cheques
      if ((data.totalParseados ?? 0) === 0) {
        setGaliciaUpload({ kind: "empty" });
      } else {
        const cc = data.cruceCheques ?? {};
        setGaliciaUpload({
          kind: "ok",
          nuevos: data.insertadosGalicia ?? 0,
          duplicados: data.duplicados ?? 0,
          sinCategoria: data.sinCategoria ?? 0,
          total: data.totalParseados ?? 0,
          chequesConciliados: cc.conciliados ?? 0,
          chequesBaja: cc.baja ?? 0,
          chequesEmitidosDespues: cc.totalEmitidoDespues ?? 0,
        });
      }
    },
    onError: (e: Error) => setGaliciaUpload({ kind: "error", msg: e.message }),
  });

  const onGaliciaFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";          // permite re-subir el mismo archivo
    if (!file) return;
    setGaliciaUpload(null);
    galiciaUploadMut.mutate(file);
  };

  // B4: categorizar un movimiento de Galicia (persiste categoría + re-reconcilia caja; NO crea reglas)
  // socioId: solo para categoría "Retiro" → crea/actualiza la fila en retiros (card del socio).
  const galiciaSetCategoryMut = useMutation({
    mutationFn: ({ id, categoryId, socioId }: { id: string | number; categoryId: number | null; socioId?: number | null }) =>
      apiRequest("PUT", "/api/galicia/movements/category", { id: String(id), categoryId, socioId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/galicia/movements"] });
      qc.invalidateQueries({ queryKey: ["/api/caja/summary"] });
      qc.invalidateQueries({ queryKey: ["/api/caja/retiros"] });
    },
  });

  const [applyPayError, setApplyPayError] = useState<string | null>(null);

  const applyPayMut = useMutation({
    mutationFn: (data: { movementId: string; customerId: number; date: string; notes?: string; links: Array<{ pedidoId: number; montoAplicado: number }> }) =>
      apiRequest("POST", "/api/bank-payment-links", data).then(r => r.json()),
    onError: (e: Error) => setApplyPayError(e.message),
  });

  // Paso 4: aplicar un cobro de Galicia a CC (baja deuda del cliente + marca asignado + carga CUIT)
  const galiciaApplyMut = useMutation({
    mutationFn: (data: { movementId: string; customerId: number; date: string; links: Array<{ pedidoId: number; montoAplicado: number }>; galiciaId: string; loadCuit?: string }) =>
      apiRequest("POST", "/api/bank-payment-links", data).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/galicia/movements"] });
      qc.invalidateQueries({ queryKey: ["/api/ar/cc"] });
      qc.invalidateQueries({ queryKey: ["/api/caja/summary"] });
      setApplyPayOpen(false); setApplyPayMov(null); setApplyAmounts(new Map()); setApplyPayError(null);
    },
    onError: (e: Error) => setApplyPayError(e.message),
  });

  // Paso 4: marcar un cobro de Galicia como "ya registrado" a mano (NO toca CC)
  const galiciaYaRegistradoMut = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/galicia/cobro/ya-registrado", { id }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/galicia/movements"] });
      setApplyPayOpen(false); setApplyPayMov(null); setApplyAmounts(new Map()); setApplyPayError(null);
    },
    onError: (e: Error) => setApplyPayError(e.message),
  });

  const [syncResult, setSyncResult] = useState<string | null>(null);
  const syncReportMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/mp/sync-report").then(r => r.json()),
    onSuccess: (data: { synced: number; skipped: number; xlsxSynced?: number; reportFile: string | null; details?: string }) => {
      const xlsxSynced = data.xlsxSynced ?? 0;
      const identSynced = data.synced ?? 0;
      const parts: string[] = [];
      if (xlsxSynced > 0) parts.push(`${xlsxSynced} mov. reporte actualizados`);
      if (identSynced > 0) parts.push(`${identSynced} identificadores`);
      const msg = parts.length > 0 ? parts.join(", ") : `Sin novedades — ${data.details ?? `skipped: ${data.skipped}`}`;
      setSyncResult(msg);
      if (xlsxSynced > 0 || identSynced > 0) qc.invalidateQueries({ queryKey: ["/api/mp/movements"] });
      setTimeout(() => setSyncResult(null), 12000);
    },
    onError: (e: Error) => { setSyncResult(`Error: ${e.message}`); setTimeout(() => setSyncResult(null), 8000); },
  });

  // ── handlers ─────────────────────────────────────────────────────────────────

  const handleAddNew = (movId: string | number) => { setPendingMovId(movId); setNewCatOpen(true); };

  const openIdentifyDialog = (mov: MpMovement) => {
    setIdentifyMov(mov); setIdName(""); setIdIdentifier(mov.rawIdentifier ?? ""); setIdType("otro");
    setIdEntityId(null); setEntitySearch(""); setIdError(null); setIdEditMode(false); setContactPickSearch("");
    setIdentifyOpen(true);
  };

  const openEditContactDialog = (mov: MpMovement) => {
    setIdentifyMov(mov); setIdName(mov.displayName ?? ""); setIdIdentifier(mov.rawIdentifier ?? "");
    setIdType(mov.contactType ?? "otro"); setIdEntityId(mov.entityId ?? null); setEntitySearch("");
    setIdError(null); setIdEditMode(true); setIdentifyOpen(true);
  };

  const closeIdentifyDialog = () => {
    setIdentifyOpen(false); setIdentifyMov(null); setIdName(""); setIdIdentifier(""); setIdType("otro");
    setIdEntityId(null); setEntitySearch(""); setIdError(null); setIdEditMode(false); setContactPickSearch("");
  };

  const applyContactToCache = (contact: BankContact, movId?: string | number) => {
    qc.setQueriesData<MpMovementsResponse>(
      { queryKey: ["/api/mp/movements"] },
      (old) => {
        if (!old?.results) return old;
        return {
          ...old,
          results: old.results.map(m => {
            const byId = !m.rawIdentifier && m.id === movId;
            const byIdentifier = m.rawIdentifier && m.rawIdentifier.toLowerCase() === contact.identifier.toLowerCase();
            const byContactId = idEditMode && m.contactId === contact.id;
            if (!byId && !byIdentifier && !byContactId) return m;
            return { ...m, identified: true, displayName: contact.displayName, contactType: contact.type, entityId: contact.entityId, contactId: contact.id };
          }),
        };
      }
    );
  };

  const handleSaveContact = () => {
    if (!idName.trim()) return;
    setIdError(null);
    const movId = identifyMov?.id;
    const contactId = identifyMov?.contactId;
    if (idEditMode && contactId) {
      updateContactMut.mutate(
        { id: contactId, displayName: idName.trim(), type: idType, entityId: idEntityId },
        { onSuccess: (contact: BankContact) => { applyContactToCache(contact, movId); closeIdentifyDialog(); } }
      );
    } else {
      const effectiveIdentifier = idIdentifier.trim() || (identifyMov?.rawIdentifier ?? "");
      if (!effectiveIdentifier.trim()) return;
      createContactMut.mutate(
        { identifier: effectiveIdentifier.trim(), displayName: idName.trim(), type: idType, entityId: idEntityId },
        { onSuccess: (contact: BankContact) => { applyContactToCache(contact, movId); closeIdentifyDialog(); } }
      );
    }
  };

  const entityList: SimpleEntity[] = idType === "cliente" ? customers : idType === "proveedor" ? suppliers : [];
  const filteredEntities = entitySearch.trim()
    ? entityList.filter(e => e.name.toLowerCase().includes(entitySearch.toLowerCase()))
    : entityList;

  // ── fetchers + cards (config por banco) ────────────────────────────────────────

  const fetchMpMovements = ({ from, to, status }: { from: string; to: string; status: string }): Promise<MpMovement[]> => {
    const p = new URLSearchParams({ from, to });
    if (status !== "all") p.set("status", status);
    return fetch(`/api/mp/movements?${p}`, { credentials: "include" }).then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); return d.results ?? []; });
  };

  const fetchGaliciaMovements = ({ from, to }: { from: string; to: string }): Promise<MpMovement[]> =>
    fetch(`/api/galicia/movements?from=${from}&to=${to}`, { credentials: "include" }).then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); return d.results ?? []; });

  const mpCards = (filtered: MpMovement[]): CardSpec[] => {
    let cobrado = 0, comis = 0;
    for (const m of filtered) {
      const raw = parseFloat(String(m.total ?? m.amount ?? 0));
      const fee = m.feeAmount ?? Math.abs(parseFloat(String(m.fee?.amount ?? 0)));
      if (raw > 0) cobrado += raw;
      comis += fee;
    }
    return [
      { label: "Cobrado (período)", value: cobrado, icon: <TrendingUp className="h-4 w-4 text-green-600" />, color: "text-green-700" },
      { label: "Comisiones (período)", value: comis, icon: <Percent className="h-4 w-4 text-orange-600" />, color: "text-orange-700" },
    ];
  };

  const galiciaCards = (filtered: MpMovement[]): CardSpec[] => {
    let pagado = 0, cobrado = 0;
    for (const m of filtered) {
      if (m.isOutgoing) pagado += m.grossAmount ?? 0;
      else cobrado += m.grossAmount ?? 0;
    }
    return [
      { label: "Pagado (período)", value: pagado, icon: <ArrowUpRight className="h-4 w-4 text-red-500" />, color: "text-red-600" },
      { label: "Cobrado (período)", value: cobrado, icon: <ArrowDownLeft className="h-4 w-4 text-green-600" />, color: "text-green-700" },
    ];
  };

  // ── render helpers de filas ─────────────────────────────────────────────────────

  const mpRenderName = (m: MpMovement) => {
    const identified = m.identified ?? false;
    const subtitle = m.description || m.type;
    if (identified) {
      return (
        <div className="flex items-center gap-1.5 flex-wrap">
          <ContactTypeIcon type={m.contactType ?? "otro"} />
          <p className="font-semibold text-sm leading-tight">{m.displayName}</p>
          <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
            {CONTACT_TYPE_LABELS[m.contactType ?? "otro"] ?? m.contactType}
          </span>
          <button onClick={() => openEditContactDialog(m)} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors" title="Editar contacto">
            <Pencil className="h-3 w-3" />
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <p className="font-semibold text-sm leading-tight text-foreground">{m.displayName || subtitle}</p>
        {fmtRawId(m.rawIdentifier) && (
          <span className="text-xs text-muted-foreground font-mono">{fmtRawId(m.rawIdentifier)}</span>
        )}
        <button onClick={() => openIdentifyDialog(m)} className="text-[11px] text-blue-600 hover:text-blue-800 font-medium border border-blue-200 rounded px-1.5 py-0.5 leading-tight hover:bg-blue-50 transition-colors flex-shrink-0">
          Identificar
        </button>
      </div>
    );
  };

  const mpRenderRowExtra = (m: MpMovement) => (
    <>
      {m.source === "xlsx" && (
        <span className="text-[10px] bg-orange-100 text-orange-700 rounded px-1.5 py-0.5 font-medium">Reporte</span>
      )}
      {!m.isOutgoing && m.contactType === "cliente" && m.entityId && (
        (m.bankPaymentLinks && m.bankPaymentLinks.length > 0) ? (
          <span className="text-[10px] bg-green-100 text-green-700 rounded px-1.5 py-0.5 font-medium">✓ {fmtBankLinks(m.bankPaymentLinks)}</span>
        ) : (
          <button
            onClick={() => { setApplyPayMov(m); setApplyAmounts(new Map()); setApplyPayOpen(true); }}
            className="text-[11px] text-green-700 hover:text-green-900 font-medium border border-green-300 rounded px-1.5 py-0.5 leading-tight hover:bg-green-50 transition-colors flex-shrink-0"
          >
            Aplicar pago
          </button>
        )
      )}
    </>
  );

  const galiciaRenderName = (m: MpMovement) => (
    <div className="flex items-center gap-2 flex-wrap">
      <p className="font-semibold text-sm leading-tight text-foreground">{m.displayName || m.description}</p>
    </div>
  );

  // Abre el diálogo "Aplicar pago" para un cobro de Galicia, con el cliente (sugerido o elegido)
  const openGaliciaApply = (m: MpMovement, customerId: number, customerName?: string | null) => {
    setApplyPayMov({ ...m, entityId: customerId, displayName: customerName ?? m.displayName, source: "galicia" });
    setApplyAmounts(new Map());
    setApplyPayError(null);
    setApplyPayOpen(true);
  };

  const galiciaRenderRowExtra = (m: MpMovement) => {
    const esCobroPendiente = m.asignacionCc === "pendiente";
    return (
      <>
        {m.comprobante && (
          <span className="text-[10px] text-muted-foreground font-mono">N.º {m.comprobante}</span>
        )}
        {m.yaContabilizado && (
          <span className="text-[10px] bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 font-medium">ya contabilizado</span>
        )}
        {/* Asignación de cobros: cobro pendiente de asignar a factura/CC */}
        {esCobroPendiente && (
          (m.bankPaymentLinks && m.bankPaymentLinks.length > 0) ? (
            <span className="text-[10px] bg-green-100 text-green-700 rounded px-1.5 py-0.5 font-medium">✓ {fmtBankLinks(m.bankPaymentLinks)}</span>
          ) : m.suggestedCustomerId ? (
            <>
              <span className="text-[10px] text-muted-foreground">Sugerido: <b className="text-foreground">{m.suggestedCustomerName}</b> · por CUIT {m.suggestedCuit}</span>
              <button
                onClick={() => openGaliciaApply(m, m.suggestedCustomerId!, m.suggestedCustomerName)}
                className="text-[11px] text-green-700 hover:text-green-900 font-medium border border-green-300 rounded px-1.5 py-0.5 leading-tight hover:bg-green-50 transition-colors flex-shrink-0"
              >Aplicar pago</button>
            </>
          ) : (
            <button
              onClick={() => { setGaliciaPickMov(m); setGaliciaPickSearch(""); setGaliciaPickOpen(true); }}
              className="text-[11px] text-blue-600 hover:text-blue-800 font-medium border border-blue-200 rounded px-1.5 py-0.5 leading-tight hover:bg-blue-50 transition-colors flex-shrink-0"
            >Identificar cliente</button>
          )
        )}
        {/* Asignación de pagos a proveedor: aplicar a la CC del proveedor */}
        {m.yaAplicadoProv && (
          <span className="text-[10px] bg-green-100 text-green-700 rounded px-1.5 py-0.5 font-medium">✓ aplicado a CC</span>
        )}
        {m.esPagoProvPend && (
          <button
            onClick={() => openProvApply(m)}
            className="text-[11px] text-purple-700 hover:text-purple-900 font-medium border border-purple-300 rounded px-1.5 py-0.5 leading-tight hover:bg-purple-50 transition-colors flex-shrink-0"
          >{m.suggestedSupplierName ? `Aplicar a ${m.suggestedSupplierName}` : "Aplicar pago"}</button>
        )}
      </>
    );
  };

  // ── secciones (reutilizadas en split y tabs) ───────────────────────────────────

  const mpSection = (
    <BankSection
      source="mp"
      title="Mercado Pago"
      headerAction={
        <Button variant="outline" size="sm" onClick={() => syncReportMut.mutate()} disabled={syncReportMut.isPending}>
          <RefreshCw className={`h-4 w-4 mr-1 ${syncReportMut.isPending ? "animate-spin" : ""}`} />
          {syncReportMut.isPending ? "Sincronizando…" : "Sincronizar"}
        </Button>
      }
      banner={syncResult && (
        <div className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground break-all">{syncResult}</div>
      )}
      queryKeyBase="/api/mp/movements"
      fetchMovements={fetchMpMovements}
      errorLabel="Mercado Pago"
      computeCards={mpCards}
      extraCardsLeft={!balanceLoading && !balance?.unavailable && balance?.available_balance != null && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Saldo disponible</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{fmt(balance.available_balance ?? 0)}</p></CardContent>
        </Card>
      )}
      showStatusFilter
      categories={categories}
      onAddCategory={() => { setPendingMovId(null); setNewCatOpen(true); }}
      onEditCategory={(cat) => { setEditCat(cat); setEditCatName(cat.name); setEditCatOpen(true); }}
      onCategorize={handleCategorizeMp}
      onAddNewForMov={handleAddNew}
      renderName={mpRenderName}
      renderRowExtra={mpRenderRowExtra}
    />
  );

  const galiciaSection = (
    <BankSection
      source="galicia"
      title="Galicia"
      headerAction={
        <>
          <input
            ref={galiciaFileRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={onGaliciaFilePicked}
          />
          <Button variant="outline" size="sm" onClick={() => galiciaFileRef.current?.click()} disabled={galiciaUploadMut.isPending}>
            <Upload className={`h-4 w-4 mr-1 ${galiciaUploadMut.isPending ? "animate-pulse" : ""}`} />
            {galiciaUploadMut.isPending ? "Subiendo…" : "Subir extracto"}
          </Button>
        </>
      }
      banner={galiciaUpload && (
        galiciaUpload.kind === "ok" ? (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2.5 text-xs space-y-1">
            <p className="font-medium text-green-800">✓ Extracto procesado ({galiciaUpload.total} movimientos leídos)</p>
            <ul className="text-green-900/80 space-y-0.5">
              <li><b>{galiciaUpload.nuevos}</b> nuevos cargados</li>
              <li><b>{galiciaUpload.duplicados}</b> ya existían — ignorados por el dedup (es correcto, no se perdió nada)</li>
              <li className={galiciaUpload.sinCategoria > 0 ? "text-amber-700" : ""}>
                <b>{galiciaUpload.sinCategoria}</b> sin categoría{galiciaUpload.sinCategoria > 0 ? " — categorizalos desde la lista (filtro \"Sin categorizar\")" : ""}
              </li>
              <li>
                {galiciaUpload.chequesConciliados > 0 ? (
                  <><b>{galiciaUpload.chequesConciliados}</b> cheque{galiciaUpload.chequesConciliados !== 1 ? "s" : ""} conciliado{galiciaUpload.chequesConciliados !== 1 ? "s" : ""} — cheques emitidos bajó ${galiciaUpload.chequesBaja.toLocaleString("es-AR")} (queda ${galiciaUpload.chequesEmitidosDespues.toLocaleString("es-AR")})</>
                ) : (
                  <span className="text-green-900/60">0 cheques nuevos para conciliar (los ya cobrados no se re-tocan)</span>
                )}
              </li>
            </ul>
            <button onClick={() => setGaliciaUpload(null)} className="text-green-700/60 hover:text-green-700 underline">cerrar</button>
          </div>
        ) : galiciaUpload.kind === "empty" ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            No se reconoció ningún movimiento. ¿Es un extracto de Galicia? (CSV con columnas Fecha, Débitos, Créditos, Concepto…).
            <button onClick={() => setGaliciaUpload(null)} className="ml-2 underline">cerrar</button>
          </div>
        ) : (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            Error al subir: {galiciaUpload.msg}
            <button onClick={() => setGaliciaUpload(null)} className="ml-2 underline">cerrar</button>
          </div>
        )
      )}
      queryKeyBase="/api/galicia/movements"
      fetchMovements={({ from, to }) => fetchGaliciaMovements({ from, to })}
      errorLabel="Galicia"
      computeCards={galiciaCards}
      categories={categories}
      onAddCategory={() => { setPendingMovId(null); setNewCatOpen(true); }}
      onEditCategory={(cat) => { setEditCat(cat); setEditCatName(cat.name); setEditCatOpen(true); }}
      onCategorize={handleCategorizeGalicia}
      onAddNewForMov={() => { setPendingMovId(null); setNewCatOpen(true); }}
      renderName={galiciaRenderName}
      renderRowExtra={galiciaRenderRowExtra}
    />
  );

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Bancos</h1>
          <Button
            variant="outline" size="sm"
            onClick={() => setViewLayout(v => (v === "split" ? "tabs" : "split"))}
            title={viewLayout === "split" ? "Ver en pestañas" : "Ver dividido"}
          >
            {viewLayout === "split" ? <><Rows2 className="h-4 w-4 mr-1" /> Pestañas</> : <><Columns2 className="h-4 w-4 mr-1" /> Dividido</>}
          </Button>
        </div>

        {viewLayout === "split" ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {mpSection}
            {galiciaSection}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="inline-flex rounded-lg border bg-muted/40 p-1">
              <button
                onClick={() => setActiveTab("mp")}
                className={`px-4 py-1.5 text-sm rounded-md transition-colors ${activeTab === "mp" ? "bg-white shadow text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >Mercado Pago</button>
              <button
                onClick={() => setActiveTab("galicia")}
                className={`px-4 py-1.5 text-sm rounded-md transition-colors ${activeTab === "galicia" ? "bg-white shadow text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >Galicia</button>
            </div>
            {activeTab === "mp" ? mpSection : galiciaSection}
          </div>
        )}
      </div>

      {/* ── Dialog nueva categoría ── */}
      <Dialog open={newCatOpen} onOpenChange={v => { setNewCatOpen(v); if (!v) { setNewCatName(""); setNewCatAfecta(true); setPendingMovId(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nueva categoría</DialogTitle></DialogHeader>
          <Input
            value={newCatName}
            onChange={e => setNewCatName(e.target.value)}
            placeholder="Ej: Retiro propio"
            onKeyDown={e => { if (e.key === "Enter" && newCatName.trim()) createCategoryMut.mutate({ name: newCatName.trim(), afectaEgresos: newCatAfecta }); }}
            autoFocus
          />
          {/* B6: ¿afecta el gráfico de egresos? */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">¿Afecta el gráfico de egresos?</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNewCatAfecta(true)}
                className={`flex-1 h-9 text-sm rounded-md border transition-colors ${newCatAfecta ? "border-foreground/30 bg-muted font-medium text-foreground" : "border-input bg-background text-muted-foreground hover:text-foreground"}`}
              >Sí (es un gasto)</button>
              <button
                type="button"
                onClick={() => setNewCatAfecta(false)}
                className={`flex-1 h-9 text-sm rounded-md border transition-colors ${!newCatAfecta ? "border-foreground/30 bg-muted font-medium text-foreground" : "border-input bg-background text-muted-foreground hover:text-foreground"}`}
              >No (interno / no-gasto)</button>
            </div>
            <p className="text-[10px] text-muted-foreground">"No" para movimientos que no son gasto operativo real (proveedores/mercadería, pases internos, retiros, etc.).</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCatOpen(false)}>Cancelar</Button>
            <Button onClick={() => { if (newCatName.trim()) createCategoryMut.mutate({ name: newCatName.trim(), afectaEgresos: newCatAfecta }); }} disabled={!newCatName.trim() || createCategoryMut.isPending}>
              {createCategoryMut.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog editar categoría ── */}
      <Dialog open={editCatOpen} onOpenChange={v => { setEditCatOpen(v); if (!v) { setEditCat(null); setEditCatName(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Editar categoría</DialogTitle></DialogHeader>
          <Input
            value={editCatName}
            onChange={e => setEditCatName(e.target.value)}
            placeholder="Nombre de la categoría"
            onKeyDown={e => { if (e.key === "Enter" && editCatName.trim() && editCat) updateCategoryMut.mutate({ id: editCat.id, name: editCatName.trim() }); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCatOpen(false)}>Cancelar</Button>
            <Button onClick={() => { if (editCatName.trim() && editCat) updateCategoryMut.mutate({ id: editCat.id, name: editCatName.trim() }); }} disabled={!editCatName.trim() || updateCategoryMut.isPending}>
              {updateCategoryMut.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog identificar / editar contacto ── */}
      <Dialog open={identifyOpen} onOpenChange={v => { if (!v) closeIdentifyDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{idEditMode ? "Editar contacto" : "Identificar contacto"}</DialogTitle></DialogHeader>

          <div className="space-y-4 py-1">
            {!idEditMode && (() => {
              const raw = identifyMov?.rawIdentifier ?? null;
              const isBankTransfer = raw?.startsWith("bank_transfer:");
              const isUsable = raw && !isBankTransfer && raw !== OWN_EMAIL;

              if (isBankTransfer) {
                return (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800 space-y-1">
                    <p className="font-medium">Transferencia desde banco externo</p>
                    <p>MP no expone quién la envió. Podés guardarla manualmente con un nombre, pero no se vinculará automáticamente a futuras transferencias del mismo pagador.</p>
                  </div>
                );
              }

              if (isUsable) {
                const label = raw!.startsWith("mp:")
                  ? "Identificador único (ID Mercado Pago)"
                  : raw!.includes("@")
                    ? "Identificador único (email MP)"
                    : /^\d{15,}$/.test(raw!)
                      ? "Identificador único (CBU/CVU)"
                      : "Identificador";
                return (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{label}</label>
                    <p className="text-xs text-muted-foreground font-mono bg-muted rounded px-2 py-1.5 break-all">{raw}</p>
                    <p className="text-[11px] text-muted-foreground">Todas las transferencias desde este identificador quedarán vinculadas a este contacto.</p>
                  </div>
                );
              }

              return (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Identificador (CBU, email o alias)</label>
                  <Input
                    value={idIdentifier}
                    onChange={e => { setIdIdentifier(e.target.value); setIdError(null); }}
                    placeholder="Ej: 0000003100099999999999 · juan@email.com"
                    autoFocus
                  />
                </div>
              );
            })()}

            {!idEditMode && allBankContacts.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Contacto existente (opcional)</label>
                <Input value={contactPickSearch} onChange={e => setContactPickSearch(e.target.value)} placeholder="Buscar contacto guardado..." />
                {contactPickSearch.trim() && (() => {
                  const q = contactPickSearch.toLowerCase();
                  const matches = allBankContacts.filter(c => c.displayName.toLowerCase().includes(q));
                  if (matches.length === 0) return null;
                  return (
                    <div className="border rounded-md overflow-hidden max-h-36 overflow-y-auto">
                      {matches.slice(0, 6).map(c => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setIdName(c.displayName); setIdType(c.type); setIdEntityId(c.entityId ?? null);
                            if (c.entityId) setEntitySearch(c.displayName);
                            setContactPickSearch("");
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors border-b last:border-b-0 flex items-center justify-between"
                        >
                          <span>{c.displayName}</span>
                          <span className="text-[10px] text-muted-foreground capitalize ml-2">{c.type}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nombre a mostrar</label>
              <Input value={idName} onChange={e => setIdName(e.target.value)} placeholder="Ej: Juan García" autoFocus />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tipo</label>
              <Select value={idType} onValueChange={v => { setIdType(v); setIdEntityId(null); setEntitySearch(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cliente">Cliente</SelectItem>
                  <SelectItem value="proveedor">Proveedor</SelectItem>
                  <SelectItem value="banco">Banco</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(idType === "cliente" || idType === "proveedor") && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Vincular a {idType === "cliente" ? "cliente" : "proveedor"} (opcional)</label>
                <Input value={entitySearch} onChange={e => { setEntitySearch(e.target.value); setIdEntityId(null); }} placeholder="Buscar por nombre..." />
                {entitySearch.trim() && filteredEntities.length > 0 && idEntityId == null && (
                  <div className="border rounded-md overflow-hidden max-h-40 overflow-y-auto">
                    {filteredEntities.slice(0, 8).map(e => (
                      <button key={e.id} onClick={() => { setIdEntityId(e.id); setEntitySearch(e.name); }} className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors border-b last:border-b-0">
                        {e.name}
                      </button>
                    ))}
                  </div>
                )}
                {idEntityId != null && (<p className="text-xs text-green-600 font-medium">✓ Vinculado correctamente</p>)}
              </div>
            )}
          </div>

          {idError && (<p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{idError}</p>)}

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            {idEditMode && identifyMov?.contactId && (
              <Button variant="destructive" onClick={() => { if (identifyMov.contactId) deleteContactMut.mutate(identifyMov.contactId); }} disabled={deleteContactMut.isPending} className="sm:mr-auto">
                {deleteContactMut.isPending ? "Eliminando..." : "Eliminar contacto"}
              </Button>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={closeIdentifyDialog}>Cancelar</Button>
              <Button
                onClick={handleSaveContact}
                disabled={!idName.trim() || (!idEditMode && !idIdentifier.trim() && !identifyMov?.rawIdentifier) || createContactMut.isPending || updateContactMut.isPending}
              >
                {(createContactMut.isPending || updateContactMut.isPending) ? "Guardando..." : idEditMode ? "Actualizar" : "Guardar"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog aplicar pago ── */}
      {applyPayOpen && applyPayMov && (() => {
        const gross = applyPayMov.grossAmount ?? Math.abs(parseFloat(String(applyPayMov.total ?? applyPayMov.amount ?? 0)));
        const totalAssigned = [...applyAmounts.values()].reduce((s, v) => s + (parseFloat(v) || 0), 0);
        const remaining = gross - totalAssigned;
        const canConfirm = applyAmounts.size > 0 && totalAssigned > 0 && totalAssigned <= gross + 0.01;

        const toggleOrder = (orderId: number, pendingAmt: number) => {
          const next = new Map(applyAmounts);
          if (next.has(orderId)) { next.delete(orderId); }
          else {
            const alreadyAssigned = [...next.values()].reduce((s, v) => s + (parseFloat(v) || 0), 0);
            const rem = gross - alreadyAssigned;
            next.set(orderId, Math.min(pendingAmt, Math.max(0, rem)).toFixed(2));
          }
          setApplyAmounts(next);
        };

        const handleConfirm = () => {
          setApplyPayError(null);
          const movId = applyPayMov.id;
          const links = [...applyAmounts.entries()].map(([pedidoId, monto]) => ({ pedidoId, montoAplicado: parseFloat(monto) }));
          const date = (applyPayMov.date_created ?? new Date().toISOString()).slice(0, 10);
          // Galicia: aplica a CC + marca asignado + carga CUIT al cliente si no tenía
          if (applyPayMov.source === "galicia") {
            galiciaApplyMut.mutate({
              movementId: String(movId), customerId: applyPayMov.entityId!, date, links,
              galiciaId: String(movId), loadCuit: applyPayMov.suggestedCuit ?? undefined,
            });
            return;
          }
          applyPayMut.mutate(
            { movementId: String(movId), customerId: applyPayMov.entityId!, date, links },
            {
              onSuccess: (result: { paymentId: number; bankLinks: BankPaymentLink[] }) => {
                qc.setQueriesData<MpMovementsResponse>(
                  { queryKey: ["/api/mp/movements"] },
                  (old) => {
                    if (!old?.results) return old;
                    return { ...old, results: old.results.map(m => String(m.id) === String(movId) ? { ...m, bankPaymentLinks: result.bankLinks } : m) };
                  }
                );
                setApplyPayOpen(false); setApplyPayMov(null); setApplyAmounts(new Map()); setApplyPayError(null);
              },
            }
          );
        };

        return (
          <Dialog open={applyPayOpen} onOpenChange={v => { if (!v) { setApplyPayOpen(false); setApplyPayMov(null); setApplyAmounts(new Map()); } }}>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Aplicar pago</DialogTitle></DialogHeader>

              <div className="space-y-4">
                <div className="bg-muted/50 rounded-lg px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm">{applyPayMov.displayName}</p>
                    <p className="text-xs text-muted-foreground">{fmtDateLong((applyPayMov.date_created ?? "").slice(0, 10))}</p>
                  </div>
                  <p className="text-lg font-bold text-green-700">+{fmt(gross)}</p>
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Pedidos con saldo pendiente</p>
                  {pendingOrdersLoading ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">Cargando...</p>
                  ) : pendingOrders.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No hay pedidos con saldo pendiente.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                      {pendingOrders.map(order => {
                        const checked = applyAmounts.has(order.id);
                        const pendingAmt = parseFloat(order.pendingAmount);
                        return (
                          <div
                            key={order.id}
                            onClick={() => toggleOrder(order.id, pendingAmt)}
                            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${checked ? "border-green-400 bg-green-50" : "border-input hover:bg-muted/40"}`}
                          >
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${checked ? "border-green-500 bg-green-500" : "border-muted-foreground/40"}`}>
                              {checked && <span className="text-white text-[9px] leading-none">✓</span>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {order.remitoNum && (<span className="text-sm font-medium">Remito {order.remitoNum}</span>)}
                                {order.invoiceNumber && (<span className="text-xs text-muted-foreground bg-muted rounded px-1 py-0.5">{order.invoiceNumber}</span>)}
                                {!order.remitoNum && !order.invoiceNumber && (<span className="text-sm text-muted-foreground">Sin remito</span>)}
                              </div>
                              <p className="text-xs text-muted-foreground">{fmtDateLong(order.orderDate)}</p>
                            </div>
                            <p className={`text-sm font-semibold flex-shrink-0 ${checked ? "text-green-700" : "text-orange-700"}`}>{fmt(pendingAmt)}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {applyAmounts.size > 0 && (
                  <div className="border-t pt-3 flex items-center justify-between text-sm">
                    <div className="flex gap-4">
                      <span className="text-muted-foreground">Asignado: <span className="font-semibold text-foreground">{fmt(totalAssigned)}</span></span>
                      <span className={`${remaining < -0.01 ? "text-destructive" : "text-muted-foreground"}`}>
                        Restante: <span className="font-semibold">{fmt(remaining)}</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {applyPayError && (<p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{applyPayError}</p>)}

              {/* Galicia: aviso de que esto baja la CC del cliente */}
              {applyPayMov.source === "galicia" && (
                <p className="text-xs text-muted-foreground bg-muted/40 border rounded px-3 py-2">
                  Al confirmar se registra el cobro de <b>{applyPayMov.displayName}</b> y <b>baja su cuenta corriente</b> por el monto asignado. Si ya lo registraste a mano, usá "Pago ya registrado" (no toca la CC).
                </p>
              )}

              <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                {applyPayMov.source === "galicia" && (
                  <Button
                    variant="outline"
                    className="border-amber-300 text-amber-700 hover:bg-amber-50 sm:mr-auto"
                    disabled={galiciaYaRegistradoMut.isPending}
                    onClick={() => galiciaYaRegistradoMut.mutate(String(applyPayMov.id))}
                  >
                    {galiciaYaRegistradoMut.isPending ? "Marcando…" : "Pago ya registrado (no toca CC)"}
                  </Button>
                )}
                <div className="flex gap-2 sm:ml-auto">
                  <Button variant="outline" onClick={() => { setApplyPayOpen(false); setApplyPayMov(null); setApplyAmounts(new Map()); setApplyPayError(null); }}>Cancelar</Button>
                  <Button onClick={handleConfirm} disabled={!canConfirm || applyPayMut.isPending || galiciaApplyMut.isPending}>
                    {(applyPayMut.isPending || galiciaApplyMut.isPending) ? "Aplicando..." : applyPayMov.source === "galicia" ? "Aplicar a CC" : "Confirmar"}
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* ── Dialog: identificar cliente de un cobro de Galicia (Paso 3, manual) ── */}
      <Dialog open={galiciaPickOpen} onOpenChange={v => { if (!v) { setGaliciaPickOpen(false); setGaliciaPickMov(null); setGaliciaPickSearch(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>¿Qué cliente es este cobro?</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            {galiciaPickMov && (
              <div className="bg-muted/50 rounded-lg px-3 py-2 text-xs">
                <p className="font-mono text-muted-foreground">{galiciaPickMov.leyendas || galiciaPickMov.displayName}</p>
                <p className="font-semibold text-green-700">+{fmt(galiciaPickMov.grossAmount ?? 0)}</p>
              </div>
            )}
            <Input value={galiciaPickSearch} onChange={e => setGaliciaPickSearch(e.target.value)} placeholder="Buscar cliente por nombre…" autoFocus />
            <div className="border rounded-md overflow-hidden max-h-56 overflow-y-auto">
              {customers
                .filter(c => !galiciaPickSearch.trim() || c.name.toLowerCase().includes(galiciaPickSearch.toLowerCase()))
                .slice(0, 30)
                .map(c => (
                  <button
                    key={c.id}
                    onClick={() => {
                      const mov = galiciaPickMov;
                      setGaliciaPickOpen(false); setGaliciaPickMov(null); setGaliciaPickSearch("");
                      if (mov) openGaliciaApply(mov, c.id, c.name);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors border-b last:border-b-0"
                  >{c.name}</button>
                ))}
              {customers.length === 0 && <p className="text-xs text-muted-foreground px-3 py-2">Cargando clientes…</p>}
            </div>
            <p className="text-[10px] text-muted-foreground">Al elegir cliente se abre "Aplicar pago" con sus pedidos pendientes. (Cargar el CUIT del cliente para auto-match futuro queda para el paso 4.)</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setGaliciaPickOpen(false); setGaliciaPickMov(null); setGaliciaPickSearch(""); }}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: aplicar pago a la CC de un PROVEEDOR ── */}
      <Dialog open={provApplyOpen} onOpenChange={v => { if (!v) { setProvApplyOpen(false); setProvApplyMov(null); setProvSupplierId(null); setProvSearch(""); setProvError(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Aplicar pago a proveedor</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            {provApplyMov && (
              <div className="bg-muted/50 rounded-lg px-3 py-2 text-xs">
                <p className="font-mono text-muted-foreground">{provApplyMov.leyendas || provApplyMov.displayName}</p>
                <p className="font-semibold text-red-700">−{fmt(provApplyMov.grossAmount ?? 0)}</p>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Proveedor</label>
              <Input value={provSearch} onChange={e => { setProvSearch(e.target.value); setProvSupplierId(null); }} placeholder="Buscar proveedor…" />
              {provSupplierId == null && provSearch.trim() && (
                <div className="border rounded-md overflow-hidden max-h-44 overflow-y-auto">
                  {suppliers.filter(s => s.name.toLowerCase().includes(provSearch.toLowerCase())).slice(0, 20).map(s => (
                    <button key={s.id} onClick={() => { setProvSupplierId(s.id); setProvSearch(s.name); }} className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors border-b last:border-b-0">{s.name}</button>
                  ))}
                </div>
              )}
            </div>
            {/* Preview del saldo CC (dry-run) */}
            {provSupplierId != null && provPreview && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                CC de <b>{provPreview.supplierName?.trim()}</b>: <b>{fmt(provPreview.saldoAntes)}</b> → <b className="text-green-700">{fmt(provPreview.saldoDespues)}</b> (baja {fmt(provApplyMov?.grossAmount ?? 0)})
              </div>
            )}
            {provError && <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">{provError}</p>}
            <p className="text-[10px] text-muted-foreground">Aplicar crea un pago al proveedor y baja su CC. Si ya lo registraste a mano (o es un cheque ya cargado), usá "Pago ya registrado".</p>
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50 sm:mr-auto" disabled={provYaRegistradoMut.isPending} onClick={() => provApplyMov && provYaRegistradoMut.mutate(String(provApplyMov.id))}>
              {provYaRegistradoMut.isPending ? "Marcando…" : "Pago ya registrado"}
            </Button>
            <div className="flex gap-2 sm:ml-auto">
              <Button variant="outline" onClick={() => { setProvApplyOpen(false); setProvApplyMov(null); setProvSupplierId(null); setProvSearch(""); setProvError(null); }}>Cancelar</Button>
              <Button
                disabled={provSupplierId == null || provApplyMut.isPending}
                onClick={() => provApplyMov && provSupplierId != null && provApplyMut.mutate({
                  movementId: String(provApplyMov.id), supplierId: provSupplierId, amount: provApplyMov.grossAmount ?? 0,
                  date: (provApplyMov.date_created ?? new Date().toISOString()).slice(0, 10), method: "TRANSFERENCIA", galiciaId: String(provApplyMov.id),
                })}
              >{provApplyMut.isPending ? "Aplicando…" : "Aplicar a CC"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: elegir socio para un movimiento categorizado como Retiro ── */}
      <Dialog open={retiroPrompt != null} onOpenChange={v => { if (!v) { setRetiroPrompt(null); setRetiroSocioId(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>¿Quién retira?</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground">Elegí el socio para que el retiro sume en su card de "Retiros de socios".</p>
            <Select value={retiroSocioId != null ? String(retiroSocioId) : ""} onValueChange={v => setRetiroSocioId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Elegí un socio" /></SelectTrigger>
              <SelectContent>
                {socios.filter(s => s.activo).map(s => (<SelectItem key={s.id} value={String(s.id)}>{s.nombre}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRetiroPrompt(null); setRetiroSocioId(null); }}>Cancelar</Button>
            <Button
              disabled={retiroSocioId == null || setCategoryMut.isPending || galiciaSetCategoryMut.isPending}
              onClick={() => {
                if (retiroPrompt == null || retiroSocioId == null) return;
                if (retiroPrompt.source === "mp") {
                  const { source, ...payload } = retiroPrompt;
                  setCategoryMut.mutate({ ...payload, socioId: retiroSocioId });
                } else {
                  galiciaSetCategoryMut.mutate({ id: retiroPrompt.id, categoryId: retiroPrompt.categoryId, socioId: retiroSocioId });
                }
                setRetiroPrompt(null); setRetiroSocioId(null);
              }}
            >
              Guardar retiro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
