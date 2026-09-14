// Turma a escola: o que a aluna vê na Minha Área é só da turma dela.
//
// A versão antiga deste script lia api/_student_access.mjs, arquivo que sumiu numa
// reorganização pra lib/, e procurava trechos de SQL no fonte. Estourava antes da primeira
// verificação e passou meses sem proteger nada. Reescrito em 07/09/2026 pra montar o portal de
// verdade e conferir o que sai dele — e foi assim que apareceu o vazamento de aviso de turma
// que está travado no item 3.
import { toStudentPortal } from './lib/db.mjs';

let falhas = 0;
function check(label, condicao, detalhe = '') {
  if (condicao) {
    console.log(`OK  ${label}`);
    return;
  }
  falhas += 1;
  console.error(`FALHOU  ${label}${detalhe ? `\n        ${detalhe}` : ''}`);
}

const aluna = { id: 'aluna-1', name: 'Aluna a escola', email: 'aluna@ebn.com', created_at: '2026-01-01T00:00:00Z', metadata: {} };

// A aluna é da turma de SÁBADO de corte. Tudo que for da turma de TERÇA (mesmo curso) ou de
// outro curso qualquer é conteúdo que ela não pode ver.
const enrollments = [
  { id: 'mat-1', student_id: 'aluna-1', course_slug: 'corte', course_name: 'Corte', class_date: '12 de setembro de 2026', status: 'confirmado', metadata: {} },
];
const payments = [{ enrollment_id: 'mat-1', student_id: 'aluna-1', status: 'confirmed', created_at: '2026-02-01T00:00:00Z' }];

const materials = [
  { course_slug: 'corte', class_date: '12 de setembro de 2026', title: 'Apostila da turma de sábado', content_type: 'pdf', external_url: '', sort_order: 1 },
  { course_slug: 'corte', class_date: null, title: 'Manual geral do curso de corte', content_type: 'pdf', external_url: '', sort_order: 2 },
  { course_slug: 'corte', class_date: '03 de novembro de 2026', title: 'Apostila da turma de terça', content_type: 'pdf', external_url: '', sort_order: 3 },
  { course_slug: 'colorimetria', class_date: null, title: 'Material de outro curso', content_type: 'pdf', external_url: '', sort_order: 4 },
];

const notifications = [
  { id: 'av-1', student_id: null, course_slug: 'corte', class_date: '12 de setembro de 2026', title: 'Sua turma de sábado mudou de sala', message: '...', sent_at: '2026-09-01T10:00:00Z' },
  { id: 'av-2', student_id: null, course_slug: 'corte', class_date: null, title: 'Aviso geral do curso de corte', message: '...', sent_at: '2026-09-01T10:00:00Z' },
  { id: 'av-3', student_id: null, course_slug: 'corte', class_date: '03 de novembro de 2026', title: 'A turma de terça foi remarcada', message: '...', sent_at: '2026-09-01T10:00:00Z' },
  { id: 'av-4', student_id: 'aluna-1', course_slug: null, class_date: null, title: 'Recado pessoal pra você', message: '...', sent_at: '2026-09-01T10:00:00Z' },
];

const certificates = [
  { course_slug: 'corte', class_date: '03 de novembro de 2026', title: 'Certificado da turma de terça', file_path: '/certificados/terca.pdf', status: 'released', released_at: '2026-11-10T00:00:00Z' },
];

const portal = toStudentPortal({ student: aluna, enrollments, payments, materials, notifications, certificates });
const matricula = portal.enrollments[0];
const titulosMaterial = matricula.materials.map((m) => m.title);
const titulosAviso = portal.notifications.map((n) => n.title);

// 1. Material da turma dela e material geral do curso: aparecem.
check('material da própria turma aparece', titulosMaterial.includes('Apostila da turma de sábado'));
check('material geral do curso aparece', titulosMaterial.includes('Manual geral do curso de corte'));

// 2. Material de OUTRA turma do mesmo curso, e de outro curso: não podem aparecer.
check('material de outra turma do mesmo curso não vaza', !titulosMaterial.includes('Apostila da turma de terça'), `veio: ${titulosMaterial.join(' | ')}`);
check('material de outro curso não vaza', !titulosMaterial.includes('Material de outro curso'), `veio: ${titulosMaterial.join(' | ')}`);

