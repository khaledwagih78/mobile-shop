import { describe, expect, it } from 'vitest';
import { readyMessage, receivedMessage, trackingUrl, waLink } from '../../packages/shared/src/index';

describe('روابط واتساب اليدوية', () => {
  it('waLink يحوّل الرقم المصري ويشفّر الرسالة', () => {
    expect(waLink('01012345678', 'تم استلام جهازك')).toBe(
      'https://wa.me/201012345678?text=' + encodeURIComponent('تم استلام جهازك'));
    expect(waLink(null, 'x')).toBe('https://wa.me/?text=x');
  });

  it('رابط المتابعة بدون شرطة مكررة', () => {
    expect(trackingUrl('https://a.example/', 'abc')).toBe('https://a.example/track/abc');
  });

  it('نص رسالة الاستلام والجاهزية مطابق للمواصفات', () => {
    const m = receivedMessage('KMR-2026-000001', 'https://a/track/t');
    expect(m).toContain('مرحبًا بك في خالد لصيانة المحمول.');
    expect(m).toContain('رقم طلب الصيانة: KMR-2026-000001');
    expect(m.endsWith('https://a/track/t')).toBe(true);
    expect(readyMessage('KMR-2026-000001')).toContain('تم الانتهاء من صيانة جهازك واعتماد جاهزيته للاستلام.');
  });
});
