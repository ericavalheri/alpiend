const COOKIE_NAME = 'ebn_admin_session';

const encoder = new TextEncoder();

function base64urlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((part) => {
    const [key, ...value] = part.trim().split('=');
    return [key, decodeURIComponent(value.join('=') || '')];
  }).filter(([key]) => key));
}

async function hmac(payload, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

async function verifySession(request) {
  const secret = process.env.ADMIN_SESSION_SECRET || '';
  if (secret.length < 32) return false;
  const token = parseCookies(request.headers.get('cookie') || '')[COOKIE_NAME];
  if (!token || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  const expected = await hmac(payload, secret);
  if (!safeEqual(expected, signature)) return false;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64urlToBytes(payload)));
    // sub agora é o id do usuário admin (uuid da tabela admin_users, ou "ebn-admin" no modo
    // legado de senha única) — o middleware só confere autenticação; permissão por papel é
    // verificada nos handlers admin (lib/admin_auth.mjs hasPermission).
    return Boolean(parsed.sub) && Number(parsed.exp) > Date.now();
  } catch {
    return false;
  }
}

function redirectToLogin(request) {
  const url = new URL('/login', request.url);
  url.searchParams.set('next', new URL(request.url).pathname);
  return Response.redirect(url, 302);
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.startsWith('/painel')) {
    if (await verifySession(request)) return;
    return redirectToLogin(request);
  }

  if (path.startsWith('/api/admin/') && !['/api/admin/login', '/api/admin/status', '/api/admin/logout'].includes(path)) {
    if (await verifySession(request)) return;
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  return;
}

export const config = {
  matcher: ['/painel/:path*', '/api/admin/:path*'],
};
