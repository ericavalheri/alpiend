// Regressão da tela de Aceites (achado da Erica em 09/09/2026: ela assinou o contrato do
// Cabeleireiro, recebeu WhatsApp, viu a aluna no painel — e a tela de Aceites dizia "Nenhum
// aceite registrado ainda").
//
// A causa não estava no aceite: as oito consultas do painel iam num Promise.all, então UMA
// coluna faltando em qualquer tabela rejeitava a promessa inteira, /api/admin/summary devolvia
// 500 e o painel caía no fallback — que na tela de Aceites tem exatamente a cara de "não tem
// aceite nenhum". Uma tela mentindo sobre contrato assinado é o pior lugar possível pra esse
// tipo de falha.
//
// Este teste trava as três garantias: tabela quebrada não derruba as outras, o aceite continua
// visível mesmo sem a linha da tabela `acceptances`, e o contrato assinado chega na tela.
import './scripts/_sem-banco.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAcceptanceRows } from './src/lib/crm-helpers.js';

const db = readFileSync('lib/db.mjs', 'utf8');
const painel = readFileSync('src/admin/AdminPanel.jsx', 'utf8');
const rota = readFileSync('api/admin/summary.mjs', 'utf8');
const aceite = readFileSync('api/acceptance.mjs', 'utf8');

