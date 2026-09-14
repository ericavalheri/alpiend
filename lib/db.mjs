import crypto from 'node:crypto';
import pg from 'pg';
import { buildStudentAccessUrl } from './student_access.mjs';
import { isClassFinished } from '../src/lib/format.js';
import { findCourse, offerForCourse } from './courses.mjs';
import { checkInCodeFor, checkInCodeMatches, normalizeCheckInCode } from './checkin.mjs';
import { certificateCode, certificateIsDue, certificatePublicPath, normalizeCertificateCode } from './certificates.mjs';
import { sendWaitlistSeatAvailable } from './whatsapp.mjs';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || '';
let pgPool;

function getPgPool() {
  if (!DATABASE_URL) return null;
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10000,
      // Curto de propósito: a agenda pública agora tenta o catálogo do banco a cada request
      // (ensureLiveCourseCatalog), e não pode ficar travada esperando conexão — melhor cair
      // rápido pro catálogo estático do que travar até o limite da função serverless.
      connectionTimeoutMillis: 4000,
    });
  }
  return pgPool;
}

export async function pgQuery(sql, values = []) {
  const pool = getPgPool();
  if (!pool) {
    const error = new Error('postgres_not_configured');
    error.code = 'postgres_not_configured';
    throw error;
  }
  return pool.query(sql, values);
}

const SUPABASE_URL = (process.env.SUPABASE_URL || '')
  .replace(/\/rest\/v1\/?$/, '')
  .replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || '';

export function isDbConfigured() {
  return Boolean(DATABASE_URL || (SUPABASE_URL && SUPABASE_SERVICE_ROLE && SUPABASE_URL.includes('supabase')));
}

function assertSafeIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    const error = new Error('invalid_database_identifier');
    error.code = 'invalid_database_identifier';
    throw error;
  }
  return value;
}

const TABLES_WITH_ID = new Set(['students', 'courses', 'classes', 'enrollments', 'carts', 'coupons', 'payments', 'payment_events', 'acceptances', 'tracking_events', 'crm_activities']);

function parseRestPath(path) {
  const [tablePart, queryPart = ''] = String(path).split('?');
  const table = assertSafeIdentifier(tablePart);
  if (!TABLES_WITH_ID.has(table)) {
    const error = new Error('table_not_allowed');
    error.code = 'table_not_allowed';
    throw error;
  }
  return { table, params: new URLSearchParams(queryPart) };
}

async function pgRequest(path, options = {}) {
  const pool = getPgPool();
  if (!pool) return null;

  const method = String(options.method || 'GET').toUpperCase();
  const { table, params } = parseRestPath(path);

  if (method === 'POST') {
    const payload = JSON.parse(options.body || '{}');
    const columns = Object.keys(payload).map(assertSafeIdentifier);
    const values = Object.values(payload).map((value) => {
      if (value && typeof value === 'object' && !(value instanceof Date)) return JSON.stringify(value);
      return value;
    });
    const placeholders = values.map((_, index) => `$${index + 1}`);
    const prefer = String(options.headers?.Prefer || options.headers?.prefer || '');
    const returning = prefer.includes('return=representation') ? ' returning *' : '';
    const sql = `insert into ${table} (${columns.join(', ')}) values (${placeholders.join(', ')})${returning}`;
    const result = await pool.query(sql, values);
    return returning ? result.rows : [];
  }

  if (method === 'GET') {
    const select = params.get('select') || '*';
    const order = params.get('order') || '';
    const limit = Number(params.get('limit') || 100);
    // Este atalho pro Postgres direto só sabe traduzir select/order/limit/offset. Filtro
    // (id=eq.X e afins) ele NÃO aplica — e ignorar em silêncio seria devolver a linha errada:
    // "o primeiro pagamento da tabela" no lugar de "o pagamento desta aluna". Melhor falhar
    // alto e na hora, pra ninguém achar que filtrou.
    // Igualdade simples (coluna=eq.valor) ele sabe traduzir. Qualquer outro operador continua
    // erro alto: ignorar filtro em silêncio devolveria a linha errada — "o primeiro pagamento
    // da tabela" no lugar de "o pagamento desta aluna".
    const valores = [];
    const where = [];
    const naoTraduzidos = [];
    for (const [chave, valor] of params.entries()) {
      if (['select', 'order', 'limit', 'offset'].includes(chave)) continue;
      if (typeof valor === 'string' && valor.startsWith('eq.')) {
        valores.push(valor.slice(3));
        where.push(`${assertSafeIdentifier(chave)} = $${valores.length}`);
        continue;
      }
      naoTraduzidos.push(chave);
    }
    if (naoTraduzidos.length) {
      const error = new Error('pg_shortcut_cannot_filter');
      error.code = 'pg_shortcut_cannot_filter';
      error.details = { table, filtrosIgnorados: naoTraduzidos };
      throw error;
    }
    const safeSelect = select === '*' ? '*' : select.split(',').map((column) => assertSafeIdentifier(column.trim())).join(', ');
    let sql = `select ${safeSelect} from ${table}`;
    if (where.length) sql += ` where ${where.join(' and ')}`;
    if (order) {
      const [column, direction = 'asc'] = order.split('.');
      sql += ` order by ${assertSafeIdentifier(column)} ${direction.toLowerCase() === 'desc' ? 'desc' : 'asc'}`;
    }
    const offset = Number(params.get('offset') || 0);
    sql += ` limit $${valores.length + 1} offset $${valores.length + 2}`;
    const result = await pool.query(sql, [
      ...valores,
      Number.isFinite(limit) && limit > 0 && limit <= 1000 ? limit : 100,
      Number.isFinite(offset) && offset > 0 ? offset : 0,
    ]);
    return result.rows;
  }

  const error = new Error('method_not_supported');
  error.code = 'method_not_supported';
  throw error;
}

function jsonHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
    'content-type': 'application/json',
    ...extra,
  };
}

export async function supabaseRequest(path, options = {}) {
  const pgResult = await pgRequest(path, options);
  if (pgResult !== null) return pgResult;

  if (!isDbConfigured()) {
    const error = new Error('database_not_configured');
    error.code = 'database_not_configured';
    throw error;
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: jsonHeaders(options.headers || {}),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.message || 'database_request_failed');
    error.code = data?.code || 'database_request_failed';
    error.details = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

function cleanPhone(value = '') {
  return String(value || '').replace(/\D/g, '').slice(0, 20);
}

function cleanCpf(value = '') {
  return String(value || '').replace(/\D/g, '').slice(0, 14);
}

// Unificação de cadastro por CPF (pedido da Erica, 04/09/2026): guardamos só um hash do CPF
// completo (nunca o CPF em si — mantém a mesma minimização de dados do cpf_last4) pra achar
// com certeza o mesmo cadastro em compras diferentes, mesmo que o email ou WhatsApp mudem.
// Atenção pra quem for trocar segredos: o hash é calculado com este tempero, então trocá-lo
// faz TODO cpf_hash já gravado deixar de bater — e as alunas voltam a duplicar em silêncio, que
// é justamente o que esta função existe pra evitar. Por isso a chave dedicada vem primeiro: se
// um dia o STUDENT_ACCESS_SECRET precisar ser rotacionado (ele assina os links de acesso),
// basta ter STUDENT_CPF_HASH_PEPPER definido antes com o valor antigo que a unificação segue
// funcionando.
function cpfHashPepper() {
  return process.env.STUDENT_CPF_HASH_PEPPER
    || process.env.STUDENT_ACCESS_SECRET
    || process.env.ADMIN_SESSION_SECRET
    || 'ebn-cpf-hash-fallback-pepper';
}

function hashCpf(cpf = '') {
  const digits = cleanCpf(cpf);
  if (digits.length !== 11) return null;
  return crypto.createHash('sha256').update(`cpf:${digits}:${cpfHashPepper()}`).digest('hex');
}

function normalizeCouponCode(value = '') {
  return String(value || '').trim().toUpperCase().slice(0, 60);
}

function paidStatus(value = '') {
  return /confirmed|confirmado|received|recebido|paid|pago|approved|aprovado/i.test(String(value || ''));
}

// Regra §16.4 do Manual do produto (decisão de negócio, 03/09/2026): estorno/chargeback cancela o
// acesso e libera a vaga na hora. "awaiting_chargeback_reversal" fica de fora de propósito —
// é um estado de disputa em andamento que ainda pode voltar a ser pago.
function cancelledPaymentStatus(value = '') {
  return /refund|refunded|reembols|estorn|chargeback|cancel/i.test(String(value || ''));
}

// Regra confirmada pela Erica em 04/09/2026: matrícula é sinônimo de pagamento — quem nunca
// pagou nenhum curso (ex.: só começou um checkout de teste e abandonou) não é aluna de
// verdade e não pode entrar na Minha Área, mesmo tendo um cadastro em students. Usado no
// login por código (requestStudentAccessCode) — mesma resposta de "não encontrado" pra não
// abrir brecha de enumeração.
async function studentHasPaidEnrollment(studentId = '') {
  const resolvedId = safeText(studentId, 120);
  if (!resolvedId) return false;
  if (DATABASE_URL) {
    const result = await pgQuery('select status from payments where student_id = $1', [resolvedId]);
    return result.rows.some((row) => paidStatus(row.status));
  }
  const rows = await supabaseRequest(`payments?student_id=eq.${encodeURIComponent(resolvedId)}&select=status`);
  return (rows || []).some((row) => paidStatus(row.status));
}

function moneyNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeId(prefix = 'evt') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isMissingOptionalCrm(error) {
  return ['42P01', 'PGRST205', 'PGRST116'].includes(String(error?.code || error?.status || ''));
}

async function persistAutomaticCrmOpportunity({ payload = {}, student = {}, enrollment = {}, source = 'site', status = 'new_opportunity', audit = {} } = {}) {
  const record = {
    lead_key: String(enrollment.id || payload.attribution?.session_id || payload.email || payload.studentEmail || safeId('lead')).slice(0, 220),
    activity_type: 'note',
    status,
    note: 'Oportunidade criada automaticamente pela agenda a escola.',
    owner: 'Atendimento a escola',
    course: payload.courseName || payload.courseSlug || null,
    phone: cleanPhone(payload.whatsapp || payload.studentWhatsapp || ''),
    email: safeText(payload.email || payload.studentEmail || '', 180).toLowerCase() || null,
    metadata: {
      kind: 'crm_opportunity',
      source,
      studentId: student.id || null,
      enrollmentId: enrollment.id || null,
      studentName: payload.name || payload.studentName || student.name || null,
      courseSlug: payload.courseSlug || null,
      classDate: payload.classDate || null,
      flow: payload.cart?.flow || enrollment.flow || null,
      attribution: payload.attribution || {},
      audit,
    },
  };

  try {
    const [activity] = await supabaseRequest('crm_activities', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(record),
    });
    return activity || null;
  } catch (error) {
    if (isMissingOptionalCrm(error)) return null;
    throw error;
  }
}

function automaticBadgeState(current = {}, audit = {}, source = '') {
  const now = audit.receivedAt || new Date().toISOString();
  const history = Array.isArray(current.history) ? current.history.slice(-8) : [];
  if (current.status === 'approved') return current;
  return {
    ...current,
    status: 'approved',
    approvedAt: current.approvedAt || now,
    automatic: true,
    source,
    updatedAt: now,
    history: [...history, { action: 'auto_approve', at: now, source }],
  };
}

async function applyAutomaticStudentBadge(studentId = '', missionKey = '', audit = {}, source = '') {
  const resolvedStudentId = safeText(studentId, 120);
  const key = cleanBadgeKey(missionKey);
  if (!resolvedStudentId || !key) return null;

  if (DATABASE_URL) {
    const current = await pgQuery('select id, metadata from students where id = $1 limit 1', [resolvedStudentId]);
    if (!current.rows[0]) return null;
    const metadata = current.rows[0].metadata || {};
    const studentBadges = metadata.studentBadges || {};
    const missions = studentBadges.missions || {};
    const nextMetadata = {
      ...metadata,
      studentBadges: {
        ...studentBadges,
        missions: {
          ...missions,
          [key]: automaticBadgeState(missions[key] || {}, audit, source),
        },
      },
    };
    await pgQuery('update students set metadata = $1::jsonb, updated_at = now() where id = $2', [JSON.stringify(nextMetadata), resolvedStudentId]);
    await pgQuery(
      `insert into tracking_events (event_name, student_id, payload)
       values ($1, $2, $3::jsonb)`,
      [`student_badge_auto_${key}`, resolvedStudentId, JSON.stringify({ missionKey: key, source, audit })],
    );
    return { studentId: resolvedStudentId, missionKey: key, mode: 'postgres' };
  }

  return updateStudentBadgeMission({ studentId: resolvedStudentId, missionKey: key, action: 'approve', note: `Liberação automática: ${source}` }, audit).catch(() => null);
}

export async function findActiveCoupon(code = '', payload = {}) {
  const normalizedCode = normalizeCouponCode(code);
  if (!normalizedCode || !isDbConfigured()) return null;

  if (DATABASE_URL) {
    const result = await pgQuery(
      `select id, code, type, value, status, used_count, max_uses, course_slug, class_date, starts_at, ends_at
       from coupons
       where upper(code) = $1
         and coalesce(status, 'active') in ('active', 'ativo', 'enabled')
         and (starts_at is null or starts_at <= now())
         and (ends_at is null or ends_at >= now())
         and (max_uses is null or coalesce(used_count, 0) < max_uses)
         and (course_slug is null or course_slug = '' or course_slug = $2)
         and (class_date is null or class_date = '' or class_date = $3)
       order by
         case when course_slug = $2 then 0 else 1 end,
         case when class_date = $3 then 0 else 1 end,
         created_at desc nulls last
       limit 1`,
      [normalizedCode, payload.courseSlug || '', payload.classDate || ''],
    );
    return result.rows[0] || null;
  }

  const rows = await supabaseRequest(
    `coupons?code=eq.${encodeURIComponent(normalizedCode)}&select=id,code,type,value,status,used_count,max_uses,course_slug,class_date,starts_at,ends_at,created_at&order=created_at.desc&limit=20`,
  );
  return (rows || []).find((coupon) => {
    const status = String(coupon.status || 'active').toLowerCase();
    const now = Date.now();
    const startsOk = !coupon.starts_at || Date.parse(coupon.starts_at) <= now;
    const endsOk = !coupon.ends_at || Date.parse(coupon.ends_at) >= now;
    const underLimit = !coupon.max_uses || Number(coupon.used_count || 0) < Number(coupon.max_uses || 0);
    const courseOk = !coupon.course_slug || coupon.course_slug === payload.courseSlug;
    const classOk = !coupon.class_date || coupon.class_date === payload.classDate;
    return ['active', 'ativo', 'enabled'].includes(status) && startsOk && endsOk && underLimit && courseOk && classOk;
  }) || null;
}

// O cron de recuperação de carrinho/pagamento pendente (api/cron/recover-carts.mjs) sempre
// promete o cupom "EBN10" de 10% na mensagem de WhatsApp (regra P1.1 do Manual do produto) — esta
// função garante que esse cupom exista e esteja ativo antes do envio, em vez de depender de
// alguém ter cadastrado a linha manualmente no banco (achado numa auditoria em 04/09/2026:
// o cupom nunca era criado em nenhum lugar do código que realmente roda em produção).
export async function ensureRecoveryCoupon() {
  if (!isDbConfigured()) return null;

  if (DATABASE_URL) {
    const result = await pgQuery(
      `insert into coupons (code, type, value, status, max_uses)
       values ('EBN10', 'percent', 10, 'active', null)
       on conflict (code) do update set status = 'active'
       returning id, code, type, value, status, used_count, max_uses, course_slug, class_date, starts_at, ends_at`,
    );
    return result.rows[0] || null;
  }

  const existingRows = await supabaseRequest('coupons?code=eq.EBN10&select=id,status&limit=1');
  if (existingRows?.[0]) {
    if (existingRows[0].status !== 'active') {
      await supabaseRequest(`coupons?id=eq.${existingRows[0].id}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
    }
    return existingRows[0];
  }
  const [created] = await supabaseRequest('coupons', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ code: 'EBN10', type: 'percent', value: 10, status: 'active' }),
  }).catch(() => []);
  return created || null;
}

// Oferta adicional configurável (regra P1.2/5.1 do Manual do produto): elegibilidade, tipo e valor
// do desconto vêm da tabela upsell_offers (cadastrada pela escola), nunca de uma regra fixa no
// código. Sem oferta ativa cadastrada para o par de cursos, não há oferta adicional.
export async function findUpsellOffer(sourceCourseSlug = '', targetCourseSlug = '') {
  if (!sourceCourseSlug || !targetCourseSlug || !isDbConfigured()) return null;

  if (DATABASE_URL) {
    const result = await pgQuery(
      `select id, source_course_slug, target_course_slug, title, discount_type, discount_value
       from upsell_offers
       where source_course_slug = $1 and target_course_slug = $2
         and status = 'active'
         and (starts_at is null or starts_at <= now())
         and (ends_at is null or ends_at >= now())
       limit 1`,
      [sourceCourseSlug, targetCourseSlug],
    );
    return result.rows[0] || null;
  }

  const rows = await supabaseRequest(
    `upsell_offers?source_course_slug=eq.${encodeURIComponent(sourceCourseSlug)}&target_course_slug=eq.${encodeURIComponent(targetCourseSlug)}&select=id,source_course_slug,target_course_slug,title,discount_type,discount_value,status,starts_at,ends_at&limit=1`,
  );
  const offer = rows[0];
  if (!offer || offer.status !== 'active') return null;
  const now = Date.now();
  if (offer.starts_at && Date.parse(offer.starts_at) > now) return null;
  if (offer.ends_at && Date.parse(offer.ends_at) < now) return null;
  return offer;
}

export async function listActiveUpsellOffers() {
  if (!isDbConfigured()) return [];

  if (DATABASE_URL) {
    const result = await pgQuery(
      `select source_course_slug, target_course_slug, title, discount_type, discount_value
       from upsell_offers
       where status = 'active'
         and (starts_at is null or starts_at <= now())
         and (ends_at is null or ends_at >= now())
       order by sort_order asc, created_at asc`,
    );
    return result.rows;
  }

  const rows = await supabaseRequest('upsell_offers?select=source_course_slug,target_course_slug,title,discount_type,discount_value,status,starts_at,ends_at&order=sort_order.asc');
  const now = Date.now();
  return (rows || []).filter((offer) => {
    if (offer.status !== 'active') return false;
    if (offer.starts_at && Date.parse(offer.starts_at) > now) return false;
    if (offer.ends_at && Date.parse(offer.ends_at) < now) return false;
    return true;
  });
}

// Gestão das ofertas (painel admin, permissão offers_manage) — diferente de
// listActiveUpsellOffers (usada pelo checkout), aqui listamos todas, inclusive rascunhos.
export async function listAllUpsellOffers() {
  if (DATABASE_URL) {
    const result = await pgQuery('select id, source_course_slug, target_course_slug, title, description, discount_type, discount_value, status, starts_at, ends_at, sort_order, created_at from upsell_offers order by created_at desc');
    return result.rows;
  }
  return supabaseRequest('upsell_offers?select=id,source_course_slug,target_course_slug,title,description,discount_type,discount_value,status,starts_at,ends_at,sort_order,created_at&order=created_at.desc');
}

export async function createUpsellOffer({ sourceCourseSlug, targetCourseSlug, title, discountType, discountValue } = {}) {
  if (DATABASE_URL) {
    const result = await pgQuery(
      `insert into upsell_offers (source_course_slug, target_course_slug, title, discount_type, discount_value, status)
       values ($1, $2, $3, $4, $5, 'active')
       returning id, source_course_slug, target_course_slug, title, discount_type, discount_value, status, created_at`,
      [sourceCourseSlug, targetCourseSlug, title, discountType, discountValue],
    );
    return result.rows[0];
  }
  const [created] = await supabaseRequest('upsell_offers', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ source_course_slug: sourceCourseSlug, target_course_slug: targetCourseSlug, title, discount_type: discountType, discount_value: discountValue, status: 'active' }),
  });
  return created;
}

export async function updateUpsellOfferStatus(id, status) {
  if (DATABASE_URL) {
    const result = await pgQuery('update upsell_offers set status = $1, updated_at = now() where id = $2 returning id, status', [status, id]);
    return result.rows[0] || null;
  }
  const [updated] = await supabaseRequest(`upsell_offers?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
  });
  return updated || null;
}

// Ocupação atômica de vaga (regra P0.5 do Manual do produto): uma turma lotada nunca pode
// confirmar matrícula acima da capacidade, mesmo com duas confirmações simultâneas.
// Chame apenas na transição para pago (isPaid && !wasAlreadyPaid) para manter idempotência.
export async function reserveClassSeat(courseSlug = '', classDate = '') {
  const slug = String(courseSlug || '').trim();
  const date = String(classDate || '').trim();
  if (!slug || !date) return { reserved: false, reason: 'missing_class_reference' };

  if (DATABASE_URL) {
    const result = await pgQuery(
      `update classes
         set sold_count = sold_count + 1,
             updated_at = now()
       where course_slug = $1
         and class_date = $2
         and sold_count + coalesce(reserved_count, 0) < capacity
       returning sold_count, capacity, reserved_count`,
      [slug, date],
    );
    if (result.rowCount > 0) {
      return { reserved: true, tracked: true, ...result.rows[0] };
    }
    const current = await pgQuery(
      `select sold_count, capacity, reserved_count from classes where course_slug = $1 and class_date = $2 limit 1`,
      [slug, date],
    );
    if (!current.rows[0]) {
      // Turma ainda não sincronizada na tabela classes: não bloqueia a venda, mas não há
      // proteção de capacidade até o catálogo ser sincronizado (POST /api/health?action=sync-catalog).
      return { reserved: true, tracked: false, reason: 'class_not_tracked' };
    }
    return { reserved: false, tracked: true, reason: 'class_full', ...current.rows[0] };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [row] = await supabaseRequest(
      `classes?course_slug=eq.${encodeURIComponent(slug)}&class_date=eq.${encodeURIComponent(date)}&select=id,sold_count,capacity,reserved_count&limit=1`,
    );
    if (!row) return { reserved: true, tracked: false, reason: 'class_not_tracked' };
    const soldCount = Number(row.sold_count || 0);
    const reservedCount = Number(row.reserved_count || 0);
    const capacity = Number(row.capacity || 0);
    if (soldCount + reservedCount >= capacity) {
      return { reserved: false, tracked: true, reason: 'class_full', soldCount, capacity, reservedCount };
    }
    const updated = await supabaseRequest(
      `classes?id=eq.${encodeURIComponent(row.id)}&sold_count=eq.${soldCount}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ sold_count: soldCount + 1, updated_at: new Date().toISOString() }),
      },
    );
    if (updated?.[0]) return { reserved: true, tracked: true, soldCount: soldCount + 1, capacity, reservedCount };
  }
  return { reserved: false, tracked: true, reason: 'concurrent_conflict' };
}

// Espelha reserveClassSeat: libera a vaga quando um pagamento antes confirmado é estornado
// ou sofre chargeback (regra §16.4 do Manual do produto — decisão de negócio, 03/09/2026). Chame
// apenas na transição de pago para cancelado, pra não liberar vaga que nunca foi ocupada.
export async function releaseClassSeat(courseSlug = '', classDate = '') {
  const slug = String(courseSlug || '').trim();
  const date = String(classDate || '').trim();
  if (!slug || !date) return { released: false, reason: 'missing_class_reference' };

  let result;
  if (DATABASE_URL) {
    const dbResult = await pgQuery(
      `update classes
         set sold_count = greatest(sold_count - 1, 0),
             updated_at = now()
       where course_slug = $1 and class_date = $2
       returning sold_count, capacity, reserved_count`,
      [slug, date],
    );
    result = dbResult.rows[0] ? { released: true, tracked: true, ...dbResult.rows[0] } : { released: true, tracked: false, reason: 'class_not_tracked' };
  } else {
    const [row] = await supabaseRequest(`classes?course_slug=eq.${encodeURIComponent(slug)}&class_date=eq.${encodeURIComponent(date)}&select=id,sold_count,capacity,reserved_count&limit=1`);
    if (!row) {
      result = { released: true, tracked: false, reason: 'class_not_tracked' };
    } else {
      const soldCount = Math.max(0, Number(row.sold_count || 0) - 1);
      await supabaseRequest(`classes?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ sold_count: soldCount, updated_at: new Date().toISOString() }),
      });
      result = { released: true, tracked: true, soldCount, capacity: row.capacity, reservedCount: row.reserved_count };
    }
  }

  // Regra §16.8 do Manual do produto (decisão de negócio, 03/09/2026): vaga liberada avisa
  // automaticamente quem está na fila de espera, por ordem de chegada (um aviso por vaga).
  const waitlistNotified = await notifyNextWaitlistEntry(slug, date).catch(() => null);
  return { ...result, waitlistNotified };
}

// Lista de espera real (tabela waitlist_entries, migration 0005): quem entra na fila é
// avisado automaticamente por WhatsApp assim que uma vaga abre de verdade (releaseClassSeat
// acima), por ordem de chegada — nunca mais que um aviso por vaga liberada.
export async function joinWaitlist({ courseSlug, classDate, name, email, whatsapp, source } = {}) {
  const record = {
    course_slug: courseSlug,
    class_date: classDate,
    name,
    email: email || null,
    whatsapp,
    source: source || 'agenda',
    status: 'waiting',
  };
  if (DATABASE_URL) {
    const columns = Object.keys(record);
    const values = Object.values(record);
    const result = await pgQuery(`insert into waitlist_entries (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, values);
    return result.rows[0];
  }
  const [created] = await supabaseRequest('waitlist_entries', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(record) });
  return created;
}

export async function listWaitlistEntries() {
  const select = 'id,course_slug,class_date,name,email,whatsapp,status,notified_at,source,created_at';
  if (DATABASE_URL) {
    const result = await pgQuery(`select ${select.split(',').join(', ')} from waitlist_entries order by created_at asc`);
    return result.rows;
  }
  return supabaseRequest(`waitlist_entries?select=${select}&order=created_at.asc`);
}

export async function updateWaitlistEntryStatus(id, status) {
  if (DATABASE_URL) {
    const result = await pgQuery('update waitlist_entries set status = $1, updated_at = now() where id = $2 returning *', [status, id]);
    return result.rows[0] || null;
  }
  const [updated] = await supabaseRequest(`waitlist_entries?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status, updated_at: new Date().toISOString() }) });
  return updated || null;
}

