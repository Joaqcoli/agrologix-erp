import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import * as XLSX from "xlsx";
import { storage } from "./storage";
import { insertCustomerSchema, insertProductSchema, insertPurchaseSchema, insertOrderSchema, insertPaymentSchema, insertWithholdingSchema, insertSupplierSchema, insertSupplierPaymentSchema } from "@shared/schema";
import { z } from "zod";
import { canonicalizeUnit } from "@shared/units";
import { getHistoricalMonthStats } from "./historical-stats";

// IVA helpers
const IVA_HUEVO = 0.21;
const IVA_DEFAULT = 0.105;
function getIvaRate(productName: string): number {
  return productName.toUpperCase().includes("HUEVO") ? IVA_HUEVO : IVA_DEFAULT;
}
function calcTotalConIva(items: { productName: string; pricePerUnit: string; quantity: string }[]): number {
  return items.reduce((sum, item) => {
    const subtotal = parseFloat(item.quantity) * parseFloat(item.pricePerUnit);
    return sum + subtotal * (1 + getIvaRate(item.productName));
  }, 0);
}

declare module "express-session" {
  interface SessionData {
    userId?: number;
    userRole?: string;
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ─── Auth ──────────────────────────────────────────────────────────────────
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
      const user = await storage.getUserByEmail(email);
      if (!user || !user.active) return res.status(401).json({ error: "Invalid credentials" });
      const valid = await storage.verifyPassword(password, user.passwordHash);
      if (!valid) return res.status(401).json({ error: "Invalid credentials" });
      req.session.userId = user.id;
      req.session.userRole = user.role;
      const { passwordHash, ...safeUser } = user;
      return res.json({ user: safeUser });
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    const user = await storage.getUserById(req.session.userId);
    if (!user) return res.status(401).json({ error: "User not found" });
    const { passwordHash, ...safeUser } = user;
    return res.json({ user: safeUser });
  });

  // ─── Dashboard ─────────────────────────────────────────────────────────────
  app.get("/api/dashboard/stats", requireAuth, async (req, res) => {
    try {
      const { from, to } = req.query as { from?: string; to?: string };
      if (!from || !to) return res.status(400).json({ error: "from and to are required" });
      const stats = await storage.getDashboardStats(from, to);
      return res.json(stats);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/dashboard/historical", requireAuth, (req, res) => {
    const month = parseInt(req.query.month as string);
    const year  = parseInt(req.query.year  as string);
    if (isNaN(month) || isNaN(year)) return res.status(400).json({ error: "month and year are required" });
    const stats = getHistoricalMonthStats(month, year);
    if (!stats) return res.status(404).json({ error: "No historical data for this period" });
    return res.json(stats);
  });

  app.get("/api/dashboard/bolsa-fv", requireAuth, async (req, res) => {
    try {
      const { from, to, type } = req.query as { from?: string; to?: string; type?: string };
      if (!from || !to) return res.status(400).json({ error: "from and to are required" });
      const data = await storage.getBolsaFvStats(from, to, type);
      return res.json(data);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── Commissions ───────────────────────────────────────────────────────────
  app.get("/api/commissions/salespersons", requireAuth, async (_req, res) => {
    try {
      return res.json(await storage.getSalespersons());
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/commissions/detail", requireAuth, async (req, res) => {
    try {
      const { salesperson, month, year } = req.query as { salesperson?: string; month?: string; year?: string };
      if (!salesperson || !month || !year) return res.status(400).json({ error: "salesperson, month and year are required" });
      const data = await storage.getCommissionDetail(salesperson, parseInt(month), parseInt(year));
      return res.json(data);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── Customers ─────────────────────────────────────────────────────────────
  app.get("/api/customers", requireAuth, async (req, res) => {
    try {
      return res.json(await storage.getCustomers());
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/customers/:id", requireAuth, async (req, res) => {
    const c = await storage.getCustomer(Number(req.params.id));
    if (!c) return res.status(404).json({ error: "Not found" });
    return res.json(c);
  });

  app.post("/api/customers", requireAuth, async (req, res) => {
    try {
      const data = insertCustomerSchema.parse(req.body);
      return res.status(201).json(await storage.createCustomer(data));
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/customers/:id", requireAuth, async (req, res) => {
    try {
      const data = insertCustomerSchema.partial().parse(req.body);
      return res.json(await storage.updateCustomer(Number(req.params.id), data));
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/customers/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteCustomer(Number(req.params.id));
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── Products ──────────────────────────────────────────────────────────────
  app.get("/api/products", requireAuth, async (req, res) => {
    try {
      const { category, search } = req.query as { category?: string; search?: string };
      return res.json(await storage.getProducts({
        category: category || undefined,
        search: search || undefined,
      }));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // Specific sub-routes MUST come before /api/products/:id to avoid capture
  app.get("/api/products/unit-history", requireAuth, async (req, res) => {
    try {
      return res.json(await storage.getProductUnitHistory());
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/products/stock", requireAuth, async (req, res) => {
    try {
      const { category, search, onlyInStock } = req.query as { category?: string; search?: string; onlyInStock?: string };
      return res.json(await storage.getAllProductUnitsStock({
        category: category || undefined,
        search: search || undefined,
        onlyInStock: onlyInStock !== "false",
      }));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/products/import", requireAuth, async (req, res) => {
    try {
      const { lines } = z.object({
        lines: z.array(z.object({ name: z.string(), unit: z.string() })).min(1),
      }).parse(req.body);
      const result = await storage.bulkImportProducts(lines);
      return res.status(201).json(result);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.get("/api/products/:id", requireAuth, async (req, res) => {
    try {
      const p = await storage.getProduct(Number(req.params.id));
      if (!p) return res.status(404).json({ error: "Not found" });
      return res.json(p);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/products", requireAuth, async (req, res) => {
    try {
      const body = insertProductSchema.parse(req.body);
      const { units, ...data } = body as any;
      const product = await storage.createProduct(data);
      // Create initial units: from units array if provided, or from product.unit
      const initialUnits: string[] = Array.isArray(units) && units.length > 0
        ? units.map((u: string) => canonicalizeUnit(u))
        : [canonicalizeUnit(data.unit ?? "KG")];
      await storage.setProductUnits(product.id, initialUnits);
      return res.status(201).json(product);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/products/:id", requireAuth, async (req, res) => {
    try {
      const { units, ...rest } = req.body as any;
      const data = insertProductSchema.partial().parse(rest);
      const product = await storage.updateProduct(Number(req.params.id), data, units);
      // Also process units if provided in the PATCH body (belt-and-suspenders alongside PUT /units)
      if (Array.isArray(units) && units.length > 0) {
        const canonical = units.map((u: string) => canonicalizeUnit(u));
        await storage.setProductUnits(Number(req.params.id), canonical);
      }
      return res.json(product);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/products/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteProduct(Number(req.params.id));
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── Product Units ─────────────────────────────────────────────────────────

  app.get("/api/products/:id/units", requireAuth, async (req, res) => {
    try {
      return res.json(await storage.getProductUnits(Number(req.params.id)));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // GET /api/products/:id/cost-for-unit?unit=CAJON — cost lookup for any unit
  app.get("/api/products/:id/cost-for-unit", requireAuth, async (req, res) => {
    try {
      const unit = String(req.query.unit ?? "KG");
      const cost = await storage._getCostForUnit(Number(req.params.id), unit);
      return res.json({ cost });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // PUT /api/products/:id/units — replace unit set (idempotent diff)
  app.put("/api/products/:id/units", requireAuth, async (req, res) => {
    try {
      const { units } = z.object({ units: z.array(z.string()).min(0) }).parse(req.body);
      const canonical = units.map((u) => canonicalizeUnit(u));
      const updated = await storage.setProductUnits(Number(req.params.id), canonical);
      return res.json(updated);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.post("/api/products/:id/units", requireAuth, async (req, res) => {
    try {
      const { unit } = z.object({ unit: z.string().min(1) }).parse(req.body);
      const canonical = canonicalizeUnit(unit);
      const pu = await storage.upsertProductUnit(Number(req.params.id), canonical);
      return res.status(201).json(pu);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/product-units/:id", requireAuth, async (req, res) => {
    try {
      await storage.deactivateProductUnit(Number(req.params.id));
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/product-units/:id/adjust", requireAuth, async (req, res) => {
    try {
      const { adjustment, notes } = z.object({ adjustment: z.number(), notes: z.string().optional() }).parse(req.body);
      const pu = await storage.adjustProductUnitStock(Number(req.params.id), adjustment, notes);
      return res.json(pu);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  // ─── Stock Movements (adjustment history) ──────────────────────────────────
  app.get("/api/stock-movements", requireAuth, async (req, res) => {
    try {
      return res.json(await storage.getAdjustmentMovements());
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── Stock Adjustments ─────────────────────────────────────────────────────
  app.post("/api/stock/adjust", requireAuth, async (req, res) => {
    try {
      const { items } = z.object({
        items: z.array(z.object({
          productId: z.number().int().positive(),
          unit: z.string().min(1),
          qty: z.number().positive(),
        })).min(1),
      }).parse(req.body);
      await storage.addStockAdjustments(items);
      return res.json({ ok: true });
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.post("/api/stock/reset", requireAuth, async (req, res) => {
    try {
      const { asMerma } = z.object({ asMerma: z.boolean() }).parse(req.body);
      const result = await storage.resetAllStock(asMerma);
      return res.json(result);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  // ─── Price History ─────────────────────────────────────────────────────────
  app.get("/api/price-history/:customerId/:productId", requireAuth, async (req, res) => {
    const record = await storage.getLastPrice(Number(req.params.customerId), Number(req.params.productId));
    return res.json(record ?? null);
  });

  // ─── Purchases ─────────────────────────────────────────────────────────────
  app.get("/api/purchases", requireAuth, async (req, res) => {
    const { date } = req.query as { date?: string };
    return res.json(await storage.getPurchases(date || undefined));
  });

  app.get("/api/purchases/next-folio", requireAuth, async (req, res) => {
    return res.json({ folio: await storage.generatePurchaseFolio() });
  });

  app.get("/api/purchases/:id", requireAuth, async (req, res) => {
    const p = await storage.getPurchase(Number(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    return res.json(p);
  });

  app.patch("/api/purchases/:id", requireAuth, async (req, res) => {
    try {
      const schema = z.object({
        supplierName: z.string().min(1),
        purchaseDate: z.string(),
        notes: z.string().optional(),
        items: z.array(z.object({
          productId: z.number().int().positive(),
          quantity: z.string(),
          unit: z.enum(["KG", "UNIDAD", "CAJON", "BOLSA", "ATADO", "MAPLE", "BANDEJA"]),
          costPerUnit: z.string(),
          costPerPurchaseUnit: z.string().optional(),
          purchaseQty: z.string().optional(),
          purchaseUnit: z.enum(["KG", "UNIDAD", "CAJON", "BOLSA", "ATADO", "MAPLE", "BANDEJA"]).optional(),
          weightPerPackage: z.string().optional(),
        })).min(1),
      });
      const data = schema.parse(req.body);
      const purchase = await storage.updatePurchase(Number(req.params.id), {
        ...data,
        purchaseDate: new Date(data.purchaseDate),
      });
      return res.json(purchase);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/purchases/:id", requireAuth, async (req, res) => {
    try {
      await storage.deletePurchase(Number(req.params.id));
      return res.json({ ok: true });
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.post("/api/purchases", requireAuth, async (req, res) => {
    try {
      const data = insertPurchaseSchema.parse(req.body);
      const purchase = await storage.createPurchase({
        folio: data.folio,
        supplierName: data.supplierName,
        supplierId: (data as any).supplierId ?? null,
        paymentMethod: (data as any).paymentMethod ?? "cuenta_corriente",
        purchaseDate: new Date(data.purchaseDate as unknown as string),
        notes: data.notes ?? undefined,
        createdBy: req.session.userId!,
        items: data.items as any,
      });
      return res.status(201).json(purchase);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  // ─── Orders ────────────────────────────────────────────────────────────────
  app.get("/api/orders", requireAuth, async (req, res) => {
    const date = req.query.date as string | undefined;
    return res.json(await storage.getOrders(date));
  });

  app.get("/api/orders/next-folio", requireAuth, async (req, res) => {
    return res.json({ folio: await storage.generateOrderFolio() });
  });

  // Check if a draft order exists for customer+date (for intake merge flow)
  app.get("/api/orders/draft", requireAuth, async (req, res) => {
    const { customerId, date } = req.query;
    if (!customerId || !date) return res.status(400).json({ error: "customerId and date required" });
    const draft = await storage.getDraftOrderByCustomerAndDate(Number(customerId), date as string);
    return res.json(draft ?? null);
  });

  // Create order from intake (no prices required)
  app.post("/api/orders/intake", requireAuth, async (req, res) => {
    try {
      const body = z.object({
        customerId: z.number(),
        orderDate: z.string(),
        notes: z.string().optional(),
        mode: z.enum(["new", "merge", "replace"]).default("new"),
        existingOrderId: z.number().optional(),
        items: z.array(z.object({
          productId: z.number().nullable(),
          quantity: z.string(),
          unit: z.string(),
          rawProductName: z.string().optional(),
          parseStatus: z.string().optional(),
        })).min(1),
      }).parse(req.body);

      let order;
      if (body.mode === "merge" && body.existingOrderId) {
        await storage.addItemsToOrder(body.existingOrderId, body.items);
        order = { id: body.existingOrderId };
      } else if (body.mode === "replace" && body.existingOrderId) {
        await storage.replaceOrderItems(body.existingOrderId, body.items);
        order = { id: body.existingOrderId };
      } else {
        const folio = await storage.generateOrderFolio();
        order = await storage.createOrderFromIntake({
          folio,
          customerId: body.customerId,
          orderDate: new Date(body.orderDate),
          notes: body.notes,
          createdBy: req.session.userId!,
          items: body.items,
        });
      }

      return res.status(201).json({ orderId: order.id });
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // Update a single order item (price, cost override, and structural fields in draft)
  app.patch("/api/orders/:id/items/:itemId", requireAuth, async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const itemId = Number(req.params.itemId);
      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });

      const schema = z.object({
        quantity: z.string().optional(),
        unit: z.string().optional(),
        productId: z.number().nullable().optional(),
        pricePerUnit: z.string().nullable().optional(),
        overrideCostPerUnit: z.string().nullable().optional(),
        bolsaType: z.string().nullable().optional(),
      });
      const patch = schema.parse(req.body);

      const result = await storage.updateOrderItem(orderId, itemId, patch, order.customerId);
      return res.json(result);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // Add item to order
  app.post("/api/orders/:id/items", requireAuth, async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const schema = z.object({
        quantity: z.string(),
        unit: z.string(),
        productId: z.number().nullable().optional(),
        pricePerUnit: z.string().nullable().optional(),
        bolsaType: z.string().nullable().optional(),
      });
      const data = schema.parse(req.body);
      const result = await storage.addOrderItem(orderId, { ...data, productId: data.productId ?? null });
      return res.status(201).json(result);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  // Delete item from order (restores stock if approved)
  app.delete("/api/orders/:id/items/:itemId", requireAuth, async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const itemId = Number(req.params.itemId);
      const result = await storage.deleteOrderItem(orderId, itemId);
      return res.json(result);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.get("/api/orders/:id", requireAuth, async (req, res) => {
    const o = await storage.getOrder(Number(req.params.id));
    if (!o) return res.status(404).json({ error: "Not found" });
    return res.json(o);
  });

  app.post("/api/orders", requireAuth, async (req, res) => {
    try {
      const data = insertOrderSchema.parse(req.body);
      const order = await storage.createOrder({
        folio: await storage.generateOrderFolio(),
        customerId: data.customerId,
        orderDate: new Date(data.orderDate as unknown as string),
        notes: data.notes,
        lowMarginConfirmed: data.lowMarginConfirmed,
        createdBy: req.session.userId!,
        items: data.items as any,
      });
      return res.status(201).json(order);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/orders/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteOrder(Number(req.params.id));
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/orders/:id/approve", requireAuth, async (req, res) => {
    try {
      const order = await storage.approveOrder(Number(req.params.id), req.session.userId!);
      return res.json(order);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  // PATCH /api/orders/:id/invoice-number — update invoice number inline
  app.patch("/api/orders/:id/invoice-number", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { invoiceNumber } = req.body as { invoiceNumber?: string | null };
      await storage.updateOrderInvoiceNumber(id, invoiceNumber ?? null);
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ─── Export ────────────────────────────────────────────────────────────────
  // Export all orders for a date as XLSX
  app.get("/api/orders/export", requireAuth, async (req, res) => {
    const date = req.query.date as string;
    if (!date) return res.status(400).json({ error: "date required" });

    const dayOrders = await storage.getOrders(date);
    const wb = XLSX.utils.book_new();
    const rows: any[][] = [];

    const headerBase = ["Cantidad", "Unidad", "Producto", "Precio Venta", "Total"];
    const headerIva = [...headerBase, "Total + IVA"];
    const headerPurchase = ["Precio Compra", "Total Compra", "Diferencia", "%"];

    for (const order of dayOrders) {
      const fullOrder = await storage.getOrder(order.id);
      if (!fullOrder) continue;
      const hasIva = fullOrder.customer.hasIva;

      rows.push([`Cliente: ${fullOrder.customer.name}`, hasIva ? "Con IVA" : "Sin IVA", `Pedido: ${order.folio}`, `Fecha: ${new Date(fullOrder.orderDate).toLocaleDateString("es-MX")}`]);
      rows.push(hasIva ? [...headerIva, ...headerPurchase] : [...headerBase, ...headerPurchase]);

      for (const item of fullOrder.items) {
        const qty = parseFloat(item.quantity as string);
        const price = parseFloat(item.pricePerUnit as string);
        const cost = parseFloat(item.costPerUnit as string);
        const subtotal = qty * price;
        const ivaRate = getIvaRate(item.product.name);
        const totalConIva = subtotal * (1 + ivaRate);
        const totalCompra = qty * cost;
        const base = hasIva ? subtotal * (1 + ivaRate) : subtotal;
        const diff = base - totalCompra;
        const pct = base > 0 ? ((diff / base) * 100).toFixed(1) + "%" : "0%";

        if (hasIva) {
          rows.push([qty, item.unit, item.product.name, price, subtotal, totalConIva, cost, totalCompra, diff, pct]);
        } else {
          rows.push([qty, item.unit, item.product.name, price, subtotal, cost, totalCompra, diff, pct]);
        }
      }

      const total = parseFloat(fullOrder.total);
      if (hasIva) {
        const totalIva = calcTotalConIva(fullOrder.items.map(i => ({ productName: i.product.name, pricePerUnit: i.pricePerUnit as string, quantity: i.quantity as string })));
        const totalCosto = fullOrder.items.reduce((s, i) => s + parseFloat(i.quantity as string) * parseFloat(i.costPerUnit as string), 0);
        const diff = totalIva - totalCosto;
        rows.push(["TOTAL", "", "", "", total, totalIva, "", totalCosto, diff, totalIva > 0 ? ((diff / totalIva) * 100).toFixed(1) + "%" : "0%"]);
      } else {
        const totalCosto = fullOrder.items.reduce((s, i) => s + parseFloat(i.quantity as string) * parseFloat(i.costPerUnit as string), 0);
        const diff = total - totalCosto;
        rows.push(["TOTAL", "", "", "", total, "", totalCosto, diff, total > 0 ? ((diff / total) * 100).toFixed(1) + "%" : "0%"]);
      }
      rows.push([]); // blank separator
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, `Pedidos ${date}`);
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Disposition", `attachment; filename="Pedidos-${date}.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(buf);
  });

  // Export single order
  app.get("/api/orders/:id/export", requireAuth, async (req, res) => {
    const fullOrder = await storage.getOrder(Number(req.params.id));
    if (!fullOrder) return res.status(404).json({ error: "Not found" });

    const hasIva = fullOrder.customer.hasIva;
    const wb = XLSX.utils.book_new();
    const rows: any[][] = [];

    rows.push([`Cliente: ${fullOrder.customer.name}`, hasIva ? "Con IVA" : "Sin IVA"]);
    rows.push([`Pedido: ${fullOrder.folio}`, `Fecha: ${new Date(fullOrder.orderDate).toLocaleDateString("es-MX")}`]);
    rows.push([]);

    const headerBase = ["Cantidad", "Unidad", "Producto", "Precio Venta", "Total"];
    const headerIva = [...headerBase, "Total + IVA"];
    const headerPurchase = ["Precio Compra", "Total Compra", "Diferencia", "%"];
    rows.push(hasIva ? [...headerIva, ...headerPurchase] : [...headerBase, ...headerPurchase]);

    for (const item of fullOrder.items) {
      const qty = parseFloat(item.quantity as string);
      const price = parseFloat(item.pricePerUnit as string);
      const cost = parseFloat(item.costPerUnit as string);
      const subtotal = qty * price;
      const ivaRate = getIvaRate(item.product.name);
      const totalConIva = subtotal * (1 + ivaRate);
      const totalCompra = qty * cost;
      const base = hasIva ? totalConIva : subtotal;
      const diff = base - totalCompra;
      const pct = base > 0 ? ((diff / base) * 100).toFixed(1) + "%" : "0%";

      if (hasIva) {
        rows.push([qty, item.unit, item.product.name, price, subtotal, totalConIva, cost, totalCompra, diff, pct]);
      } else {
        rows.push([qty, item.unit, item.product.name, price, subtotal, cost, totalCompra, diff, pct]);
      }
    }

    const total = parseFloat(fullOrder.total);
    if (hasIva) {
      const totalIva = calcTotalConIva(fullOrder.items.map(i => ({ productName: i.product.name, pricePerUnit: i.pricePerUnit as string, quantity: i.quantity as string })));
      const totalCosto = fullOrder.items.reduce((s, i) => s + parseFloat(i.quantity as string) * parseFloat(i.costPerUnit as string), 0);
      const diff = totalIva - totalCosto;
      rows.push(["TOTAL", "", "", "", total, totalIva, "", totalCosto, diff, totalIva > 0 ? ((diff / totalIva) * 100).toFixed(1) + "%" : "0%"]);
    } else {
      const totalCosto = fullOrder.items.reduce((s, i) => s + parseFloat(i.quantity as string) * parseFloat(i.costPerUnit as string), 0);
      const diff = total - totalCosto;
      rows.push(["TOTAL", "", "", "", total, "", totalCosto, diff, total > 0 ? ((diff / total) * 100).toFixed(1) + "%" : "0%"]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, fullOrder.customer.name.slice(0, 31));
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Disposition", `attachment; filename="Pedido-${fullOrder.folio}.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(buf);
  });

  // ─── Remitos ───────────────────────────────────────────────────────────────
  app.get("/api/remitos/:id", requireAuth, async (req, res) => {
    const r = await storage.getRemito(Number(req.params.id));
    if (!r) return res.status(404).json({ error: "Not found" });
    return res.json(r);
  });

  // ─── Load List ─────────────────────────────────────────────────────────────
  app.get("/api/load-list/export", requireAuth, async (req, res) => {
    try {
      const date = req.query.date as string;
      if (!date) return res.status(400).json({ error: "date query param required" });
      const includeDrafts = req.query.includeDrafts !== "0";
      const data = await storage.getLoadListByDate(date, includeDrafts);
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      // Sheet 1: Carga
      const cargaData = [
        ["Producto", "Unidad", "Total Pedido", "Stock Disponible", "Diferencia", "Clientes"],
        ...data.rows.map((r) => [r.productName, r.unit, r.totalQty, r.stockQty, r.diffQty, r.customersCount]),
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(cargaData);
      XLSX.utils.book_append_sheet(wb, ws1, "Carga");

      // Sheet 2: Detalle por cliente
      const detailRows: (string | number)[][] = [["Cliente", "Pedido", "Producto", "Unidad", "Cantidad"]];
      for (const p of data.pending) {
        detailRows.push([p.customerName, p.orderFolio, p.rawText, p.unit ?? "", p.qty ?? ""]);
      }
      const ws2 = XLSX.utils.aoa_to_sheet(detailRows);
      XLSX.utils.book_append_sheet(wb, ws2, "Detalle por Cliente");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Disposition", `attachment; filename="lista-carga-${date}.xlsx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      return res.send(buf);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/load-list", requireAuth, async (req, res) => {
    try {
      const date = req.query.date as string;
      if (!date) return res.status(400).json({ error: "date query param required" });
      const includeDrafts = req.query.includeDrafts !== "0";
      return res.json(await storage.getLoadListByDate(date, includeDrafts));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── Cuentas Corrientes ─────────────────────────────────────────────────────

  // GET /api/ar/pending-orders/:customerId — orders available to link to a payment
  app.get("/api/ar/pending-orders/:customerId", requireAuth, async (req, res) => {
    try {
      const customerId = Number(req.params.customerId);
      const result = await storage.getPendingOrdersForCustomer(customerId);
      return res.json(result);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // Helper: parse dateFrom/dateTo OR month/year from query
  function parseCCDateRange(query: Record<string, any>): { startDate: string; endDate: string } | null {
    if (query.dateFrom && query.dateTo) {
      return { startDate: query.dateFrom as string, endDate: query.dateTo as string };
    }
    const month = parseInt(query.month as string);
    const year = parseInt(query.year as string);
    if (!month || !year || month < 1 || month > 12) return null;
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
    return { startDate, endDate };
  }

  // GET /api/ar/cc/summary?month=2&year=2026  OR  ?dateFrom=2026-03-01&dateTo=2026-03-08
  app.get("/api/ar/cc/summary", requireAuth, async (req, res) => {
    try {
      const range = parseCCDateRange(req.query as Record<string, any>);
      if (!range) return res.status(400).json({ error: "Invalid date params" });
      const data = await storage.getCCSummary(range.startDate, range.endDate);
      return res.json(data);
    } catch (e: any) {
      console.error("CC summary error:", e);
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/ar/cc/customer/:id?month=2&year=2026  OR  ?dateFrom=...&dateTo=...
  app.get("/api/ar/cc/customer/:id", requireAuth, async (req, res) => {
    try {
      const customerId = Number(req.params.id);
      const range = parseCCDateRange(req.query as Record<string, any>);
      if (!range) return res.status(400).json({ error: "Invalid date params" });
      const data = await storage.getCCCustomerDetail(customerId, range.startDate, range.endDate);
      if (!data) return res.status(404).json({ error: "Customer not found" });
      return res.json(data);
    } catch (e: any) {
      console.error("CC customer detail error:", e);
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/payments
  app.post("/api/payments", requireAuth, async (req, res) => {
    try {
      const data = insertPaymentSchema.parse(req.body);
      const orderIds: number[] = Array.isArray(req.body.orderIds)
        ? (req.body.orderIds as unknown[]).map(Number).filter((n) => !isNaN(n))
        : [];
      const payment = await storage.createPayment(data, req.session.userId!);
      if (orderIds.length > 0) {
        await storage.linkPaymentToOrders(payment.id, orderIds);
      }
      return res.json(payment);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // DELETE /api/payments/:id
  app.delete("/api/payments/:id", requireAuth, async (req, res) => {
    try {
      await storage.deletePayment(Number(req.params.id));
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/withholdings
  app.post("/api/withholdings", requireAuth, async (req, res) => {
    try {
      const data = insertWithholdingSchema.parse(req.body);
      const w = await storage.createWithholding(data, req.session.userId!);
      return res.json(w);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // DELETE /api/withholdings/:id
  app.delete("/api/withholdings/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteWithholding(Number(req.params.id));
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/ar/cc/export?month=2&year=2026
  app.get("/api/ar/cc/export", requireAuth, async (req, res) => {
    try {
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);
      if (!month || !year) return res.status(400).json({ error: "Invalid params" });

      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endMonth = month === 12 ? 1 : month + 1;
      const endYear = month === 12 ? year + 1 : year;
      const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
      const data = await storage.getCCSummary(startDate, endDate);
      const monthName = new Date(year, month - 1, 1).toLocaleString("es-AR", { month: "long", year: "numeric" });

      const wb = XLSX.utils.book_new();

      // Sheet 1: main table
      const sheet1Data = [
        ["Cliente", "Saldo Mes Anterior", "Facturación", "Cobranza", "Retenciones", "Saldo", "% del Fiado"],
        ...data.customers.map((r) => [
          r.customerName,
          r.saldoMesAnterior,
          r.facturacion,
          r.cobranza,
          r.retenciones,
          r.saldo,
          parseFloat(r.pctFiado.toFixed(2)),
        ]),
        ["TOTAL", data.totals.saldoMesAnterior, data.totals.facturacion, data.totals.cobranza, data.totals.retenciones, data.totals.saldo, ""],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
      XLSX.utils.book_append_sheet(wb, ws1, "Cuentas Corrientes");

      // Sheet 2: summary
      const sheet2Data = [
        [`Resumen ${monthName}`],
        [],
        ["Período", "Venta"],
        ...data.semanas.map((s) => [`${s.label} (${s.start}-${s.end})`, s.total]),
        [],
        ["Venta del Mes", data.ventaMes],
        ["Bultos Mes", data.bultosMes],
        ["Promedio Venta x Día", data.promedioDia],
        ["Ganancia Bruta Mes", data.gananciaMes],
        ["Promedio Ganancia x Día", data.promedioGanancia],
        ["Margen Bruto %", parseFloat(data.margenPct.toFixed(2)) + "%"],
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
      XLSX.utils.book_append_sheet(wb, ws2, "Resumen");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="CC-${monthName}.xlsx"`);
      return res.send(buf);
    } catch (e: any) {
      console.error("CC export error:", e);
      return res.status(500).json({ error: e.message });
    }
  });

  // ─── Suppliers CRUD ────────────────────────────────────────────────────────────
  app.get("/api/suppliers", requireAuth, async (_req, res) => {
    try {
      return res.json(await storage.getSuppliers());
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/suppliers/:id", requireAuth, async (req, res) => {
    try {
      const s = await storage.getSupplier(Number(req.params.id));
      if (!s) return res.status(404).json({ error: "Not found" });
      return res.json(s);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/suppliers", requireAuth, async (req, res) => {
    try {
      const data = insertSupplierSchema.parse(req.body);
      return res.json(await storage.createSupplier(data));
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/suppliers/:id", requireAuth, async (req, res) => {
    try {
      const data = insertSupplierSchema.partial().parse(req.body);
      return res.json(await storage.updateSupplier(Number(req.params.id), data));
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/suppliers/:id", requireAuth, async (req, res) => {
    try {
      await storage.deactivateSupplier(Number(req.params.id));
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── AP CC ─────────────────────────────────────────────────────────────────────
  app.get("/api/ap/cc/summary", requireAuth, async (req, res) => {
    try {
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);
      if (!month || !year || month < 1 || month > 12)
        return res.status(400).json({ error: "Invalid month/year" });
      return res.json(await storage.getAPCCSummary(month, year));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/ap/cc/:supplierId", requireAuth, async (req, res) => {
    try {
      const supplierId = Number(req.params.supplierId);
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);
      if (!month || !year) return res.status(400).json({ error: "month/year required" });
      return res.json(await storage.getAPCCSupplierDetail(supplierId, month, year));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/ap/payments", requireAuth, async (req, res) => {
    try {
      const data = insertSupplierPaymentSchema.parse(req.body);
      const payment = await storage.createSupplierPayment(data, req.session.userId!);
      return res.json(payment);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/ap/payments/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteSupplierPayment(Number(req.params.id));
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/ap/pending-purchases/:supplierId", requireAuth, async (req, res) => {
    try {
      return res.json(await storage.getPendingPurchasesForSupplier(Number(req.params.supplierId)));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/ap/empties/:supplierId", requireAuth, async (req, res) => {
    try {
      return res.json(await storage.getSupplierEmptiesDetail(Number(req.params.supplierId)));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  return httpServer;
}
