import { pgTable, text, varchar, numeric, integer, timestamp, pgEnum, boolean, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const roleEnum = pgEnum("role", ["admin", "operator"]);
export const movementTypeEnum = pgEnum("movement_type", ["in", "out"]);
export const unitEnum = pgEnum("unit", ["kg", "pz", "caja", "saco", "litro", "tonelada", "CAJON", "maple", "atado", "bandeja"]);
export const orderStatusEnum = pgEnum("order_status", ["draft", "approved", "cancelled"]);

export const PRODUCT_CATEGORIES = ["Fruta", "Verdura", "Hortaliza Liviana", "Hortaliza Pesada", "Hongos/Hierbas", "Huevos"] as const;
export type ProductCategory = typeof PRODUCT_CATEGORIES[number];

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("operator"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  rfc: text("rfc"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  notes: text("notes"),
  hasIva: boolean("has_iva").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku").unique(),                                        // now nullable — kept for compat but not shown
  description: text("description"),
  unit: unitEnum("unit").notNull().default("kg"),
  category: text("category").default("Verdura"),                    // NEW
  averageCost: numeric("average_cost", { precision: 12, scale: 4 }).notNull().default("0"),
  currentStock: numeric("current_stock", { precision: 12, scale: 4 }).notNull().default("0"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const purchases = pgTable("purchases", {
  id: serial("id").primaryKey(),
  folio: text("folio").notNull().unique(),
  supplierName: text("supplier_name").notNull(),
  purchaseDate: timestamp("purchase_date").notNull().default(sql`now()`),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const purchaseItems = pgTable("purchase_items", {
  id: serial("id").primaryKey(),
  purchaseId: integer("purchase_id").notNull().references(() => purchases.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => products.id),
  quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
  unit: unitEnum("unit").notNull(),
  costPerUnit: numeric("cost_per_unit", { precision: 12, scale: 4 }).notNull(),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  // Original purchase unit context (before conversion to base unit)
  purchaseQty: numeric("purchase_qty", { precision: 12, scale: 4 }),
  purchaseUnit: unitEnum("purchase_unit"),
  weightPerPackage: numeric("weight_per_package", { precision: 12, scale: 4 }),
});

export const stockMovements = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id),
  movementType: movementTypeEnum("movement_type").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 12, scale: 4 }),
  referenceId: integer("reference_id"),
  referenceType: text("reference_type"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const productCostHistory = pgTable("product_cost_history", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id),
  averageCost: numeric("average_cost", { precision: 12, scale: 4 }).notNull(),
  previousCost: numeric("previous_cost", { precision: 12, scale: 4 }),
  purchaseId: integer("purchase_id").references(() => purchases.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// ─── Orders ───────────────────────────────────────────────────────────────────

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  folio: text("folio").notNull().unique(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  orderDate: timestamp("order_date").notNull().default(sql`now()`),
  status: orderStatusEnum("status").notNull().default("draft"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  lowMarginConfirmed: boolean("low_margin_confirmed").notNull().default(false),
  remitoId: integer("remito_id"),
  createdBy: integer("created_by").references(() => users.id),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => products.id),
  quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
  unit: text("unit").notNull().default("kg"),
  pricePerUnit: numeric("price_per_unit", { precision: 12, scale: 4 }),
  costPerUnit: numeric("cost_per_unit", { precision: 12, scale: 4 }).notNull().default("0"),
  overrideCostPerUnit: numeric("override_cost_per_unit", { precision: 12, scale: 4 }),
  margin: numeric("margin", { precision: 8, scale: 4 }),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  rawProductName: text("raw_product_name"),
  parseStatus: text("parse_status"),
});

// ─── Product Units (stock + cost per unit per product) ─────────────────────────
export const productUnits = pgTable("product_units", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  unit: text("unit").notNull(),         // canonical: KG, CAJON, BOLSA, UNIDAD, ATADO, LITRO, TONELADA, PZ
  isActive: boolean("is_active").notNull().default(true),
  avgCost: numeric("avg_cost", { precision: 12, scale: 4 }).notNull().default("0"),
  stockQty: numeric("stock_qty", { precision: 12, scale: 4 }).notNull().default("0"),
});

// Stores the last sale price per customer+product (price history)
export const priceHistory = pgTable("price_history", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  productId: integer("product_id").notNull().references(() => products.id),
  pricePerUnit: numeric("price_per_unit", { precision: 12, scale: 4 }).notNull(),
  orderId: integer("order_id").references(() => orders.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const remitos = pgTable("remitos", {
  id: serial("id").primaryKey(),
  folio: text("folio").notNull().unique(),
  orderId: integer("order_id").notNull().references(() => orders.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  issuedAt: timestamp("issued_at").notNull().default(sql`now()`),
});

// ─── Cuentas Corrientes ───────────────────────────────────────────────────────

export const PAYMENT_METHODS = ["EFECTIVO", "TRANSFERENCIA", "CHEQUE", "CUENTA_CORRIENTE", "OTRO"] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  date: text("date").notNull(), // YYYY-MM-DD stored as text for simplicity
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  method: text("method").notNull().default("EFECTIVO"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const withholdings = pgTable("withholdings", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  date: text("date").notNull(), // YYYY-MM-DD
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  type: text("type").notNull().default("IIBB"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, passwordHash: true }).extend({
  password: z.string().min(6),
});
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true });
export const insertProductSchema = createInsertSchema(products)
  .omit({ id: true, createdAt: true, averageCost: true, currentStock: true, sku: true })
  .extend({
    category: z.enum(PRODUCT_CATEGORIES).default("Verdura"),
  });
export const insertPurchaseSchema = createInsertSchema(purchases).omit({ id: true, createdAt: true, createdBy: true, total: true }).extend({
  purchaseDate: z.union([z.string(), z.date()]),
  items: z.array(z.object({
    productId: z.number(),
    quantity: z.string(),
    unit: z.enum(["kg", "pz", "caja", "saco", "litro", "tonelada", "CAJON", "maple", "atado", "bandeja"]),
    costPerUnit: z.string(),
    purchaseQty: z.string().optional(),
    purchaseUnit: z.enum(["kg", "pz", "caja", "saco", "litro", "tonelada", "CAJON", "maple", "atado", "bandeja"]).optional(),
    weightPerPackage: z.string().optional(),
  })).min(1, "Must have at least one item"),
});
export const insertOrderSchema = z.object({
  customerId: z.number(),
  orderDate: z.union([z.string(), z.date()]),
  notes: z.string().optional(),
  lowMarginConfirmed: z.boolean().default(false),
  items: z.array(z.object({
    productId: z.number(),
    quantity: z.string(),
    unit: z.enum(["kg", "pz", "caja", "saco", "litro", "tonelada", "CAJON", "maple", "atado", "bandeja"]),
    pricePerUnit: z.string(),
  })).min(1, "Must have at least one item"),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Purchase = typeof purchases.$inferSelect;
export type PurchaseItem = typeof purchaseItems.$inferSelect;
export type InsertPurchase = z.infer<typeof insertPurchaseSchema>;
export type StockMovement = typeof stockMovements.$inferSelect;
export type ProductCostHistory = typeof productCostHistory.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type ProductUnit = typeof productUnits.$inferSelect;
export type PriceHistory = typeof priceHistory.$inferSelect;
export type Remito = typeof remitos.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Withholding = typeof withholdings.$inferSelect;

export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true, createdAt: true, createdBy: true }).extend({
  amount: z.union([z.string(), z.number()]).transform((v) => String(v)),
  method: z.enum(PAYMENT_METHODS).default("EFECTIVO"),
});
export const insertWithholdingSchema = createInsertSchema(withholdings).omit({ id: true, createdAt: true, createdBy: true }).extend({
  amount: z.union([z.string(), z.number()]).transform((v) => String(v)),
});
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type InsertWithholding = z.infer<typeof insertWithholdingSchema>;
