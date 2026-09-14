// Gestão de cupons pelo painel (pedido da Erica, 05/09/2026). Só quem tem a permissão
// "coupons_manage" (owner ou comercial) pode cadastrar/arquivar. "Excluir" um cupom aqui
// sempre arquiva (status = 'archived') em vez de apagar a linha — um cupom já usado numa
// matrícula não pode sumir do histórico dessa venda; findActiveCoupon() já ignora cupons
// que não estão 'active', então arquivar tem o mesmo efeito prático sem quebrar nada.
import { authConfig, hasPermission, verifySession } from '../../lib/admin_auth.mjs';
import { createCoupon, listCoupons, updateCouponStatus } from '../../lib/db.mjs';

function safeString(value = '', max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

const TYPES = ['percent', 'fixed'];
const STATUSES = ['active', 'archived'];

export default async function handler(request, response) {
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, PATCH');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const config = authConfig();
  const session = config.configured ? verifySession(request, config.sessionSecret) : null;
  if (!hasPermission(session, 'coupons_manage')) {
    return response.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    if (request.method === 'GET') {
      const items = await listCoupons();
      return response.status(200).json({ ok: true, items });
    }

    const body = request.body || {};

    if (request.method === 'POST') {
      const code = safeString(body.code, 40).toUpperCase();
      const type = TYPES.includes(body.type) ? body.type : '';
      const value = Number(body.value);
      const maxUses = Number(body.maxUses);

      if (!code || !type || !(value > 0)) {
        return response.status(400).json({ ok: false, error: 'invalid_coupon_payload' });
      }
      if (type === 'percent' && value > 100) {
        return response.status(400).json({ ok: false, error: 'invalid_coupon_percent' });
      }

      const created = await createCoupon({
        code,
        type,
        value,
        maxUses: Number.isFinite(maxUses) && maxUses > 0 ? maxUses : null,
        courseSlug: safeString(body.courseSlug, 120) || null,
        classDate: safeString(body.classDate, 40) || null,
        startsAt: safeString(body.startsAt, 40) || null,
        endsAt: safeString(body.endsAt, 40) || null,
      });
      return response.status(201).json({ ok: true, item: created });
    }

    const id = safeString(body.id, 120);
    const status = STATUSES.includes(body.status) ? body.status : '';
    if (!id || !status) {
      return response.status(400).json({ ok: false, error: 'invalid_coupon_update' });
    }
    const updated = await updateCouponStatus(id, status);
    if (!updated) return response.status(404).json({ ok: false, error: 'coupon_not_found' });
    return response.status(200).json({ ok: true, item: updated });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error.code || 'coupon_failed' });
  }
}
