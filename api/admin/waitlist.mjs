// Fila de espera (tabela waitlist_entries, regra §16.8 do Manual do produto). Só quem tem a
// permissão "waitlist_manage" (owner, comercial ou atendimento) pode ver/gerenciar. Entradas
// só chegam pelo formulário público (api/waitlist.mjs) — este endpoint é só consulta e
// mudança de status manual (ex.: marcar convertida ou cancelada).
import { authConfig, hasPermission, verifySession } from '../../lib/admin_auth.mjs';
import { listWaitlistEntries, updateWaitlistEntryStatus } from '../../lib/db.mjs';

function safeString(value = '', max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

const STATUSES = ['waiting', 'notified', 'converted', 'cancelled'];

export default async function handler(request, response) {
  if (!['GET', 'PATCH'].includes(request.method)) {
    response.setHeader('Allow', 'GET, PATCH');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const config = authConfig();
  const session = config.configured ? verifySession(request, config.sessionSecret) : null;
  if (!hasPermission(session, 'waitlist_manage')) {
    return response.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    if (request.method === 'GET') {
      const items = await listWaitlistEntries();
      return response.status(200).json({ ok: true, items });
    }

    const body = request.body || {};
    const id = safeString(body.id, 120);
    const status = STATUSES.includes(body.status) ? body.status : '';
    if (!id || !status) {
      return response.status(400).json({ ok: false, error: 'invalid_waitlist_update' });
    }
    const updated = await updateWaitlistEntryStatus(id, status);
    if (!updated) return response.status(404).json({ ok: false, error: 'waitlist_entry_not_found' });
    return response.status(200).json({ ok: true, item: updated });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error.code || 'waitlist_failed' });
  }
}
