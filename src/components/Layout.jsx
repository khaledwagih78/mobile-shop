import { useState, useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, setSetting, stockOf } from '../db';
import { useAuth } from '../auth';
import { can, ROLES } from '../utils';
import { useSyncStatus } from '../sync';
import { getSector } from '../sectors';
import { featAllowed } from '../plans';
import { Modal } from './UI';

// nav items that can never be hidden (so the user can always get back / reconfigure)
const ALWAYS_SHOWN = ['/', '/settings'];

function relTime(iso) {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso)) / 60_000);
  if (m < 1) return 'الآن';
  if (m < 60) return `${m}د`;
  return `${Math.floor(m / 60)}س`;
}

const SYNC_ICO = { syncing: '⏳', ok: '☁️', error: '⚠️', offline: '📵', idle: '☁️' };

const MENU = [
  { to: '/', ico: '📊', label: 'الرئيسية', action: null },
  { to: '/alerts', ico: '🔔', label: 'التنبيهات', action: 'alerts', feat: 'alerts' },
  { to: '/insights', ico: '🤖', label: 'المساعد الذكي', action: 'insights', feat: 'ai' },
  { to: '/smart', ico: '🧠', label: 'التحليلات الذكية', action: 'smart', feat: 'ai' },
  { to: '/voice', ico: '🎤', label: 'تحليل بالصوت', action: 'voice', feat: 'ai' },
  { to: '/pos', ico: '🧾', label: 'بيع جديد', action: 'pos' },
  { to: '/quote', ico: '📄', label: 'عرض سعر', action: 'quote' },
  { to: '/purchase', ico: '📥', label: 'فاتورة شراء', action: 'purchase' },
  { to: '/purchase-order', ico: '📝', label: 'طلب شراء', action: 'purchase' },
  { to: '/smart-import', ico: '✨', label: 'الإضافة الذكية', action: 'smartimport', feat: 'ai' },
  { to: '/sale-return', ico: '↩️', label: 'مرتجع بيع', action: 'returns' },
  { to: '/purchase-return', ico: '↪️', label: 'مرتجع شراء', action: 'returns' },
  { to: '/invoices', ico: '🗂️', label: 'الفواتير', action: 'invoices' },
  { to: '/items', ico: '📦', label: 'المخزون', action: 'items' },
  { to: '/pricing', ico: '🏷️', label: 'قوائم الأسعار', action: 'pricing', mod: 'wholesale', feat: 'pricing' },
  { to: '/production', ico: '🏭', label: 'التصنيع', action: 'production', mod: 'production', feat: 'production' },
  { to: '/inventory-ops', ico: '📋', label: 'الجرد والتسويات', action: 'invops' },
  { to: '/transfer', ico: '🔄', label: 'تحويل بضاعة', action: 'transfer' },
  { to: '/crm', ico: '🤝', label: 'العملاء المحتملون', action: 'crm', mod: 'crm', feat: 'crm' },
  { to: '/customers', ico: '👥', label: 'العملاء', action: 'customers' },
  { to: '/suppliers', ico: '🚚', label: 'الموردين', action: 'suppliers' },
  { to: '/deliveries', ico: '🚗', label: 'التوصيل', action: 'pos', mod: 'delivery', feat: 'delivery' },
  { to: '/reps', ico: '🚶', label: 'المندوبون', action: 'reps', mod: 'reps', feat: 'reps' },
  { to: '/expenses',   ico: '💸', label: 'المصروفات',  action: 'expenses'   },
  { to: '/employees',  ico: '👷', label: 'الموظفين',   action: 'employees'  },
  { to: '/payroll',    ico: '💵', label: 'الرواتب',    action: 'payroll', feat: 'payroll' },
  { to: '/accounting', ico: '📒', label: 'المحاسبة', action: 'accounting', feat: 'accounting' },
  { to: '/treasury', ico: '🏦', label: 'الخزائن والبنوك', action: 'treasury', feat: 'treasury' },
  { to: '/cash-close', ico: '🧮', label: 'تقفيل اليومية', action: 'cashclose' },
  { to: '/assets', ico: '🏛️', label: 'الأصول الثابتة', action: 'assets', mod: 'assets', feat: 'assets' },
  { to: '/installments', ico: '💳', label: 'الأقساط والديون', action: 'installments', mod: 'installments', feat: 'installments' },
  { to: '/projects', ico: '📁', label: 'المشاريع', action: 'projects', mod: 'projects', feat: 'projects' },
  { to: '/maintenance', ico: '🔧', label: 'الصيانة', action: 'maintenance', mod: 'repair', feat: 'maintenance' },
  { to: '/reports', ico: '📈', label: 'التقارير', action: 'reports' },
  { to: '/report-builder', ico: '🧱', label: 'منشئ التقارير', action: 'reportbuilder' },
  { to: '/audit', ico: '📋', label: 'سجل النشاطات', action: 'reports' },
  { to: '/import', ico: '📑', label: 'استيراد Excel', action: 'import' },
  { to: '/backup', ico: '🛡️', label: 'النسخ الاحتياطي', action: 'backup' },
  { to: '/branches', ico: '🏢', label: 'الفروع', action: 'branches' },
  { to: '/users', ico: '🔑', label: 'المستخدمين', action: 'users' },
  { to: '/sector', ico: '🧭', label: 'مجال النشاط', action: 'sector' },
  { to: '/settings', ico: '⚙️', label: 'الإعدادات', action: 'settings' },
  { to: '/custom-fields', ico: '🧩', label: 'الحقول المخصّصة', action: 'settings' },
  { to: '/requests', ico: '📝', label: 'الطلبات والاقتراحات', action: 'requests' },
];

