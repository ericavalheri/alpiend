// Componentes de UI reaproveitados entre páginas públicas e painéis do admin (avatar da
// aluna, upload de arquivo, imagem com fallback, cabeçalho/rodapé do site, cartão de curso,
// resumo de contrato Voomp, banner de instalação do PWA). Extraído de src/main.jsx
// (organização de arquivos pedida pela Erica, 05/09/2026).
import { useEffect, useState } from 'react';
import { brand, partnerLogos } from '../lib/brand.js';
import { tenant } from '../lib/tenant.js';
import { track } from '../lib/analytics.js';
import { money, classMonth } from '../lib/format.js';
import {
  whatsappLink, voompPaymentSplit, displayPrice, firstDateForMonth, isContactOnly, isSoldOut,
  paymentInfo, offerDescription, availabilityLabel, classCapacity, primaryCta, selectedOffer,
} from '../lib/catalog-helpers.js';
import { PRE_SALE_NOTICE } from '../lib/contracts.js';

// Aviso de pré-venda (desconto por tempo limitado). Só aparece nos cursos vendidos pela Voomp —
// é deles a condição de pré-venda, quando existir. O texto vem de um lugar só
// (PRE_SALE_NOTICE em src/lib/contracts.js) pra que card, página do curso e tela de aceite
// digam exatamente a mesma coisa. Sem texto configurado, não renderiza nada.
export function PreSaleNotice({ course, compact = false }) {
  if (course?.flow !== 'voomp') return null;
  if (!PRE_SALE_NOTICE.texto && !PRE_SALE_NOTICE.curto) return null;
  if (compact) return <p className="preSaleNotice preSaleNotice--compact">{PRE_SALE_NOTICE.curto}</p>;
  return <div className="preSaleNotice"><strong>{PRE_SALE_NOTICE.titulo}</strong><span>{PRE_SALE_NOTICE.texto}</span></div>;
}

export function StudentAvatarHead({ large = false }) {
  return <span className={large ? 'studentAvatarHead studentAvatarHead--large' : 'studentAvatarHead'} aria-hidden="true" />;
}

export function StudentAvatarVisual({ avatarDef, large = false, photoSrc = '' }) {
  if (photoSrc) {
    return <div className="studentAvatarPhotoBadge"><img src={photoSrc} alt="" /></div>;
  }
  if (avatarDef?.src) {
    return <div className={large ? 'studentAvatarFigure studentAvatarFigure--large' : 'studentAvatarFigure'}>
      <img className="studentAvatarFigure__image" src={avatarDef.src} alt="" />
    </div>;
  }
  return <div className={large ? `studentAvatarBody ${avatarDef.className}` : `studentJourneyAvatar ${avatarDef.className}`}>
    <StudentAvatarHead large={large} />
  </div>;
}

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const UPLOAD_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Campo de upload reutilizável (materiais e certificados, pedido da Erica 04/09/2026): em vez
// de só aceitar link/caminho já hospedado, deixa anexar o arquivo (PDF ou imagem, até 3MB)
// direto do computador. Guarda o arquivo como data URL em `value` e some com o link normal
// quando tem um arquivo escolhido, pra não confundir qual dos dois vale.
export function AdminFileField({ id, label, value, fileName, onChange, error }) {
  async function handlePick(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      onChange(null, '', 'Arquivo maior que 3MB. Escolha um arquivo menor ou use o link.');
      event.target.value = '';
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      onChange(dataUrl, file.name, '');
    } catch {
      onChange(null, '', 'Não consegui ler esse arquivo. Tente novamente.');
    }
    event.target.value = '';
  }
  return <label htmlFor={id} className="adminFileField">
    {label}
    {value ? (
      <span className="adminFileField__chosen">
        <span>📎 {fileName}</span>
        <button type="button" className="button button--outline" onClick={() => onChange(null, '', '')}>Remover</button>
      </span>
    ) : (
      <input id={id} type="file" accept={UPLOAD_ACCEPT} onChange={handlePick} />
    )}
    {error && <small className="adminFileField__error">{error}</small>}
  </label>;
}

