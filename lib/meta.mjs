import crypto from 'node:crypto';
import { META_PURCHASE_EVENTS, metaEventName } from '../src/lib/meta-events.js';

function safeString(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Telefone precisa ir com código do país, senão o hash não bate com nada.
//
// A Meta compara SHA-256 de "5511999999999". O site guarda "11999999999" — o mesmo telefone,
// hash diferente, zero correspondência. Como toda aluna da escola é do Brasil, número de 10 ou 11
// dígitos ganha o 55 na frente; quem já veio com 55 passa direto.
function cleanPhone(value = '') {
  const digitos = String(value || '').replace(/\D/g, '').slice(0, 20);
  if (!digitos) return '';
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
}

// Nome separado em primeiro e último: a Meta casa por fn/ln, e mandar o nome inteiro num campo
// só não serve pra nada. Acento e pontuação saem porque é assim que ela normaliza antes do hash.
function splitName(value = '') {
  const partes = String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!partes.length) return { first: '', last: '' };
  return { first: partes[0], last: partes.length > 1 ? partes[partes.length - 1] : '' };
}

function sha256(value = '') {
  const text = safeString(String(value || '').toLowerCase(), 500);
  if (!text) return null;
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function metaConfig() {
  return {
    pixelId: process.env.META_PIXEL_ID || '',
    accessToken: process.env.META_CAPI_ACCESS_TOKEN || '',
    testEventCode: process.env.META_TEST_EVENT_CODE || '',
    apiVersion: process.env.META_API_VERSION || 'v20.0',
  };
}

// A tabela de nomes mora em src/lib/meta-events.js e é a MESMA que o navegador usa. Duas
// tabelas separadas já fizeram o mesmo clique chegar como "Lead" pelo Pixel e "InitiateCheckout"
// pela API de Conversões — nomes diferentes a Meta não junta, e uma matrícula virava duas.
export { metaEventName, isMetaTrackedEvent } from '../src/lib/meta-events.js';

// Hora do fato: data de pagamento quando o provedor manda, senão a hora do aceite, senão agora.
// A Meta recusa evento com mais de 7 dias, então nunca deixamos passar disso.
// Id determinístico pro caso de quem chamou esquecer de mandar um: mesmo fato, mesmo id, então
// reenvio não vira conversão nova.
function idPadrao(eventName, payload = {}, attribution = {}) {
  const chave = [
    payload.paymentId || payload.voompSaleId || payload.enrollmentId || '',
    payload.studentId || payload.email || payload.studentEmail || '',
    payload.courseSlug || payload.course_slug || '',
    attribution.session_id || payload.session_id || '',
  ].join('|');
  return `${eventName}:${crypto.createHash('sha256').update(chave).digest('hex').slice(0, 24)}`;
}

// IP do cliente, preferindo IPv6 (pedido do Diagnóstico da Meta em 11/09/2026: "seu servidor
// está enviando IPv4, mas o Pixel observou IPv6"). Quando as duas pontas mandam IP diferente da
// MESMA visita, a Meta perde uma das chaves que usa pra juntar Pixel e API de Conversões.
//
// O cabeçalho x-forwarded-for vem como uma cadeia ("cliente, proxy1, proxy2"). Se algum salto
// tiver IPv6, é o que o navegador de fato usou — então é esse que vai. Se só houver IPv4, manda
// IPv4 mesmo: não dá pra inventar um endereço que não existe.
function ipDoCliente(request) {
  const cadeia = String(request?.headers?.['x-forwarded-for'] || '')
    .split(',').map((parte) => parte.trim()).filter(Boolean);
  const ehIPv6 = (ip) => ip.includes(':') && !ip.startsWith('::ffff:');
  const comIPv6 = cadeia.find(ehIPv6);
  if (comIPv6) return comIPv6;
  const bruto = cadeia[0] || request?.socket?.remoteAddress || '';
  // "::ffff:200.1.2.3" é um IPv4 disfarçado de IPv6; a Meta quer o IPv4 limpo.
  return bruto.replace(/^::ffff:/, '') || undefined;
}

function eventTimeFrom(payload = {}) {
  const bruta = payload.paidAt || payload.paid_at || payload.confirmedAt || payload.acceptedAt || payload.receivedAt;
  const carimbo = bruta ? Date.parse(bruta) : NaN;
  const agora = Date.now();
  if (!Number.isFinite(carimbo)) return Math.floor(agora / 1000);
  const seteDias = 7 * 24 * 60 * 60 * 1000;
  if (carimbo > agora || agora - carimbo > seteDias) return Math.floor(agora / 1000);
  return Math.floor(carimbo / 1000);
}

function valueFromPayload(payload = {}) {
  const raw = payload.amount || payload.value || payload.total || payload.cart?.priceNumber || payload.cart?.total_amount || payload.priceNumber || 0;
  const value = Number(String(raw).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function sendMetaCapiEvent(eventName, payload = {}, request = null) {
  const config = metaConfig();
  if (!config.pixelId || !config.accessToken) {
    return { configured: false, sent: false, skipped: 'meta_capi_not_configured' };
  }

  // Evento fora da tabela não vai. Antes qualquer coisa não mapeada era mandada com o nome
  // literal "CustomEvent": clique no WhatsApp, troca de mês na agenda, sessão atualizada. O
  // Gerenciador de Anúncios enchia de um evento sem significado, misturado com os que importam.
  const nomeMeta = metaEventName(eventName);
  if (!nomeMeta) return { configured: true, sent: false, skipped: 'evento_nao_e_de_campanha', eventName };

  const attribution = payload.attribution || {};
  // Quem chama sempre manda o event_id. O padrão aqui é a última defesa e NÃO usa relógio: um
  // id com Date.now() faz o reenvio do mesmo webhook virar outra conversão, que é exatamente o
  // erro que já existia no webhook da Voomp.
  //
  // Compra é caso à parte: a identidade dela é o PAGAMENTO, não o aviso que chegou. A Asaas
  // manda PAYMENT_CONFIRMED quando confirma e PAYMENT_RECEIVED quando o dinheiro cai — dois
  // avisos, um pagamento só, e os dois viravam Compra com id diferente. A conta da Erica tinha
  // 523 compras registradas para um punhado de vendas reais (visto no Gerenciador em
  // 10/09/2026). Amarrando o id ao pagamento, os dois avisos viram a MESMA compra e a Meta
  // junta; reenvio do mesmo aviso também.
  const idDoPagamento = safeString(payload.paymentId || payload.voompSaleId || payload.payment_id, 120);
  const eventId = META_PURCHASE_EVENTS.has(nomeMeta) && idDoPagamento
    ? `purchase:${idDoPagamento}`
    : safeString(payload.event_id || payload.eventId || idPadrao(eventName, payload, attribution), 200);
  // Hora do fato, não hora do processamento. Webhook do provedor às vezes chega minutos depois
  // (ou repete no dia seguinte): carimbar "agora" jogaria a venda pro dia errado do relatório.
  const eventTime = eventTimeFrom(payload);
  const email = safeString(payload.email || payload.studentEmail || payload.user?.email, 180);
  const phone = cleanPhone(payload.whatsapp || payload.phone || payload.studentWhatsapp || payload.user?.phone);
  const { first, last } = splitName(payload.name || payload.studentName || payload.customerName);
  const clientIp = ipDoCliente(request);
  const userAgent = request?.headers?.['user-agent'] || undefined;
  const eventSourceUrl = safeString(payload.url || attribution.last_landing_page || attribution.first_landing_page || payload.event_source_url, 1000) || undefined;
  const value = valueFromPayload(payload);
  const ehCompra = META_PURCHASE_EVENTS.has(nomeMeta);

  // Compra sem valor não deve sair: a Meta registraria a conversão com R$ 0 e o ROAS da campanha
  // ficaria zerado justamente na venda que aconteceu. Melhor falhar visível do que reportar zero.
  if (ehCompra && !value) {
    return { configured: true, sent: false, skipped: 'compra_sem_valor', eventName, eventId };
  }

  const data = [{
    event_name: nomeMeta,
    event_time: eventTime,
    event_id: eventId,
    action_source: 'website',
    event_source_url: eventSourceUrl,
    user_data: {
      em: sha256(email),
      ph: sha256(phone),
      fn: sha256(first),
      ln: sha256(last),
      // Toda aluna da escola é do Brasil; o país é mais um campo de correspondência de graça.
      country: sha256('br'),
      client_ip_address: clientIp,
      client_user_agent: userAgent,
      fbc: safeString(attribution.fbc, 300) || (attribution.fbclid ? `fb.1.${Date.now()}.${safeString(attribution.fbclid, 220)}` : undefined),
      fbp: safeString(attribution.fbp, 300) || undefined,
      // Identificador estável da pessoa, não da visita. Antes vinha do session_id, que muda a
      // cada navegador e a cada limpeza de dados: a mesma aluna virava gente diferente entre o
      // aceite e a confirmação do pagamento, e a Meta não ligava as duas pontas.
      external_id: sha256(payload.studentId || email || phone || attribution.session_id || payload.session_id),
    },
    custom_data: {
      currency: 'BRL',
      value,
      content_name: safeString(payload.courseName || payload.course_name || payload.courseSlug || payload.course_slug, 180) || undefined,
      content_category: 'curso_presencial',
      // Sem content_type a Meta não casa o evento com o catálogo — atrapalha remarketing por
      // curso e as recomendações automáticas.
      content_type: 'product',
      content_ids: [safeString(payload.courseSlug || payload.course_slug, 120)].filter(Boolean),
      status: safeString(payload.status || payload.checkoutStatus || payload.voompStatus, 120) || undefined,
      utm_source: safeString(attribution.utm_source || payload.utm_source, 120) || undefined,
      utm_medium: safeString(attribution.utm_medium || payload.utm_medium, 120) || undefined,
      utm_campaign: safeString(attribution.utm_campaign || payload.utm_campaign, 180) || undefined,
    },
  }];

  for (const record of data) {
    Object.keys(record.user_data).forEach((key) => record.user_data[key] == null && delete record.user_data[key]);
    Object.keys(record.custom_data).forEach((key) => record.custom_data[key] == null && delete record.custom_data[key]);
  }

  const body = { data, ...(config.testEventCode ? { test_event_code: config.testEventCode } : {}) };
  const url = `https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(config.pixelId)}/events?access_token=${encodeURIComponent(config.accessToken)}`;
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Falha de envio pra Meta era silenciosa: a função devolvia sent:false e ninguém olhava.
      // Token revogado, expirado ou sem permissão derruba TODA a medição de campanha da escola sem
      // nenhum sinal na tela — a escola só descobriria por uma campanha que "parou de converter".
      // Agora fica no log da Vercel, com o motivo que a própria Meta devolveu.
      console.error('meta_capi_falhou', JSON.stringify({
        status: response.status,
        evento: nomeMeta,
        motivo: result.error?.message || 'sem detalhe',
        tipo: result.error?.type || null,
        code: result.error?.code || null,
      }));
      return { configured: true, sent: false, status: response.status, error: result.error?.message || 'meta_capi_non_2xx' };
    }
    return { configured: true, sent: true, status: response.status, result };
  } catch (error) {
    console.error('meta_capi_falhou', JSON.stringify({ evento: nomeMeta, motivo: error.message || 'erro de rede' }));
    return { configured: true, sent: false, error: error.message || 'meta_capi_failed' };
  }
}
