import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import InvoiceEditor from './components/InvoiceEditor';
import Invoices from './pages/Invoices';
import InvoiceView from './pages/InvoiceView';
import Items from './pages/Items';
import Parties from './pages/Parties';
import Reports from './pages/Reports';
import Expenses from './pages/Expenses';
import Backup from './pages/Backup';
import Import from './pages/Import';
import Insights from './pages/Insights';
import Settings from './pages/Settings';
import Users from './pages/Users';
import { can } from './utils';

function Guard({ action, children }) {
  const { user } = useAuth();
  if (action && !can(user.role, action)) return <Navigate to="/" replace />;
  return children;
}

function Shell() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="pos" element={<Guard action="pos"><InvoiceEditor type="sale" key="sale" /></Guard>} />
        <Route path="purchase" element={<Guard action="purchase"><InvoiceEditor type="purchase" key="purchase" /></Guard>} />
        <Route path="invoices" element={<Guard action="invoices"><Invoices /></Guard>} />
        <Route path="invoices/:id" element={<Guard action="invoices"><InvoiceView /></Guard>} />
        <Route path="items" element={<Guard action="items"><Items /></Guard>} />
        <Route path="customers" element={<Guard action="customers"><Parties kind="customer" key="c" /></Guard>} />
        <Route path="suppliers" element={<Guard action="suppliers"><Parties kind="supplier" key="s" /></Guard>} />
        <Route path="reports" element={<Guard action="reports"><Reports /></Guard>} />
        <Route path="expenses" element={<Guard action="expenses"><Expenses /></Guard>} />
        <Route path="insights" element={<Guard action="insights"><Insights /></Guard>} />
        <Route path="settings" element={<Guard action="settings"><Settings /></Guard>} />
        <Route path="import" element={<Guard action="import"><Import /></Guard>} />
        <Route path="backup" element={<Guard action="backup"><Backup /></Guard>} />
        <Route path="users" element={<Guard action="users"><Users /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </AuthProvider>
  );
}
