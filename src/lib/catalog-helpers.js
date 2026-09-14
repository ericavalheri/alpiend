// Preço, disponibilidade, agenda mensal e outras regras de curso/turma do lado do cliente —
// espelham as mesmas regras do servidor (lib/courses.mjs), mas o servidor sempre revalida tudo
// de novo antes de qualquer pagamento (regra P0.1 do Manual do produto); isto aqui é só exibição/preview.
// Extraído de src/main.jsx (organização de arquivos pedida pela Erica, 05/09/2026).
import { brand, courseImageBySlug } from './brand.js';
import { fallbackCourses } from '../catalog.js';
import { PAGAMENTOS_CABELEIREIRO, contractMoney } from './contracts.js';
import { courses } from './catalog-context.js';
import { classMonth, classStartDate, isClassDateExpired, money, monthRank, safeSlug, sortDatesChronologically } from './format.js';
import { getAttribution } from './analytics.js';

// Capa de curso mora no código: os arquivos estão em public/assets/cursos e trocam por deploy.
// O catálogo ao vivo (tabela courses do Supabase) guarda uma CÓPIA do campo image dentro de
// metadata, feita na sincronização. Quando a capa mudava no código, essa cópia continuava
// antiga e ficava por cima — foi o que segurou as capas de setembro fora da agenda mesmo
// depois do deploy (08/09/2026). Agora a arte do código manda; o valor do banco só vale pra
// curso que o código não conhece, ou quando a Erica trocou a imagem pelo painel de propósito
// (aí o painel grava imageSource: 'painel' e a escolha dela continua valendo).
// A regex antiga (".../assets/cursos/*-2026.jpg") era um remendo da troca de capas anterior:
// cada troca de arte precisaria de um padrão novo. Isto aqui não precisa de manutenção.
const officialCourseArt = new Map(fallbackCourses.map((course) => [course.slug, course]));

// Arte por turma, indexada pelo rótulo da turma ("Cab Diurno", "Cab Noite", "Sábado"): a
// agenda quebra o Cabeleireiro em um card por turma e cada uma tem capa própria. A chave é o
// rótulo, e não a data, porque a data muda todo ano — o rótulo é o mesmo no código e no banco
// (classes.option_label). Sem isto, sob o catálogo do banco as três turmas ficariam com a
// mesma capa: buildManagedCatalog não copia image pra dentro de variants.
const officialClassArt = new Map(
  fallbackCourses.flatMap((course) => Object.values(course.variants || {})
    .filter((variant) => variant?.image && variant?.label)
    .map((variant) => [`${course.slug}::${variant.label}`, variant.image])),
);

function panelChoseImage(course) {
  return course?.imageSource === 'painel' && Boolean(course?.image);
}

export function resolveCourseImage(course, field) {
  if (panelChoseImage(course)) return course[field] || course.image;
  const oficial = officialCourseArt.get(course?.slug);
  if (oficial) return oficial[field] || oficial.image;
  if (courseImageBySlug[course?.slug]) return courseImageBySlug[course?.slug];
  return course?.[field] || course?.image || brand.school;
}

export function resolveClassImage(course, offer) {
  if (panelChoseImage(course)) return offer?.image || course.image;
  return officialClassArt.get(`${course?.slug}::${offer?.label}`) || offer?.image || '';
}

export function normalizeCourse(course) {
  if (!course) return course;
  const image = resolveCourseImage(course, 'image');
  // As turmas também passam pela arte do código: sob o catálogo do banco, variants vem sem
  // image nenhuma, e o card de cada turma cairia na capa do curso.
  const variants = course.variants && Object.fromEntries(
    Object.entries(course.variants).map(([date, variant]) => {
      const artDaTurma = resolveClassImage(course, variant);
      return [date, artDaTurma ? { ...variant, image: artDaTurma } : variant];
    }),
  );
  return {
    ...course,
    image,
    banner: resolveCourseImage(course, 'banner') || image,
    mobileBanner: resolveCourseImage(course, 'mobileBanner') || image,
    ...(variants ? { variants } : {}),
  };
}

export function cartSummary(course, date, coupon = '') {
  return {
    courseSlug: course.slug,
    courseName: course.name,
    classDate: date,
    optionLabel: selectedOffer(course, date)?.label || null,
    flow: course.flow || 'asaas',
    price: displayPrice(course, date),
    priceNumber: displayPriceNumber(course, date) || 0,
    coupon: coupon || null,
    capacity: classCapacity(course, date),
    available: classAvailable(course, date),
  };
}

