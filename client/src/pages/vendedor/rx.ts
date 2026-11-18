// Estilo compartido de las pantallas del vendedor (17/11/2026): el mismo sistema visual que las pantallas
// rediseñadas del admin (Clientes, Pedidos, Cuentas Corrientes): fondo crema, Inter + Bricolage Grotesque,
// verde oliva, tarjetas blancas redondeadas, chips. Solo presentación. Cada página lo inyecta con <style>.

export const VX_CSS = `
.vx{background:#f4f4f1;min-height:100%;padding:30px 24px 56px;font-family:'Inter',system-ui,sans-serif;color:#1e2420;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;}
.vx *{box-sizing:border-box;}
.vx.vx-embed{padding:0;background:transparent;min-height:0;}
.vx .animate-pulse{background:#e6e6e1;}
.vx-wrap{max-width:1180px;margin:0 auto;}
.vx-top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:22px;}
.vx-title{font-family:'Bricolage Grotesque','Inter',sans-serif;font-size:27px;font-weight:700;margin:0;letter-spacing:-.02em;}
.vx-subtitle{font-size:13.5px;color:#8b8f88;margin-top:5px;}
.vx-num{font-family:'Bricolage Grotesque','Inter',sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.vx-mono{font-family:ui-monospace,Menlo,Consolas,monospace;}
.vx-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.vx-seg{display:inline-flex;background:#eeeeea;border-radius:10px;padding:3px;gap:2px;}
.vx-seg button{border:none;background:transparent;font-family:'Inter';font-size:13px;font-weight:600;color:#6f7469;padding:7px 15px;border-radius:8px;cursor:pointer;}
.vx-seg button.on{background:#6b8a2a;color:#fff;box-shadow:0 1px 2px rgba(0,0,0,.12);}
.vx-sel{position:relative;display:inline-flex;}
.vx-sel select{appearance:none;-webkit-appearance:none;background:#fff;border:1px solid #ecece8;border-radius:10px;padding:9px 34px 9px 14px;font-family:'Inter';font-size:13.5px;font-weight:500;color:#1e2420;cursor:pointer;min-width:96px;}
.vx-sel select:focus{outline:none;border-color:#5f8020;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.vx-sel svg{position:absolute;right:12px;top:50%;transform:translateY(-50%);pointer-events:none;color:#8b8f88;}
.vx-input{background:#fff;border:1px solid #ecece8;border-radius:10px;padding:9px 13px;font-family:'Inter';font-size:13.5px;color:#1e2420;}
.vx-input:focus{outline:none;border-color:#5f8020;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.vx-btn{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #ecece8;border-radius:10px;padding:9px 15px;font-family:'Inter';font-size:13.5px;font-weight:500;color:#1e2420;cursor:pointer;text-decoration:none;white-space:nowrap;}
.vx-btn:hover:not(:disabled){border-color:#cfcfc9;background:#f6f6f2;}
.vx-btn:disabled{opacity:.5;cursor:default;}
.vx-btn.primary{background:#6b8a2a;color:#fff;border:none;font-weight:600;}
.vx-btn.primary:hover:not(:disabled){background:#5f7d24;}
.vx-btn.wa{background:#1f7a3a;color:#fff;border:none;font-weight:600;padding:6px 11px;font-size:12.5px;border-radius:9px;}
.vx-btn.wa:hover:not(:disabled){background:#176330;}
.vx-btn.ghost{border:none;background:transparent;color:#8b8f88;padding:6px 8px;}
.vx-btn.ghost:hover:not(:disabled){background:#eeeeea;color:#1e2420;}
.vx-mes{display:inline-flex;align-items:center;background:#fff;border:1px solid #ecece8;border-radius:11px;overflow:hidden;}
.vx-mes button{border:none;background:transparent;width:38px;height:40px;cursor:pointer;color:#8b8f88;font-size:18px;display:flex;align-items:center;justify-content:center;}
.vx-mes button:hover{background:#f6f6f2;color:#1e2420;}
.vx-mes span{font-weight:600;font-size:14px;padding:0 10px;min-width:150px;text-align:center;}
.vx-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px;}
.vx-kpis.c4{grid-template-columns:repeat(4,1fr);}
.vx-kpi{background:#fff;border:1px solid #ecece8;border-radius:16px;padding:18px 20px;min-width:0;}
.vx-kpi.main{background:#eef3e3;border-color:#dfe8c9;}
.vx-kpi.warn{background:#fdf4f1;border-color:#f3d9d0;}
.vx-kpi .lab{font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9a9e96;}
.vx-kpi .val{font-family:'Bricolage Grotesque','Inter',sans-serif;font-size:28px;font-weight:700;line-height:1.05;margin-top:10px;letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis;}
.vx-kpi.main .val{color:#5f8020;}
.vx-kpi.warn .val{color:#b0553f;}
.vx-kpi .note{font-size:12.5px;color:#8b8f88;margin-top:8px;}
.vx-card{background:#fff;border:1px solid #ecece8;border-radius:16px;overflow:hidden;margin-bottom:18px;}
.vx-card.soft{background:#fbfaf7;}
.vx-chead{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:18px 22px 12px;flex-wrap:wrap;}
.vx-chead .t{font-family:'Bricolage Grotesque','Inter',sans-serif;font-size:16px;font-weight:700;letter-spacing:-.01em;display:inline-flex;align-items:center;gap:8px;}
.vx-chead .t svg{color:#5f8020;}
.vx-chead .n{font-size:12.5px;color:#8b8f88;}
.vx-cbody{padding:0 22px 18px;}
.vx-tblwrap{overflow-x:auto;}
table.vx-tbl{width:100%;border-collapse:collapse;}
.vx-tbl th{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#9a9e96;text-align:right;padding:0 22px 11px;border-bottom:1px solid #eeeeea;white-space:nowrap;}
.vx-tbl th.l,.vx-tbl td.l{text-align:left;}
.vx-tbl td{padding:13px 22px;border-bottom:1px solid #f5f5f2;font-size:14px;text-align:right;white-space:nowrap;}
.vx-tbl tbody tr.click{cursor:pointer;}
.vx-tbl tbody tr.click:hover td{background:#f8f8f5;}
.vx-tbl tr.sub td{background:#fbfaf7;font-size:13px;padding:9px 22px;color:#4b5048;border-bottom:1px solid #f1f1ec;}
.vx-tbl tr.sub td.l{padding-left:46px;}
.vx-tbl tfoot td{border-top:1.5px solid #eaeae6;border-bottom:none;font-weight:700;padding-top:15px;}
.vx-tbl tfoot td.l{font-family:'Bricolage Grotesque','Inter',sans-serif;text-transform:uppercase;}
.vx-tbl td.cli{font-weight:600;}
.vx-tbl td.pos{color:#5f8020;font-weight:700;}
.vx-tbl td.neg{color:#b0553f;font-weight:700;}
.vx-tbl td.mut{color:#8b8f88;}
.vx-tbl td.dash{color:#c8ccc3;}
.vx-tbl td a{color:inherit;text-decoration:none;}
.vx-tbl td a:hover{text-decoration:underline;}
.vx-chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:20px;white-space:nowrap;}
.vx-chip i{width:7px;height:7px;border-radius:50%;display:inline-block;}
.vx-chip.ok{background:#eef3e3;color:#5f8020;} .vx-chip.ok i{background:#5f8020;}
.vx-chip.par{background:#f9f1de;color:#c08a1e;} .vx-chip.par i{background:#c08a1e;}
.vx-chip.no{background:#f1f1ec;color:#8b8f88;} .vx-chip.no i{background:#b3b6ae;}
.vx-chip.bad{background:#fdf4f1;color:#c05e42;} .vx-chip.bad i{background:#c05e42;}
.vx-chip.iva{background:#e9eff7;color:#3a67a3;}
.vx-chip.info{background:#e9eff7;color:#3a67a3;}
.vx-chip.gris{background:#f1f1ec;color:#8b8f88;}
.vx-chip.line{background:transparent;color:#9a9e96;border:1px solid #e2e2dd;}
.vx-search{position:relative;max-width:620px;margin-bottom:22px;}
.vx-search>svg{position:absolute;left:15px;top:50%;transform:translateY(-50%);color:#8b8f88;pointer-events:none;}
.vx-search input{width:100%;background:#fff;border:1px solid #ecece8;border-radius:12px;padding:13px 15px 13px 44px;font-family:'Inter';font-size:14px;color:#1e2420;}
.vx-search input::placeholder{color:#a9ada4;}
.vx-search input:focus{outline:none;border-color:#5f8020;box-shadow:0 0 0 3px rgba(107,138,42,.14);}
.vx-empty{background:#fff;border:1px solid #ecece8;border-radius:16px;padding:48px 20px;text-align:center;color:#8b8f88;display:flex;flex-direction:column;align-items:center;gap:10px;}
.vx-empty .big{font-size:15px;font-weight:600;color:#1e2420;}
.vx-emptyic{width:48px;height:48px;border-radius:50%;background:#f1f1ec;display:flex;align-items:center;justify-content:center;color:#8b8f88;}
.vx-err{font-size:13.5px;color:#b0553f;padding:12px 16px;background:#f8ede8;border:1px solid #e6cdc4;border-radius:12px;margin-bottom:16px;}
.vx-note{font-size:12.5px;color:#8b8f88;margin-top:-6px;}
/* Lista de pedidos (como Pedidos del admin) */
.vx-plist{display:flex;flex-direction:column;gap:12px;}
.vx-pedido{display:grid;grid-template-columns:46px minmax(0,1fr) auto 24px;align-items:center;gap:16px;background:#fff;border:1px solid #ecece8;border-radius:15px;padding:16px 20px;cursor:pointer;transition:border-color .15s,box-shadow .15s;text-decoration:none;color:inherit;}
.vx-pedido:hover{border-color:#d9d9d3;box-shadow:0 4px 14px -10px rgba(0,0,0,.25);}
.vx-pic{width:46px;height:46px;border-radius:12px;background:#f2f2ec;color:#8f948a;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
.vx-pic.ok{background:#eef3e3;color:#5f8020;}
.vx-pmid{min-width:0;}
.vx-ptags{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px;}
.vx-pname{font-family:'Bricolage Grotesque','Inter',sans-serif;font-size:17px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.vx-pmeta{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#8b8f88;margin-top:4px;flex-wrap:wrap;}
.vx-pmeta .rem{color:#1e2420;font-weight:500;}
.vx-pmeta .com{color:#5f8020;font-weight:600;}
.vx-pright{text-align:right;white-space:nowrap;}
.vx-pright .rl{font-size:11.5px;color:#8b8f88;}
.vx-pright .rv{font-size:19px;font-weight:700;margin-top:1px;}
.vx-chev{color:#c3c6be;display:flex;justify-content:flex-end;}
/* Tarjetas de clientes (como Clientes del admin) */
.vx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;}
.vx-ccard{display:flex;align-items:flex-start;gap:13px;background:#fff;border:1px solid #ecece8;border-radius:14px;padding:14px 15px;transition:border-color .15s,box-shadow .15s;}
.vx-ccard:hover{border-color:#dcdcd6;box-shadow:0 2px 10px rgba(30,36,32,.05);}
.vx-cube{width:38px;height:38px;border-radius:10px;background:#eef3e3;color:#5f8020;display:flex;align-items:center;justify-content:center;flex:0 0 auto;margin-top:1px;font-weight:700;font-size:13px;}
.vx-cinfo{flex:1;min-width:0;}
.vx-cname{font-weight:600;font-size:14.5px;letter-spacing:-.01em;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.vx-csub{font-size:12px;color:#8b8f88;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.vx-cbadges{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;}
.vx-ctel{display:flex;align-items:center;gap:7px;font-size:12.5px;color:#8b8f88;margin-top:8px;}
.vx-ctel>svg{flex:0 0 auto;}
.vx-ctel>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.vx-ic{width:30px;height:30px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#8b8f88;flex:0 0 auto;}
.vx-ic:hover{background:#f1f1ee;color:#1e2420;}
/* Filas simples (últimos pedidos, top clientes, sin pedir) */
.vx-rows{display:flex;flex-direction:column;}
.vx-row{display:flex;align-items:center;gap:12px;padding:11px 22px;border-top:1px solid #f5f5f2;font-size:13.5px;background:none;border-left:none;border-right:none;border-bottom:none;width:100%;text-align:left;font-family:inherit;color:inherit;cursor:pointer;}
.vx-row:hover{background:#f8f8f5;}
.vx-row .main{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}
.vx-row .sub{font-size:12px;color:#8b8f88;font-weight:400;margin-top:1px;}
.vx-row .amt{font-weight:700;white-space:nowrap;}
.vx-row .rank{width:24px;height:24px;border-radius:50%;background:#f1f1ec;color:#8b8f88;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;flex:0 0 auto;}
.vx-row .rank.top{background:#f9f1de;color:#c08a1e;}
.vx-row .dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;}
.vx-row .dot.roja{background:#c05e42;} .vx-row .dot.naranja{background:#d4742e;}
.vx-row .dias{font-size:12px;white-space:nowrap;}
.vx-row .dias.roja{color:#c05e42;} .vx-row .dias.naranja{color:#d4742e;}
.vx-two{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
.vx-back{display:inline-flex;align-items:center;gap:6px;color:#8b8f88;font-size:13.5px;font-weight:500;text-decoration:none;margin-bottom:14px;background:none;border:none;cursor:pointer;padding:0;font-family:inherit;}
.vx-back:hover{color:#1e2420;}
.vx-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:22px;}
.vx-detail-head .name{font-family:'Bricolage Grotesque','Inter',sans-serif;font-size:22px;font-weight:700;letter-spacing:-.02em;}
.vx-detail-head .meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:#8b8f88;margin-top:6px;}
.vx-detail-head .tot .rl{font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9a9e96;}
.vx-detail-head .tot .rv{font-family:'Bricolage Grotesque','Inter',sans-serif;font-size:28px;font-weight:700;letter-spacing:-.02em;line-height:1.1;margin-top:4px;}
.vx-detail-head .tot .rs{font-size:12px;color:#8b8f88;margin-top:3px;}
.vx-notes{background:#fbfaf7;border:1px solid #ecece8;border-radius:12px;padding:12px 16px;font-size:13.5px;}
.vx-notes b{font-weight:600;}
.vx-bar{height:6px;border-radius:4px;background:#eeeeea;overflow:hidden;margin-top:8px;}
.vx-bar i{display:block;height:100%;background:#6b8a2a;border-radius:4px;}
.vx-chart{height:230px;padding:4px 10px 10px 0;}
@media(max-width:768px){
  .vx{padding:16px 14px 40px;}
  .vx-title{font-size:24px;}
  .vx-kpis,.vx-kpis.c4{grid-template-columns:1fr 1fr;gap:10px;}
  .vx-kpi.main{grid-column:1 / -1;}
  .vx-kpi{padding:14px 14px;}
  .vx-kpi .val{font-size:19px;letter-spacing:-.03em;}
  .vx-kpi.main .val{font-size:24px;}
  .vx-tbl th,.vx-tbl td{padding-left:12px;padding-right:12px;}
  .vx-tbl tr.sub td.l{padding-left:24px;}
  .vx-chead,.vx-detail-head{padding-left:14px;padding-right:14px;}
  .vx-cbody{padding-left:14px;padding-right:14px;}
  .vx-row{padding-left:14px;padding-right:14px;}
  .vx-two{grid-template-columns:1fr;}
  .vx-pedido{grid-template-columns:40px minmax(0,1fr) auto;gap:12px;padding:14px;}
  .vx-pic{width:40px;height:40px;}
  .vx-chev{display:none;}
  .vx-grid{grid-template-columns:1fr;}
  .vx-hide-m{display:none !important;}
  .vx-mes span{min-width:120px;}
}
`;

export { fetchJson } from "@/lib/queryClient";

export const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const mesLabel = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${MESES[m - 1] ?? ym} ${y}`; };
export const fmtFechaCorta = (s: string | null | undefined) => {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
export const fmtDiaMes = (s: string) => { const [, m, d] = s.slice(0, 10).split("-"); return `${d}/${m}`; };
export const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
/** Suma n meses a YYYY-MM */
export const sumarMes = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
export const formatRemito = (o: { remitoNum?: number | null; folio?: string | null }) => {
  if (o.remitoNum != null) return `VA-${String(o.remitoNum).padStart(6, "0")}`;
  const m = (o.folio ?? "").match(/^(?:VA|PV)-?(\d+)$/);
  return m ? `VA-${m[1].padStart(6, "0")}` : (o.folio || "—");
};
