// Upload de arquivo pros formulários de cadastro do painel admin (materiais e certificados),
// pedido da Erica em 04/09/2026: em vez de só aceitar link/caminho de arquivo já hospedado,
// deixar anexar o arquivo direto no formulário. Reaproveita o mesmo padrão de storage que já
// existia pra foto de depoimento (lib/testimonials.mjs), só generalizado pra outros buckets.
import crypto from 'node:crypto';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || '';

// Limite conservador: o corpo da requisição no Vercel tem teto ~4,5MB, e base64 já adiciona
// uns 33% de peso — 3MB de arquivo cru fica bem dentro da margem seguindo esse teto.
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

const ALLOWED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);

const bucketsReady = new Set();

async function ensureBucket(bucket) {
  if (bucketsReady.has(bucket)) return true;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return false;
  const headers = { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`, apikey: SUPABASE_SERVICE_ROLE };
  const current = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${bucket}`, { headers });
  if (current.ok) { bucketsReady.add(bucket); return true; }
  if (current.status !== 404) throw Object.assign(new Error('bucket_check_failed'), { code: 'bucket_check_failed' });
  const created = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ id: bucket, name: bucket, public: true, file_size_limit: MAX_UPLOAD_BYTES, allowed_mime_types: [...ALLOWED_TYPES.keys()] }),
  });
  if (!created.ok && created.status !== 409) throw Object.assign(new Error('bucket_create_failed'), { code: 'bucket_create_failed' });
  bucketsReady.add(bucket);
  return true;
}

// dataUrl: string "data:<mime>;base64,<...>" vinda direto do <input type="file"> no navegador.
export async function uploadAdminFile(dataUrl, { bucket, folder = '' } = {}) {
  const match = typeof dataUrl === 'string' ? dataUrl.match(/^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/) : null;
  if (!match || !ALLOWED_TYPES.has(match[1])) throw Object.assign(new Error('invalid_file'), { code: 'invalid_file' });
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw Object.assign(new Error('file_too_large'), { code: 'file_too_large' });
  const storageReady = await ensureBucket(bucket);
  if (!storageReady) throw Object.assign(new Error('storage_not_configured'), { code: 'storage_not_configured' });
  const path = `${folder ? `${folder}/` : ''}${Date.now()}-${crypto.randomBytes(10).toString('hex')}.${ALLOWED_TYPES.get(match[1])}`;
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`, apikey: SUPABASE_SERVICE_ROLE, 'content-type': match[1], 'x-upsert': 'false' },
    body: bytes,
  });
  if (!response.ok) throw Object.assign(new Error('file_upload_failed'), { code: 'file_upload_failed' });
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}
