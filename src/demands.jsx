import React, { useEffect, useState } from 'react';
import { parseDemandConversation } from './demand-conversation.js';
import { SaasAdminShell } from './saas-admin-shell.jsx';

const steps = [
  ['received', 'Recebido', 10], ['waiting_info', 'Aguardando informações', 20], ['queued', 'Na fila', 35],
  ['in_progress', 'Em produção', 65], ['approval', 'Aguardando aprovação', 90], ['changes_requested', 'Alteração solicitada', 70],
  ['approved', 'Aprovado', 100], ['completed', 'Concluído', 100],
];
const categories = { campaign: 'Campanha', organic: 'Orgânico', print: 'Impressão', website: 'Site', video: 'Vídeo', other: 'Outro' };
const templates = {
  campaign: { owner: 'Felipe', items: ['Planejamento e objetivo', 'Copy dos anúncios', 'Criação das peças', 'Configuração da campanha', 'Revisão e publicação'] },
  organic: { owner: 'Felipe', items: ['Pauta e objetivo', 'Copy/roteiro', 'Criação visual', 'Revisão', 'Programação/publicação'] },
  print: { owner: 'Flavio', items: ['Briefing e medidas', 'Conteúdo final', 'Criação da arte', 'Revisão técnica', 'Arquivo para produção'] },
  website: { owner: 'Erica', items: ['Briefing e estrutura', 'Copy e conteúdos', 'Layout', 'Desenvolvimento', 'Revisão e publicação'] },
  video: { owner: 'Flavio', items: ['Briefing/roteiro', 'Seleção do material', 'Edição', 'Legendas e acabamento', 'Exportação final'] },
  other: { owner: '', items: ['Briefing', 'Produção', 'Revisão', 'Entrega'] },
};
const statusMap = Object.fromEntries(steps.map(([key, label, progress]) => [key, { label, progress }]));
const boardColumns = [
  { key: 'intake', label: 'Entrada', hint: 'Recebidas e na fila', statuses: ['received', 'waiting_info', 'queued'] },
  { key: 'production', label: 'Em produção', hint: 'Criação e ajustes', statuses: ['in_progress', 'changes_requested'] },
  { key: 'approval', label: 'Aprovação', hint: 'Aguardando decisão', statuses: ['approval'] },
  { key: 'done', label: 'Finalizadas', hint: 'Entregas aprovadas', statuses: ['approved', 'completed'] },
];
const filterOptions = [
  ['active', 'Ativas'], ['all', 'Todas'], ['intake', 'Entrada'], ['production', 'Em produção'], ['approval', 'Aprovação'], ['changes', 'Alterações'], ['done', 'Aprovadas'],
];
const templateChecklist = (category) => (templates[category]?.items || []).map((title, index) => ({ id: `${category}-${index + 1}`, title, done: false }));
const checklistOf = (demand) => {
  const saved = Array.isArray(demand.checklist)
    ? demand.checklist
    : Array.isArray(demand.metadata?.checklist)
      ? demand.metadata.checklist
      : [];

  // Demandas criadas antes da inclusão do checklist chegam com um array vazio.
  // Exibe o modelo da categoria também nesses cards antigos; no primeiro clique
  // a lista passa a ser persistida normalmente pela mesma ação de salvar.
  return saved.length > 0 ? saved : templateChecklist(demand.category || 'other');
};
const isDone = (demand) => ['approved', 'completed'].includes(demand.status);
const dateBr = (value) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`)) : 'A combinar';
const freshDemand = () => ({ title: '', description: '', category: 'campaign', status: 'received', priority: 'normal', owner: templates.campaign.owner, dueDate: '', waitingFor: '', deliveryUrl: '', clientVisible: true, checklist: templateChecklist('campaign') });
const previewDemands = [
  { id: 'preview-1', title: 'Campanha de Colorimetria', description: 'Nova campanha para captação de alunas.', category: 'campaign', status: 'queued', priority: 'high', owner: 'Felipe', due_date: '2026-08-28', sort_order: 1, checklist: templateChecklist('campaign') },
  { id: 'preview-2', title: 'Página do curso de Corte', description: 'Atualização da estrutura e das informações da turma.', category: 'website', status: 'in_progress', priority: 'normal', owner: 'Erica', due_date: '2026-09-02', sort_order: 2, checklist: templateChecklist('website').map((item, index) => ({ ...item, done: index < 3 })) },
  { id: 'preview-3', title: 'Vídeo da próxima turma', category: 'video', status: 'changes_requested', priority: 'normal', owner: 'Flavio', due_date: '2026-08-30', waiting_for: 'Trocar a cena inicial e ajustar a legenda do valor.', sort_order: 3, checklist: templateChecklist('video').map((item) => ({ ...item, done: true })) },
  { id: 'preview-4', title: 'Criativos de matrícula', category: 'campaign', status: 'approval', priority: 'normal', owner: 'Felipe', due_date: '2026-08-26', delivery_url: 'https://example.com', sort_order: 4, checklist: templateChecklist('campaign').map((item) => ({ ...item, done: true })) },
  { id: 'preview-5', title: 'Folder do curso', category: 'print', status: 'approved', priority: 'normal', owner: 'Flavio', due_date: '2026-08-22', sort_order: 5, checklist: templateChecklist('print').map((item) => ({ ...item, done: true })) },
];

function DemandCard({ demand, editable = false, clientActions = false, busy = false, onEdit, onSave, onDecision, onMove, canMoveUp, canMoveDown }) {
  const stage = statusMap[demand.status] || statusMap.received;
  const checklist = checklistOf(demand);
  const checked = checklist.filter((item) => item.done).length;
  const checklistProgress = checklist.length ? Math.round((checked / checklist.length) * 100) : stage.progress;
  const progress = ['approval', 'approved', 'completed'].includes(demand.status) ? stage.progress : Math.max(stage.progress, checklistProgress);
  const [showChanges, setShowChanges] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const toggle = (id) => onSave?.({ ...demand, checklist: checklist.map((item) => item.id === id ? { ...item, done: !item.done } : item) });
  return <article className={`demandCard demandCard--${demand.status}`}>
    <div className="demandCard__top"><span className="demandCategory">{categories[demand.category] || 'Outro'}</span><span className={`demandStatusPill demandStatusPill--${demand.status}`}>{stage.label}</span></div>
    {demand.priority === 'high' && <span className="demandPriority">Prioridade alta</span>}
    <h3>{demand.title}</h3>{demand.description && <p>{demand.description}</p>}
    {checklist.length > 0 && <div className="demandChecklist" aria-label={`Checklist: ${checked} de ${checklist.length} etapas concluídas`}><div className="demandChecklist__head"><span><strong>{checked} de {checklist.length}</strong> etapas concluídas</span>{checked === checklist.length && <b>✓ Completo</b>}</div><div className="demandChecklist__items">{checklist.map((item) => <label className={`${item.done ? 'done' : ''}${editable ? ' editable' : ''}`} key={item.id}><input type="checkbox" checked={item.done} disabled={!editable || busy} onChange={() => toggle(item.id)} aria-label={`${item.done ? 'Desmarcar' : 'Marcar'} ${item.title}`} /><span>{item.title}</span></label>)}</div></div>}
    <div className="demandProgress" aria-label={`${progress}% concluído`}><span style={{ width: `${progress}%` }} /></div>
    <div className="demandCard__meta"><span><small>Responsável</small><strong>{demand.owner || 'A definir'}</strong></span><span><small>Prazo</small><strong>{dateBr(demand.due_date)}</strong></span></div>
    {demand.waiting_for && <div className="demandWaiting"><b>{demand.status === 'changes_requested' ? 'Alteração solicitada' : 'Aguardando a escola'}</b><span>{demand.waiting_for}</span></div>}
    <div className="demandCard__actions">{demand.delivery_url && <a href={demand.delivery_url} target="_blank" rel="noreferrer">Abrir entrega</a>}{editable && <><button type="button" onClick={() => onEdit(demand)}>Editar</button><button type="button" disabled={!canMoveUp || busy} onClick={() => onMove(demand, -1)}>↑ Subir</button><button type="button" disabled={!canMoveDown || busy} onClick={() => onMove(demand, 1)}>↓ Descer</button></>}</div>
    {editable && !isDone(demand) && <div className="demandWorkflowActions">{['received', 'queued', 'changes_requested'].includes(demand.status) && <button type="button" disabled={busy} onClick={() => onSave({ ...demand, status: 'in_progress', checklist })}>Iniciar produção</button>}{demand.status === 'in_progress' && <button type="button" className="primary" disabled={busy || (checklist.length > 0 && checked !== checklist.length)} onClick={() => onSave({ ...demand, status: 'approval', checklist })}>{checklist.length > 0 && checked !== checklist.length ? 'Conclua o checklist' : 'Enviar para aprovação'}</button>}{demand.status === 'approval' && <span>Aguardando decisão da escola</span>}</div>}
    {clientActions && demand.status === 'approval' && <div className="demandApprovalActions"><button type="button" className="approve" disabled={busy} onClick={() => onDecision(demand, 'approve', '')}>Aprovar entrega</button><button type="button" disabled={busy} onClick={() => setShowChanges(!showChanges)}>Solicitar alteração</button>{showChanges && <form onSubmit={(event) => { event.preventDefault(); onDecision(demand, 'request_changes', changeNote); }}><label>O que precisa ser alterado?<textarea required minLength="3" value={changeNote} onChange={(event) => setChangeNote(event.target.value)} /></label><button type="submit" disabled={busy || changeNote.trim().length < 3}>Enviar solicitação</button></form>}</div>}
  </article>;
}

function DemandBoard({ demands, editable = false, clientActions = false, busyId = '', busyAll = false, onEdit, onSave, onDecision, onMove }) {
  const ordered = [...demands].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  return <div className="demandBoard" aria-label="Esteira de demandas">{boardColumns.map((column) => {
    const items = ordered.filter((item) => column.statuses.includes(item.status));
    return <section className={`demandLane demandLane--${column.key}`} key={column.key}><header><div><span>{column.label}</span><small>{column.hint}</small></div><strong>{items.length}</strong></header><div className="demandLane__cards">{items.length ? items.map((item) => { const globalIndex = ordered.findIndex((demand) => demand.id === item.id); return <DemandCard key={item.id} demand={item} editable={editable} clientActions={clientActions} busy={busyAll || busyId === item.id} canMoveUp={globalIndex > 0} canMoveDown={globalIndex < ordered.length - 1} onEdit={onEdit} onSave={onSave} onDecision={onDecision} onMove={onMove} />; }) : <div className="demandLane__empty">Nenhuma demanda</div>}</div></section>;
  })}</div>;
}

export function DemandsClientPage() {
  const key = new URLSearchParams(window.location.search).get('acesso') || '';
  const preview = (import.meta.env.DEV || import.meta.env.VITE_DEMANDS_PREVIEW === '1') && new URLSearchParams(window.location.search).get('preview') === '1';
  const [state, setState] = useState(preview ? { loading: false, demands: previewDemands, error: '' } : { loading: true, demands: [], error: '' });
  const [busyId, setBusyId] = useState('');
  const load = () => fetch(`/api/health?resource=demands&key=${encodeURIComponent(key)}`).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setState({ loading: false, demands: data.demands || [], error: '' }); }).catch((error) => setState({ loading: false, demands: [], error: error.message }));
  useEffect(() => { if (!preview) load(); }, [key, preview]);
  async function decide(demand, decision, note) { setBusyId(demand.id); try { const response = await fetch(`/api/health?resource=demands&key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: demand.id, decision, note }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); await load(); } catch (error) { setState((old) => ({ ...old, error: error.message })); } finally { setBusyId(''); } }
  if (state.loading) return <section className="demandsPage"><div className="demandsEmpty"><h1>Carregando acompanhamento...</h1></div></section>;
  if (state.error) return <section className="demandsPage"><div className="demandsEmpty"><span>a escola + Agência Cavalheri</span><h1>Este acesso não está disponível.</h1><p>Peça à equipe o link atualizado de acompanhamento.</p></div></section>;
  const active = state.demands.filter((item) => !isDone(item)); const done = state.demands.filter(isDone); const waiting = active.filter((item) => item.status === 'waiting_info');
  const average = state.demands.length ? Math.round(state.demands.reduce((sum, item) => sum + (statusMap[item.status]?.progress || 0), 0) / state.demands.length) : 0;
  return <section className="demandsPage"><header className="demandsHero"><div><span>a escola + Agência Cavalheri</span><h1>Acompanhamento de demandas</h1><p>Acompanhe a produção, confira entregas e aprove ou peça ajustes sem perder o histórico.</p></div><div className="demandsOverall"><strong>{average}%</strong><span>progresso geral</span></div></header>
    <div className="demandsStats"><div><strong>{active.length}</strong><span>em andamento</span></div><div><strong>{waiting.length}</strong><span>aguardando a escola</span></div><div><strong>{done.length}</strong><span>aprovadas</span></div></div>
    <div className="demandsNotice"><b>Como funciona</b><span>A agência organiza a fila e a produção. Quando a entrega estiver pronta, você poderá aprovar ou solicitar uma alteração.</span></div>
    <section className="demandsSection"><div className="demandsSection__title"><span>Visão geral</span><h2>Esteira de demandas</h2></div><DemandBoard demands={state.demands} clientActions busyId={busyId} onDecision={decide} /></section>
  </section>;
}

