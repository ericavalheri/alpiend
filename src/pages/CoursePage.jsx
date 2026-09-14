// Página pública de um curso (detalhes, currículo, instrutor e turma). Extraído de
// src/main.jsx (organização de arquivos pedida pela Erica, 05/09/2026).
import { useEffect, useState } from 'react';
import { track } from '../lib/analytics.js';
import {
  selectedOffer, displayPrice, offerDescription, isSoldOut, availabilityLabel, classCapacity,
  paymentInfo, primaryCta, whatsappLink,
} from '../lib/catalog-helpers.js';
import { ResponsiveImage, VoompFlow } from '../components/shared.jsx';
import { ClubeEscola } from '../components/ClubeEscola.jsx';

export function CoursePage({ course }) {
  const params = new URLSearchParams(window.location.search);
  const requestedDate = params.get('turma') || '';
  const [selectedDate, setSelectedDate] = useState(course.dates.includes(requestedDate) ? requestedDate : course.dates[0]);
  useEffect(() => track('view_course', { course_slug: course.slug, course_name: course.name }), [course.slug]);
  return <>
    {/* Convite do Clube da Escola: aparece uma vez, depois que a pessoa leu a página e não avançou
        para a matrícula. É o único jeito de a escola conseguir falar com quem veio do anúncio
        e foi embora sem se matricular. */}
    <ClubeEscola course={course} classDate={selectedDate} />
    <section className="courseHero">
      <ResponsiveImage desktop={course.banner || course.image} mobile={course.mobileBanner || course.image} fallback={course.image} alt={course.name} className="courseHero__image" loading="eager" />
      <div className="courseHero__content"><p className="eyebrow">{course.category}</p><h1>{course.name}</h1><p>{course.long}</p><div className="courseHero__facts"><span>{course.status}</span><span>{course.price}</span><span>{course.workload}</span></div></div>
    </section>
    <section className="section courseDetail"><div className="detailMain"><h2>Resumo do curso</h2><div className="highlightGrid">{(course.highlights || []).map((item) => typeof item === 'string' ? <div className="highlight" key={item}>{item}</div> : <div className="highlight highlight--rich" key={item.title}><strong>{item.title}</strong><span>{item.description}</span></div>)}</div><h2>O que você vai aprender</h2><div className="bulletGrid">{course.learn.map((item) => typeof item === 'string' ? <div className="bullet" key={item}>✓ {item}</div> : <div className="bullet bullet--rich" key={item.title}><strong>✓ {item.title}</strong><span>{item.description}</span></div>)}</div><h2>Esse curso é para quem?</h2><div className="bulletGrid">{course.forWho.map((item) => <div className="bullet" key={item}>• {item}</div>)}</div><h2>Informações da turma</h2><ul className="infoList"><li><strong>Local:</strong> {course.location || '{LOCAL}'}</li><li><strong>Mentoria:</strong> {course.mentor}</li><li><strong>Nível:</strong> {course.level}</li><li><strong>Investimento:</strong> {course.price}</li>{course.variants && <li><strong>Opção selecionada:</strong> {selectedOffer(course, selectedDate)?.label} — {displayPrice(course, selectedDate)}</li>}</ul>{course.mentorBio && <div className="mentorCard"><p className="eyebrow">Conheça seu instrutor</p>{course.mentorPhoto && <img className="mentorCard__photo" src={course.mentorPhoto} alt={course.mentor} />}<h3>{course.mentor}</h3>{course.mentorTitle && <p className="mentorCard__title">{course.mentorTitle}</p>}<p className="mentorCard__bio">{course.mentorBio}</p>{(course.mentorCredentials || []).length > 0 && <ul className="mentorCard__credentials">{course.mentorCredentials.map((item) => <li key={item}>{item}</li>)}</ul>}{course.mentorInstagram && <a className="button button--outline" href={course.mentorInstagram} target="_blank" rel="noreferrer">Seguir no Instagram</a>}</div>}<VoompFlow course={course} selectedDate={selectedDate} /></div>
      <aside className="stickyBox"><h3>{course.flow === 'voomp' ? 'Pré-matrícula assistida' : 'Garanta sua vaga'}</h3><label className="datePicker"><span>{course.variants ? 'Opção/turma' : 'Turma'}</span><select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>{course.dates.map((date) => <option key={date}>{date}</option>)}</select></label>{offerDescription(course, selectedDate) && <div className="variantNote variantNote--sticky">{offerDescription(course, selectedDate)}</div>}<div className={`availabilityBox ${isSoldOut(course, selectedDate) ? 'availabilityBox--soldout' : ''}`}><strong>{availabilityLabel(course, selectedDate)}</strong><span>Limite de {classCapacity(course, selectedDate)} vagas por turma.</span></div><p className="stickyPrice"><strong>{paymentInfo(course, selectedDate).featured}</strong><em>{paymentInfo(course, selectedDate).featuredSub}</em><small>Valor total: {displayPrice(course, selectedDate)}</small><small>{paymentInfo(course, selectedDate).boleto}</small><small>{paymentInfo(course, selectedDate).pix}</small></p><a className="button button--primary" href={primaryCta(course, selectedDate).href} onClick={() => track('click_enrollment_cta', { course_slug: course.slug, course_name: course.name, class_date: selectedDate })}>{primaryCta(course, selectedDate).label}</a><a className="button button--outline" href={whatsappLink(course, selectedDate)} onClick={() => track('click_whatsapp_help', { course_slug: course.slug, course_name: course.name, class_date: selectedDate })}>Tirar dúvida no WhatsApp</a></aside>
    </section>
  </>;
}
