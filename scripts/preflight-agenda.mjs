import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fallbackCourses } from '../src/catalog.js';

const baseUrlArg = process.argv.find((arg) => arg.startsWith('--base='));
const baseUrl = (baseUrlArg?.split('=').slice(1).join('=') || process.env.AGENDA_BASE_URL || '').replace(/\/$/, '');

const expectedCourses = [
  ['escovista-profissional-noite', ['14 de Setembro a 26 de Outubro de 2026']],
  ['laboratorio-de-colorimetria', ['14 e 15 de Setembro de 2026', '29 e 30 de Novembro de 2026']],
  ['escova-modelada', ['20 de Setembro de 2026', '13 de Outubro de 2026', '15 de Novembro de 2026']],
  ['destrave', ['21 e 22 de Setembro de 2026', '16 e 17 de Novembro de 2026']],
  ['blonde-start', ['28, 29 e 30 de Setembro de 2026', '23, 24 e 25 de Novembro de 2026']],
  ['mega-hair-profissional', ['05 e 06 de Outubro de 2026', '09 e 10 de Novembro de 2026']],
  ['pro-cachos', ['23 de Setembro de 2026', '19 e 20 de Outubro de 2026', '03 de Novembro de 2026']],
  ['corte-descomplicado', ['26 e 27 de Outubro de 2026']],
  ['3-actions-haircut', ['01 e 02 de Novembro de 2026']],
  ['cabeleireiro-profissional', [
    'Cab Diurno — 18 de Janeiro a 08 de Junho de 2027',
    'Cab Noite — 11 de Janeiro a 28 de Junho de 2027',
    'Sábado — 09 de Janeiro a 31 de Julho de 2027',
  ]],
];

const expectedCabeleireiroVariants = [
  ['Cab Diurno — 18 de Janeiro a 08 de Junho de 2027', 'Cab Diurno', '18/01 a 08/06/2027', '320h'],
  ['Cab Noite — 11 de Janeiro a 28 de Junho de 2027', 'Cab Noite', '11/01 a 28/06/2027', '240h'],
  ['Sábado — 09 de Janeiro a 31 de Julho de 2027', 'Sábado', '09/01 a 31/07/2027', '240h'],
];

const requiredStaticRoutes = [
  '',
  'agenda',
  'aluno',
  'painel',
  ...expectedCourses.flatMap(([slug]) => [`curso/${slug}`, `matricula/${slug}`]),
  'aceite/cabeleireiro-profissional',
];

const requiredProductionRoutes = [
  '/',
  '/api/health',
  '/api/health?resource=courses',
  '/api/courses',
  '/api/catalog',
  '/curso/cabeleireiro-profissional',
  '/aceite/cabeleireiro-profissional',
  '/matricula/laboratorio-de-colorimetria',
  '/matricula/blonde-start',
];

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function sameList(actual, expected) {
  return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

function courseBySlug(slug) {
  return fallbackCourses.find((course) => course.slug === slug);
}

function cardCountForAgenda() {
  return fallbackCourses.reduce((total, course) => total + (course.slug === 'cabeleireiro-profissional' ? course.dates.length : 1), 0);
}

async function validateLocalCatalog() {
  const actualSlugs = fallbackCourses.map((course) => course.slug);
  check(sameList(actualSlugs, expectedCourses.map(([slug]) => slug)), `catalog slugs changed: ${actualSlugs.join(', ')}`);
  check(fallbackCourses.length === 10, `expected 10 catalog courses, got ${fallbackCourses.length}`);
  check(cardCountForAgenda() === 12, `expected 12 agenda cards, got ${cardCountForAgenda()}`);

  for (const [slug, expectedDates] of expectedCourses) {
    const course = courseBySlug(slug);
    check(Boolean(course), `missing course ${slug}`);
    if (!course) continue;
    check(sameList(course.dates || [], expectedDates), `${slug} dates changed`);
    check(!JSON.stringify(course).includes('Agosto de 2026'), `${slug} still has August 2026 data`);
  }

  const cab = courseBySlug('cabeleireiro-profissional');
  check(cab?.flow === 'voomp', 'Cabeleireiro Profissional must keep Voomp/acceptance flow');
  check(cab?.installments === '20% OFF na pré-venda até 30/11/2026', 'Cabeleireiro pre-sale deadline changed');

  for (const [date, label, period, workloadText] of expectedCabeleireiroVariants) {
    const variant = cab?.variants?.[date];
    check(Boolean(variant), `missing Cabeleireiro variant ${date}`);
    if (!variant) continue;
    check(variant.label === label, `Cabeleireiro label changed for ${date}`);
    check(variant.period === period, `Cabeleireiro period changed for ${label}`);
    check(variant.workloadText === workloadText, `Cabeleireiro workload changed for ${label}`);
    check(variant.capacity === 18, `Cabeleireiro capacity changed for ${label}`);
  }

  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const cronSchedules = new Map((vercel.crons || []).map((cron) => [cron.path, cron.schedule]));
  check(cronSchedules.get('/api/cron/recover-carts') === '*/30 * * * *', 'recover-carts cron must run every 30 minutes');
  check(cronSchedules.get('/api/cron/class-reminders') === '*/30 * * * *', 'class-reminders cron must run every 30 minutes');
  for (const route of ['/curso/:path*', '/matricula/:path*', '/aceite/:path*']) {
    check((vercel.rewrites || []).some((rewrite) => rewrite.source === route && rewrite.destination === '/'), `missing SPA rewrite ${route}`);
  }
}

async function validateStaticBuild() {
  const distPath = new URL('../dist/', import.meta.url).pathname;
  if (!existsSync(distPath)) return;
  for (const route of requiredStaticRoutes) {
    const filePath = join(distPath, route, 'index.html');
    check(existsSync(filePath), `missing static SPA entry dist/${route || '.'}/index.html`);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { response, body };
}

async function validateProduction() {
  if (!baseUrl) return;
  for (const path of requiredProductionRoutes) {
    const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
    check(response.status >= 200 && response.status < 400, `production route ${path} returned ${response.status}`);
  }

  const { response, body } = await fetchJson(`${baseUrl}/api/health?resource=courses`);
  check(response.ok, `production catalog API returned ${response.status}`);
  if (response.ok) {
    check(Array.isArray(body.courses), 'production catalog API did not return courses');
    check(body.courses?.length === 10, `production catalog expected 10 courses, got ${body.courses?.length}`);
    const cab = body.courses?.find((course) => course.slug === 'cabeleireiro-profissional');
    check(cab?.dates?.length === 3, 'production Cabeleireiro must have exactly 3 classes');
  }
}

await validateLocalCatalog();
await validateStaticBuild();
await validateProduction();

if (failures.length) {
  console.error('Agenda preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Agenda preflight passed${baseUrl ? ` for ${baseUrl}` : ''}.`);
