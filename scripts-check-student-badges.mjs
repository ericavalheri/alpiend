// Trilha de selos da Minha Área (pedido da Erica, 07/09/2026): os degraus de curso liberam
// sozinhos conforme a aluna paga mais cursos, e o que a equipe cadastra no painel entra na
// mesma lista. Este script trava as regras que valem dinheiro (a escala do desconto) e as que
// já quebraram uma vez (selo cadastrado no painel sumindo da tela por causa da coluna status).
import { buildBadgeCatalog, progressiveDiscountPercent } from './lib/db.mjs';

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`OK  ${label}`);
    return;
  }
  failures += 1;
  console.error(`FALHOU  ${label}`);
}

const byKey = (catalog) => new Map(catalog.map((badge) => [badge.key, badge]));

// 1. Desconto de aluna (regra revista pela escola em 09/09/2026): quem fecha um curso já sai
// com 20% no próximo curso de especialização. Não é mais uma escala que cresce a cada curso —
// os degraus seguintes dão brinde, cadastrado no painel.
check('sem curso pago, nenhum desconto é prometido', progressiveDiscountPercent(0) === 0);
check('primeiro curso pago já libera 20%', progressiveDiscountPercent(1) === 20);
check('o desconto continua 20% no terceiro curso (não acumula)', progressiveDiscountPercent(3) === 20);
check('nem com muitos cursos o desconto passa de 20%', progressiveDiscountPercent(12) === 20);

// 2. Aluna sem nenhum curso pago vê a trilha inteira, mas sem nenhum degrau conquistado.
const nova = buildBadgeCatalog({ paidCount: 0, missions: {}, badgeBenefits: [] });
const degrausNova = nova.filter((badge) => badge.milestone);
check('aluna nova: os 6 degraus da trilha aparecem no catálogo', degrausNova.length === 6);
check('aluna nova: nenhum degrau vem conquistado', degrausNova.every((badge) => !badge.earned));
check('aluna nova: selos de avaliação e presença aparecem como meta', nova.some((b) => b.key === 'course_review' && !b.earned) && nova.some((b) => b.key === 'class_attendance' && !b.earned));

// 3. Aluna com 3 cursos pagos: degraus 1 a 3 liberados sozinhos, 4 a 6 ainda não.
const tresCursos = byKey(buildBadgeCatalog({ paidCount: 3, missions: {}, badgeBenefits: [] }));
check('3 cursos pagos: degraus 1, 2 e 3 liberam automaticamente', ['curso_1', 'curso_2', 'curso_3'].every((key) => tresCursos.get(key)?.earned === true));
check('3 cursos pagos: degraus 4, 5 e 6 continuam bloqueados', ['curso_4', 'curso_5', 'curso_6'].every((key) => tresCursos.get(key)?.earned === false));
check('o degrau 1 promete os 20% que a escola combina na matrícula',
  tresCursos.get('curso_1')?.benefitLabel === '20% de desconto no próximo curso de especialização',
  String(tresCursos.get('curso_1')?.benefitLabel));
// Do segundo degrau em diante o prêmio muda a cada campanha (um secador, uma boneca de treino).
// Sem cadastro no painel, o selo NÃO pode inventar um benefício — prometer o que ninguém
// combinou é pior do que não prometer nada.
check('degraus 2 a 6 não prometem nada por conta própria',
  ['curso_2', 'curso_3', 'curso_4', 'curso_5', 'curso_6'].every((key) => !tresCursos.get(key)?.benefitLabel),
  ['curso_2', 'curso_3', 'curso_4', 'curso_5', 'curso_6'].map((k) => `${k}: ${tresCursos.get(k)?.benefitLabel}`).join(' | '));

