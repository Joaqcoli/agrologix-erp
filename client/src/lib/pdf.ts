import jsPDF from "jspdf";

type RemitoData = {
  folio: string;
  issuedAt: string | Date;
  order: {
    folio: string;
    orderDate: string | Date;
    notes?: string | null;
    customer: {
      name: string;
      rfc?: string | null;
      address?: string | null;
      city?: string | null;
      phone?: string | null;
    };
    items: {
      product: { name: string; sku: string };
      quantity: string;
      unit: string;
      pricePerUnit: string;
      subtotal: string;
    }[];
    total: string;
  };
};

export function generateRemitoPDF(data: RemitoData) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const margin = 15;
  let y = margin;

  const fmtDate = (d: string | Date) =>
    new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

  const fmtMoney = (v: string) =>
    `$${parseFloat(v).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ─── Header ─────────────────────────────────────────────────────────────────
  doc.setFillColor(29, 78, 216); // primary blue
  doc.rect(0, 0, pageW, 32, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("VEGETALES ARGENTINOS", margin, 13);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Distribución de Produce", margin, 20);
  doc.text("Remito de Entrega", margin, 26);

  // Folio box
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(pageW - margin - 50, 6, 50, 22, 2, 2, "F");
  doc.setTextColor(29, 78, 216);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("REMITO N°", pageW - margin - 25, 13, { align: "center" });
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(data.folio, pageW - margin - 25, 22, { align: "center" });

  y = 42;

  // ─── Info row ───────────────────────────────────────────────────────────────
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`Fecha: ${fmtDate(data.issuedAt)}`, margin, y);
  doc.text(`Pedido: ${data.order.folio}`, margin + 55, y);
  doc.text(`Fecha pedido: ${fmtDate(data.order.orderDate)}`, margin + 110, y);

  y += 8;

  // ─── Customer box ───────────────────────────────────────────────────────────
  doc.setFillColor(247, 248, 250);
  doc.rect(margin, y, pageW - margin * 2, 22, "F");
  doc.setDrawColor(220, 220, 230);
  doc.rect(margin, y, pageW - margin * 2, 22);

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("CLIENTE", margin + 3, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(data.order.customer.name, margin + 3, y + 13);
  const customerDetails = [
    data.order.customer.rfc ? `RFC: ${data.order.customer.rfc}` : null,
    data.order.customer.city ?? null,
    data.order.customer.phone ?? null,
  ].filter(Boolean).join("   |   ");
  if (customerDetails) {
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(customerDetails, margin + 3, y + 19);
  }

  y += 30;

  // ─── Table header ───────────────────────────────────────────────────────────
  const colProducto = margin;
  const colSKU = margin + 75;
  const colQty = margin + 105;
  const colUnit = margin + 125;
  const colPrice = margin + 145;
  const colSubtotal = margin + 165;

  doc.setFillColor(29, 78, 216);
  doc.rect(margin, y, pageW - margin * 2, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("Producto", colProducto + 2, y + 5.5);
  doc.text("SKU", colSKU + 2, y + 5.5);
  doc.text("Cant.", colQty + 2, y + 5.5);
  doc.text("U.", colUnit + 2, y + 5.5);
  doc.text("Precio/u", colPrice + 2, y + 5.5);
  doc.text("Subtotal", colSubtotal + 2, y + 5.5);

  y += 10;

  // ─── Table rows ─────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "normal");
  data.order.items.forEach((item, i) => {
    if (i % 2 === 0) {
      doc.setFillColor(252, 252, 255);
      doc.rect(margin, y - 3, pageW - margin * 2, 8, "F");
    }
    doc.setDrawColor(230, 230, 240);
    doc.line(margin, y + 5, pageW - margin, y + 5);

    doc.setTextColor(30, 30, 30);
    doc.setFontSize(8);
    const productName = item.product.name.length > 30 ? item.product.name.slice(0, 28) + "..." : item.product.name;
    doc.text(productName, colProducto + 2, y + 2);
    doc.text(item.product.sku, colSKU + 2, y + 2);
    doc.text(parseFloat(item.quantity).toFixed(2), colQty + 2, y + 2);
    doc.text(item.unit, colUnit + 2, y + 2);
    doc.text(fmtMoney(item.pricePerUnit), colPrice + 2, y + 2);
    doc.setFont("helvetica", "bold");
    doc.text(fmtMoney(item.subtotal), colSubtotal + 2, y + 2);
    doc.setFont("helvetica", "normal");

    y += 8;
  });

  // ─── Total ──────────────────────────────────────────────────────────────────
  y += 4;
  doc.setFillColor(29, 78, 216);
  doc.rect(pageW - margin - 60, y, 60, 10, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("TOTAL:", pageW - margin - 42, y + 7);
  doc.text(fmtMoney(data.order.total), pageW - margin - 3, y + 7, { align: "right" });

  y += 20;

  // ─── Notes ──────────────────────────────────────────────────────────────────
  if (data.order.notes) {
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.text(`Notas: ${data.order.notes}`, margin, y);
    y += 8;
  }

  // ─── Signature lines ────────────────────────────────────────────────────────
  y = Math.max(y, 240);
  doc.setDrawColor(180, 180, 180);
  doc.line(margin, y, margin + 60, y);
  doc.line(pageW - margin - 60, y, pageW - margin, y);
  doc.setTextColor(120, 120, 120);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Firma Entrega", margin + 30, y + 5, { align: "center" });
  doc.text("Conformidad Cliente", pageW - margin - 30, y + 5, { align: "center" });

  // ─── Footer ─────────────────────────────────────────────────────────────────
  doc.setFontSize(7);
  doc.setTextColor(160, 160, 160);
  doc.text(`AgroLogix ERP | Documento generado el ${new Date().toLocaleString("es-MX")}`, pageW / 2, 290, { align: "center" });

  doc.save(`Remito-${data.folio}.pdf`);
}
