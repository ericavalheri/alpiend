import { asaasConfig } from '../lib/asaas.mjs';
import { isDbConfigured, listActiveUpsellOffers, replaceCatalogFromCourses } from '../lib/db.mjs';
import { ensureLiveCourseCatalog } from '../lib/courses.mjs';
import { metaConfig } from '../lib/meta.mjs';
import { studentAccessConfigured } from '../lib/student_access.mjs';
import { whatsappConfig } from '../lib/whatsapp.mjs';
import { fallbackCourses } from '../src/catalog.js';

export function salesCourseCatalog(course) {
  if (course?.slug !== 'cabeleireiro-profissional') return course;
  return {
    ...course,
    promise: 'Arte, técnica e empreendedorismo para formar cabeleireiros preparados para atuar no mercado.',
    long: 'Formação profissionalizante completa para aprender, na prática, os fundamentos do atendimento em salão: higienização, escova, modelagem, corte, colorimetria, mechas, transformações químicas, atendimento ao cliente e empreendedorismo.',
    voomp: {
      ...course.voomp,
      workloadText: 'Curso híbrido com prática presencial e apoio online',
    },
    highlights: ['Curso híbrido', 'Prática supervisionada', 'Atendimento a modelos', 'Material didático incluso', '18 vagas por turma'],
    learn: [
      'Fundamentos da profissão, postura profissional, biossegurança e organização do ambiente',
      'Tricologia aplicada, diagnóstico básico, saúde capilar e incompatibilidades químicas',
      'Higienização, escova lisa, escova modelada, ondas, bobs e finalizações',
      'Corte feminino e masculino: base reta, arredondada, degradê, camadas, chanel, franja, curto e máquina',
      'Colorimetria, cobertura de brancos, aplicação de cor, técnicas de mechas e esfumado de raiz',
      'Alisamento, relaxamento, permanente e cuidados em transformações químicas',
      'Atendimento profissional, comunicação com clientes, ética, gestão emocional e empreendedorismo',
    ],
    forWho: [
      'Quem quer iniciar uma carreira como cabeleireiro profissional com base completa',
      'Alunos que buscam formação prática, presencial e orientada para mercado de salão',
      'Quem quer desenvolver segurança para atender, diagnosticar, executar serviços e vender melhor',
      'Profissionais iniciantes ou em evolução que precisam organizar técnica, postura e visão de carreira',
    ],
  };
}

export async function catalogResponse(response) {
  // Elegibilidade e desconto do "curso adicional" vêm da tabela upsell_offers, nunca de uma
  // regra fixa no front-end (regra P1.2/5.1 do Manual do produto). O checkout ainda revalida tudo
  // de novo no servidor em /api/payments antes de cobrar.
  const upsellOffers = await listActiveUpsellOffers().catch(() => []);
  const upsellBySource = upsellOffers.reduce((acc, offer) => {
    acc[offer.source_course_slug] = acc[offer.source_course_slug] || [];
    acc[offer.source_course_slug].push({
      targetCourseSlug: offer.target_course_slug,
      title: offer.title,
      discountType: offer.discount_type || 'percent',
      discountValue: Number(offer.discount_value ?? 20),
    });
    return acc;
  }, {});
  // Pedido da Erica em 05/09/2026: cursos/turmas editáveis pelo painel, sem depender de
  // deploy. ensureLiveCourseCatalog() usa o catálogo do banco (courses/classes) quando ele
  // já foi sincronizado, e cai pro arquivo estático (comportamento de sempre) enquanto isso
  // não acontece — a agenda pública nunca fica sem catálogo nenhum.
  const { source, courses: liveCourses } = await ensureLiveCourseCatalog();
  const courses = liveCourses.map(salesCourseCatalog).map((course) => ({
    ...course,
    upsellTargets: upsellBySource[course.slug] || [],
  }));
  return response.status(200).json({ ok: true, source, fallback: source !== 'database', courses });
}

