// Página pública do certificado (pedido da Erica, 09/09/2026).
//
// Serve pras duas coisas ao mesmo tempo: é o certificado que a aluna abre e imprime, e é a
// prova de autenticidade que qualquer pessoa consulta pelo código do rodapé. Um salão que
// recebe o certificado de uma candidata digita o endereço, vê o mesmo documento no site da escola
// e sabe que é verdadeiro — se não abrir, não é da escola.
//
// Não tem login de propósito: quem abre é quem RECEBEU o documento, não a dona dele. Por isso
// a página mostra só o que já está impresso no papel, e nada do cadastro da aluna.
//
// O desenho de fundo é a arte oficial da escola quando ela existir (a escola vai enviar). Até lá,
// o certificado é composto aqui, com a identidade da escola — sai imprimível hoje, e trocar
// pela arte definitiva depois é só apontar pra imagem.
import { useEffect, useState } from 'react';
import { tenant } from '../lib/tenant.js';
import { certificateDisplayCode } from '../lib/certificate-code.js';

function formatarData(iso) {
  if (!iso) return '';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
}

export function CertificatePage({ code = '' }) {
  const [state, setState] = useState({ loading: true, certificate: null, error: '' });

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const response = await fetch(`/api/certificado?code=${encodeURIComponent(code)}`);
        const data = await response.json().catch(() => ({}));
        if (!ativo) return;
        if (!response.ok || !data.ok) throw new Error(data.error || 'certificate_not_found');
        setState({ loading: false, certificate: data.certificate, error: '' });
      } catch (error) {
        if (ativo) setState({ loading: false, certificate: null, error: error.message });
      }
    })();
    return () => { ativo = false; };
  }, [code]);

  if (state.loading) {
    return <section className="section certificatePage"><div className="certificateStatus"><p className="eyebrow">a escola</p><h1>Conferindo certificado...</h1></div></section>;
  }

  if (!state.certificate) {
    return <section className="section certificatePage">
      <div className="certificateStatus certificateStatus--invalid">
        <p className="eyebrow">a escola — {tenant.nomeCompleto}</p>
        <h1>Certificado não encontrado</h1>
        <p>Nenhum certificado da escola corresponde ao código <strong>{code || '(vazio)'}</strong>. Confira as letras e números com o documento em mãos — o código fica no rodapé.</p>
        <p className="certificateStatus__hint">Se o código está certo e mesmo assim não abre, o documento não foi emitido por esta escola.</p>
        <a className="button button--outline" href="/">Ver os cursos da escola</a>
      </div>
    </section>;
  }

  const { studentName, courseName, classDate, workload, issuedAt } = state.certificate;
  return <section className="section certificatePage">
    {/* A tarja de conferido não vai pro papel: no impresso ela seria ruído, e quem imprime já
        sabe que é dela. Na tela é o que responde a pergunta de quem está conferindo. */}
    <div className="certificateVerified">
      <span className="certificateVerified__mark">✓</span>
      <div>
        <strong>Certificado válido, emitido pela escola</strong>
        <small>Consulta feita agora em {tenant.dominio} pelo código {certificateDisplayCode(state.certificate.code)}.</small>
      </div>
    </div>

    <article className="certificateSheet">
      {/* Marca desenhada com texto, não com imagem: certificado é documento — não pode sair do
          papel com um quadradinho de foto quebrada porque a hospedagem da logo estava fora. */}
      <header className="certificateSheet__head">
        <span className="certificateSheet__mark">a escola</span>
        <span>{tenant.nomeCompleto}</span>
      </header>

      <p className="certificateSheet__kicker">Certificado de conclusão</p>
      <p className="certificateSheet__intro">Certificamos que</p>
      <h1 className="certificateSheet__name">{studentName || 'Aluna a escola'}</h1>
      <p className="certificateSheet__body">
        concluiu o curso <strong>{courseName}</strong>
        {classDate ? <> na turma de <strong>{classDate}</strong></> : null}
        {workload ? <>, com carga horária de <strong>{workload}</strong></> : null}
        , com presença confirmada pela escola.
      </p>

      <div className="certificateSheet__foot">
        <div className="certificateSheet__sign">
          <span />
          <strong>a escola — {tenant.nomeCompleto}</strong>
          <small>{tenant.local}</small>
        </div>
        <div className="certificateSheet__code">
          <span>Código de validação</span>
          <strong>{certificateDisplayCode(state.certificate.code)}</strong>
          <small>Confira em {tenant.dominio}/certificado/{certificateDisplayCode(state.certificate.code)}</small>
          {issuedAt && <small>Emitido em {formatarData(issuedAt)}</small>}
        </div>
      </div>
    </article>

    <div className="certificateActions">
      <button type="button" className="button button--primary" onClick={() => window.print()}>Salvar em PDF ou imprimir</button>
      <p>No celular, o botão abre a opção de imprimir — escolha “Salvar como PDF” para guardar o arquivo.</p>
    </div>
  </section>;
}
