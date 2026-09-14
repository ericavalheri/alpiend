// Clube da Escola (11/09/2026): cadastro leve de quem visitou a página do curso e não avançou.
//
// A escola não tem equipe comercial. Sem isto, quem chega do anúncio, olha o curso e vai embora não
// deixa rastro nenhum — a Meta sabe que essa pessoa existe, mas a escola não tem como falar com
// ela. Aqui ela deixa nome e WhatsApp com aceite explícito e entra no CRM.
import './scripts/_sem-banco.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { metaEventName } from './src/lib/meta-events.js';
import { pendente } from './scripts/_pendente.mjs';
import { tenant } from './src/lib/tenant.js';

if (!tenant.grupoWhatsapp) pendente('a escola não tem grupo de WhatsApp configurado (tenant.grupoWhatsapp)');

const componente = readFileSync('src/components/ClubeEscola.jsx', 'utf8');
const rota = readFileSync('api/clube.mjs', 'utf8');
const db = readFileSync('lib/db.mjs', 'utf8');
const pagina = readFileSync('src/pages/CoursePage.jsx', 'utf8');

let falhas = 0;
function check(titulo, condicao, detalhe = '') {
  if (condicao) { console.log('OK ', titulo); return; }
  falhas += 1;
  console.log('FALHA', titulo, detalhe ? `→ ${detalhe}` : '');
}

// --- 1. A regra que a escola pediu em letras maiúsculas -----------------------------------------
// Se o cadastro do clube contasse como Lead, a Meta passaria a otimizar para cadastro de clube —
// que é muito mais fácil que uma matrícula — e as matrículas cairiam. É assim que campanha morre
// sem ninguém entender por quê.
check('o clube NÃO é Lead', metaEventName('clube_escola_signup') === 'CompleteRegistration', metaEventName('clube_escola_signup'));
check('Lead continua sendo só quem começa a matrícula',
  metaEventName('submit_lead') === 'Lead' && metaEventName('acceptance_validated') === 'Lead');
check('a rota do clube não dispara evento de matrícula',
  !/submit_lead|acceptance_validated|'Lead'/.test(rota));

// --- 2. Consentimento ---------------------------------------------------------------------------
// O clube manda mensagem de WhatsApp. Aceitar é a condição, não um detalhe de formulário: mandar
// pra quem não pediu é infração de LGPD e derruba o número oficial da escola por denúncia de spam.
check('sem aceite o servidor recusa', rota.includes("error: 'consentimento_obrigatorio'") && rota.includes('if (!payload.optIn)'));
check('o banco também recusa sem aceite', db.includes("erroDeNegocio('clube_sem_consentimento')"));
check('o texto do aceite fica registrado com a pessoa', db.includes('consentText:') && componente.includes('consentText: CONSENT_TEXT'),
  'se o convite mudar amanhã, tem que dar pra saber com o que cada pessoa consentiu');
check('a tela não deixa enviar sem o aceite', componente.includes('if (!form.optIn)'));

// --- 3. A escola não adiciona ninguém no grupo ------------------------------------------------------
// Adicionar alguém num grupo de WhatsApp sem a pessoa pedir é infração da política da Meta e
// derruba o número. Aqui ela recebe o link e decide entrar.
check('o convite é um link que a pessoa clica', componente.includes('CLUBE_WHATSAPP_URL') && componente.includes('chat.whatsapp.com'));
check('o link abre em outra aba, sem tirar a pessoa do curso', componente.includes("target=\"_blank\""));

// --- 4. Não vira matrícula ----------------------------------------------------------------------
// Quem entra no clube não começou matrícula nenhuma. Criar matrícula aqui estragaria o funil, o
// relatório de vendas e a contagem de vagas.
const inicio = db.indexOf('export async function persistClubSignup(');
const corpo = db.slice(inicio, db.indexOf('export async function persistCrmActivity('));
assert.ok(inicio > 0, 'persistClubSignup sumiu');
check('o clube não cria matrícula', !corpo.includes("supabaseRequest('enrollments'"));
check('o clube não cria pagamento', !corpo.includes("supabaseRequest('payments'"));
check('o clube não mexe em vagas', !/reserved|capacity/.test(corpo));
check('a origem fica marcada como clube', corpo.includes("source: 'clube_escola'"));
check('a metadata da aluna é mesclada, não substituída', corpo.includes('...(aluna.metadata || {})'),
  'quem já era aluna não pode perder o que estava guardado nela');

// --- 5. O convite aparece uma vez, e nos dois aparelhos ------------------------------------------
// Detectar saída pelo mouse só existe no computador, e a maior parte do tráfego de anúncio vem de
// celular — por isso rolagem e tempo também disparam.
check('tem gatilho que funciona no celular', componente.includes(">= 0.7") && componente.includes('setTimeout'));
check('tem gatilho de intenção de saída no computador', componente.includes('clientY <= 0'));
check('não insiste com quem já entrou ou já fechou', componente.includes('if (guardado.entrou || guardado.fechou) return'));
check('o armazenamento do navegador não derruba a página se falhar', componente.includes('catch { /* navegador sem armazenamento'));
check('o convite está montado na página do curso', pagina.includes('<ClubeEscola course={course}'));

