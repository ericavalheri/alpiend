const DEFAULT_SANDBOX_BASE_URL = 'https://sandbox.asaas.com/api/v3';
const DEFAULT_PRODUCTION_BASE_URL = 'https://api.asaas.com/v3';

function clean(value = '', max = 500) {
  return String(value || '').trim().slice(0, max);
}

function digits(value = '', max = 20) {
  return String(value || '').replace(/\D/g, '').slice(0, max);
}

export function asaasConfig() {
  const token = process.env.ASAAS_API_KEY || process.env.ASAAS_ACCESS_TOKEN || '';
  const env = clean(process.env.ASAAS_ENV || 'sandbox', 40).toLowerCase();
  const rawBaseUrl = clean(process.env.ASAAS_API_BASE_URL || '', 180);
  const baseUrl = (rawBaseUrl || (env === 'production' ? DEFAULT_PRODUCTION_BASE_URL : DEFAULT_SANDBOX_BASE_URL)).replace(/\/$/, '');
  const isSandbox = env !== 'production' && /sandbox/i.test(baseUrl);
  const realPaymentsEnabled = process.env.ASAAS_ENABLE_REAL_PAYMENTS === 'true';
  return {
    token,
    env,
    baseUrl,
    configured: Boolean(token),
    isSandbox,
    realPaymentsEnabled,
    canCreatePayment: Boolean(token) && (isSandbox || realPaymentsEnabled),
  };
}

export function billingTypeFor(method) {
  const map = {
    pix: 'PIX',
    boleto: 'BOLETO',
    credit_card: 'CREDIT_CARD',
    asaas_checkout: 'UNDEFINED',
  };
  return map[method] || 'UNDEFINED';
}

