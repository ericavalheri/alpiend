// Demandas da agência (tabela agency_demands): board de acompanhamento entre a agência e a
// a escola. Só quem tem a permissão "agency_demands_manage" (owner) pode ver e mexer.
import { authConfig, hasPermission, verifySession } from '../../lib/admin_auth.mjs';
import { createAgencyDemand, listAgencyDemands, updateAgencyDemand } from '../../lib/db.mjs';

function safeString(value = '', max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

const CATEGORIES = ['site', 'trafego', 'design', 'conteudo', 'financeiro', 'other'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['received', 'in_progress', 'waiting_client', 'done', 'approved'];

export default async function handler(request, response) {
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, PATCH');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const config = authConfig();
  const session = config.configured ? verifySession(request, config.sessionSecret) : null;
  if (!hasPermission(session, 'agency_demands_manage')) {
    return response.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    if (request.method === 'GET') {
      const items = await listAgencyDemands();
      return response.status(200).json({ ok: true, items });
    }

    const body = request.body || {};

    if (request.method === 'POST') {
      const title = safeString(body.title, 200);
      if (!title) return response.status(400).json({ ok: false, error: 'invalid_agency_demand_payload' });
      const created = await createAgencyDemand({
        title,
        description: safeString(body.description, 2000) || null,
        category: CATEGORIES.includes(body.category) ? body.category : 'other',
        priority: PRIORITIES.includes(body.priority) ? body.priority : 'normal',
        owner: safeString(body.owner, 120) || null,
        dueDate: safeString(body.dueDate, 40) || null,
        waitingFor: safeString(body.waitingFor, 300) || null,
        clientVisible: body.clientVisible !== false,
      });
      return response.status(201).json({ ok: true, item: created });
    }

    const id = safeString(body.id, 120);
    if (!id) return response.status(400).json({ ok: false, error: 'invalid_agency_demand_update' });
    const status = STATUSES.includes(body.status) ? body.status : undefined;
    const updated = await updateAgencyDemand(id, {
      status,
      deliveryUrl: body.deliveryUrl !== undefined ? safeString(body.deliveryUrl, 1000) : undefined,
      approvalNote: body.approvalNote !== undefined ? safeString(body.approvalNote, 1000) : undefined,
    });
    if (!updated) return response.status(404).json({ ok: false, error: 'agency_demand_not_found' });
    return response.status(200).json({ ok: true, item: updated });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error.code || 'agency_demand_failed' });
  }
}
