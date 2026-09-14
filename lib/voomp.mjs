const CHECKOUT_ENV_BY_COURSE = {
  'cabeleireiro-profissional': 'VOOMP_CHECKOUT_URL_CABELEIREIRO_DIURNO',
  'cabeleireiro-profissional-noturno': 'VOOMP_CHECKOUT_URL_CABELEIREIRO_NOTURNO',
  'cabeleireiro-profissional-sabado': 'VOOMP_CHECKOUT_URL_CABELEIREIRO_SABADO',
};

// Links públicos de checkout (não são segredo) recebidos da Gabi para as turmas 2027 do
// Cabeleireiro. Servem de fallback caso a variável de ambiente correspondente não esteja
// configurada/lida em produção — a variável de ambiente, quando presente, tem prioridade,
// então trocar o link no Vercel continua funcionando sem precisar mexer no código.
const DEFAULT_CHECKOUT_URL_BY_ENV_KEY = {
  VOOMP_CHECKOUT_URL_CABELEIREIRO_DIURNO: 'https://pay.voompcreators.com.br/3259/offer/R1Zmpn',
  VOOMP_CHECKOUT_URL_CABELEIREIRO_NOTURNO: 'https://pay.voompcreators.com.br/3259/offer/xDizM4',
  VOOMP_CHECKOUT_URL_CABELEIREIRO_SABADO: 'https://pay.voompcreators.com.br/3259/offer/xDizM4',
};

function safeString(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanPhone(value = '') {
  return String(value || '').replace(/\D/g, '').slice(0, 20);
}

function addParam(url, key, value) {
  if (!value) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

export function resolveVoompCheckoutUrl(payload = {}, audit = {}) {
  const courseSlug = safeString(payload.courseSlug || payload.course_slug, 120);
  const classText = `${payload.classDate || payload.class_date || payload.optionLabel || payload.option_label || ''}`.toLowerCase();
  const isCabeleireiro = courseSlug.includes('cabeleireiro-profissional');
  const envCandidates = [];

  if (isCabeleireiro && /s[aá]bado|sabado/.test(classText)) envCandidates.push('VOOMP_CHECKOUT_URL_CABELEIREIRO_SABADO');
  if (isCabeleireiro && /noite|noturno/.test(classText)) envCandidates.push('VOOMP_CHECKOUT_URL_CABELEIREIRO_NOTURNO');
  if (isCabeleireiro && /diurno|dia/.test(classText)) envCandidates.push('VOOMP_CHECKOUT_URL_CABELEIREIRO_DIURNO');
  if (CHECKOUT_ENV_BY_COURSE[courseSlug]) envCandidates.push(CHECKOUT_ENV_BY_COURSE[courseSlug]);
  if (isCabeleireiro) envCandidates.push('VOOMP_CHECKOUT_URL_CABELEIREIRO');

  const envKey = envCandidates.find((key) => safeString(process.env[key], 1200) || DEFAULT_CHECKOUT_URL_BY_ENV_KEY[key]);
  const expectedEnvKey = envCandidates[0] || CHECKOUT_ENV_BY_COURSE[courseSlug] || null;
  const baseUrl = envKey ? (safeString(process.env[envKey], 1200) || DEFAULT_CHECKOUT_URL_BY_ENV_KEY[envKey] || '') : '';
  if (!baseUrl) {
    return {
      configured: false,
      url: null,
      envKey: expectedEnvKey,
      reason: expectedEnvKey ? 'voomp_checkout_url_not_configured' : 'course_without_voomp_checkout_env',
    };
  }

  let url = baseUrl;
  const attribution = payload.attribution || {};
  const returnUrlBase = process.env.VOOMP_RETURN_URL || 'https://DOMINIO-NAO-CONFIGURADO/retorno/voomp';
  const returnParams = new URLSearchParams({
    provider: 'voomp',
    course: courseSlug,
    turma: safeString(payload.classDate || payload.class_date, 180),
    session_id: safeString(attribution.session_id, 160),
  });
  const returnUrl = `${returnUrlBase}?${returnParams.toString()}`;

  url = addParam(url, 'nome', safeString(payload.name || payload.studentName, 180));
  url = addParam(url, 'email', safeString(payload.email || payload.studentEmail, 180));
  url = addParam(url, 'telefone', cleanPhone(payload.whatsapp || payload.studentWhatsapp));
  url = addParam(url, 'cpf', cleanPhone(payload.cpf || payload.studentCpf));
  url = addParam(url, 'curso', courseSlug);
  url = addParam(url, 'turma', safeString(payload.classDate || payload.class_date, 180));
  url = addParam(url, 'session_id', safeString(attribution.session_id, 160));
  url = addParam(url, 'utm_source', safeString(attribution.utm_source, 120));
  url = addParam(url, 'utm_medium', safeString(attribution.utm_medium, 120));
  url = addParam(url, 'utm_campaign', safeString(attribution.utm_campaign, 180));
  url = addParam(url, 'return_url', returnUrl);

  return {
    configured: true,
    url,
    envKey,
    returnUrl,
    audit: { resolvedAt: new Date().toISOString(), acceptedAt: audit.acceptedAt || null },
  };
}
