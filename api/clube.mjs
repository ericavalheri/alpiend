// Clube da Escola: cadastro leve de quem visitou a página do curso e não avançou para a matrícula.
//
// A escola não tem equipe comercial para correr atrás de quem só olhou. Sem isto, essa pessoa vai
// embora sem deixar rastro — a Meta sabe que ela existe, mas a escola não tem como falar com
// ela. Aqui ela deixa nome e WhatsApp com aceite explícito e entra no CRM como lead de verdade.
//
// NÃO dispara o evento Lead da Meta. Lead é, e continua sendo, só quem começa a matrícula: se o
// cadastro do clube contasse como Lead, a campanha passaria a otimizar para cadastro de clube
// (que é muito mais fácil) e as matrículas cairiam. Este cadastro tem evento próprio.
import { isDbConfigured, persistClubSignup } from '../lib/db.mjs';
import { sendMetaCapiEvent } from '../lib/meta.mjs';
import { notifyOfficialWhatsapp } from '../lib/whatsapp.mjs';

function safeString(value, max = 300) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = request.body || {};
  const attribution = safeObject(body.attribution);
  const payload = {
    name: safeString(body.name, 180),
    whatsapp: safeString(body.whatsapp, 60),
    optIn: body.optIn === true,
    courseSlug: safeString(body.courseSlug, 120),
    courseName: safeString(body.courseName, 180),
    classDate: safeString(body.classDate, 180),
    consentText: safeString(body.consentText, 400),
    metaEventId: safeString(body.metaEventId, 200),
    attribution: {
      session_id: safeString(attribution.session_id, 120),
      utm_source: safeString(attribution.utm_source, 120) || null,
      utm_medium: safeString(attribution.utm_medium, 120) || null,
      utm_campaign: safeString(attribution.utm_campaign, 180) || null,
      utm_content: safeString(attribution.utm_content, 180) || null,
      utm_term: safeString(attribution.utm_term, 180) || null,
      fbp: safeString(attribution.fbp, 300) || null,
      fbc: safeString(attribution.fbc, 300) || null,
      fbclid: safeString(attribution.fbclid, 220) || null,
      last_landing_page: safeString(attribution.last_landing_page, 500) || null,
    },
  };

  const digitos = payload.whatsapp.replace(/\D/g, '');
  if (!payload.name || digitos.length < 10) {
    return response.status(400).json({ ok: false, error: 'dados_incompletos' });
  }
  // Sem aceite não entra. O clube manda mensagem de WhatsApp: aceitar é a condição, não um
  // detalhe de formulário.
  if (!payload.optIn) {
    return response.status(422).json({ ok: false, error: 'consentimento_obrigatorio' });
  }

  const audit = {
    receivedAt: new Date().toISOString(),
    ip: request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket?.remoteAddress || null,
    userAgent: request.headers['user-agent'] || null,
  };

  let persistence = { configured: isDbConfigured(), persisted: false };
  if (isDbConfigured()) {
    try {
      const record = await persistClubSignup(payload, audit);
      persistence = { configured: true, persisted: true, ...record };
    } catch (error) {
      const cliente = ['clube_dados_invalidos', 'clube_sem_consentimento'].includes(error.code);
      return response.status(cliente ? 400 : 500).json({ ok: false, error: error.code || 'clube_persist_failed' });
    }
  }

  const meta = await sendMetaCapiEvent('clube_escola_signup', {
    ...payload,
    event_id: payload.metaEventId || undefined,
    studentId: persistence.studentId,
  }, request);

  // Boas-vindas com o link do grupo. Se o template ainda não estiver aprovado na Twilio, o envio
  // é pulado sem quebrar nada — a pessoa já viu o link na própria tela, que é o caminho principal.
  const whatsapp = await notifyOfficialWhatsapp('clube_escola_signup', {
    name: payload.name,
    whatsapp: payload.whatsapp,
    courseName: payload.courseName || 'cursos da escola',
    classDate: payload.classDate || 'turmas novas',
    whatsappOptIn: true,
  });

  return response.status(201).json({ ok: true, status: 'clube_registrado', persistence, meta, whatsapp });
}
