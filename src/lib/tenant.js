// IDENTIDADE DA ESCOLA — PREENCHA ESTE ARQUIVO PRIMEIRO.
//
// Tudo o que é específico do cliente mora aqui, num lugar só. No projeto de origem essa
// informação estava espalhada por mais de cem arquivos, e isso é exatamente o que torna uma
// troca de cliente arriscada: basta um lugar esquecido para o CNPJ, o endereço ou o WhatsApp
// de outra escola ir para o ar.
//
// Os campos marcados com PREENCHER estão vazios de propósito. O arquivo
// scripts-check-identidade.mjs reprova a publicação enquanto algum deles continuar em branco,
// então nada sobe pela metade.

export const tenant = {
  // --- Identificação pública ---
  nome: '',                      // PREENCHER — nome curto, como aparece no site. Ex.: 'Studio Bella'
  nomeCompleto: '',              // PREENCHER — nome por extenso, para títulos e e-mails
  descricao: '',                 // PREENCHER — uma linha sobre a escola, usada em meta tags

  // --- Identificação jurídica (vai para o contrato assinado) ---
  razaoSocial: '',               // PREENCHER — razão social exata, como no cartão CNPJ
  cnpj: '',                      // PREENCHER — formato 00.000.000/0001-00
  enderecoCompleto: '',          // PREENCHER — endereço da sede, com CEP

  // --- Onde as aulas acontecem (aparece nos cards e no contrato) ---
  local: '',                     // PREENCHER — endereço resumido. Ex.: 'Rua X, 100 — Centro, Cidade/UF'
  localCurto: '',                // PREENCHER — versão curta para o card. Ex.: 'Rua X, 100 — Centro'

  // --- Contato ---
  email: '',                     // PREENCHER — e-mail de atendimento
  whatsapp: '',                  // PREENCHER — só dígitos, com 55 e DDD. Ex.: '5511999999999'
  whatsappVisivel: '',           // PREENCHER — como aparece na tela. Ex.: '(11) 99999-9999'
  atendimento: '',               // PREENCHER — Ex.: 'Segunda a sexta, das 10h às 18h'

  // --- Endereços na internet ---
  dominio: '',                   // PREENCHER — domínio da agenda, sem https. Ex.: 'agenda.escola.com.br'
  site: '',                      // PREENCHER — site institucional, se houver
  instagram: '',                 // opcional — URL completa
  mapa: '',                      // opcional — link do Google Maps

  // --- Grupo de captação (deixe vazio se a escola não tiver) ---
  grupoWhatsapp: '',             // opcional — link de convite do grupo
  nomeDoClube: '',               // opcional — como o grupo é chamado na tela. Ex.: 'Clube Studio Bella'
};

// A escola já tem tudo o que o sistema precisa para funcionar?
export function identidadeIncompleta() {
  const obrigatorios = [
    'nome', 'nomeCompleto', 'descricao', 'razaoSocial', 'cnpj', 'enderecoCompleto',
    'local', 'localCurto', 'email', 'whatsapp', 'whatsappVisivel', 'atendimento', 'dominio',
  ];
  return obrigatorios.filter((campo) => !String(tenant[campo] || '').trim());
}
