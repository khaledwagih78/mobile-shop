import { useRef, useEffect } from 'react';
import { Modal } from './UI';

// Shared barcode / QR / serial scanner. Works with:
//  - the phone/laptop camera (BarcodeDetector API when available), and
//  - a USB/Bluetooth hardware scanner, which behaves like a keyboard — it types
//    into the manual field and sends Enter (handled here).
// `title` lets callers relabel it (e.g. "مسح سيريال الجهاز").
export default function BarcodeScanner({ onDetected, onClose, title = '📷 مسح باركود' }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const activeRef = useRef(true);

  const stopCamera = () => {
    activeRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    activeRef.current = true;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return; // no camera → manual entry only
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!activeRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        if ('BarcodeDetector' in window) {
          const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'code_93', 'codabar', 'itf', 'upc_a', 'upc_e', 'qr_code', 'data_matrix'] });
          const tick = async () => {
            if (!activeRef.current || !videoRef.current) return;
            if (videoRef.current.readyState >= 2) {
              try {
                const codes = await detector.detect(videoRef.current);
                if (codes.length > 0) { const v = codes[0].rawValue; stopCamera(); onDetected(v); return; }
              } catch { /* keep trying */ }
            }
            requestAnimationFrame(tick);
          };
          tick();
        }
      } catch (err) {
        // camera denied/unavailable — manual + hardware-scanner entry still works
        console.warn('[scanner] camera unavailable:', err && err.message);
      }
    })();
    return stopCamera; // cleanup on unmount
  }, []);

  const handleManual = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = e.target.value.trim();
      if (v) { stopCamera(); onDetected(v); }
    }
  };

  const hasDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  return (
    <Modal title={title} onClose={() => { stopCamera(); onClose(); }}>
      <div style={{ textAlign: 'center' }}>
        <video ref={videoRef} autoPlay playsInline muted
          style={{ width: '100%', maxWidth: 400, borderRadius: 8, background: '#000' }} />
        <p className="muted" style={{ margin: '10px 0' }}>
          {hasDetector ? 'وجّه الكاميرا نحو الباركود / QR — يُمسح تلقائياً' : 'المتصفح لا يدعم المسح بالكاميرا — استخدم جهاز الاسكان أو اكتب يدوياً'}
        </p>
        <div className="field">
          <label>أو استخدم جهاز الاسكان / اكتب الكود يدوياً</label>
          <input className="input lg" placeholder="امسح بالجهاز أو اكتب ثم اضغط Enter" onKeyDown={handleManual} autoFocus />
        </div>
      </div>
    </Modal>
  );
}
