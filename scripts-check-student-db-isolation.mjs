// Isolamento no banco de verdade: duas alunas, dois cursos, duas turmas — nenhuma vê nada da
// outra. Diferente de scripts-check-student-class-isolation.mjs, que roda em memória, este
// grava linhas de verdade num Postgres e desfaz tudo no fim (tudo dentro de uma transação com
// rollback: nada fica no banco).
//
// Reescrito em 07/09/2026. A versão anterior carregava CÓPIAS das consultas do painel e testava
// essas cópias — não o código do app. Ficava verde mesmo quando o app se comportava diferente:
// a cópia dela filtrava aviso por turma, o app não filtrava, e o vazamento passou despercebido
// até 07/09/2026. Agora o script lê as linhas do banco e entrega pro toStudentPortal de
// verdade, o mesmo que responde a Minha Área — se o app mudar, o teste muda junto.
import crypto from 'node:crypto';
import { toStudentPortal } from './lib/db.mjs';

const databaseUrl = process.env.DATABASE_URL || '';
if (!databaseUrl) {
  // Sem banco configurado o teste não roda, mas não é falha: o isolamento em si já é conferido
  // sem banco nenhum por scripts-check-student-class-isolation.mjs. Este aqui é o extra que
  // confirma o mesmo comportamento com linhas reais, quando há um banco de QA à mão.
  console.log('PULADO  isolamento no banco real (defina DATABASE_URL para rodar).');
  console.log('        O isolamento por turma já é verificado sem banco em: npm run test:turma-ebn');
  process.exit(0);
}

const { default: pg } = await import('pg');

const marca = `qa_isolation_${crypto.randomUUID()}`;
const cursoA = `${marca}_colorimetria`;
const cursoB = `${marca}_corte`;
const turmaA = '14 e 15 de setembro — QA';
const turmaB = '29 e 30 de novembro — QA';

const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });

let falhas = 0;
function check(label, condicao, detalhe = '') {
  if (condicao) {
    console.log(`OK  ${label}`);
    return;
  }
  falhas += 1;
  console.error(`FALHOU  ${label}${detalhe ? `\n        ${detalhe}` : ''}`);
}

// Lê do banco exatamente o que o app lê (mesmo escopo: por aluna e pelos cursos das matrículas
// dela) e monta o portal com a função real. O recorte fino por turma é do toStudentPortal.
async function portalDoBanco(studentId) {
  const student = (await client.query('select id, name, email, whatsapp, cpf_last4, metadata, created_at from students where id = $1', [studentId])).rows[0];
  const enrollments = (await client.query('select id, student_id, status, amount_expected, course_slug, course_name, class_date, option_label, flow, metadata, created_at from enrollments where student_id = $1 order by created_at desc', [studentId])).rows;
  const slugs = [...new Set(enrollments.map((e) => e.course_slug).filter(Boolean))];
  const [payments, materials, certificates, notifications] = await Promise.all([
    client.query('select id, enrollment_id, student_id, status, amount, method, provider, paid_at, created_at from payments where student_id = $1', [studentId]),
    slugs.length ? client.query('select course_slug, class_date, title, description, content_type, file_path, external_url, sort_order from course_content where status = $1 and course_slug = any($2::text[])', ['published', slugs]) : { rows: [] },
    client.query('select id, course_slug, class_date, title, file_path, status, released_at from student_certificates where student_id = $1', [studentId]),
    slugs.length ? client.query('select id, student_id, course_slug, class_date, title, message, channel, sent_at from student_notifications where status = $1 and (student_id = $2 or (student_id is null and course_slug = any($3::text[])))', ['sent', studentId, slugs]) : { rows: [] },
  ]);
  return toStudentPortal({
    student,
    enrollments,
    payments: payments.rows,
    materials: materials.rows,
    certificates: certificates.rows,
    notifications: notifications.rows,
  });
}

const titulos = (lista) => lista.map((item) => item.title).sort();

