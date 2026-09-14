// Certificado automático e código de validação (pedido da Erica, 09/09/2026).
//
// Duas coisas que não podem dar errado:
//   1. QUANDO libera. A escola combinou: turma terminada E presença confirmada. Liberar cedo
//      demais entrega certificado no meio do curso; liberar sem presença certifica quem não foi.
//   2. QUEM abre. O código do rodapé é o que um salão usa pra conferir se o documento é da escola.
//      Se um código chutado abrisse o certificado de outra pessoa, a validação não valeria nada.
//
// Sem banco: a regra e o código são funções puras de propósito. A parte que grava é conferida
// contra um Postgres de verdade em scripts-check-student-archive.mjs — aqui fica o que decide.
import { readFileSync } from 'node:fs';
import { certificateCode, certificateDisplayCode, certificateIsDue, certificatePublicPath, normalizeCertificateCode } from './lib/certificates.mjs';

let falhas = 0;
function check(label, condicao, detalhe = '') {
  if (condicao) {
    console.log(`OK  ${label}`);
    return;
  }
  falhas += 1;
  console.error(`FALHOU  ${label}${detalhe ? `\n        ${detalhe}` : ''}`);
}

const TURMA_ENCERRADA = '12 e 13 de Março de 2026';
const TURMA_FUTURA = '10 e 11 de Dezembro de 2099';

// --- 1. Quando libera -----------------------------------------------------------------------
check('turma encerrada + presença + paga libera o certificado',
  certificateIsDue({ paid: true, checkInConfirmed: true, classDate: TURMA_ENCERRADA }).due === true);

// O caso que motivou a regra das duas condições: presença confirmada no primeiro dia de um
// curso de dois dias não é conclusão.
check('presença confirmada com a turma ainda em andamento NÃO libera',
  certificateIsDue({ paid: true, checkInConfirmed: true, classDate: TURMA_FUTURA }).due === false);
check('e a recusa explica que a turma ainda não terminou',
  /turma ainda não terminou/.test(certificateIsDue({ paid: true, checkInConfirmed: true, classDate: TURMA_FUTURA }).reason));

check('turma encerrada sem presença NÃO libera',
  certificateIsDue({ paid: true, checkInConfirmed: false, classDate: TURMA_ENCERRADA }).due === false);
// Presença de quem não pagou é erro de porta, não conclusão de curso.
check('presença confirmada sem pagamento NÃO libera',
  certificateIsDue({ paid: false, checkInConfirmed: true, classDate: TURMA_ENCERRADA }).due === false);
check('matrícula sem nada não libera', certificateIsDue({}).due === false);
check('turma sem data no cadastro não libera sozinha',
  certificateIsDue({ paid: true, checkInConfirmed: true, classDate: '' }).due === false);

// --- 2. O código de validação ----------------------------------------------------------------
const A = '11111111-aaaa-4bbb-8ccc-000000000001';
const B = '22222222-aaaa-4bbb-8ccc-000000000002';
const codigoA = certificateCode(A);

check('a mesma matrícula gera sempre o mesmo código', codigoA === certificateCode(A), codigoA);
check('matrículas diferentes geram códigos diferentes', codigoA !== certificateCode(B));
check('o código tem 8 caracteres úteis', normalizeCertificateCode(codigoA).length === 8, codigoA);
check('o código não expõe o id da matrícula', !codigoA.toLowerCase().includes(A.slice(0, 8)), codigoA);
check('o código não usa caracteres que se confundem lidos em voz alta', !/[01IOU]/.test(normalizeCertificateCode(codigoA)), codigoA);

// O que está impresso no rodapé e o endereço têm que ser a MESMA string — código de um jeito e
// link de outro é convite pro salão desistir de conferir.
check('o código impresso e o endereço são iguais',
  certificatePublicPath(codigoA) === `/certificado/${certificateDisplayCode(codigoA)}`,
  `${certificatePublicPath(codigoA)} vs ${certificateDisplayCode(codigoA)}`);
check('o endereço leva o código no formato lido no papel', /\/certificado\/ESC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(certificatePublicPath(codigoA)), certificatePublicPath(codigoA));

// Quem digita do papel erra o traço, o espaço e a caixa — tudo isso tem que bater.
check('aceita o código digitado sem traço e em minúsculo', normalizeCertificateCode(codigoA.replace(/-/g, '').toLowerCase()) === normalizeCertificateCode(codigoA));
check('aceita o código digitado sem o prefixo a escola', normalizeCertificateCode(codigoA.slice(4)) === normalizeCertificateCode(codigoA));
check('aceita o código digitado com espaços', normalizeCertificateCode(` ${codigoA} `) === normalizeCertificateCode(codigoA));

// E o que NÃO pode passar.
check('código curto não vira código válido', normalizeCertificateCode('ESC-ABC').length !== 8);
check('código vazio não vira código válido', normalizeCertificateCode('').length !== 8);
check('o código de uma matrícula não bate com a outra', normalizeCertificateCode(codigoA) !== normalizeCertificateCode(certificateCode(B)));

// Espaço de busca: 31 símbolos em 8 posições passa de 800 bilhões. Ninguém acha o certificado
// de outra pessoa por tentativa, que é o que dá valor à validação.
const combinacoes = 31 ** 8;
check('o espaço de códigos é grande demais pra chute', combinacoes > 1e11, `${combinacoes.toExponential(2)} combinações`);

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) do certificado falharam.`);
  process.exit(1);
}
// --- Certificado cadastrado à mão pelo painel ---------------------------------------------------
// Achado da Erica em 10/09/2026: o certificado dela abria em 404. O caminho automático já saía
// com código de validação; o do painel, não — gravava só o caminho de arquivo que a pessoa
// digitasse. Sem arquivo hospedado (a arte ainda nem chegou), o botão "Abrir certificado"
// apontava pro nada; e mesmo com o endereço certo, /certificado/CÓDIGO não acharia nada, porque
// a consulta pública procura pelo código de validação que esse caminho nunca gerava.
{
  const fonteDb = readFileSync('lib/db.mjs', 'utf8');
  const fonteRota = readFileSync('api/admin/certificates.mjs', 'utf8');
  const fontePainel = readFileSync('src/admin/panels.jsx', 'utf8');

  check('certificado do painel também gera código de validação',
    /export async function createCertificate\([\s\S]{0,1200}verificationCode: normalizeCertificateCode\(codigo\)/.test(fonteDb));
  check('sem arquivo, o botão aponta pro documento que a a escola monta',
    /file_path: filePath \|\| certificatePublicPath\(codigo\)/.test(fonteDb));
  check('arquivo próprio deixou de ser obrigatório no cadastro',
    !fonteRota.includes('(!filePath && !body.fileData)') && fonteRota.includes('if (!studentEmail || !courseSlug || !title)'));
  check('o nome da aluna entra na foto do certificado', fonteDb.includes('studentName: studentName ||'));
  check('o painel deixa recolher um certificado liberado por engano',
    fontePainel.includes('async function recolher(item)') && fontePainel.includes("status: 'draft'"));
  check('o painel mostra onde aquele certificado abre', fontePainel.includes('ONDE ABRE'));
}

console.log('\nCertificado a escola: sai só com turma encerrada e presença confirmada, e o código do rodapé é único por matrícula.');