// 1) Uma tabela quebrada não pode derrubar o painel inteiro.
assert.ok(!/const \[students, enrollments, payments, carts, coupons, acceptances, trackingEvents, crmActivities\] = await Promise\.all\(\[\s*\n\s*supabaseRequest/.test(db),
  'adminSummary não pode voltar a chamar supabaseRequest direto dentro de um Promise.all: uma tabela quebrada derruba o painel todo');
assert.ok(db.includes('async function fonteDoPainel('), 'adminSummary precisa isolar cada consulta em fonteDoPainel');
assert.ok(db.includes('failedSources: fontesComFalha'), 'o resumo precisa dizer QUAIS tabelas falharam');
assert.ok(painel.includes('failedSources.length > 0'), 'o painel precisa mostrar a tabela que falhou, em vez de só ficar vazio');

// 2) O aceite sai de duas fontes: a tabela e a própria matrícula.
const assinatura = {
  signedName: 'Maria Teste', name: 'Maria Teste', cpf: '39053344705', rg: '12.345.678-9',
  address: 'Rua Teste, 100', classDate: 'Cab Diurno — 18 de Janeiro a 08 de Junho de 2027',
  contractVersion: '2027.1', contractFingerprint: 'a'.repeat(64), contractLength: 10356,
  signedAt: '2026-09-09T18:00:00.000Z', ip: '1.2.3.4', userAgent: 'qa', code: 'ESC-422Q-MZQ5',
};
const auditAssinado = { acceptedAt: '2026-09-09T18:00:00.000Z', termsVersion: 'cabeleireiro-contrato-2027.1', contractSignature: assinatura };

const somenteMatricula = buildAcceptanceRows({
  students: [{ id: 'aluna-1', name: 'Maria Teste', whatsapp: '11988887777', email: 'maria@example.com', cpf_last4: '4705' }],
  enrollments: [{ id: 'mat-1', student_id: 'aluna-1', course_slug: 'cabeleireiro-profissional', course_name: 'Cabeleireiro Profissional', class_date: assinatura.classDate, flow: 'voomp', created_at: '2026-09-09T18:00:00.000Z', metadata: { audit: auditAssinado } }],
  acceptances: [],
});
assert.equal(somenteMatricula.length, 1, 'sem a linha da tabela de aceites, a matrícula ainda tem que aparecer na tela de Aceites');
assert.equal(somenteMatricula[0].origin, 'matricula');
assert.equal(somenteMatricula[0].name, 'Maria Teste');
assert.equal(somenteMatricula[0].contract.code, 'ESC-422Q-MZQ5', 'o contrato assinado tem que vir junto do aceite reconstruído');

// Com as duas fontes, a mesma matrícula não pode aparecer duas vezes.
const duasFontes = buildAcceptanceRows({
  students: [{ id: 'aluna-1', name: 'Maria Teste', cpf_last4: '4705' }],
  enrollments: [{ id: 'mat-1', student_id: 'aluna-1', course_slug: 'cabeleireiro-profissional', course_name: 'Cabeleireiro Profissional', class_date: assinatura.classDate, created_at: '2026-09-09T18:00:00.000Z', metadata: { audit: auditAssinado } }],
  acceptances: [{ id: 'ac-1', enrollment_id: 'mat-1', student_id: 'aluna-1', course_slug: 'cabeleireiro-profissional', class_date: assinatura.classDate, terms_version: 'cabeleireiro-contrato-2027.1', terms_read: true, payment_aware: true, enrollment_aware: true, created_at: '2026-09-09T18:00:00.000Z', metadata: { audit: auditAssinado } }],
});
assert.equal(duasFontes.length, 1, 'a mesma matrícula não pode aparecer duas vezes na lista de aceites');
assert.equal(duasFontes[0].origin, 'aceite', 'quando as duas fontes têm a matrícula, vale a linha da tabela');

// Ordenação pela data crua, não pela data já formatada em pt-BR (09/09 não pode cair depois de 10/08).
const ordenadas = buildAcceptanceRows({
  students: [], enrollments: [],
  acceptances: [
    { id: 'ac-agosto', enrollment_id: 'e1', class_date: 'x', created_at: '2026-08-10T12:00:00.000Z', metadata: {} },
    { id: 'ac-setembro', enrollment_id: 'e2', class_date: 'x', created_at: '2026-09-09T12:00:00.000Z', metadata: {} },
  ],
});
assert.equal(ordenadas[0].id, 'ac-setembro', 'o aceite mais recente tem que vir primeiro');

// Curso sem contrato continua sem contrato — nada inventado.
const semContrato = buildAcceptanceRows({
  students: [], enrollments: [],
  acceptances: [{ id: 'ac-2', enrollment_id: 'e3', class_date: 'Turma X', created_at: '2026-09-01T12:00:00.000Z', terms_read: true, payment_aware: true, enrollment_aware: true, metadata: { audit: { acceptedAt: '2026-09-01T12:00:00.000Z' } } }],
});
assert.equal(semContrato[0].contract, null, 'aceite sem assinatura não pode exibir contrato nenhum');

// 3) O contrato assinado é guardado e servido — e não vai junto na listagem.
assert.ok(aceite.includes('textoDoContrato = resultado.text'), 'o texto assinado precisa ser guardado, não só a impressão digital');
assert.ok(db.includes('contractText: documentos.contractText'), 'persistAcceptanceIntent precisa gravar o texto do contrato no aceite');
assert.ok(db.includes('const { contractText, ...metadata } = acceptance.metadata || {}'), 'a listagem do painel não pode carregar ~10 KB de contrato por aluna');
assert.ok(db.includes('export async function acceptanceContract('), 'precisa existir a rota que entrega o contrato de um aceite');
assert.ok(rota.includes("body.action === 'acceptance_contract'"), 'o painel precisa de uma ação autenticada pra abrir o contrato');
assert.ok(rota.includes("acceptance_contract: 'dashboard'"), 'contrato assinado tem CPF, RG e endereço: exige permissão, não pode ficar aberto');
assert.ok(painel.includes('crypto.subtle.digest'), 'o painel tem que conferir a impressão digital do que está mostrando, não só exibir o texto');
assert.ok(painel.includes('Documento confere'), 'a tela precisa dizer se o documento bate com o que foi assinado');

// O evento de tracking não pode carregar o contrato inteiro junto.
assert.ok(db.includes('payload: { acceptanceId: acceptance.id'), 'o evento de tracking não deve repetir o contrato assinado dentro do payload');

// --- Aviso de limite só onde ele custa alguma coisa --------------------------------------------
// O aviso de "chegou no limite da consulta" ficava aceso em quase toda tela porque
// tracking_events guarda todo clique e toda visita — bate no limite o tempo todo, e isso não
// esconde aluna, venda nem oportunidade (a Erica viu isso em 11/09/2026). Aviso sempre ligado é
// ruído: ninguém lê, e enterra o aviso que importa.
assert.ok(db.includes('const AVISA_SE_ENCHER = new Set('), 'o aviso de limite precisa filtrar quais tabelas valem');
assert.ok(!/AVISA_SE_ENCHER = new Set\(\[[^\]]*tracking_events/.test(db), 'tracking_events não pode gerar aviso de limite');
assert.ok(!/AVISA_SE_ENCHER = new Set\(\[[^\]]*crm_activities/.test(db), 'crm_activities não pode gerar aviso de limite');
for (const tabela of ['students', 'enrollments', 'payments', 'carts', 'acceptances']) {
  assert.ok(new RegExp(`AVISA_SE_ENCHER = new Set\\(\\[[^\\]]*'${tabela}'`).test(db), `${tabela} cheio precisa avisar: aí some venda de verdade da tela`);
}
console.log('ok: aviso de limite só nas tabelas em que encher esconde alguma coisa');

// O vazio da tela de aceites tem que dizer o que sabe, em vez de deixar a escola adivinhando se
// é banco vazio ou falha. E não pode acusar falha onde não há: só a Formação em Cabeleireiro
// passa por assinatura de contrato, então matrícula de outro curso sem aceite é o esperado —
// contar todas as matrículas mandava a escola caçar um defeito inexistente.
assert.ok(painel.includes("filter((linha) => linha.flow === 'voomp').length"),
  'o vazio precisa contar só as matrículas que exigem contrato assinado');
assert.ok(painel.includes('matrícula(s) de Cabeleireiro no banco e nenhuma delas traz aceite'),
  'quando há matrícula de Cabeleireiro sem aceite, a tela tem que dizer que é falha');
assert.ok(painel.includes('não pedem contrato assinado'),
  'quando as matrículas são de outros cursos, a tela tem que dizer que o vazio é normal');
assert.ok(!painel.includes('Existem ${dbMetrics.enrollments} matrícula(s) no banco e nenhuma delas traz aceite'),
  'a contagem antiga acusava falha em matrícula de curso que nem tem contrato');
console.log('ok: o vazio da tela de aceites separa banco vazio, curso sem contrato e falha real');

console.log('ok: tela de aceites — consulta isolada, aceite visível pelas duas fontes e contrato assinado conferido');
