// Relatório de vendas (pedido da Erica, 09/09/2026): todas as vendas, com filtro por período,
// curso, situação do pagamento e situação da turma.
//
// O que deu origem a isto: o relatório era montado em cima do resumo do dashboard, que busca as
// 80 matrículas e os 80 pagamentos mais recentes. Passando de 80, a lista simplesmente parava —
// sem aviso nenhum. E o corte dos pagamentos era independente do das matrículas, então uma
// venda antiga podia aparecer como "não paga" só porque o pagamento dela ficou fora da janela.
//
// Este script trava a parte que decide o que a Erica vê no fechamento do mês: quem entra em
// cada filtro e quanto soma. Sem banco — as funções são puras de propósito.
import { filterSalesReport, salePaymentSituation, saleReportDate } from './lib/db.mjs';
import { buildSalesFromSummary } from './src/lib/crm-helpers.js';

let falhas = 0;
function check(label, condicao, detalhe = '') {
  if (condicao) {
    console.log(`OK  ${label}`);
    return;
  }
  falhas += 1;
  console.error(`FALHOU  ${label}${detalhe ? `\n        ${detalhe}` : ''}`);
}

// Vendas de mentira cobrindo os casos que existem de verdade na escola.
const venda = (extra) => ({
  name: 'Aluna', email: 'aluna@ebn.local', phone: '11999990000', course: 'Destrave', courseSlug: 'destrave',
  option: '10 e 11 de Outubro de 2026', classDate: '10 e 11 de Outubro de 2026', source: 'Instagram', campaign: 'sem campanha',
  couponCode: '', paymentStatus: 'confirmed', amountNumber: 1000, createdAt: '2026-08-10T12:00:00Z', paidAt: '2026-08-12T12:00:00Z',
  classFinished: false, ...extra,
});

const vendas = [
  venda({ name: 'Paga em agosto', amountNumber: 1000, paidAt: '2026-08-12T12:00:00Z' }),
  venda({ name: 'Paga em setembro', amountNumber: 2000, createdAt: '2026-08-28T12:00:00Z', paidAt: '2026-09-03T12:00:00Z' }),
  venda({ name: 'Pendente', paymentStatus: 'pending', amountNumber: 1500, paidAt: null, createdAt: '2026-09-04T12:00:00Z' }),
  venda({ name: 'Estornada', paymentStatus: 'refunded', amountNumber: 900, paidAt: '2026-09-05T12:00:00Z' }),
  venda({ name: 'Sem cobranca', paymentStatus: '', amountNumber: 700, paidAt: null, createdAt: '2026-09-06T12:00:00Z' }),
  venda({ name: 'Curso encerrado', course: 'Corte Descomplicado', courseSlug: 'corte', classFinished: true, amountNumber: 3000, paidAt: '2026-07-20T12:00:00Z', createdAt: '2026-07-01T12:00:00Z' }),
];

// 1. Sem filtro, TODAS aparecem. É o problema original: nada pode sumir em silêncio.
const tudo = filterSalesReport(vendas, {});
check('sem filtro, todas as vendas aparecem', tudo.sales.length === vendas.length, `${tudo.sales.length} de ${vendas.length}`);

// 2. Venda de turma que já aconteceu continua sendo venda.
check('venda de turma encerrada entra no relatório', tudo.sales.some((v) => v.name === 'Curso encerrado'));
check('filtro "só encerradas" traz apenas as encerradas', filterSalesReport(vendas, { classState: 'encerradas' }).sales.every((v) => v.classFinished));
check('filtro "só futuras" não traz nenhuma encerrada', filterSalesReport(vendas, { classState: 'futuras' }).sales.every((v) => !v.classFinished));

// 3. A data que conta é a do dinheiro. Uma matrícula aberta em agosto e paga em setembro é
// venda de setembro — é assim que a Erica fecha o mês.
check('a data da venda é a do pagamento quando existe', saleReportDate(vendas[1]) === '2026-09-03T12:00:00Z');
check('sem pagamento, vale a data da matrícula', saleReportDate(vendas[2]) === '2026-09-04T12:00:00Z');
const agosto = filterSalesReport(vendas, { from: '2026-08-01', to: '2026-08-31' });
check('agosto traz a venda paga em agosto', agosto.sales.some((v) => v.name === 'Paga em agosto'));
check('agosto NÃO traz a matrícula de agosto paga em setembro', !agosto.sales.some((v) => v.name === 'Paga em setembro'), agosto.sales.map((v) => v.name).join(', '));
const setembro = filterSalesReport(vendas, { from: '2026-09-01', to: '2026-09-30' });
check('setembro traz a venda paga em setembro', setembro.sales.some((v) => v.name === 'Paga em setembro'));