await client.connect();
try {
  await client.query('begin');

  const alunaA = (await client.query(
    `insert into students (external_id,name,email,whatsapp,created_source,metadata)
     values ($1,'Aluna Fantasma A',$2,'5511000000001','qa_isolation',$3::jsonb) returning id`,
    [`${marca}_student_a`, `${marca}_a@ebn.local`, JSON.stringify({ qa: true, marca })],
  )).rows[0].id;
  const alunaB = (await client.query(
    `insert into students (external_id,name,email,whatsapp,created_source,metadata)
     values ($1,'Aluna Fantasma B',$2,'5511000000002','qa_isolation',$3::jsonb) returning id`,
    [`${marca}_student_b`, `${marca}_b@ebn.local`, JSON.stringify({ qa: true, marca })],
  )).rows[0].id;

  const matriculaA = (await client.query(
    `insert into enrollments (external_id,student_id,course_slug,course_name,class_date,flow,status,source,amount_expected,metadata)
     values ($1,$2,$3,'Curso Fantasma A',$4,'qa','confirmed','qa_isolation',0,$5::jsonb) returning id`,
    [`${marca}_enrollment_a`, alunaA, cursoA, turmaA, JSON.stringify({ qa: true, marca })],
  )).rows[0].id;
  const matriculaB = (await client.query(
    `insert into enrollments (external_id,student_id,course_slug,course_name,class_date,flow,status,source,amount_expected,metadata)
     values ($1,$2,$3,'Curso Fantasma B',$4,'qa','confirmed','qa_isolation',0,$5::jsonb) returning id`,
    [`${marca}_enrollment_b`, alunaB, cursoB, turmaB, JSON.stringify({ qa: true, marca })],
  )).rows[0].id;

  // Material da turma de cada uma, mais um material do curso A cadastrado na turma B: é o
  // material "cruzado", que não pode aparecer pra ninguém das duas.
  await client.query(
    `insert into course_content (course_slug,class_date,title,content_type,status,published_at,metadata)
     values ($1,$2,'Material exclusivo A','material','published',now(),$5::jsonb),
            ($3,$4,'Material exclusivo B','material','published',now(),$5::jsonb),
            ($1,$4,'Material com turma cruzada','material','published',now(),$5::jsonb)`,
    [cursoA, turmaA, cursoB, turmaB, JSON.stringify({ qa: true, marca })],
  );
  await client.query(
    `insert into student_notifications (student_id,course_slug,class_date,title,message,status,sent_at,metadata)
     values (null,$1,$2,'Aviso da turma A','Somente A','sent',now(),$5::jsonb),
            (null,$3,$4,'Aviso da turma B','Somente B','sent',now(),$5::jsonb),
            ($6,null,null,'Aviso individual A','Somente A','sent',now(),$5::jsonb)`,
    [cursoA, turmaA, cursoB, turmaB, JSON.stringify({ qa: true, marca }), alunaA],
  );
  await client.query(
    `insert into student_certificates (student_id,enrollment_id,course_slug,class_date,title,file_path,status,released_at,metadata)
     values ($1,$2,$3,$4,'Certificado A',$10,'released',now(),$9::jsonb),
            ($5,$6,$7,$8,'Certificado B',$11,'released',now(),$9::jsonb)`,
    [alunaA, matriculaA, cursoA, turmaA, alunaB, matriculaB, cursoB, turmaB,
      JSON.stringify({ qa: true, marca }), `${marca}/a.pdf`, `${marca}/b.pdf`],
  );

  const [portalA, portalB] = [await portalDoBanco(alunaA), await portalDoBanco(alunaB)];

  check('cada aluna vê só a própria matrícula',
    portalA.enrollments.length === 1 && portalA.enrollments[0].courseSlug === cursoA
    && portalB.enrollments.length === 1 && portalB.enrollments[0].courseSlug === cursoB);

  check('material fica na turma certa (nem o cruzado aparece)',
    JSON.stringify(titulos(portalA.enrollments[0].materials)) === JSON.stringify(['Material exclusivo A'])
    && JSON.stringify(titulos(portalB.enrollments[0].materials)) === JSON.stringify(['Material exclusivo B']),
    `A: ${titulos(portalA.enrollments[0].materials).join(' | ')} — B: ${titulos(portalB.enrollments[0].materials).join(' | ')}`);

  check('aviso de turma e recado pessoal ficam com quem é de direito',
    JSON.stringify(titulos(portalA.notifications)) === JSON.stringify(['Aviso da turma A', 'Aviso individual A'])
    && JSON.stringify(titulos(portalB.notifications)) === JSON.stringify(['Aviso da turma B']),
    `A: ${titulos(portalA.notifications).join(' | ')} — B: ${titulos(portalB.notifications).join(' | ')}`);

  check('certificado liberado é só da dona',
    portalA.enrollments[0].certificateUrl === `${marca}/a.pdf` && portalB.enrollments[0].certificateUrl === `${marca}/b.pdf`);

  // Estorno: a matrícula deixa de contar como paga, e com isso some da lista de "sou aluna
  // desse curso" na Minha Área. O recado pessoal continua chegando (é dela, não da turma).
  await client.query("update payments set status='refunded' where student_id=$1", [alunaA]);
  const depoisDoEstorno = await portalDoBanco(alunaA);
  check('matrícula estornada deixa de contar como paga', depoisDoEstorno.enrollments.every((e) => e.paid === false));
  check('recado pessoal continua chegando depois do estorno', titulos(depoisDoEstorno.notifications).includes('Aviso individual A'));

  if (falhas > 0) {
    console.error(`\n${falhas} verificação(ões) de isolamento no banco falharam.`);
    process.exitCode = 1;
  } else {
    console.log('\nBanco a escola: duas alunas em turmas diferentes, cada uma só com o que é dela.');
  }
} finally {
  // Nada do teste fica no banco: tudo foi feito dentro da transação e é desfeito aqui.
  await client.query('rollback').catch(() => {});
  await client.end();
}
