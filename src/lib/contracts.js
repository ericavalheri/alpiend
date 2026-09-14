import { tenant } from './tenant.js';

// Contrato de prestação de serviços educacionais da Formação em Cabeleireiro Profissional.
//
// O texto abaixo é o contrato que a ${tenant.nome} enviou (versão de 10/09/2026), palavra por palavra. Ele mora no
// código porque é o documento que a aluna assina antes de pagar a matrícula: precisa ser
// exatamente o mesmo pra todo mundo, versionado junto com o resto do sistema, e conferível
// depois. Quando a escola mudar o contrato, sobe a versão aqui — assinatura antiga continua
// apontando pra versão que ela realmente leu.
//
// As três turmas (Sábado, Diurno e Noite) compartilham o contrato inteiro: só o Quadro da
// Turma muda. Por isso o texto é um só e o quadro é uma tabela por turma.
//
// Três coisas do Word saem daqui de propósito, e ficam anotadas pra ninguém achar que é falha
// de cópia:
//   1. As duas linhas de sublinhado pra assinar a caneta. Aqui a assinatura é eletrônica; no
//      lugar delas o contrato registra as partes e diz como a assinatura foi feita.
//   2. "Instituição certificadora Extentensão Universitária" está escrito assim no Word. O
//      rótulo do quadro fica "(extensão universitária)" — é rótulo de tabela, não cláusula.
//   3. Dias e horário: o Word varia o espaçamento ("terça -feira 09 as 17:00"). O quadro usa a
//      mesma informação com pontuação regular.
// Cláusula é copiada palavra por palavra; conferido pelos três .docx a cada versão.

// Muda quando o TEXTO do contrato mudar. Fica gravado junto de cada assinatura: é assim que a
// ${tenant.nome} prova, depois, qual versão a aluna leu.
export const CONTRACT_VERSION = '2027.3';

export const CONTRACT_TITLE = 'Contrato de prestação de serviços educacionais — Formação em Cabeleireiro Profissional';

