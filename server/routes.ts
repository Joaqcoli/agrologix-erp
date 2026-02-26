import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCustomerSchema, insertProductSchema, insertPurchaseSchema, insertOrderSchema } from "@shared/schema";
import { z } from "zod";

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
    return res.json(await storage.getProducts());
  });

  app.get("/api/products/:id", requireAuth, async (req, res) => {
    const p = await storage.getProduct(Number(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    return res.json(p);
  });

  app.post("/api/products", requireAuth, async (req, res) => {
    try {
      const data = insertProductSchema.parse(req.body);
      return res.status(201).json(await storage.createProduct(data));
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/products/:id", requireAuth, async (req, res) => {
    try {
      const data = insertProductSchema.partial().parse(req.body);
      return res.json(await storage.updateProduct(Number(req.params.id), data));
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/products/:id", requireAuth, async (req, res) => {
    await storage.deleteProduct(Number(req.params.id));
    return res.json({ ok: true });
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
    return res.json(await storage.getOrders());
  });

  app.get("/api/orders/next-folio", requireAuth, async (req, res) => {
    return res.json({ folio: await storage.generateOrderFolio() });
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
