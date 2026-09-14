import { asaasConfig, createCheckoutSession, createCustomer, createPayment, getPaymentBillingInfo, getPixQrCode, publicBillingInfoResponse, publicPaymentResponse } from '../lib/asaas.mjs';
import { findActiveCoupon, findUpsellOffer, isDbConfigured, markPaymentCreated, persistEnrollmentIntent } from '../lib/db.mjs';
import { ensureLiveCourseCatalog, resolveOffer } from '../lib/courses.mjs';
import { sendMetaCapiEvent } from '../lib/meta.mjs';
import { notifyOfficialWhatsapp } from '../lib/whatsapp.mjs';
const requiredFields = ['courseSlug', 'classDate', 'studentName', 'studentEmail', 'studentWhatsapp', 'studentCpf', 'paymentMethod'];
const allowedMethods = ['credit_card', 'pix', 'boleto'];

function isVoompCourse(payload) {
  const haystack = `${payload.courseSlug || ''} ${payload.courseName || ''} ${payload.cart?.flow || ''}`.toLowerCase();
  return haystack.includes('voomp') || haystack.includes('cabeleireiro-profissional');
}

function enabledPaymentMethods() {
  const raw = process.env.ASAAS_ALLOWED_PAYMENT_METHODS || 'pix,boleto,credit_card';
  return raw.split(',').map((item) => item.trim()).filter((item) => allowedMethods.includes(item));
}

function safeString(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizePayload(body) {
  const cart = safeObject(body.cart);
  const attribution = safeObject(body.attribution);
  return {
    courseSlug: safeString(body.courseSlug, 120),
    courseName: safeString(body.courseName, 180),
    classDate: safeString(body.classDate, 180),
    studentName: safeString(body.studentName, 180),
    studentEmail: safeString(body.studentEmail, 180).toLowerCase(),
    // Id do evento gerado pelo navegador no envio: o Pixel e a API de Conversões usam o mesmo,
    // e a Meta junta os dois numa conversão só em vez de contar duas.
    metaEventId: safeString(body.metaEventId, 200),
    studentWhatsapp: safeString(body.studentWhatsapp, 60),
    studentCpf: safeString(body.studentCpf, 40),
    paymentMethod: safeString(body.paymentMethod, 40),
    coupon: safeString(body.coupon, 60).toUpperCase(),
    termsVersion: safeString(body.termsVersion, 80),
    whatsappOptIn: body.whatsappOptIn !== false,
    additionalCourseSlug: safeString(body.additionalCourseSlug, 120),
    additionalClassDate: safeString(body.additionalClassDate, 180),
    cart: {
      courseSlug: safeString(cart.courseSlug, 120),
      courseName: safeString(cart.courseName, 180),
      classDate: safeString(cart.classDate, 180),
      optionLabel: safeString(cart.optionLabel, 180) || null,
      flow: safeString(cart.flow, 40),
      price: safeString(cart.price, 80),
      priceNumber: Number(cart.priceNumber || 0),
      coupon: safeString(cart.coupon, 60) || null,
      capacity: Number(cart.capacity || 0),
      available: Number(cart.available || 0),
    },
    attribution: {
      session_id: safeString(attribution.session_id, 120),
      utm_source: safeString(attribution.utm_source, 120) || null,
      utm_medium: safeString(attribution.utm_medium, 120) || null,
      utm_campaign: safeString(attribution.utm_campaign, 180) || null,
      utm_content: safeString(attribution.utm_content, 180) || null,
      utm_term: safeString(attribution.utm_term, 180) || null,
      gclid: safeString(attribution.gclid, 220) || null,
      fbclid: safeString(attribution.fbclid, 220) || null,
      // _fbp e _fbc são os dois identificadores que a Meta mais usa pra casar a venda com o
      // anúncio. O navegador já os capturava dos cookies e mandava aqui — e esta função os
      // descartava, então todo evento de matrícula ia pra API de Conversões sem eles.
      fbp: safeString(attribution.fbp, 300) || null,
      fbc: safeString(attribution.fbc, 300) || null,
      msclkid: safeString(attribution.msclkid, 220) || null,
      first_landing_page: safeString(attribution.first_landing_page, 500) || null,
      first_referrer: safeString(attribution.first_referrer, 500) || null,
      last_landing_page: safeString(attribution.last_landing_page, 500) || null,
      last_referrer: safeString(attribution.last_referrer, 500) || null,
      first_seen_at: safeString(attribution.first_seen_at, 80) || null,
      last_seen_at: safeString(attribution.last_seen_at, 80) || null,
    },
  };
}

function applyCouponDiscount(payload, coupon) {
  const originalAmount = Number(payload.cart?.priceNumber || 0);
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
    return { ok: false, error: 'invalid_coupon_amount' };
  }

  const type = String(coupon.type || 'percent').toLowerCase();
  const value = Number(coupon.value || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'invalid_coupon_value' };
  }

  let discountedAmount = originalAmount;
  if (['percent', 'percentage', 'porcentagem'].includes(type)) {
    discountedAmount = originalAmount * (100 - Math.min(100, value)) / 100;
  } else if (['fixed', 'amount', 'valor'].includes(type)) {
    discountedAmount = originalAmount - value;
  } else {
    return { ok: false, error: 'invalid_coupon_type' };
  }

  discountedAmount = Math.max(1, Math.round(discountedAmount * 100) / 100);
  payload.cart.priceNumber = discountedAmount;
  payload.cart.price = discountedAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  payload.cart.discount = {
    coupon: String(coupon.code || payload.coupon).toUpperCase(),
    type,
    value,
    originalAmount,
    discountedAmount,
  };
  return { ok: true, payload, coupon: payload.cart.discount };
}

