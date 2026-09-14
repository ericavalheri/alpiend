// Formatação do código de validação do certificado, do lado do navegador.
//
// A regra de gerar o código mora no servidor (lib/certificates.mjs) e não pode vir pra cá: ela
// usa o segredo da escola. O que a página precisa é só apresentar o código do jeito impresso —
// ESC-XXXX-XXXX — pra quem lê o rodapé digitar exatamente o que está vendo.
const TAMANHO = 8;
// Precisa casar com CODE_PREFIX do servidor (lib/certificates.mjs). Vite injeta variáveis de
// ambiente com prefixo VITE_ no navegador.
const PREFIXO = (import.meta.env?.VITE_CODE_PREFIX || 'ESC').toUpperCase();

export function normalizeCertificateCode(value = '') {
  const limpo = String(value || '').toUpperCase().replace(/[\s-]/g, '');
  const semPrefixo = limpo.startsWith(PREFIXO) ? limpo.slice(PREFIXO.length) : limpo;
  return semPrefixo.slice(0, TAMANHO);
}

export function certificateDisplayCode(value = '') {
  const limpo = normalizeCertificateCode(value);
  if (limpo.length !== TAMANHO) return String(value || '');
  return `${PREFIXO}-${limpo.slice(0, 4)}-${limpo.slice(4)}`;
}
