// Webhook servidor-a-servidor da Voomp. Este é o ÚNICO endpoint autorizado a confirmar
// pagamento, ocupar vaga e liberar acesso do aluno para cursos vendidos pela Voomp
// (regra P0.4 do Manual do produto). Configure no painel da Voomp para apontar para esta rota,
// com o mesmo token de VOOMP_WEBHOOK_TOKEN configurado aqui.
import { markVoompPaymentReturn } from '../../lib/db.mjs';
import { sendMetaCapiEvent } from '../../lib/meta.mjs';
import { notifyOfficialWhatsapp } from '../../lib/whatsapp.mjs';

function safeString(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function pick(...values) {
  for (const value of values) {
    const text = safeString(value, 1200);
    if (text) return text;
  }
  return '';
}

function cleanPhone(value = '') {
  return String(value || '').replace(/\D/g, '').slice(0, 20);
}

function verifyVoompSecret(request, body = {}) {
  const configured = process.env.VOOMP_WEBHOOK_TOKEN || '';
  if (!configured) return { configured: false, ok: false };
  const received =
    request.headers['x-voomp-token'] ||
    request.headers['x-webhook-token'] ||
    request.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
    body.token ||
    body.webhook_token ||
    request.query?.token;
  return { configured: true, ok: received === configured };
}

function normalizeVoompSaleWebhook(body = {}, query = {}) {
  const data = safeObject(body.data);
  const sale = safeObject(body.sale) || safeObject(data.sale) || data || body;
  const customer = safeObject(sale.customer) || safeObject(sale.client) || safeObject(sale.buyer) || safeObject(sale.student) || {};
  const product = safeObject(sale.product) || safeObject(sale.offer) || safeObject(sale.course) || {};
  const payment = safeObject(sale.payment) || safeObject(sale.transaction) || {};
  const productName = pick(product.name, product.title, sale.product_name, sale.offer_name, sale.course_name, sale.name);
  // Achado numa auditoria em 04/09/2026: o valor de reserva não pode conter substring que o
  // paidStatus() (lib/db.mjs) reconheça como "pago" (ex.: "received", "confirmed") — senão um
  // webhook sem nenhum campo de status reconhecido é tratado como pagamento confirmado de
  // verdade, sem nenhuma confirmação real da Voomp.
  const status = pick(body.newStatus, sale.newStatus, sale.status, sale.payment_status, payment.status, body.status, body.event, query.status, 'sale_status_unknown');
  const courseSlug = /noturno|noite/i.test(productName)
    ? 'cabeleireiro-profissional-noturno'
    : /cabeleireiro|cabelereiro|cab/i.test(productName)
      ? 'cabeleireiro-profissional'
      : pick(sale.course_slug, query.course, 'cabeleireiro-profissional');

  return {
    provider: 'voomp',
    event: pick(body.event === 'saleUpdated' ? '' : body.event, body.event_name, query.event, /paid|pago|approved|aprovado|confirmed|confirmado|received|recebido/i.test(status) ? 'voomp_payment_confirmed' : 'voomp_sale_received'),
    voompType: pick(body.type, sale.type),
    voompEvent: pick(body.event, body.event_name),
    oldStatus: pick(body.oldStatus, sale.oldStatus),
    checkoutStatus: status,
    voompStatus: status,
    voompSaleId: pick(sale.id, sale.sale_id, sale.uuid, sale.code, payment.id, payment.transaction_id, body.id, query.id),
    paymentId: pick(payment.id, payment.transaction_id, sale.payment_id, sale.transaction_id),
    paymentMethod: pick(payment.method, payment.payment_method, sale.payment_method, sale.method),
    amount: pick(sale.amount, sale.value, sale.total, sale.price, payment.amount, payment.value),
    courseSlug,
    courseName: productName || 'Cabeleireiro Profissional',
    classDate: pick(sale.class_date, sale.turma, product.class_date, product.turma, query.turma),
    name: pick(customer.name, customer.full_name, sale.customer_name, sale.buyer_name, sale.name, body.name, query.name),
    email: pick(customer.email, sale.customer_email, sale.buyer_email, sale.email, body.email, query.email).toLowerCase(),
    whatsapp: cleanPhone(pick(customer.phone, customer.whatsapp, customer.mobile, sale.customer_phone, sale.buyer_phone, sale.phone, sale.whatsapp, body.phone, body.whatsapp, query.phone, query.whatsapp)),
    checkoutUrl: pick(sale.checkout_url, sale.url, body.checkout_url, query.checkout_url),
    attribution: {
      session_id: pick(sale.session_id, body.session_id, query.session_id),
      utm_source: pick(sale.utm_source, body.utm_source, query.utm_source),
      utm_medium: pick(sale.utm_medium, body.utm_medium, query.utm_medium),
      utm_campaign: pick(sale.utm_campaign, body.utm_campaign, query.utm_campaign),
      last_landing_page: pick(sale.url, body.url, query.url),
    },
    raw: { body, query },
  };
}

function validateVoompPayload(payload = {}) {
  const hasIdentity = Boolean(payload.voompSaleId || payload.paymentId || payload.attribution?.session_id || payload.email || payload.whatsapp);
  const hasCourse = Boolean(payload.courseSlug || payload.courseName);
  const hasStatus = Boolean(payload.checkoutStatus || payload.voompStatus || payload.event);
  const isConfirmed = /confirmed|confirmado|received|recebido|paid|pago|approved|aprovado/i.test(`${payload.event || ''} ${payload.checkoutStatus || ''} ${payload.voompStatus || ''}`);
  const hasPaymentIdentifier = Boolean(payload.voompSaleId || payload.paymentId);

  if (!hasIdentity || !hasCourse || !hasStatus) return { ok: false, error: 'invalid_voomp_webhook_payload' };
  if (isConfirmed && !hasPaymentIdentifier) return { ok: false, error: 'voomp_payment_identifier_required' };
  return { ok: true };
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = safeObject(request.body);

  // Fail-closed: sem token configurado, nenhum evento é aceito (mesma regra P0.3/P0.4 do webhook Asaas).
  const secret = verifyVoompSecret(request, body);
  if (!secret.configured) return response.status(503).json({ ok: false, error: 'webhook_token_not_configured' });
  if (!secret.ok) return response.status(401).json({ ok: false, error: 'invalid_voomp_webhook_token' });

  const payload = normalizeVoompSaleWebhook(body, request.query || {});
  const payloadValidation = validateVoompPayload(payload);
  if (!payloadValidation.ok) {
    return response.status(400).json({ ok: false, error: payloadValidation.error });
  }

  const audit = {
    receivedAt: new Date().toISOString(),
    ip: request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket?.remoteAddress || null,
    userAgent: request.headers['user-agent'] || null,
    source: 'voomp_server_webhook',
  };

  try {
    const voompUpdate = await markVoompPaymentReturn(payload, audit);
    const resolvedAccessUrl = voompUpdate?.studentAccessUrl || null;
    // Id estável por venda. Tinha um `Date.now()` no fim: a Voomp reenvia o webhook quando não
    // recebe 200, e cada reenvio virava uma COMPRA nova na Meta — faturamento inflado e custo
    // por venda achatado na campanha. Sem venda identificada, o evento não sai.
    const idDaVenda = payload.voompSaleId || payload.paymentId || '';
    const meta = idDaVenda
      ? await sendMetaCapiEvent(payload.event, { ...payload, provider: 'voomp', event_id: `voomp:${idDaVenda}` }, request)
      : { configured: true, sent: false, skipped: 'venda_sem_identificador' };
    const whatsapp = await notifyOfficialWhatsapp(payload.event, { ...payload, provider: 'voomp', studentId: voompUpdate?.studentId, enrollmentId: voompUpdate?.enrollmentId, studentAccessUrl: resolvedAccessUrl });
    return response.status(200).json({ ok: true, status: 'voomp_webhook_processed', voompUpdate, meta, whatsapp, audit });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error.code || 'voomp_webhook_processing_failed' });
  }
}
