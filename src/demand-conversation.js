const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const categoryLabels = { campaign: 'Campanha', organic: 'Conteúdo orgânico', print: 'Material impresso', website: 'Site', video: 'Vídeo', other: 'Demanda' };
const categoryTerms = [
  ['campaign', /\b(campanha|anuncio|ads|trafego|criativo|meta ads|google ads)\b/],
  ['website', /\b(site|landing page|pagina|wordpress|elementor)\b/],
  ['video', /\b(video|reel|reels|edicao|editar)\b/],
  ['print', /\b(folder|impresso|impressao|banner|faixa|panfleto)\b/],
  ['organic', /\b(organico|post|stories|story|carrossel|social media|rede social)\b/],
];
const people = [['Erica', /\berica\b/], ['Felipe', /\bfelipe\b/], ['Flavio', /\bflavio\b/], ['Gabriela', /\b(gabriela|gabi)\b/], ['Daniel', /\bdaniel\b/]];
const statuses = [
  ['changes_requested', /(alteracao solicitada|precisa (?:de|fazer) alteracao|pediram? ajustes?|ajuste solicitado|voltar para ajuste)/],
  ['approval', /(aguardando (?:a )?aprovacao|para aprovacao|em aprovacao|enviar para aprovacao|pode ir para aprovacao)/],
  ['waiting_info', /(aguardando (?:informacoes|retorno|material|conteudo|a ebn)|esperando (?:informacoes|retorno|material|conteudo|a ebn)|ebn (?:precisa|vai) (?:mandar|enviar))/],
  ['in_progress', /(em producao|em andamento|produzindo|comecar a produzir|iniciar producao)/],
  ['approved', /\b(aprovado|aprovada)\b/], ['completed', /\b(concluido|concluida|finalizado|finalizada)\b/],
  ['queued', /(na fila|colocar na fila|enfileirado|enfileirada)/], ['received', /(recebido|recebida|nova demanda)/],
];

const weekDays = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
const isoDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const sentence = (value) => value ? `${value.charAt(0).toUpperCase()}${value.slice(1).replace(/[.;,\s]+$/, '')}.` : '';

function parseDueDate(text, normalized, now) {
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const br = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (br) { let year = br[3] ? Number(br[3]) : now.getFullYear(); if (year < 100) year += 2000; return `${year}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`; }
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (/(?:^|\s)amanha(?:\s|[,.!?]|$)/.test(normalized)) target.setDate(target.getDate() + 1);
  else if (!/\bhoje\b/.test(normalized)) {
    const match = Object.entries(weekDays).find(([name]) => new RegExp(`\\b${name}\\b`).test(normalized));
    if (!match) return '';
    let distance = Number(match[1]) - target.getDay(); if (distance <= 0) distance += 7; target.setDate(target.getDate() + distance);
  }
  return isoDate(target);
}

function extractWaitingFor(text) {
  return text.match(/(?:aguardando|esperando) (?:da |pela |a )?a escola\s*[:\-]?\s*([^.;\n]+)/i)?.[1]?.trim()
    || text.match(/(?:aguardando|esperando)\s+([^.;\n]+?)\s+(?:da|pela)\s+a escola/i)?.[1]?.trim()
    || text.match(/(?:a )?a escola (?:precisa|vai) (?:mandar|enviar)\s+([^.;\n]+)/i)?.[1]?.trim() || '';
}

