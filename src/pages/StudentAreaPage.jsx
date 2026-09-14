// Área da aluna (Minha Área): login por código de acesso, jornada, cadastro, materiais,
// check-in, certificado e avaliação. Extraído de src/main.jsx (organização de arquivos
// pedida pela Erica, 05/09/2026).
import { useEffect, useState } from 'react';
import { brand, courseImageBySlug } from '../lib/brand.js';
import { fallbackCourses } from '../catalog.js';
import { useCatalog } from '../lib/catalog-context.js';
import { track } from '../lib/analytics.js';
import { postJson } from '../lib/api.js';
import { classStartDate, classEndDate, isClassFinished } from '../lib/format.js';
import { qrMatrix, qrSvgPath, qrSvgSize } from '../lib/qrcode.js';
import { whatsappLink, whatsappBenefitLink } from '../lib/catalog-helpers.js';
import {
  getStudentAccessCountKey, studentPhotoStorageKey, getStudentJourneyStage, pickStudentAvatar,
  findStudentAvatarByKey, journeyItemsProgress, continueEnrollmentUrl, allStudentAvatars,
} from '../lib/student-journey.js';
import { StudentAvatarVisual, SafeImage, InstallAppBanner } from '../components/shared.jsx';

// Ícones simples (linha, sem preenchimento) usados na navegação da Minha Área — pedido da
// Erica, 06/09/2026: dar mais "cara de app" à área da aluna, com navegação fixa (barra lateral
// no desktop, abas embaixo no celular) em vez das abas em pílula rolando na horizontal.
// QR do check-in. O conteúdo é o endereço do painel com o código já preenchido: a recepção
// aponta a câmera, cai na Minha Área do painel (onde já está logada) com o código no campo, e
// só confirma. Quem não quiser escanear digita o código, que fica logo acima — os dois
// caminhos levam à mesma conferência no servidor.
//
// O gerador é nosso (src/lib/qrcode.js) e é conferido lendo o QR de volta em
// scripts-check-qrcode.mjs. Desenhado como um <path> só, em vez de centenas de <rect>.
// Endereço que o QR carrega: o painel da escola com o código já no campo. Usa o domínio de onde
// a aluna está acessando, então funciona igual em produção e em teste, sem configuração.
function checkinQrValue(codigo) {
  const origem = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origem}/painel/alunos?checkin=${encodeURIComponent(codigo)}`;
}

function StudentCheckinQr({ value }) {
  const modulos = qrMatrix(value);
  if (!modulos) return null;
  const lado = qrSvgSize(modulos);
  return (
    <svg className="studentCheckinQr" viewBox={`0 0 ${lado} ${lado}`} role="img" aria-label="QR code do seu check-in">
      <rect width={lado} height={lado} fill="#fff" />
      <path d={qrSvgPath(modulos)} fill="#2d2926" />
    </svg>
  );
}

function StudentIcon({ name }) {
  const props = { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const shapes = {
    home: <path d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    book: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H6.5A2.5 2.5 0 0 0 4 20.5zm16 0A2.5 2.5 0 0 0 17.5 3H14v18a3 3 0 0 1 3-3h.5a2.5 2.5 0 0 1 2.5 2.5z" />,
    check: <path d="m5 12 4 4L19 6" />,
    award: <><circle cx="12" cy="8" r="5" /><path d="m8.8 12-1.3 9 4.5-2.5 4.5 2.5-1.3-9" /></>,
    bell: <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9zM10 21h4" />,
    message: <path d="M4 4h16v12H8l-4 4z" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    download: <path d="M12 3v12m-5-5 5 5 5-5M5 21h14" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4m8-4v4M3 10h18" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    gift: <><rect x="3" y="9" width="18" height="12" rx="2" /><path d="M12 9v12M3 13h18M7.5 9C4 9 4 4 7 4c2.5 0 5 5 5 5m4.5 0C20 9 20 4 17 4c-2.5 0-5 5-5 5" /></>,
    star: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  };
  return <svg {...props}>{shapes[name] || null}</svg>;
}

// Marca "a escola" em bloco laranja arredondado, igual ao template que a Erica recebeu (pedido da
// Erica, 06/09/2026) — no lugar da logo em foto, pra ficar com cara de ícone de app de verdade.
function StudentBrandMark() {
  return <span className="studentAppBrand__mark">a escola</span>;
}

// Capa do curso (pedido da Erica, 06/09/2026): quando não existe foto real cadastrada pra
// aquele slug (caso de um curso de teste criado só pelo painel), mostra um bloco colorido com
// o nome do curso — igual ao template — em vez do logo genérico da escola (fallback do site
// inteiro, que não tem a ver com o curso específico).
const COURSE_COVER_PALETTE = [
  'linear-gradient(135deg, #f99048, #b95f21)',
  'linear-gradient(135deg, #3f444b, #2d2926)',
  'linear-gradient(135deg, #a39d8b, #6f6b5f)',
];

function courseCoverGradient(slug) {
  const sum = String(slug || '').split('').reduce((total, char) => total + char.charCodeAt(0), 0);
  return COURSE_COVER_PALETTE[sum % COURSE_COVER_PALETTE.length];
}

function CourseCover({ slug, name, image, className }) {
  if (image) return <SafeImage src={image} alt={name} className={className} />;
  return <div className={className} style={{ background: courseCoverGradient(slug), display: 'grid', placeItems: 'center', padding: '14px' }}><span className="studentCourseCover__label">{name}</span></div>;
}

// Aba própria de "Selos e benefícios" (pedido da Erica, 07/09/2026, a partir da versão 2 do
// template): o clube de vantagens deixa de ser um bloco no fim da Jornada e vira página, com
// label curto na barra de baixo do celular (onde só cabem seis itens).
const NAV_ITEMS = [
  { key: 'jornada', label: 'Jornada', icon: 'home' },
  { key: 'cursos', label: 'Cursos', icon: 'book' },
  { key: 'agenda', label: 'Agenda', icon: 'calendar' },
  { key: 'certificado', label: 'Certificado', icon: 'award' },
  { key: 'beneficios', label: 'Selos e benefícios', shortLabel: 'Benefícios', icon: 'gift' },
  { key: 'cadastro', label: 'Cadastro', icon: 'user' },
];

// Regra da escola (confirmada pela escola em 09/09/2026): quem fecha um curso já sai com 20% no
// próximo curso de especialização. Antes era uma escala que crescia a cada curso (5%, 10%...
// até 30%) — a escola não trabalha assim. Do segundo degrau em diante o prêmio é brinde, e
// quem diz qual é o cadastro do painel, não esta tela.
const NEXT_COURSE_DISCOUNT = 20;
const LADDER_STEPS = 6;

// Ícone de cada selo. A regra de "como conquistar" quem manda é o servidor (campo rule de
// buildBadgeCatalog, em lib/db.mjs): aqui só escolhemos o desenho. Os degraus da trilha de
// cursos (curso_1..curso_6) contam a progressão — começo, estudo e especialização.
const BADGE_ICONS = {
  course_review: 'message',
  class_attendance: 'calendar',
  progressive_discount: 'gift',
};

function badgeIconFor(key = '') {
  const milestone = /^curso_(\d+)$/.exec(String(key));
  if (milestone) {
    const level = Number(milestone[1]);
    if (level <= 1) return 'star';
    return level >= 6 ? 'award' : 'book';
  }
  return BADGE_ICONS[key] || 'award';
}

function badgeRuleFor(badge) {
  return badge.rule || badge.benefitLabel || '';
}

const WEEKDAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

// Grade de um mês inteiro (6 semanas), com os dias do mês anterior/seguinte que aparecem nas
// pontas em tom apagado — mesmo cálculo de data usado no resto do site (dias em UTC, sem
// depender do fuso do aparelho de quem está vendo).
function buildCalendarGrid(year, month) {
  const startWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < totalCells; i += 1) {
    const date = new Date(Date.UTC(year, month, i - startWeekday + 1));
    cells.push({ date, muted: date.getUTCMonth() !== month });
  }
  return cells;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function greetingForHour(hour) {
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

// "Há 20 minutos" / "Ontem" / "15 de maio" (pedido da Erica, 06/09/2026, a partir do template
// que ela recebeu) — cada aviso mostra quando foi enviado, não só o texto.
function notificationTimeLabel(sentAt) {
  const date = new Date(sentAt || '');
  if (Number.isNaN(date.getTime())) return '';
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return 'Agora mesmo';
  if (diffMinutes < 60) return `Há ${diffMinutes} minuto${diffMinutes === 1 ? '' : 's'}`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `Há ${diffHours} hora${diffHours === 1 ? '' : 's'}`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return `Há ${diffDays} dias`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}

// Categoria/mentora exibidas no card do curso (pedido da Erica, 06/09/2026, a partir do
// template que ela recebeu) — vêm do catálogo estático por enquanto (mesma fonte de
// courseImageBySlug), já que o portal da aluna não devolve esses campos.
// Curso da matrícula: procura primeiro no catálogo ao vivo (o mesmo que a home usa, vindo do
// banco por /api/health?resource=courses) e só depois no arquivo do código. Antes olhava apenas
// o arquivo, então curso cadastrado pelo painel entrava na Minha Área sem capa, sem categoria e
// sem mentora — foi o que a Erica viu no curso de teste (pedido dela, 08/09/2026).
function courseCatalogFor(slug, liveCatalog = []) {
  return liveCatalog.find((course) => course.slug === slug)
    || fallbackCourses.find((course) => course.slug === slug)
    || null;
}

// A capa segue a mesma ordem: a do catálogo ao vivo (que é a que aparece na agenda pública),
// depois a foto fixa por slug e, se não houver nenhuma, o bloco colorido com o nome do curso.
// Fotos genéricas da escola: o catálogo ao vivo passa por normalizeCourse(), que preenche
// course.image com uma dessas quando o curso não tem capa própria. Se aceitássemos isso como
// capa, todo curso sem arte cadastrada mostraria a mesma foto de parede na Minha Área — em vez
// do bloco colorido com o nome do curso, que é o que a Erica aprovou no template.
const CAPAS_GENERICAS = new Set([brand.logo, brand.school, brand.school2, brand.school3].filter(Boolean));

function courseCoverImage(slug, liveCatalog = []) {
  const live = liveCatalog.find((course) => course.slug === slug);
  const candidata = live?.image || courseImageBySlug[slug] || '';
  return CAPAS_GENERICAS.has(candidata) ? '' : candidata;
}

// Onde o acesso da aluna fica guardado neste aparelho (pedido da Erica, 07/09/2026: o login
// caía a cada atualização de página). O token em si já vale 45 dias (signStudentAccess, em
// lib/student_access.mjs) — o que faltava era o navegador lembrar dele: ele só existia na
// memória da página, então qualquer refresh, ou fechar e abrir o app, voltava pro login.
const STUDENT_TOKEN_KEY = 'ebn_student_access_token';

function readStoredToken() {
  try {
    return window.localStorage.getItem(STUDENT_TOKEN_KEY) || '';
  } catch {
    // Navegador com armazenamento bloqueado (aba anônima, cookies desligados): sem token
    // guardado a aluna só entra pelo link ou pelo código, que é o comportamento de antes.
    return '';
  }
}

function storeToken(value) {
  try {
    if (value) window.localStorage.setItem(STUDENT_TOKEN_KEY, value);
    else window.localStorage.removeItem(STUDENT_TOKEN_KEY);
  } catch {
    /* sem armazenamento disponível: segue só na memória da sessão */
  }
}

export function StudentAreaPage() {
  const liveCatalog = useCatalog();
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token') || '';
  const savedToken = urlToken ? '' : readStoredToken();
  const [token, setToken] = useState(urlToken || savedToken);
  const [form, setForm] = useState({ email: '', cpfLast4: '', code: '' });
  const [state, setState] = useState({ loading: Boolean(urlToken || savedToken), portal: null, error: '' });
  const [accessIndex, setAccessIndex] = useState(0);
  const [identity, setIdentity] = useState({ email: '', cpfLast4: '' });
  const [otpStep, setOtpStep] = useState('identity');
  const [otpStatus, setOtpStatus] = useState({ loading: false, error: '', info: '' });
  const [activeTab, setActiveTab] = useState('jornada');
  const [profileForm, setProfileForm] = useState({ name: '', email: '', whatsapp: '', avatarKey: '' });
  const [profileStatus, setProfileStatus] = useState({ loading: false, error: '', success: '' });
  const [studentPhoto, setStudentPhoto] = useState('');
  // Guardado por enrollmentId (não um formulário único): uma aluna com mais de um curso
  // pago pode ter mais de uma matrícula concluída e ainda sem avaliação ao mesmo tempo — um
  // estado único misturaria a nota/texto de um curso com o de outro.
  const [reviewForms, setReviewForms] = useState({});
  const [reviewStatus, setReviewStatus] = useState({ loading: false, error: '', success: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [courseFilter, setCourseFilter] = useState('todos');
  const [expandedCourseId, setExpandedCourseId] = useState('');
  const [calendarMonthOffset, setCalendarMonthOffset] = useState(0);
  const [selectedAgendaDay, setSelectedAgendaDay] = useState('');
  const [reviewFocusId, setReviewFocusId] = useState('');

  async function loadPortal(accessToken) {
    setState({ loading: true, portal: null, error: '' });
    try {
      const response = await fetch('/api/student/portal', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: accessToken }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'student_access_failed');
      setState({ loading: false, portal: data.portal, error: '' });
      storeToken(accessToken);
      // Link do WhatsApp traz o token na URL. Depois de entrar, ele sai da barra de endereço:
      // fica guardado aqui no aparelho e para de aparecer em print, histórico ou link
      // compartilhado sem querer — quem tem o endereço tem o acesso.
      if (urlToken) {
        const limpa = new URL(window.location.href);
        limpa.searchParams.delete('token');
        window.history.replaceState({}, '', limpa.pathname + (limpa.search || '') + limpa.hash);
      }
      setIdentity({ email: form.email, cpfLast4: form.cpfLast4 });
      const accessCountKey = getStudentAccessCountKey(data.portal);
      const nextAccessCount = Number(window.localStorage.getItem(accessCountKey) || '0') + 1;
      window.localStorage.setItem(accessCountKey, String(nextAccessCount));
      setAccessIndex(nextAccessCount);
      track('student_portal_authenticated', { method: urlToken ? 'secure_link' : 'access_code' });
    } catch (error) {
      const messages = {
        student_access_not_found: 'Não encontrei uma matrícula com esses dados.',
        student_access_token_required: 'Peça um novo acesso pelo atendimento.',
        invalid_student_access_token: 'Esse link de acesso não está válido.',
        expired_student_access_token: 'Esse link expirou. Peça um novo acesso pelo atendimento.',
        student_access_secret_not_configured: 'A área restrita ainda precisa ter o segredo de acesso configurado.',
      };
      // Token recusado (expirado, inválido ou matrícula não encontrada): apaga o que estava
      // guardado, senão o app tentaria o mesmo acesso quebrado a cada abertura.
      storeToken('');
      setState({ loading: false, portal: null, error: messages[error.message] || 'Não consegui liberar seu acesso agora.' });
      setOtpStep('identity');
    }
  }

  useEffect(() => {
    track('view_student_area');
    if (token) loadPortal(token);
  }, [token]);

  async function requestAccessCode(event) {
    event.preventDefault();
    setOtpStatus({ loading: true, error: '', info: '' });
    try {
      await postJson('/api/student/request-access-code', { email: form.email, cpfLast4: form.cpfLast4 });
      setOtpStatus({ loading: false, error: '', info: 'Se encontrarmos essa matrícula, enviamos um código de acesso pelo WhatsApp cadastrado. Ele vale por 10 minutos.' });
      setOtpStep('code');
      track('student_access_code_requested');
    } catch {
      setOtpStatus({ loading: false, error: 'Não consegui enviar o código agora. Tente novamente ou fale com o atendimento.', info: '' });
    }
  }

  async function verifyAccessCode(event) {
    event.preventDefault();
    setOtpStatus({ loading: true, error: '', info: '' });
    try {
      const result = await postJson('/api/student/verify-access-code', { email: form.email, cpfLast4: form.cpfLast4, code: form.code });
      setOtpStatus({ loading: false, error: '', info: '' });
      setOtpStep('identity');
      setForm((prev) => ({ ...prev, code: '' }));
      setToken(result.token);
      track('student_access_code_verified');
    } catch (error) {
      const messages = {
        invalid_access_code: 'Código incorreto. Confira e tente novamente.',
        expired_access_code: 'Esse código expirou. Peça um novo.',
        too_many_attempts: 'Muitas tentativas com esse código. Peça um novo.',
      };
      setOtpStatus({ loading: false, error: messages[error.message] || 'Não consegui confirmar o código agora.', info: '' });
    }
  }

  useEffect(() => {
    if (!state.portal?.student) return;
    const savedPhoto = window.localStorage.getItem(studentPhotoStorageKey(state.portal.student.id)) || '';
    setStudentPhoto(savedPhoto);
    setProfileForm({
      name: state.portal.student.name || '',
      email: state.portal.student.email || '',
      whatsapp: state.portal.student.whatsapp || '',
      avatarKey: state.portal.student.profile?.avatarKey || '',
    });
  }, [state.portal?.student?.id]);

  function updateProfileField(key, value) {
    setProfileForm((prev) => ({ ...prev, [key]: value }));
    setProfileStatus({ loading: false, error: '', success: '' });
  }

  function uploadStudentPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setProfileStatus({ loading: false, error: 'Escolha uma imagem válida.', success: '' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '');
      if (!value) return;
      window.localStorage.setItem(studentPhotoStorageKey(state.portal.student.id), value);
      setStudentPhoto(value);
      setProfileStatus({ loading: false, error: '', success: 'Foto atualizada neste aparelho.' });
      track('student_profile_photo_updated');
    };
    reader.readAsDataURL(file);
  }

  async function saveProfile(event) {
    event.preventDefault();
    setProfileStatus({ loading: true, error: '', success: '' });
    try {
      const result = await postJson('/api/student/profile', {
        token,
        profile: {
          name: profileForm.name,
          email: profileForm.email,
          whatsapp: profileForm.whatsapp,
          avatarKey: profileForm.avatarKey,
        },
      });
      setState({ loading: false, portal: result.portal, error: '' });
      setIdentity((prev) => ({ ...prev, email: result.portal?.student?.email || profileForm.email }));
      setProfileStatus({ loading: false, error: '', success: 'Cadastro atualizado.' });
      track('student_profile_updated');
    } catch (error) {
      const messages = {
        invalid_student_email: 'Confira o e-mail antes de salvar.',
        student_access_not_found: 'Não consegui confirmar sua matrícula para salvar.',
      };
      setProfileStatus({ loading: false, error: messages[error.message] || 'Não consegui salvar agora.', success: '' });
    }
  }

  function getReviewForm(enrollmentId) {
    return reviewForms[enrollmentId] || { rating: 5, text: '' };
  }

  function updateReviewForm(enrollmentId, patch) {
    setReviewForms((prev) => ({ ...prev, [enrollmentId]: { ...getReviewForm(enrollmentId), ...patch } }));
  }

  async function submitReview(event, enrollmentId) {
    event.preventDefault();
    setReviewStatus({ loading: true, error: '', success: false });
    try {
      const { rating, text } = getReviewForm(enrollmentId);
      const result = await postJson('/api/student/review', {
        token,
        enrollmentId,
        rating,
        text,
      });
      setState({ loading: false, portal: result.portal, error: '' });
      setReviewStatus({ loading: false, error: '', success: true });
      setReviewForms((prev) => { const next = { ...prev }; delete next[enrollmentId]; return next; });
      track('student_course_reviewed');
    } catch (error) {
      const messages = {
        invalid_course_review: 'Escreva um pouco mais sobre o curso (mínimo 10 caracteres) e escolha uma nota.',
        course_not_completed: 'Esse curso ainda não está marcado como concluído.',
        review_already_submitted: 'Você já avaliou esse curso — obrigada!',
      };
      setReviewStatus({ loading: false, error: messages[error.message] || 'Não consegui registrar sua avaliação agora.', success: false });
    }
  }

  if (state.loading) return <section className="studentArea studentArea--locked"><div className="studentLoginCard"><p className="eyebrow">Minha Área</p><h1>Validando seu acesso...</h1><p>Estamos conferindo sua matrícula com segurança.</p></div></section>;

  if (!state.portal) return <section className="studentArea studentArea--locked">
    <div className="studentLoginCard">
      <p className="eyebrow">Minha Área</p>
      <h1>Entre na área da aluna</h1>
      {otpStep === 'identity' ? <>
        <p>Acesse com o link recebido no WhatsApp ou informe o e-mail usado na matrícula e os 4 últimos dígitos do CPF para receber um código de acesso.</p>
        <form className="studentLoginForm" onSubmit={requestAccessCode}>
          <label htmlFor="student-email">E-mail da matrícula<input id="student-email" type="email" autoComplete="email" required value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="voce@email.com" /></label>
          <label htmlFor="student-cpf">Final do CPF<input id="student-cpf" inputMode="numeric" maxLength="4" required value={form.cpfLast4} onChange={(event) => setForm((prev) => ({ ...prev, cpfLast4: event.target.value.replace(/\D/g, '').slice(0, 4) }))} placeholder="0000" /></label>
          {(state.error || otpStatus.error) && <div className="formAlert formAlert--error">{state.error || otpStatus.error}</div>}
          <button type="submit" className="button button--primary" disabled={otpStatus.loading}>{otpStatus.loading ? 'Enviando código...' : 'Receber código de acesso'}</button>
        </form>
      </> : <>
        <p>Enviamos um código de 6 dígitos pelo WhatsApp cadastrado na sua matrícula. Ele vale por 10 minutos.</p>
        <form className="studentLoginForm" onSubmit={verifyAccessCode}>
          <label htmlFor="student-code">Código recebido<input id="student-code" inputMode="numeric" maxLength="6" required autoFocus value={form.code} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value.replace(/\D/g, '').slice(0, 6) }))} placeholder="000000" /></label>
          {otpStatus.info && <div className="formAlert formAlert--success">{otpStatus.info}</div>}
          {otpStatus.error && <div className="formAlert formAlert--error">{otpStatus.error}</div>}
          <button type="submit" className="button button--primary" disabled={otpStatus.loading}>{otpStatus.loading ? 'Confirmando...' : 'Confirmar código'}</button>
          <button type="button" className="button button--outline" onClick={() => { setOtpStep('identity'); setOtpStatus({ loading: false, error: '', info: '' }); }}>Usar outro e-mail/CPF</button>
        </form>
      </>}
      <a className="studentHelpLink" href={whatsappLink({ name: 'acesso Minha Área' })}>Preciso de ajuda com meu acesso</a>
    </div>
  </section>;

  const { portal } = state;
  // Matrícula = pagamento feito (confirmado pela Erica, 04/09/2026): só cursos realmente
  // pagos contam como "sua matrícula" na jornada — o resto aparece como "finalize" abaixo,
  // nunca como se ela já fosse aluna daquele curso.
  const paidEnrollments = (portal.enrollments || []).filter((enrollment) => enrollment.paid);
  const pendingEnrollments = (portal.enrollments || []).filter((enrollment) => !enrollment.paid);
  const activeEnrollment = paidEnrollments[0] || portal.enrollments?.[0] || {};
  const stage = getStudentJourneyStage(activeEnrollment, portal.stats || {});
  const defaultAvatar = pickStudentAvatar(stage, accessIndex);
  const currentAvatar = findStudentAvatarByKey(profileForm.avatarKey || portal.student.profile?.avatarKey, defaultAvatar);
  const progressPercent = Math.min(100, Math.max(20, journeyItemsProgress(activeEnrollment, portal.stats || {})));
  const journeyItems = [
    { key: 'matricula', title: 'Matrícula', detail: activeEnrollment.paymentStatus ? `Pagamento ${activeEnrollment.paymentStatus}` : activeEnrollment.status, done: Boolean(activeEnrollment.paymentStatus), avatar: pickStudentAvatar('matricula', accessIndex) },
    { key: 'preparacao', title: 'Preparação', detail: 'Materiais e avisos liberados pela equipe da escola', done: true, avatar: pickStudentAvatar('preparacao', accessIndex + 1) },
    { key: 'checkin', title: 'Check-in', detail: activeEnrollment.checkInConfirmed ? 'Presença confirmada pela escola' : activeEnrollment.canCheckIn ? `Código ${activeEnrollment.checkInCode} para mostrar na recepção` : 'Libera após confirmação do pagamento', done: activeEnrollment.canCheckIn, avatar: pickStudentAvatar('checkin', accessIndex + 2) },
    { key: 'certificado', title: 'Certificado', detail: activeEnrollment.certificateStatus, done: /dispon/i.test(activeEnrollment.certificateStatus || ''), avatar: pickStudentAvatar('certificado', accessIndex + 3) },
    { key: 'proximo', title: 'Próximo curso', detail: activeEnrollment.discountLabel, done: portal.stats.discountPercent > 5, avatar: pickStudentAvatar('proximo', accessIndex + 4) },
  ].map((item) => ({ ...item, isCurrent: item.key === stage }));
  // Selos conquistados de verdade (students.metadata.studentBadges.missions aprovados),
  // com o benefício real cadastrado pela equipe no catálogo (painel > Operação > Selos e
  // benefícios) — decisão de negócio §16.7 do Manual do produto, ainda sem regra fixa por selo.
  // Catálogo completo de selos, não só os conquistados (pedido da Erica, 04/09/2026: mostrar
  // que cada tarefa cumprida libera um selo e um benefício — inclusive os que faltam ganhar).
  const badgeCollection = portal.student.badgeCatalog?.length
    ? portal.student.badgeCatalog
    : (portal.student.earnedBadges || []).map((badge) => ({ ...badge, earned: true }));
  const earnedBadgeCount = badgeCollection.filter((badge) => badge.earned).length;

  const firstName = String(portal.student.name || '').split(' ')[0] || 'aluna';
  const TAB_TITLES = { cadastro: 'Cadastro', cursos: 'Cursos', agenda: 'Agenda', certificado: 'Certificado' };
  const now = new Date();
  const todayEyebrow = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(now).toUpperCase();
  const nextEventDate = classStartDate(activeEnrollment.classDate);
  const nextEventDay = nextEventDate ? String(nextEventDate.getUTCDate()).padStart(2, '0') : '--';
  const nextEventMonth = nextEventDate ? nextEventDate.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '').toUpperCase() : '';
  const nextEventWeekday = nextEventDate ? nextEventDate.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '').toUpperCase() : '';
  // Turma que já passou (pedido da Erica, 07/09/2026): a data de fim sai do próprio texto da
  // turma, então o app deixa de convidar a aluna a "continuar de onde parou" num curso que já
  // aconteceu. Repare que ENCERRADA e CONCLUÍDA são coisas diferentes: a data diz que a turma
  // acabou, mas quem confirma presença e libera o certificado é a equipe da escola — por isso
  // "concluído" continua vindo de enrollment.completed, nunca do calendário.
  const activeClassFinished = isClassFinished(activeEnrollment.classDate);
  const activeClassEnd = classEndDate(activeEnrollment.classDate);
  const activeClassEndLabel = activeClassEnd
    ? activeClassEnd.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : '';
  const continuePillLabel = activeEnrollment.completed
    ? 'CONCLUÍDO'
    : activeClassFinished
      ? 'TURMA ENCERRADA'
      : stage === 'certificado' ? 'CONCLUÍDO' : stage === 'checkin' ? 'CHECK-IN LIBERADO' : 'EM ANDAMENTO';
  const unreadNotifications = (portal.notifications || []).length;

  // Sair da conta neste aparelho. Passou a ser necessário quando o acesso virou persistente
  // (07/09/2026): antes bastava fechar a página, agora um aparelho compartilhado ficaria logado.
  function logout() {
    if (!window.confirm('Sair da Minha Área neste aparelho?\n\nPra entrar de novo você vai precisar do link enviado no WhatsApp ou de um novo código de acesso.')) return;
    storeToken('');
    track('student_logout');
    setToken('');
    setState({ loading: false, portal: null, error: '' });
    setOtpStep('identity');
    setForm({ email: '', cpfLast4: '', code: '' });
    setActiveTab('jornada');
  }

  function openDrawer() {
    setDrawerOpen(true);
    track('student_notifications_opened');
  }

  // Leva direto pro curso que a aluna fez, com o formulário de avaliação à vista (pedido da
  // Erica, 07/09/2026) — antes o botão só abria a aba e ela tinha que procurar o curso na lista.
  function openCourseReview(enrollmentId) {
    setActiveTab('certificado');
    setReviewFocusId(enrollmentId);
    track('student_course_review_opened');
    window.requestAnimationFrame(() => {
      document.getElementById(`avaliacao-${enrollmentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function openCourseDetail(enrollmentId) {
    setActiveTab('cursos');
    setExpandedCourseId(enrollmentId);
  }

  // Aba "Cursos" (pedido da Erica, 06/09/2026, a partir do template): a lista completa, com
  // filtro por status — igual à agenda pública, mas sem inventar contagem de módulos/aulas
  // que não temos; os chips mostram só o que é real (turma, mentora, categoria).
  // Matrícula não paga também aparece aqui (pedido da Erica, 08/09/2026). Antes esta aba
  // listava só matrícula paga: quem estava esperando o boleto compensar abria a Minha Área,
  // via "Cursos" vazio e não tinha nada pra acompanhar. Agora o curso aparece, marcado, com o
  // caminho pra finalizar o pagamento — e sem código de check-in, que continua dependendo do
  // pagamento entrar.
  const allEnrollments = [...paidEnrollments, ...pendingEnrollments];
  // Todos os materiais das turmas pagas dela, com o curso de onde vieram, pra caber na
  // primeira tela sem ela precisar abrir curso por curso.
  const materiaisDaAluna = paidEnrollments.flatMap((enrollment) => (enrollment.materials || []).map((item) => ({
    ...item, enrollmentId: enrollment.id, courseName: enrollment.courseName,
  })));
  const filteredCourses = allEnrollments.filter((enrollment) => {
    if (courseFilter === 'concluidos') return enrollment.paid && enrollment.completed;
    if (courseFilter === 'andamento') return enrollment.paid && !enrollment.completed;
    if (courseFilter === 'aguardando') return !enrollment.paid;
    return true;
  });
  const concludedCount = paidEnrollments.filter((enrollment) => enrollment.completed).length;

  // Aba "Agenda" (pedido da Erica, 06/09/2026, a partir do template): calendário real do mês,
  // com bolinha só nos dias em que existe de fato uma turma paga marcada — nada de horário ou
  // evento inventado, já que só guardamos a data da turma, não um calendário de aulas avulsas.
  const calendarDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + calendarMonthOffset, 1));
  const calendarYear = calendarDate.getUTCFullYear();
  const calendarMonth = calendarDate.getUTCMonth();
  const calendarGrid = buildCalendarGrid(calendarYear, calendarMonth);
  const calendarLabelRaw = calendarDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const calendarLabel = calendarLabelRaw.charAt(0).toUpperCase() + calendarLabelRaw.slice(1);
  const todayKey = dateKey(now);
  const eventsByDay = new Map();
  paidEnrollments.forEach((enrollment) => {
    const eventDate = classStartDate(enrollment.classDate);
    if (!eventDate) return;
    const key = dateKey(eventDate);
    if (!eventsByDay.has(key)) eventsByDay.set(key, []);
    eventsByDay.get(key).push(enrollment);
  });
  const sortedEventKeys = [...eventsByDay.keys()].sort();
  const defaultAgendaDay = sortedEventKeys.find((key) => key >= todayKey) || sortedEventKeys[sortedEventKeys.length - 1] || '';
  const activeAgendaDay = selectedAgendaDay || defaultAgendaDay;
  const agendaDayEvents = eventsByDay.get(activeAgendaDay) || [];
  const agendaDayLabel = activeAgendaDay
    ? new Date(`${activeAgendaDay}T00:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', timeZone: 'UTC' }).toUpperCase()
    : '';

  // Aba "Selos e benefícios" (pedido da Erica, 07/09/2026, a partir da v2 do template): tudo
  // aqui sai de dado real — a escala de desconto refaz a mesma conta do servidor, os selos vêm
  // do catálogo cadastrado no painel e a recompensa por avaliação olha matrícula concluída de
  // verdade. Nada de percentual ou meta inventada que o checkout não vá honrar depois.
  const paidCoursesCount = portal.stats.paidCourses || 0;
  const currentDiscount = paidCoursesCount >= 1 ? portal.stats.discountPercent : 0;
  // A trilha vem dos selos que o servidor monta (buildBadgeCatalog): o degrau 1 traz os 20% de
  // regra fixa, e do 2 em diante traz o que a a escola cadastrou no painel — um secador, uma boneca
  // de treino, o que for da campanha. Assim a tela nunca promete um prêmio que ninguém
  // combinou: sem cadastro, ela diz que a a escola ainda vai anunciar.
  const ladderSteps = (portal.student.badgeCatalog || [])
    .filter((badge) => badge.milestone)
    .slice(0, LADDER_STEPS)
    .map((badge, index) => ({
      courses: index + 1,
      label: badge.label,
      benefit: badge.benefitLabel || '',
      earned: badge.earned,
    }));
  const proximoDegrau = ladderSteps.find((step) => !step.earned) || null;
  const ladderFillPercent = ladderSteps.length > 1
    ? Math.min(100, Math.max(0, ((paidCoursesCount - 1) / (ladderSteps.length - 1)) * 100))
    : 0;
  // Pode avaliar quando a turma já acabou (data de fim passada) ou quando a equipe marcou o
  // curso como concluído — mesma regra do servidor em createCourseReview (lib/db.mjs). Antes
  // exigia certificado liberado, e por isso o selo de avaliação nunca ativava sozinho.
  const canReview = (enrollment) => Boolean(enrollment.completed || isClassFinished(enrollment.classDate));
  const reviewPending = paidEnrollments.find((enrollment) => canReview(enrollment) && !enrollment.reviewed) || null;
  const reviewDone = paidEnrollments.some((enrollment) => enrollment.reviewed);
  const reviewBadge = badgeCollection.find((badge) => badge.key === 'course_review') || null;
  // Em "Benefícios disponíveis" ficam só os selos com um benefício cadastrado de verdade pela
  // equipe. Os degraus da trilha de cursos já estão contados na escala de desconto acima, e a
  // avaliação tem cartão próprio — repetir os três aqui só encheria a página.
  const otherBadges = badgeCollection.filter((badge) => !badge.milestone && badge.key !== 'course_review' && badge.benefitLabel);

  return <div className="studentApp">
    <aside className="studentAppSidebar">
      <button type="button" className="studentAppBrand" onClick={() => setActiveTab('jornada')}><StudentBrandMark /><span className="studentAppBrand__word">MINHA <strong>a escola</strong></span></button>
      <nav className="studentAppNav" aria-label="Minha Área">{NAV_ITEMS.map((item) => <button key={item.key} type="button" className={activeTab === item.key ? 'studentAppNavItem studentAppNavItem--active' : 'studentAppNavItem'} onClick={() => setActiveTab(item.key)}><StudentIcon name={item.icon} /><span>{item.label}</span></button>)}</nav>
      <div className="studentAppSidebarSpacer" />
      <a className="studentAppSupport" href={whatsappLink({ name: 'ajuda Minha Área' })}>
        <span className="studentAppSupport__icon"><StudentIcon name="message" /></span>
        <strong>Precisa de ajuda?</strong>
        <p>Nossa equipe está pronta para apoiar sua jornada.</p>
        <span className="studentAppSupport__cta">Falar com a a escola <StudentIcon name="arrow" /></span>
      </a>
      <button type="button" className="studentAppSidebarProfile" onClick={() => setActiveTab('cadastro')}>
        {studentPhoto ? <div className="studentPhotoPreview studentPhotoPreview--nav"><img src={studentPhoto} alt="" /></div> : <StudentAvatarVisual avatarDef={currentAvatar} />}
        <span><strong>{firstName}</strong><small>{portal.stats.rankLabel}</small></span>
      </button>
    </aside>

    <header className="studentAppMobileHeader">
      <div className="studentAppBrand"><StudentBrandMark /><span className="studentAppBrand__word">MINHA <strong>a escola</strong></span></div>
      <button type="button" className="studentAppIconButton" onClick={openDrawer} aria-label="Notificações">
        <StudentIcon name="bell" />
        {unreadNotifications > 0 && <span className="studentAppNotificationDot" />}
      </button>
    </header>

    <main className="studentAppMain">
      <InstallAppBanner />
      {activeTab === 'jornada' && <>
        <header className="studentPageHeader studentPageHeader--home">
          <div><p className="eyebrow">{todayEyebrow}</p><h1>{greetingForHour(now.getHours())}, {firstName}!</h1><p>Continue avançando na sua formação profissional.</p></div>
          <button type="button" className="studentAppIconButton studentAppIconButton--desktop" onClick={openDrawer} aria-label="Notificações">
            <StudentIcon name="bell" />
            {unreadNotifications > 0 && <span className="studentAppNotificationDot" />}
          </button>
        </header>
        <div className="studentHomeGrid">
          <article className="studentContinueCard">
            <div className="studentContinueCard__art"><CourseCover slug={activeEnrollment.courseSlug} name={activeEnrollment.courseName} image={courseCoverImage(activeEnrollment.courseSlug, liveCatalog)} className="studentContinueCard__image" /></div>
            <div className="studentContinueCard__body">
              <span className="pill pill--light">{continuePillLabel}</span>
              <div>
                <span className="studentContinueCard__eyebrow">{activeEnrollment.completed ? 'Curso concluído' : activeClassFinished ? 'Sua turma já aconteceu' : 'Continue de onde parou'}</span>
                <h2>{activeEnrollment.courseName || 'Curso a escola'}</h2>
                <small>{activeClassFinished && activeClassEndLabel ? `Terminou em ${activeClassEndLabel}` : (activeEnrollment.classDate || 'Turma vinculada ao cadastro')}</small>
                {activeClassFinished && !activeEnrollment.completed && <small className="studentContinueCard__note">O certificado é liberado depois que a a escola confere a presença da turma.</small>}
              </div>
              <div className="studentProgress"><div><strong>Seu progresso</strong><span>{progressPercent}%</span></div><i><b style={{ width: `${progressPercent}%` }} /></i></div>
              <div className="studentContinueCard__actions">{activeClassFinished || activeEnrollment.completed
                ? <button className="button button--primary" type="button" onClick={() => setActiveTab('certificado')}><StudentIcon name="award" /> Ver certificado</button>
                : <button className="button button--primary" type="button" onClick={() => openCourseDetail(activeEnrollment.id)}><StudentIcon name="check" /> Abrir check-in</button>}</div>
            </div>
          </article>
          <article className="studentNextEventCard">
            <div className="studentNextEventCard__heading"><span className="studentNextEventCard__icon"><StudentIcon name="calendar" /></span><div><span className="mini-label">{activeClassFinished ? 'ÚLTIMO ENCONTRO' : 'PRÓXIMO ENCONTRO'}</span><h3>{activeEnrollment.courseName || 'Curso a escola'}</h3></div></div>
            {nextEventDate && <div className="studentNextEventCard__date"><strong>{nextEventDay}</strong><span>{nextEventMonth}<br />{nextEventWeekday}</span></div>}
            <div className="studentNextEventCard__details"><strong>{activeEnrollment.optionLabel || activeEnrollment.classDate || 'Turma a confirmar'}</strong><span><StudentIcon name="clock" /> {activeEnrollment.classDate || 'Data a confirmar'}</span><span className="studentNextEventCard__location">{LOCAL}</span></div>
            <button className="button button--outline" type="button" onClick={() => openCourseDetail(activeEnrollment.id)}>Ver check-in</button>
          </article>
        </div>
        <div className="studentCards studentCards--portal">
          <article className="studentCard"><span>Curso atual</span><h2>{activeEnrollment.courseName || 'Curso a escola'}</h2><p>{activeEnrollment.classDate || 'Turma vinculada ao cadastro'}</p></article>
          <article className="studentCard"><span>Benefício</span><h2>{portal.stats.discountPercent}% OFF</h2><p>Desconto progressivo para o próximo curso elegível.</p></article>
          <article className="studentCard"><span>Conclusões</span><h2>{portal.stats.completedCourses}</h2><p>Certificados e cursos concluídos aparecem aqui.</p></article>
          <article className="studentCard"><span>Ranking</span><h2>{portal.stats.rankLabel}</h2><p>Por enquanto, usamos conquistas individuais antes de ranking público.</p></article>
        </div>
        {paidEnrollments.length > 1 && <section className="studentPanel studentPanel--courses"><div><p className="eyebrow">Meus cursos</p><h2>Cursos que você já é aluna</h2><p>Todo curso com matrícula paga aparece aqui.</p><button type="button" className="linkButton" onClick={() => setActiveTab('cursos')}>Ver todos <StudentIcon name="arrow" /></button></div><div className="studentCourseGrid">{paidEnrollments.map((enrollment) => { const enrollmentProgress = Math.min(100, Math.max(20, journeyItemsProgress(enrollment, portal.stats || {}))); const catalog = courseCatalogFor(enrollment.courseSlug, liveCatalog); return <article key={enrollment.id} className={enrollment.id === activeEnrollment.id ? 'studentCourseCard studentCourseCard--active' : 'studentCourseCard'}><div className="studentCourseCard__cover"><CourseCover slug={enrollment.courseSlug} name={enrollment.courseName} image={courseCoverImage(enrollment.courseSlug, liveCatalog)} className="studentCourseCard__image" /></div><div className="studentCourseCard__info">{catalog?.category && <span className="studentCourseCard__tag">{catalog.category.toUpperCase()}</span>}<h3>{enrollment.courseName}</h3><p>{catalog?.mentor || 'Equipe a escola'}</p><div className="studentCourseCard__progress"><span style={{ width: `${enrollmentProgress}%` }} /></div><div className="studentCourseCard__bottom"><span>{enrollmentProgress}% concluído</span><button type="button" aria-label="Abrir curso" onClick={() => openCourseDetail(enrollment.id)}><StudentIcon name="arrow" /></button></div></div></article>; })}</div></section>}
        {/* Materiais na primeira tela (09/09/2026). Antes o material só existia dentro do card
            do curso, atrás de um "Ver materiais e check-in" — a Erica estava apresentando o
            sistema e não achou. Material é a coisa mais procurada de uma área de aluno; agora
            aparece de cara, com o curso de onde veio. */}
        {materiaisDaAluna.length > 0 && <section className="studentPanel studentPanel--materials">
          <div>
            <p className="eyebrow">Materiais</p>
            <h2>Seus materiais de estudo</h2>
            <p>Apostilas, links e vídeos liberados pela escola para as suas turmas.</p>
            <button type="button" className="linkButton" onClick={() => setActiveTab('cursos')}>Ver por curso <StudentIcon name="arrow" /></button>
          </div>
          <div className="studentClassList">{materiaisDaAluna.slice(0, 6).map((item) => <a key={`${item.enrollmentId}-${item.title}`} className="studentMaterial" href={item.url || undefined} target={item.url ? '_blank' : undefined} rel="noreferrer">
            <span className="studentMaterial__icon"><StudentIcon name="download" /></span>
            <div><span>{item.type} · {item.courseName}</span><strong>{item.title}</strong><small>{item.description || (item.url ? 'Toque para abrir' : 'Em breve')}</small></div>
          </a>)}</div>
        </section>}
        {pendingEnrollments.length > 0 && <section className="studentPanel studentPanel--pending"><div><p className="eyebrow">Matrícula não finalizada</p><h2>Continue de onde parou</h2><p>Você começou, mas ainda não concluiu o pagamento — sua vaga só é garantida depois da confirmação.</p></div><div className="studentPendingList">{pendingEnrollments.map((enrollment) => <div key={enrollment.id} className="studentPendingItem"><div><strong>{enrollment.courseName}</strong><small>{enrollment.classDate}</small></div><a className="button button--outline" href={continueEnrollmentUrl(enrollment)}>Finalizar matrícula{paidEnrollments.length ? ` com ${portal.stats.discountPercent}% OFF de aluna a escola` : ''}</a></div>)}</div></section>}
        <section className="studentPanel studentPanel--journey"><div><p className="eyebrow">Jornada a escola</p><h2>Seu caminho dentro da escola</h2><p>Escolha seu avatar no cadastro e acompanhe as etapas do curso.</p></div><div className="studentJourneyList">{journeyItems.map((item, index) => <div key={item.title} className={[
          'studentJourneyItem',
          item.done && 'studentJourneyItem--done',
          item.isCurrent && 'studentJourneyItem--current',
        ].filter(Boolean).join(' ')}><span>{item.done ? '✓' : String(index + 1).padStart(2, '0')}</span><StudentAvatarVisual avatarDef={item.avatar} photoSrc={item.isCurrent ? studentPhoto : ''} /><div><strong>{item.title}</strong><small>{item.detail}</small></div></div>)}</div></section>
        {/* Chamada para a aba de benefícios (template v2): a Jornada mostra só onde a aluna está
            na escala de desconto e leva pro clube completo, em vez da grade de selos inteira. */}
        <section className="studentBenefitTeaser">
          <span className="studentBenefitTeaser__icon"><StudentIcon name="gift" /></span>
          <div className="studentBenefitTeaser__copy">
            <span className="mini-label">BENEFÍCIOS a escola</span>
            <h2>{currentDiscount ? `Você tem ${currentDiscount}% no próximo curso` : 'Seus selos e benefícios da escola'}</h2>
            <p>{currentDiscount
              ? `Desconto de aluna a escola, válido nos cursos de especialização.${proximoDegrau ? ` Continuando com a gente, o próximo degrau é o selo "${proximoDegrau.label}".` : ''}`
              : `Assim que sua primeira matrícula for confirmada, você ganha ${NEXT_COURSE_DISCOUNT}% de desconto no próximo curso de especialização.`}</p>
          </div>
          <div className="studentBenefitTeaser__progress">
            <span><i style={{ width: `${Math.min(100, (paidCoursesCount / Math.max(1, ladderSteps.length)) * 100)}%` }} /></span>
            <small>{paidCoursesCount} de {ladderSteps.length} degraus</small>
          </div>
          <button type="button" className="button button--outline" onClick={() => setActiveTab('beneficios')}>Ver meus benefícios <StudentIcon name="arrow" /></button>
        </section>
      </>}
      {!['jornada', 'beneficios'].includes(activeTab) && <header className="studentPageHeader"><p className="eyebrow">Minha Área</p><h1>{TAB_TITLES[activeTab]}</h1></header>}
      {activeTab === 'beneficios' && <>
        <header className="studentPageHeader"><p className="eyebrow">Clube da Escola</p><h1>Selos e benefícios</h1><p>Quanto mais você aprende e participa, mais vantagens conquista.</p></header>

        <article className="studentRewardsHero">
          <div className="studentRewardsHero__level">
            <span className="studentRewardsHero__kicker"><StudentIcon name="star" /> {String(portal.stats.rankLabel || 'Aluna a escola').toUpperCase()}</span>
            <h2>Seu aprendizado<br />vale benefícios.</h2>
            <p>{paidCoursesCount >= 1
              ? `Você já tem ${paidCoursesCount} ${paidCoursesCount === 1 ? 'curso pago' : 'cursos pagos'} com a a escola e ${NEXT_COURSE_DISCOUNT}% de desconto garantido no próximo curso de especialização.`
              : `Sua primeira matrícula paga já libera ${NEXT_COURSE_DISCOUNT}% de desconto no próximo curso de especialização.`}</p>
            <div className="studentRewardsHero__numbers">
              <span><strong>{currentDiscount}%</strong><small>desconto atual</small></span>
              <span><strong>{earnedBadgeCount}</strong><small>{earnedBadgeCount === 1 ? 'selo conquistado' : 'selos conquistados'}</small></span>
            </div>
          </div>
          <div className="studentLadder">
            <div className="studentLadder__head">
              <div><span className="mini-label">SUA TRILHA</span><h3>{proximoDegrau ? `Próximo degrau: ${proximoDegrau.label}` : 'Você percorreu a trilha inteira'}</h3></div>
              {proximoDegrau && <span className="pill pill--light">FALTA 1 CURSO</span>}
            </div>
            <p>O primeiro curso pago já garante {NEXT_COURSE_DISCOUNT}% de desconto no próximo curso de especialização. A partir daí, cada degrau tem um prêmio próprio, anunciado pela escola.</p>
            <div className="studentLadder__track">
              <span className="studentLadder__fill" style={{ width: `${ladderFillPercent}%` }} />
              {ladderSteps.map((step, index) => <i
                key={step.courses}
                className={[
                  'studentLadder__point',
                  step.earned && 'studentLadder__point--done',
                  proximoDegrau?.courses === step.courses && 'studentLadder__point--next',
                ].filter(Boolean).join(' ')}
                style={{ left: `${(index / Math.max(1, ladderSteps.length - 1)) * 100}%` }}
              >{step.courses}</i>)}
            </div>
            <div className="studentLadder__labels" style={{ gridTemplateColumns: `repeat(${ladderSteps.length}, 1fr)` }}>{ladderSteps.map((step) => <span key={step.courses}><b>{step.label}</b>{step.benefit || 'benefício em breve'}</span>)}</div>
          </div>
        </article>

        <section className="studentBenefitSection">
          <div className="studentSectionHeading"><div><span className="mini-label">VANTAGENS</span><h2>Benefícios disponíveis</h2></div></div>
          <div className="studentBenefitGrid">
            <article className={reviewPending ? 'studentBenefitCard studentBenefitCard--featured' : 'studentBenefitCard'}>
              <div className="studentBenefitCard__top">
                <span className={reviewPending || reviewDone ? 'studentBenefitCard__icon' : 'studentBenefitCard__icon studentBenefitCard__icon--muted'}><StudentIcon name="message" /></span>
                <span className={reviewPending || reviewDone ? 'pill pill--soft' : 'pill pill--neutral'}>{reviewPending ? 'AÇÃO DISPONÍVEL' : reviewDone ? 'BENEFÍCIO LIBERADO' : 'EM BREVE'}</span>
              </div>
              <div>
                <span className="mini-label">RECOMPENSA POR AVALIAÇÃO</span>
                <h3>{reviewBadge?.benefitLabel || 'Selo de avaliação na sua coleção'}</h3>
                {/* Depois de avaliar, a aluna precisa saber que o benefício é dela e como pedir
                    (pedido da Erica, 07/09/2026) — a liberação em si ainda é feita pela equipe. */}
                <p>{reviewDone
                  ? 'Sua avaliação já está registrada e o benefício é seu. Fale com a a escola pelo WhatsApp para receber.'
                  : 'Conte como foi sua experiência na escola: sua avaliação ajuda outras alunas a decidir e libera o seu benefício.'}</p>
              </div>
              {reviewPending
                ? <button type="button" className="button button--primary" onClick={() => openCourseReview(reviewPending.id)}>Avaliar e desbloquear <StudentIcon name="arrow" /></button>
                : reviewDone
                  ? <a className="button button--primary" href={whatsappBenefitLink({ studentName: portal.student.name, benefitLabel: reviewBadge?.benefitLabel, badgeLabel: reviewBadge?.label })}><StudentIcon name="message" /> Solicitar meu benefício</a>
                  : paidEnrollments.length
                    ? <><div className="studentMiniProgress"><span style={{ width: `${(portal.stats.completedCourses / paidEnrollments.length) * 100}%` }} /></div><small className="studentBenefitCard__foot">{portal.stats.completedCourses} de {paidEnrollments.length} {paidEnrollments.length === 1 ? 'curso concluído' : 'cursos concluídos'}</small></>
                    : <small className="studentBenefitCard__foot">Libera assim que você concluir seu primeiro curso.</small>}
            </article>

            <article className="studentBenefitCard">
              <div className="studentBenefitCard__top">
                <span className={currentDiscount ? 'studentBenefitCard__icon' : 'studentBenefitCard__icon studentBenefitCard__icon--muted'}><StudentIcon name="gift" /></span>
                <span className={currentDiscount ? 'pill pill--soft' : 'pill pill--neutral'}>{currentDiscount ? 'DESBLOQUEADO' : 'EM BREVE'}</span>
              </div>
              <div>
                <span className="mini-label">PRÓXIMA MATRÍCULA</span>
                <h3>{currentDiscount ? `${currentDiscount}% de desconto` : 'Desconto de aluna'}</h3>
                <p>{currentDiscount
                  ? 'Seu desconto de aluna a escola já pode ser usado em um curso de especialização. Fale com a escola na hora de fechar.'
                  : `Sua primeira matrícula paga libera ${NEXT_COURSE_DISCOUNT}% de desconto no próximo curso de especialização.`}</p>
              </div>
              <a className="button button--outline" href="/">{currentDiscount ? 'Usar benefício' : 'Ver agenda de cursos'}</a>
            </article>

            {otherBadges.map((badge) => <article key={badge.key || badge.label} className="studentBenefitCard">
              <div className="studentBenefitCard__top">
                <span className={badge.earned ? 'studentBenefitCard__icon' : 'studentBenefitCard__icon studentBenefitCard__icon--muted'}><StudentIcon name={badgeIconFor(badge.key)} /></span>
                <span className={badge.earned ? 'pill pill--soft' : 'pill pill--neutral'}>{badge.earned ? 'DESBLOQUEADO' : 'A CONQUISTAR'}</span>
              </div>
              <div>
                <span className="mini-label">{String(badge.label || '').toUpperCase()}</span>
                <h3>{badge.benefitLabel}</h3>
                {badge.rule && <p>Como conquistar: {badge.rule.toLowerCase()}.</p>}
              </div>
              {badge.earned && <a className="button button--outline" href={whatsappBenefitLink({ studentName: portal.student.name, benefitLabel: badge.benefitLabel, badgeLabel: badge.label })}>Solicitar meu benefício</a>}
            </article>)}
          </div>
        </section>

        <section className="studentBadgeCollection">
          <div className="studentSectionHeading">
            <div><span className="mini-label">MINHAS CONQUISTAS</span><h2>Coleção de selos</h2></div>
            {badgeCollection.length > 0 && <span className="studentBadgeCollection__count">{earnedBadgeCount} de {badgeCollection.length} conquistados</span>}
          </div>
          {badgeCollection.length
            ? <div className="studentBadgeCollection__grid">{badgeCollection.map((badge) => <article key={badge.key || badge.label} className={badge.earned ? 'studentBadgeTile studentBadgeTile--earned' : 'studentBadgeTile studentBadgeTile--locked'}>
              <span className="studentBadgeTile__medal"><StudentIcon name={badgeIconFor(badge.key)} /></span>
              <strong>{badge.label}</strong>
              <small>{badgeRuleFor(badge)}</small>
              <em>{badge.earned ? 'Conquistado' : 'A conquistar'}</em>
            </article>)}</div>
            : <p>Nenhum selo cadastrado ainda — assim que a equipe cadastrar os selos no painel, eles aparecem aqui.</p>}
        </section>

        <p className="studentRulesNote">Os selos e benefícios são definidos pela equipe da escola e podem ter percentuais, limites e critérios ajustados.</p>
      </>}
      {activeTab === 'cadastro' && <section className="studentPanel studentProfilePanel"><div><p className="eyebrow">Cadastro</p><h2>Seus dados na escola</h2><p>Nome, e-mail, telefone, foto e avatar podem ser ajustados. O CPF fica bloqueado como identificação da aluna.</p></div>
        <div className="studentProfileLayout">
          <aside className="studentProfileSummary">
            {studentPhoto ? <div className="studentPhotoPreview"><img src={studentPhoto} alt="" /></div> : <StudentAvatarVisual avatarDef={currentAvatar} large />}
            <label className="studentUploadButton">Trocar foto<input type="file" accept="image/*" onChange={uploadStudentPhoto} /></label>
            <h2>{portal.student.name || 'Aluna a escola'}</h2>
            {portal.student.createdAt && <p>Aluna a escola desde {new Date(portal.student.createdAt).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</p>}
            <div className="studentProfileStats"><span><strong>{paidEnrollments.length}</strong><small>Cursos</small></span><span><strong>{paidEnrollments.filter((e) => e.certificateStatus === 'Disponível').length}</strong><small>Certificados</small></span><span><strong>{portal.stats.completedCourses}</strong><small>Concluídos</small></span></div>
            <button type="button" className="button button--outline studentLogoutButton" onClick={logout}>Sair desta conta</button>
            <div className="studentAvatarPicker" aria-label="Escolha de avatar">{allStudentAvatars().map((avatar) => <button key={avatar.key} type="button" className={profileForm.avatarKey === avatar.key ? 'studentAvatarOption studentAvatarOption--active' : 'studentAvatarOption'} onClick={() => updateProfileField('avatarKey', avatar.key)}><StudentAvatarVisual avatarDef={avatar} /><span>{avatar.name}</span></button>)}</div>
          </aside>
          <form className="studentProfileForm" onSubmit={saveProfile}>
            <div className="studentProfileForm__title"><span className="studentMaterial__icon"><StudentIcon name="user" /></span><div><h2>Dados pessoais</h2><p>Informações usadas nos seus certificados.</p></div></div>
            <div className="studentProfileFields"><label>Nome completo<input value={profileForm.name} onChange={(event) => updateProfileField('name', event.target.value)} autoComplete="name" required /></label><label>E-mail<input type="email" value={profileForm.email} onChange={(event) => updateProfileField('email', event.target.value)} autoComplete="email" required /></label><label>Telefone / WhatsApp<input value={profileForm.whatsapp} onChange={(event) => updateProfileField('whatsapp', event.target.value)} autoComplete="tel" inputMode="tel" required /></label><label>CPF<input value={portal.student.cpfLast4 ? `***.***.***-${portal.student.cpfLast4}` : 'CPF vinculado ao cadastro'} disabled /></label>{profileStatus.error && <div className="formAlert formAlert--error">{profileStatus.error}</div>}{profileStatus.success && <div className="formAlert formAlert--success">{profileStatus.success}</div>}<button className="button button--primary" type="submit" disabled={profileStatus.loading}>{profileStatus.loading ? 'Salvando...' : 'Salvar cadastro'}</button></div>
          </form>
        </div>
      </section>}
      {activeTab === 'cursos' && <>
        <div className="studentFilterRow">
          <button type="button" className={courseFilter === 'todos' ? 'studentFilter studentFilter--active' : 'studentFilter'} onClick={() => setCourseFilter('todos')}>Todos <span>{allEnrollments.length}</span></button>
          <button type="button" className={courseFilter === 'andamento' ? 'studentFilter studentFilter--active' : 'studentFilter'} onClick={() => setCourseFilter('andamento')}>Em andamento <span>{paidEnrollments.length - concludedCount}</span></button>
          <button type="button" className={courseFilter === 'concluidos' ? 'studentFilter studentFilter--active' : 'studentFilter'} onClick={() => setCourseFilter('concluidos')}>Concluídos <span>{concludedCount}</span></button>
          {pendingEnrollments.length > 0 && <button type="button" className={courseFilter === 'aguardando' ? 'studentFilter studentFilter--active' : 'studentFilter'} onClick={() => setCourseFilter('aguardando')}>Aguardando pagamento <span>{pendingEnrollments.length}</span></button>}
        </div>
        <div className="studentWideCourseList">{filteredCourses.length ? filteredCourses.map((enrollment) => {
          const enrollmentProgress = Math.min(100, Math.max(20, journeyItemsProgress(enrollment, portal.stats || {})));
          const catalog = courseCatalogFor(enrollment.courseSlug, liveCatalog);
          const expanded = expandedCourseId === enrollment.id;
          return <article key={enrollment.id} className="studentWideCourse">
            <div className="studentWideCourse__row">
              <div className="studentWideCourse__cover"><CourseCover slug={enrollment.courseSlug} name={enrollment.courseName} image={courseCoverImage(enrollment.courseSlug, liveCatalog)} className="studentWideCourse__image" /></div>
              <div className="studentWideCourse__copy">
                <div>
                  {catalog?.category && <span className="studentCourseCard__tag">{catalog.category.toUpperCase()}</span>}
                  <h2>{enrollment.courseName}</h2>
                  {catalog?.promise && <p>{catalog.promise}</p>}
                  <div className="studentWideCourse__chips"><span>{enrollment.classDate}</span>{!enrollment.paid && <span className="studentChip--pending">Aguardando pagamento</span>}{enrollment.paid && isClassFinished(enrollment.classDate) && !enrollment.completed && <span className="studentChip--done">Turma encerrada</span>}{enrollment.completed && <span className="studentChip--done">Concluído</span>}{catalog?.mentor && <span>{catalog.mentor}</span>}{enrollment.paid && enrollment.certificateStatus && <span>Certificado</span>}</div>
                </div>
                <div>
                  {enrollment.paid ? <>
                    <div className="progress-label"><span>Seu progresso</span><strong>{enrollmentProgress}%</strong></div>
                    <div className="studentCourseCard__progress"><span style={{ width: `${enrollmentProgress}%` }} /></div>
                  </> : <p className="studentWideCourse__pendingNote">Sua vaga só fica garantida depois que o pagamento for confirmado. Assim que entrar, materiais e código de entrada aparecem aqui.</p>}
                  <div className="studentWideCourse__actions">
                    {!enrollment.paid && <a className="button button--primary" href={continueEnrollmentUrl(enrollment)}>Finalizar matrícula{paidEnrollments.length ? ` com ${portal.stats.discountPercent}% OFF` : ''}</a>}
                    <button className="button button--outline" type="button" onClick={() => setExpandedCourseId(expanded ? '' : enrollment.id)}>{expanded ? 'Ocultar materiais e check-in' : 'Ver materiais e check-in'}</button>
                  </div>
                </div>
              </div>
            </div>
            {expanded && <div className="studentWideCourse__detail">
              {/* Check-in por código (08/09/2026). Antes tinha aqui um "QR" que era só desenho
                  de CSS: quatro quadradinhos que não codificavam nada e não abriam nada se
                  alguém apontasse a câmera. O código abaixo é de verdade — a recepção digita
                  ele no painel e o servidor confere matrícula, turma e pagamento. */}
              <div><span className="mini-label">CHECK-IN</span><div className="studentCheckinCard">
                {enrollment.checkInConfirmed
                  ? <>
                    <span>Presença confirmada</span>
                    <strong>{enrollment.checkInCode}</strong>
                    <p className="studentCheckinCard__hint">A escola registrou sua presença nesta turma{enrollment.checkInConfirmedAt ? ` em ${new Date(enrollment.checkInConfirmedAt).toLocaleDateString('pt-BR')}` : ''}.</p>
                  </>
                  : enrollment.canCheckIn
                    ? <>
                      <span>Seu código de entrada</span>
                      <strong>{enrollment.checkInCode}</strong>
                      <StudentCheckinQr value={checkinQrValue(enrollment.checkInCode)} />
                      <p className="studentCheckinCard__hint">Na recepção, mostre esta tela: dá pra escanear o QR ou digitar o código. Ele é só seu e vale para esta turma.</p>
                    </>
                    : <>
                      <span>Ainda sem código</span>
                      <strong className="studentCheckinCard__pending">Aguardando pagamento</strong>
                      <p className="studentCheckinCard__hint">Assim que seu pagamento for confirmado, o código de entrada e o QR aparecem aqui.</p>
                    </>}
              </div></div>
              <div><span className="mini-label">MATERIAIS</span>{(enrollment.materials || []).length ? <div className="studentClassList">{enrollment.materials.map((item) => <a key={`${item.title}-${item.type}`} className="studentMaterial" href={item.url || undefined} target={item.url ? '_blank' : undefined} rel="noreferrer"><span className="studentMaterial__icon"><StudentIcon name="download" /></span><div><span>{item.type}</span><strong>{item.title}</strong><small>{item.description || (item.url ? 'Toque para abrir' : 'Em breve')}</small></div></a>)}</div> : <p>Nenhum material liberado ainda para esta turma.</p>}</div>
            </div>}
          </article>;
        }) : <p>Nenhum curso nesse filtro.</p>}</div>
      </>}
      {activeTab === 'agenda' && <div className="studentAgendaGrid">
        <article className="studentCalendarCard">
          <div className="studentCalendarCard__head">
            <button type="button" className="studentAppIconButton" aria-label="Mês anterior" onClick={() => setCalendarMonthOffset((prev) => prev - 1)}><StudentIcon name="arrow" /></button>
            <h2>{calendarLabel}</h2>
            <button type="button" className="studentAppIconButton" aria-label="Próximo mês" onClick={() => setCalendarMonthOffset((prev) => prev + 1)}><StudentIcon name="arrow" /></button>
          </div>
          <div className="studentCalendarCard__weekdays">{WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
          <div className="studentCalendarCard__days">{calendarGrid.map((cell) => { const key = dateKey(cell.date); const hasEvent = eventsByDay.has(key); return <button key={key} type="button" className={[cell.muted && 'muted', key === todayKey && 'today', key === activeAgendaDay && 'selected', hasEvent && 'has-event'].filter(Boolean).join(' ')} onClick={() => setSelectedAgendaDay(key)}>{cell.date.getUTCDate()}</button>; })}</div>
        </article>
        <div className="studentAgendaEventList">
          <div><p className="eyebrow">{agendaDayLabel || 'SEM COMPROMISSO'}</p><h2>Seus compromissos</h2></div>
          {agendaDayEvents.length ? agendaDayEvents.map((enrollment) => <article key={enrollment.id} className="studentAgendaEvent"><span className="studentAgendaEvent__bar" /><div className="studentAgendaEvent__body"><span className="pill pill--soft">{enrollment.flow === 'voomp' ? 'HÍBRIDO' : 'PRESENCIAL'}</span><h3>{enrollment.courseName}</h3><p>{enrollment.optionLabel || 'Turma vinculada ao cadastro'}</p><small>{LOCAL}</small></div></article>) : <p>Nenhum compromisso agendado {activeAgendaDay ? 'nesse dia' : 'por enquanto'}.</p>}
        </div>
      </div>}
      {activeTab === 'certificado' && <section className="studentPanel"><div><p className="eyebrow">Certificado</p><h2>Conclusão do curso</h2><p>Após presença e conferência de nome, o certificado fica disponível nesta área — cada curso pago tem o seu, aqui embaixo.</p></div>
        {paidEnrollments.length > 0 && <div className="studentCertificateSummary"><div className="studentCertificateSummary__number"><strong>{paidEnrollments.filter((e) => e.certificateStatus === 'Disponível').length}</strong><span>certificado{paidEnrollments.filter((e) => e.certificateStatus === 'Disponível').length === 1 ? '' : 's'}<br />conquistado{paidEnrollments.filter((e) => e.certificateStatus === 'Disponível').length === 1 ? '' : 's'}</span></div><div className="studentCertificateSummary__divider" /><div><span className="mini-label">CURSOS PAGOS</span><strong>{paidEnrollments.length}</strong></div></div>}
        {paidEnrollments.length ? <div className="studentCertificateGrid">{paidEnrollments.map((enrollment) => { const form = getReviewForm(enrollment.id); return <article className="studentCertificate" key={enrollment.id}><div className="studentCertificate__cover"><div className="studentCertificate__frame"><StudentBrandMark /><small>CERTIFICADO</small><strong>{enrollment.courseName || 'Curso a escola'}</strong><span>{portal.student.name || 'Aluna a escola'}</span></div></div><div className="studentCertificate__body"><span>{enrollment.certificateStatus}</span><small className="studentCertificate__rule">{enrollment.certificateUrl ? 'Abre com o código de validação no rodapé — dá pra imprimir ou salvar em PDF.' : 'Sai sozinho quando a turma terminar e sua presença estiver confirmada.'}</small><strong>{enrollment.courseName || 'Curso a escola'}</strong><a className="button button--outline" href={enrollment.certificateUrl || undefined} target={enrollment.certificateUrl ? '_blank' : undefined} rel="noreferrer" aria-disabled={!enrollment.certificateUrl} onClick={(e) => { if (!enrollment.certificateUrl) e.preventDefault(); }}><StudentIcon name="download" /> {enrollment.certificateUrl ? 'Abrir certificado' : 'Certificado ainda não liberado'}</a>
          {canReview(enrollment) && (enrollment.reviewed ? <p className="studentReviewDone">✓ Você já avaliou esse curso — obrigada por ajudar outras alunas a decidir! Seu selo de avaliação já está liberado.</p> : <form className="studentReviewForm" onSubmit={(event) => submitReview(event, enrollment.id)}>
            <p className="studentReviewForm__title">Avalie o curso e ganhe seu selo</p>
            <p className="studentReviewForm__hint">Conta pra gente como foi sua experiência — sua avaliação ajuda outras alunas e libera um selo de recompensa na sua jornada.</p>
            <div className="studentReviewForm__stars" role="radiogroup" aria-label="Nota do curso">{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} role="radio" aria-checked={form.rating === value} className={value <= form.rating ? 'studentReviewStar studentReviewStar--filled' : 'studentReviewStar'} onClick={() => updateReviewForm(enrollment.id, { rating: value })}>★</button>)}</div>
            <textarea required minLength={10} maxLength={1200} placeholder="O que você achou do curso, da turma, da estrutura?" value={form.text} onChange={(event) => updateReviewForm(enrollment.id, { text: event.target.value })} />
            {reviewStatus.error && <div className="formAlert formAlert--error">{reviewStatus.error}</div>}
            <button type="submit" className="button button--primary" disabled={reviewStatus.loading}>{reviewStatus.loading ? 'Enviando...' : 'Enviar avaliação e ganhar selo'}</button>
          </form>)}
        </div></article>; })}</div> : <p>Nenhuma matrícula paga ainda — o certificado aparece aqui assim que uma matrícula for confirmada.</p>}
      </section>}
    </main>

    <nav className="studentAppMobileNav" aria-label="Minha Área">{NAV_ITEMS.map((item) => <button key={item.key} type="button" className={activeTab === item.key ? 'active' : undefined} onClick={() => setActiveTab(item.key)}><StudentIcon name={item.icon} /><span>{item.shortLabel || item.label}</span></button>)}</nav>

    <div className="studentDrawerBackdrop" hidden={!drawerOpen} onClick={() => setDrawerOpen(false)} />
    <aside className={drawerOpen ? 'studentNotificationDrawer studentNotificationDrawer--open' : 'studentNotificationDrawer'} aria-hidden={!drawerOpen}>
      <header><div><span className="mini-label">ATUALIZAÇÕES</span><h2>Notificações</h2></div><button type="button" className="studentAppIconButton" onClick={() => setDrawerOpen(false)} aria-label="Fechar">×</button></header>
      {(portal.notifications || []).length ? portal.notifications.map((item) => <div key={item.id} className="studentNotice"><span className="studentNotice__icon"><StudentIcon name="bell" /></span><div><strong>{item.title}</strong><p>{item.message}</p><small>{notificationTimeLabel(item.sentAt)}</small></div></div>) : <p className="studentNotice__empty">Nenhum aviso por enquanto.</p>}
    </aside>
  </div>;
}