// Corpo do contrato, parágrafo a parágrafo. Linha que termina sem ponto e é curta é título de
// seção — a página usa isso pra formatar, sem mexer no texto.
export const CONTRACT_BODY = [
  "CONTRATO DE PRESTAÇÃO DE SERVIÇOS EDUCACIONAIS",
  "FORMAÇÃO EM CABELEIREIRO PROFISSIONAL",
  "Arte, Técnica e Empreendedorismo",
  `CONTRATADA: ${tenant.razaoSocial}, CNPJ nº ${tenant.cnpj}, com sede em ${tenant.enderecoCompleto}.`,
  "CONTRATANTE/ALUNO(A): {{NOME COMPLETO}}, CPF {{CPF}}, RG {{RG}}, endereço {{ENDEREÇO}}, telefone {{TELEFONE}}, e-mail {{EMAIL}}.",
  "As partes celebram este contrato de forma clara e objetiva, conforme as condições abaixo e a legislação aplicável, especialmente o Código de Defesa do Consumidor, o Código Civil e a Lei Geral de Proteção de Dados Pessoais.",
  "1. OBJETO E CERTIFICAÇÃO",
  `1.1. ${tenant.nome} prestará os serviços educacionais da Formação em Cabeleireiro Profissional - Arte, Técnica e Empreendedorismo, conforme calendário, carga horária e conteúdo descritos no Quadro da Turma e no Anexo Acadêmico.`,
  `1.2. A formação profissional realizada ${tenant.nome} está vinculada a certificação de extensão universitária emitida por instituição de ensino superior parceira, conforme resolução institucional aplicável à turma. A identificação da instituição emissora, número da resolução e carga horária certificada constarão no Quadro da Turma após a atualização formal atualmente em andamento.`,
  "1.3. A certificação de extensão universitária decorre da aprovação institucional da instituição de ensino superior emissora.",
  `1.4. A certificação será concedida ao aluno que cumprir os requisitos acadêmicos previstos neste contrato. ${tenant.nome} não garante emprego, contratação, renda ou resultado profissional específico.`,
  `2. O QUE ${tenant.nome} SE COMPROMETE A ENTREGAR`,
  "conteúdo, carga horária e atividades previstas para a turma;",
  "profissionais qualificados e substituição por profissional de qualificação compatível quando necessário;",
  "estrutura, produtos, materiais e equipamentos indicados como incluídos;",
  "ambiente adequado às atividades práticas, com regras de higiene e biossegurança;",
  "comunicação prévia de alterações relevantes de calendário, sempre que possível;",
  "certificação aos alunos que cumprirem os requisitos acadêmicos e as condições da instituição certificadora.",
  "2.1. Ajustes de calendário, docentes ou sequência de conteúdo poderão ocorrer por necessidade pedagógica, força maior ou disponibilidade justificada, sem redução indevida da carga horária ou da qualidade contratada.",
  "3. COMPROMISSOS DO ALUNO",
  "3.1. O aluno deverá participar das aulas e atividades, cumprir as orientações técnicas e de segurança, respeitar equipe, colegas, modelos e terceiros, zelar pelos equipamentos e utilizar o uniforme exigido.",
  "3.2. Para certificação, deverá cumprir no mínimo 75% de frequência presencial em cada módulo, 100% das atividades online obrigatórias e os trabalhos, avaliações, Prática Profissional Supervisionada e TCC previstos para a turma.",
  "3.3. A tolerância para atraso é de 15 minutos. Após esse período, a entrada poderá ser impedida quando comprometer a segurança ou a atividade pedagógica. Atrasos e faltas serão registrados.",
  "3.4. Descumprimentos reiterados poderão gerar advertência. Três advertências formais poderão resultar em desligamento, após comunicação e oportunidade de justificativa. Condutas graves, como agressão, ameaça, assédio, discriminação, fraude, furto, dano intencional ou risco à segurança, poderão justificar afastamento ou desligamento imediato.",
  "3.5. A ausência do aluno não gera, por si só, direito a reposição individual ou devolução do valor da aula. Eventual reposição dependerá da natureza da atividade e da disponibilidade da escola.",
  "4. PRÁTICA PROFISSIONAL, MODELOS E ATIVIDADES EXTERNAS",
  "4.1. A formação poderá incluir atendimentos supervisionados a modelos, visitas técnicas, feiras, ações sociais e outras atividades relacionadas ao conteúdo. Quando integrarem a carga horária, serão previamente informadas.",
  "4.2. A atividade prática realizada no ambiente educacional será denominada Prática Profissional Supervisionada.",
  "4.3. Imagens de modelos ou clientes somente poderão ser divulgadas mediante autorização adequada. O aluno não poderá publicar imagens de terceiros sem consentimento.",
  "5. PREÇO E PAGAMENTO",
  // Versão 2027.2: era "O valor total, matrícula" — dava pra ler como se a Voomp cobrasse o
  // curso inteiro. A escola corrigiu pra "O valor da matrícula", que é o que de fato acontece.
  "5.1. O valor da matrícula, deve ser efetuado pela Plataforma parceira Voomp, dando acesso as aulas on line e confirmando a inscrição do aluno.",
  `5.3. Em caso de inadimplência das mensalidades, a ${tenant.nome} poderá realizar cobrança e, em caso de atraso, incidirão multa de 2% sobre a parcela vencida, juros de 1% ao mês calculados proporcionalmente aos dias de atraso e atualização monetária quando aplicável. após comunicação e prazo razoável para regularização, adotar medidas sobre acessos e continuidade contratual permitidas pela legislação. O aluno não será exposto ou constrangido na cobrança.`,
  "6. CANCELAMENTO, DESISTÊNCIA E RESERVA DA VAGA",
  "6.1. Nas contratações realizadas fora do estabelecimento comercial, inclusive internet, telefone ou WhatsApp, o consumidor terá o direito de arrependimento pelo prazo legal de 7 dias, com restituição dos valores na forma da lei.",
  `6.2. O cancelamento deverá ser solicitado formalmente por um dos canais disponibilizados ${tenant.nome}. O simples abandono ou ausência às aulas não cancela o contrato.`,
  "6.3. Após o início do curso, a vaga do aluno fica reservada em turma fechada e sequencial e, em razão do avanço do conteúdo, não pode ser comercializada novamente. Por isso, no cancelamento imotivado solicitado pelo aluno serão devidos: (a) os valores correspondentes aos serviços já prestados ou disponibilizados até a data do pedido; e (b) multa compensatória de 80% sobre o saldo contratual vincendo.",
  `6.4. Não há garantia de trancamento ou transferência para outra turma. Quando possível, a ${tenant.nome} poderá autorizar remanejamento conforme disponibilidade e compatibilidade acadêmica.`,
  "7. PROPRIEDADE INTELECTUAL",
  `7.1. Apostilas, apresentações, vídeos, materiais digitais, marcas, identidade visual e demais conteúdos produzidos ou licenciados ${tenant.nome} permanecem protegidos. O aluno poderá aplicar profissionalmente as técnicas e conhecimentos aprendidos, mas não poderá copiar, vender, distribuir ou disponibilizar materiais proprietários da escola, nem compartilhar acessos às plataformas.`,
  "7.2. Trabalhos, TCC e criações autorais próprias do aluno permanecem de sua titularidade, respeitados os direitos de terceiros. Violações comprovadas poderão gerar as medidas legais cabíveis e responsabilização proporcional aos prejuízos efetivamente causados.",
  "8. IMAGEM, NOME E VOZ",
  "8.1. O(A) aluno(a) autoriza, de forma gratuita, o uso de sua imagem, nome e voz, registrados durante aulas, atividades, eventos e ações da escola, para divulgação institucional e promocional em redes sociais, site, campanhas e demais canais de comunicação da escola.",
  "8.2. A autorização poderá ser revogada por escrito para novas utilizações, preservando-se os materiais já produzidos ou publicados anteriormente, conforme a legislação aplicável.",
  "9. PROTEÇÃO DE DADOS - LGPD",
  `9.1. ${tenant.nome} tratará os dados necessários à matrícula, execução do curso, comunicação, certificação, pagamento, segurança e cumprimento de obrigações legais. Poderá compartilhar os dados estritamente necessários com plataformas educacionais, assinatura eletrônica, pagamento e a instituição de ensino superior responsável pela certificação.`,
  "9.2. Informações de saúde ou acessibilidade somente serão solicitadas quando necessárias e receberão tratamento compatível com sua natureza sensível. O aluno poderá exercer seus direitos de proteção de dados pelo canal {{CANAL LGPD}}.",
  `10. ALTERAÇÕES, CANCELAMENTO PELA ${tenant.nome} E FORÇA MAIOR`,
  `10.1. Se a ${tenant.nome} cancelar a turma antes do início e não houver alternativa aceita pelo aluno, os valores pagos serão restituídos. Se houver impossibilidade definitiva de continuidade após o início, a ${tenant.nome} oferecerá solução equivalente ou realizará o ajuste financeiro proporcional cabível, respeitados os direitos do consumidor.`,
  "10.2. Situações temporárias de força maior poderão gerar remarcação ou solução pedagógica equivalente, preservada a entrega contratada.",
  "11. VIGÊNCIA, COMUNICAÇÕES E FORO",
  "11.1. Este contrato vigora da assinatura até o encerramento das obrigações acadêmicas e financeiras, permanecendo válidas após o término apenas as obrigações que, por sua natureza, devam continuar.",
  "11.2. Comunicações acontecerão por WhatsApp, e-mail, plataforma educacional ou outro canal cadastrado. Cancelamentos e solicitações relevantes deverão permitir comprovação da data e do conteúdo do pedido.",
  "11.3. Eventuais conflitos serão preferencialmente resolvidos de forma administrativa. Ficam preservados o foro do domicílio do consumidor e os demais foros legalmente competentes."
];

