# AgroLogix ERP

Logistics ERP system for a produce distribution company (Vegetales Argentinos). Built with React + Vite (frontend) and Express + TypeScript (backend), using Drizzle ORM with PostgreSQL.

## Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query, wouter
- **Backend**: Express.js, TypeScript, xlsx (XLSX export)
- **Database**: PostgreSQL (Replit built-in, Neon-backed) via Drizzle ORM
- **Auth**: Email/password with bcryptjs, express-session + connect-pg-simple
- **ORM**: Drizzle ORM with drizzle-zod for schema validation

## Project Structure

```
client/src/
  pages/
    login.tsx          - Login page
    dashboard.tsx      - Main dashboard with stats
    customers.tsx      - Customer CRUD (includes has_iva toggle)
    products.tsx       - Product CRUD + Stock tab (2-tab: Products cards / Stock table with adjust)
    load-list.tsx      - Consolidated load list by date
    purchases/
      index.tsx        - Purchase list
      new.tsx          - Create purchase form
      detail.tsx       - Purchase detail view
    orders/
      index.tsx        - Orders list with date filter, Resumen del Día, export
      new.tsx          - Create order form (margin warnings, suggested price)
      detail.tsx       - Order detail with Excel-like IVA-aware table
  components/
    app-sidebar.tsx    - Navigation sidebar
    layout.tsx         - Authenticated page layout wrapper
  lib/
    auth.tsx           - AuthContext + useAuth hook
    queryClient.ts     - TanStack Query client + apiRequest
    pdf.ts             - jsPDF remito PDF generation
    orderParser.ts     - Deterministic order text parser (strategy pattern)

server/
  index.ts             - Express entry point, session setup, startup
  routes.ts            - All API endpoints (includes export endpoints)
  storage.ts           - Database access layer
  db.ts                - Drizzle + pg pool setup
  migrate.ts           - Manual SQL migrations
  seed.ts              - Seed data (4 customers, 6 products, 2 users)

shared/
  schema.ts            - Drizzle schema + Zod types shared between client and server
```

## Database Schema

- **users**: id, name, email, password_hash, role (admin|operator), active
- **customers**: id, name, rfc, email, phone, address, city, notes, has_iva, active
- **products**: id, name, sku, description, unit, average_cost, current_stock, active
- **purchases**: id, folio (OC-00001), supplier_name, purchase_date, total, notes, created_by
- **purchase_items**: id, purchase_id, product_id, quantity, unit, cost_per_unit, subtotal
- **stock_movements**: id, product_id, movement_type (in|out), quantity, unit_cost, reference_id, reference_type
- **product_cost_history**: id, product_id, average_cost, previous_cost, purchase_id
- **orders**: id, folio (PV-00001), customer_id, order_date, status (draft|approved|cancelled), total, notes, low_margin_confirmed, remito_id, created_by, approved_by, approved_at
- **order_items**: id, order_id, product_id (nullable), quantity, unit, price_per_unit (nullable), cost_per_unit, margin, subtotal, raw_product_name, parse_status
- **price_history**: id, customer_id, product_id, price_per_unit, order_id (last sale price per customer+product)
- **remitos**: id, folio (VA-000001), order_id, customer_id, issued_at
- **product_units**: id, product_id, unit (canonical: KG/CAJON/BOLSA/UNIDAD/ATADO/LITRO/TONELADA/PZ), avg_cost, stock_qty, is_active — multi-unit stock tracking per product

## Features Implemented

1. **Authentication** - Email/password login, bcrypt hashing, session management, roles (admin/operator)
2. **SaaS Layout** - Sidebar with navigation, header with sidebar toggle, user info with role badge
3. **Customers CRUD** - Create, view, edit, deactivate customers; has_iva flag for IVA billing
4. **Products CRUD** - Create, view, edit, deactivate products with unit selection and search
5. **Purchases Module** - Create POs with weighted average cost, stock IN movements, cost history
6. **Orders Module (full)**:
   - Date-filtered list view with Resumen del Día (Total Vendido, Costo, Margen)
   - Resumen uses IVA-adjusted totals for Con IVA customers
   - Order cards show suggested next remito folio
   - Create orders with multi-item entry, last-price suggestion, low-margin warning (<30%)
   - Excel-like detail table: IVA-aware columns (appears only for Con IVA customers)
     - IVA: 10.5% default, 21% for products containing "HUEVO" in name
     - Columns: Cant, Unidad, Producto, P.Venta, Total, [Total+IVA], P.Compra, T.Compra, Diferencia, %
   - Approve order: creates stock OUT movements, saves price_history, generates remito
   - Remito PDF (jsPDF, A4, folio VA-000001 format)
   - Export day XLSX (all orders for selected date, per-customer blocks, IVA-aware columns)
   - Export single order XLSX
