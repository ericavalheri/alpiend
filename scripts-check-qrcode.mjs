// O QR do check-in tem que ler de verdade no celular da recepção.
//
// O gerador (src/lib/qrcode.js) foi escrito à mão, sem biblioteca — então conferir "no olho"
// não vale: um único pontinho errado e a câmera não lê. Este script LÊ o QR de volta, do
// jeito que um leitor lê: acha a informação de formato, desfaz a máscara, percorre o
// ziguezague, desintercala os blocos, confere a correção de erro Reed-Solomon (síndromes têm
// que dar zero) e remonta o texto. Se o texto que sai for igual ao que entrou, o código é
// válido — independente de qualquer implementação de referência.
//
// O leitor aqui é escrito do zero, sem reaproveitar o mapa de módulos do gerador: se o
// gerador colocar um módulo no lugar errado, o leitor tropeça em vez de repetir o mesmo erro.
import { qrMatrix, qrSvgPath, qrSvgSize } from './src/lib/qrcode.js';
import { checkInCodeFor } from './lib/checkin.mjs';

let falhas = 0;
function check(label, condicao, detalhe = '') {
  if (condicao) {
    console.log(`OK  ${label}`);
    return;
  }
  falhas += 1;
  console.error(`FALHOU  ${label}${detalhe ? `\n        ${detalhe}` : ''}`);
}

// --- GF(256), pra conferir as síndromes de Reed-Solomon --------------------------------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i += 1) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

const BLOCOS_M = {
  1: { ec: 10, grupos: [[1, 16]] }, 2: { ec: 16, grupos: [[1, 28]] }, 3: { ec: 26, grupos: [[1, 44]] },
  4: { ec: 18, grupos: [[2, 32]] }, 5: { ec: 24, grupos: [[2, 43]] }, 6: { ec: 16, grupos: [[4, 27]] },
  7: { ec: 18, grupos: [[4, 31]] }, 8: { ec: 22, grupos: [[2, 38], [2, 39]] },
  9: { ec: 22, grupos: [[3, 36], [2, 37]] }, 10: { ec: 26, grupos: [[4, 43], [1, 44]] },
};
const ALIGNMENT = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

// Mapa dos módulos que NÃO são dados: finders, separadores, timing, alignment, formato,
// versão e o módulo escuro fixo. Montado aqui do zero, a partir da norma.
function mapaDeFuncao(tamanho, versao) {
  const funcao = Array.from({ length: tamanho }, () => new Array(tamanho).fill(false));
  const marca = (linha, coluna, altura, largura) => {
    for (let i = 0; i < altura; i += 1) {
      for (let j = 0; j < largura; j += 1) {
        const l = linha + i;
        const c = coluna + j;
        if (l >= 0 && c >= 0 && l < tamanho && c < tamanho) funcao[l][c] = true;
      }
    }
  };
  marca(0, 0, 9, 9);
  marca(0, tamanho - 8, 9, 8);
  marca(tamanho - 8, 0, 8, 9);
  for (let i = 0; i < tamanho; i += 1) { funcao[6][i] = true; funcao[i][6] = true; }
  const centros = ALIGNMENT[versao];
  for (const linha of centros) {
    for (const coluna of centros) {
      const sobreFinder = (linha <= 8 && coluna <= 8) || (linha <= 8 && coluna >= tamanho - 9) || (linha >= tamanho - 9 && coluna <= 8);
      if (!sobreFinder) marca(linha - 2, coluna - 2, 5, 5);
    }
  }
  if (versao >= 7) { marca(0, tamanho - 11, 6, 3); marca(tamanho - 11, 0, 3, 6); }
  return funcao;
}

