export const fmt = (n) =>
  Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

export const money = (n) => `${fmt(n)} ج.م`;

export const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' }) +
    ' ' + d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
};

export const fmtDay = (day) => {
  if (!day) return '';
  return new Date(day + 'T00:00:00').toLocaleDateString('ar-EG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
};

export const monthOf = (day) => (day || '').slice(0, 7); // YYYY-MM

// WhatsApp helpers: Egyptian 01xxxxxxxxx -> 201xxxxxxxxx
export const waPhone = (phone) => {
  let p = String(phone || '').replace(/\D/g, '');
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0') && p.length === 11) p = '2' + p;
  return p;
};
export const waLink = (phone, text) => {
  const p = waPhone(phone);
  const t = encodeURIComponent(text);
  return p ? `https://wa.me/${p}?text=${t}` : `https://wa.me/?text=${t}`;
};
export const marginPct = (cost, sale) => (cost > 0 ? Math.round(((sale - cost) / cost) * 100) : 0);

export const ROLES = {
  admin: 'مدير النظام',
  sales: 'موظف مبيعات',
  store: 'أمين مخزن',
};

// permissions per role
export const can = (role, action) => {
  const map = {
    admin: ['pos', 'purchase', 'items', 'customers', 'suppliers', 'invoices', 'reports', 'expenses', 'backup', 'users', 'import', 'insights', 'settings', 'cancelInvoice', 'editItem'],
    sales: ['pos', 'customers', 'invoices'],
    store: ['purchase', 'items', 'suppliers', 'invoices', 'editItem'],
  };
  return (map[role] || []).includes(action);
};