// Oferta adicional no segundo curso (regra P1.2 do Manual do produto). A elegibilidade e o desconto
// vêm de upsellTargets (calculado no servidor a partir da tabela upsell_offers cadastrada
// pela escola) — nunca de uma regra fixa aqui. O servidor recalcula e valida tudo de novo em
// /api/payments; isto é só o preview.
export function eligibleAdditionalCourses(catalog, primaryCourse) {
  return (primaryCourse.upsellTargets || [])
    .map((target) => {
      const course = (catalog || []).find((item) => item.slug === target.targetCourseSlug && !item.hiddenFromAgenda);
      if (!course) return null;
      const date = (course.dates || []).find((d) => classAvailable(course, d) > 0);
      if (!date) return null;
      const priceNumber = displayPriceNumber(course, date) || 0;
      const discountType = String(target.discountType || 'percent').toLowerCase();
      const discountValue = Number(target.discountValue ?? 20);
      const discountedPriceNumber = ['fixed', 'amount', 'valor'].includes(discountType)
        ? Math.max(1, Math.round((priceNumber - discountValue) * 100) / 100)
        : Math.max(1, Math.round(priceNumber * (100 - Math.min(100, Math.max(0, discountValue))) / 100 * 100) / 100);
      return {
        slug: course.slug,
        name: course.name,
        date,
        priceNumber,
        discountedPriceNumber,
        // Capa e frase do curso vão junto: a oferta adicional aparece no checkout como um
        // cartão de venda, não como uma linha de texto (pedido da Erica, 09/09/2026). A capa
        // passa pela mesma resolução da agenda, então segue a arte oficial do código.
        image: resolveCourseImage(course, 'image'),
        promise: course.promise || '',
        category: course.category || '',
        workload: course.voomp?.workloadText || course.workload || '',
      };
    })
    .filter(Boolean);
}

export function previewCheckoutCoupon(course, form) {
  // O desconto real é sempre calculado e validado no servidor (regra P0.1 do Manual do produto).
  // Este preview é só uma mensagem de expectativa para a aluna antes de enviar o checkout.
  const baseCart = cartSummary(course, form.turma, form.coupon);
  const code = String(form.coupon || '').trim().toUpperCase();
  if (!code) return { cart: baseCart, label: '', valid: false };
  return { cart: baseCart, label: 'Cupom será validado antes do pagamento.', valid: true };
}

export function whatsappLink(course, date) {
  const attribution = getAttribution();
  const session = attribution.session_id ? ` Código de atendimento: ${attribution.session_id}.` : '';
  const message = `Oi! Vi a agenda da escola e tenho interesse no curso ${course.name}${date ? `, turma ${date}` : ''}. Pode me ajudar?${session}`;
  return `https://wa.me/${tenant.whatsapp}?text=${encodeURIComponent(message)}`;
}

// Mensagem de quem JÁ é aluna e vem buscar um benefício conquistado — a whatsappLink() acima
// é de venda ("tenho interesse no curso"), e mandar uma aluna pedir o prêmio dela com texto de
// interessada confunde os dois lados do atendimento (pedido da Erica, 07/09/2026).
export function whatsappBenefitLink({ studentName = '', benefitLabel = '', badgeLabel = '' } = {}) {
  const attribution = getAttribution();
  const session = attribution.session_id ? ` Código de atendimento: ${attribution.session_id}.` : '';
  const quem = studentName ? `Aqui é a ${studentName}. ` : '';
  const premio = benefitLabel || badgeLabel || 'meu benefício';
  const selo = badgeLabel && benefitLabel ? ` (selo "${badgeLabel}")` : '';
  const message = `Oi! ${quem}Conquistei um benefício na Minha Área e queria solicitar: ${premio}${selo}. Pode me ajudar?${session}`;
  return `https://wa.me/${tenant.whatsapp}?text=${encodeURIComponent(message)}`;
}

export function selectedOffer(course, date) {
  return course.variants?.[date] || null;
}

// Turma que tem contrato assinado (as três do Cabeleireiro): o preço vem do CONTRATO, não do
// catálogo (11/09/2026).
//
// A agenda em produção lê o catálogo do BANCO, e o banco fica para trás de propósito — a escola
// edita cursos pelo painel. Enquanto o preço vinha de lá, um valor velho no banco colocava no ar
// um total diferente do documento que a aluna assina, e a inscrição, que é calculada do total,
// saía errada junto: a tela chegou a mostrar inscrição de R$ 387,51 numa turma cuja inscrição é
// R$ 419,80. O contrato mora no código e é o que vale juridicamente, então é ele que manda.
function precoDoContrato(date) {
  return contractMoney(date)?.total ?? null;
}

