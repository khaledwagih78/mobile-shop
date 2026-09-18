import { getSetting, nowISO } from './db';

// Send an email notification for sensitive events (cancel/restore/delete) via
// EmailJS — a browser-based email service, so no backend is needed. It only
// fires when the shop has configured EmailJS in Settings and there's internet.
// Fire-and-forget: never throws into the caller.
export async function notifyEvent({ action, title, body }) {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const [serviceId, templateId, publicKey, to, bizName] = await Promise.all([
      getSetting('emailServiceId', ''),
      getSetting('emailTemplateId', ''),
      getSetting('emailPublicKey', ''),
      getSetting('emailTo', ''),
      getSetting('bizName', ''),
    ]);
    if (!serviceId || !templateId || !publicKey || !to) return; // not configured
    await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey,
        template_params: {
          to_email: to,
          subject: title,
          message: body,
          action: action || '',
          biz_name: bizName || '',
          time: new Date(nowISO()).toLocaleString('ar-EG'),
        },
      }),
    });
  } catch { /* ignore — notifications are best-effort */ }
}
