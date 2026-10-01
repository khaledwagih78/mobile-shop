import { describe, it, expect } from 'vitest';
import { waPhone, marginPct, monthOf, parseInvoiceLines, matchItem, genBarcode } from '../src/utils.js';

describe('utils — pure helpers', () => {
  it('waPhone normalizes Egyptian numbers to international', () => {
    expect(waPhone('01012345678')).toBe('201012345678');
    expect(waPhone('00201012345678')).toBe('201012345678');
    expect(waPhone('201012345678')).toBe('201012345678');
  });

  it('marginPct computes profit margin over cost', () => {
    expect(marginPct(100, 150)).toBe(50);
    expect(marginPct(0, 150)).toBe(0); // guard against divide-by-zero
    expect(marginPct(200, 150)).toBe(-25);
  });

  it('monthOf takes the YYYY-MM prefix', () => {
    expect(monthOf('2026-09-30')).toBe('2026-09');
    expect(monthOf('')).toBe('');
  });

  it('parseInvoiceLines parses name/qty/price from separated text', () => {
    const rows = parseInvoiceLines('شاشة ايفون\t2\t150\nبطارية, 3, 80');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'شاشة ايفون', qty: 2, price: 150 });
    expect(rows[1]).toMatchObject({ name: 'بطارية', qty: 3, price: 80 });
  });

  it('matchItem finds the best catalog match by tokens/model number', () => {
    const items = [
      { id: 1, name: 'شاشة سامسونج A50', code: 'S50' },
      { id: 2, name: 'بطارية ايفون 11', code: 'B11' },
    ];
    const m = matchItem('شاشة A50', items);
    expect(m.item.id).toBe(1);
    expect(m.score).toBeGreaterThan(0);
  });

  it('genBarcode returns a valid 13-digit EAN-13 checksum', () => {
    const code = genBarcode();
    expect(code).toHaveLength(13);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += (+code[i]) * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (sum % 10)) % 10;
    expect(+code[12]).toBe(check);
  });
});
