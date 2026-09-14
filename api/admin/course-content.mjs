// Materiais do curso (tabela course_content, Fase 4 do Manual do produto). Só quem tem a
// permissão "materials_manage" (owner ou acadêmico) pode cadastrar/publicar.
import { authConfig, hasPermission, verifySession } from '../../lib/admin_auth.mjs';
import { createCourseContent, listCourseContent, updateCourseContentStatus } from '../../lib/db.mjs';
import { ensureLiveCourseCatalog, findCourse } from '../../lib/courses.mjs';
import { uploadAdminFile } from '../../lib/uploads.mjs';

function safeString(value = '', max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

const CONTENT_TYPES = ['video', 'pdf', 'link', 'texto'];
const STATUSES = ['draft', 'published', 'archived'];

export default async function handler(request, response) {
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, PATCH');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const config = authConfig();
  const session = config.configured ? verifySession(request, config.sessionSecret) : null;
  if (!hasPermission(session, 'materials_manage')) {
    return response.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    if (request.method === 'GET') {
      const items = await listCourseContent();
      return response.status(200).json({ ok: true, items });
    }

    const body = request.body || {};

    if (request.method === 'POST') {
      const courseSlug = safeString(body.courseSlug, 120);
      const title = safeString(body.title, 200);
      const contentType = CONTENT_TYPES.includes(body.contentType) ? body.contentType : '';
      const externalUrl = safeString(body.externalUrl, 1000);
      let filePath = safeString(body.filePath, 1000);

      if (!courseSlug || !title || !contentType || (!externalUrl && !filePath && !body.fileData)) {
        return response.status(400).json({ ok: false, error: 'invalid_course_content_payload' });
      }
      await ensureLiveCourseCatalog();
      if (!findCourse(courseSlug)) {
        return response.status(400).json({ ok: false, error: 'course_not_found' });
      }
      if (body.fileData) {
        filePath = await uploadAdminFile(body.fileData, { bucket: 'course-materials', folder: courseSlug });
      }

      const created = await createCourseContent({
        courseSlug,
        classDate: safeString(body.classDate, 180) || null,
        title,
        description: safeString(body.description, 1000) || null,
        contentType,
        filePath: filePath || null,
        externalUrl: externalUrl || null,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
        createdBy: session.username || session.name || null,
      });
      return response.status(201).json({ ok: true, item: created });
    }

    const id = safeString(body.id, 120);
    const status = STATUSES.includes(body.status) ? body.status : '';
    if (!id || !status) {
      return response.status(400).json({ ok: false, error: 'invalid_course_content_update' });
    }
    const updated = await updateCourseContentStatus(id, status);
    if (!updated) return response.status(404).json({ ok: false, error: 'course_content_not_found' });
    return response.status(200).json({ ok: true, item: updated });
  } catch (error) {
    const clientErrors = ['invalid_file', 'file_too_large', 'storage_not_configured'];
    return response.status(clientErrors.includes(error.code) ? 400 : 500).json({ ok: false, error: error.code || 'course_content_failed' });
  }
}