export const CONTRACT_ANNEX = [
  "ANEXO ACADÊMICO - CONTEÚDO ESSENCIAL",
  "O conteúdo detalhado seguirá o plano pedagógico vigente da turma. Em síntese, a formação abrange: mercado, atendimento e postura profissional; tricologia, lavatório e tratamentos; escova e modelagens; visagismo; corte; colorimetria; mechas; mudanças de estrutura; empreendedorismo, finanças, legislação, precificação e responsabilidade profissional; prática supervisionada e TCC, conforme aplicável à turma.",
  "A versão entregue ao aluno deverá refletir exatamente o calendário e a carga horária efetivamente aprovados para a turma e para a certificação universitária."
];

export const CONTRACT_SIGNATURE_NOTICE = [
  "CIÊNCIA E ASSINATURAS",
  "O CONTRATANTE declara que recebeu este contrato e seus anexos antes da assinatura e teve acesso às informações essenciais sobre conteúdo, carga horária, preço, frequência, certificação e regras de cancelamento.",
  "São Paulo, {{DATA}}.",
  // O bloco de partes existe no contrato em Word e não estava sendo montado aqui (corrigido na
  // versão 2027.2): o documento terminava na data, sem dizer quem assina de cada lado.
  //
  // No papel são duas linhas em branco pra caneta. Aqui a assinatura é eletrônica, então as
  // linhas viram o registro do que de fato acontece — quem contrata, quem é contratado, e que
  // o comprovante da assinatura fica com a escola. Fingir linha de caneta num documento
  // assinado por digitação seria descrever errado o que foi feito.
  `CONTRATADA: ${tenant.razaoSocial}`,
  "CONTRATANTE/ALUNO(A): {{NOME}} - CPF {{CPF}}",
  "Este contrato é assinado eletronicamente pelo CONTRATANTE no ato da matrícula. O registro da assinatura — nome digitado, data, hora, endereço de origem e o código de verificação do documento — fica arquivado ${tenant.nome} e pode ser conferido a qualquer momento."
];

