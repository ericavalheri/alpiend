// Parcela do Cabeleireiro (achado em 11/09/2026, a partir de um print da agenda pública).
//
// Os três cards de turma mostravam "12x de R$ 508,22" — mas dois deles tinham valor total
// R$ 5.037,60, cuja parcela é R$ 419,80. A parcela exibida vinha do campo enrollmentFee do
// catálogo, e a agenda em produção lê o catálogo do BANCO (courses/classes), não do arquivo
// estático: com o banco desatualizado, as três turmas herdavam a matrícula da Diurno.
//
// Regra da escola: são 12 parcelas iguais, sem juros, e a matrícula é a 1ª delas. Ou seja, a
// parcela é sempre o valor cheio dividido por 12 — então ela passou a ser derivada do preço,
// e não lida de um campo que pode divergir dele.
import assert from 'node:assert/strict';
import { paymentInfo, voompPaymentSplit } from './src/lib/catalog-helpers.js';
import { PAGAMENTOS_COM_CONTRATO } from './src/lib/contracts.js';
import { fallbackCourses } from './src/catalog.js';
import { exigeTurmaComContrato } from './scripts/_pendente.mjs';
import { CLASS_TABLES } from './src/lib/contracts.js';

exigeTurmaComContrato(CLASS_TABLES);

const semEspacoEstranho = (texto) => String(texto).replace(/\s/g, ' ');

// 1. Cada turma do catálogo: a parcela mostrada tem que bater com o total dividido por 12.
const cabeleireiro = fallbackCourses.find((curso) => curso.slug === 'cabeleireiro-profissional');
assert.ok(cabeleireiro, 'a Formação em Cabeleireiro sumiu do catálogo');
for (const turma of cabeleireiro.dates) {
  const { enrollmentFee, remainingBalance, priceNumber } = voompPaymentSplit(cabeleireiro, turma);
  const esperado = Math.round(Math.round(priceNumber * 100) / PAGAMENTOS_COM_CONTRATO) / 100;
  assert.equal(enrollmentFee, esperado, `${turma}: a inscrição não é o total dividido por ${PAGAMENTOS_COM_CONTRATO}`);
  assert.equal(Math.round((enrollmentFee + remainingBalance) * 100), Math.round(priceNumber * 100),
    `${turma}: inscrição + parcelas tem que fechar o valor total`);
  const { featured, featuredSub } = paymentInfo(cabeleireiro, turma);
  assert.ok(semEspacoEstranho(featuredSub).includes(semEspacoEstranho(cabeleireiro.variants?.[turma]?.price || cabeleireiro.price)),
    `${turma}: o card tem que mostrar o valor cheio da turma`);
  assert.ok(/^12x de /.test(featured), `${turma}: o card tem que anunciar 12x`);
}
console.log('OK  cada turma mostra a parcela do seu próprio valor cheio');

// 2. As turmas de R$ 5.037,60 não podem mostrar a parcela da turma de R$ 6.098,64.
{
  const porTotal = new Map();
  for (const turma of cabeleireiro.dates) {
    const { enrollmentFee, priceNumber } = voompPaymentSplit(cabeleireiro, turma);
    porTotal.set(priceNumber, enrollmentFee);
  }
  assert.equal(porTotal.get(5239.13), 403.01, 'turma de R$ 5.239,13 tem que ter inscrição e parcelas de R$ 403,01');
  assert.equal(porTotal.get(6342.57), 487.89, 'turma de R$ 6.342,57 tem que ter inscrição e parcelas de R$ 487,89');
  assert.equal(porTotal.size, 2, 'as três turmas têm dois valores distintos; se virar um só, a parcela voltou a ser copiada');
}
console.log('OK  turma de R$ 5.037,60 não herda mais a parcela da turma de R$ 6.098,64');

// 3. O caso real que quebrou: catálogo do banco com enrollmentFee divergente do preço da turma.
// A parcela tem que seguir o preço, não o campo desatualizado.
{
  const turma = 'Cab Noite — 11 de Janeiro a 28 de Junho de 2027';
  const cursoDoBanco = {
    slug: 'cabeleireiro-profissional', name: 'Cabeleireiro Profissional', flow: 'voomp',
    price: 'R$ 6.342,57', priceNumber: 6342.57,
    voomp: { enrollmentFee: 487.89, remainingBalance: 5854.68 },
    dates: [turma],
    variants: { [turma]: { label: 'Cab Noite', price: 'R$ 5.037,60', priceNumber: 5037.60, enrollmentFee: 508.22, remainingBalance: 6098.64 } },
  };
  const { featured, featuredSub } = paymentInfo(cursoDoBanco, turma);
  assert.equal(semEspacoEstranho(featured), '12x de R$ 403,01',
    'com o catálogo do banco desatualizado, a parcela ainda tem que sair do contrato da turma');
  assert.ok(semEspacoEstranho(featuredSub).includes('R$ 5.239,13'), 'o total da turma tem que vir do contrato');
  assert.ok(semEspacoEstranho(featuredSub).includes('inscrição de R$ 403,01'),
    'o card tem que mostrar a inscrição: 12x de R$ 403,01 não fecha o total sozinho');
}
console.log('OK  catálogo desatualizado no banco não contamina mais a parcela');

// 4. A parcela não pode voltar a ser lida direto do campo do catálogo.
{
  const { readFileSync } = await import('node:fs');
  const helpers = readFileSync('src/lib/catalog-helpers.js', 'utf8');
  const inicio = helpers.indexOf('export function voompPaymentSplit(');
  const corpo = helpers.slice(inicio, helpers.indexOf('export function paymentInfo('));
  assert.ok(/installmentCents = totalCents \? Math\.round\(totalCents \/ PAGAMENTOS_COM_CONTRATO\)/.test(corpo),
    'a parcela precisa continuar sendo derivada do valor total, em centavos');
  assert.ok(!/const enrollmentFee = offer\?\.enrollmentFee/.test(corpo),
    'a parcela voltou a ser lida do catálogo — é assim que ela descola do preço mostrado ao lado');
}
console.log('OK  a parcela continua derivada do preço, não copiada do catálogo');

// 5. O aceite grava a matrícula derivada do valor cheio, não a do catálogo do banco.
// O corpo do contrato usa a tabela estática (CLASS_TABLES), que sempre esteve certa — mas o
// snapshot guardado no aceite lia o catálogo, e com o banco desatualizado registrava a
// matrícula de outra turma.
{
  const { readFileSync } = await import('node:fs');
  const aceite = readFileSync('api/acceptance.mjs', 'utf8');
  assert.ok(/Math\.round\(precoTotal \* 100\) \/ PAGAMENTOS_COM_CONTRATO\) \/ 100 : null;/.test(aceite),
    'o aceite precisa derivar a inscrição do valor total dividido pelos 13 pagamentos');
  assert.ok(!/enrollmentFee: variant\?\.enrollmentFee \?\? offer\.course\?\.voomp\?\.enrollmentFee/.test(aceite),
    'o snapshot voltou a ler a matrícula do catálogo, que em produção vem do banco');
}
console.log('OK  o aceite registra a matrícula derivada do valor cheio da turma');
