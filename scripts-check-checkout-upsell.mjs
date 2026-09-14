// Oferta do segundo curso no checkout (regra P1.2 do Manual do produto; cartão de venda pedido pela
// Erica em 09/09/2026).
//
// A oferta é dinheiro na tela: preço cheio, preço com desconto e quanto a aluna economiza. Se
// a conta ou a elegibilidade saírem erradas, a a escola cobra errado ou promete um desconto que o
// servidor vai recusar no pagamento. Este script trava as duas coisas, e mais a parte nova —
// capa e frase — que é o que faz a oferta vender.
import { eligibleAdditionalCourses } from './src/lib/catalog-helpers.js';
import { fallbackCourses } from './src/catalog.js';
import { brand } from './src/lib/brand.js';
import { exigeCursoReal } from './scripts/_pendente.mjs';

exigeCursoReal(fallbackCourses);

let falhas = 0;
function check(label, condicao, detalhe = '') {
  if (condicao) {
    console.log(`OK  ${label}`);
    return;
  }
  falhas += 1;
  console.error(`FALHOU  ${label}${detalhe ? `\n        ${detalhe}` : ''}`);
}

const comOferta = (alvo, extra = {}) => ({
  ...fallbackCourses.find((c) => c.slug === 'laboratorio-de-colorimetria'),
  upsellTargets: [{ targetCourseSlug: alvo, discountType: 'percent', discountValue: 20, ...extra }],
});

const [oferta] = eligibleAdditionalCourses(fallbackCourses, comOferta('blonde-start'));
check('a oferta é montada quando existe curso alvo com turma aberta', Boolean(oferta));

// --- O que faz a oferta vender ------------------------------------------------------------
check('a oferta leva a capa do curso', Boolean(oferta.image) && oferta.image.startsWith('/assets/cursos/'), oferta.image);
check('a capa é a arte oficial do curso, não a foto genérica da escola',
  oferta.image !== brand.school && oferta.image !== brand.logo,
  oferta.image);
const noCatalogo = fallbackCourses.find((c) => c.slug === 'blonde-start');
check('a capa da oferta é a mesma que a aluna já viu na agenda', oferta.image === noCatalogo.image, `${oferta.image} vs ${noCatalogo.image}`);
check('a oferta leva a promessa do curso, pra dizer o que ela ganha', oferta.promise === noCatalogo.promise && oferta.promise.length > 20, oferta.promise);
check('a oferta leva a turma do curso adicional', Boolean(oferta.date), oferta.date);

// --- A conta ------------------------------------------------------------------------------
check('20% de desconto é calculado sobre o preço cheio da turma',
  oferta.discountedPriceNumber === Math.round(oferta.priceNumber * 0.8 * 100) / 100,
  `${oferta.priceNumber} -> ${oferta.discountedPriceNumber}`);
const economia = Math.round((oferta.priceNumber - oferta.discountedPriceNumber) * 100) / 100;
check('a economia mostrada é a diferença exata entre os dois preços', economia > 0 && Math.round((oferta.priceNumber - economia) * 100) / 100 === oferta.discountedPriceNumber, String(economia));
check('o desconto nunca deixa o curso mais caro que o preço cheio', oferta.discountedPriceNumber < oferta.priceNumber);

const [porValor] = eligibleAdditionalCourses(fallbackCourses, comOferta('blonde-start', { discountType: 'fixed', discountValue: 300 }));
check('desconto em reais tira exatamente o valor cadastrado', porValor.discountedPriceNumber === Math.round((porValor.priceNumber - 300) * 100) / 100, `${porValor.priceNumber} -> ${porValor.discountedPriceNumber}`);

// Desconto absurdo cadastrado por engano não pode virar curso de graça nem preço negativo.
const [exagerado] = eligibleAdditionalCourses(fallbackCourses, comOferta('blonde-start', { discountType: 'fixed', discountValue: 999999 }));
check('desconto maior que o preço não gera valor negativo', exagerado.discountedPriceNumber >= 1, String(exagerado.discountedPriceNumber));
const [percentualExagerado] = eligibleAdditionalCourses(fallbackCourses, comOferta('blonde-start', { discountValue: 500 }));
check('percentual acima de 100 não gera valor negativo', percentualExagerado.discountedPriceNumber >= 1, String(percentualExagerado.discountedPriceNumber));

// --- Quando NÃO pode aparecer -------------------------------------------------------------
check('sem oferta cadastrada, nada aparece', eligibleAdditionalCourses(fallbackCourses, { ...fallbackCourses[0], upsellTargets: [] }).length === 0);
check('curso alvo inexistente não vira oferta', eligibleAdditionalCourses(fallbackCourses, comOferta('curso-que-nao-existe')).length === 0);

const catalogoComEscondido = fallbackCourses.map((c) => (c.slug === 'blonde-start' ? { ...c, hiddenFromAgenda: true } : c));
check('curso escondido da agenda não é oferecido no checkout', eligibleAdditionalCourses(catalogoComEscondido, comOferta('blonde-start')).length === 0);

// Turma lotada não pode ser vendida como adicional: a vaga não existe.
const catalogoLotado = fallbackCourses.map((c) => (c.slug === 'blonde-start'
  ? { ...c, capacity: 10, reservedByDate: Object.fromEntries((c.dates || []).map((d) => [d, 10])) }
  : c));
check('turma lotada não é oferecida como curso adicional', eligibleAdditionalCourses(catalogoLotado, comOferta('blonde-start')).length === 0);

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) da oferta adicional falharam.`);
  process.exit(1);
}
console.log('\nOferta adicional: capa e promessa do curso na tela, conta certa, e nada oferecido sem vaga.');