// Quadro da Turma: a única parte que muda entre as três turmas. As chaves são os rótulos
// exatos do contrato em Word, na mesma ordem.
//
// Versão 2027.2 (10/09/2026): valor total e matrícula deixaram de ser lacuna preenchida pelo
// sistema e passaram a estar escritos no próprio contrato, turma a turma. Ficam aqui copiados
// caractere por caractere do documento que a escola enviou — inclusive a pontuação irregular
// ("R$ 7623,36", espaço depois do parêntese): é texto de contrato, não é nosso pra arrumar.
// Aviso de pré-venda das turmas 2027 do Cabeleireiro (pedido da Erica, 11/09/2026).
//
// Fica aqui, num lugar só, porque é afirmação comercial: aparece no card da agenda, na página
// do curso e na tela de aceite, e as três têm que dizer exatamente a mesma coisa. Se a frase
// fosse repetida em cada tela, uma mudança de prazo deixaria alguma para trás.
//
// Os 20% conferem com os preços do contrato: R$ 6.297,00 -> R$ 5.037,60 e R$ 7.623,36 ->
// R$ 6.098,64, exatos nos dois casos.
export const PRE_SALE_NOTICE = {
  titulo: 'Valor exclusivo de pré-venda',
  texto: 'Este valor tem 20% de desconto e vale até 30 de novembro de 2026, ou enquanto houver vagas — o que acontecer primeiro.',
  curto: '20% de desconto de pré-venda até 30/11/2026 ou enquanto houver vagas.',
};

// Quadro de cada turma. Os valores são NÚMEROS, não frases (corrigido em 11/09/2026).
//
// Antes, o quadro trazia "Valor total" e "Matrícula" como texto escrito à mão, e a "Forma de
// pagamento" vinha de um terceiro lugar (o catálogo). Três fontes para o mesmo dinheiro — e
// elas divergiram: o contrato da turma Noite dizia valor total R$ 6.297,00, matrícula
// R$ 419,80 e forma de pagamento "Matrícula R$ 508,22", que é a matrícula da Diurno. Num
// documento assinado, isso não é detalhe de tela.
//
// Agora cada turma declara só o total que a aluna paga; matrícula e parcelas são calculadas
// dele em contractText(). Um número por turma, e nada para divergir.
export const CLASS_TABLES = {
  // Cada turma do curso que exige contrato assinado. A CHAVE é o texto exato da turma no
  // catálogo (src/catalog.js) — é por ela que o sistema encontra o contrato certo.
  //
  // Curso sem entrada aqui simplesmente não pede assinatura, e a matrícula segue o fluxo
  // normal. Deixe vazio se nenhum curso desta escola tiver contrato.
  //
  // Modelo, para copiar e preencher:
  //
  // 'Turma Manhã — 10 de Março a 20 de Junho de 2027': {
  //   turma: 'MANHÃ',
  //   inicio: '10 de março de 2027 (podendo sofrer alterações)',
  //   termino: '20 de junho de 2027 (podendo sofrer alterações)',
  //   diasEHorario: 'Segunda e terça-feira, 09h às 13h',
  //   cargaPresencial: '240h',
  //   valorTotal: 5000.00,        // o que a aluna paga, já com desconto de pré-venda
  //   valorSemPreVenda: 6250.00,  // preço cheio. Para um desconto real de X%, divida o
  //                               // valorTotal por (1 - X/100) — nunca multiplique por (1 + X/100)
  // },
};