7. **Load List** - Consolidated view of approved orders by date, summed by product+unit
8. **Intake (Carga Pedido) Module**:
   - Text-based order entry: paste raw text (e.g. "5 cajon limon") and parse client-side
   - Deterministic parser (orderParser.ts): accent-normalize, unit-alias mapping, word-overlap scoring
   - Strategy pattern — ready to swap in AI parser (parseOrderTextAI stub included)
   - Preview step: shows parsed lines with OK/Ambiguous/No product/No qty statuses
   - Ambiguous lines: dropdown to select from candidates
   - Missing product lines: full product dropdown to assign manually
   - Draft detection: if draft exists for same customer+date, offers Merge / Replace / New
   - POST /api/orders/intake → creates order with null pricePerUnit for all items
   - Redirect to order detail for price completion
9. **Inline Price Editing** (order detail):
   - Items with no price show "Sin precio" badge and editable input immediately
   - Hover any priced row in draft orders to reveal pencil edit icon
   - PATCH /api/orders/:id/items/:itemId → updates price, recalculates subtotal/margin/order total
   - Approval blocked until all items have prices > 0
10. **Product Units & Multi-Unit Stock** (product_units table):
    - Each product can have multiple active units (KG, CAJON, BOLSA, UNIDAD, ATADO, LITRO, TONELADA, PZ)
    - Unit canonicalization via shared/units.ts (handles aliases: caja=CAJON, saco=BOLSA, kilo=KG, etc.)
    - Products page rewritten with 2-tab UI:
      - Tab 1 "Productos": cards with unit badges, per-unit stock/cost summary, add/remove units inline
      - Tab 2 "Stock": filterable table with stock levels, cost, value, negative stock alerts, stock adjust modal
    - Bulk import dialog: paste product lines "NOMBRE UNIDAD", preview, idempotent import
    - API: GET /api/products/stock, GET /api/products/:id/units, POST /api/products/:id/units,
           DELETE /api/product-units/:id, PATCH /api/product-units/:id/adjust, POST /api/products/import
    - Intake unit validation: warns if parsed product+unit combo not registered in product_units
    - createOrderFromIntake uses product_units.avg_cost as the cost basis
    - approveOrder deducts from product_units stock in addition to products.current_stock

## IVA Rules

- customers.has_iva = false → NO IVA columns in UI or exports
- customers.has_iva = true → Show "Total + IVA" column
  - Default rate: 10.5%
  - Products with "HUEVO" in name: 21%

## Margin Rules

- Low margin threshold: 30%
- At order creation: rows below 30% show warning, require checkbox confirmation
- At order detail: rows below 30% highlighted red, "Margen bajo" badge, checkbox required before approving

## Seed Credentials

- Admin: `admin@erp.com` / `admin123`
- Operator: `operador@erp.com` / `op123456`

## API Endpoints

- `POST /api/auth/login` — login
- `GET /api/auth/me` — current user
- `GET/POST /api/customers` — list/create customers
- `PATCH/DELETE /api/customers/:id` — update/deactivate
- `GET/POST /api/products` — list/create products
- `PATCH/DELETE /api/products/:id` — update/deactivate
- `GET /api/purchases` — list
- `GET /api/purchases/next-folio` — next OC folio
- `GET /api/purchases/:id` — detail with items
- `POST /api/purchases` — create (stock IN + cost history)
- `GET /api/stock-movements` — list movements
- `GET /api/price-history/:customerId/:productId` — last sale price
- `GET /api/orders?date=YYYY-MM-DD` — list orders (filtered by date)
- `GET /api/orders/next-folio` — next PV folio
- `GET /api/orders/:id` — detail with customer + items + products
- `POST /api/orders` — create order
- `POST /api/orders/:id/approve` — approve (stock OUT + price history + remito)
- `GET /api/orders/export?date=YYYY-MM-DD` — export day as XLSX
- `GET /api/orders/:id/export` — export single order as XLSX
- `GET /api/remitos/:id` — remito detail
- `GET /api/load-list?date=YYYY-MM-DD` — consolidated load list
- `GET /api/orders/draft?customerId&date` — check for existing draft order
- `POST /api/orders/intake` — create order from text intake (items without prices, modes: new/merge/replace)
- `PATCH /api/orders/:id/items/:itemId` — update item price, recalculate totals

## Running

`npm run dev` starts both Express and Vite on port 5000. Migrations run automatically on startup.
