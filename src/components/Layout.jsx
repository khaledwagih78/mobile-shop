import { useState, useEffect } from'react';
import { NavLink, Outlet } from'react-router-dom';
import { useLiveQuery } from'dexie-react-hooks';
import { db, getSetting, setSetting, stockOf } from'../db';
import { useAuth } from'../auth';
import { can, ROLES } from'../utils';
import { useSyncStatus } from'../sync';
import { getSector } from'../sectors';
import { featAllowed } from'../plans';
import { Modal } from'./UI';
import { Icon } from'./Icon';
import {
  Building,
  SlidersHorizontal,
  LogOut,
  Menu,
  RotateCcw,
  Cloud,
  Loader2,
  AlertTriangle,
  WifiOff
} from'lucide-react';

// nav items that can never be hidden (so the user can always get back / reconfigure)
const ALWAYS_SHOWN = ['/','/settings'];

function relTime(iso) {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso)) / 60_000);
  if (m < 1) return'الآن';
  if (m < 60) return`${m}د`;
  return`${Math.floor(m / 60)}س`;
}

function SyncStatusIcon({ state }) {
  if (state ==='syncing') return <Loader2 size={13} className="animate-spin" style={{ marginLeft: 4 }} />;
  if (state ==='error') return <AlertTriangle size={13} style={{ marginLeft: 4, color:'#f87171' }} />;
  if (state ==='offline') return <WifiOff size={13} style={{ marginLeft: 4, opacity: 0.7 }} />;
  return <Cloud size={13} style={{ marginLeft: 4 }} />;
}

const MENU = [
  // 1. الرئيسية
  { to: '/', icon: 'LayoutDashboard', label: 'الرئيسية', action: null },

  // 2. المساعد والتحليلات الذكية
  { to: '/insights', icon: 'Sparkles', label: 'المساعد والتحليلات الذكية', action: 'insights', feat: 'ai' },

  // 3. بيع جديد (POS)
  { to: '/pos', icon: 'Receipt', label: 'بيع جديد', action: 'pos' },

  // 4. الفواتير
  { to: '/invoices', icon: 'Files', label: 'الفواتير', action: 'invoices' },

  // 5. المخزون
  { to: '/items', icon: 'Boxes', label: 'المخزون', action: 'items' },
  { to: '/import', icon: 'FileSpreadsheet', label: 'استيراد من إكسل', action: 'import' },
  { to: '/inventory-ops', icon: 'ClipboardCheck', label: 'جرد وتسويات المخزون', action: 'invops' },

  // 6. الفروع والتحويلات
  { to: '/branches', icon: 'Building', label: 'إدارة الفروع', action: 'branches' },
  { to: '/transfer', icon: 'ArrowLeftRight', label: 'التحويل بين الفروع', action: 'transfer' },

  // 7. العملاء والموردين
  { to: '/customers', icon: 'Users', label: 'العملاء والموردين', action: 'customers' },

  // 8. الخزائن والمصروفات
  { to: '/expenses', icon: 'Wallet', label: 'المصروفات', action: 'expenses' },
  { to: '/cash-close', icon: 'Calculator', label: 'تقفيل اليومية (الكاش)', action: 'cashclose' },
  { to: '/treasury', icon: 'Landmark', label: 'الخزائن والبنوك', action: 'treasury', feat: 'treasury' },
  { to: '/accounting', icon: 'Scale', label: 'المحاسبة المتقدمة', action: 'accounting', feat: 'accounting' },

  // 9. التقارير
  { to: '/reports', icon: 'TrendingUp', label: 'التقارير', action: 'reports' },
  { to: '/alerts', icon: 'Bell', label: 'مركز التنبيهات', action: 'alerts', feat: 'alerts' },

  // 10. الإدارة والمستخدمين
  { to: '/employees', icon: 'UserCheck', label: 'شؤون الموظفين', action: 'employees' },
  { to: '/users', icon: 'ShieldCheck', label: 'المستخدمون والصلاحيات', action: 'users' },
  { to: '/backup', icon: 'Database', label: 'النسخ الاحتياطي', action: 'backup' },
  { to: '/settings', icon: 'Settings', label: 'الإعدادات', action: 'settings' },
  { to: '/guide', icon: 'HelpCircle', label: 'دليل الاستخدام', action: 'guide' },

  // وحدات الأنشطة المتخصصة — تظهر فقط بحسب نشاط المنشأة
  { to: '/production', icon: 'Factory', label: 'التصنيع', action: 'production', mod: 'production', feat: 'production' },
  { to: '/projects', icon: 'FolderKanban', label: 'المشاريع', action: 'projects', mod: 'projects', feat: 'projects' },
  { to: '/maintenance', icon: 'Wrench', label: 'الصيانة', action: 'maintenance', mod: 'repair', feat: 'maintenance' },
  { to: '/pricing', icon: 'Tags', label: 'قوائم الأسعار', action: 'pricing', mod: 'wholesale', feat: 'pricing' },
  { to: '/reps', icon: 'Footprints', label: 'المندوبون', action: 'reps', mod: 'reps', feat: 'reps' },
  { to: '/deliveries', icon: 'Car', label: 'التوصيل', action: 'pos', mod: 'delivery', feat: 'delivery' },
  { to: '/crm', icon: 'Handshake', label: 'العملاء المحتملون', action: 'crm', mod: 'crm', feat: 'crm' },
  { to: '/assets', icon: 'Building2', label: 'الأصول الثابتة', action: 'assets', mod: 'assets', feat: 'assets' },
  { to: '/installments', icon: 'CreditCard', label: 'الأقساط والديون', action: 'installments', mod: 'installments', feat: 'installments' },
];

