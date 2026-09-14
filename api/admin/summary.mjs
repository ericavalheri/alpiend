import { ROLE_PERMISSIONS, authConfig, hasPermission, verifySession } from '../../lib/admin_auth.mjs';
import { acceptanceContract, adminSummary, confirmStudentCheckIn, deleteStudentIfEmpty, persistCrmActivity, setStudentArchived, supabaseRequest, undoStudentCheckIn, updateStudentBadgeMission, updateStudentPortalEnrollment } from '../../lib/db.mjs';
import { studentAccessConfigured } from '../../lib/student_access.mjs';
import { notifyOfficialWhatsapp, whatsappConfig } from '../../lib/whatsapp.mjs';

const ACTION_PERMISSIONS = {
  crm_activity: 'crm',
  whatsapp_dispatch: 'whatsapp_dispatch',
  student_portal_update: 'students',
  student_checkin_confirm: 'students',
  student_checkin_undo: 'students',
  student_archive: 'students_archive',
  student_delete: 'students_archive',
  student_badge_review: 'badge_review',
  // Contrato assinado é documento com dado pessoal completo (CPF, RG, endereço): quem vê o
  // painel de aceites vê, o resto não.
  acceptance_contract: 'dashboard',
};

const WHATSAPP_ACTIONS = {
  enrollment_started: { eventName: 'crm_enrollment_started', templateName: 'ebn_matricula_iniciada', label: 'Matrícula iniciada', active: true },
  abandoned_cart_coupon: { eventName: 'crm_abandoned_cart_coupon', templateName: 'ebn_carrinho_abandonado_cupom', label: 'Carrinho abandonado + cupom EBN10', active: true },
  payment_pending: { eventName: 'crm_payment_pending', templateName: 'ebn_pagamento_pendente', label: 'Pagamento pendente', active: true },
  enrollment_confirmation: { eventName: 'crm_enrollment_confirmation', templateName: 'ebn_matricula_confirmada', label: 'Confirmação de matrícula', active: true },
  class_reminder: { eventName: 'crm_class_reminder', templateName: 'ebn_lembrete_aula', label: 'Lembrete de aula', active: true },
  human_followup: { eventName: 'crm_human_followup', templateName: 'ebn_atendimento_humano', label: 'Atendimento humano', active: false },
};

