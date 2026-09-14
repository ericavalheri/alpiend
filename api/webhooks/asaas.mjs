import { getPaymentFollowupContext, persistAsaasWebhookEvent } from '../../lib/db.mjs';
import { sendMetaCapiEvent } from '../../lib/meta.mjs';
import { notifyOfficialWhatsapp } from '../../lib/whatsapp.mjs';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const configuredSecret = process.env.ASAAS_WEBHOOK_SECRET || '';
  const receivedSecret = request.headers['asaas-access-token'] || request.headers['x-asaas-webhook-secret'] || '';

  // Fail-closed: sem segredo configurado, nenhum evento é aceito (regra P0.3 do Manual do produto).
  if (!configuredSecret) {
    return response.status(503).json({ ok: false, error: 'webhook_secret_not_configured' });
  }
  if (receivedSecret !== configuredSecret) {
    return response.status(401).json({ ok: false, error: 'invalid_webhook_secret' });
  }

  const event = request.body || {};
  const audit = {
    receivedAt: new Date().toISOString(),
    ip: request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket?.remoteAddress || null,
    userAgent: request.headers['user-agent'] || null,
  };

  try {
    const result = await persistAsaasWebhookEvent(event, audit);
    const payment = event.payment || {};
    const context = await getPaymentFollowupContext('asaas', payment.id || '').catch(() => null);
    const followupPayload = {
      provider: 'asaas',
      event: result.eventType,
      status: context?.payment_status || payment.status || result.eventType,
      paymentId: payment.id || result.providerPaymentId,
      amount: context?.amount || payment.value || payment.netValue,
      // Data do pagamento, quando a Asaas manda: é ela que carimba a venda na Meta. Sem isso o
      // webhook que chega depois da virada do dia jogaria a venda pro dia seguinte no relatório.
      paidAt: payment.paymentDate || payment.confirmedDate || payment.clientPaymentDate || null,
      invoiceUrl: payment.invoiceUrl || payment.bankSlipUrl || '',
      whatsapp: context?.whatsapp || payment.customerPhone || payment.phone || payment.mobilePhone || '',
      email: context?.email || payment.customerEmail || payment.email || '',
      name: context?.name || payment.customerName || payment.name || '',
      studentId: context?.student_id || '',
      enrollmentId: context?.enrollment_id || '',
      courseSlug: context?.course_slug || '',
      courseName: context?.course_name || payment.description || 'Curso a escola',
      classDate: context?.class_date || context?.option_label || '',
      paymentMethod: context?.method || '',
      // _fbp, _fbc e utm guardados quando a aluna se matriculou. O webhook vem do servidor da
      // Asaas, sem cookie nenhum — sem isto a venda chega na Meta só com e-mail e telefone.
      attribution: context?.attribution || {},
    };
    // Reenvio do mesmo evento não pode virar outra compra: a Asaas repete o webhook até receber
    // 200, e o painel já marca `result.duplicate` quando reconhece a repetição.
    const meta = result.duplicate
      ? { configured: true, sent: false, skipped: 'webhook_repetido' }
      : await sendMetaCapiEvent(result.eventType, { ...followupPayload, event_id: `asaas-webhook:${result.providerEventId}` }, request);
    const shouldSendWhatsapp = !result.duplicate
      && Boolean(result.updatedPayment)
      && ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_CREATED'].includes(result.eventType);
    const whatsapp = shouldSendWhatsapp
      ? await notifyOfficialWhatsapp(result.eventType, followupPayload)
      : {
          configured: false,
          sent: false,
          skipped: result.duplicate
            ? 'duplicate_webhook_event'
            : (!result.updatedPayment ? 'payment_not_managed_by_agenda' : 'event_without_followup_template'),
        };
    return response.status(200).json({
      ok: true,
      status: result.duplicate ? 'webhook_duplicate_ignored' : 'webhook_processed',
      provider: 'asaas',
      eventType: result.eventType,
      providerEventId: result.providerEventId,
      duplicate: result.duplicate,
      updatedPayment: result.updatedPayment ? { id: result.updatedPayment.id, status: result.updatedPayment.status } : null,
      meta,
      whatsapp,
      receivedAt: audit.receivedAt,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      error: error.code || 'webhook_persist_failed',
      provider: 'asaas',
      eventType: event.event || event.type || null,
    });
  }
}
