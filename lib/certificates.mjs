// Certificado da aluna: quando libera, e como qualquer pessoa confere se é verdadeiro.
//
// Regra combinada com a escola (09/09/2026): o certificado sai sozinho quando as DUAS coisas
// valem — a turma já terminou E a presença foi confirmada na porta. Confirmar presença no
// primeiro dia de um curso de dois dias não é concluir o curso, então só o check-in não basta.
//
// Cada certificado leva um código no rodapé. Quem receber o certificado (um salão, por
// exemplo) abre o endereço do rodapé e vê o mesmo documento no site da escola — se não abrir, o
// certificado não é da escola. O código é derivado da matrícula, então é sempre o mesmo pra
// mesma aluna no mesmo curso, e não expõe identificador interno nenhum.
import crypto from 'node:crypto';
import { isClassFinished } from '../src/lib/format.js';

// Mesmo alfabeto do check-in (sem 0/O/1/I/U), porque o código também vai ser lido e digitado
// por gente. 8 posições: são 32^8, mais de um trilhão de combinações — ninguém acha o
// certificado de outra pessoa por tentativa.
const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTVWXYZ';
const TAMANHO = 8;
// Sigla da escola nos códigos públicos (ex.: ESC-4F2A-91BD). Os três módulos que geram código
// precisam do MESMO prefixo — com valores diferentes, um código gerado aqui não valida ali.
const PREFIXO = (process.env.CODE_PREFIX || 'ESC').toUpperCase();

function segredo() {
  return process.env.STUDENT_CERTIFICATE_SECRET || process.env.STUDENT_ACCESS_SECRET || '';
}

export function certificateCode(enrollmentId) {
  const id = String(enrollmentId || '').trim();
  if (!id) return '';
  const chave = segredo();
  const digest = chave
    ? crypto.createHmac('sha256', chave).update(`certificado:${id}`).digest()
    : crypto.createHash('sha256').update(`certificado:${id}`).digest();
  let codigo = '';
  for (let i = 0; i < TAMANHO; i += 1) codigo += ALFABETO[digest[i] % ALFABETO.length];
  return `${PREFIXO}-${codigo.slice(0, 4)}-${codigo.slice(4)}`;
}

export function normalizeCertificateCode(value = '') {
  const limpo = String(value || '').toUpperCase().replace(/[\s-]/g, '');
  const semPrefixo = limpo.startsWith(PREFIXO) ? limpo.slice(PREFIXO.length) : limpo;
  return semPrefixo.slice(0, TAMANHO);
}

// Forma de mostrar e de imprimir: ESC-XXXX-XXXX. O endereço usa a MESMA string, pra quem lê o
// rodapé digitar exatamente o que está vendo — código de um jeito e link de outro é convite pro
// salão desistir de conferir.
export function certificateDisplayCode(code) {
  const limpo = normalizeCertificateCode(code);
  if (limpo.length !== TAMANHO) return '';
  return `${PREFIXO}-${limpo.slice(0, 4)}-${limpo.slice(4)}`;
}

export function certificatePublicPath(code) {
  return `/certificado/${certificateDisplayCode(code)}`;
}

// A regra, isolada de propósito: é a única coisa que decide se uma aluna tem certificado, e
// precisa dar pra conferir sem banco nenhum.
//
// Sem pagamento não há certificado, mesmo com presença confirmada — presença de quem não pagou
// é erro de porta, não conclusão de curso.
export function certificateIsDue({ paid = false, classDate = '', checkInConfirmed = false } = {}) {
  if (!paid) return { due: false, reason: 'matrícula sem pagamento confirmado' };
  if (!checkInConfirmed) return { due: false, reason: 'presença ainda não confirmada' };
  if (!isClassFinished(classDate)) return { due: false, reason: 'turma ainda não terminou' };
  return { due: true, reason: '' };
}
