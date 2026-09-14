// Menu e títulos do painel administrativo, separados do componente (07/09/2026) pra poderem
// ser conferidos por teste: item de menu sem título abre a página sem cabeçalho, item num grupo
// inexistente some do menu sem erro nenhum, e href que não bate com a chave vira link morto.
// Eram exatamente esses os buracos que o script de verificação não conseguia mais vigiar
// enquanto tentava achar os dados procurando texto dentro do JSX.

export const adminNavItems = [
    ['dashboard', '/painel', 'Dashboard', 'Visão geral'],
    ['crm', '/painel/crm', 'CRM', 'Vendas'],
    ['vendas', '/painel/vendas', 'Relatório de vendas', 'Vendas'],
    ['cupons', '/painel/cupons', 'Cupons', 'Vendas'],
    ['ofertas', '/painel/ofertas', 'Ofertas', 'Vendas'],
    ['demandas', '/painel/demandas', 'Demandas de atendimento', 'Vendas'],
    ['aceites', '/painel/aceites', 'Aceites Cabeleireiro', 'Vendas'],
    ['lista-espera', '/painel/lista-espera', 'Lista de espera', 'Vendas'],
    ['alunos', '/painel/alunos', 'Gestão do aluno', 'Alunos & conteúdo'],
    ['cursos', '/painel/cursos', 'Cursos e turmas', 'Alunos & conteúdo'],
    ['operacao', '/painel/operacao', 'Operação a escola', 'Alunos & conteúdo'],
    ['agencia', '/painel/agencia', 'Demandas da agência', 'Gestão'],
    ['usuarios', '/painel/usuarios', 'Usuários', 'Gestão'],
  ];
export const adminNavGroups = ['Visão geral', 'Vendas', 'Alunos & conteúdo', 'Gestão'];
export function adminPageTitles(isDatabaseMode = false) {
  return {
    dashboard: ['Dashboard', 'Painel geral', 'Resumo comercial para acompanhar faturamento, matrículas, carrinhos e próximos pontos de atenção.'],
    alunos: ['Gestão do aluno', 'Minha Área', 'Gestão do que aparece para cada aluna: curso, materiais, check-in, certificado e benefício progressivo.'],
    vendas: ['Vendas', 'Relatório de vendas', 'Todas as vendas da escola, inclusive as de turmas que já aconteceram, com filtro por período, curso e situação do pagamento.'],
    cupons: ['Cupons', 'Descontos', 'Controle por curso, turma, canal, validade e limite de uso.'],
    ofertas: ['Ofertas', 'Curso adicional no checkout', 'Cadastre quais cursos podem ser oferecidos juntos e o desconto do adicional.'],
    demandas: ['Demandas', 'Pendências de atendimento', 'Demandas manuais quando automação, WhatsApp/Twilio ou retorno de pagamento precisa de conferência humana.'],
    aceites: ['Aceites Cabeleireiro', 'Controle de aceite validado', isDatabaseMode ? 'Nome, telefone, email, turma e checkboxes aceitos no formulário de pré-matrícula.' : 'Quando o banco estiver conectado, os aceites aparecem aqui com validação completa.'],
    cursos: ['Cursos e turmas', 'Cadastro e agenda', 'Consulte a agenda vigente e cadastre/edite curso e turma direto por aqui — some direto do site quando arquivado.'],
    operacao: ['Operação a escola', 'Materiais, avisos, certificados e selos', 'Cadastre materiais por curso, avisos para as alunas, libere certificados e defina o benefício de cada selo — tudo reflete na Minha Área.'],
    agencia: ['Agência', 'Demandas da agência', 'O que está em andamento, aguardando o quê, e o que já foi entregue entre a Cavalheri Agência e a a escola.'],
    'lista-espera': ['Lista de espera', 'Fila por turma', 'Quem está esperando vaga em cada turma lotada — avisada automaticamente por WhatsApp assim que uma vaga abre.'],
    usuarios: ['Usuários', 'Administração', 'Usuários individuais e papéis de acesso ao painel administrativo.'],
  };
}
