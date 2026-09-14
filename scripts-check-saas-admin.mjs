// Painel administrativo da escola: o menu leva a algum lugar e nenhuma página some sozinha.
//
// A versão antiga procurava trechos de JSX ("SaasAdminShell active=...") dentro de src/main.jsx
// e src/demands.jsx. O painel foi reorganizado pra src/admin/ e virou uma casca única com
// seção ativa, então o script parou de achar o que procurava e estourava na primeira
// verificação. Reescrito em 07/09/2026: os dados do menu saíram do componente pra
// src/admin/nav.js e agora são conferidos como dados, não como texto — assim o teste não
// quebra mais a cada mudança de layout.
import { readFile } from 'node:fs/promises';
import { adminNavItems, adminNavGroups, adminPageTitles } from './src/admin/nav.js';

let falhas = 0;
function check(label, condicao, detalhe = '') {
  if (condicao) {
    console.log(`OK  ${label}`);
    return;
  }
  falhas += 1;
  console.error(`FALHOU  ${label}${detalhe ? `\n        ${detalhe}` : ''}`);
}

const chaves = adminNavItems.map(([key]) => key);
const titulos = adminPageTitles(true);

// O CRM é a única entrada do menu que abre uma página própria (/painel/crm -> CrmWorkspacePage),
// e por isso não tem título dentro do painel. Qualquer outra sem título abriria sem cabeçalho.
const SEM_TITULO_ESPERADO = new Set(['crm']);

// 1. Toda seção do menu tem título — sem isso a página abre quebrada (pageTitles[secao] undefined).
const semTitulo = chaves.filter((key) => !titulos[key] && !SEM_TITULO_ESPERADO.has(key));
check('toda seção do menu tem cabeçalho', semTitulo.length === 0, `sem título: ${semTitulo.join(', ')}`);

// 2. Todo título cadastrado tem entrada no menu — título órfão é página que ninguém alcança.
const orfaos = Object.keys(titulos).filter((key) => !chaves.includes(key));
check('nenhuma página fica sem entrada no menu', orfaos.length === 0, `órfãos: ${orfaos.join(', ')}`);

// 3. Todo item pertence a um grupo que existe. Item num grupo não listado em adminNavGroups
// simplesmente não é desenhado — o recurso some do painel sem erro nenhum.
const grupoFantasma = adminNavItems.filter(([, , , grupo]) => !adminNavGroups.includes(grupo));
check('todo item do menu está num grupo que existe', grupoFantasma.length === 0, grupoFantasma.map(([k, , , g]) => `${k} -> "${g}"`).join(', '));

// 4. Nenhum grupo do menu fica vazio.
const grupoVazio = adminNavGroups.filter((grupo) => !adminNavItems.some(([, , , g]) => g === grupo));
check('nenhum grupo do menu abre vazio', grupoVazio.length === 0, `vazios: ${grupoVazio.join(', ')}`);

// 5. O endereço bate com a chave da seção: se divergirem, o link abre outra página (ou nenhuma).
const hrefErrado = adminNavItems.filter(([key, href]) => href !== (key === 'dashboard' ? '/painel' : `/painel/${key}`));
check('todo link do menu aponta pra própria seção', hrefErrado.length === 0, hrefErrado.map(([k, h]) => `${k} -> ${h}`).join(', '));

// 6. Nenhuma chave repetida (duas entradas com a mesma chave brigam pelo destaque de ativo).
check('nenhuma seção repetida no menu', new Set(chaves).size === chaves.length);

// 7. O roteador entrega /painel pro painel e /painel/crm pro CRM. Sem isso o menu inteiro
// aponta pra lugar nenhum.
const main = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8');
check('/painel/crm abre a página própria do CRM', /parts\[0\] === 'painel' && parts\[1\] === 'crm'/.test(main));
check('/painel/<seção> abre o painel na seção certa', /<AdminPanel section=\{parts\[1\] \|\| 'dashboard'\} \/>/.test(main));

// 8. O painel tem layout de celular: a Erica opera pelo telefone, e sem isso o menu lateral
// fixo cobre a tela inteira.
const css = await readFile(new URL('./src/styles.css', import.meta.url), 'utf8');
check('painel tem layout próprio no celular', /@media\s*\(max-width:\s*760px\)[\s\S]{0,4000}?\.adminSidebar/.test(css));
check('painel tem estado visual de falha (.adminDataBanner--warn)', css.includes('.adminDataBanner--warn'));

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) do painel falharam.`);
  process.exit(1);
}
console.log('\nPainel a escola: menu completo, sem seção órfã e com layout de celular.');
