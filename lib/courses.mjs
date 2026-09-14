import { fallbackCourses } from '../src/catalog.js';

// Catálogo ao vivo: normalmente o código só tinha o catálogo estático (fallbackCourses),
// então adicionar/editar curso ou turma exigia um deploy. As tabelas courses/classes já
// existiam no banco (com sincronização e leitura prontas em lib/db.mjs, getManagedCatalog),
// mas nada nunca chamava esse caminho de leitura — pedido da Erica em 05/09/2026: gerenciar
// cursos/turmas pelo painel, sem depender de código. ensureLiveCourseCatalog() troca o
// binding "courses" pelo catálogo do banco quando ele existir, e cai pro arquivo estático
// (comportamento de sempre) quando o banco não está configurado ou a sincronização inicial
// ainda não rodou — nunca deixa a agenda/checkout sem catálogo nenhum.
export let courses = fallbackCourses;

let catalogRefreshedAt = 0;
let catalogSource = 'locked_catalog_module';
const CATALOG_REFRESH_MS = 10_000;

export function courseCatalogSource() {
  return catalogSource;
}

export async function ensureLiveCourseCatalog({ force = false } = {}) {
  if (!force && Date.now() - catalogRefreshedAt < CATALOG_REFRESH_MS) {
    return { source: catalogSource, courses };
  }
  try {
    // Import dinâmico: lib/db.mjs já importa findCourse/offerForCourse deste arquivo, então um
    // import estático aqui criaria uma dependência circular entre os dois módulos.
    const { isDbConfigured, getManagedCatalog } = await import('./db.mjs');
    if (isDbConfigured()) {
      // A agenda pública não pode ficar refém de um banco lento/fora do ar: antes dessa
      // integração ela nunca dependia do Postgres pra nada, então um travamento aqui (pool
      // cheio, rede instável) é regressão nova. Com timeout curto, qualquer lentidão cai pro
      // catálogo estático (comportamento de sempre) em vez de travar o request até o limite
      // da função serverless — que é o que fazia a agenda mostrar "indisponível".
      const managed = await Promise.race([
        getManagedCatalog(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('managed_catalog_timeout')), 4000)),
      ]);
      if (Array.isArray(managed) && managed.length) {
        courses = managed;
        catalogSource = 'database';
        catalogRefreshedAt = Date.now();
        return { source: catalogSource, courses };
      }
    }
  } catch (error) {
    console.error('course_catalog_refresh_failed', error);
  }
  courses = fallbackCourses;
  catalogSource = 'locked_catalog_module';
  catalogRefreshedAt = Date.now();
  return { source: catalogSource, courses };
}

export function normalizeSlug(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function findCourse(rawSlug = '') {
  const slug = normalizeSlug(rawSlug).replace(/_/g, '-');
  return courses.find((course) => !course.hiddenFromAgenda && (course.slug === slug || (course.aliases || []).map(normalizeSlug).includes(slug)));
}

export function classCapacity(course, date) {
  return course.variants?.[date]?.capacity || course.capacity || 20;
}

export function classReserved(course, date) {
  return course.variants?.[date]?.reserved || course.reservedByDate?.[date] || course.reserved || 0;
}

export function classAvailable(course, date) {
  return Math.max(0, classCapacity(course, date) - classReserved(course, date));
}

export function selectedOffer(course, date) {
  return course.variants?.[date] || null;
}

const MONTH_NAMES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Regra da escola: a matrícula fecha 1 dia antes do início da aula (mesma regra replicada em
// src/main.jsx para a vitrine pública). Ver P1.3 do Manual do produto — antes o curso só saía da
// agenda na data da aula, sem uma janela de matrícula própria.
const ENROLLMENT_CLOSES_DAYS_BEFORE_CLASS = 1;

// Datas oficiais no fuso America/Sao_Paulo (Manual do produto, secao 4.1) - nunca no fuso local do
// processo Node.js (Vercel roda em UTC) nem do navegador de quem acessa. Datas de turma (sem
// hora) viram meia-noite UTC "carimbada" com o dia calendario de Sao Paulo, pra comparacao de
// fechamento de matricula dar o mesmo resultado nao importa o fuso do processo.
function todaySaoPauloUtcMidnight() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day));
}

