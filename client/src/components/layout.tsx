import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/lib/auth";
import { Redirect } from "wouter";
import { Loader2, Moon, Sun } from "lucide-react";
import { useDarkMode } from "@/lib/useDarkMode";
import { Button } from "@/components/ui/button";

type LayoutProps = {
  children: ReactNode;
  title?: string;
};

export function Layout({ children, title }: LayoutProps) {
  const { user, loading } = useAuth();
  const { dark, toggle } = useDarkMode();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  // Guard por rol: las páginas que usan este Layout son SOLO para admin/operator.
  // Un galpón o vendedor que llegue por URL directa es rebotado a su propia vista.
  if (user.role === "galpon") return <Redirect to="/galpon/stock" />;
  if (user.role === "vendedor") return <Redirect to="/vendedor/dashboard" />;

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-4 shrink-0">
            <SidebarTrigger data-testid="button-sidebar-toggle" className="shrink-0" />
            {title && (
              <h1 className="text-base font-semibold text-foreground truncate">{title}</h1>
            )}
            <div className="ml-auto">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggle}
                title={dark ? "Modo claro" : "Modo oscuro"}
              >
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
