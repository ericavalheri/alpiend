// Coerência de todo valor de dinheiro do sistema (11/09/2026).
//
// A Erica viu, no contrato da turma Noite, "Valor total: R$ 6.297,00", "Matrícula: R$ 419,80" e
// "Forma de pagamento: Matrícula R$ 508,22" — três números que não fecham entre si, sendo que
// R$ 508,22 é a matrícula da turma Diurno. A causa não foi um número digitado errado: eram três
// fontes diferentes para o mesmo dinheiro (o quadro do contrato, o catálogo do site e o
// parcelamento escrito à mão), e bastava uma sair do passo.
//
// Este teste não confere números específicos — eles ainda vão ser atualizados pela escola. Ele
// confere que TUDO deriva do mesmo total por turma, que é o que impede a divergência de voltar.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLASS_TABLES, PAGAMENTOS_COM_CONTRATO, contractMoney, contractText } from './src/lib/contracts.js';
import { fallbackCourses } from './src/catalog.js';
import { voompPaymentSplit, paymentInfo } from './src/lib/catalog-helpers.js';
import { exigeTurmaComContrato } from './scripts/_pendente.mjs';

exigeTurmaComContrato(CLASS_TABLES);

const centavosDe = (texto) => {
  const achado = /R\$\s*([\d.]+,\d{2})/.exec(String(texto || ''));
  return achado ? Math.round(parseFloat(achado[1].replace(/\./g, '').replace(',', '.')) * 100) : null;
};
const todosOsValores = (texto) => [...String(texto || '').matchAll(/R\$\s*([\d.]+,\d{2})/g)]
  .map((m) => Math.round(parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * 100));

// 1. O quadro de cada turma declara um número, não uma frase. Frase é o que diverge.
for (const [turma, quadro] of Object.entries(CLASS_TABLES)) {
  assert.equal(typeof quadro.valorTotal, 'number', `${turma}: valorTotal precisa ser número`);
  assert.equal(typeof quadro.valorSemPreVenda, 'number', `${turma}: valorSemPreVenda precisa ser número`);
  assert.ok(quadro.valorSemPreVenda > quadro.valorTotal, `${turma}: o preço sem pré-venda tem que ser maior que o de pré-venda`);
}
console.log('OK  cada turma do contrato declara o valor como número, não como texto');

// 2. São 13 pagamentos iguais: a inscrição na Voomp mais 12 parcelas. O sistema já tratou a
// inscrição como a 1ª de 12 e cobrou uma parcela a menos que o contrato — R$ 5.037,60 contra os
// R$ 5.457,40 da turma Noite.
for (const turma of Object.keys(CLASS_TABLES)) {
  const d = contractMoney(turma);
  assert.equal(Math.round(d.matricula * 100), Math.round(Math.round(d.total * 100) / PAGAMENTOS_COM_CONTRATO),
    `${turma}: a inscrição não é o total dividido por ${PAGAMENTOS_COM_CONTRATO}`);
  assert.equal(Math.round((d.matricula + d.saldo) * 100), Math.round(d.total * 100), `${turma}: inscrição + parcelas não fecha o total`);
  assert.equal(Math.round(d.saldo * 100), Math.round(d.matricula * 100) * d.parcelas,
    `${turma}: as ${d.parcelas} parcelas têm que ter o mesmo valor da inscrição`);
}
console.log('OK  no contrato são 13 pagamentos iguais: inscrição + 12 parcelas, fechando o total');

// 2b. Os 20% anunciados têm que ser 20% de verdade.
//
// Os contratos calculavam a pré-venda multiplicando o preço cheio por 1/1,2 em vez de por 0,8,
// o que dava 16,67% de desconto enquanto três páginas públicas anunciavam 20%. Tirar 20% e
// somar 20% não são operações inversas. Corrigido em 11/09/2026 pela decisão da Erica.
//
// A tolerância é de meio centavo por parcela: o total é 13 x a inscrição, e não os 80% exatos,
// porque um contrato precisa de 13 pagamentos iguais. Isso desloca o desconto em milésimos.
for (const [turma, quadro] of Object.entries(CLASS_TABLES)) {
  const desconto = (1 - quadro.valorTotal / quadro.valorSemPreVenda) * 100;
  assert.ok(Math.abs(desconto - 20) < 0.01,
    `${turma}: o desconto real é ${desconto.toFixed(4)}%, mas as páginas anunciam 20%`);
  assert.equal(Number(desconto.toFixed(2)), 20.00, `${turma}: o desconto não fecha 20,00% arredondado`);
}
console.log('OK  o desconto anunciado de 20% é verdadeiro nas três turmas');

