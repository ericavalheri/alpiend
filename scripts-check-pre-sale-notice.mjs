// Aviso de pré-venda do Cabeleireiro (pedido da Erica, 11/09/2026).
//
// É afirmação comercial com prazo, e aparece em três telas: card da agenda, página do curso e
// tela de aceite. Se a frase fosse escrita em cada tela, uma mudança de prazo deixaria alguma
// para trás — e uma página anunciando desconto que já venceu é problema, não detalhe. Por isso
// o texto mora num lugar só e estas checagens garantem que continue assim.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRE_SALE_NOTICE } from './src/lib/contracts.js';
import { fallbackCourses } from './src/catalog.js';
import { exigeTurmaComContrato } from './scripts/_pendente.mjs';
import { CLASS_TABLES } from './src/lib/contracts.js';

exigeTurmaComContrato(CLASS_TABLES);

const compartilhado = readFileSync('src/components/shared.jsx', 'utf8');
const estilos = readFileSync('src/styles.css', 'utf8');

// 1. O texto existe e diz as três coisas que a escola pediu: exclusivo de pré-venda, 20% de
// desconto, e prazo com a ressalva das vagas.
for (const [campo, texto] of Object.entries(PRE_SALE_NOTICE)) {
  assert.ok(texto.trim().length > 0, `PRE_SALE_NOTICE.${campo} está vazio`);
}
const tudo = `${PRE_SALE_NOTICE.titulo} ${PRE_SALE_NOTICE.texto}`;
assert.ok(/pré-venda/i.test(tudo), 'o aviso precisa dizer que o valor é de pré-venda');
assert.ok(/20%/.test(tudo) && /20%/.test(PRE_SALE_NOTICE.curto), 'o aviso precisa dizer os 20% nas duas versões');
for (const texto of [PRE_SALE_NOTICE.texto, PRE_SALE_NOTICE.curto]) {
  assert.ok(/vagas/i.test(texto), 'o aviso precisa ressalvar "ou enquanto houver vagas"');
  assert.ok(/novembro de 2026|30\/11\/2026/.test(texto), 'o aviso precisa trazer o prazo');
}
// Novembro tem 30 dias: um prazo em "31 de novembro" é data que não existe, e prazo comercial
// inválido não pode ir para página pública.
assert.ok(!/31 de novembro|31\/11/.test(tudo + PRE_SALE_NOTICE.curto), 'novembro não tem 31 dias');
console.log('OK  o texto do aviso diz pré-venda, 20% e prazo com a ressalva das vagas');

// 2. Os 20% têm que fechar com os preços reais do contrato — número em página pública precisa
// ser verificável, não retórico.
{
  // Preços cheios conforme os contratos da escola (Erica, 11/09/2026).
  const contrato = { 5239.13: 6548.88, 6342.57: 7928.23 };
  const cab = fallbackCourses.find((curso) => curso.slug === 'cabeleireiro-profissional');
  for (const turma of cab.dates) {
    const site = cab.variants[turma].priceNumber;
    const cheio = contrato[site];
    assert.ok(cheio, `preço de pré-venda ${site} não tem valor cheio conhecido no contrato`);
    // O preço do site tem que ser exatamente o de pré-venda do contrato da turma.
    const desconto = (1 - site / cheio) * 100;
    assert.ok(Math.abs(desconto - 20) < 0.01, `${turma}: o desconto real é ${desconto.toFixed(4)}%, não 20%`);
  }
}
console.log('OK  o preço de cada turma no site é 20% abaixo do cheio do contrato dela');

// 3. Uma fonte só: as telas usam o componente, nunca a frase escrita à mão.
assert.ok(/export function PreSaleNotice\(/.test(compartilhado), 'o componente do aviso sumiu');
const usos = compartilhado.match(/<PreSaleNotice\b/g) || [];
assert.equal(usos.length, 3, `o aviso tem que aparecer nas 3 telas do Cabeleireiro, encontrei ${usos.length}`);
for (const trecho of ['20% de desconto de pré-venda', 'Este valor tem 20%']) {
  assert.ok(!compartilhado.includes(trecho), 'a frase foi copiada para a tela em vez de vir de PRE_SALE_NOTICE');
}
console.log('OK  as três telas usam o mesmo texto, vindo de um lugar só');

// 4. Só os cursos vendidos pela Voomp levam o aviso — a condição de pré-venda é deles.
{
  const corpo = compartilhado.slice(compartilhado.indexOf('export function PreSaleNotice('), compartilhado.indexOf('export function StudentAvatarHead('));
  assert.ok(/if \(course\?\.flow !== 'voomp'\) return null;/.test(corpo),
    'sem essa guarda, Blonde Start e Colorimetria anunciariam uma pré-venda que não existe');
}
console.log('OK  curso fora da pré-venda não recebe o aviso');

// 5. O aviso precisa de estilo próprio: sem isso ele entra como texto solto no meio do preço.
assert.ok(/^\.preSaleNotice \{/m.test(estilos) && /^\.preSaleNotice--compact \{/m.test(estilos),
  'faltou o estilo do aviso (versão completa e versão do card)');
console.log('OK  o aviso tem estilo nas duas versões');

// 6. Atendimento de segunda a quinta (a escola não atende sexta).
assert.ok(compartilhado.includes('Segunda a quinta, das 10h às 17h'), 'o horário de atendimento voltou ao valor antigo');
assert.ok(!compartilhado.includes('Segunda a sexta'), 'sobrou "segunda a sexta" em algum lugar do rodapé');
console.log('OK  rodapé com atendimento de segunda a quinta');
