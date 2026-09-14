// Painéis do admin (usuários, ofertas, materiais, certificados, selos e benefícios, cupons,
// cursos/turmas, notificações, demandas da agência, lista de espera). Extraído de
// src/main.jsx (organização de arquivos pedida pela Erica, 05/09/2026).
import { useEffect, useState } from 'react';
import { postJson, patchJson } from '../lib/api.js';
import { initials, money } from '../lib/format.js';
import { useCatalog } from '../lib/catalog-context.js';
import { classCapacity, displayPrice, displayPriceNumber } from '../lib/catalog-helpers.js';
import { AdminFileField } from '../components/shared.jsx';

const adminRoleLabels = { owner: 'Dono(a)', comercial: 'Comercial', atendimento: 'Atendimento', academico: 'Acadêmico', marketing: 'Marketing' };


export function AdminUsersPanel() {
  const [state, setState] = useState({ loading: true, users: [], error: '' });
  const [selectedUserId, setSelectedUserId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const emptyUserForm = { username: '', name: '', role: 'comercial', password: '' };
  const [form, setForm] = useState(emptyUserForm);
  const [formStatus, setFormStatus] = useState({ loading: false, error: '', success: '' });

  async function loadUsers() {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await fetch('/api/admin/users', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) { setState({ loading: false, users: [], error: 'forbidden' }); return; }
      if (!response.ok || !data.ok) throw new Error(data.error || 'users_failed');
      setState({ loading: false, users: data.users || [], error: '' });
    } catch (error) {
      setState({ loading: false, users: [], error: error.message || 'users_failed' });
    }
  }

  useEffect(() => { loadUsers(); }, []);

  async function createUser(event) {
    event.preventDefault();
    setFormStatus({ loading: true, error: '', success: '' });
    try {
      const result = await postJson('/api/admin/users', form);
      setFormStatus({ loading: false, error: '', success: `Usuário ${result.user?.username || ''} criado.` });
      setForm(emptyUserForm);
      setShowForm(false);
      loadUsers();
    } catch (error) {
      const messages = {
        invalid_admin_user_payload: 'Confira os campos — senha precisa de 12 ou mais caracteres.',
        username_already_exists: 'Já existe um usuário com esse username.',
        forbidden: 'Você não tem permissão para criar usuários.',
      };
      setFormStatus({ loading: false, error: messages[error.message] || 'Não consegui criar o usuário agora.', success: '' });
    }
  }

  async function toggleStatus(user) {
    try {
      await patchJson('/api/admin/users', { id: user.id, status: user.status === 'active' ? 'disabled' : 'active' });
      loadUsers();
    } catch {
      // silencioso: a lista recarrega e mostra o estado real na próxima tentativa.
    }
  }

  if (state.loading) return <div className="adminPanelCard"><p>Carregando usuários...</p></div>;
  if (state.error === 'forbidden') return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Usuários</p><h2>Acesso restrito</h2></div><p>Somente o papel "Dono(a)" pode gerenciar usuários administrativos.</p></div></div>;

  const selectedUser = state.users.find((user) => user.id === selectedUserId) || null;
  return <div className="adminPanelCard"><p className="adminCardIntro">Cada pessoa entra com o próprio usuário e senha. O papel decide o que ela pode ver e fazer — nunca mais uma senha única compartilhada.</p>
    <div className="adminCompactList">{state.users.length ? state.users.map((user) => <button type="button" key={user.id} className={selectedUserId === user.id ? 'adminCompactRow adminCompactRow--active' : 'adminCompactRow'} onClick={() => setSelectedUserId(user.id)}>
      <span className="adminAvatar">{initials(user.name)}</span>
      <span className="adminCompactRow__main"><strong>{user.name}</strong><small>{user.username} · {adminRoleLabels[user.role] || user.role}</small></span>
      <span className={user.status === 'active' ? 'adminStatus' : 'adminStatus adminStatus--warn'}>{user.status === 'active' ? 'Ativo' : 'Desativado'}</span>
      <span className="adminCompactRow__chevron">›</span>
    </button>) : <div className="adminEmptyState"><strong>Nenhum usuário cadastrado ainda.</strong></div>}</div>
    {selectedUser && <div className="crmDrawerOverlay" role="presentation" onClick={() => setSelectedUserId('')}><aside className="crmOpportunityDrawer" aria-label="Detalhe do usuário" onClick={(event) => event.stopPropagation()}>
      <button className="crmDrawerClose" type="button" onClick={() => setSelectedUserId('')} aria-label="Fechar detalhes">×</button>
      <div className="crmOpportunityDrawer__head"><span className={selectedUser.status === 'active' ? 'adminStatus' : 'adminStatus adminStatus--warn'}>{selectedUser.status === 'active' ? 'Ativo' : 'Desativado'}</span><h2>{selectedUser.name}</h2><p>{selectedUser.username}</p></div>
      <div className="crmOpportunityFacts">
        <div><span>Papel</span><strong>{adminRoleLabels[selectedUser.role] || selectedUser.role}</strong></div>
        <div><span>Último acesso</span><strong>{selectedUser.last_login_at ? new Date(selectedUser.last_login_at).toLocaleString('pt-BR') : 'Nunca acessou'}</strong></div>
      </div>
      <button type="button" className="button button--outline adminFullButton" onClick={() => toggleStatus(selectedUser)}>{selectedUser.status === 'active' ? 'Desativar' : 'Reativar'}</button>
    </aside></div>}
    <div className="adminFormSection">
      <button type="button" className="button button--outline adminFormSection__toggle" onClick={() => setShowForm((v) => !v)}>{showForm ? '– Cancelar' : '+ Adicionar usuário'}</button>
      {showForm && <form className="adminForm" onSubmit={createUser}><h3>Adicionar usuário</h3>
        <label htmlFor="newUserUsername">Usuário (login)<input id="newUserUsername" required value={form.username} onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value.toLowerCase() }))} placeholder="gabi" /></label>
        <label htmlFor="newUserName">Nome<input id="newUserName" required value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Gabi Gusmão" /></label>
        <label htmlFor="newUserRole">Papel<select id="newUserRole" value={form.role} onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}>{Object.entries(adminRoleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label htmlFor="newUserPassword">Senha provisória (12+ caracteres)<input id="newUserPassword" type="password" required minLength="12" value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} placeholder="Combine com a pessoa e troque depois" /></label>
        {formStatus.error && <div className="formAlert formAlert--error">{formStatus.error}</div>}
        {formStatus.success && <div className="formAlert formAlert--success">{formStatus.success}</div>}
        <button type="submit" className="button button--primary" disabled={formStatus.loading}>{formStatus.loading ? 'Criando...' : 'Criar usuário'}</button>
      </form>}
      {formStatus.success && !showForm && <div className="formAlert formAlert--success">{formStatus.success}</div>}
    </div>
  </div>;
}

export function AdminOffersPanel() {
  const catalog = useCatalog();
  const eligibleCourses = (catalog || []).filter((course) => !course.hiddenFromAgenda && (course.flow || 'asaas') !== 'voomp');
  const [state, setState] = useState({ loading: true, offers: [], error: '' });
  const [selectedOfferId, setSelectedOfferId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const emptyOfferForm = { sourceCourseSlug: '', targetCourseSlug: '', title: '', discountType: 'percent', discountValue: '20' };
  const [form, setForm] = useState(emptyOfferForm);
  const [formStatus, setFormStatus] = useState({ loading: false, error: '', success: '' });

  async function loadOffers() {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await fetch('/api/admin/upsell-offers', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) { setState({ loading: false, offers: [], error: 'forbidden' }); return; }
      if (!response.ok || !data.ok) throw new Error(data.error || 'offers_failed');
      setState({ loading: false, offers: data.offers || [], error: '' });
    } catch (error) {
      setState({ loading: false, offers: [], error: error.message || 'offers_failed' });
    }
  }

  useEffect(() => { loadOffers(); }, []);

  async function createOffer(event) {
    event.preventDefault();
    setFormStatus({ loading: true, error: '', success: '' });
    try {
      await postJson('/api/admin/upsell-offers', { ...form, discountValue: Number(form.discountValue) });
      setFormStatus({ loading: false, error: '', success: 'Oferta criada e já ativa.' });
      setForm(emptyOfferForm);
      setShowForm(false);
      loadOffers();
    } catch (error) {
      const messages = {
        invalid_upsell_offer_payload: 'Confira os campos — os cursos precisam ser diferentes e o desconto maior que zero.',
        upsell_offer_pair_already_exists: 'Já existe uma oferta cadastrada para esse par de cursos.',
        course_not_found: 'Curso não encontrado no catálogo.',
      };
      setFormStatus({ loading: false, error: messages[error.message] || 'Não consegui criar a oferta agora.', success: '' });
    }
  }

  async function toggleOffer(offer) {
    try {
      await patchJson('/api/admin/upsell-offers', { id: offer.id, status: offer.status === 'active' ? 'archived' : 'active' });
      loadOffers();
    } catch {
      // silencioso: a lista recarrega e mostra o estado real na próxima tentativa.
    }
  }

  function courseName(slug) {
    return eligibleCourses.find((course) => course.slug === slug)?.name || slug;
  }

  if (state.loading) return <div className="adminPanelCard"><p>Carregando ofertas...</p></div>;
  if (state.error === 'forbidden') return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Ofertas</p><h2>Acesso restrito</h2></div><p>Somente os papéis "Dono(a)" e "Comercial" podem gerenciar ofertas.</p></div></div>;

  const offerLabel = (offer) => (offer.discount_type === 'fixed' ? money(Math.round(offer.discount_value * 100)) : `${offer.discount_value}%`);
  const selectedOffer2 = state.offers.find((offer) => offer.id === selectedOfferId) || null;
  return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Vendas</p><h2>Oferta de curso adicional</h2></div><p>Quando ativa, aparece no checkout do curso principal como "quero levar também". Sem oferta cadastrada para o par de cursos, a opção não aparece — isso é proposital (regra P1.2 do Manual do produto).</p></div>
    <div className="adminCompactList">{state.offers.length ? state.offers.map((offer) => <button type="button" key={offer.id} className={selectedOfferId === offer.id ? 'adminCompactRow adminCompactRow--active' : 'adminCompactRow'} onClick={() => setSelectedOfferId(offer.id)}>
      <span className="adminAvatar">{initials(offer.title || courseName(offer.target_course_slug))}</span>
      <span className="adminCompactRow__main"><strong>{courseName(offer.source_course_slug)} → {courseName(offer.target_course_slug)}</strong><small>{offer.title} · {offerLabel(offer)}</small></span>
      <span className={offer.status === 'active' ? 'adminStatus' : 'adminStatus adminStatus--warn'}>{offer.status === 'active' ? 'Ativa' : offer.status === 'draft' ? 'Rascunho' : 'Arquivada'}</span>
      <span className="adminCompactRow__chevron">›</span>
    </button>) : <div className="adminEmptyState"><strong>Nenhuma oferta cadastrada ainda.</strong></div>}</div>
    {selectedOffer2 && <div className="crmDrawerOverlay" role="presentation" onClick={() => setSelectedOfferId('')}><aside className="crmOpportunityDrawer" aria-label="Detalhe da oferta" onClick={(event) => event.stopPropagation()}>
      <button className="crmDrawerClose" type="button" onClick={() => setSelectedOfferId('')} aria-label="Fechar detalhes">×</button>
      <div className="crmOpportunityDrawer__head"><span className={selectedOffer2.status === 'active' ? 'adminStatus' : 'adminStatus adminStatus--warn'}>{selectedOffer2.status === 'active' ? 'Ativa' : selectedOffer2.status === 'draft' ? 'Rascunho' : 'Arquivada'}</span><h2>{selectedOffer2.title}</h2><p>{courseName(selectedOffer2.source_course_slug)} → {courseName(selectedOffer2.target_course_slug)}</p></div>
      <div className="crmOpportunityFacts">
        <div><span>Desconto</span><strong>{offerLabel(selectedOffer2)}</strong></div>
      </div>
      <button type="button" className="button button--outline adminFullButton" onClick={() => toggleOffer(selectedOffer2)}>{selectedOffer2.status === 'active' ? 'Arquivar' : 'Ativar'}</button>
    </aside></div>}
    <div className="adminFormSection">
      <button type="button" className="button button--outline adminFormSection__toggle" onClick={() => setShowForm((v) => !v)}>{showForm ? '– Cancelar' : '+ Nova oferta'}</button>
      {showForm && <form className="adminForm" onSubmit={createOffer}><h3>Nova oferta</h3>
        <label htmlFor="offerSource">Curso principal<select id="offerSource" required value={form.sourceCourseSlug} onChange={(e) => setForm((prev) => ({ ...prev, sourceCourseSlug: e.target.value }))}><option value="">Selecione...</option>{eligibleCourses.map((course) => <option key={course.slug} value={course.slug}>{course.name}</option>)}</select></label>
        <label htmlFor="offerTarget">Curso adicional (com desconto)<select id="offerTarget" required value={form.targetCourseSlug} onChange={(e) => setForm((prev) => ({ ...prev, targetCourseSlug: e.target.value }))}><option value="">Selecione...</option>{eligibleCourses.map((course) => <option key={course.slug} value={course.slug}>{course.name}</option>)}</select></label>
        <label htmlFor="offerTitle">Título da oferta<input id="offerTitle" required value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Ex: Leve Escova Modelada com desconto" /></label>
        <label htmlFor="offerDiscountType">Tipo de desconto<select id="offerDiscountType" value={form.discountType} onChange={(e) => setForm((prev) => ({ ...prev, discountType: e.target.value }))}><option value="percent">Porcentagem (%)</option><option value="fixed">Valor fixo (R$)</option></select></label>
        <label htmlFor="offerDiscountValue">{form.discountType === 'fixed' ? 'Valor do desconto (R$)' : 'Desconto (%)'}<input id="offerDiscountValue" type="number" min="1" step="0.01" required value={form.discountValue} onChange={(e) => setForm((prev) => ({ ...prev, discountValue: e.target.value }))} /></label>
        {formStatus.error && <div className="formAlert formAlert--error">{formStatus.error}</div>}
        {formStatus.success && <div className="formAlert formAlert--success">{formStatus.success}</div>}
        <button type="submit" className="button button--primary" disabled={formStatus.loading}>{formStatus.loading ? 'Criando...' : 'Criar oferta'}</button>
      </form>}
      {formStatus.success && !showForm && <div className="formAlert formAlert--success">{formStatus.success}</div>}
    </div>
  </div>;
}

