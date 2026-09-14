import { adminSummary, supabaseRequest } from '../../lib/db.mjs';
import { notifyOfficialWhatsapp, whatsappConfig } from '../../lib/whatsapp.mjs';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PAID_STATUS = /confirmed|confirmado|received|recebido|paid|pago/i;

const MONTHS = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  março: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

function safeString(value = '', max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanPhone(value = '') {
  const phone = String(value || '').replace(/\D/g, '').slice(0, 20);
  if (!phone) return '';
  return phone.startsWith('55') ? phone : `55${phone}`;
}

function saoPauloToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function asNoonUtc({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function parseClassDate(value = '', reference = saoPauloToday()) {
  const raw = safeString(value, 180).toLowerCase();
  if (!raw || /confirmar|aguardar|lista/.test(raw)) return null;

  const numeric = raw.match(/(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
  if (numeric) {
    const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : reference.year;
    return { year, month: Number(numeric[2]), day: Number(numeric[1]) };
  }

  const textual = raw.match(/(\d{1,2})(?:\s*(?:e|,|-)\s*\d{1,2})?\s+de\s+([a-zç]+)(?:\s+de\s+(\d{4}))?/i);
  if (!textual) return null;
  const month = MONTHS[textual[2]];
  if (!month) return null;
  return { year: textual[3] ? Number(textual[3]) : reference.year, month, day: Number(textual[1]) };
}

function reminderDays(request) {
  const raw = safeString(request.query?.daysBefore || process.env.CLASS_REMINDER_DAYS_BEFORE || '1', 80);
  const days = raw.split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item >= 0 && item <= 14);
  return days.length ? days : [1];
}

function isDryRun(request) {
  return ['1', 'true', 'yes'].includes(String(request.query?.dryRun || request.query?.dry_run || '').toLowerCase());
}

// Ensaio (dryRun) NÃO é passe livre (corrigido em 11/09/2026).
//
// Antes, `?dryRun=1` pulava a checagem do segredo inteira — qualquer pessoa na internet
// chamava esta rota e recebia de volta a lista de quem está no meio de uma matrícula, com
// e-mail dentro da chave de recuperação. Ensaio muda o que a rota FAZ (não envia WhatsApp,
// não grava), nunca quem pode chamar.
function verifyCron(request, dryRun) {
  const configured = process.env.CRON_SECRET || '';
  if (!configured) return { ok: false, configured: false, error: 'cron_secret_not_configured' };
  const received = request.headers.authorization?.replace(/^Bearer\s+/i, '') || request.headers['x-cron-secret'] || request.query?.token || '';
  return { ok: received === configured, configured: true, error: received === configured ? null : 'unauthorized' };
}

function alreadyReminded(events = [], enrollmentId = '', reminderKey = '') {
  return events.some((event) => {
    if (!['whatsapp_class_reminder_sent', 'whatsapp_class_reminder_requested'].includes(event.event_name)) return false;
    const payload = event.payload || {};
    return payload.reminderKey === reminderKey || (event.enrollment_id && event.enrollment_id === enrollmentId);
  });
}

function buildCandidates(summary, daysBefore) {
  const today = saoPauloToday();
  const todayDate = asNoonUtc(today);
  const studentsById = new Map((summary.students || []).map((student) => [student.id, student]));
  const paidEnrollmentIds = new Set((summary.payments || [])
    .filter((payment) => PAID_STATUS.test(String(payment.status || '')))
    .map((payment) => payment.enrollment_id)
    .filter(Boolean));

  return (summary.enrollments || []).flatMap((enrollment) => {
    const parsedDate = parseClassDate(enrollment.class_date || enrollment.option_label || '', today);
    if (!parsedDate) return [];
    const daysUntil = Math.round((asNoonUtc(parsedDate).getTime() - todayDate.getTime()) / MS_PER_DAY);
    if (!daysBefore.includes(daysUntil)) return [];
    if (!paidEnrollmentIds.has(enrollment.id) && !PAID_STATUS.test(String(enrollment.status || ''))) return [];
    const student = studentsById.get(enrollment.student_id);
    const whatsapp = cleanPhone(student?.whatsapp || '');
    if (!student || !whatsapp) return [];

    const reminderKey = `class-reminder:${enrollment.id}:${daysUntil}:${parsedDate.year}-${String(parsedDate.month).padStart(2, '0')}-${String(parsedDate.day).padStart(2, '0')}`;
    if (alreadyReminded(summary.trackingEvents || [], enrollment.id, reminderKey)) return [];

    return [{
      reminderKey,
      daysUntil,
      enrollment,
      student,
      whatsapp,
      classDate: enrollment.class_date || enrollment.option_label || '',
      courseName: enrollment.course_name || enrollment.course_slug || 'Curso a escola',
      courseSlug: enrollment.course_slug || '',
    }];
  });
}

async function persistReminder(candidate, whatsapp, audit) {
  await supabaseRequest('tracking_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      event_name: whatsapp?.sent ? 'whatsapp_class_reminder_sent' : 'whatsapp_class_reminder_requested',
      student_id: candidate.student.id,
      enrollment_id: candidate.enrollment.id,
      payload: {
        reminderKey: candidate.reminderKey,
        daysUntil: candidate.daysUntil,
        course_slug: candidate.courseSlug,
        course_name: candidate.courseName,
        class_date: candidate.classDate,
        whatsapp,
        audit,
      },
    }),
  });
}

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const dryRun = isDryRun(request);
  const auth = verifyCron(request, dryRun);
  if (!auth.ok) return response.status(auth.configured ? 401 : 503).json({ ok: false, error: auth.error });

  const whatsapp = whatsappConfig();
  const twilioClassReminderConfigured = Boolean(whatsapp.contentSids.classReminder);
  const daysBefore = reminderDays(request);
  const audit = {
    receivedAt: new Date().toISOString(),
    source: 'vercel_cron_class_reminders',
    dryRun,
    daysBefore,
  };

  try {
    const summary = await adminSummary();
    const candidates = buildCandidates(summary, daysBefore);
    const results = [];

    for (const candidate of candidates) {
      if (dryRun) {
        results.push({ reminderKey: candidate.reminderKey, status: 'dry_run', studentId: candidate.student.id, enrollmentId: candidate.enrollment.id, daysUntil: candidate.daysUntil });
        continue;
      }
      const result = await notifyOfficialWhatsapp('crm_class_reminder', {
        provider: 'agenda_ebn',
        name: candidate.student.name || '',
        email: candidate.student.email || '',
        whatsapp: candidate.whatsapp,
        courseSlug: candidate.courseSlug,
        courseName: candidate.courseName,
        classDate: candidate.classDate,
        checkoutStatus: 'class_reminder',
        enrollmentId: candidate.enrollment.id,
        studentId: candidate.student.id,
        crm: { source: 'class_reminder_cron', audit },
      });
      await persistReminder(candidate, result, audit);
      results.push({ reminderKey: candidate.reminderKey, sent: Boolean(result?.sent), skipped: result?.skipped || null, status: result?.status || null });
    }

    return response.status(200).json({
      ok: true,
      status: dryRun ? 'class_reminder_dry_run' : 'class_reminders_processed',
      twilioClassReminderConfigured,
      daysBefore,
      candidates: candidates.length,
      results,
    });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error.code || 'class_reminder_failed' });
  }
}