export function DemandsAdminPage() {
  const [state, setState] = useState({ loading: true, demands: [], error: '' });
  const [form, setForm] = useState(freshDemand); const [saving, setSaving] = useState(false); const [filter, setFilter] = useState('active');
  const [workspaceView, setWorkspaceView] = useState('board');
  const [conversation, setConversation] = useState(''); const [interpreted, setInterpreted] = useState(false);
  const load = () => fetch('/api/admin/summary', { credentials: 'include' }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setState({ loading: false, demands: data.agencyDemands || [], error: '' }); }).catch((error) => setState({ loading: false, demands: [], error: error.message }));
  useEffect(load, []);
  async function saveDemand(demand, reset = false) { setSaving(true); try { const response = await fetch('/api/admin/summary', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'agency_demand_save', demand }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); if (reset) { setForm(freshDemand()); setWorkspaceView('board'); } await load(); } catch (error) { setState((old) => ({ ...old, error: error.message })); } finally { setSaving(false); } }
  async function moveDemand(demand, direction) { const ordered = [...state.demands].sort((a, b) => Number(a.sort_order) - Number(b.sort_order)); const index = ordered.findIndex((item) => item.id === demand.id); const target = ordered[index + direction]; if (!target) return; const currentOrder = Number(demand.sort_order); await saveDemand({ ...demand, checklist: checklistOf(demand), sortOrder: Number(target.sort_order) }); await saveDemand({ ...target, checklist: checklistOf(target), sortOrder: currentOrder }); }
  const visible = state.demands.filter((item) => filter === 'all' || (filter === 'active' ? !isDone(item) : filter === 'done' ? isDone(item) : filter === 'changes' ? item.status === 'changes_requested' : boardColumns.find((column) => column.key === filter)?.statuses.includes(item.status)));
  if (state.loading) return <SaasAdminShell active="demands"><section className="demandsAdmin demandsPage demandsAdmin--saas"><div className="demandsEmpty"><h1>Carregando demandas...</h1></div></section></SaasAdminShell>;
  const edit = (demand) => { setForm({ ...demand, checklist: checklistOf(demand), dueDate: demand.due_date || '', waitingFor: demand.waiting_for || '', deliveryUrl: demand.delivery_url || '', clientVisible: demand.client_visible !== false }); setWorkspaceView('form'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const activeCount = state.demands.filter((item) => !isDone(item)).length;
  const approvalCount = state.demands.filter((item) => item.status === 'approval').length;
  const highCount = state.demands.filter((item) => item.priority === 'high' && !isDone(item)).length;
  const waitingCount = state.demands.filter((item) => ['waiting_info', 'changes_requested'].includes(item.status)).length;
  return <SaasAdminShell active="demands"><section className="demandsAdmin demandsPage demandsAdmin--saas"><header className="demandsAdminHero"><div><p className="eyebrow">Operação</p><h1>Demandas da escola</h1><p>Responsáveis, prazos, entregas e aprovações em uma única esteira.</p></div><div className="demandsSaasActions"><button type="button" className={workspaceView === 'board' ? 'active' : ''} onClick={() => setWorkspaceView('board')}>Esteira</button><button type="button" className={workspaceView === 'form' ? 'active' : ''} onClick={() => { setForm(freshDemand()); setWorkspaceView('form'); }}>+ Nova demanda</button></div></header>
    <div className="demandsSaasStats"><div><span>Em andamento</span><strong>{activeCount}</strong></div><div><span>Aguardando aprovação</span><strong>{approvalCount}</strong></div><div><span>Prioridade alta</span><strong>{highCount}</strong></div><div><span>Precisam de atenção</span><strong>{waitingCount}</strong></div></div>
    {state.error && <div className="demandsNotice demandsNotice--error">Erro: {state.error}</div>}
    {workspaceView === 'form' && <><section className="demandConversation"><div><span>Cadastro rápido</span><h2>Conte a demanda do seu jeito</h2><p>Eu organizo categoria, responsável, prioridade, prazo e checklist. Você revisa antes de salvar.</p></div><label>Descreva a tarefa<textarea value={conversation} onChange={(event) => { setConversation(event.target.value); setInterpreted(false); }} placeholder="Ex.: Criar campanha de matrícula, prioridade alta, responsável Flávio, prazo 28/08." /></label><button type="button" disabled={conversation.trim().length < 3} onClick={() => { setForm({ ...freshDemand(), ...parseDemandConversation(conversation, templates) }); setInterpreted(true); }}>Preencher os campos</button>{interpreted && <strong>Pronto. Revise os campos e salve.</strong>}</section><div className="demandsAdminLayout demandsAdminLayout--form"><form className="demandForm" onSubmit={(event) => { event.preventDefault(); saveDemand(form, true); }}><h2>{form.id ? 'Editar demanda' : 'Nova demanda'}</h2><label>Título<input required minLength="2" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Criativos da campanha de Colorimetria" /></label><label>Descrição<textarea value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><div className="demandForm__row"><label>Categoria<select value={form.category} onChange={(event) => { const category = event.target.value; setForm({ ...form, category, owner: templates[category].owner, checklist: templateChecklist(category) }); }}>{Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{steps.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><div className="demandForm__row"><label>Responsável<input value={form.owner || ''} onChange={(event) => setForm({ ...form, owner: event.target.value })} /></label><label>Prazo<input type="date" value={form.dueDate || form.due_date || ''} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label></div>
      <div className="demandFormChecklist"><div><strong>Checklist da entrega</strong><button type="button" onClick={() => setForm({ ...form, checklist: [...checklistOf(form), { id: `custom-${Date.now()}`, title: '', done: false }] })}>+ Item</button></div>{checklistOf(form).map((item, index) => <div key={item.id}><input aria-label={`Item ${index + 1}`} value={item.title} onChange={(event) => setForm({ ...form, checklist: checklistOf(form).map((current) => current.id === item.id ? { ...current, title: event.target.value } : current) })} /><button type="button" onClick={() => setForm({ ...form, checklist: checklistOf(form).filter((current) => current.id !== item.id) })}>×</button></div>)}</div>
      <label>Aguardando da escola<input value={form.waitingFor || form.waiting_for || ''} onChange={(event) => setForm({ ...form, waitingFor: event.target.value })} /></label><label>Link da entrega<input type="url" value={form.deliveryUrl || form.delivery_url || ''} onChange={(event) => setForm({ ...form, deliveryUrl: event.target.value })} /></label><div className="demandForm__row"><label>Prioridade<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option></select></label><label className="demandCheck"><input type="checkbox" checked={form.clientVisible !== false && form.client_visible !== false} onChange={(event) => setForm({ ...form, clientVisible: event.target.checked })} />Visível para a a escola</label></div><div className="demandForm__actions"><button type="button" onClick={() => { setForm(freshDemand()); setWorkspaceView('board'); }}>Cancelar</button><button className="button button--primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar demanda'}</button></div></form></div></>}
    {workspaceView === 'board' && <div className="demandsAdminList demandsAdminList--full"><div className="demandsListHeading"><div><span>Fluxo de trabalho</span><h2>Esteira das demandas</h2></div><strong>{visible.length} {visible.length === 1 ? 'demanda' : 'demandas'}</strong></div><div className="demandsFilters" aria-label="Filtrar demandas">{filterOptions.map(([value, label]) => <button type="button" className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div>{visible.length ? <DemandBoard demands={visible} editable busyAll={saving} onSave={saveDemand} onMove={moveDemand} onEdit={edit} /> : <p className="demandsEmptyList">Nenhuma demanda nesta visão.</p>}</div>}
  </section></SaasAdminShell>;
}
