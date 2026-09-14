// Página inicial (agenda pública de cursos). Extraído de src/main.jsx (organização de
// arquivos pedida pela Erica, 05/09/2026).
import { useEffect, useMemo, useRef, useState } from 'react';
import { brand } from '../lib/brand.js';
import { track } from '../lib/analytics.js';
import { useCatalog } from '../lib/catalog-context.js';
import { whatsappLink, monthlyGroups, agendaCardCourses, firstDateForMonth } from '../lib/catalog-helpers.js';
import { displayMonth, sortDatesChronologically } from '../lib/format.js';
import { CourseCard } from '../components/shared.jsx';
import { ClubeEscola } from '../components/ClubeEscola.jsx';

export function HomePage() {
  const catalog = useCatalog();
  const months = monthlyGroups(catalog);
  const [filter, setFilter] = useState(months[0] || 'Todos');
  const visibleCourses = useMemo(() => agendaCardCourses(catalog, filter).sort((a, b) => sortDatesChronologically(firstDateForMonth(a, filter), firstDateForMonth(b, filter))), [catalog, filter]);
  const carouselRef = useRef(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  useEffect(() => track('view_agenda'), []);
  useEffect(() => { if (!months.includes(filter) && months[0]) setFilter(months[0]); }, [months.join('|'), filter]);
  useEffect(() => {
    const el = carouselRef.current;
    if (!el) return;
    const update = () => {
      setCanPrev(el.scrollLeft > 8);
      setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [filter, visibleCourses.length]);
  function scrollAgenda(direction) {
    const el = carouselRef.current;
    if (!el) return;
    const amount = Math.max(320, Math.round(el.clientWidth * 0.78));
    el.scrollBy({ left: direction * amount, behavior: 'smooth' });
  }
  return <>
    {/* Convite do Clube da Escola também na agenda: é aqui que cai quem chega do anúncio e vai embora
        sem nem abrir um curso. Sem curso escolhido o texto muda, o resto é igual. */}
    <ClubeEscola origem="agenda" />
    <section className="intro">
      <div className="intro__copy"><p className="eyebrow">Agenda Cursos 2026</p><h1>Escolha sua próxima turma na escola.</h1>
      <p className="intro__text">Uma agenda mais limpa para ver datas, valores, vagas e falar com o atendimento antes de garantir sua matrícula.</p>
      <div className="intro__actions"><a href="#agenda" className="button button--primary">Ver cursos</a><a href={whatsappLink({ name: 'agenda de cursos' })} className="button button--outline">Falar no WhatsApp</a></div></div>
      <div className="photoStrip" aria-label="Fotos da escola a escola"><img src={brand.school} alt="Estrutura da escola" /><img src={brand.school2} alt="Sala prática da escola" /><img src={brand.school3} alt="Curso presencial na escola" /></div>
    </section>
    <section id="agenda" className="section section--agenda"><div className="section__header"><p className="eyebrow">Agenda a escola</p><h2>{filter === 'A confirmar' ? 'Datas a confirmar' : `Cursos de ${filter}`}</h2><p>Confira valores, vagas, condições e links de matrícula de cada curso.</p></div>
      <div className="monthTabs" aria-label="Meses disponíveis">{months.map((item) => <button key={item} type="button" className={filter === item ? 'monthTabs__item monthTabs__item--active' : 'monthTabs__item'} onClick={() => setFilter(item)}>{displayMonth(item)}</button>)}</div>
      <div className="monthLabel">{filter === 'A confirmar' ? 'Datas a confirmar' : `Agenda de ${filter}`}</div>
      <div className="agendaCarousel">
        <button className="carouselArrow carouselArrow--prev" type="button" aria-label="Ver cursos anteriores" onClick={() => scrollAgenda(-1)} disabled={!canPrev}>‹</button>
        <div className="grid" ref={carouselRef}>{visibleCourses.map((course) => <CourseCard key={course.agendaCardId || course.slug} course={course} activeMonth={filter} />)}</div>
        <button className="carouselArrow carouselArrow--next" type="button" aria-label="Ver próximos cursos" onClick={() => scrollAgenda(1)} disabled={!canNext}>›</button>
      </div>
    </section>
    <section className="section journey"><div><p className="eyebrow">Nova experiência</p><h2>Matrícula mais simples, com a identidade da escola.</h2><p>O visual continua conectado ao site oficial, mas a jornada fica mais objetiva para mobile: curso, turma, dados essenciais, pagamento e confirmação.</p></div><ol className="steps"><li><strong>1. Veja a agenda</strong><span>Datas, valores e vagas em cards fáceis de comparar.</span></li><li><strong>2. Tire dúvida</strong><span>WhatsApp já recebe o curso e a turma escolhida.</span></li><li><strong>3. Faça a matrícula</strong><span>Checkout simplificado, sem carrinho pesado.</span></li><li><strong>4. Receba confirmação</strong><span>Próximos passos enviados com contexto.</span></li></ol></section>
  </>;
}
