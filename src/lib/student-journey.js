// Avatares e progresso da jornada da aluna na Minha Área. Extraído de src/main.jsx
// (organização de arquivos pedida pela Erica, 05/09/2026).

// Os 5 avatares oficiais da Minha Área, enviados e aprovados pela Erica em 28/08/2026, e mais 7
// enviados em 04-05/09/2026 pra dar mais variedade de gênero em cada etapa (ver
// public/assets/minha-area/MAPA.md). Antes, esses campos "src" apontavam pra uma pasta que
// nunca existiu (/assets/aluno-avatares/...) — toda a jornada mostrava ícone de imagem
// quebrada. Regra do MAPA.md: só personagens aprovados pela Erica, nenhum antigo sem aprovação nova.
export const studentAvatarLibrary = {
  matricula: [
    { key: 'starter-dreadlocks', name: 'Primeiro passo', className: 'studentAvatarBody--apron', src: '/assets/minha-area/personagem-aluno-dreadlocks-painel.webp' },
    { key: 'verde-notebook', name: 'Primeiro passo', className: 'studentAvatarBody--apron', src: '/assets/minha-area/personagem-aluna-verde-notebook-painel.webp' },
  ],
  preparacao: [
    { key: 'study-notebook', name: 'Pronto para a aula', className: 'studentAvatarBody--study', src: '/assets/minha-area/personagem-aluno-estudando-painel.webp' },
    { key: 'pixie-tablet', name: 'Pronto para a aula', className: 'studentAvatarBody--study', src: '/assets/minha-area/personagem-aluna-pixie-tablet-painel.webp' },
    { key: 'moreno-livros', name: 'Pronto para a aula', className: 'studentAvatarBody--study', src: '/assets/minha-area/personagem-aluno-moreno-livros-painel.webp' },
  ],
  checkin: [
    { key: 'checkin-laptop', name: 'Entrada liberada', className: 'studentAvatarBody--checkin', src: '/assets/minha-area/personagem-aluno-azul-notebook-painel.webp' },
    { key: 'morena-comemorando', name: 'Entrada liberada', className: 'studentAvatarBody--checkin', src: '/assets/minha-area/personagem-aluna-morena-comemorando-painel.webp' },
  ],
  certificado: [
    { key: 'certificate-celebrate', name: 'Certificada a escola', className: 'studentAvatarBody--certificate', src: '/assets/minha-area/personagem-aluna-rosa-comemorando-painel.webp' },
    { key: 'cacheada-certificado', name: 'Certificada a escola', className: 'studentAvatarBody--certificate', src: '/assets/minha-area/personagem-aluna-cacheada-certificado-painel.webp' },
    { key: 'roxa-certificado', name: 'Certificada a escola', className: 'studentAvatarBody--certificate', src: '/assets/minha-area/personagem-aluna-roxa-certificado-painel.webp' },
  ],
  proximo: [
    { key: 'next-course', name: 'Próxima turma', className: 'studentAvatarBody--next', src: '/assets/minha-area/personagem-aluno-masculino-painel.webp' },
    { key: 'loira-descontraida', name: 'Próxima turma', className: 'studentAvatarBody--next', src: '/assets/minha-area/personagem-aluna-loira-descontraida-painel.webp' },
  ],
};

export function getStudentJourneyStage(enrollment = {}, stats = {}) {
  if (/dispon/i.test(enrollment.certificateStatus || '')) return 'certificado';
  if (enrollment.canCheckIn) return 'checkin';
  if (enrollment.materials?.length) return 'preparacao';
  if (stats.paidCourses >= 1 || /received|confirm|pago|paid/i.test(`${enrollment.paymentStatus} ${enrollment.status}`)) return 'preparacao';
  return 'matricula';
}

export function journeyItemsProgress(enrollment = {}, stats = {}) {
  if (/dispon/i.test(enrollment.certificateStatus || '')) return 100;
  if (enrollment.canCheckIn) return 75;
  if (enrollment.materials?.length) return 55;
  if (stats.paidCourses >= 1 || /received|confirm|pago|paid/i.test(`${enrollment.paymentStatus} ${enrollment.status}`)) return 40;
  return 20;
}

// Link pra retomar uma matrícula começada mas não paga (pedido da Erica, 04/09/2026: quem
// começou o Cabeleireiro mas só pagou Colorimetria precisa ver "finalize sua matrícula" na
// Minha Área, não aparecer como se já fosse aluna do curso que nunca pagou). Mesma regra de
// rota usada em courseCheckoutUrl (lib/whatsapp.mjs).
export function continueEnrollmentUrl(enrollment = {}) {
  const slug = String(enrollment.courseSlug || '');
  const route = enrollment.flow === 'voomp' || slug.includes('cabeleireiro-profissional') ? 'aceite' : 'matricula';
  const query = enrollment.classDate ? `?turma=${encodeURIComponent(enrollment.classDate)}` : '';
  return `/${route}/${slug}${query}`;
}

export function pickStudentAvatar(stage, accessIndex = 0) {
  const options = studentAvatarLibrary[stage] || studentAvatarLibrary.matricula;
  return options[Math.abs(accessIndex) % options.length] || options[0];
}

export function getStudentAccessCountKey(portal) {
  const studentId = portal?.student?.id || 'anon';
  const enrollmentId = portal?.enrollments?.[0]?.id || 'portal';
  return `ebn_student_access_count_${studentId}_${enrollmentId}`;
}

export function studentPhotoStorageKey(studentId = 'anon') {
  return `ebn_student_avatar_photo_${studentId}`;
}

export function allStudentAvatars() {
  return Object.values(studentAvatarLibrary).flat();
}

export function findStudentAvatarByKey(key, fallback) {
  return allStudentAvatars().find((avatar) => avatar.key === key) || fallback || allStudentAvatars()[0];
}
