// Passo 1 do login seguro do aluno (regra P0.2 do Manual do produto): e-mail + 4 últimos
// dígitos do CPF nunca liberam acesso direto — apenas disparam um código de uso único
// pelo WhatsApp confirmado na matrícula. A resposta é sempre a mesma independentemente de
// a identidade existir ou não, para não permitir enumeração de alunos cadastrados.
import { requestStudentAccessCode } from '../../lib/db.mjs';
import { sendStudentAccessCode } from '../../lib/whatsapp.mjs';

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
    const result = await requestStudentAccessCode({
      email: safeString(body.email, 180),
      cpfLast4: safeString(body.cpfLast4 || body.cpf, 40),
    });
    if (result.matched && result.whatsapp) {
      const sendResult = await sendStudentAccessCode(result.whatsapp, result.code).catch((error) => ({ sent: false, error: error?.message || 'send_failed' }));
      if (!sendResult?.sent) {
        // A resposta ao navegador é sempre a mesma (anti-enumeração), mas o motivo real da
        // falha de envio precisa ficar visível nos logs da Vercel para dar pra diagnosticar.
        console.error('[student-access-code] falha ao enviar codigo por whatsapp', {
          studentId: result.studentId,
          reason: sendResult?.skipped || sendResult?.error || 'unknown',
          status: sendResult?.status || null,
        });
      }
    }
    return response.status(200).json({ ok: true, status: 'access_code_requested' });
  } catch (error) {
    const status = error.code === 'student_login_fields_required' ? 400 : 500;
    return response.status(status).json({ ok: false, error: error.code || 'access_code_request_failed' });
  }
}
