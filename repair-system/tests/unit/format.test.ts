import { describe, expect, it } from 'vitest';
import { durationLabel, fromLocalInput, money, toLocalInput } from '../../apps/web/src/lib/format';
import { extractToken } from '../../apps/web/src/lib/token';

describe('تنسيق العرض', () => {
  it('مدة وجود الجهاز في المحل', () => {
    expect(durationLabel(null)).toBe('—');
    expect(durationLabel(0.4)).toBe('أقل من ساعة');
    expect(durationLabel(5)).toBe('5 ساعات');
    expect(durationLabel(24)).toBe('يوم');
    expect(durationLabel(50)).toBe('يومين وساعتين');
    expect(durationLabel(75)).toBe('3 أيام و3 ساعات');
  });

  it('المبالغ بالجنيه', () => {
    expect(money(1250)).toBe('1,250 ج.م');
    expect(money(null)).toBe('—');
  });

  it('حقل التاريخ والوقت بتوقيت القاهرة', () => {
    const v = toLocalInput('2026-11-13T10:00:00Z'); // القاهرة UTC+2 في نوفمبر
    expect(v).toBe('2026-11-13T12:00');
    expect(fromLocalInput('')).toBeNull();
  });
});

describe('ربط الحساب برابط الإيصال', () => {
  it('يقبل الرابط الكامل أو الرمز', () => {
    const tok = 'a'.repeat(36);
    expect(extractToken(`https://x.app/track/${tok}`)).toBe(tok);
    expect(extractToken(`https://x.app/receipt/${tok.toUpperCase()}?a=1`)).toBe(tok);
    expect(extractToken(`  ${tok} `)).toBe(tok);
  });
});
