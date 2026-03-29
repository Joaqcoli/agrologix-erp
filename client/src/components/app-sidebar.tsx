import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Users,
  Package,
  ShoppingCart,
  LogOut,
  FileText,
  ClipboardList,
  MessageSquarePlus,
  Wallet,
  Warehouse,
  Building2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Clientes", url: "/customers", icon: Users },
  { title: "Cuentas Corrientes", url: "/cuentas-corrientes", icon: Wallet },
  { title: "Proveedores", url: "/suppliers", icon: Building2 },
  { title: "Productos", url: "/products", icon: Package },
  { title: "Compras", url: "/purchases", icon: ShoppingCart },
  { title: "Stock", url: "/stock", icon: Warehouse },
  { title: "Pedidos", url: "/orders", icon: FileText },
  { title: "Carga Pedido", url: "/intake", icon: MessageSquarePlus },
  { title: "Lista de Carga", url: "/load-list", icon: ClipboardList },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const initials = user?.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() ?? "??";

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-sidebar-border flex items-center justify-center">
        <img src="/logo.png" alt="Logo" style={{ maxWidth: "160px", width: "100%" }} />
      </SidebarHeader>

      <SidebarContent className="py-3">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs text-muted-foreground uppercase tracking-wider px-4 mb-1">
            Módulos
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      className="mx-2 rounded-md"
                      data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}
                    >
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 px-1 py-1">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-sm font-medium text-sidebar-foreground truncate leading-tight">{user?.name}</span>
            <Badge variant="secondary" className="w-fit text-[10px] px-1.5 py-0 mt-0.5">
              {user?.role === "admin" ? "Admin" : "Operador"}
            </Badge>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={logout}
            title="Cerrar sesión"
            data-testid="button-logout"
            className="shrink-0 h-8 w-8"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
