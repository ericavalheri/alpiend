// Rastreamento da Meta (10/09/2026, pedido da Erica antes de subir as campanhas).
//
// Campanha só otimiza bem se a conversão que a Meta recebe descreve a venda que aconteceu.
// Este arquivo trava os erros que estavam acontecendo — todos silenciosos, todos do tipo que
// só aparece semanas depois, como "custo por matrícula pela metade" no Gerenciador.
import './scripts/_sem-banco.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { META_EVENTS, metaEventName, newMetaEventId } from './src/lib/meta-events.js';

const analytics = readFileSync('src/lib/analytics.js', 'utf8');
const meta = readFileSync('lib/meta.mjs', 'utf8');
const checkout = readFileSync('src/pages/checkout.jsx', 'utf8');
const aceite = readFileSync('api/acceptance.mjs', 'utf8');
const pagamentos = readFileSync('api/payments.mjs', 'utf8');
const voomp = readFileSync('api/webhooks/voomp.mjs', 'utf8');
const asaas = readFileSync('api/webhooks/asaas.mjs', 'utf8');

let falhas = 0;
function check(titulo, condicao, detalhe = '') {
  if (condicao) { console.log('OK ', titulo); return; }
  falhas += 1;
  console.log('FALHA', titulo, detalhe ? `→ ${detalhe}` : '');
}

// --- 1. Uma tabela de nomes só -----------------------------------------------------------------
// Existiam duas: uma no navegador e outra no servidor. Discordavam em begin_voomp_acceptance
// (Lead x InitiateCheckout), e evento com nome diferente a Meta não junta — a mesma matrícula
// contava duas vezes.
check('o navegador não tem tabela de eventos própria',
  !analytics.includes('const metaEventMap = {'),
  'src/lib/analytics.js voltou a ter um mapa local de eventos da Meta');
check('o navegador usa a tabela compartilhada', analytics.includes("from './meta-events.js'"));
check('o servidor usa a tabela compartilhada', meta.includes("from '../src/lib/meta-events.js'"));

// --- 2. Evento que não é de campanha não vai pra Meta ------------------------------------------
// Antes, qualquer evento fora da tabela era mandado com o nome literal "CustomEvent": clique no
// WhatsApp, troca de mês na agenda, sessão atualizada. Enchia o Gerenciador de um evento que não
// quer dizer nada.
check('evento fora da tabela não vira "CustomEvent"', metaEventName('click_whatsapp') === '');
check('nem por engano existe CustomEvent no código', !meta.includes("'CustomEvent'") && !analytics.includes("'CustomEvent'"));
check('o servidor recusa mandar evento sem nome de campanha', meta.includes("skipped: 'evento_nao_e_de_campanha'"));

// --- 3. O mesmo ato tem o mesmo nome dos dois lados ---------------------------------------------
// Estes pares são o MESMO ato da aluna visto do navegador e do servidor. Se os nomes divergirem,
// a Meta conta duas conversões.
const pares = [
  ['submit_lead', 'payment_payload_validated'],
  ['submit_voomp_acceptance', 'acceptance_validated'],
];
for (const [doNavegador, doServidor] of pares) {
  check(`"${doNavegador}" e "${doServidor}" chegam com o mesmo nome na Meta`,
    metaEventName(doNavegador) === metaEventName(doServidor) && metaEventName(doNavegador) !== '',
    `${metaEventName(doNavegador)} x ${metaEventName(doServidor)}`);
}