export function dueDate(days = 3) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function asaasRequest(path, options = {}) {
  const config = asaasConfig();
  if (!config.configured) {
    const error = new Error('asaas_not_configured');
    error.code = 'asaas_not_configured';
    throw error;
  }
  if (!config.canCreatePayment) {
    const error = new Error('asaas_production_disabled');
    error.code = 'asaas_production_disabled';
    throw error;
  }

  const response = await fetch(`${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    ...options,
    headers: {
      access_token: config.token,
      'content-type': 'application/json',
      accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.errors?.[0]?.description || data?.message || 'asaas_request_failed');
    error.code = data?.errors?.[0]?.code || 'asaas_request_failed';
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

export async function createCustomer(payload, references = {}) {
  return asaasRequest('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: payload.studentName,
      cpfCnpj: digits(payload.studentCpf, 14),
      email: payload.studentEmail,
      mobilePhone: digits(payload.studentWhatsapp, 11),
      externalReference: references.studentId || references.enrollmentId || undefined,
      notificationDisabled: false,
    }),
  });
}

// Pagamento no cartão nunca mais passa número/CVV pelo nosso servidor (regra P1.5 do Manual
// a escola): em vez de montar um payload de cartão aqui, criamos um Asaas Checkout (página
// hospedada pela própria Asaas) e redirecionamos a aluna para lá. Ver createCheckoutSession.

export async function createPayment(payload, customer, references = {}, meta = {}) {
  const value = Number(payload.cart?.priceNumber || 0);
  if (!Number.isFinite(value) || value <= 0) {
    const error = new Error('invalid_payment_amount');
    error.code = 'invalid_payment_amount';
    throw error;
  }

  const description = [
    'a escola — Matrícula',
    payload.courseName || payload.courseSlug,
    payload.classDate,
  ].filter(Boolean).join(' | ').slice(0, 500);

  return asaasRequest('/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: customer.id,
      billingType: billingTypeFor(payload.paymentMethod),
      value,
      dueDate: dueDate(payload.paymentMethod === 'boleto' ? 5 : 2),
      description,
      externalReference: references.paymentId || references.enrollmentId || undefined,
      postalService: false,
      fine: { value: Number(process.env.ASAAS_FINE_PERCENT || 0) || 0 },
      interest: { value: Number(process.env.ASAAS_INTEREST_PERCENT || 0) || 0 },
    }),
  });
}

// Asaas Checkout: página de pagamento hospedada pela própria Asaas (regra P1.5 do Manual
// a escola). Usado só para cartão — Pix e boleto continuam no checkout transparente do site,
// que nunca lida com dado de cartão. O pagamento real só é confirmado depois, pelo webhook
// autenticado (api/webhooks/asaas.mjs); o retorno no navegador é só visual (regra P0.4).
export async function createCheckoutSession(payload, references = {}) {
  const value = Number(payload.cart?.priceNumber || 0);
  if (!Number.isFinite(value) || value <= 0) {
    const error = new Error('invalid_payment_amount');
    error.code = 'invalid_payment_amount';
    throw error;
  }

  const items = Array.isArray(payload.cart?.items) && payload.cart.items.length
    ? payload.cart.items
    : [{ courseSlug: payload.courseSlug, courseName: payload.courseName, optionLabel: payload.cart?.optionLabel, priceNumber: value }];

  const checkoutItems = items.map((item) => ({
    externalReference: clean(item.courseSlug || payload.courseSlug, 120),
    name: clean(item.courseName || payload.courseName || 'Curso a escola', 180),
    description: clean(item.optionLabel || payload.classDate, 180) || undefined,
    quantity: 1,
    value: Number(item.priceNumber || 0),
  }));

  const baseUrl = (process.env.PUBLIC_AGENDA_BASE_URL || 'https://DOMINIO-NAO-CONFIGURADO').replace(/\/$/, '');
  const returnParams = new URLSearchParams({ course: payload.courseSlug || '', turma: payload.classDate || '' });
  const returnBase = `${baseUrl}/retorno/asaas-checkout?${returnParams.toString()}`;

  return asaasRequest('/checkouts', {
    method: 'POST',
    body: JSON.stringify({
      billingTypes: ['CREDIT_CARD'],
      chargeTypes: ['DETACHED'],
      minutesToExpire: 30,
      externalReference: references.paymentId || references.enrollmentId || undefined,
      callback: {
        successUrl: `${returnBase}&status=success`,
        cancelUrl: `${returnBase}&status=cancel`,
        expiredUrl: `${returnBase}&status=expired`,
      },
      items: checkoutItems,
      customerData: {
        name: clean(payload.studentName, 180),
        cpfCnpj: digits(payload.studentCpf, 14),
        email: clean(payload.studentEmail, 180),
        phone: digits(payload.studentWhatsapp, 11),
      },
    }),
  });
}

export async function getPixQrCode(paymentId = '') {
  const id = clean(paymentId, 120);
  if (!id) return null;
  return asaasRequest(`/payments/${encodeURIComponent(id)}/pixQrCode`, {
    method: 'GET',
  });
}

export async function getPaymentBillingInfo(paymentId = '') {
  const id = clean(paymentId, 120);
  if (!id) return null;
  return asaasRequest(`/payments/${encodeURIComponent(id)}/billingInfo`, {
    method: 'GET',
  });
}

function isExternalProviderUrl(value = '') {
  return /(^|\.)asaas\.com\b/i.test(String(value || ''));
}

function sanitizePublicValue(value) {
  if (Array.isArray(value)) return value.map(sanitizePublicValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, item]) => !/url|link/i.test(key) || !isExternalProviderUrl(item))
      .map(([key, item]) => [key, sanitizePublicValue(item)]));
  }
  return isExternalProviderUrl(value) ? null : value;
}

export function publicBillingInfoResponse(billingInfo) {
  return sanitizePublicValue(billingInfo);
}

export function publicPaymentResponse(payment) {
  if (!payment) return null;
  return {
    id: payment.id,
    status: payment.status || null,
    billingType: payment.billingType || null,
    value: payment.value || null,
    dueDate: payment.dueDate || null,
  };
}
