function safeString(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanPhone(value = '') {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 20);
  if (!digits) return '';
  return digits.startsWith('55') ? digits : `55${digits}`;
}

function manychatApiConfig() {
  return {
    apiKey: process.env.MANYCHAT_API_KEY || '',
    baseUrl: process.env.MANYCHAT_API_BASE_URL || 'https://api.manychat.com',
  };
}

export function manychatRuntimeConfig() {
  const api = manychatApiConfig();
  const webhook = manychatConfig();
  return {
    apiConfigured: Boolean(api.apiKey),
    webhookConfigured: Boolean(webhook.webhookUrl),
  };
}

export function manychatConfig() {
  return {
    webhookUrl: process.env.MAKE_EBN_CHECKOUT_WEBHOOK_URL || process.env.MANYCHAT_CHECKOUT_RETURN_WEBHOOK_URL || process.env.MANYCHAT_CHECKOUT_WEBHOOK_URL || '',
    secret: process.env.MAKE_EBN_CHECKOUT_WEBHOOK_SECRET || process.env.MANYCHAT_WEBHOOK_SECRET || '',
  };
}

function manychatFlowNamespace(eventName, body = {}) {
  const template = safeString(body.template_name || body.template_key, 120);
  const flows = {
    crm_enrollment_started: process.env.MANYCHAT_FLOW_ENROLLMENT_STARTED || 'content20260717174653_033234',
    ebn_matricula_iniciada: process.env.MANYCHAT_FLOW_ENROLLMENT_STARTED || 'content20260717174653_033234',
    crm_payment_pending: process.env.MANYCHAT_FLOW_PAYMENT_PENDING || 'content20260717175442_243971',
    ebn_pagamento_pendente: process.env.MANYCHAT_FLOW_PAYMENT_PENDING || 'content20260717175442_243971',
    // A recovery message promises a discount. Never fall back to the generic
    // payment-pending flow, otherwise the customer may receive the wrong copy.
    crm_abandoned_cart_coupon: process.env.MANYCHAT_FLOW_ABANDONED_CART || '',
    ebn_carrinho_abandonado_cupom: process.env.MANYCHAT_FLOW_ABANDONED_CART || '',
    crm_enrollment_confirmation: process.env.MANYCHAT_FLOW_ENROLLMENT_CONFIRMATION || 'content20260717174945_686410',
    ebn_matricula_confirmada: process.env.MANYCHAT_FLOW_ENROLLMENT_CONFIRMATION || 'content20260717174945_686410',
    crm_class_reminder: process.env.MANYCHAT_FLOW_CLASS_REMINDER || 'content20260717175624_681237',
    ebn_lembrete_aula: process.env.MANYCHAT_FLOW_CLASS_REMINDER || 'content20260717175624_681237',
  };
  return flows[eventName] || flows[template] || '';
}

function tagsForPayload(eventName, payload) {
  const tags = [];
  const status = safeString(payload.checkoutStatus || payload.checkout_status || payload.voompStatus || payload.voomp_status || payload.status, 160).toLowerCase();

  if (eventName === 'voomp_acceptance_registered' || eventName === 'crm_enrollment_started') tags.push('a escola | Matrícula Iniciada');
  if (eventName === 'crm_payment_pending' || eventName === 'crm_abandoned_cart_coupon' || eventName === 'voomp_checkout_return') tags.push('a escola | Pagamento Pendente');
  if (eventName === 'crm_enrollment_confirmation') tags.push('a escola | Matrícula Confirmada');
  if (eventName === 'crm_class_reminder') tags.push('a escola | Lembrete Aula');

  if (/paid|pago|approved|aprovado|confirmed|confirmado|received|recebido/.test(status) || eventName === 'voomp_payment_confirmed') {
    tags.push('a escola | Matrícula Confirmada');
  } else if (/pending|pendente|waiting|aguardando|created|criado/.test(status) || eventName === 'voomp_sale_received' || eventName === 'asaas_payment_created') {
    tags.push('a escola | Pagamento Pendente');
  }

  return [...new Set(tags.filter(Boolean))];
}

function wait(ms = 250) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function manychatRequest(path, apiKey, body = null) {
  const { baseUrl } = manychatApiConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { status: 'error', message: text.slice(0, 200) };
  }
  return { response, data };
}

function phoneCandidates(value = '') {
  const raw = String(value || '').replace(/\D/g, '').slice(0, 20);
  const phone = cleanPhone(value);
  if (!phone) return [];
  const local = phone.startsWith('55') ? phone.slice(2) : raw;
  return [...new Set([phone, `+${phone}`, local].filter(Boolean))];
}

