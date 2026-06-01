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

  // ─── CC v4: amount applied per payment-order link ───────────────────────────
  await db.execute(sql`ALTER TABLE payment_order_links ADD COLUMN IF NOT EXISTS amount_applied numeric`);

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

  // ─── Reactivar product_units con stock > 0 que fueron desactivados ────────────
  // Bug: createPurchase/updatePurchase no seteaba isActive=true al actualizar filas.
  // Si una fila fue desactivada desde la vista de stock y luego se cargó una compra,
  // el stock se actualizaba pero la fila seguía oculta. Este UPDATE lo corrige.
  await db.execute(sql`
    UPDATE product_units SET is_active = true
    WHERE is_active = false AND stock_qty > 0
  `);

  // Bug: updatePurchase (y rutas antiguas) podían setear base_unit en rows de unidades de envase
  // (CAJON/BOLSA/BANDEJA), haciendo que approveOrder los eligiera como fila base en lugar del row KG real.
  // Este UPDATE limpia esos rows incorrectos. Solo afecta rows de envase que nunca deberían tener base_unit.
  await db.execute(sql`
    UPDATE product_units SET base_unit = NULL
    WHERE unit IN ('CAJON','BOLSA','BANDEJA') AND base_unit IS NOT NULL
  `);

  // Fix: para productos Huevos, la fila MAPLE siempre tiene weight_per_unit = 12 (1 CAJON = 12 MAPLES).
  // Si weight_per_unit era 0 o null (ej. stock cargado via pase de stock en lugar de compra),
  // el costo por CAJON resultaba $0 porque no podía resolver el wpu. Este UPDATE lo corrige.
  await db.execute(sql`
    UPDATE product_units pu
    SET weight_per_unit = 12
    FROM products p
    WHERE pu.product_id = p.id
      AND p.category = 'Huevos'
      AND pu.unit = 'MAPLE'
      AND (pu.weight_per_unit IS NULL OR pu.weight_per_unit = 0)
  `);

  // Backfill: propagar weight_per_unit a filas MAPLE de cualquier producto
  // que tenga purchase_items con weightPerPackage > 0 pero sin weight_per_unit seteado.
  // Cubre todos los casos (no solo Huevos) donde el wpu fue registrado en compras pero no en product_units.
  await db.execute(sql`
    UPDATE product_units pu
    SET weight_per_unit = sub.wpu
    FROM (
      SELECT DISTINCT ON (pi.product_id) pi.product_id, pi.weight_per_package::numeric AS wpu
      FROM purchase_items pi
      WHERE pi.weight_per_package::numeric > 0
      ORDER BY pi.product_id, pi.id DESC
    ) sub
    WHERE pu.product_id = sub.product_id
      AND pu.unit NOT IN ('CAJON','BOLSA','BANDEJA')
      AND (pu.weight_per_unit IS NULL OR pu.weight_per_unit = 0)
  `);

  // ─── Lista de Precios ────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS price_list_items (
      id              SERIAL PRIMARY KEY,
      category        TEXT NOT NULL,
      product_name    TEXT NOT NULL,
      price_per_cajon NUMERIC(12,2) NOT NULL DEFAULT 0,
      price_per_kg    NUMERIC(12,2) NOT NULL DEFAULT 0,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      active          BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  // Migrate from single-price schema (first deploy) to dual-price
  await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS price_per_cajon NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS price_per_kg    NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE price_list_items DROP COLUMN IF EXISTS unit`);
  await db.execute(sql`ALTER TABLE price_list_items DROP COLUMN IF EXISTS price`);

  // Seed initial price list (only if table is empty)
  await db.execute(sql`
    INSERT INTO price_list_items (category, product_name, price_per_cajon, price_per_kg, sort_order)
    SELECT v.category, v.product_name, v.price_per_cajon, v.price_per_kg, v.sort_order
    FROM (VALUES
      ('Verdura','Acelga',15000,1500,0),
      ('Verdura','Albahaca (12 Atados)',10000,1000,1),
      ('Verdura','Achicoria',13000,0,2),
      ('Verdura','Akusay',14000,0,3),
      ('Verdura','Pack Choi',12000,0,4),
      ('Verdura','Apio',14000,1500,5),
      ('Verdura','Brocoli Grande',24000,3200,6),
      ('Verdura','Bruselas (Bandeja)',0,2500,7),
      ('Verdura','Cebolla de Verdeo',0,5000,8),
      ('Verdura','Coliflor',19000,2500,9),
      ('Verdura','Espinaca',11000,1200,10),
      ('Verdura','Lechuga Capuccina',25000,4000,11),
      ('Verdura','Lechuga Morada',12000,4500,12),
      ('Verdura','Lechuga Criolla',18000,4000,13),
      ('Verdura','Lechuga Francesa',14000,3500,14),
      ('Verdura','Lechuga Manteca',18000,4000,15),
      ('Verdura','Perejil',0,3000,16),
      ('Verdura','Puerro',0,4000,17),
      ('Verdura','Rabanito',0,750,18),
      ('Verdura','Repollo Blanco',15000,1800,19),
      ('Verdura','Repollo Rojo',15000,1800,20),
      ('Verdura','Remolacha S/Hojas',15000,1900,21),
      ('Verdura','Rucula (24 Atados)',10000,500,22),
      ('Fruta','Banana Ecuador',38000,2800,0),
      ('Fruta','Banana Bolivia',30000,0,1),
      ('Fruta','Banana Paraguay',30000,0,2),
      ('Fruta','Ciruela Mediana',40000,4000,3),
      ('Fruta','Ciruela Grande -Chile-',0,0,4),
      ('Fruta','Durazno Amarillo Grande',0,0,5),
      ('Fruta','Durazno Amarillo Comercial (Chico)',0,0,6),
      ('Fruta','Durazno Japones (Chato)',0,0,7),
      ('Fruta','Pelon Amarillo Chico',0,0,8),
      ('Fruta','Pelon Blanco Grande',0,0,9),
      ('Fruta','Pelon Amarillo Grande',0,0,10),
      ('Fruta','Frutilla 4 Kg - Tamara - Cubetas',80000,20000,11),
      ('Fruta','Frutilla a Granel 5 Kg',0,0,12),
      ('Fruta','Kiwi',55000,8200,13),
      ('Fruta','Lima Brasil',0,4000,14),
      ('Fruta','Limon Mediano Nacional',13000,1400,15),
      ('Fruta','Limon Comercial Oferta',0,0,16),
      ('Fruta','Arandano 12 Cubetas',0,0,17),
      ('Fruta','Mango',22000,2500,18),
      ('Fruta','Manzana Red Comercial Chica',33000,0,19),
      ('Fruta','Manzana Gala Elegida',0,0,20),
      ('Fruta','Manzana Granny Comercial',48000,3200,21),
      ('Fruta','Manzana Granny Premium',76000,4500,22),
      ('Fruta','Manzana Red Comercial',41000,0,23),
      ('Fruta','Manzana Red Elegida',62000,3800,24),
      ('Fruta','Mandarina Okitsu',17000,1300,25),
      ('Fruta','Mandarina Criolla',25000,0,26),
      ('Fruta','Naranja Jugo Comercial (Mediano/Chica)',16000,1300,27),
      ('Fruta','Naranja Jugo Elegida (Grande)',20000,0,28),
      ('Fruta','Palta T.84 Peru',65000,1000,29),
      ('Fruta','Palta Hass Chile',95000,0,30),
      ('Fruta','Palta Brasil 10 Kg',25000,0,31),
      ('Fruta','Pomelo Egipto',36000,0,32),
      ('Fruta','Pomelo Nacional Comercial',21000,1800,33),
      ('Fruta','Sandia x Kg',0,0,34),
      ('Fruta','Uva Blanca S/Semilla Brasil',50000,7500,35),
      ('Fruta','Uva Blanca Superior Nacional',35000,0,36),
      ('Fruta','Uva Red Globe Nacional',35000,4500,37),
      ('Fruta','Pera Caja Elegida 18 Kg',33000,2400,38),
      ('Fruta','Pera Comercial Torito',29000,0,39),
      ('Fruta','Piña Ecuador',32000,0,40),
      ('Hortaliza Liviana','Aji Vinagre',15000,0,0),
      ('Hortaliza Liviana','Berenjena Negra',20000,2600,1),
      ('Hortaliza Liviana','Chaucha Rolliza',30000,4500,2),
      ('Hortaliza Liviana','Choclo',34000,800,3),
      ('Hortaliza Liviana','Esparrago',0,0,4),
      ('Hortaliza Liviana','Esparrago Elegido',0,0,5),
      ('Hortaliza Liviana','Pepino',30000,2600,6),
      ('Hortaliza Liviana','Morron Amarillo',19000,3000,7),
      ('Hortaliza Liviana','Morron Rojo Corrientes',22000,3200,8),
      ('Hortaliza Liviana','Morron Rojo Norte',30000,0,9),
      ('Hortaliza Liviana','Morron Verde Grande',16000,2400,10),
      ('Hortaliza Liviana','Tomate Cherry Cajon Norte',30000,3600,11),
      ('Hortaliza Liviana','Tomate Cherry Bandeja',20000,0,12),
      ('Hortaliza Liviana','Tomate Cherry Amarillo Cajon',30000,0,13),
      ('Hortaliza Liviana','Tomate Perita Mendoza',32000,0,14),
      ('Hortaliza Liviana','Tomate Perita Norte',34000,2500,15),
      ('Hortaliza Liviana','Tomate Redondo Norte',34000,2500,16),
      ('Hortaliza Liviana','Zapallito Largo',32000,2400,17),
      ('Hortaliza Liviana','Zapallito Redondo',30000,2200,18),
      ('Hortaliza Pesada','Ajo Grande',30000,900,0),
      ('Hortaliza Pesada','Batata',16000,1600,1),
      ('Hortaliza Pesada','Boniato',25000,2600,2),
      ('Hortaliza Pesada','Cebolla Maquinada',17000,0,3),
      ('Hortaliza Pesada','Cebolla Comun',15000,0,4),
      ('Hortaliza Pesada','Cebollon',15000,1000,5),
      ('Hortaliza Pesada','Cebollon Morada Brasil',22000,1700,6),
      ('Hortaliza Pesada','Cebolla Morada',18000,0,7),
      ('Hortaliza Pesada','Papa Cepillada -Innoveitor-',24000,0,8),
      ('Hortaliza Pesada','Papa Cepillada Comun',22000,0,9),
      ('Hortaliza Pesada','Papa Lavada Sagitta',30000,1900,10),
      ('Hortaliza Pesada','Zanahoria Comercial Industrial 19 Kg',15000,0,11),
      ('Hortaliza Pesada','Zanahoria Elegida Cubito',12000,1500,12),
      ('Hortaliza Pesada','Zanahoria Elegida Caja 20 Kg Brasil',21000,0,13),
      ('Hortaliza Pesada','Zapallo Anco Comun Comercial',12000,0,14),
      ('Hortaliza Pesada','Zapallo Anco Coquena Elegido',13000,1000,15),
      ('Hortaliza Pesada','Zapallo Cabutia',14000,1400,16),
      ('Hortaliza Pesada','Zapallo Princesa',14000,1400,17),
      ('Hongos/Hierbas','Brote de Soja',0,4000,0),
      ('Hongos/Hierbas','Brote de Alfalfa / Rabanito / Remolacha',0,3500,1),
      ('Hongos/Hierbas','Champignon Bandeja x 200 Gr',0,5500,2),
      ('Hongos/Hierbas','Champignon x Kilo',0,21000,3),
      ('Hongos/Hierbas','Flores Comestibles en Bandeja',0,6000,4),
      ('Hongos/Hierbas','Portobello por Kg',0,22000,5),
      ('Hongos/Hierbas','Girgolas-Portobello Bandeja x 200 Gr',0,6000,6),
      ('Hongos/Hierbas','Hongos de Pino x 250Gr',0,14000,7),
      ('Hongos/Hierbas','Ciboullete',0,3500,8),
      ('Hongos/Hierbas','Cilantro',0,2500,9),
      ('Hongos/Hierbas','Laurel',0,3000,10),
      ('Hongos/Hierbas','Menta',0,3000,11),
      ('Hongos/Hierbas','Romero',0,3000,12),
      ('Hongos/Hierbas','Eneldo',0,3000,13),
      ('Hongos/Hierbas','Salvia',0,3000,14),
      ('Hongos/Hierbas','Tomillo',0,3000,15),
      ('Hongos/Hierbas','Aji Jalapeños x Kg',0,12000,16),
      ('Hongos/Hierbas','Aji Rocoto x Kg',0,12000,17),
      ('Hongos/Hierbas','Aji Limo x Kg',0,12000,18),
      ('Hongos/Hierbas','Aji Peruano x Kg',0,22000,19),
      ('Hongos/Hierbas','Aji Panka Seco x Kg',0,23000,20),
      ('Hongos/Hierbas','Nabo Blanco x Atado (2/3 Unidades)',0,6000,21),
      ('Hongos/Hierbas','Papin x Kg',0,4000,22),
      ('Hongos/Hierbas','Pepinillos x Kg',0,15000,23),
      ('Hongos/Hierbas','Echalote x Kg',0,23000,24),
      ('Hongos/Hierbas','Jengibre x Kg',0,10000,25),
      ('Huevos','Huevo Nro 1',54000,4600,0),
      ('Huevos','Huevo Nro 2',51000,4400,1)
    ) AS v(category, product_name, price_per_cajon, price_per_kg, sort_order)
    WHERE NOT EXISTS (SELECT 1 FROM price_list_items WHERE active = TRUE LIMIT 1)
  `);

  // ─── Facturación Electrónica ARCA ────────────────────────────────────────────
  await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS cuit TEXT`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      invoice_type TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      point_of_sale INTEGER NOT NULL DEFAULT 1,
      cae TEXT NOT NULL,
      cae_expiry TEXT NOT NULL,
      total NUMERIC(12,2) NOT NULL,
      iva_amount NUMERIC(12,2) NOT NULL,
      description TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Fix: corregir números de factura con PV 0001 → 0004 (PV fue cambiado de 1 a 4)
  await db.execute(sql`
    UPDATE invoices
    SET invoice_number = regexp_replace(invoice_number, '^([A-Z])-0001-', '\\1-0004-')
    WHERE invoice_number ~ '^[A-Z]-0001-'
  `);

  // Fix: corregir point_of_sale 1 → 4 en las mismas facturas
  await db.execute(sql`
    UPDATE invoices SET point_of_sale = 4 WHERE point_of_sale = 1
  `);

  // Fix: corregir invoice_number en orders (columna que muestra el botón de descarga en detalle pedido)
  await db.execute(sql`
    UPDATE orders
    SET invoice_number = regexp_replace(invoice_number, '^([A-Z])-0001-', '\\1-0004-')
    WHERE invoice_number ~ '^[A-Z]-0001-'
  `);

  // Fix: eliminar rows fantasma de product_units con unit CAJON/BOLSA/BANDEJA
  // Esos rows no deberían tener baseUnit seteado — son un artefacto de compras mal ingresadas
  // que confunden getKnownBaseUnit() y perpetúan costos erróneos.
  await db.execute(sql`
    UPDATE product_units
    SET base_unit = NULL, is_active = false
    WHERE unit IN ('CAJON','BOLSA','BANDEJA')
      AND base_unit IS NOT NULL
      AND stock_qty::numeric <= 0
  `);

  // Restore bolsa FV items that were incorrectly zeroed: recalculate subtotal from price * qty
  await db.execute(sql`
    UPDATE order_items
    SET subtotal = (price_per_unit::numeric * quantity::numeric)::text
    WHERE bolsa_type IN ('bolsa', 'bolsa_propia')
      AND price_per_unit IS NOT NULL
      AND price_per_unit::numeric > 0
      AND subtotal::numeric = 0
  `);

  // Recalculate orders.total for affected orders
  await db.execute(sql`
    UPDATE orders o
    SET total = (
      SELECT COALESCE(SUM(oi.subtotal::numeric), 0)
      FROM order_items oi
      WHERE oi.order_id = o.id
    )
    WHERE EXISTS (
      SELECT 1 FROM order_items oi2
      WHERE oi2.order_id = o.id
        AND oi2.bolsa_type IN ('bolsa', 'bolsa_propia')
        AND oi2.price_per_unit::numeric > 0
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS caja_movements (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      category TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // ─── Bancos — categorías y overrides MP ──────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bank_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Categorías por defecto (solo si la tabla está vacía)
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM bank_categories) THEN
        INSERT INTO bank_categories (name) VALUES
          ('Transferencia a proveedor'),
          ('Transferencia a empleado'),
          ('Retiro propio'),
          ('Pago de servicio'),
          ('Cobro de cliente'),
          ('Otros');
      END IF;
    END $$
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mp_movement_overrides (
      id SERIAL PRIMARY KEY,
      mp_movement_id TEXT NOT NULL UNIQUE,
      category_id INTEGER REFERENCES bank_categories(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // ─── Bank Contacts ───────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bank_contacts (
      id SERIAL PRIMARY KEY,
      identifier TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      type TEXT NOT NULL,
      entity_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mp_movement_identifiers (
      movement_id TEXT PRIMARY KEY,
      payer_identifier TEXT NOT NULL,
      payer_name TEXT,
      raw_external_id TEXT,
      synced_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
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

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bank_payment_links (
      id SERIAL PRIMARY KEY,
      movement_id TEXT NOT NULL,
      pedido_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      monto_aplicado NUMERIC(12,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Fix bolsa FV order items saved without a sale price.
  // Pass 1: use price from the same order (non-bolsa item, same product+unit).
  // Pass 2: fallback to most recent price for the same product+unit from any approved order.
  // Finally recalculate order totals.
  await db.execute(sql`
    WITH prices_same_order AS (
      SELECT DISTINCT ON (oi.order_id, oi.product_id, oi.unit)
        oi.order_id, oi.product_id, oi.unit, oi.price_per_unit
      FROM order_items oi
      WHERE oi.bolsa_type IS NULL AND oi.price_per_unit::numeric > 0
      ORDER BY oi.order_id, oi.product_id, oi.unit
    ),
    to_fix_pass1 AS (
      SELECT oi.id, p.price_per_unit,
             ROUND(oi.quantity::numeric * p.price_per_unit::numeric, 2) AS new_subtotal
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN prices_same_order p ON p.order_id = oi.order_id
        AND p.product_id = oi.product_id AND p.unit = oi.unit
      WHERE oi.bolsa_type IN ('bolsa','bolsa_propia')
        AND (oi.price_per_unit IS NULL OR oi.price_per_unit::numeric = 0)
        AND o.status = 'approved'
    )
    UPDATE order_items
    SET price_per_unit = to_fix_pass1.price_per_unit,
        subtotal       = to_fix_pass1.new_subtotal
    FROM to_fix_pass1
    WHERE order_items.id = to_fix_pass1.id
  `);

  await db.execute(sql`
    WITH any_recent AS (
      SELECT DISTINCT ON (oi.product_id, oi.unit)
        oi.product_id, oi.unit, oi.price_per_unit
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.bolsa_type IS NULL AND oi.price_per_unit::numeric > 0 AND o.status = 'approved'
      ORDER BY oi.product_id, oi.unit, o.order_date DESC, oi.id DESC
    ),
    to_fix_pass2 AS (
      SELECT oi.id, ar.price_per_unit,
             ROUND(oi.quantity::numeric * ar.price_per_unit::numeric, 2) AS new_subtotal
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN any_recent ar ON ar.product_id = oi.product_id AND ar.unit = oi.unit
      WHERE oi.bolsa_type IN ('bolsa','bolsa_propia')
        AND (oi.price_per_unit IS NULL OR oi.price_per_unit::numeric = 0)
        AND o.status = 'approved'
    )
    UPDATE order_items
    SET price_per_unit = to_fix_pass2.price_per_unit,
        subtotal       = to_fix_pass2.new_subtotal
    FROM to_fix_pass2
    WHERE order_items.id = to_fix_pass2.id
  `);

  await db.execute(sql`
    UPDATE orders o
    SET total = (
      SELECT COALESCE(SUM(oi.subtotal::numeric), 0)
      FROM order_items oi WHERE oi.order_id = o.id
    )
    WHERE o.id IN (
      SELECT DISTINCT order_id FROM order_items
      WHERE bolsa_type IN ('bolsa','bolsa_propia')
    )
      AND o.status = 'approved'
  `);

  // ─── Notas de Crédito ────────────────────────────────────────────────────
  try { await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS condicion_iva_receptor_id INTEGER`); } catch {}
  try {
    await db.execute(sql`
      UPDATE invoices SET condicion_iva_receptor_id = 1
      WHERE invoice_type = 'A' AND condicion_iva_receptor_id IS NULL
    `);
  } catch {}
  try {
    await db.execute(sql`
      UPDATE invoices SET condicion_iva_receptor_id = 5
      WHERE invoice_type IN ('B','C') AND condicion_iva_receptor_id IS NULL
    `);
  } catch {}
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS credit_notes (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id),
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        credit_note_type TEXT NOT NULL,
        credit_note_number TEXT NOT NULL,
        point_of_sale INTEGER NOT NULL DEFAULT 4,
        cae TEXT NOT NULL,
        cae_expiry TEXT NOT NULL,
        total NUMERIC(12,2) NOT NULL,
        iva_amount NUMERIC(12,2) NOT NULL,
        condicion_iva_receptor_id INTEGER,
        description TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  } catch {}

  console.log("Migrations complete.");
}

