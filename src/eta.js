// ---------- Egyptian Tax Authority (ETA) e-invoice ----------
// Converts an internal invoice into the ETA document JSON (schema v1.0),
// UNSIGNED. The digital signature (CAdES via the company's USB token) and the
// submission to ETA happen OUTSIDE this app — this module only produces the
// exact document shape ETA expects, ready to be signed and uploaded.
//
// Nothing here talks to the network or touches secrets; it is a pure builder.

// Common ETA unit-of-measure codes (Codes → Arabic label shown in the UI).
export const ETA_UNITS = [
  { code:'EA',  label:'قطعة / وحدة (EA)' },
  { code:'KGM', label:'كيلوجرام (KGM)' },
  { code:'GRM', label:'جرام (GRM)' },
  { code:'LTR', label:'لتر (LTR)' },
  { code:'MTR', label:'متر (MTR)' },
  { code:'MTK', label:'متر مربع (MTK)' },
  { code:'BX',  label:'علبة (BX)' },
  { code:'PR',  label:'زوج (PR)' },
  { code:'SET', label:'طقم (SET)' },
  { code:'HUR', label:'ساعة (HUR)' },
  { code:'DAY', label:'يوم (DAY)' },
];

export const ETA_ITEM_TYPES = [
  { code:'GS1', label:'GS1 (باركود عالمي)' },
  { code:'EGS', label:'EGS (كود مصلحة الضرائب)' },
];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r5 = (n) => Math.round((Number(n) || 0) * 100000) / 100000;

// Map our invoice type → ETA documentType (I=invoice, C=credit note).
export const etaDocType = (type) => (type === 'sale_return' ? 'C' : 'I');

// Which invoices ETA applies to (your OUTPUT documents only).
export const etaApplies = (type) => type === 'sale' || type === 'sale_return';

// List what's still missing before a valid document can be built.
// Returns an array of human (Arabic) messages; empty array = ready.
export function etaValidate(inv, { settings, items }) {
  const miss = [];
  if (!settings?.trn) miss.push('الرقم الضريبي للمنشأة (TRN) غير مضبوط في الإعدادات');
  if (!settings?.activityCode) miss.push('كود النشاط الضريبي غير مضبوط في الإعدادات');
  if (!settings?.name) miss.push('اسم المنشأة غير مضبوط');
  if (!etaApplies(inv?.type)) miss.push('الفاتورة الإلكترونية تصدر لفواتير البيع ومرتجع البيع فقط');
  const byId = new Map((items || []).map((it) => [it.id, it]));
  for (const l of (inv?.lines || [])) {
    const it = byId.get(l.itemId);
    const code = it?.etaItemCode || (it?.etaItemType === 'GS1' ? it?.barcode : '');
    if (!code) miss.push(`الصنف «${l.name}» بدون كود ضريبي (GS1/EGS)`);
  }
  return miss;
}

// Build the ETA issuer/receiver address object from stored fields.
const addr = (a = {}) => ({
  branchID: a.branchID || '0',
  country: a.country || 'EG',
  governate: a.governate || '',
  regionCity: a.regionCity || '',
  street: a.street || '',
  buildingNumber: a.buildingNumber || '',
  postalCode: a.postalCode || '',
  floor: a.floor || '',
  room: a.room || '',
  landmark: a.landmark || '',
  additionalInformation: a.additionalInformation || '',
});

// Build the unsigned ETA document for one invoice.
// settings: { trn, name, activityCode, taxSubType, issuerType, address{...} }
// customer: the receiver party (optional, for B2B id/name)
export function buildEtaDocument(inv, { settings = {}, customer = null, items = [] } = {}) {
  const taxRate = Number(inv.taxRate) || 0;
  const disc = Number(inv.discount) || 0;
  const subtotal = (inv.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const taxSubType = settings.taxSubType || 'V009'; // standard VAT subtype — verify per activity
  const byId = new Map((items || []).map((it) => [it.id, it]));

  let totalSales = 0, totalTax = 0, totalLineDisc = 0;

  const invoiceLines = (inv.lines || []).map((l) => {
    const qty = Number(l.qty) || 0;
    const unitValue = Number(l.price) || 0;
    const salesTotal = r5(qty * unitValue);
    const lineDisc = r5(salesTotal * (subtotal > 0 ? disc / subtotal : 0));
    const netTotal = r5(salesTotal - lineDisc);
    const taxable = l.taxable !== false && taxRate > 0;
    // netTotal already reflects the proportional invoice discount; VAT is on it.
    const taxAmount = r5(taxable ? netTotal * taxRate / 100 : 0);
    const total = r2(netTotal + taxAmount);

    totalSales += salesTotal;
    totalTax += taxAmount;
    totalLineDisc += lineDisc;

    const it = byId.get(l.itemId) || {};
    const itemType = it.etaItemType || 'EGS';
    const itemCode = it.etaItemCode || (itemType === 'GS1' ? (it.barcode || l.barcode || '') : '');
    const unitType = it.etaUnit || 'EA';

    return {
      description: l.name || '',
      itemType,
      itemCode,
      unitType,
      quantity: r5(qty),
      internalCode: l.code || '',
      salesTotal,
      total,
      valueDifference: 0,
      totalTaxableFees: 0,
      netTotal,
      itemsDiscount: 0,
      unitValue: { currencySold: 'EGP', amountEGP: r5(unitValue) },
      discount: { rate: 0, amount: lineDisc },
      taxableItems: taxable ? [
        { taxType: 'T1', amount: taxAmount, subType: taxSubType, rate: r2(taxRate) },
      ] : [],
    };
  });

  const netAmount = r2(totalSales - disc);
  const totalAmount = r2(netAmount + totalTax);

  const receiver = {
    address: addr(customer?.etaAddress),
    type: customer?.taxId ? 'B' : 'P',
    name: customer?.name || inv.partyName || 'عميل نقدي',
  };
  if (customer?.taxId) receiver.id = String(customer.taxId);
  else if (customer?.nationalId) receiver.id = String(customer.nationalId);

  return {
    issuer: {
      address: addr(settings.address),
      type: settings.issuerType || 'B',
      id: String(settings.trn || ''),
      name: settings.name || '',
    },
    receiver,
    documentType: etaDocType(inv.type),
    documentTypeVersion: '1.0',
    dateTimeIssued: inv.createdAt || new Date().toISOString(),
    taxpayerActivityCode: String(settings.activityCode || ''),
    internalID: String(inv.number || inv.id || ''),
    invoiceLines,
    totalDiscountAmount: r2(disc),
    totalSalesAmount: r2(totalSales),
    netAmount,
    taxTotals: totalTax > 0 ? [{ taxType: 'T1', amount: r2(totalTax) }] : [],
    totalAmount,
    extraDiscountAmount: 0,
    totalItemsDiscountAmount: 0,
  };
}
