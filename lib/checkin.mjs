// Check-in da aula por código.
//
// Como funciona no dia a dia (pedido da Erica, 08/09/2026): a aluna abre a Minha Área e vê um
// código curto da matrícula dela; na porta, a equipe digita esse código no painel e confirma a
// presença. A confirmação só vale se a matrícula existir, for daquela aluna e estiver PAGA —
// a regra mora no servidor (lib/db.mjs, confirmStudentCheckIn), não no botão.
//
// O código não é guardado em coluna nenhuma: é derivado da própria matrícula, sempre igual pra
// mesma matrícula e diferente pra todas as outras. Assim não precisa de migração, não tem
// código órfão quando uma matrícula é arquivada, e nada quebra se o banco for restaurado.
import crypto from 'node:crypto';

// Alfabeto sem 0/O/1/I/U: quem lê o código em voz alta na porta não erra entre zero e O, nem
// entre um e i. Sobram 32 símbolos — com 6 posições dá mais de 1 bilhão de combinações, longe
// demais pra alguém chutar o código de outra aluna.
const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTVWXYZ';
const TAMANHO = 6;
// Sigla da escola nos códigos públicos (ex.: ESC-4F2A-91BD). Os três módulos que geram código
// precisam do MESMO prefixo — com valores diferentes, um código gerado aqui não valida ali.
const PREFIXO = (process.env.CODE_PREFIX || 'ESC').toUpperCase();

function checkInSecret() {
  // Com segredo, o código é imprevisível pra quem não tem a chave. Sem segredo configurado ele
  // ainda é estável e não óbvio (nunca expõe o id da matrícula), só não é imprevisível — vale
  // pra ambiente de teste, não pra produção.
  return process.env.STUDENT_CHECKIN_SECRET || process.env.STUDENT_ACCESS_SECRET || '';
}

export function checkInSecretConfigured() {
  return checkInSecret().length >= 32;
}

// Código da matrícula, no formato ESC-XXX-XXX. Mesma matrícula, sempre o mesmo código.
export function checkInCodeFor(enrollmentId) {
  const id = String(enrollmentId || '').trim();
  if (!id) return '';
  const secret = checkInSecret();
  const digest = secret
    ? crypto.createHmac('sha256', secret).update(`checkin:${id}`).digest()
    : crypto.createHash('sha256').update(`checkin:${id}`).digest();
  let code = '';
  for (let i = 0; i < TAMANHO; i += 1) code += ALFABETO[digest[i] % ALFABETO.length];
  return `${PREFIXO}-${code.slice(0, 3)}-${code.slice(3)}`;
}

// Normaliza o que a equipe digitou: aceita com ou sem o "a escola", com traço, espaço ou nada, em
// maiúscula ou minúscula. Não "conserta" letra trocada — código errado tem que falhar na cara,
// e não bater na matrícula de outra pessoa.
export function normalizeCheckInCode(value = '') {
  const limpo = String(value || '').toUpperCase().replace(/[\s-]/g, '');
  const semPrefixo = limpo.startsWith(PREFIXO) ? limpo.slice(PREFIXO.length) : limpo;
  return semPrefixo.slice(0, TAMANHO);
}

export function checkInCodeMatches(enrollmentId, typed) {
  const esperado = normalizeCheckInCode(checkInCodeFor(enrollmentId));
  const recebido = normalizeCheckInCode(typed);
  if (esperado.length !== TAMANHO || recebido.length !== TAMANHO) return false;
  return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}

// Acha a matrícula dona do código dentro de uma lista já carregada. Devolve null quando o
// código não bate com nenhuma — nunca a "mais parecida".
export function findEnrollmentByCheckInCode(enrollments = [], typed = '') {
  if (normalizeCheckInCode(typed).length !== TAMANHO) return null;
  return enrollments.find((enrollment) => checkInCodeMatches(enrollment?.id, typed)) || null;
}
