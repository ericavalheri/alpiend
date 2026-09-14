import { buildStudentAccessUrl } from './student_access.mjs';

function safeString(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanPhone(value = '') {
  const phone = String(value || '').replace(/\D/g, '').slice(0, 20);
  if (!phone) return '';
  return phone.startsWith('55') ? phone : `55${phone}`;
}

function agendaUrl(path = '') {
  const baseUrl = (process.env.PUBLIC_AGENDA_BASE_URL || 'https://DOMINIO-NAO-CONFIGURADO').replace(/\/$/, '');
  const cleanPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
  return `${baseUrl}${cleanPath}`;
}

function isExternalProviderUrl(value = '') {
  return /(^|\.)asaas\.com\b|voomp\.com\.br\b/i.test(String(value || ''));
}

function courseCheckoutUrl(payload = {}) {
  const explicit = safeString(payload.publicCheckoutUrl || payload.public_checkout_url || payload.ebnCheckoutUrl || payload.ebn_checkout_url, 1000);
  if (explicit && !isExternalProviderUrl(explicit)) return explicit;

  const courseSlug = safeString(payload.courseSlug || payload.course_slug || payload.cart?.courseSlug || payload.cart?.course_slug, 140);
  const classDate = safeString(payload.classDate || payload.class_date || payload.cart?.classDate || payload.cart?.class_date, 180);
  if (!courseSlug) return agendaUrl('/');

  const flow = safeString(payload.flow || payload.cart?.flow, 80).toLowerCase();
  const route = flow === 'voomp' || courseSlug.includes('cabeleireiro-profissional') ? 'aceite' : 'matricula';
  const query = classDate ? `?turma=${encodeURIComponent(classDate)}` : '';
  return agendaUrl(`/${route}/${courseSlug}${query}`);
}

export function whatsappConfig() {
  const contentSids = {
    enrollmentStarted: process.env.TWILIO_CONTENT_SID_MATRICULA_INICIADA || process.env.TWILIO_CONTENT_SID_ENROLLMENT_STARTED || '',
    paymentPending: process.env.TWILIO_CONTENT_SID_PAGAMENTO_PENDENTE || process.env.TWILIO_CONTENT_SID_PAYMENT_PENDING || '',
    enrollmentConfirmed: process.env.TWILIO_CONTENT_SID_MATRICULA_CONFIRMADA || process.env.TWILIO_CONTENT_SID_ENROLLMENT_CONFIRMED || '',
    classReminder: process.env.TWILIO_CONTENT_SID_LEMBRETE_AULA || process.env.TWILIO_CONTENT_SID_CLASS_REMINDER || '',
    abandonedCartCoupon: process.env.TWILIO_CONTENT_SID_CARRINHO_ABANDONADO || process.env.TWILIO_CONTENT_SID_ABANDONED_CART_COUPON || '',
    welcome: process.env.TWILIO_CONTENT_SID_BOAS_VINDAS || process.env.TWILIO_CONTENT_SID_WELCOME || '',
    studentAccess: process.env.TWILIO_CONTENT_SID_ACESSO_ALUNO || process.env.TWILIO_CONTENT_SID_STUDENT_ACCESS || '',
    clubeEscola: process.env.TWILIO_CONTENT_SID_CLUBE_ESCOLA || '',
  };
  return {
    mode: process.env.WHATSAPP_FOLLOWUP_MODE || 'twilio',
    webhookUrl: process.env.WHATSAPP_FOLLOWUP_WEBHOOK_URL || process.env.MAKE_EBN_CHECKOUT_WEBHOOK_URL || '',
    webhookSecret: process.env.WHATSAPP_FOLLOWUP_WEBHOOK_SECRET || process.env.MAKE_EBN_CHECKOUT_WEBHOOK_SECRET || '',
    cloudToken: process.env.WHATSAPP_CLOUD_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    apiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0',
    language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR',
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioFrom: process.env.TWILIO_WHATSAPP_FROM || '',
    twilioMessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || '',
    contentSids,
  };
}

const TWILIO_CONTENT_SID_BY_EVENT = {
  acceptance_validated: process.env.TWILIO_CONTENT_SID_MATRICULA_INICIADA || process.env.TWILIO_CONTENT_SID_ENROLLMENT_STARTED || '',
  payment_payload_validated: process.env.TWILIO_CONTENT_SID_MATRICULA_INICIADA || process.env.TWILIO_CONTENT_SID_ENROLLMENT_STARTED || '',
  asaas_payment_created: process.env.TWILIO_CONTENT_SID_PAGAMENTO_PENDENTE || process.env.TWILIO_CONTENT_SID_PAYMENT_PENDING || '',
  voomp_acceptance_registered: process.env.TWILIO_CONTENT_SID_PAGAMENTO_PENDENTE || process.env.TWILIO_CONTENT_SID_PAYMENT_PENDING || '',
  voomp_sale_received: process.env.TWILIO_CONTENT_SID_PAGAMENTO_PENDENTE || process.env.TWILIO_CONTENT_SID_PAYMENT_PENDING || '',
  voomp_checkout_return: process.env.TWILIO_CONTENT_SID_PAGAMENTO_PENDENTE || process.env.TWILIO_CONTENT_SID_PAYMENT_PENDING || '',
  voomp_payment_confirmed: process.env.TWILIO_CONTENT_SID_MATRICULA_CONFIRMADA || process.env.TWILIO_CONTENT_SID_ENROLLMENT_CONFIRMED || '',
  PAYMENT_CONFIRMED: process.env.TWILIO_CONTENT_SID_MATRICULA_CONFIRMADA || process.env.TWILIO_CONTENT_SID_ENROLLMENT_CONFIRMED || '',
  PAYMENT_RECEIVED: process.env.TWILIO_CONTENT_SID_MATRICULA_CONFIRMADA || process.env.TWILIO_CONTENT_SID_ENROLLMENT_CONFIRMED || '',
  crm_enrollment_started: process.env.TWILIO_CONTENT_SID_MATRICULA_INICIADA || process.env.TWILIO_CONTENT_SID_ENROLLMENT_STARTED || '',
  crm_payment_pending: process.env.TWILIO_CONTENT_SID_PAGAMENTO_PENDENTE || process.env.TWILIO_CONTENT_SID_PAYMENT_PENDING || '',
  crm_enrollment_confirmation: process.env.TWILIO_CONTENT_SID_MATRICULA_CONFIRMADA || process.env.TWILIO_CONTENT_SID_ENROLLMENT_CONFIRMED || '',
  crm_class_reminder: process.env.TWILIO_CONTENT_SID_LEMBRETE_AULA || process.env.TWILIO_CONTENT_SID_CLASS_REMINDER || '',
  crm_abandoned_cart_coupon: process.env.TWILIO_CONTENT_SID_CARRINHO_ABANDONADO || process.env.TWILIO_CONTENT_SID_ABANDONED_CART_COUPON || '',
  abandoned_cart_coupon: process.env.TWILIO_CONTENT_SID_CARRINHO_ABANDONADO || process.env.TWILIO_CONTENT_SID_ABANDONED_CART_COUPON || '',
  student_welcome: process.env.TWILIO_CONTENT_SID_BOAS_VINDAS || process.env.TWILIO_CONTENT_SID_WELCOME || '',
  student_access: process.env.TWILIO_CONTENT_SID_ACESSO_ALUNO || process.env.TWILIO_CONTENT_SID_STUDENT_ACCESS || '',
  clube_escola_signup: process.env.TWILIO_CONTENT_SID_CLUBE_ESCOLA || '',
};

const TEMPLATE_BY_EVENT = {
  acceptance_validated: 'ebn_matricula_iniciada',
  payment_payload_validated: 'ebn_matricula_iniciada',
  asaas_payment_created: 'ebn_pagamento_pendente',
  voomp_acceptance_registered: 'ebn_pagamento_pendente',
  voomp_sale_received: 'ebn_pagamento_pendente',
  voomp_checkout_return: 'ebn_pagamento_pendente',
  voomp_payment_confirmed: 'ebn_matricula_confirmada',
  PAYMENT_CONFIRMED: 'ebn_matricula_confirmada',
  PAYMENT_RECEIVED: 'ebn_matricula_confirmada',
  crm_abandoned_cart_coupon: 'ebn_carrinho_abandonado_cupom',
  abandoned_cart_coupon: 'ebn_carrinho_abandonado_cupom',
  student_welcome: 'ebn_boas_vindas',
  // Clube da Escola (11/09/2026): boas-vindas com o link do grupo. Template próprio, porque o texto e
  // a finalidade são outros — quem entra no clube não começou matrícula nenhuma.
  clube_escola_signup: 'clube_boas_vindas',
  student_access: 'ebn_acesso_aluno',
};

function templateForEvent(eventName, payload = {}) {
  const explicit = safeString(payload.template_name || payload.templateName, 120);
  if (explicit) return explicit;
  return TEMPLATE_BY_EVENT[eventName] || 'ebn_followup_matricula';
}

// Link do grupo do Clube da Escola. Fica no código, não em variável de ambiente, porque é o mesmo
// convite que a tela mostra — dois lugares com links diferentes é como a aluna acaba num grupo
// que não existe mais.
export const CLUBE_WHATSAPP_URL = process.env.CLUBE_WHATSAPP_URL || '';

function paymentOrAccessLink(eventName, payload = {}) {
  if (eventName === 'clube_escola_signup') return CLUBE_WHATSAPP_URL;
  if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'voomp_payment_confirmed', 'crm_enrollment_confirmation', 'student_welcome', 'student_access'].includes(eventName)) {
    return studentAccessUrl(payload);
  }

  const explicit = safeString(payload.checkoutUrl || payload.checkout_url || payload.invoiceUrl || payload.payment?.invoiceUrl, 1000);
  if (explicit && !isExternalProviderUrl(explicit)) return explicit;
  return courseCheckoutUrl(payload);
}

