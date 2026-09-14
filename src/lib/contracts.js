import { tenant } from './tenant.js';

// CONTRATO DE MATRÍCULA — só preencha se algum curso desta escola exigir assinatura eletrônica
// antes do pagamento. Curso que não aparece em CLASS_TABLES simplesmente não pede contrato, e a
// matrícula segue o fluxo normal (ver ContractSummary em src/components/shared.jsx e o formulário
// de aceite em src/pages/checkout.jsx).
//
// Por que este arquivo existe: quando há contrato, ele é o documento que a aluna assina antes de
// pagar. Ele precisa ser exatamente o mesmo para todo mundo, versionado junto com o resto do
// sistema, e conferível depois — por isso mora no código em vez de um link solto. Quando o
// contrato mudar, sobe a versão (CONTRACT_VERSION); assinatura antiga continua apontando para a
// versão que a aluna realmente leu (ver lib/contract-signature.mjs).
//
// Este arquivo nasceu como cópia de outro projeto e o contrato real da escola anterior foi
// removido daqui de propósito — cláusula de contrato assinado é a última coisa que devia
// sobreviver a uma troca de cliente. Cole abaixo o contrato real da Alpiend (revisado por
// advogado), turma a turma se necessário.
//
// O contrato tem lacunas no formato {{NOME COMPLETO}}, {{CPF}}, {{RG}}, {{ENDEREÇO}},
// {{TELEFONE}}, {{EMAIL}}, {{DATA}} e {{CANAL LGPD}} — fillContract() preenche essas com os dados
// de quem assina. Lacuna sem valor fica visível como lacuna, nunca vira texto vazio.

// Muda quando o TEXTO do contrato mudar. Fica gravado junto de cada assinatura: é assim que se
// prova, depois, qual versão a aluna leu.
export const CONTRACT_VERSION = '1.0';

export const CONTRACT_TITLE = ''; // PREENCHER — ex.: 'Contrato de prestação de serviços educacionais'

// Corpo do contrato, parágrafo a parágrafo. Linha que termina sem ponto e é curta é título de
// seção — a página usa isso pra formatar, sem mexer no texto. Deixe vazio enquanto o contrato
// não existir; a matrícula funciona normalmente sem ele.
export const CONTRACT_BODY = [];

export const CONTRACT_ANNEX = [];

export const CONTRACT_SIGNATURE_NOTICE = [];

// Aviso de pré-venda (desconto por tempo limitado). Aparece só em cursos com flow: 'voomp'
// (ver PreSaleNotice em src/components/shared.jsx). Deixe os três campos vazios se a escola não
// tiver promoção de pré-venda ativa — o componente não renderiza nada quando estão em branco.
export const PRE_SALE_NOTICE = {
  titulo: '',  // PREENCHER — ex.: 'Valor exclusivo de pré-venda'
  texto: '',   // PREENCHER — texto completo, com o prazo e a ressalva de vagas
  curto: '',   // PREENCHER — versão curta para o card da agenda
};

// Quadro de cada turma que exige contrato assinado. A CHAVE é o texto exato da turma no
// catálogo (src/catalog.js) — é por ela que o sistema encontra o contrato certo.
//
// Curso sem entrada aqui simplesmente não pede assinatura, e a matrícula segue o fluxo normal.
// Deixe vazio se nenhum curso desta escola tiver contrato assinado.
//
// Modelo, para copiar e preencher:
//
// 'Turma Manhã — 10 de Março a 20 de Junho de 2027': {
//   turma: 'MANHÃ',
//   inicio: '10 de março de 2027 (podendo sofrer alterações)',
//   termino: '20 de junho de 2027 (podendo sofrer alterações)',
//   diasEHorario: 'Segunda e terça-feira, 09h às 13h',
//   cargaPresencial: '240h',
//   valorTotal: 5000.00,        // o que a aluna paga, já com desconto de pré-venda, se houver
//   valorSemPreVenda: 6250.00,  // preço cheio. Para um desconto real de X%, divida o
//                               // valorTotal por (1 - X/100) — nunca multiplique por (1 + X/100)
// },
export const CLASS_TABLES = {};

// Formata em real, do jeito que o contrato escreve: R$ 5.037,60.
function emReais(valor) {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
}

// Quantos pagamentos iguais compõem o total de um curso com contrato: 1 inscrição + N parcelas.
// A inscrição NUNCA é tratada como a primeira de N parcelas separadas — ela é 1 dos
// PAGAMENTOS_COM_CONTRATO pagamentos iguais que somam o total. Fica num número nomeado, num
// lugar só, em vez de uma divisão solta pelo código, porque é exatamente o tipo de conta que
// diverge quando escrita em mais de um lugar.
//
// PREENCHER quando o modelo de parcelamento da Alpiend for definido — ex.: 13 = inscrição + 12
// parcelas.
export const PAGAMENTOS_COM_CONTRATO = 1;

