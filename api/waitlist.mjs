// Lista de espera real (regra §16.8 do Manual do produto, decisão de negócio 03/09/2026): quem entra
// aqui é avisado automaticamente por WhatsApp assim que uma vaga abre de verdade — ver
// releaseClassSeat em lib/db.mjs. Endpoint público, sem autenticação (mesmo espírito do
// formulário de matrícula: qualquer visitante pode entrar na fila de uma turma lotada).
import { joinWaitlist } from '../lib/db.mjs';
import { ensureLiveCourseCatalog, findCourse } from '../lib/courses.mjs';

function safeString(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanPhone(value = '') {
  return String(value || '').replace(/\D/g, '').slice(0, 20);
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = request.body || {};
  const courseSlug = safeString(body.courseSlug, 140);
  const classDate = safeString(body.classDate, 180);
  const name = safeString(body.name, 180);
  const whatsapp = cleanPhone(body.whatsapp);
  const email = safeString(body.email, 180).toLowerCase();

  if (!courseSlug || !classDate || !name || whatsapp.length < 10) {
    return response.status(400).json({ ok: false, error: 'invalid_waitlist_payload' });
  }
  await ensureLiveCourseCatalog();
  const course = findCourse(courseSlug);
  if (!course || !course.dates.includes(classDate)) {
    return response.status(400).json({ ok: false, error: 'class_date_not_found' });
  }

  try {
    const entry = await joinWaitlist({ courseSlug, classDate, name, email: email || null, whatsapp, source: 'agenda' });
    return response.status(201).json({ ok: true, status: 'waitlist_joined', entry: { id: entry.id } });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error.code || 'waitlist_join_failed' });
  }
}
