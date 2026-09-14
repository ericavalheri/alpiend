// Avaliação de curso dentro da Minha Área (pedido da Erica, 04/09/2026): exige o token
// assinado da aluna autenticada, igual todo write da área da aluna (regra P0.2 do Manual do produto).
// A validação de "matrícula é da aluna e está concluída" fica no servidor, em
// createCourseReview (lib/db.mjs) — nunca confia nisso vindo do corpo da requisição.
import { createCourseReview } from '../../lib/db.mjs';
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

    const audit = {
      receivedAt: new Date().toISOString(),
      ip: request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket?.remoteAddress || null,
      userAgent: request.headers['user-agent'] || null,
    };

    const verified = verifyStudentAccess(token);
    const portal = await createCourseReview({
      studentId: verified.sid,
      enrollmentId: body.enrollmentId,
      rating: body.rating,
      text: body.text,
    }, audit);

    if (!portal) return response.status(404).json({ ok: false, error: 'student_access_not_found' });
    return response.status(200).json({ ok: true, portal });
  } catch (error) {
    const clientErrors = ['invalid_course_review', 'course_not_completed', 'review_already_submitted', 'enrollment_not_found'];
    const authErrors = ['invalid_student_access_token', 'expired_student_access_token'];
    const status = clientErrors.includes(error.code) ? 400 : authErrors.includes(error.code) ? 401 : error.code === 'student_access_secret_not_configured' ? 503 : 500;
    return response.status(status).json({ ok: false, error: error.code || 'course_review_failed' });
  }
}
