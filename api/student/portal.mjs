// Regra P0.2 do Manual do produto: e-mail + 4 últimos dígitos do CPF nunca dão acesso direto aos
// dados do aluno. O acesso exige um token assinado, obtido pelo link de boas-vindas ou pelo
// fluxo de código de uso único (/api/student/request-access-code + /verify-access-code).
import { getStudentPortalByIds } from '../../lib/db.mjs';
import { verifyStudentAccess } from '../../lib/student_access.mjs';

function safeString(value = '', max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const body = request.body || {};
    const token = safeString(body.token, 3000);
    if (!token) return response.status(401).json({ ok: false, error: 'student_access_token_required' });

    const verified = verifyStudentAccess(token);
    const portal = await getStudentPortalByIds({ studentId: verified.sid, enrollmentId: verified.eid });

    if (!portal) return response.status(404).json({ ok: false, error: 'student_access_not_found' });
    return response.status(200).json({ ok: true, portal });
  } catch (error) {
    const status = ['invalid_student_access_token', 'expired_student_access_token'].includes(error.code) ? 401 : error.code === 'student_access_secret_not_configured' ? 503 : 500;
    return response.status(status).json({ ok: false, error: error.code || 'student_portal_failed' });
  }
}
