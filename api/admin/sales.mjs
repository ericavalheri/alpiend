// Relatório de vendas (pedido da Erica, 09/09/2026): TODAS as vendas, com filtro por período,
// curso, situação do pagamento e situação da turma.
//
// Endpoint separado do /api/admin/summary de propósito. O summary é o resumo do dashboard: ele
// busca as últimas dezenas de linhas de cada tabela, o que é razoável pra um resumo e errado
// pra um relatório — passando de 80 matrículas a lista parava sem avisar, e o corte dos
// pagamentos, independente do corte das matrículas, fazia venda antiga aparecer como não paga.
// Aqui a busca é paginada até acabar e a filtragem é feita no servidor.
import { authConfig, hasPermission, verifySession } from '../../lib/admin_auth.mjs';
import { isDbConfigured, salesReport } from '../../lib/db.mjs';

function texto(value = '', max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Aceita só AAAA-MM-DD. Data mal formada vira "sem filtro" em vez de recorte silencioso e
// errado — pior que não filtrar é filtrar escondendo venda sem ninguém perceber.
function data(value = '') {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : '';
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const config = authConfig();
  const session = config.configured ? verifySession(request, config.sessionSecret) : null;
  if (!hasPermission(session, 'dashboard')) {
    return response.status(403).json({ ok: false, error: 'forbidden' });
  }
  if (!isDbConfigured()) {
    return response.status(503).json({ ok: false, error: 'database_not_configured' });
  }

  const query = request.query || {};
  try {
    const relatorio = await salesReport({
      from: data(query.from),
      to: data(query.to),
      courseSlug: texto(query.course, 180),
      situation: texto(query.situation, 40),
      classState: texto(query.classState, 20),
      search: texto(query.search, 120),
    });
    return response.status(200).json({ ok: true, ...relatorio });
  } catch (error) {
    console.error('sales_report_failed', error);
    return response.status(500).json({ ok: false, error: error.code || 'sales_report_failed' });
  }
}
