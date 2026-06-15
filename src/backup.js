import { db, nowISO } from './db';

const TABLES = ['items', 'customers', 'suppliers', 'invoices', 'payments', 'stockMoves', 'expenses', 'employees', 'empRecords', 'users', 'settings'];

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function exportBackup(password) {
  const data = { app: 'khaled-erp', version: 1, exportedAt: nowISO(), tables: {} };
  for (const t of TABLES) data.tables[t] = await db[t].toArray();
  const json = JSON.stringify(data);

  let blob, ext;
  if (password) {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(json));
    const out = new Uint8Array(4 + salt.length + iv.length + cipher.byteLength);
    out.set([0x4b, 0x45, 0x52, 0x50], 0); // "KERP" magic
    out.set(salt, 4);
    out.set(iv, 20);
    out.set(new Uint8Array(cipher), 32);
    blob = new Blob([out], { type: 'application/octet-stream' });
    ext = 'kerp';
  } else {
    blob = new Blob([json], { type: 'application/json' });
    ext = 'json';
  }
  const day = nowISO().slice(0, 10);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `khaled-backup-${day}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function importBackup(file, password) {
  let json;
  const buf = new Uint8Array(await file.arrayBuffer());
  const isEncrypted = buf.length > 32 && buf[0] === 0x4b && buf[1] === 0x45 && buf[2] === 0x52 && buf[3] === 0x50;
  if (isEncrypted) {
    if (!password) throw new Error('هذه النسخة مشفّرة — أدخل كلمة السر');
    const salt = buf.slice(4, 20);
    const iv = buf.slice(20, 32);
    const key = await deriveKey(password, salt);
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, buf.slice(32));
      json = new TextDecoder().decode(plain);
    } catch {
      throw new Error('كلمة السر غير صحيحة');
    }
  } else {
    json = new TextDecoder().decode(buf);
  }
  const data = JSON.parse(json);
  if (data.app !== 'khaled-erp') throw new Error('ملف نسخة احتياطية غير صالح');

  await db.transaction('rw', TABLES.map((t) => db[t]), async () => {
    for (const t of TABLES) {
      await db[t].clear();
      if (data.tables[t]?.length) await db[t].bulkAdd(data.tables[t]);
    }
  });
  return data.exportedAt;
}