// Pega a próxima pessoa da fila (a que entrou primeiro, ainda esperando), marca como avisada
// e dispara o WhatsApp — nunca mais de uma pessoa por vaga liberada. .catch: se a tabela
// waitlist_entries ainda não existir no banco (migration 0005 não rodada), a liberação da
// vaga não pode quebrar por causa disso.
async function notifyNextWaitlistEntry(courseSlug, classDate) {
  const course = findCourse(courseSlug);
  const offer = course ? offerForCourse(course, classDate || course.dates[0]) : null;
  const checkoutUrl = offer?.checkout_url || `https://DOMINIO-NAO-CONFIGURADO/curso/${encodeURIComponent(courseSlug)}`;
  const courseName = course?.name || courseSlug;

  let entry = null;
  if (DATABASE_URL) {
    const result = await pgQuery(
      `update waitlist_entries
       set status = 'notified', notified_at = now(), updated_at = now()
       where id = (
         select id from waitlist_entries
         where course_slug = $1 and class_date = $2 and status = 'waiting'
         order by created_at asc
         limit 1
         for update skip locked
       )
       returning id, name, email, whatsapp, class_date`,
      [courseSlug, classDate],
    ).catch(() => ({ rows: [] }));
    entry = result.rows[0] || null;
  } else {
    const [candidate] = await supabaseRequest(`waitlist_entries?course_slug=eq.${encodeURIComponent(courseSlug)}&class_date=eq.${encodeURIComponent(classDate)}&status=eq.waiting&order=created_at.asc&limit=1`).catch(() => []);
    if (candidate) {
      await supabaseRequest(`waitlist_entries?id=eq.${encodeURIComponent(candidate.id)}&status=eq.waiting`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'notified', notified_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      }).catch(() => null);
      entry = candidate;
    }
  }

  if (entry) {
    await sendWaitlistSeatAvailable(entry.whatsapp, { name: entry.name, courseName, classDate: entry.class_date || classDate, checkoutUrl }).catch(() => null);
  }
  return entry;
}

// Evita aluno/lead duplicado (regra P1.6 do Manual do produto): antes de criar um registro novo em
// `students`, procura por email ou WhatsApp já cadastrados e reaproveita o mesmo id,
// atualizando os dados de contato mais recentes. Sem isso, cada tentativa de matrícula
// (inclusive reenvios depois de um carrinho abandonado) criava um aluno novo.
async function findOrCreateStudent({ name, email, whatsapp, cpf, source = 'site', whatsappOptIn = true } = {}) {
  const normalizedEmail = safeText(email, 180).toLowerCase();
  const normalizedWhatsapp = cleanPhone(whatsapp);
  const cpfLast4 = cleanCpf(cpf).slice(-4) || null;
  const cpfHash = hashCpf(cpf);
  const metadataPatch = { rawWhatsapp: whatsapp || null, whatsappOptIn: whatsappOptIn !== false };

  if (DATABASE_URL) {
    const match = await pgQuery(
      `select id, name, email, whatsapp, cpf_last4, cpf_hash, metadata from students
       where ($3 <> '' and cpf_hash = $3)
          or ($1 <> '' and lower(email) = $1)
          or ($2 <> '' and regexp_replace(coalesce(whatsapp, ''), '\\D', '', 'g') = $2)
       order by (case when $3 <> '' and cpf_hash = $3 then 0 else 1 end), created_at desc
       limit 1`,
      [normalizedEmail, normalizedWhatsapp, cpfHash || ''],
    );
    if (match.rows[0]) {
      const existing = match.rows[0];
      const updated = await pgQuery(
        `update students
         set name = coalesce(nullif($1, ''), name),
             email = coalesce(nullif($2, ''), email),
             whatsapp = coalesce(nullif($3, ''), whatsapp),
             cpf_last4 = coalesce($4, cpf_last4),
             cpf_hash = coalesce($5, cpf_hash),
             metadata = coalesce(metadata, '{}'::jsonb) || $6::jsonb,
             updated_at = now()
         where id = $7
         returning id, name, email, whatsapp, cpf_last4, cpf_hash, metadata`,
        [safeText(name, 180), normalizedEmail, normalizedWhatsapp, cpfLast4, cpfHash, JSON.stringify(metadataPatch), existing.id],
      );
      return updated.rows[0] || existing;
    }
  }

  const [student] = await supabaseRequest('students', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      external_id: safeId('student'),
      name,
      email,
      whatsapp: normalizedWhatsapp,
      cpf_last4: cpfLast4,
      cpf_hash: cpfHash,
      created_source: source,
      metadata: metadataPatch,
    }),
  });
  return student;
}

// Busca simples por email, usada pelo painel admin para localizar a aluna ao cadastrar
// certificado ou aviso (a equipe digita o email, não precisa saber o id interno).
export async function findStudentByEmail(email = '') {
  const normalized = safeText(email, 180).toLowerCase();
  if (!normalized) return null;
  if (DATABASE_URL) {
    const result = await pgQuery('select id, name, email from students where lower(email) = $1 order by created_at desc limit 1', [normalized]);
    return result.rows[0] || null;
  }
  const [student] = await supabaseRequest(`students?email=eq.${encodeURIComponent(normalized)}&select=id,name,email&limit=1`);
  return student || null;
}

export async function persistEnrollmentIntent(payload, audit = {}) {
  const enrollmentExternalId = safeId('enrollment');
  const paymentExternalId = safeId('payment');
  const cartExternalId = safeId('cart');

  const student = await findOrCreateStudent({
    name: payload.studentName,
    email: payload.studentEmail,
    whatsapp: payload.studentWhatsapp,
    cpf: payload.studentCpf,
    source: payload.attribution?.utm_source || payload.attribution?.first_referrer || 'site',
    whatsappOptIn: payload.whatsappOptIn,
  });

  const items = Array.isArray(payload.cart?.items) && payload.cart.items.length ? payload.cart.items : [{ ...(payload.cart || {}), role: 'primary' }];
  const additionalItem = items.find((item) => item.role === 'additional') || null;
  const primaryItem = items.find((item) => item.role === 'primary') || items[0];

  const [enrollment] = await supabaseRequest('enrollments', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      external_id: enrollmentExternalId,
      student_id: student.id,
      course_slug: payload.courseSlug,
      course_name: payload.courseName,
      class_date: payload.classDate,
      option_label: payload.cart?.optionLabel || null,
      flow: payload.cart?.flow || 'asaas',
      status: 'payment_intent_validated',
      source: payload.attribution?.utm_source || null,
      campaign: payload.attribution?.utm_campaign || null,
      amount_expected: primaryItem?.priceNumber ?? payload.cart?.priceNumber ?? null,
      metadata: { audit, termsVersion: payload.termsVersion || null, whatsappOptIn: payload.whatsappOptIn !== false },
    }),
  });

  // Oferta adicional com 20% no segundo curso (regra P1.2/5.1 do Manual do produto): quando presente,
  // vira uma segunda matrícula vinculada ao mesmo pagamento, nunca ao curso principal.
  let additionalEnrollment = null;
  if (additionalItem) {
    const [created] = await supabaseRequest('enrollments', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        external_id: safeId('enrollment'),
        student_id: student.id,
        course_slug: additionalItem.courseSlug,
        course_name: additionalItem.courseName,
        class_date: additionalItem.classDate,
        option_label: additionalItem.optionLabel || null,
        flow: 'asaas',
        status: 'payment_intent_validated',
        source: payload.attribution?.utm_source || null,
        campaign: payload.attribution?.utm_campaign || null,
        amount_expected: additionalItem.priceNumber ?? null,
        metadata: { audit, bundledWithEnrollmentId: enrollment.id, role: 'additional', discountPercent: additionalItem.discountPercent || 20 },
      }),
    });
    additionalEnrollment = created;
  }

  const cartItems = additionalEnrollment
    ? [{ ...primaryItem, enrollmentId: enrollment.id }, { ...additionalItem, enrollmentId: additionalEnrollment.id }]
    : [{ ...primaryItem, enrollmentId: enrollment.id }];

  const [cart] = await supabaseRequest('carts', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      external_id: cartExternalId,
      enrollment_id: enrollment.id,
      student_id: student.id,
      status: 'submitted',
      coupon_code: payload.coupon || payload.cart?.coupon || null,
      total_amount: payload.cart?.priceNumber || null,
      items: cartItems,
      attribution: payload.attribution || {},
    }),
  });

  const [payment] = await supabaseRequest('payments', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      external_id: paymentExternalId,
      enrollment_id: enrollment.id,
      student_id: student.id,
      provider: 'asaas',
      method: payload.paymentMethod,
      status: 'validated_not_created',
      amount: payload.cart?.priceNumber || null,
      metadata: { coupon: payload.coupon || null, audit, additionalEnrollmentId: additionalEnrollment?.id || null },
    }),
  });

  await supabaseRequest('tracking_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      event_name: 'payment_payload_validated',
      student_id: student.id,
      enrollment_id: enrollment.id,
      session_id: payload.attribution?.session_id || null,
      url: payload.attribution?.last_landing_page || null,
      referrer: payload.attribution?.last_referrer || null,
      utm_source: payload.attribution?.utm_source || null,
      utm_medium: payload.attribution?.utm_medium || null,
      utm_campaign: payload.attribution?.utm_campaign || null,
      payload: { cart, payment, audit },
    }),
  });

  await persistAutomaticCrmOpportunity({
    payload,
    student,
    enrollment,
    source: 'asaas_checkout',
    status: 'payment_intent_validated',
    audit,
  });

  return { studentId: student.id, enrollmentId: enrollment.id, cartId: cart.id, paymentId: payment.id, additionalEnrollmentId: additionalEnrollment?.id || null };
}

export async function markPaymentCreated(paymentId, enrollmentId, providerPayment = {}, audit = {}) {
  if (!paymentId) {
    const error = new Error('payment_id_required');
    error.code = 'payment_id_required';
    throw error;
  }

  const metadata = {
    asaas: {
      id: providerPayment.id || null,
      invoiceUrl: providerPayment.invoiceUrl || null,
      bankSlipUrl: providerPayment.bankSlipUrl || null,
      transactionReceiptUrl: providerPayment.transactionReceiptUrl || null,
      dueDate: providerPayment.dueDate || null,
      billingType: providerPayment.billingType || null,
    },
    audit,
  };

  if (DATABASE_URL) {
    await pgQuery(
      `update payments
       set provider_payment_id = $1,
           status = $2,
           amount = coalesce($3, amount),
           metadata = coalesce(metadata, '{}'::jsonb) || $4::jsonb,
           updated_at = now()
       where id = $5`,
      [providerPayment.id || null, providerPayment.status || 'created', providerPayment.value || null, JSON.stringify(metadata), paymentId],
    );
    if (enrollmentId) {
      await pgQuery(
        `update enrollments
         set status = $1,
             metadata = coalesce(metadata, '{}'::jsonb) || $2::jsonb,
             updated_at = now()
         where id = $3`,
        ['payment_created', JSON.stringify({ asaasPaymentId: providerPayment.id || null, audit }), enrollmentId],
      );
    }
    await pgQuery(
      `insert into tracking_events (event_name, enrollment_id, payload)
       values ($1, $2, $3::jsonb)`,
      ['asaas_payment_created', enrollmentId || null, JSON.stringify({ providerPayment, audit })],
    );
    return { updated: true, mode: 'postgres' };
  }

  await supabaseRequest(`payments?id=eq.${encodeURIComponent(paymentId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      provider_payment_id: providerPayment.id || null,
      status: providerPayment.status || 'created',
      amount: providerPayment.value || null,
      metadata,
      updated_at: new Date().toISOString(),
    }),
  });

  if (enrollmentId) {
    await supabaseRequest(`enrollments?id=eq.${encodeURIComponent(enrollmentId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'payment_created',
        metadata: { asaasPaymentId: providerPayment.id || null, audit },
        updated_at: new Date().toISOString(),
      }),
    });
  }

  await supabaseRequest('tracking_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      event_name: 'asaas_payment_created',
      enrollment_id: enrollmentId || null,
      payload: { providerPayment, audit },
    }),
  });

  return { updated: true, mode: 'supabase_rest' };
}

// Aplica a transição para pago em uma matrícula: reserva vaga de forma atômica (P0.5) e
// registra alerta se a turma já estiver lotada. Reaproveitado pela matrícula principal e
// pela matrícula adicional da oferta de 20% (regra P1.2 do Manual do produto).
async function settlePaidClassEnrollment({ enrollmentId, studentId, courseSlug, classDate, nextStatus, becamePaid, becameCancelled, provider, audit }) {
  let seatReservation = null;
  let enrollmentStatus = `payment_${nextStatus}`;
  if (becamePaid && courseSlug && classDate) {
    seatReservation = await reserveClassSeat(courseSlug, classDate);
    if (!seatReservation.reserved) enrollmentStatus = 'paid_capacity_exceeded';
  }
  if (becameCancelled && courseSlug && classDate) {
    seatReservation = await releaseClassSeat(courseSlug, classDate);
    enrollmentStatus = 'cancelled_refunded';
  }
  await pgQuery(
    `update enrollments
     set status = $1,
         metadata = coalesce(metadata, '{}'::jsonb) || $3::jsonb,
         updated_at = now()
     where id = $2`,
    [enrollmentStatus, enrollmentId, JSON.stringify({ lastPaymentStatus: nextStatus, paidAt: paidStatus(nextStatus) ? (audit.receivedAt || new Date().toISOString()) : null, seatReservation })],
  );
  if (becamePaid && !seatReservation?.reserved) {
    await pgQuery(
      `insert into tracking_events (event_name, student_id, enrollment_id, payload)
       values ($1, $2, $3, $4::jsonb)`,
      ['capacity_exceeded_alert', studentId, enrollmentId, JSON.stringify({ provider, courseSlug, classDate, seatReservation, audit })],
    );
  }
  return seatReservation;
}

export async function persistAsaasWebhookEvent(event = {}, audit = {}) {
  const payment = event.payment || {};
  const providerEventId = event.id || `${event.event || event.type || 'asaas_event'}:${payment.id || 'unknown'}`;
  const eventType = event.event || event.type || null;

  if (DATABASE_URL) {
    const inserted = await pgQuery(
      `insert into payment_events (provider, provider_event_id, provider_payment_id, event_type, payload, processed_at)
       values ('asaas', $1, $2, $3, $4::jsonb, now())
       on conflict (provider, provider_event_id) do nothing
       returning id`,
      [providerEventId, payment.id || null, eventType, JSON.stringify({ event, audit })],
    );

    const statusMap = {
      PAYMENT_CREATED: 'created',
      PAYMENT_UPDATED: payment.status || 'updated',
      PAYMENT_CONFIRMED: 'confirmed',
      PAYMENT_RECEIVED: 'received',
      PAYMENT_OVERDUE: 'overdue',
      PAYMENT_DELETED: 'deleted',
      PAYMENT_REFUNDED: 'refunded',
      PAYMENT_CHARGEBACK_REQUESTED: 'chargeback_requested',
      PAYMENT_CHARGEBACK_DISPUTE: 'chargeback_dispute',
      PAYMENT_AWAITING_CHARGEBACK_REVERSAL: 'awaiting_chargeback_reversal',
    };
    // Achado numa auditoria em 04/09/2026: o fallback não pode conter substring que
    // paidStatus() reconheça como "pago" (ex.: "received") -- senão um evento Asaas não
    // mapeado, sem status anterior salvo, seria tratado como pagamento confirmado de
    // verdade sem nenhuma confirmação real da Asaas.
    const nextStatus = statusMap[eventType] || payment.status || 'webhook_status_unknown';

    let updatedPayment = null;
    let seatReservation = null;
    let additionalSeatReservation = null;
    if (payment.id && inserted.rowCount > 0) {
      // Pagamento no cartão criado via Asaas Checkout (regra P1.5 do Manual do produto): nós nunca
      // chamamos /payments diretamente, então o id do pagamento na Asaas só existe a partir
      // desse primeiro webhook. Vincula pela externalReference (o id do nosso `payments`
      // enviado ao criar o checkout) na primeira vez que ele aparece.
      if (payment.externalReference) {
        await pgQuery(
          `update payments set provider_payment_id = $1, updated_at = now()
           where provider = 'asaas' and id = $2::uuid and provider_payment_id is null`,
          [payment.id, payment.externalReference],
        ).catch(() => null);
      }

      const currentResult = await pgQuery(
        `select p.status, p.metadata->>'additionalEnrollmentId' as additional_enrollment_id,
                e.id as enrollment_id, e.course_slug, e.class_date
         from payments p
         left join enrollments e on e.id = p.enrollment_id
         where p.provider = 'asaas' and p.provider_payment_id = $1
         limit 1`,
        [payment.id],
      );
      const currentPayment = currentResult.rows[0] || null;
      const wasAlreadyPaid = paidStatus(currentPayment?.status);

      const result = await pgQuery(
        `update payments
         set status = $1,
             amount = coalesce($2, amount),
             paid_at = case when $3::text in ('confirmed', 'received') then coalesce(paid_at, now()) else paid_at end,
             metadata = coalesce(metadata, '{}'::jsonb) || $4::jsonb,
             updated_at = now()
         where provider = 'asaas' and provider_payment_id = $5
         returning id, enrollment_id, student_id, status`,
        [nextStatus, payment.value || payment.netValue || null, nextStatus, JSON.stringify({ lastWebhook: { eventType, receivedAt: audit.receivedAt || new Date().toISOString() } }), payment.id],
      );
      updatedPayment = result.rows[0] || null;
      // Só ocupa vaga na transição para pago, evitando duplicar em eventos repetidos (regra P0.5 do Manual do produto).
      const becamePaid = paidStatus(nextStatus) && !wasAlreadyPaid;
      // Só libera vaga na transição de pago para estornado/chargeback (regra §16.4 do Manual do produto).
      const becameCancelled = cancelledPaymentStatus(nextStatus) && wasAlreadyPaid;

      if (updatedPayment?.enrollment_id) {
        seatReservation = await settlePaidClassEnrollment({
          enrollmentId: updatedPayment.enrollment_id,
          studentId: updatedPayment.student_id,
          courseSlug: currentPayment?.course_slug,
          classDate: currentPayment?.class_date,
          nextStatus,
          becamePaid,
          becameCancelled,
          provider: 'asaas',
          audit,
        });

        if ((becamePaid || becameCancelled) && currentPayment?.additional_enrollment_id) {
          const additionalRow = await pgQuery('select course_slug, class_date from enrollments where id = $1 limit 1', [currentPayment.additional_enrollment_id]);
          const additional = additionalRow.rows[0] || null;
          if (additional) {
            additionalSeatReservation = await settlePaidClassEnrollment({
              enrollmentId: currentPayment.additional_enrollment_id,
              studentId: updatedPayment.student_id,
              courseSlug: additional.course_slug,
              classDate: additional.class_date,
              nextStatus,
              becamePaid,
              becameCancelled,
              provider: 'asaas',
              audit,
            });
          }
        }

        if (becamePaid) {
          await applyAutomaticStudentBadge(updatedPayment.student_id, 'new_course', audit, 'paid_enrollment').catch(() => null);
        }
        if (becameCancelled) {
          await pgQuery(
            `insert into tracking_events (event_name, student_id, enrollment_id, payload)
             values ($1, $2, $3, $4::jsonb)`,
            ['enrollment_cancelled_refund', updatedPayment.student_id, updatedPayment.enrollment_id, JSON.stringify({ provider: 'asaas', nextStatus, seatReservation, audit })],
          );
        }
      }
    }

    return { persisted: inserted.rowCount > 0, duplicate: inserted.rowCount === 0, providerEventId, eventType, updatedPayment, seatReservation, additionalSeatReservation };
  }

  try {
    await supabaseRequest('payment_events', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        provider: 'asaas',
        provider_event_id: providerEventId,
        provider_payment_id: payment.id || null,
        event_type: eventType,
        processed_at: new Date().toISOString(),
        payload: { event, audit },
      }),
    });
  } catch (error) {
    if (['23505', '409'].includes(String(error.code || error.status))) {
      return { persisted: false, duplicate: true, providerEventId, eventType, updatedPayment: null };
    }
    throw error;
  }

  let updatedPayment = null;
  let seatReservation = null;
  let additionalSeatReservation = null;
  if (payment.id) {
    const statusMap = {
      PAYMENT_CREATED: 'created',
      PAYMENT_UPDATED: payment.status || 'updated',
      PAYMENT_CONFIRMED: 'confirmed',
      PAYMENT_RECEIVED: 'received',
      PAYMENT_OVERDUE: 'overdue',
      PAYMENT_DELETED: 'deleted',
      PAYMENT_REFUNDED: 'refunded',
      PAYMENT_CHARGEBACK_REQUESTED: 'chargeback_requested',
      PAYMENT_CHARGEBACK_DISPUTE: 'chargeback_dispute',
      PAYMENT_AWAITING_CHARGEBACK_REVERSAL: 'awaiting_chargeback_reversal',
    };
    // Achado numa auditoria em 04/09/2026: o fallback não pode conter substring que
    // paidStatus() reconheça como "pago" (ex.: "received") -- senão um evento Asaas não
    // mapeado, sem status anterior salvo, seria tratado como pagamento confirmado de
    // verdade sem nenhuma confirmação real da Asaas.
    const nextStatus = statusMap[eventType] || payment.status || 'webhook_status_unknown';
    if (payment.externalReference) {
      await supabaseRequest(`payments?provider=eq.asaas&id=eq.${encodeURIComponent(payment.externalReference)}&provider_payment_id=is.null`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ provider_payment_id: payment.id, updated_at: new Date().toISOString() }),
      }).catch(() => null);
    }
    const [beforePayment] = await supabaseRequest(`payments?provider=eq.asaas&provider_payment_id=eq.${encodeURIComponent(payment.id)}&select=status,metadata&limit=1`);
    const wasAlreadyPaid = paidStatus(beforePayment?.status);
    const additionalEnrollmentId = beforePayment?.metadata?.additionalEnrollmentId || null;

    const patch = {
      status: nextStatus,
      amount: payment.value || payment.netValue || null,
      metadata: { lastWebhook: { eventType, receivedAt: audit.receivedAt || new Date().toISOString() } },
      updated_at: new Date().toISOString(),
    };
    if (['confirmed', 'received'].includes(nextStatus)) patch.paid_at = new Date().toISOString();

    const [patchedPayment] = await supabaseRequest(`payments?provider=eq.asaas&provider_payment_id=eq.${encodeURIComponent(payment.id)}&select=id,enrollment_id,student_id,status`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    updatedPayment = patchedPayment || null;
    const becamePaid = paidStatus(nextStatus) && !wasAlreadyPaid;
    // Só libera vaga na transição de pago para estornado/chargeback (regra §16.4 do Manual do produto).
    const becameCancelled = cancelledPaymentStatus(nextStatus) && wasAlreadyPaid;

    if (updatedPayment?.enrollment_id) {
      let enrollmentStatus = `payment_${nextStatus}`;
      if (becamePaid) {
        const [enrollmentRow] = await supabaseRequest(`enrollments?id=eq.${encodeURIComponent(updatedPayment.enrollment_id)}&select=course_slug,class_date&limit=1`);
        if (enrollmentRow?.course_slug && enrollmentRow?.class_date) {
          seatReservation = await reserveClassSeat(enrollmentRow.course_slug, enrollmentRow.class_date);
          if (!seatReservation.reserved) enrollmentStatus = 'paid_capacity_exceeded';
        }
      }
      if (becameCancelled) {
        const [enrollmentRow] = await supabaseRequest(`enrollments?id=eq.${encodeURIComponent(updatedPayment.enrollment_id)}&select=course_slug,class_date&limit=1`);
        if (enrollmentRow?.course_slug && enrollmentRow?.class_date) {
          seatReservation = await releaseClassSeat(enrollmentRow.course_slug, enrollmentRow.class_date);
        }
        enrollmentStatus = 'cancelled_refunded';
      }
      await supabaseRequest(`enrollments?id=eq.${encodeURIComponent(updatedPayment.enrollment_id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: enrollmentStatus,
          updated_at: new Date().toISOString(),
        }),
      });

      if ((becamePaid || becameCancelled) && additionalEnrollmentId) {
        const [additionalRow] = await supabaseRequest(`enrollments?id=eq.${encodeURIComponent(additionalEnrollmentId)}&select=course_slug,class_date&limit=1`);
        let additionalEnrollmentStatus = `payment_${nextStatus}`;
        if (becamePaid && additionalRow?.course_slug && additionalRow?.class_date) {
          additionalSeatReservation = await reserveClassSeat(additionalRow.course_slug, additionalRow.class_date);
          if (!additionalSeatReservation.reserved) additionalEnrollmentStatus = 'paid_capacity_exceeded';
        }
        if (becameCancelled && additionalRow?.course_slug && additionalRow?.class_date) {
          additionalSeatReservation = await releaseClassSeat(additionalRow.course_slug, additionalRow.class_date);
          additionalEnrollmentStatus = 'cancelled_refunded';
        }
        await supabaseRequest(`enrollments?id=eq.${encodeURIComponent(additionalEnrollmentId)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: additionalEnrollmentStatus, updated_at: new Date().toISOString() }),
        });
      }

      if (becamePaid) {
        await applyAutomaticStudentBadge(updatedPayment.student_id, 'new_course', audit, 'paid_enrollment').catch(() => null);
        if (!seatReservation?.reserved) {
          await supabaseRequest('tracking_events', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              event_name: 'capacity_exceeded_alert',
              student_id: updatedPayment.student_id,
              enrollment_id: updatedPayment.enrollment_id,
              payload: { provider: 'asaas', seatReservation, audit },
            }),
          });
        }
      }
      if (becameCancelled) {
        await supabaseRequest('tracking_events', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            event_name: 'enrollment_cancelled_refund',
            student_id: updatedPayment.student_id,
            enrollment_id: updatedPayment.enrollment_id,
            payload: { provider: 'asaas', nextStatus, seatReservation, audit },
          }),
        });
      }
    }
  }

  return { persisted: true, duplicate: false, providerEventId, eventType, updatedPayment, seatReservation, additionalSeatReservation };
}

