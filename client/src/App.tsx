import { Switch, Route, Redirect } from "wouter";
import { Component, type ReactNode } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "2rem", fontFamily: "monospace" }}>
          <h2>Algo salió mal</h2>
          <pre style={{ color: "red", whiteSpace: "pre-wrap" }}>{(this.state.error as Error).message}</pre>
          <button onClick={() => this.setState({ error: null })}>Reintentar</button>
        </div>
      );
    }
    return this.props.children;
  }
}
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import CustomersPage from "@/pages/customers";
import ProductsPage from "@/pages/products";
import PurchasesPage from "@/pages/purchases/index";
import NewPurchasePage from "@/pages/purchases/new";
import PurchaseDetailPage from "@/pages/purchases/detail";
import EditPurchasePage from "@/pages/purchases/edit";
import OrdersPage from "@/pages/orders/index";
import NewOrderPage from "@/pages/orders/new";
import OrderDetailPage from "@/pages/orders/detail";
import LoadListPage from "@/pages/load-list";
import StockPage from "@/pages/stock";
import IntakePage from "@/pages/intake";
import CuentasCorrientesPage from "@/pages/cuentas-corrientes/index";
import CCCustomerDetailPage from "@/pages/cuentas-corrientes/detail";
import SuppliersPage from "@/pages/suppliers/index";
import SupplierCCPage from "@/pages/suppliers/cc";
import VendedorDashboard from "@/pages/vendedor/dashboard";
import VendedorOrders from "@/pages/vendedor/orders";
import VendedorOrderDetail from "@/pages/vendedor/order-detail";
import VendedorCustomers from "@/pages/vendedor/customers";
import NotFound from "@/pages/not-found";

function RootPage() {
  const { user } = useAuth();
  if (user?.role === "vendedor") return <Redirect to="/vendedor/dashboard" />;
  return <DashboardPage />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/" component={RootPage} />
      <Route path="/customers" component={CustomersPage} />
      <Route path="/products" component={ProductsPage} />
      <Route path="/purchases" component={PurchasesPage} />
      <Route path="/purchases/new" component={NewPurchasePage} />
      <Route path="/purchases/:id/edit">
        {(params) => <EditPurchasePage id={Number(params.id)} />}
      </Route>
      <Route path="/purchases/:id">
        {(params) => <PurchaseDetailPage id={Number(params.id)} />}
      </Route>
      <Route path="/orders" component={OrdersPage} />
      <Route path="/orders/new" component={NewOrderPage} />
      <Route path="/orders/:id">
        {(params) => <OrderDetailPage id={Number(params.id)} />}
      </Route>
      <Route path="/load-list" component={LoadListPage} />
      <Route path="/stock" component={StockPage} />
      <Route path="/intake" component={IntakePage} />
      <Route path="/cuentas-corrientes" component={CuentasCorrientesPage} />
      <Route path="/cuentas-corrientes/:id">
        {(params) => {
          const search = new URLSearchParams(window.location.search);
          const today = new Date();
          const month = parseInt(search.get("month") ?? String(today.getMonth() + 1));
          const year = parseInt(search.get("year") ?? String(today.getFullYear()));
          const dateFrom = search.get("dateFrom") ?? undefined;
          const dateTo = search.get("dateTo") ?? undefined;
          return <CCCustomerDetailPage customerId={Number(params.id)} month={month} year={year} dateFrom={dateFrom} dateTo={dateTo} />;
        }}
      </Route>
      <Route path="/suppliers" component={SuppliersPage} />
      <Route path="/suppliers/:id/cc">
        {(params) => {
          const search = new URLSearchParams(window.location.search);
          const today = new Date();
          const month = parseInt(search.get("month") ?? String(today.getMonth() + 1));
          const year = parseInt(search.get("year") ?? String(today.getFullYear()));
          return <SupplierCCPage supplierId={Number(params.id)} month={month} year={year} />;
        }}
      </Route>
      <Route path="/vendedor/dashboard" component={VendedorDashboard} />
      <Route path="/vendedor/orders" component={VendedorOrders} />
      <Route path="/vendedor/orders/:id">
        {(params) => <VendedorOrderDetail id={Number(params.id)} />}
      </Route>
      <Route path="/vendedor/customers" component={VendedorCustomers} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <Toaster />
            <Router />
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
