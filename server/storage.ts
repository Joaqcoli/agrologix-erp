import { db } from "./db";
import {
  users, customers, products, purchases, purchaseItems,
  stockMovements, productCostHistory, orders, orderItems,
  priceHistory, remitos, productUnits, payments, withholdings,
  type User, type Customer, type Product, type Purchase,
  type PurchaseItem, type StockMovement, type Order,
  type OrderItem, type PriceHistory, type Remito, type ProductUnit,
  type Payment, type Withholding, type InsertPayment, type InsertWithholding,
} from "@shared/schema";
import { eq, desc, asc, and, sql as drizzleSql, ne, gte, lt, lte, between, inArray } from "drizzle-orm";
import { dbEnumToCanonical } from "@shared/units";
import bcrypt from "bcryptjs";

// ─── CC Helpers ────────────────────────────────────────────────────────────────
const IVA_HUEVO = 0.21;
const IVA_DEFAULT = 0.105;
function ivaRate(productName: string): number {
  return productName.toUpperCase().includes("HUEVO") ? IVA_HUEVO : IVA_DEFAULT;
}

// Items enriched with product name for IVA computation
type RawOrderItem = {
  orderId: number;
  customerId: number;
  orderDate: string; // ISO date string
  quantity: string;
  pricePerUnit: string | null;
  costPerUnit: string;
  overrideCostPerUnit: string | null;
  unit: string;
  productName: string;
};

// Compute billing amount for one item (with or without IVA)
function itemBilling(item: RawOrderItem, hasIva: boolean): number {
  if (!item.pricePerUnit || parseFloat(item.pricePerUnit) === 0) return 0;
  const subtotal = parseFloat(item.quantity) * parseFloat(item.pricePerUnit);
  return hasIva ? subtotal * (1 + ivaRate(item.productName)) : subtotal;
}

// Compute gross profit for one item (always neto, no IVA)
function itemProfit(item: RawOrderItem): number {
  if (!item.pricePerUnit || parseFloat(item.pricePerUnit) === 0) return 0;
  const qty = parseFloat(item.quantity);
  const price = parseFloat(item.pricePerUnit);
  const cost = parseFloat(item.overrideCostPerUnit ?? item.costPerUnit ?? "0");
  return qty * (price - cost);
}

