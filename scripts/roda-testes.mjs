// Roda a suíte inteira e separa o que passou, o que ainda dorme esperando dado, e o que falhou.
import { readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const rodar = promisify(execFile);
const arquivos = readdirSync('.').filter((f) => f.startsWith('scripts-check-') && f.endsWith('.mjs')).sort();
const passou = [], dormindo = [], falhou = [];

for (const arquivo of arquivos) {
  try {
    const { stdout } = await rodar('node', [arquivo]);
    const primeira = stdout.split('\n')[0] || '';
    (primeira.startsWith('--') ? dormindo : passou).push([arquivo, primeira.replace(/^--\s*/, '')]);
  } catch (erro) {
    const saida = `${erro.stdout || ''}${erro.stderr || ''}`;
    const motivo = saida.split('\n').find((l) => /AssertionError|FALHA|Error:|·/.test(l)) || 'falhou';
    falhou.push([arquivo, motivo.trim().slice(0, 160)]);
  }
}

console.log(`\n${passou.length} passaram`);
if (dormindo.length) {
  console.log(`\n${dormindo.length} ainda não dá para conferir:`);
  dormindo.forEach(([a, m]) => console.log(`  · ${a.replace('scripts-check-', '').replace('.mjs', '')} — ${m}`));
}
if (falhou.length) {
  console.log(`\n${falhou.length} FALHARAM:`);
  falhou.forEach(([a, m]) => console.log(`  ✗ ${a}\n      ${m}`));
  process.exit(1);
}
console.log('');