const MASCARAS = [
  (i, j) => (i + j) % 2 === 0, (i) => i % 2 === 0, (i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0, (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0, (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

// Lê a informação de formato pela cópia 2 (a partida entre os finders da direita e de baixo),
// de propósito: a cópia 1 é a que o gerador monta primeiro, então usar a outra confere as duas.
function leFormato(modulos) {
  const n = modulos.length;
  let bits = 0;
  for (let i = 0; i < 8; i += 1) bits |= modulos[8][n - 1 - i] << i;
  for (let i = 8; i < 15; i += 1) bits |= modulos[n - 15 + i][8] << i;
  const semMascara = bits ^ 0x5412;
  // Confere o BCH: resto zero significa que os 15 bits são um formato válido.
  let resto = semMascara;
  for (let i = 14; i >= 10; i -= 1) if ((resto >> i) & 1) resto ^= 0x537 << (i - 10);
  return { nivel: (semMascara >> 13) & 0b11, mascara: (semMascara >> 10) & 0b111, valido: resto === 0 };
}

// Percorre o ziguezague na mesma ordem do gerador e devolve os codewords já sem máscara.
function leCodewords(modulos, funcao, mascara) {
  const n = modulos.length;
  const bits = [];
  let subindo = true;
  for (let colunaDireita = n - 1; colunaDireita > 0; colunaDireita -= 2) {
    if (colunaDireita === 6) colunaDireita -= 1;
    for (let passo = 0; passo < n; passo += 1) {
      const linha = subindo ? n - 1 - passo : passo;
      for (const coluna of [colunaDireita, colunaDireita - 1]) {
        if (funcao[linha][coluna]) continue;
        const valor = modulos[linha][coluna];
        bits.push(MASCARAS[mascara](linha, coluna) ? valor ^ 1 : valor);
      }
    }
    subindo = !subindo;
  }
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  return codewords;
}

// Desfaz a intercalação e devolve os blocos (dados + correção), do jeito que um leitor faz.
function desintercala(codewords, versao) {
  const { ec, grupos } = BLOCOS_M[versao];
  const tamanhos = grupos.flatMap(([quantos, porBloco]) => new Array(quantos).fill(porBloco));
  const blocos = tamanhos.map(() => ({ dados: [], ec: [] }));
  const maior = Math.max(...tamanhos);
  let p = 0;
  for (let i = 0; i < maior; i += 1) {
    for (let b = 0; b < blocos.length; b += 1) if (i < tamanhos[b]) blocos[b].dados.push(codewords[p++]);
  }
  for (let i = 0; i < ec; i += 1) {
    for (let b = 0; b < blocos.length; b += 1) blocos[b].ec.push(codewords[p++]);
  }
  return blocos;
}

// Síndromes: pra um bloco íntegro, todas dão zero. É o mesmo cálculo que o leitor do celular
// faz pra decidir se precisa corrigir alguma coisa.
function sindromesZeradas(bloco, quantidadeEc) {
  const todos = [...bloco.dados, ...bloco.ec];
  for (let i = 0; i < quantidadeEc; i += 1) {
    let valor = 0;
    for (const byte of todos) valor = mul(valor, EXP[i]) ^ byte;
    if (valor !== 0) return false;
  }
  return true;
}

function leTexto(blocos, versao) {
  const dados = blocos.flatMap((bloco) => bloco.dados);
  const bits = dados.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (byte >> i) & 1));
  let p = 0;
  const pega = (quantos) => { let v = 0; for (let i = 0; i < quantos; i += 1) v = (v << 1) | bits[p++]; return v; };
  const modo = pega(4);
  if (modo !== 0b0100) return { erro: `modo ${modo.toString(2)} (esperado byte 0100)` };
  const quantidade = pega(versao >= 10 ? 16 : 8);
  const bytes = [];
  for (let i = 0; i < quantidade; i += 1) bytes.push(pega(8));
  return { texto: new TextDecoder().decode(new Uint8Array(bytes)) };
}

function decodifica(modulos) {
  const n = modulos.length;
  const versao = (n - 17) / 4;
  const formato = leFormato(modulos);
  if (!formato.valido) return { erro: 'informação de formato inválida (BCH não fecha)' };
  if (formato.nivel !== 0b00) return { erro: `nível de correção ${formato.nivel} (esperado M = 00)` };
  const funcao = mapaDeFuncao(n, versao);
  const codewords = leCodewords(modulos, funcao, formato.mascara);
  const blocos = desintercala(codewords, versao);
  const { ec } = BLOCOS_M[versao];
  for (const bloco of blocos) if (!sindromesZeradas(bloco, ec)) return { erro: 'correção de erro não fecha (síndrome diferente de zero)' };
  return { ...leTexto(blocos, versao), versao, mascara: formato.mascara };
}

// --- Verificações ---------------------------------------------------------------------------
const casos = [
  'https://escola.exemplo.com.br/painel/alunos?checkin=ESC-ND3-RJY',
  checkInCodeFor('11111111-aaaa-4bbb-8ccc-000000000001'),
  'A',
  'abc',
  'x'.repeat(12),
  'x'.repeat(13),
  'x'.repeat(14),
  'x'.repeat(60),
  'x'.repeat(100),
  'x'.repeat(150),
  'Ação, acentuação e ç — UTF-8 no QR da escola',
];

let lidos = 0;
for (const texto of casos) {
  const modulos = qrMatrix(texto);
  const lido = modulos ? decodifica(modulos) : { erro: 'não coube nas versões suportadas' };
  const ok = lido.texto === texto;
  if (ok) lidos += 1;
  else console.error(`FALHOU  ler de volta ${JSON.stringify(texto.slice(0, 30))}\n        ${lido.erro || `saiu ${JSON.stringify(String(lido.texto).slice(0, 40))}`}`);
}
check(`todos os ${casos.length} QR leem de volta o texto exato`, lidos === casos.length, `${lidos} de ${casos.length}`);

// Estrutura: o que o leitor procura primeiro na imagem.
const modulos = qrMatrix('https://escola.exemplo.com.br/painel/alunos?checkin=ESC-ND3-RJY');
const n = modulos.length;
check('o tamanho corresponde a uma versão válida', (n - 17) % 4 === 0 && (n - 17) / 4 >= 1 && (n - 17) / 4 <= 10, `${n}x${n}`);
const olhoOk = (l, c) => {
  for (let i = -1; i < 8; i += 1) {
    for (let j = -1; j < 8; j += 1) {
      const linha = l + i;
      const coluna = c + j;
      if (linha < 0 || coluna < 0 || linha >= n || coluna >= n) continue;
      const anel = Math.max(Math.abs(i - 3), Math.abs(j - 3));
      const esperado = anel === 2 || anel > 3 ? 0 : 1;
      if (modulos[linha][coluna] !== esperado) return false;
    }
  }
  return true;
};
check('os três finder patterns estão certos, com o separador em volta', olhoOk(0, 0) && olhoOk(0, n - 7) && olhoOk(n - 7, 0));
let timingOk = true;
for (let i = 8; i < n - 8; i += 1) if (modulos[6][i] !== (i % 2 === 0 ? 1 : 0) || modulos[i][6] !== (i % 2 === 0 ? 1 : 0)) timingOk = false;
check('os timing patterns alternam corretamente', timingOk);
check('o módulo escuro fixo está no lugar', modulos[4 * ((n - 17) / 4) + 9][8] === 1);

// Correção de erro de verdade: sujar módulos tem que quebrar as síndromes. Se não quebrasse,
// os bytes de correção seriam enfeite e um QR meio apagado passaria como válido.
const sujo = modulos.map((linha) => [...linha]);
const funcao = mapaDeFuncao(n, (n - 17) / 4);
let sujados = 0;
for (let i = 0; i < n && sujados < 3; i += 1) {
  for (let j = 0; j < n && sujados < 3; j += 1) {
    if (!funcao[i][j]) { sujo[i][j] ^= 1; sujados += 1; }
  }
}
check('sujar módulos de dados faz a correção de erro acusar', decodifica(sujo).erro === 'correção de erro não fecha (síndrome diferente de zero)', JSON.stringify(decodifica(sujo)));

// A margem clara de 4 módulos é exigida pela norma: sem ela, muita câmera não enxerga o código.
const path = qrSvgPath(modulos);
check('o SVG deixa a margem clara de 4 módulos', qrSvgSize(modulos) === n + 8);
check('o SVG desenha um retângulo por módulo escuro', (path.match(/M/g) || []).length === modulos.flat().filter(Boolean).length);
check('nenhum módulo do SVG cai fora da área desenhada', [...path.matchAll(/M(\d+) (\d+)h/g)].every(([, x, y]) => Number(x) >= 4 && Number(y) >= 4 && Number(x) < n + 4 && Number(y) < n + 4));

// Texto grande demais devolve null em vez de gerar um QR quebrado.
check('texto que não cabe devolve null, sem inventar um QR inválido', qrMatrix('x'.repeat(400)) === null);

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) do QR falharam.`);
  process.exit(1);
}
console.log('\nQR do check-in: todos leem de volta o texto exato, com correção de erro conferida.');
