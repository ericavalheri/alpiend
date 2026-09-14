// Certificado automático: emite todo dia o que estiver vencido.
//
// A regra é "turma terminou E presença confirmada" (lib/certificates.mjs). A presença é um
// evento — dá pra reagir na hora. O fim da turma é só o tempo passando, e ninguém dispara nada
// por isso: por isso existe este cron. Turma que terminou ontem vira certificado hoje de manhã,
// sem a equipe lembrar de nada.
//
// Emitir é idempotente: matrícula que já tem certificado é pulada, então rodar duas vezes no
// mesmo dia não gera documento duplicado.
import { isDbConfigured, issueDueCertificates } from '../../lib/db.mjs';

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  // Mesma proteção dos outros crons: na Vercel o agendador manda o header de autorização; sem
  // segredo configurado, o endpoint fica fechado em vez de aberto pra qualquer um disparar.
  const secret = process.env.CRON_SECRET || '';
  const recebido = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '') || request.query?.token || '';
  if (secret && recebido !== secret) {
    return response.status(401).json({ ok: false, error: 'unauthorized' });
  }
  if (!isDbConfigured()) {
    return response.status(503).json({ ok: false, error: 'database_not_configured' });
  }
  try {
    const resultado = await issueDueCertificates({ receivedAt: new Date().toISOString(), actor: { username: 'cron' } });
    return response.status(200).json({
      ok: true,
      status: 'certificates_checked',
      analisadas: resultado.analisadas,
      emitidos: resultado.emitidos.length,
      certificados: resultado.emitidos.map((item) => ({ code: item.code, aluna: item.studentName, curso: item.courseName })),
    });
  } catch (error) {
    console.error('certificates_cron_failed', error);
    return response.status(500).json({ ok: false, error: error.code || 'certificates_cron_failed' });
  }
}
