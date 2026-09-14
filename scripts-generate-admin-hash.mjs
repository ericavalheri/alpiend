import crypto from 'node:crypto';

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Uso: node scripts-generate-admin-hash.mjs "senha-com-12+-caracteres"');
  process.exit(1);
}
const iterations = 210000;
const salt = crypto.randomBytes(16).toString('base64url');
const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64url');
console.log(`ADMIN_PASSWORD_HASH=pbkdf2_sha256$${iterations}$${salt}$${hash}`);
console.log(`ADMIN_SESSION_SECRET=${crypto.randomBytes(32).toString('base64url')}`);
