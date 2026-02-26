import bcrypt from "bcryptjs";
import { db } from "./db";
import { users, customers, products } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function seedDatabase() {
  const existingAdmin = await db.select().from(users).where(eq(users.email, "admin@erp.com")).limit(1);
  if (existingAdmin.length > 0) {
    return;
  }

  console.log("Seeding database...");

  const adminHash = await bcrypt.hash("admin123", 10);
  const operatorHash = await bcrypt.hash("op123456", 10);

  await db.insert(users).values([
    { name: "Admin Sistema", email: "admin@erp.com", passwordHash: adminHash, role: "admin" },
    { name: "Carlos Operador", email: "operador@erp.com", passwordHash: operatorHash, role: "operator" },
  ]);

  await db.insert(customers).values([
    { name: "Distribuidora La Frescura SA de CV", rfc: "DLF820315AB1", email: "compras@lafrescura.mx", phone: "55-1234-5678", address: "Av. Central 450, Col. Iztapalapa", city: "Ciudad de México" },
    { name: "Mercado Regional del Norte SC", rfc: "MRN910801CD2", email: "pedidos@mercadonorte.com", phone: "81-9876-5432", address: "Blvd. Morones Prieto 3800", city: "Monterrey" },
    { name: "Frutas y Verduras El Carmen", rfc: "FVC750612EF3", phone: "33-4567-8901", address: "Calle Juárez 120 Local 4", city: "Guadalajara" },
    { name: "Supertienda Familiar SA", rfc: "SFA881120GH4", email: "admin@supertienda.com.mx", phone: "222-345-6789", address: "Av. Reforma 890", city: "Puebla" },
  ]);

  await db.insert(products).values([
    { name: "Jitomate Saladette", sku: "JIT-001", description: "Jitomate saladette de primera calidad", unit: "kg", averageCost: "18.50", currentStock: "0" },
    { name: "Aguacate Hass", sku: "AVO-001", description: "Aguacate Hass maduro listo para venta", unit: "kg", averageCost: "45.00", currentStock: "0" },
    { name: "Chile Serrano", sku: "CHI-001", description: "Chile serrano fresco", unit: "kg", averageCost: "32.00", currentStock: "0" },
    { name: "Cebolla Blanca", sku: "CEB-001", description: "Cebolla blanca calibre grande", unit: "kg", averageCost: "12.00", currentStock: "0" },
    { name: "Limón Persa", sku: "LIM-001", description: "Limón persa sin semilla", unit: "kg", averageCost: "22.00", currentStock: "0" },
    { name: "Papa Alpha", sku: "PAP-001", description: "Papa alpha lavada a granel", unit: "saco", averageCost: "280.00", currentStock: "0" },
  ]);

  console.log("Seed complete. Admin: admin@erp.com / admin123");
}
