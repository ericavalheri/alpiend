// Gestão das ofertas de curso adicional (tabela upsell_offers — regra P1.2/5.1 do Manual
// a escola). Só quem tem a permissão "offers_manage" (owner ou comercial) pode cadastrar.
import { authConfig, hasPermission, verifySession } from '../../lib/admin_auth.mjs';
import { createUpsellOffer, listAllUpsellOffers, updateUpsellOfferStatus } from '../../lib/db.mjs';
import { ensureLiveCourseCatalog, findCourse } from '../../lib/courses.mjs';

function safeString(value = '', max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(request, response) {
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, PATCH');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const config = authConfig();
  const session = config.configured ? verifySession(request, config.sessionSecret) : null;
  if (!hasPermission(session, 'offers_manage')) {
    return response.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    if (request.method === 'GET') {
      const offers = await listAllUpsellOffers();
      return response.status(200).json({ ok: true, offers });
    }

    const body = request.body || {};

    if (request.method === 'POST') {
      const sourceCourseSlug = safeString(body.sourceCourseSlug, 120);
      const targetCourseSlug = safeString(body.targetCourseSlug, 120);
      const title = safeString(body.title, 180);
      const discountType = ['percent', 'fixed'].includes(body.discountType) ? body.discountType : 'percent';
      const discountValue = Number(body.discountValue);

      if (!sourceCourseSlug || !targetCourseSlug || sourceCourseSlug === targetCourseSlug || !title || !Number.isFinite(discountValue) || discountValue <= 0) {
        return response.status(400).json({ ok: false, error: 'invalid_upsell_offer_payload' });
      }
      await ensureLiveCourseCatalog();
      if (!findCourse(sourceCourseSlug) || !findCourse(targetCourseSlug)) {
        return response.status(400).json({ ok: false, error: 'course_not_found' });
      }

      const created = await createUpsellOffer({ sourceCourseSlug, targetCourseSlug, title, discountType, discountValue });
      return response.status(201).json({ ok: true, offer: created });
    }

    // PATCH: ativar/desativar uma oferta existente.
    const id = safeString(body.id, 120);
    const status = ['active', 'draft', 'archived'].includes(body.status) ? body.status : '';
    if (!id || !status) {
      return response.status(400).json({ ok: false, error: 'invalid_upsell_offer_update' });
    }
    const updated = await updateUpsellOfferStatus(id, status);
    if (!updated) return response.status(404).json({ ok: false, error: 'upsell_offer_not_found' });
    return response.status(200).json({ ok: true, offer: updated });
  } catch (error) {
    const status = error.code === '23505' ? 409 : 500;
    return response.status(status).json({ ok: false, error: error.code === '23505' ? 'upsell_offer_pair_already_exists' : (error.code || 'upsell_offers_failed') });
  }
}
