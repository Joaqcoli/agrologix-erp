import { db } from "./db";
import {
  users, customers, products, purchases, purchaseItems,
  stockMovements, productCostHistory, orders, orderItems,
  priceHistory, remitos, productUnits, payments, withholdings, paymentOrderLinks,
  suppliers, supplierPayments,
  type User, type Customer, type Product, type Purchase,
  type PurchaseItem, type StockMovement, type Order,
  type OrderItem, type PriceHistory, type Remito, type ProductUnit,
  type Payment, type Withholding, type InsertPayment, type InsertWithholding,
  type Supplier, type SupplierPayment, type InsertSupplier, type InsertSupplierPayment,
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
const BULTO_UNITS = new Set(["CAJON", "BOLSA", "BANDEJA"]);
function isBulto(unit: string): boolean {
  return BULTO_UNITS.has(unit.toUpperCase());
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

  async updateProduct(id: number, data: Partial<typeof products.$inferInsert>, units?: string[]): Promise<Product> {
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
    supplierId?: number | null;
    paymentMethod?: string;
    purchaseDate: Date;
    notes?: string;
    createdBy: number;
    items: {
      productId: number;
      quantity: string;
      unit: string;
      costPerUnit: string;
      costPerPurchaseUnit?: string;
      purchaseQty?: string;
      purchaseUnit?: string;
      weightPerPackage?: string;
      emptyCost?: string;
    }[];
  }): Promise<Purchase> {
    // Pre-compute totals (no DB)
    let total = 0;
    let totalEmptyCost = 0;
    const itemsWithSubtotal = data.items.map((item) => {
      // Use original purchase-unit price when available to avoid floating-point
      // accumulation errors from costPerBase × totalBaseQty.
      const subtotal = item.costPerPurchaseUnit && item.purchaseQty
        ? Math.round(parseFloat(item.purchaseQty) * parseFloat(item.costPerPurchaseUnit) * 100) / 100
        : Math.round(parseFloat(item.quantity) * parseFloat(item.costPerUnit) * 100) / 100;
      total += subtotal;
      const emptyCost = parseFloat(item.emptyCost ?? "0") || 0;
      const emptyQty = item.purchaseQty ? parseFloat(item.purchaseQty) : parseFloat(item.quantity);
      totalEmptyCost += emptyCost * emptyQty;
      return { ...item, subtotal: subtotal.toFixed(2) };
    });

    const purchaseDateStr = data.purchaseDate.toISOString().slice(0, 10);

    return db.transaction(async (tx) => {
      const isAutoPayment = data.paymentMethod === "efectivo" || data.paymentMethod === "transferencia";
      const [purchase] = await tx.insert(purchases).values({
        folio: data.folio,
        supplierName: data.supplierName,
        supplierId: data.supplierId ?? null,
        paymentMethod: data.paymentMethod ?? "cuenta_corriente",
        isPaid: isAutoPayment,
        totalEmptyCost: totalEmptyCost.toFixed(2),
        purchaseDate: data.purchaseDate,
        notes: data.notes,
        createdBy: data.createdBy,
        total: (total + totalEmptyCost).toFixed(2),
      }).returning();

      // Auto-create supplier payment for cash/transfer purchases
      if (isAutoPayment && data.supplierId) {
        const dateStr = data.purchaseDate.toISOString().slice(0, 10);
        await tx.insert(supplierPayments).values({
          supplierId: data.supplierId,
          date: dateStr,
          amount: (total + totalEmptyCost).toFixed(2),
          method: data.paymentMethod === "efectivo" ? "EFECTIVO" : "TRANSFERENCIA",
          notes: `Pago automático compra ${data.folio}`,
          purchaseId: purchase.id,
          createdBy: data.createdBy,
        });
      }

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
          ...(item.emptyCost && parseFloat(item.emptyCost) > 0 ? { emptyCost: item.emptyCost } : {}),
          ...(item.costPerPurchaseUnit ? { costPerPurchaseUnit: item.costPerPurchaseUnit } : {}),
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

        // item.quantity y item.costPerUnit ya vienen en unidad base (frontend convierte)
        const newQty = parseFloat(item.quantity);
        const newCost = parseFloat(item.costPerUnit);
        const baseUnitCanonical = dbEnumToCanonical(item.unit); // e.g. KG, MAPLE, ATADO

        // Datos del envase (si la compra fue en CAJON/BOLSA/BANDEJA)
        const purchaseQtyNum = item.purchaseQty ? parseFloat(item.purchaseQty) : 0;
        const weightPerPackage = item.weightPerPackage ? parseFloat(item.weightPerPackage) : 0;
        const isPackagePurchase = !!(item.purchaseUnit && weightPerPackage > 0 && purchaseQtyNum > 0);

        // ── product_units: UNA SOLA FILA por producto (unidad base) ─────────────
        const [existingPU] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, baseUnitCanonical)))
          .for('update')
          .limit(1);

        let newPuAvgCost: number;
        let newWeightPerUnit: number;

        if (existingPU) {
          const puStock = parseFloat(existingPU.stockQty as string);
          const puCost = parseFloat(existingPU.avgCost as string);
          newPuAvgCost = puStock + newQty === 0 ? newCost : (puStock * puCost + newQty * newCost) / (puStock + newQty);

          // Recalcular weight_per_unit como promedio ponderado de unidades base por envase
          if (isPackagePurchase) {
            const oldWPU = parseFloat(existingPU.weightPerUnit as string ?? "0");
            if (oldWPU > 0 && puStock > 0) {
              const oldPackages = puStock / oldWPU;
              newWeightPerUnit = (oldPackages * oldWPU + purchaseQtyNum * weightPerPackage) / (oldPackages + purchaseQtyNum);
            } else {
              newWeightPerUnit = weightPerPackage;
            }
          } else {
            newWeightPerUnit = parseFloat(existingPU.weightPerUnit as string ?? "0");
          }

          const puUpdate: Record<string, any> = {
            stockQty: (puStock + newQty).toFixed(4),
            avgCost: newPuAvgCost.toFixed(4),
            baseUnit: baseUnitCanonical,
          };
          if (isPackagePurchase) puUpdate.weightPerUnit = newWeightPerUnit.toFixed(4);

          await tx.update(productUnits).set(puUpdate).where(eq(productUnits.id, existingPU.id));
        } else {
          newPuAvgCost = newCost;
          newWeightPerUnit = weightPerPackage;
          await tx.insert(productUnits).values({
            productId: item.productId,
            unit: baseUnitCanonical,
            avgCost: newCost.toFixed(4),
            stockQty: newQty.toFixed(4),
            baseUnit: baseUnitCanonical,
            ...(weightPerPackage > 0 ? { weightPerUnit: weightPerPackage.toFixed(4) } : {}),
          });
        }

        // ── products.currentStock + averageCost: costo promedio ponderado ─────────
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

            let costForUnit: number;
            if (oiCanonical === baseUnitCanonical) {
              // Pedido en unidad base → costo directo
              costForUnit = newPuAvgCost;
            } else if (['CAJON', 'BOLSA', 'BANDEJA'].includes(oiCanonical)) {
              // Pedido en unidad de envase → derivar costo de unidad base × weight_per_unit
              const wpu = newWeightPerUnit > 0 ? newWeightPerUnit : weightPerPackage;
              if (wpu <= 0) continue;
              costForUnit = newPuAvgCost * wpu;
            } else {
              continue; // Unidad diferente, no aplica
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

  // ── Helper: obtener costo por unidad para un producto dado ──────────────────
  // Prioridad: 1) fila exacta en product_units  2) derivado de unidad base × weight_per_unit  3) products.averageCost
  // En todos los casos: solo retorna costo si hay stock > 0, sino retorna "0"
  async _getCostForUnit(productId: number, unit: string, tx: any = db): Promise<string> {
    const canonical = dbEnumToCanonical(unit);

    // 1) Coincidencia exacta — solo si hay stock
    const [exactPu] = await tx.select().from(productUnits)
      .where(and(eq(productUnits.productId, productId), eq(productUnits.unit, canonical)))
      .limit(1);
    if (exactPu && parseFloat(exactPu.stockQty as string) > 0) return exactPu.avgCost as string;

    // 2) Si es unidad de envase, derivar de fila base × weight_per_unit — solo si base tiene stock
    if (['CAJON', 'BOLSA', 'BANDEJA'].includes(canonical)) {
      const [baseRow] = await tx.select().from(productUnits)
        .where(and(
          eq(productUnits.productId, productId),
          drizzleSql`${productUnits.baseUnit} IS NOT NULL`,
        ))
        .limit(1);
      if (baseRow && parseFloat(baseRow.stockQty as string) > 0) {
        const wpu = parseFloat(baseRow.weightPerUnit as string ?? "0");
        if (wpu > 0) return (parseFloat(baseRow.avgCost as string) * wpu).toFixed(4);
      }
    }

    // 3) Fallback: averageCost del producto — solo si hay currentStock
    const [p] = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
    const currentStock = parseFloat(p?.currentStock as string ?? "0");
    if (currentStock > 0) return p?.averageCost as string ?? "0";
    return "0";
  },

  async _recalcProductSummary(pid: number, tx: any = db): Promise<void> {
    // Solo agregar entradas de la unidad base del producto para evitar mezclar unidades (KG + CAJON)
    const [product] = await tx.select({ unit: products.unit }).from(products).where(eq(products.id, pid)).limit(1);
    const baseUnit = product ? dbEnumToCanonical(product.unit) : null;
    const allPu = await tx.select().from(productUnits).where(
      baseUnit
        ? and(eq(productUnits.productId, pid), eq(productUnits.unit, baseUnit))
        : eq(productUnits.productId, pid)
    );
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
        // item.unit es la unidad base (ej. "kg", "maple") — revertir solo esa fila
        const canonicalUnit = dbEnumToCanonical(item.unit as any);
        const [pu] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
          .limit(1);
        if (pu) {
          const newStock = Number(pu.stockQty) - Number(item.quantity);
          // Preserve avgCost — only floor stock at 0
          await tx.update(productUnits).set({ stockQty: Math.max(0, newStock).toFixed(4) }).where(eq(productUnits.id, pu.id));
        }
        // No revertir el row de unidad de envase (CAJON/BOLSA) — ya no existe en el modelo nuevo
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
    items: { productId: number; quantity: string; unit: "KG" | "UNIDAD" | "CAJON" | "BOLSA" | "ATADO" | "MAPLE" | "BANDEJA"; costPerUnit: string; costPerPurchaseUnit?: string; purchaseQty?: string; purchaseUnit?: string; weightPerPackage?: string }[];
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
        const subtotal = item.costPerPurchaseUnit && item.purchaseQty
          ? Math.round(Number(item.purchaseQty) * Number(item.costPerPurchaseUnit) * 100) / 100
          : Math.round(Number(item.quantity) * Number(item.costPerUnit) * 100) / 100;
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
          ...(item.purchaseQty ? { purchaseQty: item.purchaseQty } : {}),
          ...(item.purchaseUnit ? { purchaseUnit: item.purchaseUnit as any } : {}),
          ...(item.weightPerPackage ? { weightPerPackage: item.weightPerPackage } : {}),
          ...(item.costPerPurchaseUnit ? { costPerPurchaseUnit: item.costPerPurchaseUnit } : {}),
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

  async getAdjustmentMovements(): Promise<Array<{ id: number; productId: number; productName: string; category: string; unit: string; movementType: string; quantity: string; avgCost: string | null; notes: string | null; createdAt: string }>> {
    const rows = await db.execute(drizzleSql`
      SELECT
        sm.id,
        sm.product_id AS "productId",
        p.name AS "productName",
        COALESCE(p.category, 'Sin categoría') AS category,
        COALESCE(pu.unit, 'KG') AS unit,
        sm.movement_type AS "movementType",
        sm.quantity::text AS quantity,
        COALESCE(pu.avg_cost, p.average_cost)::text AS "avgCost",
        sm.notes,
        sm.created_at::text AS "createdAt"
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      LEFT JOIN product_units pu ON pu.id = sm.reference_id
      WHERE sm.reference_type = 'adjustment'
      ORDER BY sm.created_at DESC
      LIMIT 1000
    `);
    return rows.rows as any[];
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
          costPerUnit = await this._getCostForUnit(item.productId, item.unit ?? "KG");
        }
        return {
          orderId: order.id,
          productId: item.productId ?? null,
          quantity: item.quantity,
          unit: (item.unit as any) ?? "KG",
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
          costPerUnit = await this._getCostForUnit(item.productId, item.unit ?? "KG");
        }
        return {
          orderId,
          productId: item.productId ?? null,
          quantity: item.quantity,
          unit: (item.unit as any) ?? "KG",
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
          const oiCanonical = dbEnumToCanonical(item.unit as string);
          const qty = Number(item.quantity);

          // Buscar fila de unidad base (modelo nuevo primero, fallback modelo antiguo)
          const [baseUnitPu] = await tx.select().from(productUnits)
            .where(and(
              eq(productUnits.productId, item.productId),
              drizzleSql`${productUnits.baseUnit} IS NOT NULL`,
            ))
            .limit(1);

          let restoreQty = qty;
          let puToRestore: typeof baseUnitPu | null = baseUnitPu ?? null;

          if (baseUnitPu) {
            if (oiCanonical !== baseUnitPu.unit && ['CAJON', 'BOLSA', 'BANDEJA'].includes(oiCanonical)) {
              const wpu = parseFloat(baseUnitPu.weightPerUnit as string ?? "0");
              restoreQty = qty * (wpu > 0 ? wpu : 1);
            }
          } else {
            const [oldPu] = await tx.select().from(productUnits)
              .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, oiCanonical)))
              .limit(1);
            puToRestore = oldPu ?? null;
          }

          if (puToRestore) {
            const newStock = Number(puToRestore.stockQty) + restoreQty;
            await tx.update(productUnits).set({ stockQty: newStock.toFixed(4) }).where(eq(productUnits.id, puToRestore.id));
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
      bolsaType?: string | null;
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
        const oldQty = Number(item.quantity);

        const [oldBaseUnitPu] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), drizzleSql`${productUnits.baseUnit} IS NOT NULL`))
          .limit(1);

        let restoreQty = oldQty;
        let oldPuToRestore: typeof oldBaseUnitPu | null = oldBaseUnitPu ?? null;

        if (oldBaseUnitPu) {
          if (oldCanonical !== oldBaseUnitPu.unit && ['CAJON', 'BOLSA', 'BANDEJA'].includes(oldCanonical)) {
            const wpu = parseFloat(oldBaseUnitPu.weightPerUnit as string ?? "0");
            restoreQty = oldQty * (wpu > 0 ? wpu : 1);
          }
        } else {
          const [fallbackPu] = await tx.select().from(productUnits)
            .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, oldCanonical)))
            .limit(1);
          oldPuToRestore = fallbackPu ?? null;
        }

        if (oldPuToRestore) {
          const restoredStock = Number(oldPuToRestore.stockQty) + restoreQty;
          await tx.update(productUnits).set({ stockQty: restoredStock.toFixed(4) }).where(eq(productUnits.id, oldPuToRestore.id));
        }
        await this._recalcProductSummary(item.productId, tx);
      }

      // STEP 2: Compute new field values
      const newProductId = patch.productId !== undefined ? patch.productId : item.productId;
      const newUnit = patch.unit ?? (item.unit as string);

      // Look up new cost from product_units when product or unit changes
      let newCostPerUnit: string | undefined;
      if (patch.productId !== undefined && patch.productId !== null) {
        newCostPerUnit = await this._getCostForUnit(patch.productId, newUnit, tx);
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
      if (patch.bolsaType !== undefined) updateData.bolsaType = patch.bolsaType;

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

        const [newBaseUnitPu] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, newProductId), drizzleSql`${productUnits.baseUnit} IS NOT NULL`))
          .limit(1);

        let deductQty = qty;
        let newPuToDeduct: typeof newBaseUnitPu | null = newBaseUnitPu ?? null;

        if (newBaseUnitPu) {
          if (newCanonical !== newBaseUnitPu.unit && ['CAJON', 'BOLSA', 'BANDEJA'].includes(newCanonical)) {
            const wpu = parseFloat(newBaseUnitPu.weightPerUnit as string ?? "0");
            deductQty = qty * (wpu > 0 ? wpu : 1);
          }
        } else {
          const [fallbackPu] = await tx.select().from(productUnits)
            .where(and(eq(productUnits.productId, newProductId), eq(productUnits.unit, newCanonical)))
            .limit(1);
          newPuToDeduct = fallbackPu ?? null;
        }

        if (newPuToDeduct) {
          const deductedStock = Number(newPuToDeduct.stockQty) - deductQty;
          await tx.update(productUnits).set({ stockQty: Math.max(0, deductedStock).toFixed(4) }).where(eq(productUnits.id, newPuToDeduct.id));
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

  async addOrderItem(
    orderId: number,
    data: {
      quantity: string;
      unit: string;
      productId: number | null;
      pricePerUnit?: string | null;
      bolsaType?: string | null;
    },
  ): Promise<{ item: OrderItem; orderTotal: string }> {
    return db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order) throw new Error("Order not found");
      const isApproved = order.status === "approved";

      let costPerUnit = "0";
      if (data.productId && !data.bolsaType) {
        costPerUnit = await this._getCostForUnit(data.productId, data.unit, tx);
      }

      const qty = Number(data.quantity);
      const price = data.pricePerUnit ? Number(data.pricePerUnit) : null;
      const subtotal = price && price > 0 ? qty * price : 0;
      const effectiveCost = data.bolsaType ? 0 : Number(costPerUnit);
      const margin = price && price > 0 ? (price - effectiveCost) / price : null;

      const [item] = await tx.insert(orderItems).values({
        orderId,
        productId: data.productId ?? null,
        quantity: qty.toFixed(4),
        unit: data.unit as any,
        pricePerUnit: data.pricePerUnit ?? null,
        costPerUnit: data.bolsaType ? "0" : costPerUnit,
        subtotal: subtotal.toFixed(2),
        margin: margin !== null ? margin.toFixed(4) : null,
        bolsaType: data.bolsaType ?? null,
      } as any).returning();

      const allItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      const total = allItems.reduce((s, i) => s + Number(i.subtotal), 0);
      await tx.update(orders).set({ total: total.toFixed(2) }).where(eq(orders.id, orderId));

      if (isApproved && data.productId && !data.bolsaType) {
        const newCanonical = dbEnumToCanonical(data.unit);
        const [baseUnitPu] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, data.productId), drizzleSql`${productUnits.baseUnit} IS NOT NULL`))
          .limit(1);
        let deductQty = qty;
        let puToUpdate: typeof baseUnitPu | null = baseUnitPu ?? null;
        if (baseUnitPu) {
          if (newCanonical !== baseUnitPu.unit && ['CAJON', 'BOLSA', 'BANDEJA'].includes(newCanonical)) {
            const wpu = parseFloat(baseUnitPu.weightPerUnit as string ?? "0");
            deductQty = qty * (wpu > 0 ? wpu : 1);
          }
        } else {
          const [fallbackPu] = await tx.select().from(productUnits)
            .where(and(eq(productUnits.productId, data.productId), eq(productUnits.unit, newCanonical)))
            .limit(1);
          puToUpdate = fallbackPu ?? null;
        }
        if (puToUpdate) {
          const newStock = Number(puToUpdate.stockQty) - deductQty;
          await tx.update(productUnits).set({ stockQty: Math.max(0, newStock).toFixed(4) }).where(eq(productUnits.id, puToUpdate.id));
        }
        await this._recalcProductSummary(data.productId, tx);
      }

      return { item, orderTotal: total.toFixed(2) };
    });
  },

  async deleteOrderItem(orderId: number, itemId: number): Promise<{ orderTotal: string }> {
    return db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order) throw new Error("Order not found");

      const [item] = await tx.select().from(orderItems).where(
        and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId))
      ).limit(1);
      if (!item) throw new Error("Item not found");

      const isApproved = order.status === "approved";
      const hasBolsaType = !!(item as any).bolsaType;

      if (isApproved && item.productId && !hasBolsaType) {
        const oldCanonical = dbEnumToCanonical(item.unit as string);
        const oldQty = Number(item.quantity);
        const [oldBaseUnitPu] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), drizzleSql`${productUnits.baseUnit} IS NOT NULL`))
          .limit(1);
        let restoreQty = oldQty;
        let puToRestore: typeof oldBaseUnitPu | null = oldBaseUnitPu ?? null;
        if (oldBaseUnitPu) {
          if (oldCanonical !== oldBaseUnitPu.unit && ['CAJON', 'BOLSA', 'BANDEJA'].includes(oldCanonical)) {
            const wpu = parseFloat(oldBaseUnitPu.weightPerUnit as string ?? "0");
            restoreQty = oldQty * (wpu > 0 ? wpu : 1);
          }
        } else {
          const [fallbackPu] = await tx.select().from(productUnits)
            .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, oldCanonical)))
            .limit(1);
          puToRestore = fallbackPu ?? null;
        }
        if (puToRestore) {
          const restored = Number(puToRestore.stockQty) + restoreQty;
          await tx.update(productUnits).set({ stockQty: restored.toFixed(4) }).where(eq(productUnits.id, puToRestore.id));
        }
        await this._recalcProductSummary(item.productId, tx);
      }

      await tx.delete(orderItems).where(eq(orderItems.id, itemId));

      const allItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      const total = allItems.reduce((s, i) => s + Number(i.subtotal), 0);
      await tx.update(orders).set({ total: total.toFixed(2) }).where(eq(orders.id, orderId));

      return { orderTotal: total.toFixed(2) };
    });
  },

  async getBolsaFvStats(from: string, to: string, type?: string): Promise<{
    rows: { orderId: number; orderFolio: string; orderDate: Date; customerName: string; productName: string | null; quantity: string; unit: string; pricePerUnit: string | null; subtotal: string; bolsaType: string }[];
    grandTotal: number;
  }> {
    const conditions = [
      eq(orders.status, "approved"),
      drizzleSql`${orderItems}.bolsa_type IS NOT NULL`,
      drizzleSql`${orders.orderDate}::date >= ${from}::date`,
      drizzleSql`${orders.orderDate}::date < ${to}::date`,
    ];
    if (type && type !== "all") {
      conditions.push(drizzleSql`${orderItems}.bolsa_type = ${type}`);
    }

    const rows = await db
      .select({
        orderId: orders.id,
        orderFolio: orders.folio,
        orderDate: orders.orderDate,
        customerName: customers.name,
        productName: products.name,
        quantity: orderItems.quantity,
        unit: orderItems.unit,
        pricePerUnit: orderItems.pricePerUnit,
        subtotal: orderItems.subtotal,
        bolsaType: drizzleSql<string>`${orderItems}.bolsa_type`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(products, eq(orderItems.productId, products.id))
      .where(and(...conditions))
      .orderBy(desc(orders.orderDate)) as any[];

    const grandTotal = rows.reduce((s: number, r: any) => s + Number(r.subtotal ?? 0), 0);
    return { rows, grandTotal };
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
        const costPerUnit = parseFloat(await this._getCostForUnit(item.productId, item.unit));
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
        // Bolsa FV items: no stock deduction, cost stays 0
        if ((item as any).bolsaType) continue;

        const qty = parseFloat(item.quantity as string);
        const oiCanonical = dbEnumToCanonical(item.unit as string);

        // Lock the product row
        const [product] = await tx.select().from(products)
          .where(eq(products.id, item.productId))
          .for('update')
          .limit(1);
        if (!product) continue;

        // ── Buscar fila de unidad base (modelo nuevo) ──────────────────────────
        // Preferir fila con base_unit IS NOT NULL (creada por nuevo modelo)
        const [baseUnitPu] = await tx.select().from(productUnits)
          .where(and(
            eq(productUnits.productId, item.productId),
            drizzleSql`${productUnits.baseUnit} IS NOT NULL`,
          ))
          .limit(1);

        // Determinar cantidad a descontar en unidad base
        let deductQty = qty;
        let puToUpdate: typeof baseUnitPu | null = baseUnitPu ?? null;

        if (baseUnitPu) {
          // Modelo nuevo: puede haber conversión de envase → unidad base
          if (oiCanonical !== baseUnitPu.unit && ['CAJON', 'BOLSA', 'BANDEJA'].includes(oiCanonical)) {
            const wpu = parseFloat(baseUnitPu.weightPerUnit as string ?? "0");
            deductQty = qty * (wpu > 0 ? wpu : 1);
          }
        } else {
          // Modelo antiguo: buscar por unidad canónica directa
          const [oldPu] = await tx.select().from(productUnits)
            .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, oiCanonical)))
            .limit(1);
          puToUpdate = oldPu ?? null;
        }

        const currentStock = parseFloat(product.currentStock as string);
        const rawNewStock = currentStock - deductQty;
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

        // Deduct from product_units — floor at 0
        if (puToUpdate) {
          const rawPuStock = parseFloat(puToUpdate.stockQty as string) - deductQty;
          await tx.update(productUnits)
            .set({
              stockQty: Math.max(0, rawPuStock).toFixed(4),
              ...(isOverflow && { avgCost: "0" }),
            })
            .where(eq(productUnits.id, puToUpdate.id));
        }

        // Update products.currentStock — floor at 0; reset averageCost on overflow
        await tx.update(products)
          .set({
            currentStock: finalStock.toFixed(4),
            ...(isOverflow && { averageCost: "0" }),
          })
          .where(eq(products.id, item.productId));

        // On overflow: mark this order item with cost $0 (stock agotado)
        if (isOverflow) {
          const price = parseFloat(item.pricePerUnit as string ?? "0");
          const margin = price > 0 ? price / price : null; // margin = 100% when cost = 0
          await tx.update(orderItems)
            .set({
              costPerUnit: "0",
              ...(margin !== null && { margin: "1.0000" }),
            })
            .where(eq(orderItems.id, item.id));
        }

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

    // Excluir filas de unidades de envase (CAJON/BOLSA/BANDEJA) — solo mostrar unidades base
    const PACKAGE_UNITS = new Set(['CAJON', 'BOLSA', 'BANDEJA']);
    return result.filter((r) => {
      if (!r.product?.active) return false;
      if (PACKAGE_UNITS.has(r.unit)) return false;
      if (filters?.category && r.product.category !== filters.category) return false;
      if (filters?.search && !r.product.name.toUpperCase().includes(filters.search.toUpperCase())) return false;
      return true;
    }).sort((a, b) => a.product.name.localeCompare(b.product.name));
  },

  async upsertProductUnit(productId: number, unit: string): Promise<ProductUnit> {
    const PACKAGE_UNITS = new Set(['CAJON', 'BOLSA', 'BANDEJA']);
    const isBase = !PACKAGE_UNITS.has(unit);
    const [existing] = await db.select().from(productUnits)
      .where(and(eq(productUnits.productId, productId), eq(productUnits.unit, unit)))
      .limit(1);
    if (existing) {
      const needsBaseUnit = isBase && !existing.baseUnit;
      if (!existing.isActive || needsBaseUnit) {
        const [updated] = await db.update(productUnits)
          .set({ isActive: true, ...(needsBaseUnit ? { baseUnit: unit } : {}) })
          .where(eq(productUnits.id, existing.id)).returning();
        return updated;
      }
      return existing;
    }
    const [created] = await db.insert(productUnits).values({
      productId, unit, avgCost: "0", stockQty: "0",
      ...(isBase ? { baseUnit: unit } : {}),
    }).returning();
    return created;
  },

  async deactivateProductUnit(id: number): Promise<void> {
    await db.update(productUnits).set({ isActive: false }).where(eq(productUnits.id, id));
  },

  async adjustProductUnitStock(id: number, adjustment: number, notes?: string): Promise<ProductUnit> {
    const [pu] = await db.select().from(productUnits).where(eq(productUnits.id, id)).limit(1);
    if (!pu) throw new Error("ProductUnit not found");
    const newStock = parseFloat(pu.stockQty as string) + adjustment;
    const [updated] = await db.update(productUnits).set({ stockQty: newStock.toFixed(4) }).where(eq(productUnits.id, id)).returning();
    // Sync products.currentStock
    const allPu = await db.select().from(productUnits).where(eq(productUnits.productId, pu.productId));
    const totalStock = allPu.reduce((s, p) => s + parseFloat(p.stockQty as string), 0);
    await db.update(products).set({ currentStock: totalStock.toFixed(4) }).where(eq(products.id, pu.productId));
    // Record in stock_movements (unitCost stores result stock for history display)
    await db.insert(stockMovements).values({
      productId: pu.productId,
      movementType: adjustment >= 0 ? "in" : "out",
      quantity: Math.abs(adjustment).toFixed(4),
      unitCost: newStock.toFixed(4),
      referenceType: "adjustment",
      referenceId: pu.id,
      notes: notes ?? null,
    });
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
          unit: "KG" as any,
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

    // Package units never have their own base_unit row — they derive from the base unit
    const PACKAGE_UNITS = new Set(['CAJON', 'BOLSA', 'BANDEJA']);

    // Fix pre-existing active base unit rows that lack base_unit (one-time migration per save)
    for (const pu of currentActive) {
      if (!PACKAGE_UNITS.has(pu.unit) && !pu.baseUnit) {
        await db.update(productUnits).set({ baseUnit: pu.unit }).where(eq(productUnits.id, pu.id));
      }
    }

    // Units to add (desired but not currently active)
    for (const unit of normalized) {
      if (!currentUnitSet.has(unit)) {
        // Check if exists but inactive
        const [inactive] = await db.select().from(productUnits)
          .where(and(eq(productUnits.productId, productId), eq(productUnits.unit, unit)))
          .limit(1);
        if (inactive) {
          // Restore + set base_unit for base units
          await db.update(productUnits)
            .set({ isActive: true, ...(!PACKAGE_UNITS.has(unit) ? { baseUnit: unit } : {}) })
            .where(eq(productUnits.id, inactive.id));
        } else {
          // Insert new row; base units get base_unit = unit so the system can find them
          await db.insert(productUnits).values({
            productId, unit, avgCost: "0", stockQty: "0",
            ...(!PACKAGE_UNITS.has(unit) ? { baseUnit: unit } : {}),
          });
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
    const result = await db.select().from(productUnits)
      .where(and(eq(productUnits.productId, productId), eq(productUnits.isActive, true)));
    return result;
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

  // Returns payments with comma-separated order folios from the junction table
  async getCustomerPaymentsWithFolio(
    customerId: number,
    fromDate?: string,
    toDate?: string,
  ): Promise<(Payment & { orderFolio: string | null })[]> {
    const rows = await db.execute(drizzleSql`
      SELECT p.*,
        (
          SELECT STRING_AGG(o2.folio, ', ' ORDER BY o2.folio)
          FROM payment_order_links pol
          JOIN orders o2 ON o2.id = pol.order_id
          WHERE pol.payment_id = p.id
        ) AS "orderFolio"
      FROM payments p
      WHERE p.customer_id = ${customerId}
        ${fromDate ? drizzleSql`AND p.date >= ${fromDate}` : drizzleSql``}
        ${toDate   ? drizzleSql`AND p.date < ${toDate}`   : drizzleSql``}
      ORDER BY p.date DESC
    `);
    return rows.rows as (Payment & { orderFolio: string | null })[];
  },

  async linkPaymentToOrders(paymentId: number, orderIds: number[]): Promise<void> {
    if (orderIds.length === 0) return;
    await db.insert(paymentOrderLinks)
      .values(orderIds.map((oid) => ({ paymentId, orderId: oid })))
      .onConflictDoNothing();
  },

  async getPendingOrdersForCustomer(customerId: number): Promise<{ id: number; folio: string; total: string; orderDate: string }[]> {
    const result = await db
      .select({ id: orders.id, folio: orders.folio, total: orders.total, orderDate: orders.orderDate })
      .from(orders)
      .where(and(eq(orders.customerId, customerId), eq(orders.status, "approved")))
      .orderBy(desc(orders.orderDate))
      .limit(60);
    return result.map((r) => ({
      id: r.id,
      folio: r.folio,
      total: r.total != null ? String(r.total) : "0",
      orderDate: r.orderDate instanceof Date ? r.orderDate.toISOString() : String(r.orderDate),
    }));
  },

  async updateOrderInvoiceNumber(id: number, invoiceNumber: string | null): Promise<void> {
    await db.execute(drizzleSql`UPDATE orders SET invoice_number = ${invoiceNumber} WHERE id = ${id}`);
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

  async getCustomerChildren(parentId: number): Promise<Customer[]> {
    return db.select().from(customers)
      .where(and(eq(customers.parentCustomerId, parentId), eq(customers.active, true)));
  },

  async getCCSummary(startDate: string, endDate: string) {
    // Extract month/year from startDate for metadata
    const [yearStr, monthStr] = startDate.split("-");
    const month = parseInt(monthStr);
    const year = parseInt(yearStr);

    // Period length in days
    const periodDays = Math.max(1, Math.round(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
    ));
    const monthDays = new Date(year, month, 0).getDate(); // calendar days, for weekly breakdown
    const daysInMonth = periodDays; // used for averages

    // Get all customers
    const allCustomers = await db.select().from(customers).where(eq(customers.active, true)).orderBy(asc(customers.name));
    const customerMap = new Map(allCustomers.map((c) => [c.id, c]));

    // Build childToParent redirect map (child id → parent id)
    const childToParent = new Map<number, number>();
    for (const c of allCustomers) {
      if (c.parentCustomerId != null) childToParent.set(c.id, c.parentCustomerId);
    }
    const effectiveId = (id: number) => childToParent.get(id) ?? id;

    // Get approved order items in period and before period
    const [itemsInPeriod, itemsBefore] = await Promise.all([
      this._getApprovedItems(undefined, startDate, endDate),
      this._getApprovedItems(startDate),
    ]);

    // Get payments & withholdings in period
    const [paymentsInPeriod, paymentsBefore, withholdingsInPeriod, withholdingsBefore] = await Promise.all([
      db.execute(drizzleSql`SELECT customer_id AS "customerId", SUM(amount)::text AS total FROM payments WHERE date >= ${startDate} AND date < ${endDate} AND method != 'RETENCION' GROUP BY customer_id`),
      db.execute(drizzleSql`SELECT customer_id AS "customerId", SUM(amount)::text AS total FROM payments WHERE date < ${startDate} AND method != 'RETENCION' GROUP BY customer_id`),
      db.execute(drizzleSql`SELECT customer_id AS "customerId", SUM(amount)::text AS total FROM payments WHERE date >= ${startDate} AND date < ${endDate} AND method = 'RETENCION' GROUP BY customer_id`),
      db.execute(drizzleSql`SELECT customer_id AS "customerId", SUM(amount)::text AS total FROM payments WHERE date < ${startDate} AND method = 'RETENCION' GROUP BY customer_id`),
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

    // Roll up child payments/withholdings into parent totals
    const rollUpMap = (m: Map<number, number>) => {
      for (const [childId, parentId] of childToParent) {
        const val = m.get(childId) ?? 0;
        if (val !== 0) { m.set(parentId, (m.get(parentId) ?? 0) + val); m.delete(childId); }
      }
    };
    rollUpMap(paymentsInMap);
    rollUpMap(paymentsBeforeMap);
    rollUpMap(withholdingsInMap);
    rollUpMap(withholdingsBeforeMap);

    // Compute billing per customer, rolling children up to parent
    const billingInMap = new Map<number, number>();
    const billingBeforeMap = new Map<number, number>();

    for (const item of itemsInPeriod) {
      const c = customerMap.get(item.customerId);
      if (!c) continue;
      const b = itemBilling(item, c.hasIva);
      const eid = effectiveId(item.customerId);
      billingInMap.set(eid, (billingInMap.get(eid) ?? 0) + b);
    }
    for (const item of itemsBefore) {
      const c = customerMap.get(item.customerId);
      if (!c) continue;
      const b = itemBilling(item, c.hasIva);
      const eid = effectiveId(item.customerId);
      billingBeforeMap.set(eid, (billingBeforeMap.get(eid) ?? 0) + b);
    }

    // Build customer rows — only parents and independents (children rolled up)
    const rows = allCustomers.filter((c) => c.parentCustomerId == null).map((c) => {
      const facturacionBefore = billingBeforeMap.get(c.id) ?? 0;
      const cobranzaBefore = paymentsBeforeMap.get(c.id) ?? 0;
      const retencionBefore = withholdingsBeforeMap.get(c.id) ?? 0;
      // Sum opening balance of this customer + all its children
      const openingBalance = parseFloat(c.openingBalance ?? "0") +
        allCustomers.filter((ch) => ch.parentCustomerId === c.id)
          .reduce((s, ch) => s + parseFloat(ch.openingBalance ?? "0"), 0);
      const saldoMesAnterior = openingBalance + facturacionBefore - cobranzaBefore - retencionBefore;

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

    // Weekly breakdown — only for full-month ranges (periodDays >= 28)
    const isFullMonth = periodDays >= 28;
    const weekTotals = isFullMonth ? [
      { label: "1° Semana", start: 1, end: 7 },
      { label: "2° Semana", start: 8, end: 14 },
      { label: "3° Semana", start: 15, end: 21 },
      { label: "4° Semana", start: 22, end: monthDays },
    ].map((w) => {
      const wStart = `${year}-${String(month).padStart(2, "0")}-${String(w.start).padStart(2, "0")}`;
      const wEndDay = Math.min(w.end + 1, monthDays + 1);
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
    }) : [];

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

  async getCCCustomerDetail(customerId: number, startDate: string, endDate: string) {
    const [yearStr, monthStr] = startDate.split("-");
    const month = parseInt(monthStr);
    const year = parseInt(yearStr);

    const c = await this.getCustomer(customerId);
    if (!c) return null;

    // ── Child detection: redirect to parent ──────────────────────────────────────
    if (c.parentCustomerId != null) {
      const parent = await this.getCustomer(c.parentCustomerId);
      return { isChild: true, parentId: c.parentCustomerId, parentName: parent?.name ?? "" };
    }

    // ── Parent detection: collect all subsidiary IDs ──────────────────────────────
    const children = await this.getCustomerChildren(customerId);
    const allIds = [customerId, ...children.map((ch) => ch.id)];
    const isParent = children.length > 0;
    const allCustomersMap = new Map<number, Customer>([
      [customerId, c],
      ...children.map((ch) => [ch.id, ch] as [number, Customer]),
    ]);

    const [itemsInPeriod, itemsBefore] = await Promise.all([
      this._getApprovedItems(undefined, startDate, endDate),
      this._getApprovedItems(startDate),
    ]);

    const myItemsInPeriod = itemsInPeriod.filter((i) => allIds.includes(i.customerId));
    const myItemsBefore = itemsBefore.filter((i) => allIds.includes(i.customerId));

    const facturacion = Math.round(myItemsInPeriod.reduce((s, i) => {
      const cust = allCustomersMap.get(i.customerId);
      return s + itemBilling(i, cust?.hasIva ?? c.hasIva);
    }, 0));
    const facturacionBefore = Math.round(myItemsBefore.reduce((s, i) => {
      const cust = allCustomersMap.get(i.customerId);
      return s + itemBilling(i, cust?.hasIva ?? c.hasIva);
    }, 0));

    // Multi-ID raw SQL queries (allIds are validated integers from DB)
    const idArr = allIds.join(",");
    const [paymentsIn, paymentsBef, withholdingsIn, withholdingsBef, ordersInPeriod, paidAmountsRows] = await Promise.all([
      db.execute(drizzleSql.raw(`
        SELECT p.*, (
          SELECT STRING_AGG(o2.folio, ', ' ORDER BY o2.folio)
          FROM payment_order_links pol
          JOIN orders o2 ON o2.id = pol.order_id
          WHERE pol.payment_id = p.id
        ) AS "orderFolio"
        FROM payments p
        WHERE p.customer_id = ANY(ARRAY[${idArr}]::int[])
          AND p.date >= '${startDate}' AND p.date < '${endDate}'
          AND p.method != 'RETENCION'
        ORDER BY p.date DESC
      `)),
      db.execute(drizzleSql.raw(`
        SELECT * FROM payments
        WHERE customer_id = ANY(ARRAY[${idArr}]::int[])
          AND date < '${startDate}'
          AND method != 'RETENCION'
      `)),
      db.execute(drizzleSql.raw(`
        SELECT * FROM payments
        WHERE customer_id = ANY(ARRAY[${idArr}]::int[])
          AND date >= '${startDate}' AND date < '${endDate}'
          AND method = 'RETENCION'
      `)),
      db.execute(drizzleSql.raw(`
        SELECT * FROM payments
        WHERE customer_id = ANY(ARRAY[${idArr}]::int[])
          AND date < '${startDate}'
          AND method = 'RETENCION'
      `)),
      db.execute(drizzleSql.raw(`
        SELECT o.id, o.folio, o.order_date::text AS "orderDate", o.total::text AS total,
               o.invoice_number AS "invoiceNumber", o.customer_id AS "customerId"
        FROM orders o
        WHERE o.customer_id = ANY(ARRAY[${idArr}]::int[])
          AND o.status = 'approved'
          AND o.order_date >= '${startDate}'::date
          AND o.order_date < '${endDate}'::date
        ORDER BY o.order_date DESC
      `)),
      db.execute(drizzleSql.raw(`
        SELECT pol.order_id AS "orderId", SUM(p.amount)::text AS "paidTotal"
        FROM payment_order_links pol
        JOIN payments p ON p.id = pol.payment_id
        JOIN orders o ON o.id = pol.order_id
        WHERE o.customer_id = ANY(ARRAY[${idArr}]::int[])
          AND o.status = 'approved'
          AND o.order_date >= '${startDate}'::date
          AND o.order_date < '${endDate}'::date
        GROUP BY pol.order_id
      `)),
    ]);

    // Opening balance: sum across all IDs
    const openingBalance = allIds.reduce((s, id) => {
      const cust = allCustomersMap.get(id);
      return s + parseFloat(cust?.openingBalance ?? "0");
    }, 0);
    const cobranzaBefore = (paymentsBef.rows as any[]).reduce((s, p) => s + parseFloat(p.amount ?? "0"), 0);
    const retencionBefore = (withholdingsBef.rows as any[]).reduce((s, w) => s + parseFloat(w.amount ?? "0"), 0);
    const saldoMesAnterior = Math.round(openingBalance + facturacionBefore - cobranzaBefore - retencionBefore);

    const cobranza = Math.round((paymentsIn.rows as any[]).reduce((s, p) => s + parseFloat(p.amount ?? "0"), 0));
    const retenciones = Math.round((withholdingsIn.rows as any[]).reduce((s, w) => s + parseFloat(w.amount ?? "0"), 0));
    const saldo = saldoMesAnterior + facturacion - cobranza - retenciones;

    // Compute billing per order
    const orderBillingMap = new Map<number, number>();
    for (const item of myItemsInPeriod) {
      const cust = allCustomersMap.get(item.customerId);
      orderBillingMap.set(item.orderId, (orderBillingMap.get(item.orderId) ?? 0) + itemBilling(item, cust?.hasIva ?? c.hasIva));
    }

    const paidByOrder = new Map<number, number>();
    for (const row of paidAmountsRows.rows as any[]) {
      paidByOrder.set(Number(row.orderId), parseFloat(row.paidTotal ?? "0"));
    }

    const ordersWithBilling = (ordersInPeriod.rows as any[]).map((o) => {
      const billingTotal = Math.round(orderBillingMap.get(o.id) ?? parseFloat(o.total ?? "0"));
      const paidAmount = Math.round(paidByOrder.get(o.id) ?? 0);
      return {
        id: o.id,
        folio: o.folio,
        orderDate: o.orderDate,
        total: billingTotal,
        invoiceNumber: o.invoiceNumber ?? null,
        paidAmount,
        isPaid: paidAmount >= billingTotal,
      };
    });

    // Per-subsidiary breakdown (only for parent customers)
    const subsidiaries = isParent ? allIds.map((cid) => {
      const cust = allCustomersMap.get(cid)!;
      const cidItemsIn = myItemsInPeriod.filter((i) => i.customerId === cid);
      const cidItemsBef = myItemsBefore.filter((i) => i.customerId === cid);
      const cidFact = Math.round(cidItemsIn.reduce((s, i) => s + itemBilling(i, cust.hasIva), 0));
      const cidFactBef = Math.round(cidItemsBef.reduce((s, i) => s + itemBilling(i, cust.hasIva), 0));
      const cidPayIn = (paymentsIn.rows as any[]).filter((p) => Number(p.customer_id) === cid).reduce((s, p) => s + parseFloat(p.amount ?? "0"), 0);
      const cidPayBef = (paymentsBef.rows as any[]).filter((p) => Number(p.customer_id) === cid).reduce((s, p) => s + parseFloat(p.amount ?? "0"), 0);
      const cidWitIn = (withholdingsIn.rows as any[]).filter((w) => Number(w.customer_id) === cid).reduce((s, w) => s + parseFloat(w.amount ?? "0"), 0);
      const cidWitBef = (withholdingsBef.rows as any[]).filter((w) => Number(w.customer_id) === cid).reduce((s, w) => s + parseFloat(w.amount ?? "0"), 0);
      const cidOpenBal = parseFloat(cust.openingBalance ?? "0");
      const cidSaldoBef = Math.round(cidOpenBal + cidFactBef - cidPayBef - cidWitBef);
      const cidSaldo = cidSaldoBef + cidFact - Math.round(cidPayIn) - Math.round(cidWitIn);
      return {
        customerId: cid,
        customerName: cust.name,
        facturacion: cidFact,
        cobranza: Math.round(cidPayIn),
        saldo: cidSaldo,
      };
    }) : [];

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
      payments: paymentsIn.rows,
      withholdings: withholdingsIn.rows,
      isParent,
      subsidiaries,
    };
  },

  // Returns the most recently used unit per product (from order_items history)
  async getProductUnitHistory(): Promise<{ productId: number; unit: string }[]> {
    const rows = await db.execute(drizzleSql`
      SELECT DISTINCT ON (product_id) product_id AS "productId", unit
      FROM order_items
      WHERE product_id IS NOT NULL
      ORDER BY product_id, id DESC
    `);
    return (rows.rows as any[]).map((r) => ({
      productId: Number(r.productId),
      unit: r.unit as string,
    }));
  },

  // ─── Suppliers CRUD ───────────────────────────────────────────────────────────

  async getSuppliers(): Promise<Supplier[]> {
    return db.select().from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.name));
  },

  async getSupplier(id: number): Promise<Supplier | undefined> {
    const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
    return s;
  },

  async createSupplier(data: InsertSupplier): Promise<Supplier> {
    const [s] = await db.insert(suppliers).values(data).returning();
    return s;
  },

  async updateSupplier(id: number, data: Partial<InsertSupplier>): Promise<Supplier> {
    const [s] = await db.update(suppliers).set(data).where(eq(suppliers.id, id)).returning();
    return s;
  },

  async deactivateSupplier(id: number): Promise<void> {
    await db.update(suppliers).set({ active: false }).where(eq(suppliers.id, id));
  },

  // ─── AP Payments ──────────────────────────────────────────────────────────────

  async createSupplierPayment(data: InsertSupplierPayment, userId?: number): Promise<SupplierPayment> {
    const [p] = await db.insert(supplierPayments).values({ ...data, createdBy: userId ?? null }).returning();
    return p;
  },

  async deleteSupplierPayment(id: number): Promise<void> {
    await db.delete(supplierPayments).where(eq(supplierPayments.id, id));
  },

  async getPendingPurchasesForSupplier(supplierId: number): Promise<{ id: number; folio: string; total: string; purchaseDate: string }[]> {
    const result = await db
      .select({ id: purchases.id, folio: purchases.folio, total: purchases.total, purchaseDate: purchases.purchaseDate })
      .from(purchases)
      .where(and(eq(purchases.supplierId, supplierId), eq(purchases.isPaid, false)))
      .orderBy(desc(purchases.purchaseDate))
      .limit(60);
    return result.map((r) => ({
      id: r.id,
      folio: r.folio,
      total: r.total != null ? String(r.total) : "0",
      purchaseDate: r.purchaseDate instanceof Date ? r.purchaseDate.toISOString() : String(r.purchaseDate),
    }));
  },

  // ─── AP CC Summary (resumen mensual por proveedor) ────────────────────────────

  async getAPCCSummary(month: number, year: number) {
    const fromDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const toDate = month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    const rows = await db.execute(drizzleSql`
      WITH period_purchases AS (
        SELECT supplier_id, SUM(total::numeric) AS facturacion
        FROM purchases
        WHERE supplier_id IS NOT NULL
          AND purchase_date >= ${fromDate}::timestamp
          AND purchase_date < ${toDate}::timestamp
        GROUP BY supplier_id
      ),
      prev_purchases AS (
        SELECT supplier_id, SUM(total::numeric) AS prev_total
        FROM purchases
        WHERE supplier_id IS NOT NULL AND purchase_date < ${fromDate}::timestamp
        GROUP BY supplier_id
      ),
      period_payments AS (
        SELECT supplier_id, SUM(amount::numeric) AS cobranza
        FROM supplier_payments
        WHERE date >= ${fromDate} AND date < ${toDate}
        GROUP BY supplier_id
      ),
      prev_payments AS (
        SELECT supplier_id, SUM(amount::numeric) AS prev_paid
        FROM supplier_payments
        WHERE date < ${fromDate}
        GROUP BY supplier_id
      )
      SELECT
        s.id AS "supplierId",
        s.name AS "supplierName",
        COALESCE(prev_purchases.prev_total, 0) - COALESCE(prev_payments.prev_paid, 0) AS "saldoMesAnterior",
        COALESCE(period_purchases.facturacion, 0) AS facturacion,
        COALESCE(period_payments.cobranza, 0) AS cobranza,
        (COALESCE(prev_purchases.prev_total, 0) - COALESCE(prev_payments.prev_paid, 0))
          + COALESCE(period_purchases.facturacion, 0)
          - COALESCE(period_payments.cobranza, 0) AS saldo
      FROM suppliers s
      LEFT JOIN period_purchases ON period_purchases.supplier_id = s.id
      LEFT JOIN prev_purchases ON prev_purchases.supplier_id = s.id
      LEFT JOIN period_payments ON period_payments.supplier_id = s.id
      LEFT JOIN prev_payments ON prev_payments.supplier_id = s.id
      WHERE s.active = true
        AND (
          period_purchases.facturacion IS NOT NULL
          OR prev_purchases.prev_total IS NOT NULL
          OR period_payments.cobranza IS NOT NULL
        )
      ORDER BY s.name
    `);

    const supplierRows = (rows.rows as any[]).map((r) => ({
      supplierId: Number(r.supplierId),
      supplierName: String(r.supplierName),
      saldoMesAnterior: Math.round(parseFloat(r.saldoMesAnterior ?? "0")),
      facturacion: Math.round(parseFloat(r.facturacion ?? "0")),
      cobranza: Math.round(parseFloat(r.cobranza ?? "0")),
      saldo: Math.round(parseFloat(r.saldo ?? "0")),
    }));

    const totals = supplierRows.reduce(
      (acc, r) => ({
        saldoMesAnterior: acc.saldoMesAnterior + r.saldoMesAnterior,
        facturacion: acc.facturacion + r.facturacion,
        cobranza: acc.cobranza + r.cobranza,
        saldo: acc.saldo + r.saldo,
      }),
      { saldoMesAnterior: 0, facturacion: 0, cobranza: 0, saldo: 0 }
    );

    return { month, year, suppliers: supplierRows, totals };
  },

  // ─── AP CC Detail (detalle mensual de un proveedor) ───────────────────────────

  async getAPCCSupplierDetail(supplierId: number, month: number, year: number) {
    const fromDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const toDate = month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    const [supplier, purchasesPrevRows, purchasesInRows, paymentsRows] = await Promise.all([
      db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1),
      // Compras anteriores al período
      db.execute(drizzleSql`
        SELECT COALESCE(SUM(total::numeric), 0) AS prev_total
        FROM purchases WHERE supplier_id = ${supplierId} AND purchase_date < ${fromDate}::timestamp
      `),
      // Compras del período
      db.execute(drizzleSql`
        SELECT id, folio, total::text AS total, purchase_date::text AS "purchaseDate",
               payment_method AS "paymentMethod", is_paid AS "isPaid",
               COALESCE(total_empty_cost, 0)::text AS "totalEmptyCost"
        FROM purchases
        WHERE supplier_id = ${supplierId}
          AND purchase_date >= ${fromDate}::timestamp
          AND purchase_date < ${toDate}::timestamp
        ORDER BY purchase_date DESC
      `),
      // Pagos del período y anteriores
      db.execute(drizzleSql`
        SELECT id, supplier_id AS "supplierId", date, amount::text AS amount, method, notes,
               purchase_id AS "purchaseId", created_at AS "createdAt"
        FROM supplier_payments
        WHERE supplier_id = ${supplierId}
        ORDER BY date DESC
      `),
    ]);

    const sup = supplier[0];
    if (!sup) throw new Error("Supplier not found");

    const prevPurchasesTotal = parseFloat((purchasesPrevRows.rows[0] as any)?.prev_total ?? "0");

    const allPayments = paymentsRows.rows as any[];
    const prevPaymentsTotal = allPayments
      .filter((p) => (p.date as string) < fromDate)
      .reduce((s, p) => s + parseFloat(p.amount ?? "0"), 0);
    const paymentsInPeriod = allPayments.filter((p) => (p.date as string) >= fromDate && (p.date as string) < toDate);

    const saldoMesAnterior = Math.round(prevPurchasesTotal - prevPaymentsTotal);

    const purchasesInPeriod = (purchasesInRows.rows as any[]).map((p) => ({
      id: Number(p.id),
      folio: String(p.folio),
      purchaseDate: String(p.purchaseDate),
      total: Math.round(parseFloat(p.total ?? "0")),
      paymentMethod: String(p.paymentMethod ?? "cuenta_corriente"),
      isPaid: Boolean(p.isPaid),
      totalEmptyCost: Math.round(parseFloat(p.totalEmptyCost ?? "0")),
    }));

    const facturacion = purchasesInPeriod.reduce((s, p) => s + p.total, 0);
    const cobranza = paymentsInPeriod.reduce((s, p) => s + Math.round(parseFloat(p.amount ?? "0")), 0);
    const saldo = saldoMesAnterior + facturacion - cobranza;

    return {
      supplier: { id: sup.id, name: sup.name, phone: sup.phone, email: sup.email, cuit: sup.cuit, ccType: sup.ccType },
      month,
      year,
      saldoMesAnterior,
      facturacion,
      cobranza,
      saldo,
      purchases: purchasesInPeriod,
      payments: paymentsInPeriod.map((p) => ({ ...p, amount: parseFloat(p.amount ?? "0") })),
    };
  },

  // ─── Vacíos vs Vales (historial completo por proveedor) ──────────────────────
  async getSupplierEmptiesDetail(supplierId: number) {
    const [emptiesRows, valesRows] = await Promise.all([
      db.execute(drizzleSql`
        SELECT pi.id, pi.purchase_id, pi.empty_cost::text AS empty_cost,
               pi.purchase_qty::text AS purchase_qty, pi.quantity::text AS quantity,
               pi.purchase_unit,
               p.folio, p.purchase_date::text AS purchase_date,
               pr.name AS product_name
        FROM purchase_items pi
        JOIN purchases p ON p.id = pi.purchase_id
        JOIN products pr ON pr.id = pi.product_id
        WHERE p.supplier_id = ${supplierId}
          AND pi.empty_cost > 0
        ORDER BY p.purchase_date DESC
      `),
      db.execute(drizzleSql`
        SELECT id, date, amount::text AS amount, notes
        FROM supplier_payments
        WHERE supplier_id = ${supplierId} AND method = 'VALE'
        ORDER BY date DESC
      `),
    ]);

    const empties = (emptiesRows.rows as any[]).map((r) => {
      const emptyCostPerUnit = parseFloat(r.empty_cost ?? "0");
      const qty = r.purchase_qty ? parseFloat(r.purchase_qty) : parseFloat(r.quantity ?? "0");
      return {
        purchaseId: Number(r.purchase_id),
        folio: String(r.folio),
        purchaseDate: String(r.purchase_date),
        productName: String(r.product_name),
        qty,
        emptyCostPerUnit,
        total: emptyCostPerUnit * qty,
      };
    });

    const vales = (valesRows.rows as any[]).map((r) => ({
      id: Number(r.id),
      date: String(r.date),
      amount: parseFloat(r.amount ?? "0"),
      notes: r.notes,
    }));

    const totalEmptyQty = empties.reduce((s, e) => s + e.qty, 0);
    const totalEmptyAmount = empties.reduce((s, e) => s + e.total, 0);
    const totalValesAmount = vales.reduce((s, v) => s + v.amount, 0);
    const avgEmptyCost = totalEmptyQty > 0 ? totalEmptyAmount / totalEmptyQty : 0;
    const totalValesQty = avgEmptyCost > 0 ? totalValesAmount / avgEmptyCost : 0;

    return {
      empties,
      vales,
      totalEmptyQty,
      totalEmptyAmount,
      totalValesQty,
      totalValesAmount,
      avgEmptyCost,
      saldoVacios: totalEmptyQty - totalValesQty,
    };
  },

  // ─── Dashboard Stats ─────────────────────────────────────────────────────────
  async getDashboardStats(from: string, to: string) {
    // 1) Ventas + ganancia bruta en el período (approved orders)
    const salesRow = await db.execute(drizzleSql`
      SELECT
        COALESCE(SUM(o.total::numeric), 0) AS ventas,
        COALESCE(SUM(o.total::numeric), 0)
          - COALESCE(SUM(oi_cost.cost_total), 0) AS ganancia_bruta
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT SUM(oi.quantity::numeric * oi.cost_per_unit::numeric) AS cost_total
        FROM order_items oi WHERE oi.order_id = o.id
      ) oi_cost ON true
      WHERE o.status = 'approved'
        AND o.order_date >= ${from}::timestamp
        AND o.order_date < ${to}::timestamp
    `);

    // 3) Totales merma/rinde del período
    const mermaRow = await db.execute(drizzleSql`
      SELECT
        COALESCE(SUM(CASE WHEN sm.notes ILIKE '%Merma%' THEN sm.quantity::numeric * COALESCE(sm.unit_cost::numeric, 0) ELSE 0 END), 0) AS merma,
        COALESCE(SUM(CASE WHEN sm.notes ILIKE '%Rinde%' THEN sm.quantity::numeric * COALESCE(sm.unit_cost::numeric, 0) ELSE 0 END), 0) AS rinde
      FROM stock_movements sm
      WHERE sm.created_at >= ${from}::timestamp
        AND sm.created_at < ${to}::timestamp
        AND (sm.notes ILIKE '%Merma%' OR sm.notes ILIKE '%Rinde%')
    `);

    // 5a) Vacíos recibidos en el período
    const vaciosRecibidosRow = await db.execute(drizzleSql`
      SELECT
        COALESCE(SUM(COALESCE(pi.purchase_qty, pi.quantity)::numeric), 0) AS qty,
        COALESCE(SUM(pi.empty_cost::numeric * COALESCE(pi.purchase_qty, pi.quantity)::numeric), 0) AS pesos
      FROM purchase_items pi
      JOIN purchases p ON p.id = pi.purchase_id
      WHERE pi.empty_cost::numeric > 0
        AND p.purchase_date::date >= ${from}::date AND p.purchase_date::date < ${to}::date
    `);

    // 5b) Vacíos entregados (vales VALE) en el período
    const vaciosEntregadosRow = await db.execute(drizzleSql`
      SELECT COALESCE(SUM(sp.amount::numeric), 0) AS pesos
      FROM supplier_payments sp
      WHERE sp.method = 'VALE'
        AND sp.date::date >= ${from}::date AND sp.date::date < ${to}::date
    `);

    // 5c) Histórico all-time para calcular en poder
    const vaciosHistRow = await db.execute(drizzleSql`
      SELECT
        COALESCE(SUM(COALESCE(pi.purchase_qty, pi.quantity)::numeric), 0) AS hist_qty,
        COALESCE(SUM(pi.empty_cost::numeric * COALESCE(pi.purchase_qty, pi.quantity)::numeric), 0) AS hist_pesos,
        COALESCE((SELECT SUM(sp.amount::numeric) FROM supplier_payments sp WHERE sp.method = 'VALE'), 0) AS hist_vales_pesos
      FROM purchase_items pi WHERE pi.empty_cost::numeric > 0
    `);

    // 6) Deuda a proveedores (all-time)
    const deudaRow = await db.execute(drizzleSql`
      SELECT
        COALESCE(SUM(p.total::numeric), 0) - COALESCE(SUM(sp.amount::numeric), 0) AS deuda
      FROM suppliers s
      LEFT JOIN purchases p ON p.supplier_id = s.id
      LEFT JOIN supplier_payments sp ON sp.supplier_id = s.id
      WHERE s.active = true
    `);

    // 7) Deuda de clientes (all-time AR balance)
    const deudaClientesRow = await db.execute(drizzleSql`
      SELECT COALESCE(SUM(GREATEST(0,
        COALESCE(o.total_sum, 0) - COALESCE(p.paid_sum, 0) - COALESCE(w.with_sum, 0)
      )), 0) AS deuda_clientes
      FROM customers c
      LEFT JOIN (
        SELECT customer_id, SUM(total::numeric) AS total_sum
        FROM orders WHERE status = 'approved'
        GROUP BY customer_id
      ) o ON o.customer_id = c.id
      LEFT JOIN (
        SELECT customer_id, SUM(amount::numeric) AS paid_sum
        FROM payments GROUP BY customer_id
      ) p ON p.customer_id = c.id
      LEFT JOIN (
        SELECT customer_id, SUM(amount::numeric) AS with_sum
        FROM withholdings GROUP BY customer_id
      ) w ON w.customer_id = c.id
      WHERE c.active = true
    `);

    // 8) Stock valorizado actual (real-time, no date filter)
    const stockValRow = await db.execute(drizzleSql`
      SELECT COALESCE(SUM(pu.stock_qty::numeric * pu.avg_cost::numeric), 0) AS stock_valorizado
      FROM product_units pu
      WHERE pu.stock_qty::numeric > 0 AND pu.is_active = true
    `);

    // 9) Comisiones por vendedor (período)
    const comisionesRows = await db.execute(drizzleSql`
      SELECT
        c.salesperson_name AS vendedor,
        COALESCE(SUM(o.total::numeric * c.commission_pct::numeric / 100), 0) AS comision_total
      FROM customers c
      JOIN orders o ON o.customer_id = c.id
      WHERE c.commission_pct::numeric > 0
        AND c.salesperson_name IS NOT NULL
        AND o.status = 'approved'
        AND o.order_date >= ${from}::timestamp
        AND o.order_date < ${to}::timestamp
      GROUP BY c.salesperson_name
      ORDER BY comision_total DESC
    `);

    const s = (salesRow.rows[0] as any) ?? {};
    const m = (mermaRow.rows[0] as any) ?? {};
    const vr = (vaciosRecibidosRow.rows[0] as any) ?? {};
    const ve = (vaciosEntregadosRow.rows[0] as any) ?? {};
    const vh = (vaciosHistRow.rows[0] as any) ?? {};
    const d = (deudaRow.rows[0] as any) ?? {};
    const dc = (deudaClientesRow.rows[0] as any) ?? {};
    const sv = (stockValRow.rows[0] as any) ?? {};

    const ventas = parseFloat(s.ventas ?? "0");
    const ganancia_bruta = parseFloat(s.ganancia_bruta ?? "0");
    const mermaTotal = parseFloat(m.merma ?? "0");
    const rindeTotal = parseFloat(m.rinde ?? "0");
    const ganancia_real = ganancia_bruta + rindeTotal - mermaTotal;

    // Días en el período
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    const diasPeriodo = Math.max(1, Math.ceil((toMs - fromMs) / 86400000));

    const histQty = parseFloat(vh.hist_qty ?? "0");
    const histPesos = parseFloat(vh.hist_pesos ?? "0");
    const histValesPesos = parseFloat(vh.hist_vales_pesos ?? "0");
    const avgCost = histQty > 0 ? histPesos / histQty : 0;
    const histEntregadosQty = avgCost > 0 ? Math.round(histValesPesos / avgCost) : 0;
    const enPoderQty = Math.max(0, histQty - histEntregadosQty);
    const enPoderPesos = Math.max(0, histPesos - histValesPesos);

    return {
      ventas,
      ganancia_bruta,
      mermaTotal,
      rindeTotal,
      ganancia_real,
      diasPeriodo,
      vaciosRecibidosPeriodo: { qty: parseFloat(vr.qty ?? "0"), pesos: parseFloat(vr.pesos ?? "0") },
      vaciosEntregadosPeriodo: { pesos: parseFloat(ve.pesos ?? "0"), qty: avgCost > 0 ? Math.round(parseFloat(ve.pesos ?? "0") / avgCost) : 0 },
      vaciosEnPoder: { qty: enPoderQty, pesos: enPoderPesos },
      deudaProveedores: Math.max(0, parseFloat(d.deuda ?? "0")),
      deudaClientes: parseFloat(dc.deuda_clientes ?? "0"),
      stockValorizado: parseFloat(sv.stock_valorizado ?? "0"),
      comisiones: (comisionesRows.rows as any[]).map((r) => ({
        vendedor: String(r.vendedor),
        total: parseFloat(r.comision_total ?? "0"),
      })),
    };
  },
};
