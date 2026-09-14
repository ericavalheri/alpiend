// Webhook da Voomp no modo de produção (achado em 11/09/2026, respondendo à pergunta da Erica
// sobre a tela de Aceites: "você está puxando os dados da Voomp ou da agenda?").
//
// Resposta: só da agenda. E o único caminho pelo qual uma venda da Voomp entrava na agenda —
// o webhook — estava morto em produção. `markVoompPaymentReturn` tinha implementação apenas
// para Postgres direto; no modo Supabase REST (que é o de produção) ele levantava
// `voomp_payment_requires_postgres`, o webhook devolvia 500 e a venda nunca era registrada.
// Nem as vendas feitas pela agenda. Sem registro não saía WhatsApp de acesso, não subia evento
// de Compra pra Meta, e o painel mostrava matrícula sem pagamento.
//
// Antes disso ainda havia um segundo buraco: quem comprava direto na Voomp, sem passar pela
// agenda, não tinha cadastro aqui, e o ramo REST da busca só PROCURAVA — nunca criava. O
// webhook desistia com `voomp_enrollment_not_found`, em silêncio, respondendo 200.
import assert from 'node:assert/strict';

delete process.env.DATABASE_URL;
delete process.env.DATABASE_URL;
process.env.SUPABASE_URL = 'https://exemplo.supabase.co';
process.env.SUPABASE_SERVICE_ROLE = 'chave-de-teste';

// Banco de mentira mínimo, só o suficiente pra distinguir leitura de escrita e pra deixar a
// tabela `classes` responder — é ela que segura a regra de capacidade.
function criarBanco({ alunaExistente = null, matriculaExistente = null, turma = null, pagamentoExistente = null } = {}) {
  const chamadas = [];
  let seq = 0;
  const estado = { turma };
  globalThis.fetch = async (url, options = {}) => {
    const caminho = String(url).replace('https://exemplo.supabase.co/rest/v1/', '');
    const tabela = caminho.split('?')[0];
    const metodo = options.method || 'GET';
    chamadas.push({ metodo, tabela, caminho, corpo: options.body ? JSON.parse(options.body) : null });
    let resposta = [];
    if (metodo === 'GET') {
      if (tabela === 'students' && alunaExistente) resposta = [alunaExistente];
      if (tabela === 'enrollments' && matriculaExistente) resposta = [matriculaExistente];
      if (tabela === 'classes' && estado.turma) resposta = [estado.turma];
      if (tabela === 'payments' && pagamentoExistente) resposta = [pagamentoExistente];
    } else if (metodo === 'POST' && options.body) {
      seq += 1;
      resposta = [{ id: `${tabela}-${seq}`, ...JSON.parse(options.body) }];
    } else if (metodo === 'PATCH') {
      // reserveClassSeat usa compare-and-swap: PATCH com sold_count=eq.X só acerta se ninguém
      // mexeu no meio. Só devolve linha quando o valor esperado ainda é o atual.
      if (tabela === 'classes' && estado.turma) {
        const esperado = /sold_count=eq\.(\d+)/.exec(caminho);
        if (esperado && Number(esperado[1]) === Number(estado.turma.sold_count)) {
          estado.turma = { ...estado.turma, ...JSON.parse(options.body) };
          resposta = [estado.turma];
        }
      } else {
        resposta = [JSON.parse(options.body)];
      }
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(resposta) };
  };
  return { chamadas, estado };
}

const { markVoompPaymentReturn } = await import('./lib/db.mjs');

const vendaPaga = {
  provider: 'voomp', event: 'voomp_payment_confirmed', voompStatus: 'paid',
  voompSaleId: 'venda-1', paymentId: 'pag-1', amount: '6098.64',
  courseSlug: 'cabeleireiro-profissional', courseName: 'Cabeleireiro Profissional',
  classDate: 'Turma Cabeleireiro 2027',
  name: 'Aluna Teste', email: 'aluna@exemplo.com', whatsapp: '11999990000',
};

