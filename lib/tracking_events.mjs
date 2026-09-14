import { isDbConfigured, supabaseRequest } from './db.mjs';
import { sendMetaCapiEvent } from './meta.mjs';

const ALLOWED_PUBLIC_EVENTS = new Set([
  'session_attribution_updated',
  // Troca de página no site. É o único evento que vira PageView na Meta, e vai com o mesmo
  // event_id que o Pixel usou — sem isso o mesmo acesso contaria duas vezes.
  'page_view',
  'view_agenda',
  'view_course',
  'select_course_card',
  'click_enrollment_cta',
  'click_whatsapp',
  'click_whatsapp_help',
  'begin_enrollment',
  'begin_voomp_acceptance',
  'view_student_area',
  'cart_abandoned',
  'submit_lead',
  'submit_lead_error',
  'submit_voomp_acceptance',
  'submit_voomp_acceptance_error',
  'voomp_return_view',
  'clube_escola_signup',
]);

function safeString(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function verifyTrackingSecret(request) {
  const configured = process.env.WHATSAPP_FOLLOWUP_WEBHOOK_SECRET || '';
  if (!configured) return { configured: false, ok: true };
  const received = request.headers['x-ebn-whatsapp-secret'] || request.headers.authorization?.replace(/^Bearer\s+/i, '');
  return { configured: true, ok: received === configured };
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = safeObject(request.body);
  const requestedEvent = safeString(body.event || body.event_name || 'whatsapp_event', 120);
  const isPublicEvent = ALLOWED_PUBLIC_EVENTS.has(requestedEvent);
  const secret = verifyTrackingSecret(request);
  if (!isPublicEvent && !secret.ok) return response.status(401).json({ ok: false, error: 'invalid_tracking_secret' });

  const attribution = safeObject(body.attribution);
  const payload = safeObject(body.payload);
  const event = {
    event_name: requestedEvent,
    session_id: safeString(attribution.session_id || body.session_id || body.contact_id, 160) || null,
    url: safeString(body.url || body.checkout_url || body.last_landing_page || attribution.last_landing_page, 500) || null,
    referrer: safeString(body.referrer || attribution.last_referrer, 500) || null,
    utm_source: safeString(attribution.utm_source || body.utm_source || (isPublicEvent ? '' : 'whatsapp'), 120) || null,
    utm_medium: safeString(attribution.utm_medium || body.utm_medium || (isPublicEvent ? '' : 'whatsapp'), 120) || null,
    utm_campaign: safeString(attribution.utm_campaign || body.utm_campaign || body.flow_name || body.campaign, 180) || null,
    payload: {
      ...payload,
      contact_id: safeString(body.contact_id, 160) || null,
      phone: safeString(body.phone || body.whatsapp, 80) || null,
      name: safeString(body.name || body.first_name, 180) || null,
      course_slug: safeString(body.course_slug || body.ebn_curso_origem, 120) || null,
      course_name: safeString(body.course_name || body.ebn_curso_nome, 180) || null,
      class_date: safeString(body.class_date || body.ebn_turma_data, 180) || null,
      status: safeString(body.status || body.ebn_status_matricula, 120) || null,
      attribution,
      path: safeString(body.path, 300) || null,
      title: safeString(body.title, 180) || null,
      event_id: safeString(body.event_id, 220) || null,
      raw: body,
    },
  };

  const metaPayload = { ...event.payload, ...event, attribution, event_id: event.payload.event_id };
  // Preview da Vercel e ambiente local gravam no banco (o CRM acompanha teste também), mas não
  // viram número de campanha. Ausente = produção, pra não quebrar navegador com o JS antigo
  // ainda em cache.
  const daProducao = body.production !== false;
  const mandarProMeta = (nome, dados, req) => (daProducao ? sendMetaCapiEvent(nome, dados, req) : Promise.resolve({ configured: true, sent: false, skipped: 'fora_de_producao' }));
  if (!isDbConfigured()) {
    const meta = await mandarProMeta(requestedEvent, metaPayload, request);
    return response.status(202).json({
      ok: true,
      status: isPublicEvent ? 'public_event_accepted_not_persisted' : 'whatsapp_event_validated_not_persisted',
      persistence: { configured: false, persisted: false },
      meta,
    });
  }

  try {
    await supabaseRequest('tracking_events', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(event),
    });
    const meta = await mandarProMeta(requestedEvent, metaPayload, request);
    // O WhatsApp de abandono (10% off) só é enviado pelo cron de recuperação de carrinho,
    // depois de 30 minutos e após reconferir pagamento/opt-in (regra P1.1 do Manual do produto).
    // Ver api/cron/recover-carts.mjs.
    return response.status(202).json({ ok: true, status: isPublicEvent ? 'public_event_persisted' : 'whatsapp_event_persisted', meta });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error.code || 'tracking_event_persist_failed' });
  }
}
