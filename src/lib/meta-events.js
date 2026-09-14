// Nomes de evento da Meta, num lugar só (10/09/2026).
//
// Antes existiam DUAS tabelas de conversão: uma no navegador (src/lib/analytics.js) e outra no
// servidor (lib/meta.mjs). Elas discordavam — o mesmo clique da aluna chegava na Meta como
// "Lead" pelo Pixel e como "InitiateCheckout" pela API de Conversões. Evento com nome diferente
// a Meta não junta: vira duas conversões onde houve uma, e o custo por resultado da campanha sai
// pela metade do real.
//
// Este arquivo é importado pelos dois lados. Enquanto for um só, eles não têm como discordar.

export const META_EVENTS = {
  // Navegação.
  //
  // Só o page_view automático vira PageView. `view_agenda` também virava, e a agenda mandava
  // DOIS PageView — um do page_view de rota, outro do view_agenda (visto no Chromium em
  // 10/09/2026). E `select_course_card` virava ViewContent, que a página do curso mandava de
  // novo logo em seguida: dois ViewContent pelo mesmo curso. Os dois continuam guardados no
  // banco pro CRM da escola; só não são evento de campanha.
  page_view: 'PageView',
  view_course: 'ViewContent',

  // Começou uma matrícula (abriu o formulário)
  begin_enrollment: 'InitiateCheckout',
  begin_voomp_acceptance: 'InitiateCheckout',

  // Mandou os dados — é o mesmo ato visto dos dois lados, por isso o mesmo nome dos dois lados.
  submit_lead: 'Lead',
  payment_payload_validated: 'Lead',
  submit_voomp_acceptance: 'Lead',
  acceptance_validated: 'Lead',

  // Clube da Escola: cadastro leve de quem ainda não vai se matricular.
  //
  // NÃO é Lead, de propósito. Lead é só quem começa a matrícula. Se o cadastro do clube contasse
  // como Lead, a Meta passaria a otimizar para cadastro de clube — que é muito mais fácil — e as
  // matrículas cairiam. É assim que campanha morre sem ninguém entender por quê.
  clube_escola_signup: 'CompleteRegistration',

  // Foi para o pagamento
  asaas_checkout_created: 'AddPaymentInfo',
  asaas_payment_created: 'AddPaymentInfo',
  voomp_acceptance_registered: 'AddPaymentInfo',

  // Venda confirmada. Só entra aqui o que é dinheiro confirmado pelo provedor — nunca a volta
  // do navegador da aluna, que acontece antes de o pagamento compensar.
  voomp_payment_confirmed: 'Purchase',
  PAYMENT_CONFIRMED: 'Purchase',
  PAYMENT_RECEIVED: 'Purchase',
};

// Eventos que a Meta precisa saber que são compra. Serve pra tratar valor e moeda como
// obrigatórios, e pra travar em teste que nada além disso vira faturamento na campanha.
export const META_PURCHASE_EVENTS = new Set(['Purchase']);

// Evento fora da tabela NÃO vai pra Meta.
//
// Antes ia: qualquer coisa não mapeada era mandada com o nome literal "CustomEvent" — clique no
// WhatsApp, troca de mês na agenda, sessão atualizada. O Gerenciador de Anúncios enchia de um
// evento chamado "CustomEvent" que não quer dizer nada, misturado com os que importam.
export function metaEventName(eventName) {
  return META_EVENTS[eventName] || '';
}

export function isMetaTrackedEvent(eventName) {
  return Boolean(metaEventName(eventName));
}

// Um id por ato da aluna, gerado no navegador e reaproveitado pelo servidor.
//
// A Meta junta Pixel e API de Conversões quando os dois mandam o MESMO event_name com o MESMO
// event_id. O navegador é quem sabe quando o ato aconteceu, então é ele quem cria o id e manda
// junto no formulário; o servidor usa esse mesmo id no evento dele. Sem isso, cada matrícula
// aparece duas vezes.
export function newMetaEventId(eventName, sessionId = '') {
  const semente = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${eventName}:${sessionId || 'anon'}:${semente}`.slice(0, 200);
}
