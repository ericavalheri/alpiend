// Pós-compra da escola: o que acontece entre a Asaas confirmar o pagamento e a aluna receber o
// acesso à Minha Área no WhatsApp.
//
// A versão antiga deste script lia api/_db.mjs e api/_whatsapp.mjs, arquivos que sumiram numa
// reorganização pra lib/, e por isso quebrava antes da primeira verificação — ficou meses sem
// proteger nada. Reescrito em 07/09/2026 pra rodar a sequência de verdade (com o fetch da
// Twilio dublado) em vez de procurar trechos de texto no código-fonte, que era o que fazia ele
// envelhecer a cada refatoração.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Precisa vir antes do import de lib/whatsapp.mjs: o mapa de templates da Twilio é montado na
// hora em que o módulo carrega.
process.env.WHATSAPP_FOLLOWUP_MODE = 'twilio';
process.env.TWILIO_ACCOUNT_SID = 'AC_teste';
process.env.TWILIO_AUTH_TOKEN = 'token_teste';
process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+5511999999999';
process.env.TWILIO_CONTENT_SID_MATRICULA_CONFIRMADA = 'HX_confirmada';
process.env.TWILIO_CONTENT_SID_ACESSO_ALUNO = 'HX_acesso';
// De propósito: mesmo com o template de boas-vindas configurado, ele não pode mais ser
// enviado. É esse cenário que pega a terceira mensagem voltando sem ninguém perceber.
process.env.TWILIO_CONTENT_SID_BOAS_VINDAS = 'HX_boas_vindas';
// Mínimo de 32 caracteres: abaixo disso signStudentAccess() recusa assinar e o link do
// WhatsApp sai sem token nenhum (o /api/health expõe isso como studentAccessConfigured).
process.env.STUDENT_ACCESS_SECRET = 'segredo-de-teste-com-32-caracteres-ou-mais';
process.env.STUDENT_PORTAL_BASE_URL = 'https://escola.exemplo.com.br/aluno';

const { notifyOfficialWhatsapp } = await import('./lib/whatsapp.mjs');

const enviadas = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const body = new URLSearchParams(options.body || '');
  enviadas.push({ url: String(url), contentSid: body.get('ContentSid'), variables: body.get('ContentVariables') || '' });
  return { ok: true, status: 201, json: async () => ({ sid: `SM${enviadas.length}` }), text: async () => '{}' };
};

const matriculaPaga = {
  name: 'Erica Cavalheri',
  whatsapp: '13996914248',
  courseName: 'No Gender Hair Cut',
  classDate: '12 de setembro de 2026',
  studentId: 'aluna-1',
  enrollmentId: 'matricula-1',
};

const resultado = await notifyOfficialWhatsapp('PAYMENT_CONFIRMED', matriculaPaga);
globalThis.fetch = fetchOriginal;

// 1. Pagamento confirmado dispara exatamente duas mensagens: a confirmação da matrícula (que já
// dá os parabéns) e o acesso à Minha Área. Pedido da Erica em 04/09/2026 — três mensagens
// seguidas era spam. Uma regressão silenciosa trouxe a terceira de volta numa branch de
// trabalho em 07/09/2026, e é isso que esta verificação impede de chegar em produção.
assert.equal(enviadas.length, 2, `Pagamento confirmado deve enviar 2 mensagens, enviou ${enviadas.length}.`);
assert.equal(enviadas[0].contentSid, 'HX_confirmada', 'A primeira mensagem precisa ser a confirmação da matrícula.');
assert.equal(enviadas[1].contentSid, 'HX_acesso', 'A segunda mensagem precisa ser o acesso à Minha Área.');
assert.ok(
  !enviadas.some((mensagem) => mensagem.contentSid === 'HX_boas_vindas'),
  'A mensagem separada de boas-vindas foi removida da sequência e não pode voltar, nem com o template configurado.',
);
assert.equal(resultado.sent, true, 'A sequência precisa reportar envio pra aparecer no CRM.');

// 2. O link que vai no WhatsApp é o acesso pessoal e assinado da aluna, não o checkout nem a
// página de login genérica — é ele que abre a Minha Área já autenticada.
const linkEnviado = decodeURIComponent(enviadas[1].variables);
assert.match(linkEnviado, /escola\.exemplo\.com\.br\/aluno\?token=/, 'O acesso precisa levar o link pessoal da Minha Área.');
assert.ok(!/checkout|asaas\.com|voomp/i.test(linkEnviado), 'O link do acesso nunca pode ser o do checkout do provedor.');

// 3. Aluna que pediu pra não receber WhatsApp não recebe, mesmo com pagamento confirmado.
const semOptIn = await notifyOfficialWhatsapp('PAYMENT_CONFIRMED', { ...matriculaPaga, whatsappOptIn: false });
assert.equal(semOptIn.sent, false, 'Sem opt-in, nenhuma mensagem pode ser enviada.');

// 4. Garantias do webhook que não dá pra exercitar sem banco, conferidas no código: só evento
// novo e de cobrança gerida pela agenda dispara mensagem, e a trava de duplicidade é do banco
// (unique de provider + provider_event_id), não uma checagem em memória que se perde.
const webhook = await readFile(new URL('./api/webhooks/asaas.mjs', import.meta.url), 'utf8');
const database = await readFile(new URL('./lib/db.mjs', import.meta.url), 'utf8');

assert.match(webhook, /\['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_CREATED'\]\.includes\(result\.eventType\)/, 'Confirmação e recebimento precisam liberar o pós-compra.');
assert.match(webhook, /!result\.duplicate/, 'Webhook repetido da Asaas não pode reenviar o WhatsApp.');
assert.match(webhook, /Boolean\(result\.updatedPayment\)/, 'Cobrança que não é da agenda não pode gerar mensagem pra ninguém.');
assert.match(database, /on conflict \(provider, provider_event_id\) do nothing/, 'A trava de evento duplicado precisa ser do banco, não da memória do processo.');
assert.match(database, /applyAutomaticStudentBadge\(updatedPayment\.student_id, 'new_course'/, 'Matrícula paga precisa registrar o selo automático da aluna.');

console.log('OK  pagamento confirmado envia 2 mensagens: confirmação da matrícula e acesso à Minha Área');
console.log('OK  a mensagem separada de boas-vindas continua fora da sequência');
console.log('OK  o WhatsApp leva o link pessoal e assinado da Minha Área, nunca o do checkout');
console.log('OK  aluna sem opt-in de WhatsApp não recebe mensagem');
console.log('OK  webhook repetido ou de cobrança de fora da agenda não dispara mensagem');
console.log('OK  trava de evento duplicado é do banco (unique provider + provider_event_id)');
console.log('OK  matrícula paga registra o selo automático da aluna');
console.log('\nPós-compra a escola: acesso, sequência de WhatsApp e idempotência verificados.');
