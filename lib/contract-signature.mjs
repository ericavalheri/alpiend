// Assinatura do contrato do Cabeleireiro (pedido da Erica, 09/09/2026).
//
// A escola quer que a aluna assine o contrato ANTES de pagar a matrícula. Isso muda o que o
// aceite significa: até aqui eram caixinhas de ciência; agora é um documento assinado, e um
// documento assinado precisa aguentar alguém perguntar depois "o que exatamente ela assinou?".
//
// Por isso o texto assinado é montado NO SERVIDOR, com os dados que a aluna preencheu, e o que
// fica guardado é a impressão digital (SHA-256) desse texto. Se o contrato mudar amanhã, a
// assinatura antiga continua apontando pro texto que ela realmente leu: basta remontar a
// versão daquela época e conferir se a impressão digital bate. Confiar no texto que o
// navegador manda não serviria — quem assina não pode ser quem escolhe o que assinou.
import crypto from 'node:crypto';
import { CONTRACT_VERSION, contractText } from '../src/lib/contracts.js';

const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTVWXYZ';
const TAMANHO = 8;
// Sigla da escola nos códigos públicos (ex.: ESC-4F2A-91BD). Os três módulos que geram código
// precisam do MESMO prefixo — com valores diferentes, um código gerado aqui não valida ali.
const PREFIXO = (process.env.CODE_PREFIX || 'ESC').toUpperCase();

export function contractFingerprint(texto) {
  return crypto.createHash('sha256').update(String(texto || ''), 'utf8').digest('hex');
}

// Código público da assinatura, no mesmo formato do certificado: ESC-XXXX-XXXX. Serve pra
// escola e aluna acharem o contrato assinado depois, sem depender de anexo de e-mail.
export function signatureCode(seed) {
  const chave = process.env.STUDENT_CONTRACT_SECRET || process.env.STUDENT_ACCESS_SECRET || '';
  const digest = chave
    ? crypto.createHmac('sha256', chave).update(`contrato:${seed}`).digest()
    : crypto.createHash('sha256').update(`contrato:${seed}`).digest();
  let codigo = '';
  for (let i = 0; i < TAMANHO; i += 1) codigo += ALFABETO[digest[i] % ALFABETO.length];
  return `${PREFIXO}-${codigo.slice(0, 4)}-${codigo.slice(4)}`;
}

// Compara nome digitado com nome do cadastro ignorando acento, caixa e espaço sobrando. Quem
// assina digitando o próprio nome erra o acento — recusar por causa de um "ç" seria implicância,
// mas assinar com um nome diferente do contratante não pode passar.
export function sameName(a = '', b = '') {
  const limpar = (valor) => String(valor || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
  return limpar(a) === limpar(b) && limpar(a).length > 0;
}

// Monta e valida a assinatura. Devolve o registro pronto pra guardar, ou o motivo da recusa —
// a recusa sempre em português, porque quem lê é a aluna no meio da matrícula.
export function buildContractSignature(payload = {}, audit = {}) {
  const {
    name = '', cpf = '', rg = '', address = '', whatsapp = '', email = '',
    classDate = '', signedName = '', contractAccepted = false,
    totalValue = '', enrollmentValue = '', paymentTerms = '',
  } = payload;

  if (!contractAccepted) return { ok: false, error: 'contract_not_accepted', message: 'Marque que leu e aceita o contrato para continuar.' };
  if (!signedName.trim()) return { ok: false, error: 'signature_required', message: 'Assine digitando seu nome completo, igual ao do cadastro.' };
  if (!sameName(signedName, name)) {
    return { ok: false, error: 'signature_name_mismatch', message: 'A assinatura precisa ser o mesmo nome completo do cadastro acima.' };
  }
  if (!rg.trim()) return { ok: false, error: 'rg_required', message: 'O contrato precisa do seu RG.' };
  if (!address.trim()) return { ok: false, error: 'address_required', message: 'O contrato precisa do seu endereço completo.' };

  const dataPorExtenso = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date());
  const texto = contractText(classDate, {
    name, cpf, rg, address, whatsapp, email,
    totalValue, enrollmentValue, paymentTerms,
    date: dataPorExtenso,
  });
  if (!texto) {
    return { ok: false, error: 'contract_not_available', message: 'Não encontrei o contrato desta turma. Fale com o atendimento antes de pagar.' };
  }

  const assinadoEm = audit.receivedAt || new Date().toISOString();
  return {
    ok: true,
    signature: {
      signedName: signedName.trim(),
      name,
      cpf,
      rg: rg.trim(),
      address: address.trim(),
      classDate,
      contractVersion: CONTRACT_VERSION,
      // A impressão digital do texto exato que ela leu. É o que responde "o que ela assinou?".
      contractFingerprint: contractFingerprint(texto),
      contractLength: texto.length,
      signedAt: assinadoEm,
      ip: audit.ip || null,
      userAgent: audit.userAgent || null,
      code: signatureCode(`${cpf}:${classDate}:${assinadoEm}`),
    },
    text: texto,
  };
}
