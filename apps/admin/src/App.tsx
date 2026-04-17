import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProtectedLayout } from '@/components/layout/protected-layout';
import { LoginPage } from '@/pages/login';
import { DashboardPage } from '@/pages/dashboard';
import { OrdersPage } from '@/pages/orders';
import { ProductsPage } from '@/pages/products';
import { CustomersPage } from '@/pages/customers';
import { CalendarPage } from '@/pages/calendar';
import { FinancePage } from '@/pages/finance';
import { SettingsPage } from '@/pages/settings';
import { ShippingLabelPage } from '@/pages/shipping-label';
import { ShippingPage } from '@/pages/shipping';
import { ProductDetailPage } from '@/pages/product-detail';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/products/:id" element={<ProductDetailPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/finance" element={<FinancePage />} />
            <Route path="/shipping" element={<ShippingPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/orders/:id/shipping-label" element={<ShippingLabelPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
