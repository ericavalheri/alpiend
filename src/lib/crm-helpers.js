// Monta e classifica as linhas do CRM (matrículas, aceites, pendências manuais, carrinhos
// abandonados) a partir do resumo bruto que vem de /api/admin/summary, e organiza a esteira
// (kanban), filtros e timeline por lead. Extraído de src/main.jsx (organização de arquivos
// pedida pela Erica, 05/09/2026).
import { money, normalizeStatusText, uniqueSorted } from './format.js';

export function buildSalesFromSummary(summary) {
  const studentsById = Object.fromEntries((summary?.students || []).map((student) => [student.id, student]));
  const paymentsByEnrollment = Object.fromEntries((summary?.payments || []).map((payment) => [payment.enrollment_id, payment]));
  const cartsByEnrollment = Object.fromEntries((summary?.carts || []).map((cart) => [cart.enrollment_id, cart]));
  return (summary?.enrollments || []).map((enrollment) => {
    const student = studentsById[enrollment.student_id] || {};
    const payment = paymentsByEnrollment[enrollment.id] || {};
    const cart = cartsByEnrollment[enrollment.id] || {};
    const attribution = cart.attribution || {};
    const source = enrollment.source || attribution.utm_source || student.created_source || 'sem origem';
    const campaign = enrollment.campaign || attribution.utm_campaign || 'sem campanha';
    const studentPortal = enrollment.metadata?.studentPortal || {};
    return {
      enrollmentId: enrollment.id,
      studentId: student.id,
      cartId: cart.id,
      paymentId: payment.id,
      sessionId: attribution.session_id || null,
      name: student.name || 'Aluno sem nome',
      phone: student.whatsapp || 'sem WhatsApp',
      email: student.email || 'sem email',
      course: enrollment.course_name || enrollment.course_slug,
      courseSlug: enrollment.course_slug,
      option: enrollment.option_label || enrollment.class_date,
      // A data da turma vai crua junto: o check-in é conferido contra a turma, e option_label
      // ("Cab Noite") não identifica turma nenhuma no banco.
      classDate: enrollment.class_date || '',
      // Código de check-in calculado no servidor (lib/checkin.mjs) — o painel só exibe.
      checkInCode: enrollment.checkin_code || '',
      source,
      campaign,
      method: payment.method ? `${payment.provider || 'pagamento'} / ${payment.method}` : enrollment.flow,
      paid: payment.amount ? money(Math.round(Number(payment.amount) * 100)) : money(Math.round(Number(enrollment.amount_expected || 0) * 100)),
      // O mesmo valor em número, pra somar. "paid" acima é texto formatado em reais e não
      // serve pra conta nenhuma — o relatório de vendas precisa somar de verdade.
      amountNumber: Number(payment.amount ?? enrollment.amount_expected ?? 0) || 0,
      status: payment.status || enrollment.status,
      paymentStatus: payment.status || '',
      paymentMethod: payment.method || '',
      cartStatus: cart.status || '',
      couponCode: cart.coupon_code || '',
      cart: cart.coupon_code ? `Cupom ${cart.coupon_code}` : (cart.status || 'sem carrinho'),
      studentPortal,
      attribution,
      createdAt: enrollment.created_at || student.created_at || cart.created_at || null,
      journey: [attribution.first_landing_page, attribution.last_referrer].filter(Boolean).join(' > ') || 'jornada ainda não registrada',
    };
  });
}

