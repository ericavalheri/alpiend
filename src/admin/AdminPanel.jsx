// Painel administrativo (sidebar, dashboard, vendas, alunos, agenda) e a página de CRM em
// tela cheia. Extraído de src/main.jsx (organização de arquivos pedida pela Erica, 05/09/2026).
import { adminNavItems, adminNavGroups, adminPageTitles } from './nav.js';
import { useEffect, useState } from 'react';
import { useCatalog } from '../lib/catalog-context.js';
import { money, initials, uniqueSorted, classMonth, sortDatesChronologically } from '../lib/format.js';
import {
  agendaCourses, displayPrice, displayPriceNumber, selectedOffer, classCapacity, classReserved, classAvailable,
} from '../lib/catalog-helpers.js';
import {
  whatsappDispatchOptions, crmStageFromStatus, crmStatusClass, buildAcceptanceRows, buildManualFollowupRows,
  buildAbandonedCartRows, buildSalesFromSummary, buildStudentPortalRows, buildCrmRows, buildClubRows, filterCrmRows,
  crmKanbanColumns, crmJourneyStages, crmJourneyIndex, crmStageOptions, crmOriginOptions, crmCampaignOptions,
  crmTimelineForRow, crmOriginLabel, crmCampaignLabel, crmOriginGroup, crmWhatsappHref, whatsappOptionByKey,
  whatsappPreviewText, opportunityLabel,
} from '../lib/crm-helpers.js';
import {
  AdminUsersPanel, AdminOffersPanel, AdminMaterialsPanel, AdminCertificatesPanel, AdminBadgeBenefitsPanel,
  AdminCouponsPanel, AdminCoursesManagementPanel, AdminNotificationsPanel, AdminAgencyDemandsPanel, AdminWaitlistPanel,
} from './panels.jsx';