// E o brinde que a a escola cadastrar aparece no degrau certo.
const comBrinde = byKey(buildBadgeCatalog({
  paidCount: 3,
  missions: {},
  badgeBenefits: [{ badge_key: 'curso_3', badge_label: 'Aluna dedicada', benefit_type: 'gift', benefit_detail: 'Secador profissional' }],
}));
check('brinde cadastrado no painel aparece no degrau dele', /Secador profissional/.test(comBrinde.get('curso_3')?.benefitLabel || ''), String(comBrinde.get('curso_3')?.benefitLabel));

// 4. Bug corrigido em 07/09/2026: as consultas de badge_benefits filtram status = 'active' no
// SQL e NÃO trazem a coluna status de volta. O filtro antigo comparava entry.status === 'active'
// em cima de undefined e derrubava todo selo cadastrado no painel — a Minha Área só mostrava o
// selo automático de desconto. Linha sem status tem que continuar valendo como ativa.
const doPainel = buildBadgeCatalog({
  paidCount: 1,
  missions: { indicacao: { status: 'approved', approvedAt: '2026-09-01T10:00:00Z' } },
  badgeBenefits: [{ badge_key: 'indicacao', badge_label: 'Indicou uma amiga', benefit_type: 'custom', benefit_detail: 'Vivência no salão-escola' }],
});
const indicacao = byKey(doPainel).get('indicacao');
check('selo cadastrado no painel aparece na Minha Área mesmo sem a coluna status na consulta', Boolean(indicacao));
check('selo do painel mantém o benefício cadastrado pela equipe', indicacao?.benefitLabel === 'Vivência no salão-escola');
check('selo do painel com missão aprovada aparece como conquistado', indicacao?.earned === true);

// 5. O painel manda no texto: cadastrar a mesma badge_key troca nome e benefício do selo
// automático, sem precisar de deploy.
const sobrescrito = byKey(buildBadgeCatalog({
  paidCount: 2,
  missions: {},
  badgeBenefits: [{ badge_key: 'curso_2', badge_label: 'Dupla de ouro', benefit_type: 'discount_percent', discount_percent: 12 }],
}));
check('painel sobrescreve o nome do selo automático', sobrescrito.get('curso_2')?.label === 'Dupla de ouro');
check('painel sobrescreve o benefício do selo automático', sobrescrito.get('curso_2')?.benefitLabel === '12% de desconto');
check('selo sobrescrito continua liberando sozinho pelo número de cursos', sobrescrito.get('curso_2')?.earned === true);

// 6. Conquista da aluna nunca some da tela por falta de cadastro no painel.
const orfao = byKey(buildBadgeCatalog({
  paidCount: 1,
  missions: { missao_especial: { status: 'approved' } },
  badgeBenefits: [],
}));
check('selo conquistado sem cadastro no painel ainda aparece', orfao.get('missao_especial')?.earned === true);

// 7. 'new_course' é gravado a cada matrícula paga e contaria a mesma história do degrau 1 —
// sem cadastro próprio no painel, ele não vira um selo repetido na coleção.
check('new_course não vira selo duplicado do "Primeiro passo"', !orfao.has('new_course'));
const newCourseCadastrado = byKey(buildBadgeCatalog({
  paidCount: 1,
  missions: { new_course: { status: 'approved' } },
  badgeBenefits: [{ badge_key: 'new_course', badge_label: 'Nova matrícula', benefit_type: 'custom', benefit_detail: 'Acesso ao grupo de alunas' }],
}));
check('new_course volta a aparecer quando a equipe cadastra um benefício pra ele', newCourseCadastrado.get('new_course')?.benefitLabel === 'Acesso ao grupo de alunas');

// 8. Nenhum selo repetido na coleção, em nenhum cenário.
const chaves = doPainel.map((badge) => badge.key);
check('catálogo nunca repete a mesma chave de selo', new Set(chaves).size === chaves.length);

if (failures > 0) {
  console.error(`\n${failures} verificação(ões) de selos falharam.`);
  process.exit(1);
}
console.log('\nTrilha de selos e benefícios da Minha Área verificada.');