export function displayPrice(course, date) {
  const doContrato = precoDoContrato(date);
  if (doContrato != null) return money(Math.round(doContrato * 100));
  return selectedOffer(course, date)?.price || course.price;
}

export function displayPriceNumber(course, date) {
  const doContrato = precoDoContrato(date);
  if (doContrato != null) return doContrato;
  return selectedOffer(course, date)?.priceNumber || course.priceNumber;
}

export function offerDescription(course, date) {
  return selectedOffer(course, date)?.description || null;
}

export function classCapacity(course, date) {
  return selectedOffer(course, date)?.capacity || course.capacity || 20;
}

export function classReserved(course, date) {
  const key = date || course.dates?.[0];
  return course.reservedByDate?.[key] || selectedOffer(course, key)?.reserved || course.reserved || 0;
}

export function classAvailable(course, date) {
  return Math.max(0, classCapacity(course, date) - classReserved(course, date));
}

export function isSoldOut(course, date) {
  return classMonth(date) !== 'A confirmar' && classAvailable(course, date) <= 0;
}

export function availabilityLabel(course, date) {
  if (classMonth(date) === 'A confirmar') return 'Datas em negociação';
  const available = classAvailable(course, date);
  if (available <= 0) return 'Turma lotada';
  if (available <= 5) return `Últimas ${available} vagas`;
  return `${available} vagas disponíveis`;
}

// Inscrição e parcelas do Cabeleireiro, calculadas do valor total da turma.
//
// São 13 pagamentos iguais: a inscrição paga na Voomp, mais 12 parcelas no cartão ou boleto —
// é o que dizem os três contratos da escola (11/09/2026). Antes o sistema tratava a inscrição
// como a 1ª de 12 parcelas e cobrava uma parcela A MENOS que o contrato: R$ 5.037,60 contra os
// R$ 5.457,40 da turma Noite.
//
// Derivar do total, e não ler de um campo do catálogo, também resolve um segundo defeito: a
// agenda em produção lê o catálogo do BANCO, e um valor antigo lá fazia as três turmas
// mostrarem "12x de R$ 508,22" (valor da Diurno) sobre totais de R$ 5.037,60.
//
// A conta é feita em centavos pra não acumular erro de ponto flutuante.
export function voompPaymentSplit(course, date) {
  const offer = selectedOffer(course, date);
  const priceNumber = displayPriceNumber(course, date);
  const totalCents = priceNumber ? Math.round(priceNumber * 100) : null;
  const installmentCents = totalCents ? Math.round(totalCents / PAGAMENTOS_CABELEIREIRO) : null;
  const enrollmentFee = installmentCents ? installmentCents / 100 : (offer?.enrollmentFee ?? course.voomp?.enrollmentFee ?? null);
  const remainingBalance = totalCents && installmentCents
    ? (totalCents - installmentCents) / 100
    : (offer?.remainingBalance ?? course.voomp?.remainingBalance ?? null);
  return { enrollmentFee, remainingBalance, priceNumber, parcelas: PAGAMENTOS_CABELEIREIRO - 1 };
}

export function paymentInfo(course, date) {
  if (course.flow === 'voomp') {
    // Na agenda e na página do curso, o parcelamento fica em destaque (menos
    // assustador) e o valor total aparece pequeno, só pra mostrar que é sem juros.
    // A inscrição é paga na Voomp; as demais parcelas são combinadas à parte —
    // isso fica explicado em detalhe na página de aceite (ContractSummary).
    const { enrollmentFee, priceNumber, parcelas } = voompPaymentSplit(course, date);
    const total = priceNumber ? money(Math.round(priceNumber * 100)) : null;
    // enrollmentFee é a inscrição, e as parcelas têm o mesmo valor (ver voompPaymentSplit).
    const installment = enrollmentFee ? money(Math.round(enrollmentFee * 100)) : null;
    // A inscrição precisa aparecer junto: "12x de R$ 419,80" ao lado de "total R$ 5.457,40" não
    // fecha a conta sozinho, porque o total inclui a 13ª parcela, que é a inscrição.
    return {
      card: installment ? `inscrição de ${installment} + ${parcelas}x de ${installment} sem juros` : 'valor informado no checkout Voomp',
      boleto: 'inscrição paga na Voomp · parcelas no cartão ou boleto, combinadas à parte',
      pix: 'condições de pagamento no checkout Voomp',
      featured: installment ? `${parcelas}x de ${installment}` : 'valor informado no checkout Voomp',
      featuredSub: installment && total ? `sem juros + inscrição de ${installment} · total ${total}` : 'condições disponíveis no checkout',
    };
  }
  const chosenPriceNumber = displayPriceNumber(course, date);
  const base = chosenPriceNumber ? Math.round(chosenPriceNumber * 100) : (course.price_cents || 0);
  const card = base ? money(base / 12) : 'consulte';
  const boleto = base ? money(base / 10) : 'consulte';
  const pix = base ? money(base * 0.9) : '10% de desconto';
  return {
    card: `até 12x de ${card} sem juros no cartão`,
    boleto: `até 10x de ${boleto} sem juros no boleto`,
    pix: `10% OFF no Pix à vista${base ? ` (${pix})` : ''}`,
    featured: base ? card : 'consulte',
    featuredSub: base ? 'em 12x sem juros' : 'condições disponíveis',
  };
}