export async function getPaymentFollowupContext(provider = 'asaas', providerPaymentId = '') {
  const paymentId = String(providerPaymentId || '').trim();
  if (!paymentId) return null;

  if (DATABASE_URL) {
    const result = await pgQuery(
      `select p.id as payment_id,
              p.provider_payment_id,
              p.status as payment_status,
              p.amount,
              p.method,
              e.id as enrollment_id,
              e.course_slug,
              e.course_name,
              e.class_date,
              e.option_label,
              e.flow,
              s.id as student_id,
              s.name,
              s.email,
              s.whatsapp,
              -- Atribuição do anúncio (_fbp, _fbc, utm) guardada quando a aluna se matriculou.
              -- O webhook de pagamento chega do servidor da Asaas, sem cookie nenhum: sem isto
              -- a venda ia pra Meta só com e-mail e telefone, e a correspondência ficava em
              -- 3.0/10 justamente no evento que decide a campanha.
              coalesce(
                (select c.attribution from carts c where c.enrollment_id = e.id and c.attribution is not null order by c.created_at desc limit 1),
                (select a.attribution from acceptances a where a.enrollment_id = e.id and a.attribution is not null order by a.created_at desc limit 1)
              ) as attribution
       from payments p
       left join enrollments e on e.id = p.enrollment_id
       left join students s on s.id = p.student_id
       where p.provider = $1 and p.provider_payment_id = $2
       order by p.updated_at desc nulls last, p.created_at desc
       limit 1`,
      [provider, paymentId],
    );
    return result.rows[0] || null;
  }

  const [payment] = await supabaseRequest(`payments?provider=eq.${encodeURIComponent(provider)}&provider_payment_id=eq.${encodeURIComponent(paymentId)}&select=id,enrollment_id,student_id,status,amount,method,provider_payment_id&limit=1`);
  if (!payment) return null;
  const [enrollment] = payment.enrollment_id
    ? await supabaseRequest(`enrollments?id=eq.${encodeURIComponent(payment.enrollment_id)}&select=id,course_slug,course_name,class_date,option_label,flow&limit=1`)
    : [];
  const [student] = payment.student_id
    ? await supabaseRequest(`students?id=eq.${encodeURIComponent(payment.student_id)}&select=id,name,email,whatsapp&limit=1`)
    : [];
  // Atribuição do anúncio guardada na matrícula (ver o comentário no ramo SQL acima).
  let attribution = null;
  if (payment.enrollment_id) {
    const [carrinho] = await supabaseRequest(`carts?enrollment_id=eq.${encodeURIComponent(payment.enrollment_id)}&select=attribution&order=created_at.desc&limit=1`).catch(() => []);
    attribution = carrinho?.attribution || null;
    if (!attribution) {
      const [aceite] = await supabaseRequest(`acceptances?enrollment_id=eq.${encodeURIComponent(payment.enrollment_id)}&select=attribution&order=created_at.desc&limit=1`).catch(() => []);
      attribution = aceite?.attribution || null;
    }
  }
  return {
    attribution,
    payment_id: payment.id,
    provider_payment_id: payment.provider_payment_id,
    payment_status: payment.status,
    amount: payment.amount,
    method: payment.method,
    enrollment_id: enrollment?.id || payment.enrollment_id,
    course_slug: enrollment?.course_slug || '',
    course_name: enrollment?.course_name || '',
    class_date: enrollment?.class_date || enrollment?.option_label || '',
    option_label: enrollment?.option_label || '',
    flow: enrollment?.flow || '',
    student_id: student?.id || payment.student_id,
    name: student?.name || '',
    email: student?.email || '',
    whatsapp: student?.whatsapp || '',
  };
}

// Selo humanizado só de última hora, pra quando uma aluna já ganhou um selo cuja chave a
// equipe ainda não cadastrou no catálogo de benefícios (badge_benefits) — nunca deixa a Minha
// a escola silenciosamente sem mostrar uma conquista que a aluna de fato tem.
function humanizeBadgeKey(key = '') {
  return String(key || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Selo a escola';
}

function badgeBenefitLabel(entry) {
  if (!entry) return null;
  if (entry.benefit_type === 'discount_percent' && entry.discount_percent) return `${Number(entry.discount_percent)}% de desconto`;
  return entry.benefit_detail || null;
}

// Escala do desconto progressivo: cada curso pago vale +5%, até o teto de 30%. É a mesma conta
// que o checkout aplica, então quem mexer aqui muda o desconto de verdade, não só a tela.
// Regra de desconto da escola, confirmada pela escola em 09/09/2026: quem fecha um curso já sai
// com 20% no próximo — a mesma frase que o atendimento fala na matrícula. Não é mais uma
// escala que cresce a cada curso (era 5%, 10%, 15%... até 30%): é 20%, sempre, a partir do
// primeiro curso pago. Os degraus seguintes deixam de dar desconto e passam a dar brinde, que
// a a escola cadastra em Painel > Operação > Selos e benefícios.
//
// O desconto vale só em curso de especialização. Essa parte é regra de atendimento: o sistema
// não sabe hoje quais cursos são de especialização (as categorias do catálogo são "Base",
// "Formação" e "Profissionalizante"), então a condição está escrita no texto do selo, e não
// aplicada sozinha. Pra virar automática, cada curso precisa de uma marca de "aceita desconto
// de aluna" no cadastro.
const NEXT_COURSE_DISCOUNT_PERCENT = 20;
const DISCOUNT_LEVELS = 6;

export function progressiveDiscountPercent(paidCount = 0) {
  return paidCount >= 1 ? NEXT_COURSE_DISCOUNT_PERCENT : 0;
}

// Selos automáticos da trilha de cursos (pedido da Erica, 07/09/2026): a cada curso pago a
// aluna sobe um degrau da escala de desconto e o selo daquele degrau libera sozinho — ninguém
// precisa cadastrar nada no painel nem aprovar à mão. O nome e o benefício de qualquer um
// deles podem ser trocados cadastrando a mesma badge_key em Painel > Operação > Selos e
// benefícios: o que vier do painel sempre manda no que está escrito aqui.
const COURSE_MILESTONE_LABELS = ['Primeiro passo', 'Em evolução', 'Aluna dedicada', 'Referência a escola', 'Veterana a escola', 'Especialista a escola'];

// 'new_course' é gravado como missão a cada matrícula paga, mas quem conta essa história na
// tela agora é o selo de degrau ("Primeiro passo"). Sem isso a aluna via os dois, dizendo a
// mesma coisa. Se a equipe cadastrar 'new_course' no painel com benefício próprio, aí ele
// volta a aparecer — porque passa a ser um selo que a a escola quis mesmo ter.
const BADGE_KEYS_HIDDEN_WITHOUT_CATALOG = new Set(['new_course', 'progressive_discount']);

function automaticStudentBadges({ paidCount = 0, missions = {} }) {
  const missionEarned = (key) => missions[key]?.status === 'approved';
  const milestones = COURSE_MILESTONE_LABELS.slice(0, DISCOUNT_LEVELS).map((label, index) => {
    const level = index + 1;
    return {
      key: `curso_${level}`,
      label,
      // Só o primeiro degrau tem benefício escrito no código, porque é o único que é regra
      // fixa da escola. Do segundo em diante o prêmio muda a cada campanha (um secador, uma
      // boneca de treino), então quem manda é o cadastro do painel — e enquanto não houver
      // cadastro, o selo diz honestamente que a a escola ainda vai anunciar, em vez de prometer um
      // desconto que ninguém combinou.
      benefitLabel: level === 1
        ? `${NEXT_COURSE_DISCOUNT_PERCENT}% de desconto no próximo curso de especialização`
        : null,
      rule: level === 1 ? 'Primeira matrícula paga' : `${level} cursos pagos`,
      earned: paidCount >= level,
      approvedAt: null,
      milestone: true,
    };
  });
  return [
    ...milestones,
    {
      key: 'course_review',
      label: 'Voz da escola',
      benefitLabel: null,
      rule: 'Avaliou um curso que já aconteceu',
      earned: missionEarned('course_review'),
      approvedAt: missions.course_review?.approvedAt || null,
      milestone: false,
    },
    {
      key: 'class_attendance',
      label: 'Presença marcante',
      benefitLabel: null,
      rule: 'Check-in confirmado na aula',
      earned: missionEarned('class_attendance'),
      approvedAt: missions.class_attendance?.approvedAt || null,
      milestone: false,
    },
  ];
}

// Catálogo que a Minha Área mostra: primeiro os selos automáticos na ordem da progressão,
// depois os que a equipe cadastrou no painel, e por último qualquer selo que a aluna já
// conquistou mas ninguém cadastrou — conquista dela nunca some da tela por falta de cadastro.
export function buildBadgeCatalog({ paidCount = 0, missions = {}, badgeBenefits = [] }) {
  const activeEntries = badgeBenefits.filter((entry) => entry.status === undefined || entry.status === 'active');
  const entryByKey = new Map(activeEntries.map((entry) => [entry.badge_key, entry]));
  const catalog = automaticStudentBadges({ paidCount, missions }).map((badge) => {
    const entry = entryByKey.get(badge.key);
    return {
      ...badge,
      label: entry?.badge_label || badge.label,
      benefitLabel: badgeBenefitLabel(entry) || badge.benefitLabel,
    };
  });
  const usedKeys = new Set(catalog.map((badge) => badge.key));

  for (const entry of activeEntries) {
    if (usedKeys.has(entry.badge_key)) continue;
    usedKeys.add(entry.badge_key);
    catalog.push({
      key: entry.badge_key,
      label: entry.badge_label || humanizeBadgeKey(entry.badge_key),
      benefitLabel: badgeBenefitLabel(entry),
      rule: null,
      earned: missions[entry.badge_key]?.status === 'approved',
      approvedAt: missions[entry.badge_key]?.approvedAt || null,
      milestone: false,
    });
  }

  for (const [key, mission] of Object.entries(missions)) {
    if (mission?.status !== 'approved' || usedKeys.has(key) || BADGE_KEYS_HIDDEN_WITHOUT_CATALOG.has(key)) continue;
    usedKeys.add(key);
    catalog.push({
      key,
      label: humanizeBadgeKey(key),
      benefitLabel: null,
      rule: null,
      earned: true,
      approvedAt: mission.approvedAt || null,
      milestone: false,
    });
  }

  return catalog;
}

export function toStudentPortal({ student = {}, enrollments = [], payments = [], trackingEvents = [], materials = [], certificates = [], notifications = [], badgeBenefits = [], courseReviews = [] }) {
  // payments vem ordenado created_at desc; guardamos o mais recente por matrícula, mas
  // promovemos um pagamento confirmado mais antigo se o mais recente ainda não foi pago
  // (ex.: tentativa nova pendente não deve esconder que a matrícula já está paga).
  const paymentsByEnrollment = new Map();
  for (const payment of payments) {
    const existing = paymentsByEnrollment.get(payment.enrollment_id);
    if (!existing || (!paidStatus(existing.status) && paidStatus(payment.status))) {
      paymentsByEnrollment.set(payment.enrollment_id, payment);
    }
  }
  const benefitsByBadgeKey = new Map(badgeBenefits.map((entry) => [entry.badge_key, entry]));
  const reviewedEnrollmentIds = new Set(courseReviews.map((row) => row.enrollment_id));
  const paidCount = payments.filter((payment) => ['confirmed', 'received', 'paid'].includes(String(payment.status || '').toLowerCase())).length;
  const certificateFor = (courseSlug, classDate) => certificates.find((c) => c.course_slug === courseSlug && (!c.class_date || c.class_date === classDate)) || null;
  const materialsFor = (courseSlug, classDate) => materials.filter((m) => m.course_slug === courseSlug && (!m.class_date || m.class_date === classDate));
  const completedCount = enrollments.filter((enrollment) => {
    const portal = enrollment.metadata?.studentPortal || {};
    const certificate = certificateFor(enrollment.course_slug, enrollment.class_date);
    return certificate?.status === 'released' || portal.certificateReleased === true || /completed|concluido|concluído|certificado|certificate/i.test(String(enrollment.status || ''));
  }).length;
  const discountPercent = progressiveDiscountPercent(paidCount);
  const missions = student.metadata?.studentBadges?.missions || {};
  // Catálogo completo de selos: os degraus da trilha de cursos liberam sozinhos conforme a
  // aluna paga mais cursos, e os selos cadastrados no painel (avaliação, presença, indicação
  // e o que a equipe criar depois) entram na mesma lista — pedido da Erica, 07/09/2026.
  const badgeCatalog = buildBadgeCatalog({ paidCount, missions, badgeBenefits });
  const earnedBadges = badgeCatalog
    .filter((badge) => badge.earned)
    .map((badge) => ({
      key: badge.key,
      label: badge.label,
      benefitType: benefitsByBadgeKey.get(badge.key)?.benefit_type || null,
      benefitLabel: badge.benefitLabel || 'Benefício a definir pela equipe',
      approvedAt: badge.approvedAt || null,
    }));
  return {
    student: {
      id: student.id,
      name: student.name || 'Aluna a escola',
      email: student.email || '',
      whatsapp: student.whatsapp || '',
      cpfLast4: student.cpf_last4 || '',
      createdAt: student.created_at || null,
      profile: student.metadata?.studentProfile || {},
      badges: student.metadata?.studentBadges || { missions: {} },
      earnedBadges,
      badgeCatalog,
    },
    stats: {
      paidCourses: paidCount,
      completedCourses: completedCount,
      discountPercent,
      rankLabel: paidCount >= 3 ? 'Aluna destaque' : paidCount >= 2 ? 'Jornada em evolução' : 'Primeiro passo a escola',
    },
    enrollments: enrollments.map((enrollment) => {
      const payment = paymentsByEnrollment.get(enrollment.id) || {};
      const isPaid = paidStatus(payment.status);
      const portalSettings = enrollment.metadata?.studentPortal || {};
      const certificate = certificateFor(enrollment.course_slug, enrollment.class_date);
      const enrollmentCompleted = certificate?.status === 'released' || portalSettings.certificateReleased === true || /completed|concluido|concluído|certificado|certificate/i.test(String(enrollment.status || ''));
      const enrollmentMaterials = materialsFor(enrollment.course_slug, enrollment.class_date).map((m) => ({
        title: m.title,
        description: m.description || '',
        type: contentTypeLabelFor(m.content_type),
        url: m.external_url || m.file_path || '',
      }));
      // Check-in não é mais um botão que alguém precisa lembrar de apertar: o código vale
      // porque a matrícula está paga. Antes existia um "liberar check-in" no painel que
      // gravava checkInReleased, mas a listagem já mostrava "Liberado" pra toda matrícula
      // paga — clicar não mudava nada na tela, e foi assim que a Erica achou o problema em
      // 08/09/2026. A confirmação de presença de verdade é confirmStudentCheckIn, que
      // reconfere o pagamento no servidor antes de aceitar o código.
      const checkInConfirmed = portalSettings.checkInConfirmed === true;
      return {
        id: enrollment.id,
        courseSlug: enrollment.course_slug,
        courseName: enrollment.course_name || enrollment.course_slug || 'Curso a escola',
        classDate: enrollment.class_date || enrollment.option_label || 'Turma a confirmar',
        optionLabel: enrollment.option_label || '',
        status: enrollment.status || 'em acompanhamento',
        flow: enrollment.flow || '',
        amountExpected: enrollment.amount_expected || null,
        paid: isPaid,
        paymentStatus: payment.status || '',
        paidAt: payment.paid_at || null,
        canCheckIn: isPaid,
        // Derivado da matrícula (lib/checkin.mjs), nunca lido do metadata: o código antigo
        // guardado lá era os 8 primeiros caracteres do id da matrícula, ou seja, mostrava
        // pedaço do identificador interno na tela da aluna.
        checkInCode: checkInCodeFor(enrollment.id),
        checkInConfirmed,
        checkInConfirmedAt: portalSettings.checkInConfirmedAt || null,
        certificateStatus: certificate?.status === 'released' ? 'Disponível' : enrollmentCompleted ? 'Disponível após conferência' : 'Liberação após conclusão e presença',
        certificateUrl: certificate?.status === 'released' ? certificate.file_path : '',
        discountLabel: isPaid ? `${discountPercent}% de desconto progressivo no próximo curso elegível` : 'Desconto liberado após confirmação do pagamento',
        materials: enrollmentMaterials,
        completed: enrollmentCompleted,
        reviewed: reviewedEnrollmentIds.has(enrollment.id),
      };
    }),
    // Aviso de turma só chega pra quem é daquela turma (regra da Turma a escola). Materiais e
    // certificados já eram filtrados assim; os avisos não eram, e um recado da turma de sábado
    // aparecia também pra aluna da turma de terça do mesmo curso — corrigido em 07/09/2026.
    // Aviso pessoal (student_id preenchido) é sempre da aluna e passa direto.
    notifications: notifications
      .filter((n) => {
        if (n.student_id) return true;
        if (!n.class_date) return true;
        return enrollments.some((enrollment) => enrollment.course_slug === n.course_slug && enrollment.class_date === n.class_date);
      })
      .map((n) => ({
        id: n.id,
        title: n.title,
        message: n.message,
        courseSlug: n.course_slug || null,
        sentAt: n.sent_at,
      })),
    activity: trackingEvents.map((event) => ({
      id: event.id,
      name: event.event_name,
      createdAt: event.created_at,
    })),
  };
}

function contentTypeLabelFor(type = '') {
  return { video: 'Vídeo', pdf: 'PDF', link: 'Link', texto: 'Texto' }[type] || 'Material';
}

export async function getStudentPortalByIds({ studentId = '', enrollmentId = '' } = {}) {
  if (!studentId && !enrollmentId) {
    const error = new Error('student_identity_required');
    error.code = 'student_identity_required';
    throw error;
  }

  if (DATABASE_URL) {
    // A Minha Área precisa mostrar TODAS as matrículas da aluna (pagas e pendentes), não só a
    // matrícula ligada ao link/token de acesso que ela usou pra entrar — um link de acesso é
    // gerado por matrícula (buildStudentAccessUrl), mas a aluna pode ter várias. Filtrar
    // enrollments por e.id (a matrícula do token) em vez de e.student_id fazia sumir as outras
    // matrículas — inclusive as pagas — assim que ela entrava por um link de uma matrícula
    // específica (achado pela Erica testando com uma conta com mais de uma matrícula).
    let resolvedStudentId = studentId;
    if (!resolvedStudentId && enrollmentId) {
      const [enrollmentRow] = (await pgQuery('select student_id from enrollments where id = $1 limit 1', [enrollmentId])).rows;
      resolvedStudentId = enrollmentRow?.student_id;
    }
    if (!resolvedStudentId) return null;
    const enrollmentResult = await pgQuery(
      `select e.id, e.student_id, e.status, e.amount_expected, e.course_slug, e.course_name, e.class_date, e.option_label, e.flow, e.metadata, e.created_at
       from enrollments e
       where e.student_id = $1
       order by e.created_at desc
       limit 20`,
      [resolvedStudentId],
    );
    const enrollments = enrollmentResult.rows;
    const courseSlugs = [...new Set(enrollments.map((e) => e.course_slug).filter(Boolean))];
    const [studentResult, paymentsResult, trackingResult, materialsResult, certificatesResult, notificationsResult, badgeBenefitsResult, courseReviewsResult] = await Promise.all([
      pgQuery('select id, name, email, whatsapp, cpf_last4, metadata, created_at from students where id = $1 limit 1', [resolvedStudentId]),
      pgQuery('select id, enrollment_id, student_id, status, amount, method, provider, paid_at, created_at from payments where student_id = $1 order by created_at desc limit 30', [resolvedStudentId]),
      pgQuery('select id, event_name, student_id, enrollment_id, created_at from tracking_events where student_id = $1 order by created_at desc limit 20', [resolvedStudentId]),
      courseSlugs.length
        ? pgQuery('select course_slug, class_date, title, description, content_type, file_path, external_url, sort_order from course_content where status = $1 and course_slug = any($2::text[]) order by sort_order asc', ['published', courseSlugs])
        : Promise.resolve({ rows: [] }),
      pgQuery('select id, course_slug, class_date, title, file_path, status, released_at from student_certificates where student_id = $1', [resolvedStudentId]),
      courseSlugs.length
        ? pgQuery('select id, student_id, course_slug, class_date, title, message, channel, sent_at from student_notifications where status = $1 and (student_id = $2 or (student_id is null and course_slug = any($3::text[]))) order by sent_at desc limit 20', ['sent', resolvedStudentId, courseSlugs])
        : Promise.resolve({ rows: [] }),
      // .catch: badge_benefits é uma tabela nova (migration 0004) — se ainda não rodou no banco
      // dela, a Minha Área não pode quebrar por isso, só mostra os selos sem benefício definido.
      pgQuery('select badge_key, badge_label, benefit_type, benefit_detail, discount_percent from badge_benefits where status = $1', ['active']).catch(() => ({ rows: [] })),
      // .catch: course_reviews é uma tabela nova (migration 0006) — sem ela, só não sabemos
      // ainda quais matrículas já foram avaliadas (a aluna consegue avaliar de novo até rodar).
      pgQuery('select enrollment_id from course_reviews where student_id = $1', [resolvedStudentId]).catch(() => ({ rows: [] })),
    ]);
    if (!studentResult.rows[0]) return null;
    return toStudentPortal({ student: studentResult.rows[0], enrollments, payments: paymentsResult.rows, trackingEvents: trackingResult.rows, materials: materialsResult.rows, certificates: certificatesResult.rows, notifications: notificationsResult.rows, badgeBenefits: badgeBenefitsResult.rows, courseReviews: courseReviewsResult.rows });
  }

  const studentRows = studentId
    ? await supabaseRequest(`students?id=eq.${encodeURIComponent(studentId)}&select=id,name,email,whatsapp,cpf_last4,metadata,created_at&limit=1`)
    : [];
  const enrollmentRows = enrollmentId
    ? await supabaseRequest(`enrollments?id=eq.${encodeURIComponent(enrollmentId)}&select=id,student_id,status,amount_expected,course_slug,course_name,class_date,option_label,flow,metadata,created_at&limit=1`)
    : [];
  const student = studentRows[0] || (enrollmentRows[0]?.student_id ? (await supabaseRequest(`students?id=eq.${encodeURIComponent(enrollmentRows[0].student_id)}&select=id,name,email,whatsapp,cpf_last4,metadata,created_at&limit=1`))[0] : null);
  if (!student) return null;
  // Sempre busca todas as matrículas da aluna por student_id (nunca só a matrícula do
  // token/link usado pra entrar) — mesma correção do ramo Postgres acima, mesmo motivo.
  const enrollments = await supabaseRequest(`enrollments?student_id=eq.${encodeURIComponent(student.id)}&select=id,student_id,status,amount_expected,course_slug,course_name,class_date,option_label,flow,metadata,created_at&order=created_at.desc&limit=20`);
  const courseSlugs = [...new Set(enrollments.map((e) => e.course_slug).filter(Boolean))];
  const [payments, trackingEvents, materials, certificates, notifications, badgeBenefits, courseReviews] = await Promise.all([
    supabaseRequest(`payments?student_id=eq.${encodeURIComponent(student.id)}&select=id,enrollment_id,student_id,status,amount,method,provider,paid_at,created_at&order=created_at.desc&limit=30`),
    supabaseRequest(`tracking_events?student_id=eq.${encodeURIComponent(student.id)}&select=id,event_name,student_id,enrollment_id,created_at&order=created_at.desc&limit=20`),
    courseSlugs.length ? supabaseRequest(`course_content?status=eq.published&course_slug=in.(${courseSlugs.map(encodeURIComponent).join(',')})&select=course_slug,class_date,title,description,content_type,file_path,external_url,sort_order&order=sort_order.asc`) : [],
    supabaseRequest(`student_certificates?student_id=eq.${encodeURIComponent(student.id)}&select=id,course_slug,class_date,title,file_path,status,released_at`),
    (async () => {
      const own = await supabaseRequest(`student_notifications?status=eq.sent&student_id=eq.${encodeURIComponent(student.id)}&select=id,student_id,course_slug,class_date,title,message,channel,sent_at&order=sent_at.desc&limit=20`);
      const broadcast = courseSlugs.length
        ? await supabaseRequest(`student_notifications?status=eq.sent&student_id=is.null&course_slug=in.(${courseSlugs.map(encodeURIComponent).join(',')})&select=id,student_id,course_slug,class_date,title,message,channel,sent_at&order=sent_at.desc&limit=20`)
        : [];
      return [...(own || []), ...(broadcast || [])];
    })(),
    // .catch: badge_benefits é uma tabela nova (migration 0004) — se ainda não rodou no banco
    // dela, a Minha Área não pode quebrar por isso, só mostra os selos sem benefício definido.
    supabaseRequest('badge_benefits?status=eq.active&select=badge_key,badge_label,benefit_type,benefit_detail,discount_percent').catch(() => []),
    // .catch: course_reviews é uma tabela nova (migration 0006) — sem ela, só não sabemos
    // ainda quais matrículas já foram avaliadas (a aluna consegue avaliar de novo até rodar).
    supabaseRequest(`course_reviews?student_id=eq.${encodeURIComponent(student.id)}&select=enrollment_id`).catch(() => []),
  ]);
  return toStudentPortal({ student, enrollments, payments, trackingEvents, materials, certificates, notifications, badgeBenefits, courseReviews });
}

export async function getStudentPortalByIdentity({ email = '', cpfLast4 = '' } = {}) {
  const normalizedEmail = safeText(email, 180).toLowerCase();
  const normalizedCpfLast4 = cleanCpf(cpfLast4).slice(-4);
  if (!normalizedEmail || normalizedCpfLast4.length !== 4) {
    const error = new Error('student_login_fields_required');
    error.code = 'student_login_fields_required';
    throw error;
  }

  if (DATABASE_URL) {
    const studentResult = await pgQuery(
      'select id, name, email, whatsapp, cpf_last4, metadata, created_at from students where lower(email) = $1 and cpf_last4 = $2 order by created_at desc limit 1',
      [normalizedEmail, normalizedCpfLast4],
    );
    const student = studentResult.rows[0];
    if (!student) return null;
    return getStudentPortalByIds({ studentId: student.id });
  }

  const students = await supabaseRequest(`students?email=eq.${encodeURIComponent(normalizedEmail)}&cpf_last4=eq.${encodeURIComponent(normalizedCpfLast4)}&select=id,name,email,whatsapp,cpf_last4,metadata,created_at&order=created_at.desc&limit=1`);
  if (!students[0]) return null;
  return getStudentPortalByIds({ studentId: students[0].id });
}

// Acesso do aluno por código de uso único (OTP) — regra P0.2 do Manual do produto.
// E-mail + 4 últimos dígitos do CPF nunca concedem acesso direto: eles só disparam o
// envio do código pelo WhatsApp confirmado da matrícula. O código fica hasheado (nunca em
// texto puro) dentro de students.metadata.accessCode, com expiração e limite de tentativas.
const ACCESS_CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_CODE_MAX_ATTEMPTS = 5;

function accessCodePepper() {
  return process.env.STUDENT_ACCESS_SECRET || process.env.ADMIN_SESSION_SECRET || 'ebn-access-code-fallback-pepper';
}

function hashAccessCode(code, studentId) {
  return crypto.createHash('sha256').update(`${code}:${studentId}:${accessCodePepper()}`).digest('hex');
}

async function findAllStudentIdentityRows(normalizedEmail, normalizedCpfLast4, columns) {
  if (DATABASE_URL) {
    const result = await pgQuery(
      `select ${columns} from students where lower(email) = $1 and cpf_last4 = $2 order by created_at desc limit 20`,
      [normalizedEmail, normalizedCpfLast4],
    );
    return result.rows;
  }
  if (!isDbConfigured()) return [];
  const rows = await supabaseRequest(
    `students?email=eq.${encodeURIComponent(normalizedEmail)}&cpf_last4=eq.${encodeURIComponent(normalizedCpfLast4)}&select=${columns}&order=created_at.desc&limit=20`,
  );
  return rows || [];
}

// Bug real achado em 04/09/2026, no dia seguinte ao fix de "matrícula = pagamento": quando
// existe mais de uma linha em students pro mesmo email+CPF (cadastros duplicados de testes
// antigos, de antes do reaproveitamento de cadastro existente — P1.6), pegar só a linha mais
// recente podia trazer justo a que nunca teve pagamento e bloquear o código de acesso de quem
// pagou de verdade num cadastro mais antigo com o mesmo email+CPF. Por isso aqui é preciso
// escolher, entre os duplicados, o que tem matrícula paga — nunca só "o mais recente".
async function findStudentIdentityRow(normalizedEmail, normalizedCpfLast4, columns) {
  const resolvedColumns = columns.split(',').map((entry) => entry.trim()).includes('id') ? columns : `id, ${columns}`;
  const rows = await findAllStudentIdentityRows(normalizedEmail, normalizedCpfLast4, resolvedColumns);
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  for (const row of rows) {
    if (await studentHasPaidEnrollment(row.id)) return row;
  }
  return rows[0];
}

async function saveStudentMetadata(studentId, metadata) {
  if (DATABASE_URL) {
    await pgQuery('update students set metadata = $1::jsonb, updated_at = now() where id = $2', [JSON.stringify(metadata), studentId]);
    return;
  }
  await supabaseRequest(`students?id=eq.${encodeURIComponent(studentId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ metadata, updated_at: new Date().toISOString() }),
  });
}

export async function requestStudentAccessCode({ email = '', cpfLast4 = '' } = {}) {
  const normalizedEmail = safeText(email, 180).toLowerCase();
  const normalizedCpfLast4 = cleanCpf(cpfLast4).slice(-4);
  if (!normalizedEmail || normalizedCpfLast4.length !== 4) {
    const error = new Error('student_login_fields_required');
    error.code = 'student_login_fields_required';
    throw error;
  }

  const student = await findStudentIdentityRow(normalizedEmail, normalizedCpfLast4, 'id, whatsapp, metadata');
  if (!student) return { matched: false, sent: false };
  if (!(await studentHasPaidEnrollment(student.id))) return { matched: false, sent: false };

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const accessCode = {
    codeHash: hashAccessCode(code, student.id),
    expiresAt: Date.now() + ACCESS_CODE_TTL_MS,
    attempts: 0,
    createdAt: Date.now(),
  };
  await saveStudentMetadata(student.id, { ...(student.metadata || {}), accessCode });

  return { matched: true, sent: true, studentId: student.id, whatsapp: student.whatsapp, code };
}

export async function verifyStudentAccessCode({ email = '', cpfLast4 = '', code = '' } = {}) {
  const normalizedEmail = safeText(email, 180).toLowerCase();
  const normalizedCpfLast4 = cleanCpf(cpfLast4).slice(-4);
  const suppliedCode = String(code || '').trim();
  if (!normalizedEmail || normalizedCpfLast4.length !== 4 || !/^\d{6}$/.test(suppliedCode)) {
    const error = new Error('student_login_fields_required');
    error.code = 'student_login_fields_required';
    throw error;
  }

  const invalidError = () => {
    const error = new Error('invalid_access_code');
    error.code = 'invalid_access_code';
    return error;
  };

  const student = await findStudentIdentityRow(normalizedEmail, normalizedCpfLast4, 'id, metadata');
  if (!student) throw invalidError();

  const accessCode = student.metadata?.accessCode;
  if (!accessCode) throw invalidError();
  if (Date.now() > Number(accessCode.expiresAt || 0)) {
    const error = new Error('expired_access_code');
    error.code = 'expired_access_code';
    throw error;
  }
  if (Number(accessCode.attempts || 0) >= ACCESS_CODE_MAX_ATTEMPTS) {
    const error = new Error('too_many_attempts');
    error.code = 'too_many_attempts';
    throw error;
  }

  if (hashAccessCode(suppliedCode, student.id) !== accessCode.codeHash) {
    await saveStudentMetadata(student.id, { ...student.metadata, accessCode: { ...accessCode, attempts: Number(accessCode.attempts || 0) + 1 } });
    throw invalidError();
  }

  const metadata = { ...student.metadata };
  delete metadata.accessCode;
  await saveStudentMetadata(student.id, metadata);

  return { studentId: student.id };
}

function validEmail(value = '') {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || '').trim());
}

function cleanAvatarKey(value = '') {
  return String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
}

function cleanBadgeKey(value = '') {
  return String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
}

function nextBadgeMissionState(current = {}, action = 'request', audit = {}, note = '') {
  const now = audit.receivedAt || new Date().toISOString();
  const history = Array.isArray(current.history) ? current.history.slice(-8) : [];
  const base = { ...current, updatedAt: now };
  if (action === 'approve') {
    return { ...base, status: 'approved', approvedAt: now, adminNote: safeText(note, 500) || current.adminNote || '', history: [...history, { action, at: now, note: safeText(note, 500) }] };
  }
  if (action === 'reject') {
    return { ...base, status: 'rejected', rejectedAt: now, adminNote: safeText(note, 500) || '', history: [...history, { action, at: now, note: safeText(note, 500) }] };
  }
  if (current.status === 'approved') {
    return { ...base, status: 'approved', history };
  }
  return { ...base, status: 'pending', requestedAt: current.requestedAt || now, history: [...history, { action: 'request', at: now }] };
}

export async function updateStudentProfile(payload = {}, audit = {}) {
  const studentId = safeText(payload.studentId || payload.student_id, 120);
  const identityEmail = safeText(payload.email || payload.identityEmail, 180).toLowerCase();
  const cpfLast4 = cleanCpf(payload.cpfLast4 || payload.cpf || '').slice(-4);
  const profile = payload.profile || {};
  const name = safeText(profile.name, 180);
  const nextEmail = safeText(profile.email, 180).toLowerCase();
  const whatsapp = cleanPhone(profile.whatsapp || profile.phone || '');
  const avatarKey = cleanAvatarKey(profile.avatarKey || profile.avatar_key);

  if (!studentId && (!identityEmail || cpfLast4.length !== 4)) {
    const error = new Error('student_login_fields_required');
    error.code = 'student_login_fields_required';
    throw error;
  }
  if (nextEmail && !validEmail(nextEmail)) {
    const error = new Error('invalid_student_email');
    error.code = 'invalid_student_email';
    throw error;
  }

  let resolvedStudentId = studentId;
  if (!resolvedStudentId) {
    const portal = await getStudentPortalByIdentity({ email: identityEmail, cpfLast4 });
    resolvedStudentId = portal?.student?.id || '';
  }
  if (!resolvedStudentId) {
    const error = new Error('student_access_not_found');
    error.code = 'student_access_not_found';
    throw error;
  }

  const studentProfile = {
    ...(avatarKey ? { avatarKey } : {}),
    updatedAt: audit.receivedAt || new Date().toISOString(),
  };
  const fields = {
    ...(name ? { name } : {}),
    ...(nextEmail ? { email: nextEmail } : {}),
    ...(whatsapp ? { whatsapp } : {}),
  };

  if (DATABASE_URL) {
    const setParts = [];
    const values = [];
    Object.entries(fields).forEach(([column, value]) => {
      values.push(value);
      setParts.push(`${assertSafeIdentifier(column)} = $${values.length}`);
    });
    values.push(JSON.stringify(studentProfile));
    setParts.push(`metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{studentProfile}', coalesce(metadata->'studentProfile', '{}'::jsonb) || $${values.length}::jsonb, true)`);
    values.push(resolvedStudentId);
    const result = await pgQuery(
      `update students
       set ${setParts.join(', ')}, updated_at = now()
       where id = $${values.length}
       returning id, name, email, whatsapp, cpf_last4, metadata, created_at`,
      values,
    );
    if (!result.rows[0]) {
      const error = new Error('student_access_not_found');
      error.code = 'student_access_not_found';
      throw error;
    }
    await pgQuery(
      `insert into tracking_events (event_name, student_id, payload)
       values ($1, $2, $3::jsonb)`,
      ['student_profile_updated', resolvedStudentId, JSON.stringify({ changedFields: Object.keys(fields), avatarUpdated: Boolean(avatarKey), audit })],
    );
    return getStudentPortalByIds({ studentId: resolvedStudentId });
  }

  const [current] = await supabaseRequest(`students?id=eq.${encodeURIComponent(resolvedStudentId)}&select=id,metadata&limit=1`);
  if (!current) {
    const error = new Error('student_access_not_found');
    error.code = 'student_access_not_found';
    throw error;
  }
  await supabaseRequest(`students?id=eq.${encodeURIComponent(resolvedStudentId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      ...fields,
      metadata: {
        ...(current.metadata || {}),
        studentProfile: { ...(current.metadata?.studentProfile || {}), ...studentProfile },
      },
      updated_at: new Date().toISOString(),
    }),
  });
  await supabaseRequest('tracking_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      event_name: 'student_profile_updated',
      student_id: resolvedStudentId,
      payload: { changedFields: Object.keys(fields), avatarUpdated: Boolean(avatarKey), audit },
    }),
  });
  return getStudentPortalByIds({ studentId: resolvedStudentId });
}

// Avaliação de curso dentro da Minha Área (pedido da Erica, 04/09/2026): "cada tarefa cumprida
// ganha um selo" — a tarefa aqui é avaliar um curso concluído. Confere no servidor que a
// matrícula é da própria aluna e que ela realmente concluiu o curso (certificado liberado ou
// status de conclusão) antes de aceitar a avaliação — nunca confia nisso vindo do cliente.
// Uma avaliação por matrícula (índice único em course_reviews.enrollment_id barra duplicidade).
export async function createCourseReview(payload = {}, audit = {}) {
  const studentId = safeText(payload.studentId || payload.student_id, 120);
  const enrollmentId = safeText(payload.enrollmentId || payload.enrollment_id, 120);
  const rating = Number(payload.rating);
  const text = safeText(payload.text, 1200);
  if (!studentId || !enrollmentId || !Number.isInteger(rating) || rating < 1 || rating > 5 || text.length < 10) {
    const error = new Error('invalid_course_review');
    error.code = 'invalid_course_review';
    throw error;
  }

  if (DATABASE_URL) {
    const enrollmentResult = await pgQuery(
      `select e.id, e.course_slug, e.course_name, e.class_date, e.status, sc.status as certificate_status
       from enrollments e
       left join student_certificates sc on sc.student_id = e.student_id and sc.course_slug = e.course_slug
       where e.id = $1 and e.student_id = $2
       limit 1`,
      [enrollmentId, studentId],
    );
    const enrollment = enrollmentResult.rows[0];
    if (!enrollment) {
      const error = new Error('enrollment_not_found');
      error.code = 'enrollment_not_found';
      throw error;
    }
    // Pedido da Erica, 07/09/2026: antes só dava pra avaliar depois que a equipe liberava o
    // certificado, então o selo de avaliação nunca ativava sozinho — a aluna terminava o curso
    // e ficava sem nada pra fazer. Agora a turma ter acabado (data de fim já passada) também
    // libera a avaliação: quem fez o curso pode contar como foi, sem esperar a conferência.
    const completed = enrollment.certificate_status === 'released'
      || /completed|concluido|concluído|certificado|certificate/i.test(String(enrollment.status || ''))
      || isClassFinished(enrollment.class_date);
    if (!completed) {
      const error = new Error('course_not_completed');
      error.code = 'course_not_completed';
      throw error;
    }
    const inserted = await pgQuery(
      `insert into course_reviews (student_id, enrollment_id, course_slug, course_name, rating, text)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (enrollment_id) do nothing
       returning id`,
      [studentId, enrollmentId, enrollment.course_slug, enrollment.course_name, rating, text],
    );
    if (!inserted.rows[0]) {
      const error = new Error('review_already_submitted');
      error.code = 'review_already_submitted';
      throw error;
    }
    await applyAutomaticStudentBadge(studentId, 'course_review', audit, 'course_reviewed').catch(() => null);
    return getStudentPortalByIds({ studentId });
  }

  const [enrollment] = await supabaseRequest(`enrollments?id=eq.${encodeURIComponent(enrollmentId)}&student_id=eq.${encodeURIComponent(studentId)}&select=id,course_slug,course_name,class_date,status&limit=1`);
  if (!enrollment) {
    const error = new Error('enrollment_not_found');
    error.code = 'enrollment_not_found';
    throw error;
  }
  const [certificate] = await supabaseRequest(`student_certificates?student_id=eq.${encodeURIComponent(studentId)}&course_slug=eq.${encodeURIComponent(enrollment.course_slug)}&select=status&limit=1`);
  // Mesma regra do ramo Postgres acima: turma encerrada pela data também libera a avaliação.
  const completed = certificate?.status === 'released'
    || /completed|concluido|concluído|certificado|certificate/i.test(String(enrollment.status || ''))
    || isClassFinished(enrollment.class_date);
  if (!completed) {
    const error = new Error('course_not_completed');
    error.code = 'course_not_completed';
    throw error;
  }
  const existing = await supabaseRequest(`course_reviews?enrollment_id=eq.${encodeURIComponent(enrollmentId)}&select=id&limit=1`);
  if (existing?.[0]) {
    const error = new Error('review_already_submitted');
    error.code = 'review_already_submitted';
    throw error;
  }
  await supabaseRequest('course_reviews', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ student_id: studentId, enrollment_id: enrollmentId, course_slug: enrollment.course_slug, course_name: enrollment.course_name, rating, text }),
  });
  await applyAutomaticStudentBadge(studentId, 'course_review', audit, 'course_reviewed').catch(() => null);
  return getStudentPortalByIds({ studentId });
}

export async function updateStudentBadgeMission(payload = {}, audit = {}) {
  const studentId = safeText(payload.studentId || payload.student_id, 120);
  const identityEmail = safeText(payload.email || payload.identityEmail, 180).toLowerCase();
  const cpfLast4 = cleanCpf(payload.cpfLast4 || payload.cpf || '').slice(-4);
  const missionKey = cleanBadgeKey(payload.missionKey || payload.mission_key);
  const action = safeText(payload.action, 40) || 'request';
  const note = safeText(payload.note, 500);

  if (!['request', 'approve', 'reject'].includes(action)) {
    const error = new Error('invalid_badge_action');
    error.code = 'invalid_badge_action';
    throw error;
  }
  if (!missionKey) {
    const error = new Error('badge_mission_required');
    error.code = 'badge_mission_required';
    throw error;
  }
  if (!studentId && (!identityEmail || cpfLast4.length !== 4)) {
    const error = new Error('student_login_fields_required');
    error.code = 'student_login_fields_required';
    throw error;
  }

  let resolvedStudentId = studentId;
  if (!resolvedStudentId) {
    const portal = await getStudentPortalByIdentity({ email: identityEmail, cpfLast4 });
    resolvedStudentId = portal?.student?.id || '';
  }
  if (!resolvedStudentId) {
    const error = new Error('student_access_not_found');
    error.code = 'student_access_not_found';
    throw error;
  }

  const buildMetadata = (metadata = {}) => {
    const studentBadges = metadata.studentBadges || {};
    const missions = studentBadges.missions || {};
    return {
      ...metadata,
      studentBadges: {
        ...studentBadges,
        missions: {
          ...missions,
          [missionKey]: nextBadgeMissionState(missions[missionKey] || {}, action, audit, note),
        },
      },
    };
  };

  if (DATABASE_URL) {
    const current = await pgQuery('select id, metadata from students where id = $1 limit 1', [resolvedStudentId]);
    if (!current.rows[0]) {
      const error = new Error('student_access_not_found');
      error.code = 'student_access_not_found';
      throw error;
    }
    const metadata = buildMetadata(current.rows[0].metadata || {});
    await pgQuery(
      `update students
       set metadata = $1::jsonb, updated_at = now()
       where id = $2`,
      [JSON.stringify(metadata), resolvedStudentId],
    );
    await pgQuery(
      `insert into tracking_events (event_name, student_id, payload)
       values ($1, $2, $3::jsonb)`,
      [`student_badge_${action}`, resolvedStudentId, JSON.stringify({ missionKey, action, note, audit })],
    );
    return getStudentPortalByIds({ studentId: resolvedStudentId });
  }

  const [current] = await supabaseRequest(`students?id=eq.${encodeURIComponent(resolvedStudentId)}&select=id,metadata&limit=1`);
  if (!current) {
    const error = new Error('student_access_not_found');
    error.code = 'student_access_not_found';
    throw error;
  }
  await supabaseRequest(`students?id=eq.${encodeURIComponent(resolvedStudentId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      metadata: buildMetadata(current.metadata || {}),
      updated_at: new Date().toISOString(),
    }),
  });
  await supabaseRequest('tracking_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      event_name: `student_badge_${action}`,
      student_id: resolvedStudentId,
      payload: { missionKey, action, note, audit },
    }),
  });
  return getStudentPortalByIds({ studentId: resolvedStudentId });
}

