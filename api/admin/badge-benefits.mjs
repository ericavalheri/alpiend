// Catálogo de benefícios por selo (tabela badge_benefits, decisão de negócio §16.7 do Manual
// a escola, 03/09/2026). Só quem tem a permissão "badge_benefits_manage" (owner ou comercial)
// pode cadastrar/arquivar. badgeKey deve bater com a chave usada em
// students.metadata.studentBadges.missions (ex.: 'new_course', 'class_attendance', ou uma
// chave livre criada pela equipe pra um selo custom).
import { authConfig, hasPermission, verifySession } from '../../lib/admin_auth.mjs';
import { createBadgeBenefit, listBadgeBenefits, updateBadgeBenefitStatus } from '../../lib/db.mjs';

function safeString(value = '', max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanBadgeKey(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
}

const BENEFIT_TYPES = ['discount_percent', 'free_class', 'experience', 'gift', 'other'];
const STATUSES = ['active', 'archived'];

export default async function handler(request, response) {
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, PATCH');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const config = authConfig();
  const session = config.configured ? verifySession(request, config.sessionSecret) : null;
  if (!hasPermission(session, 'badge_benefits_manage')) {
    return response.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    if (request.method === 'GET') {
      const items = await listBadgeBenefits();
      return response.status(200).json({ ok: true, items });
    }

    const body = request.body || {};

    if (request.method === 'POST') {
      const badgeKey = cleanBadgeKey(body.badgeKey);
      const badgeLabel = safeString(body.badgeLabel, 180);
      const benefitType = BENEFIT_TYPES.includes(body.benefitType) ? body.benefitType : '';
      const benefitDetail = safeString(body.benefitDetail, 500);
      const discountPercent = Number(body.discountPercent);

      if (!badgeKey || !badgeLabel || !benefitType) {
        return response.status(400).json({ ok: false, error: 'invalid_badge_benefit_payload' });
      }
      if (benefitType === 'discount_percent' && !(discountPercent > 0 && discountPercent <= 100)) {
        return response.status(400).json({ ok: false, error: 'invalid_discount_percent' });
      }

      const created = await createBadgeBenefit({
        badgeKey,
        badgeLabel,
        benefitType,
        benefitDetail: benefitDetail || null,
        discountPercent: benefitType === 'discount_percent' && Number.isFinite(discountPercent) ? discountPercent : null,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
      });
      return response.status(201).json({ ok: true, item: created });
    }

    const id = safeString(body.id, 120);
    const status = STATUSES.includes(body.status) ? body.status : '';
    if (!id || !status) {
      return response.status(400).json({ ok: false, error: 'invalid_badge_benefit_update' });
    }
    const updated = await updateBadgeBenefitStatus(id, status);
    if (!updated) return response.status(404).json({ ok: false, error: 'badge_benefit_not_found' });
    return response.status(200).json({ ok: true, item: updated });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error.code || 'badge_benefit_failed' });
  }
}
