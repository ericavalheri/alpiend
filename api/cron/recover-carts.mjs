// Recuperação real de carrinho abandonado (regra P1.1/6.2 do Manual do produto):
// só considera candidatos com pelo menos 30 minutos desde o evento cart_abandoned,
// reconfere pagamento/opt-in imediatamente antes do envio e nunca reenvia para quem
// já recebeu o cupom (marcado via tracking_events). O envio imediato no navegador foi
// removido de lib/tracking_events.mjs — este cron é o único disparador do WhatsApp de 10%.
//
// Também reenvia, no mesmo ciclo, o link oficial de pagamento da Voomp/Cabeleireiro
// para quem fez o aceite mas não pagou em 30 minutos (processVoompReminders) — a
// primeira mensagem (instantânea, no momento do aceite) continua em api/acceptance.mjs.
//
// E reenvia, com o mesmo cupom de 10% do carrinho abandonado, para quem já preencheu o
// checkout de uma especialização (Asaas) — gerou Pix/boleto — mas não pagou em 30 minutos
// (processPendingAsaasPayments): esse caso não gera o evento cart_abandoned porque o
// formulário já foi enviado com sucesso, então nunca era coberto pela recuperação de
// carrinho abandonado de fato.
import { ensureRecoveryCoupon, findAbandonedCartCandidates, findPendingAsaasPayments, findPendingVoompAcceptances, hasConflictingPaidEnrollment, supabaseRequest } from '../../lib/db.mjs';
import { notifyOfficialWhatsapp } from '../../lib/whatsapp.mjs';
import { resolveVoompCheckoutUrl } from '../../lib/voomp.mjs';

function cleanPhone(value = '') {
  const phone = String(value || '').replace(/\D/g, '').slice(0, 20);
  if (!phone) return '';
  return phone.startsWith('55') ? phone : `55${phone}`;
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

function recoveryKey(session_id, payload = {}) {
  return [
    session_id || '',
    payload.studentEmail || payload.email || '',
    payload.courseSlug || payload.course_slug || '',
    payload.classDate || payload.class_date || '',
  ].join(':').toLowerCase();
}

async function persistOutcome(candidate, key, eventName, extra = {}) {
  await supabaseRequest('tracking_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      event_name: eventName,
      session_id: candidate.session_id,
      url: candidate.url,
      referrer: candidate.referrer,
      utm_source: candidate.utm_source,
      utm_medium: candidate.utm_medium,
      utm_campaign: candidate.utm_campaign,
      payload: { recoveryKey: key, ...extra },
    }),
  });
}

// Lembrete de pagamento pendente da matrícula Voomp/Cabeleireiro (regra própria, distinta
// do cupom de 10% do carrinho abandonado): reenvia o link oficial de pagamento 30 minutos
// depois do aceite para quem ainda não pagou, sem repetir o envio (marcado via tracking_events).
async function persistVoompReminderOutcome(enrollmentId, eventName, extra = {}) {
  await supabaseRequest('tracking_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      event_name: eventName,
      payload: { enrollmentId: String(enrollmentId), ...extra },
    }),
  });
}

async function processVoompReminders(dryRun) {
  const { supported, candidates } = await findPendingVoompAcceptances();
  if (!supported) return { candidates: 0, results: [] };

  const results = [];
  for (const row of candidates) {
    const enrollmentId = row.enrollment_id;
    const courseSlug = row.course_slug;
    const classDate = row.class_date;
    const email = row.email || '';
    const whatsappOptIn = row.enrollment_metadata?.whatsappOptIn !== false && row.student_metadata?.whatsappOptIn !== false;
    const whatsappNumber = String(row.whatsapp || '').replace(/\D/g, '');

    if (!whatsappOptIn) {
      if (!dryRun) await persistVoompReminderOutcome(enrollmentId, 'whatsapp_voomp_payment_reminder_skipped', { reason: 'whatsapp_opt_in_false' });
      results.push({ enrollmentId, status: 'skipped_opt_out' });
      continue;
    }
    if (!whatsappNumber) {
      if (!dryRun) await persistVoompReminderOutcome(enrollmentId, 'whatsapp_voomp_payment_reminder_skipped', { reason: 'missing_phone' });
      results.push({ enrollmentId, status: 'skipped_missing_phone' });
      continue;
    }

    // Reconfere agora se a matrícula já foi paga (a query já filtra, mas o pagamento pode
    // ter sido confirmado entre a consulta e o envio).
    const alreadyPaid = await hasConflictingPaidEnrollment({ email, courseSlug, classDate }).catch(() => null);
    if (alreadyPaid) {
      if (!dryRun) await persistVoompReminderOutcome(enrollmentId, 'whatsapp_voomp_payment_reminder_skipped', { reason: 'already_paid' });
      results.push({ enrollmentId, status: 'skipped_already_paid' });
      continue;
    }

    const checkout = resolveVoompCheckoutUrl({ courseSlug, classDate, name: row.name, email, whatsapp: whatsappNumber }, {});
    if (!checkout.url) {
      if (!dryRun) await persistVoompReminderOutcome(enrollmentId, 'whatsapp_voomp_payment_reminder_skipped', { reason: checkout.reason || 'checkout_url_not_configured' });
      results.push({ enrollmentId, status: 'skipped_checkout_not_configured' });
      continue;
    }

    if (dryRun) {
      results.push({ enrollmentId, status: 'dry_run_eligible' });
      continue;
    }

    const whatsapp = await notifyOfficialWhatsapp('voomp_acceptance_registered', {
      provider: 'voomp',
      name: row.name || '',
      email,
      whatsapp: whatsappNumber,
      courseSlug,
      courseName: row.course_name || courseSlug,
      classDate,
      checkoutUrl: checkout.url,
      checkoutStatus: 'checkout_ready',
      whatsappOptIn: true,
    });
    await persistVoompReminderOutcome(enrollmentId, whatsapp?.sent ? 'whatsapp_voomp_payment_reminder_sent' : 'whatsapp_voomp_payment_reminder_requested', {
      course_slug: courseSlug,
      course_name: row.course_name || null,
      class_date: classDate,
      whatsapp,
    });
    results.push({ enrollmentId, sent: Boolean(whatsapp?.sent), skipped: whatsapp?.skipped || null, status: whatsapp?.status || null });
  }

  return { candidates: candidates.length, results };
}