export async function persistAcceptanceIntent(payload, audit = {}, documentos = {}) {
  const enrollmentExternalId = safeId('enrollment');
  const acceptanceExternalId = safeId('acceptance');

  const student = await findOrCreateStudent({
    name: payload.name,
    email: payload.email,
    whatsapp: payload.whatsapp,
    cpf: payload.cpf,
    source: payload.attribution?.utm_source || payload.attribution?.first_referrer || 'site',
    whatsappOptIn: payload.whatsappOptIn,
  });

  const [enrollment] = await supabaseRequest('enrollments', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      external_id: enrollmentExternalId,
      student_id: student.id,
      course_slug: payload.courseSlug,
      course_name: payload.courseName,
      class_date: payload.classDate,
      flow: 'voomp',
      status: 'acceptance_validated',
      source: payload.attribution?.utm_source || null,
      campaign: payload.attribution?.utm_campaign || null,
      amount_expected: payload.cart?.priceNumber || null,
      metadata: { audit, whatsappOptIn: payload.whatsappOptIn !== false },
    }),
  });

  const [acceptance] = await supabaseRequest('acceptances', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      external_id: acceptanceExternalId,
      enrollment_id: enrollment.id,
      student_id: student.id,
      course_slug: payload.courseSlug,
      class_date: payload.classDate,
      terms_version: audit.termsVersion || 'cabeleireiro-v1-2026-06-23',
      terms_read: payload.termsRead,
      payment_aware: payload.paymentAware,
      enrollment_aware: payload.enrollmentAware,
      wants_contact_before_payment: payload.wantsContactBeforePayment,
      ip: audit.ip,
      user_agent: audit.userAgent,
      attribution: payload.attribution || {},
      // O contrato assinado fica só aqui, ao lado do aceite — não dentro do `audit`, que é
      // copiado pra matrícula e pro evento de tracking.
      metadata: { cart: payload.cart || {}, audit, contractText: documentos.contractText || '' },
    }),
  });

  await supabaseRequest('tracking_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      event_name: 'acceptance_validated',
      student_id: student.id,
      enrollment_id: enrollment.id,
      session_id: payload.attribution?.session_id || null,
      url: payload.attribution?.last_landing_page || null,
      referrer: payload.attribution?.last_referrer || null,
      utm_source: payload.attribution?.utm_source || null,
      utm_medium: payload.attribution?.utm_medium || null,
      utm_campaign: payload.attribution?.utm_campaign || null,
      // Só a referência do aceite: guardar o objeto inteiro repetiria o contrato assinado
      // dentro do evento de tracking.
      payload: { acceptanceId: acceptance.id, acceptanceExternalId, audit },
    }),
  });

  await persistAutomaticCrmOpportunity({
    payload,
    student,
    enrollment,
    source: 'voomp_acceptance',
    status: 'acceptance_validated',
    audit,
  });

  return { studentId: student.id, enrollmentId: enrollment.id, acceptanceId: acceptance.id };
}

async function findOrCreateVoompEnrollment(payload = {}, audit = {}) {
  const email = safeText(payload.email || payload.studentEmail, 180).toLowerCase();
  const whatsapp = cleanPhone(payload.whatsapp || payload.studentWhatsapp || payload.phone || '');
  const courseSlug = safeText(payload.courseSlug || payload.course_slug, 120) || 'cabeleireiro-profissional';
  const courseName = safeText(payload.courseName || payload.course_name, 180) || 'Cabeleireiro Profissional';
  const classDate = safeText(payload.classDate || payload.class_date, 180) || 'Turma Cabeleireiro 2027';
  const sessionId = safeText(payload.attribution?.session_id || payload.session_id, 160);

  if (!DATABASE_URL) {
    // Venda da Voomp no modo Supabase REST (corrigido em 11/09/2026).
    //
    // Este ramo só PROCURAVA. Quem comprava direto na Voomp, sem passar pela agenda, não tinha
    // cadastro aqui — então a busca voltava vazia, markVoompPaymentReturn desistia com
    // `voomp_enrollment_not_found` e a venda simplesmente não existia no painel. O ramo com
    // Postgres sempre criou aluna e matrícula nesse caso; este ficou pra trás.
    const filtros = [];
    if (email) filtros.push(`email.eq.${encodeURIComponent(email)}`);
    if (whatsapp) filtros.push(`whatsapp.eq.${encodeURIComponent(whatsapp)}`);
    // Sem nenhum identificador, o filtro `or=(email.eq.,whatsapp.eq.)` casava com cadastros de
    // e-mail vazio e podia grudar a venda na aluna errada.
    let student = filtros.length
      ? (await supabaseRequest(`students?or=(${filtros.join(',')})&select=id,name,email,whatsapp,cpf_last4,metadata,created_at&order=created_at.desc&limit=1`).catch(() => []))[0] || null
      : null;

    if (student) {
      const matriculas = await supabaseRequest(`enrollments?student_id=eq.${encodeURIComponent(student.id)}&course_slug=eq.${encodeURIComponent(courseSlug)}&select=id,student_id,status,amount_expected,course_slug,course_name,class_date,option_label,flow,metadata,created_at&order=created_at.desc&limit=20`).catch(() => []);
      // Mesma preferência do SQL: a matrícula da turma que a Voomp informou vem primeiro.
      const enrollment = matriculas.find((linha) => linha.class_date === classDate) || matriculas[0] || null;
      if (enrollment) return { student, enrollment };
    }

    if (!student) {
      student = (await supabaseRequest('students', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          external_id: safeId('student'),
          name: safeText(payload.name || payload.studentName, 180) || 'Aluna a escola',
          email: email || `voomp-${safeId('email')}@ebn.local`,
          whatsapp: whatsapp || null,
          cpf_last4: cleanCpf(payload.cpf || payload.studentCpf).slice(-4) || null,
          created_source: 'voomp',
          metadata: { rawVoomp: payload, audit },
        }),
      }).catch(() => []))[0] || null;
    }
    if (!student) return { student: null, enrollment: null };

    const enrollment = (await supabaseRequest('enrollments', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        external_id: safeId('enrollment'),
        student_id: student.id,
        course_slug: courseSlug,
        course_name: courseName,
        class_date: classDate,
        option_label: classDate,
        flow: 'voomp',
        status: 'voomp_sale_received',
        source: 'voomp',
        campaign: payload.attribution?.utm_campaign || null,
        amount_expected: moneyNumber(payload.amount),
        metadata: { createdFromVoompReturn: true, audit },
      }),
    }).catch(() => []))[0] || null;
    if (!enrollment) return { student: null, enrollment: null };

    await persistAutomaticCrmOpportunity({ payload, student, enrollment, source: 'voomp_return', status: 'voomp_sale_received', audit }).catch(() => null);
    return { student, enrollment };
  }

  const match = await pgQuery(
    `select e.id as enrollment_id,
            e.student_id,
            e.course_slug,
            e.course_name,
            e.class_date,
            e.option_label,
            e.flow,
            e.status,
            e.amount_expected,
            e.metadata as enrollment_metadata,
            s.id as student_id,
            s.name,
            s.email,
            s.whatsapp,
            s.cpf_last4,
            s.metadata as student_metadata
       from enrollments e
       join students s on s.id = e.student_id
       left join acceptances a on a.enrollment_id = e.id
      where e.course_slug = $1
        and (
          ($2 <> '' and lower(s.email) = $2)
          or ($3 <> '' and regexp_replace(coalesce(s.whatsapp, ''), '\\D', '', 'g') = $3)
          or ($4 <> '' and a.attribution->>'session_id' = $4)
        )
      order by
        case when e.class_date = $5 then 0 else 1 end,
        e.created_at desc
      limit 1`,
    [courseSlug, email, whatsapp, sessionId, classDate],
  );
  const row = match.rows[0];
  if (row) {
    return {
      student: { id: row.student_id, name: row.name, email: row.email, whatsapp: row.whatsapp, cpf_last4: row.cpf_last4, metadata: row.student_metadata || {} },
      enrollment: { id: row.enrollment_id, student_id: row.student_id, course_slug: row.course_slug, course_name: row.course_name, class_date: row.class_date, option_label: row.option_label, flow: row.flow, status: row.status, amount_expected: row.amount_expected, metadata: row.enrollment_metadata || {} },
    };
  }

  const [student] = (await pgQuery(
    `insert into students (external_id, name, email, whatsapp, cpf_last4, created_source, metadata)
     values ($1, $2, $3, $4, $5, 'voomp', $6::jsonb)
     on conflict (external_id) do update set updated_at = now()
     returning id, name, email, whatsapp, cpf_last4, metadata`,
    [safeId('student'), safeText(payload.name || payload.studentName, 180) || 'Aluna a escola', email || `voomp-${safeId('email')}@ebn.local`, whatsapp || null, cleanCpf(payload.cpf || payload.studentCpf).slice(-4) || null, JSON.stringify({ rawVoomp: payload, audit })],
  )).rows;

  const [enrollment] = (await pgQuery(
    `insert into enrollments (external_id, student_id, course_slug, course_name, class_date, option_label, flow, status, source, campaign, amount_expected, metadata)
     values ($1, $2, $3, $4, $5, $6, 'voomp', 'voomp_sale_received', 'voomp', $7, $8, $9::jsonb)
     returning id, student_id, course_slug, course_name, class_date, option_label, flow, status, amount_expected, metadata`,
    [safeId('enrollment'), student.id, courseSlug, courseName, classDate, classDate, payload.attribution?.utm_campaign || null, moneyNumber(payload.amount), JSON.stringify({ createdFromVoompReturn: true, audit })],
  )).rows;

  await persistAutomaticCrmOpportunity({ payload, student, enrollment, source: 'voomp_return', status: 'voomp_sale_received', audit });
  return { student, enrollment };
}

