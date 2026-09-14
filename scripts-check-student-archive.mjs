// Tirar cadastro de aluna do painel (pedido da Erica, 09/09/2026).
//
// São duas coisas com riscos muito diferentes, e este script trava a fronteira entre elas:
//
//   ARQUIVAR  — reversível. A aluna some do painel inteiro (lista, contagens, CRM e
//               faturamento), mas nenhuma linha é apagada.
//   EXCLUIR   — irreversível. Só pode passar quando não há NADA preso no cadastro. Cadastro
//               com matrícula ou pagamento tem que ser RECUSADO pelo servidor, senão o
//               histórico de quem pagou vai junto e não volta.
//
// Roda com banco (DATABASE_URL) porque é onde a regra vive; sem banco, confere ao menos a
// parte que não depende dele.
//
// Ao contrário dos outros scripts que usam banco, este NÃO roda dentro de uma transação com
// rollback: as funções testadas abrem a própria conexão (o pool de lib/db.mjs), e não
// enxergariam linhas presas numa transação de outra conexão. Então os cadastros de teste são
// gravados de verdade e apagados no fim pelo marcador 'qa_archive' — inclusive se o script
// falhar no meio. Use um banco de QA, nunca o de produção.
import crypto from 'node:crypto';
import { hideArchivedStudents, studentIsArchived } from './lib/db.mjs';

let falhas = 0;
function check(label, condicao, detalhe = '') {
  if (condicao) {
    console.log(`OK  ${label}`);
    return;
  }
  falhas += 1;
  console.error(`FALHOU  ${label}${detalhe ? `\n        ${detalhe}` : ''}`);
}

// --- Parte sem banco: a leitura da marca de arquivada -------------------------------------
check('aluna sem metadata não é arquivada', studentIsArchived({}) === false);
check('aluna com metadata vazio não é arquivada', studentIsArchived({ metadata: {} }) === false);
check('archived: true marca como arquivada', studentIsArchived({ metadata: { archived: true } }) === true);
// Só o booleano verdadeiro conta: um "false", uma string ou um resto de campo antigo não pode
// sumir com ninguém do painel por acidente.
check('archived: false não arquiva', studentIsArchived({ metadata: { archived: false } }) === false);
check('archived como texto não arquiva', studentIsArchived({ metadata: { archived: 'sim' } }) === false);

// --- Sem banco: aluna arquivada tem que sumir do painel INTEIRO ----------------------------
// A parte fácil de errar é esquecer um array e a aluna sumir da lista mas continuar contando
// no faturamento. Aqui a conferência é sobre todos eles de uma vez.
const painel = hideArchivedStudents({
  students: [
    { id: 'a1', name: 'Aluna Real', metadata: {} },
    { id: 'a2', name: 'Cadastro de Teste', metadata: { archived: true } },
  ],
  enrollments: [{ id: 'm1', student_id: 'a1' }, { id: 'm2', student_id: 'a2' }],
  payments: [{ id: 'p1', student_id: 'a1', amount: 1962.9 }, { id: 'p2', student_id: 'a2', amount: 999 }],
  carts: [{ id: 'c1', student_id: 'a2' }],
  acceptances: [{ id: 'ac1', student_id: 'a2' }],
  trackingEvents: [{ id: 't1', student_id: 'a2' }],
});
check('aluna arquivada sai da lista de alunas', painel.students.length === 1 && painel.students[0].id === 'a1');
check('a arquivada aparece na lista de arquivadas, pra poder voltar', painel.archivedStudents.length === 1 && painel.archivedStudents[0].id === 'a2');
check('a matrícula da arquivada sai junto', painel.enrollments.length === 1 && painel.enrollments[0].student_id === 'a1');
check('o pagamento da arquivada sai junto (senão a receita continuaria somando teste)', painel.payments.length === 1 && painel.payments[0].student_id === 'a1');
check('carrinho, aceite e evento da arquivada saem junto',
  painel.carts.length === 0 && painel.acceptances.length === 0 && painel.trackingEvents.length === 0,
  `carrinhos ${painel.carts.length}, aceites ${painel.acceptances.length}, eventos ${painel.trackingEvents.length}`);

const databaseUrl = process.env.DATABASE_URL || '';
if (!databaseUrl) {
  console.log('\nPULADO  as regras de arquivar/excluir no banco (defina DATABASE_URL para rodar).');
  if (falhas > 0) process.exit(1);
  process.exit(0);
}

const { deleteStudentIfEmpty, setStudentArchived, adminSummary } = await import('./lib/db.mjs');
const { default: pg } = await import('pg');
const marca = `qa_archive_${crypto.randomUUID()}`;
const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const novaAluna = async (nome, email) => (await client.query(
  `insert into students (external_id, name, email, whatsapp, created_source, metadata)
   values ($1, $2, $3, '5511000000000', 'qa_archive', '{}'::jsonb) returning id`,
  [`${marca}_${nome}`, nome, email],
)).rows[0].id;

async function limpaVestigios() {
  const ids = (await client.query("select id from students where created_source = 'qa_archive' and external_id like $1", [`${marca}%`])).rows.map((r) => r.id);
  if (!ids.length) return;
  for (const tabela of ['payments', 'enrollments', 'tracking_events', 'student_access', 'student_notifications', 'student_certificates', 'acceptances', 'carts', 'course_reviews']) {
    await client.query(`delete from ${tabela} where student_id = any($1::uuid[])`, [ids]).catch(() => {});
  }
  await client.query('delete from students where id = any($1::uuid[])', [ids]).catch(() => {});
}