function listItems(items) {
  if (items.length < 2) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`;
}

function buildSummary(text, title, category, items, hasExplicitTitle) {
  if (hasExplicitTitle && items.length) return sentence(`${categoryLabels[category]} “${title}”, composta por ${listItems(items)}`);
  const metadata = /(prioridade|urgente|responsavel|prazo|entrega\s*https?|https?:|visivel|ocult|aguardando|esperando|aprovacao|aprovad|status|na fila|em producao|em andamento|checklist|etapas|itens|tarefas\s*:|fica com|ebn (?:precisa|vai) (?:mandar|enviar))/;
  const parts = text.split(/\n|(?<=[.!?])\s+|,\s*/).map((part) => part.trim().replace(/[.!?]+$/, '')).filter(Boolean);
  const useful = parts.filter((part) => !metadata.test(normalize(part))).slice(0, 3);
  const raw = useful.join('. ').replace(/^(precisamos|precisa|favor|por favor)\s+/i, '').trim();
  const summary = raw || title;
  return sentence(summary.slice(0, 360));
}

export function parseDemandConversation(text, templates, now = new Date()) {
  const clean = text.trim(); const normalized = normalize(clean);
  const category = categoryTerms.find(([, pattern]) => pattern.test(normalized))?.[0] || 'other';
  const namedPerson = people.find(([, pattern]) => pattern.test(normalized))?.[0];
  const explicitOwner = clean.match(/respons[aá]vel\s*[:\-]?\s*([\p{L}]+(?:\s+[\p{L}]+)?)/iu)?.[1]?.trim();
  const owner = namedPerson || explicitOwner || templates[category]?.owner || '';
  const priority = /(urgente|prioridade\s+alta|alta\s+prioridade|prioridade\s+maxima)/.test(normalized) ? 'high' : /(prioridade\s+baixa|baixa\s+prioridade|pode esperar|sem pressa)/.test(normalized) ? 'low' : 'normal';
  const status = statuses.find(([, pattern]) => pattern.test(normalized))?.[0] || 'received';
  const deliveryUrl = clean.match(/https?:\/\/[^\s,;]+/i)?.[0]?.replace(/[.)]+$/, '') || '';
  const waitingFor = extractWaitingFor(clean);
  const clientVisible = !/(nao visivel|ocult[oa]|somente (?:agencia|interno)|nao mostrar (?:para |a )?ebn)/.test(normalized);
  const itemsText = clean.match(/(?:os\s+)?itens\s+do\s+checklist\s+(?:s[aã]o|ser[aã]o)?\s*[:,]?\s*([\s\S]*?)(?=(?:\s*,?\s*prioridade\b|$))/i)?.[1]
    || clean.match(/(?:etapas|itens|checklist|tarefas)\s*:\s*([\s\S]*?)(?=(?:\s*,?\s*prioridade\b|$))/i)?.[1] || '';
  const customItems = itemsText.split(/[;|•]|,\s*(?:e\s+)?/i).map((item) => item.trim().replace(/^(?:e\s+)/i, '').replace(/[.]+$/, '').replace(/\s+/g, ' ')).filter(Boolean);
  const checklist = (customItems.length ? customItems : templates[category]?.items || []).map((itemTitle, index) => ({ id: `conversation-${Date.now()}-${index + 1}`, title: itemTitle, done: false }));
  const explicitTitle = clean.match(/(?:o\s+)?t[ií]tulo\s*(?:é|e|:|-)\s*([^,.\n]+)/i)?.[1]?.trim();
  const firstUseful = clean.split(/\n|,|\.(?:\s|$)/).map((part) => part.trim()).find((part) => part && !/(prioridade|respons[aá]vel|prazo|aguardando|status|https?:)/i.test(part)) || clean;
  const title = (explicitTitle || firstUseful
    .replace(/^(nova? demanda(?: para)?|precisamos (?:de|fazer)|o cliente pediu para|a ebn pediu para|fl[aá]vio (?:vai|precisa) (?:fazer|criar))\s+/i, '')
    .replace(/^(criar|fazer|adicionar|incluir)\s+/i, '')).trim().slice(0, 100);
  return { title: title || clean.slice(0, 100), description: buildSummary(clean, title, category, customItems, Boolean(explicitTitle)), category, status, owner, priority, dueDate: parseDueDate(clean, normalized, now), waitingFor, deliveryUrl, clientVisible, checklist };
}
