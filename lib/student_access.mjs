import crypto from 'node:crypto';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64url(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function accessSecret() {
  return process.env.STUDENT_ACCESS_SECRET || process.env.ADMIN_SESSION_SECRET || '';
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length || !left.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function studentAccessConfigured() {
  return accessSecret().length >= 32;
}

export function signStudentAccess(payload = {}) {
  const secret = accessSecret();
  if (secret.length < 32) {
    const error = new Error('student_access_secret_not_configured');
    error.code = 'student_access_secret_not_configured';
    throw error;
  }
  const body = {
    sid: payload.studentId || payload.student_id || null,
    eid: payload.enrollmentId || payload.enrollment_id || null,
    exp: payload.exp || Date.now() + 1000 * 60 * 60 * 24 * 45,
  };
  if (!body.sid && !body.eid) {
    const error = new Error('student_access_identity_required');
    error.code = 'student_access_identity_required';
    throw error;
  }
  const encoded = base64url(JSON.stringify(body));
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyStudentAccess(token = '') {
  const secret = accessSecret();
  if (secret.length < 32) {
    const error = new Error('student_access_secret_not_configured');
    error.code = 'student_access_secret_not_configured';
    throw error;
  }
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) {
    const error = new Error('invalid_student_access_token');
    error.code = 'invalid_student_access_token';
    throw error;
  }
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (!safeEqual(expected, signature)) {
    const error = new Error('invalid_student_access_token');
    error.code = 'invalid_student_access_token';
    throw error;
  }
  const parsed = JSON.parse(fromBase64url(encoded));
  if (!parsed.exp || Number(parsed.exp) < Date.now()) {
    const error = new Error('expired_student_access_token');
    error.code = 'expired_student_access_token';
    throw error;
  }
  return parsed;
}

export function buildStudentAccessUrl(payload = {}) {
  const baseUrl = (process.env.STUDENT_PORTAL_BASE_URL || 'https://DOMINIO-NAO-CONFIGURADO/aluno').replace(/\/$/, '');
  const token = signStudentAccess(payload);
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}token=${encodeURIComponent(token)}`;
}
