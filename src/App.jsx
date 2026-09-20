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
import Employees from './pages/Employees';
import EmployeeDetail from './pages/EmployeeDetail';
import AuditLog from './pages/AuditLog';
import Deliveries from './pages/Deliveries';
import Branches from './pages/Branches';
import Transfer from './pages/Transfer';
import Voice from './pages/Voice';
import Requests from './pages/Requests';
import CustomFields from './pages/CustomFields';
import Sector from './pages/Sector';
import Production from './pages/Production';
import Accounting from './pages/Accounting';
import Treasury from './pages/Treasury';
import Installments from './pages/Installments';
import CRM from './pages/CRM';
import Pricing from './pages/Pricing';
import Assets from './pages/Assets';
import Payroll from './pages/Payroll';
import Projects from './pages/Projects';
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
        <Route path="purchase-order" element={<Guard action="purchase"><InvoiceEditor type="po" key="po" /></Guard>} />
        <Route path="quote" element={<Guard action="quote"><InvoiceEditor type="quote" key="quote" /></Guard>} />
        <Route path="sale-return" element={<Guard action="returns"><InvoiceEditor type="sale_return" key="sret" /></Guard>} />
        <Route path="purchase-return" element={<Guard action="returns"><InvoiceEditor type="purchase_return" key="pret" /></Guard>} />
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
        <Route path="employees" element={<Guard action="employees"><Employees /></Guard>} />
        <Route path="employees/:id" element={<Guard action="employees"><EmployeeDetail /></Guard>} />
        <Route path="payroll" element={<Guard action="payroll"><Payroll /></Guard>} />
        <Route path="projects" element={<Guard action="projects"><Projects /></Guard>} />
        <Route path="audit" element={<Guard action="reports"><AuditLog /></Guard>} />
        <Route path="deliveries" element={<Guard action="pos"><Deliveries /></Guard>} />
        <Route path="branches" element={<Guard action="branches"><Branches /></Guard>} />
        <Route path="transfer" element={<Guard action="transfer"><Transfer /></Guard>} />
        <Route path="voice" element={<Guard action="voice"><Voice /></Guard>} />
        <Route path="requests" element={<Guard action="requests"><Requests /></Guard>} />
        <Route path="custom-fields" element={<Guard action="settings"><CustomFields /></Guard>} />
        <Route path="sector" element={<Guard action="sector"><Sector /></Guard>} />
        <Route path="production" element={<Guard action="production"><Production /></Guard>} />
        <Route path="accounting" element={<Guard action="accounting"><Accounting /></Guard>} />
        <Route path="treasury" element={<Guard action="treasury"><Treasury /></Guard>} />
        <Route path="installments" element={<Guard action="installments"><Installments /></Guard>} />
        <Route path="crm" element={<Guard action="crm"><CRM /></Guard>} />
        <Route path="pricing" element={<Guard action="pricing"><Pricing /></Guard>} />
        <Route path="assets" element={<Guard action="assets"><Assets /></Guard>} />
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