export function buildStudentPortalRows(sales = []) {
  // Matrícula = pagamento (confirmado pela Erica, 04/09/2026): "pago" só pode vir do status
  // real do pagamento (sale.paymentStatus). Testar contra sale.status também foi um bug real
  // achado numa auditoria: sale.status cai pro status cru da matrícula quando não há
  // pagamento (ex.: "voomp_sale_received"), que contém "received" e batia como se pago.
  const isPaidStatus = (value = '') => /confirmed|received|paid|pago|confirmado|approved|aprovado/i.test(value);
  return sales.map((sale, index) => {
    const paid = isPaidStatus(sale.paymentStatus || '');
    const portal = sale.studentPortal || {};
    const finished = portal.certificateReleased === true || /conclu|certificado|completed/i.test(`${sale.status || ''}`);
    const sequence = sales.filter((item) => item.email === sale.email && isPaidStatus(item.paymentStatus || '')).length;
    // Check-in (revisto em 08/09/2026). Antes esta coluna dizia "Liberado" pra toda matrícula
    // paga, sem olhar nada gravado — então o botão "liberar check-in" do painel não mudava
    // nada na tela e parecia quebrado. Agora são três estados de verdade: sem pagamento o
    // código nem existe; com pagamento o código vale; e presença confirmada é o que a equipe
    // registrou na porta.
    const checkInConfirmed = portal.checkInConfirmed === true;
    return {
      id: `${sale.studentId || sale.email}-${sale.enrollmentId || index}`,
      enrollmentId: sale.enrollmentId,
      studentId: sale.studentId,
      name: sale.name,
      contact: [sale.phone, sale.email].filter(Boolean).join(' · '),
      phone: sale.phone,
      email: sale.email,
      course: sale.course,
      courseSlug: sale.courseSlug,
      classDate: sale.option,
      classDateRaw: sale.classDate || '',
      checkInCode: sale.checkInCode || '',
      checkInConfirmed,
      checkInConfirmedAt: portal.checkInConfirmedAt || '',
      checkin: checkInConfirmed ? 'Presença confirmada' : paid ? 'Código válido' : 'Aguardando pagamento',
      certificate: finished ? 'Disponível' : 'Após conclusão',
      discount: paid ? `${Math.min(30, 5 + Math.max(0, sequence - 1) * 5)}% próximo curso` : 'Sem liberação',
      materials: portal.materialsReleased === true ? 'Liberados' : 'Apostila + orientações',
      portal,
      canRelease: Boolean(sale.enrollmentId),
      // Confirmar presença exige matrícula paga — a mesma regra é reconferida no servidor
      // antes de gravar (lib/db.mjs, confirmStudentCheckIn). Aqui é só pra não oferecer um
      // botão que vai recusar.
      canConfirmCheckIn: Boolean(sale.enrollmentId) && paid,
      paid,
      paymentStatus: sale.paymentStatus || '',
      paidLabel: sale.paid || '',
    };
  });
}

// O aceite não depende mais de uma linha só (09/09/2026).
//
// A tabela `acceptances` é uma projeção: o que a aluna aceitou já fica guardado junto da
// matrícula, em metadata.audit, gravado no mesmo pedido. Se a projeção falhar ou a leitura
// dela quebrar, o registro legal continua existindo — e sumir da tela seria o pior jeito de
// tratar isso, justamente numa tela de contrato assinado. Então a lista sai das duas fontes,
// com a tabela mandando quando as duas têm a mesma matrícula.
function contractFromAudit(audit) {
  const assinatura = audit?.contractSignature;
  if (!assinatura) return null;
  return {
    code: assinatura.code || '',
    signedName: assinatura.signedName || '',
    name: assinatura.name || '',
    cpf: assinatura.cpf || '',
    rg: assinatura.rg || '',
    address: assinatura.address || '',
    classDate: assinatura.classDate || '',
    version: assinatura.contractVersion || '',
    fingerprint: assinatura.contractFingerprint || '',
    length: Number(assinatura.contractLength || 0),
    signedAt: assinatura.signedAt || '',
    ip: assinatura.ip || '',
    userAgent: assinatura.userAgent || '',
  };
}

function acceptanceRow({ id, enrollmentId, studentId, courseSlug, classDate, termsVersion, termsRead, paymentAware, enrollmentAware, wantsContact, attribution, audit, createdAt, origem }, student = {}, enrollment = {}) {
  const allChecked = !!termsRead && !!paymentAware && !!enrollmentAware;
  const contract = contractFromAudit(audit);
  return {
    id,
    enrollmentId,
    studentId,
    origin: origem,
    name: student.name || contract?.name || 'Aluno sem nome',
    phone: student.whatsapp || 'sem WhatsApp',
    email: student.email || 'sem email',
    cpf: student.cpf_last4 ? `***.${student.cpf_last4}` : 'não exibido',
    course: enrollment.course_name || courseSlug,
    classDate,
    status: allChecked ? 'Aceite validado' : 'Aceite incompleto',
    checks: [termsRead && 'termos', paymentAware && 'pagamento', enrollmentAware && 'matrícula'].filter(Boolean).join(' + ') || 'pendente',
    contactBeforePayment: wantsContact ? 'quer falar antes' : 'pode seguir checkout',
    source: attribution?.utm_source || enrollment.source || student.created_source || 'sem origem',
    createdAt: createdAt ? new Date(createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'sem data',
    // Ordenar pela data já formatada em pt-BR colocaria 09/09 depois de 10/08 — a chave crua
    // fica guardada só pra ordenação.
    sortKey: createdAt || '',
    termsVersion: termsVersion || 'sem versão',
    contract,
  };
}

export function buildAcceptanceRows(summary) {
  const studentsById = Object.fromEntries((summary?.students || []).map((student) => [student.id, student]));
  const enrollmentsById = Object.fromEntries((summary?.enrollments || []).map((enrollment) => [enrollment.id, enrollment]));

  const daTabela = (summary?.acceptances || []).map((acceptance) => acceptanceRow({
    id: acceptance.id,
    enrollmentId: acceptance.enrollment_id,
    studentId: acceptance.student_id,
    courseSlug: acceptance.course_slug,
    classDate: acceptance.class_date,
    termsVersion: acceptance.terms_version,
    termsRead: acceptance.terms_read,
    paymentAware: acceptance.payment_aware,
    enrollmentAware: acceptance.enrollment_aware,
    wantsContact: acceptance.wants_contact_before_payment,
    attribution: acceptance.attribution,
    audit: acceptance.metadata?.audit,
    createdAt: acceptance.created_at,
    origem: 'aceite',
  }, studentsById[acceptance.student_id] || {}, enrollmentsById[acceptance.enrollment_id] || {}));

  const jaListadas = new Set(daTabela.map((row) => row.enrollmentId).filter(Boolean));
  const daMatricula = (summary?.enrollments || [])
    .filter((enrollment) => enrollment.metadata?.audit?.acceptedAt && !jaListadas.has(enrollment.id))
    .map((enrollment) => {
      const audit = enrollment.metadata.audit;
      return acceptanceRow({
        id: `matricula:${enrollment.id}`,
        enrollmentId: enrollment.id,
        studentId: enrollment.student_id,
        courseSlug: enrollment.course_slug,
        classDate: enrollment.class_date,
        termsVersion: audit.termsVersion,
        // O aceite só chega a virar matrícula depois das três caixinhas — o servidor recusa
        // antes disso. Reconstruir como "validado" descreve o que de fato aconteceu.
        termsRead: true,
        paymentAware: true,
        enrollmentAware: true,
        wantsContact: false,
        attribution: enrollment.metadata?.attribution,
        audit,
        createdAt: audit.acceptedAt || enrollment.created_at,
        origem: 'matricula',
      }, studentsById[enrollment.student_id] || {}, enrollment);
    });

  return [...daTabela, ...daMatricula].sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)));
}