export function SafeImage({ src, alt, className, loading = 'lazy' }) {
  const [failed, setFailed] = useState(false);
  if (failed || !src) return <div className={`${className || ''} imageFallback`} role="img" aria-label={alt}><img src={brand.logo} alt="" /></div>;
  return <img src={src} alt={alt} className={className} loading={loading} onError={() => setFailed(true)} />;
}

export function ResponsiveImage({ desktop, mobile, fallback, alt, className, loading = 'lazy' }) {
  const [failed, setFailed] = useState(false);
  const fallbackSrc = fallback || desktop || mobile;
  if (failed || (!desktop && !mobile && !fallbackSrc)) return <div className={`${className || ''} imageFallback`} role="img" aria-label={alt}><img src={brand.logo} alt="" /></div>;
  return <picture><source media="(max-width: 759px)" srcSet={mobile || fallbackSrc} /><img src={desktop || fallbackSrc} alt={alt} className={className} loading={loading} onError={() => setFailed(true)} /></picture>;
}

export function Header() {
  const navItems = [
    { label: 'Agenda', href: '/#agenda' },
    { label: 'Cursos', href: '/#agenda' },
    { label: 'Localização', href: '/#footer-location-title' },
    { label: 'Privacidade', href: '/politica-de-privacidade' },
  ];
  return <header className="siteHeader">
    <div className="topbar"><span>📍 {tenant.localCurto}</span><span>☎ {tenant.whatsappVisivel}</span><span>✉ {tenant.email}</span></div>
    <div className="navBar">
      <a className="navBrand" href="/" aria-label="a escola — página inicial"><img src={brand.logo} alt={`a escola — ${tenant.nomeCompleto}`} className="brandLogo" /></a>
      <nav className="mainNav" aria-label="Menu principal">{navItems.map((item) => <a key={item.label} href={item.href}>{item.label}</a>)}</nav>
      <a className="navCta" href={whatsappLink({ name: 'agenda de cursos' })}>Falar no WhatsApp</a>
    </div>
  </header>;
}