async function syncCatalog(request, response) {
  const configuredToken = process.env.CATALOG_SYNC_TOKEN || '';
  const receivedToken = request.headers['x-catalog-sync-token'] || request.query?.token || '';
  if (!configuredToken || receivedToken !== configuredToken) return response.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    const result = await replaceCatalogFromCourses(fallbackCourses, { syncedAt: new Date().toISOString(), source: 'fallback_catalog_module' });
    return response.status(200).json({ ok: true, status: 'catalog_synced', ...result });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error.code || 'catalog_sync_failed' });
  }
}

export default async function handler(request, response) {
  if (request.query?.resource === 'courses') return catalogResponse(response);
  if (request.method === 'POST' && request.query?.action === 'sync-catalog') return syncCatalog(request, response);
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  const asaas = asaasConfig();
  const meta = metaConfig();
  const whatsapp = whatsappConfig();
  const twilioConfigured = Boolean(whatsapp.twilioAccountSid && whatsapp.twilioAuthToken && (whatsapp.twilioFrom || whatsapp.twilioMessagingServiceSid));
  const twilioCoreTemplatesConfigured = Boolean(whatsapp.contentSids.enrollmentStarted && whatsapp.contentSids.paymentPending && whatsapp.contentSids.enrollmentConfirmed);
  const voompCabeleireiro = {
    diurno: Boolean(process.env.VOOMP_CHECKOUT_URL_CABELEIREIRO_DIURNO),
    noite: Boolean(process.env.VOOMP_CHECKOUT_URL_CABELEIREIRO_NOTURNO),
    sabado: Boolean(process.env.VOOMP_CHECKOUT_URL_CABELEIREIRO_SABADO),
    fallback: Boolean(process.env.VOOMP_CHECKOUT_URL_CABELEIREIRO),
  };
  response.status(200).json({
    ok: true,
    service: 'ebn-agenda-matriculas',
    version: 'mvp-crm-twilio-meta-asaas-supabase-catalog-preflight-locked',
    environment: {
      databaseConfigured: isDbConfigured(),
      // Achado em 11/09/2026: `databaseConfigured` responde true nos dois modos de banco, então
      // escondia a diferença que mais importa. Vários caminhos (recuperação de venda, webhook
      // da Voomp) tinham implementação só em SQL direto e ficavam mortos em produção, que roda
      // por Supabase REST. Sem este indicador não havia como perceber isso de fora.
      databaseMode: (process.env.DATABASE_URL) ? 'postgres' : 'supabase_rest',
      voompWebhookConfigured: Boolean(process.env.VOOMP_WEBHOOK_TOKEN),
      asaasConfigured: asaas.configured,
      asaasEnv: asaas.env,
      asaasCanCreatePayment: asaas.canCreatePayment,
      metaCapiConfigured: Boolean(meta.pixelId && meta.accessToken),
      twilioConfigured,
      twilioTemplatesConfigured: twilioCoreTemplatesConfigured,
      twilioStudentJourneyConfigured: Boolean(twilioCoreTemplatesConfigured && whatsapp.contentSids.studentAccess),
      twilioAbandonedCartConfigured: Boolean(whatsapp.contentSids.abandonedCartCoupon),
      twilioClassReminderConfigured: Boolean(whatsapp.contentSids.classReminder),
      // Clube da Escola (11/09/2026). Sem este indicador a escola não tinha como conferir se o
      // template do clube ficou configurado — e um template faltando é silencioso: o envio é
      // pulado e ninguém fica sabendo.
      twilioClubeConfigured: Boolean(whatsapp.contentSids.clubeEscola),
      studentAccessConfigured: studentAccessConfigured(),
      classReminderCronConfigured: Boolean(process.env.CRON_SECRET),
      cronEveryThirtyMinutes: true,
      voompCabeleireiroConfigured: {
        ...voompCabeleireiro,
        allClasses: Boolean(voompCabeleireiro.diurno && voompCabeleireiro.noite && voompCabeleireiro.sabado),
      },
      whatsappFollowupMode: whatsapp.mode,
      whatsappFollowupConfigured: Boolean(whatsapp.webhookUrl || (whatsapp.cloudToken && whatsapp.phoneNumberId) || twilioConfigured),
      catalogApi: true,
    },
    timestamp: new Date().toISOString(),
  });
}
