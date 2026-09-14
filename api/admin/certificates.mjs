// Certificados (tabela student_certificates). Só quem tem a permissão "certificates_manage"
// (owner ou acadêmico) pode registrar e liberar.
import { authConfig, hasPermission, verifySession } from '../../lib/admin_auth.mjs';
import { createCertificate, findStudentByEmail, listCertificates, updateCertificateStatus } from '../../lib/db.mjs';
import { uploadAdminFile } from '../../lib/uploads.mjs';

function safeString(value = '', max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

const STATUSES = ['draft', 'issued', 'released'];

export default async function handler(request, response) {
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, PATCH');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const config = authConfig();
  const session = config.configured ? verifySession(request, config.sessionSecret) : null;
  if (!hasPermission(session, 'certificates_manage')) {
    return response.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    if (request.method === 'GET') {
      const items = await listCertificates();
      return response.status(200).json({ ok: true, items });
    }

    const body = request.body || {};

    if (request.method === 'POST') {
      const studentEmail = safeString(body.studentEmail, 180).toLowerCase();
      const courseSlug = safeString(body.courseSlug, 120);
      const title = safeString(body.title, 200);
      let filePath = safeString(body.filePath, 1000);
      // Arquivo é opcional (10/09/2026): sem ele o sistema monta o certificado e o botão da
      // aluna abre esse documento. Exigir arquivo travava o cadastro enquanto a arte não chega
      // — e quem digitava um caminho qualquer pra passar do campo obrigatório acabava com um
      // certificado que abria em 404.
      if (!studentEmail || !courseSlug || !title) {
        return response.status(400).json({ ok: false, error: 'invalid_certificate_payload' });
      }
      const student = await findStudentByEmail(studentEmail);
      if (!student) return response.status(404).json({ ok: false, error: 'student_not_found' });
      if (body.fileData) {
        filePath = await uploadAdminFile(body.fileData, { bucket: 'student-certificates', folder: courseSlug });
      }

      const created = await createCertificate({
        studentId: student.id,
        courseSlug,
        classDate: safeString(body.classDate, 180) || null,
        title,
        filePath,
        studentName: student.name || '',
      });
      return response.status(201).json({ ok: true, item: created });
    }

    const id = safeString(body.id, 120);
    const status = STATUSES.includes(body.status) ? body.status : '';
    if (!id || !status) {
      return response.status(400).json({ ok: false, error: 'invalid_certificate_update' });
    }
    const updated = await updateCertificateStatus(id, status, session.username || session.name || '');
    if (!updated) return response.status(404).json({ ok: false, error: 'certificate_not_found' });
    return response.status(200).json({ ok: true, item: updated });
  } catch (error) {
    const clientErrors = ['invalid_file', 'file_too_large', 'storage_not_configured'];
    return response.status(clientErrors.includes(error.code) ? 400 : 500).json({ ok: false, error: error.code || 'certificate_failed' });
  }
}
