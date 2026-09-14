import { isDbConfigured, persistAcceptanceIntent } from '../lib/db.mjs';
import { ensureLiveCourseCatalog, resolveOffer } from '../lib/courses.mjs';
import { sendMetaCapiEvent } from '../lib/meta.mjs';
import { notifyOfficialWhatsapp } from '../lib/whatsapp.mjs';
import { resolveVoompCheckoutUrl } from '../lib/voomp.mjs';
import { buildContractSignature } from '../lib/contract-signature.mjs';
import { CLASS_TABLES, PAGAMENTOS_COM_CONTRATO, contractMoney } from '../src/lib/contracts.js';
const requiredFields = ['name', 'whatsapp', 'email', 'cpf', 'courseSlug', 'classDate'];
const requiredAcceptances = ['termsRead', 'paymentAware', 'enrollmentAware'];

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
    name: safeString(body.name, 180),
    whatsapp: safeString(body.whatsapp, 60),
    email: safeString(body.email, 180).toLowerCase(),
    cpf: safeString(body.cpf, 40),
    courseSlug: safeString(body.courseSlug, 120),
    courseName: safeString(body.courseName, 180),
    classDate: safeString(body.classDate, 180),
    termsRead: body.termsRead === true,
    paymentAware: body.paymentAware === true,
    enrollmentAware: body.enrollmentAware === true,
    wantsContactBeforePayment: body.wantsContactBeforePayment === true,
    // Contrato assinado (09/09/2026). RG e endereço entram aqui porque o contrato do
    // Cabeleireiro qualifica o contratante com esses dados — sem eles o documento fica com
    // lacuna em branco no lugar da identificação de quem assinou.
    rg: safeString(body.rg, 40),
    address: safeString(body.address, 300),
    signedName: safeString(body.signedName, 180),
    // Id do evento gerado pelo navegador no momento do envio. O evento que sai daqui pela API
    // de Conversões usa o MESMO id do Pixel, e a Meta junta os dois numa conversão só.
    metaEventId: safeString(body.metaEventId, 200),
    contractAccepted: body.contractAccepted === true,
    whatsappOptIn: body.whatsappOptIn !== false,
    cart: {
      courseSlug: safeString(cart.courseSlug, 120),
      courseName: safeString(cart.courseName, 180),
      classDate: safeString(cart.classDate, 180),
      flow: safeString(cart.flow, 40),
      price: safeString(cart.price, 80),
      priceNumber: Number(cart.priceNumber || 0),
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
      mc_whatsapp_id: safeString(attribution.mc_whatsapp_id || attribution.whatsapp_id, 80) || null,
      first_landing_page: safeString(attribution.first_landing_page, 500) || null,
      first_referrer: safeString(attribution.first_referrer, 500) || null,
      last_landing_page: safeString(attribution.last_landing_page, 500) || null,
      last_referrer: safeString(attribution.last_referrer, 500) || null,
      first_seen_at: safeString(attribution.first_seen_at, 80) || null,
      last_seen_at: safeString(attribution.last_seen_at, 80) || null,
    },
  };
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = request.body || {};
  const payload = normalizePayload(body);
  const missingFields = requiredFields.filter((field) => !payload[field]);
  const missingAcceptances = requiredAcceptances.filter((field) => payload[field] !== true);
  const invalidEmail = payload.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email);

  if (missingFields.length || missingAcceptances.length || invalidEmail) {
    return response.status(400).json({
      ok: false,
      error: 'validation_error',
      missingFields,
      missingAcceptances,
      invalidEmail,
    });
  }

  // Curso, turma e janela de matrícula são sempre validados no servidor (regra P0/P1.3/P1.4
  // do Manual do produto) — antes esta rota aceitava qualquer courseSlug/classDate do navegador.
  await ensureLiveCourseCatalog();
  const offer = resolveOffer(payload.courseSlug, payload.classDate);
  if (!offer.ok) {
    return response.status(400).json({ ok: false, error: offer.error === 'course_not_found' ? 'course_not_found' : offer.error === 'enrollment_closed' ? 'enrollment_closed' : 'class_date_not_found' });
  }
  if (offer.flow !== 'voomp') {
    return response.status(400).json({ ok: false, error: 'asaas_course_in_voomp_endpoint', nextAction: 'use_payments_flow' });
  }
  if (offer.status !== 'available') {
    return response.status(409).json({ ok: false, error: 'class_full' });
  }
  payload.courseName = offer.courseName;
  payload.cart.courseSlug = offer.courseSlug;
  payload.cart.courseName = offer.courseName;
  payload.cart.classDate = offer.classDate;
  payload.cart.flow = offer.flow;

  // Cópia fixa do que foi cobrado/combinado no momento do aceite (regra P1.9 do Manual do produto):
  // se o preço, a matrícula ou o saldo mudarem depois (como já aconteceu nesta turma), o
  // aceite antigo continua registrando exatamente o que foi apresentado a esse aluno.
  const variant = offer.course?.variants?.[offer.classDate] || null;
  // Turma com contrato assinado: o valor vem do CONTRATO, não do catálogo. O catálogo em
  // produção vem do banco, que fica para trás — e o que a aluna assina não pode depender disso.
  const doContrato = contractMoney(offer.classDate);
  const precoTotal = doContrato?.total ?? variant?.priceNumber ?? offer.priceNumber ?? null;
  // Inscrição + parcelas, pagamentos iguais (ver PAGAMENTOS_COM_CONTRATO em src/lib/contracts.js).
  const parcela = precoTotal ? Math.round(Math.round(precoTotal * 100) / PAGAMENTOS_COM_CONTRATO) / 100 : null;
  const contractSnapshot = {
    courseSlug: offer.courseSlug,
    courseName: offer.courseName,
    classDate: offer.classDate,
    optionLabel: offer.optionLabel || variant?.label || null,
    totalPrice: precoTotal,
    // A matrícula é a 1ª de 12 parcelas iguais do valor cheio, então é derivada do total em vez
    // de lida do catálogo (11/09/2026). O catálogo vem do banco em produção, e um valor antigo
    // ali fazia a turma Noite registrar matrícula de R$ 508,22 sobre um total de R$ 5.037,60.
    enrollmentFee: parcela ?? variant?.enrollmentFee ?? offer.course?.voomp?.enrollmentFee ?? null,
    remainingBalance: parcela != null && precoTotal != null
      ? Math.round((precoTotal - parcela) * 100) / 100
      : (variant?.remainingBalance ?? offer.course?.voomp?.remainingBalance ?? null),
    // Derivado como todo o resto, em vez do texto livre do catálogo: era exatamente esse campo
    // que colocava "Matrícula R$ 508,22" no registro de um aceite da turma Noite.
    installments: parcela != null
      ? `Inscrição de ${parcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} pela Voomp + ${PAGAMENTOS_COM_CONTRATO - 1}x de ${parcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} sem juros`
      : (variant?.installments || offer.course?.installments || null),
    capturedAt: new Date().toISOString(),
  };

  // Assinatura do contrato: obrigatória antes de qualquer link de pagamento sair daqui.
  // A escola pediu que a aluna assine antes de pagar a matrícula, então a checagem fica ANTES
  // de gravar o aceite e antes de resolver o checkout — não adianta validar depois de já ter
  // mandado a aluna pro pagamento.
  //
  // Só as turmas do Cabeleireiro têm contrato cadastrado. Curso sem contrato segue o fluxo de
  // sempre, em vez de travar a matrícula por um documento que não existe.
  const exigeContrato = Boolean(CLASS_TABLES[payload.classDate]);
  let assinatura = null;
  let textoDoContrato = '';
  if (exigeContrato) {
    const resultado = buildContractSignature({
      ...payload,
      totalValue: contractSnapshot.totalPrice ? contractSnapshot.totalPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '',
      enrollmentValue: contractSnapshot.enrollmentFee ? contractSnapshot.enrollmentFee.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '',
      paymentTerms: contractSnapshot.installments || '',
    }, {
      ip: request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket?.remoteAddress || null,
      userAgent: request.headers['user-agent'] || null,
      receivedAt: new Date().toISOString(),
    });
    if (!resultado.ok) {
      return response.status(422).json({ ok: false, error: resultado.error, message: resultado.message });
    }
    assinatura = resultado.signature;
    // O texto exato que ela assinou vai junto (pedido da Erica, 09/09/2026: a tela de aceites
    // tem que mostrar o contrato assinado). Guardar a impressão digital responde "o texto
    // mudou?"; guardar o texto responde "o que ela assinou?" — a escola precisa das duas, e
    // remontar o documento depois dependeria de dados que a assinatura não guarda.
    //
    // Fica fora do `audit` de propósito: o audit é copiado pra matrícula e pro evento de
    // tracking, e não faz sentido repetir 10 KB de contrato em três lugares.
    textoDoContrato = resultado.text;
  }

  const audit = {
    acceptedAt: new Date().toISOString(),
    contractSignature: assinatura,
    ip: request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket?.remoteAddress || null,
    userAgent: request.headers['user-agent'] || null,
    termsVersion: assinatura ? `cabeleireiro-contrato-${assinatura.contractVersion}` : 'cabeleireiro-v1-2026-06-23',
    attributionCaptured: Boolean(payload.attribution.session_id || payload.attribution.utm_source || payload.attribution.first_referrer),
    cartCaptured: Boolean(payload.cart.courseSlug || payload.cart.priceNumber),
    contractSnapshot,
  };

  let persistence = { configured: isDbConfigured(), persisted: false };
  if (isDbConfigured()) {
    try {
      const record = await persistAcceptanceIntent(payload, audit, { contractText: textoDoContrato });
      persistence = { configured: true, persisted: true, ...record };
    } catch (error) {
      return response.status(500).json({ ok: false, error: error.code || 'database_persist_failed', audit });
    }
  }

  const checkout = payload.wantsContactBeforePayment
    ? { configured: false, url: null, reason: 'student_requested_contact_before_payment' }
    : resolveVoompCheckoutUrl(payload, audit);

  const meta = await sendMetaCapiEvent('acceptance_validated', { ...payload, checkoutUrl: checkout.url, status: 'acceptance_validated', event_id: payload.metaEventId || `acceptance:${payload.attribution.session_id || payload.email}:${payload.courseSlug}` }, request);
  const whatsapp = await notifyOfficialWhatsapp('voomp_acceptance_registered', {
    ...payload,
    checkoutUrl: checkout.url,
    checkoutStatus: checkout.url ? 'checkout_ready' : checkout.reason || 'checkout_not_ready',
    provider: 'voomp',
  });

  return response.status(202).json({
    ok: true,
    status: persistence.persisted ? 'acceptance_persisted' : 'acceptance_validated_not_persisted',
    nextAction: payload.wantsContactBeforePayment ? 'handoff_to_whatsapp' : checkout.url ? 'open_voomp_checkout' : 'configure_voomp_checkout_url',
    checkout: {
      provider: 'voomp',
      configured: checkout.configured,
      url: checkout.url,
      returnUrl: checkout.returnUrl || null,
      reason: checkout.reason || null,
    },
    meta,
    whatsapp,
    persistence,
    audit,
  });
}
