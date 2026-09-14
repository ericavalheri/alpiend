// Verificação rápida do RBAC do painel admin (Fase 3.1, regra P1.7/13 do Manual do produto):
// cada papel só pode fazer o que está na sua lista de permissões, mesmo com sessão válida
// autenticada. Não depende de banco real — testa só a barreira de permissão, que roda antes
// de qualquer chamada ao banco.
import assert from 'node:assert/strict';

process.env.ADMIN_SESSION_SECRET = 'teste-de-permissoes-com-32-caracteres-ou-mais';
// authConfig() exige sessionSecret + (banco configurado OU modo legado ativo). Sem banco
// neste teste, simulamos o modo legado só para "configured" ficar true — o valor não precisa
// ser um hash real, pois este teste nunca chama verifyPassword.
process.env.ADMIN_PASSWORD_HASH = 'pbkdf2_sha256$210000$fakesalt$fakehash';

const { createSessionCookie, ROLE_PERMISSIONS } = await import('./lib/admin_auth.mjs');

function mockResponse() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  res.setHeader = () => {};
  return res;
}

function requestAs(role, body, method = 'POST') {
  const cookie = createSessionCookie('teste-de-permissoes-com-32-caracteres-ou-mais', { id: `id-${role}`, username: role, role, name: role }).split(';')[0];
  return { method, headers: { cookie }, body };
}