// 1. Venda feita direto na Voomp, de quem nunca passou pela agenda.
{
  const { chamadas } = criarBanco({ turma: { id: 'turma-1', sold_count: 0, reserved_count: 0, capacity: 18 } });
  const resultado = await markVoompPaymentReturn(vendaPaga, { ip: '1.2.3.4' });
  const escritas = (tabela) => chamadas.filter((c) => c.metodo === 'POST' && c.tabela === tabela);
  assert.equal(resultado.updated, true, 'venda direta na Voomp tem que ser registrada');
  assert.equal(resultado.paid, true);
  assert.equal(escritas('students').length, 1, 'precisa criar a aluna que não existia');
  assert.equal(escritas('enrollments').length, 1, 'precisa criar a matrícula');
  assert.equal(escritas('payments').length, 1, 'precisa gravar o pagamento');
  assert.equal(resultado.seatReservation.reserved, true, 'pagamento confirmado ocupa vaga');
}
console.log('OK  venda feita direto na Voomp entra no painel (aluna, matrícula e pagamento)');

// 2. Venda pela agenda: a aluna e a matrícula já existem, nada é duplicado.
{
  const aluna = { id: 'aluna-1', name: 'Aluna Teste', email: 'aluna@exemplo.com', whatsapp: '11999990000', metadata: {} };
  const matricula = { id: 'matricula-1', student_id: 'aluna-1', status: 'awaiting_payment', amount_expected: 6098.64, course_slug: 'cabeleireiro-profissional', course_name: 'Cabeleireiro Profissional', class_date: 'Turma Cabeleireiro 2027', metadata: {} };
  const { chamadas } = criarBanco({ alunaExistente: aluna, matriculaExistente: matricula, turma: { id: 'turma-1', sold_count: 3, reserved_count: 0, capacity: 18 } });
  const resultado = await markVoompPaymentReturn(vendaPaga, { ip: '1.2.3.4' });
  assert.equal(resultado.updated, true);
  assert.equal(resultado.studentId, 'aluna-1', 'tem que reaproveitar a aluna da agenda');
  assert.equal(resultado.enrollmentId, 'matricula-1', 'tem que reaproveitar a matrícula da agenda');
  assert.equal(chamadas.filter((c) => c.metodo === 'POST' && c.tabela === 'students').length, 0, 'não pode duplicar a aluna');
  assert.equal(chamadas.filter((c) => c.metodo === 'POST' && c.tabela === 'enrollments').length, 0, 'não pode duplicar a matrícula');
  const matriculaAtualizada = chamadas.find((c) => c.metodo === 'PATCH' && c.tabela === 'enrollments');
  assert.equal(matriculaAtualizada?.corpo?.status, 'payment_received', 'a matrícula tem que virar paga');
}
console.log('OK  venda pela agenda confirma a matrícula existente, sem duplicar cadastro');

// 3. Turma lotada: a venda é registrada, mas NÃO inventa vaga (regra P0.5).
{
  const aluna = { id: 'aluna-1', name: 'Aluna Teste', email: 'aluna@exemplo.com', whatsapp: '11999990000', metadata: {} };
  const matricula = { id: 'matricula-1', student_id: 'aluna-1', status: 'awaiting_payment', course_slug: 'cabeleireiro-profissional', class_date: 'Turma Cabeleireiro 2027', metadata: {} };
  const { chamadas, estado } = criarBanco({ alunaExistente: aluna, matriculaExistente: matricula, turma: { id: 'turma-1', sold_count: 18, reserved_count: 0, capacity: 18 } });
  const resultado = await markVoompPaymentReturn(vendaPaga, { ip: '1.2.3.4' });
  assert.equal(resultado.seatReservation.reserved, false, 'turma lotada não pode reservar vaga');
  assert.equal(Number(estado.turma.sold_count), 18, 'sold_count não pode passar da capacidade');
  const matriculaAtualizada = chamadas.find((c) => c.metodo === 'PATCH' && c.tabela === 'enrollments');
  assert.equal(matriculaAtualizada?.corpo?.status, 'paid_capacity_exceeded', 'a escola precisa ver que vendeu além da vaga');
  const alerta = chamadas.find((c) => c.metodo === 'POST' && c.tabela === 'tracking_events' && c.corpo?.event_name === 'capacity_exceeded_alert');
  assert.ok(alerta, 'tem que registrar o alerta de capacidade estourada');
}
console.log('OK  turma lotada: venda registrada e sinalizada, sem vender vaga que não existe');

