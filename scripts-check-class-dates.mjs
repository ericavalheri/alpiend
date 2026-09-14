// Datas de turma da escola. As datas são texto livre escrito à mão ("18 de Janeiro a 08 de Junho
// de 2027"), e é desse texto que saem três coisas que valem dinheiro: quando a matrícula fecha,
// quando a turma some da agenda pública e quando a Minha Área diz que a turma acabou.
//
// Criado em 07/09/2026 depois de dois bugs achados de uma vez, os dois adiantando o
// fechamento da matrícula — turma sumia da agenda com vaga aberta e ninguém era avisado.
import assert from 'node:assert/strict';
import { classStartDate, classEndDate, isClassFinished } from './src/lib/format.js';
import { enrollmentClosesAt } from './lib/courses.mjs';
import { fallbackCourses } from './src/catalog.js';

const iso = (date) => (date ? date.toISOString().slice(0, 10) : null);
let falhas = 0;

function check(label, real, esperado) {
  if (real === esperado) {
    console.log(`OK  ${label}`);
    return;
  }
  falhas += 1;
  console.error(`FALHOU  ${label}\n        esperado ${esperado}, veio ${real}`);
}

// 1. Turma de um dia só: começo e fim são o mesmo dia.
check('turma de um dia: começo', iso(classStartDate('06 de Setembro de 2026')), '2026-09-06');
check('turma de um dia: fim', iso(classEndDate('06 de Setembro de 2026')), '2026-09-06');

// 2. Turma de dias soltos ("28, 29 e 30 de Setembro"): começa no primeiro, acaba no último.
check('dias soltos: começa no primeiro', iso(classStartDate('28, 29 e 30 de Setembro de 2026')), '2026-09-28');
check('dias soltos: acaba no último', iso(classEndDate('28, 29 e 30 de Setembro de 2026')), '2026-09-30');

// 3. REGRESSÃO (07/09/2026): pegar o MENOR número do texto lia "18 de Janeiro a 08 de Junho"
// como dia 8. A matrícula do Cabeleireiro Diurno — a formação mais cara da escola — fechava
// 10 dias antes da hora, e a turma sumia da agenda ainda com vaga aberta.
check('intervalo com dia final menor que o inicial: começo', iso(classStartDate('Cab Diurno — 18 de Janeiro a 08 de Junho de 2027')), '2027-01-18');
check('intervalo com dia final menor que o inicial: fim', iso(classEndDate('Cab Diurno — 18 de Janeiro a 08 de Junho de 2027')), '2027-06-08');

// 4. REGRESSÃO (07/09/2026): o servidor procurava o mês percorrendo o calendário em ordem, e
// não o primeiro mês escrito no texto — "15 de Dezembro a 20 de Janeiro" virava janeiro.
check('intervalo que vira o ano: começo', iso(classStartDate('15 de Dezembro de 2026 a 20 de Janeiro de 2027')), '2026-12-15');
check('intervalo que vira o ano: fim', iso(classEndDate('15 de Dezembro de 2026 a 20 de Janeiro de 2027')), '2027-01-20');

// 5. O fim tem que seguir o mês do último trecho, não o maior número solto do texto.
check('fim segue o mês do último trecho', iso(classEndDate('26 de Setembro a 3 de Outubro de 2026')), '2026-10-03');

// 6. Sem data legível, nada é inventado.
check('turma sem data: começo', classStartDate('Turma a confirmar'), null);
check('turma sem data: fim', classEndDate('Turma a confirmar'), null);
check('turma sem data nunca aparece como encerrada', isClassFinished('Turma a confirmar'), false);

// 7. A turma só é "encerrada" depois do último dia — no próprio dia ela ainda acontece.
check('turma de hoje ainda não está encerrada', isClassFinished(new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).replace(' de ', ' de ')), false);
check('turma de 2030 não está encerrada', isClassFinished('30 de Dezembro de 2030'), false);
check('turma de 2020 está encerrada', isClassFinished('30 de Dezembro de 2020'), true);

// 8. Cliente e servidor têm que concordar em TODA data do catálogo real. A agenda pública usa
// a conta do servidor e a Minha Área usa a do cliente: se divergirem, a aluna vê uma turma que
// o checkout recusa (ou o contrário), e o erro só aparece na hora de vender.
let divergentes = 0;
for (const course of fallbackCourses) {
  for (const dateText of course.dates || []) {
    const inicio = classStartDate(dateText);
    if (!inicio) continue;
    const esperado = new Date(inicio.getTime() - 24 * 60 * 60 * 1000);
    if (iso(enrollmentClosesAt(course, dateText)) !== iso(esperado)) {
      divergentes += 1;
      console.error(`        divergem em "${dateText}" (${course.slug})`);
    }
  }
}
check('catálogo real: servidor e Minha Área concordam em todas as datas', divergentes, 0);

// 9. Nenhuma data do catálogo real pode ser lida com o dia errado.
let diaErrado = 0;
for (const course of fallbackCourses) {
  for (const dateText of course.dates || []) {
    const inicio = classStartDate(dateText);
    const primeiroEscrito = (dateText.match(/\b(\d{1,2})\b/) || [])[1];
    if (inicio && primeiroEscrito && inicio.getUTCDate() !== Number(primeiroEscrito)) {
      diaErrado += 1;
      console.error(`        "${dateText}" (${course.slug}) foi lida como dia ${inicio.getUTCDate()}`);
    }
  }
}
check('catálogo real: nenhuma turma começa num dia diferente do escrito', diaErrado, 0);

// 10. Herdado de scripts-check-agenda-expiration.mjs, removido em 07/09/2026 por testar a
// regra ANTIGA (venda fechava no dia da aula). Hoje a matrícula fecha 1 dia antes — regra P1.3,
// coberta em scripts-check-payment-security.mjs. Estas duas verificações eram só dele:
// turma de vários dias fecha pelo PRIMEIRO dia, e turma sem data nunca fecha sozinha.
const turmaLonga = { dates: ['02 e 03 de Setembro de 2026'], variants: {} };
check('turma de vários dias fecha a venda pelo primeiro dia', iso(enrollmentClosesAt(turmaLonga, '02 e 03 de Setembro de 2026')), '2026-09-01');
check('turma sem data legível nunca fecha a matrícula sozinha', enrollmentClosesAt({ dates: ['Data a confirmar'], variants: {} }, 'Data a confirmar'), null);

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) de data falharam.`);
  process.exit(1);
}
console.log('\nDatas de turma da escola: início, fim e janela de matrícula verificados.');
