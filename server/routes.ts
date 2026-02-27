import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import * as XLSX from "xlsx";
import { storage } from "./storage";
import { insertCustomerSchema, insertProductSchema, insertPurchaseSchema, insertOrderSchema } from "@shared/schema";
import { z } from "zod";
import { canonicalizeUnit } from "@shared/units";

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

  // ─── Customers ─────────────────────────────────────────────────────────────
  app.get("/api/customers", requireAuth, async (req, res) => {
    return res.json(await storage.getCustomers());
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
    await storage.deleteCustomer(Number(req.params.id));
    return res.json({ ok: true });
  });

  // ─── Products ──────────────────────────────────────────────────────────────
  app.get("/api/products", requireAuth, async (req, res) => {
    const { category, search } = req.query as { category?: string; search?: string };
    return res.json(await storage.getProducts({
      category: category || undefined,
      search: search || undefined,
    }));
  });

  // Specific sub-routes MUST come before /api/products/:id to avoid capture
  app.get("/api/products/units", requireAuth, async (req, res) => {
    const { category, search, onlyInStock } = req.query as { category?: string; search?: string; onlyInStock?: string };
    return res.json(await storage.getAllProductUnitsStock({
      category: category || undefined,
      search: search || undefined,
      onlyInStock: onlyInStock !== "false",
    }));
  });

  app.get("/api/products/stock", requireAuth, async (req, res) => {
    const { category, search, onlyInStock } = req.query as { category?: string; search?: string; onlyInStock?: string };
    return res.json(await storage.getAllProductUnitsStock({
      category: category || undefined,
      search: search || undefined,
      onlyInStock: onlyInStock !== "false",
    }));
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
    const p = await storage.getProduct(Number(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    return res.json(p);
  });

  app.post("/api/products", requireAuth, async (req, res) => {
    try {
      const body = insertProductSchema.parse(req.body);
      const { units, ...data } = body as any;
      const product = await storage.createProduct(data);
      // Create initial units: from units array if provided, or from product.unit
      const initialUnits: string[] = Array.isArray(units) && units.length > 0
        ? units.map((u: string) => canonicalizeUnit(u))
        : [canonicalizeUnit(data.unit ?? "kg")];
      await storage.setProductUnits(product.id, initialUnits);
      return res.status(201).json(product);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/products/:id", requireAuth, async (req, res) => {
    try {
      const { units, ...rest } = req.body as any;
      const data = insertProductSchema.partial().parse(rest);
      const product = await storage.updateProduct(Number(req.params.id), data);
      return res.json(product);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/products/:id", requireAuth, async (req, res) => {
    await storage.deleteProduct(Number(req.params.id));
    return res.json({ ok: true });
  });

  // ─── Product Units ─────────────────────────────────────────────────────────

  app.get("/api/products/:id/units", requireAuth, async (req, res) => {
    return res.json(await storage.getProductUnits(Number(req.params.id)));
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
    await storage.deactivateProductUnit(Number(req.params.id));
    return res.json({ ok: true });
  });

  app.patch("/api/product-units/:id/adjust", requireAuth, async (req, res) => {
    try {
      const { adjustment, notes } = z.object({ adjustment: z.number(), notes: z.string().optional() }).parse(req.body);
      const pu = await storage.adjustProductUnitStock(Number(req.params.id), adjustment, notes);
      return res.json(pu);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  // ─── Price History ─────────────────────────────────────────────────────────
  app.get("/api/price-history/:customerId/:productId", requireAuth, async (req, res) => {
    const record = await storage.getLastPrice(Number(req.params.customerId), Number(req.params.productId));
    return res.json(record ?? null);
  });

  // ─── Purchases ─────────────────────────────────────────────────────────────
  app.get("/api/purchases", requireAuth, async (req, res) => {
    return res.json(await storage.getPurchases());
  });

  app.get("/api/purchases/next-folio", requireAuth, async (req, res) => {
    return res.json({ folio: await storage.generatePurchaseFolio() });
  });

  app.get("/api/purchases/:id", requireAuth, async (req, res) => {
    const p = await storage.getPurchase(Number(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    return res.json(p);
  });

  app.post("/api/purchases", requireAuth, async (req, res) => {
    try {
      const data = insertPurchaseSchema.parse(req.body);
      const purchase = await storage.createPurchase({
        folio: data.folio,
        supplierName: data.supplierName,
        purchaseDate: new Date(data.purchaseDate as unknown as string),
        notes: data.notes ?? undefined,
        createdBy: req.session.userId!,
        items: data.items as any,
      });
      return res.status(201).json(purchase);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  // ─── Stock Movements ───────────────────────────────────────────────────────
  app.get("/api/stock-movements", requireAuth, async (req, res) => {
    const productId = req.query.productId ? Number(req.query.productId) : undefined;
    return res.json(await storage.getStockMovements(productId));
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

  // Update a single order item's price
  app.patch("/api/orders/:id/items/:itemId", requireAuth, async (req, res) => {
    try {
      const { pricePerUnit } = z.object({ pricePerUnit: z.string() }).parse(req.body);
      const item = await storage.updateOrderItemPrice(Number(req.params.id), Number(req.params.itemId), pricePerUnit);
      return res.json(item);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
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

  app.post("/api/orders/:id/approve", requireAuth, async (req, res) => {
    try {
      const order = await storage.approveOrder(Number(req.params.id), req.session.userId!);
      return res.json(order);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
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
  app.get("/api/load-list", requireAuth, async (req, res) => {
    const date = req.query.date as string;
    if (!date) return res.status(400).json({ error: "date query param required" });
    return res.json(await storage.getLoadList(date));
  });

  return httpServer;
}