export async function markVoompPaymentReturn(payload = {}, audit = {}) {
  const status = safeText(payload.voompStatus || payload.checkoutStatus || payload.status, 120) || 'voomp_sale_received';
  const isPaid = paidStatus(status) || payload.event === 'voomp_payment_confirmed';
  // Regra §16.4 do Manual do produto: estorno/cancelamento na Voomp também libera a vaga na hora.
  // A Voomp não documenta um formato fixo de evento de estorno pra nós, então detectamos pelo
  // texto do status (mesmo padrão já usado pra identificar pagamento confirmado acima).
  const isCancelled = cancelledPaymentStatus(status);
  const providerPaymentId = safeText(payload.voompSaleId || payload.paymentId || payload.checkoutId, 180);
  const hasStudentIdentity = Boolean(
    safeText(payload.email || payload.studentEmail, 180)
    || cleanPhone(payload.whatsapp || payload.studentWhatsapp || payload.phone || '')
    || safeText(payload.name || payload.studentName, 180),
  );

  if (!providerPaymentId && isPaid) {
    const error = new Error('voomp_payment_identifier_required');
    error.code = 'voomp_payment_identifier_required';
    throw error;
  }
  if (!hasStudentIdentity && !isPaid) {
    return { updated: false, reason: 'voomp_student_identity_required_for_enrollment' };
  }

  const { student, enrollment } = await findOrCreateVoompEnrollment(payload, audit);
  if (!student || !enrollment) return { updated: false, reason: 'voomp_enrollment_not_found' };

  const nextEnrollmentStatus = isPaid ? 'payment_received' : 'voomp_sale_received';
  let accessUrl = null;
  try {
    accessUrl = buildStudentAccessUrl({ studentId: student.id, enrollmentId: enrollment.id });
  } catch {
    accessUrl = null;
  }

  if (!DATABASE_URL) {
    // Confirmação de pagamento da Voomp no modo Supabase REST (corrigido em 11/09/2026).
    //
    // Este caminho não existia: levantava `voomp_payment_requires_postgres`, o webhook devolvia
    // 500 pra Voomp e NENHUMA venda da Voomp era registrada em produção — nem as que passaram
    // pela agenda. Sem registro, também não saía WhatsApp de acesso nem evento de Compra pra
    // Meta. O Asaas já tinha o equivalente em REST desde a auditoria de 04/09; o Voomp ficou.
    //
    // A vaga continua sendo ocupada por reserveClassSeat, que em REST faz compare-and-swap em
    // sold_count — então a regra P0.5 (nunca vender vaga a mais) continua valendo nos dois modos.
    const [pagamentoExistente] = providerPaymentId
      ? await supabaseRequest(`payments?provider=eq.voomp&provider_payment_id=eq.${encodeURIComponent(providerPaymentId)}&select=id,status,metadata&order=created_at.desc&limit=1`).catch(() => [])
      : [];
    const jaEstavaPago = paidStatus(pagamentoExistente?.status);
    const statusPagamento = isPaid ? 'received' : status;
    const valor = moneyNumber(payload.amount) || moneyNumber(enrollment.amount_expected) || null;
    const metodo = safeText(payload.paymentMethod, 80);
    const agoraIso = new Date().toISOString();
    const metadadosPagamento = { voomp: payload, audit, studentAccessUrl: accessUrl };

    if (pagamentoExistente) {
      await supabaseRequest(`payments?id=eq.${encodeURIComponent(pagamentoExistente.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          enrollment_id: enrollment.id,
          student_id: student.id,
          status: statusPagamento,
          ...(metodo ? { method: metodo } : {}),
          ...(valor ? { amount: valor } : {}),
          // paid_at só é carimbado na primeira confirmação, como o `coalesce(paid_at, now())` do SQL.
          ...(isPaid && !jaEstavaPago ? { paid_at: agoraIso } : {}),
          metadata: { ...(pagamentoExistente.metadata || {}), ...metadadosPagamento },
          updated_at: agoraIso,
        }),
      });
    } else {
      await supabaseRequest('payments', {
        method: 'POST',
        body: JSON.stringify({
          external_id: safeId('payment'),
          enrollment_id: enrollment.id,
          student_id: student.id,
          provider: 'voomp',
          provider_payment_id: providerPaymentId || safeId('voomp'),
          method: metodo || null,
          status: statusPagamento,
          amount: valor,
          paid_at: isPaid ? agoraIso : null,
          metadata: metadadosPagamento,
        }),
      });
    }

    let seatReservation = null;
    let finalEnrollmentStatus = nextEnrollmentStatus;
    if (isPaid && !jaEstavaPago) {
      seatReservation = await reserveClassSeat(enrollment.course_slug, enrollment.class_date);
      if (!seatReservation.reserved) finalEnrollmentStatus = 'paid_capacity_exceeded';
    }
    const virouCancelado = isCancelled && jaEstavaPago;
    if (virouCancelado) {
      seatReservation = await releaseClassSeat(enrollment.course_slug, enrollment.class_date);
      finalEnrollmentStatus = 'cancelled_refunded';
    }

    await supabaseRequest(`enrollments?id=eq.${encodeURIComponent(enrollment.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: finalEnrollmentStatus,
        metadata: {
          ...(enrollment.metadata || {}),
          lastVoompReturn: payload,
          studentAccessUrl: accessUrl,
          paidAt: isPaid ? audit.receivedAt || agoraIso : null,
          seatReservation,
        },
        updated_at: agoraIso,
      }),
    });

    if (isPaid && !jaEstavaPago) {
      await applyAutomaticStudentBadge(student.id, 'new_course', audit, 'voomp_paid_enrollment').catch(() => null);
      if (!seatReservation?.reserved) {
        await supabaseRequest('tracking_events', {
          method: 'POST',
          body: JSON.stringify({ event_name: 'capacity_exceeded_alert', student_id: student.id, enrollment_id: enrollment.id, session_id: payload.attribution?.session_id || null, payload: { provider: 'voomp', courseSlug: enrollment.course_slug, classDate: enrollment.class_date, seatReservation, audit } }),
        }).catch(() => null);
      }
    }

    if (virouCancelado) {
      await supabaseRequest('tracking_events', {
        method: 'POST',
        body: JSON.stringify({ event_name: 'enrollment_cancelled_refund', student_id: student.id, enrollment_id: enrollment.id, session_id: payload.attribution?.session_id || null, payload: { provider: 'voomp', status, seatReservation, audit } }),
      }).catch(() => null);
    }

    await persistAutomaticCrmOpportunity({ payload, student, enrollment, source: 'voomp_return', status: finalEnrollmentStatus, audit }).catch(() => null);
    await supabaseRequest('tracking_events', {
      method: 'POST',
      body: JSON.stringify({ event_name: virouCancelado || !isPaid ? 'voomp_sale_followup_registered' : 'voomp_enrollment_confirmed', student_id: student.id, enrollment_id: enrollment.id, session_id: payload.attribution?.session_id || null, payload: { payload, audit, studentAccessUrl: accessUrl, seatReservation } }),
    }).catch(() => null);

    return { updated: true, mode: 'supabase', studentId: student.id, enrollmentId: enrollment.id, studentAccessUrl: accessUrl, paid: isPaid, seatReservation };
  }

  const existingPayment = providerPaymentId
    ? await pgQuery(
        `select id, status from payments where provider = 'voomp' and provider_payment_id = $1 order by created_at desc limit 1`,
        [providerPaymentId],
      )
    : { rows: [] };
  const wasAlreadyPaid = paidStatus(existingPayment.rows[0]?.status);
  const paymentStatus = isPaid ? 'received' : status;
  const amount = moneyNumber(payload.amount) || moneyNumber(enrollment.amount_expected) || null;

  if (existingPayment.rows[0]) {
    await pgQuery(
      `update payments
       set enrollment_id = $1,
           student_id = $2,
           method = coalesce($3, method),
           status = $4,
           amount = coalesce($5, amount),
           paid_at = case when $6 then coalesce(paid_at, now()) else paid_at end,
           metadata = coalesce(metadata, '{}'::jsonb) || $7::jsonb,
           updated_at = now()
       where id = $8`,
      [enrollment.id, student.id, safeText(payload.paymentMethod, 80) || null, paymentStatus, amount, isPaid, JSON.stringify({ voomp: payload, audit, studentAccessUrl: accessUrl }), existingPayment.rows[0].id],
    );
  } else {
    await pgQuery(
      `insert into payments (external_id, enrollment_id, student_id, provider, provider_payment_id, method, status, amount, paid_at, metadata)
       values ($1, $2, $3, 'voomp', $4, $5, $6, $7, case when $8 then now() else null end, $9::jsonb)`,
      [safeId('payment'), enrollment.id, student.id, providerPaymentId || safeId('voomp'), safeText(payload.paymentMethod, 80) || null, paymentStatus, amount, isPaid, JSON.stringify({ voomp: payload, audit, studentAccessUrl: accessUrl })],
    );
  }

  // Vaga só é ocupada na transição para pago, de forma atômica (regra P0.5 do Manual do produto).
  let seatReservation = null;
  let finalEnrollmentStatus = nextEnrollmentStatus;
  if (isPaid && !wasAlreadyPaid) {
    seatReservation = await reserveClassSeat(enrollment.course_slug, enrollment.class_date);
    if (!seatReservation.reserved) finalEnrollmentStatus = 'paid_capacity_exceeded';
  }
  // Vaga só é liberada na transição de pago para estornado/cancelado (regra §16.4 do Manual do produto).
  const becameCancelled = isCancelled && wasAlreadyPaid;
  if (becameCancelled) {
    seatReservation = await releaseClassSeat(enrollment.course_slug, enrollment.class_date);
    finalEnrollmentStatus = 'cancelled_refunded';
  }

  await pgQuery(
    `update enrollments
     set status = $1,
         metadata = coalesce(metadata, '{}'::jsonb) || $2::jsonb,
         updated_at = now()
     where id = $3`,
    [finalEnrollmentStatus, JSON.stringify({ lastVoompReturn: payload, studentAccessUrl: accessUrl, paidAt: isPaid ? audit.receivedAt || new Date().toISOString() : null, seatReservation }), enrollment.id],
  );

  if (isPaid && !wasAlreadyPaid) {
    await applyAutomaticStudentBadge(student.id, 'new_course', audit, 'voomp_paid_enrollment').catch(() => null);
    if (!seatReservation?.reserved) {
      await pgQuery(
        `insert into tracking_events (event_name, student_id, enrollment_id, session_id, payload)
         values ($1, $2, $3, $4, $5::jsonb)`,
        ['capacity_exceeded_alert', student.id, enrollment.id, payload.attribution?.session_id || null, JSON.stringify({ provider: 'voomp', courseSlug: enrollment.course_slug, classDate: enrollment.class_date, seatReservation, audit })],
      );
    }
  }

  if (becameCancelled) {
    await pgQuery(
      `insert into tracking_events (event_name, student_id, enrollment_id, session_id, payload)
       values ($1, $2, $3, $4, $5::jsonb)`,
      ['enrollment_cancelled_refund', student.id, enrollment.id, payload.attribution?.session_id || null, JSON.stringify({ provider: 'voomp', status, seatReservation, audit })],
    );
  }

  await persistAutomaticCrmOpportunity({ payload, student, enrollment, source: 'voomp_return', status: finalEnrollmentStatus, audit });
  await pgQuery(
    `insert into tracking_events (event_name, student_id, enrollment_id, session_id, payload)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [becameCancelled ? 'voomp_sale_followup_registered' : isPaid ? 'voomp_enrollment_confirmed' : 'voomp_sale_followup_registered', student.id, enrollment.id, payload.attribution?.session_id || null, JSON.stringify({ payload, audit, studentAccessUrl: accessUrl, seatReservation })],
  );

  return { updated: true, mode: 'postgres', studentId: student.id, enrollmentId: enrollment.id, studentAccessUrl: accessUrl, paid: isPaid, seatReservation };
}

// Abandono real de checkout (regra P1.1/6.2 do Manual do produto): só é elegível 30 minutos
// depois do evento, e cada candidato é reconferido contra pagamento e opt-in antes do envio.
// Exige DATABASE_URL porque depende de filtro por tempo e checagem cruzada com pagamentos,
// que a camada de compatibilidade Supabase REST não faz.
// Recuperação de venda no modo Supabase (corrigido em 11/09/2026).
//
// As três buscas abaixo só existiam em SQL direto e devolviam `supported: false` quando o
// sistema roda por Supabase REST — que é o modo de produção da escola. Resultado: o cron de
// recuperação respondia 200 ("recover_carts_unsupported_without_postgres"), a Vercel marcava a
// execução como bem-sucedida, e NENHUM WhatsApp de carrinho abandonado, aceite sem pagamento ou
// boleto vencendo jamais saiu. A escola pagava anúncio, a aluna parava no meio da matrícula, e
// a automação que existia pra buscar essa aluna de volta nunca rodou.
//
// O SQL continua sendo usado quando há conexão direta (é mais eficiente). Estas funções cobrem
// o outro modo, fazendo em JavaScript o mesmo que os `not exists` faziam no banco.
function janelaDeRecuperacao(minAgeMinutes, maxAgeHours) {
  const agora = Date.now();
  return {
    ateIso: new Date(agora - minAgeMinutes * 60 * 1000).toISOString(),
    desdeIso: new Date(agora - maxAgeHours * 60 * 60 * 1000).toISOString(),
  };
}

async function chavesJaTratadas(eventNames = [], campo = 'recoveryKey', desdeIso = '') {
  const lista = eventNames.map((nome) => `"${nome}"`).join(',');
  const linhas = await supabaseRequest(`tracking_events?event_name=in.(${lista})&created_at=gte.${encodeURIComponent(desdeIso)}&select=payload&limit=2000`);
  return new Set(linhas.map((linha) => String(linha.payload?.[campo] || '').toLowerCase()).filter(Boolean));
}

function chaveDeRecuperacao(evento = {}) {
  const payload = evento.payload || {};
  return [
    evento.session_id || '',
    payload.studentEmail || payload.email || '',
    payload.courseSlug || payload.course_slug || '',
    payload.classDate || payload.class_date || '',
  ].join(':').toLowerCase();
}

// Matrículas dessa lista que já têm pagamento confirmado. Faz o papel do `not exists` em
// payments — sem isto, a aluna que acabou de pagar receberia o lembrete mesmo assim.
async function matriculasJaPagas(enrollmentIds = []) {
  if (!enrollmentIds.length) return new Set();
  const lista = enrollmentIds.map((id) => `"${id}"`).join(',');
  const pagos = await supabaseRequest(`payments?enrollment_id=in.(${lista})&status=in.("confirmed","received","payment_received")&select=enrollment_id&limit=2000`);
  return new Set(pagos.map((linha) => linha.enrollment_id));
}

async function candidatosPorMatricula({ flow, status, minAgeMinutes, maxAgeHours, limit, eventoDeControle, ignorarAdicional = false }) {
  const { ateIso, desdeIso } = janelaDeRecuperacao(minAgeMinutes, maxAgeHours);
  const statusLista = status.map((valor) => `"${valor}"`).join(',');
  const matriculas = await supabaseRequest(`enrollments?flow=eq.${encodeURIComponent(flow)}&status=in.(${statusLista})&created_at=lte.${encodeURIComponent(ateIso)}&created_at=gte.${encodeURIComponent(desdeIso)}&select=id,course_slug,course_name,class_date,amount_expected,metadata,created_at,student_id&order=created_at.asc&limit=200`);
  const elegiveis = ignorarAdicional ? matriculas.filter((linha) => (linha.metadata?.role || 'primary') !== 'additional') : matriculas;
  if (!elegiveis.length) return { supported: true, candidates: [] };

  const jaAvisadas = await chavesJaTratadas([eventoDeControle], 'enrollmentId', desdeIso);
  const jaPagas = await matriculasJaPagas(elegiveis.map((linha) => linha.id));
  const restantes = elegiveis.filter((linha) => !jaAvisadas.has(String(linha.id).toLowerCase()) && !jaPagas.has(linha.id)).slice(0, limit);
  if (!restantes.length) return { supported: true, candidates: [] };

  const alunas = await supabaseRequest(`students?id=in.(${restantes.map((linha) => `"${linha.student_id}"`).join(',')})&select=id,name,email,whatsapp,metadata&limit=200`);
  const porId = Object.fromEntries(alunas.map((aluna) => [aluna.id, aluna]));
  return {
    supported: true,
    candidates: restantes.map((linha) => {
      const aluna = porId[linha.student_id] || {};
      return {
        enrollment_id: linha.id,
        course_slug: linha.course_slug,
        course_name: linha.course_name,
        class_date: linha.class_date,
        amount_expected: linha.amount_expected,
        enrollment_metadata: linha.metadata || {},
        created_at: linha.created_at,
        student_id: aluna.id || linha.student_id,
        name: aluna.name || '',
        email: aluna.email || '',
        whatsapp: aluna.whatsapp || '',
        student_metadata: aluna.metadata || {},
      };
    }),
  };
}

export async function findAbandonedCartCandidates({ minAgeMinutes = 30, maxAgeHours = 6, limit = 20 } = {}) {
  if (!DATABASE_URL) {
    const { ateIso, desdeIso } = janelaDeRecuperacao(minAgeMinutes, maxAgeHours);
    const abandonados = await supabaseRequest(`tracking_events?event_name=eq.cart_abandoned&created_at=lte.${encodeURIComponent(ateIso)}&created_at=gte.${encodeURIComponent(desdeIso)}&select=id,session_id,url,referrer,utm_source,utm_medium,utm_campaign,payload,created_at&order=created_at.asc&limit=200`);
    if (!abandonados.length) return { supported: true, candidates: [] };
    const jaTratados = await chavesJaTratadas(
      ['whatsapp_abandoned_cart_coupon_sent', 'whatsapp_abandoned_cart_coupon_requested', 'whatsapp_abandoned_cart_coupon_skipped'],
      'recoveryKey',
      desdeIso,
    );
    return { supported: true, candidates: abandonados.filter((evento) => !jaTratados.has(chaveDeRecuperacao(evento))).slice(0, limit) };
  }

  const result = await pgQuery(
    `select te.id, te.session_id, te.url, te.referrer, te.utm_source, te.utm_medium, te.utm_campaign, te.payload, te.created_at
     from tracking_events te
     where te.event_name = 'cart_abandoned'
       and te.created_at <= now() - ($1 || ' minutes')::interval
       and te.created_at >= now() - ($2 || ' hours')::interval
       and not exists (
         select 1 from tracking_events f
         where f.event_name in ('whatsapp_abandoned_cart_coupon_sent', 'whatsapp_abandoned_cart_coupon_requested', 'whatsapp_abandoned_cart_coupon_skipped')
           and coalesce(f.payload->>'recoveryKey', '') = coalesce(
             lower(concat_ws(':', coalesce(te.session_id, ''), coalesce(te.payload->>'studentEmail', te.payload->>'email', ''), coalesce(te.payload->>'courseSlug', te.payload->>'course_slug', ''), coalesce(te.payload->>'classDate', te.payload->>'class_date', ''))),
             ''
           )
       )
     order by te.created_at asc
     limit $3`,
    [String(minAgeMinutes), String(maxAgeHours), limit],
  );
  return { supported: true, candidates: result.rows };
}

// Reconferência antes de mandar o cupom: se a aluna já pagou esse curso nessa turma, o
// lembrete não sai. Também só existia em SQL — no modo Supabase devolvia null, ou seja, "não
// achei pagamento", e o cupom sairia pra quem já é aluna pagante.
export async function hasConflictingPaidEnrollment({ email = '', courseSlug = '', classDate = '' } = {}) {
  const normalizedEmail = safeText(email, 180).toLowerCase();
  if (!normalizedEmail || !courseSlug || !classDate) return null;
  if (!DATABASE_URL) {
    const [aluna] = await supabaseRequest(`students?email=eq.${encodeURIComponent(normalizedEmail)}&select=id&limit=1`);
    if (!aluna) return null;
    const matriculas = await supabaseRequest(`enrollments?student_id=eq.${encodeURIComponent(aluna.id)}&course_slug=eq.${encodeURIComponent(courseSlug)}&class_date=eq.${encodeURIComponent(classDate)}&select=id&limit=20`);
    if (!matriculas.length) return null;
    const lista = matriculas.map((linha) => `"${linha.id}"`).join(',');
    const [pago] = await supabaseRequest(`payments?enrollment_id=in.(${lista})&status=in.("confirmed","received","payment_received")&select=status&order=created_at.desc&limit=1`);
    return pago || null;
  }
  const result = await pgQuery(
    `select p.status
     from enrollments e
     join students s on s.id = e.student_id
     join payments p on p.enrollment_id = e.id
     where lower(s.email) = $1 and e.course_slug = $2 and e.class_date = $3
       and p.status in ('confirmed', 'received', 'payment_received')
     order by p.updated_at desc nulls last, p.created_at desc
     limit 1`,
    [normalizedEmail, courseSlug, classDate],
  );
  return result.rows[0] || null;
}

// Lembrete real de pagamento pendente da matrícula Voomp/Cabeleireiro: só é elegível
// 30 minutos depois do aceite, reconfere contra pagamento confirmado antes do envio, e
// nunca reenvia para quem já recebeu o lembrete (marcado via tracking_events).
export async function findPendingVoompAcceptances({ minAgeMinutes = 30, maxAgeHours = 6, limit = 20 } = {}) {
  if (!DATABASE_URL) {
    return candidatosPorMatricula({ flow: 'voomp', status: ['acceptance_validated'], minAgeMinutes, maxAgeHours, limit, eventoDeControle: 'whatsapp_voomp_payment_reminder_sent' });
  }
  const result = await pgQuery(
    `select e.id as enrollment_id, e.course_slug, e.course_name, e.class_date, e.amount_expected,
            e.metadata as enrollment_metadata, e.created_at,
            s.id as student_id, s.name, s.email, s.whatsapp, s.metadata as student_metadata
     from enrollments e
     join students s on s.id = e.student_id
     where e.flow = 'voomp'
       and e.status = 'acceptance_validated'
       and e.created_at <= now() - ($1 || ' minutes')::interval
       and e.created_at >= now() - ($2 || ' hours')::interval
       and not exists (
         select 1 from payments p where p.enrollment_id = e.id and p.status in ('confirmed', 'received', 'payment_received')
       )
       and not exists (
         select 1 from tracking_events f
         where f.event_name = 'whatsapp_voomp_payment_reminder_sent'
           and coalesce(f.payload->>'enrollmentId', '') = e.id::text
       )
     order by e.created_at asc
     limit $3`,
    [String(minAgeMinutes), String(maxAgeHours), limit],
  );
  return { supported: true, candidates: result.rows };
}

// Lembrete real de pagamento pendente das especializações (Asaas): a pessoa preencheu o
// checkout e chegou a gerar Pix/boleto (status payment_intent_validated/payment_created),
// mas não pagou em 30 minutos. Reconfere pagamento antes do envio, ignora a matrícula
// "adicional" de uma oferta em par (o lembrete vai só para a matrícula principal do
// checkout) e nunca reenvia para quem já recebeu o cupom (marcado via tracking_events).
export async function findPendingAsaasPayments({ minAgeMinutes = 30, maxAgeHours = 6, limit = 20 } = {}) {
  if (!DATABASE_URL) {
    return candidatosPorMatricula({ flow: 'asaas', status: ['payment_intent_validated', 'payment_created'], minAgeMinutes, maxAgeHours, limit, eventoDeControle: 'whatsapp_payment_pending_coupon_sent', ignorarAdicional: true });
  }
  const result = await pgQuery(
    `select e.id as enrollment_id, e.course_slug, e.course_name, e.class_date, e.amount_expected,
            e.metadata as enrollment_metadata, e.created_at,
            s.id as student_id, s.name, s.email, s.whatsapp, s.metadata as student_metadata
     from enrollments e
     join students s on s.id = e.student_id
     where e.flow = 'asaas'
       and e.status in ('payment_intent_validated', 'payment_created')
       and coalesce(e.metadata->>'role', 'primary') <> 'additional'
       and e.created_at <= now() - ($1 || ' minutes')::interval
       and e.created_at >= now() - ($2 || ' hours')::interval
       and not exists (
         select 1 from payments p where p.enrollment_id = e.id and p.status in ('confirmed', 'received', 'payment_received')
       )
       and not exists (
         select 1 from tracking_events f
         where f.event_name = 'whatsapp_payment_pending_coupon_sent'
           and coalesce(f.payload->>'enrollmentId', '') = e.id::text
       )
     order by e.created_at asc
     limit $3`,
    [String(minAgeMinutes), String(maxAgeHours), limit],
  );
  return { supported: true, candidates: result.rows };
}

// Gestão de usuários administrativos (regra P1.7 do Manual do produto). Requer a migration
// database/migrations/0003_admin_users.sql já aplicada.
export async function listAdminUsers() {
  if (DATABASE_URL) {
    const result = await pgQuery('select id, username, name, role, status, last_login_at, created_at from admin_users order by created_at asc');
    return result.rows;
  }
  return supabaseRequest('admin_users?select=id,username,name,role,status,last_login_at,created_at&order=created_at.asc');
}

export async function createAdminUser({ username, name, role, passwordHash } = {}) {
  if (DATABASE_URL) {
    const result = await pgQuery(
      `insert into admin_users (username, name, role, password_hash)
       values ($1, $2, $3, $4)
       returning id, username, name, role, status, created_at`,
      [username, name, role, passwordHash],
    );
    return result.rows[0];
  }
  const [created] = await supabaseRequest('admin_users', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ username, name, role, password_hash: passwordHash }),
  });
  return created;
}

export async function updateAdminUser(id, { role, status } = {}) {
  const fields = {};
  if (role) fields.role = role;
  if (status) fields.status = status;
  if (!Object.keys(fields).length) return null;

  if (DATABASE_URL) {
    const setParts = [];
    const values = [];
    Object.entries(fields).forEach(([column, value]) => {
      values.push(value);
      setParts.push(`${column} = $${values.length}`);
    });
    values.push(id);
    const result = await pgQuery(
      `update admin_users set ${setParts.join(', ')}, updated_at = now() where id = $${values.length}
       returning id, username, name, role, status`,
      values,
    );
    return result.rows[0] || null;
  }
  const [updated] = await supabaseRequest(`admin_users?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
  return updated || null;
}

// Relatório de vendas: TODAS as vendas, não as últimas 80 (pedido da Erica, 09/09/2026).
//
// O painel montava o relatório em cima do resumo do dashboard, que busca as 80 matrículas e os
// 80 pagamentos mais recentes. Isso é razoável pra um resumo, e errado pra um relatório: com
// mais de 80 matrículas a lista simplesmente parava, sem avisar. Pior, o corte dos pagamentos
// é independente do corte das matrículas — uma venda antiga podia aparecer como "não paga" só
// porque o pagamento dela ficou fora da janela.
//
// Aqui a busca é paginada até acabar. O teto existe só pra não travar a função serverless num
// banco absurdamente grande, e quando ele é atingido a resposta AVISA (truncado: true) em vez
// de mentir que aquilo é tudo.
const TETO_RELATORIO = 20000;

async function buscaTudo(tabela, select, { pageSize = 1000, order = 'created_at.desc' } = {}) {
  const linhas = [];
  for (let offset = 0; offset < TETO_RELATORIO; offset += pageSize) {
    const pagina = await supabaseRequest(`${tabela}?select=${select}&order=${order}&limit=${pageSize}&offset=${offset}`);
    linhas.push(...pagina);
    if (pagina.length < pageSize) return { linhas, truncado: false };
  }
  return { linhas, truncado: true };
}

// Data que conta pro relatório: o dia em que o dinheiro entrou, quando entrou; senão o dia em
// que a matrícula começou. Uma venda paga em outubro de uma matrícula aberta em setembro é
// venda de outubro — é assim que a Erica fecha o mês.
export function saleReportDate(sale) {
  return sale.paidAt || sale.createdAt || null;
}

const SITUACAO_PAGAMENTO = [
  { key: 'pago', label: 'Pago', combina: (sale) => /confirmed|received|paid|pago|confirmado|approved|aprovado/i.test(sale.paymentStatus || '') },
  { key: 'cancelado', label: 'Cancelado/estornado', combina: (sale) => /refund|reembols|estorn|chargeback|cancel/i.test(sale.paymentStatus || '') },
  { key: 'pendente', label: 'Pendente', combina: (sale) => Boolean(sale.paymentStatus) },
  { key: 'sem_pagamento', label: 'Sem cobrança gerada', combina: () => true },
];

export function salePaymentSituation(sale) {
  return SITUACAO_PAGAMENTO.find((situacao) => situacao.combina(sale)) || SITUACAO_PAGAMENTO[3];
}

// Filtra e soma as vendas. Função pura de propósito: é a parte que decide o que a Erica vê no
// fechamento do mês, e dá pra conferir sem banco nenhum.
export function filterSalesReport(sales = [], filtros = {}) {
  const { from = '', to = '', courseSlug = '', situation = '', classState = '', search = '' } = filtros;
  const busca = String(search || '').trim().toLowerCase();
  const desde = from ? new Date(`${from}T00:00:00Z`).getTime() : null;
  const ate = to ? new Date(`${to}T23:59:59.999Z`).getTime() : null;

  const filtradas = sales.filter((sale) => {
    if (courseSlug && sale.courseSlug !== courseSlug) return false;
    if (situation && salePaymentSituation(sale).key !== situation) return false;
    if (classState === 'encerradas' && !sale.classFinished) return false;
    if (classState === 'futuras' && sale.classFinished) return false;
    if (desde !== null || ate !== null) {
      const data = saleReportDate(sale);
      // Venda sem data nenhuma não pode entrar num recorte por período: apareceria em todos os
      // meses e o mesmo dinheiro seria contado várias vezes no fechamento.
      if (!data) return false;
      const quando = new Date(data).getTime();
      if (Number.isNaN(quando)) return false;
      if (desde !== null && quando < desde) return false;
      if (ate !== null && quando > ate) return false;
    }
    if (busca) {
      const campos = [sale.name, sale.email, sale.phone, sale.course, sale.source, sale.campaign, sale.couponCode];
      if (!campos.some((campo) => String(campo || '').toLowerCase().includes(busca))) return false;
    }
    return true;
  });

  const totais = { vendas: filtradas.length, pago: 0, pendente: 0, cancelado: 0, semCobranca: 0, receitaPaga: 0, receitaPendente: 0 };
  for (const sale of filtradas) {
    const situacaoDaVenda = salePaymentSituation(sale).key;
    const valor = Number(sale.amountNumber || 0);
    if (situacaoDaVenda === 'pago') { totais.pago += 1; totais.receitaPaga += valor; }
    else if (situacaoDaVenda === 'pendente') { totais.pendente += 1; totais.receitaPendente += valor; }
    else if (situacaoDaVenda === 'cancelado') totais.cancelado += 1;
    else totais.semCobranca += 1;
  }
  return { sales: filtradas, totais };
}

export async function salesReport(filtros = {}) {
  if (!isDbConfigured()) return { configured: false, sales: [], totais: null, courses: [], truncado: false };
  const [students, enrollments, payments, carts] = await Promise.all([
    buscaTudo('students', 'id,name,email,whatsapp,cpf_last4,created_source,metadata,created_at'),
    buscaTudo('enrollments', 'id,student_id,status,amount_expected,course_slug,course_name,class_date,option_label,flow,source,campaign,metadata,created_at'),
    buscaTudo('payments', 'id,enrollment_id,student_id,status,amount,method,provider,metadata,created_at,paid_at'),
    buscaTudo('carts', 'id,enrollment_id,student_id,status,total_amount,coupon_code,items,attribution,created_at'),
  ]);
  const truncado = [students, enrollments, payments, carts].some((resultado) => resultado.truncado);

  // Aluna arquivada continua fora do painel, aqui também: quem sumiu da Minha Área não pode
  // reaparecer no relatório de vendas.
  const visivel = hideArchivedStudents({
    students: students.linhas, enrollments: enrollments.linhas, payments: payments.linhas, carts: carts.linhas,
  });

  const { buildSalesFromSummary } = await import('../src/lib/crm-helpers.js');
  const paymentsByEnrollment = new Map(visivel.payments.map((payment) => [payment.enrollment_id, payment]));
  const sales = buildSalesFromSummary({
    students: visivel.students, enrollments: visivel.enrollments, payments: visivel.payments, carts: visivel.carts,
  }).map((sale) => {
    const payment = paymentsByEnrollment.get(sale.enrollmentId) || {};
    return {
      ...sale,
      paidAt: payment.paid_at || null,
      classFinished: isClassFinished(sale.classDate || ''),
    };
  });

  // Lista de cursos do filtro, tirada das próprias vendas — inclui curso que saiu da agenda,
  // senão a venda dele ficaria inalcançável. Quando dois cursos diferentes têm o mesmo nome
  // (a a escola tem "Cabeleireiro Profissional" cadastrado mais de uma vez), o identificador entra
  // no rótulo: sem isso o filtro teria duas opções idênticas e nenhuma forma de escolher.
  const nomePorSlug = new Map(sales.map((sale) => [sale.courseSlug, sale.course]));
  const quantosComOMesmoNome = [...nomePorSlug.values()].reduce((acc, nome) => acc.set(nome, (acc.get(nome) || 0) + 1), new Map());
  const courses = [...nomePorSlug.entries()]
    .filter(([slug]) => slug)
    .map(([slug, nome]) => ({ slug, name: quantosComOMesmoNome.get(nome) > 1 ? `${nome} (${slug})` : nome }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));

  const { sales: filtradas, totais } = filterSalesReport(sales, filtros);
  return {
    configured: true,
    sales: filtradas.sort((a, b) => new Date(saleReportDate(b) || 0) - new Date(saleReportDate(a) || 0)),
    totais,
    courses,
    totalSemFiltro: sales.length,
    situations: SITUACAO_PAGAMENTO.map(({ key, label }) => ({ key, label })),
    truncado,
  };
}

// Cada consulta do painel responde por si (achado em 09/09/2026, investigando o aceite do
// Cabeleireiro que não aparecia na tela de Aceites).
//
// O painel montava as oito consultas num Promise.all: bastava UMA coluna faltando numa tabela
// pra promessa inteira ser rejeitada, /api/admin/summary devolver 500 e o painel cair no
// fallback visual — o que, na tela de Aceites, aparece exatamente como "Nenhum aceite
// registrado ainda". Ou seja: a tela dizia "não tem aceite" quando o problema era outra
// tabela, num canto nenhum relacionado. Reproduzido com Postgres de verdade removendo
// coupons.course_slug: some o painel todo, sem nenhuma pista de qual tabela quebrou.
//
// Agora uma tabela quebrada devolve lista vazia e vira um aviso nomeado em `sources`, que o
// painel mostra. O resto da tela continua real.
async function fonteDoPainel(nome, consulta, { opcional = false } = {}) {
  try {
    return { nome, linhas: await consulta, ok: true, erro: null };
  } catch (error) {
    const ausente = ['42P01', 'PGRST205', 'PGRST116'].includes(error.code);
    if (opcional && ausente) return { nome, linhas: [], ok: true, erro: null };
    console.error('admin_summary_source_failed', JSON.stringify({ nome, code: error.code || null, message: error.message || '' }));
    return { nome, linhas: [], ok: false, erro: { code: error.code || 'erro_desconhecido', message: error.message || '' } };
  }
}

export async function adminSummary() {
  if (!isDbConfigured()) return { configured: false, mode: 'mock' };
  const fontes = await Promise.all([
    fonteDoPainel('students', supabaseRequest('students?select=id,name,email,whatsapp,cpf_last4,created_source,metadata,created_at&order=created_at.desc&limit=300')),
    // 300, não 80 (11/09/2026): o CRM monta o pipeline em cima destas linhas, e com 80 a escola
    // passava a perder oportunidade em silêncio assim que passasse disso — justamente quando a
    // campanha começasse a trazer volume. O `truncated` abaixo avisa quando mesmo 300 não cobre.
    fonteDoPainel('enrollments', supabaseRequest('enrollments?select=id,student_id,status,amount_expected,course_slug,course_name,class_date,option_label,flow,source,campaign,metadata,created_at&order=created_at.desc&limit=300')),
    fonteDoPainel('payments', supabaseRequest('payments?select=id,enrollment_id,student_id,status,amount,method,provider,metadata,created_at,paid_at&order=created_at.desc&limit=300')),
    fonteDoPainel('carts', supabaseRequest('carts?select=id,enrollment_id,student_id,status,total_amount,coupon_code,items,attribution,created_at&order=created_at.desc&limit=300')),
    fonteDoPainel('coupons', supabaseRequest('coupons?select=id,code,type,value,status,used_count,max_uses,course_slug,class_date,created_at&order=created_at.desc&limit=80')),
    fonteDoPainel('acceptances', supabaseRequest('acceptances?select=id,enrollment_id,student_id,course_slug,class_date,terms_version,terms_read,payment_aware,enrollment_aware,wants_contact_before_payment,ip,user_agent,attribution,metadata,created_at&order=created_at.desc&limit=120')),
    fonteDoPainel('tracking_events', supabaseRequest('tracking_events?select=id,event_name,student_id,enrollment_id,session_id,utm_source,utm_medium,utm_campaign,url,payload,created_at&order=created_at.desc&limit=120')),
    fonteDoPainel('crm_activities', supabaseRequest('crm_activities?select=id,lead_key,activity_type,status,note,owner,course,phone,email,metadata,created_at&order=created_at.desc&limit=160'), { opcional: true }),
  ]);
  const [students, enrollments, payments, carts, coupons, acceptances, trackingEvents, crmActivities] = fontes.map((fonte) => fonte.linhas);
  const fontesComFalha = fontes.filter((fonte) => !fonte.ok).map((fonte) => ({ tabela: fonte.nome, code: fonte.erro.code, message: fonte.erro.message }));
  // Tabela que voltou cheia até o limite provavelmente tem mais linha do que coube. O painel
  // avisa em vez de deixar a escola achar que aquilo é tudo que existe.
  //
  // Mas só avisa do que CUSTA alguma coisa. `tracking_events` e `crm_activities` são históricos:
  // guardam todo clique e toda visita, batem no limite o tempo todo, e isso não esconde aluna,
  // venda nem oportunidade nenhuma — as telas que os usam mostram os mais recentes de propósito.
  // Avisar deles deixava a faixa acesa em quase toda tela (a Erica viu em 11/09/2026), e aviso
  // que fica sempre ligado é ruído: ninguém lê, e ele enterra o aviso que importa.
  const LIMITES = { students: 300, enrollments: 300, payments: 300, carts: 300, coupons: 80, acceptances: 120, tracking_events: 120, crm_activities: 160 };
  const AVISA_SE_ENCHER = new Set(['students', 'enrollments', 'payments', 'carts', 'coupons', 'acceptances']);
  const fontesTruncadas = fontes
    .filter((fonte) => fonte.ok && AVISA_SE_ENCHER.has(fonte.nome) && fonte.linhas.length >= (LIMITES[fonte.nome] || Infinity))
    .map((fonte) => ({ tabela: fonte.nome, limite: LIMITES[fonte.nome] }));

  // Isolamento de ambiente (regra P1.8 do Manual do produto): pagamentos criados em sandbox do Asaas
  // ficam registrados (útil pra QA), mas nunca entram nas métricas/receita real do painel.
  const isSandboxPayment = (payment) => String(payment.metadata?.audit?.asaasEnv || '').toLowerCase() === 'sandbox';

  const {
    students: studentsVisiveis, archivedStudents, enrollments: enrollmentsVisiveis,
    payments: paymentsVisiveis, carts: cartsVisiveis, acceptances: acceptancesVisiveis, trackingEvents: trackingVisiveis,
  } = hideArchivedStudents({ students, enrollments, payments, carts, acceptances, trackingEvents });
  const realPaymentsVisiveis = paymentsVisiveis.filter((payment) => !isSandboxPayment(payment));
  const paidVisiveis = realPaymentsVisiveis.filter((payment) => ['confirmed', 'received', 'paid'].includes(String(payment.status || '').toLowerCase()));
  const pendingVisiveis = realPaymentsVisiveis.filter((payment) => ['pending', 'created', 'validated_not_created'].includes(String(payment.status || '').toLowerCase()));
  // Cancelamentos de verdade. O painel mostrava um número fixo de exemplo aqui, sobra do
  // protótipo, mesmo com o banco conectado — número inventado no lugar mais visível do painel.
  const canceladosVisiveis = realPaymentsVisiveis.filter((payment) => cancelledPaymentStatus(payment.status));

  return {
    configured: true,
    mode: 'database',
    // Tabela que não respondeu aparece nomeada no painel, em vez de sumir com a tela inteira.
    failedSources: fontesComFalha,
    truncatedSources: fontesTruncadas,
    students: studentsVisiveis,
    // Lista à parte pra tela de arquivadas: é onde a Erica desarquiva se tiver arquivado
    // alguém sem querer.
    archivedStudents,
    // O código de check-in é derivado da matrícula, não fica em coluna nenhuma — então quem
    // monta a resposta do painel precisa calcular. O painel nunca recebe o segredo.
    enrollments: enrollmentsVisiveis.map((enrollment) => ({ ...enrollment, checkin_code: checkInCodeFor(enrollment.id) })),
    payments: paymentsVisiveis,
    carts: cartsVisiveis,
    coupons,
    // O contrato assinado tem ~10 KB por aluna. Mandar isso na listagem faria o painel baixar
    // megabytes pra desenhar cards que só mostram nome e turma — o texto vai por outra rota,
    // quando alguém abre o aceite. Aqui fica só o aviso de que existe.
    acceptances: acceptancesVisiveis.map((acceptance) => {
      const { contractText, ...metadata } = acceptance.metadata || {};
      return { ...acceptance, metadata: { ...metadata, hasContractText: Boolean(contractText) } };
    }),
    trackingEvents: trackingVisiveis,
    crmActivities,
    metrics: {
      students: studentsVisiveis.length,
      archivedStudents: archivedStudents.length,
      enrollments: enrollmentsVisiveis.length,
      carts: cartsVisiveis.length,
      coupons: coupons.length,
      acceptances: acceptancesVisiveis.length,
      payments: paymentsVisiveis.length,
      crmActivities: crmActivities.length,
      paidPayments: paidVisiveis.length,
      pendingPayments: pendingVisiveis.length,
      canceledPayments: canceladosVisiveis.length,
      revenueConfirmed: paidVisiveis.reduce((soma, payment) => soma + Number(payment.amount || 0), 0),
      revenuePending: pendingVisiveis.reduce((soma, payment) => soma + Number(payment.amount || 0), 0),
      sandboxPaymentsExcluded: paymentsVisiveis.length - realPaymentsVisiveis.length,
      failedSources: fontesComFalha.length,
    },
  };
}

function safeText(value = '', max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Contrato assinado de um aceite, buscado sob demanda (a listagem do painel não carrega o
// texto). Devolve o que foi guardado no momento da assinatura, junto da impressão digital pra
// quem abrir poder conferir que o texto não mudou desde então.
export async function acceptanceContract(acceptanceId) {
  const id = safeText(acceptanceId, 80);
  if (!id) throw erroDeNegocio('acceptance_id_required');
  const [acceptance] = await supabaseRequest(`acceptances?id=eq.${encodeURIComponent(id)}&select=id,student_id,enrollment_id,course_slug,class_date,terms_version,metadata,created_at&limit=1`);
  if (!acceptance) throw erroDeNegocio('acceptance_not_found');
  const assinatura = acceptance.metadata?.audit?.contractSignature || null;
  return {
    acceptanceId: acceptance.id,
    classDate: acceptance.class_date,
    termsVersion: acceptance.terms_version,
    signature: assinatura,
    text: acceptance.metadata?.contractText || '',
    createdAt: acceptance.created_at,
  };
}

// Clube da Escola (11/09/2026): cadastro leve de quem visitou a página do curso e não avançou.
//
// A escola não tem equipe comercial para correr atrás de quem só olhou. Sem isso, essa pessoa vai
// embora sem deixar rastro nenhum — a Meta sabe que ela existe, mas a escola não tem como falar
// com ela. Aqui ela deixa nome e WhatsApp com aceite explícito, e entra no CRM como lead de
// verdade, com o curso que estava vendo e a campanha de origem.
//
// Não cria matrícula: quem entra no clube não começou matrícula nenhuma, e misturar as duas
// coisas estragaria a leitura do funil e a otimização da campanha.
export async function persistClubSignup(payload = {}, audit = {}) {
  const nome = safeText(payload.name, 180);
  const whatsapp = cleanPhone(payload.whatsapp);
  if (!nome || whatsapp.length < 10) throw erroDeNegocio('clube_dados_invalidos');
  if (payload.optIn !== true) throw erroDeNegocio('clube_sem_consentimento');

  const aluna = await findOrCreateStudent({
    name: nome,
    whatsapp: payload.whatsapp,
    source: 'clube_escola',
    whatsappOptIn: true,
  });

  const entrada = {
    joinedAt: audit.receivedAt || new Date().toISOString(),
    courseSlug: safeText(payload.courseSlug, 120) || null,
    courseName: safeText(payload.courseName, 180) || null,
    classDate: safeText(payload.classDate, 180) || null,
    utmSource: safeText(payload.attribution?.utm_source, 120) || null,
    utmCampaign: safeText(payload.attribution?.utm_campaign, 180) || null,
    ip: audit.ip || null,
    userAgent: audit.userAgent || null,
    // O texto que ela leu ao aceitar. Se o convite mudar amanhã, o que ficou registrado é o que
    // de fato foi apresentado a essa pessoa — é o que responde "ela consentiu com o quê?".
    consentText: safeText(payload.consentText, 400) || null,
  };

  // Merge, não substituição: quem já era aluna não pode perder o que estava na metadata dela.
  const metadata = { ...(aluna.metadata || {}), clubeEscola: { ...(aluna.metadata?.clubeEscola || {}), ...entrada } };
  if (DATABASE_URL) {
    await pgQuery('update students set metadata = $1::jsonb, updated_at = now() where id = $2', [jsonb(metadata), aluna.id]);
  } else {
    await supabaseRequest(`students?id=eq.${encodeURIComponent(aluna.id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ metadata }),
    });
  }

  await supabaseRequest('tracking_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      event_name: 'clube_escola_signup',
      student_id: aluna.id,
      session_id: payload.attribution?.session_id || null,
      url: payload.attribution?.last_landing_page || null,
      utm_source: entrada.utmSource,
      utm_campaign: entrada.utmCampaign,
      payload: entrada,
    }),
  });

  return { studentId: aluna.id, name: aluna.name || nome, alreadyMember: Boolean(aluna.metadata?.clubeEscola?.joinedAt) };
}

export async function persistCrmActivity(payload = {}, audit = {}) {
  const activityType = safeText(payload.activityType || payload.activity_type, 80) || 'note';
  // "dismissed"/"restored" implementam o botão de excluir card do CRM (pedido da Erica,
  // 03/09/2026): remove o card da visão do pipeline sem apagar nada do banco — reversível,
  // ao contrário de uma exclusão de verdade das matrículas/pagamentos.
  const allowed = new Set(['contacted', 'lost', 'resolved', 'note', 'followup_scheduled', 'dismissed', 'restored']);
  if (!allowed.has(activityType)) {
    const error = new Error('invalid_crm_activity_type');
    error.code = 'invalid_crm_activity_type';
    throw error;
  }
  const record = {
    lead_key: safeText(payload.leadKey || payload.lead_key, 220) || safeId('lead'),
    activity_type: activityType,
    status: safeText(payload.status, 120) || activityType,
    note: safeText(payload.note, 1000) || null,
    owner: safeText(payload.owner, 180) || 'Atendimento a escola',
    course: safeText(payload.course, 180) || null,
    phone: cleanPhone(payload.phone || ''),
    email: safeText(payload.email, 180).toLowerCase() || null,
    metadata: { raw: payload, audit },
  };
  const [activity] = await supabaseRequest('crm_activities', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(record),
  });
  return activity;
}

export async function updateStudentPortalEnrollment(payload = {}, audit = {}) {
  const enrollmentId = safeText(payload.enrollmentId || payload.enrollment_id, 120);
  if (!enrollmentId) {
    const error = new Error('enrollment_id_required');
    error.code = 'enrollment_id_required';
    throw error;
  }

  // Só os campos que o painel realmente mandou. Antes esse objeto era montado inteiro e
  // gravado por cima do que existia: quem clicasse em "liberar materiais" apagava a presença
  // já confirmada da aula, porque checkInConfirmed voltava pra false sem ninguém pedir.
  // A gravação abaixo faz merge (jsonb ||), então o que não vem aqui fica como estava.
  // checkInReleased saiu daqui: o check-in não é mais um botão que a equipe aperta, é
  // consequência do pagamento. Quem confirma presença é confirmStudentCheckIn.
  const studentPortal = {
    materialsReleased: payload.materialsReleased === true,
    certificateReleased: payload.certificateReleased === true,
    materials: Array.isArray(payload.materials) && payload.materials.length ? payload.materials.slice(0, 12).map((item) => ({
      title: safeText(item.title, 180) || 'Material da turma',
      type: safeText(item.type, 40) || 'Material',
      status: safeText(item.status, 120) || (payload.materialsReleased === true ? 'Liberado pela equipe' : 'A liberar pela equipe'),
    })) : [
      { title: 'Apostila complementar', type: 'PDF', status: payload.materialsReleased === true ? 'Liberado pela equipe' : 'A liberar pela equipe' },
      { title: 'Orientações da turma', type: 'Aviso', status: payload.materialsReleased === true ? 'Liberado pela equipe' : 'Disponível antes da aula' },
    ],
    updatedAt: audit.receivedAt || new Date().toISOString(),
  };

  if (DATABASE_URL) {
    const result = await pgQuery(
      `update enrollments
       set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{studentPortal}', coalesce(metadata->'studentPortal', '{}'::jsonb) || $1::jsonb, true),
           updated_at = now()
       where id = $2
       returning id, student_id, metadata`,
      [JSON.stringify(studentPortal), enrollmentId],
    );
    if (!result.rows[0]) {
      const error = new Error('enrollment_not_found');
      error.code = 'enrollment_not_found';
      throw error;
    }
    await pgQuery(
      `insert into tracking_events (event_name, student_id, enrollment_id, payload)
       values ($1, $2, $3, $4::jsonb)`,
      ['student_portal_admin_updated', result.rows[0].student_id || null, enrollmentId, JSON.stringify({ studentPortal, audit })],
    );
    return result.rows[0];
  }

  const [current] = await supabaseRequest(`enrollments?id=eq.${encodeURIComponent(enrollmentId)}&select=id,student_id,metadata&limit=1`);
  if (!current) {
    const error = new Error('enrollment_not_found');
    error.code = 'enrollment_not_found';
    throw error;
  }
  const [updated] = await supabaseRequest(`enrollments?id=eq.${encodeURIComponent(enrollmentId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      metadata: { ...(current.metadata || {}), studentPortal: { ...(current.metadata?.studentPortal || {}), ...studentPortal } },
      updated_at: new Date().toISOString(),
    }),
  });
  if (!updated) {
    const error = new Error('enrollment_not_found');
    error.code = 'enrollment_not_found';
    throw error;
  }
  await supabaseRequest('tracking_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      event_name: 'student_portal_admin_updated',
      student_id: updated.student_id || null,
      enrollment_id: enrollmentId,
      payload: { studentPortal, audit },
    }),
  });
  return updated;
}

