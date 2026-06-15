import { NavLink, Outlet } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting } from '../db';
import { useAuth } from '../auth';
import { can, ROLES } from '../utils';

const MENU = [
  { to: '/', ico: '📊', label: 'الرئيسية', action: null },
  { to: '/insights', ico: '🤖', label: 'المساعد الذكي', action: 'insights' },
  { to: '/pos', ico: '🧾', label: 'بيع جديد', action: 'pos' },
  { to: '/purchase', ico: '📥', label: 'فاتورة شراء', action: 'purchase' },
  { to: '/invoices', ico: '🗂️', label: 'الفواتير', action: 'invoices' },
  { to: '/items', ico: '📦', label: 'المخزون', action: 'items' },
  { to: '/customers', ico: '👥', label: 'العملاء', action: 'customers' },
  { to: '/suppliers', ico: '🚚', label: 'الموردين', action: 'suppliers' },
  { to: '/expenses', ico: '💸', label: 'المصروفات', action: 'expenses' },
  { to: '/reports', ico: '📈', label: 'التقارير', action: 'reports' },
  { to: '/import', ico: '📑', label: 'استيراد Excel', action: 'import' },
  { to: '/backup', ico: '🛡️', label: 'النسخ الاحتياطي', action: 'backup' },
  { to: '/users', ico: '🔑', label: 'المستخدمين', action: 'users' },
  { to: '/settings', ico: '⚙️', label: 'الإعدادات', action: 'settings' },
];

const MOBILE = ['/', '/pos', '/items', '/customers', '/invoices'];

export default function Layout() {
  const { user, logout } = useAuth();
  const pending = useLiveQuery(() => db.syncQueue.where('synced').equals(0).count(), [], 0);
  const bizName = useLiveQuery(() => getSetting('bizName', 'خالد لقطع غيار المحمول'), [], 'خالد لقطع غيار المحمول');
  const visible = MENU.filter((m) => !m.action || can(user.role, m.action));
  const mobileItems = visible.filter((m) => MOBILE.includes(m.to)).slice(0, 5);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          {bizName}
          <small>نظام المبيعات والمخزون</small>
        </div>
        <nav className="nav">
          {visible.map((m) => (
            <NavLink key={m.to} to={m.to} end={m.to === '/'}>
              <span className="ico">{m.ico}</span> {m.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          <b>{user.name}</b>
          <span style={{ opacity: 0.75 }}>{ROLES[user.role]}</span>
          {pending > 0 && (
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>
              ⏳ {pending} عملية بانتظار المزامنة
            </div>
          )}
          <button onClick={logout}>تسجيل الخروج</button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <nav className="bottom-nav">
        {mobileItems.map((m) => (
          <NavLink key={m.to} to={m.to} end={m.to === '/'}>
            <span className="ico">{m.ico}</span>
            {m.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