const contentTypeLabels = { video: 'Vídeo', pdf: 'PDF', link: 'Link', texto: 'Texto' };
const materialStatusLabels = { draft: 'Rascunho', published: 'Publicado', archived: 'Arquivado' };

export function AdminMaterialsPanel() {
  const catalog = useCatalog();
  const courses = (catalog || []).filter((course) => !course.hiddenFromAgenda);
  const [state, setState] = useState({ loading: true, items: [], error: '' });
  const [selectedMaterialId, setSelectedMaterialId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const emptyMaterialForm = { courseSlug: '', classDate: '', title: '', description: '', contentType: 'link', externalUrl: '', filePath: '', fileData: '', fileName: '', fileError: '' };
  const [form, setForm] = useState(emptyMaterialForm);
  const [formStatus, setFormStatus] = useState({ loading: false, error: '', success: '' });
  // Publicar junto com o cadastro, marcado por padrão. O material nascia sempre como rascunho e
  // só ia pra Minha Área depois de abrir a linha e clicar em "Publicar" — a Erica cadastrou
  // material, foi apresentar o sistema e ele não estava lá (09/09/2026). Quem quiser preparar
  // material antes da aula é só desmarcar.
  const [publicarAgora, setPublicarAgora] = useState(true);

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await fetch('/api/admin/course-content', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) { setState({ loading: false, items: [], error: 'forbidden' }); return; }
      if (!response.ok || !data.ok) throw new Error(data.error || 'course_content_failed');
      setState({ loading: false, items: data.items || [], error: '' });
    } catch (error) {
      setState({ loading: false, items: [], error: error.message || 'course_content_failed' });
    }
  }
  useEffect(() => { load(); }, []);

  async function createItem(event) {
    event.preventDefault();
    setFormStatus({ loading: true, error: '', success: '' });
    try {
      const criado = await postJson('/api/admin/course-content', form);
      if (publicarAgora && criado?.item?.id) {
        await patchJson('/api/admin/course-content', { id: criado.item.id, status: 'published' });
      }
      setFormStatus({
        loading: false,
        error: '',
        success: publicarAgora
          ? 'Material cadastrado e publicado — já aparece na Minha Área das alunas dessa turma.'
          : 'Material salvo como rascunho. Ele só aparece pra aluna depois que você publicar.',
      });
      setForm(emptyMaterialForm);
      setShowForm(false);
      load();
    } catch (error) {
      const messages = {
        invalid_course_content_payload: 'Preencha curso, título, tipo e um link, arquivo ou caminho de arquivo.',
        course_not_found: 'Curso não encontrado no catálogo.',
        invalid_file: 'Arquivo inválido — envie PDF, JPG, PNG ou WEBP.',
        file_too_large: 'Arquivo maior que 3MB. Escolha um arquivo menor.',
        storage_not_configured: 'Upload de arquivo ainda não está configurado. Use o link externo por enquanto.',
      };
      setFormStatus({ loading: false, error: messages[error.message] || 'Não consegui cadastrar o material agora.', success: '' });
    }
  }

  async function toggleStatus(item) {
    try {
      await patchJson('/api/admin/course-content', { id: item.id, status: item.status === 'published' ? 'archived' : 'published' });
      load();
    } catch { /* silencioso: a lista recarrega e mostra o estado real na próxima tentativa. */ }
  }

  function courseName(slug) { return courses.find((c) => c.slug === slug)?.name || slug; }

  if (state.loading) return <div className="adminPanelCard"><p>Carregando materiais...</p></div>;
  if (state.error === 'forbidden') return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Materiais</p><h2>Acesso restrito</h2></div><p>Somente os papéis "Dono(a)" e "Acadêmico" podem gerenciar materiais.</p></div></div>;

  const selectedMaterial = state.items.find((item) => item.id === selectedMaterialId) || null;
  const rascunhos = state.items.filter((item) => item.status !== 'published');
  return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Operação</p><h2>Materiais do curso</h2></div><p>Cadastre apostilas, vídeos e links por curso/turma. Só material <strong>publicado</strong> aparece na Minha Área da aluna.</p></div>
    {/* Aviso de rascunho no topo: era o que faltava pra ninguém achar que cadastrou e acabou. */}
    {rascunhos.length > 0 && <div className="adminDraftWarning" role="status">
      <strong>{rascunhos.length} material{rascunhos.length === 1 ? '' : 'is'} ainda não publicado{rascunhos.length === 1 ? '' : 's'}</strong>
      <p>Nenhuma aluna está vendo {rascunhos.length === 1 ? 'ele' : 'eles'}. Clique em <em>publicar</em> na linha para liberar.</p>
    </div>}
    <div className="adminCompactList">{state.items.length ? state.items.map((item) => <div key={item.id} className={selectedMaterialId === item.id ? 'adminCompactRow adminCompactRow--active adminCompactRow--static' : 'adminCompactRow adminCompactRow--static'}>
      <button type="button" className="adminCompactRow__open" onClick={() => setSelectedMaterialId(item.id)}>
        <span className="adminAvatar">{initials(item.title)}</span>
        <span className="adminCompactRow__main"><strong>{item.title}</strong><small>{courseName(item.course_slug)}{item.class_date ? ` · ${item.class_date}` : ' · todas as turmas'} · {contentTypeLabels[item.content_type] || item.content_type}</small></span>
      </button>
      <span className={item.status === 'published' ? 'adminStatus adminStatus--success' : 'adminStatus adminStatus--warn'}>{materialStatusLabels[item.status] || item.status}</span>
      <button type="button" className={item.status === 'published' ? 'linkButton mutedAction' : 'linkButton'} onClick={() => toggleStatus(item)}>{item.status === 'published' ? 'arquivar' : 'publicar'}</button>
    </div>) : <div className="adminEmptyState"><strong>Nenhum material cadastrado ainda.</strong></div>}</div>
    {selectedMaterial && <div className="crmDrawerOverlay" role="presentation" onClick={() => setSelectedMaterialId('')}><aside className="crmOpportunityDrawer" aria-label="Detalhe do material" onClick={(event) => event.stopPropagation()}>
      <button className="crmDrawerClose" type="button" onClick={() => setSelectedMaterialId('')} aria-label="Fechar detalhes">×</button>
      <div className="crmOpportunityDrawer__head"><span className={selectedMaterial.status === 'published' ? 'adminStatus' : 'adminStatus adminStatus--warn'}>{materialStatusLabels[selectedMaterial.status] || selectedMaterial.status}</span><h2>{selectedMaterial.title}</h2><p>{courseName(selectedMaterial.course_slug)}{selectedMaterial.class_date ? ` · ${selectedMaterial.class_date}` : ''}</p></div>
      <div className="crmOpportunityFacts">
        <div><span>Tipo</span><strong>{contentTypeLabels[selectedMaterial.content_type] || selectedMaterial.content_type}</strong></div>
        {selectedMaterial.description && <div><span>Descrição</span><strong>{selectedMaterial.description}</strong></div>}
      </div>
      <button type="button" className="button button--outline adminFullButton" onClick={() => toggleStatus(selectedMaterial)}>{selectedMaterial.status === 'published' ? 'Arquivar' : 'Publicar'}</button>
    </aside></div>}
    <div className="adminFormSection">
      <button type="button" className="button button--outline adminFormSection__toggle" onClick={() => setShowForm((v) => !v)}>{showForm ? '– Cancelar' : '+ Novo material'}</button>
      {showForm && <form className="adminForm" onSubmit={createItem}><h3>Novo material</h3>
        <label htmlFor="materialCourse">Curso<select id="materialCourse" required value={form.courseSlug} onChange={(e) => setForm((prev) => ({ ...prev, courseSlug: e.target.value }))}><option value="">Selecione...</option>{courses.map((course) => <option key={course.slug} value={course.slug}>{course.name}</option>)}</select></label>
        <label htmlFor="materialClassDate">Turma (opcional, deixe vazio pra valer pra todas)<input id="materialClassDate" value={form.classDate} onChange={(e) => setForm((prev) => ({ ...prev, classDate: e.target.value }))} placeholder="Ex: 14 de Setembro a 26 de Outubro de 2026" /></label>
        <label htmlFor="materialTitle">Título<input id="materialTitle" required value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Ex: Apostila módulo 1" /></label>
        <label htmlFor="materialDescription">Descrição (opcional)<input id="materialDescription" value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} /></label>
        <label htmlFor="materialType">Tipo<select id="materialType" value={form.contentType} onChange={(e) => setForm((prev) => ({ ...prev, contentType: e.target.value }))}><option value="link">Link</option><option value="video">Vídeo</option><option value="pdf">PDF</option><option value="texto">Texto</option></select></label>
        <AdminFileField id="materialFile" label="Arquivo (PDF ou imagem, até 3MB)" value={form.fileData} fileName={form.fileName} error={form.fileError} onChange={(dataUrl, name, error) => setForm((prev) => ({ ...prev, fileData: dataUrl || '', fileName: name, fileError: error }))} />
        {!form.fileData && <label htmlFor="materialUrl">Ou link externo (YouTube, Drive etc.)<input id="materialUrl" value={form.externalUrl} onChange={(e) => setForm((prev) => ({ ...prev, externalUrl: e.target.value }))} placeholder="https://..." /></label>}
        {!form.fileData && <label htmlFor="materialFilePath">Ou caminho de arquivo já hospedado<input id="materialFilePath" value={form.filePath} onChange={(e) => setForm((prev) => ({ ...prev, filePath: e.target.value }))} placeholder="/materiais/apostila.pdf" /></label>}
        <label className="adminCheckboxLine" htmlFor="materialPublicar"><input id="materialPublicar" type="checkbox" checked={publicarAgora} onChange={(e) => setPublicarAgora(e.target.checked)} /> <span>Publicar agora para as alunas dessa turma<small>Desmarque só se quiser deixar o material pronto e liberar depois.</small></span></label>
        {formStatus.error && <div className="formAlert formAlert--error">{formStatus.error}</div>}
        {formStatus.success && <div className="formAlert formAlert--success">{formStatus.success}</div>}
        <button type="submit" className="button button--primary" disabled={formStatus.loading}>{formStatus.loading ? 'Cadastrando...' : publicarAgora ? 'Cadastrar e publicar' : 'Salvar como rascunho'}</button>
      </form>}
      {formStatus.success && !showForm && <div className="formAlert formAlert--success">{formStatus.success}</div>}
    </div>
  </div>;
}

const certificateStatusLabels = { draft: 'Rascunho', issued: 'Emitido', released: 'Liberado' };

