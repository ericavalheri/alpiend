// Revisão do CRM (pedido da Erica em 11/09/2026: "veja se ali está tudo funcionando certinho").
//
// Os três achados batiam exatamente na queixa dela — "os leads chegam e ninguém atende":
// o CRM escondia oportunidade em silêncio, duplicava quem tinha feito aceite, e perdia a
// referência de quem já tinha sido removido da lista.
import './scripts/_sem-banco.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCrmRows, buildSalesFromSummary, buildAcceptanceRows, filterCrmRows } from './src/lib/crm-helpers.js';

function resumoFalso(quantidade, comAceite) {
  const students = [], enrollments = [], acceptances = [];
  for (let i = 1; i <= quantidade; i += 1) {
    students.push({ id: `al-${i}`, name: `Aluna ${i}`, email: `aluna${i}@ex.com`, whatsapp: `1199999${String(i).padStart(4, '0')}` });
    enrollments.push({ id: `mat-${i}`, student_id: `al-${i}`, course_slug: 'cabeleireiro-profissional', course_name: 'Cabeleireiro Profissional', class_date: 'Cab Diurno', status: i <= comAceite ? 'acceptance_validated' : 'lead', flow: 'voomp', created_at: '2026-09-01T10:00:00Z', metadata: {} });
    if (i <= comAceite) acceptances.push({ id: `ac-${i}`, enrollment_id: `mat-${i}`, student_id: `al-${i}`, course_slug: 'cabeleireiro-profissional', class_date: 'Cab Diurno', terms_read: true, payment_aware: true, enrollment_aware: true, created_at: '2026-09-01T10:00:00Z', metadata: {} });
  }
  return { students, enrollments, acceptances, payments: [], carts: [], trackingEvents: [] };
}

const resumo = resumoFalso(60, 10);
const vendas = buildSalesFromSummary(resumo);
const aceites = buildAcceptanceRows(resumo);
const linhas = buildCrmRows(vendas, aceites, [], []);

// 1. Nenhuma oportunidade sumindo.
// A lista terminava com .slice(0, 35). Como a ordem é por pontuação, quem caía fora era a MENOR
// pontuação: "Lead capturado" e "Em acompanhamento" — o lead novo, que ainda não fez nada. O CRM
// escondia exatamente quem mais precisa de atendimento.
assert.equal(linhas.length, 60, `o CRM tem que mostrar as 60 oportunidades, mostrou ${linhas.length}`);
console.log('OK  60 oportunidades, 60 cards — nada é cortado em silêncio');
const fonte = readFileSync('src/lib/crm-helpers.js', 'utf8');
// Procura o corte no CÓDIGO, não no comentário que explica o bug.
assert.ok(!/b\.score - a\.score\)\.slice\(/.test(fonte), 'o corte fixo de cards não pode voltar ao fim do buildCrmRows');
console.log('OK  o corte fixo de 35 cards não existe mais');

// Os leads novos continuam na tela, não só os quentes.
const leads = linhas.filter((linha) => linha.stage === 'Lead capturado');
assert.equal(leads.length, 50, `os 50 leads sem aceite têm que aparecer, apareceram ${leads.length}`);
console.log('OK  os 50 leads novos aparecem (antes eram os primeiros a sumir)');

// 2. Uma oportunidade, um card.
const porMatricula = linhas.reduce((acc, linha) => { if (linha.enrollmentId) acc[linha.enrollmentId] = (acc[linha.enrollmentId] || 0) + 1; return acc; }, {});
const duplicadas = Object.entries(porMatricula).filter(([, n]) => n > 1);
assert.equal(duplicadas.length, 0, `matrícula duplicada no pipeline: ${JSON.stringify(duplicadas)}`);
console.log('OK  quem fez o aceite aparece uma vez só (antes: dois cards pela mesma pessoa)');

// Aceite sem matrícula na lista continua aparecendo — não pode sumir junto com a deduplicação.
const soltoNoAceite = buildCrmRows([], buildAcceptanceRows({
  students: [{ id: 'al-x', name: 'Aluna X', email: 'x@ex.com' }],
  enrollments: [],
  acceptances: [{ id: 'ac-x', enrollment_id: 'mat-x', student_id: 'al-x', course_slug: 'c', class_date: 'T', terms_read: true, payment_aware: true, enrollment_aware: true, created_at: '2026-09-01T10:00:00Z', metadata: {} }],
}), [], []);
assert.equal(soltoNoAceite.length, 1, 'aceite sem matrícula na lista tem que continuar aparecendo');
console.log('OK  aceite sem venda correspondente continua no pipeline');

// 3. Id do card preso à matrícula, não à posição na lista.
// Era `sale-<email>-<índice>`: bastava entrar uma venda nova pra todo mundo mudar de id, e quem
// tinha sido escondido voltava enquanto outra pessoa sumia no lugar.
const antes = buildCrmRows(vendas, [], [], []).find((linha) => linha.name === 'Aluna 20');
const vendaNova = { ...vendas[0], enrollmentId: 'mat-nova', email: 'nova@ex.com', name: 'Aluna nova' };
const depois = buildCrmRows([vendaNova, ...vendas], [], [], []).find((linha) => linha.name === 'Aluna 20');
assert.equal(antes.id, depois.id, 'o id do card não pode mudar quando entra uma venda nova');
assert.ok(antes.id.includes('mat-20'), `o id tem que sair da matrícula, saiu ${antes.id}`);
console.log('OK  o id do card é da matrícula:', antes.id, '— esconder um card continua valendo amanhã');

// 4. Os filtros continuam funcionando sobre a lista inteira.
assert.equal(filterCrmRows(linhas, { search: 'Aluna 55', stage: '', source: '', campaign: '', priority: 'all' }).length, 1);
assert.equal(filterCrmRows(linhas, { search: '', stage: 'Lead capturado', source: '', campaign: '', priority: 'all' }).length, 50);
assert.equal(filterCrmRows(linhas, { search: '', stage: '', source: '', campaign: '', priority: 'hot' }).length, 10);
console.log('OK  busca, etapa e prioridade filtram a lista inteira');

// 5. O painel avisa quando a consulta chega no limite, em vez de deixar a escola achar que aquilo
// é tudo que existe.
const db = readFileSync('lib/db.mjs', 'utf8');
assert.ok(db.includes('truncatedSources: fontesTruncadas'), 'o resumo precisa avisar quando a consulta encheu');
assert.ok(!/enrollments\?select=[^']*limit=80'/.test(db), 'o limite de 80 matrículas do painel era pouco pro pipeline');
assert.ok(readFileSync('src/admin/AdminPanel.jsx', 'utf8').includes('truncatedSources.length > 0'), 'o painel precisa mostrar esse aviso');
console.log('OK  o painel avisa quando tem mais registro do que coube na consulta');

console.log('\nCRM: nada some em silêncio, uma oportunidade por card, e o card guarda a mesma identidade amanhã.');
