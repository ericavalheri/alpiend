// Assinatura do contrato do Cabeleireiro antes do pagamento (pedido da Erica, 09/09/2026).
//
// A escola quer que a aluna assine o contrato antes de pagar a matrícula. Isso muda o peso do
// que estava ali: eram caixinhas de ciência, agora é um documento assinado. E documento
// assinado precisa aguentar a pergunta "o que exatamente ela assinou?" — meses depois, com o
// contrato já alterado.
//
// Este script trava as duas coisas que sustentam a resposta: o texto assinado é montado no
// servidor (nunca aceito do navegador) e fica registrado por impressão digital; e ninguém passa
// da assinatura sem os dados que qualificam quem assinou.
import crypto from 'node:crypto';
import { buildContractSignature, contractFingerprint, sameName } from './lib/contract-signature.mjs';
import { CLASS_TABLES, CONTRACT_VERSION, contractMoney, contractText, fillContract } from './src/lib/contracts.js';
import { exigeTurmaComContrato } from './scripts/_pendente.mjs';

exigeTurmaComContrato(CLASS_TABLES);

let falhas = 0;
function check(label, condicao, detalhe = '') {
  if (condicao) {
    console.log(`OK  ${label}`);
    return;
  }
  falhas += 1;
  console.error(`FALHOU  ${label}${detalhe ? `\n        ${detalhe}` : ''}`);
}

const TURMAS = Object.keys(CLASS_TABLES);
const base = {
  name: 'Marina Duarte', cpf: '123.456.789-00', rg: '12.345.678-9',
  address: 'Rua X, 10 — São Paulo/SP', whatsapp: '(11) 99999-0000', email: 'marina@ebn.local',
  classDate: TURMAS[0], signedName: 'Marina Duarte', contractAccepted: true,
  totalValue: 'R$ 6.098,64', enrollmentValue: 'R$ 508,22', paymentTerms: 'Matrícula + 11x sem juros',
};
const audit = { ip: '1.2.3.4', userAgent: 'Chrome', receivedAt: '2026-09-09T20:00:00Z' };

// --- 1. O contrato ---------------------------------------------------------------------------
check('as três turmas do Cabeleireiro têm contrato', TURMAS.length === 3, TURMAS.join(' | '));
for (const turma of TURMAS) {
  const texto = contractText(turma, base);
  check(`contrato da turma "${CLASS_TABLES[turma].turma}" é o documento inteiro`, texto.length > 8000, `${texto.length} caracteres`);
  check(`contrato da "${CLASS_TABLES[turma].turma}" traz o quadro da turma certo`,
    texto.includes(`Turma: ${CLASS_TABLES[turma].turma}`) && texto.includes(CLASS_TABLES[turma].cargaPresencial),
    `${CLASS_TABLES[turma].turma} / ${CLASS_TABLES[turma].cargaPresencial}`);
}
// As três turmas compartilham o mesmo contrato: se o texto delas ficar igual, alguém apagou o
// quadro da turma sem perceber.
check('as turmas não geram o mesmo texto', new Set(TURMAS.map((t) => contractText(t, base))).size === 3);