// Is this unit a "bulto" (physical box/bag)?
const BULTO_UNITS = new Set(["caja", "saco"]);
function isBulto(unit: string): boolean {
  return BULTO_UNITS.has(unit.toLowerCase());
}

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
  async getProducts(filters?: { category?: string; search?: string }): Promise<Product[]> {
    const conditions = [eq(products.active, true)];
    if (filters?.category) conditions.push(drizzleSql`${products.category} = ${filters.category}`);
    if (filters?.search) conditions.push(drizzleSql`upper(${products.name}) LIKE ${'%' + filters.search.toUpperCase() + '%'}`);
    return db.select().from(products)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions as any))
      .orderBy(asc(products.name));
  },

  async getProduct(id: number): Promise<Product | undefined> {
    const [p] = await db.select().from(products).where(eq(products.id, id)).limit(1);
    return p;
  },

  async createProduct(data: Omit<typeof products.$inferInsert, "id" | "createdAt" | "averageCost" | "currentStock">): Promise<Product> {
    const [p] = await db.insert(products).values({ ...data, sku: null, averageCost: "0", currentStock: "0" }).returning();
    return p;
  },

  async updateProduct(id: number, data: Partial<typeof products.$inferInsert>): Promise<Product> {
    const [p] = await db.update(products).set(data).where(eq(products.id, id)).returning();
    return p;
  },

  async deleteProduct(id: number): Promise<void> {
    await db.update(products).set({ active: false }).where(eq(products.id, id));
  },

  // ─── Price History ─────────────────────────────────────────────────────────
  async getLastPrice(customerId: number, productId: number): Promise<PriceHistory | undefined> {
    const [record] = await db
      .select()
      .from(priceHistory)
      .where(and(eq(priceHistory.customerId, customerId), eq(priceHistory.productId, productId)))
      .orderBy(desc(priceHistory.createdAt))
      .limit(1);
    return record;
  },

  async savePriceHistory(customerId: number, productId: number, pricePerUnit: string, orderId: number): Promise<void> {
    await db.insert(priceHistory).values({ customerId, productId, pricePerUnit, orderId });
  },

  // ─── Purchases ────────────────────────────────────────────────────────────
  async getPurchases(date?: string): Promise<(Purchase & { itemCount: number })[]> {
    let all: Purchase[];
    if (date) {
      all = await db.select().from(purchases)
        .where(drizzleSql`${purchases.purchaseDate}::date = ${date}::date`)
        .orderBy(desc(purchases.createdAt));
    } else {
      all = await db.select().from(purchases).orderBy(desc(purchases.createdAt));
    }
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
    items: {
      productId: number;
      quantity: string;
      unit: string;
      costPerUnit: string;
      purchaseQty?: string;
      purchaseUnit?: string;
      weightPerPackage?: string;
    }[];
  }): Promise<Purchase> {
    // Pre-compute totals (no DB)
    let total = 0;
    const itemsWithSubtotal = data.items.map((item) => {
      const subtotal = parseFloat(item.quantity) * parseFloat(item.costPerUnit);
      total += subtotal;
      return { ...item, subtotal: subtotal.toFixed(2) };
    });

    const purchaseDateStr = data.purchaseDate.toISOString().slice(0, 10);

    return db.transaction(async (tx) => {
      const [purchase] = await tx.insert(purchases).values({
        folio: data.folio,
        supplierName: data.supplierName,
        purchaseDate: data.purchaseDate,
        notes: data.notes,
        createdBy: data.createdBy,
        total: total.toFixed(2),
      }).returning();

      await tx.insert(purchaseItems).values(
        itemsWithSubtotal.map((item) => ({
          purchaseId: purchase.id,
          productId: item.productId,
          quantity: item.quantity,
          unit: item.unit as any,
          costPerUnit: item.costPerUnit,
          subtotal: item.subtotal,
          ...(item.purchaseQty ? { purchaseQty: item.purchaseQty } : {}),
          ...(item.purchaseUnit ? { purchaseUnit: item.purchaseUnit as any } : {}),
          ...(item.weightPerPackage ? { weightPerPackage: item.weightPerPackage } : {}),
        }))
      );

      // Ordenar por productId para adquirir locks en orden consistente → evita deadlocks
      const sortedItems = [...data.items].sort((a, b) => a.productId - b.productId);

      for (const item of sortedItems) {
        // FOR UPDATE: serializa escrituras concurrentes de stock/costo sobre el mismo producto
        const [product] = await tx.select().from(products)
          .where(eq(products.id, item.productId))
          .for('update')
          .limit(1);
        if (!product) continue;

        const newQty = parseFloat(item.quantity);
        const newCost = parseFloat(item.costPerUnit);

        // ── product_units: costo promedio ponderado + stock acumulado ─────────────
        const canonicalUnit = dbEnumToCanonical(item.unit);
        const [existingPU] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
          .for('update')
          .limit(1);

        if (existingPU) {
          const puStock = parseFloat(existingPU.stockQty as string);
          const puCost = parseFloat(existingPU.avgCost as string);
          const newPuAvgCost = puStock + newQty === 0 ? newCost : (puStock * puCost + newQty * newCost) / (puStock + newQty);
          await tx.update(productUnits).set({
            stockQty: (puStock + newQty).toFixed(4),
            avgCost: newPuAvgCost.toFixed(4),
          }).where(eq(productUnits.id, existingPU.id));
        } else {
          await tx.insert(productUnits).values({
            productId: item.productId,
            unit: canonicalUnit,
            avgCost: newCost.toFixed(4),
            stockQty: newQty.toFixed(4),
          });
        }

        // ── products.currentStock + averageCost: costo promedio ponderado ───────────
        // Nuevo costo = ((stock_actual * costo_actual) + (qty * costo_compra)) / stock_total
        const currentStock = parseFloat(product.currentStock as string);
        const currentAvgCost = parseFloat(product.averageCost as string);
        const newAvgCost = currentStock + newQty === 0
          ? newCost
          : (currentStock * currentAvgCost + newQty * newCost) / (currentStock + newQty);
        const previousCost = product.averageCost as string;

        await tx.update(products).set({
          currentStock: (currentStock + newQty).toFixed(4),
          averageCost: newAvgCost.toFixed(4),
        }).where(eq(products.id, item.productId));

        await tx.insert(stockMovements).values({
          productId: item.productId,
          movementType: "in",
          quantity: item.quantity,
          unitCost: item.costPerUnit,
          referenceId: purchase.id,
          referenceType: "purchase",
          notes: `Compra ${data.folio}`,
        });

        await tx.insert(productCostHistory).values({
          productId: item.productId,
          averageCost: newAvgCost.toFixed(4),
          previousCost,
          purchaseId: purchase.id,
        });

        // ── SYNC: Update costPerUnit in same-day draft/approved order_items ──────
        const sameDayOrders = await tx
          .select({ id: orders.id })
          .from(orders)
          .where(and(
            drizzleSql`${orders.status} IN ('draft', 'approved')`,
            drizzleSql`${orders.orderDate}::date = ${purchaseDateStr}::date`,
          ));

        if (sameDayOrders.length > 0) {
          const sameDayOrderIds = sameDayOrders.map((o) => o.id);

          const candidateItems = await tx
            .select()
            .from(orderItems)
            .where(and(
              inArray(orderItems.orderId, sameDayOrderIds),
              eq(orderItems.productId, item.productId),
            ));

          const affectedOrderIds = new Set<number>();

          for (const oi of candidateItems) {
            const oiCanonical = dbEnumToCanonical(oi.unit as string);

            // Determine effective cost for this order item's unit
            let costForUnit: number;
            if (oiCanonical === canonicalUnit) {
              // Direct unit match (e.g. both KG)
              costForUnit = newCost;
            } else if (item.purchaseUnit && item.weightPerPackage) {
              // Cross-unit: purchase was converted to base unit (KG) but order is in original unit (CAJON)
              const purchaseCanonical = dbEnumToCanonical(item.purchaseUnit);
              if (oiCanonical !== purchaseCanonical) continue;
              // cost per package = cost per base unit × weight per package (e.g. $1000/kg × 18 kg/cajón = $18000/cajón)
              costForUnit = newCost * parseFloat(item.weightPerPackage);
            } else {
              continue;
            }

            const qty = Number(oi.quantity);
            const price = oi.pricePerUnit ? Number(oi.pricePerUnit) : null;
            const newSubtotal = price != null && price > 0 ? qty * price : 0;
            const newMargin = price && price > 0 ? (price - costForUnit) / price : null;

            const updateData: Record<string, any> = {
              costPerUnit: costForUnit.toFixed(4),
              subtotal: newSubtotal.toFixed(2),
            };
            if (newMargin !== null) updateData.margin = newMargin.toFixed(4);

            await tx.update(orderItems).set(updateData).where(eq(orderItems.id, oi.id));
            affectedOrderIds.add(oi.orderId);
          }

          // Recalculate totals for affected orders
          for (const orderId of Array.from(affectedOrderIds)) {
            const allOrderItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
            const orderTotal = allOrderItems.reduce((s, i) => s + Number(i.subtotal), 0);
            await tx.update(orders).set({ total: orderTotal.toFixed(2) }).where(eq(orders.id, orderId));
          }
        }
      }

      return purchase;
    });
  },

  async generatePurchaseFolio(): Promise<string> {
    const [row] = await db
      .select({ maxNum: drizzleSql<number>`COALESCE(MAX(CAST(REPLACE(folio, 'OC-', '') AS INTEGER)), 0)` })
      .from(purchases)
      .where(drizzleSql`folio LIKE 'OC-%'`);
    const nextNum = (Number(row?.maxNum) || 0) + 1;
    return `OC-${String(nextNum).padStart(5, "0")}`;
  },

  async _recalcProductSummary(pid: number, tx: any = db): Promise<void> {
    const allPu = await tx.select().from(productUnits).where(eq(productUnits.productId, pid));
    const totalStock = allPu.reduce((s: number, p: any) => s + Number(p.stockQty), 0);
    if (totalStock > 0) {
      const weightedAvg = allPu.reduce((s: number, p: any) => s + Number(p.stockQty) * Number(p.avgCost), 0) / totalStock;
      await tx.update(products).set({
        currentStock: totalStock.toFixed(4),
        averageCost: weightedAvg.toFixed(4),
      }).where(eq(products.id, pid));
    } else {
      // Stock is zero: preserve last known averageCost, only zero the stock count
      await tx.update(products).set({ currentStock: "0" }).where(eq(products.id, pid));
    }
  },

  async deletePurchase(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      const items = await tx.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, id));

      for (const item of items) {
        const canonicalUnit = dbEnumToCanonical(item.unit as any);
        const [pu] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
          .limit(1);
        if (pu) {
          const newStock = Number(pu.stockQty) - Number(item.quantity);
          if (newStock <= 0) {
            // Preserve avgCost — only zero the stock qty
            await tx.update(productUnits).set({ stockQty: "0" }).where(eq(productUnits.id, pu.id));
          } else {
            await tx.update(productUnits).set({ stockQty: newStock.toFixed(4) }).where(eq(productUnits.id, pu.id));
          }
        }
      }

      const affectedProductIds = Array.from(new Set(items.map((i) => i.productId)));
      for (const pid of affectedProductIds) {
        await this._recalcProductSummary(pid, tx);
      }

      await tx.delete(stockMovements)
        .where(and(eq(stockMovements.referenceType, "purchase"), eq(stockMovements.referenceId, id)));
      await tx.delete(productCostHistory).where(eq(productCostHistory.purchaseId, id));
      await tx.delete(purchaseItems).where(eq(purchaseItems.purchaseId, id));
      await tx.delete(purchases).where(eq(purchases.id, id));
    });
  },

  async updatePurchase(id: number, data: {
    supplierName: string;
    purchaseDate: Date;
    notes?: string;
    items: { productId: number; quantity: string; unit: "kg" | "pz" | "caja" | "saco" | "litro" | "tonelada"; costPerUnit: string }[];
  }): Promise<Purchase> {
    return db.transaction(async (tx) => {
      const purchaseDateStr = data.purchaseDate.toISOString().slice(0, 10);

      // ── Pre-lock de todos los productos afectados (viejos + nuevos) ─────────────
      // Adquirir locks en orden ascendente de productId para evitar deadlocks entre
      // transacciones concurrentes que toquen los mismos productos.
      const oldItems = await tx.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, id));
      const allProductIds = Array.from(new Set([
        ...oldItems.map((i) => i.productId),
        ...data.items.map((i) => i.productId),
      ])).sort((a, b) => a - b);
      for (const pid of allProductIds) {
        await tx.select({ id: products.id }).from(products)
          .where(eq(products.id, pid))
          .for('update')
          .limit(1);
      }

      // ── PHASE 1: Revertir items anteriores ────────────────────────────────────
      for (const item of oldItems) {
        const canonicalUnit = dbEnumToCanonical(item.unit as any);
        const [pu] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
          .for('update')
          .limit(1);
        if (pu) {
          const newStock = Number(pu.stockQty) - Number(item.quantity);
          // Preserve avgCost — solo zerear stock si queda negativo
          await tx.update(productUnits)
            .set({ stockQty: newStock <= 0 ? "0" : newStock.toFixed(4) })
            .where(eq(productUnits.id, pu.id));
        }
      }
      const oldProductIds = Array.from(new Set(oldItems.map((i) => i.productId)));
      for (const pid of oldProductIds) {
        await this._recalcProductSummary(pid, tx);
      }

      // Capturar el costo anterior (post-reversal = costo sin esta compra) para auditoría
      const previousCostMap = new Map<number, string>();
      for (const pid of Array.from(new Set(data.items.map((i) => i.productId)))) {
        const [p] = await tx.select({ averageCost: products.averageCost })
          .from(products).where(eq(products.id, pid)).limit(1);
        if (p) previousCostMap.set(pid, p.averageCost as string);
      }

      // ── PHASE 2: Aplicar nuevos items ─────────────────────────────────────────
      let total = 0;
      const itemsWithSubtotal = data.items.map((item) => {
        const subtotal = Number(item.quantity) * Number(item.costPerUnit);
        total += subtotal;
        return { ...item, subtotal: subtotal.toFixed(2) };
      });

      // Procesar en orden de productId (locks ya adquiridos arriba)
      const sortedNewItems = [...data.items].sort((a, b) => a.productId - b.productId);
      for (const item of sortedNewItems) {
        const newQty = Number(item.quantity);
        const newCost = Number(item.costPerUnit);
        const canonicalUnit = dbEnumToCanonical(item.unit);
        const [existingPU] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
          .for('update')
          .limit(1);
        if (existingPU) {
          const puStock = Number(existingPU.stockQty);
          const puCost = Number(existingPU.avgCost);
          // Costo promedio ponderado = ((stock * costo_actual) + (qty * costo_compra)) / stock_total
          const newPuAvgCost = (puStock + newQty) === 0
            ? newCost
            : (puStock * puCost + newQty * newCost) / (puStock + newQty);
          await tx.update(productUnits).set({
            stockQty: (puStock + newQty).toFixed(4),
            avgCost: newPuAvgCost.toFixed(4),
          }).where(eq(productUnits.id, existingPU.id));
        } else {
          await tx.insert(productUnits).values({
            productId: item.productId,
            unit: canonicalUnit,
            avgCost: newCost.toFixed(4),
            stockQty: newQty.toFixed(4),
          });
        }
      }
      const newProductIds = Array.from(new Set(data.items.map((i) => i.productId)));
      for (const pid of newProductIds) {
        await this._recalcProductSummary(pid, tx);
      }

      // ── Actualizar cabecera de compra ─────────────────────────────────────────
      const [updated] = await tx.update(purchases).set({
        supplierName: data.supplierName,
        purchaseDate: data.purchaseDate,
        notes: data.notes,
        total: total.toFixed(2),
      }).where(eq(purchases.id, id)).returning();

      // ── Reemplazar purchase_items ─────────────────────────────────────────────
      await tx.delete(purchaseItems).where(eq(purchaseItems.purchaseId, id));
      await tx.insert(purchaseItems).values(
        itemsWithSubtotal.map((item) => ({
          purchaseId: id,
          productId: item.productId,
          quantity: item.quantity,
          unit: item.unit,
          costPerUnit: item.costPerUnit,
          subtotal: item.subtotal,
        }))
      );

      // ── Auditoría: regenerar movimientos_stock y productCostHistory ───────────
      await tx.delete(stockMovements)
        .where(and(eq(stockMovements.referenceType, "purchase"), eq(stockMovements.referenceId, id)));
      await tx.delete(productCostHistory).where(eq(productCostHistory.purchaseId, id));

      for (const item of data.items) {
        // Leer producto con su averageCost ya recalculado en PHASE 2
        const [product] = await tx.select().from(products)
          .where(eq(products.id, item.productId)).limit(1);
        if (!product) continue;
        await tx.insert(stockMovements).values({
          productId: item.productId,
          movementType: "in",
          quantity: item.quantity,
          unitCost: item.costPerUnit,
          referenceId: id,
          referenceType: "purchase",
          notes: `Compra ${updated.folio} (editada)`,
        });
        await tx.insert(productCostHistory).values({
          productId: item.productId,
          averageCost: product.averageCost as string,
          // previousCost = costo ANTES de re-aplicar esta compra (capturado post-reversal)
          previousCost: previousCostMap.get(item.productId) ?? product.averageCost as string,
          purchaseId: id,
        });
      }

      // ── SYNC: propagar costo actualizado a order_items del mismo día ──────────
      // Impacto inmediato en márgenes de pedidos activos (draft/approved)
      for (const item of data.items) {
        const canonicalUnit = dbEnumToCanonical(item.unit);
        const newCost = Number(item.costPerUnit);

        const sameDayOrders = await tx
          .select({ id: orders.id })
          .from(orders)
          .where(and(
            drizzleSql`${orders.status} IN ('draft', 'approved')`,
            drizzleSql`${orders.orderDate}::date = ${purchaseDateStr}::date`,
          ));
        if (sameDayOrders.length === 0) continue;

        const sameDayOrderIds = sameDayOrders.map((o) => o.id);
        const candidateItems = await tx
          .select()
          .from(orderItems)
          .where(and(
            inArray(orderItems.orderId, sameDayOrderIds),
            eq(orderItems.productId, item.productId),
          ));

        const affectedOrderIds = new Set<number>();
        for (const oi of candidateItems) {
          if (dbEnumToCanonical(oi.unit as string) !== canonicalUnit) continue;
          const qty = Number(oi.quantity);
          const price = oi.pricePerUnit ? Number(oi.pricePerUnit) : null;
          const newSubtotal = price != null && price > 0 ? qty * price : 0;
          const newMargin = price && price > 0 ? (price - newCost) / price : null;
          const updateData: Record<string, any> = {
            costPerUnit: item.costPerUnit,
            subtotal: newSubtotal.toFixed(2),
          };
          if (newMargin !== null) updateData.margin = newMargin.toFixed(4);
          await tx.update(orderItems).set(updateData).where(eq(orderItems.id, oi.id));
          affectedOrderIds.add(oi.orderId);
        }

        // Recalcular total de cada pedido afectado
        for (const orderId of Array.from(affectedOrderIds)) {
          const allOrderItems = await tx.select().from(orderItems)
            .where(eq(orderItems.orderId, orderId));
          const orderTotal = allOrderItems.reduce((s, i) => s + Number(i.subtotal), 0);
          await tx.update(orders).set({ total: orderTotal.toFixed(2) })
            .where(eq(orders.id, orderId));
        }
      }

      return updated;
    });
  },

  async getStockMovements(productId?: number): Promise<StockMovement[]> {
    if (productId) {
      return db.select().from(stockMovements).where(eq(stockMovements.productId, productId)).orderBy(desc(stockMovements.createdAt));
    }
    return db.select().from(stockMovements).orderBy(desc(stockMovements.createdAt));
  },

  // ─── Orders ───────────────────────────────────────────────────────────────
  async getNextRemitoFolio(): Promise<string> {
    const [last] = await db.select().from(remitos).orderBy(desc(remitos.id)).limit(1);
    const num = last ? parseInt(last.folio.replace("VA-", "")) + 1 : 1;
    return `VA-${String(num).padStart(6, "0")}`;
  },

  async getOrders(date?: string): Promise<(Order & { customerName: string; itemCount: number; suggestedRemito: string; hasIva: boolean; totalConIva: string; totalCosto: string })[]> {
    let all: Order[];
    if (date) {
      all = await db
        .select()
        .from(orders)
        .where(drizzleSql`${orders.orderDate}::date = ${date}::date`)
        .orderBy(desc(orders.createdAt));
    } else {
      all = await db.select().from(orders).orderBy(desc(orders.createdAt));
    }
    // Compute the global next remito folio base (we'll increment per order in draft status for display)
    const [lastRemito] = await db.select().from(remitos).orderBy(desc(remitos.id)).limit(1);
    let nextRemitoNum = lastRemito ? parseInt(lastRemito.folio.replace("VA-", "")) + 1 : 1;

    // Pre-fetch all products for IVA calculation
    const allProducts = await db.select().from(products);
    const products_cache = new Map(allProducts.map((p) => [p.id, p]));

    const result = await Promise.all(
      all.map(async (o) => {
        const [customer] = await db.select().from(customers).where(eq(customers.id, o.customerId)).limit(1);
        const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
        // For approved orders with a remito, show existing remito folio
        let suggestedRemito = `VA-${String(nextRemitoNum).padStart(6, "0")}`;
        if (o.remitoId) {
          const [existingRemito] = await db.select().from(remitos).where(eq(remitos.id, o.remitoId)).limit(1);
          suggestedRemito = existingRemito?.folio ?? suggestedRemito;
        } else if (o.status === "draft") {
          nextRemitoNum++;
        }
        // Compute IVA total and costo for this order
        let totalConIva = parseFloat(o.total as string);
        let totalCosto = 0;
        if (customer?.hasIva) {
          totalConIva = items.reduce((sum, item) => {
            if (!item.pricePerUnit) return sum;
            const subtotal = parseFloat(item.quantity as string) * parseFloat(item.pricePerUnit as string);
            const productRow = item.productId ? products_cache.get(item.productId) : null;
            const productName = productRow?.name ?? "";
            const rate = productName.toUpperCase().includes("HUEVO") ? 0.21 : 0.105;
            return sum + subtotal * (1 + rate);
          }, 0);
        }
        totalCosto = items.reduce((sum, item) => {
          const qty = parseFloat(item.quantity as string);
          const cost = item.costPerUnit ? parseFloat(item.costPerUnit as string) : 0;
          return sum + qty * cost;
        }, 0);

        return { ...o, customerName: customer?.name ?? "", itemCount: items.length, suggestedRemito, hasIva: customer?.hasIva ?? false, totalConIva: totalConIva.toFixed(2), totalCosto: totalCosto.toFixed(2) };
      })
    );
    return result;
  },

  async getOrder(id: number): Promise<(Order & { customer: Customer; items: (OrderItem & { product: Product })[] }) | undefined> {
    const [o] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!o) return undefined;
    const [customer] = await db.select().from(customers).where(eq(customers.id, o.customerId)).limit(1);
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
    const itemsWithProducts = await Promise.all(
      items.map(async (item) => {
        if (!item.productId) return { ...item, product: null as unknown as Product };
        const [product] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
        return { ...item, product: (product ?? null) as unknown as Product };
      })
    );
    return { ...o, customer, items: itemsWithProducts };
  },

  async getDraftOrderByCustomerAndDate(customerId: number, date: string): Promise<Order | undefined> {
    const [o] = await db
      .select()
      .from(orders)
      .where(
        drizzleSql`${orders.customerId} = ${customerId} AND ${orders.status} = 'draft' AND ${orders.orderDate}::date = ${date}::date`
      )
      .limit(1);
    return o;
  },

  async createOrderFromIntake(data: {
    folio: string;
    customerId: number;
    orderDate: Date;
    notes?: string;
    createdBy: number;
    items: {
      productId: number | null;
      quantity: string;
      unit: string;
      rawProductName?: string;
      parseStatus?: string;
    }[];
  }): Promise<Order> {
    const [order] = await db.insert(orders).values({
      folio: data.folio,
      customerId: data.customerId,
      orderDate: data.orderDate,
      notes: data.notes,
      createdBy: data.createdBy,
      total: "0",
      status: "draft",
      lowMarginConfirmed: false,
    }).returning();

    const itemsToInsert = await Promise.all(
      data.items.map(async (item) => {
        let costPerUnit = "0";
        if (item.productId) {
          // Try product_units first (canonical unit lookup)
          const canonicalUnit = dbEnumToCanonical(item.unit ?? "kg");
          const [pu] = await db.select().from(productUnits)
            .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
            .limit(1);
          if (pu) {
            costPerUnit = pu.avgCost as string;
          } else {
            // Fallback to products.averageCost
            const [p] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
            if (p) costPerUnit = p.averageCost as string;
          }
        }
        return {
          orderId: order.id,
          productId: item.productId ?? null,
          quantity: item.quantity,
          unit: (item.unit as any) ?? "kg",
          pricePerUnit: null as any,
          costPerUnit,
          margin: null as any,
          subtotal: "0",
          rawProductName: item.rawProductName ?? null,
          parseStatus: item.parseStatus ?? "ok",
        };
      })
    );

    if (itemsToInsert.length > 0) {
      await db.insert(orderItems).values(itemsToInsert);
    }

    return order;
  },

  async addItemsToOrder(orderId: number, items: {
    productId: number | null;
    quantity: string;
    unit: string;
    rawProductName?: string;
    parseStatus?: string;
  }[]): Promise<void> {
    const itemsToInsert = await Promise.all(
      items.map(async (item) => {
        let costPerUnit = "0";
        if (item.productId) {
          const [p] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
          if (p) costPerUnit = p.averageCost as string;
        }
        return {
          orderId,
          productId: item.productId ?? null,
          quantity: item.quantity,
          unit: (item.unit as any) ?? "kg",
          pricePerUnit: null as any,
          costPerUnit,
          margin: null as any,
          subtotal: "0",
          rawProductName: item.rawProductName ?? null,
          parseStatus: item.parseStatus ?? "ok",
        };
      })
    );
    if (itemsToInsert.length > 0) {
      await db.insert(orderItems).values(itemsToInsert);
    }
  },

  async replaceOrderItems(orderId: number, items: {
    productId: number | null;
    quantity: string;
    unit: string;
    rawProductName?: string;
    parseStatus?: string;
  }[]): Promise<void> {
    await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
    await this.addItemsToOrder(orderId, items);
    await db.update(orders).set({ total: "0" }).where(eq(orders.id, orderId));
  },

  async deleteOrder(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!order) throw new Error("Pedido no encontrado");

      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, id));

      // Revert stock impact for approved orders
      if (order.status === "approved") {
        for (const item of items) {
          if (!item.productId) continue;
          const canonicalUnit = dbEnumToCanonical(item.unit as string);
          const [pu] = await tx.select().from(productUnits)
            .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
            .limit(1);
          if (pu) {
            const newStock = Number(pu.stockQty) + Number(item.quantity);
            await tx.update(productUnits).set({ stockQty: newStock.toFixed(4) }).where(eq(productUnits.id, pu.id));
          }
        }

        const affectedProductIds = Array.from(new Set(
          items.filter((i) => i.productId != null).map((i) => i.productId!)
        ));
        for (const pid of affectedProductIds) {
          await this._recalcProductSummary(pid, tx);
        }

        // Delete the "out" stock movements created on approval
        await tx.delete(stockMovements)
          .where(and(eq(stockMovements.referenceType, "order"), eq(stockMovements.referenceId, id)));
      }

      // Break circular FK (orders.remitoId ↔ remitos.orderId) before deleting
      if (order.remitoId) {
        await tx.update(orders).set({ remitoId: null }).where(eq(orders.id, id));
        await tx.delete(remitos).where(eq(remitos.id, order.remitoId));
      }

      // Null out price_history references (FK is nullable, no cascade)
      await tx.update(priceHistory).set({ orderId: null }).where(eq(priceHistory.orderId, id));
      await tx.delete(orderItems).where(eq(orderItems.orderId, id));
      await tx.delete(orders).where(eq(orders.id, id));
    });
  },

  async updateOrderItem(
    orderId: number,
    itemId: number,
    patch: {
      quantity?: string;
      unit?: string;
      productId?: number | null;
      pricePerUnit?: string | null;
      overrideCostPerUnit?: string | null;
    },
    customerId: number,
  ): Promise<{ item: OrderItem; orderTotal: string }> {
    return db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      const [item] = await tx.select().from(orderItems).where(
        and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId))
      ).limit(1);
      if (!item) throw new Error("Item not found");

      const isApproved = order?.status === "approved";
      const hasStructuralChange =
        patch.quantity !== undefined ||
        patch.unit !== undefined ||
        patch.productId !== undefined;

      // STEP 1: Revert old stock contribution for approved orders
      if (isApproved && hasStructuralChange && item.productId) {
        const oldCanonical = dbEnumToCanonical(item.unit as string);
        const [oldPu] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, oldCanonical)))
          .limit(1);
        if (oldPu) {
          const restoredStock = Number(oldPu.stockQty) + Number(item.quantity);
          await tx.update(productUnits).set({ stockQty: restoredStock.toFixed(4) }).where(eq(productUnits.id, oldPu.id));
        }
        await this._recalcProductSummary(item.productId, tx);
      }

      // STEP 2: Compute new field values
      const newProductId = patch.productId !== undefined ? patch.productId : item.productId;
      const newUnit = patch.unit ?? (item.unit as string);

      // Validate unit is active for the product
      if (newProductId && patch.unit) {
        const canonical = dbEnumToCanonical(patch.unit);
        const [pu] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, newProductId), eq(productUnits.unit, canonical), eq(productUnits.isActive, true)))
          .limit(1);
        if (!pu) throw new Error(`Unidad "${patch.unit}" no está habilitada para este producto`);
      }

      // Look up new cost from product_units when product or unit changes
      let newCostPerUnit: string | undefined;
      if (patch.productId !== undefined && patch.productId !== null) {
        const canonical = dbEnumToCanonical(newUnit);
        const [pu] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, patch.productId), eq(productUnits.unit, canonical), eq(productUnits.isActive, true)))
          .limit(1);
        if (pu) newCostPerUnit = pu.avgCost as string;
        else {
          const [p] = await tx.select().from(products).where(eq(products.id, patch.productId)).limit(1);
          if (p) newCostPerUnit = p.averageCost as string;
        }
      }

      // Effective cost for margin calculation: override > new product cost > existing cost
      const overrideVal = patch.overrideCostPerUnit !== undefined
        ? patch.overrideCostPerUnit
        : ((item as any).overrideCostPerUnit as string | null);
      const baseCost = newCostPerUnit ?? (item.costPerUnit as string);
      const effectiveCost = overrideVal ? Number(overrideVal) : Number(baseCost);

      const qty = Number(patch.quantity ?? (item.quantity as string));
      const existingPrice = item.pricePerUnit ? Number(item.pricePerUnit as string) : null;
      const newPriceRaw = patch.pricePerUnit !== undefined ? patch.pricePerUnit : null;
      const price = newPriceRaw !== undefined && newPriceRaw !== null
        ? Number(newPriceRaw)
        : existingPrice;
      const subtotal = price != null && price > 0 ? qty * price : 0;
      const margin = price && price > 0 ? (price - effectiveCost) / price : null;

      const updateData: Record<string, any> = { subtotal: subtotal.toFixed(2) };
      if (patch.quantity !== undefined) updateData.quantity = qty.toFixed(4);
      if (patch.unit !== undefined) updateData.unit = patch.unit;
      if (patch.productId !== undefined) updateData.productId = patch.productId;
      if (patch.pricePerUnit !== undefined) updateData.pricePerUnit = patch.pricePerUnit;
      if (patch.overrideCostPerUnit !== undefined) updateData.overrideCostPerUnit = patch.overrideCostPerUnit;
      if (newCostPerUnit !== undefined) updateData.costPerUnit = newCostPerUnit;
      if (margin !== null) updateData.margin = margin.toFixed(4);

      const [updated] = await tx.update(orderItems).set(updateData).where(eq(orderItems.id, itemId)).returning();

      // Recalculate order total
      const allItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      const total = allItems.reduce((s, i) => s + Number(i.subtotal), 0);
      await tx.update(orders).set({ total: total.toFixed(2) }).where(eq(orders.id, orderId));

      // Save price history when price is explicitly set and a product is linked
      if (patch.pricePerUnit && newProductId) {
        await tx.insert(priceHistory).values({ customerId, productId: newProductId, pricePerUnit: patch.pricePerUnit, orderId });
      }

      // STEP 3: Apply new stock deduction for approved orders
      if (isApproved && hasStructuralChange && newProductId) {
        const newCanonical = dbEnumToCanonical(newUnit);
        const [newPu] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, newProductId), eq(productUnits.unit, newCanonical)))
          .limit(1);
        if (newPu) {
          const deductedStock = Number(newPu.stockQty) - qty;
          await tx.update(productUnits).set({ stockQty: deductedStock.toFixed(4) }).where(eq(productUnits.id, newPu.id));
        }
        await this._recalcProductSummary(newProductId, tx);
      }

      return { item: updated, orderTotal: total.toFixed(2) };
    });
  },

  async updateOrderItemPrice(orderId: number, itemId: number, pricePerUnit: string): Promise<OrderItem> {
    const order = await this.getOrder(orderId);
    if (!order) throw new Error("Order not found");
    const { item } = await this.updateOrderItem(orderId, itemId, { pricePerUnit }, order.customerId);
    return item;
  },

  async generateOrderFolio(): Promise<string> {
    const [row] = await db
      .select({ maxNum: drizzleSql<number>`COALESCE(MAX(CAST(REPLACE(folio, 'PV-', '') AS INTEGER)), 0)` })
      .from(orders)
      .where(drizzleSql`folio LIKE 'PV-%'`);
    const nextNum = (Number(row?.maxNum) || 0) + 1;
    return `PV-${String(nextNum).padStart(5, "0")}`;
  },

  async createOrder(data: {
    folio: string;
    customerId: number;
    orderDate: Date;
    notes?: string;
    lowMarginConfirmed: boolean;
    createdBy: number;
    items: { productId: number; quantity: string; unit: string; pricePerUnit: string }[];
  }): Promise<Order> {
    let total = 0;
    const itemsEnriched = await Promise.all(
      data.items.map(async (item) => {
        const [product] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
        const costPerUnit = product ? parseFloat(product.averageCost as string) : 0;
        const price = parseFloat(item.pricePerUnit);
        const margin = price > 0 ? (price - costPerUnit) / price : 0;
        const subtotal = parseFloat(item.quantity) * price;
        total += subtotal;
        return {
          ...item,
          costPerUnit: costPerUnit.toFixed(4),
          margin: margin.toFixed(4),
          subtotal: subtotal.toFixed(2),
        };
      })
    );

    const [order] = await db.insert(orders).values({
      folio: data.folio,
      customerId: data.customerId,
      orderDate: data.orderDate,
      notes: data.notes,
      lowMarginConfirmed: data.lowMarginConfirmed,
      createdBy: data.createdBy,
      total: total.toFixed(2),
      status: "draft",
    }).returning();

    await db.insert(orderItems).values(
      itemsEnriched.map((item) => ({
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
        unit: item.unit as any,
        pricePerUnit: item.pricePerUnit,
        costPerUnit: item.costPerUnit,
        margin: item.margin,
        subtotal: item.subtotal,
      }))
    );

    return order;
  },

  async approveOrder(id: number, userId: number): Promise<Order> {
    const order = await this.getOrder(id);
    if (!order) throw new Error("Order not found");
    if (order.status !== "draft") throw new Error("Order is not in draft status");

    // Guard: all items must have a price before approval
    const unpricedItems = order.items.filter((i) => !i.pricePerUnit || parseFloat(i.pricePerUnit as string) === 0);
    if (unpricedItems.length > 0) {
      throw new Error(`${unpricedItems.length} producto(s) sin precio. Completá los precios antes de aprobar.`);
    }

    return db.transaction(async (tx) => {
      // Stock OUT — atomic per-item deduction with floor-at-zero safety
      for (const item of order.items) {
        if (!item.productId) continue;

        const qty = parseFloat(item.quantity as string);

        // Lock the product row for this transaction to prevent concurrent over-deduction
        const [product] = await tx.select().from(products)
          .where(eq(products.id, item.productId))
          .limit(1);
        if (!product) continue;

        const currentStock = parseFloat(product.currentStock as string);
        const rawNewStock = currentStock - qty;
        const isOverflow = rawNewStock < 0;
        const finalStock = isOverflow ? 0 : rawNewStock;

        const movementNotes = isOverflow
          ? `Stock agotado, excedente marcado con costo 0 por rinde (Pedido ${order.folio})`
          : `Pedido ${order.folio}`;

        // Stock OUT movement (audit trail)
        await tx.insert(stockMovements).values({
          productId: item.productId,
          movementType: "out",
          quantity: item.quantity as string,
          unitCost: item.costPerUnit as string,
          referenceId: id,
          referenceType: "order",
          notes: movementNotes,
        });

        // Deduct from product_units (canonical unit) — floor at 0
        const canonicalUnit = dbEnumToCanonical(item.unit as string);
        const [pu] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
          .limit(1);
        if (pu) {
          const rawPuStock = parseFloat(pu.stockQty as string) - qty;
          const finalPuStock = rawPuStock < 0 ? 0 : rawPuStock;
          await tx.update(productUnits)
            .set({
              stockQty: finalPuStock.toFixed(4),
              ...(isOverflow && { avgCost: "0" }),
            })
            .where(eq(productUnits.id, pu.id));
        }

        // Update products.currentStock — floor at 0; reset averageCost on overflow
        await tx.update(products)
          .set({
            currentStock: finalStock.toFixed(4),
            ...(isOverflow && { averageCost: "0" }),
          })
          .where(eq(products.id, item.productId));

        // Save final price to price_history
        await tx.insert(priceHistory).values({
          customerId: order.customerId,
          productId: item.productId,
          pricePerUnit: item.pricePerUnit as string,
          orderId: id,
        });
      }

      // Generate remito
      const [lastRemito] = await tx.select().from(remitos).orderBy(desc(remitos.id)).limit(1);
      const remitoNum = lastRemito ? parseInt(lastRemito.folio.replace("VA-", "")) + 1 : 1;
      const remitoFolio = `VA-${String(remitoNum).padStart(6, "0")}`;

      const [remito] = await tx.insert(remitos).values({
        folio: remitoFolio,
        orderId: id,
        customerId: order.customerId,
      }).returning();

      // Update order status
      const [updated] = await tx.update(orders).set({
        status: "approved",
        approvedBy: userId,
        approvedAt: new Date(),
        remitoId: remito.id,
      }).where(eq(orders.id, id)).returning();

      return updated;
    });
  },

  async getRemito(id: number): Promise<(Remito & { order: Order & { customer: Customer; items: (OrderItem & { product: Product })[] } }) | undefined> {
    const [r] = await db.select().from(remitos).where(eq(remitos.id, id)).limit(1);
    if (!r) return undefined;
    const order = await this.getOrder(r.orderId);
    if (!order) return undefined;
    return { ...r, order };
  },

  async getRemitoByOrderId(orderId: number): Promise<Remito | undefined> {
    const [r] = await db.select().from(remitos).where(eq(remitos.orderId, orderId)).limit(1);
    return r;
  },

  // ─── Load List ─────────────────────────────────────────────────────────────
  async getLoadListByDate(date: string, includeDrafts: boolean): Promise<{
    summary: { date: string; ordersCount: number; customersCount: number; rowsCount: number; shortagesCount: number };
    rows: Array<{ productId: number; productName: string; unit: string; totalQty: number; stockQty: number; diffQty: number; customersCount: number; customerNames: string[] }>;
    pending: Array<{ orderId: number; orderFolio: string; customerName: string; rawText: string; qty: number | null; unit: string | null }>;
  }> {
    const statusFilter = includeDrafts
      ? drizzleSql`${orders.status} IN ('approved','draft')`
      : eq(orders.status, "approved");

    const dayOrders = await db
      .select({ id: orders.id, folio: orders.folio, customerId: orders.customerId, status: orders.status })
      .from(orders)
      .where(and(statusFilter, drizzleSql`${orders.orderDate}::date = ${date}::date`));

    if (dayOrders.length === 0) {
      return { summary: { date, ordersCount: 0, customersCount: 0, rowsCount: 0, shortagesCount: 0 }, rows: [], pending: [] };
    }

    const customerIds = Array.from(new Set(dayOrders.map((o) => o.customerId)));
    const allCustomers = await db.select({ id: customers.id, name: customers.name }).from(customers)
      .where(drizzleSql`${customers.id} = ANY(ARRAY[${drizzleSql.join(customerIds.map(id => drizzleSql`${id}`), drizzleSql`, `)}]::int[])`);
    const customerMap = new Map(allCustomers.map((c) => [c.id, c.name]));

    const orderIds = dayOrders.map((o) => o.id);
    const orderCustomerMap = new Map(dayOrders.map((o) => [o.id, o.customerId]));
    const orderFolioMap = new Map(dayOrders.map((o) => [o.id, o.folio]));

    const allItems = await db.select().from(orderItems)
      .where(drizzleSql`${orderItems.orderId} = ANY(ARRAY[${drizzleSql.join(orderIds.map(id => drizzleSql`${id}`), drizzleSql`, `)}]::int[])`);

    // Pending: items with no productId
    const pending: Array<{ orderId: number; orderFolio: string; customerName: string; rawText: string; qty: number | null; unit: string | null }> = [];
    const resolvedItems = allItems.filter((item) => {
      if (!item.productId) {
        const cid = orderCustomerMap.get(item.orderId);
        pending.push({
          orderId: item.orderId,
          orderFolio: orderFolioMap.get(item.orderId) ?? "",
          customerName: cid ? (customerMap.get(cid) ?? "?") : "?",
          rawText: item.rawProductName ?? "?",
          qty: item.quantity ? parseFloat(item.quantity as string) : null,
          unit: item.unit ?? null,
        });
        return false;
      }
      return true;
    });

    // Load product names and categories
    const productIds = Array.from(new Set(resolvedItems.map((i) => i.productId as number)));
    const allProducts = productIds.length > 0
      ? await db.select({ id: products.id, name: products.name, category: products.category }).from(products)
          .where(drizzleSql`${products.id} = ANY(ARRAY[${drizzleSql.join(productIds.map(id => drizzleSql`${id}`), drizzleSql`, `)}]::int[])`)
      : [];
    const productNameMap = new Map(allProducts.map((p) => [p.id, p.name]));
    const productCategoryMap = new Map(allProducts.map((p) => [p.id, p.category ?? ""]));

    // Load stock from product_units
    const allPU = productIds.length > 0
      ? await db.select({ productId: productUnits.productId, unit: productUnits.unit, stockQty: productUnits.stockQty })
          .from(productUnits)
          .where(drizzleSql`${productUnits.productId} = ANY(ARRAY[${drizzleSql.join(productIds.map(id => drizzleSql`${id}`), drizzleSql`, `)}]::int[])`)
      : [];
    const stockMap = new Map<string, number>();
    for (const pu of allPU) {
      stockMap.set(`${pu.productId}-${pu.unit}`, parseFloat(pu.stockQty as string));
    }

    // Consolidate by productId + unit
    type Row = { productId: number; productName: string; category: string; unit: string; totalQty: number; stockQty: number; diffQty: number; customerSet: Set<number>; customerNames: string[] };
    const rowMap = new Map<string, Row>();
    for (const item of resolvedItems) {
      const pid = item.productId as number;
      const key = `${pid}-${item.unit}`;
      const qty = item.quantity ? parseFloat(item.quantity as string) : 0;
      const cid = orderCustomerMap.get(item.orderId);
      if (!rowMap.has(key)) {
        const stock = stockMap.get(`${pid}-${dbEnumToCanonical(item.unit as string)}`) ?? 0;
        rowMap.set(key, {
          productId: pid,
          productName: productNameMap.get(pid) ?? "?",
          category: productCategoryMap.get(pid) ?? "",
          unit: item.unit,
          totalQty: qty,
          stockQty: stock,
          diffQty: stock - qty,
          customerSet: new Set(cid !== undefined ? [cid] : []),
          customerNames: [],
        });
      } else {
        const row = rowMap.get(key)!;
        row.totalQty += qty;
        row.diffQty = row.stockQty - row.totalQty;
        if (cid !== undefined) row.customerSet.add(cid);
      }
    }

    const CATEGORY_ORDER: Record<string, number> = {
      "Fruta": 0, "Verdura": 1, "Hortaliza Liviana": 2,
      "Hortaliza Pesada": 3, "Hongos/Hierbas": 4, "Huevos": 5,
    };

    const rows = Array.from(rowMap.values()).map((r) => ({
      productId: r.productId,
      productName: r.productName,
      category: r.category,
      unit: r.unit,
      totalQty: r.totalQty,
      stockQty: r.stockQty,
      diffQty: r.diffQty,
      customersCount: r.customerSet.size,
      customerNames: Array.from(r.customerSet).map((id) => customerMap.get(id) ?? "?"),
    }));

    rows.sort((a, b) => {
      const catA = CATEGORY_ORDER[a.category] ?? 99;
      const catB = CATEGORY_ORDER[b.category] ?? 99;
      if (catA !== catB) return catA - catB;
      return a.productName.localeCompare(b.productName);
    });

    const shortagesCount = rows.filter((r) => r.diffQty < 0).length;
    const uniqueCustomers = new Set(dayOrders.map((o) => o.customerId));

    return {
      summary: { date, ordersCount: dayOrders.length, customersCount: uniqueCustomers.size, rowsCount: rows.length, shortagesCount },
      rows,
      pending,
    };
  },

  // ─── Product Units ──────────────────────────────────────────────────────────

  async getProductUnits(productId: number): Promise<ProductUnit[]> {
    return db.select().from(productUnits)
      .where(and(eq(productUnits.productId, productId), eq(productUnits.isActive, true)));
  },

  async getAllProductUnitsStock(filters?: { category?: string; search?: string; onlyInStock?: boolean }): Promise<(ProductUnit & { product: Product })[]> {
    const onlyInStock = filters?.onlyInStock !== false; // default true
    const puConditions: any[] = [eq(productUnits.isActive, true)];
    if (onlyInStock) puConditions.push(drizzleSql`${productUnits.stockQty} > 0`);

    const all = await db.select().from(productUnits)
      .where(and(...puConditions));

    const result = await Promise.all(
      all.map(async (pu) => {
        const [product] = await db.select().from(products).where(eq(products.id, pu.productId)).limit(1);
        return { ...pu, product };
      })
    );

    return result.filter((r) => {
      if (!r.product?.active) return false;
      if (filters?.category && r.product.category !== filters.category) return false;
      if (filters?.search && !r.product.name.toUpperCase().includes(filters.search.toUpperCase())) return false;
      return true;
    }).sort((a, b) => a.product.name.localeCompare(b.product.name));
  },

  async upsertProductUnit(productId: number, unit: string): Promise<ProductUnit> {
    const [existing] = await db.select().from(productUnits)
      .where(and(eq(productUnits.productId, productId), eq(productUnits.unit, unit)))
      .limit(1);
    if (existing) {
      // Just activate it if inactive
      if (!existing.isActive) {
        const [updated] = await db.update(productUnits).set({ isActive: true }).where(eq(productUnits.id, existing.id)).returning();
        return updated;
      }
      return existing;
    }
    const [created] = await db.insert(productUnits).values({ productId, unit, avgCost: "0", stockQty: "0" }).returning();
    return created;
  },

  async deactivateProductUnit(id: number): Promise<void> {
    await db.update(productUnits).set({ isActive: false }).where(eq(productUnits.id, id));
  },

  async adjustProductUnitStock(id: number, adjustment: number, _notes?: string): Promise<ProductUnit> {
    const [pu] = await db.select().from(productUnits).where(eq(productUnits.id, id)).limit(1);
    if (!pu) throw new Error("ProductUnit not found");
    const newStock = parseFloat(pu.stockQty as string) + adjustment;
    const [updated] = await db.update(productUnits).set({ stockQty: newStock.toFixed(4) }).where(eq(productUnits.id, id)).returning();
    // Sync products.currentStock (pick first active unit as primary)
    const allPu = await db.select().from(productUnits).where(eq(productUnits.productId, pu.productId));
    const totalStock = allPu.reduce((s, p) => s + parseFloat(p.stockQty as string), 0);
    await db.update(products).set({ currentStock: totalStock.toFixed(4) }).where(eq(products.id, pu.productId));
    return updated;
  },

  async addStockAdjustments(items: { productId: number; unit: string; qty: number }[]): Promise<void> {
    for (const item of items) {
      const canonicalUnit = item.unit.trim().toUpperCase();
      const [existing] = await db.select().from(productUnits)
        .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
        .limit(1);
      if (existing) {
        const newStock = parseFloat(existing.stockQty as string) + item.qty;
        await db.update(productUnits)
          .set({ stockQty: newStock.toFixed(4), isActive: true })
          .where(eq(productUnits.id, existing.id));
      } else {
        await db.insert(productUnits).values({
          productId: item.productId,
          unit: canonicalUnit,
          avgCost: "0",
          stockQty: item.qty.toFixed(4),
          isActive: true,
        });
      }
      const allPu = await db.select().from(productUnits).where(eq(productUnits.productId, item.productId));
      const totalStock = allPu.reduce((s, p) => s + parseFloat(p.stockQty as string), 0);
      await db.update(products).set({ currentStock: totalStock.toFixed(4) }).where(eq(products.id, item.productId));
    }
  },

  async bulkImportProducts(lines: { name: string; unit: string }[]): Promise<{ created: number; unitsAdded: number }> {
    let created = 0;
    let unitsAdded = 0;
    for (const line of lines) {
      const normalizedName = line.name.trim().toUpperCase();
      const canonicalUnit = line.unit.trim().toUpperCase(); // already canonicalized by caller

      // Find or create product (no SKU)
      let [existing] = await db.select().from(products)
        .where(drizzleSql`upper(${products.name}) = ${normalizedName}`)
        .limit(1);

      if (!existing) {
        const [created_] = await db.insert(products).values({
          name: normalizedName,
          sku: null,
          description: "",
          unit: "kg" as any,
          category: "Verdura",
          averageCost: "0",
          currentStock: "0",
        }).returning();
        existing = created_;
        created++;
      }

      // Upsert product_unit
      const [existingPu] = await db.select().from(productUnits)
        .where(and(eq(productUnits.productId, existing.id), eq(productUnits.unit, canonicalUnit)))
        .limit(1);

      if (!existingPu) {
        await db.insert(productUnits).values({ productId: existing.id, unit: canonicalUnit, avgCost: "0", stockQty: "0" });
        unitsAdded++;
      } else if (!existingPu.isActive) {
        await db.update(productUnits).set({ isActive: true }).where(eq(productUnits.id, existingPu.id));
        unitsAdded++;
      }
    }
    return { created, unitsAdded };
  },

  // B) Set units for a product (idempotent diff: add new, soft-delete removed)
  async setProductUnits(productId: number, desiredUnits: string[]): Promise<ProductUnit[]> {
    const normalized = desiredUnits.map((u) => u.trim().toUpperCase());

    // Get currently active units
    const currentActive = await db.select().from(productUnits)
      .where(and(eq(productUnits.productId, productId), eq(productUnits.isActive, true)));

    const currentUnitSet = new Set(currentActive.map((pu) => pu.unit));
    const desiredSet = new Set(normalized);

    // Units to add (desired but not currently active)
    for (const unit of normalized) {
      if (!currentUnitSet.has(unit)) {
        // Check if exists but inactive
        const [inactive] = await db.select().from(productUnits)
          .where(and(eq(productUnits.productId, productId), eq(productUnits.unit, unit)))
          .limit(1);
        if (inactive) {
          await db.update(productUnits).set({ isActive: true }).where(eq(productUnits.id, inactive.id));
        } else {
          await db.insert(productUnits).values({ productId, unit, avgCost: "0", stockQty: "0" });
        }
      }
    }

    // Units to remove (currently active but not in desired)
    for (const pu of currentActive) {
      if (!desiredSet.has(pu.unit)) {
        const stock = parseFloat(pu.stockQty as string);
        // Check if has stock movements
        const movements = await db.select().from(stockMovements)
          .where(eq(stockMovements.productId, productId))
          .limit(1);
        const hasHistory = stock !== 0 || movements.length > 0;
        if (hasHistory) {
          // Soft disable
          await db.update(productUnits).set({ isActive: false }).where(eq(productUnits.id, pu.id));
        } else {
          // Safe to delete
          await db.delete(productUnits).where(eq(productUnits.id, pu.id));
        }
      }
    }

    // Return updated active units
    return db.select().from(productUnits)
      .where(and(eq(productUnits.productId, productId), eq(productUnits.isActive, true)));
  },

  // ─── Cuentas Corrientes ────────────────────────────────────────────────────

  async createPayment(data: InsertPayment, userId: number): Promise<Payment> {
    const [p] = await db.insert(payments).values({ ...data, createdBy: userId }).returning();
    return p;
  },

  async createWithholding(data: InsertWithholding, userId: number): Promise<Withholding> {
    const [w] = await db.insert(withholdings).values({ ...data, createdBy: userId }).returning();
    return w;
  },

  async deletePayment(id: number): Promise<void> {
    await db.delete(payments).where(eq(payments.id, id));
  },

  async deleteWithholding(id: number): Promise<void> {
    await db.delete(withholdings).where(eq(withholdings.id, id));
  },

  // fromDate: inclusive (>=), toDate: exclusive (<)
  async getCustomerPayments(customerId: number, fromDate?: string, toDate?: string): Promise<Payment[]> {
    const conds = [eq(payments.customerId, customerId)];
    if (fromDate) conds.push(gte(payments.date, fromDate));
    if (toDate) conds.push(lt(payments.date, toDate));
    return db.select().from(payments).where(and(...conds as any)).orderBy(desc(payments.date));
  },

  // fromDate: inclusive (>=), toDate: exclusive (<)
  async getCustomerWithholdings(customerId: number, fromDate?: string, toDate?: string): Promise<Withholding[]> {
    const conds = [eq(withholdings.customerId, customerId)];
    if (fromDate) conds.push(gte(withholdings.date, fromDate));
    if (toDate) conds.push(lt(withholdings.date, toDate));
    return db.select().from(withholdings).where(and(...conds as any)).orderBy(desc(withholdings.date));
  },

  // Fetch all approved order items with product name & customer info
  async _getApprovedItems(beforeDate?: string, fromDate?: string, toDate?: string): Promise<RawOrderItem[]> {
    // Build where conditions on orders
    let dateFilter = drizzleSql`o.status = 'approved'`;
    if (fromDate && toDate) {
      dateFilter = drizzleSql`o.status = 'approved' AND o.order_date >= ${fromDate}::date AND o.order_date < ${toDate}::date`;
    } else if (beforeDate) {
      dateFilter = drizzleSql`o.status = 'approved' AND o.order_date < ${beforeDate}::date`;
    }

    const rows = await db.execute(drizzleSql`
      SELECT
        o.id AS "orderId",
        o.customer_id AS "customerId",
        o.order_date::text AS "orderDate",
        oi.quantity::text AS "quantity",
        oi.price_per_unit::text AS "pricePerUnit",
        oi.cost_per_unit::text AS "costPerUnit",
        oi.override_cost_per_unit::text AS "overrideCostPerUnit",
        oi.unit::text AS "unit",
        COALESCE(p.name, oi.raw_product_name, '') AS "productName"
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE ${dateFilter}
    `);
    return rows.rows as RawOrderItem[];
  },

  async getCCSummary(month: number, year: number) {
    // Period boundaries
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

    // Days in month
    const daysInMonth = new Date(year, month, 0).getDate();

    // Get all customers
    const allCustomers = await db.select().from(customers).where(eq(customers.active, true)).orderBy(asc(customers.name));
    const customerMap = new Map(allCustomers.map((c) => [c.id, c]));

    // Get approved order items in period and before period
    const [itemsInPeriod, itemsBefore] = await Promise.all([
      this._getApprovedItems(undefined, startDate, endDate),
      this._getApprovedItems(startDate),
    ]);

    // Get payments & withholdings in period
    const [paymentsInPeriod, paymentsBefore, withholdingsInPeriod, withholdingsBefore] = await Promise.all([
      db.execute(drizzleSql`SELECT customer_id AS "customerId", SUM(amount)::text AS total FROM payments WHERE date >= ${startDate} AND date < ${endDate} GROUP BY customer_id`),
      db.execute(drizzleSql`SELECT customer_id AS "customerId", SUM(amount)::text AS total FROM payments WHERE date < ${startDate} GROUP BY customer_id`),
      db.execute(drizzleSql`SELECT customer_id AS "customerId", SUM(amount)::text AS total FROM withholdings WHERE date >= ${startDate} AND date < ${endDate} GROUP BY customer_id`),
      db.execute(drizzleSql`SELECT customer_id AS "customerId", SUM(amount)::text AS total FROM withholdings WHERE date < ${startDate} GROUP BY customer_id`),
    ]);

    const toMap = (rows: any[]): Map<number, number> => {
      const m = new Map<number, number>();
      for (const r of rows) m.set(Number(r.customerId), parseFloat(r.total ?? "0"));
      return m;
    };

    const paymentsInMap = toMap(paymentsInPeriod.rows as any[]);
    const paymentsBeforeMap = toMap(paymentsBefore.rows as any[]);
    const withholdingsInMap = toMap(withholdingsInPeriod.rows as any[]);
    const withholdingsBeforeMap = toMap(withholdingsBefore.rows as any[]);

    // Compute billing per customer (grouped by period)
    const billingInMap = new Map<number, number>();
    const billingBeforeMap = new Map<number, number>();

    for (const item of itemsInPeriod) {
      const c = customerMap.get(item.customerId);
      if (!c) continue;
      const b = itemBilling(item, c.hasIva);
      billingInMap.set(item.customerId, (billingInMap.get(item.customerId) ?? 0) + b);
    }
    for (const item of itemsBefore) {
      const c = customerMap.get(item.customerId);
      if (!c) continue;
      const b = itemBilling(item, c.hasIva);
      billingBeforeMap.set(item.customerId, (billingBeforeMap.get(item.customerId) ?? 0) + b);
    }

    // Build customer rows
    const rows = allCustomers.map((c) => {
      const facturacionBefore = billingBeforeMap.get(c.id) ?? 0;
      const cobranzaBefore = paymentsBeforeMap.get(c.id) ?? 0;
      const retencionBefore = withholdingsBeforeMap.get(c.id) ?? 0;
      const saldoMesAnterior = facturacionBefore - cobranzaBefore - retencionBefore;

      const facturacion = billingInMap.get(c.id) ?? 0;
      const cobranza = paymentsInMap.get(c.id) ?? 0;
      const retenciones = withholdingsInMap.get(c.id) ?? 0;
      const saldo = saldoMesAnterior + facturacion - cobranza - retenciones;

      return {
        customerId: c.id,
        customerName: c.name,
        hasIva: c.hasIva,
        saldoMesAnterior: Math.round(saldoMesAnterior),
        facturacion: Math.round(facturacion),
        cobranza: Math.round(cobranza),
        retenciones: Math.round(retenciones),
        saldo: Math.round(saldo),
        fiado: Math.max(Math.round(saldo), 0),
      };
    }).filter((r) =>
      // show customers with any movement or non-zero balance
      r.saldoMesAnterior !== 0 || r.facturacion !== 0 || r.cobranza !== 0 || r.retenciones !== 0 || r.saldo !== 0
    );

    // Compute % del fiado
    const totalFiado = rows.reduce((s, r) => s + r.fiado, 0);
    const rowsWithPct = rows
      .map((r) => ({ ...r, pctFiado: totalFiado > 0 ? (r.fiado / totalFiado) * 100 : 0 }))
      .sort((a, b) => b.saldo - a.saldo);

    // Totals row
    const totals = {
      saldoMesAnterior: rows.reduce((s, r) => s + r.saldoMesAnterior, 0),
      facturacion: rows.reduce((s, r) => s + r.facturacion, 0),
      cobranza: rows.reduce((s, r) => s + r.cobranza, 0),
      retenciones: rows.reduce((s, r) => s + r.retenciones, 0),
      saldo: rows.reduce((s, r) => s + r.saldo, 0),
      fiado: totalFiado,
    };

    // Weekly breakdown (fixed weeks in the month)
    const weeks = [
      { label: "1° Semana", start: 1, end: 7 },
      { label: "2° Semana", start: 8, end: 14 },
      { label: "3° Semana", start: 15, end: 21 },
      { label: "4° Semana", start: 22, end: daysInMonth },
    ];

    const weekTotals = weeks.map((w) => {
      const wStart = `${year}-${String(month).padStart(2, "0")}-${String(w.start).padStart(2, "0")}`;
      const wEndDay = Math.min(w.end + 1, daysInMonth + 1);
      const wEnd = `${year}-${String(month).padStart(2, "0")}-${String(wEndDay).padStart(2, "0")}`;

      let total = 0;
      for (const item of itemsInPeriod) {
        const d = item.orderDate.substring(0, 10); // YYYY-MM-DD
        if (d >= wStart && d < wEnd) {
          const c = customerMap.get(item.customerId);
          total += itemBilling(item, c?.hasIva ?? false);
        }
      }
      return { ...w, total: Math.round(total) };
    });

    // Venta del mes = sum of facturacion all customers in period
    const ventaMes = rows.reduce((s, r) => s + r.facturacion, 0);

    // Bultos
    let bultosMes = 0;
    for (const item of itemsInPeriod) {
      if (isBulto(item.unit)) bultosMes += parseFloat(item.quantity);
    }

    // Ganancia bruta
    let gananciaMes = 0;
    for (const item of itemsInPeriod) {
      gananciaMes += itemProfit(item);
    }
    gananciaMes = Math.round(gananciaMes);

    // Promedios
    const promedioDia = Math.round(ventaMes / daysInMonth);
    const promedioGanancia = Math.round(gananciaMes / daysInMonth);
    const margenPct = ventaMes > 0 ? (gananciaMes / ventaMes) * 100 : 0;

    return {
      month,
      year,
      daysInMonth,
      customers: rowsWithPct,
      totals,
      semanas: weekTotals,
      ventaMes,
      bultosMes: Math.round(bultosMes),
      gananciaMes,
      promedioDia,
      promedioGanancia,
      margenPct,
    };
  },

  async getCCCustomerDetail(customerId: number, month: number, year: number) {
    const c = await this.getCustomer(customerId);
    if (!c) return null;

    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

    const [itemsInPeriod, itemsBefore] = await Promise.all([
      this._getApprovedItems(undefined, startDate, endDate),
      this._getApprovedItems(startDate),
    ]);

    const myItemsInPeriod = itemsInPeriod.filter((i) => i.customerId === customerId);
    const myItemsBefore = itemsBefore.filter((i) => i.customerId === customerId);

    const facturacion = Math.round(myItemsInPeriod.reduce((s, i) => s + itemBilling(i, c.hasIva), 0));
    const facturacionBefore = Math.round(myItemsBefore.reduce((s, i) => s + itemBilling(i, c.hasIva), 0));

    const [paymentsIn, paymentsBef, withholdingsIn, withholdingsBef, ordersInPeriod] = await Promise.all([
      this.getCustomerPayments(customerId, startDate, endDate),
      this.getCustomerPayments(customerId, undefined, startDate),
      this.getCustomerWithholdings(customerId, startDate, endDate),
      this.getCustomerWithholdings(customerId, undefined, startDate),
      db.execute(drizzleSql`
        SELECT o.id, o.folio, o.order_date::text AS "orderDate", o.total::text AS total
        FROM orders o
        WHERE o.customer_id = ${customerId}
          AND o.status = 'approved'
          AND o.order_date >= ${startDate}::date
          AND o.order_date < ${endDate}::date
        ORDER BY o.order_date DESC
      `),
    ]);

    const cobranzaBefore = paymentsBef.reduce((s, p) => s + parseFloat(p.amount as string), 0);
    const retencionBefore = withholdingsBef.reduce((s, w) => s + parseFloat(w.amount as string), 0);
    const saldoMesAnterior = Math.round(facturacionBefore - cobranzaBefore - retencionBefore);

    const cobranza = Math.round(paymentsIn.reduce((s, p) => s + parseFloat(p.amount as string), 0));
    const retenciones = Math.round(withholdingsIn.reduce((s, w) => s + parseFloat(w.amount as string), 0));
    const saldo = saldoMesAnterior + facturacion - cobranza - retenciones;

    // Compute billing per order in period for the table
    const orderBillingMap = new Map<number, number>();
    for (const item of myItemsInPeriod) {
      orderBillingMap.set(item.orderId, (orderBillingMap.get(item.orderId) ?? 0) + itemBilling(item, c.hasIva));
    }

    const ordersWithBilling = (ordersInPeriod.rows as any[]).map((o) => ({
      id: o.id,
      folio: o.folio,
      orderDate: o.orderDate,
      total: Math.round(orderBillingMap.get(o.id) ?? parseFloat(o.total ?? "0")),
    }));

    return {
      customer: c,
      month,
      year,
      saldoMesAnterior,
      facturacion,
      cobranza,
      retenciones,
      saldo,
      orders: ordersWithBilling,
      payments: paymentsIn,
      withholdings: withholdingsIn,
    };
  },
};
