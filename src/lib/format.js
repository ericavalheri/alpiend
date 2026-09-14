// Formatação de dinheiro/texto e cálculo de datas de turma. Sem dependências de React —
// extraído de src/main.jsx (organização de arquivos pedida pela Erica, 05/09/2026).

export function money(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Iniciais pro avatar circular das listas compactas do painel (pedido da Erica, 04/09/2026:
// cards com avatar/iniciais no lugar de tabela longa, estilo ferramenta interna profissional).
export function initials(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

export function safeSlug(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function normalizeStatusText(value = '') {
  return String(value || '').toLowerCase();
}

export function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const monthLookup = monthNames.reduce((acc, name, index) => ({ ...acc, [name.toLowerCase()]: { name, index } }), {});
monthLookup.marco = monthLookup['março'];

export function classMonth(dateText) {
  const found = String(dateText || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro/i);
  if (!found) return 'A confirmar';
  const normalized = found[0].toLowerCase();
  const map = { marco: 'Março' };
  return map[normalized] || monthNames.find((m) => m.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === normalized) || 'A confirmar';
}

// Datas oficiais no fuso America/Sao_Paulo (Manual do produto, seção 4.1) — nunca no fuso local de
// quem está com o site aberto. Sem isso, uma visitante em outro fuso veria a turma sumir/ficar
// disponível em um dia diferente do que o servidor decide (que já usa este mesmo cálculo).
export function todaySaoPauloUtcMidnight() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day));
}

export function startOfToday() {
  return new Date(todaySaoPauloUtcMidnight());
}

const monthOrder = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro', 'A confirmar'];

export function classStartDate(dateText) {
  const text = String(dateText || '');
  if (!text || classMonth(text) === 'A confirmar') return null;
  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    const year = Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]);
    return new Date(Date.UTC(year, month, day));
  }
  const month = classMonth(text);
  const monthIndex = monthOrder.indexOf(month);
  if (monthIndex < 0 || month === 'A confirmar') return null;
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date()));
  // Bug achado em 07/09/2026: pegar o MENOR número do texto lia "18 de Janeiro a 08 de Junho"
  // como dia 8, e a matrícula do Cabeleireiro Diurno fechava 10 dias antes da hora (a turma
  // sumia da agenda pública com vaga aberta). O primeiro dia é o que vem escrito antes do
  // primeiro nome de mês — "dia de mês", como se escreve em português.
  const flat = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const firstMonth = flat.match(/janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro/i);
  const scope = firstMonth ? flat.slice(0, firstMonth.index) : flat;
  const daysBefore = [...scope.matchAll(/\b(\d{1,2})\b/g)].map((match) => Number(match[1])).filter((value) => value >= 1 && value <= 31);
  const allDays = [...flat.matchAll(/\b(\d{1,2})\b/g)].map((match) => Number(match[1])).filter((value) => value >= 1 && value <= 31);
  const day = daysBefore.length ? daysBefore[0] : (allDays.length ? allDays[0] : 1);
  return new Date(Date.UTC(year, monthIndex, day));
}

// Último dia da turma (pedido da Erica, 07/09/2026: a Minha Área precisa saber quando a turma
// já acabou). As datas são texto livre: turma curta vem como "06 de Setembro de 2026" e turma
// longa como "14 de Setembro a 26 de Outubro de 2026" — o fim está escrito ali, é só ler o
// último trecho. Espelho de classStartDate(), que lê o primeiro.
//
// Não dá pra pegar simplesmente o maior número do texto: em "26 de Setembro a 3 de Outubro" o
// maior dia (26) é do PRIMEIRO mês, e a turma acabaria "no dia 26 de outubro". Por isso o dia
// procurado é o último que aparece ANTES do último nome de mês — que é como a data se escreve
// em português ("dia de mês").
export function classEndDate(dateText) {
  const text = String(dateText || '');
  if (!text || classMonth(text) === 'A confirmar') return null;

  const numeric = [...text.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g)];
  if (numeric.length) {
    const last = numeric[numeric.length - 1];
    const year = Number(last[3].length === 2 ? `20${last[3]}` : last[3]);
    return new Date(Date.UTC(year, Number(last[2]) - 1, Number(last[1])));
  }

  // Mesma string normalizada pros dois casamentos: tirar acento muda o tamanho do texto
  // ("Março" -> "Marco"), e comparar posição de um texto com a do outro daria índice errado.
  const flat = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const months = [...flat.matchAll(/janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro/gi)];
  if (!months.length) return null;
  const lastMonth = months[months.length - 1];
  const monthIndex = monthLookup[lastMonth[0].toLowerCase()]?.index;
  if (monthIndex === undefined) return null;

  const daysBefore = [...flat.slice(0, lastMonth.index).matchAll(/\b(\d{1,2})\b/g)]
    .map((match) => Number(match[1]))
    .filter((day) => day >= 1 && day <= 31);
  const day = daysBefore.length ? daysBefore[daysBefore.length - 1] : 1;

  const years = [...flat.matchAll(/\b(20\d{2})\b/g)];
  const year = years.length
    ? Number(years[years.length - 1][1])
    : Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date()));

  return new Date(Date.UTC(year, monthIndex, day));
}

// A turma acabou quando o dia seguinte ao último dia já chegou (no fuso oficial da escola):
// no próprio dia da aula ela ainda está acontecendo, então nada de dizer que terminou.
export function isClassFinished(dateText) {
  const endDate = classEndDate(dateText);
  if (!endDate) return false;
  return startOfToday().getTime() > endDate.getTime();
}

// Regra da escola: a matrícula fecha 1 dia antes do início da aula (mesma regra replicada no
// servidor em lib/courses.mjs). Antes o curso só saía da agenda na data da aula, sem uma
// janela de matrícula própria (P1.3 do Manual do produto).
const ENROLLMENT_CLOSES_DAYS_BEFORE_CLASS = 1;

export function enrollmentClosesAt(dateText) {
  const startDate = classStartDate(dateText);
  if (!startDate) return null;
  const closesAt = new Date(startDate);
  closesAt.setUTCDate(closesAt.getUTCDate() - ENROLLMENT_CLOSES_DAYS_BEFORE_CLASS);
  return closesAt;
}

export function isClassDateExpired(dateText) {
  const closesAt = enrollmentClosesAt(dateText);
  if (!closesAt) return false;
  return closesAt <= startOfToday();
}

export function displayMonth(month) { return month === 'A confirmar' ? 'Datas a confirmar' : month; }

export function monthRank(month) {
  const index = monthOrder.indexOf(month);
  return index >= 0 ? index : 99;
}

export function dayRank(dateText) {
  const found = String(dateText || '').match(/\b(\d{1,2})\b/);
  return found ? Number(found[1]) : 99;
}

export function sortDatesChronologically(a, b) {
  const monthDiff = monthRank(classMonth(a)) - monthRank(classMonth(b));
  if (monthDiff) return monthDiff;
  return dayRank(a) - dayRank(b);
}