async function run() {
  assert.deepEqual(Object.keys(ROLE_PERMISSIONS).sort(), ['academico', 'atendimento', 'comercial', 'marketing', 'owner'].sort(), 'papéis esperados definidos em ROLE_PERMISSIONS');

  const { default: summaryHandler } = await import('./api/admin/summary.mjs');

  const resAcademicoWhatsapp = mockResponse();
  await summaryHandler(requestAs('academico', { action: 'whatsapp_dispatch' }), resAcademicoWhatsapp);
  assert.equal(resAcademicoWhatsapp.statusCode, 403, 'papel academico não tem permissão whatsapp_dispatch');

  const resMarketingCrm = mockResponse();
  await summaryHandler(requestAs('marketing', { action: 'crm_activity' }), resMarketingCrm);
  assert.equal(resMarketingCrm.statusCode, 403, 'papel marketing não tem permissão crm');

  const resOwnerBadge = mockResponse();
  await summaryHandler(requestAs('owner', { action: 'student_badge_review', badge: {} }), resOwnerBadge);
  assert.notEqual(resOwnerBadge.statusCode, 403, 'papel owner tem todas as permissões (pode falhar depois por falta de banco, mas não por 403)');
  console.log('OK  Fase 3.1 — api/admin/summary.mjs bloqueia ações fora da permissão do papel');

  const { default: usersHandler } = await import('./api/admin/users.mjs');

  const resComercialUsers = mockResponse();
  await usersHandler(requestAs('comercial', {}), resComercialUsers);
  assert.equal(resComercialUsers.statusCode, 403, 'papel comercial não pode gerenciar usuários');

  const resOwnerUsers = mockResponse();
  await usersHandler(requestAs('owner', {}), resOwnerUsers);
  assert.notEqual(resOwnerUsers.statusCode, 403, 'papel owner pode gerenciar usuários (pode falhar depois por falta de banco, mas não por 403)');
  console.log('OK  Fase 3.1 — api/admin/users.mjs exige permissão users_manage (só owner)');

  const { default: offersHandler } = await import('./api/admin/upsell-offers.mjs');

  const resAtendimentoOffers = mockResponse();
  await offersHandler(requestAs('atendimento', {}), resAtendimentoOffers);
  assert.equal(resAtendimentoOffers.statusCode, 403, 'papel atendimento não pode gerenciar ofertas');

  const resComercialOffers = mockResponse();
  await offersHandler(requestAs('comercial', {}), resComercialOffers);
  assert.notEqual(resComercialOffers.statusCode, 403, 'papel comercial pode gerenciar ofertas (pode falhar depois por falta de banco, mas não por 403)');
  console.log('OK  Painel de Ofertas — api/admin/upsell-offers.mjs exige permissão offers_manage (owner/comercial)');

  const { default: courseContentHandler } = await import('./api/admin/course-content.mjs');
  const resMarketingMaterials = mockResponse();
  await courseContentHandler(requestAs('marketing', {}), resMarketingMaterials);
  assert.equal(resMarketingMaterials.statusCode, 403, 'papel marketing não pode gerenciar materiais do curso');
  const resAcademicoMaterials = mockResponse();
  await courseContentHandler(requestAs('academico', {}), resAcademicoMaterials);
  assert.notEqual(resAcademicoMaterials.statusCode, 403, 'papel academico pode gerenciar materiais (pode falhar depois por falta de banco, mas não por 403)');

  const { default: certificatesHandler } = await import('./api/admin/certificates.mjs');
  const resComercialCertificates = mockResponse();
  await certificatesHandler(requestAs('comercial', {}), resComercialCertificates);
  assert.equal(resComercialCertificates.statusCode, 403, 'papel comercial não pode gerenciar certificados');
  const resOwnerCertificates = mockResponse();
  await certificatesHandler(requestAs('owner', {}), resOwnerCertificates);
  assert.notEqual(resOwnerCertificates.statusCode, 403, 'papel owner pode gerenciar certificados (pode falhar depois por falta de banco, mas não por 403)');
  console.log('OK  Operação — course-content.mjs e certificates.mjs exigem materials_manage/certificates_manage (owner/academico)');

  const { default: notificationsHandler } = await import('./api/admin/notifications.mjs');
  const resAtendimentoNotifications = mockResponse();
  await notificationsHandler(requestAs('atendimento', {}), resAtendimentoNotifications);
  assert.equal(resAtendimentoNotifications.statusCode, 403, 'papel atendimento não pode gerenciar avisos à aluna');
  const resComercialNotifications = mockResponse();
  await notificationsHandler(requestAs('comercial', {}), resComercialNotifications);
  assert.notEqual(resComercialNotifications.statusCode, 403, 'papel comercial pode gerenciar avisos (pode falhar depois por falta de banco, mas não por 403)');
  console.log('OK  Operação — notifications.mjs exige permissão notifications_manage (owner/comercial/academico)');

  const { default: agencyDemandsHandler } = await import('./api/admin/agency-demands.mjs');
  const resAcademicoAgency = mockResponse();
  await agencyDemandsHandler(requestAs('academico', {}), resAcademicoAgency);
  assert.equal(resAcademicoAgency.statusCode, 403, 'papel academico não pode ver/gerenciar demandas da agência');
  const resOwnerAgency = mockResponse();
  await agencyDemandsHandler(requestAs('owner', {}), resOwnerAgency);
  assert.notEqual(resOwnerAgency.statusCode, 403, 'papel owner pode gerenciar demandas da agência (pode falhar depois por falta de banco, mas não por 403)');
  console.log('OK  Demandas da agência — agency-demands.mjs exige permissão agency_demands_manage (só owner)');

  const { default: badgeBenefitsHandler } = await import('./api/admin/badge-benefits.mjs');
  const resAtendimentoBadges = mockResponse();
  await badgeBenefitsHandler(requestAs('atendimento', {}), resAtendimentoBadges);
  assert.equal(resAtendimentoBadges.statusCode, 403, 'papel atendimento não pode gerenciar o catálogo de benefícios por selo');
  const resComercialBadges = mockResponse();
  await badgeBenefitsHandler(requestAs('comercial', {}), resComercialBadges);
  assert.notEqual(resComercialBadges.statusCode, 403, 'papel comercial pode gerenciar benefícios por selo (pode falhar depois por falta de banco, mas não por 403)');
  console.log('OK  Selos e benefícios — badge-benefits.mjs exige permissão badge_benefits_manage (owner/comercial)');

  const { default: couponsHandler } = await import('./api/admin/coupons.mjs');
  const resAtendimentoCoupons = mockResponse();
  await couponsHandler(requestAs('atendimento', {}), resAtendimentoCoupons);
  assert.equal(resAtendimentoCoupons.statusCode, 403, 'papel atendimento não pode gerenciar cupons');
  const resComercialCoupons = mockResponse();
  await couponsHandler(requestAs('comercial', {}), resComercialCoupons);
  assert.notEqual(resComercialCoupons.statusCode, 403, 'papel comercial pode gerenciar cupons (pode falhar depois por falta de banco, mas não por 403)');
  console.log('OK  Cupons — coupons.mjs exige permissão coupons_manage (owner/comercial), "excluir" sempre arquiva');

  const { default: coursesHandler } = await import('./api/admin/courses.mjs');
  const resAtendimentoCourses = mockResponse();
  await coursesHandler(requestAs('atendimento', {}), resAtendimentoCourses);
  assert.equal(resAtendimentoCourses.statusCode, 403, 'papel atendimento não pode gerenciar cursos/turmas');
  const resComercialCourses = mockResponse();
  await coursesHandler(requestAs('comercial', {}), resComercialCourses);
  assert.notEqual(resComercialCourses.statusCode, 403, 'papel comercial pode gerenciar cursos/turmas (pode falhar depois por falta de banco, mas não por 403)');
  console.log('OK  Cursos/turmas — courses.mjs exige permissão courses_manage (owner/comercial), "excluir turma" sempre arquiva');

  const { default: waitlistHandler } = await import('./api/admin/waitlist.mjs');
  const resMarketingWaitlist = mockResponse();
  await waitlistHandler(requestAs('marketing', undefined, 'GET'), resMarketingWaitlist);
  assert.equal(resMarketingWaitlist.statusCode, 403, 'papel marketing não pode ver/gerenciar a lista de espera');
  const resAtendimentoWaitlist = mockResponse();
  await waitlistHandler(requestAs('atendimento', undefined, 'GET'), resAtendimentoWaitlist);
  assert.notEqual(resAtendimentoWaitlist.statusCode, 403, 'papel atendimento pode ver a lista de espera (pode falhar depois por falta de banco, mas não por 403)');
  console.log('OK  Lista de espera — waitlist.mjs exige permissão waitlist_manage (owner/comercial/atendimento)');

  // Excluir card do CRM (pedido da Erica, 03/09/2026): mesma permissão "crm" de sempre —
  // "dismissed"/"restored" são só mais dois tipos de crm_activity, reversível, sem apagar
  // nada do banco. Confirma que a barreira de permissão continua valendo pra essa ação.
  const resMarketingDismiss = mockResponse();
  await summaryHandler(requestAs('marketing', { action: 'crm_activity', activity: { leadKey: 'lead-1', activityType: 'dismissed' } }), resMarketingDismiss);
  assert.equal(resMarketingDismiss.statusCode, 403, 'papel marketing não pode excluir/restaurar card do CRM (sem permissão crm)');
  const resAtendimentoDismiss = mockResponse();
  await summaryHandler(requestAs('atendimento', { action: 'crm_activity', activity: { leadKey: 'lead-1', activityType: 'dismissed' } }), resAtendimentoDismiss);
  assert.notEqual(resAtendimentoDismiss.statusCode, 403, 'papel atendimento pode excluir/restaurar card do CRM (pode falhar depois por falta de banco, mas não por 403)');
  const dbSourceForCrm = await (await import('node:fs/promises')).readFile('./lib/db.mjs', 'utf8');
  assert.ok(dbSourceForCrm.includes("'dismissed'") && dbSourceForCrm.includes("'restored'"), 'lib/db.mjs deve aceitar os tipos de atividade "dismissed" e "restored" pro botão de excluir card do CRM');
  console.log('OK  Excluir card do CRM — dismissed/restored usam a mesma permissão crm, sem apagar dado nenhum');

  console.log('\nTodas as verificações de RBAC do admin passaram.');
}

run().catch((error) => {
  console.error('FALHOU:', error.message);
  process.exit(1);
});