export function AdminCertificatesPanel() {
  const catalog = useCatalog();
  const courses = (catalog || []).filter((course) => !course.hiddenFromAgenda);
  const [state, setState] = useState({ loading: true, items: [], error: '' });
  const [selectedCertificateId, setSelectedCertificateId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const emptyCertificateForm = { studentEmail: '', courseSlug: '', classDate: '', title: '', filePath: '', fileData: '', fileName: '', fileError: '' };
  const [form, setForm] = useState(emptyCertificateForm);
  const [formStatus, setFormStatus] = useState({ loading: false, error: '', success: '' });

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await fetch('/api/admin/certificates', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) { setState({ loading: false, items: [], error: 'forbidden' }); return; }
      if (!response.ok || !data.ok) throw new Error(data.error || 'certificate_failed');
      setState({ loading: false, items: data.items || [], error: '' });
    } catch (error) {
      setState({ loading: false, items: [], error: error.message || 'certificate_failed' });
    }
  }
  useEffect(() => { load(); }, []);

  async function createItem(event) {
    event.preventDefault();
    setFormStatus({ loading: true, error: '', success: '' });
    try {
      await postJson('/api/admin/certificates', form);
      setFormStatus({ loading: false, error: '', success: 'Certificado registrado como rascunho.' });
      setForm(emptyCertificateForm);
      setShowForm(false);
      load();
    } catch (error) {
      const messages = {
        invalid_certificate_payload: 'Preencha email da aluna, curso, título e anexe ou informe o arquivo do certificado.',
        student_not_found: 'Não encontrei nenhuma aluna com esse email.',
        invalid_file: 'Arquivo inválido — envie PDF, JPG, PNG ou WEBP.',
        file_too_large: 'Arquivo maior que 3MB. Escolha um arquivo menor.',
        storage_not_configured: 'Upload de arquivo ainda não está configurado. Use o link/caminho por enquanto.',
      };
      setFormStatus({ loading: false, error: messages[error.message] || 'Não consegui registrar o certificado agora.', success: '' });
    }
  }

  async function advanceStatus(item) {
    const next = item.status === 'draft' ? 'issued' : item.status === 'issued' ? 'released' : null;
    if (!next) return;
    try {
      await patchJson('/api/admin/certificates', { id: item.id, status: next });
      load();
    } catch { /* silencioso: a lista recarrega e mostra o estado real na próxima tentativa. */ }
  }

  // Recolher: o status só andava pra frente, então um certificado liberado por engano — ou com
  // o arquivo errado — ficava na Minha Área da aluna sem jeito de tirar pelo painel (achado da
  // Erica, 10/09/2026). Volta pra rascunho: some da área da aluna e nada é apagado.
  async function recolher(item) {
    if (!window.confirm(`Recolher o certificado de ${item.student_name || 'a aluna'}? Ele sai da Minha Área dela e volta pra rascunho — nada é apagado, dá pra liberar de novo depois.`)) return;
    try {
      await patchJson('/api/admin/certificates', { id: item.id, status: 'draft' });
      load();
    } catch { /* silencioso: a lista recarrega e mostra o estado real na próxima tentativa. */ }
  }

  function courseName(slug) { return courses.find((c) => c.slug === slug)?.name || slug; }

  if (state.loading) return <div className="adminPanelCard"><p>Carregando certificados...</p></div>;
  if (state.error === 'forbidden') return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Certificados</p><h2>Acesso restrito</h2></div><p>Somente os papéis "Dono(a)" e "Acadêmico" podem gerenciar certificados.</p></div></div>;

  const selectedCertificate = state.items.find((item) => item.id === selectedCertificateId) || null;
  return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Operação</p><h2>Certificados</h2></div><p>Registre o certificado de uma aluna e libere quando estiver pronto — a liberação aparece na Minha Área dela.</p></div>
    <div className="adminCompactList">{state.items.length ? state.items.map((item) => <button type="button" key={item.id} className={selectedCertificateId === item.id ? 'adminCompactRow adminCompactRow--active' : 'adminCompactRow'} onClick={() => setSelectedCertificateId(item.id)}>
      <span className="adminAvatar">{initials(item.student_name || item.student_email)}</span>
      <span className="adminCompactRow__main"><strong>{item.student_name || 'Aluna'}</strong><small>{courseName(item.course_slug)} · {item.title}</small></span>
      <span className={item.status === 'released' ? 'adminStatus' : 'adminStatus adminStatus--warn'}>{certificateStatusLabels[item.status] || item.status}</span>
      <span className="adminCompactRow__chevron">›</span>
    </button>) : <div className="adminEmptyState"><strong>Nenhum certificado registrado ainda.</strong></div>}</div>
    {selectedCertificate && <div className="crmDrawerOverlay" role="presentation" onClick={() => setSelectedCertificateId('')}><aside className="crmOpportunityDrawer" aria-label="Detalhe do certificado" onClick={(event) => event.stopPropagation()}>
      <button className="crmDrawerClose" type="button" onClick={() => setSelectedCertificateId('')} aria-label="Fechar detalhes">×</button>
      <div className="crmOpportunityDrawer__head"><span className={selectedCertificate.status === 'released' ? 'adminStatus' : 'adminStatus adminStatus--warn'}>{certificateStatusLabels[selectedCertificate.status] || selectedCertificate.status}</span><h2>{selectedCertificate.student_name || 'Aluna'}</h2><p>{selectedCertificate.student_email}</p></div>
      <div className="crmOpportunityFacts">
        <div><span>Curso</span><strong>{courseName(selectedCertificate.course_slug)}</strong>{selectedCertificate.class_date && <small>{selectedCertificate.class_date}</small>}</div>
        <div><span>Certificado</span><strong>{selectedCertificate.title}</strong></div>
      </div>
      <div><span className="mini-label">ONDE ABRE</span><p className="adminFormHint">{selectedCertificate.file_path?.startsWith('/certificado/') ? `Documento montado pela escola, com código de validação: ${selectedCertificate.file_path}` : selectedCertificate.file_path ? `Arquivo próprio: ${selectedCertificate.file_path}` : 'Sem endereço registrado — recolha e cadastre de novo pra gerar o código de validação.'}</p></div>
      {selectedCertificate.status !== 'released' && <button type="button" className="button button--outline adminFullButton" onClick={() => advanceStatus(selectedCertificate)}>{selectedCertificate.status === 'draft' ? 'Marcar emitido' : 'Liberar pra aluna'}</button>}
      {selectedCertificate.status !== 'draft' && <button type="button" className="button button--outline adminFullButton" onClick={() => recolher(selectedCertificate)}>Recolher (voltar pra rascunho)</button>}
    </aside></div>}
    <div className="adminFormSection">
      <button type="button" className="button button--outline adminFormSection__toggle" onClick={() => setShowForm((v) => !v)}>{showForm ? '– Cancelar' : '+ Novo certificado'}</button>
      {showForm && <form className="adminForm" onSubmit={createItem}><h3>Novo certificado</h3>
        <label htmlFor="certStudentEmail">Email da aluna<input id="certStudentEmail" type="email" required value={form.studentEmail} onChange={(e) => setForm((prev) => ({ ...prev, studentEmail: e.target.value }))} placeholder="aluna@email.com" /></label>
        <label htmlFor="certCourse">Curso<select id="certCourse" required value={form.courseSlug} onChange={(e) => setForm((prev) => ({ ...prev, courseSlug: e.target.value }))}><option value="">Selecione...</option>{courses.map((course) => <option key={course.slug} value={course.slug}>{course.name}</option>)}</select></label>
        <label htmlFor="certClassDate">Turma (opcional)<input id="certClassDate" value={form.classDate} onChange={(e) => setForm((prev) => ({ ...prev, classDate: e.target.value }))} /></label>
        <label htmlFor="certTitle">Título do certificado<input id="certTitle" required value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Ex: Certificado de Conclusão — Escovista Profissional" /></label>
        <p className="adminFormHint">O arquivo é opcional. Sem arquivo, a a escola monta o certificado com os dados da aluna e o botão dela abre esse documento — com código de validação no rodapé, do mesmo jeito que o certificado automático. Anexe um arquivo só se a arte já estiver pronta.</p>
        <AdminFileField id="certFile" label="Arquivo do certificado (opcional — PDF ou imagem, até 3MB)" value={form.fileData} fileName={form.fileName} error={form.fileError} onChange={(dataUrl, name, error) => setForm((prev) => ({ ...prev, fileData: dataUrl || '', fileName: name, fileError: error }))} />
        {!form.fileData && <label htmlFor="certFilePath">Ou link de um arquivo já hospedado (opcional)<input id="certFilePath" value={form.filePath} onChange={(e) => setForm((prev) => ({ ...prev, filePath: e.target.value }))} placeholder="https://..." /></label>}
        {formStatus.error && <div className="formAlert formAlert--error">{formStatus.error}</div>}
        {formStatus.success && <div className="formAlert formAlert--success">{formStatus.success}</div>}
        <button type="submit" className="button button--primary" disabled={formStatus.loading}>{formStatus.loading ? 'Registrando...' : 'Registrar certificado'}</button>
      </form>}
      {formStatus.success && !showForm && <div className="formAlert formAlert--success">{formStatus.success}</div>}
    </div>
  </div>;
}

const badgeBenefitTypeLabels = { discount_percent: 'Desconto', free_class: 'Aula online grátis', experience: 'Vivência/visita', gift: 'Brinde', other: 'Outro' };