async function resolveSubscriberId(apiKey, body) {
  const direct = safeString(body.subscriber_id || body.whatsapp_id || body.manychat_subscriber_id, 160);
  if (direct && /^\d+$/.test(direct)) return { subscriberId: direct, source: 'payload_id' };

  const phones = phoneCandidates(body.phone);
  if (!phones.length) return { subscriberId: null, source: null, reason: 'missing_subscriber_id_or_phone' };

  let lastFailure = null;
  const fields = ['phone', 'whatsapp_phone', 'phone_number', 'wa_id'];
  for (const phone of phones) {
    const formats = [
      { path: `/fb/subscriber/findBySystemField?phone=${encodeURIComponent(phone)}`, sourceField: 'legacy_phone_query' },
      ...fields.map((field) => ({ path: `/fb/subscriber/findBySystemField?field_name=${encodeURIComponent(field)}&field_value=${encodeURIComponent(phone)}`, sourceField: field })),
    ];
    for (const lookup of formats) {
      const { response, data } = await manychatRequest(lookup.path, apiKey);
      const found = Array.isArray(data.data) ? data.data[0] : data.data;
      const subscriberId = found?.id || found?.subscriber_id || null;
      if (!response.ok || data.status === 'error') {
        lastFailure = { reason: data.message || 'find_subscriber_failed', status: response.status, phoneFormat: phone.startsWith('+') ? 'e164_plus' : phone.startsWith('55') ? 'digits_55' : 'local_digits', sourceField: lookup.sourceField };
        continue;
      }
      if (subscriberId) return { subscriberId: String(subscriberId), source: `${lookup.sourceField}:${phone.startsWith('+') ? 'e164_plus' : phone.startsWith('55') ? 'digits_55' : 'local_digits'}` };
    }
  }

  return { subscriberId: null, source: 'phone', reason: lastFailure?.reason || 'subscriber_not_found', status: lastFailure?.status, phoneFormat: lastFailure?.phoneFormat, sourceField: lastFailure?.sourceField };
}

function splitName(fullName = '') {
  const parts = safeString(fullName, 180).split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: null, lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || null };
}

async function createManychatSubscriber(apiKey, body) {
  const phones = phoneCandidates(body.phone);
  const phoneDigits = phones.find((phone) => !phone.startsWith('+')) || '';
  const email = safeString(body.email, 180).toLowerCase() || null;
  if (!phoneDigits && !email) return { created: false, reason: 'missing_phone_or_email' };
  const { firstName, lastName } = splitName(body.name);
  const consentPhrase = safeString(
    body.consent_phrase
      || body.opt_in_phrase
      || `Contato criado pela agenda a escola após início de matrícula/aceite com telefone informado para receber mensagens transacionais sobre o curso ${body.course_name || ''}.`,
    500,
  );
  const attempts = [
    { whatsapp_phone: phoneDigits || null, phoneFormat: 'whatsapp_phone_digits_55' },
    { whatsapp_phone: phoneDigits ? `+${phoneDigits}` : null, phoneFormat: 'whatsapp_phone_e164_plus' },
    { phone_number: phoneDigits || null, phoneFormat: 'phone_number_digits_55' },
    { phone_number: phoneDigits ? `+${phoneDigits}` : null, phoneFormat: 'phone_number_e164_plus' },
    { phone: phoneDigits || null, phoneFormat: 'phone_digits_55' },
    { phone: phoneDigits ? `+${phoneDigits}` : null, phoneFormat: 'phone_e164_plus' },
    { wa_id: phoneDigits || null, phoneFormat: 'wa_id_digits_55' },
    { waId: phoneDigits || null, phoneFormat: 'waId_digits_55' },
    { email, phoneFormat: 'email_only' },
  ].filter((item) => item.phone || item.phone_number || item.whatsapp_phone || item.wa_id || item.waId || item.email);

  let last = null;
  const diagnostics = [];
  for (const attempt of attempts) {
    const payload = {
      first_name: firstName,
      last_name: lastName,
      ...(attempt.phone ? { phone: attempt.phone } : {}),
      ...(attempt.phone_number ? { phone_number: attempt.phone_number } : {}),
      ...(attempt.whatsapp_phone ? { whatsapp_phone: attempt.whatsapp_phone } : {}),
      ...(attempt.wa_id ? { wa_id: attempt.wa_id } : {}),
      ...(attempt.waId ? { waId: attempt.waId } : {}),
      ...(attempt.email ? { email: attempt.email } : email ? { email } : {}),
      has_opt_in_sms: Boolean(attempt.phone || attempt.phone_number),
      has_opt_in_whatsapp: Boolean(attempt.whatsapp_phone || attempt.wa_id || attempt.waId),
      consent_phrase: consentPhrase,
    };
    const { response, data } = await manychatRequest('/fb/subscriber/createSubscriber', apiKey, payload);
    const created = response.ok && data.status !== 'error';
    const subscriber = data.data || data;
    const subscriberId = subscriber?.id || subscriber?.subscriber_id || null;
    last = {
      created,
      status: response.status,
      subscriberId: subscriberId ? String(subscriberId) : null,
      message: data.message || data.error || null,
      error: data.error || null,
      phoneFormat: attempt.phoneFormat,
    };
    diagnostics.push({ phoneFormat: attempt.phoneFormat, status: response.status, message: data.message || data.error || null });
    if (created || subscriberId) return { ...last, diagnostics };
  }
  return last ? { ...last, diagnostics } : { created: false, reason: 'create_subscriber_failed', diagnostics };
}

