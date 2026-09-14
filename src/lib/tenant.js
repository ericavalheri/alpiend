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
  nome: 'Alpiend',
  nomeCompleto: '',              // PREENCHER — "Alpiend" ou "Alpiend Brasil"? confirmar nome por extenso
  descricao: 'Centro de treinamento em alpinismo industrial e acesso por corda em Praia Grande/SP, com instrutores certificados IRATA.',

  // --- Identificação jurídica (vai para o contrato assinado, se houver) ---
  razaoSocial: '',               // PREENCHER — razão social exata, como no cartão CNPJ
  cnpj: '',                      // PREENCHER — formato 00.000.000/0001-00
  enderecoCompleto: 'Rua Joséfa Alves de Siqueira, 509 — Anhanguera, Praia Grande/SP, 11718-000',

  // --- Onde as aulas acontecem (aparece nos cards e no contrato) ---
  local: 'Rua Joséfa Alves de Siqueira, 509 — Anhanguera, Praia Grande/SP, 11718-000',
  localCurto: 'Anhanguera, Praia Grande/SP',

  // --- Contato ---
  email: '',                     // PREENCHER — e-mail de atendimento
  whatsapp: '5513996763931',     // (13) 99676-3931, do perfil do Google
  whatsappVisivel: '(13) 99676-3931',
  atendimento: '',               // PREENCHER — horário completo, ex.: 'Segunda a sexta, das 8h às 18h30'

  // --- Endereços na internet ---
  dominio: 'agenda.alpiend.com',
  site: 'alpiend.com',
  instagram: 'https://www.instagram.com/alpiendalpinismo/',
  mapa: '',                      // opcional — link do Google Maps

  // --- Grupo de captação (deixe vazio se a escola não tiver) ---
  grupoWhatsapp: '',             // opcional — link de convite do grupo
  nomeDoClube: '',               // opcional — como o grupo é chamado na tela. Ex.: 'Clube Alpiend'
};

// A escola já tem tudo o que o sistema precisa para funcionar?
export function identidadeIncompleta() {
  const obrigatorios = [
    'nome', 'nomeCompleto', 'descricao', 'razaoSocial', 'cnpj', 'enderecoCompleto',
    'local', 'localCurto', 'email', 'whatsapp', 'whatsappVisivel', 'atendimento', 'dominio',
  ];
  return obrigatorios.filter((campo) => !String(tenant[campo] || '').trim());
}
