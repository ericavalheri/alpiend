// Verificação rápida das correções P0 e P1.1/P1.2 (Manual Oficial a escola, seção 15): preço
// autoritativo, webhooks fail-closed, acesso do aluno sem fallback inseguro, abandono real
// de 30 minutos e oferta adicional de 20%. Não depende de banco real — e, graças ao import de
// scripts/_sem-banco.mjs, o resultado não muda se quem roda tiver DATABASE_URL no ambiente.
import './scripts/_sem-banco.mjs';
import assert from 'node:assert/strict';
import { enrollmentClosesAt, isEnrollmentClosed, parseCourseImportCsv, resolveOffer } from './lib/courses.mjs';
import { buildManagedCatalog } from './lib/db.mjs';
import { fallbackCourses } from './src/catalog.js';
import { exigeCursoReal } from './scripts/_pendente.mjs';

exigeCursoReal(fallbackCourses);

function mockResponse() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  res.setHeader = () => {};
  return res;
}

async function run() {
  // P0.1 — preço/turma resolvidos no servidor a partir do catálogo, nunca do navegador.
  const someCourse = fallbackCourses.find((course) => !course.hiddenFromAgenda);
  const someDate = someCourse.dates[0];
  const offer = resolveOffer(someCourse.slug, someDate);
  assert.equal(offer.ok, true, 'resolveOffer deveria aceitar curso/turma reais do catálogo');
  assert.equal(offer.priceNumber, someCourse.variants?.[someDate]?.priceNumber ?? someCourse.priceNumber, 'preço autoritativo deve vir do catálogo');

  const badOffer = resolveOffer(someCourse.slug, 'data-inventada-por-um-atacante');
  assert.equal(badOffer.ok, false, 'turma inexistente deve ser rejeitada');
  assert.equal(badOffer.error, 'class_date_not_found');

  const badCourse = resolveOffer('curso-que-nao-existe', someDate);
  assert.equal(badCourse.ok, false, 'curso inexistente deve ser rejeitado');
  assert.equal(badCourse.error, 'course_not_found');
  console.log('OK  P0.1 — preço/turma autoritativos no servidor (lib/courses.mjs)');

  // P1.3 — matrícula fecha 1 dia antes da aula, não no dia da aula. Servidor recusa mesmo
  // que alguém acesse a URL de checkout direto após o prazo (não é só a agenda visual).
  const pastCourse = { ...someCourse, dates: ['10 de Janeiro de 2020'], variants: {} };
  assert.equal(isEnrollmentClosed(pastCourse, '10 de Janeiro de 2020'), true, 'turma com aula em data passada deve ter matrícula fechada');
  const futureCourse = { ...someCourse, dates: ['10 de Janeiro de 2099'], variants: {} };
  assert.equal(isEnrollmentClosed(futureCourse, '10 de Janeiro de 2099'), false, 'turma com aula em data futura deve ter matrícula aberta');
  const closesAt = enrollmentClosesAt(futureCourse, '10 de Janeiro de 2099');
  assert.equal(closesAt.getDate(), 9, 'matrícula deve fechar 1 dia antes do início da aula');
  console.log('OK  P1.3 — matrícula fecha 1 dia antes da aula (não no dia da aula)');

  // P0.3 — webhook Asaas deve falhar fechado sem segredo configurado.
  delete process.env.ASAAS_WEBHOOK_SECRET;
  const { default: asaasHandler } = await import('./api/webhooks/asaas.mjs');
  const resNoSecret = mockResponse();
  await asaasHandler({ method: 'POST', headers: {}, body: {} }, resNoSecret);
  assert.equal(resNoSecret.statusCode, 503, 'sem ASAAS_WEBHOOK_SECRET, webhook deve responder 503 (fail-closed)');

  process.env.ASAAS_WEBHOOK_SECRET = 'segredo-de-teste';
  const resWrongSecret = mockResponse();
  await asaasHandler({ method: 'POST', headers: { 'asaas-access-token': 'errado' }, body: {} }, resWrongSecret);
  assert.equal(resWrongSecret.statusCode, 401, 'segredo incorreto deve responder 401');
  delete process.env.ASAAS_WEBHOOK_SECRET;
  console.log('OK  P0.3 — webhook Asaas falha fechado sem segredo configurado');

  // P0.4 — webhook Voomp deve falhar fechado sem token, e o retorno visual nunca confirma pagamento.
  delete process.env.VOOMP_WEBHOOK_TOKEN;
  delete process.env.VOOMP_WEBHOOK_TOKEN;
  const { default: voompWebhookHandler } = await import('./api/webhooks/voomp.mjs');
  const resVoompNoToken = mockResponse();
  await voompWebhookHandler({ method: 'POST', headers: {}, query: {}, body: {} }, resVoompNoToken);
  assert.equal(resVoompNoToken.statusCode, 503, 'sem VOOMP_WEBHOOK_TOKEN, webhook deve responder 503 (fail-closed)');

  const returnSource = await (await import('node:fs/promises')).readFile('./api/voomp/return.mjs', 'utf8');
  assert.ok(!returnSource.includes('markVoompPaymentReturn'), '/api/voomp/return.mjs nunca pode chamar markVoompPaymentReturn (só o webhook autenticado confirma pagamento)');
  console.log('OK  P0.4 — webhook Voomp falha fechado e retorno visual nunca confirma pagamento');

  // P0.2 — portal/perfil do aluno exigem token; e-mail+CPF sozinhos não dão acesso nem editam cadastro.
  const { default: portalHandler } = await import('./api/student/portal.mjs');
  const resPortalNoToken = mockResponse();
  await portalHandler({ method: 'POST', headers: {}, body: { email: 'a@a.com', cpfLast4: '1234' } }, resPortalNoToken);
  assert.equal(resPortalNoToken.statusCode, 401, 'portal sem token deve responder 401, mesmo enviando email+cpf');

  const { default: profileHandler } = await import('./api/student/profile.mjs');
  const resProfileNoToken = mockResponse();
  await profileHandler({ method: 'POST', headers: {}, body: { email: 'a@a.com', cpfLast4: '1234', profile: { name: 'outro nome' } } }, resProfileNoToken);
  assert.equal(resProfileNoToken.statusCode, 401, 'edição de perfil sem token deve responder 401, mesmo enviando email+cpf');
  console.log('OK  P0.2 — portal e perfil do aluno exigem token assinado (sem fallback email+CPF)');

  // P1.1 — o navegador não dispara mais o WhatsApp de abandono na hora (só o cron faz isso).
  const trackingSource = await (await import('node:fs/promises')).readFile('./lib/tracking_events.mjs', 'utf8');
  assert.ok(!trackingSource.includes('notifyOfficialWhatsapp'), 'lib/tracking_events.mjs não pode mais notificar WhatsApp diretamente no evento cart_abandoned (só o cron, após 30min)');
  console.log('OK  P1.1 — evento cart_abandoned não dispara WhatsApp imediato (fica a cargo do cron)');

  // P1.2 — oferta adicional: elegibilidade e desconto vêm da tabela upsell_offers, nunca de
  // uma regra fixa. Sem banco configurado (como neste teste), nenhum par de cursos é elegível.
  const [primaryCourse, additionalCourse] = fallbackCourses.filter((c) => !c.hiddenFromAgenda && (c.flow || 'asaas') !== 'voomp');
  const { default: paymentsHandler } = await import('./api/payments.mjs');

  const resIneligible = mockResponse();
  await paymentsHandler({
    method: 'POST',
    headers: {},
    body: {
      courseSlug: primaryCourse.slug, classDate: primaryCourse.dates[0],
      additionalCourseSlug: primaryCourse.slug, additionalClassDate: primaryCourse.dates[0],
      studentName: 'Teste', studentEmail: 'teste@teste.com', studentWhatsapp: '11999999999', studentCpf: '11111111111', paymentMethod: 'pix',
    },
  }, resIneligible);
  assert.equal(resIneligible.statusCode, 400, 'curso adicional igual ao principal deve ser rejeitado');
  assert.equal(resIneligible.body.error, 'additional_course_not_eligible');

  const resNoUpsellRow = mockResponse();
  await paymentsHandler({
    method: 'POST',
    headers: {},
    body: {
      courseSlug: primaryCourse.slug, classDate: primaryCourse.dates[0],
      additionalCourseSlug: additionalCourse.slug, additionalClassDate: additionalCourse.dates[0],
      studentName: 'Teste', studentEmail: 'teste@teste.com', studentWhatsapp: '11999999999', studentCpf: '11111111111', paymentMethod: 'pix',
    },
  }, resNoUpsellRow);
  assert.equal(resNoUpsellRow.statusCode, 400, 'sem linha ativa em upsell_offers para o par de cursos, deve rejeitar (fail-safe, nunca permitir por padrão)');
  assert.equal(resNoUpsellRow.body.error, 'additional_course_not_eligible');
  console.log('OK  P1.2 — curso adicional exige linha ativa em upsell_offers (fail-safe sem cadastro)');

  // P1.4 — matrícula Voomp/Cabeleireiro: link oficial de pagamento enviado na hora do aceite
  // (api/acceptance.mjs) E reenviado pelo cron 30min depois para quem ainda não pagou, sem
  // duplicar envio (marcado via tracking_events).
  const { findPendingVoompAcceptances } = await import('./lib/db.mjs');
  // Atualizado em 11/09/2026. Este teste exigia supported:false sem DATABASE_URL — e com isso
  // travava um bug: em produção a a escola roda por Supabase REST, então a busca desistia e a
  // recuperação de venda nunca acontecia. A garantia que importa continua e é mais forte: SEM
  // BANCO NENHUM a busca tem que falhar alto, nunca devolver candidato inventado.
  await assert.rejects(() => findPendingVoompAcceptances(), (erro) => erro.code === 'database_not_configured',
    'sem banco nenhum, findPendingVoompAcceptances deve falhar alto em vez de inventar candidatos');

  const acceptanceSource = await (await import('node:fs/promises')).readFile('./api/acceptance.mjs', 'utf8');
  assert.ok(acceptanceSource.includes("notifyOfficialWhatsapp('voomp_acceptance_registered'"), 'api/acceptance.mjs deve continuar notificando o WhatsApp na hora do aceite, com o link oficial de pagamento');

  const recoverCartsSource = await (await import('node:fs/promises')).readFile('./api/cron/recover-carts.mjs', 'utf8');
  assert.ok(recoverCartsSource.includes('findPendingVoompAcceptances'), 'api/cron/recover-carts.mjs deve reenviar o link da Voomp para aceites pendentes há 30min');
  assert.ok(recoverCartsSource.includes('whatsapp_voomp_payment_reminder_sent'), 'o cron deve marcar o lembrete enviado via tracking_events para nunca reenviar em duplicidade');
  assert.ok(recoverCartsSource.includes('hasConflictingPaidEnrollment'), 'o cron deve reconferir se a matrícula já foi paga antes de reenviar o lembrete');
  console.log('OK  P1.4 — matrícula Voomp: link instantâneo no aceite + lembrete único 30min depois se não pago');

  // Extensão do P1.1 — especializações (Asaas): quem chega a gerar Pix/boleto mas não paga em
  // 30min recebe o mesmo cupom de 10% do carrinho abandonado (o evento cart_abandoned não
  // cobre esse caso, porque o formulário já foi enviado com sucesso).
  const { findPendingAsaasPayments } = await import('./lib/db.mjs');
  await assert.rejects(() => findPendingAsaasPayments(), (erro) => erro.code === 'database_not_configured',
    'sem banco nenhum, findPendingAsaasPayments deve falhar alto em vez de inventar candidatos');
  assert.ok(recoverCartsSource.includes('findPendingAsaasPayments'), 'api/cron/recover-carts.mjs deve reenviar o cupom de 10% para especializações com Pix/boleto pendente há 30min');
  assert.ok(recoverCartsSource.includes('whatsapp_payment_pending_coupon_sent'), 'o cron deve marcar o lembrete de especialização enviado via tracking_events para nunca reenviar em duplicidade');
  const dbSource = await (await import('node:fs/promises')).readFile('./lib/db.mjs', 'utf8');
  assert.ok(dbSource.includes("<> 'additional'"), 'o lembrete não deve considerar a matrícula adicional de uma oferta em par (evita duplicar envio para o mesmo checkout)');
  console.log('OK  P1.1b — especializações (Asaas): cupom de 10% único 30min depois se Pix/boleto não pago');

  // P1.6 — aluno/lead não pode duplicar: persistEnrollmentIntent/persistAcceptanceIntent
  // devem procurar um cadastro existente (email/whatsapp) em `students` antes de criar um novo.
  assert.ok(dbSource.includes('async function findOrCreateStudent'), 'lib/db.mjs deve ter uma função para reaproveitar o cadastro do aluno por email/whatsapp');
  assert.ok(dbSource.includes('await findOrCreateStudent({'), 'persistEnrollmentIntent/persistAcceptanceIntent devem usar findOrCreateStudent em vez de inserir um student novo direto');
  console.log('OK  P1.6 — matrícula reaproveita cadastro existente do aluno (email/whatsapp), evita duplicidade');

  // P1.9 — cópia fixa do que foi cobrado/combinado no aceite do Cabeleireiro: se os valores do
  // curso mudarem depois, o aceite antigo continua com o que foi mostrado a esse aluno.
  assert.ok(acceptanceSource.includes('contractSnapshot'), 'api/acceptance.mjs deve guardar uma cópia fixa (contractSnapshot) do valor/matrícula/saldo no momento do aceite');
  console.log('OK  P1.9 — aceite da matrícula guarda cópia fixa do valor/matrícula/saldo combinados');

  // P1.5 — pagamento no cartão nunca mais passa pelo nosso servidor: em vez de coletar
  // número/CVV no formulário, criamos um Asaas Checkout (página hospedada pela Asaas) e
  // redirecionamos a aluna pra lá. Pix e boleto continuam no checkout transparente de sempre.
  const paymentsSource = await (await import('node:fs/promises')).readFile('./api/payments.mjs', 'utf8');
  const asaasSource = await (await import('node:fs/promises')).readFile('./lib/asaas.mjs', 'utf8');
  assert.ok(!paymentsSource.includes('payload.card') && !paymentsSource.includes('cardHolder'), 'api/payments.mjs não deve mais aceitar/validar número de cartão, CVV ou dados do titular no corpo da requisição');
  assert.ok(paymentsSource.includes("paymentMethod === 'credit_card'") && paymentsSource.includes('createCheckoutSession'), 'pagamento no cartão deve ser roteado para createCheckoutSession (Asaas Checkout), não para /payments direto');
  assert.ok(asaasSource.includes('export async function createCheckoutSession'), 'lib/asaas.mjs deve expor createCheckoutSession');
  assert.ok(!asaasSource.includes('creditCardHolderInfo') && !asaasSource.includes('function cardPayload'), 'lib/asaas.mjs não deve mais montar payload de cartão (número/CVV) para enviar à Asaas');

  const { default: paymentsHandlerForCard } = await import('./api/payments.mjs');
  const resCard = mockResponse();
  await paymentsHandlerForCard({
    method: 'POST',
    headers: {},
    body: {
      courseSlug: primaryCourse.slug, classDate: primaryCourse.dates[0], paymentMethod: 'credit_card',
      studentName: 'Teste', studentEmail: 'teste@teste.com', studentWhatsapp: '11999999999', studentCpf: '11111111111',
    },
  }, resCard);
  assert.ok(!JSON.stringify(resCard.body).match(/"card"|cardNumber|creditCard/i), 'a resposta do checkout de cartão nunca deve ecoar dado de cartão de volta');
  console.log('OK  P1.5 — pagamento no cartão vai para o Asaas Checkout (hospedado), nunca digita cartão no site');

  // P1.3 (fuso horário) — o Manual do produto exige que as datas usem America/Sao_Paulo, nunca o
  // fuso do processo Node.js (Vercel roda em UTC) ou do navegador de quem acessa.
  const coursesSource = await (await import('node:fs/promises')).readFile('./lib/courses.mjs', 'utf8');
  // O cálculo de fuso do lado do cliente vivia em src/main.jsx e foi extraído para
  // src/lib/format.js na organização de arquivos pedida pela Erica (05/09/2026).
  const clientDateSource = await (await import('node:fs/promises')).readFile('./src/lib/format.js', 'utf8');
  assert.ok(coursesSource.includes("America/Sao_Paulo"), 'lib/courses.mjs deve calcular o fechamento da matrícula no fuso America/Sao_Paulo, não no fuso do servidor');
  assert.ok(clientDateSource.includes("America/Sao_Paulo"), 'src/lib/format.js deve calcular a agenda pública no fuso America/Sao_Paulo, não no fuso do navegador de quem acessa');
  console.log('OK  P1.3b — janela de matrícula usa o fuso oficial America/Sao_Paulo (servidor e agenda pública)');

  // §16.4 (Manual do produto, decisão de negócio 03/09/2026) — estorno/chargeback cancela o acesso
  // e libera a vaga na hora, tanto no webhook Asaas quanto no retorno Voomp. Testado por
  // inspeção de código (como P0.5/P1.6): a transição real de pago->estornado com liberação
  // atômica de vaga depende de Postgres real, fora do escopo deste smoke test sem banco.
  const finalDbSource = await (await import('node:fs/promises')).readFile('./lib/db.mjs', 'utf8');
  assert.ok(finalDbSource.includes('export async function releaseClassSeat'), 'lib/db.mjs deve expor releaseClassSeat (espelha reserveClassSeat) para devolver vaga em estorno/chargeback');
  assert.ok(finalDbSource.includes('function cancelledPaymentStatus'), 'lib/db.mjs deve reconhecer status de estorno/chargeback/cancelamento vindos do webhook');
  assert.ok(finalDbSource.includes('becameCancelled') && finalDbSource.includes('releaseClassSeat(enrollment.course_slug'), 'markVoompPaymentReturn deve liberar a vaga quando uma matrícula antes paga é cancelada/estornada');
  assert.ok(finalDbSource.includes("enrollmentStatus = 'cancelled_refunded'"), 'a matrícula deve mudar para um status claro de cancelada/estornada, distinto de pagamentos normais');
  console.log('OK  §16.4 — estorno/chargeback cancela a matrícula e libera a vaga automaticamente (Asaas e Voomp)');

  // §16.8 (Manual do produto, decisão de negócio 03/09/2026) — lista de espera real: quem entra na
  // fila é avisado automaticamente por WhatsApp assim que uma vaga abre, por ordem de chegada.
  assert.ok(finalDbSource.includes('export async function joinWaitlist'), 'lib/db.mjs deve expor joinWaitlist para o formulário público de lista de espera');
  assert.ok(finalDbSource.includes('async function notifyNextWaitlistEntry') && finalDbSource.includes('waitlistNotified = await notifyNextWaitlistEntry'), 'releaseClassSeat deve avisar automaticamente a próxima pessoa da fila ao liberar uma vaga');
  assert.ok(finalDbSource.includes("order by created_at asc") && finalDbSource.includes('for update skip locked'), 'o aviso de vaga deve respeitar ordem de chegada (FIFO) e evitar avisar a mesma pessoa duas vezes em corrida');
  const whatsappSource = await (await import('node:fs/promises')).readFile('./lib/whatsapp.mjs', 'utf8');
  assert.ok(whatsappSource.includes('export async function sendWaitlistSeatAvailable'), 'lib/whatsapp.mjs deve expor o envio do aviso de vaga aberta pra quem está na lista de espera');
  console.log('OK  §16.8 — lista de espera real com aviso automático por WhatsApp (ordem de chegada)');

  // Achado numa auditoria em 04/09/2026: o status padrão usado quando um webhook (Asaas ou
  // Voomp) não manda nenhum status reconhecível não pode, por coincidência de texto, bater
  // com o regex que paidStatus() (lib/db.mjs) usa pra reconhecer pagamento confirmado --
  // senão um webhook incompleto vira "matrícula confirmada" sem nenhuma confirmação real do
  // provedor. Já aconteceu duas vezes ('webhook_received' e 'sale_received', ambos contêm
  // "received"); este teste barra qualquer valor padrão que caia na mesma armadilha.
  const paidStatusRegex = /confirmed|confirmado|received|recebido|paid|pago|approved|aprovado/i;
  assert.ok(!finalDbSource.includes("'webhook_received'"), 'lib/db.mjs não pode voltar a usar "webhook_received" como status padrão do webhook Asaas (contém "received", que paidStatus() reconhece como pago)');
  assert.match(finalDbSource, /webhook_status_unknown/, 'lib/db.mjs deve usar um status padrão neutro quando o evento Asaas não é reconhecido');
  assert.ok(!paidStatusRegex.test('webhook_status_unknown'), 'o status padrão do webhook Asaas não pode, por coincidência, ser lido como pago');
  const voompWebhookSource = await (await import('node:fs/promises')).readFile('./api/webhooks/voomp.mjs', 'utf8');
  assert.ok(!voompWebhookSource.includes("'sale_received'"), 'api/webhooks/voomp.mjs não pode voltar a usar "sale_received" como status padrão (contém "received")');
  assert.match(voompWebhookSource, /sale_status_unknown/, 'api/webhooks/voomp.mjs deve usar um status padrão neutro quando a Voomp não manda nenhum status reconhecível');
  assert.ok(!paidStatusRegex.test('sale_status_unknown'), 'o status padrão do webhook Voomp não pode, por coincidência, ser lido como pago');
  console.log('OK  Auditoria 04/09 — status padrão de webhook incompleto nunca vira "pago" por acidente (Asaas e Voomp)');

  // Confirmado pela Erica em 04/09/2026: matrícula é sinônimo de pagamento. Quem nunca pagou
  // nenhum curso (só começou um checkout e abandonou) não pode entrar na Minha Área, mesmo
  // tendo um cadastro em students — e a Minha Área só pode mostrar como "sua matrícula" um
  // curso realmente pago, nunca o mais recente pra chegar independente de status.
  assert.ok(finalDbSource.includes('async function studentHasPaidEnrollment'), 'lib/db.mjs deve expor studentHasPaidEnrollment para barrar login de quem nunca pagou nada');
  assert.ok(finalDbSource.includes('if (!(await studentHasPaidEnrollment(student.id))) return { matched: false, sent: false };'), 'requestStudentAccessCode deve negar o código de acesso pra quem não tem nenhuma matrícula paga (mesma resposta de "não encontrado", sem abrir enumeração)');
  // StudentAreaPage foi extraída para src/pages/StudentAreaPage.jsx na organização de
  // arquivos pedida pela Erica (05/09/2026) — não mora mais em src/main.jsx.
  const studentAreaSource = await (await import('node:fs/promises')).readFile('./src/pages/StudentAreaPage.jsx', 'utf8');
  assert.ok(!studentAreaSource.includes("const activeEnrollment = portal.enrollments?.[0] || {};"), 'a Minha Área não pode voltar a escolher o curso atual pela matrícula mais recente (pode ser uma nunca paga) — precisa priorizar matrícula paga');
  assert.ok(studentAreaSource.includes('const paidEnrollments = (portal.enrollments || []).filter((enrollment) => enrollment.paid);'), 'a Minha Área deve separar matrículas pagas das pendentes antes de decidir o curso atual');
  // crmStageFromStatus foi extraído para src/lib/crm-helpers.js na organização de arquivos
  // pedida pela Erica (05/09/2026) — não mora mais em src/main.jsx.
  const crmHelpersSource = await (await import('node:fs/promises')).readFile('./src/lib/crm-helpers.js', 'utf8');
  assert.ok(crmHelpersSource.includes('voomp_sale_received|sale_status_unknown|webhook_status_unknown'), 'crmStageFromStatus deve barrar os marcadores internos de "venda registrada, ainda não paga" antes do regex genérico de pagamento confirmado (mesma armadilha do "received" já corrigida no servidor)');
  console.log('OK  Auditoria 04/09 — matrícula = pagamento: login exige matrícula paga e Minha Área nunca mostra curso não pago como "sua matrícula"');

  // Regressão real achada em 05/09/2026, um dia depois do fix acima: o código de acesso por
  // WhatsApp parou de funcionar pra Erica, que tinha mais de uma linha em students pro mesmo
  // email+CPF (cadastros duplicados de testes antigos). findStudentIdentityRow pegava só a
  // linha "order by created_at desc limit 1" — se a linha mais recente for um teste nunca
  // pago, o gate de studentHasPaidEnrollment bloqueava quem tinha pagado de verdade num
  // cadastro mais antigo com o mesmo email+CPF. A busca de identidade precisa considerar TODOS
  // os cadastros duplicados e escolher o que tem matrícula paga, não só o mais recente.
  assert.ok(finalDbSource.includes('async function findAllStudentIdentityRows'), 'lib/db.mjs deve expor findAllStudentIdentityRows para buscar todos os cadastros duplicados do mesmo email+CPF (a busca de identidade do login por código não pode mais trazer só a linha mais recente)');
  assert.ok(finalDbSource.includes('if (await studentHasPaidEnrollment(row.id)) return row;'), 'findStudentIdentityRow deve escolher, entre cadastros duplicados, o que tem matrícula paga — nunca só o mais recente por created_at');
  console.log('OK  Auditoria 05/09 — cadastro duplicado do mesmo email+CPF não pode mais bloquear o código de acesso de quem realmente pagou');

  // Pedido da Erica em 05/09/2026: cursos/turmas editáveis pelo painel (banco), sem depender
  // de deploy. getManagedCatalog() e a sincronização já existiam em lib/db.mjs, mas nada
  // nunca lia esse caminho — a agenda e o checkout sempre usavam só o arquivo estático. Dois
  // riscos aqui: (1) o catálogo do banco precisa produzir o MESMO formato que resolveOffer já
  // sabe interpretar, senão preço/turma quebra silenciosamente; (2) uma turma com preço
  // diferente do curso mas sem rótulo próprio (ex.: destrave 16/17 de novembro) não pode
  // perder esse preço ao ser lida de volta do banco.
  const managedCourseRows = [
    { slug: 'turma-generica', name: 'Turma Genérica', category: 'Base', status: 'active', metadata: { priceNumber: 1000, price: 'R$ 1.000,00', capacity: 18, promise: 'x', dates: ['ignorar'], reservedByDate: { ignorar: 1 } } },
  ];
  const managedClassRows = [
    { course_slug: 'turma-generica', class_date: '10 de Outubro de 2026', option_label: null, capacity: 18, reserved_count: 2, sold_count: 0, status: 'open', price_amount: 1000, metadata: {} },
    { course_slug: 'turma-generica', class_date: '15 de Novembro de 2026', option_label: null, capacity: 18, reserved_count: 0, status: 'open', price_amount: 850, metadata: {} },
    { course_slug: 'turma-generica', class_date: '01 de Dezembro de 2026', option_label: null, capacity: 18, reserved_count: 0, status: 'archived', price_amount: 1000, metadata: {} },
  ];
  const managedCatalog = buildManagedCatalog(managedCourseRows, managedClassRows);
  const managedCourse = managedCatalog[0];
  assert.deepEqual(managedCourse.dates, ['10 de Outubro de 2026', '15 de Novembro de 2026'], 'buildManagedCatalog deve listar as duas turmas ativas da linha em classes, sem incluir a arquivada');
  assert.equal(managedCourse.variants?.['15 de Novembro de 2026']?.priceNumber, 850, 'uma turma com preço diferente do curso (sem rótulo/option_label) não pode perder esse preço ao ser lida de volta do banco');
  assert.equal(managedCourse.variants?.['10 de Outubro de 2026'], undefined, 'uma turma cujo preço bate com o padrão do curso não precisa de entrada em variants');
  assert.ok(!managedCourse.dates.includes('01 de Dezembro de 2026'), '"excluir turma" no painel arquiva (status archived), e a turma arquivada não pode continuar aparecendo na agenda ao vivo');
  console.log('OK  Auditoria 05/09 — catálogo do banco (courses/classes) preserva preço de turma sem rótulo próprio e esconde turma arquivada');

  assert.ok(finalDbSource.includes('export async function upsertManagedCourse') && finalDbSource.includes('export async function upsertManagedClass') && finalDbSource.includes('export async function archiveManagedClass'), 'lib/db.mjs deve expor upsertManagedCourse/upsertManagedClass/archiveManagedClass pro painel criar/editar/arquivar curso e turma sem afetar as outras turmas do mesmo curso');
  console.log('OK  Auditoria 05/09 — painel adm tem escrita granular de curso/turma (aditiva, não substitui o catálogo inteiro)');

  // Importador de planilha (CSV, pedido da Erica em 05/09/2026): modelo fixo, sem IA — mais
  // confiável e sem custo por importação. Deve aceitar valor com "R$" e vírgula decimal
  // (formato que ela usa naturalmente numa planilha), preço em branco/inválido não pode virar
  // 0 silenciosamente (isso criaria uma turma de graça), e vírgula dentro de um campo entre
  // aspas (ex.: descrição de horário) não pode quebrar a linha em colunas erradas.
  const importCsv = [
    'curso_slug,curso_nome,categoria,data_turma,rotulo_turma,vagas,preco,carga_horaria,descricao_turma',
    'penteados-de-festa,Penteados de Festa,Base,14 de Outubro de 2026,,18,"R$ 1.200,00",,',
    'penteados-de-festa,,,20 de Novembro de 2026,Turma extra,20,1350.50,,"Segunda e terça, das 9h às 17h"',
    'curso-sem-preco,Curso Sem Preco,Base,10 de Dezembro de 2026,,18,,,',
  ].join('\n');
  const importResult = parseCourseImportCsv(importCsv);
  assert.equal(importResult.headerError, '', 'planilha com todas as colunas do modelo não pode dar erro de cabeçalho');
  assert.equal(importResult.rows.length, 3, 'parseCourseImportCsv deve interpretar uma linha por turma');
  assert.equal(importResult.rows[0].priceNumber, 1200, 'preço no formato "R$ 1.200,00" precisa virar o número 1200, não NaN nem 1.2');
  assert.equal(importResult.rows[1].description, 'Segunda e terça, das 9h às 17h', 'vírgula dentro de um campo entre aspas não pode quebrar a linha em colunas erradas');
  assert.equal(importResult.rows[2].valid, false, 'uma linha sem preço não pode ser válida — isso criaria uma turma de graça');
  const missingColumnsResult = parseCourseImportCsv('curso_slug,data_turma\nx,y');
  assert.equal(missingColumnsResult.headerError, 'missing_columns', 'planilha faltando uma coluna do modelo (ex.: preco) deve ser rejeitada antes de processar qualquer linha, não tratada como preço em branco');
  console.log('OK  Auditoria 05/09 — importador de planilha (CSV) interpreta preço/vírgulas corretamente e nunca aceita turma sem preço');

  assert.ok(finalDbSource.includes('export function buildManagedCatalog'), 'lib/db.mjs deve expor buildManagedCatalog (transformação pura, testável sem banco real) usada por getManagedCatalog');
  const finalCoursesSource = await (await import('node:fs/promises')).readFile('./lib/courses.mjs', 'utf8');
  assert.ok(finalCoursesSource.includes('export async function ensureLiveCourseCatalog'), 'lib/courses.mjs deve expor ensureLiveCourseCatalog para o catálogo do banco virar a fonte ao vivo de findCourse/resolveOffer');
  const finalPaymentsSource = await (await import('node:fs/promises')).readFile('./api/payments.mjs', 'utf8');
  assert.ok(finalPaymentsSource.includes('await ensureLiveCourseCatalog();') && finalPaymentsSource.indexOf('await ensureLiveCourseCatalog();') < finalPaymentsSource.indexOf('resolveOffer(payload.courseSlug'), 'api/payments.mjs deve atualizar o catálogo ao vivo antes de resolver preço/turma (P0.1 não pode cobrar com um catálogo desatualizado)');
  console.log('OK  Auditoria 05/09 — cursos/turmas do banco viram a fonte ao vivo de preço/turma no checkout (payments.mjs)');

  console.log('\nTodas as verificações P0/P1 passaram.');
}

run().catch((error) => {
  console.error('FALHOU:', error.message);
  process.exit(1);
});