// O texto que a aluna assina de verdade: quem monta é buildContractSignature, que preenche a
// data do dia. Montar aqui sem a data deixaria {{DATA}} em aberto — e é exatamente o tipo de
// lacuna que a verificação abaixo tem que pegar num contrato de verdade.
const assinado = buildContractSignature(base, audit).text;
check('o contrato assinado não tem nenhuma lacuna em branco', !/\{\{/.test(assinado), (assinado.match(/\{\{[^}]+\}\}/g) || []).join(', '));
check('o contrato traz o nome, o CPF e o RG de quem assina', assinado.includes(base.name) && assinado.includes(base.cpf) && assinado.includes(base.rg));
check('o contrato traz as regras que pesam pra aluna', /75% de frequência/.test(assinado) && /multa compensatória de 80%/.test(assinado) && /7 dias/.test(assinado));

// Lacuna sem valor continua visível como lacuna: contrato com espaço em branco no lugar do CPF
// é pior do que um contrato que mostra o que está faltando.
check('lacuna sem valor não vira espaço em branco', fillContract('CPF {{CPF}}', {}) === 'CPF {{CPF}}');

// --- 2. Quem assina --------------------------------------------------------------------------
const ok = buildContractSignature(base, audit);
check('assinatura completa é aceita', ok.ok === true, ok.message);
check('a assinatura registra data, IP e navegador', Boolean(ok.signature.signedAt && ok.signature.ip && ok.signature.userAgent));
check('a assinatura registra a versão do contrato lido', ok.signature.contractVersion === CONTRACT_VERSION, ok.signature.contractVersion);
check('a assinatura registra RG e endereço', ok.signature.rg === base.rg && ok.signature.address === base.address);
check('a assinatura tem código público no formato do papel', /^ESC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(ok.signature.code), ok.signature.code);

const recusas = [
  ['sem marcar o aceite do contrato', { contractAccepted: false }, 'contract_not_accepted'],
  ['sem assinar', { signedName: '' }, 'signature_required'],
  ['assinando com outro nome', { signedName: 'Fulana de Tal' }, 'signature_name_mismatch'],
  ['assinando só o primeiro nome', { signedName: 'Marina' }, 'signature_name_mismatch'],
  ['sem RG', { rg: '' }, 'rg_required'],
  ['sem endereço', { address: '' }, 'address_required'],
  ['turma sem contrato cadastrado', { classDate: 'turma inventada' }, 'contract_not_available'],
];
for (const [rotulo, patch, erro] of recusas) {
  const r = buildContractSignature({ ...base, ...patch }, audit);
  check(`${rotulo} é recusado`, r.ok === false && r.error === erro, `veio: ${r.error || 'ACEITOU'}`);
  check(`  e a recusa explica em português`, r.ok === false && /[a-zà-ú]/i.test(r.message) && r.message.length > 20, r.message);
}

// Quem digita o próprio nome erra o acento — recusar por causa de um "ç" seria implicância.
check('acento e caixa não reprovam a assinatura', sameName('Márcia Sá', 'marcia sa') === true);
check('mas nome diferente reprova', sameName('Marina Duarte', 'Marina Duarti') === false);
check('assinatura vazia nunca bate com nada', sameName('', '') === false);

// --- 3. A impressão digital -------------------------------------------------------------------
// É o que responde "o que ela assinou?" meses depois. Se o texto mudar um caractere, a digital
// muda — e é assim que se prova que o contrato assinado era outro.
// A digital tem que ser do texto que a assinatura DEVOLVE, e não de um texto remontado aqui:
// o contrato assinado leva a data do dia, então remontar sem ela daria outro documento — que é
// justamente o tipo de diferença que a digital existe pra pegar.
check('a impressão digital é do texto exato que foi assinado',
  ok.signature.contractFingerprint === crypto.createHash('sha256').update(ok.text, 'utf8').digest('hex'),
  `${ok.signature.contractFingerprint.slice(0, 16)}...`);
check('o texto assinado leva a data da assinatura', /São Paulo, \d{2} de \w+ de \d{4}\./.test(ok.text), ok.text.slice(-80));
check('mudar um caractere muda a impressão digital', contractFingerprint(assinado) !== contractFingerprint(`${assinado} `));
check('alunas diferentes assinam documentos diferentes',
  buildContractSignature({ ...base, name: 'Outra Aluna', signedName: 'Outra Aluna' }, audit).signature.contractFingerprint !== ok.signature.contractFingerprint);
check('turmas diferentes assinam documentos diferentes',
  buildContractSignature({ ...base, classDate: TURMAS[1] }, audit).signature.contractFingerprint !== ok.signature.contractFingerprint);
// O tamanho vai junto: é uma conferência barata contra texto truncado no meio do caminho.
check('a assinatura guarda o tamanho do texto assinado', ok.signature.contractLength === ok.text.length);

// --- 4. Versão 2027.2: preço escrito no próprio contrato ---------------------------------------
// A escola passou a escrever valor total e matrícula dentro do documento, turma a turma
// (contratos enviados em 10/09/2026). Antes eram lacunas preenchidas com o preço do catálogo.
//
// A matrícula é o número que o sistema realmente cobra hoje pela Voomp: se o preço do site e o
// preço do contrato divergirem, a aluna assina um valor e paga outro. Este bloco existe pra
// isso não acontecer em silêncio — mexer no preço de um lado sem o outro quebra o teste aqui,
// não na frente da aluna.
const { fallbackCourses } = await import('./src/catalog.js');
const cabeleireiro = fallbackCourses.find((curso) => curso.slug === 'cabeleireiro-profissional');
const emReais = (valor) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\u00a0|\u202f/g, ' ');