export function AdminPanel({ section = 'dashboard' }) {
  const catalog = useCatalog();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [adminData, setAdminData] = useState({ loading: true, summary: null, error: '' });
  const [crmFilters, setCrmFilters] = useState({ search: '', stage: '', source: '', priority: 'all' });
  const [crmView, setCrmView] = useState('kanban');
  const [crmActionState, setCrmActionState] = useState({ loadingId: '', message: '', error: '' });
  const [whatsappTemplate, setWhatsappTemplate] = useState(whatsappDispatchOptions[0].key);
  const [studentCourseFilter, setStudentCourseFilter] = useState('');
  const [studentPaidOnly, setStudentPaidOnly] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudentRowId, setSelectedStudentRowId] = useState('');
  // Código vindo do QR da aluna: a recepção aponta a câmera, cai aqui com ?checkin=... e o
  // campo já vem preenchido. De propósito NÃO confirma sozinho — quem confirma presença é
  // sempre um clique de gente, senão bastaria alguém abrir um link pra marcar presença.
  const [checkinCode, setCheckinCode] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('checkin') || '';
    } catch {
      return '';
    }
  });
  const [checkinState, setCheckinState] = useState({ loading: false, message: '', error: '', found: null });
  const [showArchivedStudents, setShowArchivedStudents] = useState(false);
  // Relatório de vendas: os filtros vão pro servidor, que é quem tem a lista completa.
  const [salesFilters, setSalesFilters] = useState({ from: '', to: '', course: '', situation: '', classState: '', search: '' });
  const [salesReport, setSalesReport] = useState({ loading: true, data: null, error: '' });
  const [salesPage, setSalesPage] = useState(1);
  const SALES_PAGE_SIZE = 12;
  const [selectedAcceptanceId, setSelectedAcceptanceId] = useState('');
  // Contrato assinado (pedido da Erica, 09/09/2026). Só carrega quando alguém abre o aceite:
  // são ~10 KB de documento por aluna, e a listagem não precisa disso pra desenhar os cards.
  const [contratoAssinado, setContratoAssinado] = useState({ acceptanceId: '', loading: false, error: '', text: '', signature: null, conferencia: '' });
  const [selectedSaleKey, setSelectedSaleKey] = useState('');
  const [selectedDemandId, setSelectedDemandId] = useState('');

  async function loadSummary(active = true) {
    try {
      const response = await fetch('/api/admin/summary', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (!active) return;
      if (!response.ok || !data.ok) throw new Error(data.error || 'summary_failed');
      setAdminData({ loading: false, summary: data, error: '' });
    } catch (error) {
      if (active) setAdminData({ loading: false, summary: null, error: error.message || 'summary_failed' });
    }
  }

  useEffect(() => {
    let active = true;
    loadSummary(active);
    return () => { active = false; };
  }, []);

  // O relatório é buscado num endpoint próprio (/api/admin/sales), que pagina o banco até
  // acabar. O resumo do dashboard continua sendo resumo: buscar tudo nele deixaria toda página
  // do painel lenta por causa de uma só.
  useEffect(() => {
    if (section !== 'vendas') return undefined;
    let ativo = true;
    // Espera a digitação parar antes de ir no servidor — senão cada letra da busca vira uma
    // consulta que varre o banco inteiro.
    const timer = setTimeout(async () => {
      setSalesReport((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const params = new URLSearchParams(Object.entries(salesFilters).filter(([, valor]) => valor));
        const response = await fetch(`/api/admin/sales?${params}`, { credentials: 'include' });
        const data = await response.json().catch(() => ({}));
        if (!ativo) return;
        if (!response.ok || !data.ok) throw new Error(data.error || 'sales_report_failed');
        setSalesReport({ loading: false, data, error: '' });
      } catch {
        if (ativo) setSalesReport({ loading: false, data: null, error: 'Não consegui carregar o relatório agora.' });
      }
    }, salesFilters.search ? 350 : 0);
    return () => { ativo = false; clearTimeout(timer); };
  }, [section, salesFilters]);

  // Depois de ler o código do QR, ele sai da barra de endereço: um F5 mais tarde não traz de
  // volta o código de uma aluna que já passou pela porta.
  useEffect(() => {
    if (!checkinCode) return;
    try {
      const limpa = new URL(window.location.href);
      if (!limpa.searchParams.has('checkin')) return;
      limpa.searchParams.delete('checkin');
      window.history.replaceState({}, '', limpa.pathname + (limpa.search || '') + limpa.hash);
    } catch {
      // barra de endereço indisponível não impede a conferência
    }
  }, []);

  async function persistCrmAction(row, activityType) {
    const labels = { contacted: 'Contato registrado', lost: 'Lead marcado como perdido', resolved: 'Pendência resolvida' };
    setCrmActionState({ loadingId: `${row.id}-${activityType}`, message: '', error: '' });
    try {
      const response = await fetch('/api/admin/summary', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'crm_activity',
          activity: {
            leadKey: row.id,
            activityType,
            status: activityType,
            note: row.nextAction,
            owner: row.owner,
            course: row.course,
            phone: row.phone,
            email: row.email,
            stage: row.stage,
            source: row.source,
            campaign: row.campaign,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'crm_activity_failed');
      setCrmActionState({ loadingId: '', message: labels[activityType] || 'Ação registrada', error: '' });
      fetch('/api/admin/summary', { credentials: 'include' })
        .then((summaryResponse) => summaryResponse.json())
        .then((summary) => summary.ok && setAdminData({ loading: false, summary, error: '' }))
        .catch(() => {});
    } catch (error) {
      setCrmActionState({ loadingId: '', message: '', error: 'Não consegui registrar essa ação agora. Verifique se o banco/tabela crm_activities está configurado.' });
    }
  }

  const rows = agendaCourses(catalog).flatMap((course) => [...course.dates].sort(sortDatesChronologically).map((date) => ({
    course,
    date,
    month: classMonth(date),
    price: displayPrice(course, date),
    priceNumber: displayPriceNumber(course, date) || 0,
    variant: selectedOffer(course, date)?.label || null,
    flow: course.flow === 'voomp' ? 'Voomp/aceite' : classMonth(date) === 'A confirmar' ? 'Lista de espera' : 'Asaas',
    capacity: classCapacity(course, date),
    reserved: classReserved(course, date),
    available: classAvailable(course, date),
  }))).sort((a, b) => sortDatesChronologically(a.date, b.date) || a.course.name.localeCompare(b.course.name));
  const openRows = rows.filter((row) => row.month !== 'A confirmar');
  const revenuePotential = openRows.reduce((sum, row) => sum + row.priceNumber, 0);
  const mockConfirmedRevenue = Math.round(revenuePotential * 0.28);
  const mockPendingRevenue = Math.round(revenuePotential * 0.18);
  const dbMetrics = adminData.summary?.metrics || {};
  const whatsappChannelConfigured = Boolean(adminData.summary?.integrations?.whatsappConfigured);

  async function triggerWhatsapp(row) {
    const option = whatsappDispatchOptions.find((item) => item.key === whatsappTemplate) || whatsappDispatchOptions[0];
    setCrmActionState({ loadingId: `${row.id}-whatsapp`, message: '', error: '' });
    try {
      const response = await fetch('/api/admin/summary', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'whatsapp_dispatch', templateKey: option.key, opportunity: row }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'whatsapp_dispatch_failed');
      const sent = Boolean(data.dispatch?.messageSent || data.dispatch?.whatsapp?.sent);
      setCrmActionState({ loadingId: '', message: sent ? `${option.label} enviado pela Twilio.` : `${option.label} registrado, mas a Twilio não confirmou envio. Confira aprovação do template e número do aluno.`, error: '' });
      await loadSummary(true);
    } catch (error) {
      setCrmActionState({ loadingId: '', message: '', error: error.message === 'whatsapp_channel_not_configured' ? 'Twilio ainda não está configurada na Vercel.' : 'Esse template ainda não está ativo/aprovado para disparo.' });
    }
  }

  async function updateStudentPortalRow(row, patch) {
    if (!row.enrollmentId) return;
    setCrmActionState({ loadingId: `${row.id}-portal`, message: '', error: '' });
    try {
      const portal = {
        enrollmentId: row.enrollmentId,
        materialsReleased: patch.materialsReleased ?? row.portal?.materialsReleased === true,
        certificateReleased: patch.certificateReleased ?? row.portal?.certificateReleased === true,
        materials: patch.materials || row.portal?.materials,
      };
      const response = await fetch('/api/admin/summary', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'student_portal_update', portal }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'student_portal_update_failed');
      setCrmActionState({ loadingId: '', message: 'Minha Área atualizada para essa matrícula.', error: '' });
      await loadSummary(true);
    } catch {
      setCrmActionState({ loadingId: '', message: '', error: 'Não consegui atualizar a Minha Área dessa matrícula agora.' });
    }
  }

  // Presença na aula: a aluna mostra o código da Minha Área, a equipe digita aqui. Quem decide
  // se vale é o servidor (confirmStudentCheckIn) — ele reconfere se a matrícula existe, se é
  // daquela turma e se o pagamento entrou. Aqui só mostramos a resposta.
  async function confirmCheckIn({ row = null, code = '' } = {}) {
    setCheckinState({ loading: true, message: '', error: '', found: null });
    try {
      const response = await fetch('/api/admin/summary', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'student_checkin_confirm',
          checkin: {
            enrollmentId: row?.enrollmentId || undefined,
            code: code || undefined,
            courseSlug: row?.courseSlug || undefined,
            classDate: row?.classDateRaw || undefined,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setCheckinState({ loading: false, message: '', error: data.message || 'Não consegui confirmar a presença agora.', found: null });
        return;
      }
      setCheckinState({ loading: false, message: `Presença confirmada: ${data.checkin.courseName}${data.checkin.classDate ? ` · ${data.checkin.classDate}` : ''}.`, error: '', found: data.checkin });
      setCheckinCode('');
      await loadSummary(true);
    } catch {
      setCheckinState({ loading: false, message: '', error: 'Não consegui falar com o servidor agora.', found: null });
    }
  }

  async function undoCheckIn(row) {
    if (!row?.enrollmentId) return;
    setCheckinState({ loading: true, message: '', error: '', found: null });
    try {
      const response = await fetch('/api/admin/summary', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'student_checkin_undo', checkin: { enrollmentId: row.enrollmentId } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error('undo_failed');
      setCheckinState({ loading: false, message: 'Presença desfeita.', error: '', found: null });
      await loadSummary(true);
    } catch {
      setCheckinState({ loading: false, message: '', error: 'Não consegui desfazer a presença agora.', found: null });
    }
  }

  // Arquivar / desarquivar / excluir cadastro de aluna (pedido da Erica, 09/09/2026).
  //
  // Arquivar é o botão do dia a dia: a aluna some do painel inteiro — lista, contagem, CRM e
  // faturamento — mas nada é apagado, e o mesmo botão traz de volta. Excluir de vez só existe
  // pra cadastro sem nada preso nele; quem tem matrícula ou pagamento o servidor recusa, e a
  // recusa vem escrita dizendo o que está preso.
  async function archiveStudent(row, arquivar) {
    if (!row?.studentId) return;
    setCrmActionState({ loadingId: `${row.id}-archive`, message: '', error: '' });
    try {
      const response = await fetch('/api/admin/summary', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'student_archive', student: { studentId: row.studentId, archived: arquivar } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'archive_failed');
      setSelectedStudentRowId('');
      setCrmActionState({ loadingId: '', message: arquivar ? `${row.name} saiu do painel. Dá pra trazer de volta em "arquivadas".` : `${row.name} voltou pro painel.`, error: '' });
      await loadSummary(true);
    } catch (error) {
      setCrmActionState({ loadingId: '', message: '', error: error.message === 'archive_failed' ? 'Não consegui arquivar agora.' : error.message });
    }
  }

  async function deleteStudent(row) {
    if (!row?.studentId) return;
    // Excluir não tem desfazer. A confirmação é o último passo antes de sumir de vez.
    if (!window.confirm(`Excluir o cadastro de ${row.name} de vez? Isso não tem desfazer. Se preferir algo reversível, use "arquivar".`)) return;
    setCrmActionState({ loadingId: `${row.id}-archive`, message: '', error: '' });
    try {
      const response = await fetch('/api/admin/summary', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'student_delete', student: { studentId: row.studentId } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Não consegui excluir agora.');
      setSelectedStudentRowId('');
      setCrmActionState({ loadingId: '', message: `Cadastro de ${row.name} excluído.`, error: '' });
      await loadSummary(true);
    } catch (error) {
      setCrmActionState({ loadingId: '', message: '', error: error.message });
    }
  }

  const isDatabaseMode = adminData.summary?.mode === 'database';
  const failedSources = adminData.summary?.failedSources || [];
  const truncatedSources = adminData.summary?.truncatedSources || [];
  const confirmedRevenue = isDatabaseMode ? dbMetrics.revenueConfirmed || 0 : mockConfirmedRevenue;
  const pendingRevenue = isDatabaseMode ? dbMetrics.revenuePending || 0 : mockPendingRevenue;
  const leadStats = { leads: 86, preEnrollments: 31, paid: 12, followups: 19, canceled: 3, carts: 24 };
  const brl = (value) => money(Math.round(value * 100));
  const acceptanceRows = isDatabaseMode ? buildAcceptanceRows(adminData.summary) : [];
  // Só a Formação em Cabeleireiro passa por assinatura de contrato (VoompFlow só aparece
  // quando flow === 'voomp'). Contar todas as matrículas fazia esta tela acusar defeito onde
  // não existe: matrícula de Blonde Start ou Colorimetria não tem aceite, e está certo assim.
  const matriculasComContrato = (adminData.summary?.enrollments || []).filter((linha) => linha.flow === 'voomp').length;
  const manualFollowupRows = isDatabaseMode ? buildManualFollowupRows(adminData.summary) : [];
  const abandonedCartRows = isDatabaseMode ? buildAbandonedCartRows(adminData.summary) : [];
  const sales = isDatabaseMode ? buildSalesFromSummary(adminData.summary) : [
    { name: 'Mariana Lima', phone: '(11) 99911-2200', email: 'mariana@email.com', course: 'Corte Descomplicado', option: '06 e 07 de Julho', source: 'Meta Ads / Instagram', campaign: 'corte-julho-leads', method: 'Pix Asaas', paid: 'R$ 1.962,90', status: 'Pago', cart: '1 curso + cupom EBNCORTE10', journey: 'Anúncio > página do curso > WhatsApp > checkout' },
    { name: 'Camila Souza', phone: '(11) 98844-1020', email: 'camila@email.com', course: 'No Gender Hair Cut', option: 'Curso completo com prática', source: 'Google orgânico', campaign: 'sem campanha', method: 'Cartão 12x', paid: 'R$ 2.800,00', status: 'Pago', cart: 'Curso completo', journey: 'Google > agenda > matrícula' },
    { name: 'Patrícia Nunes', phone: '(11) 97755-8833', email: 'patricia@email.com', course: 'Laboratório de Colorimetria', option: '20 e 21 de Julho', source: 'WhatsApp atendimento', campaign: 'lista-colorimetria', method: 'Boleto', paid: 'R$ 0,00', status: 'Pendente', cart: 'Curso + boleto aberto', journey: 'Instagram DM > WhatsApp > checkout' },
    { name: 'Renata Alves', phone: '(11) 96622-7810', email: 'renata@email.com', course: 'Cabeleireiro Profissional', option: 'Diurno', source: 'WhatsApp atendimento', campaign: 'indicação', method: 'Voomp matrícula', paid: 'R$ 508,22', status: 'Aceite enviado', cart: 'Matrícula + contrato', journey: 'WhatsApp > aceite > Voomp' },
    { name: 'Juliana Castro', phone: '(11) 95518-7001', email: 'juliana@email.com', course: 'Mega Hair Profissional', option: '18 e 19 de Julho', source: 'Meta Ads / Facebook', campaign: 'mega-hair-julho', method: 'Cartão', paid: 'R$ 2.547,00', status: 'Cancelado', cart: '1 curso', journey: 'Anúncio > checkout > cancelamento' },
  ];
  const studentPortalRows = buildStudentPortalRows(sales);
  const crmRows = buildCrmRows(sales, acceptanceRows, manualFollowupRows, abandonedCartRows, buildClubRows(adminData.summary));
  const crmStages = uniqueSorted(crmRows.map((row) => row.stage));
  const crmSources = uniqueSorted(crmRows.map((row) => row.source));
  const filteredCrmRows = filterCrmRows(crmRows, crmFilters);
  const crmKanban = crmKanbanColumns(filteredCrmRows);
  const hotCrmRows = crmRows.filter((row) => row.score >= 70);
  const crmActivities = adminData.summary?.crmActivities || [];
  const journeyCounts = crmJourneyStages.map((stage, index) => ({
    ...stage,
    count: index === 0 ? filteredCrmRows.filter((row) => row.source).length
      : index === 1 ? filteredCrmRows.length
        : index === 2 ? filteredCrmRows.filter((row) => row.course || row.classDate).length
          : filteredCrmRows.filter((row) => crmJourneyIndex(row) === index).length,
  }));
  const activeSection = ['dashboard', 'alunos', 'vendas', 'cupons', 'ofertas', 'demandas', 'aceites', 'cursos', 'operacao', 'agencia', 'lista-espera', 'usuarios'].includes(section) ? section : 'dashboard';
  // Grupos do menu (pedido da Erica, 03/09/2026: "cara de software SaaS, organizado") — antes
  // era uma lista única de 13 itens sem nenhuma hierarquia entre eles.
  const pageTitles = adminPageTitles(isDatabaseMode);
  const [eyebrow, title, description] = pageTitles[activeSection];

  const dashboardContent = <>
    <div className="adminPanelCard crmShortcutCard"><div className="adminTableHeader"><div><p className="eyebrow">CRM comercial</p><h2>Oportunidades em página própria</h2></div><p>Pipeline, WhatsApp/Twilio e detalhe de cada oportunidade sem misturar com o painel geral.</p></div><a className="button button--primary" href="/painel/crm">Abrir CRM de oportunidades</a></div>
    <p className="adminSectionLabel">Financeiro</p>
    <div className="adminRevenueGrid"><div className="revenueCard revenueCard--main"><span>Recebido confirmado</span><strong>{brl(confirmedRevenue)}</strong><small>{isDatabaseMode ? `Soma dos pagamentos confirmados no banco.${dbMetrics.sandboxPaymentsExcluded ? ` (${dbMetrics.sandboxPaymentsExcluded} teste(s) em sandbox excluído(s))` : ''}` : 'Mock do que virá do Asaas/Voomp.'}</small></div><div className="revenueCard"><span>Pendente</span><strong>{brl(pendingRevenue)}</strong><small>{isDatabaseMode ? 'Pagamentos pendentes/criados no banco.' : 'Boletos, Pix e negociações em aberto.'}</small></div><div className="revenueCard"><span>Carrinhos abertos</span><strong>{isDatabaseMode ? dbMetrics.carts || 0 : leadStats.carts}</strong><small>Pré-checkout iniciado e ainda não pago — base para recuperação via WhatsApp oficial.</small></div><div className="revenueCard"><span>Cancelamentos</span><strong>{isDatabaseMode ? dbMetrics.canceledPayments || 0 : leadStats.canceled}</strong><small>Pagamentos estornados, cancelados ou com chargeback.</small></div></div>
    <p className="adminSectionLabel">Funil de conversão</p>
    <div className="adminFunnel"><div><strong>{isDatabaseMode ? dbMetrics.students || 0 : leadStats.leads}</strong><span>Leads</span></div><div><strong>{isDatabaseMode ? dbMetrics.enrollments || 0 : leadStats.preEnrollments}</strong><span>Pré-matrículas</span></div><div><strong>{isDatabaseMode ? dbMetrics.acceptances || 0 : leadStats.followups}</strong><span>Aceites/follow-ups</span></div><div><strong>{isDatabaseMode ? dbMetrics.paidPayments || 0 : leadStats.paid}</strong><span>Pagas</span></div></div>
  </>;
  // Alunas por curso (pedido da Erica, 04/09/2026): quantas matrículas pagas de verdade
  // existem em cada curso e quais alunas são essas — filtro clicável, não só uma lista única.
  const studentCoursesSummary = Object.entries(studentPortalRows.filter((row) => row.paid).reduce((acc, row) => {
    acc[row.course] = (acc[row.course] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
  const studentSearchNormalized = studentSearch.trim().toLowerCase();
  const filteredStudentRows = studentPortalRows
    .filter((row) => (studentCourseFilter ? row.course === studentCourseFilter : true))
    .filter((row) => (studentPaidOnly ? row.paid : true))
    // A busca também aceita o código de check-in: quem está na porta digita as 6 letras e a
    // aluna aparece na hora, sem rolar a lista atrás do nome.
    .filter((row) => (studentSearchNormalized
      ? [row.name, row.email, row.phone, row.course, row.checkInCode].some((campo) => String(campo || '').toLowerCase().replace(/-/g, '').includes(studentSearchNormalized.replace(/-/g, '')))
      : true));
  const selectedStudentRow = filteredStudentRows.find((row) => row.id === selectedStudentRowId) || null;
  // Só quem pode arquivar vê os botões. Não é controle de acesso — quem decide é o servidor a
  // cada chamada — é só pra não oferecer um botão que vai recusar.
  const podeArquivar = (adminData.summary?.session?.permissions || []).includes('students_archive');
  const archivedStudents = adminData.summary?.archivedStudents || [];
  const checkinDone = studentPortalRows.filter((row) => row.checkInConfirmed).length;

  const studentStatusChip = (row) => (row.checkInConfirmed
    ? <span className="adminStatus adminStatus--success">Presença confirmada</span>
    : row.paid
      ? <span className="adminStatus">Código válido</span>
      : <span className="adminStatus adminStatus--warn">Aguardando pagamento</span>);

  // Cards compactos com detalhe ao clicar, no mesmo formato das outras páginas do painel
  // (pedido da Erica, 08/09/2026: a tabela de 8 colunas era ilegível, principalmente no
  // celular, que é de onde ela usa o painel na recepção).
  const studentContent = <div className="adminPanelCard studentOpsCard">
    <div className="adminTableHeader"><div><p className="eyebrow">Alunos e pós-venda</p><h2>Minha Área</h2></div><p>Gestão do que aparece para cada aluna: curso, materiais, check-in por código, certificado e benefício progressivo.</p></div>
    <div className="studentOpsSummary">
      <div><strong>{studentPortalRows.filter((row) => row.paid).length}</strong><span>alunas com matrícula paga</span></div>
      <div><strong>{studentPortalRows.filter((row) => !row.paid).length}</strong><span>matrículas iniciadas, não pagas</span></div>
      <div><strong>{checkinDone}</strong><span>presenças confirmadas</span></div>
      <div><strong>{studentPortalRows.filter((row) => row.certificate === 'Disponível').length}</strong><span>com certificado disponível</span></div>
    </div>

    <div className="checkinConsole">
      <div className="checkinConsole__head"><p className="eyebrow">Check-in da aula</p><h3>Conferir código na porta</h3><p>A aluna abre a Minha Área e mostra o código de 6 caracteres. Digite aqui: o sistema confere se a matrícula é dela, é dessa turma e está paga.</p></div>
      <form className="checkinConsole__form" onSubmit={(event) => { event.preventDefault(); confirmCheckIn({ code: checkinCode }); }}>
        <label htmlFor="checkinCode">Código da aluna
          <input id="checkinCode" value={checkinCode} onChange={(event) => setCheckinCode(event.target.value)} placeholder="a escola-000-000" autoComplete="off" spellCheck="false" />
        </label>
        <button type="submit" className="button button--primary" disabled={checkinState.loading || !checkinCode.trim()}>{checkinState.loading ? 'Conferindo...' : 'Confirmar presença'}</button>
      </form>
      {checkinState.error && <p className="checkinConsole__error" role="alert">{checkinState.error}</p>}
      {checkinState.message && <p className="checkinConsole__ok" role="status">{checkinState.message}</p>}
    </div>

    <div className="studentCourseFilters">
      <button type="button" className={studentCourseFilter === '' ? 'button button--outline is-active' : 'button button--outline'} onClick={() => setStudentCourseFilter('')}>Todos os cursos ({studentPortalRows.filter((row) => row.paid).length})</button>
      {studentCoursesSummary.map(([course, count]) => <button type="button" key={course} className={studentCourseFilter === course ? 'button button--outline is-active' : 'button button--outline'} onClick={() => setStudentCourseFilter(course)}>{course} ({count})</button>)}
      <button type="button" className={studentPaidOnly ? 'button button--outline is-active' : 'button button--outline'} onClick={() => setStudentPaidOnly((prev) => !prev)}>✓ Somente matrículas pagas ({studentPortalRows.filter((row) => row.paid).length})</button>
    </div>

    <div className="adminTableToolbar"><input type="search" placeholder="Buscar por nome, email, curso ou código de check-in..." value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} /><small>{filteredStudentRows.length} de {studentPortalRows.length} {studentPortalRows.length === 1 ? 'matrícula' : 'matrículas'}</small></div>

    <div className="adminCompactList">{filteredStudentRows.length ? filteredStudentRows.map((row) => <button type="button" key={row.id} className={selectedStudentRowId === row.id ? 'adminCompactRow adminCompactRow--active' : 'adminCompactRow'} onClick={() => setSelectedStudentRowId(row.id)}>
      <span className="adminAvatar">{initials(row.name)}</span>
      <span className="adminCompactRow__main"><strong>{row.name}</strong><small>{row.course} · {row.classDate}</small></span>
      {row.paid && <span className="checkinCodeChip" title="Código de check-in desta matrícula">{row.checkInCode}</span>}
      {studentStatusChip(row)}
      <span className="adminCompactRow__chevron">›</span>
    </button>) : <div className="adminEmptyState"><strong>{studentPortalRows.length ? 'Nada encontrado para esse filtro.' : 'Nenhuma aluna com matrícula ainda.'}</strong><small>{studentPortalRows.length ? 'Tente outro nome, curso ou código.' : 'Quando houver matrícula no banco, a Minha Área passa a listar acessos e controles aqui.'}</small></div>}</div>

    {podeArquivar && archivedStudents.length > 0 && <div className="studentArchivedBox">
      <button type="button" className="studentArchivedBox__toggle" onClick={() => setShowArchivedStudents((prev) => !prev)}>
        {showArchivedStudents ? '▾' : '▸'} {archivedStudents.length} cadastro{archivedStudents.length === 1 ? '' : 's'} arquivado{archivedStudents.length === 1 ? '' : 's'}
      </button>
      {showArchivedStudents && <div className="studentArchivedBox__list">
        <p>Ficam fora do painel, mas nada foi apagado. Clique em trazer de volta para desarquivar.</p>
        {archivedStudents.map((student) => <div key={student.id} className="studentArchivedBox__row">
          <span><strong>{student.name || 'Sem nome'}</strong><small>{student.email || 'sem email'}</small></span>
          <button type="button" className="linkButton" disabled={crmActionState.loadingId === `${student.id}-archive`} onClick={() => archiveStudent({ id: student.id, studentId: student.id, name: student.name || 'Cadastro' }, false)}>trazer de volta</button>
        </div>)}
      </div>}
    </div>}

    {crmActionState.message && <p className="checkinConsole__ok" role="status">{crmActionState.message}</p>}

    {selectedStudentRow && <div className="crmDrawerOverlay" role="presentation" onClick={() => setSelectedStudentRowId('')}><aside className="crmOpportunityDrawer" aria-label="Detalhe da aluna" onClick={(event) => event.stopPropagation()}>
      <button className="crmDrawerClose" type="button" onClick={() => setSelectedStudentRowId('')} aria-label="Fechar detalhes">×</button>
      <div className="crmOpportunityDrawer__head">
        <span className={selectedStudentRow.paid ? 'adminStatus adminStatus--success' : 'adminStatus adminStatus--warn'}>{selectedStudentRow.paid ? 'Aluna confirmada' : 'Matrícula não paga'}</span>
        <h2>{selectedStudentRow.name}</h2>
        <p>{selectedStudentRow.course} · {selectedStudentRow.classDate}</p>
      </div>
      <div className="crmOpportunityFacts">
        <div><span>Contato</span><strong>{selectedStudentRow.phone}</strong><small>{selectedStudentRow.email}</small></div>
        <div><span>Pagamento</span><strong>{selectedStudentRow.paidLabel || '—'}</strong><small>{selectedStudentRow.paymentStatus || 'sem pagamento registrado'}</small></div>
        <div><span>Materiais</span><strong>{selectedStudentRow.materials}</strong><small>{selectedStudentRow.portal?.materialsReleased ? 'Visível na área da aluna' : 'Aguardando liberação'}</small></div>
        <div><span>Certificado</span><strong>{selectedStudentRow.certificate}</strong><small>Liberação pela equipe</small></div>
        <div><span>Benefício progressivo</span><strong>{selectedStudentRow.discount}</strong><small>Cresce a cada curso pago</small></div>
      </div>

      <div className="checkinDrawerBlock">
        <h3>Check-in da aula</h3>
        {selectedStudentRow.paid ? <>
          <p className="checkinDrawerBlock__code"><span>Código desta matrícula</span><strong>{selectedStudentRow.checkInCode}</strong></p>
          <p className="checkinDrawerBlock__hint">É o mesmo código que aparece na Minha Área dela. Confira antes de confirmar.</p>
          {selectedStudentRow.checkInConfirmed
            ? <div className="checkinDrawerBlock__done"><span className="adminStatus adminStatus--success">Presença confirmada</span><button type="button" className="linkButton mutedAction" disabled={checkinState.loading} onClick={() => undoCheckIn(selectedStudentRow)}>desfazer presença</button></div>
            : <button type="button" className="button button--primary" disabled={checkinState.loading} onClick={() => confirmCheckIn({ row: selectedStudentRow })}>Confirmar presença desta aluna</button>}
        </> : <p className="checkinDrawerBlock__blocked">Sem pagamento confirmado, o check-in não libera e nenhum código é gerado para esta matrícula. Assim que o pagamento entrar, o código aparece aqui e na Minha Área dela.</p>}
        {checkinState.error && <p className="checkinConsole__error" role="alert">{checkinState.error}</p>}
      </div>

      <div className="studentPortalAdminActions">
        <button type="button" className="linkButton" disabled={!selectedStudentRow.canRelease || crmActionState.loadingId === `${selectedStudentRow.id}-portal`} onClick={() => updateStudentPortalRow(selectedStudentRow, { materialsReleased: true })}>liberar materiais</button>
        <button type="button" className="linkButton mutedAction" disabled={!selectedStudentRow.canRelease || crmActionState.loadingId === `${selectedStudentRow.id}-portal`} onClick={() => updateStudentPortalRow(selectedStudentRow, { certificateReleased: true })}>liberar certificado</button>
      </div>

      {podeArquivar && <div className="studentDangerZone">
        <h3>Tirar este cadastro do painel</h3>
        <p><strong>Arquivar</strong> faz a aluna sumir do painel inteiro — lista, contagens, CRM e faturamento —, sem apagar nada. Dá pra trazer de volta quando quiser.</p>
        <p><strong>Excluir de vez</strong> só funciona em cadastro que não tem nada preso nele. Se tiver matrícula ou pagamento, o sistema recusa e explica o motivo: apagar levaria o histórico junto.</p>
        <div className="studentDangerZone__actions">
          <button type="button" className="button button--outline" disabled={crmActionState.loadingId === `${selectedStudentRow.id}-archive`} onClick={() => archiveStudent(selectedStudentRow, true)}>Arquivar (some do painel)</button>
          <button type="button" className="linkButton dangerAction" disabled={crmActionState.loadingId === `${selectedStudentRow.id}-archive`} onClick={() => deleteStudent(selectedStudentRow)}>excluir de vez</button>
        </div>
        {crmActionState.error && <p className="checkinConsole__error" role="alert">{crmActionState.error}</p>}
      </div>}
    </aside></div>}
  </div>;
  // --- Relatório de vendas -----------------------------------------------------------------
  // Todas as vendas, sem teto, com filtro por período, curso, situação do pagamento e situação
  // da turma (pedido da Erica, 09/09/2026). Inclui de propósito as turmas que já aconteceram:
  // venda de curso encerrado é venda igual, e some do relatório se ninguém cuidar disso.
  const relatorio = salesReport.data;
  const vendasDoRelatorio = relatorio?.sales || [];
  const totaisDoRelatorio = relatorio?.totais || { vendas: 0, pago: 0, pendente: 0, cancelado: 0, semCobranca: 0, receitaPaga: 0, receitaPendente: 0 };
  const filtroAtivo = Object.values(salesFilters).some(Boolean);
  const mudaFiltro = (campo, valor) => { setSalesFilters((prev) => ({ ...prev, [campo]: valor })); setSalesPage(1); setSelectedSaleKey(''); };

  // Atalhos de período: é como a Erica pensa o fechamento ("esse mês", "mês passado"), não em
  // datas soltas. As datas são montadas no fuso de São Paulo, não no do navegador.
  const hojeSaoPaulo = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [anoHoje, mesHoje] = hojeSaoPaulo.split('-').map(Number);
  const diaDoMes = (ano, mes, dia) => `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  const ultimoDia = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const mesPassado = mesHoje === 1 ? { ano: anoHoje - 1, mes: 12 } : { ano: anoHoje, mes: mesHoje - 1 };
  const atalhosDePeriodo = [
    { label: 'Tudo', from: '', to: '' },
    { label: 'Este mês', from: diaDoMes(anoHoje, mesHoje, 1), to: diaDoMes(anoHoje, mesHoje, ultimoDia(anoHoje, mesHoje)) },
    { label: 'Mês passado', from: diaDoMes(mesPassado.ano, mesPassado.mes, 1), to: diaDoMes(mesPassado.ano, mesPassado.mes, ultimoDia(mesPassado.ano, mesPassado.mes)) },
    { label: 'Este ano', from: `${anoHoje}-01-01`, to: `${anoHoje}-12-31` },
  ];
  const periodoAtual = atalhosDePeriodo.find((atalho) => atalho.from === salesFilters.from && atalho.to === salesFilters.to);

  const situacaoDaVenda = (sale) => {
    if (/confirmed|received|paid|pago|confirmado|approved|aprovado/i.test(sale.paymentStatus || '')) return { label: 'Pago', tone: 'success' };
    if (/refund|reembols|estorn|chargeback|cancel/i.test(sale.paymentStatus || '')) return { label: 'Cancelado', tone: 'danger' };
    if (sale.paymentStatus) return { label: 'Pendente', tone: 'warn' };
    return { label: 'Sem cobrança', tone: 'neutral' };
  };
  const dataDaVenda = (sale) => {
    const quando = sale.paidAt || sale.createdAt;
    return quando ? new Date(quando).toLocaleDateString('pt-BR') : '—';
  };

  // Exportar pra planilha: um relatório de vendas serve pra fechar o mês com a contadora, e
  // isso acontece fora do painel. O arquivo leva exatamente as linhas filtradas na tela.
  function exportaRelatorio() {
    const colunas = ['Data da venda', 'Aluna', 'Email', 'WhatsApp', 'Curso', 'Turma', 'Turma encerrada', 'Situação', 'Valor', 'Forma de pagamento', 'Origem', 'Campanha', 'Cupom'];
    const linhas = vendasDoRelatorio.map((sale) => [
      dataDaVenda(sale), sale.name, sale.email, sale.phone, sale.course, sale.option,
      sale.classFinished ? 'sim' : 'não', situacaoDaVenda(sale).label,
      Number(sale.amountNumber || 0).toFixed(2).replace('.', ','),
      sale.paymentMethod || '', sale.source || '', sale.campaign || '', sale.couponCode || '',
    ]);
    // Ponto e vírgula e BOM: é o que o Excel em português abre sem pedir nada.
    const csv = [colunas, ...linhas].map((linha) => linha.map((campo) => `"${String(campo ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `vendas-ebn-${hojeSaoPaulo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const relatorioTotalPaginas = Math.max(1, Math.ceil(vendasDoRelatorio.length / SALES_PAGE_SIZE));
  const relatorioPagina = Math.min(salesPage, relatorioTotalPaginas);
  const vendasNaPagina = vendasDoRelatorio.slice((relatorioPagina - 1) * SALES_PAGE_SIZE, relatorioPagina * SALES_PAGE_SIZE);
  const chaveDaVenda = (sale) => sale.enrollmentId || `${sale.email}-${sale.course}-${sale.option}`;
  const vendaSelecionada = vendasDoRelatorio.find((sale) => chaveDaVenda(sale) === selectedSaleKey) || null;

  // Os gráficos passam a ler as MESMAS vendas da lista abaixo, com o mesmo filtro aplicado.
  // Antes eles vinham do resumo do dashboard (cortado em 80) e o "Cancelado" era um número
  // fixo de exemplo que sobrou do protótipo — dado inventado num relatório de vendas.
  const porOrigem = Object.values(vendasDoRelatorio.reduce((acc, sale) => {
    const chave = sale.source || 'sem origem';
    const atual = acc[chave] || { label: chave, value: 0, revenueValue: 0 };
    atual.value += 1;
    atual.revenueValue += Number(sale.amountNumber || 0);
    acc[chave] = atual;
    return acc;
  }, {})).map((origem) => ({ ...origem, revenue: money(Math.round(origem.revenueValue * 100)) })).sort((a, b) => b.value - a.value);
  const maiorOrigem = Math.max(...porOrigem.map((origem) => origem.value), 1);
  const salesReportBySource = porOrigem.slice(0, 6).map((origem) => ({ ...origem, percentage: Math.max(8, Math.round((origem.value / maiorOrigem) * 100)) }));
  const salesStatusReport = [
    { label: 'Pago', value: totaisDoRelatorio.pago, tone: 'success' },
    { label: 'Pendente', value: totaisDoRelatorio.pendente, tone: 'warn' },
    { label: 'Cancelado', value: totaisDoRelatorio.cancelado, tone: 'danger' },
    { label: 'Sem cobrança', value: totaisDoRelatorio.semCobranca, tone: 'neutral' },
  ];
  const salesStatusMax = Math.max(...salesStatusReport.map((item) => item.value), 1);
  const salesReportCard = <div className="adminPanelCard salesReportCard">
    <div className="adminTableHeader"><div><p className="eyebrow">Resumo</p><h2>Origem e pagamento</h2></div><p>Por canal e por situação do pagamento — sempre sobre as vendas do filtro escolhido abaixo.</p></div>
    <div className="salesReportGrid">
      <div className="salesChartBlock"><h3>Vendas por origem</h3><div className="salesBars">{salesReportBySource.length ? salesReportBySource.map((origem) => <div className="salesBarRow" key={origem.label}><div><strong>{origem.label}</strong><span>{origem.value} {origem.value === 1 ? 'venda' : 'vendas'} · {origem.revenue}</span></div><div className="salesBarTrack"><span style={{ width: `${origem.percentage}%` }} /></div></div>) : <p className="salesChartBlock__vazio">Nenhuma venda no filtro.</p>}</div></div>
      <div className="salesChartBlock"><h3>Situação do pagamento</h3><div className="salesStatusChart">{salesStatusReport.map((item) => <div className={`salesStatusItem salesStatusItem--${item.tone}`} key={item.label}><span style={{ height: `${Math.max(12, Math.round((item.value / salesStatusMax) * 100))}%` }} /><strong>{item.value}</strong><small>{item.label}</small></div>)}</div><div className="salesReportTotals"><div><span>Recebido</span><strong>{brl(totaisDoRelatorio.receitaPaga)}</strong></div><div><span>A receber</span><strong>{brl(totaisDoRelatorio.receitaPendente)}</strong></div></div></div>
    </div>
  </div>;

  const salesReportPage = <div className="adminPanelCard">
    <div className="adminTableHeader"><div><p className="eyebrow">Relatório de vendas</p><h2>Todas as vendas</h2></div><p>Inclui as turmas que já aconteceram. Filtre por período, curso, situação do pagamento ou situação da turma.</p></div>

    <div className="salesFilters">
      <div className="salesFilters__periodo">
        <span className="salesFilters__rotulo">Período</span>
        <div className="salesFilters__atalhos">{atalhosDePeriodo.map((atalho) => <button type="button" key={atalho.label} className={periodoAtual?.label === atalho.label ? 'button button--outline is-active' : 'button button--outline'} onClick={() => { setSalesFilters((prev) => ({ ...prev, from: atalho.from, to: atalho.to })); setSalesPage(1); }}>{atalho.label}</button>)}</div>
        <div className="salesFilters__datas">
          <label htmlFor="vendasDe">de<input id="vendasDe" type="date" value={salesFilters.from} onChange={(event) => mudaFiltro('from', event.target.value)} /></label>
          <label htmlFor="vendasAte">até<input id="vendasAte" type="date" value={salesFilters.to} onChange={(event) => mudaFiltro('to', event.target.value)} /></label>
        </div>
      </div>
      <div className="salesFilters__linha">
        <label htmlFor="vendasCurso">Curso
          <select id="vendasCurso" value={salesFilters.course} onChange={(event) => mudaFiltro('course', event.target.value)}>
            <option value="">Todos os cursos</option>
            {(relatorio?.courses || []).map((curso) => <option key={curso.slug} value={curso.slug}>{curso.name}</option>)}
          </select>
        </label>
        <label htmlFor="vendasSituacao">Pagamento
          <select id="vendasSituacao" value={salesFilters.situation} onChange={(event) => mudaFiltro('situation', event.target.value)}>
            <option value="">Todas as situações</option>
            {(relatorio?.situations || []).map((situacao) => <option key={situacao.key} value={situacao.key}>{situacao.label}</option>)}
          </select>
        </label>
        <label htmlFor="vendasTurma">Turma
          <select id="vendasTurma" value={salesFilters.classState} onChange={(event) => mudaFiltro('classState', event.target.value)}>
            <option value="">Encerradas e futuras</option>
            <option value="futuras">Só turmas que ainda vão acontecer</option>
            <option value="encerradas">Só turmas já encerradas</option>
          </select>
        </label>
        <label htmlFor="vendasBusca">Buscar
          <input id="vendasBusca" type="search" placeholder="nome, email, curso, origem ou cupom..." value={salesFilters.search} onChange={(event) => mudaFiltro('search', event.target.value)} />
        </label>
      </div>
      {filtroAtivo && <button type="button" className="linkButton" onClick={() => { setSalesFilters({ from: '', to: '', course: '', situation: '', classState: '', search: '' }); setSalesPage(1); }}>limpar filtros</button>}
    </div>

    <div className="salesTotals">
      <div><strong>{totaisDoRelatorio.vendas}</strong><span>{totaisDoRelatorio.vendas === 1 ? 'venda no filtro' : 'vendas no filtro'}</span></div>
      <div className="salesTotals--ok"><strong>{brl(totaisDoRelatorio.receitaPaga)}</strong><span>recebido ({totaisDoRelatorio.pago} pago{totaisDoRelatorio.pago === 1 ? '' : 's'})</span></div>
      <div className="salesTotals--warn"><strong>{brl(totaisDoRelatorio.receitaPendente)}</strong><span>a receber ({totaisDoRelatorio.pendente} pendente{totaisDoRelatorio.pendente === 1 ? '' : 's'})</span></div>
      <div><strong>{totaisDoRelatorio.cancelado}</strong><span>cancelada{totaisDoRelatorio.cancelado === 1 ? '' : 's'} ou estornada{totaisDoRelatorio.cancelado === 1 ? '' : 's'} · {totaisDoRelatorio.semCobranca} sem cobrança gerada</span></div>
    </div>

    <div className="adminTableToolbar">
      <small>{salesReport.loading ? 'Carregando...' : `${vendasDoRelatorio.length} de ${relatorio?.totalSemFiltro ?? 0} ${(relatorio?.totalSemFiltro ?? 0) === 1 ? 'venda' : 'vendas'} no total`}</small>
      <button type="button" className="button button--outline" disabled={!vendasDoRelatorio.length} onClick={exportaRelatorio}>Exportar para planilha</button>
    </div>

    {relatorio?.truncado && <p className="checkinConsole__error" role="alert">O banco tem mais vendas do que este relatório consegue trazer de uma vez. Filtre por período para ver o restante — nada foi perdido.</p>}
    {salesReport.error && <p className="checkinConsole__error" role="alert">{salesReport.error}</p>}

    <div className="adminCompactList">{vendasNaPagina.length ? vendasNaPagina.map((sale) => { const situacao = situacaoDaVenda(sale); return <button type="button" key={chaveDaVenda(sale)} className={selectedSaleKey === chaveDaVenda(sale) ? 'adminCompactRow adminCompactRow--active' : 'adminCompactRow'} onClick={() => setSelectedSaleKey(chaveDaVenda(sale))}>
      <span className="adminAvatar">{initials(sale.name)}</span>
      <span className="adminCompactRow__main"><strong>{sale.name}</strong><small>{sale.course} · {sale.option}</small></span>
      <span className="salesRowDate">{dataDaVenda(sale)}{sale.classFinished && <em>turma encerrada</em>}</span>
      <span className="salesRowValue">{brl(sale.amountNumber || 0)}</span>
      <span className={crmStatusClass(situacao.tone)}>{situacao.label}</span>
      <span className="adminCompactRow__chevron">›</span>
    </button>; }) : <div className="adminEmptyState"><strong>{salesReport.loading ? 'Carregando as vendas...' : filtroAtivo ? 'Nenhuma venda nesse filtro.' : 'Nenhuma venda registrada ainda.'}</strong><small>{filtroAtivo ? 'Tente outro período, curso ou situação.' : 'Quando as matrículas gravarem no banco, as vendas aparecem aqui.'}</small></div>}</div>

    {relatorioTotalPaginas > 1 && <div className="adminPagination"><button type="button" className="button button--outline" disabled={relatorioPagina <= 1} onClick={() => setSalesPage(relatorioPagina - 1)}>‹ Anterior</button><span>Página {relatorioPagina} de {relatorioTotalPaginas}</span><button type="button" className="button button--outline" disabled={relatorioPagina >= relatorioTotalPaginas} onClick={() => setSalesPage(relatorioPagina + 1)}>Próxima ›</button></div>}

    {vendaSelecionada && <div className="crmDrawerOverlay" role="presentation" onClick={() => setSelectedSaleKey('')}><aside className="crmOpportunityDrawer" aria-label="Detalhe da venda" onClick={(event) => event.stopPropagation()}>
      <button className="crmDrawerClose" type="button" onClick={() => setSelectedSaleKey('')} aria-label="Fechar detalhes">×</button>
      <div className="crmOpportunityDrawer__head"><span className={crmStatusClass(situacaoDaVenda(vendaSelecionada).tone)}>{situacaoDaVenda(vendaSelecionada).label}</span><h2>{vendaSelecionada.name}</h2><p>{vendaSelecionada.course} · {vendaSelecionada.option}</p></div>
      <div className="crmOpportunityFacts">
        <div><span>Data da venda</span><strong>{dataDaVenda(vendaSelecionada)}</strong><small>{vendaSelecionada.paidAt ? 'data do pagamento' : 'início da matrícula'}</small></div>
        <div><span>Valor</span><strong>{brl(vendaSelecionada.amountNumber || 0)}</strong><small>{vendaSelecionada.paymentMethod || 'forma não registrada'}</small></div>
        <div><span>Contato</span><strong>{vendaSelecionada.phone}</strong><small>{vendaSelecionada.email}</small></div>
        <div><span>Origem</span><strong>{vendaSelecionada.source}</strong><small>{vendaSelecionada.campaign}</small></div>
        <div><span>Turma</span><strong>{vendaSelecionada.option}</strong><small>{vendaSelecionada.classFinished ? 'já encerrada' : 'ainda vai acontecer'}</small></div>
        <div><span>Carrinho</span><strong>{vendaSelecionada.cart}</strong></div>
      </div>
      <div className="crmOpportunityNotes crmOpportunityNotes--summary"><h3>Jornada de acesso</h3><p>{vendaSelecionada.journey}</p></div>
    </aside></div>}
  </div>;

  const selectedDemand = manualFollowupRows.find((row) => row.id === selectedDemandId) || null;
  const demandsContent = <div className="adminPanelCard">
    <div className="adminTableHeader"><div><p className="eyebrow">Atenção atendimento</p><h2>Pendências de atendimento WhatsApp</h2></div><p>Vendas/retornos em que a automação Twilio falhou ou precisa de intervenção. Chamar manualmente e conferir cadastro.</p></div>
    <div className="adminCompactList">{manualFollowupRows.length ? manualFollowupRows.map((row) => <button type="button" key={row.id} className={selectedDemandId === row.id ? 'adminCompactRow adminCompactRow--active' : 'adminCompactRow'} onClick={() => setSelectedDemandId(row.id)}>
      <span className="adminAvatar">{initials(row.name)}</span>
      <span className="adminCompactRow__main"><strong>{row.name}</strong><small>{row.course} · {row.classDate}</small></span>
      <span className="adminStatus adminStatus--warn">{row.status}</span>
      <span className="adminCompactRow__chevron">›</span>
    </button>) : <div className="adminEmptyState"><strong>Nenhuma pendência manual agora.</strong><small>Se a Twilio não confirmar o envio automático, a venda aparece aqui.</small></div>}</div>
    {selectedDemand && <div className="crmDrawerOverlay" role="presentation" onClick={() => setSelectedDemandId('')}><aside className="crmOpportunityDrawer" aria-label="Detalhe da pendência" onClick={(event) => event.stopPropagation()}>
      <button className="crmDrawerClose" type="button" onClick={() => setSelectedDemandId('')} aria-label="Fechar detalhes">×</button>
      <div className="crmOpportunityDrawer__head"><span className="adminStatus adminStatus--warn">{selectedDemand.status}</span><h2>{selectedDemand.name}</h2><p>{selectedDemand.course} · {selectedDemand.classDate}</p></div>
      <div className="crmOpportunityFacts">
        <div><span>Contato</span><strong>{selectedDemand.phone}</strong><small>{selectedDemand.email}</small></div>
        <div><span>Venda Voomp</span><strong>{selectedDemand.amount}</strong><small>{selectedDemand.paymentMethod}</small></div>
        <div><span>Venda</span><strong>{selectedDemand.saleId}</strong></div>
        <div><span>Recebido em</span><strong>{selectedDemand.createdAt}</strong></div>
      </div>
      <div className="crmOpportunityNotes crmOpportunityNotes--summary"><h3>Por que aparece aqui</h3><p>Automação não confirmou envio pela Twilio. Chame manualmente pelo WhatsApp e confira o cadastro.</p></div>
    </aside></div>}
  </div>;
  // Cards compactos + painel de detalhe ao clicar (pedido da Erica, 04/09/2026: nada de
  // tabela enorme rolando pra baixo — referência: ferramentas internas estilo SaaS, um
  // resumo por card e o resto some até alguém clicar).
  // Confere se o documento que a tela está mostrando é o mesmo que foi assinado. A impressão
  // digital (SHA-256) foi calculada no servidor no momento da assinatura; se ela bate com o
  // texto guardado, ninguém mexeu no contrato depois. É a diferença entre exibir um contrato e
  // provar que é aquele contrato.
  async function conferirContrato(texto, esperado) {
    if (!texto || !esperado) return '';
    try {
      const bytes = new TextEncoder().encode(texto);
      const digest = await window.crypto.subtle.digest('SHA-256', bytes);
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      return hex === esperado ? 'confere' : 'diferente';
    } catch {
      // Navegador sem crypto.subtle (só acontece fora de HTTPS): mostra o contrato mesmo
      // assim, sem afirmar o que não deu pra verificar.
      return '';
    }
  }

  async function abrirAceite(row) {
    setSelectedAcceptanceId(row.id);
    if (row.origin !== 'aceite') {
      setContratoAssinado({ acceptanceId: row.id, loading: false, error: '', text: '', signature: row.contract, conferencia: '' });
      return;
    }
    setContratoAssinado({ acceptanceId: row.id, loading: true, error: '', text: '', signature: row.contract, conferencia: '' });
    try {
      const response = await fetch('/api/admin/summary', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'acceptance_contract', acceptanceId: row.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'acceptance_contract_failed');
      const texto = data.contract?.text || '';
      const conferencia = await conferirContrato(texto, data.contract?.signature?.contractFingerprint);
      setContratoAssinado({ acceptanceId: row.id, loading: false, error: '', text: texto, signature: data.contract?.signature || row.contract, conferencia });
    } catch {
      setContratoAssinado({ acceptanceId: row.id, loading: false, error: 'Não consegui abrir o contrato assinado agora.', text: '', signature: row.contract, conferencia: '' });
    }
  }

  const selectedAcceptance = acceptanceRows.find((row) => row.id === selectedAcceptanceId) || null;
  const acceptancesContent = <div className="adminPanelCard">
    <div className="adminCompactList">{acceptanceRows.length ? acceptanceRows.map((row) => <button type="button" key={row.id} className={selectedAcceptanceId === row.id ? 'adminCompactRow adminCompactRow--active' : 'adminCompactRow'} onClick={() => abrirAceite(row)}>
      <span className="adminAvatar">{initials(row.name)}</span>
      <span className="adminCompactRow__main"><strong>{row.name}</strong><small>{row.course} · {row.classDate}</small></span>
      {row.contract ? <span className="adminStatus adminStatus--contract">Contrato assinado</span> : null}
      <span className={row.status === 'Aceite validado' ? 'adminStatus' : 'adminStatus adminStatus--warn'}>{row.status}</span>
      <span className="adminCompactRow__chevron">›</span>
    </button>) : <div className="adminEmptyState"><strong>Nenhum aceite registrado ainda.</strong><small>{matriculasComContrato ? `Existem ${matriculasComContrato} matrícula(s) de Cabeleireiro no banco e nenhuma delas traz aceite registrado — isso é falha, me avise que eu investigo.` : dbMetrics.enrollments ? `As ${dbMetrics.enrollments} matrícula(s) no banco são de cursos que não pedem contrato assinado, então é normal não aparecer aceite aqui. Só a Formação em Cabeleireiro passa pela assinatura antes do pagamento.` : 'Não há matrícula nenhuma no banco ainda. Assim que a primeira pessoa assinar o contrato do Cabeleireiro, o registro entra e aparece aqui.'}</small></div>}</div>
    {selectedAcceptance && <div className="crmDrawerOverlay" role="presentation" onClick={() => setSelectedAcceptanceId('')}><aside className="crmOpportunityDrawer" aria-label="Detalhe do aceite" onClick={(event) => event.stopPropagation()}>
      <button className="crmDrawerClose" type="button" onClick={() => setSelectedAcceptanceId('')} aria-label="Fechar detalhes">×</button>
      <div className="crmOpportunityDrawer__head"><span className={selectedAcceptance.status === 'Aceite validado' ? 'adminStatus' : 'adminStatus adminStatus--warn'}>{selectedAcceptance.status}</span><h2>{selectedAcceptance.name}</h2><p>{selectedAcceptance.course}</p></div>
      <div className="crmOpportunityFacts">
        <div><span>Contato</span><strong>{selectedAcceptance.phone}</strong><small>{selectedAcceptance.email}</small></div>
        <div><span>CPF</span><strong>{selectedAcceptance.cpf}</strong></div>
        <div><span>Turma</span><strong>{selectedAcceptance.classDate}</strong></div>
        <div><span>Itens confirmados</span><strong>{selectedAcceptance.checks}</strong></div>
        <div><span>Contato antes do pagamento</span><strong>{selectedAcceptance.contactBeforePayment}</strong></div>
        <div><span>Origem</span><strong>{selectedAcceptance.source}</strong></div>
        <div><span>Versão dos termos</span><strong>{selectedAcceptance.termsVersion}</strong></div>
        <div><span>Registrado em</span><strong>{selectedAcceptance.createdAt}</strong></div>
      </div>
      {selectedAcceptance.origin === 'matricula' && <div className="adminContractNote"><strong>Reconstruído a partir da matrícula.</strong><small>A linha da tabela de aceites não veio na consulta, mas o registro do aceite está guardado junto da matrícula — é ele que está sendo mostrado aqui.</small></div>}
      {selectedAcceptance.contract ? <div className="adminContract">
        <div className="adminContract__head">
          <div><p className="eyebrow">Contrato assinado</p><h3>Versão {selectedAcceptance.contract.version} · código {selectedAcceptance.contract.code}</h3></div>
          {contratoAssinado.conferencia === 'confere' && <span className="adminStatus">Documento confere</span>}
          {contratoAssinado.conferencia === 'diferente' && <span className="adminStatus adminStatus--warn">Documento não confere</span>}
        </div>
        <div className="crmOpportunityFacts">
          <div><span>Assinado como</span><strong>{selectedAcceptance.contract.signedName}</strong></div>
          <div><span>RG</span><strong>{selectedAcceptance.contract.rg || 'não informado'}</strong></div>
          <div><span>Endereço</span><strong>{selectedAcceptance.contract.address || 'não informado'}</strong></div>
          <div><span>Assinado em</span><strong>{selectedAcceptance.contract.signedAt ? new Date(selectedAcceptance.contract.signedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'sem data'}</strong></div>
          <div><span>IP de origem</span><strong>{selectedAcceptance.contract.ip || 'não registrado'}</strong></div>
          <div><span>Impressão digital</span><strong className="adminContract__hash">{selectedAcceptance.contract.fingerprint}</strong></div>
        </div>
        {contratoAssinado.loading && <p className="adminContract__status">Abrindo o contrato assinado...</p>}
        {contratoAssinado.error && <p className="adminContract__status adminContract__status--warn">{contratoAssinado.error}</p>}
        {!contratoAssinado.loading && !contratoAssinado.error && !contratoAssinado.text && <p className="adminContract__status">Este aceite guardou a assinatura e a impressão digital, mas não o texto do documento — assinaturas feitas antes de 09/09/2026. O modelo da versão {selectedAcceptance.contract.version} continua em <a href="/aceite/cabeleireiro-profissional">/aceite/cabeleireiro-profissional</a>, e a impressão digital acima identifica exatamente qual texto foi assinado.</p>}
        {contratoAssinado.text && <>
          <div className="adminContract__doc"><pre>{contratoAssinado.text}</pre></div>
          <button type="button" className="button button--outline" onClick={() => window.print()}>Imprimir / salvar em PDF</button>
        </>}
      </div> : <div className="adminContractNote"><strong>Sem contrato assinado.</strong><small>Só as turmas do Cabeleireiro Profissional exigem assinatura de contrato. Os demais cursos registram o aceite dos termos, que está acima.</small></div>}
    </aside></div>}
  </div>;
  const coursesContent = <>
    <div className="adminMetrics"><div><strong>{agendaCourses(catalog).length}</strong><span>cursos cadastrados</span></div><div><strong>{rows.length}</strong><span>turmas/opções</span></div><div><strong>{openRows.reduce((sum, row) => sum + row.capacity, 0)}</strong><span>vagas totais abertas</span></div><div><strong>{openRows.reduce((sum, row) => sum + row.available, 0)}</strong><span>vagas disponíveis</span></div></div>
    <div className="adminPanelCard"><div className="adminTableHeader"><div><p className="eyebrow">Agenda</p><h2>Visão geral da agenda pública</h2></div><p>Ordem cronológica por mês, turma, vagas e fluxo de pagamento — reflete exatamente o que a aluna vê no site.</p></div><div className="adminTableWrap"><table className="adminTable"><thead><tr><th>Mês</th><th>Curso</th><th>Categoria</th><th>Turma/opção</th><th>Fluxo</th><th>Vagas</th><th>Preço</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.course.slug}-${row.date}`}><td data-label="Mês">{row.month}</td><td data-label="Curso"><strong>{row.course.name}</strong>{row.variant && <small>{row.variant}</small>}</td><td data-label="Categoria">{row.course.category}</td><td data-label="Turma/opção">{row.date}</td><td data-label="Fluxo"><span className="adminFlow">{row.flow}</span></td><td data-label="Vagas"><span className={row.available <= 0 ? 'stockPill stockPill--soldout' : row.available <= 5 ? 'stockPill stockPill--low' : 'stockPill'}>{row.available}/{row.capacity}</span><small>{row.reserved} reservadas</small></td><td data-label="Preço">{row.price}</td><td data-label="Status"><span className="adminStatus">{row.course.status}</span></td></tr>)}</tbody></table></div></div>
    <AdminCoursesManagementPanel />
  </>;
  const pageContent = {
    dashboard: dashboardContent,
    alunos: studentContent,
    vendas: <>{salesReportCard}{salesReportPage}</>,
    cupons: <AdminCouponsPanel />,
    ofertas: <AdminOffersPanel />,
    demandas: demandsContent,
    aceites: acceptancesContent,
    cursos: coursesContent,
    operacao: <><AdminMaterialsPanel /><AdminCertificatesPanel /><AdminBadgeBenefitsPanel /><AdminNotificationsPanel /></>,
    agencia: <AdminAgencyDemandsPanel />,
    'lista-espera': <AdminWaitlistPanel />,
    usuarios: <AdminUsersPanel />,
  }[activeSection];

  return <section className="adminPage adminSaasPage"><div className={sidebarOpen ? 'adminShell adminShell--withSidebar adminSaasShell adminShell--sidebarOpen' : 'adminShell adminShell--withSidebar adminSaasShell'}><button type="button" className="adminSidebar__backdrop" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} /><aside className="adminSidebar" aria-label="Menu do painel"><div className="adminSidebar__brand"><strong>a escola</strong><span>Admin OS</span></div><nav>{adminNavGroups.map((group) => <div className="adminSidebar__group" key={group}><p className="adminSidebar__groupLabel">{group}</p>{adminNavItems.filter(([, , , itemGroup]) => itemGroup === group).map(([key, href, label]) => <a key={key} className={(key === activeSection || (key === 'crm' && section === 'crm')) ? 'is-active' : ''} href={href}>{label}</a>)}</div>)}</nav></aside><div className="adminContent"><div className="adminTopbar"><button type="button" className="adminSidebar__toggle" aria-label="Abrir menu" onClick={() => setSidebarOpen(true)}><span /><span /><span /></button><div><span>Painel administrativo</span><strong>Operação a escola</strong></div><div className="adminTopbar__actions"><a href="/aluno">Ver área da aluna</a><a href="/painel/crm">Abrir CRM</a></div></div><div className="adminHero"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div><div className="adminHeroCard"><span>Potencial aberto</span><strong>{brl(revenuePotential)}</strong><small>Turmas com data definida no calendário atual.</small></div></div>
    <div className={adminData.error ? 'adminDataBanner adminDataBanner--warn' : isDatabaseMode ? 'adminDataBanner adminDataBanner--ok' : 'adminDataBanner'}>{adminData.loading ? 'Carregando dados protegidos do painel...' : adminData.error ? 'Não consegui carregar o resumo protegido agora. Mantive o fallback visual para não quebrar o painel.' : isDatabaseMode ? 'Banco conectado: alunos, carrinhos, cupons e pagamentos abaixo vêm da base protegida.' : 'Banco ainda não conectado: painel exibindo dados demonstrativos enquanto a persistência não é ativada.'}</div>
    {/* Tabela que não respondeu aparece com nome e motivo. Antes uma consulta quebrada derrubava
        as oito e a tela ficava só "vazia" — a de aceites dizia "nenhum aceite registrado ainda"
        quando o problema era outra tabela (achado em 09/09/2026). */}
    {truncatedSources.length > 0 && <div className="adminDataBanner adminDataBanner--warn"><strong>Chegou no limite da consulta.</strong> {truncatedSources.map((f) => `${f.tabela} (${f.limite})`).join(', ')}. Tem mais registro do que cabe nesta tela. O relatório de vendas mostra tudo; para o painel, o limite precisa ser aumentado.</div>}
    {failedSources.length > 0 && <div className="adminDataBanner adminDataBanner--warn"><strong>Parte do painel não carregou.</strong> {failedSources.map((fonte) => `${fonte.tabela} (${fonte.code})`).join(', ')}. O resto da tela é real; o que vem dessas tabelas fica em branco até o banco responder.</div>}
    {pageContent}
  </div></div></section>;
}

export function CrmWorkspacePage() {
  const [adminData, setAdminData] = useState({ loading: true, summary: null, error: '' });
  const [filters, setFilters] = useState({ search: '', stage: '', source: '', campaign: '', priority: 'all' });
  const [selectedId, setSelectedId] = useState('');
  const [crmActionState, setCrmActionState] = useState({ loadingId: '', message: '', error: '' });
  const [whatsappTemplate, setWhatsappTemplate] = useState(whatsappDispatchOptions[0].key);
  const [showDismissed, setShowDismissed] = useState(false);

  async function loadSummary(active = true) {
    try {
      const response = await fetch('/api/admin/summary', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (!active) return;
      if (!response.ok || !data.ok) throw new Error(data.error || 'summary_failed');
      setAdminData({ loading: false, summary: data, error: '' });
    } catch (error) {
      if (active) setAdminData({ loading: false, summary: null, error: error.message || 'summary_failed' });
    }
  }

  useEffect(() => {
    let active = true;
    loadSummary(active);
    return () => { active = false; };
  }, []);

  async function persistCrmAction(row, activityType) {
    const labels = { contacted: 'Contato registrado', lost: 'Lead marcado como perdido', resolved: 'Pendência resolvida', dismissed: 'Card removido do CRM', restored: 'Card restaurado no CRM' };
    setCrmActionState({ loadingId: `${row.id}-${activityType}`, message: '', error: '' });
    try {
      const response = await fetch('/api/admin/summary', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'crm_activity', activity: { leadKey: row.id, activityType, status: activityType, note: row.nextAction, owner: row.owner, course: row.course, phone: row.phone, email: row.email, stage: row.stage, source: row.source, campaign: row.campaign } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'crm_activity_failed');
      setCrmActionState({ loadingId: '', message: labels[activityType] || 'Ação registrada', error: '' });
      if (activityType === 'dismissed' && selectedId === row.id) setSelectedId('');
      await loadSummary(true);
    } catch {
      setCrmActionState({ loadingId: '', message: '', error: 'Não consegui registrar essa ação agora.' });
    }
  }

  function dismissCard(row, event) {
    event.stopPropagation();
    if (!window.confirm(`Remover "${row.name}" do CRM? O card some do pipeline, mas nada é apagado do banco — dá pra restaurar depois em "Mostrar cards removidos".`)) return;
    persistCrmAction(row, 'dismissed');
  }

  async function triggerWhatsapp(row) {
    const option = whatsappOptionByKey(whatsappTemplate);
    setCrmActionState({ loadingId: `${row.id}-whatsapp`, message: '', error: '' });
    try {
      const response = await fetch('/api/admin/summary', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'whatsapp_dispatch', templateKey: option.key, opportunity: row }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'whatsapp_dispatch_failed');
      const sent = Boolean(data.dispatch?.messageSent || data.dispatch?.whatsapp?.sent);
      setCrmActionState({ loadingId: '', message: sent ? `${option.label} enviado pela Twilio.` : `${option.label} registrado, mas a Twilio não confirmou envio. Confira aprovação do template e número do aluno.`, error: '' });
      await loadSummary(true);
    } catch (error) {
      setCrmActionState({ loadingId: '', message: '', error: error.message === 'whatsapp_channel_not_configured' ? 'Twilio ainda não está configurada na Vercel.' : 'Esse template ainda não foi disparado. Confira aprovação do template, configuração Twilio e opt-in.' });
    }
  }

  const isDatabaseMode = adminData.summary?.mode === 'database';
  const sales = isDatabaseMode ? buildSalesFromSummary(adminData.summary) : [];
  const acceptanceRows = isDatabaseMode ? buildAcceptanceRows(adminData.summary) : [];
  const manualRows = isDatabaseMode ? buildManualFollowupRows(adminData.summary) : [];
  const abandonedRows = isDatabaseMode ? buildAbandonedCartRows(adminData.summary) : [];
  const trackingEvents = adminData.summary?.trackingEvents || [];
  const crmActivities = adminData.summary?.crmActivities || [];
  // Excluir card (pedido da Erica, 03/09/2026): a última atividade "dismissed"/"restored"
  // registrada pra esse lead_key decide se o card fica escondido do pipeline. Reversível —
  // não apaga nada do banco, só tira da visão até alguém restaurar.
  const latestActivityByLeadKey = new Map();
  for (const activity of crmActivities) {
    if (!latestActivityByLeadKey.has(activity.lead_key)) latestActivityByLeadKey.set(activity.lead_key, activity);
  }
  const dismissedIds = new Set([...latestActivityByLeadKey.entries()].filter(([, activity]) => activity.activity_type === 'dismissed').map(([leadKey]) => leadKey));
  const allCrmRows = buildCrmRows(sales, acceptanceRows, manualRows, abandonedRows, buildClubRows(adminData.summary));
  const dismissedCount = allCrmRows.filter((row) => dismissedIds.has(row.id)).length;
  const crmRows = showDismissed ? allCrmRows.filter((row) => dismissedIds.has(row.id)) : allCrmRows.filter((row) => !dismissedIds.has(row.id));
  const crmStages = crmStageOptions(crmRows);
  const crmSources = crmOriginOptions(crmRows);
  const crmCampaigns = crmCampaignOptions(crmRows, filters.source);
  const filteredRows = filterCrmRows(crmRows, filters);
  const columns = crmKanbanColumns(filteredRows);
  const selected = filteredRows.find((row) => row.id === selectedId) || null;
  const selectedTimeline = selected ? crmTimelineForRow(selected, trackingEvents) : [];
  const whatsappChannelConfigured = Boolean(adminData.summary?.integrations?.whatsappConfigured);
  const selectedWhatsappOption = whatsappOptionByKey(whatsappTemplate);
  const totalValue = filteredRows.reduce((sum, row) => sum + (Number(String(row.value || '').replace(/[^\d,.-]/g, '').replace('.', '').replace(',', '.')) || 0), 0);
  const journeyCounts = crmJourneyStages.map((stage, index) => ({ ...stage, count: index === 0 ? filteredRows.filter((row) => row.source).length : index === 1 ? filteredRows.length : index === 2 ? filteredRows.filter((row) => row.course || row.classDate).length : filteredRows.filter((row) => crmJourneyIndex(row) === index).length }));
  if (adminData.loading) return <section className="adminPage crmWorkspace"><div className="crmWorkspaceLoading"><p className="eyebrow">CRM a escola</p><h1>Carregando oportunidades...</h1><p>Buscando leads, matrículas, aceites e pagamentos.</p></div></section>;
  if (adminData.error) return <section className="adminPage crmWorkspace"><div className="crmWorkspaceLoading"><p className="eyebrow">CRM a escola</p><h1>Não consegui abrir o CRM</h1><p>Se sua sessão expirou, entre novamente no painel.</p><a className="button button--primary" href="/login?next=/painel/crm">Entrar no painel</a></div></section>;

  return <section className="crmWorkspace adminPage">
    <div className="crmWorkspaceToolbar"><div><p className="eyebrow">CRM a escola</p><h1>Oportunidades</h1><p>Pipeline de matrículas, origem, campanha e próxima ação.</p></div><div className="crmWorkspaceTop__actions"><a className="button button--outline" href="/painel">Voltar ao painel</a></div></div>
    <div className="crmWorkspaceStats"><div><span>Oportunidades</span><strong>{filteredRows.length}</strong></div><div><span>Alta prioridade</span><strong>{filteredRows.filter((row) => row.score >= 70).length}</strong></div><div><span>Pendentes</span><strong>{filteredRows.filter((row) => /pendente|manual|aceite/i.test(row.stage)).length}</strong></div><div><span>Valor mapeado</span><strong>{money(Math.round(totalValue * 100))}</strong></div></div>
    <div className="crmJourneyMap crmJourneyMap--workspace" aria-label="Mapa da jornada de venda">{journeyCounts.map((step, index) => <div className="crmJourneyStep" key={step.key}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.label}</strong><small>{step.hint}</small></div><em>{step.count}</em></div>)}</div>
    <div className="crmWorkspaceFilters"><label>Buscar<input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder="Nome, telefone, curso, campanha..." /></label><label>Etapa<select value={filters.stage} onChange={(event) => setFilters((prev) => ({ ...prev, stage: event.target.value }))}><option value="">Todas as etapas</option>{crmStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></label><label>Origem<select value={filters.source} onChange={(event) => setFilters((prev) => ({ ...prev, source: event.target.value, campaign: '' }))}><option value="">Todas as origens</option>{crmSources.map((source) => <option key={source} value={source}>{source}</option>)}</select></label><label>Campanha/anúncio<select value={filters.campaign} onChange={(event) => setFilters((prev) => ({ ...prev, campaign: event.target.value }))}><option value="">Todas as campanhas</option>{crmCampaigns.map((campaign) => <option key={campaign} value={campaign}>{campaign}</option>)}</select></label><label>Prioridade<select value={filters.priority} onChange={(event) => setFilters((prev) => ({ ...prev, priority: event.target.value }))}><option value="all">Todas</option><option value="hot">Alta</option><option value="warm">Baixa/média</option></select></label><button className="button button--outline" type="button" onClick={() => setFilters({ search: '', stage: '', source: '', campaign: '', priority: 'all' })}>Limpar</button><button className={showDismissed ? 'button button--outline is-active' : 'button button--outline'} type="button" onClick={() => setShowDismissed((prev) => !prev)}>{showDismissed ? 'Ver pipeline ativo' : `Cards removidos (${dismissedCount})`}</button></div>
    {crmActionState.message && <div className="crmActionNotice crmActionNotice--ok">{crmActionState.message}</div>}{crmActionState.error && <div className="crmActionNotice crmActionNotice--error">{crmActionState.error}</div>}
    <div className="crmWorkspaceGrid" id="pipeline"><div className="crmWorkspacePipeline" aria-label="Pipeline de oportunidades">{columns.map((column) => <section className="crmWorkspaceColumn" key={column.stage}><div className="crmWorkspaceColumn__head"><div><strong>{column.stage}</strong><small>{opportunityLabel(column.rows.length)}</small></div><span>{column.rows.length}</span></div><div className="crmWorkspaceColumn__cards">{column.rows.length ? column.rows.map((row) => <div className={selected?.id === row.id ? 'crmOpportunityCard crmOpportunityCard--active' : 'crmOpportunityCard'} key={row.id}><button type="button" className="crmOpportunityCard__delete" title={showDismissed ? 'Restaurar no pipeline' : 'Remover do CRM'} disabled={crmActionState.loadingId === `${row.id}-dismissed` || crmActionState.loadingId === `${row.id}-restored`} onClick={(event) => showDismissed ? (event.stopPropagation(), persistCrmAction(row, 'restored')) : dismissCard(row, event)}>{showDismissed ? '↺' : '×'}</button><button type="button" className="crmOpportunityCard__body" onClick={() => setSelectedId(row.id)}><div className="crmOpportunityCard__top"><span className={crmStatusClass(row.tone)}>{row.score}</span><small>{crmOriginLabel(row)}</small></div><strong>{row.name}</strong><em>{row.course}</em><small>{row.classDate}</small><p>{crmCampaignLabel(row)}</p></button></div>) : <div className="crmColumnEmpty">{showDismissed ? 'Nenhum card removido.' : 'Sem oportunidades aqui.'}</div>}</div></section>)}</div></div>
    {selected && <div className="crmDrawerOverlay" role="presentation" onClick={() => setSelectedId('')}><aside className="crmOpportunityDrawer" aria-label="Detalhe da oportunidade" onClick={(event) => event.stopPropagation()}><button className="crmDrawerClose" type="button" onClick={() => setSelectedId('')} aria-label="Fechar detalhes">×</button><div className="crmOpportunityDrawer__head"><span className={crmStatusClass(selected.tone)}>{selected.stage}</span><h2>{selected.name}</h2><p>{selected.course}</p></div><div className="crmOpportunityFacts"><div className="crmOpportunityFact crmOpportunityFact--contact"><span>WhatsApp</span><strong>{selected.phone || 'sem telefone'}</strong>{crmWhatsappHref(selected) ? <a className="crmContactButton" href={crmWhatsappHref(selected)} target="_blank" rel="noreferrer">Chamar contato</a> : <small>Telefone não disponível</small>}<div className="crmWhatsappBox"><div className="crmWhatsappPicker"><label>Template WhatsApp/Twilio<select value={whatsappTemplate} onChange={(event) => setWhatsappTemplate(event.target.value)}>{whatsappDispatchOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label><span className={selectedWhatsappOption.active && whatsappChannelConfigured ? 'crmTemplateBadge crmTemplateBadge--active' : 'crmTemplateBadge'}>{selectedWhatsappOption.active ? (whatsappChannelConfigured ? 'Twilio configurada' : 'Aguardando Twilio') : 'Rascunho - não dispara'}</span></div><div className="crmTemplatePreview"><span>Mensagem prevista</span><p>{whatsappPreviewText(selectedWhatsappOption, selected)}</p></div><button type="button" className="crmWhatsappButton" disabled={crmActionState.loadingId === `${selected.id}-whatsapp` || !selected.phone || !selectedWhatsappOption.active || !whatsappChannelConfigured} onClick={() => triggerWhatsapp(selected)}>{selectedWhatsappOption.active ? (whatsappChannelConfigured ? (crmActionState.loadingId === `${selected.id}-whatsapp` ? 'Enviando...' : 'Enviar pela Twilio') : 'Aguardando Twilio') : 'Aguardando template aprovado'}</button></div></div><div><span>Veio de</span><strong>{crmOriginLabel(selected)}</strong></div><div><span>Turma</span><strong>{selected.classDate}</strong></div><div><span>Valor</span><strong>{selected.value}</strong></div><div><span>Responsável</span><strong>{selected.owner}</strong></div></div><div className="crmOpportunityNotes crmOpportunityNotes--summary"><h3>Resumo da oportunidade</h3><p>Etapa atual: <strong>{selected.stage}</strong></p><small>Origem: {crmOriginGroup(selected)} · Campanha/anúncio: {crmCampaignLabel(selected)} · Contato: {selected.phone || 'sem telefone'}</small></div><div className="crmStoryline"><h3>Histórico automático da oportunidade</h3><p>Eventos reais capturados pela agenda, pagamento e automações. O que ainda não voltou do sistema aparece como aguardando.</p><ol>{selectedTimeline.map((item) => <li key={item.key} className={`crmStoryline__item crmStoryline__item--${item.status}`}><span>{item.at}</span><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</li>)}</ol></div></aside></div>}
  </section>;
}
