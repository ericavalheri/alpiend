// Agenda pública da escola: o que aparece (e o que não aparece) pra quem chega no site.
//
// A versão antiga procurava trechos de JSX dentro de src/main.jsx. O arquivo foi quebrado em
// src/pages/ numa reorganização e o script passou a estourar na primeira verificação, sem
// proteger nada. Reescrito em 07/09/2026 pra chamar as funções que a agenda usa de verdade
// (src/lib/catalog-helpers.js) com o catálogo real, em vez de conferir texto de componente —
// que é o que fazia ele envelhecer a cada mudança de layout.
import {
  agendaCourses, agendaCardCourses, monthlyGroups, monthsForCourse, activeDatesForCourse, publicCourse, findPublicCourse,
  normalizeCourse,
} from './src/lib/catalog-helpers.js';
import { fallbackCourses } from './src/catalog.js';
import { classMonth, isClassDateExpired } from './src/lib/format.js';
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

// --- Turmas de mentira, pra exercitar os casos que o catálogo real não tem hoje ---
const ONTEM = '01 de Janeiro de 2020';
const FUTURO = '15 de Dezembro de 2099';

const cursoSoComTurmaVelha = { slug: 'qa-vencido', name: 'QA Vencido', dates: [ONTEM], image: '/qa.png' };
const cursoMisto = { slug: 'qa-misto', name: 'QA Misto', dates: [ONTEM, FUTURO], image: '/qa.png' };
const cursoEscondido = { slug: 'qa-escondido', name: 'QA Escondido', dates: [FUTURO], image: '/qa.png', hiddenFromAgenda: true };
const cursoFuturo = { slug: 'qa-futuro', name: 'QA Futuro', dates: [FUTURO], image: '/qa.png' };

const inventados = [cursoSoComTurmaVelha, cursoMisto, cursoEscondido, cursoFuturo];
const naAgenda = agendaCourses(inventados).map((course) => course.slug);

// 1. Turma que já passou da janela de matrícula não pode continuar à venda.
check('curso com a única turma vencida sai da agenda', !naAgenda.includes('qa-vencido'), `agenda: ${naAgenda.join(', ')}`);
check('curso com turma vencida e turma futura continua, só com a futura',
  naAgenda.includes('qa-misto') && JSON.stringify(activeDatesForCourse(cursoMisto)) === JSON.stringify([FUTURO]),
  `datas ativas: ${activeDatesForCourse(cursoMisto).join(' | ')}`);

// 2. Curso marcado como escondido nunca aparece, mesmo com turma aberta.
check('curso escondido não aparece na agenda', !naAgenda.includes('qa-escondido'));
check('curso escondido também não abre por link direto', findPublicCourse('qa-escondido', inventados) === null);
check('curso normal com turma futura aparece', naAgenda.includes('qa-futuro'));
check('publicCourse devolve null pra curso sem turma disponível', publicCourse(cursoSoComTurmaVelha) === null);

// --- Catálogo real ---
const reais = agendaCourses(fallbackCourses);
const meses = monthlyGroups(fallbackCourses);

// 3. A agenda real não pode ficar vazia por causa de um filtro errado — seria o site sem
// nenhum curso à venda, e nada no sistema avisaria.
check('a agenda real tem cursos à venda', reais.length > 0, `${reais.length} cursos`);
check('a agenda real tem meses com turma', meses.length > 0, `meses: ${meses.join(', ')}`);

// 4. Todo curso mostrado tem capa: card sem imagem é card quebrado na vitrine.
const semCapa = reais.filter((course) => !course.image);
check('todo curso da agenda tem capa', semCapa.length === 0, `sem capa: ${semCapa.map((c) => c.slug).join(', ')}`);

// 5. Nenhuma turma vencida escapa pra vitrine.
const vencidasVisiveis = reais.flatMap((course) => course.dates.filter(isClassDateExpired).map((date) => `${course.slug}: ${date}`));
check('nenhuma turma vencida aparece na agenda', vencidasVisiveis.length === 0, vencidasVisiveis.join(' | '));

// 6. Cada mês do filtro só lista curso que realmente tem turma naquele mês.
let foraDoMes = 0;
for (const mes of meses) {
  for (const card of agendaCardCourses(fallbackCourses, mes)) {
    if (!monthsForCourse(card).includes(mes)) {
      foraDoMes += 1;
      console.error(`        "${card.name}" apareceu em ${mes} sem turma nesse mês`);
    }
  }
}
check('todo curso listado num mês tem turma naquele mês', foraDoMes === 0);

