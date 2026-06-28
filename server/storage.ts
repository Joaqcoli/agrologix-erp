import { db } from "./db";
import {
  users, customers, products, purchases, purchaseItems,
  stockMovements, productCostHistory, orders, orderItems,
  priceHistory, remitos, productUnits, payments, withholdings, paymentOrderLinks,
  suppliers, supplierPayments, supplierPaymentPurchaseLinks, clientGroups, clientGroupMembers, priceListItems,
  invoices, cajaMovements, bankCategories, mpMovementOverrides, bankContacts, bankPaymentLinks,
  mpMovementIdentifiers,
  creditNotes,
  cuentasFinancieras,
  type User, type Customer, type Product, type Purchase,
  type PurchaseItem, type Order,
  type OrderItem, type PriceHistory, type Remito, type ProductUnit,
  type Payment, type Withholding, type InsertPayment, type InsertWithholding,
  type Supplier, type SupplierPayment, type InsertSupplier, type InsertSupplierPayment,
  type PriceListItem, type InsertPriceListItem,
  type Invoice, type InsertInvoice,
  type CreditNote, type InsertCreditNote,
  type CajaMovement, type InsertCajaMovement,
  type BankCategory,
  type BankContact, type InsertBankContact,
  type MpMovementIdentifier,
} from "@shared/schema";
import { eq, desc, asc, and, sql as drizzleSql, ne, gte, lt, lte, between, inArray } from "drizzle-orm";
import { dbEnumToCanonical } from "@shared/units";
import { ivaRateOf } from "@shared/iva";
import bcrypt from "bcryptjs";
import { getHistoricalMonthStats, isHistoricalMonth, listHistoricalMonths } from "./historical-stats";

// ─── CC Helpers ────────────────────────────────────────────────────────────────
// La tasa de IVA sale de products.iva_rate (única fuente, helper compartido). Ver M6.

// Items enriched with product name/category + tasa de IVA para el cálculo
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
  productCategory: string;
  ivaRate?: string | null; // tasa del producto (products.iva_rate)
};

// Compute billing amount for one item (with or without IVA)
function itemBilling(item: RawOrderItem, hasIva: boolean): number {
  if (!item.pricePerUnit || parseFloat(item.pricePerUnit) === 0) return 0;
  const subtotal = parseFloat(item.quantity) * parseFloat(item.pricePerUnit);
  return hasIva ? subtotal * (1 + ivaRateOf(item)) : subtotal;
}

// Compute gross profit for one item (revenue with IVA minus cost)
function itemProfit(item: RawOrderItem, hasIva: boolean): number {
  const qty = parseFloat(item.quantity);
  const cost = parseFloat(item.overrideCostPerUnit ?? item.costPerUnit ?? "0");
  return itemBilling(item, hasIva) - qty * cost;
}

// Forma REAL que devuelven las queries crudas de obligacion_pagos: snake_case + numeric
// casteado a float (distinta del $inferSelect de Drizzle, que es camelCase + string). M8.
type ObligacionPagoRow = {
  id: number; obligacion_id: number; fecha: string; monto: number; moneda: string;
  cotizacion: number | null; monto_ars: number; cuenta_pago_id: number | null; created_at: string | Date;
};

// Is this unit a "bulto" (physical box/bag)?
const BULTO_UNITS = new Set(["CAJON", "BOLSA", "BANDEJA"]);
function isBulto(unit: string): boolean {
  return BULTO_UNITS.has(unit.toUpperCase());
}

// Históricos de ventas/comisiones cargados a mano para meses sin pedidos (por vendedor + YYYY-MM).
// Si un mes tiene override, se usa ese valor (en el banner mensual y en el gráfico) en vez de calcular.
const VENDEDOR_HIST: Record<string, Record<string, { facturacion: number; comisiones: number }>> = {
  Juan: {
    "2026-01": { facturacion: 707300, comisiones: 35365 },
    "2026-02": { facturacion: 5644580, comisiones: 282229 },
    "2026-03": { facturacion: 6003480, comisiones: 300174 },
  },
};

