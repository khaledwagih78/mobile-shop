import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

const SVGNS = 'http://www.w3.org/2000/svg';
const OPTS = { format: 'CODE128', height: 60, fontSize: 14, width: 2, margin: 6, displayValue: true };

// Inline barcode (CODE128 works for any code/number string).
export function Barcode({ value, height = 60 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try { JsBarcode(ref.current, String(value), { ...OPTS, height }); }
    catch { /* invalid value */ }
  }, [value, height]);
  return <svg ref={ref} />;
}

// Serialize a barcode to an SVG string (for the print window).
export function barcodeSVG(value) {
  try {
    const el = document.createElementNS(SVGNS, 'svg');
    JsBarcode(el, String(value), OPTS);
    return new XMLSerializer().serializeToString(el);
  } catch { return ''; }
}
