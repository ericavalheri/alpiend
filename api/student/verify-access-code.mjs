// Passo 2 do login seguro do aluno (regra P0.2 do Manual do produto): confirma o código de uso
// único enviado por WhatsApp e, só então, emite o token assinado que dá acesso à área do
// aluno (usado por /api/student/portal e /api/student/profile).
import { verifyStudentAccessCode } from '../../lib/db.mjs';
import { signStudentAccess } from '../../lib/student_access.mjs';

function safeString(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = request.body || {};
  try {
    const { studentId } = await verifyStudentAccessCode({
      email: safeString(body.email, 180),
      cpfLast4: safeString(body.cpfLast4 || body.cpf, 40),
      code: safeString(body.code, 12),
    });
    const token = signStudentAccess({ studentId });
    return response.status(200).json({ ok: true, token });
  } catch (error) {
    const clientErrors = ['student_login_fields_required', 'invalid_access_code', 'expired_access_code', 'too_many_attempts'];
    const status = clientErrors.includes(error.code) ? 400 : error.code === 'student_access_secret_not_configured' ? 503 : 500;
    return response.status(status).json({ ok: false, error: error.code || 'access_code_verify_failed' });
  }
}
