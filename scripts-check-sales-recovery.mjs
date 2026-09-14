// Recuperação de venda (achado em 11/09/2026, revisando por que os leads da escola não viram
// matrícula mesmo com a Twilio inteira configurada).
//
// As três buscas que alimentam o cron de recuperação só existiam em SQL direto e devolviam
// `supported: false` quando o sistema roda por Supabase REST — que é o modo de produção. O cron
// respondia 200 com "recover_carts_unsupported_without_postgres", a Vercel marcava a execução
// como bem-sucedida, e NENHUM WhatsApp de carrinho abandonado, aceite sem pagamento ou boleto
// vencendo jamais saiu. A escola pagava anúncio, a aluna parava no meio da matrícula, e a
// automação que existia pra buscá-la de volta nunca rodou.
import './scripts/_sem-banco.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const db = readFileSync('lib/db.mjs', 'utf8');
const cron = readFileSync('api/cron/recover-carts.mjs', 'utf8');
const lembretes = readFileSync('api/cron/class-reminders.mjs', 'utf8');

// 1. Nenhuma das buscas pode desistir por falta de conexão direta.
for (const funcao of ['findAbandonedCartCandidates', 'findPendingVoompAcceptances', 'findPendingAsaasPayments']) {
  const inicio = db.indexOf(`export async function ${funcao}(`);
  assert.ok(inicio > 0, `${funcao} sumiu`);
  const corpo = db.slice(inicio, inicio + 1400);
  assert.ok(!/if \(!DATABASE_URL\) return \{ supported: false/.test(corpo),
    `${funcao} voltou a desistir sem Postgres direto — em produção isso zera a recuperação de venda`);
  assert.ok(/if \(!DATABASE_URL\) \{/.test(corpo), `${funcao} precisa de um caminho para o modo Supabase`);
}
console.log('OK  as três buscas de recuperação funcionam nos dois modos de banco');

// A reconferência de pagamento também: sem ela, o cupom sairia pra quem já pagou.
const conflito = db.slice(db.indexOf('export async function hasConflictingPaidEnrollment('), db.indexOf('export async function hasConflictingPaidEnrollment(') + 900);
assert.ok(!/if \(!DATABASE_URL\) return null;/.test(conflito), 'a reconferência de pagamento não pode devolver null por falta de Postgres — o cupom iria pra quem já é aluna pagante');
console.log('OK  a reconferência de pagamento antes do envio vale nos dois modos');

// 2. Sem fonte de dados, o cron falha alto. Responder 200 fazia a Vercel marcar a execução como
// bem-sucedida enquanto nada era enviado.
assert.ok(cron.includes("error: 'recover_carts_sem_fonte_de_dados'") && cron.includes('response.status(503)'),
  'cron sem fonte de dados tem que falhar visível, não responder 200');
assert.ok(!cron.includes('recover_carts_unsupported_without_postgres'), 'o no-op silencioso não pode voltar');
console.log('OK  cron sem fonte de dados falha alto, em vez de fingir sucesso');

// 3. Ensaio não é passe livre.
// `?dryRun=1` pulava a checagem do segredo inteira, e a resposta traz a chave de recuperação —
// que contém o e-mail da aluna. Qualquer pessoa na internet listava quem está no meio de uma
// matrícula.
for (const [nome, fonte] of [['recover-carts', cron], ['class-reminders', lembretes]]) {
  assert.ok(!/if \(dryRun\) return \{ ok: true/.test(fonte),
    `${nome}: ensaio não pode pular a checagem do segredo — a resposta leva e-mail de aluna`);
  assert.ok(/const configured = process\.env\.CRON_SECRET/.test(fonte), `${nome}: o segredo tem que ser exigido sempre`);
}
console.log('OK  ensaio (dryRun) exige o segredo do cron, como qualquer chamada');

// 4. As regras de proteção continuam no lugar — é o que impede a automação de virar spam.
assert.ok(db.includes('async function matriculasJaPagas('), 'quem já pagou tem que ficar de fora do lembrete');
assert.ok(db.includes('async function chavesJaTratadas('), 'quem já recebeu não pode receber de novo');
assert.ok(db.includes('function janelaDeRecuperacao('), 'a janela de 30 min a 6 h tem que ser respeitada');
assert.ok(cron.includes('whatsapp_opt_in_false'), 'quem recusou WhatsApp não recebe');
console.log('OK  as travas continuam: janela de tempo, não repetir, não mandar pra quem pagou, respeitar opt-out');

console.log('\nRecuperação de venda: funciona no modo de produção, falha alto quando não pode rodar, e o ensaio não é porta aberta.');