// --- 6. O lead do Clube precisa CHEGAR no CRM ---------------------------------------------------
// O CRM é montado a partir de MATRÍCULAS, e quem entra no Clube não tem matrícula por design.
// Sem isto o cadastro caía no banco e sumia da tela: a escola teria o telefone guardado e nenhuma
// forma de ver que ele existe — exatamente o problema que o clube veio resolver.
{
  const { buildClubRows, buildCrmRows, buildSalesFromSummary } = await import('./src/lib/crm-helpers.js');
  const resumo = {
    students: [
      { id: 'cl-1', name: 'Joana Souza', whatsapp: '11977776666', created_source: 'clube_escola',
        metadata: { clubeEscola: { joinedAt: '2026-09-11T12:00:00Z', courseSlug: 'laboratorio-de-colorimetria', courseName: 'Laboratório de Colorimetria', utmSource: 'meta', utmCampaign: 'colorimetria-set' } } },
      { id: 'cl-2', name: 'Já é aluna', whatsapp: '11966665555', metadata: { clubeEscola: { joinedAt: '2026-09-10T12:00:00Z' } } },
      { id: 'cl-3', name: 'Nunca entrou no clube', whatsapp: '11955554444', metadata: {} },
    ],
    enrollments: [{ id: 'm1', student_id: 'cl-2', course_slug: 'mechas', course_name: 'Mechas', status: 'paid', created_at: '2026-09-01T10:00:00Z', metadata: {} }],
    payments: [], carts: [], acceptances: [], trackingEvents: [],
  };
  const doClube = buildClubRows(resumo);
  check('o lead do Clube vira card no CRM', doClube.length === 1, `${doClube.length} card(s)`);
  check('quem já tem matrícula não vira card duplicado', !doClube.some((linha) => linha.studentId === 'cl-2'));
  check('quem nunca entrou no clube não aparece', !doClube.some((linha) => linha.studentId === 'cl-3'));
  check('o card leva WhatsApp, curso e campanha', doClube[0].phone === '11977776666' && doClube[0].course.includes('Colorimetria') && doClube[0].campaign === 'colorimetria-set');
  check('o card diz o próximo passo', /clube/i.test(doClube[0].nextAction));
  // Pontuação abaixo do lead que já começou matrícula (55): entrar no clube é interesse
  // declarado, não intenção de compra — a ordem da tela tem que refletir isso.
  check('o clube pontua abaixo de quem começou matrícula', doClube[0].score < 55, String(doClube[0].score));
  const pipeline = buildCrmRows(buildSalesFromSummary(resumo), [], [], [], doClube);
  check('o card do clube entra no pipeline junto com o resto', pipeline.some((linha) => linha.id === 'clube-cl-1'));
}

// --- 7. Boas-vindas por WhatsApp ----------------------------------------------------------------
// Template próprio: quem entra no clube não começou matrícula, e reaproveitar o texto de
// matrícula seria mentir pra pessoa. Sem o template aprovado na Twilio o envio é pulado sem
// quebrar nada — a pessoa já viu o link na tela, que é o caminho principal.
{
  const whats = readFileSync('lib/whatsapp.mjs', 'utf8');
  check('o clube tem template próprio', whats.includes("clube_escola_signup: 'clube_boas_vindas'"));
  check('o link do grupo da mensagem é o mesmo da tela',
    whats.includes('chat.whatsapp.com/FCEvUEOjVfyIE53Xb77eo6') && componente.includes('chat.whatsapp.com/FCEvUEOjVfyIE53Xb77eo6'),
    'dois links diferentes é como a aluna acaba num grupo que não existe mais');
  check('a rota manda as boas-vindas', rota.includes("notifyOfficialWhatsapp('clube_escola_signup'"));
  check('sem template aprovado o cadastro não quebra', whats.includes("skipped: 'twilio_content_sid_not_configured'"));
}

// --- 8. A escola precisa conseguir VER se o template do clube está de pé ------------------------
// Template faltando é silencioso: o envio é pulado e ninguém fica sabendo. Sem um indicador, a
// a escola só descobriria pela ausência de mensagem — que ninguém percebe.
{
  const health = readFileSync('api/health.mjs', 'utf8');
  const resumo = readFileSync('api/admin/summary.mjs', 'utf8');
  check('a saúde do sistema informa se o template do clube existe', health.includes('twilioClubeConfigured'));
  check('o painel também informa', resumo.includes('twilioClubeConfigured'));
  check('o indicador vem do SID de verdade, não de um valor fixo',
    health.includes('Boolean(whatsapp.contentSids.clubeEscola)') && resumo.includes('Boolean(whatsapp.contentSids.clubeEscola)'));
}

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) do Clube da Escola falharam.`);
  process.exit(1);
}
console.log('\nClube da Escola: cadastro com aceite, entra no CRM, e NUNCA conta como Lead da campanha.');
