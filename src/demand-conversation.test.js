import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDemandConversation } from './demand-conversation.js';

const templates = { campaign: { owner: 'Felipe', items: ['Planejamento', 'Criação'] }, website: { owner: 'Erica', items: ['Briefing', 'Layout'] }, other: { owner: '', items: ['Briefing'] } };

test('interpreta os principais campos e checklist personalizado', () => {
  const result = parseDemandConversation('Criar campanha de matrícula, prioridade alta, responsável Flávio, prazo 28/08. Etapas: briefing; copy; artes', templates, new Date(2026, 7, 22));
  assert.equal(result.title, 'campanha de matrícula'); assert.equal(result.category, 'campaign'); assert.equal(result.owner, 'Flavio');
  assert.equal(result.priority, 'high'); assert.equal(result.dueDate, '2026-08-28');
  assert.deepEqual(result.checklist.map((item) => item.title), ['briefing', 'copy', 'artes']);
});

test('usa modelo automático e entende amanhã', () => {
  const result = parseDemandConversation('Fazer página do curso até amanhã', templates, new Date(2026, 7, 22));
  assert.equal(result.category, 'website'); assert.equal(result.owner, 'Erica'); assert.equal(result.dueDate, '2026-08-23');
  assert.deepEqual(result.checklist.map((item) => item.title), ['Briefing', 'Layout']);
});

test('preenche status, pessoa citada, espera da escola, link e visibilidade', () => {
  const result = parseDemandConversation('Revisar vídeo da turma, Flávio, aguardando aprovação, aguardando da escola: depoimentos das alunas. Entrega https://drive.example.com/video. Não visível para a escola', templates, new Date(2026, 7, 22));
  assert.equal(result.category, 'video'); assert.equal(result.owner, 'Flavio'); assert.equal(result.status, 'approval');
  assert.equal(result.waitingFor, 'depoimentos das alunas'); assert.equal(result.deliveryUrl, 'https://drive.example.com/video'); assert.equal(result.clientVisible, false);
});

test('reconhece todos os status disponíveis no formulário', () => {
  const cases = [['nova demanda', 'received'], ['aguardando informações', 'waiting_info'], ['na fila', 'queued'], ['em produção', 'in_progress'], ['para aprovação', 'approval'], ['alteração solicitada', 'changes_requested'], ['aprovada', 'approved'], ['concluído', 'completed']];
  for (const [phrase, expected] of cases) assert.equal(parseDemandConversation(`Tarefa, ${phrase}`, templates).status, expected);
});

test('resume briefing conversacional sem jogar metadados na descrição', () => {
  const result = parseDemandConversation('O cliente pediu para criar um vídeo curto da nova turma mostrando as alunas em aula. Fica com o Flávio, é urgente e já pode ir para aprovação. A escola precisa mandar os depoimentos. Link da entrega https://drive.example.com/final', templates, new Date(2026, 7, 22));
  assert.equal(result.title, 'um vídeo curto da nova turma mostrando as alunas em aula');
  assert.equal(result.description, 'O cliente pediu para criar um vídeo curto da nova turma mostrando as alunas em aula.');
  assert.equal(result.category, 'video'); assert.equal(result.owner, 'Flavio'); assert.equal(result.priority, 'high'); assert.equal(result.status, 'approval');
  assert.equal(result.waitingFor, 'os depoimentos'); assert.equal(result.deliveryUrl, 'https://drive.example.com/final');
});

test('entende linguagem livre para responsável, fila, baixa prioridade e visibilidade', () => {
  const result = parseDemandConversation('Preparar um folder para a turma de setembro. Pode ficar com a Gabi, sem pressa, coloca na fila e deixa somente interno.', templates);
  assert.equal(result.category, 'print'); assert.equal(result.owner, 'Gabriela'); assert.equal(result.priority, 'low'); assert.equal(result.status, 'queued'); assert.equal(result.clientVisible, false);
});

test('reproduz corretamente o texto real enviado pelo Flávio', () => {
  const input = `Campanha, o titulo e Escovista Profissional, responsavel Flavio ... prazo até a próxima quarta
feira .. os itens do checklist são, 1 Criativo Estatico, 1 Carrossel com ate 10 cards, banners mobile e
Desktop, e video, prioridade normal`;
  const result = parseDemandConversation(input, templates, new Date(2026, 7, 22));
  assert.equal(result.title, 'Escovista Profissional'); assert.equal(result.category, 'campaign'); assert.equal(result.owner, 'Flavio');
  assert.equal(result.priority, 'normal'); assert.equal(result.dueDate, '2026-08-26');
  assert.deepEqual(result.checklist.map((item) => item.title), ['1 Criativo Estatico', '1 Carrossel com ate 10 cards', 'banners mobile e Desktop', 'video']);
  assert.equal(result.description, 'Campanha “Escovista Profissional”, composta por 1 Criativo Estatico, 1 Carrossel com ate 10 cards, banners mobile e Desktop e video.');
});
