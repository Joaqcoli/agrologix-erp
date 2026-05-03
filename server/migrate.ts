import { db, pool } from "./db";
import { sql } from "drizzle-orm";

export async function runMigrations() {
  console.log("Running migrations...");

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE role AS ENUM ('admin', 'operator');
    EXCEPTION WHEN duplicate_object THEN null; END $$;
  `);

  await db.execute(sql`
    DO $$ BEGIN
      ALTER TYPE role ADD VALUE IF NOT EXISTS 'vendedor';
    EXCEPTION WHEN others THEN null; END $$;
  `);

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE movement_type AS ENUM ('in', 'out');
    EXCEPTION WHEN duplicate_object THEN null; END $$;
  `);

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE unit AS ENUM ('kg', 'pz', 'caja', 'saco', 'litro', 'tonelada');
    EXCEPTION WHEN duplicate_object THEN null; END $$;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role role NOT NULL DEFAULT 'operator',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      rfc TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      notes TEXT,
      has_iva BOOLEAN NOT NULL DEFAULT false,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS has_iva BOOLEAN NOT NULL DEFAULT false
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT NOT NULL UNIQUE,
      description TEXT,
      unit unit NOT NULL DEFAULT 'kg',
      average_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
      current_stock NUMERIC(12,4) NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS purchases (
      id SERIAL PRIMARY KEY,
      folio TEXT NOT NULL UNIQUE,
      supplier_name TEXT NOT NULL,
      purchase_date TIMESTAMP NOT NULL DEFAULT now(),
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS purchase_items (
      id SERIAL PRIMARY KEY,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity NUMERIC(12,4) NOT NULL,
      unit unit NOT NULL,
      cost_per_unit NUMERIC(12,4) NOT NULL,
      subtotal NUMERIC(12,2) NOT NULL
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      movement_type movement_type NOT NULL,
      quantity NUMERIC(12,4) NOT NULL,
      unit_cost NUMERIC(12,4),
      reference_id INTEGER,
      reference_type TEXT,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS product_cost_history (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      average_cost NUMERIC(12,4) NOT NULL,
      previous_cost NUMERIC(12,4),
      purchase_id INTEGER REFERENCES purchases(id),
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  // ─── Orders ─────────────────────────────────────────────────────────────────
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE order_status AS ENUM ('draft', 'approved', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN null; END $$;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      folio TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      order_date TIMESTAMP NOT NULL DEFAULT now(),
      status order_status NOT NULL DEFAULT 'draft',
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      notes TEXT,
      low_margin_confirmed BOOLEAN NOT NULL DEFAULT false,
      remito_id INTEGER,
      created_by INTEGER REFERENCES users(id),
      approved_by INTEGER REFERENCES users(id),
      approved_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id),
      quantity NUMERIC(12,4) NOT NULL,
      unit unit NOT NULL DEFAULT 'kg',
      price_per_unit NUMERIC(12,4),
      cost_per_unit NUMERIC(12,4) NOT NULL DEFAULT 0,
      margin NUMERIC(8,4),
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      raw_product_name TEXT,
      parse_status TEXT
    )
  `);

  await db.execute(sql`ALTER TABLE order_items ALTER COLUMN product_id DROP NOT NULL`);
  await db.execute(sql`ALTER TABLE order_items ALTER COLUMN price_per_unit DROP NOT NULL`);
  await db.execute(sql`ALTER TABLE order_items ALTER COLUMN cost_per_unit SET DEFAULT 0`);
  await db.execute(sql`ALTER TABLE order_items ALTER COLUMN subtotal SET DEFAULT 0`);
  await db.execute(sql`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS raw_product_name TEXT`);
  await db.execute(sql`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS parse_status TEXT`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS price_history (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      price_per_unit NUMERIC(12,4) NOT NULL,
      order_id INTEGER REFERENCES orders(id),
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS remitos (
      id SERIAL PRIMARY KEY,
      folio TEXT NOT NULL UNIQUE,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      issued_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  // ─── Product Units (multi-unit stock + cost per product) ─────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS product_units (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      unit TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      avg_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
      stock_qty NUMERIC(12,4) NOT NULL DEFAULT 0,
      UNIQUE(product_id, unit)
    )
  `);

  // Populate product_units from existing products (idempotent: INSERT ... ON CONFLICT DO NOTHING)
  await db.execute(sql`
    INSERT INTO product_units (product_id, unit, is_active, avg_cost, stock_qty)
    SELECT id,
      CASE unit::text
        WHEN 'caja' THEN 'CAJON'
        WHEN 'saco' THEN 'BOLSA'
        WHEN 'kg'   THEN 'KG'
        WHEN 'pz'   THEN 'PZ'
        WHEN 'litro' THEN 'LITRO'
        WHEN 'tonelada' THEN 'TONELADA'
        ELSE upper(unit::text)
      END,
      active,
      average_cost,
      current_stock
    FROM products
    ON CONFLICT (product_id, unit) DO NOTHING
  `);

  // A) Make SKU nullable (drop NOT NULL constraint)
  await db.execute(sql`
    ALTER TABLE products ALTER COLUMN sku DROP NOT NULL
  `);

  // D) Add category column to products
  await db.execute(sql`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Verdura'
  `);

  // Backfill existing products with default category
  await db.execute(sql`
    UPDATE products SET category = 'Verdura' WHERE category IS NULL
  `);

  // Add override_cost_per_unit to order_items
  await db.execute(sql`
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS override_cost_per_unit NUMERIC(12,4)
  `);

  // ─── Cuentas Corrientes ─────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      date TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      method TEXT NOT NULL DEFAULT 'EFECTIVO',
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS withholdings (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      date TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      type TEXT NOT NULL DEFAULT 'IIBB',
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  // Extend unit enum with new values (idempotent: IF NOT EXISTS)
  for (const val of ["CAJON", "maple", "atado", "bandeja", "KG", "UNIDAD", "BOLSA", "MAPLE", "ATADO", "BANDEJA"]) {
    await db.execute(sql.raw(`ALTER TYPE unit ADD VALUE IF NOT EXISTS '${val}'`));
  }

  // ─── purchase_items: original purchase unit context columns ─────────────────
  await db.execute(sql`ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS purchase_qty NUMERIC(12,4)`);
  await db.execute(sql`ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS purchase_unit unit`);
  await db.execute(sql`ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS weight_per_package NUMERIC(12,4)`);

  // ─── product_units: base unit tracking for composite unit model ──────────────
  await db.execute(sql`ALTER TABLE product_units ADD COLUMN IF NOT EXISTS weight_per_unit NUMERIC(10,4) DEFAULT 0`);
  await db.execute(sql`ALTER TABLE product_units ADD COLUMN IF NOT EXISTS base_unit TEXT`);

  // ─── Cuentas Corrientes v2 ───────────────────────────────────────────────────
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_number text`);
  await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS cc_type text DEFAULT 'por_saldo'`);
  await db.execute(sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS order_id INTEGER REFERENCES orders(id)`);

  // ─── Cuentas Corrientes v3: multi-order payment links ───────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS payment_order_links (
      id SERIAL PRIMARY KEY,
      payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      order_id   INTEGER NOT NULL REFERENCES orders(id)  ON DELETE CASCADE,
      UNIQUE(payment_id, order_id)
    )
  `);

  // ─── Proveedores (AP module) ─────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS suppliers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      email TEXT,
      cuit TEXT,
      notes TEXT,
      cc_type TEXT DEFAULT 'por_saldo',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS supplier_payments (
      id SERIAL PRIMARY KEY,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      date TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      method TEXT NOT NULL DEFAULT 'EFECTIVO',
      notes TEXT,
      purchase_id INTEGER REFERENCES purchases(id),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id)`);
  await db.execute(sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cuenta_corriente'`);
  await db.execute(sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT false`);

  // ─── Vacíos (empty packaging cost) ──────────────────────────────────────────
  await db.execute(sql`ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS empty_cost numeric(12,4) DEFAULT 0`);
  await db.execute(sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS total_empty_cost numeric(12,2) DEFAULT 0`);

  // Backfill: recalculate total to include total_empty_cost for existing purchases
  await db.execute(sql`
    UPDATE purchases
    SET total = (
      SELECT COALESCE(SUM(pi.subtotal), 0) + purchases.total_empty_cost
      FROM purchase_items pi
      WHERE pi.purchase_id = purchases.id
    )
    WHERE total_empty_cost > 0
  `);

  // ─── Customers: salesperson & commission ────────────────────────────────────
  await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS salesperson_name text`);
  await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS commission_pct numeric(5,2) DEFAULT 0`);
  await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS bolsa_fv boolean DEFAULT false`);

  // ─── Bolsa FV en pedidos ─────────────────────────────────────────────────────
  await db.execute(sql`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS bolsa_type text`);

  // ─── Saldo inicial de cuentas corrientes ──────────────────────────────────────
  await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS opening_balance numeric(12,2) NOT NULL DEFAULT 0`);

  // ─── Estandarización de unidades canónicas ───────────────────────────────────
  // Migrate products.unit (enum column) → canonical uppercase
  for (const [from, to] of [["kg","KG"],["pz","UNIDAD"],["caja","CAJON"],["saco","BOLSA"],["maple","MAPLE"],["atado","ATADO"],["bandeja","BANDEJA"],["litro","KG"],["tonelada","KG"]]) {
    await db.execute(sql.raw(`UPDATE products SET unit = '${to}'::unit WHERE unit::text = '${from}'`));
  }

  // Migrate purchase_items.unit (enum column)
  for (const [from, to] of [["kg","KG"],["pz","UNIDAD"],["caja","CAJON"],["saco","BOLSA"],["maple","MAPLE"],["atado","ATADO"],["bandeja","BANDEJA"],["litro","KG"],["tonelada","KG"]]) {
    await db.execute(sql.raw(`UPDATE purchase_items SET unit = '${to}'::unit WHERE unit::text = '${from}'`));
  }

  // Migrate purchase_items.purchase_unit (nullable enum column)
  for (const [from, to] of [["kg","KG"],["pz","UNIDAD"],["caja","CAJON"],["saco","BOLSA"],["maple","MAPLE"],["atado","ATADO"],["bandeja","BANDEJA"],["litro","KG"],["tonelada","KG"]]) {
    await db.execute(sql.raw(`UPDATE purchase_items SET purchase_unit = '${to}'::unit WHERE purchase_unit::text = '${from}'`));
  }

  // Migrate order_items.unit (TEXT column)
  await db.execute(sql.raw(`
    UPDATE order_items SET unit = CASE unit
      WHEN 'kg' THEN 'KG' WHEN 'pz' THEN 'UNIDAD'
      WHEN 'caja' THEN 'CAJON' WHEN 'saco' THEN 'BOLSA'
      WHEN 'maple' THEN 'MAPLE' WHEN 'atado' THEN 'ATADO'
      WHEN 'bandeja' THEN 'BANDEJA' WHEN 'litro' THEN 'KG' WHEN 'tonelada' THEN 'KG'
      ELSE unit END
    WHERE unit IN ('kg','pz','caja','saco','maple','atado','bandeja','litro','tonelada')
  `));

  // Update column defaults
  await db.execute(sql.raw(`ALTER TABLE products ALTER COLUMN unit SET DEFAULT 'KG'`));
  await db.execute(sql.raw(`ALTER TABLE order_items ALTER COLUMN unit SET DEFAULT 'KG'`));

  // ─── Grupos de clientes (parent-child) ──────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS
    parent_customer_id integer REFERENCES customers(id)
  `);

  // ─── purchase_items: costo por unidad de compra original ─────────────────
  await db.execute(sql`ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS cost_per_purchase_unit NUMERIC(12,2)`);

  // ─── orders: número de remito del papel (del Excel de días) ───────────────
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS remito_num integer`);

  // ─── Grupos de clientes con precios compartidos ───────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_group_members (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES client_groups(id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      UNIQUE(group_id, customer_id)
    )
  `);
  await db.execute(sql`
    INSERT INTO client_groups (name)
    VALUES ('BLACK POT'), ('LUSQTOFF'), ('QUINQUELA-MARQUESA'), ('COMO SIEMPRE-MESTIZO')
    ON CONFLICT (name) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO client_group_members (group_id, customer_id)
    SELECT g.id, c.id FROM client_groups g CROSS JOIN customers c
    WHERE g.name = 'BLACK POT' AND c.name ILIKE '%COLEGIO%' AND c.active = true
    ON CONFLICT (group_id, customer_id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO client_group_members (group_id, customer_id)
    SELECT g.id, c.id FROM client_groups g CROSS JOIN customers c
    WHERE g.name = 'LUSQTOFF' AND c.name ILIKE '%LUSQTOFF%'
    ON CONFLICT (group_id, customer_id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO client_group_members (group_id, customer_id)
    SELECT g.id, c.id FROM client_groups g CROSS JOIN customers c
    WHERE g.name = 'QUINQUELA-MARQUESA' AND c.name IN ('QUINQUELA', 'LA MARQUESA')
    ON CONFLICT (group_id, customer_id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO client_group_members (group_id, customer_id)
    SELECT g.id, c.id FROM client_groups g CROSS JOIN customers c
    WHERE g.name = 'COMO SIEMPRE-MESTIZO' AND c.name IN ('COMO SIEMPRE LAGUNA', 'MESTIZO')
    ON CONFLICT (group_id, customer_id) DO NOTHING
  `);

  // ─── price_history: track unit per price record ──────────────────────────────
  await db.execute(sql`ALTER TABLE price_history ADD COLUMN IF NOT EXISTS unit TEXT`);

  console.log("Migrations complete.");
}
