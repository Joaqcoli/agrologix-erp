// Layout del vendedor (17/11/2026): el mismo armazón que el admin (sidebar plegable con botón de menú en
// celular, modo oscuro), con las entradas propias del vendedor. Antes era una barra fija de 224 px.
import { ReactNode } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@/lib/auth";
import { Loader2, LayoutDashboard, FileText, Users, Wallet, Landmark, Moon, Sun } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useDarkMode } from "@/lib/useDarkMode";
import { Button } from "@/components/ui/button";

const navItems = [
  { title: "Dashboard", url: "/vendedor/dashboard", icon: LayoutDashboard },
  { title: "Pedidos", url: "/vendedor/orders", icon: FileText },
  { title: "Clientes", url: "/vendedor/customers", icon: Users },
  { title: "Cuentas Corrientes", url: "/vendedor/cc", icon: Landmark },
  { title: "Comisiones", url: "/vendedor/comisiones", icon: Wallet },
];

export function VendedorLayout({ children, title }: { children: ReactNode; title?: string }) {
  const { user, loading } = useAuth();
  const { dark, toggle } = useDarkMode();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Redirect to="/login" />;
  if (user.role !== "vendedor" && user.role !== "admin" && user.role !== "administrativo") return <Redirect to="/" />;

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-background">
        <AppSidebar items={navItems} roleLabel="Vendedor" />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-4 shrink-0">
            <SidebarTrigger data-testid="button-sidebar-toggle" className="shrink-0" />
            {title && <h1 className="text-base font-semibold text-foreground truncate">{title}</h1>}
            <div className="ml-auto">
              <Button variant="ghost" size="icon" onClick={toggle} title={dark ? "Modo claro" : "Modo oscuro"}>
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </div>
          </header>
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
