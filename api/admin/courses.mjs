// Gestão de cursos/turmas pelo painel (pedido da Erica, 05/09/2026): antes só dava pra
// adicionar/editar curso ou turma com um deploy de código. Usa as mesmas tabelas
// courses/classes que a agenda pública já lê ao vivo (ver lib/courses.mjs,
// ensureLiveCourseCatalog). Só quem tem a permissão "courses_manage" (owner ou comercial)
// pode cadastrar/editar/arquivar.
import { authConfig, hasPermission, verifySession } from '../../lib/admin_auth.mjs';
import { archiveManagedClass, getManagedCatalog, isDbConfigured, replaceCatalogFromCourses, upsertManagedClass, upsertManagedCourse } from '../../lib/db.mjs';
import { normalizeSlug, parseCourseImportCsv } from '../../lib/courses.mjs';
import { fallbackCourses } from '../../src/catalog.js';

const MAX_IMPORT_ROWS = 200;

// Arte oficial do curso no código, pra distinguir uma capa nova escolhida pela Erica no painel
// da capa atual que o formulário de editar curso devolve pré-preenchida.
function codeArtFor(slug) {
  const course = fallbackCourses.find((item) => item.slug === slug);
  return course?.image || '';
}

function safeString(value = '', max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeStringList(value) {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => safeString(item, 300)).filter(Boolean);
}

