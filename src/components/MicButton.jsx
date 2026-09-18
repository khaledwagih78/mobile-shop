import { useRef, useState } from 'react';

// Small reusable voice-to-text button. Calls onResult(transcript) with what the
// user said (Egyptian Arabic). Falls back gracefully when speech isn't available.
export default function MicButton({ onResult, title = 'اسأل بصوتك', size = 40 }) {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const supported = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

  const stop = () => { try { recRef.current?.stop(); } catch { /* ignore */ } };

  const start = () => {
    if (!supported) { alert('المتصفح لا يدعم الإدخال الصوتي — اكتب بدلاً من ذلك. (المايك يعمل على Chrome بالموبايل)'); return; }
    try {
      const R = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new R();
      rec.lang = 'ar-EG'; rec.interimResults = false; rec.maxAlternatives = 1;
      rec.onstart = () => setListening(true);
      rec.onend = () => setListening(false);
      rec.onerror = (e) => {
        setListening(false);
        const c = e && e.error;
        if (c === 'not-allowed' || c === 'service-not-allowed') alert('اسمح بالوصول للميكروفون من إعدادات المتصفح.');
        else if (c === 'network') alert('التعرّف على الصوت يحتاج إنترنت.');
      };
      rec.onresult = (e) => { const said = e.results[0][0].transcript; onResult && onResult(said); };
      recRef.current = rec;
      rec.start();
    } catch { setListening(false); }
  };

  return (
    <button
      type="button"
      title={title}
      onClick={listening ? stop : start}
      style={{
        width: size, height: size, minWidth: size, borderRadius: '50%', border: 'none', cursor: 'pointer',
        fontSize: Math.round(size * 0.5), color: '#fff', lineHeight: 1,
        background: listening ? 'var(--red, #d64545)' : 'var(--primary, #0F4C5C)',
        boxShadow: listening ? '0 0 0 6px rgba(214,69,69,.25)' : 'none',
        transition: 'all .15s',
      }}
    >🎤</button>
  );
}
