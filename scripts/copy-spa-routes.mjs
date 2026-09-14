import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fallbackCourses } from '../src/catalog.js';

const distDir = new URL('../dist/', import.meta.url);
const indexFile = new URL('../dist/index.html', import.meta.url);

const codeCourseSlugs = fallbackCourses.filter((course) => !course.hiddenFromAgenda).map((course) => course.slug);

// Curso cadastrado só pelo painel (banco), sem passar por aqui, nunca ganhava a pasta
// estática de /curso e /matricula — a Vercel devolvia 404 puro pra qualquer slug que não
// existisse em src/catalog.js no momento do build, mesmo com o catálogo ao vivo funcionando
// certinho (achado pela Erica testando um curso de teste em 06/09/2026). Busca o catálogo do
// banco aqui também pra incluir esses slugs; se o banco não estiver configurado ou a conexão
// falhar durante o build, segue só com os cursos do código — nunca quebra o deploy por causa
// disso.
let dbCourses = [];
try {
  const { isDbConfigured, getManagedCatalog } = await import('../lib/db.mjs');
  if (isDbConfigured()) {
    dbCourses = (await getManagedCatalog()).filter((course) => !course.hiddenFromAgenda);
  }
} catch (error) {
  console.warn('copy-spa-routes: não consegui buscar o catálogo do banco, seguindo só com os cursos do código.', error.message);
}

const dbCourseSlugs = dbCourses.map((course) => course.slug);
const courseSlugs = [...new Set([...codeCourseSlugs, ...dbCourseSlugs])];
const voompSlugs = [...new Set([...fallbackCourses, ...dbCourses].filter((course) => course.flow === 'voomp' && !course.hiddenFromAgenda).map((course) => course.slug))];

const routes = [
  'agenda',
  'aluno',
  // O certificado é /certificado/<código>, e o código é diferente pra cada aluna — não dá pra
  // gerar uma pasta por código. Quem resolve o endereço completo é a regra de rewrite do
  // vercel.json; esta entrada cobre só o /certificado sozinho.
  'certificado',
  'login',
  'lista-de-espera',
  'painel',
  'painel/crm',
  'painel/alunos',
  'painel/vendas',
  'painel/cupons',
  'painel/ofertas',
  'painel/demandas',
  'painel/aceites',
  'painel/cursos',
  'painel/operacao',
  'painel/agencia',
  'painel/lista-espera',
  'painel/usuarios',
  ...courseSlugs.map((slug) => `curso/${slug}`),
  ...courseSlugs.map((slug) => `matricula/${slug}`),
  ...voompSlugs.map((slug) => `aceite/${slug}`),
];

for (const route of routes) {
  const targetDir = join(distDir.pathname, route);
  await mkdir(targetDir, { recursive: true });
  await copyFile(indexFile, join(targetDir, 'index.html'));
}
