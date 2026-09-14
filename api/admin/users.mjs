// Gestão de usuários administrativos (regra P1.7 do Manual do produto). Só quem tem a permissão
// "users_manage" (papel owner) pode listar, criar ou alterar usuários. Requer a migration
// database/migrations/0003_admin_users.sql já aplicada no banco.
import { authConfig, hasPermission, hashPassword, verifySession } from '../../lib/admin_auth.mjs';
import { createAdminUser, listAdminUsers, updateAdminUser } from '../../lib/db.mjs';

const VALID_ROLES = ['owner', 'comercial', 'atendimento', 'academico', 'marketing'];

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
  if (!hasPermission(session, 'users_manage')) {
    return response.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    if (request.method === 'GET') {
      const users = await listAdminUsers();
      return response.status(200).json({ ok: true, users });
    }

    const body = request.body || {};

    if (request.method === 'POST') {
      const username = safeString(body.username, 80).toLowerCase().replace(/[^a-z0-9._-]/g, '');
      const name = safeString(body.name, 180);
      const role = VALID_ROLES.includes(body.role) ? body.role : '';
      const password = String(body.password || '');
      if (!username || !name || !role || password.length < 12) {
        return response.status(400).json({ ok: false, error: 'invalid_admin_user_payload' });
      }
      const created = await createAdminUser({ username, name, role, passwordHash: hashPassword(password) });
      return response.status(201).json({ ok: true, user: created });
    }

    // PATCH: alterar papel e/ou status (active/disabled) de um usuário existente.
    const id = safeString(body.id, 120);
    const role = VALID_ROLES.includes(body.role) ? body.role : undefined;
    const status = ['active', 'disabled'].includes(body.status) ? body.status : undefined;
    if (!id || (!role && !status)) {
      return response.status(400).json({ ok: false, error: 'invalid_admin_user_update' });
    }
    const updated = await updateAdminUser(id, { role, status });
    if (!updated) return response.status(404).json({ ok: false, error: 'admin_user_not_found' });
    return response.status(200).json({ ok: true, user: updated });
  } catch (error) {
    const status = error.code === '23505' ? 409 : 500;
    return response.status(status).json({ ok: false, error: error.code === '23505' ? 'username_already_exists' : (error.code || 'admin_users_failed') });
  }
}
