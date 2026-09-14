// Identidade da escola: impede publicar o site pela metade, ou com resto do cliente anterior.
//
// Este projeto nasceu como cópia de outro. Numa cópia, os dois erros que doem são o mesmo erro
// visto de dois lados: publicar com o campo em branco, e publicar com o dado da escola antiga.
// O primeiro é feio; o segundo é grave — CNPJ, endereço ou WhatsApp de um cliente no site de
// outro. Este teste reprova os dois.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { tenant, identidadeIncompleta } from './src/lib/tenant.js';
import { fallbackCourses } from './src/catalog.js';

const pendencias = [];

// 1. Todo campo obrigatório da escola precisa estar preenchido.
const faltando = identidadeIncompleta();
if (faltando.length) pendencias.push(`preencha em src/lib/tenant.js: ${faltando.join(', ')}`);

// 2. CNPJ no formato certo — ele vai para o contrato assinado.
if (tenant.cnpj && !/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(tenant.cnpj)) {
  pendencias.push(`CNPJ fora do formato 00.000.000/0001-00: "${tenant.cnpj}"`);
}

// 3. WhatsApp precisa ser só dígitos, com país e DDD — senão o link wa.me não abre.
if (tenant.whatsapp && !/^55\d{10,11}$/.test(tenant.whatsapp)) {
  pendencias.push(`WhatsApp precisa ser só dígitos começando em 55 (ex.: 5511999999999): "${tenant.whatsapp}"`);
}

// 4. Domínio sem https:// e sem barra — ele é concatenado em vários lugares.
if (tenant.dominio && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(tenant.dominio)) {
  pendencias.push(`domínio deve ser só o host, sem https:// e sem barra: "${tenant.dominio}"`);
}

// 5. O curso de exemplo não pode ir para o ar.
const exemplos = fallbackCourses.filter((curso) => curso.exemplo);
if (exemplos.length) {
  pendencias.push(`src/catalog.js ainda tem curso de exemplo (${exemplos.map((c) => c.slug).join(', ')}) — troque pelos cursos reais e apague a linha "exemplo: true"`);
}

// 6. Nada da escola anterior pode ter sobrado no código.
const proibidos = ['EBN', 'ebnedu', '51.853.267', 'Gusmão', 'Kamura', 'voompcreators', 'Av. Paulista, 726'];
const extensoes = ['.js', '.jsx', '.mjs', '.html', '.json', '.webmanifest', '.md', '.sql', '.css'];
function varrer(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', '.vercel'].includes(item.name)) continue;
    const caminho = `${dir}/${item.name}`;
    if (item.isDirectory()) { varrer(caminho); continue; }
    if (!extensoes.some((e) => item.name.endsWith(e))) continue;
    if (item.name === 'scripts-check-identidade.mjs') continue;
    const conteudo = readFileSync(caminho, 'utf8');
    for (const termo of proibidos) {
      if (conteudo.includes(termo)) pendencias.push(`${caminho} ainda cita "${termo}" — é dado da escola anterior`);
    }
  }
}
varrer('.');

// 7. O prefixo dos códigos públicos precisa ser o mesmo no servidor e no navegador: um código
// gerado com um prefixo não valida com o outro.
const servidor = /CODE_PREFIX \|\| '([A-Z]+)'/.exec(readFileSync('lib/certificates.mjs', 'utf8'))?.[1];
const navegador = /VITE_CODE_PREFIX \|\| '([A-Z]+)'/.exec(readFileSync('src/lib/certificate-code.js', 'utf8'))?.[1];
assert.equal(servidor, navegador, `prefixo padrão diferente entre servidor (${servidor}) e navegador (${navegador})`);

if (pendencias.length) {
  console.error('\nFalta configurar antes de publicar:\n');
  pendencias.forEach((p) => console.error('  · ' + p));
  console.error(`\n${pendencias.length} pendência(s). Comece por src/lib/tenant.js.\n`);
  process.exit(1);
}
console.log('OK  identidade da escola completa e sem resto do projeto de origem');
