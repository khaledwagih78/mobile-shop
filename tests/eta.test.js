import { describe, it, expect } from 'vitest';
import { buildEtaDocument, etaValidate, etaApplies, etaDocType } from '../src/eta';

const items = [
  { id: 1, etaItemType: 'EGS', etaItemCode: 'EG-1', etaUnit: 'EA' },
  { id: 2, etaItemType: 'GS1', barcode: '6221', etaUnit: 'EA' },
];
const settings = { trn: '123456789', name: 'محل تجريبي', activityCode: '4651' };

const inv = (over = {}) => ({
  number: 'INV-1', type: 'sale', createdAt: '2026-11-28T10:00:00Z',
  taxRate: 14, discount: 0,
  lines: [
    { itemId: 1, name: 'صنف أ', code: 'A1', qty: 2, price: 100, taxable: true },
    { itemId: 2, name: 'صنف ب', code: 'B1', qty: 1, price: 50, taxable: true },
  ],
  ...over,
});

describe('ETA document builder', () => {
  it('maps types correctly', () => {
    expect(etaDocType('sale')).toBe('I');
    expect(etaDocType('sale_return')).toBe('C');
    expect(etaApplies('sale')).toBe(true);
    expect(etaApplies('purchase')).toBe(false);
  });

  it('computes totals and VAT with no discount', () => {
    const d = buildEtaDocument(inv(), { settings, items });
    expect(d.totalSalesAmount).toBe(250);
    expect(d.netAmount).toBe(250);
    expect(d.taxTotals[0].amount).toBe(35); // 250 * 14%
    expect(d.totalAmount).toBe(285);
    expect(d.issuer.id).toBe('123456789');
    expect(d.documentType).toBe('I');
    // line item codes resolve from the item (GS1 falls back to barcode)
    expect(d.invoiceLines[0].itemCode).toBe('EG-1');
    expect(d.invoiceLines[0].taxableItems[0].amount).toBe(28); // 200 * 14%
    expect(d.invoiceLines[1].itemType).toBe('GS1');
    expect(d.invoiceLines[1].itemCode).toBe('6221');
  });

  it('distributes an invoice discount proportionally before VAT', () => {
    const d = buildEtaDocument(inv({ discount: 25 }), { settings, items });
    expect(d.totalSalesAmount).toBe(250);
    expect(d.totalDiscountAmount).toBe(25);
    expect(d.netAmount).toBe(225);
    // line1 net 180 → tax 25.2 ; line2 net 45 → tax 6.3 ; total tax 31.5
    expect(d.taxTotals[0].amount).toBe(31.5);
    expect(d.totalAmount).toBe(256.5);
  });

  it('skips VAT on non-taxable lines', () => {
    const d = buildEtaDocument(inv({ lines: [{ itemId: 1, name: 'صنف أ', code: 'A1', qty: 1, price: 100, taxable: false }] }), { settings, items });
    expect(d.taxTotals).toEqual([]);
    expect(d.totalAmount).toBe(100);
    expect(d.invoiceLines[0].taxableItems).toEqual([]);
  });

  it('reports missing prerequisites', () => {
    const miss = etaValidate(inv({ lines: [{ itemId: 99, name: 'بدون كود', qty: 1, price: 10 }] }), { settings, items });
    expect(miss.some((m) => m.includes('بدون كود'))).toBe(true);
    const missNoTrn = etaValidate(inv(), { settings: {}, items });
    expect(missNoTrn.some((m) => m.includes('TRN'))).toBe(true);
  });
});
