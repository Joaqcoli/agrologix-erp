import { ReactNode } from "react";
import { Link, useLocation, Redirect } from "wouter";
import { useAuth } from "@/lib/auth";
import { Loader2, LayoutDashboard, FileText, Users, LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const navItems = [
  { title: "Dashboard", url: "/vendedor/dashboard", icon: LayoutDashboard },
  { title: "Pedidos", url: "/vendedor/orders", icon: FileText },
  { title: "Clientes", url: "/vendedor/customers", icon: Users },
];

export function VendedorLayout({ children, title }: { children: ReactNode; title?: string }) {
  const { user, loading, logout } = useAuth();
  const [location] = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Redirect to="/login" />;
  if (user.role !== "vendedor" && user.role !== "admin") return <Redirect to="/" />;

  const initials = user.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="flex h-screen w-full bg-background">
      <aside className="w-56 shrink-0 border-r border-border flex flex-col bg-sidebar">
        <div className="p-4 border-b border-sidebar-border flex items-center justify-center">
          <img src="/logo.png" alt="Logo" style={{ maxWidth: "140px", width: "100%" }} />
        </div>

        <nav className="flex-1 py-4 px-2 flex flex-col gap-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider px-3 mb-2">Módulos</p>
          {navItems.map((item) => {
            const isActive = location === item.url || location.startsWith(item.url + "/");
            return (
              <Link key={item.url} href={item.url}>
                <a
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-sidebar-foreground hover:bg-muted"
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.title}
                </a>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 px-1 py-1">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-sm font-medium truncate leading-tight">{user.name}</span>
              <span className="text-xs text-muted-foreground">Vendedor</span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={logout}
              title="Cerrar sesión"
              className="h-8 w-8 shrink-0"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex flex-col flex-1 overflow-hidden">
        {title && (
          <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-4 shrink-0">
            <h1 className="text-base font-semibold text-foreground truncate">{title}</h1>
          </header>
        )}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
