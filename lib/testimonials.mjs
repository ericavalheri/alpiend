import crypto from 'node:crypto';
import { isDbConfigured, isPgConfigured, pgQuery, supabaseRequest } from './db.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || '';
const BUCKET = 'course-testimonials';
const ALLOWED_TYPES = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);
let infrastructureReady = false;

function safe(value, max = 500) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function slug(value) { return safe(value, 120).toLowerCase().replace(/[^a-z0-9-]/g, ''); }
function originAllowed(request) {
  const origin = safe(request.headers.origin, 300);
  if (!origin) return true;
  return /^https:\/\/(${dominioPublico()}|[a-z0-9-]+\.vercel\.app)$/i.test(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}
async function ensureInfrastructure() {
  if (infrastructureReady) return;
  if (isPgConfigured()) await pgQuery(`create table if not exists testimonials (id uuid primary key default gen_random_uuid(), student_name text not null check (char_length(student_name) between 2 and 100), course_slug text not null, course_name text not null, rating smallint not null check (rating between 1 and 5), text text not null check (char_length(text) between 20 and 1200), photo_url text not null, status text not null default 'approved' check (status in ('pending','approved','rejected')), metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()); create index if not exists idx_testimonials_course_status on testimonials(course_slug,status,created_at desc); alter table testimonials enable row level security;`);
  await ensureBucket();
  infrastructureReady = true;
}
async function ensureBucket() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return false;
  const headers = { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`, apikey: SUPABASE_SERVICE_ROLE };
  const current = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, { headers });
  if (current.ok) return true;
  if (current.status !== 404) throw Object.assign(new Error('bucket_check_failed'), { code: 'bucket_check_failed' });
  const created = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 650000, allowed_mime_types: [...ALLOWED_TYPES.keys()] }) });
  if (!created.ok && created.status !== 409) throw Object.assign(new Error('bucket_create_failed'), { code: 'bucket_create_failed' });
  return true;
}
async function uploadPhoto(dataUrl, courseSlug) {
  const match = safe(dataUrl, 900000).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !ALLOWED_TYPES.has(match[1])) throw Object.assign(new Error('invalid_photo'), { code: 'invalid_photo' });
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 650000) throw Object.assign(new Error('photo_too_large'), { code: 'photo_too_large' });
  const storageReady = await ensureBucket();
  if (!storageReady) return dataUrl;
  const file = `${courseSlug}/${Date.now()}-${crypto.randomBytes(10).toString('hex')}.${ALLOWED_TYPES.get(match[1])}`;
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${file}`, { method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`, apikey: SUPABASE_SERVICE_ROLE, 'content-type': match[1], 'x-upsert': 'false' }, body: bytes });
  if (!response.ok) throw Object.assign(new Error('photo_upload_failed'), { code: 'photo_upload_failed' });
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${file}`;
}

export async function handleTestimonials(request, response) {
  if (!originAllowed(request)) return response.status(403).json({ ok: false, error: 'origin_not_allowed' });
  if (!isDbConfigured()) return response.status(503).json({ ok: false, error: 'database_not_configured' });
  try {
    await ensureInfrastructure();
    if (request.method === 'GET') {
      const courseSlug = slug(request.query?.course);
      if (!courseSlug) return response.status(400).json({ ok: false, error: 'course_required' });
      const rows = isPgConfigured()
        ? (await pgQuery('select id, student_name, course_slug, course_name, rating, text, photo_url, created_at from testimonials where course_slug = $1 and status = $2 order by created_at desc limit 40', [courseSlug, 'approved'])).rows
        : await supabaseRequest(`testimonials?select=id,student_name,course_slug,course_name,rating,text,photo_url,created_at&course_slug=eq.${encodeURIComponent(courseSlug)}&status=eq.approved&order=created_at.desc&limit=40`);
      response.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
      return response.status(200).json({ ok: true, testimonials: rows });
    }
    if (request.method === 'POST') {
      const body = request.body || {};
      if (safe(body.website, 80)) return response.status(202).json({ ok: true, status: 'received' });
      const studentName = safe(body.studentName, 100);
      const courseSlug = slug(body.courseSlug);
      const courseName = safe(body.courseName, 160);
      const text = safe(body.text, 1200);
      const rating = Number(body.rating);
      if (studentName.length < 2 || !courseSlug || !courseName || text.length < 20 || !Number.isInteger(rating) || rating < 1 || rating > 5 || body.consent !== true) return response.status(400).json({ ok: false, error: 'invalid_testimonial' });
      const photoUrl = await uploadPhoto(body.photo, courseSlug);
      const rows = await supabaseRequest('testimonials', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ student_name: studentName, course_slug: courseSlug, course_name: courseName, rating, text, photo_url: photoUrl, status: 'approved', metadata: { source: 'course_page', consent_at: new Date().toISOString() } }) });
      return response.status(201).json({ ok: true, testimonial: rows[0] });
    }
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (error) {
    const diagnostic = safe(error.code || error.message, 120).replace(/[^a-zA-Z0-9_ .:-]/g, '');
    return response.status(['invalid_photo', 'photo_too_large'].includes(error.code) ? 400 : 500).json({ ok: false, error: diagnostic || 'testimonial_failed' });
  }
}