// Match leyenda del extracto Galicia → socio, por PRIMER nombre del socio dentro de la leyenda.
// Normaliza acentos (la leyenda dice "JOAQUIN" sin tilde; el socio es "Joaquín Coli").
// Ej: "FEDERICO EMANUEL VIDUHEIRO | ..." → socio cuyo primer nombre normalizado es "FEDERICO".
function _normName(s: string): string {
  return String(s ?? "").toUpperCase()
    .replace(/[ÁÀÄÂÃ]/g, "A").replace(/[ÉÈËÊ]/g, "E").replace(/[ÍÌÏÎ]/g, "I")
    .replace(/[ÓÒÖÔÕ]/g, "O").replace(/[ÚÙÜÛ]/g, "U");
}
export function matchSocioByLeyenda(leyenda: string | null | undefined, socios: { id: number; nombre: string }[]): number | null {
  const L = _normName(leyenda ?? "");
  if (!L) return null;
  for (const s of socios) {
    const first = _normName(s.nombre).split(/\s+/)[0] ?? "";
    if (first.length >= 3 && L.includes(first)) return s.id;
  }
  return null;
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

  async createUser(data: { name: string; email: string; password: string; role: "admin" | "operator" | "vendedor" | "galpon" }): Promise<User> {
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
  async getPurchases(date?: string): Promise<(Purchase & { itemCount: number; bultos: number })[]> {
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
        // Bultos = lo cargado como CAJON o BOLSA (misma lógica que el dashboard)
        const bultos = items.reduce((s, it) => {
          const pu = String((it as any).purchaseUnit ?? "").toUpperCase();
          const u = String(it.unit ?? "").toUpperCase();
          if (pu === "CAJON" || pu === "BOLSA") return s + (parseFloat(String((it as any).purchaseQty ?? "0")) || 0);
          if (u === "CAJON" || u === "BOLSA") return s + (parseFloat(String(it.quantity ?? "0")) || 0);
          return s;
        }, 0);
        return { ...p, itemCount: items.length, bultos };
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
    totalEmptyCostExtra?: string;
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
    // Add any global empty cost not tied to a specific item (e.g., for KG/ATADO purchases)
    totalEmptyCost += parseFloat(data.totalEmptyCostExtra ?? "0") || 0;

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
          newPuAvgCost = newCost === 0
            ? puCost
            : (puStock + newQty === 0 ? newCost : (puStock * puCost + newQty * newCost) / (puStock + newQty));

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
            isActive: true, // reactivar si fue desactivado desde la vista de stock
          };
          if (isPackagePurchase) {
            puUpdate.weightPerUnit = newWeightPerUnit.toFixed(4);
          } else if (baseUnitCanonical === "MAPLE" && parseFloat(existingPU.weightPerUnit as string ?? "0") === 0) {
            puUpdate.weightPerUnit = "12.0000"; // Huevos: 1 CAJON = 12 MAPLES siempre
          }

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
            isActive: true,
            ...(weightPerPackage > 0
              ? { weightPerUnit: weightPerPackage.toFixed(4) }
              : baseUnitCanonical === "MAPLE"
              ? { weightPerUnit: "12.0000" } // Huevos: 1 CAJON = 12 MAPLES siempre
              : {}),
          });
        }

        // ── products.currentStock + averageCost: costo promedio ponderado ─────────
        const currentStock = parseFloat(product.currentStock as string);
        const currentAvgCost = parseFloat(product.averageCost as string);
        const newAvgCost = newCost === 0
          ? currentAvgCost
          : (currentStock + newQty === 0 ? newCost : (currentStock * currentAvgCost + newQty * newCost) / (currentStock + newQty));
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
      }

      // Costo = PROMEDIO PONDERADO MÓVIL (WMA), el modelo oficial. El avg ya se calculó
      // inline arriba (product_units y products) con (stock·costo + qty·compra)/(stock+qty);
      // con stock 0 resetea limpio al costo de la compra. Acá sólo propagamos
      // products.average_cost desde las filas base. NO se pisa con FIFO (fijo al comprar,
      // quieto al vender). Ver AUDITORIA-COSTOS.md §14-20.
      const affectedPids = Array.from(new Set(data.items.map((i) => i.productId)));
      for (const pid of affectedPids) {
        await this._recalcProductSummary(pid, tx);
      }

      return purchase;
    });

    // Después de confirmar la transacción: actualizar costPerUnit en pedidos borrador
    // para los productos comprados (fuera de la tx para no enlentecerla).
    const purchasedProductIds = data.items.map((i) => i.productId);
    await this._syncDraftOrderItemCosts(purchasedProductIds).catch((err) => {
      console.error("SYNC draft order costs failed (non-fatal):", err);
    });

    return purchase;
  },

  // Actualiza costPerUnit en order_items de pedidos borrador para los productos dados.
  async _syncDraftOrderItemCosts(productIds: number[]): Promise<void> {
    if (!productIds.length) return;
    const draftItems = await db
      .select({ id: orderItems.id, productId: orderItems.productId, unit: orderItems.unit })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(
        drizzleSql`${orders.status} = 'draft'`,
        inArray(orderItems.productId, productIds),
      ));
    for (const item of draftItems) {
      const freshCost = await this._getCostForUnit(item.productId, item.unit as string);
      await db.update(orderItems).set({ costPerUnit: freshCost }).where(eq(orderItems.id, item.id));
    }
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
  // ignoreStock=false (default): retorna "0" si no hay stock — el costo solo existe si hay mercadería
  // ignoreStock=true: retorna el último costo conocido sin importar el stock (para rinde / display de dialog)
  async _getCostForUnit(productId: number, unit: string, tx: any = db, ignoreStock = false): Promise<string> {
    const canonical = dbEnumToCanonical(unit);
    const isPackageUnit = ['CAJON', 'BOLSA', 'BANDEJA'].includes(canonical);

    // 1) Coincidencia exacta — SOLO para unidades base (no CAJON/BOLSA/BANDEJA)
    // Las unidades de envase siempre derivan del row base para evitar rows CAJON del modelo antiguo
    if (!isPackageUnit) {
      const [exactPu] = await tx.select().from(productUnits)
        .where(and(eq(productUnits.productId, productId), eq(productUnits.unit, canonical)))
        .limit(1);
      if (exactPu && parseFloat(exactPu.avgCost as string) > 0) {
        if (ignoreStock || parseFloat(exactPu.stockQty as string) > 0) return exactPu.avgCost as string;
        // Hay costo histórico pero sin stock — intentar derivar de otra fila base con stock
      }
      // 1b) Fallback cross-unit: buscar otra fila base con stock para derivar el costo
      // Cubre: KG order con ATADO/UNIDAD stock (cost_kg = altCost/wpu)
      //        MAPLE/UNIDAD order cuando la otra es la que tiene stock (huevos)
      if (!ignoreStock) {
        const [altBase] = await tx.select().from(productUnits)
          .where(and(
            eq(productUnits.productId, productId),
            drizzleSql`${productUnits.baseUnit} IS NOT NULL`,
            drizzleSql`${productUnits.unit} NOT IN ('CAJON','BOLSA','BANDEJA')`,
            drizzleSql`${productUnits.unit} != ${canonical}`,
            drizzleSql`${productUnits.stockQty}::numeric > 0`,
            drizzleSql`${productUnits.avgCost}::numeric > 0`,
          ))
          .orderBy(drizzleSql`${productUnits.stockQty}::numeric DESC`)
          .limit(1);
        if (altBase) {
          const altCost = parseFloat(altBase.avgCost as string);
          const altWpu = parseFloat(altBase.weightPerUnit as string ?? "0");
          // MAPLE ↔ UNIDAD: misma unidad conceptual (huevos, 1 MAPLE = 1 UNIDAD = 1 docena)
          if (['MAPLE','UNIDAD'].includes(canonical) && ['MAPLE','UNIDAD'].includes(altBase.unit)) {
            return altBase.avgCost as string;
          }
          // KG order: altBase es ATADO o UNIDAD con wpu = KG por unidad → cost_per_KG = altCost / wpu
          if (canonical === 'KG' && altWpu > 0) {
            return (altCost / altWpu).toFixed(4);
          }
        }
      }
      return "0"; // hay costo histórico pero sin stock (o no hay fallback viable)
    }

    // 2) Unidad de envase: derivar de fila base × weight_per_package
    // CRÍTICO: solo buscar filas base que NO sean unidades de envase (excluye rows CAJON mal marcados)
    // Ordenar por stockQty DESC para preferir filas con stock real sobre filas históricas vacías
    if (isPackageUnit) {
      const [baseRow] = await tx.select().from(productUnits)
        .where(and(
          eq(productUnits.productId, productId),
          drizzleSql`${productUnits.baseUnit} IS NOT NULL`,
          drizzleSql`${productUnits.unit} NOT IN ('CAJON','BOLSA','BANDEJA')`,
        ))
        .orderBy(drizzleSql`${productUnits.stockQty}::numeric DESC, ${productUnits.avgCost}::numeric DESC`)
        .limit(1);
      if (baseRow && parseFloat(baseRow.avgCost as string) > 0) {
        if (ignoreStock || parseFloat(baseRow.stockQty as string) > 0) {
          const [recentPi] = await tx.select({ weightPerPackage: purchaseItems.weightPerPackage })
            .from(purchaseItems)
            .where(and(
              eq(purchaseItems.productId, productId),
              eq(purchaseItems.purchaseUnit, canonical as any),
            ))
            .orderBy(desc(purchaseItems.id))
            .limit(1);
          let wpu = recentPi?.weightPerPackage
            ? parseFloat(recentPi.weightPerPackage as string)
            : parseFloat(baseRow.weightPerUnit as string ?? "0");
          // Fallback para datos viejos sin purchaseUnit: cualquier compra con weightPerPackage > 0
          if (wpu === 0) {
            const [anyPi] = await tx.select({ weightPerPackage: purchaseItems.weightPerPackage })
              .from(purchaseItems)
              .where(and(
                eq(purchaseItems.productId, productId),
                drizzleSql`${purchaseItems.weightPerPackage}::numeric > 0`,
              ))
              .orderBy(desc(purchaseItems.id))
              .limit(1);
            wpu = parseFloat(anyPi?.weightPerPackage as string ?? "0");
          }
          // Huevos: 1 CAJON = 12 MAPLES siempre (constante universal)
          if (wpu === 0 && baseRow.unit === "MAPLE") wpu = 12;
          if (wpu > 0) return (parseFloat(baseRow.avgCost as string) * wpu).toFixed(4);
        }
        return "0"; // base tiene costo pero sin stock
      }
    }

    // 3 & 4: solo cuando ignoreStock=true (ej. rinde de producto nunca comprado)
    if (ignoreStock) {
      const [p] = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
      if (p?.averageCost && parseFloat(p.averageCost as string) > 0) return p.averageCost as string;
      const [lastPi] = await tx.select({ costPerUnit: purchaseItems.costPerUnit })
        .from(purchaseItems)
        .where(eq(purchaseItems.productId, productId))
        .orderBy(desc(purchaseItems.id))
        .limit(1);
      if (lastPi?.costPerUnit && parseFloat(lastPi.costPerUnit as string) > 0) return lastPi.costPerUnit as string;
    }

    return "0";
  },

  async getLastPriceByUnit(productId: number, customerId: number, unit: string): Promise<string | null> {
    const canonical = unit.trim().toUpperCase();
    // Busca en todos los miembros del grupo (cliente + peers) juntos, más reciente primero.
    // Así el precio más nuevo de CUALQUIER miembro del grupo siempre gana.
    const peerIds = await this._getGroupPeerIds(customerId);
    const allIds = [customerId, ...peerIds];
    const allIdsSql = drizzleSql.join(allIds.map((id) => drizzleSql`${id}`), drizzleSql`, `);
    const result = await db.execute(drizzleSql`
      SELECT oi.price_per_unit
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = ${productId}
        AND o.customer_id = ANY(ARRAY[${allIdsSql}]::int[])
        AND upper(oi.unit::text) = ${canonical}
        AND o.status = 'approved'
        AND oi.price_per_unit::numeric > 0
      ORDER BY o.order_date DESC, o.id DESC
      LIMIT 1
    `);
    const rows = result.rows as any[];
    if (rows.length > 0) return String(rows[0].price_per_unit);
    return null;
  },

  async _getGroupPeerIds(customerId: number): Promise<number[]> {
    const memberships = await db
      .select({ groupId: clientGroupMembers.groupId })
      .from(clientGroupMembers)
      .where(eq(clientGroupMembers.customerId, customerId));
    if (memberships.length === 0) return [];
    const groupIds = memberships.map((m) => m.groupId);
    const peers = await db
      .select({ customerId: clientGroupMembers.customerId })
      .from(clientGroupMembers)
      .where(and(inArray(clientGroupMembers.groupId, groupIds), ne(clientGroupMembers.customerId, customerId)));
    return [...new Set(peers.map((p) => p.customerId))];
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

  // Recalcula el costo en base a las compras MÁS RECIENTES que componen el stock
  // actual (no el promedio perpetuo que arrastra picos históricos ya vendidos).
  // Implementa "el costo = lo que pagué por lo que efectivamente tengo en stock".
  async _recomputeCostFromStock(pid: number, tx: any = db): Promise<void> {
    // Fila base con stock (prioriza la marcada como base_unit; ignora cajón/bolsa)
    const baseRes: any = await tx.execute(drizzleSql`
      SELECT id, unit, stock_qty::float AS st FROM product_units
      WHERE product_id = ${pid} AND stock_qty::float > 0
        AND unit NOT IN ('CAJON','BOLSA','BANDEJA')
      ORDER BY (base_unit IS NOT NULL) DESC, stock_qty::float DESC LIMIT 1
    `);
    const baseRow = (baseRes.rows ?? baseRes)[0];
    if (!baseRow) return; // sin stock → preservar último costo conocido
    const stock = Number(baseRow.st);
    // Compras de la misma unidad base, de la más reciente a la más vieja
    const itemsRes: any = await tx.execute(drizzleSql`
      SELECT pi.quantity::float AS q, pi.cost_per_unit::float AS c
      FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
      WHERE pi.product_id = ${pid} AND pi.unit = ${baseRow.unit}
      ORDER BY p.purchase_date DESC, pi.id DESC
    `);
    const items = itemsRes.rows ?? itemsRes;
    let remaining = stock, sum = 0;
    for (const it of items) {
      if (remaining <= 0) break;
      const take = Math.min(Number(it.q), remaining);
      sum += take * Number(it.c);
      remaining -= take;
    }
    const covered = stock - remaining;
    if (covered <= 0) return; // no hay compras que matcheen → no tocar el costo
    const cost = (sum / covered).toFixed(4);
    await tx.execute(drizzleSql`UPDATE product_units SET avg_cost = ${cost} WHERE id = ${baseRow.id}`);
    await tx.execute(drizzleSql`UPDATE products SET average_cost = ${cost} WHERE id = ${pid}`);
  },

  // Recomputa product_units.weight_per_unit (kg por envase del producto) como el promedio
  // ponderado por CANTIDAD DE ENVASES de los pesos de las compras que cubren el stock actual,
  // recorriendo de la más reciente hacia atrás (MISMA ventana que el costo FIFO en
  // _recomputeCostFromStock) → costo y peso quedan coherentes (mismo conjunto de compras).
  // Ej.: stock 244kg cubierto por 11 cajón@16 (176kg) + 4 cajón@17 (68kg) → (11×16+4×17)/15 = 16.27.
  async _recomputeWeightPerUnitFromStock(pid: number, tx: any = db): Promise<void> {
    const baseRes: any = await tx.execute(drizzleSql`
      SELECT id, unit, stock_qty::float AS st FROM product_units
      WHERE product_id = ${pid} AND unit NOT IN ('CAJON','BOLSA','BANDEJA')
      ORDER BY (base_unit IS NOT NULL) DESC, stock_qty::float DESC LIMIT 1
    `);
    const baseRow = (baseRes.rows ?? baseRes)[0];
    if (!baseRow) return;
    const stock = Number(baseRow.st);
    const itemsRes: any = await tx.execute(drizzleSql`
      SELECT pi.quantity::float AS q, pi.weight_per_package::float AS wpp
      FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
      WHERE pi.product_id = ${pid} AND pi.unit = ${baseRow.unit}
      ORDER BY p.purchase_date DESC, pi.id DESC
    `);
    const items = itemsRes.rows ?? itemsRes;
    if (items.length === 0) return;

    // Sin stock: usar el peso por envase de la compra más reciente (no hay stock que ponderar)
    if (stock <= 0) {
      const latestPkg = items.find((it: any) => Number(it.wpp) > 0);
      if (latestPkg) await tx.execute(drizzleSql`UPDATE product_units SET weight_per_unit = ${Number(latestPkg.wpp).toFixed(4)} WHERE id = ${baseRow.id}`);
      return;
    }

    // Ventana FIFO: cubrir el stock (en kg base) de la más reciente hacia atrás.
    // El peso es el promedio ponderado por envases: weight_per_unit = kg_cubiertos / envases_cubiertos.
    let remaining = stock, totalKg = 0, totalEnvases = 0;
    for (const it of items) {
      if (remaining <= 0) break;
      const take = Math.min(Number(it.q), remaining);
      remaining -= take;
      const wpp = Number(it.wpp);
      if (wpp > 0) { totalKg += take; totalEnvases += take / wpp; }
    }
    if (totalEnvases <= 0) return; // no hay compras por envase en la ventana → no tocar
    const wpu = totalKg / totalEnvases;
    await tx.execute(drizzleSql`UPDATE product_units SET weight_per_unit = ${wpu.toFixed(4)} WHERE id = ${baseRow.id}`);
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
    supplierId?: number | null;
    affectsStock?: boolean; // global: si false, el edit NO toca el stock actual (sólo registro/CC/costo)
    purchaseDate: Date;
    notes?: string;
    totalEmptyCost?: string;
    items: { productId: number; quantity: string; unit: "KG" | "UNIDAD" | "CAJON" | "BOLSA" | "ATADO" | "MAPLE" | "BANDEJA"; costPerUnit: string; costPerPurchaseUnit?: string; purchaseQty?: string; purchaseUnit?: string; weightPerPackage?: string; affectsStock?: boolean }[];
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

      // ── Detección de items SIN CAMBIOS ────────────────────────────────────────
      // Para no re-tocar el stock de líneas que ya estaban (y ya fueron contabilizadas),
      // sólo se revierte/reaplica el stock de items removidos, cambiados o agregados.
      // Esto evita inflar el stock al editar una compra vieja (ej. cambiar el proveedor).
      // costo a 2 decimales para absorber ruido de redondeo en items por envase (cajón/bolsa)
      const itemSig = (productId: number, unit: any, quantity: any, costPerUnit: any) =>
        `${productId}|${dbEnumToCanonical(unit)}|${(parseFloat(String(quantity)) || 0).toFixed(4)}|${(parseFloat(String(costPerUnit)) || 0).toFixed(2)}`;
      const oldSigCount = new Map<string, number>();
      for (const it of oldItems) {
        const s = itemSig(it.productId, it.unit, it.quantity, it.costPerUnit);
        oldSigCount.set(s, (oldSigCount.get(s) ?? 0) + 1);
      }
      // Items nuevos que coinciden exactamente con uno viejo = "sin cambios"
      const unchangedNewSet = new Set<object>();
      const keepOldCount = new Map<string, number>();
      const matchCount = new Map(oldSigCount);
      for (const it of data.items) {
        const s = itemSig(it.productId, it.unit, it.quantity, it.costPerUnit);
        if ((matchCount.get(s) ?? 0) > 0) {
          matchCount.set(s, matchCount.get(s)! - 1);
          unchangedNewSet.add(it);
          keepOldCount.set(s, (keepOldCount.get(s) ?? 0) + 1);
        }
      }
      // affectsStock=false (línea sólo financiera) o item sin cambios → no toca stock
      const itemAffectsStock = (it: any) => it.affectsStock !== false && !unchangedNewSet.has(it);
      // Flag global: si el usuario eligió "no afectar stock", el edit no toca el inventario
      // (sólo actualiza el registro de la compra, la CC del proveedor y el costo).
      const stockEnabled = data.affectsStock !== false;

      // ── PHASE 1: Revertir items anteriores (sólo los que cambiaron/se removieron) ─
      for (const item of (stockEnabled ? oldItems : [])) {
        const sig = itemSig(item.productId, item.unit, item.quantity, item.costPerUnit);
        if ((keepOldCount.get(sig) ?? 0) > 0) { keepOldCount.set(sig, keepOldCount.get(sig)! - 1); continue; } // sin cambios → no revertir
        const canonicalUnit = dbEnumToCanonical(item.unit as any);
        const [pu] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
          .for('update')
          .limit(1);
        if (pu) {
          const newStock = Number(pu.stockQty) - Number(item.quantity);
          // C3 FIX: permitir el negativo intermedio (NO floorear acá). Si esta línea
          // se reaplica en PHASE 2 (mismo prod+unidad: cambio de cantidad/peso/precio),
          // el negativo se netea con el reaplique y queda el DELTA correcto. El floor
          // final (post-PHASE 2) limpia los que queden negativos (líneas removidas o
          // reaplicadas que no recuperan stock) y los desactiva. Preserva avgCost.
          // Antes flooreaba a 0 acá → inflaba el stock al editar compras viejas ya vendidas.
          await tx.update(productUnits)
            .set({ stockQty: newStock.toFixed(4) })
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
      const emptyCostAmount = parseFloat(data.totalEmptyCost ?? "0") || 0;
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
        if (!stockEnabled || !itemAffectsStock(item)) continue; // global off, sin cambios, o línea sólo financiera → no toca stock
        const newQty = Number(item.quantity);
        const newCost = Number(item.costPerUnit);
        const canonicalUnit = dbEnumToCanonical(item.unit);
        const purchaseQtyNum = item.purchaseQty ? parseFloat(item.purchaseQty) : 0;
        const weightPerPackage = item.weightPerPackage ? parseFloat(item.weightPerPackage) : 0;
        const isPackagePurchase = !!(item.purchaseUnit && weightPerPackage > 0 && purchaseQtyNum > 0);

        const [existingPU] = await tx.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
          .for('update')
          .limit(1);

        let newPuAvgCost: number;
        let newWeightPerUnit: number;

        if (existingPU) {
          const puStock = Number(existingPU.stockQty);
          const puCost = Number(existingPU.avgCost);
          // Costo PROMEDIO PONDERADO MÓVIL (WMA) al editar. Política (AUDITORIA-COSTOS.md §16):
          //  · newCost===0 (bonificación/rinde) → conservar el costo actual
          //  · puStock < 0 (post-revert negativo = stock < cantidad de la línea, mercadería ya
          //    vendida): NO recalcular, dejar el costo como está. La des-mezcla del WMA no es
          //    válida ahí; el ajuste de STOCK sí se aplica normal. Nunca rompe ni da negativo.
          //  · normal: (stock·costo + qty·compra)/(stock+qty); stock 0 → reset al costo nuevo.
          newPuAvgCost = newCost === 0
            ? puCost
            : puStock < 0
            ? puCost
            : (puStock + newQty) === 0
            ? newCost
            : (puStock * puCost + newQty * newCost) / (puStock + newQty);

          // BUG 3 FIX: recalcular weightPerUnit como promedio ponderado (igual que createPurchase)
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

          const isPackageCanonical = ['CAJON', 'BOLSA', 'BANDEJA'].includes(canonicalUnit);
          const puUpdate: Record<string, any> = {
            stockQty: (puStock + newQty).toFixed(4),
            avgCost: newPuAvgCost.toFixed(4),
            ...(!isPackageCanonical ? { baseUnit: canonicalUnit } : {}),
            isActive: true, // reactivar si fue desactivado desde la vista de stock
          };
          if (isPackagePurchase) {
            puUpdate.weightPerUnit = newWeightPerUnit.toFixed(4);
          } else if (canonicalUnit === "MAPLE" && parseFloat(existingPU.weightPerUnit as string ?? "0") === 0) {
            puUpdate.weightPerUnit = "12.0000"; // Huevos: 1 CAJON = 12 MAPLES siempre
          }
          await tx.update(productUnits).set(puUpdate).where(eq(productUnits.id, existingPU.id));
        } else {
          newPuAvgCost = newCost;
          newWeightPerUnit = weightPerPackage;
          const isPackageCanonical = ['CAJON', 'BOLSA', 'BANDEJA'].includes(canonicalUnit);
          const insertData: Record<string, any> = {
            productId: item.productId,
            unit: canonicalUnit,
            avgCost: newCost.toFixed(4),
            stockQty: newQty.toFixed(4),
            ...(!isPackageCanonical ? { baseUnit: canonicalUnit } : {}),
            isActive: true,
          };
          if (weightPerPackage > 0) {
            insertData.weightPerUnit = weightPerPackage.toFixed(4);
          } else if (canonicalUnit === "MAPLE") {
            insertData.weightPerUnit = "12.0000"; // Huevos: 1 CAJON = 12 MAPLES siempre
          }
          await tx.insert(productUnits).values(insertData);
        }

      }

      // ── C3 FIX: floor final de negativos ──────────────────────────────────────
      // Tras netear revert (PHASE 1) + reaplique (PHASE 2), cualquier fila que haya
      // quedado en negativo (línea removida, o reaplicada que no recupera stock) se
      // floorea a 0 y se desactiva (evita stock fantasma). Corre ANTES del resumen y
      // del FIFO para que lean stock limpio. lte(...,"0") también desactiva las filas
      // que quedaron en 0 exacto, replicando la prevención de fantasma del PHASE 1 viejo.
      if (stockEnabled) {
        for (const pid of allProductIds) {
          await tx.update(productUnits)
            .set({ stockQty: "0", isActive: false })
            .where(and(eq(productUnits.productId, pid), lte(productUnits.stockQty, "0")));
        }
      }

      const newProductIds = Array.from(new Set(data.items.map((i) => i.productId)));
      for (const pid of newProductIds) {
        await this._recalcProductSummary(pid, tx);
      }

      // ── Actualizar cabecera de compra ─────────────────────────────────────────
      const [updated] = await tx.update(purchases).set({
        supplierName: data.supplierName,
        ...(data.supplierId !== undefined ? { supplierId: data.supplierId } : {}),
        purchaseDate: data.purchaseDate,
        notes: data.notes,
        totalEmptyCost: emptyCostAmount.toFixed(2),
        total: (total + emptyCostAmount).toFixed(2),
      }).where(eq(purchases.id, id)).returning();

      // ── BUG 4 FIX: AP Sync — actualizar supplier_payment vinculado si existe ──
      // Para compras pagadas con efectivo/transferencia hay un supplier_payment
      // auto-creado con purchaseId. Si el total cambió, actualizar su monto.
      await tx.update(supplierPayments)
        .set({
          amount: (total + emptyCostAmount).toFixed(2),
          ...(data.supplierId !== undefined && data.supplierId !== null ? { supplierId: data.supplierId } : {}),
        })
        .where(eq(supplierPayments.purchaseId, id));

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

      for (const item of (stockEnabled ? data.items : [])) {
        // Líneas sólo financieras (no afectan stock) → sin movimiento ni cost history
        if (item.affectsStock === false) continue;
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

      // ── Costo = PROMEDIO PONDERADO MÓVIL (WMA) ────────────────────────────────
      // El avg se calculó en PHASE 2 (product_units) con la política de edición y se
      // propagó a products via _recalcProductSummary (arriba). NO se pisa con FIFO: el
      // modelo oficial es WMA (fijo al comprar, quieto al vender). Ver AUDITORIA-COSTOS.md §14-20.

      // Nota: costos en pedidos borrador del mismo día se actualizan al aprobar
      // via _getCostForUnit (el SYNC era fuente de transacciones lentas).

      return updated;
    });
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
        sm.created_by AS "createdBy",
        u.name AS "createdByName",
        sm.created_at::text AS "createdAt"
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      LEFT JOIN product_units pu ON pu.id = sm.reference_id
      LEFT JOIN users u ON u.id = sm.created_by
      WHERE sm.reference_type = 'adjustment'
        AND sm.notes NOT ILIKE 'Ajuste peso galpón%'  -- los de peso van en la vista unificada (reference_id = purchase_item)
      ORDER BY sm.created_at DESC
      LIMIT 1000
    `);
    return rows.rows as any[];
  },

  // ─── Vista unificada de Ajustes de stock (pre-venta + post-venta) ────────────
  // Consolida desde stock_movements: ajuste de peso del galpón (pre), merma/rinde
  // (manual + de pedidos, post), correcciones. SOLO LECTURA (no recalcula nada).
  // includeMoney=false → versión galpón (sin unitCost/value).
  async getStockAdjustments(includeMoney = true): Promise<any[]> {
    const res: any = await db.execute(drizzleSql`
      SELECT
        sm.id,
        sm.created_at::text AS created_at,
        sm.product_id,
        p.name AS product_name,
        COALESCE(p.category, 'Sin categoría') AS category,
        COALESCE(p.unit::text, 'KG') AS unit,
        sm.movement_type,
        sm.quantity::float AS quantity,
        sm.unit_cost::float AS unit_cost,
        sm.reference_type,
        sm.reference_id,
        sm.notes,
        sm.created_by,
        u.name AS created_by_name
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      LEFT JOIN users u ON u.id = sm.created_by
      WHERE (
              sm.reference_type = 'adjustment'
              OR (sm.reference_type = 'order' AND sm.notes ILIKE '%Rinde%')
            )
        AND sm.notes NOT ILIKE 'Reversión%'
        AND COALESCE(sm.notes,'') <> 'REVERTIDO'
      ORDER BY sm.created_at DESC
      LIMIT 2000
    `);
    const rows = (res.rows ?? res) as any[];
    const today = new Date(); const yest = new Date(Date.now() - 86400000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const todayISO = iso(today), yestISO = iso(yest);

    return rows.map((r) => {
      const notes: string = r.notes ?? "";
      const rt: string = r.reference_type;
      // Clasificación del tipo
      let tipo = "correccion", label = "Ajuste", section = "post", revert: string | null = null;
      if (/^Ajuste peso galpón/i.test(notes)) { tipo = "ajuste_peso"; label = "Ajuste de peso"; section = "pre"; revert = notes.includes("(deshecho)") ? null : "galpon_weight"; }
      else if (notes === "Merma") { tipo = "merma"; label = "Merma"; section = "post"; revert = "merma_rinde"; }
      else if (notes === "Rinde") { tipo = "rinde"; label = "Rinde"; section = "post"; revert = "merma_rinde"; }
      else if (rt === "order" && /Rinde/i.test(notes)) { tipo = "rinde_pedido"; label = "Rinde (pedido)"; section = "post"; revert = null; }

      const qty = Number(r.quantity) || 0;
      const sign = r.movement_type === "out" ? -1 : 1; // out = perdido, in = ganado/apareció
      const unitCost = r.unit_cost != null ? Number(r.unit_cost) : 0;
      const value = sign * qty * unitCost; // ganado/perdido en $
      const dateISO = (r.created_at ?? "").slice(0, 10);
      const revertible = revert != null && (dateISO === todayISO || dateISO === yestISO);

      const base: any = {
        id: r.id,
        createdAt: r.created_at,
        productId: r.product_id,
        productName: r.product_name,
        category: r.category,
        unit: r.unit,
        movementType: r.movement_type,
        quantity: qty,            // Δ en unidad base (siempre positivo; el signo va por movementType)
        tipo, label, section,
        createdBy: r.created_by ?? null,
        createdByName: r.created_by_name ?? null,
        revertKind: revertible ? revert : null,
        revertible,
        notes,
      };
      if (includeMoney) { base.unitCost = unitCost; base.value = value; }
      return base;
    });
  },

  // Deshacer un AJUSTE DE PESO del galpón: vuelve al peso anterior reusando el método
  // targeted (galponSetPurchaseItemWeight). Límite hoy/ayer. Marca el original (deshecho).
  async revertGalponWeightAdjustment(movementId: number, userId?: number): Promise<{ ok: true }> {
    const [mv] = await db.select().from(stockMovements).where(eq(stockMovements.id, movementId)).limit(1);
    if (!mv) throw new Error("Ajuste no encontrado");
    const notes = mv.notes ?? "";
    if (!/^Ajuste peso galpón/i.test(notes)) throw new Error("Este ajuste no es un ajuste de peso del galpón");
    if (notes.includes("(deshecho)")) throw new Error("Este ajuste ya fue deshecho");
    const d = (mv.createdAt as Date).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (d !== today && d !== yest) throw new Error("Solo se pueden deshacer ajustes de hoy o ayer");

    // Peso anterior: parsear "OLD→NEW" de las notas
    const m = notes.match(/(\d+(?:[.,]\d+)?)\s*→/);
    if (!m) throw new Error("No se pudo determinar el peso anterior");
    const oldWeight = parseFloat(m[1].replace(",", "."));
    if (!(oldWeight > 0)) throw new Error("Peso anterior inválido");

    const purchaseItemId = mv.referenceId as number;
    if (!purchaseItemId) throw new Error("No se pudo ubicar la línea de compra del ajuste");

    // Volver al peso anterior (el targeted reajusta stock + costo WMA, mismo que validamos)
    await this.galponSetPurchaseItemWeight(purchaseItemId, oldWeight, userId);
    // Marcar el original como deshecho (oculta el botón; no se vuelve a deshacer)
    await db.update(stockMovements).set({ notes: `${notes} (deshecho)` }).where(eq(stockMovements.id, movementId));
    return { ok: true };
  },

  // Elementos extra del dashboard del vendedor — TODO filtrado por su salesperson_name (sus clientes/pedidos).
  async getVendedorDashboardExtra(salespersonName: string) {
    // Venta con IVA (misma lógica que /api/vendedor/dashboard)
    const iva = drizzleSql`CASE
      WHEN oi.price_per_unit::numeric = 0 THEN 0
      WHEN c.has_iva = true THEN oi.quantity::numeric * oi.price_per_unit::numeric * (1 + COALESCE(p.iva_rate, 0.105))
      ELSE oi.quantity::numeric * oi.price_per_unit::numeric END`;
    const monthStart = drizzleSql`date_trunc('month', CURRENT_DATE)`;
    const monthEnd = drizzleSql`date_trunc('month', CURRENT_DATE) + interval '1 month'`;

    // 1) Clientes inactivos: asignados + activos + con AL MENOS un pedido; días desde el último pedido >= 7.
    //    (Los que nunca pidieron quedan fuera por el JOIN.)
    const inactivos = await db.execute(drizzleSql`
      SELECT c.id, c.name, c.phone, (CURRENT_DATE - MAX(o.order_date)::date) AS dias
      FROM customers c
      JOIN orders o ON o.customer_id = c.id
      WHERE c.salesperson_name = ${salespersonName} AND c.active = true
      GROUP BY c.id, c.name, c.phone
      HAVING (CURRENT_DATE - MAX(o.order_date)::date) >= 7
      ORDER BY dias DESC
    `);

    // 2) Ventas por día del mes actual (solo sus ventas aprobadas)
    const ventasPorDia = await db.execute(drizzleSql`
      SELECT o.order_date::date::text AS dia, COALESCE(SUM(${iva}), 0)::float AS total
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.status = 'approved' AND c.salesperson_name = ${salespersonName}
        AND o.order_date >= ${monthStart} AND o.order_date < ${monthEnd}
      GROUP BY o.order_date::date
      ORDER BY o.order_date::date
    `);

    // 3) Últimos pedidos cargados (cualquier estado), del vendedor
    const ultimosPedidos = await db.execute(drizzleSql`
      SELECT o.id, o.folio, o.order_date::date::text AS fecha, o.status,
             c.name AS cliente, o.total::float AS total
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE c.salesperson_name = ${salespersonName}
      ORDER BY o.created_at DESC
      LIMIT 8
    `);

    // 4) Top 5 clientes del mes por facturación — unificando sedes del mismo dueño (parent_customer_id)
    const topClientes = await db.execute(drizzleSql`
      WITH ventas AS (
        SELECT COALESCE(c.parent_customer_id, c.id) AS gid, (${iva}) AS v
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.status = 'approved' AND c.salesperson_name = ${salespersonName}
          AND o.order_date >= ${monthStart} AND o.order_date < ${monthEnd}
      )
      SELECT pc.id, pc.name, COALESCE(SUM(ventas.v), 0)::float AS total
      FROM ventas
      JOIN customers pc ON pc.id = ventas.gid
      GROUP BY pc.id, pc.name
      HAVING COALESCE(SUM(ventas.v), 0) > 0
      ORDER BY total DESC
      LIMIT 5
    `);

    return {
      inactivos: (inactivos.rows as any[]).map((r) => ({
        id: Number(r.id), name: String(r.name), phone: r.phone ? String(r.phone) : null, dias: Number(r.dias),
        bucket: Number(r.dias) >= 14 ? "roja" : "naranja",
      })),
      ventasPorDia: (ventasPorDia.rows as any[]).map((r) => ({ dia: String(r.dia), total: Number(r.total) })),
      ultimosPedidos: (ultimosPedidos.rows as any[]).map((r) => ({
        id: Number(r.id), folio: String(r.folio), fecha: String(r.fecha),
        status: String(r.status), cliente: String(r.cliente), total: Number(r.total),
      })),
      topClientes: (topClientes.rows as any[]).map((r) => ({ id: Number(r.id), name: String(r.name), total: Number(r.total) })),
    };
  },

  // Override de histórico para un vendedor en un mes (YYYY-MM); null si no hay
  vendedorHistOverride(salespersonName: string, ym: string): { facturacion: number; comisiones: number } | null {
    return VENDEDOR_HIST[salespersonName]?.[ym] ?? null;
  },

  // Facturación + comisiones mes a mes del año en curso (del vendedor). Usa el override donde exista.
  async getVendedorMonthly(salespersonName: string) {
    const year = new Date().getFullYear();
    const curMonth = new Date().getMonth() + 1;
    const rows = await db.execute(drizzleSql`
      SELECT to_char(o.order_date, 'YYYY-MM') AS ym,
        COALESCE(SUM(
          CASE
            WHEN oi.price_per_unit::numeric = 0 THEN 0
            WHEN c.has_iva = true THEN oi.quantity::numeric * oi.price_per_unit::numeric * (1 + COALESCE(p.iva_rate, 0.105))
            ELSE oi.quantity::numeric * oi.price_per_unit::numeric
          END
        ), 0)::float AS facturacion,
        COALESCE(SUM(
          CASE WHEN oi.price_per_unit::numeric = 0 THEN 0
            ELSE c.commission_pct::numeric / 100 * oi.quantity::numeric * oi.price_per_unit::numeric END
        ), 0)::float AS comisiones
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.status = 'approved' AND c.salesperson_name = ${salespersonName}
        AND o.order_date >= ${`${year}-01-01`}::timestamp AND o.order_date < ${`${year + 1}-01-01`}::timestamp
      GROUP BY to_char(o.order_date, 'YYYY-MM')
    `);
    const map = new Map((rows.rows as any[]).map((r) => [String(r.ym), { facturacion: Number(r.facturacion), comisiones: Number(r.comisiones) }]));
    const MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const out: { month: string; label: string; facturacion: number; comisiones: number }[] = [];
    for (let m = 1; m <= curMonth; m++) {
      const ym = `${year}-${String(m).padStart(2, "0")}`;
      const v = this.vendedorHistOverride(salespersonName, ym) ?? (map.get(ym) ?? { facturacion: 0, comisiones: 0 });
      out.push({ month: ym, label: MES[m - 1], facturacion: v.facturacion, comisiones: v.comisiones });
    }
    return out;
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
        if (o.remitoNum != null) {
          suggestedRemito = `VA-${String(o.remitoNum).padStart(5, "0")}`;
        } else if (o.remitoId) {
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
            const rate = ivaRateOf(productRow);
            return sum + subtotal * (1 + rate);
          }, 0);
        }
        totalCosto = items.reduce((sum, item) => {
          const qty = parseFloat(item.quantity as string);
          const cost = parseFloat((item.overrideCostPerUnit ?? item.costPerUnit ?? "0") as string);
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
        const product = item.productId
          ? ((await db.select().from(products).where(eq(products.id, item.productId)).limit(1))[0] ?? null)
          : null;
        // Bolsa FV: siempre costo $0.
        // Pedido borrador: recalcular costo según stock actual (evita costos históricos stale).
        let costPerUnit = item.costPerUnit;
        if ((item as any).bolsaType && (item as any).bolsaType !== 'sin_stock') {
          costPerUnit = "0";
        } else if (o.status === 'draft' && item.productId) {
          costPerUnit = await this._getCostForUnit(item.productId, item.unit as string);
        }
        return { ...item, costPerUnit, product: (product ?? null) as unknown as Product };
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
    const remitoNum = await this.getNextRemitoNumForCustomer(data.customerId);
    const [order] = await db.insert(orders).values({
      folio: data.folio,
      customerId: data.customerId,
      orderDate: data.orderDate,
      notes: data.notes,
      createdBy: data.createdBy,
      total: "0",
      status: "draft",
      lowMarginConfirmed: false,
      remitoNum,
    }).returning();

    const itemsToInsert = await Promise.all(
      data.items.map(async (item) => {
        let costPerUnit = "0";
        if (item.productId) {
          costPerUnit = await this._getCostForUnit(item.productId, item.unit ?? "KG");
        }
        let pricePerUnit = (item as any).pricePerUnit != null ? String((item as any).pricePerUnit) : null as any;
        // Bug A fix: si el front no mandó un precio válido (>0), buscarlo server-side
        // (cliente + peers del grupo, unidad exacta). Hace el precio determinístico,
        // independiente del timing del prefill async del navegador. Si el front ya mandó
        // un precio válido, se respeta y NO se pisa. No hay fallback de unidad (Bug B intacto).
        if ((!pricePerUnit || parseFloat(pricePerUnit) === 0) && item.productId) {
          const looked = await this.getLastPriceByUnit(item.productId, data.customerId, item.unit ?? "KG");
          if (looked && parseFloat(looked) > 0) pricePerUnit = looked;
        }
        const subtotal = pricePerUnit && item.quantity
          ? (parseFloat(pricePerUnit) * parseFloat(String(item.quantity))).toFixed(4)
          : "0";
        return {
          orderId: order.id,
          productId: item.productId ?? null,
          quantity: item.quantity,
          unit: (item.unit as any) ?? "KG",
          pricePerUnit,
          costPerUnit,
          margin: null as any,
          subtotal,
          rawProductName: item.rawProductName ?? null,
          parseStatus: item.parseStatus ?? "ok",
        };
      })
    );

    if (itemsToInsert.length > 0) {
      await db.insert(orderItems).values(itemsToInsert);
      // Recalcular el total del pedido a partir de los subtotales (antes quedaba en 0)
      const total = itemsToInsert.reduce((s, it) => s + (parseFloat(String(it.subtotal ?? "0")) || 0), 0);
      await db.update(orders).set({ total: total.toFixed(2) }).where(eq(orders.id, order.id));
      return { ...order, total: total.toFixed(2) };
    }

    return order;
  },

  async addItemsToOrder(orderId: number, items: {
    productId: number | null;
    quantity: string;
    unit: string;
    pricePerUnit?: string | null;
    rawProductName?: string;
    parseStatus?: string;
  }[]): Promise<void> {
    // customerId del pedido — necesario para el lookup de precio server-side (Bug A fix)
    const [ord] = await db.select({ customerId: orders.customerId }).from(orders).where(eq(orders.id, orderId)).limit(1);
    const orderCustomerId = ord?.customerId ?? null;
    const itemsToInsert = await Promise.all(
      items.map(async (item) => {
        let costPerUnit = "0";
        if (item.productId) {
          costPerUnit = await this._getCostForUnit(item.productId, item.unit ?? "KG");
        }
        let pricePerUnit = item.pricePerUnit != null ? String(item.pricePerUnit) : null as any;
        // Bug A fix: si no llega precio válido (>0), buscarlo server-side (cliente + peers del grupo,
        // unidad exacta). Respeta un precio válido enviado por el front. Sin fallback de unidad (Bug B intacto).
        if ((!pricePerUnit || parseFloat(pricePerUnit) === 0) && item.productId && orderCustomerId) {
          const looked = await this.getLastPriceByUnit(item.productId, orderCustomerId, item.unit ?? "KG");
          if (looked && parseFloat(looked) > 0) pricePerUnit = looked;
        }
        const subtotal = pricePerUnit && item.quantity
          ? (parseFloat(pricePerUnit) * parseFloat(String(item.quantity))).toFixed(4)
          : "0";
        return {
          orderId,
          productId: item.productId ?? null,
          quantity: item.quantity,
          unit: (item.unit as any) ?? "KG",
          pricePerUnit,
          costPerUnit,
          margin: null as any,
          subtotal,
          rawProductName: item.rawProductName ?? null,
          parseStatus: item.parseStatus ?? "ok",
        };
      })
    );
    if (itemsToInsert.length > 0) {
      await db.insert(orderItems).values(itemsToInsert);
      // Recalculate order total after inserting items
      const allItems = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      const total = allItems.reduce((s, i) => s + Number(i.subtotal), 0);
      await db.update(orders).set({ total: total.toFixed(2) }).where(eq(orders.id, orderId));
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
    // Total is recalculated inside addItemsToOrder; no override needed here
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

          // Buscar fila de unidad base (modelo nuevo) — preferir la que coincide con la unidad del item
          const [baseUnitPu] = await tx.select().from(productUnits)
            .where(and(
              eq(productUnits.productId, item.productId),
              drizzleSql`${productUnits.baseUnit} IS NOT NULL`,
              drizzleSql`${productUnits.unit} NOT IN ('CAJON','BOLSA','BANDEJA')`,
            ))
            .orderBy(drizzleSql`CASE WHEN ${productUnits.unit} = ${oiCanonical} THEN 0 ELSE 1 END`)
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
      isBonification?: boolean;
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
          .where(and(
            eq(productUnits.productId, item.productId),
            drizzleSql`${productUnits.baseUnit} IS NOT NULL`,
            drizzleSql`${productUnits.unit} NOT IN ('CAJON','BOLSA','BANDEJA')`,
          ))
          .orderBy(drizzleSql`CASE WHEN ${productUnits.unit} = ${oldCanonical} THEN 0 ELSE 1 END`)
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

      // Auto-fill price for bolsa FV: when toggling bolsa type on an item with no price,
      // fetch the last known sale price from price_history (same unit, prefer customer-specific)
      let bolsaAutoPrice: number | null = null;
      if (patch.bolsaType && ['bolsa', 'bolsa_propia'].includes(patch.bolsaType) &&
          !patch.pricePerUnit && newProductId) {
        const existingPriceNum = item.pricePerUnit ? Number(item.pricePerUnit as string) : 0;
        if (existingPriceNum === 0) {
          const unitForLookup = newUnit.toUpperCase();
          const [ph] = await tx.select().from(priceHistory)
            .where(and(
              eq(priceHistory.productId, newProductId),
              eq(priceHistory.customerId, customerId),
              eq(priceHistory.unit, unitForLookup),
              drizzleSql`${priceHistory.pricePerUnit}::numeric > 0`,
            ))
            .orderBy(desc(priceHistory.createdAt)).limit(1);
          if (ph) {
            bolsaAutoPrice = Number(ph.pricePerUnit);
          } else {
            const [phAny] = await tx.select().from(priceHistory)
              .where(and(
                eq(priceHistory.productId, newProductId),
                eq(priceHistory.unit, unitForLookup),
                drizzleSql`${priceHistory.pricePerUnit}::numeric > 0`,
              ))
              .orderBy(desc(priceHistory.createdAt)).limit(1);
            if (phAny) bolsaAutoPrice = Number(phAny.pricePerUnit);
          }
        }
      }

      const qty = Number(patch.quantity ?? (item.quantity as string));
      const existingPrice = item.pricePerUnit ? Number(item.pricePerUnit as string) : null;
      const newPriceRaw = patch.pricePerUnit !== undefined ? patch.pricePerUnit : null;
      const price = newPriceRaw !== undefined && newPriceRaw !== null
        ? Number(newPriceRaw)
        : (bolsaAutoPrice ?? existingPrice);
      const subtotal = price != null && price > 0 ? qty * price : 0;
      const margin = price && price > 0 ? (price - effectiveCost) / price : null;

      const updateData: Record<string, any> = { subtotal: subtotal.toFixed(2) };
      if (patch.quantity !== undefined) updateData.quantity = qty.toFixed(4);
      if (patch.unit !== undefined) updateData.unit = patch.unit;
      if (patch.productId !== undefined) updateData.productId = patch.productId;
      if (patch.pricePerUnit !== undefined) updateData.pricePerUnit = patch.pricePerUnit;
      else if (bolsaAutoPrice !== null) updateData.pricePerUnit = bolsaAutoPrice.toFixed(2);
      if (patch.overrideCostPerUnit !== undefined) updateData.overrideCostPerUnit = patch.overrideCostPerUnit;
      if (newCostPerUnit !== undefined) updateData.costPerUnit = newCostPerUnit;
      if (margin !== null) updateData.margin = margin.toFixed(4);
      if (patch.bolsaType !== undefined) updateData.bolsaType = patch.bolsaType;
      if (patch.isBonification !== undefined) updateData.isBonification = patch.isBonification;

      const [updated] = await tx.update(orderItems).set(updateData).where(eq(orderItems.id, itemId)).returning();

      // Recalculate order total
      const allItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      const total = allItems.reduce((s, i) => s + Number(i.subtotal), 0);
      await tx.update(orders).set({ total: total.toFixed(2) }).where(eq(orders.id, orderId));

      // Save price history when price is explicitly set and a product is linked
      if (patch.pricePerUnit && newProductId) {
        const unitForHistory = newUnit.toUpperCase();
        await tx.insert(priceHistory).values({ customerId, productId: newProductId, pricePerUnit: patch.pricePerUnit, unit: unitForHistory, orderId });
        // Propagate to group peers: write price_history + update their draft order_items
        const groupPeerIds = await this._getGroupPeerIds(customerId);
        if (groupPeerIds.length > 0) {
          await tx.insert(priceHistory).values(
            groupPeerIds.map((peerId) => ({
              customerId: peerId,
              productId: newProductId as number,
              pricePerUnit: patch.pricePerUnit as string,
              unit: unitForHistory,
              orderId,
            }))
          );
          // Sync price in peers' draft orders (same as approveOrder does)
          const peerIdsSql = drizzleSql.join(groupPeerIds.map((pid) => drizzleSql`${pid}`), drizzleSql`, `);
          await tx.execute(drizzleSql`
            UPDATE order_items oi
            SET
              price_per_unit = ${patch.pricePerUnit},
              subtotal = (oi.quantity::numeric * ${patch.pricePerUnit}::numeric)
            FROM orders o
            WHERE oi.order_id = o.id
              AND oi.product_id = ${newProductId}
              AND UPPER(oi.unit::text) = ${unitForHistory}
              AND o.customer_id = ANY(ARRAY[${peerIdsSql}]::int[])
              AND o.status = 'draft'
          `);
        }
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
          .where(and(
            eq(productUnits.productId, data.productId),
            drizzleSql`${productUnits.baseUnit} IS NOT NULL`,
            drizzleSql`${productUnits.unit} NOT IN ('CAJON','BOLSA','BANDEJA')`,
          ))
          .orderBy(drizzleSql`CASE WHEN ${productUnits.unit} = ${newCanonical} THEN 0 ELSE 1 END`)
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
          .where(and(
            eq(productUnits.productId, item.productId),
            drizzleSql`${productUnits.baseUnit} IS NOT NULL`,
            drizzleSql`${productUnits.unit} NOT IN ('CAJON','BOLSA','BANDEJA')`,
          ))
          .orderBy(drizzleSql`CASE WHEN ${productUnits.unit} = ${oldCanonical} THEN 0 ELSE 1 END`)
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
      drizzleSql`${orderItems}.bolsa_type != 'sin_stock'`,
      drizzleSql`${customers}.bolsa_fv = true`,
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

  async getNextRemitoNumForCustomer(customerId: number): Promise<number> {
    const [row] = await db
      .select({ maxNum: drizzleSql<number | null>`MAX(remito_num)` })
      .from(orders)
      .where(drizzleSql`customer_id = ${customerId} AND remito_num IS NOT NULL`);
    return (Number(row?.maxNum) || 0) + 1;
  },

  async generateOrderFolio(): Promise<string> {
    const [row] = await db
      .select({ maxNum: drizzleSql<number>`COALESCE(MAX(CAST(SUBSTRING(folio FROM 4) AS INTEGER)), 0)` })
      .from(orders)
      .where(drizzleSql`folio ~ '^(VA|PV)-\\d+$'`);
    const nextNum = (Number(row?.maxNum) || 0) + 1;
    return `VA-${String(nextNum).padStart(6, "0")}`;
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

    const remitoNum = await this.getNextRemitoNumForCustomer(data.customerId);
    const [order] = await db.insert(orders).values({
      folio: data.folio,
      customerId: data.customerId,
      orderDate: data.orderDate,
      notes: data.notes,
      lowMarginConfirmed: data.lowMarginConfirmed,
      createdBy: data.createdBy,
      total: total.toFixed(2),
      status: "draft",
      remitoNum,
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

  async approveOrder(id: number, userId: number, decisions?: Record<number, "zero" | "rinde" | "prorate">): Promise<Order> {
    const order = await this.getOrder(id);
    if (!order) throw new Error("Order not found");
    if (order.status !== "draft") throw new Error("Order is not in draft status");

    // Guard: all items must have a price before approval
    const unpricedItems = order.items.filter((i) => !i.pricePerUnit || parseFloat(i.pricePerUnit as string) === 0);
    if (unpricedItems.length > 0) {
      throw new Error(`${unpricedItems.length} producto(s) sin precio. Completá los precios antes de aprobar.`);
    }

    const groupPeerIds = await this._getGroupPeerIds(order.customerId);

    // Build price map from approved order items ("productId:UNIT" → pricePerUnit)
    const priceMap = new Map<string, string>();
    for (const item of order.items) {
      if (item.productId && item.unit && item.pricePerUnit && parseFloat(item.pricePerUnit as string) > 0) {
        priceMap.set(`${item.productId}:${(item.unit as string).toUpperCase()}`, item.pricePerUnit as string);
      }
    }

    return db.transaction(async (tx) => {
      // Stock OUT — atomic per-item deduction with floor-at-zero safety
      for (const item of order.items) {
        if (!item.productId) continue;
        // Bolsa FV items: no stock deduction, cost stays 0
        if (['bolsa', 'bolsa_propia'].includes((item as any).bolsaType)) continue;

        const qty = parseFloat(item.quantity as string);
        const oiCanonical = dbEnumToCanonical(item.unit as string);

        // Lock the product row
        const [product] = await tx.select().from(products)
          .where(eq(products.id, item.productId))
          .for('update')
          .limit(1);
        if (!product) continue;

        // ── Buscar fila de unidad base (modelo nuevo) ──────────────────────────
        // Prioridad: (1) tiene stock, (2) exact match, (3) más stock.
        // Esto evita que MAPLE(stock=0) gane sobre UNIDAD(stock=36) cuando el pedido es MAPLE.
        const [baseUnitPu] = await tx.select().from(productUnits)
          .where(and(
            eq(productUnits.productId, item.productId),
            drizzleSql`${productUnits.baseUnit} IS NOT NULL`,
            drizzleSql`${productUnits.unit} NOT IN ('CAJON','BOLSA','BANDEJA')`,
          ))
          .orderBy(
            drizzleSql`CASE WHEN ${productUnits.stockQty}::numeric > 0 THEN 0 ELSE 1 END`,
            drizzleSql`CASE WHEN ${productUnits.unit} = ${oiCanonical} THEN 0 ELSE 1 END`,
            drizzleSql`${productUnits.stockQty}::numeric DESC`,
          )
          .limit(1);

        // Determinar cantidad a descontar en unidad base
        let deductQty = qty;
        // wpuForBase: cuántas unidades base entran en 1 unidad de pedido (1 si el pedido ya está en unidad base).
        // Sirve para convertir el costo por unidad de pedido → costo por unidad base, porque las cantidades
        // de los movimientos de rinde/prorrateo se guardan en unidad base.
        let wpuForBase = 1;
        let puToUpdate: typeof baseUnitPu | null = baseUnitPu ?? null;

        if (baseUnitPu) {
          // Modelo nuevo: puede haber conversión de envase → unidad base
          if (oiCanonical !== baseUnitPu.unit && ['CAJON', 'BOLSA', 'BANDEJA'].includes(oiCanonical)) {
            // Buscar el peso por envase específico para este tipo (CAJON vs BANDEJA vs BOLSA)
            // para evitar usar el promedio confuso de todos los tipos de envase
            const [recentPi] = await tx.select({ weightPerPackage: purchaseItems.weightPerPackage })
              .from(purchaseItems)
              .where(and(
                eq(purchaseItems.productId, item.productId as number),
                eq(purchaseItems.purchaseUnit, oiCanonical as any),
              ))
              .orderBy(desc(purchaseItems.id))
              .limit(1);
            let wpu = recentPi?.weightPerPackage
              ? parseFloat(recentPi.weightPerPackage as string)
              : parseFloat(baseUnitPu.weightPerUnit as string ?? "0");
            if (wpu === 0) {
              const [anyPi] = await tx.select({ weightPerPackage: purchaseItems.weightPerPackage })
                .from(purchaseItems)
                .where(and(
                  eq(purchaseItems.productId, item.productId as number),
                  drizzleSql`${purchaseItems.weightPerPackage}::numeric > 0`,
                ))
                .orderBy(desc(purchaseItems.id))
                .limit(1);
              wpu = parseFloat(anyPi?.weightPerPackage as string ?? "0");
            }
            // Huevos: 1 CAJON = 12 MAPLES siempre (constante universal)
            if (wpu === 0 && baseUnitPu.unit === "MAPLE") wpu = 12;
            wpuForBase = wpu > 0 ? wpu : 1;
            deductQty = qty * wpuForBase;
          }
        } else {
          // Modelo antiguo: buscar por unidad canónica directa
          const [oldPu] = await tx.select().from(productUnits)
            .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, oiCanonical)))
            .limit(1);
          puToUpdate = oldPu ?? null;
        }

        const currentStock = parseFloat(product.currentStock as string);
        const availableQtyBase = puToUpdate ? parseFloat(puToUpdate.stockQty as string) : currentStock;
        const rawNewStock = currentStock - deductQty;
        const isOverflow = rawNewStock < 0;
        const finalStock = isOverflow ? 0 : rawNewStock;

        // Re-fetch costo actual al momento de aprobación ($0 si no hay stock)
        const freshCostStr = await this._getCostForUnit(item.productId, oiCanonical, tx);
        const freshCost = parseFloat(freshCostStr);
        const baseCostStr = freshCostStr; // no fallback a item.costPerUnit histórico

        // ── Decisión del usuario para stock insuficiente ────────────────────────
        const decision = decisions?.[item.id];

        if (decision === "zero") {
          // Sin efecto en stock, costo $0
          await tx.update(orderItems)
            .set({ costPerUnit: "0", margin: "1.0000" })
            .where(eq(orderItems.id, item.id));
          // No hay stock movement ni deducción de stock
          continue;
        }

        // effectiveCostStr: costo por unidad de PEDIDO → guardado en order_items.cost_per_unit y usado para el margen.
        // movementCostStr: costo por la MISMA unidad en que va la quantity del movimiento de stock.
        //   - Flujo normal: quantity en unidad de pedido → costo por unidad de pedido (= effectiveCostStr).
        //   - Rinde/prorrateo: quantity en unidad BASE → costo por unidad base (= effectiveCostStr ÷ wpuForBase),
        //     porque deductFromStock/excessQty están en unidad base. Sin esta división, un pedido en CAJON
        //     multiplicaría kg_base × costo_por_cajón (rinde inflado).
        let effectiveCostStr: string;
        let movementCostStr: string;
        let deductFromStock: number;
        let outQty: string;

        if (decision === "rinde") {
          // Para rinde: usar costo histórico aunque no haya stock (la mercadería "apareció")
          effectiveCostStr = await this._getCostForUnit(item.productId, oiCanonical, tx, true);
          movementCostStr = (parseFloat(effectiveCostStr) / wpuForBase).toFixed(4);
          deductFromStock = Math.max(0, availableQtyBase);
          outQty = (deductFromStock).toFixed(4);

          const excessQty = deductQty - deductFromStock;
          if (excessQty > 0) {
            // Movimiento de Rinde: representa la mercadería que "apareció" para cubrir el faltante.
            // quantity en unidad base → unitCost por unidad base.
            await tx.insert(stockMovements).values({
              productId: item.productId,
              movementType: "in",
              quantity: excessQty.toFixed(4),
              unitCost: movementCostStr,
              referenceId: id,
              referenceType: "order",
              notes: `Rinde — Pedido ${order.folio}`,
              createdBy: userId,
            });
          }
        } else if (decision === "prorate") {
          // Prorratear el costo del stock disponible entre toda la cantidad pedida.
          // freshCost es por unidad de pedido; lo paso a unidad base para operar con cantidades base.
          const baseFreshCost = freshCost / wpuForBase;
          const proratedCost = deductQty > 0 && freshCost > 0
            ? (availableQtyBase * freshCost) / deductQty
            : 0;
          effectiveCostStr = proratedCost.toFixed(4); // por unidad de pedido (order_items + margen)
          movementCostStr = baseFreshCost.toFixed(4); // por unidad base (la quantity OUT va en base)
          deductFromStock = Math.max(0, availableQtyBase);
          outQty = (deductFromStock).toFixed(4);
        } else {
          // Flujo normal (sin decisión = stock suficiente): el MOVIMIENTO se loguea en unidad
          // BASE (kg) igual que rinde/prorate, para que el ledger sea consistente.
          // effectiveCostStr (order_items + margen) sigue por unidad de PEDIDO — NO cambia.
          effectiveCostStr = baseCostStr;                          // por unidad de pedido (margen/order_items)
          movementCostStr = (parseFloat(baseCostStr) / wpuForBase).toFixed(4); // costo por unidad base (acompaña outQty base)
          deductFromStock = deductQty;
          outQty = deductQty.toFixed(4);                           // kg base (antes: item.quantity en bultos)
        }

        const movementNotes = (decision === "rinde" || decision === "prorate")
          ? `Stock insuficiente (${decision}) — Pedido ${order.folio}`
          : `Pedido ${order.folio}`;

        // Actualizar costPerUnit en order_items
        const price = parseFloat(item.pricePerUnit as string ?? "0");
        const newMargin = price > 0 && parseFloat(effectiveCostStr) > 0
          ? ((price - parseFloat(effectiveCostStr)) / price).toFixed(4)
          : null;
        const itemUpdate: Record<string, any> = { costPerUnit: effectiveCostStr };
        if (newMargin !== null) itemUpdate.margin = newMargin;
        await tx.update(orderItems).set(itemUpdate).where(eq(orderItems.id, item.id));

        // Stock OUT movement — unitCost en la misma unidad que outQty (ver movementCostStr arriba)
        if (parseFloat(outQty) > 0) {
          await tx.insert(stockMovements).values({
            productId: item.productId,
            movementType: "out",
            quantity: outQty,
            unitCost: movementCostStr,
            referenceId: id,
            referenceType: "order",
            notes: movementNotes,
            createdBy: userId,
          });
        }

        // Deduct from product_units — floor at 0; avgCost NUNCA se zeroa
        if (puToUpdate) {
          const rawPuStock = parseFloat(puToUpdate.stockQty as string) - deductFromStock;
          await tx.update(productUnits)
            .set({ stockQty: Math.max(0, rawPuStock).toFixed(4) })
            .where(eq(productUnits.id, puToUpdate.id));
        }

        // Update products.currentStock — floor at 0; averageCost NUNCA se zeroa
        await tx.update(products)
          .set({ currentStock: Math.max(0, currentStock - deductFromStock).toFixed(4) })
          .where(eq(products.id, item.productId));

        // Save final price to price_history
        await tx.insert(priceHistory).values({
          customerId: order.customerId,
          productId: item.productId,
          pricePerUnit: item.pricePerUnit as string,
          unit: item.unit as string,
          orderId: id,
        });
        // Replicate price to group peers
        if (groupPeerIds.length > 0) {
          await tx.insert(priceHistory).values(
            groupPeerIds.map((peerId) => ({
              customerId: peerId,
              productId: item.productId as number,
              pricePerUnit: item.pricePerUnit as string,
              unit: item.unit as string,
              orderId: id,
            }))
          );
        }
      }

      // Sync prices to all open (draft) orders from group peers
      if (groupPeerIds.length > 0 && priceMap.size > 0) {
        const peerIdsSql = drizzleSql.join(groupPeerIds.map((pid) => drizzleSql`${pid}`), drizzleSql`, `);
        for (const [key, price] of priceMap) {
          const [productIdStr, unit] = key.split(":");
          const productId = parseInt(productIdStr);
          await tx.execute(drizzleSql`
            UPDATE order_items oi
            SET
              price_per_unit = ${price},
              subtotal = (oi.quantity::numeric * ${price}::numeric)
            FROM orders o
            WHERE oi.order_id = o.id
              AND oi.product_id = ${productId}
              AND UPPER(oi.unit::text) = ${unit}
              AND o.customer_id = ANY(ARRAY[${peerIdsSql}]::int[])
              AND o.status = 'draft'
          `);
        }
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
    rows: Array<{ productId: number; productName: string; unit: string; totalQty: number; stockQty: number; diffQty: number; customersCount: number; customerNames: string[]; allProductStock: Array<{ unit: string; qty: number }> }>;
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
      // Bolsa FV items don't require stock picking — exclude from load list
      if ((item as any).bolsaType && ['bolsa', 'bolsa_propia'].includes((item as any).bolsaType)) return false;
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

    // Load stock from product_units (incluir weightPerUnit para conversión de envases)
    const allPU = productIds.length > 0
      ? await db.select({
            productId: productUnits.productId,
            unit: productUnits.unit,
            stockQty: productUnits.stockQty,
            weightPerUnit: productUnits.weightPerUnit,
          })
          .from(productUnits)
          .where(drizzleSql`${productUnits.productId} = ANY(ARRAY[${drizzleSql.join(productIds.map(id => drizzleSql`${id}`), drizzleSql`, `)}]::int[])`)
      : [];

    // stockMap: unidad exacta (para base units)
    const stockMap = new Map<string, number>();
    // baseStockMap: stock en unidad base por producto (KG/UNIDAD/MAPLE/ATADO)
    const baseStockMap = new Map<number, number>();
    // wpuMap: key "pid-UNIT" (desde purchase_items) o "pid" (desde product_units, fallback)
    const wpuMap = new Map<string, number>();

    for (const pu of allPU) {
      const canonUnit = dbEnumToCanonical(pu.unit as string);
      const stockVal = parseFloat(pu.stockQty as string ?? "0");
      stockMap.set(`${pu.productId}-${canonUnit}`, stockVal);
      if (!["CAJON", "BOLSA", "BANDEJA"].includes(canonUnit)) {
        // Quedarse con la fila base de MÁS stock (evita que una fila vieja en 0 de otra
        // unidad base pise la real). Coherente con la selección de approveOrder.
        if (stockVal > (baseStockMap.get(pu.productId) ?? -Infinity)) baseStockMap.set(pu.productId, stockVal);
        const wpu = parseFloat(pu.weightPerUnit as string ?? "0");
        if (Number.isFinite(wpu) && wpu > 0) wpuMap.set(`${pu.productId}`, wpu);
      }
    }

    // Para productos pedidos en envase, buscar wpu exacto por tipo en purchase_items
    const packagePids = [...new Set(
      resolvedItems
        .filter((i) => ["CAJON", "BOLSA", "BANDEJA"].includes(dbEnumToCanonical(i.unit as string)))
        .map((i) => i.productId as number),
    )];
    if (packagePids.length > 0) {
      // OJO Postgres: 'NaN'::numeric > 0 es TRUE, así que el filtro > 0 no excluye NaN.
      // Hay datos con weight_per_package = 'NaN' (ej. BROTE DE SOJA) → excluir explícitamente.
      const wpuRows = await db.execute(drizzleSql.raw(`
        SELECT DISTINCT ON (product_id, purchase_unit::text)
          product_id, purchase_unit::text AS pu, weight_per_package::numeric AS wpu
        FROM purchase_items
        WHERE product_id = ANY(ARRAY[${packagePids.join(",")}]::int[])
          AND purchase_unit IS NOT NULL
          AND weight_per_package IS NOT NULL
          AND weight_per_package::text <> 'NaN'
          AND weight_per_package::numeric > 0
        ORDER BY product_id, purchase_unit::text, id DESC
      `));
      for (const row of wpuRows.rows as any[]) {
        const wpu = parseFloat(row.wpu);
        // Guard defensivo: nunca dejar entrar NaN/inválido/≤0 al wpuMap
        if (Number.isFinite(wpu) && wpu > 0) wpuMap.set(`${row.product_id}-${row.pu}`, wpu);
      }
    }

    // Retorna stock en la misma unidad que el pedido (convirtiendo envases vía wpu)
    const stockForUnit = (pid: number, canonUnit: string): number => {
      if (["CAJON", "BOLSA", "BANDEJA"].includes(canonUnit)) {
        const base = baseStockMap.get(pid) ?? 0;
        const wpu = wpuMap.get(`${pid}-${canonUnit}`) ?? wpuMap.get(`${pid}`) ?? 0;
        // Guard: un wpu NaN/inválido nunca debe propagar NaN al stock convertido
        return Number.isFinite(wpu) && wpu > 0 ? base / wpu : 0;
      }
      return stockMap.get(`${pid}-${canonUnit}`) ?? 0;
    };

    // Stock de todas las unidades por producto (para detectar "duda" en el frontend)
    const productAllStock = new Map<number, Array<{ unit: string; qty: number }>>();
    for (const pu of allPU) {
      const qty = parseFloat(pu.stockQty as string ?? "0");
      if (qty > 0) {
        const canonUnit = dbEnumToCanonical(pu.unit as string);
        if (!productAllStock.has(pu.productId)) productAllStock.set(pu.productId, []);
        productAllStock.get(pu.productId)!.push({ unit: canonUnit, qty });
      }
    }

    // ── Consolidación por PRODUCTO (fix doble conteo entre unidades) ───────────
    // Toda la demanda del producto se lleva a unidad BASE (kg), se resta el stock UNA
    // sola vez, y el faltante se expresa en la unidad de compra (envase si se pidió en
    // envase; si no, la unidad base). El desglose por unidad queda informativo
    // (demandByUnit). ANTES cada unidad se comparaba contra el stock ENTERO → el mismo
    // stock se contaba N veces y escondía faltantes. Ver AUDITORIA-LISTA-CARGA.md.
    const PACKAGE_UNITS = ["CAJON", "BOLSA", "BANDEJA"];
    // wpu = unidades base por 1 unidad de pedido. Base → 1. Envase → wpu del tipo (guarda
    // contra NaN/≤0: si no hay wpu confiable devuelve 0 = "no convertible").
    const wpuForUnit = (pid: number, canonUnit: string): number => {
      if (!PACKAGE_UNITS.includes(canonUnit)) return 1;
      const wpu = wpuMap.get(`${pid}-${canonUnit}`) ?? wpuMap.get(`${pid}`) ?? 0;
      return Number.isFinite(wpu) && wpu > 0 ? wpu : 0;
    };

    type Row = { productId: number; productName: string; category: string; unit: string; totalQty: number; stockQty: number; diffQty: number; customerSet: Set<number>; customerNames: string[]; allProductStock: Array<{ unit: string; qty: number }>; demandByUnit: Array<{ unit: string; qty: number }> };

    // Agrupar líneas por PRODUCTO
    const byProduct = new Map<number, typeof resolvedItems>();
    for (const item of resolvedItems) {
      const pid = item.productId as number;
      if (!byProduct.has(pid)) byProduct.set(pid, []);
      byProduct.get(pid)!.push(item);
    }

    const rowMap = new Map<number, Row>();
    for (const [pid, lines] of byProduct) {
      const demandByUnitMap = new Map<string, number>();   // unidad de pedido → qty (informativo)
      const customerSet = new Set<number>();
      const packageBaseDemand = new Map<string, number>(); // envase canónico → demanda en base
      const baseDemand = new Map<string, number>();        // unidad base canónica → qty
      let totalDemandBase = 0;
      for (const item of lines) {
        const qty = item.quantity ? parseFloat(item.quantity as string) : 0;
        const canon = dbEnumToCanonical(item.unit as string);
        demandByUnitMap.set(item.unit, (demandByUnitMap.get(item.unit) ?? 0) + qty);
        const cid = orderCustomerMap.get(item.orderId);
        if (cid !== undefined) customerSet.add(cid);
        if (PACKAGE_UNITS.includes(canon)) {
          const wpu = wpuForUnit(pid, canon);
          // guard: si no hay wpu confiable, sumar crudo (no rompe; no infla con NaN)
          const baseQty = wpu > 0 ? qty * wpu : qty;
          totalDemandBase += baseQty;
          packageBaseDemand.set(canon, (packageBaseDemand.get(canon) ?? 0) + baseQty);
        } else {
          totalDemandBase += qty;
          baseDemand.set(canon, (baseDemand.get(canon) ?? 0) + qty);
        }
      }
      // Unidad de compra: el envase de mayor demanda si se pidió en envase; si no, la base más pedida.
      let buyUnit: string;
      if (packageBaseDemand.size > 0) buyUnit = [...packageBaseDemand.entries()].sort((a, b) => b[1] - a[1])[0][0];
      else if (baseDemand.size > 0) buyUnit = [...baseDemand.entries()].sort((a, b) => b[1] - a[1])[0][0];
      else buyUnit = dbEnumToCanonical(lines[0].unit as string);
      const wpuBuy = wpuForUnit(pid, buyUnit) || 1; // base → 1; envase → wpu (>0); guard → 1
      const stockBase = baseStockMap.get(pid) ?? 0;
      const totalQty = totalDemandBase / wpuBuy;  // demanda total en unidad de compra
      const stockQty = stockBase / wpuBuy;        // stock en unidad de compra (restado UNA sola vez)
      rowMap.set(pid, {
        productId: pid,
        productName: productNameMap.get(pid) ?? "?",
        category: productCategoryMap.get(pid) ?? "",
        unit: buyUnit,
        totalQty, stockQty, diffQty: stockQty - totalQty,
        customerSet, customerNames: [],
        allProductStock: productAllStock.get(pid) ?? [],
        demandByUnit: [...demandByUnitMap.entries()].map(([unit, qty]) => ({ unit, qty })),
      });
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
      allProductStock: r.allProductStock,
      demandByUnit: r.demandByUnit,
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
    const puConditions: any[] = [eq(productUnits.isActive, true), eq(products.active, true)];
    if (onlyInStock) puConditions.push(drizzleSql`${productUnits.stockQty} > 0`);

    // Single JOIN query instead of N+1 parallel queries
    const rows = await db.select({ pu: productUnits, product: products })
      .from(productUnits)
      .innerJoin(products, eq(productUnits.productId, products.id))
      .where(and(...puConditions));

    const PACKAGE_UNITS = new Set(['CAJON', 'BOLSA', 'BANDEJA']);
    return rows
      .filter((r) => {
        if (PACKAGE_UNITS.has(r.pu.unit)) return false;
        if (filters?.category && r.product.category !== filters.category) return false;
        if (filters?.search && !r.product.name.toUpperCase().includes(filters.search.toUpperCase())) return false;
        return true;
      })
      .map((r) => ({ ...r.pu, product: r.product }))
      .sort((a, b) => a.product.name.localeCompare(b.product.name));
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

  async adjustProductUnitStock(id: number, adjustment: number, notes?: string, avgCost?: number, weightPerUnit?: number): Promise<ProductUnit> {
    const [pu] = await db.select().from(productUnits).where(eq(productUnits.id, id)).limit(1);
    if (!pu) throw new Error("ProductUnit not found");

    let updated = pu;

    // Actualizar weightPerUnit si se especificó (independiente del adjustment)
    if (weightPerUnit !== undefined && weightPerUnit >= 0) {
      await db.update(productUnits)
        .set({ weightPerUnit: weightPerUnit.toFixed(4) })
        .where(eq(productUnits.id, id));
    }

    if (adjustment !== 0) {
      const newStock = parseFloat(pu.stockQty as string) + adjustment;
      const updateFields: Record<string, any> = { stockQty: newStock.toFixed(4) };
      if (avgCost !== undefined) updateFields.avgCost = avgCost.toFixed(4);
      [updated] = await db.update(productUnits).set(updateFields).where(eq(productUnits.id, id)).returning();
      // Sync products.currentStock
      const allPu = await db.select().from(productUnits).where(eq(productUnits.productId, pu.productId));
      const totalStock = allPu.reduce((s, p) => s + parseFloat(p.stockQty as string), 0);
      await db.update(products).set({ currentStock: totalStock.toFixed(4) }).where(eq(products.id, pu.productId));
      // Record in stock_movements
      await db.insert(stockMovements).values({
        productId: pu.productId,
        movementType: adjustment >= 0 ? "in" : "out",
        quantity: Math.abs(adjustment).toFixed(4),
        unitCost: (avgCost !== undefined ? avgCost : parseFloat(pu.avgCost as string)).toFixed(4),
        referenceType: "adjustment",
        referenceId: pu.id,
        notes: notes ?? null,
      });
    } else if (avgCost !== undefined) {
      // Cost-only update: no movement recorded
      [updated] = await db.update(productUnits)
        .set({ avgCost: avgCost.toFixed(4) })
        .where(eq(productUnits.id, id))
        .returning();
    }

    // Sync products.averageCost if cost was updated
    if (avgCost !== undefined) {
      const allPu = await db.select().from(productUnits).where(eq(productUnits.productId, pu.productId));
      const totalStockForAvg = allPu.reduce((s, p) => s + parseFloat(p.stockQty as string), 0);
      const weightedCost = totalStockForAvg > 0
        ? allPu.reduce((s, p) => s + parseFloat(p.stockQty as string) * parseFloat(p.avgCost as string), 0) / totalStockForAvg
        : avgCost;
      await db.update(products).set({ averageCost: weightedCost.toFixed(4) }).where(eq(products.id, pu.productId));
    }

    return updated;
  },

  // Revierte (total o parcial) un ajuste de Merma/Rinde, limitado a hoy/ayer.
  // Atómico. No toca fórmulas: reduce/marca el movimiento original (los totales se recalculan en vivo)
  // y corrige el stock guardado (product_units + products). Registra un movimiento de auditoría neutro.
  async revertStockAdjustment(movementId: number, qtyToRevert: number, userId?: number): Promise<{ ok: boolean }> {
    return db.transaction(async (tx) => {
      const [mv] = await tx.select().from(stockMovements)
        .where(and(eq(stockMovements.id, movementId), eq(stockMovements.referenceType, "adjustment")))
        .limit(1);
      if (!mv) throw new Error("Ajuste no encontrado");
      const note = mv.notes ?? "";
      if (note !== "Merma" && note !== "Rinde") throw new Error("Solo se pueden revertir ajustes de Merma o Rinde");

      // Límite hoy/ayer (fecha del servidor)
      const g = await tx.execute(drizzleSql`SELECT (created_at::date >= CURRENT_DATE - 1) AS ok FROM stock_movements WHERE id = ${movementId}`);
      if (!(g.rows[0] as any)?.ok) throw new Error("Solo se pueden revertir ajustes de hoy o ayer");

      const origQty = parseFloat(mv.quantity as string);
      if (!(qtyToRevert > 0)) throw new Error("La cantidad a revertir debe ser mayor a 0");
      if (qtyToRevert > origQty + 1e-6) throw new Error(`No se puede revertir más que la cantidad original (${origQty.toFixed(2)})`);
      const qty = Math.min(qtyToRevert, origQty);

      const puId = mv.referenceId as number;
      const [pu] = await tx.select().from(productUnits).where(eq(productUnits.id, puId)).limit(1);
      if (!pu) throw new Error("Unidad de stock del ajuste no encontrada");
      const currentStock = parseFloat(pu.stockQty as string);
      const isMerma = note === "Merma"; // movimiento 'out' (bajó stock)

      // Revertir un Rinde saca stock → validar que alcance. Revertir una Merma siempre es seguro.
      if (!isMerma && currentStock < qty - 1e-6) {
        throw new Error("No se puede revertir: la mercadería del rinde ya se usó/vendió (stock insuficiente)");
      }

      // 1) Corregir el stock real
      const newStock = isMerma ? currentStock + qty : currentStock - qty;
      await tx.update(productUnits)
        .set({ stockQty: Math.max(0, newStock).toFixed(4), isActive: true })
        .where(eq(productUnits.id, puId));
      const allPu = await tx.select().from(productUnits).where(eq(productUnits.productId, mv.productId));
      const totalStock = allPu.reduce((s, p) => s + parseFloat(p.stockQty as string), 0);
      await tx.update(products).set({ currentStock: totalStock.toFixed(4) }).where(eq(products.id, mv.productId));

      // 2) Reducir / marcar el ajuste original (sin tocar fórmulas — los totales son en vivo)
      const remaining = origQty - qty;
      if (remaining <= 1e-6) {
        // Total: notes sin %Merma%/%Rinde% → sale de TODOS los totales. El tipo se infiere de movement_type.
        await tx.update(stockMovements).set({ notes: "REVERTIDO" }).where(eq(stockMovements.id, movementId));
      } else {
        await tx.update(stockMovements).set({ quantity: remaining.toFixed(4) }).where(eq(stockMovements.id, movementId));
      }

      // 3) Auditoría: movimiento neutro (no matchea Merma/Rinde, no impacta ningún total)
      const [prod] = await tx.select({ name: products.name }).from(products).where(eq(products.id, mv.productId)).limit(1);
      await tx.insert(stockMovements).values({
        productId: mv.productId,
        movementType: isMerma ? "in" : "out",
        quantity: qty.toFixed(4),
        unitCost: mv.unitCost as string,
        referenceType: "adjustment",
        referenceId: puId,
        notes: `Reversión — ${prod?.name ?? ""} (${qty.toFixed(2)} de ${origQty.toFixed(2)})`,
        createdBy: userId ?? null,
      });

      return { ok: true };
    });
  },

  async resetAllStock(asMerma: boolean): Promise<{ affected: number }> {
    const allPu = await db.select().from(productUnits)
      .where(drizzleSql`${productUnits.stockQty}::numeric > 0 AND ${productUnits.isActive} = true`);
    if (allPu.length === 0) return { affected: 0 };

    for (const pu of allPu) {
      const currentQty = parseFloat(pu.stockQty as string);
      if (asMerma) {
        await db.insert(stockMovements).values({
          productId: pu.productId,
          movementType: "out",
          quantity: currentQty.toFixed(4),
          unitCost: pu.avgCost as string,
          referenceType: "adjustment",
          referenceId: pu.id,
          notes: "Merma",
        });
      }
      await db.update(productUnits).set({ stockQty: "0" }).where(eq(productUnits.id, pu.id));
      await db.update(products).set({ currentStock: "0" }).where(eq(products.id, pu.productId));
    }
    return { affected: allPu.length };
  },

  // [ELIMINADO 2026-06] recalcAllStockCosts (botón "Recalcular Costos"): corría un WMA
  // sobre stock_movements, un ledger inconsistente (mezcla kg base de compras con bultos
  // de ventas) → divergía hasta ±29% del FIFO oficial y podía corromper el costo de casi
  // todo el catálogo de un click. El modelo de costo único del sistema es FIFO
  // (_recomputeCostFromStock), que NO usa el ledger. Ver AUDITORIA-COSTOS.md.

  // ─── Stock check pre-aprobación ──────────────────────────────────────────────
  // Retorna ítems del pedido con stock insuficiente y los datos necesarios para
  // que el frontend muestre el dialog de decisión.
  async checkOrderStock(orderId: number): Promise<{
    itemId: number;
    productId: number;
    productName: string;
    orderedQty: number;
    orderedUnit: string;
    orderedQtyBase: number;
    availableQtyBase: number;
    availableQtyDisplay: number;
    wpu: number;
    status: "zero" | "insufficient";
    knownCostBase: number;
  }[]> {
    const order = await this.getOrder(orderId);
    if (!order) throw new Error("Order not found");

    const issues: Awaited<ReturnType<typeof this.checkOrderStock>> = [];

    for (const item of order.items) {
      if (!item.productId) continue;
      if (['bolsa', 'bolsa_propia'].includes((item as any).bolsaType)) continue;

      const qty = parseFloat(item.quantity as string);
      const oiCanonical = dbEnumToCanonical(item.unit as string);

      // Buscar fila base (modelo nuevo) — prioridad: (1) tiene stock, (2) exact match, (3) más stock.
      // Evita que MAPLE(stock=0) gane sobre UNIDAD(stock=36) cuando el pedido es MAPLE.
      const [baseUnitPu] = await db.select().from(productUnits)
        .where(and(
          eq(productUnits.productId, item.productId),
          drizzleSql`${productUnits.baseUnit} IS NOT NULL`,
          drizzleSql`${productUnits.unit} NOT IN ('CAJON','BOLSA','BANDEJA')`,
        ))
        .orderBy(
          drizzleSql`CASE WHEN ${productUnits.stockQty}::numeric > 0 THEN 0 ELSE 1 END`,
          drizzleSql`CASE WHEN ${productUnits.unit} = ${oiCanonical} THEN 0 ELSE 1 END`,
          drizzleSql`${productUnits.stockQty}::numeric DESC`,
        )
        .limit(1);

      let deductQtyBase = qty;
      let wpu = 0;
      let stockQtyBase = 0;

      if (baseUnitPu) {
        stockQtyBase = parseFloat(baseUnitPu.stockQty as string);
        if (oiCanonical !== baseUnitPu.unit && ['CAJON', 'BOLSA', 'BANDEJA'].includes(oiCanonical)) {
          const [recentPi] = await db.select({ weightPerPackage: purchaseItems.weightPerPackage })
            .from(purchaseItems)
            .where(and(eq(purchaseItems.productId, item.productId as number), eq(purchaseItems.purchaseUnit, oiCanonical as any)))
            .orderBy(desc(purchaseItems.id))
            .limit(1);
          wpu = recentPi?.weightPerPackage
            ? parseFloat(recentPi.weightPerPackage as string)
            : parseFloat(baseUnitPu.weightPerUnit as string ?? "0");
          if (wpu === 0) {
            const [anyPi] = await db.select({ weightPerPackage: purchaseItems.weightPerPackage })
              .from(purchaseItems)
              .where(and(
                eq(purchaseItems.productId, item.productId as number),
                drizzleSql`${purchaseItems.weightPerPackage}::numeric > 0`,
              ))
              .orderBy(desc(purchaseItems.id))
              .limit(1);
            wpu = parseFloat(anyPi?.weightPerPackage as string ?? "0");
          }
          // Huevos: 1 CAJON = 12 MAPLES siempre (constante universal)
          if (wpu === 0 && baseUnitPu.unit === "MAPLE") wpu = 12;
          deductQtyBase = qty * (wpu > 0 ? wpu : 1);
        }
      } else {
        // Modelo antiguo
        const [oldPu] = await db.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, oiCanonical)))
          .limit(1);
        stockQtyBase = oldPu ? parseFloat(oldPu.stockQty as string) : 0;
      }

      if (stockQtyBase >= deductQtyBase) continue; // stock suficiente

      const knownCostStr = await this._getCostForUnit(item.productId, oiCanonical, db, true);
      const knownCostBase = parseFloat(knownCostStr);
      const availableQtyDisplay = wpu > 0 ? stockQtyBase / wpu : stockQtyBase;

      issues.push({
        itemId: item.id,
        productId: item.productId,
        productName: (item as any).product?.name ?? "Producto",
        orderedQty: qty,
        orderedUnit: oiCanonical,
        orderedQtyBase: deductQtyBase,
        availableQtyBase: stockQtyBase,
        availableQtyDisplay,
        wpu,
        status: stockQtyBase <= 0 ? "zero" : "insufficient",
        knownCostBase,
      });
    }

    return issues;
  },

  async getProductPurchaseHistory(productId: number, limit = 10) {
    const rows = await db
      .select({
        purchaseDate: purchases.purchaseDate,
        supplierName: purchases.supplierName,
        purchaseQty: purchaseItems.purchaseQty,
        purchaseUnit: purchaseItems.purchaseUnit,
        weightPerPackage: purchaseItems.weightPerPackage,
        quantity: purchaseItems.quantity,
        costPerUnit: purchaseItems.costPerUnit,
        costPerPurchaseUnit: purchaseItems.costPerPurchaseUnit,
      })
      .from(purchaseItems)
      .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
      .where(eq(purchaseItems.productId, productId))
      .orderBy(desc(purchases.purchaseDate), desc(purchases.id))
      .limit(limit);
    return rows;
  },

  // ─── GALPÓN (solo lectura, SIN costos) ───────────────────────────────────────
  // REGLA DE ORO: estos SELECT NUNCA incluyen avg_cost, cost_per_unit, ni ninguna
  // columna de costo/precio. Los costos no salen del servidor para el rol galpón.
  async getGalponStock(): Promise<{ productId: number; productName: string; category: string | null; unit: string; stockQty: string; weightPerUnit: string | null }[]> {
    const PACKAGE_UNITS = new Set(['CAJON', 'BOLSA', 'BANDEJA']);
    const rows = await db.select({
      productId: productUnits.productId,
      productName: products.name,
      category: products.category,
      unit: productUnits.unit,
      stockQty: productUnits.stockQty,
      weightPerUnit: productUnits.weightPerUnit,
    })
      .from(productUnits)
      .innerJoin(products, eq(productUnits.productId, products.id))
      .where(and(
        eq(productUnits.isActive, true),
        eq(products.active, true),
        drizzleSql`${productUnits.stockQty} > 0`,
      ));
    return rows
      .filter((r) => !PACKAGE_UNITS.has(r.unit))
      .sort((a, b) => a.productName.localeCompare(b.productName));
  },

  // Últimas compras de un producto SIN precios (para la vista galpón)
  async getGalponProductPurchaseHistory(productId: number, limit = 10): Promise<{ itemId: number; purchaseDate: Date; supplierName: string; purchaseQty: string | null; purchaseUnit: string | null; weightPerPackage: string | null; quantity: string }[]> {
    return db.select({
      itemId: purchaseItems.id,
      purchaseDate: purchases.purchaseDate,
      supplierName: purchases.supplierName,
      purchaseQty: purchaseItems.purchaseQty,
      purchaseUnit: purchaseItems.purchaseUnit,
      weightPerPackage: purchaseItems.weightPerPackage,
      quantity: purchaseItems.quantity,
    })
      .from(purchaseItems)
      .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
      .where(eq(purchaseItems.productId, productId))
      .orderBy(desc(purchases.purchaseDate), desc(purchases.id))
      .limit(limit);
  },

  // Último weight_per_package usado para un producto + proveedor (sugerencia de compra).
  // Devuelve null si no hay compras previas de esa combinación.
  async getLastWeightForProductSupplier(productId: number, supplierId: number): Promise<number | null> {
    const [row] = await db
      .select({ wpp: purchaseItems.weightPerPackage })
      .from(purchaseItems)
      .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
      .where(and(
        eq(purchaseItems.productId, productId),
        eq(purchases.supplierId, supplierId),
        drizzleSql`${purchaseItems.weightPerPackage} IS NOT NULL`,
        drizzleSql`${purchaseItems.weightPerPackage}::numeric > 0`,
      ))
      .orderBy(desc(purchases.purchaseDate), desc(purchaseItems.id))
      .limit(1);
    return row?.wpp != null ? parseFloat(row.wpp as string) : null;
  },

  // Corregir el peso por envase (weight_per_package) de UNA línea de compra.
  // Enfoque TARGETED y seguro (NO usa updatePurchase, que tiene el bug de piso-en-0 al
  // revertir y además cambia el id del item): aplica el DELTA exacto de stock, recalcula
  // el costo por kg de esa línea (precio del envase fijo) y recomputa el costo del producto
  // (FIFO). Mantiene el mismo id de la línea. SOLO toca el peso, nada de precios/cantidades.
  async galponSetPurchaseItemWeight(itemId: number, newWeight: number, userId?: number): Promise<{ ok: true; weightPerPackage: number }> {
    if (!(newWeight > 0)) throw new Error("Peso inválido");
    return db.transaction(async (tx) => {
      const [item] = await tx.select().from(purchaseItems).where(eq(purchaseItems.id, itemId)).for('update').limit(1);
      if (!item) throw new Error("Línea de compra no encontrada");
      if (!item.purchaseUnit || item.purchaseQty == null) throw new Error("Esta línea no es por envase (cajón/bolsa); no tiene peso por envase");

      // Lock del producto para serializar con compras/aprobaciones concurrentes
      await tx.select({ id: products.id }).from(products).where(eq(products.id, item.productId)).for('update').limit(1);

      const pq = parseFloat(item.purchaseQty as string);
      const oldQty = parseFloat(item.quantity as string);
      const oldCost = parseFloat(item.costPerUnit as string); // costo/u de la línea ANTES de corregir (para des-mezclar el WMA)
      // Precio del envase (cost_per_purchase_unit) NO cambia. Si faltara, se deriva.
      const cpp = item.costPerPurchaseUnit != null
        ? parseFloat(item.costPerPurchaseUnit as string)
        : parseFloat(item.costPerUnit as string) * parseFloat((item.weightPerPackage as string) ?? "0");
      const newQty = pq * newWeight;
      const newCost = cpp / newWeight;
      const deltaQty = newQty - oldQty;
      const canonicalUnit = dbEnumToCanonical(item.unit as any);

      // 1) La línea de compra (mismo id)
      await tx.update(purchaseItems).set({
        quantity: newQty.toFixed(4),
        costPerUnit: newCost.toFixed(4),
        weightPerPackage: newWeight.toFixed(4),
        costPerPurchaseUnit: cpp.toFixed(2),
        // subtotal = cpp × purchase_qty → no cambia
      }).where(eq(purchaseItems.id, itemId));

      // 2) Movimiento de stock de esa compra (log de auditoría; el costo lo da el FIFO, no el ledger)
      await tx.update(stockMovements).set({
        quantity: newQty.toFixed(4),
        unitCost: newCost.toFixed(4),
      }).where(and(
        eq(stockMovements.referenceType, "purchase"),
        eq(stockMovements.referenceId, item.purchaseId),
        eq(stockMovements.productId, item.productId),
      ));

      // 3) Stock actual: aplicar SOLO el delta y recalcular el costo con PROMEDIO PONDERADO
      //    MÓVIL (WMA). Política (AUDITORIA-COSTOS.md §17): des-mezcla la línea vieja y mezcla
      //    la corregida; si stock < oldQty (mercadería ya vendida) o el dato es inconsistente,
      //    deja el costo como está. Nunca rompe ni da negativo.
      const [pu] = await tx.select().from(productUnits)
        .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
        .for('update').limit(1);
      if (pu) {
        const stock = parseFloat(pu.stockQty as string);
        const avg = parseFloat(pu.avgCost as string);
        const ns = Math.max(0, stock + deltaQty);
        const EPS = 1e-6;
        let newAvg = avg;                                   // default: conservar (cubre el caso borde)
        const exLine = stock - oldQty;                      // stock SIN esta línea
        if (exLine > EPS) {
          const preCost = (stock * avg - oldQty * oldCost) / exLine; // costo del stock sin esta línea
          if (preCost >= 0) {
            const newStock = exLine + newQty;
            if (newStock > EPS) newAvg = (preCost * exLine + newQty * newCost) / newStock;
          }
        } else if (exLine > -EPS) {
          newAvg = newCost;                                 // todo el stock es esta línea → costo corregido
        } // else stock < oldQty (ya vendido) → conservar avg
        await tx.update(productUnits)
          .set({ stockQty: ns.toFixed(4), avgCost: newAvg.toFixed(4) })
          .where(eq(productUnits.id, pu.id));
      }

      // 4) Propagar el costo (WMA, seteado arriba) a products via _recalcProductSummary, y
      //    recomputar el peso por envase (independiente del costo). NO se pisa con FIFO.
      await this._recalcProductSummary(item.productId, tx);
      await this._recomputeWeightPerUnitFromStock(item.productId, tx);

      // 5) Movimiento de AUDITORÍA (solo RASTRO; NO mueve stock ni costo — eso ya lo hizo el
      //    targeted via product_units arriba). Es un registro para el historial de ajustes.
      //    Como el stock/costo salen de product_units (no de sumar movimientos), insertar este
      //    log NO genera doble descuento ni recalcula nada.
      const [prodRow] = await tx.select({ name: products.name }).from(products).where(eq(products.id, item.productId)).limit(1);
      const oldWeight = parseFloat(item.weightPerPackage as string ?? "0");
      await tx.insert(stockMovements).values({
        productId: item.productId,
        movementType: deltaQty < 0 ? "out" : "in",
        quantity: Math.abs(deltaQty).toFixed(4),
        unitCost: newCost.toFixed(4),
        referenceType: "adjustment",
        referenceId: itemId, // purchase_item id → permite "deshacer" (volver al peso anterior)
        notes: `Ajuste peso galpón: ${prodRow?.name ?? ""} ${item.purchaseUnit} ${oldWeight}→${newWeight}kg (Δ ${deltaQty >= 0 ? "+" : ""}${deltaQty.toFixed(2)} kg)`,
        createdBy: userId ?? null,
      });

      return { ok: true, weightPerPackage: newWeight };
    });
  },

  // ─── GALPÓN: Pedidos (SIN dinero) ────────────────────────────────────────────
  // REGLA DE ORO: estos SELECT NUNCA incluyen price_per_unit, cost_per_unit, margin,
  // subtotal ni total. Solo cliente, producto, cantidad, unidad, estado y el flag galpón.
  async getGalponOrders(date?: string): Promise<any[]> {
    const dateCond = date ? drizzleSql`WHERE o.order_date::date = ${date}::date` : drizzleSql``;
    const rows: any = await db.execute(drizzleSql`
      SELECT o.id, o.folio, o.remito_num AS "remitoNum", o.order_date AS "orderDate", o.status,
             o.galpon_confirmed AS "galponConfirmed",
             c.name AS "customerName",
             u.name AS "createdByName",
             (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS "itemCount"
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN users u ON u.id = o.created_by
      ${dateCond}
      ORDER BY o.created_at DESC
    `);
    return rows.rows ?? rows;
  },

  async getGalponOrder(id: number): Promise<any | undefined> {
    const ordRes: any = await db.execute(drizzleSql`
      SELECT o.id, o.folio, o.remito_num AS "remitoNum", o.order_date AS "orderDate", o.status, o.notes,
             o.galpon_confirmed AS "galponConfirmed",
             c.name AS "customerName", c.address, c.city, c.phone,
             u.name AS "createdByName"
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN users u ON u.id = o.created_by
      WHERE o.id = ${id}
    `);
    const order = (ordRes.rows ?? ordRes)[0];
    if (!order) return undefined;
    const itemsRes: any = await db.execute(drizzleSql`
      SELECT oi.id, oi.product_id AS "productId", oi.quantity, oi.unit,
             COALESCE(p.name, oi.raw_product_name) AS "productName"
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ${id}
      ORDER BY oi.id
    `);
    return { ...order, items: itemsRes.rows ?? itemsRes };
  },

  // Lista de productos para el selector del galpón (SIN costo)
  async getGalponProducts(): Promise<{ id: number; name: string; unit: string; category: string | null }[]> {
    const rows = await db.select({ id: products.id, name: products.name, unit: products.unit, category: products.category })
      .from(products).where(eq(products.active, true)).orderBy(asc(products.name));
    return rows as any;
  },

  async confirmGalponOrder(id: number, userId: number): Promise<{ id: number; galponConfirmed: boolean }> {
    const res: any = await db.execute(drizzleSql`
      UPDATE orders SET galpon_confirmed = true, galpon_confirmed_at = NOW(), galpon_confirmed_by = ${userId}
      WHERE id = ${id}
      RETURNING id, galpon_confirmed AS "galponConfirmed"
    `);
    return (res.rows ?? res)[0];
  },

  // ── Helper: peso por envase para CAJON/BOLSA/BANDEJA ─────────────────────────
  // Busca el weightPerPackage de la última compra con ese purchaseUnit para el producto.
  // Si no encuentra (o es 0), cae al fallback (weightPerUnit del row base).
  async _resolveWpu(productId: number, packageUnit: string, fallbackWpu: number): Promise<number> {
    const [lastPi] = await db
      .select({ weightPerPackage: purchaseItems.weightPerPackage })
      .from(purchaseItems)
      .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
      .where(and(
        eq(purchaseItems.productId, productId),
        drizzleSql`${purchaseItems.purchaseUnit}::text = ${packageUnit}`,
      ))
      .orderBy(desc(purchases.purchaseDate))
      .limit(1);
    const wpu = parseFloat(lastPi?.weightPerPackage as string ?? '0');
    if (wpu > 0) return wpu;
    if (fallbackWpu > 0) return fallbackWpu;
    // Fallback para datos viejos sin purchaseUnit: buscar cualquier compra con weightPerPackage > 0
    const [anyPi] = await db
      .select({ weightPerPackage: purchaseItems.weightPerPackage })
      .from(purchaseItems)
      .where(and(
        eq(purchaseItems.productId, productId),
        drizzleSql`${purchaseItems.weightPerPackage}::numeric > 0`,
      ))
      .orderBy(desc(purchaseItems.id))
      .limit(1);
    return parseFloat(anyPi?.weightPerPackage as string ?? '0');
  },

  async addStockAdjustments(items: { productId: number; unit: string; qty: number }[]): Promise<void> {
    const PACKAGE_UNITS = new Set(['CAJON', 'BOLSA', 'BANDEJA']);

    for (const item of items) {
      const canonicalUnit = item.unit.trim().toUpperCase();

      if (PACKAGE_UNITS.has(canonicalUnit)) {
        // Package unit (CAJON/BOLSA/BANDEJA): convert to base unit row
        const [baseUnitPu] = await db.select().from(productUnits)
          .where(and(
            eq(productUnits.productId, item.productId),
            drizzleSql`${productUnits.baseUnit} IS NOT NULL`,
          ))
          .limit(1);

        if (baseUnitPu) {
          // Use weightPerPackage from the last purchase (most precise), fallback to stored average
          const fallback = parseFloat(baseUnitPu.weightPerUnit as string ?? '0');
          const wpu = await this._resolveWpu(item.productId, canonicalUnit, fallback);
          const addQty = wpu > 0 ? item.qty * wpu : item.qty;
          const newStock = parseFloat(baseUnitPu.stockQty as string) + addQty;
          const updateSet: Record<string, any> = { stockQty: newStock.toFixed(4), isActive: true };
          // Persistir wpu si el row no lo tenía (para que futuras ventas en CAJON resuelvan el costo)
          if (wpu > 0 && parseFloat(baseUnitPu.weightPerUnit as string ?? '0') === 0) {
            updateSet.weightPerUnit = wpu.toFixed(4);
          }
          await db.update(productUnits)
            .set(updateSet)
            .where(eq(productUnits.id, baseUnitPu.id));
        } else {
          // No base unit row: create a KG row and add qty directly
          const [existingKg] = await db.select().from(productUnits)
            .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, 'KG')))
            .limit(1);
          if (existingKg) {
            const newStock = parseFloat(existingKg.stockQty as string) + item.qty;
            await db.update(productUnits)
              .set({ stockQty: newStock.toFixed(4), isActive: true, baseUnit: 'KG' })
              .where(eq(productUnits.id, existingKg.id));
          } else {
            await db.insert(productUnits).values({
              productId: item.productId,
              unit: 'KG',
              avgCost: '0',
              stockQty: item.qty.toFixed(4),
              isActive: true,
              baseUnit: 'KG',
            });
          }
        }
      } else {
        // Base unit (KG/UNIDAD/ATADO/MAPLE/etc.): upsert and set baseUnit
        const [existing] = await db.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
          .limit(1);
        if (existing) {
          const newStock = parseFloat(existing.stockQty as string) + item.qty;
          await db.update(productUnits)
            .set({ stockQty: newStock.toFixed(4), isActive: true, baseUnit: canonicalUnit })
            .where(eq(productUnits.id, existing.id));
        } else {
          await db.insert(productUnits).values({
            productId: item.productId,
            unit: canonicalUnit,
            avgCost: '0',
            stockQty: item.qty.toFixed(4),
            isActive: true,
            baseUnit: canonicalUnit,
          });
        }
      }

      const allPu = await db.select().from(productUnits).where(eq(productUnits.productId, item.productId));
      const totalStock = allPu.reduce((s, p) => s + parseFloat(p.stockQty as string), 0);
      await db.update(products).set({ currentStock: totalStock.toFixed(4) }).where(eq(products.id, item.productId));
    }
  },

  // Reemplaza el stock de cada item al valor exacto indicado.
  // mode="merma_rinde": registra movimientos (Merma si baja, Rinde si sube)
  // mode="correction": solo actualiza el valor sin registrar movimientos
  async setStockAdjustments(
    items: { productId: number; unit: string; qty: number }[],
    mode: "merma_rinde" | "correction",
    userId?: number,
  ): Promise<void> {
    const PACKAGE_UNITS = new Set(['CAJON', 'BOLSA', 'BANDEJA']);

    // ── Step 1: resolve each input item to its base-unit product_units row ──────
    type Resolved = { productId: number; puId: number; targetQty: number; currentQty: number; currentAvgCost: string };
    const resolved: Resolved[] = [];
    const listedPuIds = new Set<number>();

    for (const item of items) {
      const canonicalUnit = item.unit.trim().toUpperCase();
      let targetQty = item.qty;
      let pu: typeof productUnits.$inferSelect | undefined;

      if (PACKAGE_UNITS.has(canonicalUnit)) {
        // CAJON/BOLSA/BANDEJA → find base unit row and convert qty
        // Excluir CAJON/BOLSA/BANDEJA para evitar rows del modelo antiguo mal marcados
        const [baseRow] = await db.select().from(productUnits)
          .where(and(
            eq(productUnits.productId, item.productId),
            drizzleSql`${productUnits.baseUnit} IS NOT NULL`,
            drizzleSql`${productUnits.unit} NOT IN ('CAJON','BOLSA','BANDEJA')`,
          ))
          .limit(1);
        if (baseRow) {
          const fallback = parseFloat(baseRow.weightPerUnit as string ?? '0');
          const wpu = await this._resolveWpu(item.productId, canonicalUnit, fallback);
          targetQty = wpu > 0 ? item.qty * wpu : item.qty;
          pu = baseRow;
        }
      } else {
        // Base unit (KG/UNIDAD/ATADO/MAPLE/etc.)
        const [existing] = await db.select().from(productUnits)
          .where(and(eq(productUnits.productId, item.productId), eq(productUnits.unit, canonicalUnit)))
          .limit(1);
        if (existing) {
          pu = existing;
        } else {
          // No row yet — look up cost from last purchase before creating
          let initCost = '0';
          const [lastPi] = await db
            .select({ costPerUnit: purchaseItems.costPerUnit })
            .from(purchaseItems)
            .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
            .where(eq(purchaseItems.productId, item.productId))
            .orderBy(desc(purchases.purchaseDate))
            .limit(1);
          if (lastPi && parseFloat(lastPi.costPerUnit as string) > 0) {
            initCost = lastPi.costPerUnit as string;
          }
          const [created] = await db.insert(productUnits).values({
            productId: item.productId, unit: canonicalUnit,
            avgCost: initCost, stockQty: targetQty.toFixed(4), isActive: true, baseUnit: canonicalUnit,
          }).returning();
          listedPuIds.add(created.id);
          resolved.push({ productId: item.productId, puId: created.id, targetQty, currentQty: 0, currentAvgCost: initCost });
          continue;
        }
      }

      if (!pu) continue;
      listedPuIds.add(pu.id);
      resolved.push({
        productId: item.productId,
        puId: pu.id,
        targetQty,
        currentQty: parseFloat(pu.stockQty as string),
        currentAvgCost: pu.avgCost as string,
      });
    }

    // ── Step 2: resolve cost for each listed item ────────────────────────────────
    // Priority: existing avgCost (if > 0), else last purchase costPerUnit (already in base unit)
    const affectedProductIds = new Set<number>();

    for (const r of resolved) {
      let resolvedCost = r.currentAvgCost;
      if (parseFloat(resolvedCost) <= 0) {
        const [lastPi] = await db
          .select({ costPerUnit: purchaseItems.costPerUnit })
          .from(purchaseItems)
          .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
          .where(eq(purchaseItems.productId, r.productId))
          .orderBy(desc(purchases.purchaseDate))
          .limit(1);
        if (lastPi && parseFloat(lastPi.costPerUnit as string) > 0) {
          resolvedCost = lastPi.costPerUnit as string;
        }
      }

      const diff = r.targetQty - r.currentQty;
      if (mode === "merma_rinde" && Math.abs(diff) > 0.0001) {
        await db.insert(stockMovements).values({
          productId: r.productId,
          movementType: diff < 0 ? "out" : "in",
          quantity: Math.abs(diff).toFixed(4),
          unitCost: resolvedCost,
          referenceType: "adjustment",
          referenceId: r.puId,
          notes: diff < 0 ? "Merma" : "Rinde",
          createdBy: userId ?? null,
        });
      }

      const setFields: Partial<typeof productUnits.$inferInsert> = { stockQty: r.targetQty.toFixed(4), isActive: true };
      if (parseFloat(r.currentAvgCost) <= 0 && parseFloat(resolvedCost) > 0) {
        setFields.avgCost = resolvedCost;
      }
      await db.update(productUnits).set(setFields).where(eq(productUnits.id, r.puId));
      affectedProductIds.add(r.productId);
    }

    // ── Step 3: zero out all other product_units rows that weren't listed ────────
    // (This is a full inventory replacement — only what was listed exists now)
    const allStockedPus = await db.select().from(productUnits)
      .where(drizzleSql`${productUnits.stockQty}::numeric > 0.0001`);

    for (const pu of allStockedPus) {
      if (listedPuIds.has(pu.id)) continue; // already handled above

      const currentQty = parseFloat(pu.stockQty as string);
      if (mode === "merma_rinde" && currentQty > 0.0001) {
        await db.insert(stockMovements).values({
          productId: pu.productId,
          movementType: "out",
          quantity: currentQty.toFixed(4),
          unitCost: pu.avgCost as string,
          referenceType: "adjustment",
          referenceId: pu.id,
          notes: "Merma",
          createdBy: userId ?? null,
        });
      }
      await db.update(productUnits).set({ stockQty: "0.0000", isActive: false }).where(eq(productUnits.id, pu.id));
      affectedProductIds.add(pu.productId);
    }

    // ── Step 4: sync products.currentStock for every affected product ────────────
    for (const productId of affectedProductIds) {
      const allPu = await db.select().from(productUnits).where(eq(productUnits.productId, productId));
      const totalStock = allPu.reduce((s, p) => s + parseFloat(p.stockQty as string), 0);
      await db.update(products).set({ currentStock: totalStock.toFixed(4) }).where(eq(products.id, productId));
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
    // Borrar los cheques recibidos vinculados a este pago (payment_id) para no dejarlos huérfanos
    // en cartera. Solo los de ESTE pago; los viejos (payment_id NULL) y los de otros pagos no se tocan.
    // deleteCheque limpia además los movimientos_cuenta del cheque (ingreso en cartera, etc.).
    const chequesDelPago = (await db.execute(drizzleSql`SELECT id FROM cheques WHERE payment_id = ${id}`)).rows as any[];
    for (const c of chequesDelPago) { await this.deleteCheque(c.id); }
    await db.delete(payments).where(eq(payments.id, id));
  },

  async updatePayment(id: number, data: { date: string; amount: string; method: string; notes?: string | null }): Promise<Payment> {
    const [updated] = await db.update(payments)
      .set({ date: data.date, amount: data.amount, method: data.method as any, notes: data.notes ?? null })
      .where(eq(payments.id, id))
      .returning();
    return updated;
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

  async linkPaymentToOrders(paymentId: number, orderIds: number[], amounts?: Map<number, number>): Promise<void> {
    if (orderIds.length === 0) return;
    await db.insert(paymentOrderLinks)
      .values(orderIds.map((oid) => ({
        paymentId,
        orderId: oid,
        amountApplied: amounts?.has(oid) ? amounts.get(oid)!.toFixed(2) : null,
      })))
      .onConflictDoNothing();
  },

  async getPendingOrdersForCustomer(customerId: number): Promise<{ id: number; folio: string; remitoNum: number | null; total: string; paidAmount: string; orderDate: string; invoiceNumber: string | null; customerId: number }[]> {
    // Incluir sucursales si este cliente es un padre
    const childRows = await db.execute(drizzleSql`
      SELECT id FROM customers WHERE parent_customer_id = ${customerId} AND active = true
    `);
    const childIds = (childRows.rows as any[]).map((r) => Number(r.id));
    const allIds = [customerId, ...childIds];
    const idArr = allIds.join(",");

    // Nuevo algoritmo: respeta vínculos explícitos (payment_order_links).
    // Los pagos con link explícito se aplican a sus remitos vinculados.
    // Los pagos sin link se aplican FIFO (más viejo primero) sobre los restantes.
    // El saldo inicial (opening_balance) reduce el pool FIFO.
    const [openingRow, paymentsLinksRows, ordersRows] = await Promise.all([
      db.execute(drizzleSql.raw(`
        SELECT COALESCE(SUM(opening_balance::numeric), 0) AS total_opening
        FROM customers WHERE id = ANY(ARRAY[${idArr}]::int[])
      `)),
      // Cada pago con los IDs de remitos a los que está vinculado (en orden de fecha)
      // y el amount_applied exacto por link (cuando está disponible)
      db.execute(drizzleSql.raw(`
        SELECT
          p.id,
          p.amount::numeric AS amount,
          STRING_AGG(CAST(pol.order_id AS text), ',' ORDER BY o.order_date, o.id)
            FILTER (WHERE pol.order_id IS NOT NULL) AS linked_ids,
          STRING_AGG(COALESCE(pol.amount_applied::text, 'N'), ',' ORDER BY o.order_date, o.id)
            FILTER (WHERE pol.order_id IS NOT NULL) AS amounts_applied
        FROM payments p
        LEFT JOIN payment_order_links pol ON pol.payment_id = p.id
        LEFT JOIN orders o ON o.id = pol.order_id
        WHERE p.customer_id = ANY(ARRAY[${idArr}]::int[])
        GROUP BY p.id, p.amount, p.date
        ORDER BY p.date, p.id
      `)),
      db.execute(drizzleSql.raw(`
        SELECT
          o.id,
          o.folio,
          o.remito_num,
          o.order_date,
          o.invoice_number,
          o.customer_id AS "customerId",
          CASE WHEN c.has_iva THEN
            COALESCE(ROUND(SUM(CASE
              WHEN oi.price_per_unit::numeric = 0 THEN 0
              ELSE oi.quantity::numeric * oi.price_per_unit::numeric * (1 + COALESCE(p.iva_rate, 0.105))
            END)), 0)
          ELSE
            COALESCE(ROUND(SUM(CASE
              WHEN oi.price_per_unit::numeric = 0 THEN 0
              ELSE oi.quantity::numeric * oi.price_per_unit::numeric
            END)), 0)
          END AS billing_total
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.customer_id = ANY(ARRAY[${idArr}]::int[])
          AND o.status = 'approved'
        GROUP BY o.id, o.folio, o.remito_num, o.order_date, o.invoice_number, c.has_iva
        ORDER BY o.order_date ASC, o.id ASC
        LIMIT 500
      `)),
    ]);

    const totalOpening = Math.round(parseFloat((openingRow.rows[0] as any).total_opening ?? "0"));

    // Mapa: orderId → total de facturación
    const orderTotalMap = new Map<number, number>();
    for (const r of ordersRows.rows as any[]) {
      orderTotalMap.set(Number(r.id), Math.round(parseFloat(r.billing_total ?? "0")));
    }

    // Crédito acumulado por remito (de pagos con link explícito)
    const creditByOrder = new Map<number, number>();
    // Pool para pagos sin vínculo (se aplican FIFO); arranca negativo por el saldo inicial
    let unlinkedPool = -totalOpening;

    for (const p of paymentsLinksRows.rows as any[]) {
      const amount = Math.round(parseFloat(p.amount ?? "0"));
      const linkedIdsStr: string | null = p.linked_ids;
      const amountsAppliedStr: string | null = p.amounts_applied;

      if (linkedIdsStr) {
        const linkedIds = linkedIdsStr.split(",").map(Number).filter((n) => !isNaN(n) && n > 0);
        const rawAmounts = amountsAppliedStr ? amountsAppliedStr.split(",") : [];
        const allKnown = rawAmounts.length === linkedIds.length && rawAmounts.every((s) => s !== "N");

        if (allKnown) {
          // Pago con montos exactos por remito: usar valores almacenados
          let totalApplied = 0;
          for (let i = 0; i < linkedIds.length; i++) {
            const orderId = linkedIds[i];
            const exactAmount = Math.round(parseFloat(rawAmounts[i]));
            if (!isNaN(exactAmount) && exactAmount > 0) {
              creditByOrder.set(orderId, (creditByOrder.get(orderId) ?? 0) + exactAmount);
              totalApplied += exactAmount;
            }
          }
          // Sobrante (si pago excedió los remitos vinculados) va al pool FIFO
          unlinkedPool += Math.max(0, amount - totalApplied);
        } else {
          // Fallback (datos históricos sin amount_applied): distribuir secuencialmente
          let remaining = amount;
          for (const orderId of linkedIds) {
            if (remaining <= 0) break;
            const orderTotal = orderTotalMap.get(orderId) ?? 0;
            const alreadyCovered = creditByOrder.get(orderId) ?? 0;
            const toApply = Math.min(remaining, Math.max(0, orderTotal - alreadyCovered));
            if (toApply > 0) {
              creditByOrder.set(orderId, alreadyCovered + toApply);
              remaining -= toApply;
            }
          }
          unlinkedPool += remaining;
        }
      } else {
        // Pago sin vínculo: va al pool FIFO
        unlinkedPool += amount;
      }
    }

    // Aplicar pool FIFO a remitos con crédito insuficiente (más viejo primero)
    for (const r of ordersRows.rows as any[]) {
      if (unlinkedPool <= 0) break;
      const orderId = Number(r.id);
      const orderTotal = orderTotalMap.get(orderId) ?? 0;
      const alreadyCovered = creditByOrder.get(orderId) ?? 0;
      const toApply = Math.min(unlinkedPool, Math.max(0, orderTotal - alreadyCovered));
      if (toApply > 0) {
        creditByOrder.set(orderId, alreadyCovered + toApply);
        unlinkedPool -= toApply;
      }
    }

    // Construir resultado: remitos donde el crédito no alcanza el total (+1 tolerancia de redondeo)
    const result: { id: number; folio: string; remitoNum: number | null; total: string; paidAmount: string; orderDate: string; invoiceNumber: string | null }[] = [];
    for (const r of ordersRows.rows as any[]) {
      const orderId = Number(r.id);
      const orderTotal = orderTotalMap.get(orderId) ?? 0;
      const covered = Math.round(creditByOrder.get(orderId) ?? 0);
      if (covered >= orderTotal - 1) continue; // totalmente cubierto
      result.push({
        id: orderId,
        folio: String(r.folio),
        remitoNum: r.remito_num != null ? Number(r.remito_num) : null,
        total: orderTotal.toFixed(2),
        paidAmount: Math.max(0, covered).toFixed(2),
        orderDate: r.order_date instanceof Date ? r.order_date.toISOString() : String(r.order_date),
        invoiceNumber: r.invoice_number ?? null,
        customerId: Number(r.customerId),
      });
    }

    return result;
  },

  // Auto-aplicar pago a pedidos pendientes del más viejo al más nuevo.
  // Acepta snapshot previo para calcular montos exactos sin interferencia del nuevo pago.
  async autoApplyPaymentToOrders(
    paymentId: number,
    customerId: number,
    paymentAmount: number,
    pendingSnapshot?: { id: number; total: string; paidAmount: string }[],
  ): Promise<void> {
    const pending = pendingSnapshot ?? await this.getPendingOrdersForCustomer(customerId);
    if (pending.length === 0) return;

    let remaining = paymentAmount;
    const toLink: number[] = [];
    const amounts = new Map<number, number>();

    for (const order of pending) {
      if (remaining <= 0) break;
      const orderRemaining = Math.max(0, parseFloat(order.total) - parseFloat(order.paidAmount));
      const toApply = Math.min(remaining, orderRemaining);
      if (toApply > 0) {
        toLink.push(order.id);
        amounts.set(order.id, toApply);
        remaining -= toApply;
      }
    }

    if (toLink.length > 0) {
      await this.linkPaymentToOrders(paymentId, toLink, amounts);
    }
  },

  async updateOrderInvoiceNumber(id: number, invoiceNumber: string | null): Promise<void> {
    await db.execute(drizzleSql`UPDATE orders SET invoice_number = ${invoiceNumber} WHERE id = ${id}`);
  },

  async updateOrderRemitoNum(id: number, remitoNum: number | null): Promise<void> {
    await db.execute(drizzleSql`UPDATE orders SET remito_num = ${remitoNum} WHERE id = ${id}`);
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
        COALESCE(p.name, oi.raw_product_name, '') AS "productName",
        COALESCE(p.category, '') AS "productCategory",
        p.iva_rate::text AS "ivaRate"
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

      const hasEverOrdered = (billingBeforeMap.get(c.id) ?? 0) !== 0 || (billingInMap.get(c.id) ?? 0) !== 0;
      const hasEverPaid = (paymentsBeforeMap.get(c.id) ?? 0) !== 0 || (paymentsInMap.get(c.id) ?? 0) !== 0;
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
        hasEverOrdered,
        hasEverPaid,
      };
    }).filter((r) =>
      // Mostrar si tiene movimiento en el período, saldo no cero,
      // o si alguna vez tuvo pedidos/pagos (aunque hoy esté en $0)
      r.saldoMesAnterior !== 0 || r.facturacion !== 0 || r.cobranza !== 0 || r.retenciones !== 0 || r.saldo !== 0
      || r.hasEverOrdered || r.hasEverPaid
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

    // Ganancia bruta (revenue with IVA minus cost)
    let gananciaMes = 0;
    for (const item of itemsInPeriod) {
      const c = customerMap.get(item.customerId);
      gananciaMes += itemProfit(item, c?.hasIva ?? false);
    }
    gananciaMes = Math.round(gananciaMes);

    // Promedios
    let promedioDia = Math.round(ventaMes / daysInMonth);
    let promedioGanancia = Math.round(gananciaMes / daysInMonth);
    let semanas = weekTotals;

    // Override gananciaMes/promedios/semanas for historical months (Jan/Feb/Mar 2026)
    const histStats = getHistoricalMonthStats(month, year);
    if (histStats) {
      gananciaMes = Math.round(histStats.ganancia_bruta);
      promedioDia = Math.round(histStats.promedioDia);
      promedioGanancia = Math.round(histStats.promedioGanancia);
      semanas = histStats.semanas.map((s) => ({ ...s, total: Math.round(s.total) }));
    }

    const margenPct = ventaMes > 0 ? (gananciaMes / ventaMes) * 100 : 0;

    return {
      month,
      year,
      daysInMonth,
      customers: rowsWithPct,
      totals,
      semanas,
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
    const [paymentsIn, paymentsBef, withholdingsIn, withholdingsBef, ordersInPeriod] = await Promise.all([
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
               o.invoice_number AS "invoiceNumber", o.customer_id AS "customerId",
               o.remito_num AS "remitoNum"
        FROM orders o
        WHERE o.customer_id = ANY(ARRAY[${idArr}]::int[])
          AND o.status = 'approved'
          AND o.order_date >= '${startDate}'::date
          AND o.order_date < '${endDate}'::date
        ORDER BY o.order_date DESC
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

    // Compute billing per order (IVA-adjusted)
    const orderBillingMap = new Map<number, number>();
    for (const item of myItemsInPeriod) {
      const cust = allCustomersMap.get(item.customerId);
      orderBillingMap.set(item.orderId, (orderBillingMap.get(item.orderId) ?? 0) + itemBilling(item, cust?.hasIva ?? c.hasIva));
    }

    // isPaid via running balance (consistente con getPendingOrdersForCustomer)
    const pendingOrders = await this.getPendingOrdersForCustomer(customerId);
    const pendingOrderIds = new Set(pendingOrders.map((o) => o.id));
    const pendingCreditByOrder = new Map(pendingOrders.map((o) => [o.id, parseFloat(o.paidAmount ?? "0")]));

    const ordersWithBilling = (ordersInPeriod.rows as any[]).map((o) => {
      const billingTotal = Math.round(orderBillingMap.get(o.id) ?? parseFloat(o.total ?? "0"));
      const isPaid = !pendingOrderIds.has(o.id);
      const paidAmount = isPaid ? billingTotal : Math.round(pendingCreditByOrder.get(o.id) ?? 0);
      return {
        id: o.id,
        folio: o.folio,
        remitoNum: o.remitoNum ?? null,
        orderDate: o.orderDate,
        total: billingTotal,
        invoiceNumber: o.invoiceNumber ?? null,
        customerId: o.customerId ?? null,
        paidAmount,
        isPaid,
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

  async getSupplierPaymentById(id: number): Promise<SupplierPayment | undefined> {
    const [p] = await db.select().from(supplierPayments).where(eq(supplierPayments.id, id)).limit(1);
    return p;
  },

  async createSupplierPayment(data: InsertSupplierPayment, userId?: number): Promise<SupplierPayment> {
    const [p] = await db.insert(supplierPayments).values({ ...data, createdBy: userId ?? null }).returning();
    return p;
  },

  async deleteSupplierPayment(id: number): Promise<void> {
    // Proveedor del pago (para recomputar is_paid tras borrar; el cascade ya limpia las imputaciones)
    const supRow = (await db.execute(drizzleSql`SELECT supplier_id AS "supplierId" FROM supplier_payments WHERE id = ${id}`)).rows[0] as any;
    const supplierId = supRow ? Number(supRow.supplierId) : null;
    // Limpiar cheques/obligaciones vinculados a este pago (sin esto quedaban huérfanos
    // y aparecían como cheques duplicados al borrar y recrear un pago con cheque).
    const linked: any = await db.execute(drizzleSql`
      SELECT id, tipo, estado, obligacion_id FROM cheques WHERE supplier_payment_id = ${id}
    `);
    for (const ch of (linked.rows ?? [])) {
      if (ch.estado === "cobrado") continue; // ya cobrado: no deshacer
      if (ch.tipo === "emitido") {
        // Cheque propio: borrar cheque + su obligación si sigue pendiente
        await db.execute(drizzleSql`DELETE FROM cheques WHERE id = ${ch.id}`);
        if (ch.obligacion_id) {
          await db.execute(drizzleSql`DELETE FROM obligaciones WHERE id = ${ch.obligacion_id} AND estado = 'pendiente'`);
        }
      } else if (ch.tipo === "recibido" && ch.estado === "endosado") {
        // Cheque de cartera endosado: revertir a en_cartera y limpiar su movimiento
        await db.execute(drizzleSql`UPDATE cheques SET estado = 'en_cartera', supplier_payment_id = NULL WHERE id = ${ch.id}`);
        await this.deleteMovimientoCuentaByOrigen("cheque_endosado", String(ch.id));
      }
    }
    await db.delete(supplierPayments).where(eq(supplierPayments.id, id)); // cascade borra las imputaciones
    // Revertir imputaciones: lo que cubría este pago vuelve a pendiente/parcial según el resto
    if (supplierId) await this._recomputeSupplierPaidFlags(supplierId);
  },

  // ─── Imputación de pagos a compras (lado proveedor, espejo de getPendingOrdersForCustomer) ────
  // Netea Σpagos contra las compras del proveedor: respeta imputaciones explícitas
  // (supplier_payment_purchase_links) y el legacy supplier_payments.purchase_id; los pagos sin
  // imputar van a un pool que se aplica FIFO (compra más vieja primero). Devuelve cada compra con
  // cuánto tiene cubierto y su estado. NO cambia Σpagos ni Σcompras → el saldo del proveedor es
  // invariante; esta función SOLO reparte la cobertura entre las compras.
  async _supplierPurchaseStates(
    supplierId: number,
    opts?: { excludePaymentId?: number },
  ): Promise<{ id: number; folio: string; purchaseDate: string; total: number; covered: number; status: "pagada" | "parcial" | "pendiente" }[]> {
    const exclude = opts?.excludePaymentId ?? 0;
    const [purchasesRows, paymentsRows] = await Promise.all([
      db.execute(drizzleSql`
        SELECT id, folio, purchase_date AS "purchaseDate", total::numeric AS total
        FROM purchases
        WHERE supplier_id = ${supplierId}
        ORDER BY purchase_date ASC, id ASC
      `),
      db.execute(drizzleSql`
        SELECT
          sp.id,
          sp.amount::numeric AS amount,
          sp.purchase_id AS "legacyPurchaseId",
          STRING_AGG(CAST(sppl.purchase_id AS text), ',' ORDER BY pu.purchase_date, pu.id)
            FILTER (WHERE sppl.purchase_id IS NOT NULL) AS linked_ids,
          STRING_AGG(COALESCE(sppl.amount_applied::text, 'N'), ',' ORDER BY pu.purchase_date, pu.id)
            FILTER (WHERE sppl.purchase_id IS NOT NULL) AS amounts_applied
        FROM supplier_payments sp
        LEFT JOIN supplier_payment_purchase_links sppl ON sppl.supplier_payment_id = sp.id
        LEFT JOIN purchases pu ON pu.id = sppl.purchase_id
        WHERE sp.supplier_id = ${supplierId} AND sp.id <> ${exclude}
        GROUP BY sp.id, sp.amount, sp.purchase_id, sp.date
        ORDER BY sp.date, sp.id
      `),
    ]);

    const purchasesList = (purchasesRows.rows as any[]).map((r) => ({
      id: Number(r.id),
      folio: String(r.folio),
      purchaseDate: r.purchaseDate instanceof Date ? r.purchaseDate.toISOString() : String(r.purchaseDate),
      total: Math.round(parseFloat(r.total ?? "0")),
    }));
    const totalById = new Map(purchasesList.map((p) => [p.id, p.total]));
    const credit = new Map<number, number>();
    let pool = 0;

    for (const p of paymentsRows.rows as any[]) {
      const amount = Math.round(parseFloat(p.amount ?? "0"));
      const linkedStr: string | null = p.linked_ids;
      const amountsStr: string | null = p.amounts_applied;
      const legacyId = p.legacyPurchaseId != null ? Number(p.legacyPurchaseId) : null;

      if (linkedStr) {
        // Pago con imputación explícita: usar amount_applied exacto cuando esté disponible
        const ids = linkedStr.split(",").map(Number).filter((n) => !isNaN(n) && n > 0);
        const raw = amountsStr ? amountsStr.split(",") : [];
        const allKnown = raw.length === ids.length && raw.every((s) => s !== "N");
        let applied = 0;
        if (allKnown) {
          for (let i = 0; i < ids.length; i++) {
            const a = Math.round(parseFloat(raw[i]));
            if (!isNaN(a) && a > 0) { credit.set(ids[i], (credit.get(ids[i]) ?? 0) + a); applied += a; }
          }
        } else {
          let rem = amount;
          for (const id of ids) {
            if (rem <= 0) break;
            const room = Math.max(0, (totalById.get(id) ?? 0) - (credit.get(id) ?? 0));
            const a = Math.min(rem, room);
            if (a > 0) { credit.set(id, (credit.get(id) ?? 0) + a); rem -= a; applied += a; }
          }
        }
        pool += Math.max(0, amount - applied); // sobrante → FIFO
      } else if (legacyId && totalById.has(legacyId)) {
        // Legacy: pago atado a una compra (puesta al día CC / auto-pago de compra contado)
        const room = Math.max(0, (totalById.get(legacyId) ?? 0) - (credit.get(legacyId) ?? 0));
        const a = Math.min(amount, room);
        if (a > 0) credit.set(legacyId, (credit.get(legacyId) ?? 0) + a);
        pool += Math.max(0, amount - a);
      } else {
        pool += amount; // pago flotante (sin imputar) → FIFO
      }
    }

    // Pool FIFO: cubrir compras más viejas primero
    for (const p of purchasesList) {
      if (pool <= 0) break;
      const room = Math.max(0, p.total - (credit.get(p.id) ?? 0));
      const a = Math.min(pool, room);
      if (a > 0) { credit.set(p.id, (credit.get(p.id) ?? 0) + a); pool -= a; }
    }

    return purchasesList.map((p) => {
      const covered = Math.round(credit.get(p.id) ?? 0);
      const status: "pagada" | "parcial" | "pendiente" =
        covered >= p.total - 1 ? "pagada" : covered > 0 ? "parcial" : "pendiente";
      return { ...p, covered, status };
    });
  },

  // Compras no saldadas del proveedor (incluye parciales), con cuánto llevan pagado. Sin filtro de
  // período (trae todas, como getPendingOrdersForCustomer) — el frontend las parte en dos secciones.
  // excludePaymentId: ignora la cobertura de ESE pago (para re-imputar un pago existente a mano —
  // muestra las compras como si ese pago no estuviera aplicado).
  async getPendingPurchasesForSupplier(supplierId: number, excludePaymentId?: number): Promise<{ id: number; folio: string; total: string; purchaseDate: string; paidAmount: string; status: string }[]> {
    const states = await this._supplierPurchaseStates(supplierId, excludePaymentId ? { excludePaymentId } : undefined);
    return states
      .filter((s) => s.status !== "pagada")
      .map((s) => ({
        id: s.id,
        folio: s.folio,
        total: s.total.toFixed(2),
        purchaseDate: s.purchaseDate,
        paidAmount: s.covered.toFixed(2),
        status: s.status,
      }));
  },

  // Imputar un pago a compras del proveedor. Si se pasan purchaseIds, reparte el monto SOLO sobre
  // esas (más vieja primero, parcial la última). Si no, FIFO sobre todas las pendientes (autoApply).
  // Escribe supplier_payment_purchase_links (parciales reales) y sincroniza el flag is_paid.
  // Idempotente: borra las imputaciones previas de ESTE pago antes de recalcular.
  async applySupplierPaymentToPurchases(
    supplierPaymentId: number,
    supplierId: number,
    amount: number,
    purchaseIds?: number[],
  ): Promise<void> {
    await db.delete(supplierPaymentPurchaseLinks).where(eq(supplierPaymentPurchaseLinks.supplierPaymentId, supplierPaymentId));

    // Cobertura por el RESTO de los pagos (excluyendo éste): repartimos sobre lo que queda libre
    const states = await this._supplierPurchaseStates(supplierId, { excludePaymentId: supplierPaymentId });
    const byId = new Map(states.map((s) => [s.id, s]));

    // Orden de imputación: si hay selección, esas compras ordenadas por fecha; si no, todas (FIFO)
    const targets = (purchaseIds && purchaseIds.length > 0)
      ? purchaseIds.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s)
          .sort((a, b) => (a.purchaseDate < b.purchaseDate ? -1 : a.purchaseDate > b.purchaseDate ? 1 : a.id - b.id))
      : states; // ya viene ordenado por fecha asc

    let remaining = Math.round(amount);
    const links: { supplierPaymentId: number; purchaseId: number; amountApplied: string }[] = [];
    for (const s of targets) {
      if (remaining <= 0) break;
      const room = Math.max(0, s.total - s.covered);
      const toApply = Math.min(remaining, room);
      if (toApply > 0) {
        links.push({ supplierPaymentId, purchaseId: s.id, amountApplied: toApply.toFixed(2) });
        remaining -= toApply;
      }
    }
    if (links.length > 0) await db.insert(supplierPaymentPurchaseLinks).values(links);
    await this._recomputeSupplierPaidFlags(supplierId);
  },

  // Quitar la imputación de un pago: borra sus supplier_payment_purchase_links → el pago queda
  // sin imputar a compras concretas (las compras que cubría vuelven a pendiente). NO borra el pago
  // (sigue bajando el saldo). Reversible: se puede re-imputar con applySupplierPaymentToPurchases.
  async clearSupplierPaymentImputation(supplierPaymentId: number): Promise<void> {
    const pay = await this.getSupplierPaymentById(supplierPaymentId);
    if (!pay) throw new Error("Pago no encontrado");
    await db.delete(supplierPaymentPurchaseLinks).where(eq(supplierPaymentPurchaseLinks.supplierPaymentId, supplierPaymentId));
    await this._recomputeSupplierPaidFlags(pay.supplierId);
  },

  // Sincroniza el flag físico purchases.is_paid con el netting (pagada = cubierta completa).
  // Mantiene correcto cualquier lugar que lea is_paid directamente.
  async _recomputeSupplierPaidFlags(supplierId: number): Promise<void> {
    const states = await this._supplierPurchaseStates(supplierId);
    const paidIds = states.filter((s) => s.status === "pagada").map((s) => s.id);
    const unpaidIds = states.filter((s) => s.status !== "pagada").map((s) => s.id);
    if (paidIds.length > 0) await db.update(purchases).set({ isPaid: true }).where(inArray(purchases.id, paidIds));
    if (unpaidIds.length > 0) await db.update(purchases).set({ isPaid: false }).where(inArray(purchases.id, unpaidIds));
  },

  // ─── AP CC Summary (resumen mensual por proveedor) ────────────────────────────

  async getAPCCSummary(fromDate: string, toDate: string) {
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

    // % de deuda: proporción del saldo de cada proveedor sobre el total adeudado (saldos positivos)
    const totalDeuda = supplierRows.reduce((s, r) => s + (r.saldo > 0 ? r.saldo : 0), 0);
    const suppliersWithPct = supplierRows
      .map((r) => ({
        ...r,
        pct: totalDeuda > 0 && r.saldo > 0 ? (r.saldo / totalDeuda) * 100 : 0,
      }))
      .sort((a, b) => b.saldo - a.saldo); // mayor saldo a menor, igual que la CC de clientes

    const totals = supplierRows.reduce(
      (acc, r) => ({
        saldoMesAnterior: acc.saldoMesAnterior + r.saldoMesAnterior,
        facturacion: acc.facturacion + r.facturacion,
        cobranza: acc.cobranza + r.cobranza,
        saldo: acc.saldo + r.saldo,
      }),
      { saldoMesAnterior: 0, facturacion: 0, cobranza: 0, saldo: 0 }
    );

    return { fromDate, toDate, suppliers: suppliersWithPct, totals };
  },

  // ─── AP CC Detail (detalle mensual de un proveedor) ───────────────────────────

  async getAPCCSupplierDetail(supplierId: number, month: number, year: number) {
    const fromDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const toDate = month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    const [supplier, purchasesPrevRows, purchasesInRows, paymentsRows, chequesRows] = await Promise.all([
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
      // Cheques emitidos a este proveedor (para el detalle + plazo)
      db.execute(drizzleSql`
        SELECT id, monto::float AS monto, fecha_cobro AS "fechaCobro",
               created_at AS "createdAt", estado, notas
        FROM cheques
        WHERE supplier_id = ${supplierId} AND tipo = 'emitido'
        ORDER BY created_at DESC
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

    // Netting: estado (pagada/parcial/pendiente) y monto pagado por compra
    const purchaseStates = await this._supplierPurchaseStates(supplierId);
    const stateById = new Map(purchaseStates.map((s) => [s.id, s]));

    const purchasesInPeriod = (purchasesInRows.rows as any[]).map((p) => {
      const total = Math.round(parseFloat(p.total ?? "0"));
      const stt = stateById.get(Number(p.id));
      const status = stt ? stt.status : (Boolean(p.isPaid) ? "pagada" : "pendiente");
      const paidAmount = stt ? stt.covered : (Boolean(p.isPaid) ? total : 0);
      return {
        id: Number(p.id),
        folio: String(p.folio),
        purchaseDate: String(p.purchaseDate),
        total,
        paymentMethod: String(p.paymentMethod ?? "cuenta_corriente"),
        isPaid: status === "pagada",
        status,        // "pagada" | "parcial" | "pendiente"
        paidAmount,    // cuánto lleva imputado (para parciales)
        totalEmptyCost: Math.round(parseFloat(p.totalEmptyCost ?? "0")),
      };
    });

    const facturacion = purchasesInPeriod.reduce((s, p) => s + p.total, 0);
    const cobranza = paymentsInPeriod.reduce((s, p) => s + Math.round(parseFloat(p.amount ?? "0")), 0);
    const saldo = saldoMesAnterior + facturacion - cobranza;

    // Cheques emitidos a este proveedor: plazo = fecha_cobro − fecha de emisión (created_at)
    const toDay = (v: any) => new Date(v).toISOString().slice(0, 10);
    const diffDays = (a: string, b: string) =>
      Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
    const emitidos = (chequesRows.rows as any[]).map((c) => {
      const fechaEmision = toDay(c.createdAt);
      const numMatch = typeof c.notas === "string" ? c.notas.match(/N[º°o]\s*([^\s,;]+)/i) : null;
      return {
        id: Number(c.id),
        numero: numMatch ? numMatch[1] : (c.notas ?? null),
        monto: Number(c.monto),
        fechaEmision,
        fechaCobro: String(c.fechaCobro),
        emisionMs: new Date(c.createdAt).getTime(),
        plazoDias: diffDays(fechaEmision, String(c.fechaCobro)),
        estado: String(c.estado),
      };
    });
    const plazoPromedioChequesDias = emitidos.length > 0
      ? Math.round(emitidos.reduce((s, c) => s + c.plazoDias, 0) / emitidos.length)
      : null;
    // Lista para la tabla de la CC, ordenada por fecha de cobro
    const cheques = emitidos
      .map(({ emisionMs, ...c }) => c)
      .sort((a, b) => (a.fechaCobro < b.fechaCobro ? -1 : a.fechaCobro > b.fechaCobro ? 1 : 0));

    // Vincular cada pago con método CHEQUE a su cheque emitido (mismo monto, emisión más cercana al pago)
    const usedCheque = new Set<number>();
    const payments = paymentsInPeriod.map((p) => {
      const base = { ...p, amount: parseFloat(p.amount ?? "0") };
      if (String(p.method ?? "").toUpperCase() !== "CHEQUE") return base;
      const payMs = new Date(p.createdAt ?? p.date).getTime();
      let bestIdx = -1, bestDelta = Infinity;
      emitidos.forEach((c, i) => {
        if (usedCheque.has(i) || Math.abs(c.monto - base.amount) > 0.5) return;
        const delta = Math.abs(c.emisionMs - payMs);
        if (delta < bestDelta) { bestDelta = delta; bestIdx = i; }
      });
      if (bestIdx < 0) return base;
      usedCheque.add(bestIdx);
      return { ...base, chequeFechaCobro: emitidos[bestIdx].fechaCobro, chequePlazoDias: emitidos[bestIdx].plazoDias };
    });

    return {
      supplier: { id: sup.id, name: sup.name, phone: sup.phone, email: sup.email, cuit: sup.cuit, ccType: sup.ccType },
      month,
      year,
      saldoMesAnterior,
      facturacion,
      cobranza,
      saldo,
      plazoPromedioChequesDias,
      cheques,
      purchases: purchasesInPeriod,
      payments,
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
    // 1) Ventas + ganancia bruta en el período (approved orders, IVA diferenciado por producto)
    const salesRow = await db.execute(drizzleSql`
      SELECT
        COALESCE(SUM(
          CASE
            WHEN oi.price_per_unit::numeric = 0 THEN 0
            WHEN c.has_iva = true THEN oi.quantity::numeric * oi.price_per_unit::numeric * (1 + COALESCE(p.iva_rate, 0.105))
            ELSE oi.quantity::numeric * oi.price_per_unit::numeric
          END
        ), 0) AS ventas,
        COALESCE(SUM(
          CASE
            WHEN oi.price_per_unit::numeric = 0 THEN 0
            WHEN c.has_iva = true THEN oi.quantity::numeric * oi.price_per_unit::numeric * (1 + COALESCE(p.iva_rate, 0.105))
            ELSE oi.quantity::numeric * oi.price_per_unit::numeric
          END
          - oi.quantity::numeric * COALESCE(oi.override_cost_per_unit, oi.cost_per_unit)::numeric
        ), 0) AS ganancia_bruta
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.status = 'approved'
        AND o.order_date >= ${from}::timestamp
        AND o.order_date < ${to}::timestamp
        AND (o.notes IS NULL OR o.notes NOT LIKE '%Facturación histórica importada%')
    `);

    // 2) Días trabajados (días con al menos 1 pedido aprobado no-histórico)
    const diasRow = await db.execute(drizzleSql`
      SELECT COUNT(DISTINCT order_date)::int AS dias_trabajados
      FROM orders
      WHERE status = 'approved'
        AND order_date >= ${from}::timestamp
        AND order_date < ${to}::timestamp
        AND (notes IS NULL OR notes NOT LIKE '%Facturación histórica importada%')
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
    // Agrego cada lado por separado para evitar join cartesiano
    const deudaRow = await db.execute(drizzleSql`
      SELECT
        COALESCE(SUM(comp.total_pendiente), 0)
          - COALESCE(SUM(pag.total_pagado), 0) AS deuda
      FROM suppliers s
      LEFT JOIN (
        SELECT supplier_id, SUM(total::numeric) AS total_pendiente
        FROM purchases
        WHERE is_paid = false OR payment_method = 'cuenta_corriente'
        GROUP BY supplier_id
      ) comp ON comp.supplier_id = s.id
      LEFT JOIN (
        SELECT supplier_id, SUM(amount::numeric) AS total_pagado
        FROM supplier_payments
        WHERE method != 'VALE'
        GROUP BY supplier_id
      ) pag ON pag.supplier_id = s.id
      WHERE s.active = true
    `);

    // 7) Deuda de clientes (all-time AR balance)
    // Incluye: opening_balance + facturación con IVA - cobranza - retenciones
    // Rollup: hijos acumulados en padre mediante COALESCE(parent_customer_id, id)
    const deudaClientesRow = await db.execute(drizzleSql`
      WITH ventas_por_padre AS (
        SELECT
          COALESCE(c.parent_customer_id, c.id) AS parent_id,
          SUM(
            CASE
              WHEN oi.price_per_unit::numeric = 0 THEN 0
              WHEN c.has_iva = true THEN oi.quantity::numeric * oi.price_per_unit::numeric * (1 + COALESCE(p.iva_rate, 0.105))
              ELSE oi.quantity::numeric * oi.price_per_unit::numeric
            END
          ) AS facturacion
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.status = 'approved'
        GROUP BY COALESCE(c.parent_customer_id, c.id)
      ),
      pagos_por_padre AS (
        SELECT
          COALESCE(c.parent_customer_id, c.id) AS parent_id,
          SUM(CASE WHEN py.method != 'RETENCION' THEN py.amount::numeric ELSE 0 END) AS cobranza,
          SUM(CASE WHEN py.method  = 'RETENCION' THEN py.amount::numeric ELSE 0 END) AS retenciones
        FROM payments py
        JOIN customers c ON c.id = py.customer_id
        GROUP BY COALESCE(c.parent_customer_id, c.id)
      ),
      opening_por_padre AS (
        SELECT
          COALESCE(parent_customer_id, id) AS parent_id,
          SUM(opening_balance::numeric) AS total_opening
        FROM customers
        WHERE active = true
        GROUP BY COALESCE(parent_customer_id, id)
      ),
      saldos AS (
        SELECT GREATEST(0,
          COALESCE(ob.total_opening, 0)
          + COALESCE(v.facturacion,  0)
          - COALESCE(py.cobranza,    0)
          - COALESCE(py.retenciones, 0)
        ) AS saldo_positivo
        FROM customers c
        LEFT JOIN ventas_por_padre  v  ON v.parent_id  = c.id
        LEFT JOIN pagos_por_padre   py ON py.parent_id = c.id
        LEFT JOIN opening_por_padre ob ON ob.parent_id = c.id
        WHERE c.active = true AND c.parent_customer_id IS NULL
      )
      SELECT COALESCE(SUM(saldo_positivo), 0) AS deuda_clientes
      FROM saldos
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
    const dt = (diasRow.rows[0] as any) ?? {};
    const m = (mermaRow.rows[0] as any) ?? {};
    const vr = (vaciosRecibidosRow.rows[0] as any) ?? {};
    const ve = (vaciosEntregadosRow.rows[0] as any) ?? {};
    const vh = (vaciosHistRow.rows[0] as any) ?? {};
    const d = (deudaRow.rows[0] as any) ?? {};
    const dc = (deudaClientesRow.rows[0] as any) ?? {};
    const sv = (stockValRow.rows[0] as any) ?? {};

    let ventas = parseFloat(s.ventas ?? "0");
    let ganancia_bruta = parseFloat(s.ganancia_bruta ?? "0");
    const mermaTotal = parseFloat(m.merma ?? "0");
    const rindeTotal = parseFloat(m.rinde ?? "0");
    let ganancia_real = ganancia_bruta + rindeTotal - mermaTotal;

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

    let diasTrabajados = Math.max(1, parseInt(dt.dias_trabajados ?? "0") || 1);

    // Override ventas/ganancia for historical months (Jan/Feb/Mar 2026)
    const histMonth = isHistoricalMonth(from, to);
    if (histMonth) {
      const hs = getHistoricalMonthStats(histMonth.month, histMonth.year);
      if (hs) {
        ventas = hs.ventas;
        ganancia_bruta = hs.ganancia_bruta;
        ganancia_real = hs.ganancia_bruta; // no merma/rinde data for historical months
        diasTrabajados = hs.diasTrabajados;
      }
    }

    // Cheques en circulación (no suman entre sí ni con deudas — cada uno es su propio concepto)
    const chequesRow = await db.execute(drizzleSql`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'emitido'  AND estado = 'en_cartera' THEN monto::numeric ELSE 0 END), 0) AS cheques_emitidos,
        COALESCE(SUM(CASE WHEN tipo = 'recibido' AND estado = 'en_cartera' THEN monto::numeric ELSE 0 END), 0) AS cheques_en_cartera
      FROM cheques
    `);
    const chq = (chequesRow.rows[0] as any) ?? {};

    // ── Ventas y bultos por semana (lunes-domingo, calendario real) ─────────────
    const ventasSemanaRow = await db.execute(drizzleSql`
      SELECT to_char(date_trunc('week', o.order_date::date), 'YYYY-MM-DD') AS wk,
        COALESCE(SUM(
          CASE
            WHEN oi.price_per_unit::numeric = 0 THEN 0
            WHEN c.has_iva = true THEN oi.quantity::numeric * oi.price_per_unit::numeric * (1 + COALESCE(p.iva_rate, 0.105))
            ELSE oi.quantity::numeric * oi.price_per_unit::numeric
          END
        ), 0) AS ventas
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.status = 'approved'
        AND o.order_date >= ${from}::timestamp AND o.order_date < ${to}::timestamp
        AND (o.notes IS NULL OR o.notes NOT LIKE '%Facturación histórica importada%')
      GROUP BY date_trunc('week', o.order_date::date)
    `);
    // Bultos = lo que se cargó en compras como CAJON o BOLSA (cantidad de envases)
    const bultosSemanaRow = await db.execute(drizzleSql`
      SELECT to_char(date_trunc('week', p.purchase_date::date), 'YYYY-MM-DD') AS wk,
        COALESCE(SUM(
          CASE WHEN pi.purchase_unit IN ('CAJON','BOLSA') THEN pi.purchase_qty::numeric
               WHEN pi.unit IN ('CAJON','BOLSA') THEN pi.quantity::numeric
               ELSE 0 END
        ), 0) AS bultos
      FROM purchases p
      JOIN purchase_items pi ON pi.purchase_id = p.id
      WHERE p.purchase_date >= ${from}::timestamp AND p.purchase_date < ${to}::timestamp
      GROUP BY date_trunc('week', p.purchase_date::date)
    `);
    const ventasByWeek = new Map<string, number>();
    for (const r of ventasSemanaRow.rows as any[]) ventasByWeek.set(String(r.wk), parseFloat(r.ventas ?? "0"));
    const bultosByWeek = new Map<string, number>();
    for (const r of bultosSemanaRow.rows as any[]) bultosByWeek.set(String(r.wk), parseFloat(r.bultos ?? "0"));

    // Enumerar las semanas calendario (lunes) que solapan [from, to)
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const fmtDM = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    const fromD = new Date(from + "T00:00:00");
    const toD = new Date(to + "T00:00:00");
    const semanas: { label: string; ventas: number; bultos: number }[] = [];
    let bultosTotal = 0;
    let wkStart = new Date(fromD);
    wkStart.setDate(wkStart.getDate() - ((wkStart.getDay() + 6) % 7)); // lunes de la semana de 'from'
    wkStart.setHours(0, 0, 0, 0);
    let guard = 0;
    while (wkStart < toD && guard++ < 80) {
      const wkEnd = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 7);
      const segStart = wkStart < fromD ? fromD : wkStart;
      const segEnd = wkEnd > toD ? toD : wkEnd;
      if (segStart < segEnd) {
        const key = ymd(wkStart);
        const v = ventasByWeek.get(key) ?? 0;
        const b = bultosByWeek.get(key) ?? 0;
        bultosTotal += b;
        const lastDay = new Date(segEnd.getTime() - 86400000);
        semanas.push({ label: `${fmtDM(segStart)}–${fmtDM(lastDay)}`, ventas: Math.round(v), bultos: Math.round(b) });
      }
      wkStart = wkEnd;
    }

    // ── Ganancia Neta: ganancia_real − egresos operativos categorizados ──────────
    // Egresos = caja_movements egresos con afecta_egresos=true (MISMA lógica que el
    // gráfico de egresos B6: flag de bank_categories + fallback por texto). Período
    // [from, to). fecha_cobertura = última fecha con egresos cargados (MP/Galicia).
    const egRows = (await db.execute(drizzleSql`
      SELECT category, amount::float AS amount, date
      FROM caja_movements
      WHERE type = 'egreso' AND date >= ${from} AND date < ${to}
    `)).rows as any[];
    const bankCatsRows = (await db.execute(drizzleSql`SELECT lower(name) AS name, afecta_egresos FROM bank_categories`)).rows as any[];
    const afectaMap = new Map<string, boolean>(bankCatsRows.map(r => [r.name, r.afecta_egresos]));
    const excludeText = (cat: string) => {
      const l = (cat ?? "").toLowerCase();
      return l.includes("proveedor") || l.includes("mercader") || l.includes("banco propio")
        || l.includes("retiro") || l.includes("cheque rechazado");
    };
    const cuentaEnGrafico = (cat: string) => {
      const flag = afectaMap.get((cat ?? "").toLowerCase());
      return flag === undefined ? !excludeText(cat) : flag !== false;  // true = suma al gráfico/neta
    };
    let egresosOperativos = 0, cantidadMovimientosEgresos = 0, fechaCoberturaEgresos: string | null = null;
    for (const r of egRows) {
      if (r.date && (fechaCoberturaEgresos === null || r.date > fechaCoberturaEgresos)) fechaCoberturaEgresos = r.date;
      if (cuentaEnGrafico(r.category)) { egresosOperativos += r.amount; cantidadMovimientosEgresos++; }
    }
    egresosOperativos = Math.round(egresosOperativos);
    const ganancia_neta = ganancia_real - egresosOperativos;

    return {
      ventas,
      ganancia_bruta,
      mermaTotal,
      rindeTotal,
      ganancia_real,
      ganancia_neta,
      egresosOperativos,
      cantidadMovimientosEgresos,
      fechaCoberturaEgresos,
      diasPeriodo,
      diasTrabajados,
      semanas,
      bultosTotal: Math.round(bultosTotal),
      chequesEmitidos: parseFloat(chq.cheques_emitidos ?? "0"),
      chequesEnCartera: parseFloat(chq.cheques_en_cartera ?? "0"),
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

  // ─── Evolución mensual (ventas + margen bruto % por mes, ventana de 12) ────────
  // Serie para los gráficos del dashboard. UNA query con GROUP BY mes, replicando
  // EXACTO el criterio de ventas/ganancia de getDashboardStats (mismo CASE de IVA por
  // producto, mismo costo override, mismos filtros: approved + sin facturación
  // histórica importada). Los meses históricos (ene/feb/mar 2026) se mergean con el
  // mismo override hardcodeado que usa getDashboardStats → coinciden con lo que el
  // dashboard muestra para esos meses. Margen = ganancia_bruta / ventas × 100.
  async getMonthlyTrend(): Promise<{ ym: string; ventas: number; margen: number }[]> {
    const rows = await db.execute(drizzleSql`
      SELECT
        to_char(date_trunc('month', o.order_date), 'YYYY-MM') AS ym,
        COALESCE(SUM(
          CASE
            WHEN oi.price_per_unit::numeric = 0 THEN 0
            WHEN c.has_iva = true THEN oi.quantity::numeric * oi.price_per_unit::numeric * (1 + COALESCE(p.iva_rate, 0.105))
            ELSE oi.quantity::numeric * oi.price_per_unit::numeric
          END
        ), 0) AS ventas,
        COALESCE(SUM(
          CASE
            WHEN oi.price_per_unit::numeric = 0 THEN 0
            WHEN c.has_iva = true THEN oi.quantity::numeric * oi.price_per_unit::numeric * (1 + COALESCE(p.iva_rate, 0.105))
            ELSE oi.quantity::numeric * oi.price_per_unit::numeric
          END
          - oi.quantity::numeric * COALESCE(oi.override_cost_per_unit, oi.cost_per_unit)::numeric
        ), 0) AS ganancia_bruta
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.status = 'approved'
        AND (o.notes IS NULL OR o.notes NOT LIKE '%Facturación histórica importada%')
      GROUP BY 1
    `);

    const map = new Map<string, { ventas: number; ganancia: number }>();
    for (const r of rows.rows as any[]) {
      map.set(String(r.ym), { ventas: parseFloat(r.ventas ?? "0"), ganancia: parseFloat(r.ganancia_bruta ?? "0") });
    }
    // Override de meses históricos (mismo dato que getDashboardStats)
    for (const h of listHistoricalMonths()) {
      map.set(h.ym, { ventas: h.ventas, ganancia: h.ganancia_bruta });
    }

    return [...map.entries()]
      .filter(([, v]) => v.ventas > 0)                 // solo meses con ventas reales
      .sort(([a], [b]) => a.localeCompare(b))          // cronológico (más viejo → nuevo)
      .slice(-12)                                      // ventana móvil: últimos 12
      .map(([ym, v]) => ({
        ym,
        ventas: v.ventas,
        margen: v.ventas > 0 ? +((v.ganancia / v.ventas) * 100).toFixed(2) : 0,
      }));
  },

  // ─── Commissions Detail ───────────────────────────────────────────────────
  async getSalespersons(): Promise<string[]> {
    const rows = await db.execute(drizzleSql`
      SELECT DISTINCT salesperson_name
      FROM customers
      WHERE salesperson_name IS NOT NULL
        AND commission_pct::numeric > 0
        AND active = true
      ORDER BY salesperson_name
    `);
    return rows.rows.map((r: any) => String(r.salesperson_name));
  },

  async getCommissionDetail(salesperson: string, month: number, year: number): Promise<{
    rows: { orderDate: string; customerName: string; total: number; commissionPct: number; commissionAmount: number }[];
    totalVentas: number;
    totalComision: number;
  }> {
    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    const nextM = month === 12 ? 1 : month + 1;
    const nextY = month === 12 ? year + 1 : year;
    const to = `${nextY}-${String(nextM).padStart(2, "0")}-01`;

    const result = await db.execute(drizzleSql`
      SELECT
        o.order_date::date::text AS order_date,
        c.name AS customer_name,
        o.total::numeric AS total,
        c.commission_pct::numeric AS commission_pct,
        o.total::numeric * c.commission_pct::numeric / 100 AS commission_amount
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE c.salesperson_name = ${salesperson}
        AND c.commission_pct::numeric > 0
        AND o.status = 'approved'
        AND o.order_date >= ${from}::timestamp
        AND o.order_date < ${to}::timestamp
      ORDER BY o.order_date, c.name
    `);

    const rows = result.rows.map((r: any) => ({
      orderDate: String(r.order_date),
      customerName: String(r.customer_name),
      total: parseFloat(r.total ?? "0"),
      commissionPct: parseFloat(r.commission_pct ?? "0"),
      commissionAmount: parseFloat(r.commission_amount ?? "0"),
    }));

    return {
      rows,
      totalVentas: rows.reduce((sum, r) => sum + r.total, 0),
      totalComision: rows.reduce((sum, r) => sum + r.commissionAmount, 0),
    };
  },

  // ─── Lista de Precios ──────────────────────────────────────────────────────
  async getPriceList(): Promise<PriceListItem[]> {
    return db.select().from(priceListItems)
      .where(eq(priceListItems.active, true))
      .orderBy(asc(priceListItems.category), asc(priceListItems.sortOrder), asc(priceListItems.productName));
  },

  async createPriceListItem(data: InsertPriceListItem): Promise<PriceListItem> {
    const [item] = await db.insert(priceListItems).values(data).returning();
    return item;
  },

  async updatePriceListItem(id: number, data: Partial<InsertPriceListItem>): Promise<PriceListItem> {
    const [item] = await db.update(priceListItems).set(data).where(eq(priceListItems.id, id)).returning();
    return item;
  },

  async deletePriceListItem(id: number): Promise<void> {
    await db.update(priceListItems).set({ active: false }).where(eq(priceListItems.id, id));
  },

  async reorderPriceListItems(ids: number[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      await db.update(priceListItems).set({ sortOrder: i }).where(eq(priceListItems.id, ids[i]));
    }
  },

  // ─── Facturas Electrónicas ────────────────────────────────────────────────────
  async createInvoice(data: InsertInvoice): Promise<Invoice> {
    // Use explicit raw SQL to avoid RETURNING * including condicion_iva_receptor_id
    // if the migration hasn't run yet.
    const { condicionIvaReceptorId, ...rest } = data as any;
    const rows = await db.execute(drizzleSql`
      INSERT INTO invoices (order_id, customer_id, invoice_type, invoice_number, point_of_sale, cae, cae_expiry, total, iva_amount, description)
      VALUES (${rest.orderId}, ${rest.customerId}, ${rest.invoiceType}, ${rest.invoiceNumber}, ${rest.pointOfSale ?? 4},
              ${rest.cae}, ${rest.caeExpiry}, ${rest.total}, ${rest.ivaAmount}, ${rest.description ?? null})
      RETURNING id, order_id AS "orderId", customer_id AS "customerId",
                invoice_type AS "invoiceType", invoice_number AS "invoiceNumber",
                point_of_sale AS "pointOfSale", cae, cae_expiry AS "caeExpiry",
                total, iva_amount AS "ivaAmount", description, created_at AS "createdAt"
    `);
    const inv = (rows.rows[0] as any) as Invoice;
    if (condicionIvaReceptorId != null) {
      try {
        await db.execute(drizzleSql`UPDATE invoices SET condicion_iva_receptor_id = ${condicionIvaReceptorId} WHERE id = ${inv.id}`);
      } catch { /* column not yet created by migration */ }
    }
    return inv;
  },

  async getInvoices(filters?: { customerId?: number; orderId?: number; from?: string; to?: string }): Promise<(Invoice & { customerName: string; customerPhone: string | null; orderRemitoNum: string | null; creditNoteId: number | null; creditNoteNumber: string | null; creditNoteCae: string | null; creditNoteCaeExpiry: string | null; creditNoteCreatedAt: string | null })[]> {
    // Base query — no credit_notes join so it always succeeds even if table is missing
    let q = drizzleSql`
      SELECT
        i.id, i.order_id AS "orderId", i.customer_id AS "customerId",
        i.invoice_type AS "invoiceType", i.invoice_number AS "invoiceNumber",
        i.point_of_sale AS "pointOfSale", i.cae, i.cae_expiry AS "caeExpiry",
        i.total, i.iva_amount AS "ivaAmount", i.description,
        i.created_at AS "createdAt",
        c.name AS "customerName", c.phone AS "customerPhone",
        o.remito_num AS "orderRemitoNum"
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      JOIN orders o ON o.id = i.order_id
      WHERE 1=1
    `;
    if (filters?.customerId) q = drizzleSql`${q} AND i.customer_id = ${filters.customerId}`;
    if (filters?.orderId)    q = drizzleSql`${q} AND i.order_id = ${filters.orderId}`;
    if (filters?.from) q = drizzleSql`${q} AND i.created_at >= ${filters.from}::date`;
    if (filters?.to) q = drizzleSql`${q} AND i.created_at < (${filters.to}::date + interval '1 day')`;
    q = drizzleSql`${q} ORDER BY i.created_at DESC`;
    const invoiceRows = (await db.execute(q)).rows as any[];

    // Enrich with credit note data — optional, falls back gracefully if table missing
    const emptyCn = { creditNoteId: null, creditNoteNumber: null, creditNoteCae: null, creditNoteCaeExpiry: null, creditNoteCreatedAt: null };
    try {
      const cnRows = (await db.execute(drizzleSql`
        SELECT invoice_id AS "invoiceId", id AS "creditNoteId",
               credit_note_number AS "creditNoteNumber",
               cae AS "creditNoteCae", cae_expiry AS "creditNoteCaeExpiry",
               created_at AS "creditNoteCreatedAt"
        FROM credit_notes
      `)).rows as any[];
      const cnMap = new Map(cnRows.map((r: any) => [r.invoiceId, r]));
      return invoiceRows.map((r: any) => ({ ...r, ...(cnMap.get(r.id) ?? emptyCn) }));
    } catch {
      return invoiceRows.map((r: any) => ({ ...r, ...emptyCn }));
    }
  },

  async getInvoiceById(id: number): Promise<{ invoice: Invoice; customer: Customer; order: Order & { items: (OrderItem & { product: Product | null })[] } } | null> {
    // Raw SQL to avoid Drizzle including condicion_iva_receptor_id if not yet created
    const invRows = await db.execute(drizzleSql`
      SELECT id, order_id AS "orderId", customer_id AS "customerId",
             invoice_type AS "invoiceType", invoice_number AS "invoiceNumber",
             point_of_sale AS "pointOfSale", cae, cae_expiry AS "caeExpiry",
             total, iva_amount AS "ivaAmount", description, created_at AS "createdAt"
      FROM invoices WHERE id = ${id}
    `);
    const inv = (invRows.rows[0] as any) as (Invoice & { condicionIvaReceptorId?: number | null }) | undefined;
    if (!inv) return null;
    // Try to read condicion (column may not exist yet)
    try {
      const cRows = await db.execute(drizzleSql`SELECT condicion_iva_receptor_id AS "condicionIvaReceptorId" FROM invoices WHERE id = ${id}`);
      inv.condicionIvaReceptorId = (cRows.rows[0] as any)?.condicionIvaReceptorId ?? null;
    } catch { inv.condicionIvaReceptorId = null; }

    const [customer] = await db.select().from(customers).where(eq(customers.id, inv.customerId));
    const [order]    = await db.select().from(orders).where(eq(orders.id, inv.orderId));
    const rawItems   = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const items = await Promise.all(rawItems.map(async (item) => {
      const product = item.productId
        ? ((await db.select().from(products).where(eq(products.id, item.productId)).limit(1))[0] ?? null)
        : null;
      return { ...item, product: product as Product | null };
    }));
    return { invoice: inv, customer, order: { ...order, items } };
  },

  async createCreditNote(data: InsertCreditNote): Promise<CreditNote> {
    const rows = await db.execute(drizzleSql`
      INSERT INTO credit_notes
        (invoice_id, customer_id, credit_note_type, credit_note_number, point_of_sale,
         cae, cae_expiry, total, iva_amount, condicion_iva_receptor_id, description)
      VALUES
        (${data.invoiceId}, ${data.customerId}, ${data.creditNoteType}, ${data.creditNoteNumber},
         ${data.pointOfSale ?? 4}, ${data.cae}, ${data.caeExpiry}, ${data.total}, ${data.ivaAmount},
         ${data.condicionIvaReceptorId ?? null}, ${data.description ?? null})
      RETURNING id, invoice_id AS "invoiceId", customer_id AS "customerId",
                credit_note_type AS "creditNoteType", credit_note_number AS "creditNoteNumber",
                point_of_sale AS "pointOfSale", cae, cae_expiry AS "caeExpiry",
                total, iva_amount AS "ivaAmount", condicion_iva_receptor_id AS "condicionIvaReceptorId",
                description, created_at AS "createdAt"
    `);
    return rows.rows[0] as CreditNote;
  },

  async getCreditNoteByInvoiceId(invoiceId: number): Promise<CreditNote | null> {
    try {
      const rows = await db.execute(drizzleSql`
        SELECT id, invoice_id AS "invoiceId", customer_id AS "customerId",
               credit_note_type AS "creditNoteType", credit_note_number AS "creditNoteNumber",
               point_of_sale AS "pointOfSale", cae, cae_expiry AS "caeExpiry",
               total, iva_amount AS "ivaAmount", condicion_iva_receptor_id AS "condicionIvaReceptorId",
               description, created_at AS "createdAt"
        FROM credit_notes WHERE invoice_id = ${invoiceId}
      `);
      return (rows.rows[0] as CreditNote) ?? null;
    } catch {
      return null;
    }
  },

  // ─── Caja ───────────────────────────────────────────────────────────────────
  async getCajaSummary(from: string, to: string): Promise<{
    totalIngresos: number;
    totalEgresos: number;
    saldo: number;
    payments: { id: number; date: string; amount: string; method: string; notes: string | null; customerName: string }[];
    supplierPayments: { id: number; date: string; amount: string; method: string; notes: string | null; supplierName: string }[];
    manualMovements: CajaMovement[];
  }> {
    const pmts = await db
      .select({
        id: payments.id,
        date: payments.date,
        amount: payments.amount,
        method: payments.method,
        notes: payments.notes,
        customerName: customers.name,
      })
      .from(payments)
      .innerJoin(customers, eq(payments.customerId, customers.id))
      .where(and(drizzleSql`${payments.date} >= ${from}`, drizzleSql`${payments.date} <= ${to}`))
      .orderBy(desc(payments.date));

    const spmts = await db
      .select({
        id: supplierPayments.id,
        date: supplierPayments.date,
        amount: supplierPayments.amount,
        method: supplierPayments.method,
        notes: supplierPayments.notes,
        supplierName: suppliers.name,
      })
      .from(supplierPayments)
      .innerJoin(suppliers, eq(supplierPayments.supplierId, suppliers.id))
      .where(and(drizzleSql`${supplierPayments.date} >= ${from}`, drizzleSql`${supplierPayments.date} <= ${to}`))
      .orderBy(desc(supplierPayments.date));

    const manualMovements = await db
      .select()
      .from(cajaMovements)
      .where(and(drizzleSql`${cajaMovements.date} >= ${from}`, drizzleSql`${cajaMovements.date} <= ${to}`))
      .orderBy(desc(cajaMovements.date));

    const sumPayments = pmts.reduce((acc, p) => acc + parseFloat(p.amount ?? "0"), 0);
    const sumManualIn = manualMovements.filter(m => m.type === "ingreso").reduce((acc, m) => acc + parseFloat(m.amount ?? "0"), 0);
    const sumSupplier = spmts.reduce((acc, p) => acc + parseFloat(p.amount ?? "0"), 0);
    const sumManualOut = manualMovements.filter(m => m.type === "egreso").reduce((acc, m) => acc + parseFloat(m.amount ?? "0"), 0);

    const totalIngresos = sumPayments + sumManualIn;
    const totalEgresos = sumSupplier + sumManualOut;

    return {
      totalIngresos,
      totalEgresos,
      saldo: totalIngresos - totalEgresos,
      payments: pmts.map(p => ({ ...p, amount: p.amount ?? "0" })),
      supplierPayments: spmts.map(p => ({ ...p, amount: p.amount ?? "0" })),
      manualMovements,
    };
  },

  async getCajaBalance(): Promise<{ efectivo: number; transferencia: number; cheque: number; otro: number }> {
    const normalizeMethod = (m: string | null): "efectivo" | "transferencia" | "cheque" | "otro" => {
      const k = (m || "").toLowerCase();
      if (k === "efectivo") return "efectivo";
      if (k === "transferencia" || k === "banco" || k === "transferencia bancaria") return "transferencia";
      if (k === "cheque") return "cheque";
      return "otro";
    };

    const bal = { efectivo: 0, transferencia: 0, cheque: 0, otro: 0 };

    const pmtRows = await db.select({ amount: payments.amount, method: payments.method }).from(payments);
    for (const p of pmtRows) {
      const k = normalizeMethod(p.method);
      bal[k] += parseFloat(p.amount ?? "0");
    }

    const spRows = await db.select({ amount: supplierPayments.amount, method: supplierPayments.method }).from(supplierPayments);
    for (const p of spRows) {
      const k = normalizeMethod(p.method);
      bal[k] -= parseFloat(p.amount ?? "0");
    }

    const manRows = await db
      .select({ amount: cajaMovements.amount, method: cajaMovements.method, type: cajaMovements.type })
      .from(cajaMovements)
      .where(drizzleSql`${cajaMovements.method} IS NOT NULL`);
    for (const m of manRows) {
      const k = normalizeMethod(m.method);
      const amt = parseFloat(m.amount ?? "0");
      if (m.type === "ingreso") bal[k] += amt;
      else bal[k] -= amt;
    }

    return bal;
  },

  async getCajaTrend(months = 6): Promise<Array<{ month: string; label: string; ingresos: number; egresos: number }>> {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const startD = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const endD = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const fromStr = `${startD.getFullYear()}-${pad(startD.getMonth() + 1)}-01`;
    const toStr = `${endD.getFullYear()}-${pad(endD.getMonth() + 1)}-${pad(endD.getDate())}`;

    const [pmtRows, orderRows, manInRows, supplierRows, manOutRows] = await Promise.all([
      db.select({
        month: drizzleSql<string>`to_char(${payments.date}::date, 'YYYY-MM')`,
        total: drizzleSql<string>`sum(${payments.amount}::numeric)`,
      }).from(payments)
        .where(and(drizzleSql`${payments.date} >= ${fromStr}`, drizzleSql`${payments.date} <= ${toStr}`))
        .groupBy(drizzleSql`to_char(${payments.date}::date, 'YYYY-MM')`),

      db.select({
        month: drizzleSql<string>`to_char(${orders.approvedAt}::date, 'YYYY-MM')`,
        total: drizzleSql<string>`sum(${orders.total}::numeric)`,
      }).from(orders)
        .where(and(eq(orders.status, "approved"),
          drizzleSql`${orders.approvedAt}::date >= ${fromStr}::date`,
          drizzleSql`${orders.approvedAt}::date <= ${toStr}::date`))
        .groupBy(drizzleSql`to_char(${orders.approvedAt}::date, 'YYYY-MM')`),

      db.select({
        month: drizzleSql<string>`to_char(${cajaMovements.date}::date, 'YYYY-MM')`,
        total: drizzleSql<string>`sum(${cajaMovements.amount}::numeric)`,
      }).from(cajaMovements)
        .where(and(eq(cajaMovements.type, "ingreso"),
          drizzleSql`${cajaMovements.date} >= ${fromStr}`, drizzleSql`${cajaMovements.date} <= ${toStr}`))
        .groupBy(drizzleSql`to_char(${cajaMovements.date}::date, 'YYYY-MM')`),

      db.select({
        month: drizzleSql<string>`to_char(${supplierPayments.date}::date, 'YYYY-MM')`,
        total: drizzleSql<string>`sum(${supplierPayments.amount}::numeric)`,
      }).from(supplierPayments)
        .where(and(drizzleSql`${supplierPayments.date} >= ${fromStr}`, drizzleSql`${supplierPayments.date} <= ${toStr}`))
        .groupBy(drizzleSql`to_char(${supplierPayments.date}::date, 'YYYY-MM')`),

      db.select({
        month: drizzleSql<string>`to_char(${cajaMovements.date}::date, 'YYYY-MM')`,
        total: drizzleSql<string>`sum(${cajaMovements.amount}::numeric)`,
      }).from(cajaMovements)
        .where(and(eq(cajaMovements.type, "egreso"),
          drizzleSql`${cajaMovements.date} >= ${fromStr}`, drizzleSql`${cajaMovements.date} <= ${toStr}`))
        .groupBy(drizzleSql`to_char(${cajaMovements.date}::date, 'YYYY-MM')`),
    ]);

    const get = (rows: { month: string; total: string }[], key: string) =>
      parseFloat(rows.find(r => r.month === key)?.total ?? "0");

    const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const result = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      const label = `${MONTHS_ES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
      const ingresos = get(pmtRows, key) + get(orderRows, key) + get(manInRows, key);
      const egresos = get(supplierRows, key) + get(manOutRows, key);
      result.push({ month: key, label, ingresos, egresos });
    }
    return result;
  },

  async createCajaMovement(data: InsertCajaMovement, userId: number): Promise<CajaMovement> {
    const [m] = await db.insert(cajaMovements).values({ ...data, createdBy: userId }).returning();
    return m;
  },

  async deleteCajaMovement(id: number): Promise<void> {
    await db.delete(cajaMovements).where(eq(cajaMovements.id, id));
  },

  async syncBankMovementToCaja(data: {
    sourceId: string;
    date: string;
    type: "ingreso" | "egreso";
    description: string;
    amount: string;
    category: string;
    method: string;
  }): Promise<void> {
    await db.delete(cajaMovements).where(drizzleSql`${cajaMovements.sourceId} = ${data.sourceId}`);
    await db.insert(cajaMovements).values({
      sourceId: data.sourceId,
      date: data.date,
      type: data.type,
      description: data.description,
      amount: data.amount,
      category: data.category,
      method: data.method,
    });
  },

  async deleteBankMovementFromCaja(sourceId: string): Promise<void> {
    await db.delete(cajaMovements).where(drizzleSql`${cajaMovements.sourceId} = ${sourceId}`);
    await db.delete(cajaMovements).where(drizzleSql`${cajaMovements.sourceId} = ${sourceId + ":fee"}`);
    await this.deleteRetiroByMovimientoRef(sourceId);
  },

  // Sincroniza el movimiento PRINCIPAL de MP categorizado a caja con el monto TRANSFERIDO (gross).
  // La comisión se maneja por separado en syncMpFee (para cubrir TODOS los movimientos, no solo este).
  // Retiro: el monto del retiro es el transferido (gross). Si no se pasa socioId, se conserva el del retiro previo.
  async reconcileMpCajaMovement(data: {
    sourceId: string; date: string; type: "ingreso" | "egreso";
    description: string; gross: number; category: string; socioId?: number | null;
  }): Promise<void> {
    let socioId = data.socioId ?? null;
    if (socioId == null) {
      const prev = await db.execute(drizzleSql`SELECT socio_id FROM retiros WHERE movimiento_ref = ${data.sourceId} LIMIT 1`);
      socioId = (prev.rows[0] as any)?.socio_id ?? null;
    }
    await db.delete(cajaMovements).where(drizzleSql`${cajaMovements.sourceId} = ${data.sourceId}`);
    await this.deleteRetiroByMovimientoRef(data.sourceId);

    await db.insert(cajaMovements).values({
      sourceId: data.sourceId, date: data.date, type: data.type,
      description: data.description, amount: data.gross.toFixed(2), category: data.category, method: "TRANSFERENCIA",
    });
    if (data.category === "Retiro" && socioId != null) {
      await this.createRetiro({
        socioId, monto: data.gross, fecha: data.date, origen: "movimiento",
        movimientoRef: data.sourceId, notas: data.description,
      });
    }
  },

  // Comisión de MP como egreso en categoría "Comisiones" (sourceId mp:<id>:fee).
  // Se aplica a TODO movimiento con comisión (cobros, pagos, retiros, etc.), esté categorizado o no,
  // así el total de "Comisiones" en egresos coincide con el total de comisiones del período en Bancos.
  async syncMpFee(data: { sourceId: string; fee: number; date: string; description: string }): Promise<void> {
    const feeSrc = `${data.sourceId}:fee`;
    await db.delete(cajaMovements).where(drizzleSql`${cajaMovements.sourceId} = ${feeSrc}`);
    if (data.fee > 0.005) {
      await db.insert(cajaMovements).values({
        sourceId: feeSrc, date: data.date, type: "egreso",
        description: `Comisión MP — ${data.description}`, amount: data.fee.toFixed(2),
        category: "Comisiones", method: "TRANSFERENCIA",
      });
    }
  },

  // Monto actual del caja_movement principal por sourceId (para detectar los que aún no separan comisión)
  async getCajaAmountsBySourceIds(sourceIds: string[]): Promise<Map<string, number>> {
    if (sourceIds.length === 0) return new Map();
    const rows = await db.select({ sourceId: cajaMovements.sourceId, amount: cajaMovements.amount })
      .from(cajaMovements)
      .where(inArray(cajaMovements.sourceId, sourceIds));
    return new Map(rows.map(r => [String(r.sourceId), parseFloat(String(r.amount ?? "0"))]));
  },

  // Backfill: inserta entradas de banco que ya tenían categoría pero aún no están en caja_movements
  async backfillBankMovementsToCaja(movements: Array<{
    sourceId: string;
    date: string;
    type: "ingreso" | "egreso";
    description: string;
    amount: string;
    category: string;
    method: string;
  }>): Promise<number> {
    if (movements.length === 0) return 0;
    const sourceIds = movements.map(m => m.sourceId);
    const existing = await db
      .select({ sid: cajaMovements.sourceId })
      .from(cajaMovements)
      .where(inArray(cajaMovements.sourceId, sourceIds));
    const existingSet = new Set(existing.map(r => r.sid));
    const toSync = movements.filter(m => !existingSet.has(m.sourceId));
    for (const m of toSync) {
      await db.insert(cajaMovements).values({
        sourceId: m.sourceId,
        date: m.date,
        type: m.type,
        description: m.description,
        amount: m.amount,
        category: m.category,
        method: m.method,
      });
    }
    return toSync.length;
  },

  // ─── Bank Categories ─────────────────────────────────────────────────────────
  async getBankCategories(): Promise<BankCategory[]> {
    return db.select().from(bankCategories).orderBy(asc(bankCategories.id));
  },

  async createBankCategory(name: string, afectaEgresos: boolean = true): Promise<BankCategory> {
    const [cat] = await db.insert(bankCategories).values({ name, afectaEgresos }).returning();
    return cat;
  },

  async updateBankCategory(id: number, name: string): Promise<BankCategory> {
    const [cat] = await db.update(bankCategories).set({ name }).where(eq(bankCategories.id, id)).returning();
    return cat;
  },

  // ─── Lector Galicia (paso 6): importar extracto → galicia_movements + caja_movements ──
  // Parsea, clasifica por reglas, deduplica y reconcilia a caja_movements. Idempotente
  // (ON CONFLICT DO NOTHING en galicia, upsert por source_id en caja). Con dryRun=true
  // corre todo en una transacción que hace ROLLBACK (verificación sin persistir).
  async importGaliciaExtracto(buffer: Buffer, opts?: { dryRun?: boolean }): Promise<{
    totalParseados: number; insertadosGalicia: number; duplicados: number;
    reconciliadosCaja: number; sinCategoria: number; retirosEfectivo: number;
    cobrosPendientes: number; yaContabilizados: number;
    porCategoria: { category: string; n: number; total: number }[];
    cruceCheques: any;   // resultado del cruce ECHEQ↔cheque emitido (auto al cargar)
  }> {
    const { parseGaliciaExtracto, classifyGaliciaMovement, tratamientoCobro, GALICIA_NEW_CATEGORIES } =
      await import("./galicia-parser");
    const movs = parseGaliciaExtracto(buffer);

    const run = async (exec: any) => {
      // Reglas de clasificación
      const rulesRows = (await exec.execute(drizzleSql`SELECT match_concepto, match_leyenda, category_name, prioridad FROM galicia_rules`)).rows as any[];
      const rules = rulesRows.map(r => ({ matchConcepto: r.match_concepto, matchLeyenda: r.match_leyenda, categoryName: r.category_name, prioridad: r.prioridad }));

      // Asegurar categorías nuevas en bank_categories (no pisa las existentes)
      const existing = (await exec.execute(drizzleSql`SELECT lower(name) AS name FROM bank_categories`)).rows.map((r: any) => r.name);
      for (const c of GALICIA_NEW_CATEGORIES) {
        if (!existing.includes(c.toLowerCase())) {
          await exec.execute(drizzleSql`INSERT INTO bank_categories (name) VALUES (${c})`);
        }
      }
      // Cuenta Efectivo (única que lleva saldo): los "Retiro de efectivo" suman a su saldo
      const efeRow = (await exec.execute(drizzleSql`SELECT id FROM cuentas_financieras WHERE tipo = 'efectivo' LIMIT 1`)).rows[0] as any;
      const efectivoId: number | null = efeRow?.id ?? null;
      // Socios (para auto-asignar retiros por la leyenda del extracto)
      const socios = (await exec.execute(drizzleSql`SELECT id, nombre FROM socios WHERE activo = true`)).rows as { id: number; nombre: string }[];

      let insertadosGalicia = 0, duplicados = 0, reconciliadosCaja = 0, sinCategoria = 0, cobrosPendientes = 0, yaContabilizados = 0, retirosEfectivo = 0;
      const porCat: Record<string, { n: number; total: number }> = {};

      for (const m of movs) {
        const category = classifyGaliciaMovement(m, rules);
        const { yaContabilizado, asignacionCc } = tratamientoCobro(category);
        if (!category) sinCategoria++;
        if (asignacionCc === "pendiente") cobrosPendientes++;
        if (yaContabilizado) yaContabilizados++;
        const k = category ?? "(sin categoría)";
        porCat[k] = porCat[k] ?? { n: 0, total: 0 };
        porCat[k].n++; porCat[k].total += m.monto;

        // 1) staging galicia_movements (dedup por id)
        const ins = await exec.execute(drizzleSql`
          INSERT INTO galicia_movements (id, fecha, descripcion, debito, credito, grupo_concepto, concepto, comprobante, leyendas, saldo, tipo_movimiento, category, categoria_auto, ya_contabilizado, asignacion_cc)
          VALUES (${m.id}, ${m.fecha}, ${m.descripcion}, ${m.debito}, ${m.credito}, ${m.grupoConcepto}, ${m.concepto}, ${m.comprobante}, ${m.leyendas}, ${m.saldo}, ${m.tipoMovimiento}, ${category}, ${category != null}, ${yaContabilizado}, ${asignacionCc})
          ON CONFLICT (id) DO NOTHING
        `);
        const inserted = (ins as any).rowCount ?? 0;
        if (inserted > 0) insertadosGalicia++; else { duplicados++; continue; } // ya existía → no re-reconciliar

        // 2) reconciliar a caja_movements SOLO si tiene categoría (igual que MP)
        if (category) {
          const sourceId = `galicia:${m.id}`;
          await exec.execute(drizzleSql`DELETE FROM caja_movements WHERE source_id = ${sourceId}`);
          await exec.execute(drizzleSql`
            INSERT INTO caja_movements (source_id, date, type, description, amount, category, method)
            VALUES (${sourceId}, ${m.fecha}, ${m.direccion}, ${m.descripcion || m.concepto}, ${m.monto.toFixed(2)}, ${category}, 'TRANSFERENCIA')
          `);
          reconciliadosCaja++;

          // 3) "Retiro de efectivo" (extracción de cajero) = transferencia interna Galicia→Efectivo.
          //    Suma al saldo de la cuenta Efectivo (movimiento_cuenta ingreso, dedup por origen_id).
          //    NOTA: solo afecta el saldo si su fecha > saldo_base_fecha de Efectivo (si es anterior,
          //    ya está absorbido en el saldo_base; el filtro lo excluye → no doble cuenta).
          if (category === "Retiro de efectivo" && efectivoId != null) {
            await exec.execute(drizzleSql`DELETE FROM movimientos_cuenta WHERE origen_tipo = 'galicia_efectivo' AND origen_id = ${sourceId}`);
            await exec.execute(drizzleSql`
              INSERT INTO movimientos_cuenta (cuenta_id, fecha, signo, monto, concepto, origen_tipo, origen_id)
              VALUES (${efectivoId}, ${m.fecha}::timestamp, 'ingreso', ${m.monto.toFixed(2)}, ${"Extracción Galicia → Efectivo"}, 'galicia_efectivo', ${sourceId})
            `);
            retirosEfectivo++;
          }

          // 4) AUTOMÁTICO: "Retiro" con leyenda que nombra a un socio → crea su fila en retiros
          //    (suma en la card del socio). Si la leyenda no nombra socio → no asigna (queda sin socio).
          //    Idempotente: solo corre en movimientos nuevos (los duplicados hacen continue arriba) +
          //    ON CONFLICT (movimiento_ref) DO NOTHING como segunda barrera.
          if (category === "Retiro") {
            const socioId = matchSocioByLeyenda(m.leyendas, socios);
            if (socioId != null) {
              await exec.execute(drizzleSql`
                INSERT INTO retiros (socio_id, monto, fecha, origen, movimiento_ref, notas)
                VALUES (${socioId}, ${m.monto.toFixed(2)}, ${m.fecha}, 'movimiento', ${sourceId}, ${m.leyendas || m.descripcion || null})
                ON CONFLICT (movimiento_ref) WHERE movimiento_ref IS NOT NULL DO NOTHING
              `);
            }
          }
        }
      }

      // Cruce de cheques AUTOMÁTICO: tras reconciliar los movimientos, ejecutar el mismo cruce
      // que el endpoint manual, en el MISMO exec (así participa del rollback en dryRun).
      // Idempotente: los cheques ya cobrados no se re-tocan → no baja cheques emitidos dos veces.
      const cruceCheques = await this._reconcileChequesEmitidosTx(exec);

      const porCategoria = Object.entries(porCat).map(([category, v]) => ({ category, n: v.n, total: Math.round(v.total) }))
        .sort((a, b) => b.total - a.total);
      return { totalParseados: movs.length, insertadosGalicia, duplicados, reconciliadosCaja, sinCategoria, cobrosPendientes, yaContabilizados, retirosEfectivo, porCategoria, cruceCheques };
    };

    if (opts?.dryRun) {
      // Ejecuta en transacción y fuerza rollback (no persiste) — para verificación
      let result: any = null;
      try {
        await db.transaction(async (tx) => { result = await run(tx); throw new Error("__DRYRUN_ROLLBACK__"); });
      } catch (e: any) { if (e.message !== "__DRYRUN_ROLLBACK__") throw e; }
      return result;
    }
    return run(db);
  },

  // ─── Lector Galicia: movimientos para la vista de Banco (B1, solo lectura) ─────
  // Devuelve cada movimiento de galicia_movements en la MISMA forma que un MpMovement
  // (la vista de /bancos los renderiza con el mismo componente). categoryId se resuelve
  // desde el nombre de category vía bank_categories para que el CategoryPicker lo muestre.
  async getGaliciaMovementsForView(from?: string, to?: string): Promise<any[]> {
    const conds: string[] = [];
    if (from) conds.push(`g.fecha >= '${from.replace(/'/g, "")}'`);
    if (to)   conds.push(`g.fecha <= '${to.replace(/'/g, "")}'`);
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const rows = (await db.execute(drizzleSql`
      SELECT g.id, g.fecha, g.descripcion, g.debito::float AS debito, g.credito::float AS credito,
             g.concepto, g.comprobante, g.leyendas, g.tipo_movimiento, g.category,
             g.categoria_auto, g.ya_contabilizado, g.asignacion_cc,
             bc.id AS category_id
      FROM galicia_movements g
      LEFT JOIN bank_categories bc ON lower(bc.name) = lower(g.category)
      ${drizzleSql.raw(where)}
      ORDER BY g.fecha DESC, g.id DESC
    `)).rows as any[];

    // Sugerencia de cliente por CUIT (solo cobros pendientes de asignar). El CUIT está
    // en la leyenda (11 dígitos) y matchea customers.cuit (único, no heurístico).
    const cuitDe = (leyenda: string | null): string | null => {
      const m = String(leyenda ?? "").match(/\b(\d{11})\b/);
      return m ? m[1] : null;
    };
    const pendientes = rows.filter(r => r.asignacion_cc === "pendiente");
    const cuitToCustomer = new Map<string, { id: number; name: string }>();
    if (pendientes.length > 0) {
      const custs = (await db.execute(drizzleSql`
        SELECT id, name, regexp_replace(cuit, '[^0-9]', '', 'g') AS cuit_norm
        FROM customers WHERE cuit IS NOT NULL AND cuit <> ''`)).rows as any[];
      for (const c of custs) if (c.cuit_norm) cuitToCustomer.set(String(c.cuit_norm), { id: c.id, name: c.name });
    }

    // Proveedor: egresos "Pago a proveedor" pendientes de aplicar a CC.
    const pagosProvPend = rows.filter(r => r.category === "Pago a proveedor" && r.debito != null && r.asignacion_cc == null);
    let suppliers: { id: number; name: string }[] = [];
    const refsAplicados = new Set<string>();
    if (pagosProvPend.length > 0) {
      suppliers = (await db.execute(drizzleSql`SELECT id, name FROM suppliers`)).rows as any[];
      const sp = (await db.execute(drizzleSql`SELECT movement_ref FROM supplier_payments WHERE movement_ref IS NOT NULL`)).rows as any[];
      for (const x of sp) refsAplicados.add(String(x.movement_ref));
    }
    const matchSupplier = (leyenda: string | null) => {
      const L = String(leyenda ?? "").toUpperCase();
      if (!L) return null;
      for (const s of suppliers) {
        const tokens = String(s.name).toUpperCase().split(/[\s\-]+/).filter(t => t.length >= 4);
        if (tokens.some(t => L.includes(t))) return s;
      }
      return null;
    };

    return rows.map((r) => {
      const isOutgoing = r.debito != null;
      const gross = Math.abs(parseFloat(String(r.debito ?? r.credito ?? 0)));
      // Sugerencia de cliente (solo cobros pendientes)
      let suggestedCustomerId: number | null = null;
      let suggestedCustomerName: string | null = null;
      let suggestedCuit: string | null = null;
      if (r.asignacion_cc === "pendiente") {
        suggestedCuit = cuitDe(r.leyendas);
        const hit = suggestedCuit ? cuitToCustomer.get(suggestedCuit) : undefined;
        if (hit) { suggestedCustomerId = hit.id; suggestedCustomerName = hit.name; }
      }
      // Pago a proveedor pendiente de aplicar a CC (+ hint de proveedor por nombre)
      const esPagoProvPend = r.category === "Pago a proveedor" && isOutgoing && r.asignacion_cc == null;
      const yaAplicadoProv = refsAplicados.has(String(r.id));
      let suggestedSupplierId: number | null = null, suggestedSupplierName: string | null = null;
      if (esPagoProvPend && !yaAplicadoProv) { const sm = matchSupplier(r.leyendas); if (sm) { suggestedSupplierId = sm.id; suggestedSupplierName = sm.name; } }
      return {
        id: r.id,                                   // "galicia:..."
        date_created: `${r.fecha}T00:00:00-03:00`,  // sin hora real en el extracto
        type: r.tipo_movimiento ?? r.concepto ?? "transferencia",
        description: r.descripcion || r.concepto || "",
        status: "approved",
        isOutgoing,
        grossAmount: gross,
        feeAmount: 0,
        netAmount: gross,
        total: gross,
        displayName: r.descripcion || r.leyendas || r.concepto || null,
        categoryId: r.category_id ?? null,          // resuelto desde el nombre
        categoryName: r.category ?? null,           // nombre crudo (por si no está en el catálogo)
        // campos propios de Galicia (para badges/futuro)
        comprobante: r.comprobante ?? null,
        leyendas: r.leyendas ?? null,
        yaContabilizado: r.ya_contabilizado ?? false,
        asignacionCc: r.asignacion_cc ?? null,
        categoriaAuto: r.categoria_auto ?? true,
        // Asignación de cobros (paso 1): cliente sugerido por CUIT
        suggestedCustomerId,
        suggestedCustomerName,
        suggestedCuit,
        // Pago a proveedor: pendiente de aplicar a CC + proveedor sugerido por nombre
        esPagoProvPend: esPagoProvPend && !yaAplicadoProv,
        yaAplicadoProv,
        suggestedSupplierId,
        suggestedSupplierName,
        source: "galicia",
      };
    });
  },

  // ─── Lector Galicia: corregir categoría de UN movimiento a mano (B4) ──────────
  // Actualiza galicia_movements.category + categoria_auto=false (corrección manual)
  // y re-reconcilia el caja_movement (source_id galicia:...). NO toca galicia_rules
  // (sin aprendizaje automático — decisión del usuario). Idempotente: el caja_movement
  // se rehace con DELETE+INSERT, así A→B→A nunca duplica (siempre 0/1 fila por source_id).
  async setGaliciaCategory(galiciaId: string, categoryName: string | null, opts?: { dryRun?: boolean; socioId?: number | null }): Promise<any> {
    const sourceId = `galicia:${galiciaId}`;

    // Aplica el cambio de categoría + re-reconciliación. Devuelve datos básicos.
    const apply = async (exec: any, name: string | null, socioIdArg?: number | null) => {
      const rows = (await exec.execute(drizzleSql`
        SELECT fecha, descripcion, concepto, leyendas, debito::float AS debito, credito::float AS credito, category
        FROM galicia_movements WHERE id = ${galiciaId}`)).rows as any[];
      if (rows.length === 0) throw new Error("Movimiento Galicia no encontrado");
      const m = rows[0];
      const isOutgoing = m.debito != null;
      const monto = Math.abs(parseFloat(String(m.debito ?? m.credito ?? 0)));
      const direccion = isOutgoing ? "egreso" : "ingreso";
      const desc = m.descripcion || m.concepto || "";

      // 1) categoría + marca de corrección manual
      await exec.execute(drizzleSql`UPDATE galicia_movements SET category = ${name}, categoria_auto = false WHERE id = ${galiciaId}`);

      // 2) re-reconciliar caja_movements (DELETE+INSERT → nunca duplica)
      await exec.execute(drizzleSql`DELETE FROM caja_movements WHERE source_id = ${sourceId}`);
      if (name != null) {
        await exec.execute(drizzleSql`
          INSERT INTO caja_movements (source_id, date, type, description, amount, category, method)
          VALUES (${sourceId}, ${m.fecha}, ${direccion}, ${desc}, ${monto.toFixed(2)}, ${name}, 'TRANSFERENCIA')`);
      }

      // 3) "Retiro de efectivo" → movimiento_cuenta en Efectivo (igual que el import; mantiene consistencia al cambiar A→Retiro o Retiro→A)
      await exec.execute(drizzleSql`DELETE FROM movimientos_cuenta WHERE origen_tipo = 'galicia_efectivo' AND origen_id = ${sourceId}`);
      if (name === "Retiro de efectivo") {
        const efe = (await exec.execute(drizzleSql`SELECT id FROM cuentas_financieras WHERE tipo = 'efectivo' LIMIT 1`)).rows[0] as any;
        if (efe?.id != null) {
          await exec.execute(drizzleSql`
            INSERT INTO movimientos_cuenta (cuenta_id, fecha, signo, monto, concepto, origen_tipo, origen_id)
            VALUES (${efe.id}, ${m.fecha}::timestamp, 'ingreso', ${monto.toFixed(2)}, ${"Extracción Galicia → Efectivo"}, 'galicia_efectivo', ${sourceId})`);
        }
      }

      // 4) MANUAL: "Retiro" del socio → fila en retiros (espejo de reconcileMpCajaMovement).
      //    Conserva el socio previo si no se pasa socioId (idempotente al re-categorizar).
      //    Si la categoría se va de "Retiro", la fila se borra (DELETE de abajo) y no se reinserta.
      let socio = socioIdArg ?? null;
      if (socio == null && name === "Retiro") {
        const prev = (await exec.execute(drizzleSql`SELECT socio_id FROM retiros WHERE movimiento_ref = ${sourceId} LIMIT 1`)).rows[0] as any;
        socio = prev?.socio_id ?? null;
      }
      await exec.execute(drizzleSql`DELETE FROM retiros WHERE movimiento_ref = ${sourceId}`);
      if (name === "Retiro" && socio != null) {
        await exec.execute(drizzleSql`
          INSERT INTO retiros (socio_id, monto, fecha, origen, movimiento_ref, notas)
          VALUES (${socio}, ${monto.toFixed(2)}, ${m.fecha}, 'movimiento', ${sourceId}, ${m.leyendas || desc || null})
          ON CONFLICT (movimiento_ref) WHERE movimiento_ref IS NOT NULL DO NOTHING`);
      }
      return { sourceId, category: name, type: direccion, amount: monto, socioId: socio, originalCategory: m.category };
    };

    // Snapshot para verificación (categoría + filas de caja + retiro del source + conteo de reglas)
    const snapshot = async (exec: any) => {
      const g = (await exec.execute(drizzleSql`SELECT category, categoria_auto FROM galicia_movements WHERE id = ${galiciaId}`)).rows[0];
      const caja = (await exec.execute(drizzleSql`SELECT id, category FROM caja_movements WHERE source_id = ${sourceId} ORDER BY id`)).rows;
      const ret = (await exec.execute(drizzleSql`SELECT id, socio_id, monto::float AS monto FROM retiros WHERE movimiento_ref = ${sourceId}`)).rows;
      const rules = (await exec.execute(drizzleSql`SELECT count(*)::int AS n FROM galicia_rules`)).rows[0];
      return { galiciaCategory: g?.category ?? null, categoriaAuto: g?.categoria_auto ?? null, cajaRows: caja, cajaCount: caja.length, retiroRows: ret, retiroCount: ret.length, rulesCount: rules?.n ?? 0 };
    };

    if (opts?.dryRun) {
      // Verificación sin persistir: captura before → aplica B → after → vuelve al original (round-trip) → rollback
      let evidence: any = null;
      try {
        await db.transaction(async (tx) => {
          const before = await snapshot(tx);
          await apply(tx, categoryName, opts.socioId);
          const after = await snapshot(tx);
          await apply(tx, before.galiciaCategory);   // round-trip a la categoría original
          const roundtrip = await snapshot(tx);
          evidence = { before, after, roundtrip };
          throw new Error("__DRYRUN_ROLLBACK__");
        });
      } catch (e: any) { if (e.message !== "__DRYRUN_ROLLBACK__") throw e; }
      return evidence;
    }

    return apply(db, categoryName, opts?.socioId);
  },

  // ─── Backfill retroactivo: socio a retiros de Galicia ya cargados ─────────────
  // Para movimientos category="Retiro" SIN fila en retiros, hace match leyenda→socio
  // y crea la fila (origen='movimiento', movimiento_ref='galicia:'+id). Sin match → skip.
  // Idempotente: el NOT EXISTS + ON CONFLICT evitan duplicar. dryRun → transacción + rollback.
  async backfillGaliciaRetiros(opts?: { dryRun?: boolean }): Promise<any> {
    const totalsPorSocio = async (exec: any) =>
      (await exec.execute(drizzleSql`SELECT socio_id, sum(monto::float)::float AS total, count(*)::int AS n FROM retiros GROUP BY socio_id ORDER BY socio_id`)).rows;

    const run = async (exec: any) => {
      const socios = (await exec.execute(drizzleSql`SELECT id, nombre FROM socios WHERE activo = true`)).rows as { id: number; nombre: string }[];
      const movs = (await exec.execute(drizzleSql`
        SELECT g.id, g.fecha, g.leyendas, g.descripcion, g.debito::float AS debito, g.credito::float AS credito
        FROM galicia_movements g
        WHERE g.category = 'Retiro'
          AND NOT EXISTS (SELECT 1 FROM retiros r WHERE r.movimiento_ref = 'galicia:' || g.id)
        ORDER BY g.fecha`)).rows as any[];

      const creados: any[] = [], sinSocio: any[] = [];
      for (const m of movs) {
        const sourceId = `galicia:${m.id}`;
        const monto = Math.abs(parseFloat(String(m.debito ?? m.credito ?? 0)));
        const socioId = matchSocioByLeyenda(m.leyendas, socios);
        if (socioId == null) { sinSocio.push({ sourceId, leyenda: m.leyendas, monto }); continue; }
        await exec.execute(drizzleSql`
          INSERT INTO retiros (socio_id, monto, fecha, origen, movimiento_ref, notas)
          VALUES (${socioId}, ${monto.toFixed(2)}, ${m.fecha}, 'movimiento', ${sourceId}, ${m.leyendas || m.descripcion || null})
          ON CONFLICT (movimiento_ref) WHERE movimiento_ref IS NOT NULL DO NOTHING`);
        creados.push({ sourceId, socioId, monto, fecha: m.fecha });
      }
      return { creados, sinSocio, totalesDespues: await totalsPorSocio(exec) };
    };

    const totalesAntes = await totalsPorSocio(db);
    if (opts?.dryRun) {
      let result: any = null;
      try { await db.transaction(async (tx) => { result = { totalesAntes, ...(await run(tx)) }; throw new Error("__DRYRUN_ROLLBACK__"); }); }
      catch (e: any) { if (e.message !== "__DRYRUN_ROLLBACK__") throw e; }
      return result;
    }
    return { totalesAntes, ...(await run(db)) };
  },

  // ─── Cruce ECHEQ (extracto Galicia) ↔ cheque emitido (Paso B) ─────────────────
  // Match estricto: número normalizado (campo formal cheques.numero O extracción del
  // texto de notas/concepto) Y monto exacto. Si número coincide pero monto NO → NO
  // concilia, lo marca como "dudoso" para revisar a mano. Por cada match en_cartera:
  // cheque → cobrado, obligación → pagada. tipo=proveedor → NO suma gasto. Idempotente:
  // los ya cobrados no se vuelven a tocar (solo se reportan como vínculo).
  // Núcleo del cruce ECHEQ↔cheque emitido — reutilizable con cualquier exec (db o tx).
  // Lo llaman: reconcileChequesEmitidos (endpoint manual) Y importGaliciaExtracto (auto al cargar).
  // Idempotente: solo concilia cheques en_cartera que matchean (número+monto); los ya cobrados
  // no se re-tocan → ejecutar tras cada carga no baja cheques emitidos dos veces.
  async _reconcileChequesEmitidosTx(exec: any): Promise<any> {
    const norm = (s: any): string | null => { const d = String(s ?? "").replace(/\D/g, "").replace(/^0+/, ""); return d || null; };
    const numDe = (c: any): { num: string | null; fuente: string } => {
      if (c.numero) { const n = norm(c.numero); if (n) return { num: n, fuente: "campo formal" }; }
      const m = String(c.notas ?? "").match(/N[ºo°]\s*0*([0-9]+)/i) || String(c.obl_concepto ?? "").match(/N[ºo°]\s*0*([0-9]+)/i);
      if (m) { const n = norm(m[1]); if (n) return { num: n, fuente: "texto (notas/concepto)" }; }
      return { num: null, fuente: "sin número" };
    };

    const echeqs = (await exec.execute(drizzleSql`
      SELECT comprobante, debito::float AS monto FROM galicia_movements
      WHERE concepto LIKE '%ECHEQ 48 HS. NRO%' AND debito IS NOT NULL ORDER BY fecha`)).rows as any[];
    const cheques = (await exec.execute(drizzleSql`
      SELECT c.id, c.numero, c.monto::float AS monto, c.estado, c.contraparte, c.obligacion_id, c.notas,
             o.concepto AS obl_concepto, o.tipo AS obl_tipo, o.estado AS obl_estado
      FROM cheques c LEFT JOIN obligaciones o ON o.id = c.obligacion_id
      WHERE c.tipo = 'emitido'`)).rows as any[];

    const totalEmitidoAntes = cheques.filter(c => c.estado === "en_cartera").reduce((s, c) => s + c.monto, 0);

    const byNum: Record<string, any[]> = {};
    for (const c of cheques) { const { num, fuente } = numDe(c); c._num = num; c._fuente = fuente; if (num) (byNum[num] ??= []).push(c); }

    const used = new Set<number>();
    let conciliados = 0, yaCobrados = 0, baja = 0, sumanGasto = 0;
    const sinMatch: any[] = [], dudosos: any[] = [], detalle: any[] = [];

    for (const e of echeqs) {
      const n = norm(e.comprobante);
      const cands = (n ? (byNum[n] ?? []) : []).filter(c => !used.has(c.id));
      const exact = cands.find(c => Math.abs(c.monto - e.monto) < 0.5);
      if (!exact) {
        if (cands.length > 0) dudosos.push({ numero: n!, montoEcheq: e.monto, montoCheque: cands[0].monto, chequeId: cands[0].id });
        else sinMatch.push({ numero: n ?? String(e.comprobante), monto: e.monto });
        continue;
      }
      used.add(exact.id);
      if (exact.obl_tipo && exact.obl_tipo !== "proveedor") sumanGasto++;
      if (exact.estado === "en_cartera") {
        conciliados++; baja += exact.monto;
        await exec.execute(drizzleSql`UPDATE cheques SET estado = 'cobrado' WHERE id = ${exact.id}`);
        if (exact.obligacion_id != null) {
          await exec.execute(drizzleSql`UPDATE obligaciones SET estado = 'pagado', pagado_at = now() WHERE id = ${exact.obligacion_id} AND estado <> 'pagado'`);
        }
      } else { yaCobrados++; }
      detalle.push({ numero: n!, monto: e.monto, chequeId: exact.id, contraparte: String(exact.contraparte).trim(),
        estadoAntes: exact.estado, oblTipo: exact.obl_tipo ?? null, fuenteNumero: exact._fuente,
        accion: exact.estado === "en_cartera" ? "conciliar (cobrado + obligación pagada)" : "ya cobrado (solo vínculo)" });
    }

    return {
      echeqsExtracto: echeqs.length, matches: conciliados + yaCobrados, conciliados, yaCobrados,
      totalEmitidoAntes: Math.round(totalEmitidoAntes), totalEmitidoDespues: Math.round(totalEmitidoAntes - baja),
      baja: Math.round(baja), sumanGasto, sinMatch, dudosos, detalle,
    };
  },

  async reconcileChequesEmitidos(opts?: { dryRun?: boolean }): Promise<{
    echeqsExtracto: number; matches: number; conciliados: number; yaCobrados: number;
    totalEmitidoAntes: number; totalEmitidoDespues: number; baja: number; sumanGasto: number;
    sinMatch: { numero: string; monto: number }[];
    dudosos: { numero: string; montoEcheq: number; montoCheque: number; chequeId: number }[];
    detalle: { numero: string; monto: number; chequeId: number; contraparte: string;
      estadoAntes: string; oblTipo: string | null; accion: string; fuenteNumero: string }[];
  }> {
    if (opts?.dryRun) {
      let result: any = null;
      try { await db.transaction(async (tx) => { result = await this._reconcileChequesEmitidosTx(tx); throw new Error("__DRYRUN_ROLLBACK__"); }); }
      catch (e: any) { if (e.message !== "__DRYRUN_ROLLBACK__") throw e; }
      return result;
    }
    return this._reconcileChequesEmitidosTx(db);
  },

  // ─── MP Movement Overrides ────────────────────────────────────────────────────
  async getMpMovementOverridesMap(mpIds: string[]): Promise<Map<string, number | null>> {
    if (mpIds.length === 0) return new Map();
    const rows = await db.select().from(mpMovementOverrides)
      .where(inArray(mpMovementOverrides.mpMovementId, mpIds));
    return new Map(rows.map(r => [r.mpMovementId, r.categoryId ?? null]));
  },

  async setMpMovementCategory(mpMovementId: string, categoryId: number | null): Promise<void> {
    await db.execute(drizzleSql`
      INSERT INTO mp_movement_overrides (mp_movement_id, category_id)
      VALUES (${mpMovementId}, ${categoryId})
      ON CONFLICT (mp_movement_id) DO UPDATE SET category_id = ${categoryId}
    `);
  },

  // ─── Bank Contacts ────────────────────────────────────────────────────────────
  async getBankContacts(): Promise<BankContact[]> {
    return db.select().from(bankContacts).orderBy(asc(bankContacts.displayName));
  },

  async getBankContactsByIdentifiers(identifiers: string[]): Promise<Map<string, BankContact>> {
    if (identifiers.length === 0) return new Map();
    const all = await db.select().from(bankContacts);
    const lowerSet = new Set(identifiers.map(i => i.toLowerCase().trim()));
    const matching = all.filter(r => lowerSet.has(r.identifier.toLowerCase().trim()));
    return new Map(matching.map(r => [r.identifier.toLowerCase().trim(), r]));
  },

  async createBankContact(data: InsertBankContact): Promise<BankContact> {
    // Normalize identifier to lowercase so lookups always match regardless of casing
    const [row] = await db.insert(bankContacts).values({
      ...data,
      identifier: data.identifier.toLowerCase().trim(),
    }).returning();
    return row;
  },

  async updateBankContact(id: number, data: Partial<Pick<BankContact, "displayName" | "type" | "entityId">>): Promise<BankContact> {
    const [row] = await db.update(bankContacts).set(data).where(eq(bankContacts.id, id)).returning();
    return row;
  },

  async deleteBankContact(id: number): Promise<void> {
    await db.delete(bankContacts).where(eq(bankContacts.id, id));
  },

  // ─── MP XLSX Movements (reporte de liquidaciones) ─────────────────────────

  async upsertMpXlsxMovements(rows: {
    mpId: string; fecha: string; fechaTs?: string | null; descripcion: string;
    montoBruto: number; montoNetoDebitado: number;
    montoNetoAcreditado: number; comision: number; feeAmount?: number | null;
  }[]): Promise<void> {
    if (rows.length === 0) return;
    await db.execute(drizzleSql`
      CREATE TABLE IF NOT EXISTS mp_xlsx_movements (
        mp_id TEXT PRIMARY KEY,
        fecha TEXT,
        descripcion TEXT,
        monto_bruto NUMERIC(12,2),
        monto_neto_debitado NUMERIC(12,2),
        monto_neto_acreditado NUMERIC(12,2),
        comision NUMERIC(12,2),
        synced_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    try { await db.execute(drizzleSql`ALTER TABLE mp_xlsx_movements ADD COLUMN IF NOT EXISTS fecha_ts TEXT`); } catch (_) {}
    try { await db.execute(drizzleSql`ALTER TABLE mp_xlsx_movements ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(12,2)`); } catch (_) {}
    for (const r of rows) {
      await db.execute(drizzleSql`
        INSERT INTO mp_xlsx_movements (mp_id, fecha, fecha_ts, descripcion, monto_bruto, monto_neto_debitado, monto_neto_acreditado, comision, fee_amount, synced_at)
        VALUES (${r.mpId}, ${r.fecha}, ${r.fechaTs ?? null}, ${r.descripcion}, ${r.montoBruto}, ${r.montoNetoDebitado}, ${r.montoNetoAcreditado}, ${r.comision}, ${r.feeAmount ?? null}, NOW())
        ON CONFLICT (mp_id) DO UPDATE
          SET fecha                = EXCLUDED.fecha,
              fecha_ts             = EXCLUDED.fecha_ts,
              descripcion          = EXCLUDED.descripcion,
              monto_bruto          = EXCLUDED.monto_bruto,
              monto_neto_debitado  = EXCLUDED.monto_neto_debitado,
              monto_neto_acreditado = EXCLUDED.monto_neto_acreditado,
              comision             = EXCLUDED.comision,
              fee_amount           = EXCLUDED.fee_amount,
              synced_at            = NOW()
      `);
    }
  },

  async getMpXlsxMovements(from?: string, to?: string): Promise<any[]> {
    await db.execute(drizzleSql`
      CREATE TABLE IF NOT EXISTS mp_xlsx_movements (
        mp_id TEXT PRIMARY KEY,
        fecha TEXT,
        descripcion TEXT,
        monto_bruto NUMERIC(12,2),
        monto_neto_debitado NUMERIC(12,2),
        monto_neto_acreditado NUMERIC(12,2),
        comision NUMERIC(12,2),
        synced_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Safe: from/to are always YYYY-MM-DD from our own route handler
    const safeFrom = from ? from.replace(/[^0-9\-]/g, "").slice(0, 10) : null;
    const safeTo   = to   ? to.replace(/[^0-9\-]/g, "").slice(0, 10)   : null;
    let where = "";
    if (safeFrom && safeTo) where = `WHERE fecha >= '${safeFrom}' AND fecha <= '${safeTo}'`;
    else if (safeFrom)      where = `WHERE fecha >= '${safeFrom}'`;
    else if (safeTo)        where = `WHERE fecha <= '${safeTo}'`;
    const rows = await db.execute(drizzleSql.raw(`
      SELECT mp_id, fecha, fecha_ts, descripcion,
             monto_bruto::float,
             monto_neto_debitado::float,
             monto_neto_acreditado::float,
             comision::float,
             fee_amount::float,
             synced_at
      FROM mp_xlsx_movements
      ${where}
      ORDER BY COALESCE(fecha_ts, fecha || 'T12:00:00') DESC
    `));
    return rows.rows as any[];
  },

  // ─── MP Movement Identifiers (settlement report) ──────────────────────────

  async upsertMpMovementIdentifiers(rows: { movementId: string; payerIdentifier: string; payerName?: string | null; rawExternalId?: string | null }[]): Promise<void> {
    if (rows.length === 0) return;
    await db.execute(drizzleSql`
      CREATE TABLE IF NOT EXISTS mp_movement_identifiers (
        movement_id TEXT PRIMARY KEY,
        payer_identifier TEXT NOT NULL,
        payer_name TEXT,
        raw_external_id TEXT,
        synced_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    for (const row of rows) {
      await db.execute(drizzleSql`
        INSERT INTO mp_movement_identifiers (movement_id, payer_identifier, payer_name, raw_external_id, synced_at)
        VALUES (${row.movementId}, ${row.payerIdentifier}, ${row.payerName ?? null}, ${row.rawExternalId ?? null}, NOW())
        ON CONFLICT (movement_id) DO UPDATE
          SET payer_identifier = EXCLUDED.payer_identifier,
              payer_name = EXCLUDED.payer_name,
              raw_external_id = EXCLUDED.raw_external_id,
              synced_at = NOW()
      `);
    }
  },

  async getMpMovementIdentifierMap(movementIds: string[]): Promise<Map<string, MpMovementIdentifier>> {
    if (movementIds.length === 0) return new Map();
    await db.execute(drizzleSql`
      CREATE TABLE IF NOT EXISTS mp_movement_identifiers (
        movement_id TEXT PRIMARY KEY,
        payer_identifier TEXT NOT NULL,
        payer_name TEXT,
        raw_external_id TEXT,
        synced_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    const escaped = movementIds.map(id => `'${id.replace(/'/g, "''")}'`).join(",");
    const rows = await db.execute(drizzleSql.raw(`
      SELECT movement_id, payer_identifier, payer_name, raw_external_id
      FROM mp_movement_identifiers
      WHERE movement_id IN (${escaped})
    `));
    return new Map((rows.rows as any[]).map(r => [r.movement_id, { movementId: r.movement_id, payerIdentifier: r.payer_identifier, payerName: r.payer_name, rawExternalId: r.raw_external_id, syncedAt: r.synced_at }]));
  },

  // ─── Bank Payment Links ────────────────────────────────────────────────────

  async getBankPaymentLinksByMovements(movementIds: string[]): Promise<Map<string, Array<{ id: number; pedidoId: number | null; montoAplicado: string; paymentId: number | null; folio: string | null }>>> {
    if (movementIds.length === 0) return new Map();
    const escaped = movementIds.map(id => `'${id.replace(/'/g, "''")}'`).join(",");
    const rows = await db.execute(drizzleSql.raw(`
      SELECT bpl.id, bpl.movement_id, bpl.pedido_id, bpl.monto_aplicado::text, o.folio, o.remito_num, o.invoice_number
      FROM bank_payment_links bpl
      LEFT JOIN orders o ON o.id = bpl.pedido_id
      WHERE bpl.movement_id IN (${escaped})
    `));
    const map = new Map<string, any[]>();
    for (const r of rows.rows as any[]) {
      const key = r.movement_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ id: r.id, pedidoId: r.pedido_id, montoAplicado: r.monto_aplicado, folio: r.folio, remitoNum: r.remito_num ?? null, invoiceNumber: r.invoice_number ?? null });
    }
    return map;
  },

  async applyBankMovementToOrders(data: {
    movementId: string;
    customerId: number;
    date: string;
    notes?: string;
    links: Array<{ pedidoId: number; montoAplicado: number }>;
    userId: number;
    galiciaId?: string;   // si viene, marca galicia_movements.asignacion_cc='asignado'
    loadCuit?: string;    // si el cliente no tiene CUIT, se lo carga (auto-match futuro)
  }): Promise<{ paymentId: number; bankLinks: any[]; cuitLoaded: boolean }> {
    const totalAmount = data.links.reduce((s, l) => s + l.montoAplicado, 0);
    const isGalicia = !!data.galiciaId;
    return await db.transaction(async (tx) => {
      // 1. Crear registro de pago en payments (actualiza CC automáticamente vía cálculo dinámico)
      const [payment] = await tx.insert(payments).values({
        customerId: data.customerId,
        date: data.date,
        amount: String(totalAmount.toFixed(2)),
        method: "TRANSFERENCIA" as any,
        notes: data.notes ?? `${isGalicia ? "Cobro Galicia" : "Pago MP"} — movimiento ${data.movementId}`,
        createdBy: data.userId,
      }).returning();

      // 2. Vincular pago a pedidos en payment_order_links (FIFO explícito)
      await tx.insert(paymentOrderLinks).values(
        data.links.map(l => ({
          paymentId: payment.id,
          orderId: l.pedidoId,
          amountApplied: String(l.montoAplicado.toFixed(2)),
        }))
      );

      // 3. Registrar vínculos en bank_payment_links (para UI de bancos)
      const bankLinks = await tx.insert(bankPaymentLinks).values(
        data.links.map(l => ({
          movementId: data.movementId,
          pedidoId: l.pedidoId,
          montoAplicado: String(l.montoAplicado.toFixed(2)),
        }))
      ).returning();

      // 4. Galicia: marcar el cobro como asignado (deja de figurar pendiente)
      if (data.galiciaId) {
        await tx.execute(drizzleSql`UPDATE galicia_movements SET asignacion_cc = 'asignado' WHERE id = ${data.galiciaId}`);
      }

      // 5. Cargar CUIT al cliente si no tenía (para que la próxima matchee sola). Solo si está vacío.
      let cuitLoaded = false;
      if (data.loadCuit && /^\d{11}$/.test(data.loadCuit)) {
        const r = await tx.execute(drizzleSql`UPDATE customers SET cuit = ${data.loadCuit} WHERE id = ${data.customerId} AND (cuit IS NULL OR cuit = '')`);
        cuitLoaded = ((r as any).rowCount ?? 0) > 0;
      }

      return { paymentId: payment.id, bankLinks, cuitLoaded };
    });
  },

  // Marca un cobro de Galicia como "ya registrado" a mano → NO toca la CC, deja de figurar pendiente.
  async marcarCobroGaliciaYaRegistrado(galiciaId: string): Promise<{ ok: boolean }> {
    await db.execute(drizzleSql`UPDATE galicia_movements SET asignacion_cc = 'ya_registrado' WHERE id = ${galiciaId}`);
    return { ok: true };
  },

  // Saldo CC de un proveedor = Σ compras − Σ pagos (misma fórmula que el módulo AP).
  async getSupplierSaldo(supplierId: number): Promise<number> {
    const r = (await db.execute(drizzleSql`
      SELECT COALESCE((SELECT sum(total::numeric) FROM purchases WHERE supplier_id = ${supplierId}), 0)
           - COALESCE((SELECT sum(amount::numeric) FROM supplier_payments WHERE supplier_id = ${supplierId}), 0) AS saldo
    `)).rows[0] as any;
    return Math.round(parseFloat(String(r?.saldo ?? 0)));
  },

  // Aplicar un movimiento de banco a la CC de un proveedor (espejo de applyBankMovementToOrders).
  // Crea un supplier_payment (baja la CC) con movement_ref = id del movimiento (anti-duplicado +
  // revert). Si es de Galicia, marca asignacion_cc='asignado'. dryRun = preview saldo, sin escribir.
  async applyBankMovementToSupplier(data: {
    movementId: string; supplierId: number; amount: number; date: string;
    method?: string; notes?: string; galiciaId?: string; userId?: number; dryRun?: boolean;
    purchaseIds?: number[];
  }): Promise<any> {
    // Anti-duplicado: si ya hay un supplier_payment con este movement_ref, no re-aplicar.
    const yaAplicado = (await db.execute(drizzleSql`SELECT id FROM supplier_payments WHERE movement_ref = ${data.movementId} LIMIT 1`)).rows[0] as any;
    if (yaAplicado) throw new Error("Este movimiento ya fue aplicado a un proveedor (no se duplica).");

    const saldoAntes = await this.getSupplierSaldo(data.supplierId);
    const saldoDespues = saldoAntes - Math.round(data.amount);

    if (data.dryRun) {
      const sup = (await db.execute(drizzleSql`SELECT name FROM suppliers WHERE id = ${data.supplierId}`)).rows[0] as any;
      return { dryRun: true, supplierId: data.supplierId, supplierName: sup?.name ?? null, amount: Math.round(data.amount), saldoAntes, saldoDespues };
    }

    const [pay] = await db.insert(supplierPayments).values({
      supplierId: data.supplierId, date: data.date, amount: String(data.amount.toFixed(2)),
      method: (data.method ?? "TRANSFERENCIA") as any, notes: data.notes ?? `Pago banco — movimiento ${data.movementId}`,
      movementRef: data.movementId, createdBy: data.userId ?? null,
    } as any).returning();

    // Imputar a las compras elegidas (o FIFO sobre todas si no se eligió ninguna)
    await this.applySupplierPaymentToPurchases(pay.id, data.supplierId, data.amount, data.purchaseIds);

    if (data.galiciaId) {
      await db.execute(drizzleSql`UPDATE galicia_movements SET asignacion_cc = 'asignado' WHERE id = ${data.galiciaId}`);
    }
    return { supplierPaymentId: pay.id, saldoAntes, saldoDespues };
  },

  // Marcar un pago a proveedor como "ya registrado" (NO toca CC). Galicia → asignacion_cc;
  // MP/otros → tabla bank_prov_registrado (los movimientos MP no tienen fila propia).
  async marcarPagoProveedorYaRegistrado(movementId: string): Promise<{ ok: boolean }> {
    if (movementId.startsWith("galicia:")) {
      await db.execute(drizzleSql`UPDATE galicia_movements SET asignacion_cc = 'ya_registrado' WHERE id = ${movementId}`);
    } else {
      await db.execute(drizzleSql`INSERT INTO bank_prov_registrado (movement_id) VALUES (${movementId}) ON CONFLICT (movement_id) DO NOTHING`);
    }
    return { ok: true };
  },

  // Sets para el endpoint MP: refs ya aplicados a un proveedor + movimientos marcados "ya registrado".
  async getAppliedSupplierRefs(): Promise<Set<string>> {
    const rows = (await db.execute(drizzleSql`SELECT movement_ref FROM supplier_payments WHERE movement_ref IS NOT NULL`)).rows as any[];
    return new Set(rows.map(r => String(r.movement_ref)));
  },
  async getProvRegistrados(): Promise<Set<string>> {
    try {
      const rows = (await db.execute(drizzleSql`SELECT movement_id FROM bank_prov_registrado`)).rows as any[];
      return new Set(rows.map(r => String(r.movement_id)));
    } catch { return new Set(); }
  },

  // ─── Cuentas Financieras ──────────────────────────────────────────────────

  async getCuentasFinancieras(): Promise<any[]> {
    const rows = await db.execute(drizzleSql.raw(`
      SELECT
        cf.id, cf.nombre, cf.tipo,
        cf.saldo_base::float AS saldo_base,
        cf.saldo_base_fecha, cf.orden, cf.updated_at,
        COALESCE(SUM(CASE
          WHEN mc.signo = 'ingreso'
           AND (cf.saldo_base_fecha IS NULL OR mc.fecha > cf.saldo_base_fecha)
          THEN mc.monto::float ELSE 0 END), 0) AS ajuste_ingresos,
        COALESCE(SUM(CASE
          WHEN mc.signo = 'egreso'
           AND (cf.saldo_base_fecha IS NULL OR mc.fecha > cf.saldo_base_fecha)
          THEN mc.monto::float ELSE 0 END), 0) AS ajuste_egresos
      FROM cuentas_financieras cf
      LEFT JOIN movimientos_cuenta mc ON mc.cuenta_id = cf.id
      GROUP BY cf.id
      ORDER BY cf.orden
    `));
    return (rows.rows as any[]).map(r => ({
      ...r,
      ajuste: (r.ajuste_ingresos ?? 0) - (r.ajuste_egresos ?? 0),
    }));
  },

  async updateCuentaFinanciera(id: number, saldoBase: number): Promise<void> {
    await db.execute(drizzleSql`
      UPDATE cuentas_financieras
      SET saldo_base = ${saldoBase}, saldo_base_fecha = NOW(), updated_at = NOW()
      WHERE id = ${id}
    `);
  },

  async createMovimientoCuenta(data: {
    cuentaId: number; signo: string; monto: number; comision?: number;
    concepto: string; origenTipo: string; origenId?: string | null; fecha?: Date;
  }): Promise<void> {
    const fecha = data.fecha ?? new Date();
    await db.execute(drizzleSql`
      INSERT INTO movimientos_cuenta
        (cuenta_id, fecha, signo, monto, comision, concepto, origen_tipo, origen_id)
      VALUES
        (${data.cuentaId}, ${fecha.toISOString()}, ${data.signo}, ${data.monto},
         ${data.comision ?? 0}, ${data.concepto}, ${data.origenTipo}, ${data.origenId ?? null})
      ON CONFLICT (origen_tipo, origen_id) WHERE origen_id IS NOT NULL DO NOTHING
    `);
  },

  async deleteMovimientoCuentaByOrigen(origenTipo: string, origenId: string): Promise<void> {
    await db.execute(drizzleSql`
      DELETE FROM movimientos_cuenta WHERE origen_tipo = ${origenTipo} AND origen_id = ${origenId}
    `);
  },

  // ─── Socios ─────────────────────────────────────────────────────────────────
  async getSocios(): Promise<any[]> {
    const rows = await db.execute(drizzleSql`
      SELECT id, nombre, activo FROM socios ORDER BY id ASC
    `);
    return rows.rows as any[];
  },

  // ─── Retiros ─────────────────────────────────────────────────────────────────
  async getCajaRetiros(): Promise<any[]> {
    const rows = await db.execute(drizzleSql`
      SELECT r.id, r.socio_id, s.nombre AS socio_nombre, r.monto::float,
             r.fecha, r.origen, r.movimiento_ref, r.notas, r.created_at
      FROM retiros r
      JOIN socios s ON s.id = r.socio_id
      ORDER BY r.fecha DESC, r.id DESC
    `);
    return rows.rows as any[];
  },

  async createRetiro(data: {
    socioId: number; monto: number; fecha: string;
    origen: string; movimientoRef?: string | null; notas?: string | null;
  }): Promise<any> {
    const row = await db.execute(drizzleSql`
      INSERT INTO retiros (socio_id, monto, fecha, origen, movimiento_ref, notas)
      VALUES (${data.socioId}, ${data.monto}, ${data.fecha}, ${data.origen},
        ${data.movimientoRef ?? null}, ${data.notas ?? null})
      ON CONFLICT (movimiento_ref) WHERE movimiento_ref IS NOT NULL DO NOTHING
      RETURNING id, socio_id, monto::float, fecha, origen, movimiento_ref, notas, created_at
    `);
    return (row.rows as any[])[0];
  },

  async deleteRetiro(id: number): Promise<void> {
    await db.execute(drizzleSql`DELETE FROM retiros WHERE id = ${id}`);
  },

  async deleteRetiroByMovimientoRef(ref: string): Promise<void> {
    await db.execute(drizzleSql`DELETE FROM retiros WHERE movimiento_ref = ${ref}`);
  },

  // ─── Cheques ────────────────────────────────────────────────────────────────
  async getCheques(): Promise<any[]> {
    const rows = await db.execute(drizzleSql`
      SELECT id, tipo, numero, monto::float, fecha_cobro, estado, contraparte, supplier_id,
             cuenta_destino_id, comision::float, obligacion_id, notas, created_at
      FROM cheques ORDER BY fecha_cobro ASC, id ASC
    `);
    return rows.rows as any[];
  },

  async createCheque(data: {
    tipo: string; monto: number; fechaCobro: string; estado?: string;
    contraparte: string; supplierId?: number | null; cuentaDestinoId?: number | null;
    comision?: number; obligacionId?: number | null; notas?: string | null;
    supplierPaymentId?: number | null; numero?: string | null; paymentId?: number | null;
  }): Promise<any> {
    const row = await db.execute(drizzleSql`
      INSERT INTO cheques (tipo, numero, monto, fecha_cobro, estado, contraparte, supplier_id,
        cuenta_destino_id, comision, obligacion_id, notas, supplier_payment_id, payment_id)
      VALUES (${data.tipo}, ${data.numero ?? null}, ${data.monto}, ${data.fechaCobro},
        ${data.estado ?? "en_cartera"}, ${data.contraparte}, ${data.supplierId ?? null},
        ${data.cuentaDestinoId ?? null}, ${data.comision ?? 0},
        ${data.obligacionId ?? null}, ${data.notas ?? null}, ${data.supplierPaymentId ?? null}, ${data.paymentId ?? null})
      RETURNING id, tipo, numero, monto::float, fecha_cobro, estado, contraparte, supplier_id,
        cuenta_destino_id, comision::float, obligacion_id, notas, created_at
    `);
    return (row.rows as any[])[0];
  },

  async patchCheque(id: number, data: {
    estado?: string; cuentaDestinoId?: number | null; comision?: number; contraparte?: string;
    supplierPaymentId?: number | null; fechaCobro?: string; monto?: number; numero?: string | null;
  }): Promise<any> {
    const row = await db.execute(drizzleSql`
      UPDATE cheques SET
        estado = COALESCE(${data.estado ?? null}, estado),
        cuenta_destino_id = CASE WHEN ${data.cuentaDestinoId !== undefined} THEN ${data.cuentaDestinoId ?? null} ELSE cuenta_destino_id END,
        comision = CASE WHEN ${data.comision !== undefined} THEN ${data.comision ?? 0}::numeric ELSE comision END,
        contraparte = COALESCE(${data.contraparte ?? null}, contraparte),
        fecha_cobro = COALESCE(${data.fechaCobro ?? null}, fecha_cobro),
        monto = CASE WHEN ${data.monto !== undefined} THEN ${data.monto ?? 0}::numeric ELSE monto END,
        numero = CASE WHEN ${data.numero !== undefined} THEN ${data.numero ?? null} ELSE numero END,
        supplier_payment_id = CASE WHEN ${data.supplierPaymentId !== undefined} THEN ${data.supplierPaymentId ?? null} ELSE supplier_payment_id END
      WHERE id = ${id}
      RETURNING id, tipo, numero, monto::float, fecha_cobro, estado, contraparte,
        cuenta_destino_id, comision::float, obligacion_id, notas, created_at
    `);
    return (row.rows as any[])[0];
  },

  async deleteCheque(id: number): Promise<void> {
    // Limpiar movimientos de cuenta que referencien este cheque (ingreso en cartera, depósito, etc.)
    for (const origen of ["cheque_recibido", "cheque_deposito_destino", "cheque_depositado", "cheque_endosado"]) {
      await this.deleteMovimientoCuentaByOrigen(origen, String(id));
    }
    await db.execute(drizzleSql`DELETE FROM cheques WHERE id = ${id}`);
  },

  // ─── Obligaciones ───────────────────────────────────────────────────────────
  async getObligaciones(): Promise<any[]> {
    const rows = await db.execute(drizzleSql`
      SELECT id, concepto, tipo, monto::float, moneda, pago_parcial, fecha_vencimiento,
             estado, grupo_cuota, numero_cuota, total_cuotas,
             notas, pagado_at, cuenta_pago_id, created_at
      FROM obligaciones
      ORDER BY fecha_vencimiento ASC, id ASC
    `);
    return rows.rows as any[];
  },

  // Historial de pagos (parciales/total) de una obligación
  async getObligacionPagos(obligacionId: number): Promise<ObligacionPagoRow[]> {
    const rows = await db.execute(drizzleSql`
      SELECT id, obligacion_id, fecha, monto::float, moneda, cotizacion::float, monto_ars::float, cuenta_pago_id, created_at
      FROM obligacion_pagos WHERE obligacion_id = ${obligacionId}
      ORDER BY created_at ASC, id ASC
    `);
    return rows.rows as ObligacionPagoRow[];
  },

  // tx opcional → permite registrar el pago dentro de la misma transacción que el pago a la
  // obligación (ver payObligacion), para que no quede una obligación pagada sin su registro.
  async addObligacionPago(data: {
    obligacionId: number; fecha: string; monto: number; moneda: string;
    cotizacion?: number | null; montoArs: number; cuentaPagoId?: number | null;
  }, tx: any = db): Promise<ObligacionPagoRow> {
    const row = await tx.execute(drizzleSql`
      INSERT INTO obligacion_pagos (obligacion_id, fecha, monto, moneda, cotizacion, monto_ars, cuenta_pago_id)
      VALUES (${data.obligacionId}, ${data.fecha}, ${data.monto}, ${data.moneda},
        ${data.cotizacion ?? null}, ${data.montoArs}, ${data.cuentaPagoId ?? null})
      RETURNING id, obligacion_id, fecha, monto::float, moneda, cotizacion::float, monto_ars::float, cuenta_pago_id, created_at
    `);
    return (row.rows as ObligacionPagoRow[])[0];
  },

  // (c) Pagar una obligación de forma ATÓMICA: aplica el pago a la obligación Y registra el
  // pago en el historial en UNA sola transacción. Si el registro falla, se revierte todo →
  // es IMPOSIBLE que quede una obligación pagada sin su registro de pago.
  async payObligacion(
    id: number,
    patch: Parameters<typeof storage.patchObligacion>[1],
    pago: { fecha: string; monto: number; moneda: string; cotizacion?: number | null; montoArs: number; cuentaPagoId?: number | null },
  ): Promise<{ obligacion: any; pago: ObligacionPagoRow }> {
    return db.transaction(async (tx) => {
      const obligacion = await this.patchObligacion(id, patch, tx);
      const pagoRow = await this.addObligacionPago({ obligacionId: id, ...pago }, tx);
      return { obligacion, pago: pagoRow };
    });
  },

  async createObligaciones(items: {
    concepto: string; tipo: string; monto: number; moneda?: string;
    fechaVencimiento: string; grupoCuota?: string | null;
    numeroCuota?: number | null; totalCuotas?: number | null; notas?: string | null;
  }[]): Promise<any[]> {
    const result: any[] = [];
    for (const item of items) {
      const row = await db.execute(drizzleSql`
        INSERT INTO obligaciones (concepto, tipo, monto, moneda, fecha_vencimiento,
          grupo_cuota, numero_cuota, total_cuotas, notas)
        VALUES (${item.concepto}, ${item.tipo}, ${item.monto}, ${item.moneda ?? "ARS"}, ${item.fechaVencimiento},
          ${item.grupoCuota ?? null}, ${item.numeroCuota ?? null},
          ${item.totalCuotas ?? null}, ${item.notas ?? null})
        RETURNING id, concepto, tipo, monto::float, moneda, fecha_vencimiento,
          estado, grupo_cuota, numero_cuota, total_cuotas, notas, created_at
      `);
      result.push((row.rows as any[])[0]);
    }
    return result;
  },

  async patchObligacion(id: number, data: {
    estado?: string; cuentaPagoId?: number | null; pagadoAt?: string | null;
    monto?: string; moneda?: string; concepto?: string; tipo?: string;
    fechaVencimiento?: string; notas?: string | null; pagoParcial?: boolean;
  }, tx: any = db): Promise<any> {
    const row = await tx.execute(drizzleSql`
      UPDATE obligaciones
      SET estado = COALESCE(${data.estado ?? null}, estado),
          cuenta_pago_id = CASE WHEN ${data.cuentaPagoId !== undefined} THEN ${data.cuentaPagoId ?? null} ELSE cuenta_pago_id END,
          pagado_at = CASE WHEN ${data.pagadoAt !== undefined} THEN ${data.pagadoAt ?? null}::timestamp ELSE pagado_at END,
          monto = CASE WHEN ${data.monto !== undefined} THEN ${data.monto ?? null}::numeric ELSE monto END,
          moneda = COALESCE(${data.moneda ?? null}, moneda),
          pago_parcial = CASE WHEN ${data.pagoParcial !== undefined} THEN ${data.pagoParcial ?? false} ELSE pago_parcial END,
          concepto = COALESCE(${data.concepto ?? null}, concepto),
          tipo = COALESCE(${data.tipo ?? null}, tipo),
          fecha_vencimiento = COALESCE(${data.fechaVencimiento ?? null}, fecha_vencimiento),
          notas = CASE WHEN ${data.notas !== undefined} THEN ${data.notas ?? null} ELSE notas END
      WHERE id = ${id}
      RETURNING id, concepto, tipo, monto::float, moneda, pago_parcial, fecha_vencimiento,
        estado, grupo_cuota, numero_cuota, total_cuotas, notas, pagado_at, cuenta_pago_id
    `);
    return (row.rows as any[])[0];
  },

  async updateObligacionesGrupo(grupoCuota: string, fromId: number, data: {
    concepto?: string; tipo?: string; monto?: string; moneda?: string; notas?: string | null;
  }): Promise<void> {
    // Updates all pending obligations in the same group that come after (by fecha_vencimiento >= that of fromId)
    // We use id >= fromId as a proxy for "same or future"
    await db.execute(drizzleSql`
      UPDATE obligaciones
      SET concepto = COALESCE(${data.concepto ?? null}, concepto),
          tipo     = COALESCE(${data.tipo ?? null}, tipo),
          monto    = CASE WHEN ${data.monto !== undefined} THEN ${data.monto ?? null}::numeric ELSE monto END,
          moneda   = COALESCE(${data.moneda ?? null}, moneda),
          notas    = CASE WHEN ${data.notas !== undefined} THEN ${data.notas ?? null} ELSE notas END
      WHERE grupo_cuota = ${grupoCuota}
        AND id >= ${fromId}
        AND estado = 'pendiente'
    `);
  },

  async deleteObligacion(id: number): Promise<void> {
    await db.execute(drizzleSql`DELETE FROM obligaciones WHERE id = ${id}`);
  },
};