// Formata em real, do jeito que o contrato escreve: R$ 5.037,60.
function emReais(valor) {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\u00a0/g, ' ');
}

// Como o Cabeleireiro é pago (confirmado nos três contratos enviados pela escola em
// 11/09/2026): uma INSCRIÇÃO paga na Voomp, MAIS 12 parcelas no cartão ou boleto — todas do
// mesmo valor. São 13 pagamentos iguais, não 12.
//
// Preço cheio conforme os contratos da escola: R$ 6.548,88 na Noite e Sábado, R$ 7.928,23 na
// Diurno. O preço de pré-venda é 20% abaixo dele DE VERDADE (decisão da Erica, 11/09/2026).
//
// Os contratos calculavam a pré-venda multiplicando o cheio por 1/1,2 em vez de por 0,8, o que
// dava 16,67% de desconto enquanto as páginas anunciavam 20% — tirar 20% e somar 20% não são
// operações inversas. A pré-venda passou de R$ 5.457,40 para R$ 5.239,13 e de R$ 6.606,86 para
// R$ 6.342,57, e a inscrição cobrada na Voomp mudou junto (R$ 403,01 e R$ 487,89).
//
// O total é 13 x a inscrição, e não os 80% exatos (R$ 5.239,10 e R$ 6.342,58): três centavos de
// diferença compram 13 pagamentos exatamente iguais, que é o que um contrato precisa ter. O
// desconto continua sendo 20,00% arredondado.
//
// Isto já esteve errado aqui: o sistema tratava a inscrição como a 1ª de 12 parcelas e cobrava
// uma parcela a menos que o contrato (R$ 5.037,60 contra R$ 5.457,40 na turma Noite). Por isso
// a divisão fica neste número nomeado, num lugar só, em vez de um "/ 12" solto pelo código.
export const PAGAMENTOS_CABELEIREIRO = 13;

// Inscrição e parcelas de uma turma, calculadas do total.
export function contractMoney(classDate) {
  const quadro = CLASS_TABLES[classDate];
  if (!quadro) return null;
  const totalCentavos = Math.round(quadro.valorTotal * 100);
  const parcelaCentavos = Math.round(totalCentavos / PAGAMENTOS_CABELEIREIRO);
  return {
    total: quadro.valorTotal,
    totalTexto: emReais(totalCentavos / 100),
    matricula: parcelaCentavos / 100,
    matriculaTexto: emReais(parcelaCentavos / 100),
    saldo: (totalCentavos - parcelaCentavos) / 100,
    saldoTexto: emReais((totalCentavos - parcelaCentavos) / 100),
    parcelas: PAGAMENTOS_CABELEIREIRO - 1,
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
    // As três linhas de dinheiro saem do MESMO número (o total da turma, em CLASS_TABLES).
    //
    // Antes, "Valor total" e "Matrícula" vinham de texto escrito à mão no quadro e a "Forma de
    // pagamento" vinha do catálogo do site — três fontes que divergiram: o contrato da Noite
    // saiu com matrícula R$ 419,80 numa linha e R$ 508,22 na outra (valor da Diurno). Deriva
    // tudo do total elimina a possibilidade, em vez de só corrigir os números desta vez.
    `Valor total: ${dinheiro.totalTexto} (preço de pré-venda, com 20% de desconto sobre ${dinheiro.semPreVendaTexto}, válido até 30 de novembro de 2026 ou enquanto houver vagas)`,
    `Matrícula: ${dinheiro.matriculaTexto} (inscrição, paga pela Voomp)`,
    `Forma de pagamento: inscrição de ${dinheiro.matriculaTexto} pela Voomp, mais ${dinheiro.parcelas}x de ${dinheiro.matriculaTexto} sem juros no cartão ou boleto (${dinheiro.saldoTexto}), totalizando ${dinheiro.totalTexto}.`,
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