export function AdminBadgeBenefitsPanel() {
  const [state, setState] = useState({ loading: true, items: [], error: '' });
  const [selectedBadgeId, setSelectedBadgeId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const emptyBadgeForm = { badgeKey: '', badgeLabel: '', benefitType: 'other', benefitDetail: '', discountPercent: '' };
  const [form, setForm] = useState(emptyBadgeForm);
  const [badgeKeyChoice, setBadgeKeyChoice] = useState('');
  const [formStatus, setFormStatus] = useState({ loading: false, error: '', success: '' });
  const automaticBadgeKeys = [
    { value: 'new_course', label: 'new_course — primeira matrícula paga (automático)' },
    { value: 'class_attendance', label: 'class_attendance — check-in confirmado na aula (automático)' },
    { value: 'course_review', label: 'course_review — avaliação do curso enviada (automático)' },
  ];

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await fetch('/api/admin/badge-benefits', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) { setState({ loading: false, items: [], error: 'forbidden' }); return; }
      if (!response.ok || !data.ok) throw new Error(data.error || 'badge_benefit_failed');
      setState({ loading: false, items: data.items || [], error: '' });
    } catch (error) {
      setState({ loading: false, items: [], error: error.message || 'badge_benefit_failed' });
    }
  }
  useEffect(() => { load(); }, []);

  async function createItem(event) {
    event.preventDefault();
    setFormStatus({ loading: true, error: '', success: '' });
    try {
      await postJson('/api/admin/badge-benefits', { ...form, discountPercent: form.discountPercent ? Number(form.discountPercent) : undefined });
      setFormStatus({ loading: false, error: '', success: 'Benefício salvo — já aparece na Minha Área de quem tiver esse selo aprovado.' });
      setForm(emptyBadgeForm);
      setBadgeKeyChoice('');
      setShowForm(false);
      load();
    } catch (error) {
      const messages = { invalid_badge_benefit_payload: 'Preencha a chave do selo, o nome do selo e o tipo de benefício.', invalid_discount_percent: 'Pra desconto, informe um percentual entre 1 e 100.' };
      setFormStatus({ loading: false, error: messages[error.message] || 'Não consegui salvar o benefício agora.', success: '' });
    }
  }

  async function toggleStatus(item) {
    try {
      await patchJson('/api/admin/badge-benefits', { id: item.id, status: item.status === 'active' ? 'archived' : 'active' });
      load();
    } catch { /* silencioso: a lista recarrega e mostra o estado real na próxima tentativa. */ }
  }

  if (state.loading) return <div className="adminPanelCard"><p>Carregando selos...</p></div>;
  if (state.error === 'forbidden') return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Selos</p><h2>Acesso restrito</h2></div><p>Somente os papéis "Dono(a)" e "Comercial" podem gerenciar o catálogo de benefícios.</p></div></div>;

  const benefitLabel = (item) => `${badgeBenefitTypeLabels[item.benefit_type] || item.benefit_type}${item.benefit_type === 'discount_percent' && item.discount_percent ? ` — ${item.discount_percent}%` : ''}`;
  const selectedBadge = state.items.find((item) => item.id === selectedBadgeId) || null;
  return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Operação</p><h2>Selos e benefícios</h2></div><p>Cadastre o que cada selo dá: desconto, aula online grátis, vivência/visita ou brinde. Escolha a chave numa lista pra evitar erro de digitação — as automáticas (<code>new_course</code>, <code>class_attendance</code>, <code>course_review</code>) já liberam sozinhas quando a aluna cumpre a tarefa; uma chave personalizada só é liberada manualmente por vocês.</p></div>
    <div className="adminCompactList">{state.items.length ? state.items.map((item) => <button type="button" key={item.id} className={selectedBadgeId === item.id ? 'adminCompactRow adminCompactRow--active' : 'adminCompactRow'} onClick={() => setSelectedBadgeId(item.id)}>
      <span className="adminAvatar">{initials(item.badge_label)}</span>
      <span className="adminCompactRow__main"><strong>{item.badge_label}</strong><small>{item.badge_key} · {benefitLabel(item)}</small></span>
      <span className={item.status === 'active' ? 'adminStatus' : 'adminStatus adminStatus--warn'}>{item.status === 'active' ? 'Ativo' : 'Arquivado'}</span>
      <span className="adminCompactRow__chevron">›</span>
    </button>) : <div className="adminEmptyState"><strong>Nenhum selo cadastrado ainda.</strong><small>As alunas já ganham selos automaticamente (ex.: primeira matrícula), mas o benefício de cada um aparece "a definir" até você cadastrar aqui.</small></div>}</div>
    {selectedBadge && <div className="crmDrawerOverlay" role="presentation" onClick={() => setSelectedBadgeId('')}><aside className="crmOpportunityDrawer" aria-label="Detalhe do selo" onClick={(event) => event.stopPropagation()}>
      <button className="crmDrawerClose" type="button" onClick={() => setSelectedBadgeId('')} aria-label="Fechar detalhes">×</button>
      <div className="crmOpportunityDrawer__head"><span className={selectedBadge.status === 'active' ? 'adminStatus' : 'adminStatus adminStatus--warn'}>{selectedBadge.status === 'active' ? 'Ativo' : 'Arquivado'}</span><h2>{selectedBadge.badge_label}</h2><p><code>{selectedBadge.badge_key}</code></p></div>
      <div className="crmOpportunityFacts">
        <div><span>Benefício</span><strong>{benefitLabel(selectedBadge)}</strong></div>
        {selectedBadge.benefit_detail && <div><span>Detalhe</span><strong>{selectedBadge.benefit_detail}</strong></div>}
      </div>
      <button type="button" className="button button--outline adminFullButton" onClick={() => toggleStatus(selectedBadge)}>{selectedBadge.status === 'active' ? 'Arquivar' : 'Reativar'}</button>
    </aside></div>}
    <div className="adminFormSection">
      <button type="button" className="button button--outline adminFormSection__toggle" onClick={() => setShowForm((v) => !v)}>{showForm ? '– Cancelar' : '+ Novo selo/benefício'}</button>
      {showForm && <form className="adminForm" onSubmit={createItem}><h3>Novo selo/benefício</h3>
        <label htmlFor="badgeKey">Chave do selo<select id="badgeKey" required value={badgeKeyChoice} onChange={(e) => { const value = e.target.value; setBadgeKeyChoice(value); setForm((prev) => ({ ...prev, badgeKey: value === '__custom__' ? '' : value })); }}>
          <option value="" disabled>Selecione a chave...</option>
          {automaticBadgeKeys.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          <option value="__custom__">Outra (chave manual, liberada só pela equipe)</option>
        </select></label>
        {badgeKeyChoice === '__custom__' && <label htmlFor="badgeKeyCustom">Chave personalizada<input id="badgeKeyCustom" required value={form.badgeKey} onChange={(e) => setForm((prev) => ({ ...prev, badgeKey: e.target.value }))} placeholder="Ex: selo-fidelidade" /></label>}
        <label htmlFor="badgeLabel">Nome do selo<input id="badgeLabel" required value={form.badgeLabel} onChange={(e) => setForm((prev) => ({ ...prev, badgeLabel: e.target.value }))} placeholder="Ex: Primeira matrícula" /></label>
        <label htmlFor="badgeBenefitType">Tipo de benefício<select id="badgeBenefitType" value={form.benefitType} onChange={(e) => setForm((prev) => ({ ...prev, benefitType: e.target.value }))}><option value="discount_percent">Desconto</option><option value="free_class">Aula online grátis</option><option value="experience">Vivência/visita</option><option value="gift">Brinde</option><option value="other">Outro</option></select></label>
        {form.benefitType === 'discount_percent' && <label htmlFor="badgeDiscount">Percentual de desconto<input id="badgeDiscount" type="number" min="1" max="100" value={form.discountPercent} onChange={(e) => setForm((prev) => ({ ...prev, discountPercent: e.target.value }))} placeholder="Ex: 10" /></label>}
        <label htmlFor="badgeDetail">Detalhe (o que a aluna vê)<input id="badgeDetail" value={form.benefitDetail} onChange={(e) => setForm((prev) => ({ ...prev, benefitDetail: e.target.value }))} placeholder="Ex: Aula de Introdução a Colorimetria gratuita" /></label>
        {formStatus.error && <div className="formAlert formAlert--error">{formStatus.error}</div>}
        {formStatus.success && <div className="formAlert formAlert--success">{formStatus.success}</div>}
        <button type="submit" className="button button--primary" disabled={formStatus.loading}>{formStatus.loading ? 'Salvando...' : 'Salvar benefício'}</button>
      </form>}
      {formStatus.success && !showForm && <div className="formAlert formAlert--success">{formStatus.success}</div>}
    </div>
  </div>;
}

export function AdminCouponsPanel() {
  // Curso e turma vinham como campo de texto: pra amarrar um cupom a um curso era preciso
  // digitar o identificador dele ("laboratorio-de-colorimetria") sem errar uma letra. Agora
  // são listas do catálogo, e a de turmas segue o curso escolhido (pedido da Erica,
  // 09/09/2026). A validade e o limite de usos já existiam no banco e já eram conferidos no
  // checkout — só não tinham onde ser preenchidos.
  const catalog = useCatalog();
  const courses = (catalog || []).filter((course) => !course.hiddenFromAgenda);
  const [state, setState] = useState({ loading: true, items: [], error: '' });
  const [selectedCouponId, setSelectedCouponId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const emptyCouponForm = { code: '', type: 'percent', value: '', maxUses: '', courseSlug: '', classDate: '', startsAt: '', endsAt: '' };
  const [form, setForm] = useState(emptyCouponForm);
  const [formStatus, setFormStatus] = useState({ loading: false, error: '', success: '' });

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await fetch('/api/admin/coupons', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) { setState({ loading: false, items: [], error: 'forbidden' }); return; }
      if (!response.ok || !data.ok) throw new Error(data.error || 'coupon_failed');
      setState({ loading: false, items: data.items || [], error: '' });
    } catch (error) {
      setState({ loading: false, items: [], error: error.message || 'coupon_failed' });
    }
  }
  useEffect(() => { load(); }, []);

  async function createItem(event) {
    event.preventDefault();
    setFormStatus({ loading: true, error: '', success: '' });
    try {
      await postJson('/api/admin/coupons', { ...form, value: Number(form.value), maxUses: form.maxUses ? Number(form.maxUses) : undefined });
      setFormStatus({ loading: false, error: '', success: 'Cupom salvo e já ativo pro checkout.' });
      setForm(emptyCouponForm);
      setShowForm(false);
      load();
    } catch (error) {
      const messages = { invalid_coupon_payload: 'Preencha código, tipo e um valor maior que zero.', invalid_coupon_percent: 'Desconto em percentual não pode passar de 100%.' };
      setFormStatus({ loading: false, error: messages[error.message] || 'Não consegui salvar o cupom agora.', success: '' });
    }
  }

  async function toggleStatus(item) {
    try {
      await patchJson('/api/admin/coupons', { id: item.id, status: item.status === 'active' ? 'archived' : 'active' });
      load();
    } catch { /* silencioso: a lista recarrega e mostra o estado real na próxima tentativa. */ }
  }

  if (state.loading) return <div className="adminPanelCard"><p>Carregando cupons...</p></div>;
  if (state.error === 'forbidden') return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Cupons</p><h2>Acesso restrito</h2></div><p>Somente os papéis "Dono(a)" e "Comercial" podem gerenciar cupons.</p></div></div>;

  const ruleLabel = (item) => item.type === 'percent' ? `${Number(item.value)}% OFF` : `${money(Math.round(Number(item.value || 0) * 100))} OFF`;
  const courseName = (slug) => courses.find((c) => c.slug === slug)?.name || slug;
  const couponScopeLabel = (item) => (item.course_slug ? courseName(item.course_slug) : 'Todos os cursos');
  const couponExpiryLabel = (item) => {
    if (!item.ends_at) return '';
    const fim = new Date(item.ends_at);
    return `${fim < new Date() ? 'expirou' : 'expira'} em ${fim.toLocaleDateString('pt-BR')}`;
  };
  const selectedCoupon = state.items.find((item) => item.id === selectedCouponId) || null;
  return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Vendas</p><h2>Cupons</h2></div><p>Controle por curso, turma, validade e limite de uso. Arquivar um cupom só desativa — o histórico de quem já usou continua intacto.</p></div>
    <div className="adminCompactList">{state.items.length ? state.items.map((item) => <button type="button" key={item.id} className={selectedCouponId === item.id ? 'adminCompactRow adminCompactRow--active' : 'adminCompactRow'} onClick={() => setSelectedCouponId(item.id)}>
      <span className="adminAvatar">{initials(item.code)}</span>
      <span className="adminCompactRow__main"><strong>{item.code}</strong><small>{ruleLabel(item)} · {item.used_count || 0}{item.max_uses ? `/${item.max_uses}` : ''} usos · {couponScopeLabel(item)}{couponExpiryLabel(item) ? ` · ${couponExpiryLabel(item)}` : ''}</small></span>
      <span className={item.status === 'active' ? 'adminStatus adminStatus--success' : 'adminStatus adminStatus--warn'}>{item.status === 'active' ? 'Ativo' : 'Arquivado'}</span>
      <span className="adminCompactRow__chevron">›</span>
    </button>) : <div className="adminEmptyState"><strong>Nenhum cupom cadastrado ainda.</strong><small>Crie um cupom abaixo pra usar no checkout ou em campanhas de recuperação.</small></div>}</div>
    {selectedCoupon && <div className="crmDrawerOverlay" role="presentation" onClick={() => setSelectedCouponId('')}><aside className="crmOpportunityDrawer" aria-label="Detalhe do cupom" onClick={(event) => event.stopPropagation()}>
      <button className="crmDrawerClose" type="button" onClick={() => setSelectedCouponId('')} aria-label="Fechar detalhes">×</button>
      <div className="crmOpportunityDrawer__head"><span className={selectedCoupon.status === 'active' ? 'adminStatus adminStatus--success' : 'adminStatus adminStatus--warn'}>{selectedCoupon.status === 'active' ? 'Ativo' : 'Arquivado'}</span><h2>{selectedCoupon.code}</h2><p><code>{ruleLabel(selectedCoupon)}</code></p></div>
      <div className="crmOpportunityFacts">
        <div><span>Usos</span><strong>{selectedCoupon.used_count || 0}{selectedCoupon.max_uses ? ` / ${selectedCoupon.max_uses}` : ' (sem limite)'}</strong><small>{selectedCoupon.max_uses && Number(selectedCoupon.used_count || 0) >= Number(selectedCoupon.max_uses) ? 'Limite atingido: o checkout já recusa' : 'O checkout para de aceitar ao bater o limite'}</small></div>
        <div><span>Vale para</span><strong>{couponScopeLabel(selectedCoupon)}</strong>{selectedCoupon.class_date && <small>{selectedCoupon.class_date}</small>}</div>
        <div><span>Validade</span><strong>{couponExpiryLabel(selectedCoupon) || 'Sem data de expiração'}</strong>{selectedCoupon.starts_at && <small>começa em {new Date(selectedCoupon.starts_at).toLocaleDateString('pt-BR')}</small>}</div>
      </div>
      <button type="button" className="button button--outline adminFullButton" onClick={() => toggleStatus(selectedCoupon)}>{selectedCoupon.status === 'active' ? 'Arquivar (excluir)' : 'Reativar'}</button>
    </aside></div>}
    <div className="adminFormSection">
      <button type="button" className="button button--outline adminFormSection__toggle" onClick={() => setShowForm((v) => !v)}>{showForm ? '– Cancelar' : '+ Criar cupom'}</button>
      {showForm && <form className="adminForm" onSubmit={createItem}><h3>Novo cupom</h3>
        <label htmlFor="couponCode">Código<input id="couponCode" required value={form.code} onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))} placeholder="Ex: EBNJULHO10" /></label>
        <label htmlFor="couponType">Tipo<select id="couponType" value={form.type} onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}><option value="percent">Percentual (%)</option><option value="fixed">Valor fixo (R$)</option></select></label>
        <label htmlFor="couponValue">{form.type === 'percent' ? 'Percentual de desconto' : 'Valor do desconto (R$)'}<input id="couponValue" type="number" min="1" max={form.type === 'percent' ? 100 : undefined} step={form.type === 'percent' ? 1 : 0.01} required value={form.value} onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))} placeholder={form.type === 'percent' ? 'Ex: 10' : 'Ex: 150'} /></label>
        <label htmlFor="couponCourse">Vale para o curso<select id="couponCourse" value={form.courseSlug} onChange={(e) => setForm((prev) => ({ ...prev, courseSlug: e.target.value, classDate: '' }))}><option value="">Todos os cursos</option>{courses.map((course) => <option key={course.slug} value={course.slug}>{course.name}</option>)}</select></label>
        <label htmlFor="couponClassDate">Vale para a turma<select id="couponClassDate" value={form.classDate} disabled={!form.courseSlug} onChange={(e) => setForm((prev) => ({ ...prev, classDate: e.target.value }))}><option value="">{form.courseSlug ? 'Todas as turmas desse curso' : 'Escolha um curso primeiro'}</option>{(courses.find((c) => c.slug === form.courseSlug)?.dates || []).map((date) => <option key={date} value={date}>{date}</option>)}</select></label>
        <label htmlFor="couponMaxUses">Expira depois de quantos usos<input id="couponMaxUses" type="number" min="1" value={form.maxUses} onChange={(e) => setForm((prev) => ({ ...prev, maxUses: e.target.value }))} placeholder="Ex: 50 — vazio = sem limite" /></label>
        <label htmlFor="couponStartsAt">Começa a valer em (opcional)<input id="couponStartsAt" type="date" value={form.startsAt} onChange={(e) => setForm((prev) => ({ ...prev, startsAt: e.target.value }))} /></label>
        <label htmlFor="couponEndsAt">Expira em (opcional)<input id="couponEndsAt" type="date" value={form.endsAt} onChange={(e) => setForm((prev) => ({ ...prev, endsAt: e.target.value }))} /></label>
        <p className="adminFormHint">O checkout recusa o cupom sozinho fora do período, depois do limite de usos, ou em curso/turma diferente do que você escolheu aqui.</p>
        {formStatus.error && <div className="formAlert formAlert--error">{formStatus.error}</div>}
        {formStatus.success && <div className="formAlert formAlert--success">{formStatus.success}</div>}
        <button type="submit" className="button button--primary" disabled={formStatus.loading}>{formStatus.loading ? 'Salvando...' : 'Salvar cupom'}</button>
      </form>}
      {formStatus.success && !showForm && <div className="formAlert formAlert--success">{formStatus.success}</div>}
    </div>
  </div>;
}

