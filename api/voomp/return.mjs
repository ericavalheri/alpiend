// Retorno visual do checkout Voomp no navegador da aluna.
// Este endpoint NUNCA confirma pagamento, matrícula ou vaga (regra P0.4 do Manual do produto):
// tudo aqui vem do navegador e pode ser forjado por qualquer pessoa. Ele só registra um
// evento de acompanhamento para o atendimento continuar pelo WhatsApp. A confirmação real
// só acontece pelo webhook autenticado da Voomp em /api/webhooks/voomp.
import { isDbConfigured, supabaseRequest } from '../../lib/db.mjs';
import { sendMetaCapiEvent } from '../../lib/meta.mjs';
import { notifyOfficialWhatsapp } from '../../lib/whatsapp.mjs';

function safeString(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizePayload(body = {}, query = {}) {
  const attribution = safeObject(body.attribution);
  return {
    provider: 'voomp',
    event: 'voomp_checkout_return',
    checkoutStatus: safeString(body.status || query.status || body.checkout_status || 'returned_from_checkout', 120),
    courseSlug: safeString(body.courseSlug || query.course || query.courseSlug, 120),
    courseName: safeString(body.courseName || query.courseName, 180),
    classDate: safeString(body.classDate || query.turma || query.classDate, 180),
    name: safeString(body.name || query.name, 180),
    email: safeString(body.email || query.email, 180).toLowerCase(),
    whatsapp: safeString(body.whatsapp || query.whatsapp || query.phone, 80),
    checkoutId: safeString(body.checkoutId || query.checkout_id || query.id, 180),
    paymentId: safeString(body.paymentId || query.payment_id || query.transaction_id, 180),
    checkoutUrl: safeString(body.checkoutUrl || query.checkout_url, 1200),
    attribution: {
      ...attribution,
      session_id: safeString(attribution.session_id || body.session_id || query.session_id, 160) || null,
      utm_source: safeString(attribution.utm_source || query.utm_source, 120) || null,
      utm_medium: safeString(attribution.utm_medium || query.utm_medium, 120) || null,
      utm_campaign: safeString(attribution.utm_campaign || query.utm_campaign, 180) || null,
      last_landing_page: safeString(attribution.last_landing_page || body.url || query.url, 500) || null,
    },
  };
}

export default async function handler(request, response) {
  if (!['POST', 'GET'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = request.method === 'POST' ? safeObject(request.body) : {};
  const payload = normalizePayload(body, request.query || {});
  const hasIdentity = Boolean(payload.checkoutId || payload.paymentId || payload.attribution.session_id || payload.email || payload.whatsapp);
  if (!hasIdentity || !(payload.courseSlug || payload.courseName)) {
    return response.status(400).json({ ok: false, error: 'invalid_voomp_return_payload' });
  }

  const audit = {
    receivedAt: new Date().toISOString(),
    ip: request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket?.remoteAddress || null,
    userAgent: request.headers['user-agent'] || null,
    source: 'voomp_browser_return',
  };

  let persistence = { configured: isDbConfigured(), persisted: false };
  if (isDbConfigured()) {
    try {
      await supabaseRequest('tracking_events', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          event_name: payload.event,
          session_id: payload.attribution.session_id || null,
          url: payload.attribution.last_landing_page || null,
          utm_source: payload.attribution.utm_source || null,
          utm_medium: payload.attribution.utm_medium || null,
          utm_campaign: payload.attribution.utm_campaign || null,
          payload: { ...payload, audit },
        }),
      });
      persistence = { configured: true, persisted: true };
    } catch (error) {
      persistence = { configured: true, persisted: false, error: error.code || 'tracking_persist_failed' };
    }
  }

  const meta = await sendMetaCapiEvent(payload.event, { ...payload, provider: 'voomp', event_id: `voomp-return:${payload.paymentId || payload.checkoutId || payload.attribution.session_id || Date.now()}` }, request);
  const whatsapp = await notifyOfficialWhatsapp('voomp_checkout_return', { ...payload, provider: 'voomp' });

  return response.status(202).json({ ok: true, status: 'voomp_return_received', persistence, meta, whatsapp, audit });
}