/** Corre las migraciones de Notas de Crédito de forma independiente.
 *  Se llama por separado para garantizar que corran aunque runMigrations() falle. */
export async function runNcMigrations() {
  try { await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS condicion_iva_receptor_id INTEGER`); } catch {}
  try {
    await db.execute(sql`
      UPDATE invoices SET condicion_iva_receptor_id = 1
      WHERE invoice_type = 'A' AND condicion_iva_receptor_id IS NULL
    `);
  } catch {}
  try {
    await db.execute(sql`
      UPDATE invoices SET condicion_iva_receptor_id = 5
      WHERE invoice_type IN ('B','C') AND condicion_iva_receptor_id IS NULL
    `);
  } catch {}
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS credit_notes (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id),
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        credit_note_type TEXT NOT NULL,
        credit_note_number TEXT NOT NULL,
        point_of_sale INTEGER NOT NULL DEFAULT 4,
        cae TEXT NOT NULL,
        cae_expiry TEXT NOT NULL,
        total NUMERIC(12,2) NOT NULL,
        iva_amount NUMERIC(12,2) NOT NULL,
        condicion_iva_receptor_id INTEGER,
        description TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  } catch {}
  try { await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS black_pot BOOLEAN DEFAULT FALSE`); } catch {}
  try { await db.execute(sql`ALTER TABLE caja_movements ADD COLUMN IF NOT EXISTS method TEXT`); } catch {}
  try { await db.execute(sql`ALTER TABLE caja_movements ADD COLUMN IF NOT EXISTS source_id TEXT`); } catch {}
  try { await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS caja_movements_source_id_idx ON caja_movements(source_id) WHERE source_id IS NOT NULL`); } catch {}
  try { await db.execute(sql`ALTER TABLE mp_xlsx_movements ADD COLUMN IF NOT EXISTS fecha_ts TEXT`); } catch {}
  try { await db.execute(sql`ALTER TABLE mp_xlsx_movements ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(12,2)`); } catch {}

  // Movimientos de cuenta (libro de ajustes por cuenta)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS movimientos_cuenta (
      id SERIAL PRIMARY KEY,
      cuenta_id INTEGER NOT NULL REFERENCES cuentas_financieras(id),
      fecha TIMESTAMP NOT NULL DEFAULT NOW(),
      signo TEXT NOT NULL,
      monto NUMERIC(14,2) NOT NULL,
      comision NUMERIC(14,2) NOT NULL DEFAULT 0,
      concepto TEXT NOT NULL,
      origen_tipo TEXT NOT NULL,
      origen_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  try { await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS mc_origen_idx
    ON movimientos_cuenta(origen_tipo, origen_id)
    WHERE origen_id IS NOT NULL
  `); } catch {}

  // Cuentas financieras
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS cuentas_financieras (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      tipo TEXT NOT NULL,
      saldo_base NUMERIC(14,2) NOT NULL DEFAULT 0,
      saldo_base_fecha TIMESTAMP,
      orden INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  try {
    const cfCount = await db.execute(sql`SELECT COUNT(*)::int AS n FROM cuentas_financieras`);
    if (((cfCount.rows[0] as any)?.n ?? 0) === 0) {
      await db.execute(sql`
        INSERT INTO cuentas_financieras (nombre, tipo, orden) VALUES
          ('Mercado Pago', 'mp', 1),
          ('Galicia', 'banco', 2),
          ('Efectivo', 'efectivo', 3),
          ('Cheques en cartera', 'cheque', 4)
      `);
    }
  } catch {}

  // Socios
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS socios (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
  try {
    const socCount = await db.execute(sql`SELECT COUNT(*)::int AS n FROM socios`);
    if (((socCount.rows[0] as any)?.n ?? 0) === 0) {
      await db.execute(sql`INSERT INTO socios (nombre) VALUES ('Joaquín'), ('Federico')`);
    }
  } catch {}

  // Cheques
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS cheques (
      id SERIAL PRIMARY KEY,
      tipo TEXT NOT NULL,
      monto NUMERIC(14,2) NOT NULL,
      fecha_cobro TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'en_cartera',
      contraparte TEXT NOT NULL,
      cuenta_destino_id INTEGER REFERENCES cuentas_financieras(id),
      comision NUMERIC(14,2) NOT NULL DEFAULT 0,
      obligacion_id INTEGER,
      notas TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Obligaciones
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS obligaciones (
      id SERIAL PRIMARY KEY,
      concepto TEXT NOT NULL,
      tipo TEXT NOT NULL,
      monto NUMERIC(14,2) NOT NULL,
      fecha_vencimiento TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendiente',
      grupo_cuota TEXT,
      numero_cuota INTEGER,
      total_cuotas INTEGER,
      notas TEXT,
      pagado_at TIMESTAMP,
      cuenta_pago_id INTEGER REFERENCES cuentas_financieras(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Retiros
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS retiros (
      id SERIAL PRIMARY KEY,
      socio_id INTEGER NOT NULL REFERENCES socios(id),
      monto NUMERIC(14,2) NOT NULL,
      fecha TEXT NOT NULL,
      origen TEXT NOT NULL DEFAULT 'manual',
      movimiento_ref TEXT,
      notas TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  try { await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS retiros_movimiento_ref_idx
    ON retiros(movimiento_ref) WHERE movimiento_ref IS NOT NULL
  `); } catch {}

  // Obligaciones: moneda + pago_parcial
  try { await db.execute(sql`ALTER TABLE obligaciones ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'ARS'`); } catch {}
  try { await db.execute(sql`ALTER TABLE obligaciones ADD COLUMN IF NOT EXISTS pago_parcial BOOLEAN NOT NULL DEFAULT FALSE`); } catch {}

  // ── Fix: CAJÓN purchases where cost_per_unit was stored as per-cajón instead of per-KG ──
  // Detectable when: cost_per_unit ≈ cost_per_purchase_unit AND weight_per_package > 1
  // Step 1: Fix purchase_items.cost_per_unit
  try { await db.execute(sql`
    UPDATE purchase_items
    SET cost_per_unit = (cost_per_purchase_unit::numeric / weight_per_package::numeric)::text
    WHERE purchase_unit = 'CAJON'
      AND weight_per_package IS NOT NULL
      AND weight_per_package::numeric > 1
      AND cost_per_purchase_unit IS NOT NULL
      AND cost_per_purchase_unit::numeric > 0
      AND cost_per_unit IS NOT NULL
      AND ABS(cost_per_unit::numeric - cost_per_purchase_unit::numeric) < 0.01
  `); } catch {}

  // Step 2: Fix stock_movements (purchases) that used the wrong per-cajón unit_cost
  try { await db.execute(sql`
    UPDATE stock_movements sm
    SET unit_cost = pi.cost_per_unit
    FROM purchase_items pi
    WHERE sm.reference_type = 'purchase'
      AND sm.reference_id = pi.purchase_id
      AND sm.product_id = pi.product_id
      AND pi.purchase_unit = 'CAJON'
      AND pi.weight_per_package IS NOT NULL
      AND pi.weight_per_package::numeric > 1
      AND pi.cost_per_purchase_unit IS NOT NULL
      AND pi.cost_per_purchase_unit::numeric > 0
      AND ABS(sm.unit_cost::numeric - pi.cost_per_purchase_unit::numeric) < 1
  `); } catch {}

  // Step 3: Recalc product_units.avg_cost for affected products (WA over all purchase movements)
  try { await db.execute(sql`
    WITH aff AS (
      SELECT DISTINCT pi.product_id FROM purchase_items pi
      WHERE pi.purchase_unit = 'CAJON' AND pi.weight_per_package::numeric > 1
    ),
    wma AS (
      SELECT sm.product_id,
        SUM(sm.quantity::numeric * sm.unit_cost::numeric) / NULLIF(SUM(sm.quantity::numeric), 0) AS avg_cost
      FROM stock_movements sm
      JOIN aff a ON a.product_id = sm.product_id
      WHERE sm.movement_type = 'in' AND sm.reference_type = 'purchase'
        AND sm.unit_cost IS NOT NULL AND sm.unit_cost::numeric > 0
      GROUP BY sm.product_id
    )
    UPDATE product_units pu SET avg_cost = wma.avg_cost::text
    FROM wma
    WHERE pu.product_id = wma.product_id
      AND pu.base_unit IS NOT NULL
      AND pu.unit NOT IN ('CAJON','BOLSA','BANDEJA')
      AND wma.avg_cost IS NOT NULL AND wma.avg_cost > 0
  `); } catch {}

  // Step 4: Sync products.average_cost
  try { await db.execute(sql`
    WITH aff AS (
      SELECT DISTINCT pi.product_id FROM purchase_items pi
      WHERE pi.purchase_unit = 'CAJON' AND pi.weight_per_package::numeric > 1
    ),
    totals AS (
      SELECT pu.product_id,
        CASE WHEN SUM(pu.stock_qty::numeric) > 0
          THEN SUM(pu.stock_qty::numeric * pu.avg_cost::numeric) / SUM(pu.stock_qty::numeric)
          ELSE MAX(pu.avg_cost::numeric)
        END AS avg_cost
      FROM product_units pu
      JOIN aff a ON a.product_id = pu.product_id
      WHERE pu.base_unit IS NOT NULL AND pu.unit NOT IN ('CAJON','BOLSA','BANDEJA')
      GROUP BY pu.product_id
    )
    UPDATE products p SET average_cost = totals.avg_cost::text
    FROM totals
    WHERE p.id = totals.product_id AND totals.avg_cost IS NOT NULL AND totals.avg_cost > 0
  `); } catch {}

  // Step 5: Fix rinde stock_movements that used the wrong per-cajón unit_cost
  try { await db.execute(sql`
    UPDATE stock_movements sm
    SET unit_cost = (
      SELECT (pi.cost_per_purchase_unit::numeric / pi.weight_per_package::numeric)::text
      FROM purchase_items pi
      WHERE pi.product_id = sm.product_id
        AND pi.purchase_unit = 'CAJON'
        AND pi.weight_per_package::numeric > 1
        AND pi.cost_per_purchase_unit IS NOT NULL
        AND ABS(sm.unit_cost::numeric - pi.cost_per_purchase_unit::numeric) < 1
      ORDER BY pi.id DESC LIMIT 1
    )
    WHERE sm.notes ILIKE '%Rinde%'
      AND sm.movement_type = 'in'
      AND EXISTS (
        SELECT 1 FROM purchase_items pi
        WHERE pi.product_id = sm.product_id
          AND pi.purchase_unit = 'CAJON'
          AND pi.weight_per_package::numeric > 1
          AND pi.cost_per_purchase_unit IS NOT NULL
          AND ABS(sm.unit_cost::numeric - pi.cost_per_purchase_unit::numeric) < 1
      )
  `); } catch {}

  // Step 6: Fix rinde movements where unit_cost = per-cajón price (avg_cost × weight_per_unit)
  // Detectable: sm.unit_cost / pu.avg_cost ≈ pu.weight_per_unit (ratio = kg/cajón)
  try { await db.execute(sql`
    UPDATE stock_movements sm
    SET unit_cost = (sm.unit_cost::numeric / pu.weight_per_unit::numeric)::text
    FROM product_units pu
    WHERE sm.notes ILIKE '%Rinde%'
      AND sm.movement_type = 'in'
      AND sm.product_id = pu.product_id
      AND pu.base_unit IS NOT NULL
      AND pu.unit NOT IN ('CAJON','BOLSA','BANDEJA')
      AND pu.weight_per_unit IS NOT NULL
      AND pu.weight_per_unit::numeric > 1
      AND pu.avg_cost IS NOT NULL
      AND pu.avg_cost::numeric > 0
      AND sm.unit_cost IS NOT NULL
      AND sm.unit_cost::numeric > 0
      AND ABS(sm.unit_cost::numeric / NULLIF(pu.avg_cost::numeric, 0) - pu.weight_per_unit::numeric) < 0.5
  `); } catch (e) { console.error("Step 6 rinde fix failed:", e); }

  console.log("NC migrations complete.");
}
