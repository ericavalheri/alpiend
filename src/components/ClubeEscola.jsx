// Convite do Clube da Escola (pedido da Erica, 11/09/2026).
//
// O problema que ele resolve: a a escola não tem equipe comercial. Quem chega do anúncio, olha o
// curso e vai embora não deixa rastro nenhum — a Meta sabe que essa pessoa existe, mas a escola
// não tem como falar com ela. Aqui ela deixa nome e WhatsApp com aceite explícito e entra no CRM.
//
// O convite aparece UMA vez, depois que a pessoa leu a página e não clicou em matricular.
import { useEffect, useRef, useState } from 'react';
import { track, getAttribution } from '../lib/analytics.js';
import { newMetaEventId } from '../lib/meta-events.js';
import { postJson } from '../lib/api.js';
import { tenant } from '../lib/tenant.js';

// Vazio desliga o convite do clube: sem grupo configurado, o modal não aparece.
export const CLUBE_WHATSAPP_URL = tenant.grupoWhatsapp;
const CONSENT_TEXT = 'Quero receber no WhatsApp as novidades, turmas e condições especiais da escola.';
const CHAVE = 'ebn_clube_estado';

function estadoGuardado() {
  try { return JSON.parse(window.localStorage.getItem(CHAVE) || 'null') || {}; } catch { return {}; }
}

function guardar(patch) {
  try { window.localStorage.setItem(CHAVE, JSON.stringify({ ...estadoGuardado(), ...patch })); } catch { /* navegador sem armazenamento: o convite só aparece de novo, não quebra nada */ }
}

// `course` é opcional: na agenda a pessoa ainda não escolheu curso nenhum, e o convite vale
// igual — é ali que estão as visitas que chegam do anúncio e nem clicam num curso.
export function ClubeEscola({ course = null, classDate = '', origem = 'curso' }) {
  const cursoSlug = course?.slug || '';
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState({ name: '', whatsapp: '', optIn: true });
  const [estado, setEstado] = useState({ loading: false, error: '', pronto: false });
  const jaMostrou = useRef(false);

  useEffect(() => {
    const guardado = estadoGuardado();
    // Quem já entrou ou já fechou não vê de novo. Insistir com quem disse não é o jeito mais
    // rápido de a pessoa associar a marca a incômodo.
    if (guardado.entrou || guardado.fechou) return undefined;

    function mostrar(motivo) {
      if (jaMostrou.current) return;
      jaMostrou.current = true;
      setAberto(true);
      track('clube_escola_convite_exibido', { course_slug: cursoSlug, origem, motivo });
    }

    // Três gatilhos, porque um só não cobre os dois aparelhos:
    // - saída do mouse pela parte de cima: intenção de sair, mas SÓ existe no computador;
    // - rolagem até 70% da página: funciona no celular, que é de onde vem a maior parte do
    //   tráfego de anúncio;
    // - 45 segundos: pega quem ficou lendo sem rolar.
    const aoSairDoTopo = (evento) => { if (evento.clientY <= 0) mostrar('saida'); };
    const aoRolar = () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      if (total > 0 && (window.scrollY / total) >= 0.7) mostrar('rolagem');
    };
    const relogio = window.setTimeout(() => mostrar('tempo'), 45000);
    document.addEventListener('mouseout', aoSairDoTopo);
    window.addEventListener('scroll', aoRolar, { passive: true });
    return () => {
      window.clearTimeout(relogio);
      document.removeEventListener('mouseout', aoSairDoTopo);
      window.removeEventListener('scroll', aoRolar);
    };
  }, [cursoSlug]);

  function fechar() {
    setAberto(false);
    guardar({ fechou: true });
    if (!estado.pronto) track('clube_escola_convite_fechado', { course_slug: cursoSlug, origem });
  }

  async function enviar(evento) {
    evento.preventDefault();
    if (!form.optIn) { setEstado({ loading: false, error: 'Marque o aceite para receber as mensagens.', pronto: false }); return; }
    setEstado({ loading: true, error: '', pronto: false });
    const metaEventId = newMetaEventId('clube_escola_signup', getAttribution().session_id);
    try {
      await postJson('/api/clube', {
        name: form.name,
        whatsapp: form.whatsapp,
        optIn: form.optIn,
        courseSlug: cursoSlug,
        courseName: course?.name || '',
        classDate,
        consentText: CONSENT_TEXT,
        metaEventId,
        attribution: getAttribution(),
      });
      guardar({ entrou: true });
      setEstado({ loading: false, error: '', pronto: true });
      track('clube_escola_signup', { meta_event_id: metaEventId, course_slug: cursoSlug, class_date: classDate, origem });
    } catch (erro) {
      const mensagens = {
        dados_incompletos: 'Confira o nome e o WhatsApp com DDD.',
        consentimento_obrigatorio: 'Marque o aceite para receber as mensagens.',
      };
      setEstado({ loading: false, error: mensagens[erro.message] || 'Não consegui cadastrar agora. Tente de novo em instantes.', pronto: false });
    }
  }

  if (!aberto) return null;

  return <div className="clubeOverlay" role="presentation" onClick={fechar}>
    <aside className="clubeCard" role="dialog" aria-labelledby="clube-titulo" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="clubeCard__fechar" onClick={fechar} aria-label="Fechar convite">×</button>
      {estado.pronto ? <div className="clubeCard__pronto">
        <p className="eyebrow">Clube da Escola</p>
        <h2 id="clube-titulo">Pronto, {form.name.split(' ')[0]}!</h2>
        <p>Agora é só entrar no grupo. É lá que a equipe a escola avisa das turmas novas antes de todo mundo.</p>
        <a className="button button--primary" href={CLUBE_WHATSAPP_URL} target="_blank" rel="noreferrer" onClick={() => track('clube_escola_grupo_aberto', { course_slug: cursoSlug, origem })}>Entrar no grupo do Clube da Escola</a>
        <button type="button" className="linkButton" onClick={fechar}>Agora não, continuar vendo o curso</button>
      </div> : <form className="clubeCard__form" onSubmit={enviar}>
        <p className="eyebrow">Clube da Escola</p>
        <h2 id="clube-titulo">{course ? 'Ainda pensando nesse curso?' : 'Não achou a turma certa hoje?'}</h2>
        <p>Entre no Clube da Escola e acompanhe de perto. É onde a equipe a escola avisa das turmas novas, das condições especiais e manda conteúdo de técnica antes de sair em qualquer lugar.</p>
        <label htmlFor="clube-nome">Seu nome<input id="clube-nome" required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Como podemos te chamar" autoComplete="name" /></label>
        <label htmlFor="clube-whatsapp">WhatsApp<input id="clube-whatsapp" required inputMode="tel" value={form.whatsapp} onChange={(e) => setForm((p) => ({ ...p, whatsapp: e.target.value }))} placeholder="(11) 90000-0000" autoComplete="tel" /></label>
        <label className="clubeCard__aceite"><input type="checkbox" checked={form.optIn} onChange={(e) => setForm((p) => ({ ...p, optIn: e.target.checked }))} /><span>{CONSENT_TEXT}</span></label>
        {estado.error && <p className="clubeCard__erro">{estado.error}</p>}
        <button type="submit" className="button button--primary" disabled={estado.loading}>{estado.loading ? 'Cadastrando...' : 'Quero entrar no Clube'}</button>
        <small>Você pode sair quando quiser, é só pedir na própria conversa.</small>
      </form>}
    </aside>
  </div>;
}