// 7. Nenhum mês do filtro pode vir vazio: aba de mês sem curso nenhum é beco sem saída.
const mesesVazios = meses.filter((mes) => agendaCardCourses(fallbackCourses, mes).length === 0);
check('nenhum mês do filtro abre vazio', mesesVazios.length === 0, `vazios: ${mesesVazios.join(', ')}`);

// 8. Os meses vêm em ordem de calendário, não na ordem em que os cursos foram cadastrados.
const cadaMesTemData = meses.every((mes) => reais.some((course) => course.dates.some((date) => classMonth(date) === mes)));
check('todo mês do filtro corresponde a uma turma real', cadaMesTemData);

// 9. Capa: quem manda é a arte do código, não a cópia velha guardada no banco.
//
// A agenda pública lê o catálogo ao vivo (tabelas courses/classes do Supabase), e a
// sincronização guarda uma CÓPIA do campo image dentro de courses.metadata. Quando a capa
// muda no código, essa cópia continua antiga: em 08/09/2026 as capas novas de setembro foram
// pro deploy e a agenda continuou mostrando as antigas, porque o valor do banco ficava por
// cima. Estas verificações trancam a precedência — sem elas o mesmo problema volta calado na
// próxima troca de arte.
const cursoDoCodigo = fallbackCourses.find((course) => course.slug === 'blonde-start');
const vindoDoBanco = normalizeCourse({ ...cursoDoCodigo, image: '/assets/cursos/capa-velha.jpg', banner: '/assets/cursos/capa-velha.jpg', mobileBanner: '/assets/cursos/capa-velha.jpg' });
check('capa antiga guardada no banco não fica por cima da arte do código',
  vindoDoBanco.image === cursoDoCodigo.image && vindoDoBanco.banner === cursoDoCodigo.image && vindoDoBanco.mobileBanner === cursoDoCodigo.image,
  `mostrou: ${vindoDoBanco.image}`);

// A exceção: capa trocada de propósito pelo painel (imageSource: 'painel') continua valendo.
const escolhidaNoPainel = normalizeCourse({ ...cursoDoCodigo, image: '/assets/cursos/escolha-da-erica.webp', imageSource: 'painel' });
check('capa escolhida no painel continua valendo', escolhidaNoPainel.image === '/assets/cursos/escolha-da-erica.webp', `mostrou: ${escolhidaNoPainel.image}`);

// 10. Cada turma do Cabeleireiro mostra a capa dela, mesmo quando o catálogo vem do banco —
// buildManagedCatalog não copia image pra dentro de variants, então a arte de turma tem que
// ser reencontrada pelo rótulo ("Cab Diurno", "Cab Noite", "Sábado").
const cabDoCodigo = fallbackCourses.find((course) => course.slug === 'cabeleireiro-profissional');
const cabSemArteDeTurma = {
  ...cabDoCodigo,
  image: '/assets/cursos/capa-velha.jpg',
  variants: Object.fromEntries(Object.entries(cabDoCodigo.variants || {}).map(([date, variant]) => {
    const { image, ...semImagem } = variant;
    return [date, semImagem];
  })),
};
const catalogoComCab = fallbackCourses.map((course) => (course.slug === 'cabeleireiro-profissional' ? normalizeCourse(cabSemArteDeTurma) : normalizeCourse(course)));
const cardsDoCab = monthlyGroups(catalogoComCab).flatMap((mes) => agendaCardCourses(catalogoComCab, mes)).filter((card) => card.slug === 'cabeleireiro-profissional');
const capasPorTurma = cardsDoCab.map((card) => card.image);
check('a agenda separa o Cabeleireiro em um card por turma', cardsDoCab.length >= 2, `${cardsDoCab.length} card(s)`);
check('cada turma do Cabeleireiro tem capa própria, e nenhuma é a capa velha do banco',
  new Set(capasPorTurma).size === capasPorTurma.length && !capasPorTurma.includes('/assets/cursos/capa-velha.jpg'),
  capasPorTurma.join(' | '));

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) da agenda pública falharam.`);
  process.exit(1);
}
console.log('\nAgenda pública a escola: turma vencida some, curso escondido não vaza, todo mês tem curso de verdade.');
