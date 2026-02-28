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

  console.log("Migrations complete.");
}