// Presença na aula, confirmada pelo código que a aluna mostra na Minha Área.
//
// Toda a regra mora aqui, no servidor, e não no botão do painel (regra P1.7 do Manual do produto:
// "esconder um botão não é controle de acesso"). Três recusas, nessa ordem:
//   1. código que não bate com matrícula nenhuma;
//   2. matrícula de outra turma, quando a equipe diz qual turma está conferindo;
//   3. matrícula sem pagamento confirmado — pedido da Erica, 08/09/2026: "a liberação só fica
//      ativa se ele é aluno mesmo do curso, e está pago".
// Estorno e chargeback contam como não pago (§16.4 do Manual do produto), então quem pediu o dinheiro
// de volta não entra na aula com um código antigo.
//
// erroDeNegocio carrega um code que a API traduz pra uma frase em português — quem está na
// recepção ou no painel precisa saber o que houve, não decifrar um código.
function erroDeNegocio(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

async function enrollmentsForCheckIn({ courseSlug, classDate }) {
  const filtros = [];
  if (DATABASE_URL) {
    const where = [];
    const params = [];
    if (courseSlug) { params.push(courseSlug); where.push(`course_slug = $${params.length}`); }
    if (classDate) { params.push(classDate); where.push(`class_date = $${params.length}`); }
    const sql = `select id, student_id, status, course_slug, course_name, class_date, option_label, metadata
                 from enrollments
                 ${where.length ? `where ${where.join(' and ')}` : ''}
                 order by created_at desc
                 limit 2000`;
    return (await pgQuery(sql, params)).rows;
  }
  if (courseSlug) filtros.push(`course_slug=eq.${encodeURIComponent(courseSlug)}`);
  if (classDate) filtros.push(`class_date=eq.${encodeURIComponent(classDate)}`);
  const query = ['select=id,student_id,status,course_slug,course_name,class_date,option_label,metadata', 'order=created_at.desc', 'limit=2000', ...filtros].join('&');
  return supabaseRequest(`enrollments?${query}`);
}

async function paymentsOfEnrollment(enrollmentId) {
  if (DATABASE_URL) {
    return (await pgQuery('select id, status, amount, paid_at from payments where enrollment_id = $1', [enrollmentId])).rows;
  }
  return supabaseRequest(`payments?enrollment_id=eq.${encodeURIComponent(enrollmentId)}&select=id,status,amount,paid_at`);
}

// Paga = tem pagamento confirmado e nenhum estorno/chargeback por cima dele.
export function enrollmentIsPaid(payments = []) {
  if (payments.some((payment) => cancelledPaymentStatus(payment?.status))) return false;
  return payments.some((payment) => paidStatus(payment?.status));
}

async function writeCheckIn(enrollment, patch, audit, eventName) {
  const studentPortal = { ...patch, updatedAt: audit.receivedAt || new Date().toISOString() };
  if (DATABASE_URL) {
    const result = await pgQuery(
      `update enrollments
       set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{studentPortal}', coalesce(metadata->'studentPortal', '{}'::jsonb) || $1::jsonb, true),
           updated_at = now()
       where id = $2
       returning id, student_id, metadata`,
      [JSON.stringify(studentPortal), enrollment.id],
    );
    await pgQuery(
      `insert into tracking_events (event_name, student_id, enrollment_id, payload)
       values ($1, $2, $3, $4::jsonb)`,
      [eventName, enrollment.student_id || null, enrollment.id, JSON.stringify({ studentPortal, audit })],
    );
    return result.rows[0];
  }
  const [current] = await supabaseRequest(`enrollments?id=eq.${encodeURIComponent(enrollment.id)}&select=id,student_id,metadata&limit=1`);
  const [updated] = await supabaseRequest(`enrollments?id=eq.${encodeURIComponent(enrollment.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      metadata: { ...(current?.metadata || {}), studentPortal: { ...(current?.metadata?.studentPortal || {}), ...studentPortal } },
      updated_at: new Date().toISOString(),
    }),
  });
  await supabaseRequest('tracking_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ event_name: eventName, student_id: enrollment.student_id || null, enrollment_id: enrollment.id, payload: { studentPortal, audit } }),
  });
  return updated;
}

export async function confirmStudentCheckIn(payload = {}, audit = {}) {
  const enrollmentId = safeText(payload.enrollmentId || payload.enrollment_id, 120);
  const code = normalizeCheckInCode(payload.code);
  const courseSlug = safeText(payload.courseSlug || payload.course_slug, 180);
  const classDate = safeText(payload.classDate || payload.class_date, 180);
  if (!enrollmentId && !code) throw erroDeNegocio('checkin_code_required');

  const candidatas = await enrollmentsForCheckIn({ courseSlug, classDate });
  let enrollment = enrollmentId ? candidatas.find((item) => String(item.id) === enrollmentId) || null : null;
  if (!enrollment && enrollmentId && !code) throw erroDeNegocio('enrollment_not_found');
  if (code) {
    // Com id E código, os dois têm que apontar pra mesma matrícula: assim ninguém confirma a
    // presença da aluna errada digitando o código de uma e clicando no card de outra.
    const doCodigo = candidatas.find((item) => checkInCodeMatches(item.id, code)) || null;
    if (!doCodigo) throw erroDeNegocio('checkin_code_not_found');
    if (enrollment && String(doCodigo.id) !== String(enrollment.id)) throw erroDeNegocio('checkin_code_other_student');
    enrollment = doCodigo;
  }
  if (!enrollment) throw erroDeNegocio('enrollment_not_found');
  if (courseSlug && enrollment.course_slug !== courseSlug) throw erroDeNegocio('checkin_wrong_class');
  if (classDate && enrollment.class_date !== classDate) throw erroDeNegocio('checkin_wrong_class');

  const payments = await paymentsOfEnrollment(enrollment.id);
  if (!enrollmentIsPaid(payments)) {
    throw erroDeNegocio('checkin_requires_paid_enrollment', {
      enrollmentId: enrollment.id,
      courseName: enrollment.course_name || enrollment.course_slug || '',
      classDate: enrollment.class_date || '',
    });
  }

  const updated = await writeCheckIn(enrollment, {
    checkInReleased: true,
    checkInConfirmed: true,
    checkInConfirmedAt: audit.receivedAt || new Date().toISOString(),
    checkInConfirmedBy: audit.actor?.username || null,
  }, audit, 'student_checkin_confirmed');

  // Selo de presença: já existia como badge automático, mas só era aplicado por um caminho que
  // não conferia pagamento nenhum.
  await applyAutomaticStudentBadge(enrollment.student_id, 'class_attendance', audit, 'checkin_confirmed').catch(() => null);

  // Se a turma já terminou, o certificado sai agora — é o caso de confirmar a presença no
  // último dia do curso: a aluna sai da aula com o certificado. Se a turma ainda não acabou,
  // não emite nada; o cron diário emite quando a data passar.
  const certificado = await issueCertificateForEnrollment(enrollment.id, audit).catch(() => ({ issued: false }));

  return {
    enrollmentId: enrollment.id,
    studentId: enrollment.student_id || null,
    courseName: enrollment.course_name || enrollment.course_slug || '',
    classDate: enrollment.class_date || '',
    checkInCode: checkInCodeFor(enrollment.id),
    confirmed: true,
    certificateIssued: certificado.issued === true,
    certificateCode: certificado.code || null,
    metadata: updated?.metadata || null,
  };
}

// Desfazer é parte do fluxo, não um extra: confirmar presença é um clique na porta, com fila
// esperando, e vai acontecer de confirmar a aluna errada.
export async function undoStudentCheckIn(payload = {}, audit = {}) {
  const enrollmentId = safeText(payload.enrollmentId || payload.enrollment_id, 120);
  if (!enrollmentId) throw erroDeNegocio('enrollment_id_required');
  const candidatas = await enrollmentsForCheckIn({});
  const enrollment = candidatas.find((item) => String(item.id) === enrollmentId);
  if (!enrollment) throw erroDeNegocio('enrollment_not_found');
  await writeCheckIn(enrollment, {
    checkInConfirmed: false,
    checkInConfirmedAt: null,
    checkInConfirmedBy: null,
    checkInUndoneBy: audit.actor?.username || null,
  }, audit, 'student_checkin_undone');
  return { enrollmentId: enrollment.id, confirmed: false };
}

// Tirar um cadastro de teste do painel (pedido da Erica, 09/09/2026).
//
// São duas coisas diferentes, de propósito:
//
//   ARQUIVAR — o botão do dia a dia. A aluna some do painel, das contagens e do CRM, mas as
//   linhas continuam no banco. É reversível com um clique. Vale pra qualquer cadastro,
//   inclusive de quem pagou, porque nada é perdido.
//
//   EXCLUIR DE VEZ — só quando não há NADA preso no cadastro: nenhuma matrícula, pagamento,
//   certificado, aceite, carrinho ou avaliação. Nesse caso apagar é seguro por construção,
//   porque não existe linha pra ficar órfã. Cadastro com qualquer coisa presa nunca some por
//   aqui: apagar levaria junto o histórico de pagamento, e um painel de celular não é lugar
//   pra uma decisão irreversível dessas. A limpeza definitiva desses casos é o roteiro
//   revisado em database/limpeza/, que faz cópia de segurança antes e tem como desfazer.
//
// A regra de "está vazio" é conferida no servidor a cada chamada, nunca no botão: a tela pode
// estar desatualizada, e entre carregar a lista e clicar a aluna pode ter se matriculado.
const TABELAS_DEPENDENTES = [
  { tabela: 'enrollments', rotulo: 'matrícula' },
  { tabela: 'payments', rotulo: 'pagamento' },
  { tabela: 'student_certificates', rotulo: 'certificado' },
  { tabela: 'acceptances', rotulo: 'aceite de contrato' },
  { tabela: 'carts', rotulo: 'carrinho' },
  { tabela: 'course_reviews', rotulo: 'avaliação de curso' },
  { tabela: 'student_notifications', rotulo: 'aviso enviado' },
];

// Sobra desimportante: só existe por causa do acesso e da analytics, e não é histórico de
// ninguém. Some junto com o cadastro vazio, sem precisar entrar na conta acima.
const TABELAS_DESCARTAVEIS = ['student_access', 'tracking_events'];

async function contaDependencias(studentId) {
  const contagem = {};
  for (const { tabela, rotulo } of TABELAS_DEPENDENTES) {
    if (DATABASE_URL) {
      const { rows } = await pgQuery(`select count(*)::int as total from ${tabela} where student_id = $1`, [studentId]);
      contagem[rotulo] = rows[0]?.total || 0;
    } else {
      const linhas = await supabaseRequest(`${tabela}?student_id=eq.${encodeURIComponent(studentId)}&select=id&limit=1`);
      contagem[rotulo] = linhas.length;
    }
  }
  return contagem;
}

async function buscaAluna(studentId) {
  if (DATABASE_URL) {
    const { rows } = await pgQuery('select id, name, email, metadata from students where id = $1', [studentId]);
    return rows[0] || null;
  }
  const [aluna] = await supabaseRequest(`students?id=eq.${encodeURIComponent(studentId)}&select=id,name,email,metadata&limit=1`);
  return aluna || null;
}

export async function setStudentArchived(payload = {}, audit = {}) {
  const studentId = safeText(payload.studentId || payload.student_id, 120);
  if (!studentId) throw erroDeNegocio('student_id_required');
  const arquivar = payload.archived !== false;
  const aluna = await buscaAluna(studentId);
  if (!aluna) throw erroDeNegocio('student_not_found');

  const marca = arquivar
    ? {
      archived: true,
      archivedAt: audit.receivedAt || new Date().toISOString(),
      archivedBy: audit.actor?.username || null,
      archivedReason: safeText(payload.reason, 300) || null,
    }
    : { archived: false, archivedAt: null, archivedBy: null, archivedReason: null };

  if (DATABASE_URL) {
    await pgQuery(
      `update students set metadata = coalesce(metadata, '{}'::jsonb) || $1::jsonb, updated_at = now() where id = $2`,
      [JSON.stringify(marca), studentId],
    );
    await pgQuery(
      'insert into tracking_events (event_name, student_id, payload) values ($1, $2, $3::jsonb)',
      [arquivar ? 'student_archived' : 'student_restored', studentId, JSON.stringify({ marca, audit })],
    );
  } else {
    await supabaseRequest(`students?id=eq.${encodeURIComponent(studentId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { ...(aluna.metadata || {}), ...marca }, updated_at: new Date().toISOString() }),
    });
    await supabaseRequest('tracking_events', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ event_name: arquivar ? 'student_archived' : 'student_restored', student_id: studentId, payload: { marca, audit } }),
    });
  }
  return { studentId, name: aluna.name || '', archived: arquivar };
}

