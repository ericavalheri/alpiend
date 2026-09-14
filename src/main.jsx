import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { CatalogContext } from './lib/catalog-context.js';
import { initAnalytics, analyticsPageView, captureAttribution, track } from './lib/analytics.js';
import { normalizeCourse, whatsappLink, findPublicCourse } from './lib/catalog-helpers.js';
import { Header, Footer } from './components/shared.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { StudentAreaPage } from './pages/StudentAreaPage.jsx';
import { CertificatePage } from './pages/CertificatePage.jsx';
import { CoursePage } from './pages/CoursePage.jsx';
import {
  AcceptancePage, EnrollmentPage, WaitlistPage, VoompReturnPage, AsaasCheckoutReturnPage,
} from './pages/checkout.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { AdminPanel, CrmWorkspacePage } from './admin/AdminPanel.jsx';

function getRoute() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  return { path, parts };
}

function NotFound() { return <section className="section confirmPage"><div className="confirmCard"><p className="eyebrow">a escola</p><h1>Página não encontrada</h1><p>Volte para a agenda e escolha uma turma disponível.</p><a className="button button--primary" href="/">Ver agenda</a></div></section>; }

function App() {
  const [{ parts }, setRoute] = useState(getRoute());
  const [catalogState, setCatalogState] = useState({ loading: true, courses: [], error: '' });
  const catalog = catalogState.courses;
  const routeKey = parts.join('/');
  useEffect(() => {
    initAnalytics();
    captureAttribution();
    track('session_attribution_updated', { path: window.location.pathname });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  useEffect(() => {
    let active = true;
    fetch('/api/health?resource=courses')
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        if (data.ok && Array.isArray(data.courses)) setCatalogState({ loading: false, courses: data.courses.map(normalizeCourse), error: '' });
        else setCatalogState({ loading: false, courses: [], error: data.error || data.warning || 'catalog_unavailable' });
      })
      .catch((error) => { if (active) setCatalogState({ loading: false, courses: [], error: error.message || 'catalog_unavailable' }); });
    return () => { active = false; };
  }, []);
  useEffect(() => { analyticsPageView(window.location.pathname); }, [routeKey]);
  useEffect(() => { const onPop = () => setRoute(getRoute()); window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop); }, []);
  const loadingPage = <section className="section confirmPage"><div className="confirmCard"><p className="eyebrow">a escola</p><h1>Carregando agenda...</h1><p>Buscando cursos e turmas disponíveis.</p></div></section>;
  const unavailablePage = <section className="section confirmPage"><div className="confirmCard"><p className="eyebrow">a escola</p><h1>Agenda temporariamente indisponível</h1><p>Não consegui carregar o catálogo agora. Tente novamente em instantes ou fale com o atendimento.</p><a className="button button--primary" href={whatsappLink({ name: 'agenda de cursos' })}>Falar com atendimento</a></div></section>;
  let page = catalogState.loading ? loadingPage : catalogState.error ? unavailablePage : <HomePage />;
  if (!catalogState.loading && !catalogState.error && parts[0] === 'curso') { const course = findPublicCourse(parts[1], catalog); page = course ? <CoursePage course={course} /> : <NotFound />; }
  if (!catalogState.loading && !catalogState.error && parts[0] === 'matricula') { const course = findPublicCourse(parts[1], catalog); page = course ? <EnrollmentPage course={course} /> : <NotFound />; }
  if (!catalogState.loading && !catalogState.error && parts[0] === 'aceite') { const course = findPublicCourse(parts[1], catalog); page = course ? <AcceptancePage course={course} /> : <NotFound />; }
  if (parts[0] === 'lista-de-espera') page = <WaitlistPage />;
  if (parts[0] === 'aluno') page = <StudentAreaPage />;
  // Certificado público: quem tem o código do rodapé abre o documento e confere se é da escola.
  // Fica fora do catálogo de propósito — tem que abrir mesmo se a agenda estiver indisponível.
  if (parts[0] === 'certificado') page = <CertificatePage code={parts[1] || ''} />;
  if (parts[0] === 'retorno' && parts[1] === 'voomp') page = <VoompReturnPage />;
  if (parts[0] === 'retorno' && parts[1] === 'asaas-checkout') page = <AsaasCheckoutReturnPage />;
  if (parts[0] === 'login') page = <LoginPage />;
  if (parts[0] === 'painel' && parts[1] === 'crm') page = <CrmWorkspacePage />;
  else if (parts[0] === 'painel') page = <AdminPanel section={parts[1] || 'dashboard'} />;
  const isAdmin = parts[0] === 'painel';
  const isStudent = parts[0] === 'aluno';
  const isCertificate = parts[0] === 'certificado';
  return <CatalogContext.Provider value={catalog}><main className={isAdmin ? 'adminRoute' : isStudent ? 'studentRoute' : ''}>{!isStudent && !isCertificate && <Header />}{page}{!isAdmin && !isStudent && !isCertificate && <Footer />}{!isAdmin && !isStudent && !isCertificate && <a className="whatsappFloat" href={whatsappLink({ name: 'agenda de cursos' })} aria-label="Contato pelo WhatsApp">✆</a>}</main></CatalogContext.Provider>;
}

createRoot(document.getElementById('root')).render(<App />);
