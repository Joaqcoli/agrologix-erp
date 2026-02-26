import { pgTable, text, varchar, numeric, integer, timestamp, pgEnum, boolean, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const roleEnum = pgEnum("role", ["admin", "operator"]);
export const movementTypeEnum = pgEnum("movement_type", ["in", "out"]);
export const unitEnum = pgEnum("unit", ["kg", "pz", "caja", "saco", "litro", "tonelada"]);

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
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  description: text("description"),
  unit: unitEnum("unit").notNull().default("kg"),
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

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, passwordHash: true }).extend({
  password: z.string().min(6),
});
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true, createdAt: true, averageCost: true, currentStock: true });
export const insertPurchaseSchema = createInsertSchema(purchases).omit({ id: true, createdAt: true, createdBy: true, total: true }).extend({
  purchaseDate: z.union([z.string(), z.date()]),
  items: z.array(z.object({
    productId: z.number(),
    quantity: z.string(),
    unit: z.enum(["kg", "pz", "caja", "saco", "litro", "tonelada"]),
    costPerUnit: z.string(),
  })).min(1, "Must have at least one item"),
});

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