function templateParameters(eventName, payload = {}) {
  const name = safeString(payload.name || payload.studentName, 80) || 'aluno(a)';
  const course = safeString(payload.courseName || payload.course_name || payload.courseSlug || payload.course_slug, 120) || 'curso a escola';
  const turma = safeString(payload.classDate || payload.class_date, 120) || 'turma escolhida';
  const link = paymentOrAccessLink(eventName, payload);
  return [name, course, turma, link];
}

function studentAccessUrl(payload = {}) {
  const explicit = safeString(payload.studentAccessUrl || payload.accessUrl || payload.student_access_url, 1000);
  if (explicit && explicit !== 'https://DOMINIO-NAO-CONFIGURADO/aluno') return explicit;
  try {
    return buildStudentAccessUrl(payload);
  } catch {
    return explicit || 'https://DOMINIO-NAO-CONFIGURADO/aluno';
  }
}

async function sendCloudTemplate(config, to, templateName, parameters) {
  if (!config.cloudToken || !config.phoneNumberId) return { configured: false, sent: false, skipped: 'whatsapp_cloud_not_configured' };
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: config.language },
      components: [{
        type: 'body',
        parameters: parameters.map((value) => ({ type: 'text', text: safeString(String(value), 1000) })),
      }],
    },
  };
  const url = `https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.cloudToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { configured: true, sent: false, status: response.status, error: data.error?.message || 'whatsapp_cloud_non_2xx', data };
  return { configured: true, sent: true, status: response.status, data };
}

async function sendTwilioTemplate(config, to, eventName, parameters, payload = {}) {
  if (!config.twilioAccountSid || !config.twilioAuthToken) return { configured: false, sent: false, skipped: 'twilio_credentials_not_configured' };
  if (!config.twilioFrom && !config.twilioMessagingServiceSid) return { configured: false, sent: false, skipped: 'twilio_sender_not_configured' };
  const contentSid = safeString(payload.contentSid || payload.content_sid || TWILIO_CONTENT_SID_BY_EVENT[eventName], 120);
  if (!contentSid) return { configured: true, sent: false, skipped: 'twilio_content_sid_not_configured' };

  const form = new URLSearchParams();
  form.set('To', `whatsapp:+${to}`);
  if (config.twilioMessagingServiceSid) form.set('MessagingServiceSid', config.twilioMessagingServiceSid);
  else form.set('From', config.twilioFrom.startsWith('whatsapp:') ? config.twilioFrom : `whatsapp:${config.twilioFrom}`);
  form.set('ContentSid', contentSid);
  form.set('ContentVariables', JSON.stringify({
    1: parameters[0] || 'aluno(a)',
    2: parameters[1] || 'curso a escola',
    3: parameters[2] || 'turma escolhida',
    4: parameters[3] || 'https://DOMINIO-NAO-CONFIGURADO',
  }));

  const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.twilioAccountSid)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { configured: true, sent: false, status: response.status, error: data.message || data.code || 'twilio_non_2xx', data };
  return { configured: true, sent: true, status: response.status, sid: data.sid || null, contentSid };
}

// Pedido da Erica, 04/09/2026: só 2 mensagens no total pra quem paga — a de confirmação (que já
// dá os parabéns e as boas-vindas) e depois o acesso à área da aluna. A de boas-vindas separada
// (student_welcome) foi removida da sequência por ser redundante com a de confirmação.
async function sendTwilioSequence(config, to, eventName, parameters, payload = {}) {
  const first = await sendTwilioTemplate(config, to, eventName, parameters, payload);
  const shouldSendStudentJourney = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'voomp_payment_confirmed', 'crm_enrollment_confirmation'].includes(eventName);
  if (!shouldSendStudentJourney || !first.sent) return first;

  const accessUrl = studentAccessUrl(payload);
  const followups = [];
  if (config.contentSids.studentAccess) {
    followups.push(await sendTwilioTemplate(config, to, 'student_access', [parameters[0], parameters[1], parameters[2], accessUrl], { ...payload, contentSid: config.contentSids.studentAccess, checkoutUrl: accessUrl }));
  }
  return { ...first, sequence: { sent: first.sent, followups } };
}

async function sendWebhook(config, eventName, to, templateName, parameters, payload) {
  if (!config.webhookUrl) return { configured: false, sent: false, skipped: 'whatsapp_followup_webhook_not_configured' };
  const headers = { 'content-type': 'application/json' };
  if (config.webhookSecret) headers['x-ebn-whatsapp-secret'] = config.webhookSecret;
  const response = await fetch(config.webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      event: eventName,
      event_name: eventName,
      provider: payload.provider || 'agenda_ebn',
      to,
      phone: to,
      name: payload.name || payload.studentName || null,
      email: payload.email || payload.studentEmail || null,
      course_slug: payload.courseSlug || payload.course_slug || null,
      course_name: payload.courseName || payload.course_name || null,
      class_date: payload.classDate || payload.class_date || null,
      checkout_url: paymentOrAccessLink(eventName, payload),
      checkout_status: payload.checkoutStatus || payload.status || null,
      amount: payload.amount || payload.value || payload.total || payload.cart?.priceNumber || null,
      utm_source: payload.attribution?.utm_source || null,
      utm_medium: payload.attribution?.utm_medium || null,
      utm_campaign: payload.attribution?.utm_campaign || null,
      session_id: payload.attribution?.session_id || payload.session_id || null,
      template_name: templateName,
      template_language: config.language,
      template_parameters: parameters,
      automation_stage: templateName,
      payload,
    }),
  });
  const data = await response.text().catch(() => '');
  if (!response.ok) return { configured: true, sent: false, status: response.status, error: 'whatsapp_followup_webhook_non_2xx', data: data.slice(0, 300) };
  return { configured: true, sent: true, status: response.status };
}

// Envio direto do código de acesso (OTP) do login da área do aluno — regra P0.2 do Manual do produto.
// Não passa pelo fluxo de eventos de CRM: é uma ação síncrona de autenticação.
export async function sendStudentAccessCode(rawPhone, code) {
  const config = whatsappConfig();
  const to = cleanPhone(rawPhone);
  if (!to) return { configured: false, sent: false, skipped: 'missing_phone' };
  if (!config.twilioAccountSid || !config.twilioAuthToken) return { configured: false, sent: false, skipped: 'twilio_credentials_not_configured' };
  if (!config.twilioFrom && !config.twilioMessagingServiceSid) return { configured: false, sent: false, skipped: 'twilio_sender_not_configured' };
  const contentSid = process.env.TWILIO_CONTENT_SID_CODIGO_ACESSO || process.env.TWILIO_CONTENT_SID_ACCESS_CODE || '';
  if (!contentSid) return { configured: true, sent: false, skipped: 'twilio_access_code_template_not_configured' };

  const form = new URLSearchParams();
  form.set('To', `whatsapp:+${to}`);
  if (config.twilioMessagingServiceSid) form.set('MessagingServiceSid', config.twilioMessagingServiceSid);
  else form.set('From', config.twilioFrom.startsWith('whatsapp:') ? config.twilioFrom : `whatsapp:${config.twilioFrom}`);
  form.set('ContentSid', contentSid);
  form.set('ContentVariables', JSON.stringify({ 1: safeString(String(code), 12) }));

  const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.twilioAccountSid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { configured: true, sent: false, status: response.status, error: data.message || data.code || 'twilio_non_2xx' };
    return { configured: true, sent: true, status: response.status, sid: data.sid || null };
  } catch (error) {
    return { configured: true, sent: false, error: error.message || 'twilio_request_failed' };
  }
}

// Aviso automático de vaga aberta na lista de espera — regra §16.8 do Manual do produto (decisão de
// negócio, 03/09/2026). Disparado direto por releaseClassSeat (lib/db.mjs) assim que um
// cancelamento/estorno libera a vaga, um de cada vez, por ordem de chegada (FIFO).
export async function sendWaitlistSeatAvailable(rawPhone, payload = {}) {
  const config = whatsappConfig();
  const to = cleanPhone(rawPhone);
  if (!to) return { configured: false, sent: false, skipped: 'missing_phone' };
  if (!config.twilioAccountSid || !config.twilioAuthToken) return { configured: false, sent: false, skipped: 'twilio_credentials_not_configured' };
  if (!config.twilioFrom && !config.twilioMessagingServiceSid) return { configured: false, sent: false, skipped: 'twilio_sender_not_configured' };
  const contentSid = process.env.TWILIO_CONTENT_SID_VAGA_ABERTA || process.env.TWILIO_CONTENT_SID_WAITLIST_SEAT_AVAILABLE || '';
  if (!contentSid) return { configured: true, sent: false, skipped: 'twilio_waitlist_template_not_configured' };

  const form = new URLSearchParams();
  form.set('To', `whatsapp:+${to}`);
  if (config.twilioMessagingServiceSid) form.set('MessagingServiceSid', config.twilioMessagingServiceSid);
  else form.set('From', config.twilioFrom.startsWith('whatsapp:') ? config.twilioFrom : `whatsapp:${config.twilioFrom}`);
  form.set('ContentSid', contentSid);
  form.set('ContentVariables', JSON.stringify({
    1: safeString(payload.name, 80) || 'aluno(a)',
    2: safeString(payload.courseName, 120) || 'curso a escola',
    3: safeString(payload.classDate, 120) || 'turma',
    4: safeString(payload.checkoutUrl, 1000) || 'https://DOMINIO-NAO-CONFIGURADO',
  }));

  const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.twilioAccountSid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { configured: true, sent: false, status: response.status, error: data.message || data.code || 'twilio_non_2xx' };
    return { configured: true, sent: true, status: response.status, sid: data.sid || null };
  } catch (error) {
    return { configured: true, sent: false, error: error.message || 'twilio_request_failed' };
  }
}

export async function notifyOfficialWhatsapp(eventName, payload = {}) {
  if (payload.whatsappOptIn === false) return { configured: false, sent: false, skipped: 'whatsapp_opt_in_false' };
  const config = whatsappConfig();
  const to = cleanPhone(payload.whatsapp || payload.phone || payload.studentWhatsapp);
  const configured = Boolean(config.webhookUrl || (config.cloudToken && config.phoneNumberId) || (config.twilioAccountSid && config.twilioAuthToken && (config.twilioFrom || config.twilioMessagingServiceSid)));
  if (!to) return { configured, sent: false, skipped: 'missing_phone' };
  const templateName = templateForEvent(eventName, payload);
  const parameters = templateParameters(eventName, payload);
  try {
    if (config.mode === 'twilio') return await sendTwilioSequence(config, to, eventName, parameters, payload);
    if (config.mode === 'cloud') return await sendCloudTemplate(config, to, templateName, parameters);
    if (config.mode === 'off') return { configured: false, sent: false, skipped: 'whatsapp_followup_disabled' };
    if (config.webhookUrl) return await sendWebhook(config, eventName, to, templateName, parameters, payload);
    return await sendTwilioSequence(config, to, eventName, parameters, payload);
  } catch (error) {
    return { configured: true, sent: false, error: error.message || 'whatsapp_followup_failed' };
  }
}