const MOBILE = ['/', '/pos', '/items', '/customers', '/invoices'];

export default function Layout() {
  const { user, logout, branches, activeBranch, setActiveBranch } = useAuth();
  const syncStatus = useSyncStatus();
  const pending    = useLiveQuery(() => db.syncQueue.where('synced').equals(0).count(), [], 0);
  const bizName = useLiveQuery(() => getSetting('bizName', ''), [], '');
  // browser tab title follows the shop's own name once it's set
  useEffect(() => { document.title = bizName || 'نظام المبيعات والمخزون'; }, [bizName]);
  const sectorId = useLiveQuery(() => getSetting('bizSector', 'general'), [], 'general');
  const sector = getSector(sectorId);
  // per-shop overrides on top of the sector default: { [mod]: true|false }
  const modOverrides = useLiveQuery(() => getSetting('moduleOverrides', {}), [], {}) || {};
  // active edition/plan (soft, marketing gating): free | basic | full
  const plan = useLiveQuery(() => getSetting('plan', 'full'), [], 'full');
  // per-shop nav declutter: routes the user chose to hide from the menu
  const navHidden = useLiveQuery(() => getSetting('navHidden', []), [], []) || [];
  const [customizing, setCustomizing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const lowStockCount = useLiveQuery(async () => {
    const items = await db.items.toArray();
    return items.filter((it) => stockOf(it, activeBranch) > 0 && stockOf(it, activeBranch) <= (it.minStock || 0)).length;
  }, [activeBranch], 0);
  // does a mod-gated section show? per-shop override wins, else the sector default
  const modShown = (mod) => {
    if (Object.prototype.hasOwnProperty.call(modOverrides, mod)) return modOverrides[mod] === true;
    return sector.allMods || (sector.mods || []).includes(mod);
  };
  // items allowed by permission + sector + plan (before the user's declutter choice)
  const permitted = MENU
    .filter((m) => (!m.action || can(user.role, m.action)) && (!m.mod || modShown(m.mod)) && featAllowed(plan, m.feat))
    // apply sector-specific labels (e.g. المخزون -> "المواد والمنتجات")
    .map((m) => (sector.relabel && sector.relabel[m.to]) ? { ...m, label: sector.relabel[m.to] } : m);
  const isHidden = (to) => navHidden.includes(to) && !ALWAYS_SHOWN.includes(to);
  const visible = permitted.filter((m) => !isHidden(m.to));
  const mobileItems = visible.filter((m) => MOBILE.includes(m.to)).slice(0, 5);
  const isAdmin = user.role === 'admin';
  const curBranch = branches.find((b) => b.id === activeBranch);

  const toggleHidden = async (to) => {
    if (ALWAYS_SHOWN.includes(to)) return;
    const next = navHidden.includes(to) ? navHidden.filter((x) => x !== to) : [...navHidden, to];
    await setSetting('navHidden', next);
    import('../sync').then((m) => m.triggerSync()).catch(() => {});
  };
  const resetNav = async () => { await setSetting('navHidden', []); import('../sync').then((m) => m.triggerSync()).catch(() => {}); };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          {bizName || 'اسم المتجر'}
          <small>نظام المبيعات والمخزون</small>
        </div>

        <div className="branch-switch" style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.12)' }}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>🏢 الفرع الحالي</div>
          {isAdmin && branches.length > 1 ? (
            <select
              className="input"
              value={activeBranch}
              onChange={(e) => setActiveBranch(Number(e.target.value))}
              style={{ width: '100%', padding: '6px 8px', fontSize: 13 }}
            >
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : (
            <b style={{ fontSize: 14 }}>{curBranch ? curBranch.name : 'الفرع الرئيسي'}</b>
          )}
        </div>

        <nav className="nav">
          {visible.map((m) => (
            <NavLink key={m.to} to={m.to} end={m.to === '/'}>
              <span className="ico">{m.ico}</span> {m.label}
              {m.to === '/items' && lowStockCount > 0 && (
                <span className="badge red" style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px' }}>{lowStockCount}</span>
              )}
            </NavLink>
          ))}
          <button type="button" className="nav-customize" onClick={() => setCustomizing(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'transparent', border: 0, color: 'inherit', opacity: 0.75, cursor: 'pointer', padding: '10px 14px', font: 'inherit', textAlign: 'right' }}>
            <span className="ico">🎛️</span> تخصيص الأيقونات
          </button>
        </nav>
        <div className="sidebar-user">
          <b>{user.name}</b>
          <span style={{ opacity: 0.75 }}>{ROLES[user.role]}</span>
          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.75 }}>
            {SYNC_ICO[syncStatus.state] || '☁️'}{' '}
            {syncStatus.state === 'syncing' && 'جاري المزامنة...'}
            {syncStatus.state === 'ok'      && `مزامن ${relTime(syncStatus.at) || ''}`}
            {syncStatus.state === 'error'   && 'خطأ في المزامنة'}
            {syncStatus.state === 'offline' && 'بدون إنترنت'}
            {syncStatus.state === 'idle'    && 'Supabase'}
            {pending > 0 && syncStatus.state !== 'syncing' && ` · ${pending} معلّق`}
          </div>
          <button onClick={logout}>تسجيل الخروج</button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <nav className="bottom-nav">
        {mobileItems.slice(0, 4).map((m) => (
          <NavLink key={m.to} to={m.to} end={m.to === '/'}>
            <span className="ico">{m.ico}</span>
            {m.label}
          </NavLink>
        ))}
        <button type="button" className="more-btn" onClick={() => setMoreOpen(true)}
          style={{ background: 'transparent', border: 0, color: 'inherit', font: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer', flex: 1 }}>
          <span className="ico" style={{ fontSize: 20 }}>☰</span>
          المزيد
        </button>
      </nav>

      {/* Mobile full menu: reach every section + customize + logout */}
      {moreOpen && (
        <Modal title="📋 القائمة" onClose={() => setMoreOpen(false)}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8, maxHeight: '60vh', overflowY: 'auto' }}>
            {visible.map((m) => (
              <NavLink key={m.to} to={m.to} end={m.to === '/'} onClick={() => setMoreOpen(false)}
                className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, margin: 0, textDecoration: 'none', color: 'inherit' }}>
                <span className="ico" style={{ fontSize: 20 }}>{m.ico}</span>
                <span style={{ fontSize: 13 }}>{m.label}</span>
              </NavLink>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn ghost" onClick={() => { setMoreOpen(false); setCustomizing(true); }}>🎛️ تخصيص الأيقونات</button>
            <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={logout}>تسجيل الخروج</button>
          </div>
        </Modal>
      )}

      {customizing && (
        <Modal title="🎛️ تخصيص أيقونات القائمة" onClose={() => setCustomizing(false)}>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            اختَر الأيقونات اللي تظهر في القائمة. الأقسام اللي بتستخدمها كل فترة (زي الجرد) تقدر تخفيها لتقليل الزحمة —
            وتفضل موجودة وترجّعها من هنا أي وقت.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 6, maxHeight: '55vh', overflowY: 'auto' }}>
            {permitted.map((m) => {
              const locked = ALWAYS_SHOWN.includes(m.to);
              const shown = !isHidden(m.to);
              return (
                <label key={m.to} className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, margin: 0, cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.6 : 1 }}>
                  <input type="checkbox" checked={shown} disabled={locked} onChange={() => toggleHidden(m.to)} style={{ width: 18, height: 18 }} />
                  <span className="ico">{m.ico}</span>
                  <span style={{ flex: 1, fontSize: 13 }}>{m.label}</span>
                  {locked && <span className="badge gray" style={{ fontSize: 10 }}>دائم</span>}
                </label>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn ghost sm" onClick={resetNav}>↺ إظهار الكل</button>
            <button className="btn accent sm" style={{ marginRight: 'auto' }} onClick={() => setCustomizing(false)}>تم</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