export function AdminCoursesManagementPanel() {
  const [state, setState] = useState({ loading: true, courses: [], error: '' });
  const [seedStatus, setSeedStatus] = useState({ loading: false, message: '', error: '' });
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [editingCourseSlug, setEditingCourseSlug] = useState(null);
  const [showClassForm, setShowClassForm] = useState(false);
  const emptyCourseForm = { slug: '', name: '', category: '', priceNumber: '', capacity: '', promise: '', long: '', mentor: '', mentorTitle: '', mentorBio: '', mentorPhoto: '', mentorInstagram: '', mentorCredentials: '', location: '', level: '', workload: '', installments: '', image: '', highlights: '', learn: '', forWho: '' };
  const [courseForm, setCourseForm] = useState(emptyCourseForm);
  const emptyClassForm = { courseSlug: '', classDate: '', optionLabel: '', capacity: '', priceNumber: '', description: '', workload: '' };
  const [classForm, setClassForm] = useState(emptyClassForm);
  const [editForm, setEditForm] = useState(null);
  const [formStatus, setFormStatus] = useState({ loading: false, error: '', success: '' });
  const [showImport, setShowImport] = useState(false);
  const [importState, setImportState] = useState({ fileName: '', rows: null, loading: false, committing: false, error: '', result: null });

  function downloadImportTemplate() {
    const header = 'curso_slug,curso_nome,categoria,data_turma,rotulo_turma,vagas,preco,carga_horaria,descricao_turma';
    const example = 'penteados-de-festa,Penteados de Festa,Base,14 de Outubro de 2026,,18,"R$ 1.200,00",Curso presencial,';
    const blob = new Blob([`${header}\n${example}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modelo-turmas-ebn.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportState({ fileName: file.name, rows: null, loading: true, committing: false, error: '', result: null });
    try {
      const csv = await file.text();
      const response = await fetch('/api/admin/courses', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_import', csv, commit: false }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        const messages = { missing_columns: 'Faltam colunas do modelo na planilha. Baixe o modelo de novo e preencha por cima dele.', too_many_rows: 'Essa planilha tem turmas demais pra importar de uma vez (limite 200 linhas).', empty_csv: 'O arquivo está vazio.' };
        setImportState((prev) => ({ ...prev, loading: false, error: messages[data.error] || 'Não consegui ler essa planilha.' }));
        return;
      }
      setImportState((prev) => ({ ...prev, loading: false, rows: data.rows }));
    } catch {
      setImportState((prev) => ({ ...prev, loading: false, error: 'Não consegui ler esse arquivo. Confira se é um CSV de texto.' }));
    }
  }

  async function commitImport() {
    if (!importState.rows) return;
    setImportState((prev) => ({ ...prev, committing: true, error: '' }));
    try {
      const header = 'curso_slug,curso_nome,categoria,data_turma,rotulo_turma,vagas,preco,carga_horaria,descricao_turma';
      const csvLines = importState.rows.map((row) => [row.courseSlug, row.courseName || '', row.category || '', row.classDate, row.optionLabel || '', row.capacity || '', row.priceNumber || '', row.workload || '', row.description || ''].map((cell) => (String(cell).includes(',') ? `"${cell}"` : cell)).join(','));
      const csv = [header, ...csvLines].join('\n');
      const response = await fetch('/api/admin/courses', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_import', csv, commit: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'bulk_import_failed');
      setImportState({ fileName: '', rows: null, loading: false, committing: false, error: '', result: data });
      load();
    } catch {
      setImportState((prev) => ({ ...prev, committing: false, error: 'Não consegui publicar as turmas agora.' }));
    }
  }

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await fetch('/api/admin/courses', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) { setState({ loading: false, courses: [], error: 'forbidden' }); return; }
      if (response.status === 503) { setState({ loading: false, courses: [], error: 'database_not_configured' }); return; }
      if (!response.ok || !data.ok) throw new Error(data.error || 'courses_failed');
      setState({ loading: false, courses: data.courses || [], error: '' });
    } catch (error) {
      setState({ loading: false, courses: [], error: error.message || 'courses_failed' });
    }
  }
  useEffect(() => { load(); }, []);

  async function seedFromCode() {
    setSeedStatus({ loading: true, message: '', error: '' });
    try {
      await postJson('/api/admin/courses', { action: 'seed_from_code' });
      setSeedStatus({ loading: false, message: 'Catálogo do código publicado no banco — a agenda e o checkout já passam a ler daqui.', error: '' });
      load();
    } catch {
      setSeedStatus({ loading: false, message: '', error: 'Não consegui sincronizar agora.' });
    }
  }

  function parseLines(text = '') {
    return text.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  // Destaques e "o que vai aprender" podem ser um texto simples ou um título com descrição
  // (formato "Título: descrição") — como quase todo curso já usa o formato rico hoje, editar
  // aqui precisa preservar isso e não achatar tudo em texto simples de novo.
  function parseRichLines(text = '') {
    return parseLines(text).map((line) => {
      const separator = line.indexOf(':');
      if (separator > 0 && separator < line.length - 1) {
        const title = line.slice(0, separator).trim();
        const description = line.slice(separator + 1).trim();
        if (title && description) return { title, description };
      }
      return line;
    });
  }

  function stringifyRichLine(item) {
    if (typeof item === 'string') return item;
    if (item?.title) return `${item.title}: ${item.description || ''}`;
    return '';
  }

  async function createCourse(event) {
    event.preventDefault();
    setFormStatus({ loading: true, error: '', success: '' });
    const isEditing = Boolean(editingCourseSlug);
    try {
      await postJson('/api/admin/courses', {
        slug: courseForm.slug,
        name: courseForm.name,
        category: courseForm.category,
        priceNumber: Number(courseForm.priceNumber),
        capacity: Number(courseForm.capacity),
        promise: courseForm.promise,
        long: courseForm.long,
        mentor: courseForm.mentor,
        mentorTitle: courseForm.mentorTitle,
        mentorBio: courseForm.mentorBio,
        mentorPhoto: courseForm.mentorPhoto,
        mentorInstagram: courseForm.mentorInstagram,
        mentorCredentials: parseLines(courseForm.mentorCredentials),
        location: courseForm.location,
        level: courseForm.level,
        workload: courseForm.workload,
        installments: courseForm.installments,
        image: courseForm.image,
        highlights: parseRichLines(courseForm.highlights),
        learn: parseRichLines(courseForm.learn),
        forWho: parseLines(courseForm.forWho),
      });
      setFormStatus({ loading: false, error: '', success: isEditing ? 'Curso atualizado — o texto novo já aparece na página pública.' : 'Curso salvo — agora é só cadastrar as turmas dele.' });
      setCourseForm(emptyCourseForm);
      setEditingCourseSlug(null);
      setShowCourseForm(false);
      load();
    } catch {
      setFormStatus({ loading: false, error: `Não consegui ${isEditing ? 'atualizar' : 'salvar'} o curso agora. Confira o slug e o nome.`, success: '' });
    }
  }

  function startEditCourse(course) {
    setEditingCourseSlug(course.slug);
    setCourseForm({
      slug: course.slug,
      name: course.name || '',
      category: course.category || '',
      priceNumber: String(course.priceNumber || ''),
      capacity: String(course.capacity || ''),
      promise: course.promise || '',
      long: course.long || '',
      mentor: course.mentor || '',
      mentorTitle: course.mentorTitle || '',
      mentorBio: course.mentorBio || '',
      mentorPhoto: course.mentorPhoto || '',
      mentorInstagram: course.mentorInstagram || '',
      mentorCredentials: (course.mentorCredentials || []).join('\n'),
      location: course.location || '',
      level: course.level || '',
      workload: course.workload || '',
      installments: course.installments || '',
      image: course.image || course.banner || '',
      highlights: (course.highlights || []).map(stringifyRichLine).join('\n'),
      learn: (course.learn || []).map(stringifyRichLine).join('\n'),
      forWho: (course.forWho || []).join('\n'),
    });
    setFormStatus({ loading: false, error: '', success: '' });
    setShowCourseForm(true);
  }

  function cancelCourseForm() {
    setShowCourseForm(false);
    setEditingCourseSlug(null);
    setCourseForm(emptyCourseForm);
  }

  // Tirar/devolver um curso inteiro da agenda (pedido da Erica, 07/09/2026). Não apaga nada do
  // banco: matrícula e pagamento antigos continuam apontando pro curso. Só some do site.
  async function toggleCourseVisibility(course) {
    const ocultando = !course.hiddenFromAgenda;
    const aviso = ocultando
      ? `Tirar "${course.name}" da agenda pública?\n\nAs turmas dele param de aparecer no site e ninguém consegue se matricular. Matrículas e pagamentos já feitos continuam guardados, e dá pra voltar atrás a qualquer momento.`
      : `Voltar a mostrar "${course.name}" na agenda pública?`;
    if (!window.confirm(aviso)) return;
    setFormStatus({ loading: true, error: '', success: '' });
    try {
      await postJson('/api/admin/courses', { action: 'course_visibility', courseSlug: course.slug, hiddenFromAgenda: ocultando });
      setFormStatus({ loading: false, error: '', success: ocultando ? 'Curso tirado da agenda.' : 'Curso de volta na agenda.' });
      load();
    } catch {
      setFormStatus({ loading: false, error: 'Não consegui mudar a visibilidade do curso agora.', success: '' });
    }
  }

  async function submitClass(payload, successMessage) {
    setFormStatus({ loading: true, error: '', success: '' });
    try {
      await postJson('/api/admin/courses', { action: 'class', ...payload });
      setFormStatus({ loading: false, error: '', success: successMessage });
      return true;
    } catch {
      setFormStatus({ loading: false, error: 'Não consegui salvar a turma agora. Confira curso, data e preço.', success: '' });
      return false;
    }
  }

  async function createClass(event) {
    event.preventDefault();
    const ok = await submitClass({
      courseSlug: classForm.courseSlug,
      classDate: classForm.classDate,
      optionLabel: classForm.optionLabel || undefined,
      capacity: Number(classForm.capacity) || undefined,
      priceNumber: Number(classForm.priceNumber),
      description: classForm.description || undefined,
      workload: classForm.workload || undefined,
    }, 'Turma salva.');
    if (ok) { setClassForm(emptyClassForm); setShowClassForm(false); load(); }
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editForm) return;
    const ok = await submitClass({
      courseSlug: editForm.courseSlug,
      classDate: editForm.classDate,
      originalClassDate: editForm.originalClassDate,
      optionLabel: editForm.optionLabel || undefined,
      capacity: Number(editForm.capacity) || undefined,
      priceNumber: Number(editForm.priceNumber),
      description: editForm.description || undefined,
      workload: editForm.workload || undefined,
    }, 'Turma atualizada.');
    if (ok) { setEditForm(null); load(); }
  }

  async function archiveClass(courseSlug, classDate) {
    try {
      await patchJson('/api/admin/courses', { courseSlug, classDate });
      load();
    } catch { /* silencioso: a lista recarrega e mostra o estado real na próxima tentativa. */ }
  }

  if (state.loading) return <div className="adminPanelCard"><p>Carregando cursos e turmas do banco...</p></div>;
  if (state.error === 'forbidden') return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Cursos e turmas</p><h2>Acesso restrito</h2></div><p>Somente os papéis "Dono(a)" e "Comercial" podem cadastrar/editar cursos e turmas.</p></div></div>;

  const rows = state.courses.flatMap((course) => (course.dates || []).map((date) => ({ course, date, variant: course.variants?.[date] || null })));

  return <div className="adminPanelCard">
    <div className="adminTableHeader"><div><p className="eyebrow">Alunos & conteúdo</p><h2>Cadastrar e editar curso/turma</h2></div><p>Cursos e turmas cadastrados aqui aparecem direto na agenda pública e no checkout — sem precisar de deploy.</p></div>
    {state.error === 'database_not_configured' && <div className="adminEmptyState"><strong>Banco de dados não configurado.</strong><small>Configure a conexão com o banco pra ativar o cadastro de curso/turma pelo painel.</small></div>}
    {!state.error && !state.courses.length && <div className="adminEmptyState"><strong>Nenhum curso publicado no banco ainda.</strong><small>A agenda está usando o catálogo do código (src/catalog.js). Publique-o no banco uma vez pra passar a editar tudo por aqui.</small></div>}
    <div className="adminFormSection__toggle" style={{ marginBottom: 16 }}>
      <button type="button" className="button button--outline" onClick={seedFromCode} disabled={seedStatus.loading}>{seedStatus.loading ? 'Sincronizando...' : 'Sincronizar catálogo do código pro banco'}</button>
      {seedStatus.message && <div className="formAlert formAlert--success">{seedStatus.message}</div>}
      {seedStatus.error && <div className="formAlert formAlert--error">{seedStatus.error}</div>}
    </div>
    {rows.length > 0 && <div className="adminTableWrap"><table className="adminTable"><thead><tr><th>Curso</th><th>Turma</th><th>Vagas</th><th>Preço</th><th>Ações</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.course.slug}-${row.date}`}>
      <td data-label="Curso"><strong>{row.course.name}</strong><small>{row.course.category}{row.course.hiddenFromAgenda ? ' · fora da agenda' : ''}</small></td>
      <td data-label="Turma">{row.date}{row.variant?.label && <small>{row.variant.label}</small>}</td>
      <td data-label="Vagas">{classCapacity(row.course, row.date)}</td>
      <td data-label="Preço">{displayPrice(row.course, row.date)}</td>
      <td data-label="Ações"><div className="studentPortalAdminActions">
        <button type="button" className="linkButton" onClick={() => startEditCourse(row.course)}>editar curso</button>
        <button type="button" className="linkButton" onClick={() => setEditForm({ courseSlug: row.course.slug, classDate: row.date, originalClassDate: row.date, optionLabel: row.variant?.label || '', capacity: String(classCapacity(row.course, row.date)), priceNumber: String(displayPriceNumber(row.course, row.date) || ''), description: row.variant?.description || '', workload: row.variant?.workload || '' })}>editar turma</button>
        <button type="button" className="linkButton mutedAction" onClick={() => archiveClass(row.course.slug, row.date)}>excluir turma</button>
        <button type="button" className="linkButton mutedAction" onClick={() => toggleCourseVisibility(row.course)}>{row.course.hiddenFromAgenda ? 'mostrar curso' : 'tirar curso da agenda'}</button>
      </div></td>
    </tr>)}</tbody></table></div>}
    {editForm && <div className="crmDrawerOverlay" role="presentation" onClick={() => setEditForm(null)}><aside className="crmOpportunityDrawer" aria-label="Editar turma" onClick={(event) => event.stopPropagation()}>
      <button className="crmDrawerClose" type="button" onClick={() => setEditForm(null)} aria-label="Fechar detalhes">×</button>
      <div className="crmOpportunityDrawer__head"><h2>{editForm.courseSlug}</h2></div>
      <form className="adminForm" onSubmit={saveEdit}>
        <label htmlFor="editClassDate">Data da turma<input id="editClassDate" required value={editForm.classDate} onChange={(e) => setEditForm((prev) => ({ ...prev, classDate: e.target.value }))} placeholder="Ex: 14 e 15 de Setembro de 2026" /><small>Escreva por extenso, com o nome do mês (não use 14/09/2026) — é assim que o site reconhece o mês da turma na agenda.</small></label>
        <label htmlFor="editOptionLabel">Rótulo da turma (opcional)<input id="editOptionLabel" value={editForm.optionLabel} onChange={(e) => setEditForm((prev) => ({ ...prev, optionLabel: e.target.value }))} placeholder="Ex: Cab Diurno" /></label>
        <label htmlFor="editCapacity">Vagas<input id="editCapacity" type="number" min="1" required value={editForm.capacity} onChange={(e) => setEditForm((prev) => ({ ...prev, capacity: e.target.value }))} /></label>
        <label htmlFor="editPrice">Preço (R$)<input id="editPrice" type="number" min="1" step="0.01" required value={editForm.priceNumber} onChange={(e) => setEditForm((prev) => ({ ...prev, priceNumber: e.target.value }))} /></label>
        <label htmlFor="editWorkload">Carga horária (opcional)<input id="editWorkload" value={editForm.workload} onChange={(e) => setEditForm((prev) => ({ ...prev, workload: e.target.value }))} placeholder="Ex: 320h" /></label>
        <label htmlFor="editDescription">Descrição da turma (opcional)<input id="editDescription" value={editForm.description} onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="Ex: Segunda e terça, das 09h às 17h" /></label>
        {formStatus.error && <div className="formAlert formAlert--error">{formStatus.error}</div>}
        <button type="submit" className="button button--primary" disabled={formStatus.loading}>{formStatus.loading ? 'Salvando...' : 'Salvar turma'}</button>
      </form>
    </aside></div>}
    <div className="adminFormSection">
      <button type="button" className="button button--outline adminFormSection__toggle" onClick={() => setShowImport((v) => !v)}>{showImport ? '– Cancelar' : '+ Importar turmas em lote (planilha)'}</button>
      {showImport && <div className="adminImportPanel">
        <h3>Importar várias turmas de uma vez</h3>
        <p>Baixe o modelo, preencha uma linha por turma (pode repetir o mesmo curso em várias linhas) e suba de volta aqui. Você confere tudo antes de publicar.</p>
        <button type="button" className="button button--outline" onClick={downloadImportTemplate}>Baixar modelo (CSV)</button>
        <label htmlFor="importFile">Planilha preenchida (.csv)<input id="importFile" type="file" accept=".csv,text/csv" onChange={handleImportFile} /></label>
        {importState.loading && <p>Lendo {importState.fileName}...</p>}
        {importState.error && <div className="formAlert formAlert--error">{importState.error}</div>}
        {importState.result && <div className="formAlert formAlert--success">{importState.result.imported} turma(s) publicada(s). {importState.result.results.filter((r) => !r.ok).length ? `${importState.result.results.filter((r) => !r.ok).length} linha(s) não importada(s) — confira os motivos abaixo.` : ''}</div>}
        {importState.result?.results?.some((r) => !r.ok) && <ul>{importState.result.results.filter((r) => !r.ok).map((r) => <li key={r.lineNumber}>Linha {r.lineNumber}: {r.errors ? r.errors.join(', ') : r.error}</li>)}</ul>}
        {importState.rows && <>
          <div className="adminTableWrap"><table className="adminTable"><thead><tr><th>Linha</th><th>Curso</th><th>Turma</th><th>Vagas</th><th>Preço</th><th>Status</th></tr></thead><tbody>{importState.rows.map((row) => <tr key={row.lineNumber}>
            <td data-label="Linha">{row.lineNumber}</td>
            <td data-label="Curso"><strong>{row.courseName || row.courseSlug}</strong><small>{row.courseSlug}</small></td>
            <td data-label="Turma">{row.classDate}{row.optionLabel && <small>{row.optionLabel}</small>}</td>
            <td data-label="Vagas">{row.capacity || 20}</td>
            <td data-label="Preço">{row.priceNumber ? row.priceNumber.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</td>
            <td data-label="Status">{row.valid ? <span className="adminStatus adminStatus--success">Pronta pra publicar</span> : <span className="adminStatus adminStatus--warn">{row.errors.join(', ')}</span>}</td>
          </tr>)}</tbody></table></div>
          <button type="button" className="button button--primary" disabled={importState.committing || !importState.rows.some((row) => row.valid)} onClick={commitImport}>{importState.committing ? 'Publicando...' : `Confirmar e publicar ${importState.rows.filter((row) => row.valid).length} turma(s)`}</button>
        </>}
      </div>}
    </div>
    <div className="adminFormSection">
      <button type="button" className="button button--outline adminFormSection__toggle" onClick={() => setShowClassForm((v) => !v)}>{showClassForm ? '– Cancelar' : '+ Nova turma'}</button>
      {showClassForm && <form className="adminForm" onSubmit={createClass}><h3>Nova turma</h3>
        <label htmlFor="newClassCourse">Curso<select id="newClassCourse" required value={classForm.courseSlug} onChange={(e) => setClassForm((prev) => ({ ...prev, courseSlug: e.target.value }))}>
          <option value="" disabled>Selecione o curso...</option>
          {state.courses.map((course) => <option key={course.slug} value={course.slug}>{course.name}</option>)}
        </select></label>
        <label htmlFor="newClassDate">Data da turma<input id="newClassDate" required value={classForm.classDate} onChange={(e) => setClassForm((prev) => ({ ...prev, classDate: e.target.value }))} placeholder="Ex: 14 e 15 de Setembro de 2026" /><small>Escreva por extenso, com o nome do mês (não use 14/09/2026) — é assim que o site reconhece o mês da turma na agenda.</small></label>
        <label htmlFor="newClassLabel">Rótulo (opcional)<input id="newClassLabel" value={classForm.optionLabel} onChange={(e) => setClassForm((prev) => ({ ...prev, optionLabel: e.target.value }))} placeholder="Ex: Cab Diurno" /></label>
        <label htmlFor="newClassCapacity">Vagas<input id="newClassCapacity" type="number" min="1" value={classForm.capacity} onChange={(e) => setClassForm((prev) => ({ ...prev, capacity: e.target.value }))} placeholder="Ex: 18" /></label>
        <label htmlFor="newClassPrice">Preço (R$)<input id="newClassPrice" type="number" min="1" step="0.01" required value={classForm.priceNumber} onChange={(e) => setClassForm((prev) => ({ ...prev, priceNumber: e.target.value }))} /></label>
        <label htmlFor="newClassWorkload">Carga horária (opcional)<input id="newClassWorkload" value={classForm.workload} onChange={(e) => setClassForm((prev) => ({ ...prev, workload: e.target.value }))} placeholder="Ex: 320h" /></label>
        <label htmlFor="newClassDescription">Descrição (opcional)<input id="newClassDescription" value={classForm.description} onChange={(e) => setClassForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="Ex: Segunda e terça, das 09h às 17h" /></label>
        {formStatus.error && <div className="formAlert formAlert--error">{formStatus.error}</div>}
        {formStatus.success && <div className="formAlert formAlert--success">{formStatus.success}</div>}
        <button type="submit" className="button button--primary" disabled={formStatus.loading}>{formStatus.loading ? 'Salvando...' : 'Salvar turma'}</button>
      </form>}
    </div>
    <div className="adminFormSection">
      <button type="button" className="button button--outline adminFormSection__toggle" onClick={() => (showCourseForm ? cancelCourseForm() : setShowCourseForm(true))}>{showCourseForm ? '– Cancelar' : '+ Novo curso'}</button>
      {showCourseForm && <form className="adminForm" onSubmit={createCourse}><h3>{editingCourseSlug ? `Editar curso — ${courseForm.name}` : 'Novo curso'}</h3>
        <label htmlFor="newCourseSlug">Identificador (slug){editingCourseSlug && <small>Não muda depois de criado.</small>}<input id="newCourseSlug" required readOnly={Boolean(editingCourseSlug)} value={courseForm.slug} onChange={(e) => setCourseForm((prev) => ({ ...prev, slug: e.target.value }))} placeholder="Ex: penteados-de-festa" /></label>
        <label htmlFor="newCourseName">Nome do curso<input id="newCourseName" required value={courseForm.name} onChange={(e) => setCourseForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Ex: Penteados de Festa" /></label>
        <label htmlFor="newCourseCategory">Categoria<input id="newCourseCategory" value={courseForm.category} onChange={(e) => setCourseForm((prev) => ({ ...prev, category: e.target.value }))} placeholder="Ex: Base" /></label>
        <label htmlFor="newCoursePrice">Preço padrão (R$)<input id="newCoursePrice" type="number" min="1" step="0.01" required value={courseForm.priceNumber} onChange={(e) => setCourseForm((prev) => ({ ...prev, priceNumber: e.target.value }))} /></label>
        <label htmlFor="newCourseCapacity">Vagas padrão por turma<input id="newCourseCapacity" type="number" min="1" value={courseForm.capacity} onChange={(e) => setCourseForm((prev) => ({ ...prev, capacity: e.target.value }))} placeholder="Ex: 18" /></label>
        <label htmlFor="newCourseMentor">Instrutor(a)<input id="newCourseMentor" value={courseForm.mentor} onChange={(e) => setCourseForm((prev) => ({ ...prev, mentor: e.target.value }))} placeholder="Ex: Gabi Gusmão" /></label>
        <label htmlFor="newCourseLevel">Nível<input id="newCourseLevel" value={courseForm.level} onChange={(e) => setCourseForm((prev) => ({ ...prev, level: e.target.value }))} placeholder="Ex: Base" /></label>
        <label htmlFor="newCourseWorkload">Carga horária<input id="newCourseWorkload" value={courseForm.workload} onChange={(e) => setCourseForm((prev) => ({ ...prev, workload: e.target.value }))} placeholder="Ex: Curso presencial" /></label>
        <label htmlFor="newCourseInstallments">Parcelamento<input id="newCourseInstallments" value={courseForm.installments} onChange={(e) => setCourseForm((prev) => ({ ...prev, installments: e.target.value }))} placeholder="Ex: 12x R$ 100,00 sem juros" /></label>
        <label htmlFor="newCourseLocation">Local do curso<input id="newCourseLocation" value={courseForm.location} onChange={(e) => setCourseForm((prev) => ({ ...prev, location: e.target.value }))} placeholder="Ex: {LOCAL}" /></label>
        <label htmlFor="newCoursePromise">Chamada de vendas (1 frase)<input id="newCoursePromise" value={courseForm.promise} onChange={(e) => setCourseForm((prev) => ({ ...prev, promise: e.target.value }))} placeholder="Ex: Domine a técnica que mais vende no salão" /></label>
        <label htmlFor="newCourseLong">Descrição completa<textarea id="newCourseLong" rows={3} value={courseForm.long} onChange={(e) => setCourseForm((prev) => ({ ...prev, long: e.target.value }))} placeholder="Parágrafo de vendas do curso" /></label>
        <label htmlFor="newCourseHighlights">Destaques (1 por linha — pode ser "Título: descrição")<textarea id="newCourseHighlights" rows={3} value={courseForm.highlights} onChange={(e) => setCourseForm((prev) => ({ ...prev, highlights: e.target.value }))} placeholder={'Curso presencial\nMaterial didático: disponibilizamos todo o material necessário'} /></label>
        <label htmlFor="newCourseLearn">O que vai aprender (1 por linha — pode ser "Título: descrição")<textarea id="newCourseLearn" rows={3} value={courseForm.learn} onChange={(e) => setCourseForm((prev) => ({ ...prev, learn: e.target.value }))} placeholder={'Fundamentos de cor: altura de tom e cobertura de brancos\nAltura de tom'} /></label>
        <label htmlFor="newCourseForWho">Pra quem é (1 por linha)<textarea id="newCourseForWho" rows={3} value={courseForm.forWho} onChange={(e) => setCourseForm((prev) => ({ ...prev, forWho: e.target.value }))} placeholder={'Cabeleireiros em evolução\nQuem quer mais segurança técnica'} /></label>
        <label htmlFor="newCourseImage">Imagem/banner (URL)<input id="newCourseImage" value={courseForm.image} onChange={(e) => setCourseForm((prev) => ({ ...prev, image: e.target.value }))} placeholder="https://..." /></label>
        <label htmlFor="newCourseMentorTitle">Título do instrutor(a)<input id="newCourseMentorTitle" value={courseForm.mentorTitle} onChange={(e) => setCourseForm((prev) => ({ ...prev, mentorTitle: e.target.value }))} placeholder="Ex: Especialista em Penteados e Diretora Educacional da escola" /></label>
        <label htmlFor="newCourseMentorPhoto">Foto do instrutor(a) (URL)<input id="newCourseMentorPhoto" value={courseForm.mentorPhoto} onChange={(e) => setCourseForm((prev) => ({ ...prev, mentorPhoto: e.target.value }))} placeholder="/assets/instrutores/..." /></label>
        <label htmlFor="newCourseMentorInstagram">Instagram do instrutor(a) (link)<input id="newCourseMentorInstagram" value={courseForm.mentorInstagram} onChange={(e) => setCourseForm((prev) => ({ ...prev, mentorInstagram: e.target.value }))} placeholder="https://www.instagram.com/..." /></label>
        <label htmlFor="newCourseMentorBio">Bio do instrutor(a)<textarea id="newCourseMentorBio" rows={3} value={courseForm.mentorBio} onChange={(e) => setCourseForm((prev) => ({ ...prev, mentorBio: e.target.value }))} placeholder="Parágrafo de apresentação do instrutor(a) — some da página se ficar em branco" /></label>
        <label htmlFor="newCourseMentorCredentials">Credenciais do instrutor(a) (1 por linha)<textarea id="newCourseMentorCredentials" rows={3} value={courseForm.mentorCredentials} onChange={(e) => setCourseForm((prev) => ({ ...prev, mentorCredentials: e.target.value }))} placeholder={'Mais de 20 anos de experiência\nFormação em ...'} /></label>
        {formStatus.error && <div className="formAlert formAlert--error">{formStatus.error}</div>}
        {formStatus.success && <div className="formAlert formAlert--success">{formStatus.success}</div>}
        <button type="submit" className="button button--primary" disabled={formStatus.loading}>{formStatus.loading ? 'Salvando...' : editingCourseSlug ? 'Salvar alterações' : 'Salvar curso'}</button>
      </form>}
    </div>
  </div>;
}

export function AdminNotificationsPanel() {
  const catalog = useCatalog();
  const courses = (catalog || []).filter((course) => !course.hiddenFromAgenda);
  const [state, setState] = useState({ loading: true, items: [], error: '' });
  const [selectedNotificationId, setSelectedNotificationId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const emptyNotificationForm = { studentEmail: '', courseSlug: '', title: '', message: '', channel: 'app' };
  const [form, setForm] = useState(emptyNotificationForm);
  const [formStatus, setFormStatus] = useState({ loading: false, error: '', success: '' });

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await fetch('/api/admin/notifications', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) { setState({ loading: false, items: [], error: 'forbidden' }); return; }
      if (!response.ok || !data.ok) throw new Error(data.error || 'notification_failed');
      setState({ loading: false, items: data.items || [], error: '' });
    } catch (error) {
      setState({ loading: false, items: [], error: error.message || 'notification_failed' });
    }
  }
  useEffect(() => { load(); }, []);

  async function createItem(event) {
    event.preventDefault();
    setFormStatus({ loading: true, error: '', success: '' });
    try {
      await postJson('/api/admin/notifications', form);
      setFormStatus({ loading: false, error: '', success: 'Aviso cadastrado como rascunho.' });
      setForm(emptyNotificationForm);
      setShowForm(false);
      load();
    } catch (error) {
      const messages = { invalid_notification_payload: 'Preencha título e mensagem.', student_not_found: 'Não encontrei nenhuma aluna com esse email.' };
      setFormStatus({ loading: false, error: messages[error.message] || 'Não consegui cadastrar o aviso agora.', success: '' });
    }
  }

  async function markSent(item) {
    try {
      await patchJson('/api/admin/notifications', { id: item.id });
      load();
    } catch { /* silencioso: a lista recarrega e mostra o estado real na próxima tentativa. */ }
  }

  if (state.loading) return <div className="adminPanelCard"><p>Carregando avisos...</p></div>;
  if (state.error === 'forbidden') return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Avisos</p><h2>Acesso restrito</h2></div><p>Somente Dono(a), Comercial e Acadêmico podem cadastrar avisos.</p></div></div>;

  const selectedNotification = state.items.find((item) => item.id === selectedNotificationId) || null;
  return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Operação</p><h2>Avisos à aluna</h2></div><p>Canal "App" aparece na Minha Área assim que marcado como enviado. Canal "WhatsApp" fica registrado aqui, mas o envio em si é manual pelo atendimento — mensagem livre fora de template aprovado não é confiável via API.</p></div>
    <div className="adminCompactList">{state.items.length ? state.items.map((item) => <button type="button" key={item.id} className={selectedNotificationId === item.id ? 'adminCompactRow adminCompactRow--active' : 'adminCompactRow'} onClick={() => setSelectedNotificationId(item.id)}>
      <span className="adminAvatar">{initials(item.student_name || item.title)}</span>
      <span className="adminCompactRow__main"><strong>{item.title}</strong><small>{item.student_name ? `${item.student_name} · ` : 'Todas · '}{item.channel === 'whatsapp' ? 'WhatsApp' : 'App'}</small></span>
      <span className={item.status === 'sent' ? 'adminStatus' : 'adminStatus adminStatus--warn'}>{item.status === 'sent' ? 'Enviado' : 'Rascunho'}</span>
      <span className="adminCompactRow__chevron">›</span>
    </button>) : <div className="adminEmptyState"><strong>Nenhum aviso cadastrado ainda.</strong></div>}</div>
    {selectedNotification && <div className="crmDrawerOverlay" role="presentation" onClick={() => setSelectedNotificationId('')}><aside className="crmOpportunityDrawer" aria-label="Detalhe do aviso" onClick={(event) => event.stopPropagation()}>
      <button className="crmDrawerClose" type="button" onClick={() => setSelectedNotificationId('')} aria-label="Fechar detalhes">×</button>
      <div className="crmOpportunityDrawer__head"><span className={selectedNotification.status === 'sent' ? 'adminStatus' : 'adminStatus adminStatus--warn'}>{selectedNotification.status === 'sent' ? 'Enviado' : 'Rascunho'}</span><h2>{selectedNotification.title}</h2><p>{selectedNotification.student_name ? `${selectedNotification.student_name} (${selectedNotification.student_email})` : `Todas (${selectedNotification.course_slug || 'geral'})`}</p></div>
      <div className="crmOpportunityFacts">
        <div><span>Canal</span><strong>{selectedNotification.channel === 'whatsapp' ? 'WhatsApp' : 'App'}</strong></div>
      </div>
      <div className="crmOpportunityNotes crmOpportunityNotes--summary"><h3>Mensagem</h3><p>{selectedNotification.message}</p></div>
      {selectedNotification.status !== 'sent' && <button type="button" className="button button--outline adminFullButton" onClick={() => markSent(selectedNotification)}>{selectedNotification.channel === 'whatsapp' ? 'Marcar enviado (manual)' : 'Publicar'}</button>}
    </aside></div>}
    <div className="adminFormSection">
      <button type="button" className="button button--outline adminFormSection__toggle" onClick={() => setShowForm((v) => !v)}>{showForm ? '– Cancelar' : '+ Novo aviso'}</button>
      {showForm && <form className="adminForm" onSubmit={createItem}><h3>Novo aviso</h3>
        <label htmlFor="notifStudentEmail">Email da aluna (deixe vazio pra avisar todas de um curso)<input id="notifStudentEmail" type="email" value={form.studentEmail} onChange={(e) => setForm((prev) => ({ ...prev, studentEmail: e.target.value }))} placeholder="aluna@email.com" /></label>
        <label htmlFor="notifCourse">Curso (opcional)<select id="notifCourse" value={form.courseSlug} onChange={(e) => setForm((prev) => ({ ...prev, courseSlug: e.target.value }))}><option value="">Sem curso específico</option>{courses.map((course) => <option key={course.slug} value={course.slug}>{course.name}</option>)}</select></label>
        <label htmlFor="notifTitle">Título<input id="notifTitle" required value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Ex: Aula de sábado antecipada" /></label>
        <label htmlFor="notifMessage">Mensagem<textarea id="notifMessage" required value={form.message} onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))} placeholder="Escreva o aviso..." /></label>
        <label htmlFor="notifChannel">Canal<select id="notifChannel" value={form.channel} onChange={(e) => setForm((prev) => ({ ...prev, channel: e.target.value }))}><option value="app">App (Minha Área)</option><option value="whatsapp">WhatsApp (envio manual)</option></select></label>
        {formStatus.error && <div className="formAlert formAlert--error">{formStatus.error}</div>}
        {formStatus.success && <div className="formAlert formAlert--success">{formStatus.success}</div>}
        <button type="submit" className="button button--primary" disabled={formStatus.loading}>{formStatus.loading ? 'Cadastrando...' : 'Cadastrar aviso'}</button>
      </form>}
      {formStatus.success && !showForm && <div className="formAlert formAlert--success">{formStatus.success}</div>}
    </div>
  </div>;
}

