// ---------- offline license / activation keys ----------
// Upgrades the edition (plan) with a signed activation code. The app holds ONLY
// the PUBLIC key, so it can verify a code but can NOT forge one — codes are minted
// by the reseller with the matching PRIVATE key in a separate generator tool that
// never ships in this app. This is genuine offline licensing (short of patching
// the app itself), far stronger than a plain toggle.
//
// Code format:  base64url(JSON payload) + "." + base64url(ECDSA-P256/SHA-256 sig)
// payload = { plan:'basic'|'full', exp:'YYYY-MM-DD'|null, shop?:string, id?:string, iat }
import { setSetting } from './db';

const PUBLIC_KEY_JWK = {
  kty: 'EC', crv: 'P-256',
  x: 'mE51fY5BiwE7df5ZKwDej-Xo_TyFikOl1R7UD_Y-F1U',
  y: 'A1-LvH2Sv9mtRy-A5DOj_IJn3kfirCJhkF0Vv-VboTM',
};

const b64urlToBytes = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const bytesToStr = (bytes) => new TextDecoder().decode(bytes);

let _keyPromise = null;
const getKey = () => {
  if (!_keyPromise) {
    _keyPromise = crypto.subtle.importKey('jwk', PUBLIC_KEY_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  }
  return _keyPromise;
};

// Verify a code's signature and expiry. Returns { valid, plan, exp, shop, reason }.
export async function verifyLicenseCode(code) {
  try {
    const clean = String(code || '').trim().replace(/\s+/g, '');
    const dot = clean.indexOf('.');
    if (dot < 0) return { valid: false, reason: 'الكود غير صحيح' };
    const payloadB64 = clean.slice(0, dot);
    const sigB64 = clean.slice(dot + 1);
    const payloadBytes = b64urlToBytes(payloadB64);
    const sigBytes = b64urlToBytes(sigB64);
    const key = await getKey();
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, payloadBytes);
    if (!ok) return { valid: false, reason: 'التوقيع غير صالح — الكود غير معتمد' };
    const payload = JSON.parse(bytesToStr(payloadBytes));
    if (!payload.plan) return { valid: false, reason: 'الكود لا يحتوي على خطة' };
    if (payload.exp) {
      const today = new Date().toISOString().slice(0, 10);
      if (today > payload.exp) return { valid: false, reason: `الكود منتهي الصلاحية (${payload.exp})`, expired: true, plan: payload.plan };
    }
    return { valid: true, plan: payload.plan, exp: payload.exp || null, shop: payload.shop || null, id: payload.id || null };
  } catch {
    return { valid: false, reason: 'تعذّر قراءة الكود' };
  }
}

// Verify + apply: on success set the plan and persist the license. Returns the result.
export async function applyLicenseCode(code) {
  const res = await verifyLicenseCode(code);
  if (res.valid) {
    await setSetting('plan', res.plan);
    await setSetting('licenseCode', String(code || '').trim());
    await setSetting('licenseExp', res.exp);
    await setSetting('licenseShop', res.shop);
    import('./sync').then((m) => m.triggerSync()).catch(() => {});
  }
  return res;
}

// Boot check: if a stored license has expired, drop the shop back to the free plan.
// (Only downgrades a plan that was granted by a license; a manually-set plan with
// no stored code is left alone.)
export async function enforceLicenseOnBoot(getSetting) {
  try {
    const code = await getSetting('licenseCode', '');
    if (!code) return;
    const res = await verifyLicenseCode(code);
    if (!res.valid) {
      await setSetting('plan', 'free');
    }
  } catch { /* best-effort */ }
}
