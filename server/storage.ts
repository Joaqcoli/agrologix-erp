import { db } from "./db";
import {
  users, customers, products, purchases, purchaseItems,
  stockMovements, productCostHistory,
  type User, type Customer, type Product, type Purchase,
  type PurchaseItem, type StockMovement,
} from "@shared/schema";
import { eq, desc, asc, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

export const storage = {
  // ─── Auth ─────────────────────────────────────────────────────────────────
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  },

  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  },

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  },

  // ─── Users ────────────────────────────────────────────────────────────────
  async getUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(asc(users.name));
  },

  async createUser(data: { name: string; email: string; password: string; role: "admin" | "operator" }): Promise<User> {
    const passwordHash = await bcrypt.hash(data.password, 10);
    const [user] = await db.insert(users).values({
      name: data.name,
      email: data.email,
      passwordHash,
      role: data.role,
    }).returning();
    return user;
  },

  // ─── Customers ────────────────────────────────────────────────────────────
  async getCustomers(): Promise<Customer[]> {
    return db.select().from(customers).orderBy(asc(customers.name));
  },

  async getCustomer(id: number): Promise<Customer | undefined> {
    const [c] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
    return c;
  },

  async createCustomer(data: Omit<typeof customers.$inferInsert, "id" | "createdAt">): Promise<Customer> {
    const [c] = await db.insert(customers).values(data).returning();
    return c;
  },

  async updateCustomer(id: number, data: Partial<typeof customers.$inferInsert>): Promise<Customer> {
    const [c] = await db.update(customers).set(data).where(eq(customers.id, id)).returning();
    return c;
  },

  async deleteCustomer(id: number): Promise<void> {
    await db.update(customers).set({ active: false }).where(eq(customers.id, id));
  },

  // ─── Products ─────────────────────────────────────────────────────────────
  async getProducts(): Promise<Product[]> {
    return db.select().from(products).orderBy(asc(products.name));
  },

  async getProduct(id: number): Promise<Product | undefined> {
    const [p] = await db.select().from(products).where(eq(products.id, id)).limit(1);
    return p;
  },

  async createProduct(data: Omit<typeof products.$inferInsert, "id" | "createdAt" | "averageCost" | "currentStock">): Promise<Product> {
    const [p] = await db.insert(products).values({ ...data, averageCost: "0", currentStock: "0" }).returning();
    return p;
  },

  async updateProduct(id: number, data: Partial<typeof products.$inferInsert>): Promise<Product> {
    const [p] = await db.update(products).set(data).where(eq(products.id, id)).returning();
    return p;
  },

  async deleteProduct(id: number): Promise<void> {
    await db.update(products).set({ active: false }).where(eq(products.id, id));
  },

  // ─── Purchases ────────────────────────────────────────────────────────────
  async getPurchases(): Promise<(Purchase & { itemCount: number })[]> {
    const all = await db.select().from(purchases).orderBy(desc(purchases.createdAt));
    const result = await Promise.all(
      all.map(async (p) => {
        const items = await db.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, p.id));
        return { ...p, itemCount: items.length };
      })
    );
    return result;
  },

  async getPurchase(id: number): Promise<(Purchase & { items: (PurchaseItem & { product: Product })[] }) | undefined> {
    const [p] = await db.select().from(purchases).where(eq(purchases.id, id)).limit(1);
    if (!p) return undefined;
    const items = await db.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, id));
    const itemsWithProducts = await Promise.all(
      items.map(async (item) => {
        const [product] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
        return { ...item, product };
      })
    );
    return { ...p, items: itemsWithProducts };
  },

  async createPurchase(data: {
    folio: string;
    supplierName: string;
    purchaseDate: Date;
    notes?: string;
    createdBy: number;
    items: { productId: number; quantity: string; unit: "kg" | "pz" | "caja" | "saco" | "litro" | "tonelada"; costPerUnit: string }[];
  }): Promise<Purchase> {
    let total = 0;
    const itemsWithSubtotal = data.items.map((item) => {
      const subtotal = parseFloat(item.quantity) * parseFloat(item.costPerUnit);
      total += subtotal;
      return { ...item, subtotal: subtotal.toFixed(2) };
    });

    const [purchase] = await db.insert(purchases).values({
      folio: data.folio,
      supplierName: data.supplierName,
      purchaseDate: data.purchaseDate,
      notes: data.notes,
      createdBy: data.createdBy,
      total: total.toFixed(2),
    }).returning();

    await db.insert(purchaseItems).values(
      itemsWithSubtotal.map((item) => ({
        purchaseId: purchase.id,
        productId: item.productId,
        quantity: item.quantity,
        unit: item.unit,
        costPerUnit: item.costPerUnit,
        subtotal: item.subtotal,
      }))
    );

    for (const item of data.items) {
      const [product] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
      if (!product) continue;

      const currentStock = parseFloat(product.currentStock as string);
      const currentAvgCost = parseFloat(product.averageCost as string);
      const newQty = parseFloat(item.quantity);
      const newCost = parseFloat(item.costPerUnit);

      const newAvgCost =
        currentStock + newQty === 0
          ? newCost
          : (currentStock * currentAvgCost + newQty * newCost) / (currentStock + newQty);

      const previousCost = product.averageCost as string;

      await db.update(products).set({
        currentStock: (currentStock + newQty).toFixed(4),
        averageCost: newAvgCost.toFixed(4),
      }).where(eq(products.id, item.productId));

      await db.insert(stockMovements).values({
        productId: item.productId,
        movementType: "in",
        quantity: item.quantity,
        unitCost: item.costPerUnit,
        referenceId: purchase.id,
        referenceType: "purchase",
        notes: `Compra ${data.folio}`,
      });

      await db.insert(productCostHistory).values({
        productId: item.productId,
        averageCost: newAvgCost.toFixed(4),
        previousCost,
        purchaseId: purchase.id,
      });
    }

    return purchase;
  },

  async generateFolio(): Promise<string> {
    const [last] = await db.select().from(purchases).orderBy(desc(purchases.id)).limit(1);
    const num = last ? parseInt(last.folio.replace("OC-", "")) + 1 : 1;
    return `OC-${String(num).padStart(5, "0")}`;
  },

  async getStockMovements(productId?: number): Promise<StockMovement[]> {
    if (productId) {
      return db.select().from(stockMovements).where(eq(stockMovements.productId, productId)).orderBy(desc(stockMovements.createdAt));
    }
    return db.select().from(stockMovements).orderBy(desc(stockMovements.createdAt));
  },
};
