import { authConfig, clearSessionCookie, clientIp, createSessionCookie, findAdminUser, rateLimitLogin, touchAdminLastLogin, verifyPassword, verifySession } from '../../lib/admin_auth.mjs';

export default async function handler(request, response) {
  const config = authConfig();
  if (request.method === 'GET') {
    const session = config.configured ? verifySession(request, config.sessionSecret) : null;
    return response.status(200).json({
      ok: true,
      configured: config.configured,
      authenticated: Boolean(session),
      user: session ? { username: session.username, name: session.name, role: session.role } : null,
    });
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  if (request.body?.action === 'logout') {
    response.setHeader('Set-Cookie', clearSessionCookie());
    return response.status(200).json({ ok: true });
  }

  if (!config.configured) {
    return response.status(503).json({ ok: false, error: 'admin_auth_not_configured' });
  }

  const ip = clientIp(request);
  const limit = rateLimitLogin(ip);
  if (!limit.ok) {
    return response.status(429).json({ ok: false, error: 'too_many_attempts' });
  }

  let body = {};
  try {
    body = typeof request.body === 'object' ? request.body : JSON.parse(request.body || '{}');
  } catch {
    return response.status(400).json({ ok: false, error: 'invalid_json' });
  }

  const user = await findAdminUser(body.username, config);
  if (!user || !verifyPassword(body.password, user.passwordHash)) {
    return response.status(401).json({ ok: false, error: 'invalid_credentials', remaining: limit.remaining });
  }

  await touchAdminLastLogin(user.id);
  response.setHeader('Set-Cookie', createSessionCookie(config.sessionSecret, user));
  return response.status(200).json({ ok: true, user: { username: user.username, name: user.name, role: user.role } });
}
