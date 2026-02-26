import { db } from "./db";
import {
  users, customers, products, purchases, purchaseItems,
  stockMovements, productCostHistory, orders, orderItems,
  priceHistory, remitos, productUnits,
  type User, type Customer, type Product, type Purchase,
  type PurchaseItem, type StockMovement, type Order,
  type OrderItem, type PriceHistory, type Remito, type ProductUnit,
} from "@shared/schema";
import { eq, desc, asc, and, sql as drizzleSql } from "drizzle-orm";
import { dbEnumToCanonical } from "@shared/units";
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

      const newQty = parseFloat(item.quantity);
      const newCost = parseFloat(item.costPerUnit);

      // ── Update product_units (canonical unit stock + cost) ──────────────────
      const canonicalUnit = dbEnumToCanonical(item.unit);
      const [existingPU] = await db.select().from(productUnits)
        .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
        .limit(1);

      if (existingPU) {
        const puStock = parseFloat(existingPU.stockQty as string);
        const puCost = parseFloat(existingPU.avgCost as string);
        const newPuAvgCost = puStock + newQty === 0 ? newCost : (puStock * puCost + newQty * newCost) / (puStock + newQty);
        await db.update(productUnits).set({
          stockQty: (puStock + newQty).toFixed(4),
          avgCost: newPuAvgCost.toFixed(4),
        }).where(eq(productUnits.id, existingPU.id));
      } else {
        await db.insert(productUnits).values({
          productId: item.productId,
          unit: canonicalUnit,
          avgCost: newCost.toFixed(4),
          stockQty: newQty.toFixed(4),
        });
      }

      // ── Keep products.currentStock + averageCost for backward compat ─────────
      const currentStock = parseFloat(product.currentStock as string);
      const currentAvgCost = parseFloat(product.averageCost as string);
      const newAvgCost = currentStock + newQty === 0
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

  async generatePurchaseFolio(): Promise<string> {
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

  // ─── Orders ───────────────────────────────────────────────────────────────
  async getNextRemitoFolio(): Promise<string> {
    const [last] = await db.select().from(remitos).orderBy(desc(remitos.id)).limit(1);
    const num = last ? parseInt(last.folio.replace("VA-", "")) + 1 : 1;
    return `VA-${String(num).padStart(6, "0")}`;
  },

  async getOrders(date?: string): Promise<(Order & { customerName: string; itemCount: number; suggestedRemito: string; hasIva: boolean; totalConIva: string; totalCosto: string })[]> {
    let all: Order[];
    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      all = await db
        .select()
        .from(orders)
        .where(drizzleSql`${orders.orderDate} >= ${startOfDay} AND ${orders.orderDate} <= ${endOfDay}`)
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
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    const [o] = await db
      .select()
      .from(orders)
      .where(
        drizzleSql`${orders.customerId} = ${customerId} AND ${orders.status} = 'draft' AND ${orders.orderDate} >= ${startOfDay} AND ${orders.orderDate} <= ${endOfDay}`
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

  async updateOrderItemPrice(orderId: number, itemId: number, pricePerUnit: string): Promise<OrderItem> {
    const [item] = await db.select().from(orderItems).where(
      and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId))
    ).limit(1);
    if (!item) throw new Error("Item not found");

    const qty = parseFloat(item.quantity as string);
    const price = parseFloat(pricePerUnit);
    const cost = parseFloat(item.costPerUnit as string);
    const subtotal = qty * price;
    const margin = price > 0 ? (price - cost) / price : 0;

    const [updated] = await db.update(orderItems).set({
      pricePerUnit,
      subtotal: subtotal.toFixed(2),
      margin: margin.toFixed(4),
    }).where(eq(orderItems.id, itemId)).returning();

    // Recalculate order total (only items with price)
    const allItems = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const total = allItems.reduce((s, i) => s + parseFloat(i.subtotal as string), 0);
    await db.update(orders).set({ total: total.toFixed(2) }).where(eq(orders.id, orderId));

    return updated;
  },

  async generateOrderFolio(): Promise<string> {
    const [last] = await db.select().from(orders).orderBy(desc(orders.id)).limit(1);
    const num = last ? parseInt(last.folio.replace("PV-", "")) + 1 : 1;
    return `PV-${String(num).padStart(5, "0")}`;
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

    // Create stock OUT movements and save price history
    for (const item of order.items) {
      const qty = parseFloat(item.quantity as string);

      // Only create stock movements for items with a linked product
      if (item.productId) {
        await db.insert(stockMovements).values({
          productId: item.productId,
          movementType: "out",
          quantity: item.quantity as string,
          unitCost: item.costPerUnit as string,
          referenceId: id,
          referenceType: "order",
          notes: `Pedido ${order.folio}`,
        });

        // Deduct from product_units (canonical unit)
        const canonicalUnit = dbEnumToCanonical(item.unit as string);
        const [pu] = await db.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
          .limit(1);
        if (pu) {
          const puStock = parseFloat(pu.stockQty as string) - qty;
          await db.update(productUnits).set({ stockQty: puStock.toFixed(4) }).where(eq(productUnits.id, pu.id));
        }

        // Update product.currentStock for backward compat
        const [product] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
        if (product) {
          const newStock = parseFloat(product.currentStock as string) - qty;
          await db.update(products).set({ currentStock: newStock.toFixed(4) }).where(eq(products.id, item.productId));
        }

        // Save final price to price_history
        await db.insert(priceHistory).values({
          customerId: order.customerId,
          productId: item.productId,
          pricePerUnit: item.pricePerUnit as string,
          orderId: id,
        });
      }
    }

    // Generate remito
    const [lastRemito] = await db.select().from(remitos).orderBy(desc(remitos.id)).limit(1);
    const remitoNum = lastRemito ? parseInt(lastRemito.folio.replace("VA-", "")) + 1 : 1;
    const remitoFolio = `VA-${String(remitoNum).padStart(6, "0")}`;

    const [remito] = await db.insert(remitos).values({
      folio: remitoFolio,
      orderId: id,
      customerId: order.customerId,
    }).returning();

    // Update order status
    const [updated] = await db.update(orders).set({
      status: "approved",
      approvedBy: userId,
      approvedAt: new Date(),
      remitoId: remito.id,
    }).where(eq(orders.id, id)).returning();

    return updated;
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
  async getLoadList(date: string): Promise<{ productId: number; productName: string; sku: string; unit: string; totalQuantity: number; orderCount: number }[]> {
    // Get all approved orders for the date
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const dayOrders = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.status, "approved"),
        drizzleSql`${orders.orderDate} >= ${startOfDay} AND ${orders.orderDate} <= ${endOfDay}`
      ));

    if (dayOrders.length === 0) return [];

    const orderIds = dayOrders.map((o) => o.id);

    // Get all items for those orders
    const allItems: (OrderItem & { product: Product })[] = [];
    for (const oid of orderIds) {
      const items = await db.select().from(orderItems).where(eq(orderItems.orderId, oid));
      for (const item of items) {
        if (!item.productId) continue;
        const [product] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
        if (product) allItems.push({ ...item, product });
      }
    }

    // Consolidate by product + unit
    const map = new Map<string, { productId: number; productName: string; sku: string; unit: string; totalQuantity: number; orderCount: number }>();
    for (const item of allItems) {
      const key = `${item.productId}-${item.unit}`;
      const existing = map.get(key);
      if (existing) {
        existing.totalQuantity += parseFloat(item.quantity as string);
        existing.orderCount += 1;
      } else {
        map.set(key, {
          productId: item.productId as number,
          productName: item.product.name,
          sku: item.product.sku,
          unit: item.unit,
          totalQuantity: parseFloat(item.quantity as string),
          orderCount: 1,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.productName.localeCompare(b.productName));
  },

  // ─── Product Units ──────────────────────────────────────────────────────────

  async getProductUnits(productId: number): Promise<ProductUnit[]> {
    return db.select().from(productUnits)
      .where(and(eq(productUnits.productId, productId), eq(productUnits.isActive, true)));
  },

  async getAllProductUnitsStock(): Promise<(ProductUnit & { product: Product })[]> {
    const all = await db.select().from(productUnits);
    const result = await Promise.all(
      all.map(async (pu) => {
        const [product] = await db.select().from(products).where(eq(products.id, pu.productId)).limit(1);
        return { ...pu, product };
      })
    );
    return result.filter((r) => r.product?.active);
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

  async bulkImportProducts(lines: { name: string; unit: string }[]): Promise<{ created: number; unitsAdded: number }> {
    let created = 0;
    let unitsAdded = 0;
    for (const line of lines) {
      const normalizedName = line.name.trim().toUpperCase();
      const canonicalUnit = line.unit.trim().toUpperCase(); // already canonicalized by caller

      // Find or create product
      let [existing] = await db.select().from(products)
        .where(drizzleSql`upper(${products.name}) = ${normalizedName}`)
        .limit(1);

      if (!existing) {
        // Generate a safe SKU from name
        const sku = normalizedName.replace(/\s+/g, "-").slice(0, 20) + "-" + Date.now().toString().slice(-4);
        const [created_] = await db.insert(products).values({
          name: normalizedName,
          sku,
          description: "",
          unit: "kg" as any, // default enum value for backward compat
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
};