// --- 4. E o mesmo event_id ---------------------------------------------------------------------
// Nome igual não basta: a Meta junta por (nome, event_id). O navegador gera o id ANTES de mandar
// o formulário e o servidor reaproveita esse id.
check('o formulário gera o id antes de enviar', (checkout.match(/newMetaEventId\(/g) || []).length >= 2);
check('o id vai no corpo do pedido', checkout.includes('metaEventId,'));
check('o Pixel usa esse mesmo id', checkout.includes('meta_event_id: metaEventId'));
check('o aceite no servidor reaproveita o id do navegador', aceite.includes('event_id: payload.metaEventId ||'));
check('o pagamento no servidor reaproveita o id do navegador', pagamentos.includes('event_id: payload.metaEventId ||'));
check('o track aceita um id pronto', analytics.includes('params.meta_event_id || newMetaEventId('));
check('ids gerados não se repetem', newMetaEventId('submit_lead', 's1') !== newMetaEventId('submit_lead', 's1'));

// --- 5. Identificação da pessoa ------------------------------------------------------------------
// _fbp e _fbc são o que mais casa venda com anúncio. O navegador capturava dos cookies, mandava
// pro servidor — e a normalização do pedido descartava os dois.
for (const [nome, fonte] of [['aceite', aceite], ['pagamento', pagamentos]]) {
  check(`o ${nome} preserva _fbp`, /fbp: safeString\(attribution\.fbp/.test(fonte));
  check(`o ${nome} preserva _fbc`, /fbc: safeString\(attribution\.fbc/.test(fonte));
}
check('telefone vai com código do país', meta.includes("return `55${digitos}`"));
check('nome vai separado em fn e ln', meta.includes('fn: sha256(first)') && meta.includes('ln: sha256(last)'));
check('país vai junto', meta.includes("country: sha256('br')"));
check('external_id é da pessoa, não da visita',
  /external_id: sha256\(payload\.studentId \|\| email \|\| phone/.test(meta),
  'voltou a sair do session_id, que muda a cada navegador');
check('o catálogo casa com o evento', meta.includes("content_type: 'product'"));

// --- 6. Compra ----------------------------------------------------------------------------------
// O que vira faturamento na campanha. Só pagamento confirmado pelo provedor, nunca a volta do
// navegador — que acontece antes de o boleto compensar.
const compras = Object.entries(META_EVENTS).filter(([, nome]) => nome === 'Purchase').map(([chave]) => chave);
assert.deepEqual(compras.sort(), ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'voomp_payment_confirmed'].sort());
console.log('OK  só pagamento confirmado vira Purchase:', compras.join(', '));
check('a volta do navegador não é compra nem pagamento', metaEventName('voomp_checkout_return') === '');
check('compra sem valor não sai', meta.includes("skipped: 'compra_sem_valor'"),
  'a Meta registraria a venda com R$ 0 e zeraria o ROAS da campanha');
check('webhook Voomp repetido não vira outra compra',
  !voomp.includes('payload.paymentId || Date.now()') && voomp.includes("skipped: 'venda_sem_identificador'"));
check('webhook Asaas repetido não vira outra compra', asaas.includes("skipped: 'webhook_repetido'"));
check('a venda é carimbada na hora do pagamento', meta.includes('function eventTimeFrom(') && asaas.includes('paidAt: payment.paymentDate'));

// --- 7. Um evento por ato ----------------------------------------------------------------------
// Unificar as tabelas trouxe um efeito colateral que só apareceu no Chromium: a agenda passou a
// mandar DOIS PageView (um do page_view de rota, outro do view_agenda), e o PageView automático
// saía sem event_id — sem id a Meta não junta com o que a API de Conversões manda.
check('só o page_view de rota vira PageView', metaEventName('page_view') === 'PageView');
check('view_agenda não duplica o PageView da rota', metaEventName('view_agenda') === '');
check('clicar no card não duplica o ViewContent da página do curso', metaEventName('select_course_card') === '');
check('o PageView automático leva event_id', /fbq\('track', 'PageView', \{\}, \{ eventID: eventId \}\)/.test(analytics));
check('o PageView automático também vai pro servidor', analytics.includes("enviarProServidor('page_view', eventId"));
check('o endpoint público aceita page_view', readFileSync('lib/tracking_events.mjs', 'utf8').includes("'page_view',"));
check('o id padrão do servidor não usa relógio',
  meta.includes('function idPadrao(') && !/idPadrao[\s\S]{0,400}Date\.now\(\)/.test(meta),
  'id com relógio faz reenvio de webhook virar conversão nova');

// --- 8. Verificação de domínio -------------------------------------------------------------------
// Sem o domínio verificado a a escola não consegue priorizar eventos e perde atribuição no iOS.
//
// Quem verifica o domínio raiz (escola.exemplo.com.br) é o registro TXT no DNS, não esta tag: a raiz é
// o WordPress na Hostinger, e esta aplicação responde em escola.exemplo.com.br. A tag fica aqui
// pro caso de a a escola cadastrar o subdomínio separado — e, se ficar, tem que estar no <head>
// estático, porque o rastreador da Meta lê o HTML como sai do servidor e não roda JavaScript.
{
  const html = readFileSync('index.html', 'utf8');
  const cabeca = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  const tag = /<meta name="facebook-domain-verification" content="([a-z0-9]{20,})" \/>/.exec(cabeca);
// A tag de verificação de domínio é da conta de negócios DESTA escola, e nasce vazia numa
// cópia. Enquanto não existir, é pendência no Gerenciador de Negócios, não defeito de código.
if (/facebook-domain-verification"\s+content="[^"]+"/.test(html)) {
  check('a metatag de verificação da Meta está no <head>', /<head>[\s\S]*facebook-domain-verification[\s\S]*<\/head>/.test(html));
} else {
  console.log('-- verificação de domínio da Meta ainda não configurada (ver index.html)');
}
  check('a verificação não depende de JavaScript',
    !readFileSync('src/main.jsx', 'utf8').includes('facebook-domain-verification'));
}

// --- 9. Compra é o pagamento, não o aviso ------------------------------------------------------
// O Gerenciador da Erica mostrava 523 "Compra" para um punhado de vendas reais (10/09/2026). A
// Asaas manda PAYMENT_CONFIRMED quando confirma e PAYMENT_RECEIVED quando o dinheiro cai: dois
// avisos, um pagamento só — e cada um virava uma compra, com id diferente.
check('a compra é identificada pelo pagamento, não pelo aviso',
  meta.includes("`purchase:${idDoPagamento}`"),
  'sem isso, confirmado + recebido do mesmo pagamento viram duas vendas');
check('a venda leva a atribuição do anúncio pra Meta',
  asaas.includes('attribution: context?.attribution'),
  'webhook vem do servidor da Asaas, sem cookie: sem isso a correspondência da Compra fica no chão');
check('o contexto do pagamento busca a atribuição guardada na matrícula',
  readFileSync('lib/db.mjs', 'utf8').includes(') as attribution'));

// --- 10. Preview da Vercel não conta como campanha ---------------------------------------------
// Cada deploy de preview tem endereço próprio e disparava o mesmo Pixel: a Meta listava cada um
// como um "site" mandando dados, e visita de teste entrava junto com tráfego de campanha.
check('o Pixel só inicia no endereço de produção', analytics.includes('isProductionHost() && !window.fbq'));
// A regra é de EXCLUSÃO, não de lista fechada. Uma lista com "escola.exemplo.com.br" dentro
// desligava o Pixel calado se o site mudasse de endereço, ganhasse um "www." ou alguém errasse
// uma letra na variável — e isso ninguém descobre olhando a tela, só semanas depois pela
// campanha sem conversão. Errar mandando demais custa dado sujo; errar não mandando custa
// dinheiro de anúncio.
check('o bloqueio exclui endereço de teste em vez de exigir lista fechada',
  analytics.includes('HOSTS_FORA_DE_PRODUCAO') && !/metaHosts: \(viteEnv\.VITE_META_ALLOWED_HOSTS \|\| 'agenda/.test(analytics),
  'a lista fechada como padrão podia desligar o Pixel em produção sem ninguém perceber');
// A checagem é repetida em cada disparo de propósito: depender só de o window.fbq não existir
// deixava qualquer outro script da página (extensão, tag de terceiro, o snippet do WordPress
// colado sem querer) reabrir o caminho do preview pra dentro da campanha.
check('cada disparo do Pixel confere o domínio',
  (analytics.match(/window\.fbq && analyticsConfig\.metaPixelId && isProductionHost\(\)/g) || []).length === 2,
  'os dois pontos que chamam fbq precisam checar o domínio');
check('o beacon avisa o servidor se é produção', analytics.includes('production: isProductionHost()'));
check('fora de produção o servidor não repassa pra Meta',
  readFileSync('lib/tracking_events.mjs', 'utf8').includes("skipped: 'fora_de_producao'"));
check('ausência do aviso vale como produção (JS antigo em cache não quebra)',
  readFileSync('lib/tracking_events.mjs', 'utf8').includes('body.production !== false'));

// --- 11. O script de configuração automática da Meta fica bloqueado de propósito -----------------
// www.facebook.com/signals/iwl.js é o script da ferramenta "Configurar eventos" e dos eventos
// automáticos de clique da Meta. Liberar ele significa deixar o Pixel inventar eventos por conta
// própria — eventos SEM event_id, que não desduplicam com os que o site manda e com a API de
// Conversões, e que voltariam a inflar a conta como o "CustomEvent" fazia.
//
// A escola dispara os eventos dela no código, com id. Este bloqueio é a defesa contra alguém
// reconfigurar isso por engano pelo Gerenciador de Anúncios.
{
  const csp = JSON.parse(readFileSync('vercel.json', 'utf8')).headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  const diretiva = (nome) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${nome} `)) || '');
  check('scripts só podem vir de connect.facebook.net, nunca de www.facebook.com',
    diretiva('script-src').includes('https://connect.facebook.net') && !diretiva('script-src').includes('https://www.facebook.com'),
    'liberar www.facebook.com deixa a Meta injetar eventos automáticos sem event_id');
  // O GA4 coleta em analytics.google.com (host cru) e em www.google.com. Em CSP, "*.dominio" casa
  // apenas SUBDOMÍNIOS — não casa o host cru. Sem estes dois, a medição do Google fica bloqueada
  // em silêncio, que foi o que apareceu no console da Erica em 11/09/2026.
  for (const origem of ['https://analytics.google.com', 'https://www.google.com']) {
    check(`o GA4 consegue coletar em ${origem}`, diretiva('connect-src').includes(`${origem} `) || diretiva('connect-src').endsWith(origem));
  }
}

// --- 12. Falha de envio pra Meta não pode ser silenciosa ----------------------------------------
// Token revogado, expirado ou sem permissão derruba TODA a medição de campanha, e a função só
// devolvia sent:false — ninguém olha esse retorno. A escola descobriria por uma campanha que
// "parou de converter" semanas depois. Agora vai pro log da Vercel com o motivo da Meta.
check('erro de envio pra Meta vai pro log', meta.includes("console.error('meta_capi_falhou'"));
check('o log leva o motivo que a Meta devolveu', meta.includes('result.error?.message'));

// --- 13. Identificação da pessoa no Pixel e IP coerente entre as duas pontas ---------------------
// A Meta mostrou que só 35% dos eventos de Lead chegavam com identificação: o Pixel tentava
// adivinhar dos campos do formulário. Como o Lead é o evento que otimiza a campanha, isso limita
// direto a atribuição. No envio a agenda já tem nome, e-mail e telefone digitados.
check('o checkout identifica a aluna antes de disparar o Lead',
  (checkout.match(/identifyForMeta\(\{ name: form\.name/g) || []).length === 2,
  'os dois formulários (aceite e pagamento) precisam identificar antes do evento');
check('a identificação usa a mesma normalização do servidor',
  analytics.includes('function telefoneParaMeta('),
  'normalização diferente faz a mesma aluna virar duas pessoas pra Meta');
check('nada é enviado sem e-mail nem telefone', analytics.includes('if (!dados.em && !dados.ph) return;'));
check('a identificação respeita o bloqueio de preview', analytics.includes('!analyticsConfig.metaPixelId || !isProductionHost()) return;'));

// IP: quando as duas pontas mandam endereço diferente da MESMA visita, a Meta perde uma das
// chaves que usa pra juntar Pixel e API de Conversões (pedido do Diagnóstico, 11/09/2026).
check('o IP do cliente prefere IPv6 quando existe', meta.includes('function ipDoCliente('));
check('IPv4 disfarçado de IPv6 vai limpo', meta.includes("replace(/^::ffff:/, '')"));

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) do rastreamento da Meta falharam.`);
  process.exit(1);
}
console.log('\nMeta: uma tabela de eventos só, Pixel e API de Conversões com o mesmo id, e compra só com dinheiro confirmado.');
