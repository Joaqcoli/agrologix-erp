import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCustomerSchema, insertProductSchema, insertPurchaseSchema } from "@shared/schema";
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

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  if (req.session.userRole !== "admin") return res.status(403).json({ error: "Admin required" });
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
    const list = await storage.getCustomers();
    return res.json(list);
  });

  app.get("/api/customers/:id", requireAuth, async (req, res) => {
    const c = await storage.getCustomer(Number(req.params.id));
    if (!c) return res.status(404).json({ error: "Not found" });
    return res.json(c);
  });

  app.post("/api/customers", requireAuth, async (req, res) => {
    try {
      const data = insertCustomerSchema.parse(req.body);
      const c = await storage.createCustomer(data);
      return res.status(201).json(c);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/customers/:id", requireAuth, async (req, res) => {
    try {
      const data = insertCustomerSchema.partial().parse(req.body);
      const c = await storage.updateCustomer(Number(req.params.id), data);
      return res.json(c);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/customers/:id", requireAuth, async (req, res) => {
    await storage.deleteCustomer(Number(req.params.id));
    return res.json({ ok: true });
  });

  // ─── Products ──────────────────────────────────────────────────────────────
  app.get("/api/products", requireAuth, async (req, res) => {
    const list = await storage.getProducts();
    return res.json(list);
  });

  app.get("/api/products/:id", requireAuth, async (req, res) => {
    const p = await storage.getProduct(Number(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    return res.json(p);
  });

  app.post("/api/products", requireAuth, async (req, res) => {
    try {
      const data = insertProductSchema.parse(req.body);
      const p = await storage.createProduct(data);
      return res.status(201).json(p);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/products/:id", requireAuth, async (req, res) => {
    try {
      const data = insertProductSchema.partial().parse(req.body);
      const p = await storage.updateProduct(Number(req.params.id), data);
      return res.json(p);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/products/:id", requireAuth, async (req, res) => {
    await storage.deleteProduct(Number(req.params.id));
    return res.json({ ok: true });
  });

  // ─── Purchases ─────────────────────────────────────────────────────────────
  app.get("/api/purchases", requireAuth, async (req, res) => {
    const list = await storage.getPurchases();
    return res.json(list);
  });

  app.get("/api/purchases/next-folio", requireAuth, async (req, res) => {
    const folio = await storage.generateFolio();
    return res.json({ folio });
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
    const list = await storage.getStockMovements(productId);
    return res.json(list);
  });

  return httpServer;
}
