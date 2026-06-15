import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { storage } from "./storage";
import { db } from "./db";
import { sql as drizzleSql } from "drizzle-orm";
import { insertCustomerSchema, insertProductSchema, insertPurchaseSchema, insertOrderSchema, insertPaymentSchema, insertWithholdingSchema, insertSupplierSchema, insertSupplierPaymentSchema, insertPriceListItemSchema, insertCajaMovementSchema } from "@shared/schema";
import { z } from "zod";
import { canonicalizeUnit } from "@shared/units";
import { getHistoricalMonthStats } from "./historical-stats";
import { getLastVoucher, createVoucher } from "./arca";
import { syncMpReport } from "./mp-report-sync";

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


function requireVendedor(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  if (req.session.userRole !== "vendedor" && req.session.userRole !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// Encargado de galpón: solo galpon + admin. Los endpoints /api/galpon/* (próximos bloques)
// NUNCA deben devolver precios de venta, costos de venta ni márgenes.
function requireGalpon(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  if (req.session.userRole !== "galpon" && req.session.userRole !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// ─── Seguridad por rol: LISTA BLANCA CENTRAL (un solo lugar) ──────────────────
// Define, por ROL, qué prefijos de /api/* puede llamar. Si un rol aparece acá es
// DEFAULT-DENY: todo lo que NO matchee su lista responde 403 (aunque el endpoint
// use solo requireAuth → caja/costos/proveedores/bancos nunca salen para ese rol).
// Roles SIN entrada (admin) = acceso total. Para sumar un rol o cambiar permisos,
// editar SOLO este mapa.
export const ROLE_API_WHITELIST: Record<string, string[]> = {
  galpon:   ["/api/galpon/", "/api/auth/"],
  vendedor: ["/api/vendedor/", "/api/auth/"],
  // admin: sin entrada → acceso total.
  // operator: cuenta deprecada, desactivada a nivel login (users.active=false). Sin entrada acá.
};

// Pura y testeable: decide si un rol puede llamar a un path de /api/*.
export function isApiAllowedForRole(role: string | undefined, path: string): boolean {
  if (!role || !path.startsWith("/api/")) return true;
  const allowed = ROLE_API_WHITELIST[role];
  if (!allowed) return true; // rol sin lista blanca (admin) → acceso total
  return allowed.some((prefix) => path.startsWith(prefix));
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ─── Default-deny por rol (lista blanca central ROLE_API_WHITELIST) ───────────
  // Mismo patrón que tenía el galpón, ahora generalizado a la tabla de arriba:
  // cada rol con lista blanca solo puede llamar a sus prefijos; el resto 403.
  app.use((req, res, next) => {
    if (!isApiAllowedForRole(req.session?.userRole, req.path)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  });

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

  // Diagnostic: show raw cost data for a product (temp endpoint)
  app.get("/api/debug/product-cost", requireAuth, async (req, res) => {
    try {
      const name = (req.query.name as string) ?? "";
      const rows = await db.execute(drizzleSql`
        SELECT
          p.id, p.name,
          pu.unit, pu.avg_cost, pu.stock_qty, pu.weight_per_unit, pu.base_unit,
          pi.id AS pi_id, pi.purchase_unit, pi.unit AS pi_unit,
          pi.cost_per_unit, pi.cost_per_purchase_unit,
          pi.quantity, pi.purchase_qty, pi.weight_per_package, pi.subtotal,
          sm.id AS sm_id, sm.movement_type, sm.unit_cost AS sm_unit_cost,
          sm.quantity AS sm_qty, sm.notes, sm.reference_type
        FROM products p
        LEFT JOIN product_units pu ON pu.product_id = p.id
        LEFT JOIN purchase_items pi ON pi.product_id = p.id
        LEFT JOIN stock_movements sm ON sm.product_id = p.id
        WHERE LOWER(p.name) ILIKE ${('%' + name.toLowerCase() + '%')}
        ORDER BY pi.id DESC, sm.id DESC
        LIMIT 30
      `);
      return res.json(rows.rows);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/dashboard/rinde-detail", requireAuth, async (req, res) => {
    try {
      const { from, to } = req.query as { from?: string; to?: string };
      if (!from || !to) return res.status(400).json({ error: "from and to are required" });
      // Unidad base del movimiento vía subconsulta LATERAL (una sola fila): la quantity del rinde
      // está en unidad base. Un producto puede tener varias filas base (ej. KG y UNIDAD); un JOIN
      // directo a product_units multiplicaría el movimiento. Elegimos la fila base no-envase real:
      // preferir la que tiene costo > 0, luego mayor stock. Garantiza UNA fila por movimiento.
      const rows = await db.execute(drizzleSql`
        SELECT
          sm.id,
          sm.created_at,
          p.name AS product_name,
          sm.quantity::float AS quantity,
          base_pu.unit,
          sm.unit_cost::float AS unit_cost,
          (sm.quantity::numeric * COALESCE(sm.unit_cost::numeric, 0))::float AS total,
          sm.notes
        FROM stock_movements sm
        JOIN products p ON p.id = sm.product_id
        LEFT JOIN LATERAL (
          SELECT pu.unit
          FROM product_units pu
          WHERE pu.product_id = sm.product_id
            AND pu.base_unit IS NOT NULL
            AND pu.unit NOT IN ('CAJON','BOLSA','BANDEJA')
          ORDER BY (pu.avg_cost::numeric > 0) DESC, pu.stock_qty::numeric DESC
          LIMIT 1
        ) base_pu ON true
        WHERE sm.created_at >= ${from}::timestamp
          AND sm.created_at < ${to}::timestamp
          AND sm.notes ILIKE '%Rinde%'
        ORDER BY sm.created_at DESC
      `);
      return res.json(rows.rows);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // Detalle de Merma — mismo patrón que rinde-detail, filtrando movimientos de merma
  app.get("/api/dashboard/merma-detail", requireAuth, async (req, res) => {
    try {
      const { from, to } = req.query as { from?: string; to?: string };
      if (!from || !to) return res.status(400).json({ error: "from and to are required" });
      const rows = await db.execute(drizzleSql`
        SELECT
          sm.id,
          sm.created_at,
          p.name AS product_name,
          sm.quantity::float AS quantity,
          base_pu.unit,
          sm.unit_cost::float AS unit_cost,
          (sm.quantity::numeric * COALESCE(sm.unit_cost::numeric, 0))::float AS total,
          sm.notes
        FROM stock_movements sm
        JOIN products p ON p.id = sm.product_id
        LEFT JOIN LATERAL (
          SELECT pu.unit
          FROM product_units pu
          WHERE pu.product_id = sm.product_id
            AND pu.base_unit IS NOT NULL
            AND pu.unit NOT IN ('CAJON','BOLSA','BANDEJA')
          ORDER BY (pu.avg_cost::numeric > 0) DESC, pu.stock_qty::numeric DESC
          LIMIT 1
        ) base_pu ON true
        WHERE sm.created_at >= ${from}::timestamp
          AND sm.created_at < ${to}::timestamp
          AND sm.notes ILIKE '%Merma%'
        ORDER BY sm.created_at DESC
      `);
      return res.json(rows.rows);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
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

  // GET /api/products/:id/purchase-history — last purchases for cost breakdown
  app.get("/api/products/:id/purchase-history", requireAuth, async (req, res) => {
    try {
      const rows = await storage.getProductPurchaseHistory(Number(req.params.id));
      return res.json(rows);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // GET /api/products/:id/last-price?customerId=X&unit=Y — last approved sale price for this product+customer+unit
  app.get("/api/products/:id/last-price", requireAuth, async (req, res) => {
    try {
      const customerId = Number(req.query.customerId);
      const unit = String(req.query.unit ?? "KG");
      if (!customerId) return res.status(400).json({ error: "customerId required" });
      const price = await storage.getLastPriceByUnit(Number(req.params.id), customerId, unit);
      return res.json({ price });
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
      const { adjustment, notes, avgCost, weightPerUnit } = z.object({
        adjustment: z.number().default(0),
        notes: z.string().optional(),
        avgCost: z.number().nonnegative().optional(),
        weightPerUnit: z.number().nonnegative().optional(),
      }).parse(req.body);
      const pu = await storage.adjustProductUnitStock(Number(req.params.id), adjustment, notes, avgCost, weightPerUnit);
      return res.json(pu);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  // ─── Stock Movements (adjustment history) ──────────────────────────────────
  app.get("/api/stock-movements", requireAuth, async (req, res) => {
    try {
      return res.json(await storage.getAdjustmentMovements());
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // Revertir (total o parcial) un ajuste de merma/rinde — limitado a hoy/ayer
  app.post("/api/stock-movements/:id/revert", requireAuth, async (req, res) => {
    try {
      const { qty } = z.object({ qty: z.number().positive() }).parse(req.body);
      const result = await storage.revertStockAdjustment(Number(req.params.id), qty);
      return res.json(result);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
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

  app.post("/api/stock/set", requireAuth, async (req, res) => {
    try {
      const { items, mode } = z.object({
        items: z.array(z.object({
          productId: z.number().int().positive(),
          unit: z.string().min(1),
          qty: z.number().min(0),
        })).min(1),
        mode: z.enum(["merma_rinde", "correction"]),
      }).parse(req.body);
      await storage.setStockAdjustments(items, mode);
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

  // Sugerencia de peso por envase: último weight_per_package usado para ese producto+proveedor.
  // Solo sugerencia para la pantalla de compra; null si no hay compras previas de esa combinación.
  app.get("/api/purchases/last-weight", requireAuth, async (req, res) => {
    try {
      const productId = Number(req.query.productId);
      const supplierId = Number(req.query.supplierId);
      if (!productId || !supplierId) return res.json({ weightPerPackage: null });
      const w = await storage.getLastWeightForProductSupplier(productId, supplierId);
      return res.json({ weightPerPackage: w });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
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
        supplierId: z.number().int().positive().nullable().optional(),
        affectsStock: z.boolean().optional(),
        purchaseDate: z.string(),
        notes: z.string().optional(),
        totalEmptyCost: z.string().optional(),
        items: z.array(z.object({
          productId: z.number().int().positive(),
          quantity: z.string(),
          unit: z.enum(["KG", "UNIDAD", "CAJON", "BOLSA", "ATADO", "MAPLE", "BANDEJA"]),
          costPerUnit: z.string(),
          costPerPurchaseUnit: z.string().optional(),
          purchaseQty: z.string().optional(),
          purchaseUnit: z.enum(["KG", "UNIDAD", "CAJON", "BOLSA", "ATADO", "MAPLE", "BANDEJA"]).optional(),
          weightPerPackage: z.string().optional(),
          affectsStock: z.boolean().optional(),
        })).min(1),
      });
      const data = schema.parse(req.body);
      const purchase = await storage.updatePurchase(Number(req.params.id), {
        ...data,
        purchaseDate: new Date(data.purchaseDate),
        totalEmptyCost: data.totalEmptyCost,
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
        totalEmptyCostExtra: (data as any).totalEmptyCostExtra ?? undefined,
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
          pricePerUnit: z.string().nullable().optional(),
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
        isBonification: z.boolean().optional(),
      });
      const patch = schema.parse(req.body);

      // Bolsa FV solo permitida para clientes con bolsa_fv = true
      if (patch.bolsaType && ['bolsa', 'bolsa_propia'].includes(patch.bolsaType)) {
        if (!(order.customer as any).bolsaFv) {
          return res.status(403).json({ error: "Este cliente no tiene habilitada la opción Bolsa FV" });
        }
      }

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

  // GET /api/orders/:id/stock-check — pre-flight: qué ítems tienen stock insuficiente
  app.get("/api/orders/:id/stock-check", requireAuth, async (req, res) => {
    try {
      const issues = await storage.checkOrderStock(Number(req.params.id));
      return res.json(issues);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.post("/api/orders/:id/approve", requireAuth, async (req, res) => {
    try {
      const decisions = req.body?.decisions as Record<number, "zero" | "rinde" | "prorate"> | undefined;
      const order = await storage.approveOrder(Number(req.params.id), req.session.userId!, decisions);
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

  // PATCH /api/orders/:id/remito-num — update remito number inline
  app.patch("/api/orders/:id/remito-num", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { remitoNum } = req.body as { remitoNum?: number | null };
      await storage.updateOrderRemitoNum(id, remitoNum ?? null);
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

  // ─── Black Pot Excel Export ────────────────────────────────────────────────
  app.post("/api/orders/export-blackpot-excel", requireAuth, async (req, res) => {
    try {
      const { orderIds } = z.object({ orderIds: z.array(z.number()).min(1) }).parse(req.body);
      const MONTHS_ES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

      const wb = new ExcelJS.Workbook();
      wb.creator = "AgroLogix ERP";

      // Nombres de hoja únicos: si se repite un colegio (varios pedidos), agrega " 2", " 3"…
      // (Excel limita el nombre de hoja a 31 caracteres, así que se recorta la base para que entre el sufijo.)
      const usedSheetNames = new Set<string>();
      const uniqueSheetName = (base: string): string => {
        const b = base || "Hoja";
        if (!usedSheetNames.has(b.toLowerCase())) { usedSheetNames.add(b.toLowerCase()); return b; }
        let n = 2;
        while (true) {
          const suffix = ` ${n}`;
          const cand = b.slice(0, 31 - suffix.length) + suffix;
          if (!usedSheetNames.has(cand.toLowerCase())) { usedSheetNames.add(cand.toLowerCase()); return cand; }
          n++;
        }
      };

      for (const id of orderIds) {
        const order = await storage.getOrder(id);
        if (!order) continue;

        const customer = order.customer;
        const schoolName = customer.name;
        const address = [customer.address, customer.city].filter(Boolean).join(", ");
        const remitoStr = order.remitoNum != null ? String(order.remitoNum).padStart(6, "0") : "";
        const d = new Date(order.orderDate);
        const dateStr = `${d.getDate()}-${MONTHS_ES[d.getMonth()]}`;

        const baseName = schoolName.replace(/[\\\/\?\*\[\]:]/g, "").slice(0, 31) || `Pedido-${id}`;
        const sheetName = uniqueSheetName(baseName);
        const ws = wb.addWorksheet(sheetName);

        ws.columns = [
          { width: 10 },  // A CANTIDAD
          { width: 10 },  // B UNIDAD
          { width: 32 },  // C PRODUCTO
          { width: 14 },  // D PRECIO
          { width: 14 },  // E TOTAL
          { width: 16 },  // F TOTAL + IVA
        ];

        // Row 1 — school header
        ws.mergeCells("A1:D1");
        const r1 = ws.getRow(1);
        r1.getCell("A").value = `COLEGIO ${schoolName}${address ? ` - ${address}` : ""}`;
        r1.getCell("A").font = { name: "Arial", bold: true, size: 11 };
        r1.getCell("A").alignment = { vertical: "middle" };
        r1.getCell("E").value = remitoStr ? `rto: ${remitoStr}` : "";
        r1.getCell("E").font = { name: "Arial", size: 10 };
        r1.getCell("F").value = dateStr;
        r1.getCell("F").font = { name: "Arial", size: 10 };
        r1.height = 18;
        r1.commit();

        // Row 2 — invoice
        ws.mergeCells("A2:D2");
        const r2 = ws.getRow(2);
        r2.getCell("A").value = "";
        r2.getCell("E").value = "Factura Nro:";
        r2.getCell("E").font = { name: "Arial", size: 10 };
        r2.getCell("F").value = order.invoiceNumber ?? "";
        r2.getCell("F").font = { name: "Arial", size: 10 };
        r2.commit();

        // Row 3 — column headers
        const r3 = ws.getRow(3);
        ["CANTIDAD","UNIDAD","PRODUCTO","PRECIO","TOTAL","TOTAL + IVA"].forEach((h, i) => {
          const cell = r3.getCell(i + 1);
          cell.value = h;
          cell.font = { name: "Arial", bold: true, size: 10 };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
          cell.alignment = { horizontal: i >= 3 ? "right" : "left" };
        });
        r3.commit();

        // Item rows
        const startRow = 4;
        let rowIdx = startRow;
        for (const item of order.items) {
          if ((item as any).bolsaType) continue;
          const productName = (item.product?.name ?? (item as any).rawProductName ?? "") as string;
          const pCat = ((item.product as any)?.category ?? "").toUpperCase() as string;
          const isHuevo = productName.toUpperCase().includes("HUEVO") || productName.toUpperCase().includes("MAPLE") || pCat.includes("HUEVO");
          const ivaRate = isHuevo ? 0.21 : 0.105;
          const subtotal = parseFloat(String(item.subtotal ?? "0"));
          const totalConIva = parseFloat((subtotal * (1 + ivaRate)).toFixed(2));

          const row = ws.getRow(rowIdx);
          row.getCell(1).value = parseFloat(String(item.quantity));
          row.getCell(1).font = { name: "Arial", size: 10 };
          row.getCell(2).value = item.unit as string;
          row.getCell(2).font = { name: "Arial", size: 10 };
          row.getCell(3).value = productName;
          row.getCell(3).font = { name: "Arial", size: 10 };
          row.getCell(4).value = parseFloat(String(item.pricePerUnit ?? "0"));
          row.getCell(4).numFmt = '"$"#,##0.00';
          row.getCell(4).font = { name: "Arial", size: 10 };
          row.getCell(4).alignment = { horizontal: "right" };
          row.getCell(5).value = subtotal;
          row.getCell(5).numFmt = '"$"#,##0.00';
          row.getCell(5).font = { name: "Arial", size: 10 };
          row.getCell(5).alignment = { horizontal: "right" };
          row.getCell(6).value = totalConIva;
          row.getCell(6).numFmt = '"$"#,##0.00';
          row.getCell(6).font = { name: "Arial", size: 10 };
          row.getCell(6).alignment = { horizontal: "right" };
          row.commit();
          rowIdx++;
        }

        const endRow = rowIdx - 1;

        // Total row
        const tr = ws.getRow(rowIdx);
        tr.getCell(3).value = "TOTAL";
        tr.getCell(3).font = { name: "Arial", bold: true, size: 10 };
        tr.getCell(5).value = endRow >= startRow ? { formula: `SUM(E${startRow}:E${endRow})` } : 0;
        tr.getCell(5).numFmt = '"$"#,##0.00';
        tr.getCell(5).font = { name: "Arial", bold: true, size: 10 };
        tr.getCell(5).alignment = { horizontal: "right" };
        tr.getCell(6).value = endRow >= startRow ? { formula: `SUM(F${startRow}:F${endRow})` } : 0;
        tr.getCell(6).numFmt = '"$"#,##0.00';
        tr.getCell(6).font = { name: "Arial", bold: true, size: 10 };
        tr.getCell(6).alignment = { horizontal: "right" };
        tr.commit();
      }

      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const today = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Disposition", `attachment; filename="BLACK_POT_${today}.xlsx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      return res.send(buf);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
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

  // Export "lista de compra" — solo faltantes, agrupados por categoría, listo para imprimir
  app.get("/api/load-list/export-compra", requireAuth, async (req, res) => {
    try {
      const date = req.query.date as string;
      if (!date) return res.status(400).json({ error: "date query param required" });
      const data = await storage.getLoadListByDate(date, true);

      // Filas "duda" que el usuario confirmó como ya cubiertas por stock (key = productId-unit) → excluir
      const excludeSet = new Set(((req.query.exclude as string) || "").split(",").filter(Boolean));

      // Solo filas con faltante real (diffQty < 0), salvo las confirmadas como cubiertas
      const shortages = data.rows.filter((r) => r.diffQty < 0 && !excludeSet.has(`${r.productId}-${r.unit}`));

      const CATEGORY_ORDER = [
        "Fruta", "Verdura", "Hortaliza Liviana", "Hortaliza Pesada", "Hongos/Hierbas", "Huevos",
      ];
      // Agrupar por categoría
      const byCategory = new Map<string, typeof shortages>();
      for (const cat of CATEGORY_ORDER) byCategory.set(cat, []);
      for (const row of shortages) {
        const cat = CATEGORY_ORDER.includes(row.category) ? row.category : "Verdura";
        byCategory.get(cat)!.push(row);
      }

      const [d, m, y] = date.split("-").reverse();
      const dateLabel = `${d}/${m}/${y}`;

      const wb = new ExcelJS.Workbook();
      wb.creator = "AgroLogix ERP";
      const ws = wb.addWorksheet("Lista de Compra");

      ws.columns = [
        { width: 30 },  // PRODUCTO
        { width: 10 },  // UNIDAD
        { width: 12 },  // CANTIDAD
      ];

      // Fila título
      const titleRow = ws.addRow([`LISTA DE COMPRA — ${dateLabel}`, "", ""]);
      ws.mergeCells(`A${titleRow.number}:C${titleRow.number}`);
      titleRow.getCell(1).font = { name: "Arial", bold: true, size: 13 };
      titleRow.getCell(1).alignment = { horizontal: "center" };
      titleRow.height = 22;
      titleRow.commit();

      // Fila vacía
      ws.addRow([]).commit();

      // Colores por categoría
      const CAT_COLORS: Record<string, string> = {
        "Fruta":              "FFFCE4EC",
        "Verdura":            "FFE8F5E9",
        "Hortaliza Liviana":  "FFE3F2FD",
        "Hortaliza Pesada":   "FFEDE7F6",
        "Hongos/Hierbas":     "FFFFF8E1",
        "Huevos":             "FFFFF3E0",
      };
      const CAT_TEXT: Record<string, string> = {
        "Fruta":              "FF880E4F",
        "Verdura":            "FF1B5E20",
        "Hortaliza Liviana":  "FF0D47A1",
        "Hortaliza Pesada":   "FF4A148C",
        "Hongos/Hierbas":     "FFF57F17",
        "Huevos":             "FFE65100",
      };

      for (const cat of CATEGORY_ORDER) {
        const rows = byCategory.get(cat) ?? [];
        if (rows.length === 0) continue;

        // Encabezado de categoría
        const catRow = ws.addRow([cat.toUpperCase(), "", ""]);
        ws.mergeCells(`A${catRow.number}:C${catRow.number}`);
        catRow.getCell(1).font = { name: "Arial", bold: true, size: 10, color: { argb: CAT_TEXT[cat] ?? "FF000000" } };
        catRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CAT_COLORS[cat] ?? "FFF5F5F5" } };
        catRow.getCell(1).alignment = { horizontal: "left", indent: 1 };
        catRow.height = 16;
        catRow.commit();

        // Encabezados de columna
        const hRow = ws.addRow(["PRODUCTO", "UNIDAD", "CANTIDAD"]);
        hRow.eachCell((cell) => {
          cell.font = { name: "Arial", bold: true, size: 9 };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };
          cell.alignment = { horizontal: "center" };
          cell.border = { bottom: { style: "thin", color: { argb: "FFBDBDBD" } } };
        });
        hRow.height = 14;
        hRow.commit();

        // Items
        for (const row of rows.sort((a, b) => a.productName.localeCompare(b.productName))) {
          // Valor exacto con 2 decimales para TODAS las unidades (incl. envases).
          // Sin Math.ceil: un faltante de 0.5 cajón debe mostrarse 0.5, no redondear a 1.
          const toBuy = Math.abs(row.diffQty);
          const qtyValue = parseFloat(toBuy.toFixed(2));

          const itemRow = ws.addRow([row.productName, row.unit, qtyValue]);
          itemRow.getCell(1).font = { name: "Arial", size: 10 };
          itemRow.getCell(2).font = { name: "Arial", size: 10 };
          itemRow.getCell(2).alignment = { horizontal: "center" };
          itemRow.getCell(3).font = { name: "Arial", bold: true, size: 10 };
          itemRow.getCell(3).alignment = { horizontal: "right" };
          if (row.unit.toUpperCase() === "KG") {
            itemRow.getCell(3).numFmt = '#,##0.00" KG"';
          } else {
            // 0.## → muestra decimales exactos sin redondear (0.5 → "0.5", 2 → "2")
            itemRow.getCell(3).numFmt = `#,##0.##" ${row.unit}"`;
          }
          itemRow.height = 15;
          itemRow.commit();
        }

        // Separador
        ws.addRow([]).commit();
      }

      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      res.setHeader("Content-Disposition", `attachment; filename="lista-compra-${date}.xlsx"`);
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

      // Tomar snapshot del estado pendiente ANTES de crear el pago para calcular
      // montos exactos por remito sin interferencia del nuevo pago en el pool FIFO.
      const pendingSnapshot = await storage.getPendingOrdersForCustomer(data.customerId);

      const payment = await storage.createPayment(data, req.session.userId!);

      if (orderIds.length > 0) {
        // Calcular cuánto de este pago se aplica a cada remito seleccionado
        const pendingMap = new Map(
          pendingSnapshot.map((o) => [o.id, Math.max(0, parseFloat(o.total) - parseFloat(o.paidAmount))]),
        );
        const pendingOrderMap = new Map(pendingSnapshot.map((o) => [o.id, o]));

        // Ordenar seleccionados por fecha (más viejo primero)
        const sortedIds = [...orderIds].sort((a, b) => {
          const pA = pendingOrderMap.get(a);
          const pB = pendingOrderMap.get(b);
          if (!pA && !pB) return a - b;
          if (!pA) return 1;
          if (!pB) return -1;
          if (pA.orderDate < pB.orderDate) return -1;
          if (pA.orderDate > pB.orderDate) return 1;
          return a - b;
        });

        let remaining = parseFloat(String(data.amount));
        const amounts = new Map<number, number>();
        for (const orderId of sortedIds) {
          if (remaining <= 0) break;
          const orderRem = pendingMap.get(orderId) ?? 0;
          const toApply = Math.min(remaining, orderRem);
          if (toApply > 0) {
            amounts.set(orderId, toApply);
            remaining -= toApply;
          }
        }

        await storage.linkPaymentToOrders(payment.id, orderIds, amounts);
      } else {
        // Auto-aplicar: vincular al pedido más viejo primero hasta cubrir el monto
        await storage.autoApplyPaymentToOrders(payment.id, data.customerId, parseFloat(String(data.amount)), pendingSnapshot);
      }
      // Ajustar saldo de cuenta si cuentaId fue indicado (solo banco/efectivo, nunca MP)
      const cuentaId = req.body.cuentaId ? Number(req.body.cuentaId) : null;
      if (cuentaId) {
        await storage.createMovimientoCuenta({
          cuentaId, signo: "ingreso", monto: parseFloat(String(data.amount)),
          concepto: `Cobro cliente`, origenTipo: "cobro", origenId: String(payment.id),
        });
      }
      // Si pago con cheque, crear cheque recibido + movimiento en Cheques en cartera
      if (data.method === "CHEQUE" && req.body.chequeInfo?.fechaCobro) {
        const customer = await storage.getCustomer(data.customerId);
        const contraparte = customer?.name ?? "Cliente";
        const allCuentas = await storage.getCuentasFinancieras();
        const chequeCuenta = (allCuentas as any[]).find((c: any) => c.tipo === "cheque");
        const cheque = await storage.createCheque({
          tipo: "recibido",
          monto: parseFloat(String(data.amount)),
          fechaCobro: req.body.chequeInfo.fechaCobro,
          estado: "en_cartera",
          contraparte,
          notas: data.notes ?? null,
        });
        if (chequeCuenta) {
          await storage.createMovimientoCuenta({
            cuentaId: chequeCuenta.id, signo: "ingreso",
            monto: parseFloat(String(data.amount)),
            concepto: `Cheque de ${contraparte}`,
            origenTipo: "cheque_recibido", origenId: String(cheque.id),
          });
        }
      }
      return res.json(payment);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  // PATCH /api/payments/:id
  app.patch("/api/payments/:id", requireAuth, async (req, res) => {
    try {
      const { date, amount, method, notes } = req.body;
      if (!date || !amount || !method) return res.status(400).json({ error: "date, amount and method required" });
      const updated = await storage.updatePayment(Number(req.params.id), { date, amount: String(amount), method, notes: notes ?? null });
      return res.json(updated);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/payments/:id
  app.delete("/api/payments/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteMovimientoCuentaByOrigen("cobro", req.params.id);
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
  // GET /api/ap/cc/summary?month=2&year=2026  OR  ?dateFrom=...&dateTo=...
  app.get("/api/ap/cc/summary", requireAuth, async (req, res) => {
    try {
      const range = parseCCDateRange(req.query as Record<string, any>);
      if (!range) return res.status(400).json({ error: "Invalid date params" });
      return res.json(await storage.getAPCCSummary(range.startDate, range.endDate));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // GET /api/ap/cc/export?month=2&year=2026 — resumen CC proveedores en XLSX
  app.get("/api/ap/cc/export", requireAuth, async (req, res) => {
    try {
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);
      if (!month || !year) return res.status(400).json({ error: "Invalid params" });
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endMonth = month === 12 ? 1 : month + 1;
      const endYear = month === 12 ? year + 1 : year;
      const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
      const data = await storage.getAPCCSummary(startDate, endDate);
      const monthName = new Date(year, month - 1, 1).toLocaleString("es-AR", { month: "long", year: "numeric" });

      const wb = XLSX.utils.book_new();
      const sheetData = [
        ["Proveedor", "Saldo Anterior", "Facturación", "Pagos", "Saldo Actual", "% Deuda"],
        ...data.suppliers.map((r) => [
          r.supplierName, r.saldoMesAnterior, r.facturacion, r.cobranza, r.saldo,
          parseFloat(r.pct.toFixed(2)),
        ]),
        ["TOTAL", data.totals.saldoMesAnterior, data.totals.facturacion, data.totals.cobranza, data.totals.saldo, ""],
      ];
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, "CC Proveedores");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="CC-Proveedores-${monthName}.xlsx"`);
      return res.send(buf);
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
      const cuentaId = req.body.cuentaId ? Number(req.body.cuentaId) : null;
      if (cuentaId) {
        await storage.createMovimientoCuenta({
          cuentaId, signo: "egreso", monto: parseFloat(String(data.amount)),
          concepto: `Pago proveedor`, origenTipo: "pago", origenId: String(payment.id),
        });
      }
      // Circuito cheques para pagos a proveedores
      if (data.method === "CHEQUE") {
        const chequeInfo = req.body.chequeInfo as {
          tipo?: "cartera" | "propio"; chequeCarteraId?: number; fechaCobro?: string;
        } | undefined;
        const allCuentas = await storage.getCuentasFinancieras();
        const chequeCuenta = (allCuentas as any[]).find((c: any) => c.tipo === "cheque");

        if (chequeInfo?.tipo === "cartera" && chequeInfo.chequeCarteraId) {
          // Endosar cheque de cartera (vinculado al pago para poder revertir si se borra)
          await storage.patchCheque(chequeInfo.chequeCarteraId, { estado: "endosado", supplierPaymentId: payment.id });
          if (chequeCuenta) {
            const supplier = await storage.getSupplier(data.supplierId);
            await storage.createMovimientoCuenta({
              cuentaId: chequeCuenta.id, signo: "egreso",
              monto: parseFloat(String(data.amount)),
              concepto: `Cheque endosado a ${supplier?.name ?? "proveedor"}`,
              origenTipo: "cheque_endosado", origenId: String(chequeInfo.chequeCarteraId),
            });
          }
        } else if (chequeInfo?.tipo === "propio" && chequeInfo.fechaCobro) {
          // Cheque propio: crear obligacion + cheque emitido (Galicia no baja hasta pagar la obligacion)
          const supplier = await storage.getSupplier(data.supplierId);
          const supplierName = supplier?.name ?? "Proveedor";
          const obs = await storage.createObligaciones([{
            concepto: `Cheque propio — ${supplierName}`,
            tipo: "proveedor",
            monto: parseFloat(String(data.amount)),
            fechaVencimiento: chequeInfo.fechaCobro,
            notas: data.notes ?? null,
          }]);
          await storage.createCheque({
            tipo: "emitido",
            monto: parseFloat(String(data.amount)),
            fechaCobro: chequeInfo.fechaCobro,
            estado: "en_cartera",
            contraparte: supplierName,
            supplierId: data.supplierId, // vínculo por ID (contraparte se mantiene por compat)
            obligacionId: obs[0].id,
            supplierPaymentId: payment.id, // permite limpiar cheque+obligación si se borra el pago
          });
        }
      }
      return res.json(payment);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/ap/payments/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteMovimientoCuentaByOrigen("pago", req.params.id);
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

  // ─── Vendedor ───────────────────────────────────────────────────────────────
  app.get("/api/vendedor/dashboard", requireVendedor, async (req, res) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      const { from, to } = req.query as { from?: string; to?: string };
      if (!from || !to) return res.status(400).json({ error: "from and to are required" });

      const salesRow = await db.execute(drizzleSql`
        SELECT
          COALESCE(SUM(
            CASE
              WHEN oi.price_per_unit::numeric = 0 THEN 0
              WHEN c.has_iva = true AND (p.name ILIKE '%huevo%' OR p.category ILIKE '%huevo%')
                THEN oi.quantity::numeric * oi.price_per_unit::numeric * 1.21
              WHEN c.has_iva = true
                THEN oi.quantity::numeric * oi.price_per_unit::numeric * 1.105
              ELSE oi.quantity::numeric * oi.price_per_unit::numeric
            END
          ), 0) AS ventas,
          COALESCE(SUM(
            CASE
              WHEN oi.price_per_unit::numeric = 0 THEN 0
              ELSE c.commission_pct::numeric / 100 * oi.quantity::numeric * oi.price_per_unit::numeric
            END
          ), 0) AS comisiones
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.status = 'approved'
          AND o.order_date >= ${from}::timestamp
          AND o.order_date < ${to}::timestamp
          AND c.salesperson_name = ${user.name}
      `);

      const clientesRow = await db.execute(drizzleSql`
        SELECT COUNT(*)::int AS total
        FROM customers
        WHERE salesperson_name = ${user.name} AND active = true
      `);

      const r = (salesRow.rows as any[])[0] ?? {};
      const clientesTotal = ((clientesRow.rows as any[])[0]?.total) ?? 0;
      let ventas = parseFloat(r.ventas ?? "0");
      let comisiones = parseFloat(r.comisiones ?? "0");
      // Si el rango es exactamente un mes con histórico cargado (sin pedidos), usar esos valores
      const ym = from.slice(0, 7);
      const [yy, mm] = from.split("-").map(Number);
      const nextFirst = mm === 12 ? `${yy + 1}-01-01` : `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
      const isFullMonth = from === `${ym}-01` && to === nextFirst;
      const ov = storage.vendedorHistOverride(user.name, ym);
      if (isFullMonth && ov) { ventas = ov.facturacion; comisiones = ov.comisiones; }
      return res.json({
        ventas,
        comisiones,
        clientesAsignados: Number(clientesTotal),
      });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/vendedor/dashboard-monthly", requireVendedor, async (req, res) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      return res.json(await storage.getVendedorMonthly(user.name));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/vendedor/dashboard-extra", requireVendedor, async (req, res) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      return res.json(await storage.getVendedorDashboardExtra(user.name));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/vendedor/orders", requireVendedor, async (req, res) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      const { date } = req.query as { date?: string };

      const rows = await db.execute(drizzleSql`
        SELECT
          o.id,
          o.folio,
          o.order_date::text AS "orderDate",
          o.status,
          o.total::text AS total,
          o.remito_num AS "remitoNum",
          c.name AS "customerName",
          c.has_iva AS "hasIva",
          c.commission_pct::text AS "commissionPct",
          COUNT(oi.id)::int AS "itemCount",
          COALESCE(SUM(
            CASE
              WHEN oi.price_per_unit::numeric = 0 THEN 0
              WHEN c.has_iva = true AND (p.name ILIKE '%huevo%' OR p.category ILIKE '%huevo%')
                THEN oi.quantity::numeric * oi.price_per_unit::numeric * 1.21
              WHEN c.has_iva = true
                THEN oi.quantity::numeric * oi.price_per_unit::numeric * 1.105
              ELSE oi.quantity::numeric * oi.price_per_unit::numeric
            END
          ), 0)::text AS "totalConIva"
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE c.salesperson_name = ${user.name}
          ${date ? drizzleSql`AND o.order_date::date = ${date}::date` : drizzleSql``}
        GROUP BY o.id, o.folio, o.order_date, o.status, o.total, o.remito_num, c.name, c.has_iva, c.commission_pct
        ORDER BY o.order_date DESC, o.id DESC
      `);
      return res.json(rows.rows);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/vendedor/orders/:id", requireVendedor, async (req, res) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      const order = await storage.getOrder(Number(req.params.id));
      if (!order) return res.status(404).json({ error: "Not found" });
      if (order.customer.salespersonName !== user.name && req.session.userRole !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
      }
      // Strip cost fields from items
      const safeItems = order.items.map(({ costPerUnit: _c, overrideCostPerUnit: _oc, margin: _m, ...rest }: any) => rest);
      return res.json({ ...order, items: safeItems });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/vendedor/customers", requireVendedor, async (req, res) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      const rows = await db.execute(drizzleSql`
        SELECT * FROM customers
        WHERE salesperson_name = ${user.name} AND active = true
        ORDER BY name
      `);
      return res.json(rows.rows);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── Lista de Precios ──────────────────────────────────────────────────────
  app.get("/api/price-list", requireAuth, async (_req, res) => {
    try { return res.json(await storage.getPriceList()); }
    catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/price-list", requireAuth, async (req, res) => {
    try {
      const data = insertPriceListItemSchema.parse(req.body);
      return res.status(201).json(await storage.createPriceListItem(data));
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/price-list/:id", requireAuth, async (req, res) => {
    try {
      const data = insertPriceListItemSchema.partial().parse(req.body);
      return res.json(await storage.updatePriceListItem(Number(req.params.id), data));
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/price-list/:id", requireAuth, async (req, res) => {
    try {
      await storage.deletePriceListItem(Number(req.params.id));
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/price-list/reorder", requireAuth, async (req, res) => {
    try {
      const { ids } = req.body as { ids: number[] };
      await storage.reorderPriceListItems(ids);
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/vendedor/customers", requireVendedor, async (req, res) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      const data = insertCustomerSchema.parse({ ...req.body, salespersonName: user.name });
      return res.status(201).json(await storage.createCustomer(data));
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/vendedor/customers/:id", requireVendedor, async (req, res) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      const customer = await storage.getCustomer(Number(req.params.id));
      if (!customer) return res.status(404).json({ error: "Not found" });
      if (customer.salespersonName !== user.name && req.session.userRole !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
      }
      const data = insertCustomerSchema.partial().parse(req.body);
      return res.json(await storage.updateCustomer(Number(req.params.id), data));
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  // ─── GALPÓN (requireGalpon) — NUNCA devolver costos/precios/márgenes ──────────
  app.get("/api/galpon/stock", requireGalpon, async (_req, res) => {
    try {
      return res.json(await storage.getGalponStock());
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/galpon/products/:id/purchase-history", requireGalpon, async (req, res) => {
    try {
      return res.json(await storage.getGalponProductPurchaseHistory(Number(req.params.id)));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // Corregir SOLO el peso por envase de una línea de compra (dispara recálculo de costo/stock).
  // La respuesta NO incluye costos: solo confirma el guardado.
  app.patch("/api/galpon/purchase-item/:id", requireGalpon, async (req, res) => {
    try {
      const weight = parseFloat(req.body?.weightPerPackage);
      if (!(weight > 0)) return res.status(400).json({ error: "Peso inválido" });
      const result = await storage.galponSetPurchaseItemWeight(Number(req.params.id), weight);
      return res.json(result);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.get("/api/galpon/products", requireGalpon, async (_req, res) => {
    try {
      return res.json(await storage.getGalponProducts());
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── GALPÓN: Pedidos (sin precios/costos/márgenes) ───────────────────────────
  app.get("/api/galpon/orders", requireGalpon, async (req, res) => {
    try {
      return res.json(await storage.getGalponOrders((req.query.date as string) || undefined));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/galpon/orders/:id", requireGalpon, async (req, res) => {
    try {
      const o = await storage.getGalponOrder(Number(req.params.id));
      if (!o) return res.status(404).json({ error: "Pedido no encontrado" });
      return res.json(o);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // El galpón solo edita pedidos en BORRADOR (no toca stock; se materializa al aprobar el admin).
  async function galponAssertDraft(orderId: number, res: Response): Promise<any | null> {
    const order = await storage.getOrder(orderId);
    if (!order) { res.status(404).json({ error: "Pedido no encontrado" }); return null; }
    if (order.status !== "draft") { res.status(400).json({ error: "Solo se pueden editar pedidos en borrador" }); return null; }
    return order;
  }

  app.patch("/api/galpon/orders/:id/items/:itemId", requireGalpon, async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const order = await galponAssertDraft(orderId, res);
      if (!order) return;
      // SOLO cantidad/unidad/producto — se ignora cualquier campo de precio/costo
      const patch: any = {};
      if (req.body.quantity !== undefined) patch.quantity = String(req.body.quantity);
      if (req.body.unit !== undefined) patch.unit = String(req.body.unit);
      if (req.body.productId !== undefined) patch.productId = req.body.productId;
      await storage.updateOrderItem(orderId, Number(req.params.itemId), patch, order.customerId);
      return res.json({ ok: true });
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.post("/api/galpon/orders/:id/items", requireGalpon, async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const order = await galponAssertDraft(orderId, res);
      if (!order) return;
      await storage.addOrderItem(orderId, {
        quantity: String(req.body.quantity),
        unit: String(req.body.unit),
        productId: req.body.productId ?? null,
      });
      return res.json({ ok: true });
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/galpon/orders/:id/items/:itemId", requireGalpon, async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const order = await galponAssertDraft(orderId, res);
      if (!order) return;
      await storage.deleteOrderItem(orderId, Number(req.params.itemId));
      return res.json({ ok: true });
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  app.post("/api/galpon/orders/:id/confirm", requireGalpon, async (req, res) => {
    try {
      const result = await storage.confirmGalponOrder(Number(req.params.id), req.session.userId!);
      return res.json(result);
    } catch (e: any) { return res.status(400).json({ error: e.message }); }
  });

  // ─── Facturas Electrónicas ARCA ───────────────────────────────────────────────

  // Diagnóstico WSAA — solo para admin, eliminar en producción estable
  app.get("/api/invoices/wsaa-test", requireAuth, async (req, res) => {
    const certRaw  = process.env.ARCA_CERT ?? "";
    const keyRaw   = process.env.ARCA_KEY  ?? "";
    const certNorm = certRaw.replace(/\\n/g, "\n").trim();
    const keyNorm  = keyRaw.replace(/\\n/g, "\n").trim();

    const certLines = certNorm.split("\n");
    const certInfo = {
      hasBeginCert:    certLines[0]?.includes("BEGIN CERTIFICATE"),
      hasEndCert:      certLines[certLines.length - 1]?.includes("END CERTIFICATE"),
      lineCount:       certLines.length,
      firstLine:       certLines[0],
      lastLine:        certLines[certLines.length - 1],
      totalChars:      certNorm.length,
      rawHasLiteralNewlines: certRaw.includes("\\n"),
      rawHasCR: certRaw.includes("\r"),
      rawHasQuotes: certRaw.startsWith('"') || certRaw.startsWith("'"),
    };
    const keyLines = keyNorm.split("\n");
    const keyInfo = {
      hasBeginKey:  keyLines[0]?.includes("BEGIN"),
      hasEndKey:    keyLines[keyLines.length - 1]?.includes("END"),
      lineCount:    keyLines.length,
      firstLine:    keyLines[0],
    };

    // Try to parse the cert with node-forge
    let certParsed: any = null;
    try {
      const forgeImport = await import("node-forge");
      const forge = (forgeImport as any).default ?? forgeImport;
      const cert = forge.pki.certificateFromPem(certNorm);
      certParsed = {
        subject: cert.subject.attributes.map((a: any) => `${a.shortName}=${a.value}`).join(", "),
        issuer:  cert.issuer.attributes.map((a: any) => `${a.shortName}=${a.value}`).join(", "),
        validFrom: cert.validity.notBefore,
        validTo:   cert.validity.notAfter,
        serialNumber: cert.serialNumber,
      };
    } catch (err: any) {
      certParsed = { parseError: err.message };
    }

    // Try calling WSAA
    let wsaaResult: any = null;
    try {
      const { getLastVoucher: glv } = await import("./arca");
      const last = await glv(6);
      wsaaResult = { ok: true, lastFacturaB: last };
    } catch (e: any) {
      wsaaResult = { ok: false, error: e.message };
    }

    return res.json({ certInfo, keyInfo, certParsed, wsaaResult });
  });
  app.post("/api/invoices/create", requireAuth, async (req, res) => {
    try {
      const { orderId, invoiceType, description, condicionIva, ivaIncluido } = z.object({
        orderId: z.number(),
        invoiceType: z.enum(["A", "B", "C"]),
        description: z.string().optional(),
        /** 1=Resp.Inscripto 4=Exento 5=ConsumidorFinal 6=Monotributista 13=MonotributistaSocial */
        condicionIva: z.number().int().default(5),
        /** true = el subtotal del ítem ya incluye IVA → calcular neto dividiendo */
        ivaIncluido: z.boolean().default(false),
      }).parse(req.body);

      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
      if (order.status !== "approved") return res.status(400).json({ error: "El pedido debe estar aprobado" });

      const customer = order.customer;
      // If child client → bill to parent (they hold the CUIT)
      const billingCustomer = customer.parentCustomerId
        ? (await storage.getCustomer(customer.parentCustomerId) ?? customer)
        : customer;
      if (invoiceType === "A" && !billingCustomer.cuit) {
        return res.status(400).json({ error: "El cliente (ni su cliente padre) tiene CUIT registrado" });
      }
      // Auto-prepend child name to description so the invoice identifies the source
      const effectiveDescription = customer.parentCustomerId && customer.name !== billingCustomer.name
        ? `${customer.name}${description ? ` — ${description}` : ""}`
        : (description ?? null);

      // Calculate IVA breakdown
      let neto105 = 0, iva105 = 0, neto21 = 0, iva21 = 0;
      for (const item of order.items) {
        const pName = (item.product?.name ?? item.rawProductName ?? "").toUpperCase();
        const pCat = (item.product as any)?.category ?? "";
        const isHuevo = pName.includes("HUEVO") || pName.includes("MAPLE") || pCat.toUpperCase().includes("HUEVO");
        const sub = parseFloat(item.subtotal ?? "0") || 0;
        // Para Factura B el precio ya incluye IVA (no discriminado).
        // Para Factura A con ivaIncluido=true, ídem.
        const rate = isHuevo ? IVA_HUEVO : IVA_DEFAULT;
        const netSub = (invoiceType === "B" || ivaIncluido) ? sub / (1 + rate) : sub;
        if (isHuevo) {
          neto21 += netSub;
          iva21  += netSub * IVA_HUEVO;
        } else {
          neto105 += netSub;
          iva105  += netSub * IVA_DEFAULT;
        }
      }
      const totalNeto = neto105 + neto21;
      const totalIVA  = iva105 + iva21;

      if (!isFinite(totalNeto) || !isFinite(totalIVA)) {
        throw new Error(`Total del pedido inválido: neto=${totalNeto}, iva=${totalIVA}. Verificar precios de los ítems.`);
      }

      // Map type → AFIP code
      const cbteTipo = invoiceType === "A" ? 1 : invoiceType === "B" ? 6 : 11;

      const lastVoucher = await getLastVoucher(cbteTipo);
      const nextNumber = lastVoucher + 1;

      const docTipo = invoiceType === "A" ? 80 : 99;
      const docNro  = invoiceType === "A" ? parseInt((billingCustomer.cuit ?? "").replace(/\D/g, "")) : 0;

      const now = new Date();
      const cbteDate = parseInt(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`);

      const iva: { Id: number; BaseImp: number; Importe: number }[] = [];
      if (neto105 > 0) iva.push({ Id: 4, BaseImp: parseFloat(neto105.toFixed(2)), Importe: parseFloat(iva105.toFixed(2)) });
      if (neto21  > 0) iva.push({ Id: 5, BaseImp: parseFloat(neto21.toFixed(2)),  Importe: parseFloat(iva21.toFixed(2))  });

      const { CAE, CAEFchVto } = await createVoucher({
        CantReg: 1,
        PtoVta: 4,
        CbteTipo: cbteTipo,
        Concepto: 1,
        DocTipo: docTipo,
        DocNro: docNro,
        CbteDesde: nextNumber,
        CbteHasta: nextNumber,
        CbteFch: cbteDate,
        ImpTotal: parseFloat((totalNeto + totalIVA).toFixed(2)),
        ImpTotConc: 0,
        ImpNeto: parseFloat(totalNeto.toFixed(2)),
        ImpOpEx: 0,
        ImpIVA: parseFloat(totalIVA.toFixed(2)),
        ImpTrib: 0,
        MonId: "PES",
        MonCotiz: 1,
        CondicionIVAReceptorId: condicionIva,
        Iva: iva,
      });

      const formattedNumber = `${invoiceType}-0004-${String(nextNumber).padStart(8, "0")}`;
      const invoice = await storage.createInvoice({
        orderId,
        customerId: billingCustomer.id,
        invoiceType,
        invoiceNumber: formattedNumber,
        pointOfSale: 4,
        cae: String(CAE),
        caeExpiry: String(CAEFchVto),
        total: String((totalNeto + totalIVA).toFixed(2)),
        ivaAmount: String(totalIVA.toFixed(2)),
        condicionIvaReceptorId: condicionIva,
        description: effectiveDescription,
      });

      await storage.updateOrderInvoiceNumber(orderId, formattedNumber);

      return res.json(invoice);
    } catch (e: any) {
      return res.status(500).json({ error: e.message ?? "Error emitiendo factura" });
    }
  });

  app.get("/api/invoices", requireAuth, async (req, res) => {
    try {
      const customerId = req.query.customerId ? Number(req.query.customerId) : undefined;
      const orderId    = req.query.orderId    ? Number(req.query.orderId)    : undefined;
      const from = req.query.from as string | undefined;
      const to   = req.query.to   as string | undefined;
      return res.json(await storage.getInvoices({ customerId, orderId, from, to }));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/invoices/:id", requireAuth, async (req, res) => {
    try {
      const inv = await storage.getInvoiceById(Number(req.params.id));
      if (!inv) return res.status(404).json({ error: "Factura no encontrada" });
      return res.json(inv);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/invoices/:id/credit-note", requireAuth, async (req, res) => {
    try {
      const invoiceId = Number(req.params.id);
      const { condicionIva } = z.object({ condicionIva: z.number().int().optional() }).parse(req.body);

      const invData = await storage.getInvoiceById(invoiceId);
      if (!invData) return res.status(404).json({ error: "Factura no encontrada" });

      const existing = await storage.getCreditNoteByInvoiceId(invoiceId);
      if (existing) return res.status(400).json({ error: "Ya existe una nota de crédito para esta factura" });

      const { invoice, customer, order } = invData;

      // NC type codes — A=3, B=8, C=13
      const ncTypes: Record<string, number> = { A: 3, B: 8, C: 13 };
      const origTypes: Record<string, number> = { A: 1, B: 6, C: 11 };
      const ncCbteTipo  = ncTypes[invoice.invoiceType];
      const origCbteTipo = origTypes[invoice.invoiceType];
      if (!ncCbteTipo) return res.status(400).json({ error: "Tipo de factura no soportado para NC" });

      // Original voucher number extracted from invoiceNumber (e.g. "A-0004-00000001" → 1)
      const origNumber = parseInt(invoice.invoiceNumber.split("-").pop() ?? "0", 10);

      const lastVoucher = await getLastVoucher(ncCbteTipo);
      const nextNumber  = lastVoucher + 1;

      // Recalculate IVA breakdown from order items (same logic as invoice creation)
      let neto105 = 0, iva105 = 0, neto21 = 0, iva21 = 0;
      for (const item of order.items) {
        const pName = ((item.product?.name ?? (item as any).rawProductName ?? "") as string).toUpperCase();
        const pCat  = ((item.product as any)?.category ?? "") as string;
        const isHuevo = pName.includes("HUEVO") || pName.includes("MAPLE") || pCat.toUpperCase().includes("HUEVO");
        const sub  = parseFloat((item as any).subtotal ?? "0") || 0;
        const rate = isHuevo ? IVA_HUEVO : IVA_DEFAULT;
        const isFacturaB = invoice.invoiceType === "B";
        const netSub = isFacturaB ? sub / (1 + rate) : sub;
        if (isHuevo) { neto21 += netSub; iva21 += netSub * IVA_HUEVO; }
        else         { neto105 += netSub; iva105 += netSub * IVA_DEFAULT; }
      }
      const totalNeto = neto105 + neto21;
      const totalIVA  = iva105 + iva21;

      const iva: { Id: number; BaseImp: number; Importe: number }[] = [];
      if (neto105 > 0) iva.push({ Id: 4, BaseImp: parseFloat(neto105.toFixed(2)), Importe: parseFloat(iva105.toFixed(2)) });
      if (neto21  > 0) iva.push({ Id: 5, BaseImp: parseFloat(neto21.toFixed(2)),  Importe: parseFloat(iva21.toFixed(2))  });

      const docTipo  = invoice.invoiceType === "A" ? 80 : 99;
      const docNro   = invoice.invoiceType === "A" ? parseInt((customer.cuit ?? "").replace(/\D/g, "")) : 0;
      // condicionIva from request body > stored in invoice > fallback by type
      const condicion = condicionIva ?? (invoice as any).condicionIvaReceptorId ?? (invoice.invoiceType === "A" ? 1 : 5);

      const now = new Date();
      const cbteDate = parseInt(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`);

      const { CAE, CAEFchVto } = await createVoucher({
        CantReg: 1,
        PtoVta: 4,
        CbteTipo: ncCbteTipo,
        Concepto: 1,
        DocTipo: docTipo,
        DocNro: docNro,
        CbteDesde: nextNumber,
        CbteHasta: nextNumber,
        CbteFch: cbteDate,
        ImpTotal: parseFloat((totalNeto + totalIVA).toFixed(2)),
        ImpTotConc: 0,
        ImpNeto: parseFloat(totalNeto.toFixed(2)),
        ImpOpEx: 0,
        ImpIVA: parseFloat(totalIVA.toFixed(2)),
        ImpTrib: 0,
        MonId: "PES",
        MonCotiz: 1,
        CondicionIVAReceptorId: condicion,
        Iva: iva,
        CbtesAsoc: [{ Tipo: origCbteTipo, PtoVta: 4, Nro: origNumber }],
      });

      const formattedNumber = `NC-${invoice.invoiceType}-0004-${String(nextNumber).padStart(8, "0")}`;
      const creditNote = await storage.createCreditNote({
        invoiceId,
        customerId: invoice.customerId,
        creditNoteType: invoice.invoiceType,
        creditNoteNumber: formattedNumber,
        pointOfSale: 4,
        cae: String(CAE),
        caeExpiry: String(CAEFchVto),
        total: String((totalNeto + totalIVA).toFixed(2)),
        ivaAmount: String(totalIVA.toFixed(2)),
        condicionIvaReceptorId: condicion,
        description: `NC de ${invoice.invoiceNumber}`,
      });

      // Clear invoice number from order so it can be re-invoiced
      await storage.updateOrderInvoiceNumber(invoice.orderId, null);

      return res.json(creditNote);
    } catch (e: any) {
      return res.status(500).json({ error: e.message ?? "Error emitiendo nota de crédito" });
    }
  });

  // ─── Socios & Retiros ─────────────────────────────────────────────────────
  app.get("/api/caja/socios", requireAuth, async (_req, res) => {
    try { return res.json(await storage.getSocios()); }
    catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/caja/retiros", requireAuth, async (_req, res) => {
    try { return res.json(await storage.getCajaRetiros()); }
    catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/caja/retiros", requireAuth, async (req, res) => {
    try {
      const { socioId, monto, fecha, notas } = req.body;
      if (!socioId || !monto || !fecha) return res.status(400).json({ error: "socioId, monto, fecha requeridos" });
      const retiro = await storage.createRetiro({
        socioId: parseInt(socioId), monto: parseFloat(monto),
        fecha, origen: "manual", notas: notas || null,
      });
      return res.json(retiro);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/caja/retiros/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteRetiro(parseInt(req.params.id));
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── Cuentas Financieras ──────────────────────────────────────────────────
  app.get("/api/caja/cuentas", requireAuth, async (_req, res) => {
    try {
      return res.json(await storage.getCuentasFinancieras());
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.put("/api/caja/cuentas/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const saldoBase = parseFloat(req.body.saldo_base);
      if (isNaN(id) || isNaN(saldoBase)) return res.status(400).json({ error: "Datos inválidos" });
      await storage.updateCuentaFinanciera(id, saldoBase);
      const cuentas = await storage.getCuentasFinancieras();
      return res.json(cuentas.find(c => c.id === id) ?? {});
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── Caja ───────────────────────────────────────────────────────────────────
  app.get("/api/caja/summary", requireAuth, async (req, res) => {
    try {
      const from = (req.query.from as string) || new Date().toISOString().slice(0, 10);
      const to   = (req.query.to   as string) || new Date().toISOString().slice(0, 10);
      return res.json(await storage.getCajaSummary(from, to));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/caja/movements", requireAuth, async (req: any, res) => {
    try {
      const parsed = insertCajaMovementSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const m = await storage.createCajaMovement(parsed.data as any, req.session.userId!);
      const cuentaId = req.body.cuentaId ? Number(req.body.cuentaId) : null;
      if (cuentaId) {
        await storage.createMovimientoCuenta({
          cuentaId, signo: parsed.data.type, monto: parseFloat(String(parsed.data.amount)),
          concepto: parsed.data.description ?? "", origenTipo: "manual", origenId: String(m.id),
        });
      }
      // Auto-crear retiro si categoría = "Retiro" y viene socioId
      if (parsed.data.category === "Retiro" && req.body.socioId) {
        const socioId = parseInt(req.body.socioId);
        if (!isNaN(socioId)) {
          await storage.createRetiro({
            socioId, monto: parseFloat(String(parsed.data.amount)),
            fecha: parsed.data.date, origen: "movimiento",
            movimientoRef: String(m.id),
            notas: parsed.data.description ?? null,
          });
        }
      }
      return res.json(m);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/caja/movements/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteMovimientoCuentaByOrigen("manual", req.params.id);
      await storage.deleteRetiroByMovimientoRef(req.params.id);
      await storage.deleteCajaMovement(Number(req.params.id));
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/caja/trend", requireAuth, async (req, res) => {
    try {
      const months = Math.min(24, Math.max(2, parseInt(req.query.months as string) || 6));
      return res.json(await storage.getCajaTrend(months));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/caja/balance", requireAuth, async (_req, res) => {
    try {
      return res.json(await storage.getCajaBalance());
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── Cheques ─────────────────────────────────────────────────────────────────
  app.get("/api/caja/cheques", requireAuth, async (_req, res) => {
    try { return res.json(await storage.getCheques()); }
    catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // Crear cheque en cartera manualmente
  app.post("/api/caja/cheques", requireAuth, async (req, res) => {
    try {
      const { monto, fechaCobro, contraparte, notas } = req.body;
      if (!monto || !fechaCobro || !contraparte) return res.status(400).json({ error: "Campos requeridos: monto, fechaCobro, contraparte" });
      const cheque = await storage.createCheque({
        tipo: "recibido", monto: parseFloat(monto), fechaCobro,
        estado: "en_cartera", contraparte, notas: notas ?? null,
      });
      return res.json(cheque);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // Eliminar cheque en cartera
  app.delete("/api/caja/cheques/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const cheque = (await storage.getCheques() as any[]).find((c: any) => c.id === id);
      if (!cheque) return res.status(404).json({ error: "Cheque no encontrado" });
      if (cheque.estado === "depositado" || cheque.estado === "cobrado")
        return res.status(400).json({ error: "No se puede eliminar un cheque depositado o cobrado" });
      await storage.deleteCheque(id);
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/caja/cheques/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { accion, comision, contraparte, cuentaDestinoId, monto, fechaCobro } = req.body;
      const allCuentas = await storage.getCuentasFinancieras();
      const chequeCuenta = (allCuentas as any[]).find((c: any) => c.tipo === "cheque");
      const galiciaCuenta = (allCuentas as any[]).find((c: any) => c.tipo === "banco");

      const todosCheques = await storage.getCheques();
      const cheque = (todosCheques as any[]).find((c: any) => c.id === id);
      if (!cheque) return res.status(404).json({ error: "Cheque no encontrado" });
      if (cheque.estado !== "en_cartera") return res.status(400).json({ error: "El cheque no está en cartera" });

      if (accion === "depositar") {
        const comisionNum = parseFloat(comision ?? 0) || 0;
        const destinoId = cuentaDestinoId ? parseInt(cuentaDestinoId) : galiciaCuenta?.id;
        await storage.patchCheque(id, { estado: "depositado", cuentaDestinoId: destinoId ?? null, comision: comisionNum });
        if (chequeCuenta) {
          await storage.createMovimientoCuenta({
            cuentaId: chequeCuenta.id, signo: "egreso", monto: cheque.monto,
            concepto: `Cheque depositado de ${cheque.contraparte}`,
            origenTipo: "cheque_depositado", origenId: String(id),
          });
        }
        if (destinoId) {
          await storage.createMovimientoCuenta({
            cuentaId: destinoId, signo: "ingreso", monto: cheque.monto - comisionNum,
            concepto: `Depósito cheque de ${cheque.contraparte}`,
            origenTipo: "cheque_deposito_destino", origenId: String(id),
          });
        }
      } else if (accion === "endosar") {
        const nuevaContraparte = contraparte || cheque.contraparte;
        await storage.patchCheque(id, { estado: "endosado", contraparte: nuevaContraparte });
        if (chequeCuenta) {
          await storage.createMovimientoCuenta({
            cuentaId: chequeCuenta.id, signo: "egreso", monto: cheque.monto,
            concepto: `Cheque endosado a ${nuevaContraparte}`,
            origenTipo: "cheque_endosado", origenId: String(id),
          });
        }
      } else if (accion === "editar") {
        // Editar datos del cheque en cartera (monto, fecha de cobro, de quién)
        await storage.patchCheque(id, {
          ...(monto !== undefined ? { monto: parseFloat(monto) } : {}),
          ...(fechaCobro !== undefined ? { fechaCobro } : {}),
          ...(contraparte !== undefined ? { contraparte } : {}),
        });
      }
      return res.json(await storage.getCheques().then(cs => (cs as any[]).find(c => c.id === id)));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── Obligaciones ────────────────────────────────────────────────────────────
  app.get("/api/caja/obligaciones", requireAuth, async (_req, res) => {
    try { return res.json(await storage.getObligaciones()); }
    catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/caja/obligaciones/:id/pagos", requireAuth, async (req, res) => {
    try {
      return res.json(await storage.getObligacionPagos(parseInt(req.params.id)));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/caja/obligaciones", requireAuth, async (req, res) => {
    try {
      const { concepto, tipo, monto, moneda, fechaVencimiento, notas, cuotas, cuotaInicial, mensual } = req.body;
      if (!concepto || !tipo || !monto || !fechaVencimiento)
        return res.status(400).json({ error: "Campos requeridos: concepto, tipo, monto, fechaVencimiento" });

      const currency = moneda ?? "ARS";
      const n = parseInt(cuotas) || 1;
      if (n <= 1) {
        const created = await storage.createObligaciones([{ concepto, tipo, monto: parseFloat(monto), moneda: currency, fechaVencimiento, notas }]);
        return res.json(created[0]);
      }

      const startAt = Math.max(1, Math.min(parseInt(cuotaInicial) || 1, n));
      const grupoCuota = `gc-${Date.now()}`;
      const items = [];
      let base = new Date(fechaVencimiento + "T12:00:00Z");
      for (let i = startAt; i <= n; i++) {
        // mensual=true → same monto every month (recurring expense like rent/salary)
        // mensual=false (cuotas) → same amount per installment (user enters the per-cuota amount)
        const montoI = parseFloat(monto);
        const vencimiento = `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2,"0")}-${String(base.getUTCDate()).padStart(2,"0")}`;
        const label = mensual ? concepto : `${concepto} ${i} de ${n}`;
        items.push({ concepto: label, tipo, monto: montoI, moneda: currency,
          fechaVencimiento: vencimiento, grupoCuota, numeroCuota: i, totalCuotas: n, notas });
        base.setUTCMonth(base.getUTCMonth() + 1);
      }
      const created = await storage.createObligaciones(items);
      return res.json(created);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/caja/obligaciones/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const { estado, cuentaPagoId, montoPagado, cotizacion } = req.body;

      // Revert mode (marcar como pendiente)
      if (estado === "pendiente") {
        await storage.deleteMovimientoCuentaByOrigen("obligacion", String(id));
        const updated = await storage.patchObligacion(id, { estado: "pendiente", pagadoAt: null, cuentaPagoId: null, pagoParcial: false });
        return res.json(updated);
      }

      // Payment mode: requires montoPagado
      if (montoPagado !== undefined) {
        const montoNum = parseFloat(montoPagado);
        if (isNaN(montoNum) || montoNum <= 0) return res.status(400).json({ error: "Monto inválido" });

        const obs = await storage.getObligaciones();
        const ob = obs.find((o: any) => o.id === id);
        if (!ob) return res.status(404).json({ error: "Obligación no encontrada" });

        const montoOriginal = parseFloat(ob.monto);
        const isFullPayment = montoNum >= montoOriginal;
        const isUSD = (ob.moneda ?? "ARS") === "USD";
        const cotz = cotizacion ? parseFloat(cotizacion) : 1;
        const montoARS = isUSD ? montoNum * cotz : montoNum;

        const patch: Record<string, any> = {
          cuentaPagoId: cuentaPagoId ? parseInt(cuentaPagoId) : null,
        };

        if (isFullPayment) {
          patch.estado = "pagado";
          patch.pagadoAt = new Date().toISOString();
          patch.pagoParcial = false;
        } else {
          // Partial: reduce monto in the obligation's currency, keep pendiente
          patch.estado = "pendiente";
          patch.monto = String(Math.round((montoOriginal - montoNum) * 100) / 100);
          patch.pagoParcial = true;
        }

        const cuentas = await storage.getCuentasFinancieras();
        const cuenta = cuentaPagoId ? cuentas.find((c: any) => c.id === parseInt(cuentaPagoId)) : null;
        const isMP = cuenta?.tipo === "mp";

        // Crear movimiento de cuenta si no es MP
        if (cuenta && !isMP) {
          await storage.createMovimientoCuenta({
            cuentaId: cuenta.id,
            signo: "egreso",
            monto: montoARS,
            concepto: ob.concepto,
            origenTipo: "obligacion",
            origenId: null, // null allows multiple partial payments
          });
        }

        // Crear movimiento en feed de egresos (caja_movements) para no-MP
        if (!isMP) {
          const cuentaTipoMethod = (t: string) => {
            if (t === "efectivo") return "EFECTIVO";
            if (t === "cheque") return "CHEQUE";
            return "TRANSFERENCIA";
          };
          try {
            await storage.createCajaMovement({
              date: new Date().toISOString().slice(0, 10),
              type: "egreso",
              description: ob.concepto,
              amount: String(montoARS),
              category: ob.tipo,
              method: cuenta ? cuentaTipoMethod(cuenta.tipo) : "TRANSFERENCIA",
            }, req.session.userId!);
          } catch (e) { console.error("caja_movement creation failed:", e); }
        }

        const updated = await storage.patchObligacion(id, patch);

        // Registrar el pago (parcial o total) en el historial
        try {
          await storage.addObligacionPago({
            obligacionId: id,
            fecha: new Date().toISOString().slice(0, 10),
            monto: montoNum,
            moneda: ob.moneda ?? "ARS",
            cotizacion: isUSD ? cotz : null,
            montoArs: montoARS,
            cuentaPagoId: cuentaPagoId ? parseInt(cuentaPagoId) : null,
          });
        } catch (e) { console.error("addObligacionPago failed:", e); }

        // Si es pago completo, marcar cheque vinculado como cobrado
        if (isFullPayment) {
          try {
            const linkedCheques = await storage.getCheques();
            for (const ch of (linkedCheques as any[]).filter((c: any) => c.obligacion_id === id)) {
              await storage.patchCheque(ch.id, { estado: "cobrado" });
            }
          } catch {}
        }
        return res.json(updated);
      }

      // Legacy fallback (estado directo)
      const patch: { estado?: string; cuentaPagoId?: number | null; pagadoAt?: string | null } = {};
      if (estado) patch.estado = estado;
      if (cuentaPagoId !== undefined) patch.cuentaPagoId = cuentaPagoId ? parseInt(cuentaPagoId) : null;
      const updated = await storage.patchObligacion(id, patch);
      return res.json(updated);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // Edit obligación (with optional group propagation)
  app.put("/api/caja/obligaciones/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { concepto, tipo, monto, moneda, fechaVencimiento, notas, propagate, pagoParcial } = req.body;

      const obs = await storage.getObligaciones();
      const ob = obs.find((o: any) => o.id === id);
      if (!ob) return res.status(404).json({ error: "Obligación no encontrada" });

      const editData: Record<string, any> = {};
      if (concepto !== undefined) editData.concepto = concepto;
      if (tipo !== undefined) editData.tipo = tipo;
      if (monto !== undefined) editData.monto = String(parseFloat(monto));
      if (moneda !== undefined) editData.moneda = moneda;
      if (fechaVencimiento !== undefined) editData.fechaVencimiento = fechaVencimiento;
      if (notas !== undefined) editData.notas = notas;
      if (pagoParcial !== undefined) editData.pagoParcial = pagoParcial;

      const updated = await storage.patchObligacion(id, editData);

      // Propagate to future group members if requested
      if (propagate && ob.grupo_cuota) {
        const groupData: Record<string, any> = {};
        if (concepto !== undefined) groupData.concepto = concepto;
        if (tipo !== undefined) groupData.tipo = tipo;
        if (monto !== undefined) groupData.monto = String(parseFloat(monto));
        if (moneda !== undefined) groupData.moneda = moneda;
        if (notas !== undefined) groupData.notas = notas;
        await storage.updateObligacionesGrupo(ob.grupo_cuota, id, groupData);
      }

      return res.json(updated);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/caja/obligaciones/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteMovimientoCuentaByOrigen("obligacion", String(id));
      await storage.deleteObligacion(id);
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── Mercado Pago (proxy) ────────────────────────────────────────────────────
  // Cache del merchant user ID (se resuelve una vez, luego se reutiliza)
  let _mpMerchantId: string | null = null;
  async function getMpMerchantId(token: string): Promise<string | null> {
    if (_mpMerchantId) return _mpMerchantId;
    try {
      const ac = new AbortController();
      const t  = setTimeout(() => ac.abort(), 5000);
      try {
        const r = await fetch("https://api.mercadopago.com/v1/users/me", {
          headers: { Authorization: `Bearer ${token}` }, signal: ac.signal,
        });
        if (r.ok) { const d = await r.json(); _mpMerchantId = String(d.id); }
      } finally { clearTimeout(t); }
    } catch {}
    return _mpMerchantId;
  }

  // Diagnostic endpoint — tests multiple MP endpoints and returns which ones respond
  app.get("/api/mp/test", requireAuth, async (_req, res) => {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return res.status(503).json({ error: "MP_ACCESS_TOKEN no configurado" });
    const candidates = [
      "https://api.mercadopago.com/v1/account/balance",
      "https://api.mercadopago.com/v1/payments/search?limit=5",
      "https://api.mercadopago.com/merchant_orders/search?limit=5",
    ];
    const results: Record<string, { status: number; ok: boolean; body: any }> = {};
    for (const url of candidates) {
      try {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const body = await r.json().catch(() => null);
        results[url] = { status: r.status, ok: r.ok, body };
      } catch (e: any) {
        results[url] = { status: 0, ok: false, body: { error: e.message } };
      }
    }
    return res.json(results);
  });

  // Debug: devuelve los primeros 3 pagos crudos (sin normalizar) + merchant_id + users/me
  app.get("/api/mp/raw", requireAuth, async (_req, res) => {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return res.status(503).json({ error: "MP_ACCESS_TOKEN no configurado" });
    try {
      // 1. Obtener info del usuario
      const meRes  = await fetch("https://api.mercadopago.com/v1/users/me", { headers: { Authorization: `Bearer ${token}` } });
      const meBody = await meRes.json();

      // 2. Pagos últimos 30 días con fechas explícitas
      const now  = new Date();
      const from = new Date(now); from.setDate(now.getDate() - 29);
      const pad  = (n: number) => String(n).padStart(2, "0");
      const isoFrom = `${from.getFullYear()}-${pad(from.getMonth()+1)}-${pad(from.getDate())}T00:00:00.000-03:00`;
      const isoTo   = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T23:59:59.999-03:00`;
      const url = `https://api.mercadopago.com/v1/payments/search?range=date_created&begin_date=${encodeURIComponent(isoFrom)}&end_date=${encodeURIComponent(isoTo)}&sort=date_created&criteria=desc&limit=3`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const body = await r.json();

      return res.json({
        me_status: meRes.status,
        me: meBody,
        payments_status: r.status,
        payments: body?.results ?? body,
      });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/mp/balance", requireAuth, async (_req, res) => {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return res.json({ available_balance: null, unavailable: true });
    try {
      const r = await fetch("https://api.mercadopago.com/v1/account/balance", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await r.json();
      if (!r.ok) {
        // Loguear el error exacto para diagnóstico en Render
        console.warn(`[MP balance] HTTP ${r.status}:`, JSON.stringify(body));
        return res.json({ available_balance: null, unavailable: true, _debug: { status: r.status, body } });
      }
      return res.json(body);
    } catch (e: any) {
      console.warn("[MP balance] exception:", e.message);
      return res.json({ available_balance: null, unavailable: true });
    }
  });

  // Diagnostic: returns raw fields of first 10 incoming payments + report list
  app.get("/api/mp/income-diag", requireAuth, async (_req, res) => {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return res.status(503).json({ error: "MP_ACCESS_TOKEN no configurado" });
    try {
      const now = new Date();
      const from = new Date(now); from.setDate(now.getDate() - 60);
      const pad2 = (n: number) => String(n).padStart(2, "0");
      const isoFrom = `${from.getFullYear()}-${pad2(from.getMonth()+1)}-${pad2(from.getDate())}T00:00:00.000-03:00`;
      const isoTo   = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}T23:59:59.999-03:00`;
      const url = `https://api.mercadopago.com/v1/payments/search?range=date_created&begin_date=${encodeURIComponent(isoFrom)}&end_date=${encodeURIComponent(isoTo)}&sort=date_created&criteria=desc&limit=50`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const body = await r.json();
      const payments = body?.results ?? [];

      // Detect merchantId
      const freq = new Map<string, number>();
      for (const p of payments) {
        const cid = String(p.collector_id ?? p.collector?.id ?? "");
        if (cid && cid !== "0") freq.set(cid, (freq.get(cid) ?? 0) + 1);
      }
      let merchantId = "";
      let best = 0;
      for (const [id, n] of freq) { if (n > best) { best = n; merchantId = id; } }

      // Filter income (non-outgoing)
      const income = payments.filter((p: any) => {
        const cid = String(p.collector_id ?? p.collector?.id ?? "");
        return cid === merchantId;
      });

      const diagData = income.slice(0, 10).map((p: any) => ({
        id: p.id,
        date_created: p.date_created,
        operation_type: p.operation_type,
        payment_type_id: p.payment_type_id,
        status: p.status,
        transaction_amount: p.transaction_amount,
        collector_id: p.collector_id,
        payer_id: p.payer_id,
        payer: { id: p.payer?.id, email: p.payer?.email, first_name: p.payer?.first_name, last_name: p.payer?.last_name, identification: p.payer?.identification },
        transaction_details: p.transaction_details,
        description: p.description,
        statement_descriptor: p.statement_descriptor,
      }));

      // Also check report list
      let reportList: any = null;
      try {
        const rl = await fetch("https://api.mercadopago.com/v1/account/release_report/list", { headers: { Authorization: `Bearer ${token}` } });
        reportList = await rl.json();
      } catch (_) {}

      return res.json({ merchantId, totalFetched: payments.length, incomeCount: income.length, diagData, reportList });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/mp/movements", requireAuth, async (req, res) => {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return res.status(503).json({ error: "MP_ACCESS_TOKEN no configurado" });
    try {
      const { from, to, type, status } = req.query as Record<string, string | undefined>;

      // Default: primer día del mes actual
      const now = new Date();
      const pad2 = (n: number) => String(n).padStart(2, "0");
      const firstOfMonth = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
      const effectiveFrom = from ?? firstOfMonth;

      // end_date: explicit `to` param → midnight of that day (ART); no `to` → exact current moment so today's payments are included
      const endDateIso = to ? `${to}T23:59:59.999-03:00` : new Date().toISOString();

      const baseParams = new URLSearchParams();
      baseParams.set("range", "date_created");
      baseParams.set("begin_date", `${effectiveFrom}T00:00:00.000-03:00`);
      baseParams.set("end_date", endDateIso);
      if (status) baseParams.set("status", status);
      baseParams.set("sort", "date_created");
      baseParams.set("criteria", "desc");

      // Paginación completa — MP devuelve máx 50 por request
      const LIMIT = 50;
      const rawPayments: any[] = [];
      let offset = 0;
      let mpData: any = {};

      while (true) {
        const pageParams = new URLSearchParams(baseParams);
        pageParams.set("limit", String(LIMIT));
        pageParams.set("offset", String(offset));
        const url = `https://api.mercadopago.com/v1/payments/search?${pageParams.toString()}`;

        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 15000);
        let r: Response;
        try {
          r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal });
        } finally {
          clearTimeout(timer);
        }

        const body = await r.json();
        if (!r.ok) {
          console.error("[MP movements] error", r.status, JSON.stringify(body));
          return res.status(r.status).json({ error: `MP error ${r.status}`, detail: body });
        }

        mpData = body;
        const page: any[] = body.results ?? body.elements ?? [];
        rawPayments.push(...page);

        const pagingTotal: number = body.paging?.total ?? 0;
        const firstDate = page[0]?.date_created ?? "-";
        const lastDate  = page[page.length - 1]?.date_created ?? "-";
        console.log(`[mp] página offset=${offset} → ${page.length} items, total MP=${pagingTotal} | rango: ${lastDate} → ${firstDate}`);
        // Solo parar en página vacía o parcial — paging.total puede ser inexacto
        if (page.length < LIMIT) break;
        if (offset >= 10000) break;  // límite de seguridad
        offset += LIMIT;
      }
      console.log(`[mp] total fetcheado: ${rawPayments.length} movimientos (${effectiveFrom} → ${to ?? "hoy"})`);


      // ── Detectar merchant ID desde los propios datos (más fiable que /users/me) ──
      // El merchant aparece como payer_id en sus egresos Y como collector_id en sus ingresos.
      // NO usar collector.id anidado (es el ID del cobrador externo, ej. Uber).
      // Solo usar campos top-level: payer_id + collector_id.
      if (!_mpMerchantId) {
        const freq = new Map<string, number>();
        for (const p of rawPayments) {
          const pid = String(p.payer_id ?? "");
          if (pid && pid !== "0") freq.set(pid, (freq.get(pid) ?? 0) + 1);
          const cid = String(p.collector_id ?? "");
          if (cid && cid !== "0") freq.set(cid, (freq.get(cid) ?? 0) + 1);
        }
        let best = 0;
        for (const [id, n] of freq) { if (n > best) { best = n; _mpMerchantId = id; } }
      }
      const merchantId = _mpMerchantId;

      const movements: any[] = rawPayments.map((p: any) => {
        // ── Dirección ─────────────────────────────────────────────────────────
        // payer_id (top-level) para egresos, payer.id para ingresos
        const payerIdRaw   = String(p.payer_id   ?? p.payer?.id   ?? "");
        const collIdRaw    = String(p.collector_id ?? p.collector?.id ?? "");
        // Egreso: yo soy el payer Y no soy el collector (evita falso positivo en self-transfers)
        const isOutgoing   = merchantId
          ? (payerIdRaw === merchantId && collIdRaw !== merchantId)
          : false;

        // ── Monto bruto ───────────────────────────────────────────────────────
        const grossAmount: number = Math.abs(parseFloat(String(p.transaction_amount ?? 0)));

        // ── Comisión desde charges_details (fee_details siempre vacío en este token) ─
        const chargesArr: any[] = Array.isArray(p.charges_details) ? p.charges_details : [];
        const feeAmount: number = chargesArr.length > 0
          ? chargesArr.reduce((s, c) => s + Math.abs(parseFloat(String(c.amounts?.original ?? 0))), 0)
          : 0;

        // ── Neto ──────────────────────────────────────────────────────────────
        // Ingreso: gross - fee = net_received
        // Egreso: gross + fee = total_paid (lo que salió de mi cuenta)
        const netAmount: number = isOutgoing ? grossAmount + feeAmount : grossAmount - feeAmount;

        // ── Nombre de la otra parte ───────────────────────────────────────────
        let displayName: string | null = null;
        if (isOutgoing) {
          // Destinatario: intentar todos los campos disponibles en orden
          const collFirst    = String(p.collector?.first_name ?? "").trim();
          const collLast     = String(p.collector?.last_name  ?? "").trim();
          const collFullName = [collFirst, collLast].filter(Boolean).join(" ");
          const collNick     = String(p.collector?.nickname   ?? "").trim();
          const collEmail    = String(p.collector?.email      ?? "").toLowerCase().trim();
          const stmtDesc     = String(p.statement_descriptor  ?? "").trim();
          const descMatch    = (p.description ?? "").match(/transferencia a (.+)/i);

          if (collFullName) {
            displayName = collFullName;
          } else if (collNick) {
            displayName = collNick;
          } else if (stmtDesc && stmtDesc.toLowerCase() !== "mercadopago") {
            displayName = stmtDesc;
          } else if (descMatch) {
            displayName = descMatch[1].trim();
          } else if (collEmail && !collEmail.includes("noreply")) {
            displayName = collEmail;
          }
        } else {
          // Pagador: email > nombre (first_name/last_name) > descripción del banco
          const email: string = p.payer?.email ?? "";
          const payerFirstName = String(p.payer?.first_name ?? "").trim();
          const payerLastName  = String(p.payer?.last_name  ?? "").trim();
          const payerFullName  = [payerFirstName, payerLastName].filter(Boolean).join(" ");
          const bankOwnerName  = String(p.transaction_details?.payer_bank_info?.owner_name ?? "").trim();
          if (email && email !== "vegetalesargentinos.srl@gmail.com") {
            displayName = email;
          } else if (payerFullName) {
            displayName = payerFullName;
          } else if (bankOwnerName) {
            displayName = bankOwnerName;
          }
        }

        return {
          ...p,
          date_created: p.date_created ?? p.date_approved,
          total: p.transaction_amount ?? p.total,
          type: p.payment_type_id ?? p.operation_type ?? "payment",
          fee: { amount: feeAmount },
          isOutgoing,
          grossAmount,
          feeAmount,
          netAmount,
          displayName,
        };
      });

      // Fetch órdenes del período UNA sola vez con query liviana y linkear en memoria (evita N+1)
      const rangeFrom = effectiveFrom;
      const rangeTo   = to ?? (movements[0]?.date_created ?? "").slice(0, 10);
      let periodOrders: { id: number; folio: string; total: string }[] = [];
      if (rangeFrom && rangeTo) {
        const rows = await db.execute(
          drizzleSql`SELECT id, folio, total FROM orders WHERE order_date::date >= ${rangeFrom}::date AND order_date::date <= ${rangeTo}::date`
        );
        periodOrders = rows.rows as any[];
      }

      const enriched = movements.map((mov: any) => {
        const movAmount = Math.abs(parseFloat(String(mov.total ?? mov.amount ?? 0)));
        if (movAmount === 0) return { ...mov, linkedOrderId: null, linkedOrderFolio: null };
        const linked = (periodOrders as any[]).find((o: any) => {
          const orderTotal = parseFloat(String(o.total ?? "0"));
          return orderTotal > 0 && Math.abs(orderTotal - movAmount) / movAmount <= 0.05;
        });
        return { ...mov, linkedOrderId: linked?.id ?? null, linkedOrderFolio: linked?.folio ?? null };
      });

      // Embed category from DB overrides (tabla puede no existir aún si la migración no corrió)
      const mpIds = enriched.map((m: any) => String(m.id));
      let catMap: Map<string, number | null> = new Map();
      try {
        catMap = await storage.getMpMovementOverridesMap(mpIds);
      } catch (_) { /* tabla no existe todavía, continuar sin categorías */ }

      // Fetch stored payer identifiers from settlement report sync
      let identifierMap: Map<string, any> = new Map();
      try {
        identifierMap = await storage.getMpMovementIdentifierMap(mpIds);
      } catch (_) {}

      // Compute candidate identifiers — separados por dirección del pago
      const withCandidates = enriched.map((m: any) => {
        const candidates: string[] = [];

        if (m.isOutgoing) {
          // EGRESO: identificar al COBRADOR (a quien le pagamos)
          // collector.identification.number = su CUIT/CBU → único y correcto
          const collIdNum = String(m.collector?.identification?.number ?? "").replace(/[\s-]/g, "").toLowerCase();
          if (collIdNum.length >= 10) candidates.push(collIdNum);
          const collId = String(m.collector_id ?? m.collector?.id ?? "");
          if (collId && collId !== "0" && collId !== merchantId) candidates.push(`mp:${collId}`);
          if (m.displayName) candidates.push((m.displayName as string).toLowerCase().trim());
        } else {
          // INGRESO: lógica según operation_type
          const opType: string = String(m.operation_type ?? "").toLowerCase();

          if (opType === "money_transfer") {
            // MP-a-MP (QR, transferencia entre cuentas MP)
            // payer.email es el email real del pagador (si ≠ propio)
            const payEmail = String(m.payer?.email ?? "").toLowerCase().trim();
            if (payEmail && payEmail.includes("@") && payEmail !== "vegetalesargentinos.srl@gmail.com" && !payEmail.includes("noreply")) {
              candidates.push(payEmail);
            } else {
              // Fallback: mp:payer.id si es distinto al merchant
              const payId = String(m.payer_id ?? m.payer?.id ?? "");
              if (payId && payId !== "0" && payId !== merchantId) candidates.push(`mp:${payId}`);
            }
          } else if (opType === "account_fund") {
            // Transferencia bancaria externa — payer.email es siempre el propio, inútil
            // Usar bank_transfer_id como identificador único de la transacción (no reutilizable)
            const btId = String(m.transaction_details?.bank_transfer_id ?? "").trim();
            if (btId && btId !== "0") candidates.push(`bank_transfer:${btId}`);
            // No agregar email ni payer.id (serían nuestros propios datos)
          } else {
            // Otros tipos: intentar por stored identifier o mp:payer.id
            const stored = identifierMap.get(String(m.id));
            if (stored?.payerIdentifier) candidates.push(stored.payerIdentifier.toLowerCase().trim());
            const payId = String(m.payer_id ?? m.payer?.id ?? "");
            if (payId && payId !== "0" && payId !== merchantId) candidates.push(`mp:${payId}`);
          }
        }

        // Nunca usar el propio email como identificador
        const filtered_ = candidates.filter(c => c !== "vegetalesargentinos.srl@gmail.com");
        const rawIdentifier: string | null = filtered_[0] ?? null;
        return { ...m, rawIdentifier, _candidates: filtered_ };
      });

      // Batch lookup — todos los candidatos de todos los movimientos
      const allCandidates = [...new Set(withCandidates.flatMap((m: any) => m._candidates as string[]))];
      let contactsMap: Map<string, any> = new Map();
      try {
        contactsMap = await storage.getBankContactsByIdentifiers(allCandidates);
        // Log diagnóstico (visible en Render)
        console.log(`[contacts] ${withCandidates.length} movimientos → ${allCandidates.length} candidatos → ${contactsMap.size} matches`);
        if (contactsMap.size > 0) console.log(`[contacts] matched keys:`, [...contactsMap.keys()]);
        if (allCandidates.length > 0) console.log(`[contacts] candidatos MP:`, allCandidates.slice(0, 10));
      } catch (e: any) { console.warn("[contacts] lookup failed:", e.message); }

      // Batch-fetch bank_payment_links for all movements
      let paymentLinksMap: Map<string, any[]> = new Map();
      try {
        paymentLinksMap = await storage.getBankPaymentLinksByMovements(mpIds);
      } catch (_) {}

      // ── Fix 1: asegurar contacto Pago Debin en bank_contacts ────────────────
      const PAGO_DEBIN_ID = "pago_debin_propio";
      const PAGO_DEBIN_NAME = "Vegetales Argentinos Galicia";
      try {
        const existing = await storage.getBankContactsByIdentifiers([PAGO_DEBIN_ID]);
        if (!existing.has(PAGO_DEBIN_ID)) {
          await storage.createBankContact({ identifier: PAGO_DEBIN_ID, displayName: PAGO_DEBIN_NAME, type: "banco", entityId: null });
        }
      } catch (_) {}


      const withCats = withCandidates.map((m: any) => {
        const candidates = m._candidates as string[];
        // Primer candidato que matchee en bank_contacts
        const contact = candidates.map(c => contactsMap.get(c.toLowerCase().trim())).find(Boolean);
        const { _candidates: _, ...cleanM } = m;

        // Fix 1: Pago Debin → siempre Vegetales Argentinos Galicia
        const isPayoDebin = !m.isOutgoing && String(m.description ?? "").trim() === "Pago Debin";
        if (isPayoDebin) {
          const debinContact = contactsMap.get(PAGO_DEBIN_ID) ?? { displayName: PAGO_DEBIN_NAME, type: "banco", entityId: null, id: null };
          return {
            ...cleanM,
            categoryId: catMap.get(String(m.id)) ?? null,
            identified: true,
            displayName: PAGO_DEBIN_NAME,
            contactType: debinContact.type ?? "banco",
            entityId: debinContact.entityId ?? null,
            contactId: (debinContact as any).id ?? null,
            bankPaymentLinks: paymentLinksMap.get(String(m.id)) ?? [],
          };
        }

        return {
          ...cleanM,
          categoryId: catMap.get(String(m.id)) ?? null,
          identified: !!contact,
          displayName: contact ? contact.displayName : (m.displayName ?? null),
          contactType: contact?.type ?? null,
          entityId: contact?.entityId ?? null,
          contactId: contact?.id ?? null,
          bankPaymentLinks: paymentLinksMap.get(String(m.id)) ?? [],
        };
      });

      // Reconciliación banco→caja:
      //  (1) movimientos CATEGORIZADOS → su monto principal = transferido (gross), separando la comisión.
      //  (2) TODO movimiento con comisión → un egreso en "Comisiones" (categorizado o no), así el total de
      //      comisiones en egresos coincide con el total del período en Bancos.
      // Solo reescribe lo que cambió (idempotente y barato en cada fetch).
      try {
        const allMovs = (withCats as any[]).filter((m: any) => (m.grossAmount ?? m.netAmount ?? 0) > 0 || (m.feeAmount ?? 0) > 0);
        if (allMovs.length > 0) {
          const allCats = await storage.getBankCategories();
          const catNameMap = new Map(allCats.map(c => [c.id, c.name]));
          const mainAmounts = await storage.getCajaAmountsBySourceIds(allMovs.map(m => `mp:${String(m.id)}`));
          const feeAmounts = await storage.getCajaAmountsBySourceIds(allMovs.map(m => `mp:${String(m.id)}:fee`));
          let syncedMain = 0, syncedFee = 0;
          for (const m of allMovs) {
            const sourceId = `mp:${String(m.id)}`;
            const movDate = (m.date_created ?? "").slice(0, 10);
            const movDesc = String(m.displayName || m.description || (m.isOutgoing ? "Pago banco" : "Cobro banco"));
            const gross = parseFloat(String(m.grossAmount ?? m.netAmount ?? 0));
            const fee = parseFloat(String(m.feeAmount ?? 0));
            // (1) principal solo si está categorizado y el monto guardado no es el gross
            if (m.categoryId != null && gross > 0) {
              const existing = mainAmounts.get(sourceId);
              if (existing == null || Math.abs(existing - gross) >= 0.01) {
                await storage.reconcileMpCajaMovement({
                  sourceId, date: movDate, type: (m.isOutgoing ? "egreso" : "ingreso"),
                  description: movDesc, gross, category: catNameMap.get(m.categoryId as number) ?? "Sin categoría",
                });
                syncedMain++;
              }
            }
            // (2) comisión para TODOS los movimientos con fee (o quitarla si ya no hay)
            const existingFee = feeAmounts.get(`${sourceId}:fee`) ?? 0;
            const wantFee = fee > 0.005 ? fee : 0;
            if (Math.abs(existingFee - wantFee) >= 0.01) {
              await storage.syncMpFee({ sourceId, fee: wantFee, date: movDate, description: movDesc });
              syncedFee++;
            }
          }
          if (syncedMain > 0 || syncedFee > 0) console.log(`[caja reconcile] principal:${syncedMain} comisiones:${syncedFee}`);
        }
      } catch (backfillErr: any) {
        console.warn("[caja reconcile] error:", backfillErr.message);
      }

      // ── Merge XLSX movements (missing from payments API) ─────────────────────
      let xlsxMovements: any[] = [];
      let xlsxDebug = { raw: 0, filtered: 0, merged: 0, error: "" };
      try {
        const xlsxRaw = await storage.getMpXlsxMovements(effectiveFrom, to ?? undefined);
        xlsxDebug.raw = xlsxRaw.length;
        const existingIds = new Set(rawPayments.map((p: any) => String(p.id)));
        const xlsxFiltered = xlsxRaw.filter(r => !existingIds.has(String(r.mp_id)));
        xlsxDebug.filtered = xlsxFiltered.length;
        console.log(`[mp-xlsx merge] from=${effectiveFrom} to=${to ?? "null"} raw=${xlsxRaw.length} filtered=${xlsxFiltered.length} existingPayments=${existingIds.size}`);
        // Log fecha_ts for first 3 rows to confirm it's populated after sync
        if (xlsxRaw.length > 0) {
          const sample = xlsxRaw.slice(0, 3).map((r: any) => `${r.mp_id}:${r.fecha_ts ?? "NULL"}`);
          console.log(`[mp-xlsx merge] sample fecha_ts: ${sample.join(" | ")}`);
        }

        if (xlsxFiltered.length > 0) {
          const xlsxIds = xlsxFiltered.map(r => `xlsx_${r.mp_id}`);
          let xlsxCatMap = new Map<string, number | null>();
          let xlsxPayLinksMap = new Map<string, any[]>();
          try { xlsxCatMap = await storage.getMpMovementOverridesMap(xlsxIds); } catch (_) {}
          try { xlsxPayLinksMap = await storage.getBankPaymentLinksByMovements(xlsxIds); } catch (_) {}

          xlsxMovements = xlsxFiltered.map(r => {
            const id = `xlsx_${r.mp_id}`;
            const isOutgoing = (r.monto_neto_debitado ?? 0) > 0;
            const gross = Math.abs(r.monto_bruto ?? (isOutgoing ? r.monto_neto_debitado : r.monto_neto_acreditado)) || 0;
            const fee = r.fee_amount ?? 0;
            const net = isOutgoing ? Math.abs(r.monto_neto_debitado ?? 0) : Math.abs(r.monto_neto_acreditado ?? 0);
            // TEMA 1: use full timestamp from fecha_ts if available, fallback to date + 12:00
            const dateCreated = r.fecha_ts
              ? r.fecha_ts
              : r.fecha ? `${r.fecha}T12:00:00.000-03:00` : "";
            return {
              id,
              date_created: dateCreated,
              type: "bank_transfer",
              description: r.descripcion,
              status: "approved",
              isOutgoing,
              grossAmount: gross,
              feeAmount: fee,
              netAmount: net,
              displayName: null,
              rawIdentifier: `xlsx:${r.mp_id}`,
              identified: false,
              categoryId: xlsxCatMap.get(id) ?? null,
              contactType: null,
              entityId: null,
              contactId: null,
              bankPaymentLinks: xlsxPayLinksMap.get(id) ?? [],
              source: "xlsx" as const,
              operation_type: isOutgoing ? "money_transfer" : "account_fund",
            };
          });
          xlsxDebug.merged = xlsxMovements.length;

          // TEMA 2: batch-lookup bank_contacts for xlsx movements using rawIdentifier
          if (xlsxMovements.length > 0) {
            const xlsxRawIds = xlsxMovements.map((m: any) => m.rawIdentifier as string).filter(Boolean);
            try {
              const xlsxContactsMap = await storage.getBankContactsByIdentifiers(xlsxRawIds);
              console.log(`[xlsx-contacts] ${xlsxRawIds.length} ids → ${xlsxContactsMap.size} matches`);
              xlsxMovements = xlsxMovements.map((m: any) => {
                const contact = xlsxContactsMap.get((m.rawIdentifier ?? "").toLowerCase().trim());
                if (!contact) return m;
                return {
                  ...m,
                  identified: true,
                  displayName: contact.displayName,
                  contactType: contact.type,
                  entityId: contact.entityId ?? null,
                  contactId: contact.id,
                };
              });
            } catch (e: any) {
              console.warn("[xlsx-contacts] lookup failed:", e.message);
            }
          }
        }
      } catch (xlsxErr: any) {
        xlsxDebug.error = xlsxErr.message;
        console.warn("[mp-xlsx] fetch error:", xlsxErr.message);
      }

      // Reconciliación de comisiones de movimientos XLSX-only (no estaban en payments API,
      // por eso el loop anterior no los sincronizó). Sin esto, el total de "Comisiones" en
      // egresos queda por debajo del total de comisiones que muestra Bancos.
      // Se usa el mismo sourceId base `mp:{mpId}` que el payments API → idempotente, sin duplicar.
      try {
        const xlsxWithFee = (xlsxMovements as any[]).filter((m) => (m.feeAmount ?? 0) > 0.005);
        if (xlsxWithFee.length > 0) {
          const rawId = (m: any) => String(m.id).replace(/^xlsx_/, "");
          const existingXlsxFees = await storage.getCajaAmountsBySourceIds(xlsxWithFee.map((m) => `mp:${rawId(m)}:fee`));
          let syncedXlsxFee = 0;
          for (const m of xlsxWithFee) {
            const sourceId = `mp:${rawId(m)}`;
            const fee = parseFloat(String(m.feeAmount ?? 0));
            const existing = existingXlsxFees.get(`${sourceId}:fee`) ?? 0;
            if (Math.abs(existing - fee) >= 0.01) {
              await storage.syncMpFee({
                sourceId, fee,
                date: String(m.date_created ?? "").slice(0, 10),
                description: String(m.displayName || m.description || "Comisión MP"),
              });
              syncedXlsxFee++;
            }
          }
          if (syncedXlsxFee > 0) console.log(`[caja reconcile xlsx] comisiones:${syncedXlsxFee}`);
        }
      } catch (feeErr: any) {
        console.warn("[caja reconcile xlsx] error:", feeErr.message);
      }

      // Merge payments + xlsx, sorted by date desc
      const allMovements: any[] = [...withCats, ...xlsxMovements];
      allMovements.sort((a, b) =>
        new Date(b.date_created ?? 0).getTime() - new Date(a.date_created ?? 0).getTime()
      );

      return res.json({ ...mpData, results: allMovements, _debug_xlsx_merged: xlsxDebug });
    } catch (e: any) {
      const msg = (e as any)?.name === "AbortError" ? "Timeout al conectar con Mercado Pago" : e.message;
      return res.status(500).json({ error: msg });
    }
  });

  // ─── Bank Categories ─────────────────────────────────────────────────────────
  app.get("/api/bank-categories", requireAuth, async (_req, res) => {
    try {
      return res.json(await storage.getBankCategories());
    } catch (_) {
      // Tabla puede no existir aún si la migración no corrió — devolver array vacío
      return res.json([]);
    }
  });

  app.post("/api/bank-categories", requireAuth, async (req, res) => {
    try {
      const { name } = req.body as { name?: string };
      if (!name?.trim()) return res.status(400).json({ error: "Nombre requerido" });
      return res.json(await storage.createBankCategory(name.trim()));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.put("/api/bank-categories/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name } = req.body as { name?: string };
      if (!name?.trim()) return res.status(400).json({ error: "Nombre requerido" });
      return res.json(await storage.updateBankCategory(id, name.trim()));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.put("/api/mp/movements/:mpId/category", requireAuth, async (req, res) => {
    try {
      const { mpId } = req.params;
      const { categoryId, amount, fee, date, isOutgoing, description } = req.body as {
        categoryId: number | null;
        amount?: number;   // monto TRANSFERIDO (gross), sin comisión
        fee?: number;      // comisión de MP → va a categoría "Comisiones"
        date?: string;
        isOutgoing?: boolean;
        description?: string;
      };
      await storage.setMpMovementCategory(mpId, categoryId ?? null);

      const sourceId = `mp:${mpId}`;
      if (categoryId != null && amount != null && amount > 0) {
        const cats = await storage.getBankCategories();
        const catName = cats.find(c => c.id === categoryId)?.name ?? "Sin categoría";
        const socioRaw = req.body.socioId != null ? parseInt(String(req.body.socioId)) : NaN;
        const movDate = date ?? new Date().toISOString().slice(0, 10);
        const movDesc = description || (isOutgoing ? "Pago banco" : "Cobro banco");
        await storage.reconcileMpCajaMovement({
          sourceId, date: movDate, type: isOutgoing ? "egreso" : "ingreso",
          description: movDesc, gross: parseFloat(String(amount)), category: catName,
          socioId: catName === "Retiro" && !isNaN(socioRaw) ? socioRaw : null,
        });
        await storage.syncMpFee({ sourceId, fee: fee != null ? parseFloat(String(fee)) : 0, date: movDate, description: movDesc });
      } else {
        await storage.deleteBankMovementFromCaja(sourceId); // borra el principal, la comisión y el retiro
      }

      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── Bank Contacts ────────────────────────────────────────────────────────────
  app.get("/api/bank-contacts", requireAuth, async (_req, res) => {
    try {
      return res.json(await storage.getBankContacts());
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/bank-contacts", requireAuth, async (req, res) => {
    try {
      const { identifier, displayName, type, entityId } = req.body as {
        identifier: string; displayName: string; type: string; entityId?: number | null;
      };
      if (!identifier?.trim()) return res.status(400).json({ error: "identifier requerido" });
      if (!displayName?.trim()) return res.status(400).json({ error: "displayName requerido" });
      if (!type?.trim()) return res.status(400).json({ error: "type requerido" });
      const contact = await storage.createBankContact({
        identifier: identifier.trim(),
        displayName: displayName.trim(),
        type,
        entityId: entityId ?? null,
      });
      return res.json(contact);
    } catch (e: any) {
      if ((e as any).code === "23505") return res.status(409).json({ error: "Ese identificador ya existe" });
      return res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/bank-contacts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { displayName, type, entityId } = req.body as { displayName?: string; type?: string; entityId?: number | null };
      const contact = await storage.updateBankContact(id, {
        ...(displayName ? { displayName: displayName.trim() } : {}),
        ...(type ? { type } : {}),
        ...(entityId !== undefined ? { entityId: entityId ?? null } : {}),
      });
      return res.json(contact);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/bank-contacts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteBankContact(id);
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── MP Report Sync ────────────────────────────────────────────
  app.post('/api/mp/sync-report', requireAuth, async (_req, res) => {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return res.status(500).json({ error: 'MP_ACCESS_TOKEN no configurado' });
    try {
      const result = await syncMpReport(token);
      return res.json(result);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

    // ─── Pedidos pendientes por cliente (para vincular pagos MP) ──────────────
  app.get("/api/customers/:id/pedidos-pendientes", requireAuth, async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      const pending = await storage.getPendingOrdersForCustomer(customerId);
      return res.json(pending.map(o => ({
        ...o,
        pendingAmount: String((parseFloat(o.total) - parseFloat(o.paidAmount)).toFixed(2)),
      })));
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // ─── Bank Payment Links — vincular movimiento MP a pedidos ───────────────
  app.post("/api/bank-payment-links", requireAuth, async (req, res) => {
    try {
      const { movementId, customerId, date, notes, links } = req.body as {
        movementId: string;
        customerId: number;
        date: string;
        notes?: string;
        links: Array<{ pedidoId: number; montoAplicado: number }>;
      };
      if (!movementId) return res.status(400).json({ error: "movementId requerido" });
      if (!customerId) return res.status(400).json({ error: "customerId requerido" });
      if (!Array.isArray(links) || links.length === 0) return res.status(400).json({ error: "links requerido" });
      const result = await storage.applyBankMovementToOrders({
        movementId, customerId, date: date ?? new Date().toISOString().slice(0, 10),
        notes, links, userId: req.session.userId!,
      });
      return res.json(result);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  return httpServer;
}