// 4. Webhook repetido do mesmo pagamento não ocupa a vaga duas vezes.
{
  const aluna = { id: 'aluna-1', name: 'Aluna Teste', email: 'aluna@exemplo.com', whatsapp: '11999990000', metadata: {} };
  const matricula = { id: 'matricula-1', student_id: 'aluna-1', status: 'payment_received', course_slug: 'cabeleireiro-profissional', class_date: 'Turma Cabeleireiro 2027', metadata: {} };
  const { chamadas, estado } = criarBanco({
    alunaExistente: aluna, matriculaExistente: matricula,
    turma: { id: 'turma-1', sold_count: 5, reserved_count: 0, capacity: 18 },
    pagamentoExistente: { id: 'pagamento-1', status: 'received', metadata: {} },
  });
  const resultado = await markVoompPaymentReturn(vendaPaga, { ip: '1.2.3.4' });
  assert.equal(resultado.updated, true);
  assert.equal(resultado.seatReservation, null, 'pagamento já confirmado não reserva vaga de novo');
  assert.equal(Number(estado.turma.sold_count), 5, 'a vaga não pode ser contada duas vezes');
  assert.equal(chamadas.filter((c) => c.metodo === 'POST' && c.tabela === 'payments').length, 0, 'não pode duplicar o pagamento');
}
console.log('OK  webhook repetido não conta a mesma venda nem a mesma vaga duas vezes');

// 5. Estorno na Voomp libera a vaga (regra §16.4).
{
  const aluna = { id: 'aluna-1', name: 'Aluna Teste', email: 'aluna@exemplo.com', whatsapp: '11999990000', metadata: {} };
  const matricula = { id: 'matricula-1', student_id: 'aluna-1', status: 'payment_received', course_slug: 'cabeleireiro-profissional', class_date: 'Turma Cabeleireiro 2027', metadata: {} };
  const { chamadas } = criarBanco({
    alunaExistente: aluna, matriculaExistente: matricula,
    turma: { id: 'turma-1', sold_count: 5, reserved_count: 0, capacity: 18 },
    pagamentoExistente: { id: 'pagamento-1', status: 'received', metadata: {} },
  });
  await markVoompPaymentReturn({ ...vendaPaga, event: 'saleUpdated', voompStatus: 'refunded' }, { ip: '1.2.3.4' });
  const matriculaAtualizada = chamadas.find((c) => c.metodo === 'PATCH' && c.tabela === 'enrollments');
  assert.equal(matriculaAtualizada?.corpo?.status, 'cancelled_refunded', 'estorno tem que cancelar a matrícula');
  const evento = chamadas.find((c) => c.metodo === 'POST' && c.tabela === 'tracking_events' && c.corpo?.event_name === 'enrollment_cancelled_refund');
  assert.ok(evento, 'estorno tem que ficar registrado');
}
console.log('OK  estorno na Voomp cancela a matrícula e devolve a vaga');

// 6. Nenhum dos dois caminhos pode voltar a desistir por falta de Postgres direto.
{
  const { readFileSync } = await import('node:fs');
  const db = readFileSync('lib/db.mjs', 'utf8');
  // Procura o `throw`, não a palavra: o comentário que explica o bug também cita o código do erro.
  assert.ok(!/code = 'voomp_payment_requires_postgres'/.test(db),
    'markVoompPaymentReturn voltou a exigir Postgres direto — em produção isso zera o registro de vendas da Voomp');
  const inicio = db.indexOf('async function findOrCreateVoompEnrollment(');
  const corpo = db.slice(inicio, db.indexOf('export async function markVoompPaymentReturn('));
  assert.ok(/if \(!DATABASE_URL\) \{[\s\S]*supabaseRequest\('students', \{[\s\S]*method: 'POST'/.test(corpo),
    'o ramo Supabase precisa criar a aluna da venda direta, não só procurar');
}
console.log('OK  os dois caminhos funcionam nos dois modos de banco');