try {
  const vazia = await novaAluna('Cadastro Vazio', `${marca}_vazia@ebn.local`);
  const comMatricula = await novaAluna('Com Matricula', `${marca}_mat@ebn.local`);
  const comPagamento = await novaAluna('Com Pagamento', `${marca}_pago@ebn.local`);

  const matricula = (await client.query(
    `insert into enrollments (external_id, student_id, course_slug, course_name, class_date, status)
     values ($1, $2, 'destrave', 'Destrave', '10 e 11 de Outubro', 'confirmed') returning id`,
    [`${marca}_e1`, comMatricula],
  )).rows[0].id;
  const matriculaPaga = (await client.query(
    `insert into enrollments (external_id, student_id, course_slug, course_name, class_date, status)
     values ($1, $2, 'destrave', 'Destrave', '10 e 11 de Outubro', 'confirmed') returning id`,
    [`${marca}_e2`, comPagamento],
  )).rows[0].id;
  await client.query(
    `insert into payments (external_id, enrollment_id, student_id, status, amount, metadata)
     values ($1, $2, $3, 'confirmed', 1962.90, '{}'::jsonb)`,
    [`${marca}_p1`, matriculaPaga, comPagamento],
  );
  // Sobra desimportante: existe só por causa do acesso/analytics e não é histórico de ninguém.
  // Não pode impedir a exclusão de um cadastro que, fora isso, está vazio.
  await client.query("insert into tracking_events (event_name, student_id, payload) values ('qa_ruido', $1, '{}'::jsonb)", [vazia]);

  // --- Excluir: só o cadastro vazio passa --------------------------------------------------
  const recusa = async (studentId) => {
    try {
      await deleteStudentIfEmpty({ studentId }, {});
      return null;
    } catch (error) {
      return error;
    }
  };

  const erroMatricula = await recusa(comMatricula);
  check('cadastro com matrícula NÃO é excluído', erroMatricula?.code === 'student_has_history', erroMatricula ? `veio outro erro: ${erroMatricula.code || erroMatricula.message}` : 'EXCLUIU — isso levaria o histórico junto');
  check('a recusa diz o que está preso no cadastro', /matrícula/i.test(erroMatricula?.detalhe || ''), erroMatricula?.detalhe || '');

  const erroPagamento = await recusa(comPagamento);
  check('cadastro com pagamento NÃO é excluído', erroPagamento?.code === 'student_has_history', erroPagamento ? `veio outro erro: ${erroPagamento.code || erroPagamento.message}` : 'EXCLUIU — isso levaria o histórico junto');
  check('a recusa cita o pagamento', /pagamento/i.test(erroPagamento?.detalhe || ''), erroPagamento?.detalhe || '');

  const aindaExistem = (await client.query('select count(*)::int as total from students where id = any($1::uuid[])', [[comMatricula, comPagamento]])).rows[0].total;
  check('nada foi apagado nas tentativas recusadas', aindaExistem === 2, `${aindaExistem} de 2 ainda no banco`);
  const matriculasIntactas = (await client.query('select count(*)::int as total from enrollments where id = any($1::uuid[])', [[matricula, matriculaPaga]])).rows[0].total;
  check('as matrículas continuam intactas', matriculasIntactas === 2);

  const apagada = await deleteStudentIfEmpty({ studentId: vazia }, { actor: { username: 'qa' } });
  check('cadastro sem nada preso é excluído', apagada.deleted === true);
  const sumiu = (await client.query('select count(*)::int as total from students where id = $1', [vazia])).rows[0].total;
  check('o cadastro vazio realmente saiu do banco', sumiu === 0);
  const ruido = (await client.query('select count(*)::int as total from tracking_events where student_id = $1', [vazia])).rows[0].total;
  check('a sobra de analytics saiu junto, sem deixar linha órfã', ruido === 0);

  // Excluir de novo o que já sumiu tem que falhar limpo, sem quebrar a tela.
  const denovo = await recusa(vazia);
  check('excluir duas vezes falha sem estourar', denovo?.code === 'student_not_found', `veio: ${denovo?.code || denovo?.message || 'nenhum erro'}`);

  // --- Arquivar: reversível, e some do painel ---------------------------------------------
  await setStudentArchived({ studentId: comPagamento }, { actor: { username: 'qa' }, receivedAt: new Date().toISOString() });
  const marcada = (await client.query('select metadata from students where id = $1', [comPagamento])).rows[0].metadata;
  check('arquivar marca a aluna, sem apagar nada', marcada.archived === true && Boolean(marcada.archivedAt));
  const pagamentoIntacto = (await client.query('select count(*)::int as total from payments where student_id = $1', [comPagamento])).rows[0].total;
  check('arquivar NÃO toca no pagamento', pagamentoIntacto === 1);

  await setStudentArchived({ studentId: comPagamento, archived: false }, { actor: { username: 'qa' } });
  const desmarcada = (await client.query('select metadata from students where id = $1', [comPagamento])).rows[0].metadata;
  check('desarquivar traz a aluna de volta', desmarcada.archived === false);

  if (falhas > 0) {
    console.error(`\n${falhas} verificação(ões) de arquivar/excluir falharam.`);
    process.exitCode = 1;
  } else {
    console.log('\nCadastro de aluna: arquivar é reversível, e excluir só passa quando não há histórico pra levar junto.');
  }
} finally {
  // Nada do teste fica no banco, mesmo se ele falhar no meio.
  await limpaVestigios().catch((error) => console.error('nao consegui limpar os vestigios do teste:', error.message));
  await client.end();
  const { closePgPool } = await import('./lib/db.mjs').catch(() => ({}));
  if (typeof closePgPool === 'function') await closePgPool().catch(() => {});
}