async function persistPendingAsaasOutcome(enrollmentId, eventName, extra = {}) {
  await supabaseRequest('tracking_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      event_name: eventName,
      payload: { enrollmentId: String(enrollmentId), ...extra },
    }),
  });
}

async function processPendingAsaasPayments(dryRun) {
  const { supported, candidates } = await findPendingAsaasPayments();
  if (!supported) return { candidates: 0, results: [] };

  const results = [];
  for (const row of candidates) {
    const enrollmentId = row.enrollment_id;
    const courseSlug = row.course_slug;
    const classDate = row.class_date;
    const email = row.email || '';
    const whatsappOptIn = row.enrollment_metadata?.whatsappOptIn !== false && row.student_metadata?.whatsappOptIn !== false;
    const whatsappNumber = cleanPhone(row.whatsapp || '');

    if (!whatsappOptIn) {
      if (!dryRun) await persistPendingAsaasOutcome(enrollmentId, 'whatsapp_payment_pending_coupon_skipped', { reason: 'whatsapp_opt_in_false' });
      results.push({ enrollmentId, status: 'skipped_opt_out' });
      continue;
    }
    if (!whatsappNumber) {
      if (!dryRun) await persistPendingAsaasOutcome(enrollmentId, 'whatsapp_payment_pending_coupon_skipped', { reason: 'missing_phone' });
      results.push({ enrollmentId, status: 'skipped_missing_phone' });
      continue;
    }

    // Reconfere agora se a matrícula já foi paga (a query já filtra, mas o pagamento pode
    // ter sido confirmado entre a consulta e o envio).
    const alreadyPaid = await hasConflictingPaidEnrollment({ email, courseSlug, classDate }).catch(() => null);
    if (alreadyPaid) {
      if (!dryRun) await persistPendingAsaasOutcome(enrollmentId, 'whatsapp_payment_pending_coupon_skipped', { reason: 'already_paid' });
      results.push({ enrollmentId, status: 'skipped_already_paid' });
      continue;
    }

    if (dryRun) {
      results.push({ enrollmentId, status: 'dry_run_eligible' });
      continue;
    }

    // Reaproveita o mesmo template/cupom EBN10 do carrinho abandonado (regra P1.1): aqui a
    // pessoa chegou a enviar o formulário e gerar Pix/boleto, mas não pagou em 30 minutos —
    // o link volta para a matrícula do site, onde ela pode aplicar o cupom e fechar de novo.
    await ensureRecoveryCoupon().catch(() => null);
    const whatsapp = await notifyOfficialWhatsapp('abandoned_cart_coupon', {
      provider: 'agenda_ebn',
      name: row.name || '',
      email,
      whatsapp: whatsappNumber,
      courseSlug,
      courseName: row.course_name || courseSlug,
      classDate,
      checkoutStatus: 'payment_pending',
      coupon: 'EBN10',
      amount: row.amount_expected || '',
      whatsappOptIn: true,
    });
    await persistPendingAsaasOutcome(enrollmentId, whatsapp?.sent ? 'whatsapp_payment_pending_coupon_sent' : 'whatsapp_payment_pending_coupon_requested', {
      coupon: 'EBN10',
      course_slug: courseSlug,
      course_name: row.course_name || null,
      class_date: classDate,
      whatsapp,
    });
    results.push({ enrollmentId, sent: Boolean(whatsapp?.sent), skipped: whatsapp?.skipped || null, status: whatsapp?.status || null });
  }

  return { candidates: candidates.length, results };
}

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const dryRun = isDryRun(request);
  const auth = verifyCron(request, dryRun);
  if (!auth.ok) return response.status(auth.configured ? 401 : 503).json({ ok: false, error: auth.error });

  const audit = { receivedAt: new Date().toISOString(), source: 'vercel_cron_recover_carts', dryRun };
  try {
    const { supported, candidates } = await findAbandonedCartCandidates();
    if (!supported) {
      // Isto virou um caso que não deveria mais acontecer: a busca funciona nos dois modos de
      // banco desde 11/09/2026. Se voltar, é falha de configuração — e responder 200 fazia a
      // Vercel marcar a execução como bem-sucedida enquanto nenhum WhatsApp saía.
      console.error('recover_carts_sem_fonte_de_dados');
      return response.status(503).json({ ok: false, error: 'recover_carts_sem_fonte_de_dados', candidates: 0, results: [] });
    }

    const results = [];
    for (const row of candidates) {
      const payload = row.payload || {};
      const cart = payload.cart || {};
      const key = recoveryKey(row.session_id, payload);
      const courseSlug = payload.courseSlug || payload.course_slug || cart.courseSlug || '';
      const classDate = payload.classDate || payload.class_date || cart.classDate || '';
      const email = payload.studentEmail || payload.email || '';
      const whatsappNumber = cleanPhone(payload.studentWhatsapp || payload.whatsapp || payload.phone || '');

      if (payload.whatsappOptIn === false) {
        if (!dryRun) await persistOutcome(row, key, 'whatsapp_abandoned_cart_coupon_skipped', { reason: 'whatsapp_opt_in_false' });
        results.push({ recoveryKey: key, status: 'skipped_opt_out' });
        continue;
      }
      if (!whatsappNumber) {
        if (!dryRun) await persistOutcome(row, key, 'whatsapp_abandoned_cart_coupon_skipped', { reason: 'missing_phone' });
        results.push({ recoveryKey: key, status: 'skipped_missing_phone' });
        continue;
      }

      // Reconfere agora — não no momento do abandono — se a matrícula já foi paga (regra P1.1).
      const alreadyPaid = await hasConflictingPaidEnrollment({ email, courseSlug, classDate }).catch(() => null);
      if (alreadyPaid) {
        if (!dryRun) await persistOutcome(row, key, 'whatsapp_abandoned_cart_coupon_skipped', { reason: 'already_paid' });
        results.push({ recoveryKey: key, status: 'skipped_already_paid' });
        continue;
      }

      if (dryRun) {
        results.push({ recoveryKey: key, status: 'dry_run_eligible' });
        continue;
      }

      await ensureRecoveryCoupon().catch(() => null);
      const whatsapp = await notifyOfficialWhatsapp('abandoned_cart_coupon', {
        provider: 'agenda_ebn',
        name: payload.studentName || payload.name || '',
        email,
        whatsapp: whatsappNumber,
        courseSlug,
        courseName: payload.courseName || payload.course_name || cart.courseName || '',
        classDate,
        checkoutUrl: row.url || 'https://DOMINIO-NAO-CONFIGURADO',
        checkoutStatus: 'cart_abandoned',
        coupon: payload.coupon || cart.coupon || 'EBN10',
        amount: cart.priceNumber || payload.amount || payload.value || '',
        attribution: payload.attribution || {},
        crm: { source: 'recover_carts_cron', audit },
      });
      await persistOutcome(row, key, whatsapp?.sent ? 'whatsapp_abandoned_cart_coupon_sent' : 'whatsapp_abandoned_cart_coupon_requested', {
        coupon: payload.coupon || cart.coupon || 'EBN10',
        course_slug: courseSlug || null,
        course_name: payload.courseName || payload.course_name || cart.courseName || null,
        class_date: classDate || null,
        whatsapp,
        audit,
      });
      results.push({ recoveryKey: key, sent: Boolean(whatsapp?.sent), skipped: whatsapp?.skipped || null, status: whatsapp?.status || null });
    }

    const voompReminders = await processVoompReminders(dryRun);
    const pendingAsaasReminders = await processPendingAsaasPayments(dryRun);

    return response.status(200).json({
      ok: true,
      status: dryRun ? 'recover_carts_dry_run' : 'recover_carts_processed',
      candidates: candidates.length,
      results,
      voompReminders,
      pendingAsaasReminders,
    });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error.code || 'recover_carts_failed' });
  }
}