export function buildManualFollowupRows(summary) {
  return (summary?.trackingEvents || [])
    .filter((event) => event.event_name === 'whatsapp_followup_not_sent')
    .map((event) => {
      const payload = typeof event.payload === 'string' ? JSON.parse(event.payload || '{}') : (event.payload || {});
      return {
        id: event.id,
        name: payload.name || 'Nome não informado',
        phone: payload.whatsapp || payload.phone || 'sem telefone',
        email: payload.email || 'sem email',
        course: payload.courseName || payload.course_name || payload.courseSlug || 'curso não identificado',
        classDate: payload.classDate || payload.class_date || 'turma não identificada',
        status: payload.voompStatus || payload.checkoutStatus || 'status não identificado',
        amount: payload.amount || payload.value || payload.total || 'valor não informado',
        paymentMethod: payload.paymentMethod || payload.payment_method || 'método não informado',
        saleId: payload.voompSaleId || payload.voomp_sale_id || payload.sale_id || event.session_id || 'sem sale id',
        createdAt: event.created_at ? new Date(event.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'sem data',
      };
    });
}

export function buildAbandonedCartRows(summary) {
  return (summary?.trackingEvents || [])
    .filter((event) => event.event_name === 'cart_abandoned')
    .map((event) => {
      const payload = crmEventPayload(event);
      const cart = payload.cart || {};
      return {
        id: event.id,
        trackingEventId: event.id,
        sessionId: event.session_id,
        name: payload.studentName || payload.name || 'Contato sem nome',
        phone: payload.studentWhatsapp || payload.whatsapp || payload.phone || 'sem WhatsApp',
        email: payload.studentEmail || payload.email || 'sem email',
        course: payload.course_name || payload.courseName || cart.courseName || payload.course_slug || payload.courseSlug || 'curso não identificado',
        courseSlug: payload.course_slug || payload.courseSlug || cart.courseSlug || '',
        classDate: payload.class_date || payload.classDate || cart.classDate || 'turma não identificada',
        source: event.utm_source || payload.attribution?.utm_source || 'site',
        campaign: event.utm_campaign || payload.attribution?.utm_campaign || 'carrinho-abandonado',
        couponCode: payload.coupon || cart.coupon || 'EBN10',
        value: cart.price || (cart.priceNumber ? money(Math.round(Number(cart.priceNumber) * 100)) : 'valor não informado'),
        createdAt: event.created_at || null,
        attribution: payload.attribution || {},
      };
    });
}

// Leads do Clube da Escola no pipeline (11/09/2026).
//
// O CRM é montado a partir de MATRÍCULAS — e quem entra no Clube não tem matrícula nenhuma, por
// design. Sem isto o cadastro do clube caía no banco e sumia da tela: a escola teria o telefone
// guardado e nenhuma forma de ver que ele existe, que é exatamente o problema que o clube veio
// resolver.
export function buildClubRows(summary) {
  const comMatricula = new Set((summary?.enrollments || []).map((matricula) => matricula.student_id));
  return (summary?.students || [])
    .filter((aluna) => aluna?.metadata?.clubeEscola?.joinedAt)
    // Quem já tem matrícula já está no pipeline pelo card da venda — não precisa de um segundo.
    .filter((aluna) => !comMatricula.has(aluna.id))
    .map((aluna) => {
      const clube = aluna.metadata.clubeEscola;
      return {
        id: `clube-${aluna.id}`,
        studentId: aluna.id,
        name: aluna.name || 'Sem nome',
        phone: aluna.whatsapp || 'sem WhatsApp',
        email: aluna.email || 'sem email',
        course: clube.courseName || clube.courseSlug || 'Ainda escolhendo',
        courseSlug: clube.courseSlug || '',
        classDate: clube.classDate || 'sem turma escolhida',
        source: clube.utmSource || aluna.created_source || 'clube ebn',
        campaign: clube.utmCampaign || 'clube-ebn',
        createdAt: clube.joinedAt || aluna.created_at || null,
        stage: 'Lead capturado',
        tone: 'neutral',
        // Abaixo do lead que já começou uma matrícula (55): entrou no clube é interesse
        // declarado, não é intenção de compra. A ordem da tela tem que refletir isso.
        score: 50,
        nextAction: 'Entrou no Clube da Escola — apresentar a turma e conduzir para a matrícula',
        owner: 'CRM automático',
        value: 'Sem matrícula ainda',
      };
    });
}

export function crmStageFromStatus(status = '') {
  const normalized = normalizeStatusText(status);
  // Guarda (achado numa auditoria em 04/09/2026): "voomp_sale_received"/"sale_received" são
  // marcadores internos de "venda registrada, ainda NÃO paga" — mas contêm a palavra
  // "received", que o regex de pagamento confirmado logo abaixo leria por engano como pago.
  // Precisa ser conferido antes do regex genérico (mesma classe de bug já corrigida no
  // paidStatus() do servidor, lib/db.mjs).
  if (/voomp_sale_received|sale_status_unknown|webhook_status_unknown/.test(normalized)) return { stage: 'Aceite realizado', tone: 'warn', score: 74, nextAction: 'Enviar link/lembrar checkout da matrícula' };
  if (/pago|paid|confirmed|confirmado|received|recebido/.test(normalized)) return { stage: 'Matrícula confirmada', tone: 'success', score: 100, nextAction: 'Enviar próximos passos e lembrete da turma' };
  if (/cancel|perdido|deleted|refunded|estorno/.test(normalized)) return { stage: 'Perdido/cancelado', tone: 'danger', score: 5, nextAction: 'Registrar motivo e remover da recuperação' };
  if (/pendente|pending|created|criado|boleto|pix/.test(normalized)) return { stage: 'Pagamento pendente', tone: 'warn', score: 82, nextAction: 'Disparar template de pagamento pendente via Twilio' };
  if (/abandonado|abandoned/.test(normalized)) return { stage: 'Carrinho abandonado', tone: 'warn', score: 88, nextAction: 'Enviar cupom EBN10 via Twilio' };
  if (/aceite|acceptance|validado/.test(normalized)) return { stage: 'Aceite realizado', tone: 'warn', score: 74, nextAction: 'Enviar link/lembrar checkout da matrícula' };
  if (/lead|intent|submitted|payload/.test(normalized)) return { stage: 'Lead capturado', tone: 'neutral', score: 55, nextAction: 'Nutrir no WhatsApp e conduzir para pagamento' };
  return { stage: 'Em acompanhamento', tone: 'neutral', score: 40, nextAction: 'Revisar no atendimento e definir próximo passo' };
}

// Pipeline do CRM (revisado em 11/09/2026, a pedido da Erica).
//
// Três coisas estavam erradas aqui, e as três batiam exatamente na queixa de "os leads chegam e
// ninguém atende":
//
//   1. A lista terminava com .slice(0, 35). Com 50 oportunidades, 15 sumiam da tela — e como a
//      ordem é por pontuação, quem caía fora era justamente a menor pontuação: "Lead capturado"
//      e "Em acompanhamento", ou seja, o lead novo que ainda não fez nada. O CRM escondia
//      exatamente quem mais precisava de atendimento.
//   2. Quem fez o aceite aparecia DUAS vezes: uma como matrícula, outra como aceite. Dez alunas,
//      vinte cards.
//   3. O id do card saía do índice da lista (`sale-email-19`). Bastava entrar uma venda nova pra
//      todo mundo mudar de id — e quem tinha sido escondido no CRM voltava, enquanto outra
//      pessoa sumia no lugar.
export function buildCrmRows(sales = [], acceptanceRows = [], manualFollowupRows = [], abandonedCartRows = [], clubRows = []) {
  const saleRows = sales.map((sale) => {
    const stage = crmStageFromStatus(sale.status || sale.cart);
    return {
      // Id preso à matrícula, não à posição na lista: é o que faz "esconder card" continuar
      // valendo pra mesma pessoa amanhã.
      id: `sale-${sale.enrollmentId || `${sale.email}-${sale.courseSlug || ''}`}`,
      enrollmentId: sale.enrollmentId,
      studentId: sale.studentId,
      sessionId: sale.sessionId,
      name: sale.name,
      phone: sale.phone,
      email: sale.email,
      course: sale.course,
      courseSlug: sale.courseSlug,
      classDate: sale.option,
      source: sale.source,
      campaign: sale.campaign,
      couponCode: sale.couponCode,
      paymentMethod: sale.paymentMethod,
      paymentStatus: sale.paymentStatus,
      cartStatus: sale.cartStatus,
      attribution: sale.attribution,
      createdAt: sale.createdAt,
      stage: stage.stage,
      tone: stage.tone,
      score: stage.score,
      nextAction: stage.nextAction,
      owner: /whatsapp|agent|twilio/i.test(`${sale.source} ${sale.journey}`) ? 'Atendimento WhatsApp' : 'CRM automático',
      value: sale.paid,
    };
  });
  // Aceite de matrícula que já está na lista de vendas não vira card separado: é a mesma
  // oportunidade vista de outro ângulo, e o card de venda traz pagamento e carrinho junto.
  const matriculasJaListadas = new Set(saleRows.map((row) => row.enrollmentId).filter(Boolean));
  const acceptanceCrmRows = acceptanceRows.filter((row) => !row.enrollmentId || !matriculasJaListadas.has(row.enrollmentId)).map((row) => {
    const stage = crmStageFromStatus(row.status);
    return {
      id: `acceptance-${row.id}`,
      enrollmentId: row.enrollmentId,
      studentId: row.studentId,
      name: row.name,
      phone: row.phone,
      email: row.email,
      course: row.course,
      classDate: row.classDate,
      source: row.source,
      campaign: 'aceite-cabeleireiro',
      stage: stage.stage,
      tone: stage.tone,
      score: stage.score,
      nextAction: row.contactBeforePayment === 'quer falar antes' ? 'Atendimento humano antes do pagamento' : stage.nextAction,
      owner: 'Atendimento WhatsApp',
      value: 'Matrícula Voomp',
    };
  });
  const manualRows = manualFollowupRows.map((row) => ({
    id: `manual-${row.id}`,
    name: row.name,
    phone: row.phone,
    email: row.email,
    course: row.course,
    classDate: row.classDate,
    source: 'Webhook pagamento',
    campaign: 'pendência manual',
    stage: 'Atenção manual',
    tone: 'warn',
    score: 90,
    nextAction: 'Chamar no WhatsApp e conferir envio da Twilio',
    owner: 'Atendimento humano',
    value: row.amount,
  }));
  const abandonedRows = abandonedCartRows.map((row) => ({
    id: `abandoned-${row.id}`,
    trackingEventId: row.trackingEventId,
    sessionId: row.sessionId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    course: row.course,
    courseSlug: row.courseSlug,
    classDate: row.classDate,
    source: row.source,
    campaign: row.campaign,
    couponCode: row.couponCode,
    attribution: row.attribution,
    createdAt: row.createdAt,
    stage: 'Carrinho abandonado',
    tone: 'warn',
    score: 88,
    nextAction: 'Enviar cupom EBN10 via Twilio',
    owner: 'CRM automático',
    value: row.value,
  }));
  // Sem corte. Quem filtra é a tela (etapa, origem, campanha, busca) e o Kanban, que mostram o
  // total de verdade — esconder oportunidade em silêncio é o pior jeito de "organizar" a lista.
  return [...manualRows, ...abandonedRows, ...acceptanceCrmRows, ...saleRows, ...clubRows].sort((a, b) => b.score - a.score);
}

export function crmStatusClass(tone) {
  if (tone === 'danger') return 'adminStatus adminStatus--danger';
  if (tone === 'warn') return 'adminStatus adminStatus--warn';
  if (tone === 'success') return 'adminStatus';
  return 'adminStatus adminStatus--neutral';
}

export const crmJourneyStages = [
  { key: 'origem', label: 'Origem', hint: 'Entrou por anúncio, busca, WhatsApp ou indicação' },
  { key: 'lead', label: 'Lead', hint: 'Contato identificado no CRM' },
  { key: 'interesse', label: 'Interesse', hint: 'Curso/turma escolhidos ou conversa iniciada' },
  { key: 'decisao', label: 'Decisão', hint: 'Precisa de aceite, resposta ou pagamento' },
  { key: 'compra', label: 'Compra', hint: 'Matrícula confirmada ou perdida' },
];

export function crmJourneyIndex(row) {
  const stage = normalizeStatusText(row.stage || '');
  if (/confirmada|pago|matricula/.test(stage)) return 4;
  if (/perdido|cancelado/.test(stage)) return 4;
  if (/pagamento|aceite|manual|pendente/.test(stage)) return 3;
  if (/acompanhamento/.test(stage)) return 2;
  if (/lead/.test(stage)) return 1;
  return 1;
}

export function crmMissingToBuy(row) {
  const stage = normalizeStatusText(row.stage || '');
  if (/confirmada|pago|matricula/.test(stage)) return 'Nada: matrícula concluída';
  if (/perdido|cancelado/.test(stage)) return 'Recuperar objeção ou arquivar';
  if (/manual/.test(stage)) return 'Atendimento humano resolver pendência';
  if (/pagamento/.test(stage)) return 'Concluir pagamento';
  if (/aceite/.test(stage)) return 'Enviar próximo passo de pagamento';
  if (/acompanhamento/.test(stage)) return 'Responder dúvida e chamar para matrícula';
  return 'Confirmar interesse e turma';
}

export function crmEventPayload(event = {}) {
  if (!event?.payload) return {};
  if (typeof event.payload === 'string') {
    try { return JSON.parse(event.payload || '{}') || {}; } catch { return {}; }
  }
  return event.payload || {};
}

export function crmEventDate(value) {
  if (!value) return 'sem data';
  try { return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch { return 'sem data'; }
}

export function crmTimelineLabel(event = {}) {
  const payload = crmEventPayload(event);
  const name = event.event_name || payload.event || '';
  const labels = {
    session_attribution_updated: 'Sessão identificada e atribuição registrada',
    select_agenda_summary: 'Clicou em uma turma na agenda',
    select_course_card: 'Clicou em saber mais do curso',
    view_agenda: 'Visualizou a agenda',
    view_course: 'Entrou na página do curso',
    click_enrollment_cta: 'Clicou para fazer matrícula',
    click_whatsapp_help: 'Clicou para tirar dúvida no WhatsApp',
    begin_enrollment: 'Chegou ao formulário de matrícula',
    submit_lead: 'Enviou os dados da matrícula',
    payment_payload_validated: 'Carrinho e pagamento foram registrados',
    create_payment_mock: 'Pagamento foi preparado/exibido',
    asaas_payment_created: 'Cobrança foi emitida',
    begin_voomp_acceptance: 'Iniciou aceite de pré-matrícula',
    submit_voomp_acceptance: 'Aceite de pré-matrícula enviado',
    acceptance_validated: 'Aceite validado no CRM',
    voomp_payment_confirmed: 'Pagamento Voomp confirmado',
    sale_paid: 'Venda marcada como paga',
    whatsapp_followup_not_sent: 'WhatsApp automático não foi enviado',
    whatsapp_coupon_sent: 'Cupom enviado no WhatsApp',
    whatsapp_abandoned_cart_coupon_sent: 'Carrinho abandonado + cupom enviado no WhatsApp',
    whatsapp_abandoned_cart_coupon_requested: 'Carrinho abandonado + cupom solicitado no WhatsApp',
    whatsapp_payment_pending_sent: 'Pagamento pendente enviado no WhatsApp',
    whatsapp_payment_pending_requested: 'Pagamento pendente solicitado no WhatsApp',
    whatsapp_enrollment_confirmation_sent: 'Confirmação de matrícula enviada no WhatsApp',
    whatsapp_enrollment_confirmation_requested: 'Confirmação de matrícula solicitada no WhatsApp',
    whatsapp_class_reminder_sent: 'Lembrete de aula enviado no WhatsApp',
    whatsapp_class_reminder_requested: 'Lembrete de aula solicitado no WhatsApp',
    whatsapp_human_followup_sent: 'Atendimento humano acionado no WhatsApp',
    whatsapp_human_followup_requested: 'Atendimento humano solicitado no WhatsApp',
    whatsapp_abandoned_cart_sent: 'Recuperação de carrinho enviada no WhatsApp',
    whatsapp_message_delivered: 'Mensagem entregue no WhatsApp',
    whatsapp_coupon_applied: 'Cupom aplicado no checkout',
  };
  return labels[name] || name.replaceAll('_', ' ') || 'Evento registrado';
}

export function crmTimelineDetail(event = {}) {
  const payload = crmEventPayload(event);
  const raw = payload.raw || {};
  const course = payload.course_name || payload.courseName || payload.course_slug || payload.courseSlug || raw.ebn_curso_nome || raw.course_name || '';
  const classDate = payload.class_date || payload.classDate || raw.ebn_turma_data || '';
  const campaign = event.utm_campaign || payload.utm_campaign || payload.attribution?.utm_campaign || raw.utm_campaign || '';
  const coupon = payload.coupon || payload.cart?.coupon || payload.cart?.couponCode || raw.coupon || raw.ebn_coupon || '';
  const method = payload.payment_method || payload.paymentMethod || raw.payment_method || '';
  return [course, classDate, campaign && `campanha ${campaign}`, coupon && `cupom ${coupon}`, method && `pagamento ${method}`].filter(Boolean).join(' · ');
}

export function crmWhatsappDigits(phone = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits || digits.length < 10) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function crmWhatsappHref(row = {}) {
  const digits = crmWhatsappDigits(row.phone);
  if (!digits) return '';
  const message = `Oi, ${row.name || 'tudo bem'}! Aqui é da escola. Estou te chamando sobre sua matrícula no curso ${row.course || ''}${row.classDate ? `, turma ${row.classDate}` : ''}.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export const whatsappDispatchOptions = [
  { key: 'enrollment_started', label: 'Matrícula iniciada - Twilio', active: true, preview: 'Oi, {{nome}}! Vimos que você iniciou sua matrícula no curso {{curso}}, turma {{turma}}. Se precisar de ajuda para concluir, estamos por aqui.' },
  { key: 'enrollment_confirmation', label: 'Matrícula confirmada - Twilio', active: true, preview: 'Oi, {{nome}}! Sua matrícula no curso {{curso}} foi confirmada. Em breve enviaremos as orientações da turma {{turma}}.' },
  { key: 'abandoned_cart_coupon', label: 'Carrinho abandonado + cupom EBN10 - Twilio', active: true, preview: 'Oi, {{nome}}! Vi que você começou sua matrícula no curso {{curso}} e ainda não concluiu. Para te ajudar, liberamos o cupom EBN10 para usar no checkout da turma {{turma}}.' },
  { key: 'payment_pending', label: 'Pagamento pendente - Twilio', active: true, preview: 'Oi, {{nome}}! Sua pré-matrícula em {{curso}} está quase confirmada. Falta só concluir o pagamento da turma {{turma}} para garantir sua vaga.' },
  { key: 'class_reminder', label: 'Lembrete de aula - Twilio', active: true, preview: 'Oi, {{nome}}! Passando para lembrar da sua turma de {{curso}} em {{turma}}. Qualquer dúvida, fale com a equipe a escola.' },
  { key: 'human_followup', label: 'Atendimento humano - aguardando template aprovado', active: false, preview: 'Oi, {{nome}}! Aqui é da equipe a escola. Estou te chamando para te ajudar com sua matrícula no curso {{curso}}, turma {{turma}}.' },
];

export function whatsappOptionByKey(key) {
  return whatsappDispatchOptions.find((item) => item.key === key) || whatsappDispatchOptions[0];
}

export function whatsappPreviewText(option, row = {}) {
  return String(option?.preview || '')
    .replaceAll('{{nome}}', row.name || 'aluno(a)')
    .replaceAll('{{curso}}', row.course || 'curso escolhido')
    .replaceAll('{{turma}}', row.classDate || 'turma escolhida');
}

export function crmTimelineForRow(row = {}, trackingEvents = []) {
  const matches = trackingEvents.filter((event) => {
    const payload = crmEventPayload(event);
    return (row.enrollmentId && event.enrollment_id === row.enrollmentId)
      || (row.studentId && event.student_id === row.studentId)
      || (row.sessionId && event.session_id === row.sessionId)
      || (row.trackingEventId && event.id === row.trackingEventId)
      || (row.courseSlug && (payload.course_slug === row.courseSlug || payload.courseSlug === row.courseSlug));
  }).sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  const actual = matches.map((event) => ({ status: 'done', at: crmEventDate(event.created_at), title: crmTimelineLabel(event), detail: crmTimelineDetail(event), key: `event-${event.id}` }));
  const expected = [];
  if (!matches.some((event) => ['whatsapp_coupon_sent', 'whatsapp_abandoned_cart_sent', 'whatsapp_abandoned_cart_coupon_sent', 'whatsapp_abandoned_cart_coupon_requested'].includes(event.event_name))) {
    expected.push({ status: 'pending', at: 'aguardando', title: 'Automação de WhatsApp/cupom', detail: 'Aparece aqui quando a Twilio retornar o disparo, entrega ou cupom enviado.', key: 'expected-whatsapp' });
  }
  if (row.couponCode) expected.push({ status: 'done', at: 'registrado', title: 'Cupom usado no carrinho', detail: row.couponCode, key: 'coupon-used' });
  else expected.push({ status: 'pending', at: 'se acontecer', title: 'Cupom aplicado no checkout', detail: 'Quando o aluno usar cupom, entra como passo da jornada.', key: 'coupon-pending' });
  if (/pendente|created|pending/i.test(row.paymentStatus || row.stage || '')) expected.push({ status: 'current', at: 'agora', title: 'Aguardando pagamento', detail: [row.paymentMethod && `método ${row.paymentMethod}`, row.value].filter(Boolean).join(' · '), key: 'payment-waiting' });
  if (/confirmada|confirmed|received|paid/i.test(row.paymentStatus || row.stage || '')) expected.push({ status: 'done', at: 'confirmado', title: 'Pagamento confirmado', detail: 'Matrícula pronta para confirmação e lembretes.', key: 'payment-confirmed' });
  const origin = { status: 'done', at: row.createdAt ? crmEventDate(row.createdAt) : 'início', title: `Veio de ${crmOriginGroup(row)}`, detail: [`campanha ${crmCampaignLabel(row)}`, row.attribution?.last_landing_page || row.source].filter(Boolean).join(' · '), key: 'origin' };
  return [origin, ...actual, ...expected].filter((item, index, array) => array.findIndex((other) => other.key === item.key) === index).slice(-12);
}

export function crmOriginLabel(row) {
  const source = String(row.source || '').trim();
  if (!source) return 'Origem não identificada';
  return crmOriginGroup(row);
}

export function opportunityLabel(count) {
  return `${count} ${count === 1 ? 'oportunidade' : 'oportunidades'}`;
}

export const crmStageOrder = ['Lead capturado', 'Em acompanhamento', 'Aceite realizado', 'Carrinho abandonado', 'Pagamento pendente', 'Atenção manual', 'Matrícula confirmada', 'Perdido/cancelado'];
export const crmOriginOrder = ['Meta Ads', 'Google orgânico', 'WhatsApp', 'Direto/indicação', 'Twilio', 'Agente IA', 'Webhook pagamento', 'Outros'];

export function crmOriginGroup(row = {}) {
  const text = normalizeStatusText([row.source, row.campaign, row.journey, row.owner].filter(Boolean).join(' '));
  if (/meta|facebook|instagram|fbclid|ig|ads/.test(text)) return 'Meta Ads';
  if (/google|gclid|organico|orgânico|seo|busca/.test(text)) return 'Google orgânico';
  if (/whatsapp|wa\.me|wpp/.test(text)) return 'WhatsApp';
  if (/twilio/.test(text)) return 'Twilio';
  if (/agent|agente|ia|zaya/.test(text)) return 'Agente IA';
  if (/webhook|voomp|asaas|pagamento/.test(text)) return 'Webhook pagamento';
  if (/direto|direct|indicacao|indicação|sem origem|sem campanha|none|null/.test(text)) return 'Direto/indicação';
  return 'Outros';
}

export function crmCampaignLabel(row = {}) {
  const campaign = String(row.campaign || '').trim();
  if (!campaign || /sem campanha|none|null|undefined/i.test(campaign)) return 'Sem campanha identificada';
  return campaign;
}

export function crmStageOptions(rows = []) {
  const found = uniqueSorted(rows.map((row) => row.stage));
  return [...crmStageOrder, ...found.filter((stage) => !crmStageOrder.includes(stage))];
}

export function crmOriginOptions(rows = []) {
  const found = uniqueSorted(rows.map((row) => crmOriginGroup(row)));
  return [...crmOriginOrder, ...found.filter((origin) => !crmOriginOrder.includes(origin))];
}

export function crmCampaignOptions(rows = [], source = '') {
  const scoped = source ? rows.filter((row) => crmOriginGroup(row) === source) : rows;
  return uniqueSorted(scoped.map((row) => crmCampaignLabel(row)));
}

export function filterCrmRows(rows, filters) {
  const search = normalizeStatusText(filters.search);
  return rows.filter((row) => {
    const haystack = normalizeStatusText([row.name, row.phone, row.email, row.course, row.classDate, row.source, crmOriginGroup(row), row.campaign, row.stage, row.owner].join(' '));
    const matchesSearch = !search || haystack.includes(search);
    const matchesStage = !filters.stage || row.stage === filters.stage;
    const matchesSource = !filters.source || crmOriginGroup(row) === filters.source;
    const matchesCampaign = !filters.campaign || crmCampaignLabel(row) === filters.campaign;
    const matchesPriority = filters.priority === 'all' || (filters.priority === 'hot' ? row.score >= 70 : row.score < 70);
    return matchesSearch && matchesStage && matchesSource && matchesCampaign && matchesPriority;
  });
}

export function crmKanbanColumns(rows) {
  const stages = crmStageOptions(rows);
  return stages
    .map((stage) => ({ stage, rows: rows.filter((row) => row.stage === stage).sort((a, b) => b.score - a.score) }))
}