// 3. O contrato escrito não pode citar nenhum valor que não seja um dos quatro da turma.
// É esta checagem que pega o caso da Erica: R$ 508,22 aparecendo no contrato da Noite.
for (const turma of Object.keys(CLASS_TABLES)) {
  const d = contractMoney(turma);
  const permitidos = new Set([d.total, d.matricula, d.saldo, CLASS_TABLES[turma].valorSemPreVenda].map((v) => Math.round(v * 100)));
  const linhas = contractText(turma, {}).split('\n').filter((linha) => /R\$/.test(linha));
  for (const linha of linhas) {
    for (const valor of todosOsValores(linha)) {
      assert.ok(permitidos.has(valor),
        `${turma}: o contrato cita ${(valor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, que não é valor desta turma — linha: "${linha.trim()}"`);
    }
  }
}
console.log('OK  o contrato de cada turma só cita valores da própria turma');

// 4. Site e contrato têm que cobrar o mesmo. Se divergirem, a aluna assina um valor e paga outro.
{
  const cab = fallbackCourses.find((curso) => curso.slug === 'cabeleireiro-profissional');
  for (const turma of cab.dates) {
    const noContrato = contractMoney(turma);
    assert.ok(noContrato, `${turma}: turma do site sem quadro de contrato`);
    const noSite = voompPaymentSplit(cab, turma);
    assert.equal(Math.round(noSite.priceNumber * 100), Math.round(noContrato.total * 100),
      `${turma}: o site cobra ${noSite.priceNumber} e o contrato diz ${noContrato.total}`);
    assert.equal(Math.round(noSite.enrollmentFee * 100), Math.round(noContrato.matricula * 100),
      `${turma}: matrícula diferente entre site e contrato`);
  }
}
console.log('OK  site e contrato cobram exatamente o mesmo em todas as turmas');

// 5. Catálogo inteiro: toda frase de parcelamento tem que refletir o preço ao lado dela.
{
  let conferidos = 0;
  const conferir = (rotulo, precoNumero, precoTexto, installments) => {
    const totalC = Math.round(precoNumero * 100);
    if (precoTexto) assert.equal(centavosDe(precoTexto), totalC, `${rotulo}: o preço escrito não bate com o número`);
    const naFrase = centavosDe(installments);
    if (naFrase !== null) {
      // Curso da Voomp: 13 pagamentos iguais. Os demais: 12 parcelas do total.
      const esperado = /Inscrição/.test(installments) ? Math.round(totalC / PAGAMENTOS_COM_CONTRATO) : Math.round(totalC / 12);
      assert.equal(naFrase, esperado, `${rotulo}: "${installments}" não bate com o preço ${precoNumero}`);
    }
    conferidos += 1;
  };
  for (const curso of fallbackCourses) {
    conferir(curso.slug, curso.priceNumber, curso.price, curso.installments);
    for (const [turma, v] of Object.entries(curso.variants || {})) {
      conferir(`${curso.slug} / ${v.label || turma}`, v.priceNumber ?? curso.priceNumber, v.price, v.installments);
    }
  }
  assert.ok(conferidos >= fallbackCourses.length, 'a varredura do catálogo não rodou');
  console.log(`OK  ${conferidos} preços do catálogo conferidos, nenhum divergente`);
}