function safeText(value = '', max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanPhone(value = '') {
  const phone = String(value || '').replace(/\D/g, '').slice(0, 20);
  if (!phone) return '';
  return phone.startsWith('55') ? phone : `55${phone}`;
}

async function dispatchWhatsapp(body = {}, audit = {}) {
  const templateKey = safeText(body.templateKey || body.template_key, 80);
  const config = WHATSAPP_ACTIONS[templateKey];
  if (!config) {
    const error = new Error('invalid_whatsapp_template');
    error.code = 'invalid_whatsapp_template';
    throw error;
  }
  if (!config.active) {
    const error = new Error('whatsapp_template_not_active');
    error.code = 'whatsapp_template_not_active';
    throw error;
  }
  const opportunity = body.opportunity || {};
  const payload = {
    eventName: config.eventName,
    templateName: config.templateName || templateKey,
    template_name: config.templateName || templateKey,
    label: config.label,
    name: safeText(opportunity.name, 180),
    studentName: safeText(opportunity.name, 180),
    email: safeText(opportunity.email, 180),
    phone: cleanPhone(opportunity.phone),
    whatsapp: cleanPhone(opportunity.phone),
    courseSlug: safeText(opportunity.courseSlug, 120),
    courseName: safeText(opportunity.course, 180),
    classDate: safeText(opportunity.classDate, 180),
    checkoutStatus: safeText(opportunity.stage, 120),
    amount: safeText(opportunity.value, 80),
    coupon: templateKey === 'abandoned_cart_coupon' ? 'EBN10' : safeText(opportunity.couponCode, 80),
    attribution: {
      session_id: safeText(opportunity.sessionId, 160),
      utm_source: safeText(opportunity.source, 120),
      utm_campaign: safeText(opportunity.campaign, 180),
    },
    crm: { templateKey, templateName: config.templateName || templateKey, label: config.label, opportunityId: safeText(opportunity.id, 220), stage: safeText(opportunity.stage, 120), audit },
  };
  const result = await notifyOfficialWhatsapp(config.eventName, payload);
  if (!result?.sent && !result?.configured) {
    const error = new Error('whatsapp_channel_not_configured');
    error.code = 'whatsapp_channel_not_configured';
    throw error;
  }
  const messageSent = Boolean(result?.sent);
  await supabaseRequest('tracking_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      event_name: messageSent ? `whatsapp_${templateKey}_sent` : `whatsapp_${templateKey}_requested`,
      student_id: safeText(opportunity.studentId, 120) || null,
      enrollment_id: safeText(opportunity.enrollmentId, 120) || null,
      session_id: safeText(opportunity.sessionId, 160) || null,
      utm_source: safeText(opportunity.source, 120) || null,
      utm_campaign: safeText(opportunity.campaign, 180) || null,
      payload: { templateKey, label: config.label, opportunity, whatsapp: result, audit },
    }),
  });
  return { templateKey, label: config.label, messageSent, whatsapp: result };
}

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  try {
    const config = authConfig();
    const session = config.configured ? verifySession(request, config.sessionSecret) : null;
    // O middleware já bloqueia quem não tem sessão válida; aqui checamos o papel específico
    // (regra P1.7 do Manual do produto: "ocultar um botão não é controle de acesso").
    if (request.method === 'POST') {
      const body = request.body || {};
      const requiredPermission = ACTION_PERMISSIONS[body.action];
      if (requiredPermission && !hasPermission(session, requiredPermission)) {
        return response.status(403).json({ ok: false, error: 'forbidden', requiredPermission });
      }
      const audit = {
        receivedAt: new Date().toISOString(),
        ip: request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket?.remoteAddress || null,
        userAgent: request.headers['user-agent'] || null,
        actor: session ? { username: session.username, role: session.role } : null,
      };
      if (body.action === 'crm_activity') {
        const activity = await persistCrmActivity(body.activity || {}, audit);
        return response.status(201).json({ ok: true, status: 'crm_activity_persisted', activity });
      }
      if (body.action === 'whatsapp_dispatch') {
        const dispatch = await dispatchWhatsapp(body, audit);
        return response.status(202).json({ ok: true, status: 'whatsapp_dispatch_processed', dispatch });
      }
      if (body.action === 'student_portal_update') {
        const update = await updateStudentPortalEnrollment(body.portal || {}, audit);
        return response.status(200).json({ ok: true, status: 'student_portal_updated', update });
      }
      // Presença na aula, conferida pelo código que a aluna mostra na Minha Área. As recusas
      // vêm com mensagem pronta em português: quem está na porta precisa saber na hora por que
      // não deu, não decifrar um código de erro.
      if (body.action === 'student_checkin_confirm') {
        try {
          const checkin = await confirmStudentCheckIn(body.checkin || {}, audit);
          return response.status(200).json({ ok: true, status: 'student_checkin_confirmed', checkin });
        } catch (error) {
          const motivos = {
            checkin_code_required: 'Digite o código que aparece na Minha Área da aluna.',
            checkin_code_not_found: 'Nenhuma matrícula com esse código. Confira as 6 letras/números com a aluna.',
            checkin_code_other_student: 'Esse código é de outra matrícula, não da que está aberta aqui.',
            checkin_wrong_class: 'Essa matrícula é de outra turma.',
            checkin_requires_paid_enrollment: 'Matrícula sem pagamento confirmado: o check-in só libera depois que o pagamento entra.',
            enrollment_not_found: 'Matrícula não encontrada.',
          };
          const motivo = motivos[error.code];
          if (!motivo) throw error;
          return response.status(422).json({ ok: false, error: error.code, message: motivo });
        }
      }
      if (body.action === 'student_checkin_undo') {
        const checkin = await undoStudentCheckIn(body.checkin || {}, audit);
        return response.status(200).json({ ok: true, status: 'student_checkin_undone', checkin });
      }
      // Arquivar tira a aluna do painel sem apagar nada — é reversível pelo mesmo botão.
      if (body.action === 'student_archive') {
        const student = await setStudentArchived(body.student || {}, audit);
        return response.status(200).json({ ok: true, status: student.archived ? 'student_archived' : 'student_restored', student });
      }
      // Excluir de vez só passa quando não há nada preso no cadastro. A recusa vem com a
      // lista do que está preso, pra quem está na tela saber se é um pagamento de verdade.
      if (body.action === 'student_delete') {
        try {
          const student = await deleteStudentIfEmpty(body.student || {}, audit);
          return response.status(200).json({ ok: true, status: 'student_deleted', student });
        } catch (error) {
          if (error.code === 'student_has_history') {
            return response.status(422).json({
              ok: false,
              error: error.code,
              message: `Esse cadastro tem ${error.detalhe} preso nele. Excluir levaria junto o histórico, então aqui só dá pra arquivar — a aluna some do painel e você pode trazer de volta depois.`,
            });
          }
          if (error.code === 'student_not_found') {
            return response.status(404).json({ ok: false, error: error.code, message: 'Cadastro não encontrado. Talvez já tenha sido excluído.' });
          }
          throw error;
        }
      }
      if (body.action === 'acceptance_contract') {
        const contrato = await acceptanceContract(body.acceptanceId);
        return response.status(200).json({ ok: true, status: 'acceptance_contract_loaded', contract: contrato });
      }
      if (body.action === 'student_badge_review') {
        const portal = await updateStudentBadgeMission({ ...(body.badge || {}), action: body.badge?.action || 'approve' }, audit);
        return response.status(200).json({ ok: true, status: 'student_badge_reviewed', portal });
      }
      return response.status(400).json({ ok: false, error: 'invalid_admin_action' });
    }
    if (!hasPermission(session, 'dashboard')) {
      return response.status(403).json({ ok: false, error: 'forbidden' });
    }
    const summary = await adminSummary();
    const whatsapp = whatsappConfig();
    const twilioConfigured = Boolean(whatsapp.twilioAccountSid && whatsapp.twilioAuthToken && (whatsapp.twilioFrom || whatsapp.twilioMessagingServiceSid));
    const twilioCoreTemplatesConfigured = Boolean(whatsapp.contentSids.enrollmentStarted && whatsapp.contentSids.paymentPending && whatsapp.contentSids.enrollmentConfirmed);
    return response.status(200).json({
      ok: true,
      ...summary,
      integrations: {
        whatsappConfigured: Boolean(twilioConfigured || whatsapp.webhookUrl || (whatsapp.cloudToken && whatsapp.phoneNumberId)),
        whatsappFollowupMode: whatsapp.mode,
        twilioConfigured,
        twilioTemplatesConfigured: twilioCoreTemplatesConfigured,
        twilioStudentJourneyConfigured: Boolean(twilioCoreTemplatesConfigured && whatsapp.contentSids.studentAccess),
        twilioAbandonedCartConfigured: Boolean(whatsapp.contentSids.abandonedCartCoupon),
        // Clube da Escola (11/09/2026): template faltando é silencioso — o envio é pulado e ninguém
        // fica sabendo. O painel precisa poder dizer se está de pé.
        twilioClubeConfigured: Boolean(whatsapp.contentSids.clubeEscola),
        studentAccessConfigured: studentAccessConfigured(),
      },
      // O painel usa isto só pra não oferecer um botão que o servidor vai recusar. Quem manda
      // continua sendo a checagem do servidor a cada ação (regra P1.7 do Manual do produto).
      session: session ? { username: session.username, role: session.role, permissions: ROLE_PERMISSIONS[session.role] || [] } : null,
    });
  } catch (error) {
    const status = ['invalid_whatsapp_template', 'invalid_crm_activity_type', 'enrollment_id_required', 'badge_mission_required', 'invalid_badge_action', 'acceptance_id_required'].includes(error.code) ? 400 : error.code === 'acceptance_not_found' ? 404 : ['whatsapp_template_not_active', 'whatsapp_channel_not_configured', 'enrollment_not_found', 'student_access_not_found'].includes(error.code) ? 409 : 500;
    return response.status(status).json({ ok: false, error: error.code || 'admin_summary_failed' });
  }
}