async function resolveOrCreateSubscriberId(apiKey, body) {
  const resolved = await resolveSubscriberId(apiKey, body);
  if (resolved.subscriberId) return { ...resolved, created: false };

  const canAttemptCreate = ['subscriber_not_found', 'Validation error', 'find_subscriber_failed'].includes(resolved.reason) || Boolean(resolved.status);
  if (!canAttemptCreate) return resolved;

  const created = await createManychatSubscriber(apiKey, body);
  if (created.subscriberId) return { subscriberId: created.subscriberId, source: 'created', created: true, create: created, initialResolve: resolved };
  if (!created.created) return { subscriberId: null, source: 'createSubscriber', reason: created.message || 'create_subscriber_failed', create: created, initialResolve: resolved };

  const foundAfterCreate = await resolveSubscriberId(apiKey, body);
  return foundAfterCreate.subscriberId
    ? { ...foundAfterCreate, source: 'created_then_found', created: true, create: created, initialResolve: resolved }
    : { subscriberId: null, source: 'created_then_find', reason: foundAfterCreate.reason || 'created_but_subscriber_id_not_found', create: created, initialResolve: resolved };
}

async function sendManychatFlow(apiKey, subscriberId, eventName, body = {}) {
  const flowNs = manychatFlowNamespace(eventName, body);
  if (!flowNs) return { configured: false, sent: false, skipped: 'flow_not_mapped' };

  const { response, data } = await manychatRequest('/fb/sending/sendFlow', apiKey, {
    subscriber_id: subscriberId,
    flow_ns: flowNs,
  });

  return {
    configured: true,
    sent: response.ok && data.status !== 'error',
    status: response.status,
    flowNs,
    message: data.message || data.error || null,
  };
}

async function updateManychatContact(eventName, body) {
  const { apiKey } = manychatApiConfig();
  if (!apiKey) return { configured: false, sent: false, skipped: 'api_key_not_configured' };

  try {
    const resolved = await resolveOrCreateSubscriberId(apiKey, body);
    if (!resolved.subscriberId) return { configured: true, sent: false, ...resolved };

    const tags = tagsForPayload(eventName, body);
    const tagResults = [];
    for (const tag_name of tags) {
      const { response, data } = await manychatRequest('/fb/subscriber/addTagByName', apiKey, {
        subscriber_id: resolved.subscriberId,
        tag_name,
      });
      tagResults.push({ tag_name, ok: response.ok && data.status !== 'error', status: response.status, message: data.message || null });
      await wait();
    }

    // Keep this map aligned with fields that already exist in the a escola ManyChat account.
    // Sending unknown field names returns Validation error and burns API rate limit.
    const fields = {
      ebn_ultimo_evento: eventName,
      ebn_automation_stage: eventName,
      ebn_status_matricula: safeString(body.checkout_status || (eventName === 'voomp_acceptance_registered' ? 'aceite_realizado' : 'retorno_checkout'), 120),
      ebn_curso_nome: safeString(body.course_name, 180),
      ebn_turma_data: safeString(body.class_date, 180),
      ebn_turma_valor: safeString(body.amount || body.value || body.total, 80),
      ebn_checkout_url: safeString(body.checkout_url, 1200),
      ebn_cab_curso: safeString(body.course_name, 180),
      ebn_cab_status: safeString(body.checkout_status || body.voomp_status || body.status, 160),
      ebn_cab_etapa: eventName,
      ebn_cab_origem_lead: safeString(body.utm_source || body.provider, 120),
      ebn_campaign_name: safeString(body.utm_campaign, 180),
    };
    const fieldResults = [];
    for (const [field_name, field_value] of Object.entries(fields)) {
      if (!field_value) continue;
      const { response, data } = await manychatRequest('/fb/subscriber/setCustomFieldByName', apiKey, {
        subscriber_id: resolved.subscriberId,
        field_name,
        field_value,
      });
      fieldResults.push({ field_name, ok: response.ok && data.status !== 'error', status: response.status, message: data.message || null });
      await wait();
    }

    const flow = await sendManychatFlow(apiKey, resolved.subscriberId, eventName, body);

    const contactUpdated = tagResults.some((item) => item.ok) || fieldResults.some((item) => item.ok);
    return {
      configured: true,
      sent: contactUpdated || flow.sent,
      messageSent: Boolean(flow.sent),
      contactUpdated,
      subscriberSource: resolved.source,
      createdSubscriber: Boolean(resolved.created),
      subscriberCreate: resolved.create || null,
      tags: tagResults,
      fields: fieldResults,
      flow,
    };
  } catch (error) {
    return { configured: true, sent: false, error: error.message || 'manychat_api_failed' };
  }
}