export function Footer() {
  return <footer className="ebnFooter">
    <section className="ebnFooter__partners" aria-labelledby="footer-partners-title"><div className="ebnFooter__inner"><div className="ebnFooter__sectionHead"><p className="eyebrow">Parceiros a escola</p><h2 id="footer-partners-title">Marcas que caminham com a nossa formação</h2><p>Uma rede de parceiros que reforça a experiência prática dos alunos dentro da escola.</p></div><div className="ebnFooter__logos">{partnerLogos.map((logo) => <div className="ebnFooter__logoCard" key={logo.src}><img src={logo.src} alt={logo.name} loading="lazy" /></div>)}</div></div></section>
    <section className="ebnFooter__location" aria-labelledby="footer-location-title"><div className="ebnFooter__inner ebnFooter__locationGrid"><div className="ebnFooter__locationCard"><p className="eyebrow">Onde estamos</p><h2 id="footer-location-title">Onde as aulas acontecem</h2><p className="ebnFooter__lead">{tenant.descricao}</p><div className="ebnFooter__infoGrid"><div><span>Endereço</span><strong>{tenant.local}</strong></div><div><span>Atendimento</span><strong>{tenant.atendimento}</strong></div><div><span>Contato</span><strong><a href={`mailto:${tenant.email}`}>{tenant.email}</a></strong></div></div></div><div className="ebnFooter__map"><iframe title={`Mapa — ${tenant.nome}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={`https://www.google.com/maps?q=${encodeURIComponent(tenant.local)}&output=embed`}></iframe><a className="ebnFooter__mapLink" href={tenant.mapa || `https://www.google.com/maps?q=${encodeURIComponent(tenant.local)}`} target="_blank" rel="noreferrer">Abrir no Google Maps</a></div></div></section>
    <section className="ebnFooter__institutional"><div className="ebnFooter__inner ebnFooter__institutionalGrid"><div className="ebnFooter__brand"><img src={brand.logo} alt="a escola" /><p>{tenant.nomeCompleto}</p></div><div className="ebnFooter__links"><span>Políticas</span><a href="/politica-de-privacidade">Política de Privacidade</a></div><div className="ebnFooter__legal"><span>Dados institucionais</span><p>CNPJ {tenant.cnpj}</p><p>{tenant.razaoSocial}</p></div></div><div className="ebnFooter__credit">Desenvolvido com ❤️ por: Cavalheri Agência WEB</div></section>
  </footer>;
}

export function VoompFlow({ course, selectedDate }) {
  if (course.flow !== 'voomp') return null;
  const { enrollmentFee, priceNumber, parcelas } = voompPaymentSplit(course, selectedDate);
  const total = priceNumber ? money(Math.round(priceNumber * 100)) : (displayPrice(course, selectedDate) || course.price);
  const installment = enrollmentFee ? money(Math.round(enrollmentFee * 100)) : 'valor informado no checkout';
  return <div className="voompFlow"><p className="eyebrow">Como funciona a matrícula</p><h2>Inscrição + {parcelas}x sem juros</h2><p>Para este profissionalizante, o investimento total é {total}: uma inscrição de {installment}, paga na plataforma oficial indicada pela escola para confirmar sua vaga, mais {parcelas} parcelas de {installment} sem juros, combinadas à parte, direto com o atendimento.</p><div className="voompFlow__grid"><div><strong>1</strong><span>Você lê as condições principais da matrícula</span></div><div><strong>2</strong><span>Confirma ciência da inscrição de {installment} e das {parcelas} parcelas de {installment} sem juros</span></div><div><strong>3</strong><span>Depois do aceite, paga a inscrição no link oficial</span></div><div><strong>4</strong><span>Se preferir, fala com o atendimento antes de pagar</span></div></div><PreSaleNotice course={course} /></div>;
}

export function CourseCard({ course, activeMonth }) {
  const initialDate = firstDateForMonth(course, activeMonth);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  useEffect(() => setSelectedDate(firstDateForMonth(course, activeMonth)), [course.agendaCardId || course.slug, activeMonth]);
  return <article className={isContactOnly(course, selectedDate) ? "course course--contact" : "course"} id={`curso-${course.agendaCardId || course.slug}`}>
    <a className="course__imageWrap" href={`/curso/${course.slug}?turma=${encodeURIComponent(selectedDate)}`} onClick={() => track('select_course_card', { course_slug: course.slug })}>
      <SafeImage src={course.image} alt={course.name} className="course__image" />
      <span className={`course__status ${isSoldOut(course, selectedDate) ? 'course__status--soldout' : ''}`}>{isSoldOut(course, selectedDate) ? 'Turma lotada' : course.status}</span>
    </a>
    <div className="course__body">
      <div className="course__meta"><span>{course.category}</span><span>{displayPrice(course, selectedDate)}</span></div>
      <div className="course__featuredPrice"><strong>{paymentInfo(course, selectedDate).featured}</strong><span>{paymentInfo(course, selectedDate).featuredSub}</span></div>
      <PreSaleNotice course={course} compact />
      <h3><a href={`/curso/${course.slug}`}>{course.name}</a></h3>
      <p>{course.promise}</p>
      {classMonth(selectedDate) === 'A confirmar' ? <div className="datePicker datePicker--notice"><span>Turma</span><strong>Datas em negociação pelo atendimento</strong></div> : <label className="datePicker"><span>{course.variants ? 'Escolha a opção' : 'Escolha a turma'}</span><select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>{course.dates.map((date) => <option key={date}>{date}</option>)}</select></label>} {offerDescription(course, selectedDate) && <div className="variantNote">{offerDescription(course, selectedDate)}</div>}
      <ul className="course__facts"><li>📍 {course.location || tenant.localCurto}</li><li>🎟️ {availabilityLabel(course, selectedDate)} de {classCapacity(course, selectedDate)}</li><li>💳 {paymentInfo(course, selectedDate).card}</li><li>🧾 {paymentInfo(course, selectedDate).boleto}</li><li>⚡ {paymentInfo(course, selectedDate).pix}</li></ul>
      <div className="course__actions"><a className="button button--primary" href={primaryCta(course, selectedDate).href}>{primaryCta(course, selectedDate).label}</a><a className="button button--light" href={`/curso/${course.slug}?turma=${encodeURIComponent(selectedDate)}`}>Mais informações</a></div>
    </div>
  </article>;
}

const INSTALL_DISMISS_KEY = 'ebn_student_install_dismissed_v1';

function isStandaloneApp() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function detectInstallPlatform() {
  const ua = window.navigator.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

// Minha Área funciona como app instalável no celular (PWA já configurado: manifest.webmanifest
// + sw.js). Faltava avisar a aluna que isso existe — Android/Chrome tem prompt nativo
// (beforeinstallprompt), mas o Safari do iPhone nunca mostra esse prompt sozinho, então quem
// usa iPhone precisa do passo a passo manual (Compartilhar > Adicionar à Tela de Início).
export function InstallAppBanner() {
  const [platform] = useState(detectInstallPlatform);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(() => window.localStorage.getItem(INSTALL_DISMISS_KEY) === '1');
  const [installed, setInstalled] = useState(isStandaloneApp);
  const [showSteps, setShowSteps] = useState(false);
  // Link do WhatsApp abre num navegador embutido do próprio app (Android Custom Tabs), que o
  // Chrome nunca libera o prompt automático de instalação — não é código nosso que resolve isso,
  // é preciso abrir no Chrome de verdade primeiro. document.referrer nesse caso vem como
  // "android-app://com.whatsapp" (cada app embutido tem o seu), diferente de abrir direto no navegador.
  const [openedFromApp] = useState(() => /^android-app:\/\//.test(document.referrer || ''));

  useEffect(() => {
    function onBeforeInstallPrompt(event) {
      event.preventDefault();
      setDeferredPrompt(event);
    }
    function onInstalled() { setInstalled(true); }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function dismiss() {
    window.localStorage.setItem(INSTALL_DISMISS_KEY, '1');
    setDismissed(true);
  }

  async function installAndroid() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    setDeferredPrompt(null);
    track('student_pwa_install_prompted');
  }

  if (installed || dismissed) return null;

  return <div className="installAppBanner">
    <div className="installAppBanner__icon"><img src="/assets/marca/app-icon.svg" alt="" /></div>
    <div className="installAppBanner__copy">
      <strong>Instale a Minha Área no seu celular</strong>
      <span>Acesse mais rápido, direto da tela inicial, sem precisar abrir o navegador.</span>
      {!deferredPrompt && platform === 'android' && openedFromApp && <>
        <ol className="installAppBanner__steps">
          <li>Toque nos três pontinhos (⋮) aqui em cima da tela</li>
          <li>Escolha "Abrir no Chrome" (ou "Abrir no navegador")</li>
          <li>Na página aberta no Chrome, toque em "Instalar agora"</li>
        </ol>
        <small className="installAppBanner__note">Esse link foi aberto direto do WhatsApp — o navegador embutido dele não libera o botão de instalar com 1 toque. Abrindo no Chrome, ele aparece.</small>
      </>}
      {!deferredPrompt && showSteps && platform === 'ios' && <ol className="installAppBanner__steps">
        <li>Toque no ícone de Compartilhar (□ com uma seta ↑) na barra do Safari</li>
        <li>Escolha "Adicionar à Tela de Início"</li>
        <li>Toque em "Adicionar" — pronto, o app aparece na sua tela</li>
      </ol>}
      {!deferredPrompt && showSteps && platform === 'android' && !openedFromApp && <ol className="installAppBanner__steps">
        <li>Toque nos três pontinhos (⋮) no canto do navegador</li>
        <li>Toque em "Instalar app" ou "Adicionar à tela inicial"</li>
        <li>Confirme — o app aparece na sua tela</li>
      </ol>}
      {!deferredPrompt && showSteps && platform === 'android' && !openedFromApp && <small className="installAppBanner__note">Se essa opção ainda não aparecer no menu, é o navegador que ainda não liberou — geralmente libera depois de navegar mais um pouco pelo site. Pode tentar de novo daqui a pouco.</small>}
      {!deferredPrompt && showSteps && platform === 'desktop' && <ol className="installAppBanner__steps">
        <li>Procure o ícone de instalação (um monitor ou uma tela com seta ⊕) do lado direito da barra de endereço</li>
        <li>Ou abra o menu (⋮) do navegador e toque em "Instalar Minha Área..."</li>
        <li>Confirme — o app abre numa janela própria, sem as abas do navegador</li>
      </ol>}
    </div>
    <div className="installAppBanner__actions">
      {deferredPrompt ? (
        <button type="button" className="button button--primary" onClick={installAndroid}>Instalar agora</button>
      ) : platform === 'android' && openedFromApp ? null : showSteps ? null : (
        <button type="button" className="button button--primary" onClick={() => setShowSteps(true)}>Como instalar</button>
      )}
      <button type="button" className="linkButton" onClick={dismiss}>Agora não</button>
    </div>
  </div>;
}

export function ContractSummary({ course, selectedDate }) {
  const offer = selectedOffer(course, selectedDate);
  const { enrollmentFee, remainingBalance, priceNumber, parcelas } = voompPaymentSplit(course, selectedDate);
  const total = priceNumber ? money(Math.round(priceNumber * 100)) : (displayPrice(course, selectedDate) || course.price);
  const matricula = enrollmentFee ? money(Math.round(enrollmentFee * 100)) : 'valor informado no checkout';
  // São 13 pagamentos iguais: a inscrição na Voomp mais 12 parcelas (ver PAGAMENTOS_COM_CONTRATO).
  const demaisParcelas = enrollmentFee ? `${parcelas}x de ${matricula} (sem juros)` : 'valor informado após a matrícula';
  const saldo = remainingBalance ? money(Math.round(remainingBalance * 100)) : null;
  // As cláusulas específicas (frequência mínima, uniforme, uso de imagem, cancelamento...) saíram
  // daqui de propósito: eram as regras do curso da escola anterior, e não se aplicam a qualquer
  // cliente. O que sobra é só o que é sempre verdadeiro — dados da turma e a conta do pagamento,
  // as duas coisas que este componente calcula de verdade. Regra específica de curso deve vir de
  // CLASS_TABLES/CONTRACT_BODY (src/lib/contracts.js) quando existir contrato assinado, não de
  // texto solto aqui.
  return <div className="contractSummary"><div className="contractHeader"><p className="eyebrow">Leia antes de continuar</p><h2>Condições principais da matrícula</h2><p>Este é um resumo operacional das condições que precisam ficar claras antes do pagamento da matrícula. O objetivo é evitar qualquer dúvida antes de avançar.</p></div><div className="contractValues"><div><span>Inscrição (paga agora, via Voomp)</span><strong>{matricula}</strong></div><div><span>Demais parcelas (combinadas à parte)</span><strong>{demaisParcelas}</strong></div><div><span>Valor total do curso (inscrição + {parcelas}x)</span><strong>{total}</strong></div></div><PreSaleNotice course={course} /><div className="contractClauses"><section><h3>Turma e carga horária</h3><ul><li>{offer?.label || course.voomp?.contractModel || course.dates[0]}</li><li>{offer?.schedule || course.voomp?.schedule || selectedDate || course.dates[0]}</li><li>{offer?.period || selectedDate || course.dates[0]}</li><li>{offer?.workloadText || course.voomp?.workloadText || course.workload}</li><li>O cronograma pode sofrer ajustes por agenda, feriados e situações operacionais, preservando a carga horária contratada.</li></ul></section><section><h3>Pagamento e matrícula</h3><ul><li>O pagamento feito agora, no checkout oficial, corresponde apenas à inscrição ({matricula}). O valor total do curso é {total}: a inscrição mais {parcelas} parcelas de {matricula} sem juros{saldo ? `, que somam ${saldo}` : ''}.</li><li>Pagar a inscrição não é o pagamento total do curso: as {demaisParcelas} serão cobradas depois, à parte (boleto, cartão etc.), na forma de pagamento que você escolher, conforme estipulado no contrato de matrícula.</li><li>A confirmação da matrícula depende da validação dos dados e da confirmação do pagamento da matrícula.</li></ul></section><section><h3>Cancelamento e demais regras</h3><ul><li>As condições completas de cancelamento, desistência e continuidade da matrícula constam no contrato de matrícula desta turma, quando exigido, ou serão informadas pelo atendimento antes do pagamento.</li><li>O aluno(a) declara que leu e compreendeu estas condições antes de solicitar o link de pagamento da matrícula.</li></ul></section></div></div>;
}
