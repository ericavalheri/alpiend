// Teste que só faz sentido depois que a escola preencher os dados.
//
// Num projeto recém-copiado, boa parte das verificações confere coisas que ainda não existem:
// os cursos, as turmas com contrato, as artes. Deixar esses testes vermelhos desde o primeiro
// dia treina a pessoa a ignorar teste vermelho — que é exatamente o hábito que faz um defeito
// de verdade passar batido depois.
//
// Então eles dormem, dizendo o que falta, e acordam sozinhos quando o dado aparece.
export function pendente(motivo) {
  console.log(`-- ainda não dá para conferir: ${motivo}`);
  process.exit(0);
}

export function exigeCursoReal(cursos) {
  const reais = (cursos || []).filter((curso) => !curso.exemplo);
  if (!reais.length) pendente('nenhum curso real em src/catalog.js (só o curso de exemplo)');
  return reais;
}

export function exigeTurmaComContrato(tabelas) {
  const turmas = Object.keys(tabelas || {});
  if (!turmas.length) pendente('nenhuma turma com contrato em CLASS_TABLES (src/lib/contracts.js)');
  return turmas;
}
