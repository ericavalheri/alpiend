// Usuários administrativos individuais com papel/permissão (regra P1.7/13 do Manual do produto).
// Fonte de verdade: tabela admin_users (database/migrations/0003_admin_users.sql). Enquanto
// essa tabela não existir ou estiver vazia, cai para o modo legado de senha única
// (ADMIN_PASSWORD_HASH), mapeada como um único usuário "ebn-admin" com papel "owner" —
// assim o deploy deste código não derruba o acesso de ninguém antes da migration rodar.
import crypto from 'node:crypto';
import { isDbConfigured, pgQuery, supabaseRequest } from './db.mjs';

const COOKIE_NAME = 'ebn_admin_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const attempts = new Map();

export const ROLE_PERMISSIONS = {
  // students_archive é só da dona: arquivar tira a aluna do painel inteiro (lista, contagem,
  // CRM e faturamento) e excluir apaga o cadastro. Quem cuida de material, certificado ou
  // atendimento continua com 'students' pra liberar acesso, mas não some com o cadastro.
  owner: ['dashboard', 'crm', 'students', 'students_archive', 'demands', 'whatsapp_dispatch', 'badge_review', 'users_manage', 'offers_manage', 'materials_manage', 'certificates_manage', 'notifications_manage', 'agency_demands_manage', 'badge_benefits_manage', 'waitlist_manage', 'coupons_manage', 'courses_manage'],
  comercial: ['dashboard', 'crm', 'students', 'whatsapp_dispatch', 'offers_manage', 'notifications_manage', 'badge_benefits_manage', 'waitlist_manage', 'coupons_manage', 'courses_manage'],
  atendimento: ['dashboard', 'crm', 'whatsapp_dispatch', 'waitlist_manage'],
  academico: ['dashboard', 'students', 'badge_review', 'materials_manage', 'certificates_manage', 'notifications_manage'],
  marketing: ['dashboard', 'demands'],
};

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((part) => {
    const [key, ...value] = part.trim().split('=');
    return [key, decodeURIComponent(value.join('=') || '')];
  }).filter(([key]) => key));
}

function isUndefinedTableError(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST116';
}

export function authConfig() {
  const sessionSecret = process.env.ADMIN_SESSION_SECRET || '';
  const legacyHash = process.env.ADMIN_PASSWORD_HASH || '';
  const legacyConfigured = legacyHash.startsWith('pbkdf2_sha256$');
  const configured = sessionSecret.length >= 32 && (isDbConfigured() || legacyConfigured);
  return { configured, sessionSecret, legacyConfigured, legacyHash };
}

// Retorna o usuário admin pelo username, ou o usuário legado único quando a tabela
// admin_users ainda não existe/está vazia ou não há usuário com esse username nela.
export async function findAdminUser(username, config) {
  const normalized = String(username || '').trim().toLowerCase();

  if (isDbConfigured()) {
    try {
      const usePostgres = Boolean(process.env.DATABASE_URL);
      const rows = usePostgres
        ? (await pgQuery('select id, username, name, role, password_hash, status from admin_users where username = $1 limit 1', [normalized])).rows
        : await supabaseRequest(`admin_users?username=eq.${encodeURIComponent(normalized)}&select=id,username,name,role,password_hash,status&limit=1`);
      const user = rows?.[0];
      if (user && user.status !== 'disabled') {
        return { id: user.id, username: user.username, name: user.name, role: user.role, passwordHash: user.password_hash };
      }
      if (user && user.status === 'disabled') return null;
    } catch (error) {
      if (!isUndefinedTableError(error)) throw error;
      // tabela ainda não existe: cai para o modo legado abaixo.
    }
  }

  if (config.legacyConfigured && (!normalized || normalized === 'ebn-admin')) {
    return { id: 'ebn-admin', username: 'ebn-admin', name: 'a escola Admin', role: 'owner', passwordHash: config.legacyHash };
  }
  return null;
}

export async function touchAdminLastLogin(userId) {
  if (!isDbConfigured() || userId === 'ebn-admin') return;
  try {
    if (process.env.DATABASE_URL) {
      await pgQuery('update admin_users set last_login_at = now() where id = $1', [userId]);
    } else {
      await supabaseRequest(`admin_users?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ last_login_at: new Date().toISOString() }),
      });
    }
  } catch {
    // não bloqueia o login se o registro de último acesso falhar.
  }
}

export function clientIp(request) {
  return request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.headers['x-real-ip'] || 'unknown';
}

export function rateLimitLogin(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 6;
  const current = attempts.get(ip) || [];
  const fresh = current.filter((time) => now - time < windowMs);
  fresh.push(now);
  attempts.set(ip, fresh);
  return { ok: fresh.length <= maxAttempts, remaining: Math.max(0, maxAttempts - fresh.length) };
}

export function hashPassword(password) {
  const iterations = 210000;
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.pbkdf2Sync(String(password || ''), salt, iterations, 32, 'sha256').toString('base64url');
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, iterationsRaw, salt, expected] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2_sha256' || !iterationsRaw || !salt || !expected) return false;
  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations < 100000) return false;
  const derived = crypto.pbkdf2Sync(String(password || ''), salt, iterations, 32, 'sha256').toString('base64url');
  return safeEqual(derived, expected);
}

export function createSessionCookie(secret, user) {
  const payload = base64url(JSON.stringify({
    sub: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    iat: Date.now(),
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  }));
  const signature = sign(payload, secret);
  const token = `${payload}.${signature}`;
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Retorna a sessão (id, username, role, name) ou null. Antes retornava um boolean — todo
// chamador precisa checar identidade/papel agora, não só "está autenticado".
export function verifySession(request, secret) {
  const token = parseCookies(request.headers.cookie || '')[COOKIE_NAME];
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!safeEqual(sign(payload, secret), signature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.sub || Number(parsed.exp) <= Date.now()) return null;
    return { id: parsed.sub, username: parsed.username || parsed.sub, role: parsed.role || 'owner', name: parsed.name || parsed.username || parsed.sub };
  } catch {
    return null;
  }
}

export function hasPermission(session, permission) {
  if (!session) return false;
  const permissions = ROLE_PERMISSIONS[session.role] || [];
  return permissions.includes(permission);
}

export { COOKIE_NAME };
