// Analytics (GTM/GA4/Clarity/Meta Pixel) e atribuição de sessão (UTM, fbclid/gclid, sessão de
// atendimento). Extraído de src/main.jsx (organização de arquivos pedida pela Erica, 05/09/2026).

// import.meta.env só existe quando o Vite monta o site. Os scripts de verificação carregam
// estes módulos direto no Node (sem Vite) e quebravam aqui antes de rodar qualquer teste — daí
// o encadeamento opcional. No navegador nada muda.
import { metaEventName, newMetaEventId } from './meta-events.js';

const viteEnv = import.meta.env || {};
const analyticsConfig = {
  ga4Id: viteEnv.VITE_GA4_MEASUREMENT_ID || '',
  gtmId: viteEnv.VITE_GTM_ID || '',
  clarityId: viteEnv.VITE_CLARITY_PROJECT_ID || '',
  metaPixelId: viteEnv.VITE_META_PIXEL_ID || '',
  // Lista fechada de endereços, quando alguém quiser travar explicitamente. Vazia por padrão —
  // o normal é a regra de exclusão abaixo.
  metaHosts: (viteEnv.VITE_META_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
};

// Endereços que NÃO são o site de verdade: preview da Vercel, ambiente local, ambiente de teste.
const HOSTS_FORA_DE_PRODUCAO = [
  /\.vercel\.app$/,
  /^localhost$/,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /\.local$/,
  /^(preview|staging|homolog|teste|dev)\./,
];

// Cada deploy de preview da Vercel ganha um endereço próprio, e o Pixel disparava igual neles —
// a Meta listava cada um como um "site" mandando dados pro mesmo conjunto, e visita de teste
// entrava misturada com tráfego de campanha (a Erica viu "Mais 13" sites em 10/09/2026).
//
// A primeira versão disto era uma lista fechada com "{DOMINIO}" dentro. Perigoso:
// bastava o site mudar de endereço, ganhar um "www.", ou alguém errar uma letra na variável,
// pro Pixel MORRER CALADO em produção — e ninguém descobre olhando a tela, só semanas depois
// pela campanha sem conversão. Errar pro lado de mandar demais custa dado sujo; errar pro lado
// de não mandar custa dinheiro de anúncio.
//
// Então a regra virou o contrário: dispara em qualquer endereço, MENOS nos que são
// reconhecidamente de teste. Quem quiser travar numa lista fechada ainda pode, preenchendo
// VITE_META_ALLOWED_HOSTS.
export function isProductionHost() {
  if (typeof window === 'undefined') return false;
  const host = String(window.location.hostname || '').toLowerCase();
  if (!host) return false;
  if (analyticsConfig.metaHosts.length) return analyticsConfig.metaHosts.includes(host);
  return !HOSTS_FORA_DE_PRODUCAO.some((padrao) => padrao.test(host));
}

function injectScriptOnce(id, src, attrs = {}) {
  if (!src || document.getElementById(id)) return;
  const script = document.createElement('script');
  script.id = id;
  script.async = true;
  script.src = src;
  Object.entries(attrs).forEach(([key, value]) => script.setAttribute(key, value));
  document.head.appendChild(script);
}

export function initAnalytics() {
  window.dataLayer = window.dataLayer || [];
  if (analyticsConfig.gtmId) {
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    injectScriptOnce('ebn-gtm', `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(analyticsConfig.gtmId)}`);
  }
  if (analyticsConfig.ga4Id) {
    injectScriptOnce('ebn-ga4', `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(analyticsConfig.ga4Id)}`);
    window.gtag = window.gtag || function gtag(){ window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', analyticsConfig.ga4Id, { send_page_view: false });
  }
  if (analyticsConfig.clarityId && !window.clarity) {
    window.clarity = function clarity(){ (window.clarity.q = window.clarity.q || []).push(arguments); };
    injectScriptOnce('ebn-clarity', `https://www.clarity.ms/tag/${encodeURIComponent(analyticsConfig.clarityId)}`);
  }
  if (analyticsConfig.metaPixelId && isProductionHost() && !window.fbq) {
    window.fbq = function fbq(){ window.fbq.callMethod ? window.fbq.callMethod.apply(window.fbq, arguments) : window.fbq.queue.push(arguments); };
    window._fbq = window._fbq || window.fbq;
    window.fbq.push = window.fbq;
    window.fbq.loaded = true;
    window.fbq.version = '2.0';
    window.fbq.queue = [];
    injectScriptOnce('ebn-meta-pixel', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', analyticsConfig.metaPixelId);
  }
}

// Correspondência avançada do Pixel (11/09/2026).
//
// A Meta mostrou que só 35% dos eventos de Lead chegavam com identificação da pessoa: o Pixel
// tentava adivinhar sozinho dos campos do formulário e acertava um terço das vezes. Como o Lead
// é o evento que otimiza a campanha, isso limita direto quanto a Meta consegue atribuir.
//
// No momento do envio a agenda já tem nome, e-mail e telefone digitados — então passa de vez.
// A normalização é a MESMA do servidor (lib/meta.mjs): minúsculo, sem acento, telefone com o 55
// na frente. Tem que ser igual, senão o dado do navegador e o do servidor viram duas pessoas
// diferentes pra Meta e a correspondência piora em vez de melhorar.
//
// Quem hasheia é o próprio Pixel, no navegador — o dado cru não sai da máquina da aluna.
function normalizarParaMeta(valor = '') {
  return String(valor || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase();
}

function telefoneParaMeta(valor = '') {
  const digitos = String(valor || '').replace(/\D/g, '').slice(0, 20);
  if (!digitos) return '';
  return digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
}

export function identifyForMeta({ name = '', email = '', whatsapp = '' } = {}) {
  if (!window.fbq || !analyticsConfig.metaPixelId || !isProductionHost()) return;
  const partes = normalizarParaMeta(name).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  const dados = {
    em: normalizarParaMeta(email) || undefined,
    ph: telefoneParaMeta(whatsapp) || undefined,
    fn: partes[0] || undefined,
    ln: partes.length > 1 ? partes[partes.length - 1] : undefined,
    country: 'br',
  };
  Object.keys(dados).forEach((chave) => dados[chave] === undefined && delete dados[chave]);
  if (!dados.em && !dados.ph) return;
  // Reinicializar o Pixel com os dados é como a Meta documenta a correspondência avançada
  // manual; a partir daqui os eventos disparados levam a identificação junto.
  window.fbq('init', analyticsConfig.metaPixelId, dados);
}

export function analyticsPageView(path = window.location.pathname) {
  const attribution = captureAttribution();
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: 'page_view', page_path: path, page_location: window.location.href, attribution, source_app: 'agenda_ebn_mvp' });
  if (window.gtag && analyticsConfig.ga4Id) window.gtag('event', 'page_view', { page_path: path, page_location: window.location.href, page_title: document.title });
  // O PageView saía sem event_id, então a Meta não tinha como juntá-lo com o que a API de
  // Conversões manda do servidor — e o mesmo acesso contava duas vezes. Agora o id é gerado
  // aqui e o mesmo id vai pros dois caminhos.
  const eventId = newMetaEventId('page_view', attribution.session_id);
  const params = { page_path: path, page_title: document.title };
  // A checagem do domínio é repetida aqui de propósito. Antes o bloqueio dependia só de o
  // initAnalytics não ter criado o window.fbq — bastava qualquer outro script da página definir
  // um fbq (extensão do navegador, tag de terceiro, o snippet do WordPress colado sem querer)
  // pro preview voltar a mandar evento como se fosse campanha.
  if (window.fbq && analyticsConfig.metaPixelId && isProductionHost()) {
    window.fbq('track', 'PageView', {}, { eventID: eventId });
  }
  enviarProServidor('page_view', eventId, params, attribution);
  if (window.clarity) window.clarity('set', 'ebn_session_id', attribution.session_id || '');
}

// Manda o evento pro servidor, que grava no banco e repassa pra API de Conversões da Meta com
// este mesmo event_id.
function enviarProServidor(eventName, eventId, params, attribution) {
  // O servidor usa isto pra decidir se repassa pra Meta. Fora de produção, grava e para por aí.
  const payload = JSON.stringify({ event: eventName, event_id: eventId, payload: params, attribution, production: isProductionHost(), path: window.location.pathname, url: window.location.href, referrer: document.referrer || null, title: document.title });
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/whatsapp/events', new Blob([payload], { type: 'application/json' }));
  } else {
    fetch('/api/whatsapp/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
  }
}

function getStoredJson(key, fallback = null) {
  try { return JSON.parse(window.localStorage.getItem(key) || 'null') || fallback; } catch { return fallback; }
}

function getCookie(name) {
  return document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.split('=').slice(1).join('=') || '';
}

function getSessionId() {
  const key = 'ebn_session_id';
  let value = window.localStorage.getItem(key);
  if (!value) {
    value = `ebn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(key, value);
  }
  return value;
}

export function captureAttribution() {
  const params = new URLSearchParams(window.location.search);
  const previous = getStoredJson('ebn_attribution', {});
  const utm = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'msclkid', 'whatsapp_id', 'subscriber_id', 'contact_id'].forEach((key) => {
    const value = params.get(key);
    if (value) utm[key] = value;
  });
  const fbp = getCookie('_fbp');
  const fbc = getCookie('_fbc') || (utm.fbclid ? `fb.1.${Date.now()}.${utm.fbclid}` : '');
  const now = new Date().toISOString();
  const attribution = {
    ...previous,
    ...utm,
    session_id: previous.session_id || getSessionId(),
    first_landing_page: previous.first_landing_page || window.location.href,
    first_referrer: previous.first_referrer || document.referrer || null,
    first_seen_at: previous.first_seen_at || now,
    last_landing_page: window.location.href,
    last_referrer: document.referrer || previous.last_referrer || null,
    fbp: fbp || previous.fbp || null,
    fbc: fbc || previous.fbc || null,
    last_seen_at: now,
  };
  window.localStorage.setItem('ebn_attribution', JSON.stringify(attribution));
  return attribution;
}

export function getAttribution() {
  if (typeof window === 'undefined') return {};
  return getStoredJson('ebn_attribution', {}) || {};
}

export function track(eventName, params = {}) {
  window.dataLayer = window.dataLayer || [];
  const attribution = captureAttribution();
  // O id pode vir pronto de quem chamou. É assim que o formulário de matrícula usa o MESMO id
  // no Pixel e no evento que o servidor manda pela API de Conversões — sem isso a Meta conta a
  // mesma matrícula duas vezes, uma por caminho.
  const eventId = params.meta_event_id || newMetaEventId(eventName, attribution.session_id);
  const event = { event: eventName, event_id: eventId, ...params, attribution, source_app: 'agenda_ebn_mvp' };
  window.dataLayer.push(event);
  if (window.gtag) window.gtag('event', eventName, { ...params, event_id: eventId, course_slug: params.course_slug || params.courseSlug, value: params.value || params.priceNumber });
  if (window.fbq && analyticsConfig.metaPixelId && isProductionHost()) {
    // Mesma tabela do servidor (src/lib/meta-events.js). Duas tabelas separadas já fizeram o
    // mesmo clique chegar como "Lead" pelo Pixel e "InitiateCheckout" pela API de Conversões.
    const nomeMeta = metaEventName(eventName);
    if (nomeMeta) window.fbq('track', nomeMeta, { content_name: params.course_name || params.courseName || params.course_slug || params.courseSlug, content_category: 'curso_presencial', content_type: 'product', content_ids: [params.course_slug || params.courseSlug].filter(Boolean), value: params.value || params.priceNumber || params.cart?.priceNumber, currency: 'BRL' }, { eventID: eventId });
  }
  if (window.clarity && params.course_slug) window.clarity('set', 'ebn_course_slug', params.course_slug);
  enviarProServidor(eventName, eventId, params, attribution);
}