// Inscrição e parcelas de uma turma, calculadas do total.
export function contractMoney(classDate) {
  const quadro = CLASS_TABLES[classDate];
  if (!quadro) return null;
  const totalCentavos = Math.round(quadro.valorTotal * 100);
  const parcelaCentavos = Math.round(totalCentavos / PAGAMENTOS_COM_CONTRATO);
  return {
    total: quadro.valorTotal,
    totalTexto: emReais(totalCentavos / 100),
    matricula: parcelaCentavos / 100,
    matriculaTexto: emReais(parcelaCentavos / 100),
    saldo: (totalCentavos - parcelaCentavos) / 100,
    saldoTexto: emReais((totalCentavos - parcelaCentavos) / 100),
    parcelas: PAGAMENTOS_COM_CONTRATO - 1,
    semPreVendaTexto: emReais(quadro.valorSemPreVenda),
  };
}

// Linhas do quadro que são iguais em todas as turmas do curso com contrato.
// PREENCHER com os dados da formação desta escola.
export const CLASS_TABLE_FIXED = {
  nomeOficial: '',                  // PREENCHER — nome oficial da formação, como no contrato
  cargaOnline: '',                  // PREENCHER — ex.: '48h'. Deixe '' se não houver parte online
  certificadoraUniversitaria: '',   // opcional — instituição de ensino superior parceira
  resolucao: '',                    // opcional — número e data da resolução institucional
  certificadora: tenant.nomeCompleto,
  local: tenant.local,
};

// O contrato tem lacunas ({{NOME COMPLETO}}, {{CPF}}...) pra preencher com os dados de quem
// assina. Preencher aqui, e não no navegador, garante que o texto assinado é o mesmo que o
// servidor guarda — é ele que calcula a impressão digital da assinatura.
export function fillContract(texto, dados = {}) {
  const valores = {
    'NOME COMPLETO': dados.name || '',
    NOME: dados.name || '',
    CPF: dados.cpf || '',
    RG: dados.rg || '',
    'ENDEREÇO': dados.address || '',
    TELEFONE: dados.whatsapp || '',
    EMAIL: dados.email || '',
    VALOR: dados.value || '',
    'CONDIÇÃO': dados.paymentTerms || '',
    DATA: dados.date || '',
    'CANAL LGPD': dados.lgpdChannel || tenant.email,
  };
  return String(texto).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (original, chave) => {
    const valor = valores[chave.trim()];
    // Lacuna sem valor fica visível como lacuna, nunca vira texto vazio: contrato com um
    // espaço em branco no lugar do CPF é pior do que um contrato que mostra o que falta.
    return valor || original;
  });
}

// Todo o contrato de uma turma, já preenchido, numa string só. É esta string que a aluna lê,
// que é assinada, e de onde sai a impressão digital guardada com a assinatura.
export function contractText(classDate, dados = {}) {
  const quadro = CLASS_TABLES[classDate];
  if (!quadro) return '';
  const dinheiro = contractMoney(classDate);
  const linhasDoQuadro = [
    'QUADRO DA TURMA - PARTE INTEGRANTE DO CONTRATO',
    `Nome oficial da formação: ${CLASS_TABLE_FIXED.nomeOficial}`,
    `Turma: ${quadro.turma}`,
    `Início: ${quadro.inicio}`,
    `Término: ${quadro.termino}`,
    `Dias e horário: ${quadro.diasEHorario}`,
    `Carga horária presencial: ${quadro.cargaPresencial}`,
    `Carga horária online: ${CLASS_TABLE_FIXED.cargaOnline}`,
    `Instituição certificadora (extensão universitária): ${CLASS_TABLE_FIXED.certificadoraUniversitaria}`,
    `Resolução institucional: ${CLASS_TABLE_FIXED.resolucao}`,
    `Instituição certificadora: ${CLASS_TABLE_FIXED.certificadora}`,
    `Local principal: ${CLASS_TABLE_FIXED.local}`,
    // As três linhas de dinheiro saem do MESMO número (o total da turma, em CLASS_TABLES), para
    // eliminar a possibilidade de "valor total", "matrícula" e "forma de pagamento" divergirem
    // por virem de três lugares diferentes.
    `Valor total: ${dinheiro.totalTexto}${quadro.valorSemPreVenda ? ` (preço de pré-venda, sobre ${dinheiro.semPreVendaTexto})` : ''}`,
    `Matrícula: ${dinheiro.matriculaTexto} (inscrição)`,
    `Forma de pagamento: inscrição de ${dinheiro.matriculaTexto}, mais ${dinheiro.parcelas}x de ${dinheiro.matriculaTexto} sem juros (${dinheiro.saldoTexto}), totalizando ${dinheiro.totalTexto}.`,
  ];
  const tudo = [
    CONTRACT_TITLE,
    ...CONTRACT_BODY,
    ...linhasDoQuadro,
    ...CONTRACT_ANNEX,
    ...CONTRACT_SIGNATURE_NOTICE,
  ].join('\n');
  return fillContract(tudo, dados);
}