export async function notifyManychatCheckout(eventName, payload = {}) {
  const config = manychatConfig();

  const body = {
    event: eventName,
    event_name: eventName,
    template_name: safeString(payload.templateName || payload.template_name || payload.crm?.templateName, 120) || null,
    template_key: safeString(payload.crm?.templateKey || payload.templateKey || payload.template_key, 120) || null,
    session_id: safeString(payload.attribution?.session_id || payload.session_id, 160) || null,
    subscriber_id: safeString(payload.attribution?.manychat_subscriber_id || payload.manychat_subscriber_id, 160) || null,
    whatsapp_id: safeString(payload.attribution?.mc_whatsapp_id || payload.attribution?.whatsapp_id || payload.whatsapp_id, 80) || null,
    phone: cleanPhone(payload.whatsapp || payload.studentWhatsapp || payload.phone),
    name: safeString(payload.name || payload.studentName, 180) || null,
    email: safeString(payload.email || payload.studentEmail, 180).toLowerCase() || null,
    course_slug: safeString(payload.courseSlug || payload.course_slug, 120) || null,
    course_name: safeString(payload.courseName || payload.course_name, 180) || null,
    class_date: safeString(payload.classDate || payload.class_date, 180) || null,
    checkout_url: safeString(payload.checkoutUrl || payload.checkout_url, 1200) || null,
    checkout_status: safeString(payload.checkoutStatus || payload.checkout_status, 120) || null,
    voomp_status: safeString(payload.voompStatus || payload.voomp_status, 160) || null,
    voomp_type: safeString(payload.voompType || payload.voomp_type, 80) || null,
    voomp_event: safeString(payload.voompEvent || payload.voomp_event, 120) || null,
    voomp_old_status: safeString(payload.oldStatus || payload.old_status, 160) || null,
    voomp_sale_id: safeString(payload.voompSaleId || payload.voomp_sale_id || payload.sale_id, 180) || null,
    sale_id: safeString(payload.sale_id || payload.voompSaleId || payload.voomp_sale_id, 180) || null,
    payment_id: safeString(payload.paymentId || payload.payment_id, 180) || null,
    payment_method: safeString(payload.paymentMethod || payload.payment_method, 120) || null,
    amount: safeString(payload.amount || payload.value || payload.total, 80) || null,
    provider: safeString(payload.provider || 'voomp', 80),
    utm_source: safeString(payload.attribution?.utm_source, 120) || null,
    utm_medium: safeString(payload.attribution?.utm_medium, 120) || null,
    utm_campaign: safeString(payload.attribution?.utm_campaign, 180) || null,
    raw: payload,
  };

  const api = await updateManychatContact(eventName, body);

  if (!config.webhookUrl) {
    return { configured: api.configured, sent: api.sent, api, webhook: { configured: false, sent: false, skipped: 'webhook_not_configured' } };
  }

  const headers = { 'content-type': 'application/json' };
  if (config.secret) headers['x-manychat-secret'] = config.secret;

  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return { configured: true, sent: api.sent, api, webhook: { configured: true, sent: false, status: response.status, error: 'manychat_webhook_non_2xx' } };
    }
    return { configured: true, sent: true, api, webhook: { configured: true, sent: true, status: response.status } };
  } catch (error) {
    return { configured: true, sent: api.sent, api, webhook: { configured: true, sent: false, error: error.message || 'manychat_webhook_failed' } };
  }
}
