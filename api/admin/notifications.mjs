// Avisos à aluna (tabela student_notifications). Só quem tem a permissão
// "notifications_manage" (owner, comercial ou acadêmico) pode cadastrar.
// Canal "app" aparece na Minha Área assim que marcado como enviado; canal "whatsapp" fica
// marcado para envio manual pelo atendimento, já que mensagem livre fora de template
// aprovado não é confiável via API do WhatsApp (regra P0.2/6 do Manual do produto).
import { authConfig, hasPermission, verifySession } from '../../lib/admin_auth.mjs';
import { createNotification, findStudentByEmail, listNotifications, markNotificationSent } from '../../lib/db.mjs';

function safeString(value = '', max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

const CHANNELS = ['app', 'whatsapp'];

export default async function handler(request, response) {
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, PATCH');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const config = authConfig();
  const session = config.configured ? verifySession(request, config.sessionSecret) : null;
  if (!hasPermission(session, 'notifications_manage')) {
    return response.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    if (request.method === 'GET') {
      const items = await listNotifications();
      return response.status(200).json({ ok: true, items });
    }

    const body = request.body || {};

    if (request.method === 'POST') {
      const title = safeString(body.title, 200);
      const message = safeString(body.message, 2000);
      const channel = CHANNELS.includes(body.channel) ? body.channel : 'app';
      const studentEmail = safeString(body.studentEmail, 180).toLowerCase();
      if (!title || !message) {
        return response.status(400).json({ ok: false, error: 'invalid_notification_payload' });
      }
      let studentId = null;
      if (studentEmail) {
        const student = await findStudentByEmail(studentEmail);
        if (!student) return response.status(404).json({ ok: false, error: 'student_not_found' });
        studentId = student.id;
      }
      const created = await createNotification({
        studentId,
        courseSlug: safeString(body.courseSlug, 120) || null,
        classDate: safeString(body.classDate, 180) || null,
        title,
        message,
        channel,
        createdBy: session.username || session.name || null,
      });
      return response.status(201).json({ ok: true, item: created });
    }

    const id = safeString(body.id, 120);
    if (!id) return response.status(400).json({ ok: false, error: 'invalid_notification_update' });
    const updated = await markNotificationSent(id);
    if (!updated) return response.status(404).json({ ok: false, error: 'notification_not_found' });
    return response.status(200).json({ ok: true, item: updated });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error.code || 'notification_failed' });
  }
}