export default async function handler(request, response) {
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, PATCH');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const config = authConfig();
  const session = config.configured ? verifySession(request, config.sessionSecret) : null;
  if (!hasPermission(session, 'courses_manage')) {
    return response.status(403).json({ ok: false, error: 'forbidden' });
  }
  if (!isDbConfigured()) {
    return response.status(503).json({ ok: false, error: 'database_not_configured' });
  }

  const audit = { actor: session?.username || session?.id || null };

  try {
    if (request.method === 'GET') {
      const courses = await getManagedCatalog();
      return response.status(200).json({ ok: true, courses });
    }

    const body = request.body || {};

    if (request.method === 'POST' && body.action === 'seed_from_code') {
      // Primeira ativação: publica o catálogo hoje só existente no código (src/catalog.js)
      // dentro do banco, pra a agenda passar a ler dali. Segura de rodar de novo — substitui
      // (não duplica) os cursos/turmas que vieram do código.
      const result = await replaceCatalogFromCourses(fallbackCourses, { syncedAt: new Date().toISOString(), source: 'admin_panel', actor: audit.actor });
      return response.status(200).json({ ok: true, status: 'catalog_seeded', ...result });
    }

    if (request.method === 'POST' && body.action === 'bulk_import') {
      const csvText = typeof body.csv === 'string' ? body.csv.slice(0, 500_000) : '';
      if (!csvText.trim()) {
        return response.status(400).json({ ok: false, error: 'empty_csv' });
      }
      const parsed = parseCourseImportCsv(csvText);
      if (parsed.headerError) {
        return response.status(400).json({ ok: false, error: parsed.headerError, missingColumns: parsed.missingColumns });
      }
      if (parsed.rows.length > MAX_IMPORT_ROWS) {
        return response.status(400).json({ ok: false, error: 'too_many_rows', maxRows: MAX_IMPORT_ROWS });
      }

      // Sem commit: só devolve a prévia (linhas interpretadas + validação), pra Erica conferir
      // e corrigir antes de qualquer coisa ir pro banco — pedido dela desde a primeira
      // conversa sobre esse importador ("me dando a opção de editar qqr campo que não esteja
      // de acordo").
      if (!body.commit) {
        return response.status(200).json({ ok: true, preview: true, rows: parsed.rows });
      }

      const validRows = parsed.rows.filter((row) => row.valid);
      const seenCourseSlugs = new Set();
      const results = [];
      for (const row of validRows) {
        try {
          if (!seenCourseSlugs.has(row.courseSlug)) {
            seenCourseSlugs.add(row.courseSlug);
            const existingCourse = (await getManagedCatalog()).find((course) => course.slug === row.courseSlug);
            if (!existingCourse) {
              if (!row.courseName) {
                results.push({ lineNumber: row.lineNumber, ok: false, error: 'curso_nome obrigatório na primeira linha de um curso novo' });
                continue;
              }
              await upsertManagedCourse({ slug: row.courseSlug, name: row.courseName, category: row.category, hiddenFromAgenda: false, metadata: { priceNumber: row.priceNumber, capacity: row.capacity || 20 } }, audit);
            }
          }
          const created = await upsertManagedClass({
            courseSlug: row.courseSlug,
            classDate: row.classDate,
            optionLabel: row.optionLabel,
            capacity: row.capacity || 20,
            priceNumber: row.priceNumber,
            workload: row.workload,
            description: row.description,
          }, audit);
          results.push({ lineNumber: row.lineNumber, ok: true, class: created });
        } catch (error) {
          results.push({ lineNumber: row.lineNumber, ok: false, error: error.code || 'row_import_failed' });
        }
      }
      const invalidRows = parsed.rows.filter((row) => !row.valid).map((row) => ({ lineNumber: row.lineNumber, ok: false, errors: row.errors }));
      return response.status(200).json({ ok: true, status: 'bulk_import_processed', imported: results.filter((r) => r.ok).length, results: [...results, ...invalidRows] });
    }

    // Ocultar/mostrar um curso inteiro na agenda (pedido da Erica, 07/09/2026). Faltava:
    // dava pra arquivar TURMA, mas não o curso — e ela ficou sem como tirar do site dois
    // cursos de cabeleireiro duplicados que entraram por importação de planilha. Segue a
    // regra do Manual do produto: "excluir" no painel sempre oculta/arquiva, nunca apaga do banco,
    // porque matrícula e pagamento já feitos apontam pro curso e não podem virar órfãos.
    if (request.method === 'POST' && body.action === 'course_visibility') {
      const slug = normalizeSlug(safeString(body.courseSlug, 140));
      if (!slug) return response.status(400).json({ ok: false, error: 'invalid_course_slug' });
      const catalog = await getManagedCatalog();
      const course = catalog.find((item) => item.slug === slug);
      if (!course) return response.status(404).json({ ok: false, error: 'course_not_found' });
      const hidden = body.hiddenFromAgenda !== false;
      const saved = await upsertManagedCourse({
        slug,
        name: course.name,
        category: course.category,
        hiddenFromAgenda: hidden,
        metadata: { hiddenFromAgenda: hidden, hiddenReason: safeString(body.reason, 300) || null },
      }, audit);
      return response.status(200).json({ ok: true, status: hidden ? 'course_hidden' : 'course_visible', course: saved });
    }

    if (request.method === 'POST' && body.action === 'class') {
      const courseSlug = normalizeSlug(body.courseSlug);
      const classDate = safeString(body.classDate, 180);
      const priceNumber = Number(body.priceNumber);
      if (!courseSlug || !classDate || !(priceNumber > 0)) {
        return response.status(400).json({ ok: false, error: 'invalid_class_payload' });
      }
      const originalClassDate = safeString(body.originalClassDate, 180) || undefined;
      const created = await upsertManagedClass({
        courseSlug,
        classDate,
        originalClassDate,
        optionLabel: safeString(body.optionLabel, 120) || null,
        capacity: Number(body.capacity) || 20,
        priceNumber,
        status: ['open', 'closed', 'archived', 'hidden'].includes(body.status) ? body.status : 'open',
        description: safeString(body.description, 500) || null,
        workload: safeString(body.workload, 200) || null,
      }, audit);
      return response.status(201).json({ ok: true, class: created });
    }

    if (request.method === 'POST') {
      const slug = normalizeSlug(body.slug);
      const name = safeString(body.name, 180);
      if (!slug || !name) {
        return response.status(400).json({ ok: false, error: 'invalid_course_payload' });
      }
      const metadata = {
        promise: safeString(body.promise, 500) || undefined,
        long: safeString(body.long, 2000) || undefined,
        mentor: safeString(body.mentor, 180) || undefined,
        mentorTitle: safeString(body.mentorTitle, 200) || undefined,
        mentorBio: safeString(body.mentorBio, 2000) || undefined,
        mentorPhoto: safeString(body.mentorPhoto, 500) || undefined,
        mentorInstagram: safeString(body.mentorInstagram, 300) || undefined,
        mentorCredentials: safeStringList(body.mentorCredentials),
        level: safeString(body.level, 120) || undefined,
        workload: safeString(body.workload, 200) || undefined,
        installments: safeString(body.installments, 200) || undefined,
        location: safeString(body.location, 300) || undefined,
        priceNumber: Number(body.priceNumber) > 0 ? Number(body.priceNumber) : undefined,
        price: Number(body.priceNumber) > 0 ? Number(body.priceNumber).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : undefined,
        capacity: Number(body.capacity) > 0 ? Number(body.capacity) : undefined,
        image: safeString(body.image, 500) || undefined,
        // Marca de quem escolheu a capa. A agenda dá preferência à arte do código (arquivos em
        // public/assets/cursos, trocados por deploy) porque a cópia guardada aqui no banco
        // envelhece a cada troca de arte — foi o que segurou as capas de setembro fora da
        // agenda em 08/09/2026. A exceção é esta marca: capa escolhida no painel continua
        // valendo. Só marcamos quando a URL enviada é DIFERENTE da arte do código: o formulário
        // de editar curso vem pré-preenchido com a capa atual, e sem essa comparação um simples
        // "salvar" fixaria a capa velha pra sempre.
        imageSource: safeString(body.image, 500) && safeString(body.image, 500) !== codeArtFor(slug) ? 'painel' : null,
        flow: body.flow === 'voomp' ? 'voomp' : undefined,
        highlights: safeStringList(body.highlights),
        learn: safeStringList(body.learn),
        forWho: safeStringList(body.forWho),
      };
      Object.keys(metadata).forEach((key) => { if (metadata[key] === undefined) delete metadata[key]; });
      const created = await upsertManagedCourse({
        slug,
        name,
        category: safeString(body.category, 120) || null,
        hiddenFromAgenda: Boolean(body.hiddenFromAgenda),
        metadata,
      }, audit);
      return response.status(201).json({ ok: true, course: created });
    }

    // PATCH: arquivar uma turma ("excluir" — mantém histórico de quem já se matriculou).
    const courseSlug = normalizeSlug(body.courseSlug);
    const classDate = safeString(body.classDate, 180);
    if (!courseSlug || !classDate) {
      return response.status(400).json({ ok: false, error: 'invalid_archive_payload' });
    }
    const archived = await archiveManagedClass(courseSlug, classDate);
    if (!archived) return response.status(404).json({ ok: false, error: 'class_not_found' });
    return response.status(200).json({ ok: true, class: archived });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error.code || 'course_management_failed' });
  }
}
