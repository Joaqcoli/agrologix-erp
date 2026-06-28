import { pgTable, text, varchar, numeric, integer, timestamp, pgEnum, boolean, serial, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const roleEnum = pgEnum("role", ["admin", "operator", "vendedor", "galpon"]);
export const movementTypeEnum = pgEnum("movement_type", ["in", "out"]);
export const unitEnum = pgEnum("unit", ["KG", "UNIDAD", "CAJON", "BOLSA", "ATADO", "MAPLE", "BANDEJA"]);
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
  cuit: text("cuit"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  notes: text("notes"),
  hasIva: boolean("has_iva").notNull().default(false),
  ccType: text("cc_type").default("por_saldo"),
  bolsaFv: boolean("bolsa_fv").default(false),
  blackPot: boolean("black_pot").default(false),
  salespersonName: text("salesperson_name"),
  commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }).default("0"),
  openingBalance: numeric("opening_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  parentCustomerId: integer("parent_customer_id").references(() => customers.id),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku").unique(),                                        // now nullable — kept for compat but not shown
  description: text("description"),
  unit: unitEnum("unit").notNull().default("KG"),
  category: text("category").default("Verdura"),                    // NEW
  averageCost: numeric("average_cost", { precision: 12, scale: 4 }).notNull().default("0"),
  currentStock: numeric("current_stock", { precision: 12, scale: 4 }).notNull().default("0"),
  ivaRate: numeric("iva_rate", { precision: 5, scale: 4 }).notNull().default("0.105"), // tasa de IVA (0.1050 general | 0.2100 huevos). Dato fiscal explícito.
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  cuit: text("cuit"),
  notes: text("notes"),
  ccType: text("cc_type").default("por_saldo"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const purchases = pgTable("purchases", {
  id: serial("id").primaryKey(),
  folio: text("folio").notNull().unique(),
  supplierName: text("supplier_name").notNull(),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  purchaseDate: timestamp("purchase_date").notNull().default(sql`now()`),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  paymentMethod: text("payment_method").default("cuenta_corriente"),
  isPaid: boolean("is_paid").notNull().default(false),
  totalEmptyCost: numeric("total_empty_cost", { precision: 12, scale: 2 }).default("0"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const supplierPayments = pgTable("supplier_payments", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  date: text("date").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  method: text("method").notNull().default("EFECTIVO"),
  notes: text("notes"),
  purchaseId: integer("purchase_id").references(() => purchases.id),
  movementRef: text("movement_ref"),  // id del movimiento de banco que originó el pago (galicia:.. / mp:..) — anti-duplicado + revert
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Imputación pago→compra (espejo de payment_order_links, lado proveedor).
// Permite que el usuario elija a qué compras imputar un pago, con parciales reales.
// onDelete cascade: borrar el pago revierte sus imputaciones automáticamente.
export const supplierPaymentPurchaseLinks = pgTable("supplier_payment_purchase_links", {
  id: serial("id").primaryKey(),
  supplierPaymentId: integer("supplier_payment_id").notNull().references(() => supplierPayments.id, { onDelete: "cascade" }),
  purchaseId: integer("purchase_id").notNull().references(() => purchases.id, { onDelete: "cascade" }),
  amountApplied: numeric("amount_applied"),
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
  emptyCost: numeric("empty_cost", { precision: 12, scale: 4 }).default("0"),
  costPerPurchaseUnit: numeric("cost_per_purchase_unit", { precision: 12, scale: 2 }),
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
  createdBy: integer("created_by").references(() => users.id), // quién generó el movimiento (ajustes); null = histórico/desconocido
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
  remitoNum: integer("remito_num"),
  createdBy: integer("created_by").references(() => users.id),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  invoiceNumber: text("invoice_number"),
  // Puente galpón→admin: el galpón "confirma" el armado (no es el approve; el pedido sigue en borrador)
  galponConfirmed: boolean("galpon_confirmed").notNull().default(false),
  galponConfirmedAt: timestamp("galpon_confirmed_at"),
  galponConfirmedBy: integer("galpon_confirmed_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => products.id),
  quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
  unit: text("unit").notNull().default("KG"),
  pricePerUnit: numeric("price_per_unit", { precision: 12, scale: 4 }),
  costPerUnit: numeric("cost_per_unit", { precision: 12, scale: 4 }).notNull().default("0"),
  overrideCostPerUnit: numeric("override_cost_per_unit", { precision: 12, scale: 4 }),
  margin: numeric("margin", { precision: 8, scale: 4 }),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  rawProductName: text("raw_product_name"),
  parseStatus: text("parse_status"),
  bolsaType: text("bolsa_type"), // null | 'bolsa' | 'bolsa_propia'
  isBonification: boolean("is_bonification").default(false),
});

// ─── Product Units (stock + cost per unit per product) ─────────────────────────
export const productUnits = pgTable("product_units", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  unit: text("unit").notNull(),         // base unit: KG, UNIDAD, ATADO, MAPLE, LITRO, etc.
  isActive: boolean("is_active").notNull().default(true),
  avgCost: numeric("avg_cost", { precision: 12, scale: 4 }).notNull().default("0"),
  stockQty: numeric("stock_qty", { precision: 12, scale: 4 }).notNull().default("0"),
  // Weight (base units per package) for CAJON/BOLSA products — e.g. 18 KG per cajón
  weightPerUnit: numeric("weight_per_unit", { precision: 10, scale: 4 }).default("0"),
  // Set when this row was created/updated by the base-unit purchase model
  baseUnit: text("base_unit"),
}, (t) => ({
  productUnitUnique: unique().on(t.productId, t.unit),
}));

// Stores the last sale price per customer+product (price history)
export const priceHistory = pgTable("price_history", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  productId: integer("product_id").notNull().references(() => products.id),
  pricePerUnit: numeric("price_per_unit", { precision: 12, scale: 4 }).notNull(),
  unit: text("unit"),
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

export const PAYMENT_METHODS = ["EFECTIVO", "TRANSFERENCIA", "CHEQUE", "CUENTA_CORRIENTE", "OTRO", "RETENCION", "MIXTO"] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  date: text("date").notNull(), // YYYY-MM-DD stored as text for simplicity
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  method: text("method").notNull().default("EFECTIVO"),
  notes: text("notes"),
  orderId: integer("order_id").references(() => orders.id),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const paymentOrderLinks = pgTable("payment_order_links", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  amountApplied: numeric("amount_applied"),
});

// Líneas que componen un pago de cliente (un pago puede mezclar métodos: efectivo + transferencia +
// cheques). Para líneas CHEQUE, chequeId apunta al cheque creado en cartera. amount = monto de la línea.
// La suma de las líneas = payments.amount. onDelete cascade: borrar el pago borra sus líneas.
export const paymentLines = pgTable("payment_lines", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
  method: text("method").notNull(),        // EFECTIVO | TRANSFERENCIA | CHEQUE | ...
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  cuentaId: integer("cuenta_id").references(() => cuentasFinancieras.id), // mov. de cuenta (efectivo/transf)
  chequeId: integer("cheque_id"),          // cheque creado (líneas CHEQUE)
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
    ivaRate: z.union([z.string(), z.number()]).optional().transform((v) => v == null ? undefined : String(v)), // "0.105" | "0.21"
  });
export const insertPurchaseSchema = createInsertSchema(purchases).omit({ id: true, createdAt: true, createdBy: true, total: true }).extend({
  purchaseDate: z.union([z.string(), z.date()]),
  items: z.array(z.object({
    productId: z.number(),
    quantity: z.string(),
    unit: z.enum(["KG", "UNIDAD", "CAJON", "BOLSA", "ATADO", "MAPLE", "BANDEJA"]),
    costPerUnit: z.string(),
    purchaseQty: z.string().optional(),
    purchaseUnit: z.enum(["KG", "UNIDAD", "CAJON", "BOLSA", "ATADO", "MAPLE", "BANDEJA"]).optional(),
    weightPerPackage: z.string().optional(),
    emptyCost: z.string().optional(),
    costPerPurchaseUnit: z.string().optional(),
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
    unit: z.enum(["KG", "UNIDAD", "CAJON", "BOLSA", "ATADO", "MAPLE", "BANDEJA"]),
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
export type PaymentOrderLink = typeof paymentOrderLinks.$inferSelect;
export type PaymentLine = typeof paymentLines.$inferSelect;
export type Withholding = typeof withholdings.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type SupplierPayment = typeof supplierPayments.$inferSelect;
export type SupplierPaymentPurchaseLink = typeof supplierPaymentPurchaseLinks.$inferSelect;

export const insertSupplierSchema = createInsertSchema(suppliers).omit({ id: true, createdAt: true });
export const insertSupplierPaymentSchema = createInsertSchema(supplierPayments).omit({ id: true, createdAt: true, createdBy: true }).extend({
  amount: z.union([z.string(), z.number()]).transform((v) => String(v)),
  purchaseId: z.number().int().optional().nullable(),
});
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type InsertSupplierPayment = z.infer<typeof insertSupplierPaymentSchema>;

export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true, createdAt: true, createdBy: true }).extend({
  amount: z.union([z.string(), z.number()]).transform((v) => String(v)),
  method: z.enum(PAYMENT_METHODS).default("EFECTIVO"),
  orderId: z.number().int().optional().nullable(),
});
export const insertWithholdingSchema = createInsertSchema(withholdings).omit({ id: true, createdAt: true, createdBy: true }).extend({
  amount: z.union([z.string(), z.number()]).transform((v) => String(v)),
});
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type InsertWithholding = z.infer<typeof insertWithholdingSchema>;

// ─── Lista de Precios ────────────────────────────────────────────────────────
export const priceListItems = pgTable("price_list_items", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  productName: text("product_name").notNull(),
  pricePerCajon: numeric("price_per_cajon", { precision: 12, scale: 2 }).notNull().default("0"),
  pricePerKg: numeric("price_per_kg", { precision: 12, scale: 2 }).notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertPriceListItemSchema = createInsertSchema(priceListItems).omit({ id: true, createdAt: true });
export type PriceListItem = typeof priceListItems.$inferSelect;
export type InsertPriceListItem = z.infer<typeof insertPriceListItemSchema>;

// ─── Grupos de clientes con precios compartidos ───────────────────────────────
export const clientGroups = pgTable("client_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const clientGroupMembers = pgTable("client_group_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => clientGroups.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
});

export type ClientGroup = typeof clientGroups.$inferSelect;
export type ClientGroupMember = typeof clientGroupMembers.$inferSelect;

// ─── Facturas electrónicas ARCA ───────────────────────────────────────────────
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  customerId: integer("customer_id").references(() => customers.id).notNull(),
  invoiceType: text("invoice_type").notNull(),        // "A" | "B" | "C"
  invoiceNumber: text("invoice_number").notNull(),    // "A-0001-00000001"
  pointOfSale: integer("point_of_sale").notNull().default(1),
  cae: text("cae").notNull(),
  caeExpiry: text("cae_expiry").notNull(),            // "YYYYMMDD"
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  ivaAmount: numeric("iva_amount", { precision: 12, scale: 2 }).notNull(),
  condicionIvaReceptorId: integer("condicion_iva_receptor_id"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;

// ─── Notas de Crédito ────────────────────────────────────────────────────────
export const creditNotes = pgTable("credit_notes", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  creditNoteType: text("credit_note_type").notNull(),      // "A" | "B" | "C"
  creditNoteNumber: text("credit_note_number").notNull(),  // "NC-A-0004-00000001"
  pointOfSale: integer("point_of_sale").notNull().default(4),
  cae: text("cae").notNull(),
  caeExpiry: text("cae_expiry").notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  ivaAmount: numeric("iva_amount", { precision: 12, scale: 2 }).notNull(),
  condicionIvaReceptorId: integer("condicion_iva_receptor_id"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export type CreditNote = typeof creditNotes.$inferSelect;
export type InsertCreditNote = typeof creditNotes.$inferInsert;

// ─── Caja — movimientos manuales ─────────────────────────────────────────────
export const cajaMovements = pgTable("caja_movements", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),                          // YYYY-MM-DD
  type: text("type").notNull(),                          // "ingreso" | "egreso"
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  category: text("category"),
  method: text("method"),                                // "EFECTIVO" | "TRANSFERENCIA" | "CHEQUE" | etc.
  sourceId: text("source_id"),                           // "mp:{mpId}" para movimientos sincronizados desde Bancos
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export const insertCajaMovementSchema = createInsertSchema(cajaMovements).omit({ id: true, createdAt: true, createdBy: true });
export type CajaMovement = typeof cajaMovements.$inferSelect;
export type InsertCajaMovement = typeof cajaMovements.$inferInsert;

// ─── Bancos — categorías y overrides MP ──────────────────────────────────────

export const bankCategories = pgTable("bank_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  afectaEgresos: boolean("afecta_egresos").notNull().default(true), // si false, NO suma al gráfico de egresos (reemplaza EXCLUDE_FROM_PIE por texto)
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export type BankCategory = typeof bankCategories.$inferSelect;

export const mpMovementOverrides = pgTable("mp_movement_overrides", {
  id: serial("id").primaryKey(),
  mpMovementId: text("mp_movement_id").notNull().unique(),
  categoryId: integer("category_id").references(() => bankCategories.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export type MpMovementOverride = typeof mpMovementOverrides.$inferSelect;

// ─── Bank Contacts ────────────────────────────────────────────────────────────

export const bankContacts = pgTable("bank_contacts", {
  id: serial("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),   // email, CBU, MP user ID
  displayName: text("display_name").notNull(),
  type: text("type").notNull(),                        // 'cliente'|'proveedor'|'banco'|'otro'
  entityId: integer("entity_id"),                      // FK a customers o suppliers según type
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export type BankContact = typeof bankContacts.$inferSelect;
export type InsertBankContact = typeof bankContacts.$inferInsert;

// ─── MP Movement Identifiers (from settlement report sync) ────────────────────
export const mpMovementIdentifiers = pgTable("mp_movement_identifiers", {
  movementId: text("movement_id").primaryKey(),
  payerIdentifier: text("payer_identifier").notNull(),
  payerName: text("payer_name"),
  rawExternalId: text("raw_external_id"),
  syncedAt: timestamp("synced_at").notNull().default(sql`now()`),
});
export type MpMovementIdentifier = typeof mpMovementIdentifiers.$inferSelect;

export const mpXlsxMovements = pgTable("mp_xlsx_movements", {
  mpId: text("mp_id").primaryKey(),
  fecha: text("fecha"),
  descripcion: text("descripcion"),
  montoBruto: numeric("monto_bruto", { precision: 12, scale: 2 }),
  montoNetoDebitado: numeric("monto_neto_debitado", { precision: 12, scale: 2 }),
  montoNetoAcreditado: numeric("monto_neto_acreditado", { precision: 12, scale: 2 }),
  comision: numeric("comision", { precision: 12, scale: 2 }),
  syncedAt: timestamp("synced_at").notNull().default(sql`now()`),
});
export type MpXlsxMovement = typeof mpXlsxMovements.$inferSelect;

export const bankPaymentLinks = pgTable("bank_payment_links", {
  id: serial("id").primaryKey(),
  movementId: text("movement_id").notNull(),
  pedidoId: integer("pedido_id").references(() => orders.id, { onDelete: "set null" }),
  montoAplicado: numeric("monto_aplicado", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export type BankPaymentLink = typeof bankPaymentLinks.$inferSelect;

// ─── Galicia: staging de movimientos del extracto (paso 2 lector Galicia) ─────
// Espejo de mp_xlsx_movements: guarda el crudo de cada movimiento del extracto
// (CSV/XLSX) para dedup, clasificación y re-categorización sin re-subir el archivo.
export const galiciaMovements = pgTable("galicia_movements", {
  id: text("id").primaryKey(),                                    // clave de dedup (fecha:comprobante:monto:saldo o hash)
  fecha: text("fecha").notNull(),                                 // YYYY-MM-DD
  descripcion: text("descripcion"),
  debito: numeric("debito", { precision: 14, scale: 2 }),         // salió plata (egreso); null si es crédito
  credito: numeric("credito", { precision: 14, scale: 2 }),       // entró plata (ingreso); null si es débito
  grupoConcepto: text("grupo_concepto"),
  concepto: text("concepto"),                                     // "907355 - DEBITO DEBIN"
  comprobante: text("comprobante"),                               // Número de Comprobante
  leyendas: text("leyendas"),                                     // Leyendas Adicionales 1-4 concatenadas
  saldo: numeric("saldo", { precision: 14, scale: 2 }),           // running balance de la línea
  tipoMovimiento: text("tipo_movimiento"),
  category: text("category"),                                     // categoría asignada (auto o manual) — texto, igual que caja_movements
  categoriaAuto: boolean("categoria_auto").notNull().default(true), // true=auto por regla, false=corregida a mano
  yaContabilizado: boolean("ya_contabilizado").notNull().default(false), // cheque acreditado ya registrado → NO suma a la ganancia
  asignacionCc: text("asignacion_cc"),                            // null | 'pendiente' (cobro de cliente a asignar a factura/CC)
  syncedAt: timestamp("synced_at").notNull().default(sql`now()`),
});
export type GaliciaMovement = typeof galiciaMovements.$inferSelect;
export type InsertGaliciaMovement = typeof galiciaMovements.$inferInsert;

// ─── Galicia: reglas de clasificación (paso 4) — concepto/leyenda → categoría ──
// Seed inicial + reglas "aprendidas" cuando el usuario corrige una categoría.
export const galiciaRules = pgTable("galicia_rules", {
  id: serial("id").primaryKey(),
  matchConcepto: text("match_concepto").notNull(),                // substring a buscar en concepto (uppercase)
  matchLeyenda: text("match_leyenda"),                            // substring opcional en leyendas (uppercase)
  categoryName: text("category_name").notNull(),                  // categoría a asignar (nombre, igual que caja_movements.category)
  prioridad: integer("prioridad").notNull().default(0),           // mayor = se evalúa primero (aprendidas > seed)
  origen: text("origen").notNull().default("seed"),               // seed | aprendida
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export type GaliciaRule = typeof galiciaRules.$inferSelect;
export type InsertGaliciaRule = typeof galiciaRules.$inferInsert;

// ─── Cuentas Financieras ──────────────────────────────────────────────────────
export const cuentasFinancieras = pgTable("cuentas_financieras", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  tipo: text("tipo").notNull(), // mp | banco | efectivo | cheque
  saldoBase: numeric("saldo_base", { precision: 14, scale: 2 }).notNull().default("0"),
  saldoBaseFecha: timestamp("saldo_base_fecha"),
  orden: integer("orden").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});
export type CuentaFinanciera = typeof cuentasFinancieras.$inferSelect;

// ─── Movimientos de cuenta ────────────────────────────────────────────────────
export const movimientosCuenta = pgTable("movimientos_cuenta", {
  id: serial("id").primaryKey(),
  cuentaId: integer("cuenta_id").notNull().references(() => cuentasFinancieras.id),
  fecha: timestamp("fecha").notNull().default(sql`now()`),
  signo: text("signo").notNull(), // ingreso | egreso
  monto: numeric("monto", { precision: 14, scale: 2 }).notNull(),
  comision: numeric("comision", { precision: 14, scale: 2 }).notNull().default("0"),
  concepto: text("concepto").notNull(),
  origenTipo: text("origen_tipo").notNull(), // cobro | pago | manual | cheque | deposito | obligacion
  origenId: text("origen_id"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export type MovimientoCuenta = typeof movimientosCuenta.$inferSelect;

// ─── Socios ───────────────────────────────────────────────────────────────────
export const socios = pgTable("socios", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  activo: boolean("activo").notNull().default(true),
});
export type Socio = typeof socios.$inferSelect;

// ─── Retiros ──────────────────────────────────────────────────────────────────
export const retiros = pgTable("retiros", {
  id: serial("id").primaryKey(),
  socioId: integer("socio_id").notNull().references(() => socios.id),
  monto: numeric("monto", { precision: 14, scale: 2 }).notNull(),
  fecha: text("fecha").notNull(), // YYYY-MM-DD
  origen: text("origen").notNull().default("manual"), // manual | movimiento
  movimientoRef: text("movimiento_ref"),              // id de caja_movement que lo originó
  notas: text("notas"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export type Retiro = typeof retiros.$inferSelect;

// ─── Obligaciones (vencimientos) ──────────────────────────────────────────────
export const cheques = pgTable("cheques", {
  id: serial("id").primaryKey(),
  tipo: text("tipo").notNull(), // recibido | emitido
  numero: text("numero"), // número de cheque (talonario / comprobante ECHEQ) — clave para cruzar con extracto Galicia
  monto: numeric("monto", { precision: 14, scale: 2 }).notNull(),
  fechaCobro: text("fecha_cobro").notNull(), // YYYY-MM-DD
  estado: text("estado").notNull().default("en_cartera"), // en_cartera | depositado | endosado | cobrado
  contraparte: text("contraparte").notNull(), // nombre (compat); para emitidos a proveedor también se guarda supplierId
  supplierId: integer("supplier_id").references(() => suppliers.id), // null para cheques recibidos de clientes
  cuentaDestinoId: integer("cuenta_destino_id").references(() => cuentasFinancieras.id),
  comision: numeric("comision", { precision: 14, scale: 2 }).notNull().default("0"),
  obligacionId: integer("obligacion_id"),  // se referencia a obligaciones, sin FK circular
  paymentId: integer("payment_id"),        // vínculo cheque recibido → pago de cliente (varios cheques por pago); null en los viejos
  notas: text("notas"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export type Cheque = typeof cheques.$inferSelect;

export const obligaciones = pgTable("obligaciones", {
  id: serial("id").primaryKey(),
  concepto: text("concepto").notNull(),
  tipo: text("tipo").notNull(), // proveedor|impuesto|cuota|servicio|sueldo|otro
  monto: numeric("monto", { precision: 14, scale: 2 }).notNull(),
  moneda: text("moneda").notNull().default("ARS"), // ARS | USD
  pagoParcial: integer("pago_parcial", { mode: "boolean" }).notNull().default(false),
  fechaVencimiento: text("fecha_vencimiento").notNull(), // ISO date string YYYY-MM-DD
  estado: text("estado").notNull().default("pendiente"), // pendiente|pagado
  grupoCuota: text("grupo_cuota"),
  numeroCuota: integer("numero_cuota"),
  totalCuotas: integer("total_cuotas"),
  notas: text("notas"),
  pagadoAt: timestamp("pagado_at"),
  cuentaPagoId: integer("cuenta_pago_id").references(() => cuentasFinancieras.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export type Obligacion = typeof obligaciones.$inferSelect;

// Historial de pagos (parciales/total) de una obligación (M8: matchea la tabla ya existente)
export const obligacionPagos = pgTable("obligacion_pagos", {
  id: serial("id").primaryKey(),
  obligacionId: integer("obligacion_id").notNull().references(() => obligaciones.id, { onDelete: "cascade" }),
  fecha: text("fecha").notNull(), // YYYY-MM-DD
  monto: numeric("monto", { precision: 14, scale: 2 }).notNull(),
  moneda: text("moneda").notNull().default("ARS"), // ARS | USD
  cotizacion: numeric("cotizacion", { precision: 14, scale: 4 }),
  montoArs: numeric("monto_ars", { precision: 14, scale: 2 }).notNull(),
  cuentaPagoId: integer("cuenta_pago_id").references(() => cuentasFinancieras.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export type ObligacionPago = typeof obligacionPagos.$inferSelect;
export type InsertObligacionPago = typeof obligacionPagos.$inferInsert;
