// Check-in da aula por código (pedido da Erica, 08/09/2026).
//
// O problema que deu origem a isto: o painel tinha um botão "liberar check-in" que não mudava
// nada na tela — a coluna já dizia "Liberado" pra toda matrícula paga, sem olhar nada gravado.
// E o "QR code" da área da aluna era desenho de CSS, não codificava nada.
//
// Agora a regra é uma só e mora no servidor: o código pertence à matrícula, e a presença só é
// confirmada se a matrícula existir, for daquela turma e estiver PAGA. Este script trava isso
// sem banco nenhum: exercita as funções de verdade (lib/checkin.mjs e as regras de pagamento
// e de montagem da listagem do painel), não cópias delas.
import { checkInCodeFor, checkInCodeMatches, findEnrollmentByCheckInCode, normalizeCheckInCode } from './lib/checkin.mjs';
import { enrollmentIsPaid } from './lib/db.mjs';
import { buildStudentPortalRows } from './src/lib/crm-helpers.js';

let falhas = 0;
function check(label, condicao, detalhe = '') {
  if (condicao) {
    console.log(`OK  ${label}`);
    return;
  }
  falhas += 1;
  console.error(`FALHOU  ${label}${detalhe ? `\n        ${detalhe}` : ''}`);
}

// --- 1. O código pertence à matrícula ------------------------------------------------------
const matriculaA = '9c1f7a20-1111-4bbb-8ccc-000000000001';
const matriculaB = '9c1f7a20-1111-4bbb-8ccc-000000000002';
const codigoA = checkInCodeFor(matriculaA);
const codigoB = checkInCodeFor(matriculaB);

check('a mesma matrícula gera sempre o mesmo código', codigoA === checkInCodeFor(matriculaA), codigoA);
check('matrículas diferentes geram códigos diferentes', codigoA !== codigoB, `${codigoA} vs ${codigoB}`);
check('o código não expõe o id da matrícula', !codigoA.toLowerCase().includes(matriculaA.slice(0, 8)), codigoA);
check('o código tem 6 caracteres úteis', normalizeCheckInCode(codigoA).length === 6, codigoA);
// Zero, um, i, o e u ficam de fora do alfabeto: quem lê o código em voz alta na recepção não
// erra entre 0 e O nem entre 1 e I.
check('o código não usa caracteres que se confundem lidos em voz alta', !/[01IOU]/.test(normalizeCheckInCode(codigoA)), codigoA);

// --- 2. Como a recepção digita ------------------------------------------------------------
check('aceita o código digitado sem traço e em minúsculo', checkInCodeMatches(matriculaA, codigoA.replace(/-/g, '').toLowerCase()));
check('aceita o código digitado sem o prefixo a escola', checkInCodeMatches(matriculaA, codigoA.slice(4)));
check('aceita o código digitado com espaços', checkInCodeMatches(matriculaA, ` ${codigoA} `));

// --- 3. O que NUNCA pode passar -----------------------------------------------------------
// Este é o coração do pedido: "a liberação só fica ativa se ele é aluno mesmo do curso".
check('o código de uma aluna não confirma a presença de outra', checkInCodeMatches(matriculaB, codigoA) === false);
check('código incompleto não bate com ninguém', findEnrollmentByCheckInCode([{ id: matriculaA }, { id: matriculaB }], codigoA.slice(0, 6)) === null);
check('código vazio não bate com ninguém', findEnrollmentByCheckInCode([{ id: matriculaA }], '') === null);
// Uma letra trocada tem que falhar seco, e não cair na matrícula "mais parecida".
const trocado = codigoA.slice(0, -1) + (codigoA.endsWith('Z') ? '2' : 'Z');
check('uma letra trocada não confirma ninguém', findEnrollmentByCheckInCode([{ id: matriculaA }, { id: matriculaB }], trocado) === null, `${codigoA} -> ${trocado}`);
check('a busca reversa acha a matrícula dona do código', findEnrollmentByCheckInCode([{ id: matriculaB }, { id: matriculaA }], codigoA)?.id === matriculaA);

// --- 4. Pagamento: quem manda no check-in --------------------------------------------------
check('sem pagamento nenhum, a matrícula não está paga', enrollmentIsPaid([]) === false);
check('pagamento pendente não conta como paga', enrollmentIsPaid([{ status: 'pending' }]) === false);
check('pagamento confirmado conta como paga', enrollmentIsPaid([{ status: 'confirmed' }]) === true);
check('pagamento recebido conta como paga', enrollmentIsPaid([{ status: 'received' }]) === true);
// §16.4 do Manual do produto: estorno cancela o acesso. Sem isto, quem pediu o dinheiro de volta
// entrava na aula com o código antigo, que continua sendo o mesmo pra sempre.
check('estorno derruba o check-in mesmo com pagamento confirmado antes', enrollmentIsPaid([{ status: 'confirmed' }, { status: 'refunded' }]) === false);
check('chargeback derruba o check-in', enrollmentIsPaid([{ status: 'received' }, { status: 'chargeback' }]) === false);

// --- 5. A listagem do painel diz a verdade -------------------------------------------------
// O bug original: a coluna mostrava "Liberado" pra toda matrícula paga, sem olhar nada gravado.
// Clicar em "liberar check-in" não mudava a tela, e por isso parecia que o botão não funcionava.
const vendas = [
  { enrollmentId: matriculaA, studentId: 's1', name: 'Aluna Paga', email: 'paga@ebn.local', course: 'Destrave', courseSlug: 'destrave', option: '10 e 11 de Outubro', classDate: '10 e 11 de Outubro', checkInCode: codigoA, paymentStatus: 'confirmed', studentPortal: {} },
  { enrollmentId: matriculaB, studentId: 's2', name: 'Aluna Sem Pagar', email: 'sempagar@ebn.local', course: 'Destrave', courseSlug: 'destrave', option: '10 e 11 de Outubro', classDate: '10 e 11 de Outubro', checkInCode: codigoB, paymentStatus: 'pending', studentPortal: {} },
  { enrollmentId: 'c3', studentId: 's3', name: 'Aluna Presente', email: 'presente@ebn.local', course: 'Destrave', courseSlug: 'destrave', option: '10 e 11 de Outubro', classDate: '10 e 11 de Outubro', checkInCode: checkInCodeFor('c3'), paymentStatus: 'confirmed', studentPortal: { checkInConfirmed: true } },
];
const linhas = buildStudentPortalRows(vendas);
const [paga, semPagar, presente] = linhas;

check('matrícula paga aparece como "Código válido", não como "Liberado"', paga.checkin === 'Código válido', paga.checkin);
check('matrícula não paga aparece como "Aguardando pagamento"', semPagar.checkin === 'Aguardando pagamento', semPagar.checkin);
check('presença já confirmada aparece como "Presença confirmada"', presente.checkin === 'Presença confirmada', presente.checkin);
check('o painel só oferece confirmar presença pra quem pagou', paga.canConfirmCheckIn === true && semPagar.canConfirmCheckIn === false);
check('o painel mostra o código da matrícula paga', paga.checkInCode === codigoA, paga.checkInCode);
check('o painel leva a turma junto, pra conferir contra a aula certa', paga.classDateRaw === '10 e 11 de Outubro' && paga.courseSlug === 'destrave');

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) do check-in falharam.`);
  process.exit(1);
}
console.log('\nCheck-in a escola: código só da dona da matrícula, presença só com pagamento em dia, estorno derruba o acesso.');