export async function deleteStudentIfEmpty(payload = {}, audit = {}) {
  const studentId = safeText(payload.studentId || payload.student_id, 120);
  if (!studentId) throw erroDeNegocio('student_id_required');
  const aluna = await buscaAluna(studentId);
  if (!aluna) throw erroDeNegocio('student_not_found');

  const contagem = await contaDependencias(studentId);
  const presos = Object.entries(contagem).filter(([, total]) => total > 0);
  if (presos.length) {
    throw erroDeNegocio('student_has_history', {
      // A mensagem diz o que está preso, pra decisão não virar adivinhação: quem lê precisa
      // saber se é um pagamento de verdade ou só um carrinho abandonado.
      detalhe: presos.map(([rotulo, total]) => `${total} ${rotulo}${total > 1 ? 's' : ''}`).join(', '),
    });
  }

  if (DATABASE_URL) {
    await pgQuery('begin');
    try {
      for (const tabela of TABELAS_DESCARTAVEIS) {
        await pgQuery(`delete from ${tabela} where student_id = $1`, [studentId]);
      }
      const { rowCount } = await pgQuery('delete from students where id = $1', [studentId]);
      if (!rowCount) throw erroDeNegocio('student_not_found');
      await pgQuery('commit');
    } catch (error) {
      await pgQuery('rollback').catch(() => {});
      throw error;
    }
  } else {
    for (const tabela of TABELAS_DESCARTAVEIS) {
      await supabaseRequest(`${tabela}?student_id=eq.${encodeURIComponent(studentId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    }
    await supabaseRequest(`students?id=eq.${encodeURIComponent(studentId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  }
  // O registro de que foi apagada fica fora da tabela de tracking ligada à aluna (que acabou
  // de sumir) — vai pro log da função, que é onde dá pra auditar depois.
  console.log('student_deleted', JSON.stringify({ studentId, name: aluna.name || '', email: aluna.email || '', actor: audit.actor?.username || null, at: audit.receivedAt || new Date().toISOString() }));
  return { studentId, name: aluna.name || '', deleted: true };
}

// Aluna arquivada some do painel. É a mesma leitura que o painel faz da metadata, num lugar
// só, pra lista, contagem e CRM não discordarem entre si.
export function studentIsArchived(student) {
  return student?.metadata?.archived === true;
}

// Tira do painel tudo que pertence a aluna arquivada — não só a lista de alunas, mas as
// matrículas, pagamentos, carrinhos, aceites e eventos delas. Sem isso o painel diria
// "8 alunas" com 4 na lista, e a receita continuaria somando venda de teste.
//
// Fica separado de adminSummary de propósito: é a parte fácil de esquecer um array, e assim
// dá pra conferir sem banco nenhum (scripts-check-student-archive.mjs).
export function hideArchivedStudents({ students = [], enrollments = [], payments = [], carts = [], acceptances = [], trackingEvents = [] } = {}) {
  const arquivadas = new Set(students.filter(studentIsArchived).map((student) => student.id));
  const semArquivadas = (linhas) => linhas.filter((linha) => !arquivadas.has(linha.student_id));
  return {
    students: students.filter((student) => !arquivadas.has(student.id)),
    archivedStudents: students.filter(studentIsArchived),
    enrollments: semArquivadas(enrollments),
    payments: semArquivadas(payments),
    carts: semArquivadas(carts),
    acceptances: semArquivadas(acceptances),
    trackingEvents: semArquivadas(trackingEvents),
  };
}

// Fecha o pool de conexões. Serve pros scripts de verificação, que precisam terminar o
// processo em vez de ficar pendurados numa conexão aberta.
export async function closePgPool() {
  if (!pgPool) return;
  const pool = pgPool;
  pgPool = null;
  await pool.end();
}

// Certificado automático (pedido da Erica, 09/09/2026).
//
// Sai sozinho quando a turma já terminou E a presença foi confirmada — as duas coisas, porque
// confirmar presença no primeiro dia de um curso de dois dias não é concluir o curso. Quem
// dispara é o cron diário (api/cron/certificates.mjs) e também a própria confirmação de
// presença, pro caso de a equipe confirmar no último dia do curso: aí a aluna já sai da aula
// com o certificado na mão.
//
// O documento guarda uma FOTOGRAFIA dos dados no momento da emissão (nome, curso, turma, carga
// horária). Se a aluna trocar o nome no cadastro depois, o certificado dela continua igual —
// certificado é um documento, não uma tela que acompanha o cadastro.
async function dadosDoCurso(courseSlug, classDate) {
  try {
    await ensureLiveCourseCatalog();
    const course = findCourse(courseSlug);
    if (!course) return { courseName: '', workload: '' };
    const variant = course.variants?.[classDate] || null;
    return {
      courseName: course.name || '',
      workload: variant?.workloadText || variant?.workload || course.voomp?.workloadText || course.workload || '',
    };
  } catch {
    return { courseName: '', workload: '' };
  }
}

function certificadoJaExiste(certificados, enrollmentId) {
  return certificados.some((linha) => String(linha.enrollment_id) === String(enrollmentId));
}

// Emite o certificado de UMA matrícula, se ela tiver direito. Devolve o que aconteceu (emitido,
// já existia, ou por que não pode) em vez de lançar erro: quem chama é um cron que percorre
// todas as matrículas e não pode parar na primeira que não se aplica.
export async function issueCertificateForEnrollment(enrollmentId, audit = {}) {
  const id = safeText(enrollmentId, 120);
  if (!id) return { issued: false, reason: 'matrícula não informada' };

  const enrollment = DATABASE_URL
    ? (await pgQuery('select id, student_id, course_slug, course_name, class_date, metadata from enrollments where id = $1', [id])).rows[0]
    : (await supabaseRequest(`enrollments?id=eq.${encodeURIComponent(id)}&select=id,student_id,course_slug,course_name,class_date,metadata&limit=1`))[0];
  if (!enrollment) return { issued: false, reason: 'matrícula não encontrada' };

  const payments = await paymentsOfEnrollment(enrollment.id);
  const regra = certificateIsDue({
    paid: enrollmentIsPaid(payments),
    classDate: enrollment.class_date || '',
    checkInConfirmed: enrollment.metadata?.studentPortal?.checkInConfirmed === true,
  });
  if (!regra.due) return { issued: false, reason: regra.reason };

  const existentes = DATABASE_URL
    ? (await pgQuery('select id, enrollment_id from student_certificates where enrollment_id = $1', [enrollment.id])).rows
    : await supabaseRequest(`student_certificates?enrollment_id=eq.${encodeURIComponent(enrollment.id)}&select=id,enrollment_id`);
  if (certificadoJaExiste(existentes, enrollment.id)) return { issued: false, reason: 'certificado já emitido' };

  const student = DATABASE_URL
    ? (await pgQuery('select id, name from students where id = $1', [enrollment.student_id])).rows[0]
    : (await supabaseRequest(`students?id=eq.${encodeURIComponent(enrollment.student_id)}&select=id,name&limit=1`))[0];

  const { courseName, workload } = await dadosDoCurso(enrollment.course_slug, enrollment.class_date);
  const codigo = certificateCode(enrollment.id);
  const agora = audit.receivedAt || new Date().toISOString();
  const record = {
    student_id: enrollment.student_id,
    enrollment_id: enrollment.id,
    course_slug: enrollment.course_slug,
    class_date: enrollment.class_date || null,
    title: `Certificado de conclusão — ${courseName || enrollment.course_name || enrollment.course_slug}`,
    file_path: certificatePublicPath(codigo),
    status: 'released',
    issued_at: agora,
    released_at: agora,
    released_by: audit.actor?.username || 'sistema',
    metadata: {
      verificationCode: normalizeCertificateCode(codigo),
      // Fotografia dos dados na emissão — o certificado não muda depois.
      studentName: student?.name || '',
      courseName: courseName || enrollment.course_name || enrollment.course_slug,
      classDate: enrollment.class_date || '',
      workload: workload || '',
      issuedAt: agora,
      issuedBy: audit.actor?.username || 'automático',
    },
  };

  if (DATABASE_URL) {
    const columns = Object.keys(record);
    const values = Object.values(record).map((valor) => (valor && typeof valor === 'object' ? JSON.stringify(valor) : valor));
    const result = await pgQuery(
      `insert into student_certificates (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      values,
    );
    await pgQuery(
      'insert into tracking_events (event_name, student_id, enrollment_id, payload) values ($1, $2, $3, $4::jsonb)',
      ['certificate_issued', enrollment.student_id, enrollment.id, JSON.stringify({ code: record.metadata.verificationCode, audit })],
    );
    return { issued: true, code: record.metadata.verificationCode, certificateId: result.rows[0]?.id, studentName: record.metadata.studentName, courseName: record.metadata.courseName };
  }
  await supabaseRequest('student_certificates', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(record) });
  await supabaseRequest('tracking_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ event_name: 'certificate_issued', student_id: enrollment.student_id, enrollment_id: enrollment.id, payload: { code: record.metadata.verificationCode, audit } }),
  });
  return { issued: true, code: record.metadata.verificationCode, studentName: record.metadata.studentName, courseName: record.metadata.courseName };
}

// Varre as matrículas e emite o que estiver vencido. É o cron diário: turma que terminou
// ontem vira certificado hoje de manhã, sem ninguém lembrar de nada.
export async function issueDueCertificates(audit = {}) {
  if (!isDbConfigured()) return { configured: false, emitidos: [], analisadas: 0 };
  const enrollments = DATABASE_URL
    ? (await pgQuery("select id from enrollments where coalesce(metadata->'studentPortal'->>'checkInConfirmed', 'false') = 'true' order by created_at desc limit 2000")).rows
    : (await supabaseRequest('enrollments?select=id,metadata&order=created_at.desc&limit=2000'))
      .filter((linha) => linha.metadata?.studentPortal?.checkInConfirmed === true);

  const emitidos = [];
  for (const enrollment of enrollments) {
    const resultado = await issueCertificateForEnrollment(enrollment.id, audit).catch((error) => ({ issued: false, reason: error.message }));
    if (resultado.issued) emitidos.push(resultado);
  }
  return { configured: true, emitidos, analisadas: enrollments.length };
}

// Consulta pública pelo código do rodapé. Devolve só o que já está impresso no papel — nome,
// curso, turma, carga horária e data. Nada de e-mail, telefone ou CPF: quem abre isso é quem
// recebeu o certificado, não a dona dele.
export async function findCertificateByCode(code = '') {
  const codigo = normalizeCertificateCode(code);
  if (codigo.length !== 8 || !isDbConfigured()) return null;
  const linha = DATABASE_URL
    ? (await pgQuery("select course_slug, class_date, title, status, issued_at, released_at, metadata from student_certificates where metadata->>'verificationCode' = $1 limit 1", [codigo])).rows[0]
    : (await supabaseRequest(`student_certificates?metadata->>verificationCode=eq.${encodeURIComponent(codigo)}&select=course_slug,class_date,title,status,issued_at,released_at,metadata&limit=1`))[0];
  if (!linha || linha.status !== 'released') return null;
  return {
    code: codigo,
    studentName: linha.metadata?.studentName || '',
    courseName: linha.metadata?.courseName || linha.course_slug || '',
    classDate: linha.metadata?.classDate || linha.class_date || '',
    workload: linha.metadata?.workload || '',
    issuedAt: linha.metadata?.issuedAt || linha.released_at || linha.issued_at || null,
  };
}

function jsonb(value) {
  return JSON.stringify(value ?? {});
}

function moneyLabel(amount) {
  return Number(amount || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export async function replaceCatalogFromCourses(catalog = [], audit = {}) {
  if (!DATABASE_URL) {
    const error = new Error('postgres_required_for_catalog_sync');
    error.code = 'postgres_required_for_catalog_sync';
    throw error;
  }
  const slugs = catalog.map((course) => String(course.slug || '').trim()).filter(Boolean);
  if (!slugs.length) return { courses: 0, classes: 0 };

  await pgQuery('begin');
  try {
    await pgQuery('delete from classes where course_slug = any($1::text[])', [slugs]);
    let classCount = 0;
    for (const [index, course] of catalog.entries()) {
      const metadata = {
        ...course,
        managed_by: 'agenda_supabase_catalog',
        synced_at: audit.syncedAt || new Date().toISOString(),
        sort_order: index,
      };
      delete metadata.dates;
      delete metadata.reservedByDate;
      await pgQuery(
        `insert into courses (slug, name, category, status, metadata, updated_at)
         values ($1, $2, $3, $4, $5::jsonb, now())
         on conflict (slug) do update set
           name = excluded.name,
           category = excluded.category,
           status = excluded.status,
           metadata = excluded.metadata,
           updated_at = now()`,
        [course.slug, course.name, course.category || null, course.hiddenFromAgenda ? 'hidden' : 'active', jsonb(metadata)],
      );
      for (const [dateIndex, date] of (course.dates || []).entries()) {
        const variant = course.variants?.[date] || null;
        await pgQuery(
          `insert into classes (course_slug, class_date, option_label, capacity, reserved_count, sold_count, status, price_amount, metadata, updated_at)
           values ($1, $2, $3, $4, $5, 0, $6, $7, $8::jsonb, now())`,
          [
            course.slug,
            date,
            variant?.label || null,
            Number(variant?.capacity || course.capacity || 20),
            Number(course.reservedByDate?.[date] ?? variant?.reserved ?? course.reserved ?? 0),
            course.hiddenFromAgenda ? 'hidden' : 'open',
            Number(variant?.priceNumber ?? course.priceNumber ?? 0) || null,
            jsonb({
              managed_by: 'agenda_supabase_catalog',
              sort_order: dateIndex,
              price: variant?.price || course.price || null,
              priceNumber: variant?.priceNumber ?? course.priceNumber ?? null,
              description: variant?.description || null,
              workload: variant?.workload || null,
            }),
          ],
        );
        classCount += 1;
      }
    }
    await pgQuery('commit');
    return { courses: slugs.length, classes: classCount };
  } catch (error) {
    await pgQuery('rollback').catch(() => {});
    throw error;
  }
}

// Pura (sem I/O) pra dar pra testar sem banco real: recebe linhas de courses/classes já
// buscadas e devolve o catálogo no mesmo formato de src/catalog.js (fallbackCourses). Uma
// turma só ganha entrada em "variants" quando ela realmente diverge do curso (rótulo
// próprio, preço/vagas diferentes do padrão do curso, ou descrição/carga horária extra) —
// sem isso, uma turma com preço promocional mas sem rótulo (ex.: destrave em 16/17 de
// novembro) perdia o preço ao ser lida de volta do banco, porque só existia entrada de
// variants quando havia option_label.
export function buildManagedCatalog(courseRows = [], classRows = []) {
  // Turma arquivada/oculta (status 'archived' ou 'hidden') não pode aparecer na agenda ao
  // vivo — "excluir turma" no painel só arquiva (mantém histórico de quem já se matriculou),
  // mas precisa mesmo assim sumir da lista pública de datas.
  const classesBySlug = classRows.filter((row) => !['archived', 'hidden'].includes(row.status)).reduce((acc, row) => {
    acc[row.course_slug] = acc[row.course_slug] || [];
    acc[row.course_slug].push(row);
    return acc;
  }, {});
  return courseRows.map((row) => {
    const metadata = row.metadata || {};
    const classes = classesBySlug[row.slug] || [];
    const dates = classes.map((item) => item.class_date);
    const reservedByDate = Object.fromEntries(classes.map((item) => [item.class_date, Number(item.reserved_count || 0)]));
    const courseCapacity = Number(metadata.capacity || 20);
    const coursePriceNumber = metadata.priceNumber ?? null;
    const variants = classes.reduce((acc, item) => {
      const classCapacity = Number(item.capacity || 20);
      const classPriceNumber = item.metadata?.priceNumber ?? (item.price_amount != null ? Number(item.price_amount) : null);
      const hasOverride = Boolean(item.option_label) || Boolean(item.metadata?.description) || Boolean(item.metadata?.workload)
        || classCapacity !== courseCapacity
        || (classPriceNumber != null && coursePriceNumber != null && classPriceNumber !== coursePriceNumber);
      if (hasOverride) {
        acc[item.class_date] = {
          label: item.option_label || undefined,
          price: item.metadata?.price || (classPriceNumber != null ? moneyLabel(classPriceNumber) : metadata.price || null),
          priceNumber: classPriceNumber,
          capacity: classCapacity,
          reserved: Number(item.reserved_count || 0),
          workload: item.metadata?.workload || null,
          description: item.metadata?.description || null,
        };
      }
      return acc;
    }, {});
    const course = {
      ...metadata,
      slug: row.slug,
      name: row.name,
      category: row.category || metadata.category,
      hiddenFromAgenda: row.status !== 'active' || metadata.hiddenFromAgenda === true,
      dates,
      reservedByDate,
    };
    if (Object.keys(variants).length) course.variants = variants;
    return course;
  });
}

export async function getManagedCatalog() {
  if (!DATABASE_URL) {
    const error = new Error('postgres_required_for_catalog');
    error.code = 'postgres_required_for_catalog';
    throw error;
  }
  const coursesResult = await pgQuery(
    `select slug, name, category, status, metadata
     from courses
     where metadata->>'managed_by' = 'agenda_supabase_catalog'
     order by coalesce((metadata->>'sort_order')::integer, 999), created_at asc`,
  );
  if (!coursesResult.rows.length) return [];
  const slugs = coursesResult.rows.map((course) => course.slug);
  const classesResult = await pgQuery(
    `select course_slug, class_date, option_label, capacity, reserved_count, sold_count, status, price_amount, metadata
     from classes
     where course_slug = any($1::text[])
     order by coalesce((metadata->>'sort_order')::integer, 999), created_at asc`,
    [slugs],
  );
  return buildManagedCatalog(coursesResult.rows, classesResult.rows);
}

// Cadastro/edição de curso e turma pelo painel (pedido da Erica, 05/09/2026): ao contrário de
// replaceCatalogFromCourses (que substitui o catálogo inteiro, apagando e recriando todas as
// turmas dos cursos tocados — bom pra sincronizar o arquivo estático inteiro, ruim pra editar
// uma turma sem afetar as outras), estas funções são aditivas: tocam só o curso/turma pedido.
// managed_by precisa ser o mesmo marcador de replaceCatalogFromCourses pra aparecer em
// getManagedCatalog() — sem isso, um curso cadastrado aqui nunca apareceria na agenda ao vivo.
export async function upsertManagedCourse({ slug, name, category, hiddenFromAgenda, metadata } = {}, audit = {}) {
  if (!DATABASE_URL) {
    const error = new Error('postgres_required_for_catalog');
    error.code = 'postgres_required_for_catalog';
    throw error;
  }
  const cleanMetadata = { ...(metadata || {}) };
  delete cleanMetadata.dates;
  delete cleanMetadata.reservedByDate;
  delete cleanMetadata.variants;
  const record = {
    ...cleanMetadata,
    managed_by: 'agenda_supabase_catalog',
    updated_by: audit.actor || null,
    updated_at_iso: new Date().toISOString(),
  };
  const result = await pgQuery(
    `insert into courses (slug, name, category, status, metadata, updated_at)
     values ($1, $2, $3, $4, $5::jsonb, now())
     on conflict (slug) do update set
       name = excluded.name,
       category = excluded.category,
       status = excluded.status,
       metadata = courses.metadata || excluded.metadata,
       updated_at = now()
     returning slug, name, category, status, metadata`,
    [slug, name, category || null, hiddenFromAgenda ? 'hidden' : 'active', jsonb(record)],
  );
  return result.rows[0];
}

export async function upsertManagedClass({ courseSlug, classDate, originalClassDate, optionLabel, capacity, priceNumber, price, status, description, workload } = {}, audit = {}) {
  if (!DATABASE_URL) {
    const error = new Error('postgres_required_for_catalog');
    error.code = 'postgres_required_for_catalog';
    throw error;
  }
  const metadata = {
    managed_by: 'agenda_supabase_catalog',
    price: price || (priceNumber != null ? moneyLabel(priceNumber) : null),
    priceNumber: priceNumber ?? null,
    description: description || null,
    workload: workload || null,
    updated_by: audit.actor || null,
    updated_at_iso: new Date().toISOString(),
  };
  // originalClassDate vem do painel quando a Erica está corrigindo a data de uma turma já
  // cadastrada ("editar turma") — sem isso, mudar a data criava uma turma nova em vez de
  // corrigir a existente, porque a busca abaixo usava a data nova (que ainda não existe).
  const [existing] = (await pgQuery('select id from classes where course_slug = $1 and class_date = $2 limit 1', [courseSlug, originalClassDate || classDate])).rows;
  if (existing) {
    const result = await pgQuery(
      `update classes set class_date = $1, option_label = $2, capacity = $3, price_amount = $4, status = $5, metadata = metadata || $6::jsonb, updated_at = now()
       where id = $7
       returning course_slug, class_date, option_label, capacity, reserved_count, sold_count, status, price_amount, metadata`,
      [classDate, optionLabel || null, Number(capacity || 20), priceNumber != null ? Number(priceNumber) : null, status || 'open', jsonb(metadata), existing.id],
    );
    return result.rows[0];
  }
  const result = await pgQuery(
    `insert into classes (course_slug, class_date, option_label, capacity, reserved_count, sold_count, status, price_amount, metadata, updated_at)
     values ($1, $2, $3, $4, 0, 0, $5, $6, $7::jsonb, now())
     returning course_slug, class_date, option_label, capacity, reserved_count, sold_count, status, price_amount, metadata`,
    [courseSlug, classDate, optionLabel || null, Number(capacity || 20), status || 'open', priceNumber != null ? Number(priceNumber) : null, jsonb(metadata)],
  );
  return result.rows[0];
}

// "Excluir" uma turma no painel só arquiva (mesmo espírito do "excluir" cupom): uma turma que
// já teve matrícula não pode sumir do histórico dessa venda, e a turma some da agenda mesmo
// assim porque getManagedCatalog()/agenda pública só mostram turmas com status diferente de
// 'archived' (ver classAvailable/status na resposta pública).
export async function archiveManagedClass(courseSlug, classDate) {
  if (!DATABASE_URL) {
    const error = new Error('postgres_required_for_catalog');
    error.code = 'postgres_required_for_catalog';
    throw error;
  }
  const result = await pgQuery(
    `update classes set status = 'archived', updated_at = now() where course_slug = $1 and class_date = $2 returning course_slug, class_date, status`,
    [courseSlug, classDate],
  );
  return result.rows[0] || null;
}

// Materiais do curso (tabela course_content, Fase 4 do Manual do produto): a a escola cadastra material
// por curso/turma no painel, e ele fica disponível na Minha Área depois de publicado.
export async function listCourseContent() {
  const select = 'id,course_slug,class_date,title,description,content_type,file_path,external_url,sort_order,status,published_at,created_by,created_at';
  if (DATABASE_URL) {
    const result = await pgQuery(`select ${select.split(',').join(', ')} from course_content order by course_slug asc, sort_order asc, created_at asc`);
    return result.rows;
  }
  return supabaseRequest(`course_content?select=${select}&order=course_slug.asc,sort_order.asc`);
}

export async function createCourseContent({ courseSlug, classDate, title, description, contentType, filePath, externalUrl, sortOrder, createdBy } = {}) {
  const record = {
    course_slug: courseSlug,
    class_date: classDate || null,
    title,
    description: description || null,
    content_type: contentType,
    file_path: filePath || null,
    external_url: externalUrl || null,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    status: 'draft',
    created_by: createdBy || null,
  };
  if (DATABASE_URL) {
    const columns = Object.keys(record);
    const values = Object.values(record);
    const result = await pgQuery(
      `insert into course_content (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
      values,
    );
    return result.rows[0];
  }
  const [created] = await supabaseRequest('course_content', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(record) });
  return created;
}

export async function updateCourseContentStatus(id, status) {
  const patch = { status, updated_at: new Date().toISOString() };
  if (status === 'published') patch.published_at = new Date().toISOString();
  if (DATABASE_URL) {
    const result = await pgQuery(
      'update course_content set status = $1, updated_at = now(), published_at = case when $1 = \'published\' then coalesce(published_at, now()) else published_at end where id = $2 returning *',
      [status, id],
    );
    return result.rows[0] || null;
  }
  const [updated] = await supabaseRequest(`course_content?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  return updated || null;
}

// Certificados (tabela student_certificates): a a escola registra e libera o certificado de uma
// matrícula específica; a liberação fica visível na Minha Área da aluna.
export async function listCertificates() {
  if (DATABASE_URL) {
    const result = await pgQuery(
      `select c.id, c.student_id, c.enrollment_id, c.course_slug, c.class_date, c.title, c.file_path, c.status,
              c.issued_at, c.released_at, c.released_by, c.created_at,
              s.name as student_name, s.email as student_email
       from student_certificates c
       left join students s on s.id = c.student_id
       order by c.created_at desc`,
    );
    return result.rows;
  }
  const rows = await supabaseRequest('student_certificates?select=id,student_id,enrollment_id,course_slug,class_date,title,file_path,status,issued_at,released_at,released_by,created_at&order=created_at.desc');
  const students = await supabaseRequest('students?select=id,name,email');
  const byId = Object.fromEntries((students || []).map((s) => [s.id, s]));
  return (rows || []).map((row) => ({ ...row, student_name: byId[row.student_id]?.name || null, student_email: byId[row.student_id]?.email || null }));
}

// Certificado cadastrado à mão pelo painel (achado da Erica em 10/09/2026: o certificado dela
// abria em 404).
//
// O certificado automático já saía com código de validação, foto dos dados e endereço público.
// Este, não: gravava só o caminho do arquivo que a pessoa digitasse. Sem arquivo hospedado de
// verdade — e a arte do certificado ainda nem chegou — o botão "Abrir certificado" apontava
// pro nada. Pior: mesmo com o endereço certo, /certificado/CÓDIGO não acharia nada, porque a
// consulta pública procura pelo código de validação, que este caminho nunca gerava.
//
// Agora os dois caminhos produzem o mesmo tipo de certificado. Arquivo próprio virou opcional:
// quem tem, o botão abre o arquivo; quem não tem, abre o documento que o sistema monta. Nos
// dois casos o código de validação existe e /certificado/CÓDIGO responde.
export async function createCertificate({ studentId, enrollmentId, courseSlug, classDate, title, filePath, studentName } = {}) {
  const semente = enrollmentId || `manual:${studentId}:${courseSlug}:${classDate || ''}`;
  const codigo = certificateCode(semente);
  const { courseName, workload } = await dadosDoCurso(courseSlug, classDate);
  const agora = new Date().toISOString();
  const record = {
    student_id: studentId,
    enrollment_id: enrollmentId || null,
    course_slug: courseSlug,
    class_date: classDate || null,
    title,
    file_path: filePath || certificatePublicPath(codigo),
    status: 'draft',
    metadata: {
      verificationCode: normalizeCertificateCode(codigo),
      studentName: studentName || '',
      courseName: courseName || courseSlug,
      classDate: classDate || '',
      workload: workload || '',
      issuedAt: agora,
      issuedBy: 'painel',
      // Arquivo próprio, quando existe, fica registrado à parte: o botão abre ele, e a página
      // de validação continua existindo pelo código.
      customFile: filePath || '',
    },
  };
  if (DATABASE_URL) {
    const columns = Object.keys(record);
    const values = columns.map((coluna) => (coluna === 'metadata' ? jsonb(record[coluna]) : record[coluna]));
    const result = await pgQuery(`insert into student_certificates (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, values);
    return result.rows[0];
  }
  const [created] = await supabaseRequest('student_certificates', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(record) });
  return created;
}

export async function updateCertificateStatus(id, status, releasedBy = '') {
  if (DATABASE_URL) {
    const result = await pgQuery(
      `update student_certificates
       set status = $1,
           issued_at = case when $1 in ('issued', 'released') then coalesce(issued_at, now()) else issued_at end,
           released_at = case when $1 = 'released' then coalesce(released_at, now()) else released_at end,
           released_by = case when $1 = 'released' then coalesce($3, released_by) else released_by end,
           updated_at = now()
       where id = $2
       returning *`,
      [status, id, releasedBy || null],
    );
    return result.rows[0] || null;
  }
  const patch = { status, updated_at: new Date().toISOString() };
  if (['issued', 'released'].includes(status)) patch.issued_at = new Date().toISOString();
  if (status === 'released') { patch.released_at = new Date().toISOString(); patch.released_by = releasedBy || null; }
  const [updated] = await supabaseRequest(`student_certificates?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  return updated || null;
}

// Avisos à aluna (tabela student_notifications): recado cadastrado pela escola, exibido na
// Minha Área (canal "app"); canal "whatsapp" fica marcado para envio manual pelo atendimento,
// já que mensagem livre fora de template aprovado não é confiável via API do WhatsApp.
export async function listNotifications() {
  if (DATABASE_URL) {
    const result = await pgQuery(
      `select n.id, n.student_id, n.course_slug, n.class_date, n.title, n.message, n.channel, n.status,
              n.scheduled_at, n.sent_at, n.created_by, n.created_at,
              s.name as student_name, s.email as student_email
       from student_notifications n
       left join students s on s.id = n.student_id
       order by n.created_at desc`,
    );
    return result.rows;
  }
  const rows = await supabaseRequest('student_notifications?select=id,student_id,course_slug,class_date,title,message,channel,status,scheduled_at,sent_at,created_by,created_at&order=created_at.desc');
  const students = await supabaseRequest('students?select=id,name,email');
  const byId = Object.fromEntries((students || []).map((s) => [s.id, s]));
  return (rows || []).map((row) => ({ ...row, student_name: row.student_id ? (byId[row.student_id]?.name || null) : null, student_email: row.student_id ? (byId[row.student_id]?.email || null) : null }));
}

export async function createNotification({ studentId, courseSlug, classDate, title, message, channel, createdBy } = {}) {
  const record = { student_id: studentId || null, course_slug: courseSlug || null, class_date: classDate || null, title, message, channel: channel || 'app', status: 'draft', created_by: createdBy || null };
  if (DATABASE_URL) {
    const columns = Object.keys(record);
    const values = Object.values(record);
    const result = await pgQuery(`insert into student_notifications (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, values);
    return result.rows[0];
  }
  const [created] = await supabaseRequest('student_notifications', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(record) });
  return created;
}

export async function markNotificationSent(id) {
  const patch = { status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (DATABASE_URL) {
    const result = await pgQuery('update student_notifications set status = $1, sent_at = now(), updated_at = now() where id = $2 returning *', ['sent', id]);
    return result.rows[0] || null;
  }
  const [updated] = await supabaseRequest(`student_notifications?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  return updated || null;
}

// Demandas da agência (tabela agency_demands): board simples de acompanhamento entre a
// agência e a a escola — o que está em andamento, aguardando o quê, e o que já foi entregue.
export async function listAgencyDemands() {
  const select = 'id,title,description,category,status,priority,owner,due_date,waiting_for,delivery_url,client_visible,sort_order,created_at,updated_at,completed_at,approved_at,approval_note';
  if (DATABASE_URL) {
    const result = await pgQuery(`select ${select.split(',').join(', ')} from agency_demands order by sort_order asc, created_at desc`);
    return result.rows;
  }
  return supabaseRequest(`agency_demands?select=${select}&order=sort_order.asc,created_at.desc`);
}

export async function createAgencyDemand({ title, description, category, priority, owner, dueDate, waitingFor, clientVisible } = {}) {
  const record = {
    title,
    description: description || null,
    category: category || 'other',
    priority: priority || 'normal',
    owner: owner || null,
    due_date: dueDate || null,
    waiting_for: waitingFor || null,
    client_visible: clientVisible !== false,
  };
  if (DATABASE_URL) {
    const columns = Object.keys(record);
    const values = Object.values(record);
    const result = await pgQuery(`insert into agency_demands (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, values);
    return result.rows[0];
  }
  const [created] = await supabaseRequest('agency_demands', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(record) });
  return created;
}

export async function updateAgencyDemand(id, { status, deliveryUrl, approvalNote } = {}) {
  const fields = {};
  if (status) fields.status = status;
  if (deliveryUrl !== undefined) fields.delivery_url = deliveryUrl || null;
  if (approvalNote !== undefined) fields.approval_note = approvalNote || null;
  if (status === 'done') fields.completed_at = new Date().toISOString();
  if (status === 'approved') fields.approved_at = new Date().toISOString();
  if (!Object.keys(fields).length) return null;

  if (DATABASE_URL) {
    const setParts = [];
    const values = [];
    Object.entries(fields).forEach(([column, value]) => { values.push(value); setParts.push(`${column} = $${values.length}`); });
    values.push(id);
    const result = await pgQuery(`update agency_demands set ${setParts.join(', ')}, updated_at = now() where id = $${values.length} returning *`, values);
    return result.rows[0] || null;
  }
  const [updated] = await supabaseRequest(`agency_demands?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }) });
  return updated || null;
}

// Catálogo de benefícios por selo (tabela badge_benefits, decisão de negócio §16.7 do Manual
// a escola, 03/09/2026): a a escola ainda não tem regra fechada de qual selo dá qual benefício, então
// isso fica editável pelo painel em vez de hardcoded. badge_key é a mesma chave usada em
// students.metadata.studentBadges.missions — veja badgeBenefitsFor() em toStudentPortal.
export async function listBadgeBenefits() {
  const select = 'id,badge_key,badge_label,benefit_type,benefit_detail,discount_percent,status,sort_order,created_at,updated_at';
  if (DATABASE_URL) {
    const result = await pgQuery(`select ${select.split(',').join(', ')} from badge_benefits order by sort_order asc, created_at asc`);
    return result.rows;
  }
  return supabaseRequest(`badge_benefits?select=${select}&order=sort_order.asc,created_at.asc`);
}

export async function createBadgeBenefit({ badgeKey, badgeLabel, benefitType, benefitDetail, discountPercent, sortOrder } = {}) {
  const record = {
    badge_key: badgeKey,
    badge_label: badgeLabel,
    benefit_type: benefitType || 'other',
    benefit_detail: benefitDetail || null,
    discount_percent: Number.isFinite(discountPercent) ? discountPercent : null,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    status: 'active',
  };
  if (DATABASE_URL) {
    const columns = Object.keys(record);
    const values = Object.values(record);
    const result = await pgQuery(
      `insert into badge_benefits (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})
       on conflict (badge_key) do update set badge_label = excluded.badge_label, benefit_type = excluded.benefit_type, benefit_detail = excluded.benefit_detail, discount_percent = excluded.discount_percent, sort_order = excluded.sort_order, status = 'active', updated_at = now()
       returning *`,
      values,
    );
    return result.rows[0];
  }
  const [created] = await supabaseRequest('badge_benefits', { method: 'POST', headers: { Prefer: 'return=representation', 'x-upsert': 'true' }, body: JSON.stringify(record) });
  return created;
}

export async function updateBadgeBenefitStatus(id, status) {
  if (DATABASE_URL) {
    const result = await pgQuery('update badge_benefits set status = $1, updated_at = now() where id = $2 returning *', [status, id]);
    return result.rows[0] || null;
  }
  const [updated] = await supabaseRequest(`badge_benefits?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status, updated_at: new Date().toISOString() }) });
  return updated || null;
}

