# AgroLogix ERP

Logistics ERP system for a produce distribution company. Built with React + Vite (frontend) and Express + TypeScript (backend), using Drizzle ORM with PostgreSQL.

## Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query, wouter
- **Backend**: Express.js, TypeScript
- **Database**: PostgreSQL (Replit built-in, Neon-backed) via Drizzle ORM
- **Auth**: Email/password with bcryptjs, express-session + connect-pg-simple
- **ORM**: Drizzle ORM with drizzle-zod for schema validation

## Project Structure

```
client/src/
  pages/
    login.tsx          - Login page
    dashboard.tsx      - Main dashboard with stats
    customers.tsx      - Customer CRUD
    products.tsx       - Product CRUD
    purchases/
      index.tsx        - Purchase list
      new.tsx          - Create purchase form
      detail.tsx       - Purchase detail view
  components/
    app-sidebar.tsx    - Navigation sidebar
    layout.tsx         - Authenticated page layout wrapper
  lib/
    auth.tsx           - AuthContext + useAuth hook
    queryClient.ts     - TanStack Query client + apiRequest

server/
  index.ts             - Express entry point, session setup, startup
  routes.ts            - All API endpoints
  storage.ts           - Database access layer
  db.ts                - Drizzle + pg pool setup
  migrate.ts           - Manual SQL migrations
  seed.ts              - Seed data (4 customers, 6 products, 2 users)

shared/
  schema.ts            - Drizzle schema + Zod types shared between client and server
```

## Database Schema

- **users**: id, name, email, password_hash, role (admin|operator), active
- **customers**: id, name, rfc, email, phone, address, city, notes, active
- **products**: id, name, sku, description, unit, average_cost, current_stock, active
- **purchases**: id, folio, supplier_name, purchase_date, total, notes, created_by
- **purchase_items**: id, purchase_id, product_id, quantity, unit, cost_per_unit, subtotal
- **stock_movements**: id, product_id, movement_type (in|out), quantity, unit_cost, reference_id, reference_type
- **product_cost_history**: id, product_id, average_cost, previous_cost, purchase_id

## Features Implemented (MVP)

1. **Authentication** - Email/password login, bcrypt hashing, session management, roles (admin/operator)
2. **SaaS Layout** - Sidebar with navigation, header with sidebar toggle, user info with role badge
3. **Customers CRUD** - Create, view, edit, deactivate customers with search
4. **Products CRUD** - Create, view, edit, deactivate products with unit selection and search
5. **Purchases Module**:
   - Create purchase orders with auto-generated folio (OC-00001...)
   - Add multiple items (product, quantity, unit, cost per unit)
   - Real-time subtotal and grand total calculation
   - Projected weighted average cost preview per item
   - On save: creates stock movement (IN), recalculates weighted average cost, saves cost history
6. **Product Cost History** - Saves average cost snapshots per purchase in `product_cost_history`

## Seed Credentials

- Admin: `admin@erp.com` / `admin123`
- Operator: `operador@erp.com` / `op123456`

## API Endpoints

- `POST /api/auth/login` — login
- `POST /api/auth/logout` — logout
- `GET /api/auth/me` — current user
- `GET/POST /api/customers` — list/create customers
- `PATCH/DELETE /api/customers/:id` — update/deactivate customer
- `GET/POST /api/products` — list/create products
- `PATCH/DELETE /api/products/:id` — update/deactivate product
- `GET /api/purchases` — list purchases
- `GET /api/purchases/next-folio` — generate next folio
- `GET /api/purchases/:id` — purchase detail with items
- `POST /api/purchases` — create purchase (also creates stock movements and cost history)
- `GET /api/stock-movements` — list stock movements

## Running

The app runs via `npm run dev` which starts both the Express server and Vite dev server on port 5000.
Migrations and seeding run automatically on startup.