// 6. O caminho do aceite não pode voltar a copiar o parcelamento do catálogo.
{
  const aceite = readFileSync('api/acceptance.mjs', 'utf8');
  assert.ok(!/installments: variant\?\.installments \|\| offer\.course\?\.installments \|\| null,/.test(aceite),
    'o registro do aceite voltou a copiar o parcelamento do catálogo — era daí que vinha a matrícula da turma errada');
  const contrato = readFileSync('src/lib/contracts.js', 'utf8');
  assert.ok(!/Forma de pagamento: \$\{dados\.paymentTerms/.test(contrato),
    'o contrato voltou a escrever a forma de pagamento a partir de texto livre');
}
console.log('OK  nem o aceite nem o contrato voltam a usar texto livre para dinheiro');

// 7. Datas do quadro: nenhuma pode ser inexistente, e o término tem que casar com o nome da turma.
for (const [turma, quadro] of Object.entries(CLASS_TABLES)) {
  for (const campo of ['inicio', 'termino']) {
    assert.ok(!/\b31 de (novembro|abril|junho|setembro)\b/.test(quadro[campo]), `${turma}: ${campo} tem data que não existe`);
  }
  const mesNoNome = /a \d{2} de (\w+) de 2027/.exec(turma)?.[1];
  if (mesNoNome) {
    assert.ok(quadro.termino.toLowerCase().includes(mesNoNome.toLowerCase()),
      `${turma}: o término do quadro ("${quadro.termino}") não casa com o mês do nome da turma`);
  }
}
console.log('OK  as datas do quadro existem e casam com o nome da turma');

// 8. As telas não podem descrever uma cobrança diferente da que acontece.
//
// São 13 pagamentos: inscrição + 12 parcelas. Enquanto o sistema tratava a inscrição como a 1ª
// de 12, o checkout fazia a aluna marcar "entendo que são as demais 11 parcelas" — declaração
// formal de ciência sobre uma cobrança que não é a real.
{
  const telas = {
    'src/pages/checkout.jsx': readFileSync('src/pages/checkout.jsx', 'utf8'),
    'src/components/shared.jsx': readFileSync('src/components/shared.jsx', 'utf8'),
    'src/lib/catalog-helpers.js': readFileSync('src/lib/catalog-helpers.js', 'utf8'),
  };
  for (const [arquivo, conteudo] of Object.entries(telas)) {
    for (const proibido of ['11 parcelas', '11x de', '1ª parcela (matrícula)', 'parcelamento em 12x']) {
      assert.ok(!conteudo.includes(proibido),
        `${arquivo}: "${proibido}" descreve a regra antiga (inscrição como 1ª de 12), não a cobrança real`);
    }
  }
  // E o número de parcelas mostrado tem que vir do mesmo lugar que a conta.
  assert.ok(telas['src/lib/catalog-helpers.js'].includes('PAGAMENTOS_COM_CONTRATO'),
    'o número de pagamentos precisa vir da constante, não escrito à mão na tela');
}
console.log('OK  nenhuma tela descreve a cobrança antiga de 12 parcelas');

// 9. Catálogo velho no banco não pode mudar o que a aluna vê nem o que ela assina.
//
// A agenda em produção lê o catálogo do BANCO, que fica para trás porque a escola edita cursos
// pelo painel. Enquanto o preço vinha de lá, o site ficou anunciando um total diferente do
// contrato, e a inscrição — que é calculada do total — saiu junto: a tela mostrou inscrição de
// R$ 387,51 numa turma cuja inscrição é R$ 419,80. Nas turmas com contrato, quem manda é o
// contrato, que mora no código e é o documento que vale.
{
  const { displayPrice, displayPriceNumber, paymentInfo, voompPaymentSplit } = await import('./src/lib/catalog-helpers.js');
  for (const [turma, quadro] of Object.entries(CLASS_TABLES)) {
    const doContrato = contractMoney(turma);
    // Catálogo propositalmente errado, como o banco de produção esteve.
    const cursoDoBancoVelho = {
      slug: 'cabeleireiro-profissional', flow: 'voomp',
      price: 'R$ 1,00', priceNumber: 1,
      voomp: { enrollmentFee: 1, remainingBalance: 1 },
      dates: [turma],
      variants: { [turma]: { label: quadro.turma, price: 'R$ 1,00', priceNumber: 1, enrollmentFee: 1, remainingBalance: 1 } },
    };
    assert.equal(displayPriceNumber(cursoDoBancoVelho, turma), doContrato.total,
      `${turma}: o preço mostrado seguiu o catálogo do banco em vez do contrato`);
    assert.ok(displayPrice(cursoDoBancoVelho, turma).replace(/\s/g, ' ').includes(doContrato.totalTexto.replace(/\s/g, ' ')),
      `${turma}: o preço escrito na tela não é o do contrato`);
    const split = voompPaymentSplit(cursoDoBancoVelho, turma);
    assert.equal(split.enrollmentFee, doContrato.matricula,
      `${turma}: a inscrição mostrada não é a do contrato`);
    const { featuredSub } = paymentInfo(cursoDoBancoVelho, turma);
    const limpo = featuredSub.replace(/\s/g, ' ');
    assert.ok(limpo.includes(doContrato.totalTexto.replace(/\s/g, ' ')), `${turma}: o card não mostra o total do contrato`);
    assert.ok(limpo.includes(doContrato.matriculaTexto.replace(/\s/g, ' ')), `${turma}: o card não mostra a inscrição junto do total`);
  }
}
console.log('OK  catálogo velho no banco não altera o preço, a inscrição nem o total mostrados');

// 10. Os valores são exatamente os dos contratos que a escola enviou (11/09/2026).
{
  const esperado = {
    'Cab Noite — 11 de Janeiro a 28 de Junho de 2027': { cheio: 6548.88, preVenda: 5239.13, inscricao: 403.01 },
    'Sábado — 09 de Janeiro a 31 de Julho de 2027': { cheio: 6548.88, preVenda: 5239.13, inscricao: 403.01 },
    'Cab Diurno — 18 de Janeiro a 08 de Junho de 2027': { cheio: 7928.23, preVenda: 6342.57, inscricao: 487.89 },
  };
  for (const [turma, valores] of Object.entries(esperado)) {
    const quadro = CLASS_TABLES[turma];
    assert.ok(quadro, `${turma}: sumiu do quadro de turmas`);
    assert.equal(quadro.valorSemPreVenda, valores.cheio, `${turma}: preço cheio diferente do contrato`);
    assert.equal(quadro.valorTotal, valores.preVenda, `${turma}: preço de pré-venda diferente do contrato`);
    assert.equal(contractMoney(turma).matricula, valores.inscricao, `${turma}: inscrição diferente do contrato`);
  }
}
console.log('OK  os três quadros trazem o preço cheio dos contratos e a pré-venda com 20% reais');