const MOBILE = ['/','/pos','/items','/customers','/invoices'];

export default function Layout() {
  const { user, logout, branches, activeBranch, setActiveBranch } = useAuth();
  const syncStatus = useSyncStatus();
  const pending    = useLiveQuery(() => db.syncQueue.where('synced').equals(0).count(), [], 0);
  const bizName = useLiveQuery(() => getSetting('bizName',''), [],'');
  // browser tab title follows the shop's own name once it's set
  useEffect(() => { document.title = bizName ||'نظام المبيعات والمخزون'; }, [bizName]);
  const sectorId = useLiveQuery(() => getSetting('bizSector','general'), [],'general');
  const sector = getSector(sectorId);
  // per-shop overrides on top of the sector default: { [mod]: true|false }
  const modOverrides = useLiveQuery(() => getSetting('moduleOverrides', {}), [], {}) || {};
  // active edition/plan (soft, marketing gating): free | basic | full
  const plan = useLiveQuery(() => getSetting('plan','full'), [],'full');
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
    // apply sector-specific labels (e.g. المخزون ->"المواد والمنتجات")
    .map((m) => (sector.relabel && sector.relabel[m.to]) ? { ...m, label: sector.relabel[m.to] } : m);
  const isHidden = (to) => navHidden.includes(to) && !ALWAYS_SHOWN.includes(to);
  const visible = permitted.filter((m) => !isHidden(m.to));
  const mobileItems = visible.filter((m) => MOBILE.includes(m.to)).slice(0, 4);
  const isAdmin = user.role ==='admin';
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
          {bizName ||'اسم المتجر'}
          <small>نظام المبيعات والمخزون</small>
        </div>

        <div className="branch-switch" style={{ padding:'10px 14px', borderBottom:'1px solid rgba(255,255,255,.12)' }}>
          <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 4, display:'flex', alignItems:'center', justifyContent: 'space-between' }}>
            <span style={{ display:'flex', alignItems:'center', gap: 4 }}>
              <Building size={12} /> الفرع الحالي
            </span>
            {isAdmin && (
              <NavLink to="/branches" style={{ color: '#fff', fontSize: 11, textDecoration: 'underline', opacity: 0.9 }}>
                إدارة الفروع
              </NavLink>
            )}
          </div>
          {isAdmin && branches.length > 1 ? (
            <select
              className="input"
              value={activeBranch}
              onChange={(e) => setActiveBranch(Number(e.target.value))}
              style={{ width:'100%', padding:'6px 8px', fontSize: 13, background:'rgba(255,255,255,0.95)' }}
            >
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <b style={{ fontSize: 14 }}>{curBranch ? curBranch.name :'الفرع الرئيسي'}</b>
              {isAdmin && branches.length === 1 && (
                <NavLink to="/branches" className="badge gray" style={{ fontSize: 10, textDecoration: 'none', color: '#15252b', background: '#fff' }}>
                  ＋ إضافة فرع
                </NavLink>
              )}
            </div>
          )}
          {branches.length > 1 && (
            <div style={{ marginTop: 6, fontSize: 11 }}>
              <NavLink to="/transfer" style={{ color: 'rgba(255,255,255,0.9)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <RotateCcw size={11} /> تحويل مخزون بين الفروع
              </NavLink>
            </div>
          )}
        </div>

        <nav className="nav">
          {visible.map((m) => (
            <NavLink key={m.to} to={m.to} end={m.to ==='/'}>
              <span className="ico">
                <Icon name={m.icon} size={17} strokeWidth={2} />
              </span>
              <span>{m.label}</span>
              {m.to ==='/items' && lowStockCount > 0 && (
                <span className="badge red" style={{ marginRight:'auto', fontSize: 10, padding:'2px 6px' }}>{lowStockCount}</span>
              )}
            </NavLink>
          ))}
          <button type="button" className="nav-btn" onClick={() => setCustomizing(true)}>
            <span className="ico">
              <SlidersHorizontal size={17} strokeWidth={2} />
            </span>
            <span>تخصيص القائمة</span>
          </button>
        </nav>
        <div className="sidebar-user">
          <b>{user.name}</b>
          <span style={{ opacity: 0.75 }}>{ROLES[user.role]}</span>
          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.8, display:'flex', alignItems:'center' }}>
            <SyncStatusIcon state={syncStatus.state} />
            <span>
              {syncStatus.state ==='syncing' &&'جاري المزامنة...'}
              {syncStatus.state ==='ok'      &&`مزامن ${relTime(syncStatus.at) ||''}`}
              {syncStatus.state ==='error'   &&'خطأ في المزامنة'}
              {syncStatus.state ==='offline' &&'بدون إنترنت'}
              {syncStatus.state ==='idle'    &&'جاهز للمزامنة'}
              {pending > 0 && syncStatus.state !=='syncing' &&` · ${pending} معلّق`}
            </span>
          </div>
          <button type="button" onClick={logout}>
            <LogOut size={13} />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <nav className="bottom-nav">
        {mobileItems.map((m) => (
          <NavLink key={m.to} to={m.to} end={m.to ==='/'}>
            <span className="ico">
              <Icon name={m.icon} size={18} strokeWidth={2} />
            </span>
            <span>{m.label}</span>
          </NavLink>
        ))}
        <button type="button" className="more-btn" onClick={() => setMoreOpen(true)}>
          <span className="ico">
            <Menu size={18} strokeWidth={2} />
          </span>
          <span>المزيد</span>
        </button>
      </nav>

      {/* Mobile full menu: reach every section + customize + logout */}
      {moreOpen && (
        <Modal title="قائمة الأقسام" onClose={() => setMoreOpen(false)}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap: 8, maxHeight:'60vh', overflowY:'auto' }}>
            {visible.map((m) => (
              <NavLink key={m.to} to={m.to} end={m.to ==='/'} onClick={() => setMoreOpen(false)}
                className="card" style={{ display:'flex', alignItems:'center', gap: 8, padding: 12, margin: 0, textDecoration:'none', color:'inherit' }}>
                <span className="ico" style={{ display:'flex', alignItems:'center' }}>
                  <Icon name={m.icon} size={18} strokeWidth={2} />
                </span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{m.label}</span>
              </NavLink>
            ))}
          </div>
          <div style={{ display:'flex', gap: 8, marginTop: 14 }}>
            <button className="btn ghost" onClick={() => { setMoreOpen(false); setCustomizing(true); }}>
              <SlidersHorizontal size={15} />
              تخصيص القائمة
            </button>
            <button className="btn ghost danger" style={{ marginRight:'auto' }} onClick={logout}>
              <LogOut size={15} />
              تسجيل الخروج
            </button>
          </div>
        </Modal>
      )}

      {customizing && (
        <Modal title="تخصيص عناصر القائمة" onClose={() => setCustomizing(false)}>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            اختَر الأقسام التي تود ظهورها في القائمة الجانبية لتسهيل وسرعة الوصول. يمكنك تعديل هذا الخيار في أي وقت.
          </p>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap: 6, maxHeight:'55vh', overflowY:'auto' }}>
            {permitted.map((m) => {
              const locked = ALWAYS_SHOWN.includes(m.to);
              const shown = !isHidden(m.to);
              return (
                <label key={m.to} className="card" style={{ display:'flex', alignItems:'center', gap: 8, padding: 8, margin: 0, cursor: locked ?'default' :'pointer', opacity: locked ? 0.6 : 1 }}>
                  <input type="checkbox" checked={shown} disabled={locked} onChange={() => toggleHidden(m.to)} style={{ width: 18, height: 18, accentColor:'var(--primary)' }} />
                  <span className="ico" style={{ display:'flex', alignItems:'center' }}>
                    <Icon name={m.icon} size={16} strokeWidth={2} />
                  </span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{m.label}</span>
                  {locked && <span className="badge gray" style={{ fontSize: 10 }}>دائم</span>}
                </label>
              );
            })}
          </div>
          <div style={{ display:'flex', gap: 8, marginTop: 12 }}>
            <button className="btn ghost sm" onClick={resetNav}>
              <RotateCcw size={14} />
              إظهار الكل
            </button>
            <button className="btn accent sm" style={{ marginRight:'auto' }} onClick={() => setCustomizing(false)}>
              حفظ
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