async function applyServerCoupon(payload) {
  const code = safeString(payload.coupon, 60).toUpperCase();
  if (!code) return { ok: true, payload, coupon: null };

  const registeredCoupon = await findActiveCoupon(code, payload).catch(() => null);
  if (!registeredCoupon) return { ok: false, error: 'coupon_not_found' };

  return applyCouponDiscount(payload, registeredCoupon);
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = request.body || {};
  const payload = normalizePayload(body);
  const missingFields = requiredFields.filter((field) => !payload[field]);
  const enabledMethods = enabledPaymentMethods();
  const invalidPaymentMethod = !allowedMethods.includes(payload.paymentMethod) || !enabledMethods.includes(payload.paymentMethod);
  const voompCourseInAsaasEndpoint = isVoompCourse(payload);
  const invalidEmail = payload.studentEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.studentEmail);

  if (missingFields.length || invalidPaymentMethod || invalidEmail || voompCourseInAsaasEndpoint) {
    return response.status(400).json({
      ok: false,
      error: 'validation_error',
      missingFields,
      invalidPaymentMethod,
      invalidEmail,
      allowedMethods,
      enabledMethods,
      voompCourseInAsaasEndpoint,
      nextAction: voompCourseInAsaasEndpoint ? 'use_acceptance_voomp_flow' : undefined,
    });
  }

  // Curso, turma, preço e vaga são sempre resolvidos no servidor. O navegador nunca decide o valor cobrado (regra P0 do Manual do produto).
  await ensureLiveCourseCatalog();
  const offer = resolveOffer(payload.courseSlug, payload.classDate);
  if (!offer.ok) {
    // enrollment_closed: a matrícula fechou (regra P1.3 do Manual do produto) — mesmo que alguém
    // acesse a URL de checkout direto após o prazo, o servidor recusa, não só a agenda visual.
    return response.status(400).json({ ok: false, error: offer.error === 'course_not_found' ? 'course_not_found' : offer.error === 'enrollment_closed' ? 'enrollment_closed' : 'class_date_not_found' });
  }
  if (offer.flow === 'voomp') {
    return response.status(400).json({ ok: false, error: 'voomp_course_in_asaas_endpoint', nextAction: 'use_acceptance_voomp_flow' });
  }
  if (offer.status !== 'available') {
    return response.status(409).json({ ok: false, error: 'class_full' });
  }

  payload.courseName = offer.courseName;
  payload.cart.courseSlug = offer.courseSlug;
  payload.cart.courseName = offer.courseName;
  payload.cart.classDate = offer.classDate;
  payload.cart.optionLabel = offer.optionLabel;
  payload.cart.priceNumber = offer.priceNumber;
  payload.cart.price = offer.price;
  payload.cart.capacity = offer.capacity;
  payload.cart.available = offer.availableSpots;
  payload.cart.flow = offer.flow;

  // Oferta adicional (regra P1.2/5.1 do Manual do produto): elegibilidade e desconto vêm sempre da
  // tabela upsell_offers, cadastrada pela escola — nunca de uma regra fixa no código. Nunca
  // cumulativa com cupom por padrão.
  let additionalOffer = null;
  if (payload.additionalCourseSlug) {
    additionalOffer = resolveOffer(payload.additionalCourseSlug, payload.additionalClassDate);
    if (!additionalOffer.ok) {
      return response.status(400).json({ ok: false, error: additionalOffer.error === 'course_not_found' ? 'additional_course_not_found' : additionalOffer.error === 'enrollment_closed' ? 'additional_enrollment_closed' : 'additional_class_date_not_found' });
    }
    if (additionalOffer.courseSlug === offer.courseSlug) {
      return response.status(400).json({ ok: false, error: 'additional_course_not_eligible' });
    }
    if (additionalOffer.status !== 'available') {
      return response.status(409).json({ ok: false, error: 'additional_class_full' });
    }

    const upsellOffer = await findUpsellOffer(offer.courseSlug, additionalOffer.courseSlug);
    if (!upsellOffer) {
      return response.status(400).json({ ok: false, error: 'additional_course_not_eligible', message: 'Não existe oferta adicional cadastrada para esses dois cursos.' });
    }
    if (payload.coupon) {
      return response.status(400).json({ ok: false, error: 'coupon_not_combinable_with_additional_course', message: 'O cupom não pode ser combinado com a oferta de curso adicional. Escolha um dos dois.' });
    }

    const discountType = String(upsellOffer.discount_type || 'percent').toLowerCase();
    const discountValue = Number(upsellOffer.discount_value ?? 20);
    let additionalDiscountedPrice = additionalOffer.priceNumber;
    if (['percent', 'percentage', 'porcentagem'].includes(discountType)) {
      additionalDiscountedPrice = additionalOffer.priceNumber * (100 - Math.min(100, Math.max(0, discountValue))) / 100;
    } else if (['fixed', 'amount', 'valor'].includes(discountType)) {
      additionalDiscountedPrice = additionalOffer.priceNumber - discountValue;
    }
    additionalDiscountedPrice = Math.max(1, Math.round(additionalDiscountedPrice * 100) / 100);

    payload.cart.items = [
      { role: 'primary', courseSlug: offer.courseSlug, courseName: offer.courseName, classDate: offer.classDate, optionLabel: offer.optionLabel, priceNumber: offer.priceNumber },
      { role: 'additional', courseSlug: additionalOffer.courseSlug, courseName: additionalOffer.courseName, classDate: additionalOffer.classDate, optionLabel: additionalOffer.optionLabel, priceNumber: additionalDiscountedPrice, originalPriceNumber: additionalOffer.priceNumber, discountType, discountValue, upsellOfferId: upsellOffer.id },
    ];
    payload.cart.priceNumber = Math.round((offer.priceNumber + additionalDiscountedPrice) * 100) / 100;
    payload.cart.price = payload.cart.priceNumber.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  } else {
    payload.cart.items = [{ role: 'primary', courseSlug: offer.courseSlug, courseName: offer.courseName, classDate: offer.classDate, optionLabel: offer.optionLabel, priceNumber: offer.priceNumber }];
  }

  const audit = {
    receivedAt: new Date().toISOString(),
    ip: request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket?.remoteAddress || null,
    userAgent: request.headers['user-agent'] || null,
    termsVersion: payload.termsVersion || null,
    attributionCaptured: Boolean(payload.attribution.session_id || payload.attribution.utm_source || payload.attribution.first_referrer),
    cartCaptured: Boolean(payload.cart.courseSlug || payload.cart.priceNumber),
  };

  const couponResult = await applyServerCoupon(payload);
  if (!couponResult.ok) {
    return response.status(400).json({ ok: false, error: couponResult.error, message: 'Cupom inválido para este curso/cadastro.', audit });
  }
  audit.coupon = couponResult.coupon;

  let persistence = { configured: isDbConfigured(), persisted: false };
  if (isDbConfigured()) {
    try {
      const record = await persistEnrollmentIntent(payload, audit);
      persistence = { configured: true, persisted: true, ...record };
    } catch (error) {
      console.error('persistEnrollmentIntent_failed', { code: error.code, message: error.message, details: error.details, courseSlug: payload.courseSlug, classDate: payload.classDate });
      return response.status(500).json({ ok: false, error: error.code || 'database_persist_failed', audit });
    }
  }

  const asaas = asaasConfig();
  if (!asaas.configured) {
    const meta = await sendMetaCapiEvent('payment_payload_validated', { ...payload, status: 'payment_payload_validated', event_id: payload.metaEventId || `lead:${payload.attribution.session_id || payload.studentEmail}:${payload.courseSlug}` }, request);
    const whatsapp = await notifyOfficialWhatsapp('payment_payload_validated', { ...payload, status: 'payment_payload_validated' });
    return response.status(202).json({
      ok: true,
      status: persistence.persisted ? 'payment_payload_persisted_not_created' : 'payment_payload_validated_not_created',
      provider: 'asaas',
      mode: 'stub',
      nextAction: persistence.persisted ? 'configure_secure_asaas_sandbox_payment_creation' : 'configure_database_and_secure_asaas_backend_token',
      persistence,
      meta,
      whatsapp,
      audit,
    });
  }

  if (!asaas.canCreatePayment) {
    return response.status(409).json({
      ok: false,
      error: 'asaas_production_disabled',
      message: 'A criação em produção está bloqueada. Configure ASAAS_ENV=sandbox ou libere ASAAS_ENABLE_REAL_PAYMENTS=true somente depois do QA sandbox.',
      persistence,
      audit,
    });
  }

  if (!persistence.persisted) {
    return response.status(409).json({
      ok: false,
      error: 'database_required_before_asaas_payment',
      message: 'A cobrança Asaas só é criada depois que a intenção de matrícula é salva no banco.',
      persistence,
      audit,
    });
  }

  // Cartão nunca mais é digitado no site nem passa pelo nosso servidor (regra P1.5 do Manual
  // a escola): a aluna é redirecionada para o checkout hospedado pela própria Asaas. Pix e boleto
  // continuam no checkout transparente de sempre, que nunca lida com dado de cartão.
  if (payload.paymentMethod === 'credit_card') {
    try {
      const session = await createCheckoutSession(payload, persistence);
      const meta = await sendMetaCapiEvent('asaas_checkout_created', { ...payload, checkoutUrl: session.link, status: 'checkout_created', event_id: `asaas-checkout:${session.id || persistence.paymentId}` }, request);
      return response.status(201).json({
        ok: true,
        status: asaas.isSandbox ? 'sandbox_checkout_created' : 'checkout_created',
        provider: 'asaas',
        mode: asaas.isSandbox ? 'sandbox' : 'production',
        nextAction: 'redirect_to_asaas_checkout',
        checkout: { provider: 'asaas', configured: true, url: session.link, id: session.id || null },
        persistence,
        meta,
        audit: { ...audit, asaasCheckoutCreated: true },
      });
    } catch (error) {
      return response.status(error.status || 502).json({
        ok: false,
        error: error.code || 'asaas_checkout_create_failed',
        message: error.message || 'Falha ao criar checkout Asaas.',
        persistence,
        audit: { ...audit, asaasCheckoutCreated: false },
      });
    }
  }

  try {
    const customer = await createCustomer(payload, persistence);
    const providerPayment = await createPayment(payload, customer, persistence, { remoteIp: audit.ip });
    const pixQrCode = payload.paymentMethod === 'pix'
      ? await getPixQrCode(providerPayment.id).catch((error) => ({ error: error.code || 'pix_qr_code_failed' }))
      : null;
    const billingInfo = payload.paymentMethod === 'boleto'
      ? await getPaymentBillingInfo(providerPayment.id).catch((error) => ({ error: error.code || 'billing_info_failed' }))
      : null;
    const update = await markPaymentCreated(persistence.paymentId, persistence.enrollmentId, providerPayment, { ...audit, asaasEnv: asaas.env, asaasBaseUrl: asaas.baseUrl });
    const followupPayload = { ...payload, checkoutUrl: '', invoiceUrl: '', status: providerPayment.status || 'created', amount: providerPayment.value || payload.cart?.priceNumber };
    const meta = await sendMetaCapiEvent('asaas_payment_created', { ...followupPayload, event_id: `asaas:${providerPayment.id || persistence.paymentId}` }, request);
    const whatsapp = await notifyOfficialWhatsapp('asaas_payment_created', followupPayload);
    return response.status(201).json({
      ok: true,
      status: asaas.isSandbox ? 'sandbox_payment_created' : 'payment_created',
      provider: 'asaas',
      mode: asaas.isSandbox ? 'sandbox' : 'production',
      payment: { ...publicPaymentResponse(providerPayment), pixQrCode, billingInfo: publicBillingInfoResponse(billingInfo) },
      nextAction: pixQrCode && !pixQrCode.error ? 'show_transparent_pix_checkout' : billingInfo && !billingInfo.error ? 'show_transparent_boleto_checkout' : 'wait_payment_confirmation',
      persistence: { ...persistence, paymentUpdated: update.updated },
      meta,
      whatsapp,
      audit: { ...audit, asaasPaymentCreated: true },
    });
  } catch (error) {
    return response.status(error.status || 502).json({
      ok: false,
      error: error.code || 'asaas_payment_create_failed',
      message: error.message || 'Falha ao criar cobrança Asaas.',
      persistence,
      audit: { ...audit, asaasPaymentCreated: false },
    });
  }
}