// O último dia do período tem que entrar inteiro: uma venda às 23h do dia 31 é do mês.
const fimDoMes = [venda({ name: 'No apagar das luzes', paidAt: '2026-08-31T23:30:00Z' })];
check('venda no último dia do período entra', filterSalesReport(fimDoMes, { from: '2026-08-01', to: '2026-08-31' }).sales.length === 1);

// Venda sem data nenhuma não pode entrar num recorte por período: apareceria em todo mês e o
// mesmo dinheiro seria contado duas vezes no fechamento.
const semData = [venda({ name: 'Sem data', paidAt: null, createdAt: null })];
check('venda sem data fica fora de um recorte por período', filterSalesReport(semData, { from: '2026-01-01', to: '2026-12-31' }).sales.length === 0);
check('mas continua aparecendo quando não há filtro de período', filterSalesReport(semData, {}).sales.length === 1);

// 4. Filtro por curso e por situação do pagamento.
check('filtro por curso traz só aquele curso', filterSalesReport(vendas, { courseSlug: 'corte' }).sales.every((v) => v.courseSlug === 'corte'));
check('filtro "pago" não traz pendente nem estornada', filterSalesReport(vendas, { situation: 'pago' }).sales.every((v) => salePaymentSituation(v).key === 'pago'));
check('estorno é classificado como cancelado, não como pago', salePaymentSituation(vendas[3]).key === 'cancelado');
check('matrícula sem cobrança gerada tem situação própria', salePaymentSituation(vendas[4]).key === 'sem_pagamento');

// 5. As somas. É o número que ela usa pra fechar o mês, então erro aqui é erro de dinheiro.
check('soma só o que foi pago em "recebido"', tudo.totais.receitaPaga === 1000 + 2000 + 3000, `veio ${tudo.totais.receitaPaga}`);
check('estorno não entra no recebido', !String(tudo.totais.receitaPaga).includes('900'));
check('pendente soma separado', tudo.totais.receitaPendente === 1500, `veio ${tudo.totais.receitaPendente}`);
check('as contagens batem com as linhas', tudo.totais.pago === 3 && tudo.totais.pendente === 1 && tudo.totais.cancelado === 1 && tudo.totais.semCobranca === 1,
  JSON.stringify(tudo.totais));
check('os totais respeitam o filtro aplicado', filterSalesReport(vendas, { courseSlug: 'corte' }).totais.receitaPaga === 3000);

// 6. Busca por texto, incluindo cupom e origem.
check('busca acha por nome', filterSalesReport(vendas, { search: 'estornada' }).sales.length === 1);
check('busca acha por origem', filterSalesReport(vendas, { search: 'instagram' }).sales.length === vendas.length);
check('busca por algo que não existe não traz nada', filterSalesReport(vendas, { search: 'zzzz' }).sales.length === 0);

// 7. Filtros combinam (é o uso real: "quanto o Destrave rendeu em setembro").
const combinado = filterSalesReport(vendas, { courseSlug: 'destrave', situation: 'pago', from: '2026-09-01', to: '2026-09-30' });
check('curso + situação + período combinam', combinado.sales.length === 1 && combinado.sales[0].name === 'Paga em setembro', combinado.sales.map((v) => v.name).join(', '));

// 8. O valor em número vem junto das vendas montadas do banco — sem ele, nada soma.
const doBanco = buildSalesFromSummary({
  students: [{ id: 's1', name: 'Marina', email: 'm@ebn.local' }],
  enrollments: [{ id: 'e1', student_id: 's1', course_slug: 'destrave', course_name: 'Destrave', class_date: 'x', amount_expected: 1500 }],
  payments: [{ id: 'p1', enrollment_id: 'e1', student_id: 's1', status: 'confirmed', amount: 1962.9 }],
  carts: [],
});
check('venda paga leva o valor do pagamento, em número', doBanco[0].amountNumber === 1962.9, String(doBanco[0].amountNumber));
const semPagamento = buildSalesFromSummary({
  students: [{ id: 's1', name: 'Marina' }],
  enrollments: [{ id: 'e1', student_id: 's1', course_slug: 'destrave', course_name: 'Destrave', class_date: 'x', amount_expected: 1500 }],
  payments: [], carts: [],
});
check('venda sem pagamento leva o valor esperado da matrícula', semPagamento[0].amountNumber === 1500, String(semPagamento[0].amountNumber));

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) do relatório de vendas falharam.`);
  process.exit(1);
}
console.log('\nRelatório de vendas: nenhuma venda some, turma encerrada continua contando, e as somas batem com o filtro da tela.');