// 2027.3 (11/09/2026): o quadro passou a calcular matrícula e parcelas do valor total, em vez
// de trazê-las escritas à mão. O texto assinado mudou, então a versão registrada tem que mudar
// junto — senão dois documentos diferentes ficam com o mesmo número no registro do aceite.
check('a versão do contrato subiu junto com o texto novo', CONTRACT_VERSION === '2027.3', CONTRACT_VERSION);
check('a cláusula 5.1 cobra a matrícula, não o valor total',
  ok.text.includes('5.1. O valor da matrícula, deve ser efetuado pela Plataforma parceira Voomp'));
check('a redação antiga e ambígua da 5.1 saiu do contrato',
  !ok.text.includes('O valor total, matrícula, deve ser efetuado'));

for (const [turma, quadro] of Object.entries(CLASS_TABLES)) {
  const variante = cabeleireiro.variants[turma];
  const dinheiro = contractMoney(turma);
  check(`${quadro.turma}: o contrato traz o valor total`, typeof quadro.valorTotal === 'number' && quadro.valorTotal > 0, quadro.valorTotal);
  check(`${quadro.turma}: a matrícula do contrato é a mesma que o site cobra`,
    Math.round(dinheiro.matricula * 100) === Math.round(variante.enrollmentFee * 100),
    `contrato ${dinheiro.matriculaTexto} · site ${emReais(variante.enrollmentFee)}`);
  check(`${quadro.turma}: o valor total do contrato é o mesmo que o site cobra`,
    Math.round(dinheiro.total * 100) === Math.round(variante.priceNumber * 100),
    `contrato ${dinheiro.totalTexto} · site ${emReais(variante.priceNumber)}`);
  // paymentTerms vai de propósito com um valor de outra turma: desde 11/09/2026 o contrato
  // monta a forma de pagamento sozinho, e não pode mais deixar esse texto livre entrar.
  const documento = contractText(turma, { name: 'Aluna Teste', cpf: '11144477735', rg: '1', address: 'Rua 1', whatsapp: '11', email: 'a@b.com', paymentTerms: 'Matrícula R$ 999,99', date: '10 de setembro de 2026' });
  check(`${quadro.turma}: o documento não sai com lacuna de valor em aberto`, !documento.includes('{{VALOR}}'));
  check(`${quadro.turma}: o valor total aparece no documento montado`, documento.includes(dinheiro.totalTexto));
  check(`${quadro.turma}: a matrícula aparece no documento montado`, documento.includes(dinheiro.matriculaTexto));
  check(`${quadro.turma}: texto livre de pagamento não entra no contrato`, !documento.includes('R$ 999,99'));
}

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) da assinatura do contrato falharam.`);
  process.exit(1);
}
console.log('\nContrato a escola: documento inteiro montado no servidor, assinatura só com nome conferido, e impressão digital do texto exato.');