export function activeDatesForCourse(course) {
  return (course.dates || []).filter((date) => !isClassDateExpired(date));
}

export function publicCourse(course) {
  if (!course || course.hiddenFromAgenda) return null;
  const dates = activeDatesForCourse(course);
  if (!dates.length) return null;
  return { ...course, dates };
}

export function monthsForCourse(course) {
  return Array.from(new Set(activeDatesForCourse(course).map(classMonth)));
}

export function monthStartDate(source = courses, month = '') {
  const dates = agendaCourses(source).flatMap((course) => activeDatesForCourse(course).filter((date) => classMonth(date) === month));
  const parsed = dates.map(classStartDate).filter(Boolean).sort((a, b) => a - b);
  return parsed[0] || new Date(9999, 11, 31);
}

export function firstDateForMonth(course, month) {
  const dates = activeDatesForCourse(course);
  if (!dates.length) return course.dates?.[0];
  if (!month || month === 'Todos') return dates[0];
  return dates.find((date) => classMonth(date) === month) || dates[0];
}

export function agendaCourses(source = courses) {
  return source.map(publicCourse).filter(Boolean);
}

export function findPublicCourse(slug, source = courses) {
  return publicCourse(source.find((item) => item.slug === slug));
}

export function monthlyGroups(source = courses) {
  const available = new Set(agendaCourses(source).flatMap(monthsForCourse));
  return Array.from(available).sort((a, b) => {
    const dateDiff = monthStartDate(source, a) - monthStartDate(source, b);
    if (dateDiff) return dateDiff;
    return monthRank(a) - monthRank(b);
  });
}

export function agendaCardCourses(source = courses, month = '') {
  return agendaCourses(source)
    .filter((course) => monthsForCourse(course).includes(month))
    .flatMap((course) => {
      if (course.slug !== 'cabeleireiro-profissional') return [course];
      return activeDatesForCourse(course)
        .filter((date) => classMonth(date) === month)
        .sort(sortDatesChronologically)
        .map((date) => {
          const offer = selectedOffer(course, date);
          const arteDaTurma = resolveClassImage(course, offer);
          return {
            ...course,
            // Turma com arte própria (Cabeleireiro Diurno/Noite/Sábado) mostra a capa dela;
            // sem arte de turma, segue a do curso. Pedido da Erica, 08/09/2026.
            image: arteDaTurma || course.image,
            banner: arteDaTurma || course.banner,
            mobileBanner: arteDaTurma || course.mobileBanner,
            agendaCardId: `${course.slug}-${safeSlug(offer?.label || date)}`,
            name: offer?.label ? `${course.name} — ${offer.label}` : course.name,
            dates: [date],
            variants: offer ? { [date]: offer } : course.variants,
            reservedByDate: { [date]: classReserved(course, date) },
          };
        });
    });
}

export function isContactOnly(course, date) {
  return course.flow === 'voomp' || classMonth(date) === 'A confirmar';
}

export function primaryCta(course, date) {
  if (isSoldOut(course, date)) return { label: 'Entrar na lista de espera', href: `/lista-de-espera?course=${encodeURIComponent(course.slug)}&turma=${encodeURIComponent(date)}` };
  if (course.flow === 'voomp') return { label: 'Iniciar pré-matrícula', href: `/aceite/${course.slug}?turma=${encodeURIComponent(date)}` };
  if (isContactOnly(course, date)) return { label: 'Tenho interesse', href: whatsappLink(course, date) };
  return { label: 'Garantir matrícula', href: `/matricula/${course.slug}?turma=${encodeURIComponent(date)}` };
}