function parseClassStartDate(dateText = '') {
  const text = String(dateText || '');
  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    const year = Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]);
    return new Date(Date.UTC(year, month, day));
  }
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Dois bugs corrigidos em 07/09/2026, ambos adiantando o fechamento da matrícula (turma some
  // da agenda com vaga aberta, sem ninguém perceber):
  //  1. findIndex sobre MONTH_NAMES achava o mês mais cedo do CALENDÁRIO, não o primeiro do
  //     texto — "15 de Dezembro a 20 de Janeiro" virava janeiro.
  //  2. Math.min sobre todos os números lia "18 de Janeiro a 08 de Junho" como dia 8, o que
  //     fechava a matrícula do Cabeleireiro Diurno 10 dias antes da hora.
  // Regra correta (a mesma de classStartDate em src/lib/format.js): primeiro nome de mês que
  // aparece no texto, e o primeiro dia escrito antes dele.
  const firstMonth = normalized.match(/janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro/);
  if (!firstMonth) return null;
  const monthIndex = MONTH_NAMES.indexOf(firstMonth[0]);
  if (monthIndex < 0) return null;
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date()));
  const inScope = [...normalized.slice(0, firstMonth.index).matchAll(/\b(\d{1,2})\b/g)].map((match) => Number(match[1])).filter((value) => value >= 1 && value <= 31);
  const anyDay = [...normalized.matchAll(/\b(\d{1,2})\b/g)].map((match) => Number(match[1])).filter((value) => value >= 1 && value <= 31);
  const day = inScope.length ? inScope[0] : (anyDay.length ? anyDay[0] : 1);
  return new Date(Date.UTC(year, monthIndex, day));
}

// Permite, no futuro, sobrescrever a data de fechamento por curso/turma (course.variants[date]
// .enrollmentClosesAt, uma string ISO) sem mudar a regra padrão de 1 dia antes.
export function enrollmentClosesAt(course, dateText) {
  const override = course?.variants?.[dateText]?.enrollmentClosesAt;
  if (override) return new Date(override);
  const startDate = parseClassStartDate(dateText);
  if (!startDate) return null;
  const closesAt = new Date(startDate);
  closesAt.setUTCDate(closesAt.getUTCDate() - ENROLLMENT_CLOSES_DAYS_BEFORE_CLASS);
  return closesAt;
}

export function isEnrollmentClosed(course, dateText) {
  const closesAt = enrollmentClosesAt(course, dateText);
  if (!closesAt) return false;
  return todaySaoPauloUtcMidnight() >= closesAt.getTime();
}

// Fonte única de verdade do preço/turma no servidor (P0.1 do manual a escola).
// Nunca usar valores de preço vindos do navegador para cobrança.
export function resolveOffer(rawSlug = '', rawClassDate = '') {
  const course = findCourse(rawSlug);
  if (!course) return { ok: false, error: 'course_not_found' };

  const classDate = String(rawClassDate || '').trim();
  if (!course.dates.includes(classDate)) {
    return { ok: false, error: 'class_date_not_found', course };
  }
  if (isEnrollmentClosed(course, classDate)) {
    return { ok: false, error: 'enrollment_closed', course };
  }

  const offer = offerForCourse(course, classDate);
  if (offer.date !== classDate) return { ok: false, error: 'class_date_not_found', course };

  return {
    ok: true,
    course,
    courseSlug: course.slug,
    courseName: course.name,
    classDate,
    flow: offer.flow,
    priceNumber: offer.price_number,
    price: offer.price,
    capacity: offer.capacity,
    availableSpots: offer.available_spots,
    status: offer.status,
    optionLabel: offer.option_label,
  };
}