const demandCategoryLabels = { site: 'Site', trafego: 'Tráfego', design: 'Design', conteudo: 'Conteúdo', financeiro: 'Financeiro', other: 'Outro' };
const demandStatusLabels = { received: 'Recebida', in_progress: 'Em andamento', waiting_client: 'Aguardando cliente', done: 'Concluída', approved: 'Aprovada' };
const demandPriorityLabels = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };

export function AdminAgencyDemandsPanel() {
  const [state, setState] = useState({ loading: true, items: [], error: '' });
  const [selectedDemandId2, setSelectedDemandId2] = useState('');
  const [showForm, setShowForm] = useState(false);
  const emptyDemandForm = { title: '', description: '', category: 'other', priority: 'normal', owner: '', dueDate: '', waitingFor: '' };
  const [form, setForm] = useState(emptyDemandForm);
  const [formStatus, setFormStatus] = useState({ loading: false, error: '', success: '' });

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await fetch('/api/admin/agency-demands', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) { setState({ loading: false, items: [], error: 'forbidden' }); return; }
      if (!response.ok || !data.ok) throw new Error(data.error || 'agency_demand_failed');
      setState({ loading: false, items: data.items || [], error: '' });
    } catch (error) {
      setState({ loading: false, items: [], error: error.message || 'agency_demand_failed' });
    }
  }
  useEffect(() => { load(); }, []);

  async function createItem(event) {
    event.preventDefault();
    setFormStatus({ loading: true, error: '', success: '' });
    try {
      await postJson('/api/admin/agency-demands', form);
      setFormStatus({ loading: false, error: '', success: 'Demanda registrada.' });
      setForm(emptyDemandForm);
      setShowForm(false);
      load();
    } catch {
      setFormStatus({ loading: false, error: 'Não consegui registrar a demanda agora.', success: '' });
    }
  }

  async function setStatus(item, status) {
    try {
      await patchJson('/api/admin/agency-demands', { id: item.id, status });
      load();
    } catch { /* silencioso: a lista recarrega e mostra o estado real na próxima tentativa. */ }
  }

  if (state.loading) return <div className="adminPanelCard"><p>Carregando demandas...</p></div>;
  if (state.error === 'forbidden') return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Demandas da agência</p><h2>Acesso restrito</h2></div><p>Somente o papel "Dono(a)" acompanha as demandas da agência.</p></div></div>;

  const selectedDemand2 = state.items.find((item) => item.id === selectedDemandId2) || null;
  return <div className="adminPanelCard">
    <div className="adminCompactList">{state.items.length ? state.items.map((item) => <button type="button" key={item.id} className={selectedDemandId2 === item.id ? 'adminCompactRow adminCompactRow--active' : 'adminCompactRow'} onClick={() => setSelectedDemandId2(item.id)}>
      <span className="adminAvatar">{initials(item.title)}</span>
      <span className="adminCompactRow__main"><strong>{item.title}</strong><small>{demandCategoryLabels[item.category] || item.category} · {demandPriorityLabels[item.priority] || item.priority}</small></span>
      <span className={item.status === 'done' || item.status === 'approved' ? 'adminStatus' : 'adminStatus adminStatus--warn'}>{demandStatusLabels[item.status] || item.status}</span>
      <span className="adminCompactRow__chevron">›</span>
    </button>) : <div className="adminEmptyState"><strong>Nenhuma demanda registrada ainda.</strong></div>}</div>
    {selectedDemand2 && <div className="crmDrawerOverlay" role="presentation" onClick={() => setSelectedDemandId2('')}><aside className="crmOpportunityDrawer" aria-label="Detalhe da demanda" onClick={(event) => event.stopPropagation()}>
      <button className="crmDrawerClose" type="button" onClick={() => setSelectedDemandId2('')} aria-label="Fechar detalhes">×</button>
      <div className="crmOpportunityDrawer__head"><span className={selectedDemand2.status === 'done' || selectedDemand2.status === 'approved' ? 'adminStatus' : 'adminStatus adminStatus--warn'}>{demandStatusLabels[selectedDemand2.status] || selectedDemand2.status}</span><h2>{selectedDemand2.title}</h2><p>{demandCategoryLabels[selectedDemand2.category] || selectedDemand2.category}</p></div>
      <div className="crmOpportunityFacts">
        <div><span>Prioridade</span><strong>{demandPriorityLabels[selectedDemand2.priority] || selectedDemand2.priority}</strong></div>
        <div><span>Aguardando</span><strong>{selectedDemand2.waiting_for || '—'}</strong></div>
      </div>
      {selectedDemand2.description && <div className="crmOpportunityNotes crmOpportunityNotes--summary"><h3>Descrição</h3><p>{selectedDemand2.description}</p></div>}
      {selectedDemand2.status !== 'done' && selectedDemand2.status !== 'approved' && <button type="button" className="button button--outline adminFullButton" onClick={() => setStatus(selectedDemand2, selectedDemand2.status === 'received' ? 'in_progress' : 'done')}>{selectedDemand2.status === 'received' ? 'Iniciar' : 'Concluir'}</button>}
      {selectedDemand2.status === 'done' && <button type="button" className="button button--outline adminFullButton" onClick={() => setStatus(selectedDemand2, 'approved')}>Aprovar</button>}
    </aside></div>}
    <div className="adminFormSection">
      <button type="button" className="button button--outline adminFormSection__toggle" onClick={() => setShowForm((v) => !v)}>{showForm ? '– Cancelar' : '+ Nova demanda'}</button>
      {showForm && <form className="adminForm" onSubmit={createItem}><h3>Nova demanda</h3>
        <label htmlFor="demandTitle">Título<input id="demandTitle" required value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} /></label>
        <label htmlFor="demandDescription">Descrição<input id="demandDescription" value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} /></label>
        <label htmlFor="demandCategory">Categoria<select id="demandCategory" value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}>{Object.entries(demandCategoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label htmlFor="demandPriority">Prioridade<select id="demandPriority" value={form.priority} onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}>{Object.entries(demandPriorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label htmlFor="demandOwner">Responsável<input id="demandOwner" value={form.owner} onChange={(e) => setForm((prev) => ({ ...prev, owner: e.target.value }))} placeholder="Ex: Cavalheri Agência" /></label>
        <label htmlFor="demandWaiting">Aguardando o quê (opcional)<input id="demandWaiting" value={form.waitingFor} onChange={(e) => setForm((prev) => ({ ...prev, waitingFor: e.target.value }))} placeholder="Ex: aprovação da Erica" /></label>
        {formStatus.error && <div className="formAlert formAlert--error">{formStatus.error}</div>}
        {formStatus.success && <div className="formAlert formAlert--success">{formStatus.success}</div>}
        <button type="submit" className="button button--primary" disabled={formStatus.loading}>{formStatus.loading ? 'Registrando...' : 'Registrar demanda'}</button>
      </form>}
      {formStatus.success && !showForm && <div className="formAlert formAlert--success">{formStatus.success}</div>}
    </div>
  </div>;
}

const waitlistStatusLabels = { waiting: 'Esperando', notified: 'Avisada', converted: 'Matriculou', cancelled: 'Cancelada' };

export function AdminWaitlistPanel() {
  const catalog = useCatalog();
  const courses = (catalog || []).filter((course) => !course.hiddenFromAgenda);
  const [state, setState] = useState({ loading: true, items: [], error: '' });
  const [actionState, setActionState] = useState({ loadingId: '' });
  const [selectedWaitlistId, setSelectedWaitlistId] = useState('');

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await fetch('/api/admin/waitlist', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) { setState({ loading: false, items: [], error: 'forbidden' }); return; }
      if (!response.ok || !data.ok) throw new Error(data.error || 'waitlist_failed');
      setState({ loading: false, items: data.items || [], error: '' });
    } catch (error) {
      setState({ loading: false, items: [], error: error.message || 'waitlist_failed' });
    }
  }
  useEffect(() => { load(); }, []);

  async function setStatus(item, status) {
    setActionState({ loadingId: item.id });
    try {
      await patchJson('/api/admin/waitlist', { id: item.id, status });
      await load();
    } catch { /* silencioso: a lista recarrega e mostra o estado real na próxima tentativa. */ }
    setActionState({ loadingId: '' });
  }

  function courseName(slug) { return courses.find((c) => c.slug === slug)?.name || slug; }

  if (state.loading) return <div className="adminPanelCard"><p>Carregando lista de espera...</p></div>;
  if (state.error === 'forbidden') return <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Lista de espera</p><h2>Acesso restrito</h2></div><p>Somente os papéis "Dono(a)", "Comercial" e "Atendimento" podem ver a fila de espera.</p></div></div>;

  const waiting = state.items.filter((item) => item.status === 'waiting').length;
  const notified = state.items.filter((item) => item.status === 'notified').length;

  const waitlistStatusClass = (status) => (status === 'converted' ? 'adminStatus' : status === 'cancelled' ? 'adminStatus adminStatus--neutral' : status === 'notified' ? 'adminStatus adminStatus--warn' : 'adminStatus adminStatus--neutral');
  const selectedWaitlistEntry = state.items.find((item) => item.id === selectedWaitlistId) || null;
  return <div className="adminPanelCard"><p className="adminCardIntro">Quem entrou na fila de uma turma lotada. Assim que uma vaga abre (cancelamento/estorno), a pessoa mais antiga da fila daquela turma é avisada sozinha pelo WhatsApp — aqui você acompanha e pode marcar quem já matriculou ou desistiu.</p>
    <div className="adminMetrics"><div><strong>{state.items.length}</strong><span>na fila (total)</span></div><div><strong>{waiting}</strong><span>esperando vaga</span></div><div><strong>{notified}</strong><span>avisadas, aguardando matrícula</span></div></div>
    <div className="adminCompactList">{state.items.length ? state.items.map((item) => <button type="button" key={item.id} className={selectedWaitlistId === item.id ? 'adminCompactRow adminCompactRow--active' : 'adminCompactRow'} onClick={() => setSelectedWaitlistId(item.id)}>
      <span className="adminAvatar">{initials(item.name)}</span>
      <span className="adminCompactRow__main"><strong>{item.name}</strong><small>{courseName(item.course_slug)} · {item.class_date}</small></span>
      <span className={waitlistStatusClass(item.status)}>{waitlistStatusLabels[item.status] || item.status}</span>
      <span className="adminCompactRow__chevron">›</span>
    </button>) : <div className="adminEmptyState"><strong>Ninguém na fila de espera ainda.</strong><small>Quando uma turma lotada mostra "Entrar na lista de espera" na agenda, quem se cadastra aparece aqui.</small></div>}</div>
    {selectedWaitlistEntry && <div className="crmDrawerOverlay" role="presentation" onClick={() => setSelectedWaitlistId('')}><aside className="crmOpportunityDrawer" aria-label="Detalhe da lista de espera" onClick={(event) => event.stopPropagation()}>
      <button className="crmDrawerClose" type="button" onClick={() => setSelectedWaitlistId('')} aria-label="Fechar detalhes">×</button>
      <div className="crmOpportunityDrawer__head"><span className={waitlistStatusClass(selectedWaitlistEntry.status)}>{waitlistStatusLabels[selectedWaitlistEntry.status] || selectedWaitlistEntry.status}</span><h2>{selectedWaitlistEntry.name}</h2><p>{courseName(selectedWaitlistEntry.course_slug)} · {selectedWaitlistEntry.class_date}</p></div>
      <div className="crmOpportunityFacts">
        <div><span>Contato</span><strong>{selectedWaitlistEntry.whatsapp}</strong>{selectedWaitlistEntry.email && <small>{selectedWaitlistEntry.email}</small>}</div>
        <div><span>Entrou em</span><strong>{selectedWaitlistEntry.created_at?.slice(0, 10)}</strong></div>
        {selectedWaitlistEntry.notified_at && <div><span>Avisada em</span><strong>{selectedWaitlistEntry.notified_at.slice(0, 10)}</strong></div>}
      </div>
      {!['converted', 'cancelled'].includes(selectedWaitlistEntry.status) && <div className="studentPortalAdminActions"><button type="button" className="button button--outline" disabled={actionState.loadingId === selectedWaitlistEntry.id} onClick={() => setStatus(selectedWaitlistEntry, 'converted')}>Marcar matriculou</button><button type="button" className="button button--outline" disabled={actionState.loadingId === selectedWaitlistEntry.id} onClick={() => setStatus(selectedWaitlistEntry, 'cancelled')}>Marcar desistiu</button></div>}
    </aside></div>}
  </div>;
}
