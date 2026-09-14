// Retorno visual do Asaas Checkout (pagamento no cartão) no navegador da aluna.
// Este endpoint NUNCA confirma pagamento, matrícula ou vaga (regra P0.4 do Manual do produto):
// tudo aqui vem do navegador e pode ser forjado por qualquer pessoa. Ele só registra um
// evento de acompanhamento. A confirmação real só acontece pelo webhook autenticado da
// Asaas em /api/webhooks/asaas.
import { isDbConfigured, supabaseRequest } from '../../lib/db.mjs';
import { sendMetaCapiEvent } from '../../lib/meta.mjs';

function safeString(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizePayload(body = {}, query = {}) {
  const attribution = safeObject(body.attribution);
  return {
    provider: 'asaas',
    event: 'asaas_checkout_return',
    checkoutStatus: safeString(body.status || query.status, 120) || 'returned_from_checkout',
    courseSlug: safeString(body.courseSlug || query.course, 120),
    classDate: safeString(body.classDate || query.turma, 180),
    attribution: {
      ...attribution,
      session_id: safeString(attribution.session_id || body.session_id || query.session_id, 160) || null,
      last_landing_page: safeString(attribution.last_landing_page || body.url, 500) || null,
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
  if (!payload.courseSlug) {
    return response.status(400).json({ ok: false, error: 'invalid_asaas_checkout_return_payload' });
  }

  const audit = {
    receivedAt: new Date().toISOString(),
    ip: request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket?.remoteAddress || null,
    userAgent: request.headers['user-agent'] || null,
    source: 'asaas_checkout_browser_return',
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
          payload: { ...payload, audit },
        }),
      });
      persistence = { configured: true, persisted: true };
    } catch (error) {
      persistence = { configured: true, persisted: false, error: error.code || 'tracking_persist_failed' };
    }
  }

  const meta = await sendMetaCapiEvent(payload.event, { ...payload, event_id: `asaas-checkout-return:${payload.attribution.session_id || Date.now()}` }, request);

  return response.status(202).json({ ok: true, status: 'asaas_checkout_return_received', persistence, meta, audit });
}