// 3. REGRESSÃO (07/09/2026): avisos não eram filtrados por turma, só materiais e certificados.
// Um recado da turma de sábado chegava também na aluna da turma de terça do mesmo curso —
// informação errada na mão da aluna errada.
check('aviso da própria turma aparece', titulosAviso.includes('Sua turma de sábado mudou de sala'));
check('aviso geral do curso aparece', titulosAviso.includes('Aviso geral do curso de corte'));
check('aviso pessoal aparece', titulosAviso.includes('Recado pessoal pra você'));
check('aviso de outra turma do mesmo curso não vaza', !titulosAviso.includes('A turma de terça foi remarcada'), `veio: ${titulosAviso.join(' | ')}`);

// 4. Certificado emitido pra OUTRA turma não pode virar o certificado dela.
check('certificado de outra turma não vira o dela', matricula.certificateStatus !== 'Disponível' && !matricula.certificateUrl, `status: ${matricula.certificateStatus} / url: ${matricula.certificateUrl}`);

// 5. O portal responde só com as matrículas da própria aluna.
check('portal traz só a matrícula da aluna', portal.enrollments.length === 1 && portal.enrollments[0].id === 'mat-1');

// 6. Matrícula cancelada/estornada nunca conta como paga (a Minha Área trata "paga" como
// "é aluna do curso": vaga, selo, desconto e check-in dependem disso).
for (const status of ['refunded', 'chargeback', 'canceled', 'pending', 'overdue']) {
  const semPagamento = toStudentPortal({
    student: aluna,
    enrollments,
    payments: [{ enrollment_id: 'mat-1', student_id: 'aluna-1', status, created_at: '2026-02-01T00:00:00Z' }],
    materials: [],
    notifications: [],
    certificates: [],
  });
  check(`pagamento "${status}" não conta como matrícula paga`, semPagamento.enrollments[0].paid === false);
}

// 7. Check-in acompanha o pagamento (revisto em 08/09/2026).
//
// Antes existia um "liberar check-in" no painel, e este teste travava esse fluxo. Só que a
// listagem do painel já mostrava "Liberado" pra toda matrícula paga sem olhar nada gravado:
// clicar no botão não mudava nada na tela e parecia quebrado. A regra agora é uma só — o
// código de entrada existe porque a matrícula está paga — e quem confirma a presença na porta
// é confirmStudentCheckIn, que reconfere o pagamento no servidor antes de aceitar o código.
check('matrícula paga já nasce com código de entrada', matricula.canCheckIn === true);
check('o código de entrada vem preenchido e não expõe o id da matrícula',
  Boolean(matricula.checkInCode) && !matricula.checkInCode.toLowerCase().includes('mat-1'),
  matricula.checkInCode);
check('presença só aparece confirmada depois que a equipe confirma', matricula.checkInConfirmed === false);

const semPagar = toStudentPortal({
  student: aluna,
  enrollments,
  payments: [{ enrollment_id: 'mat-1', student_id: 'aluna-1', status: 'pending', created_at: '2026-02-01T00:00:00Z' }],
  materials: [], notifications: [], certificates: [],
});
check('matrícula sem pagamento não tem check-in liberado', semPagar.enrollments[0].canCheckIn === false);
// Um "checkInReleased: true" perdido no metadata (sobra do botão antigo) não pode reabrir o
// check-in de quem não pagou.
const releaseVelho = toStudentPortal({
  student: aluna,
  enrollments: [{ ...enrollments[0], metadata: { studentPortal: { checkInReleased: true } } }],
  payments: [{ enrollment_id: 'mat-1', student_id: 'aluna-1', status: 'pending', created_at: '2026-02-01T00:00:00Z' }],
  materials: [], notifications: [], certificates: [],
});
check('liberação antiga guardada no metadata não fura a regra do pagamento', releaseVelho.enrollments[0].canCheckIn === false);

const jaConfirmada = toStudentPortal({
  student: aluna,
  enrollments: [{ ...enrollments[0], metadata: { studentPortal: { checkInConfirmed: true, checkInConfirmedAt: '2026-03-10T13:00:00Z' } } }],
  payments, materials: [], notifications: [], certificates: [],
});
check('presença confirmada chega na área da aluna', jaConfirmada.enrollments[0].checkInConfirmed === true && Boolean(jaConfirmada.enrollments[0].checkInConfirmedAt));

// 8. O CPF completo nunca sai do servidor — só os 4 últimos dígitos.
const comCpf = toStudentPortal({ student: { ...aluna, cpf_last4: '4864', cpf_hash: 'hash-secreto' }, enrollments, payments, materials: [], notifications: [], certificates: [] });
const serializado = JSON.stringify(comCpf);
check('portal expõe só os 4 últimos dígitos do CPF', comCpf.student.cpfLast4 === '4864' && !serializado.includes('hash-secreto'));

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) de isolamento falharam.`);
  process.exit(1);
}
console.log('\nTurma a escola: material, aviso e certificado ficam na turma certa.');