// Gestão de cupons pelo painel (pedido da Erica, 05/09/2026): "excluir" um cupom nunca apaga a
// linha do banco — só arquiva (status = 'archived'), porque um cupom já usado numa matrícula
// não pode sumir do histórico dessa venda. findActiveCoupon() já ignora cupons não 'active', então
// arquivar tem o mesmo efeito prático de excluir sem quebrar nada que já foi vendido com ele.
const COUPON_SELECT = 'id,code,type,value,status,max_uses,used_count,course_slug,class_date,starts_at,ends_at,created_at,updated_at';

export async function listCoupons() {
  if (DATABASE_URL) {
    const result = await pgQuery(`select ${COUPON_SELECT.split(',').join(', ')} from coupons order by created_at desc limit 200`);
    return result.rows;
  }
  return supabaseRequest(`coupons?select=${COUPON_SELECT}&order=created_at.desc&limit=200`);
}

export async function createCoupon({ code, type, value, maxUses, courseSlug, classDate, startsAt, endsAt } = {}) {
  const record = {
    code: String(code || '').trim().toUpperCase(),
    type,
    value,
    status: 'active',
    max_uses: Number.isFinite(maxUses) ? maxUses : null,
    course_slug: courseSlug || null,
    class_date: classDate || null,
    starts_at: startsAt || null,
    ends_at: endsAt || null,
  };
  if (DATABASE_URL) {
    const columns = Object.keys(record);
    const values = Object.values(record);
    const result = await pgQuery(
      `insert into coupons (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})
       on conflict (code) do update set type = excluded.type, value = excluded.value, status = 'active', max_uses = excluded.max_uses, course_slug = excluded.course_slug, class_date = excluded.class_date, starts_at = excluded.starts_at, ends_at = excluded.ends_at, updated_at = now()
       returning ${COUPON_SELECT.split(',').join(', ')}`,
      values,
    );
    return result.rows[0];
  }
  const [created] = await supabaseRequest('coupons', { method: 'POST', headers: { Prefer: 'return=representation', 'x-upsert': 'true' }, body: JSON.stringify(record) });
  return created;
}

export async function updateCouponStatus(id, status) {
  if (DATABASE_URL) {
    const result = await pgQuery(`update coupons set status = $1, updated_at = now() where id = $2 returning ${COUPON_SELECT.split(',').join(', ')}`, [status, id]);
    return result.rows[0] || null;
  }
  const [updated] = await supabaseRequest(`coupons?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status, updated_at: new Date().toISOString() }) });
  return updated || null;
}