export function offerForCourse(course, preferredDate = '') {
  const date = course.dates.includes(preferredDate) ? preferredDate : course.dates[0];
  const variant = selectedOffer(course, date);
  const price = variant?.price || course.price;
  const priceNumber = variant?.priceNumber || course.priceNumber;
  const available = classAvailable(course, date);
  const checkoutPath = course.flow === 'voomp' ? `/aceite/${course.slug}` : `/matricula/${course.slug}`;
  const checkoutUrl = `https://DOMINIO-NAO-CONFIGURADO${checkoutPath}?turma=${encodeURIComponent(date)}&utm_source=whatsapp&utm_medium=twilio&utm_campaign=ebn_${course.slug}`;
  return {
    course_slug: course.slug,
    course_name: course.name,
    category: course.category,
    date,
    time: 'conforme agenda da turma',
    location: process.env.PUBLIC_LOCATION || '',
    price,
    price_number: priceNumber,
    spots: available > 0 ? `${available} vagas disponíveis de ${classCapacity(course, date)}` : 'Turma lotada',
    available_spots: available,
    capacity: classCapacity(course, date),
    checkout_url: checkoutUrl,
    short_description: variant?.description || course.description,
    status: available > 0 ? 'available' : 'sold_out',
    flow: course.flow || 'asaas',
    option_label: variant?.label || null,
  };
}

// Importador de planilha (pedido da Erica, 05/09/2026: subir várias turmas de uma vez, num
// modelo fixo, sem depender de IA pra interpretar o arquivo — mais confiável e sem custo por
// importação). Aceita CSV (Excel/Planilhas Google salvam/exportam nesse formato sem perda) em
// vez de .xlsx binário: evita depender de uma biblioteca de parser de Excel, que hoje só existe
// com vulnerabilidades conhecidas sem correção (prototype pollution/ReDoS). Função pura — não
// grava nada, só interpreta e valida; quem chama decide se publica (ver bulkImportClasses).
export const COURSE_IMPORT_CSV_HEADER = ['curso_slug', 'curso_nome', 'categoria', 'data_turma', 'rotulo_turma', 'vagas', 'preco', 'carga_horaria', 'descricao_turma'];

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
      else if (char === '"') { inQuotes = false; }
      else current += char;
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parsePriceCell(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return null;
  const normalized = text.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseCourseImportCsv(csvText = '') {
  const lines = String(csvText || '').split(/\r\n|\r|\n/).filter((line) => line.trim().length);
  if (!lines.length) return { rows: [], headerError: 'empty_file' };

  const header = parseCsvLine(lines[0]).map((cell) => cell.toLowerCase());
  const missingColumns = COURSE_IMPORT_CSV_HEADER.filter((column) => !header.includes(column));
  if (missingColumns.length) return { rows: [], headerError: 'missing_columns', missingColumns };

  const columnIndex = Object.fromEntries(COURSE_IMPORT_CSV_HEADER.map((column) => [column, header.indexOf(column)]));
  const rows = lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    const get = (column) => (cells[columnIndex[column]] || '').trim();
    const courseSlug = normalizeSlug(get('curso_slug'));
    const courseName = get('curso_nome');
    const classDate = get('data_turma');
    const priceNumber = parsePriceCell(get('preco'));
    const capacityRaw = get('vagas');
    const capacity = capacityRaw ? Number(capacityRaw) : null;

    const errors = [];
    if (!courseSlug) errors.push('curso_slug em branco');
    if (!classDate) errors.push('data_turma em branco');
    if (!priceNumber) errors.push('preco inválido ou em branco');
    if (capacityRaw && !(Number.isFinite(capacity) && capacity > 0)) errors.push('vagas precisa ser um número maior que zero');

    return {
      lineNumber: index + 2,
      courseSlug,
      courseName: courseName || null,
      category: get('categoria') || null,
      classDate,
      optionLabel: get('rotulo_turma') || null,
      capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
      priceNumber,
      workload: get('carga_horaria') || null,
      description: get('descricao_turma') || null,
      valid: errors.length === 0,
      errors,
    };
  });
  return { rows, headerError: '' };
}
