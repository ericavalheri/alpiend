// Gerador de QR Code, só o pedaço que a a escola usa: modo byte, correção de erro nível M,
// versões 1 a 10 (dá conta de uma URL de até ~200 caracteres). Escrito aqui, sem biblioteca,
// porque o projeto tem uma lista curta de dependências de propósito e o conteúdo do nosso QR é
// sempre o mesmo formato — não vale puxar uma árvore de pacotes pra isso.
//
// Confiar num QR escrito à mão é arriscado, então a saída é conferida módulo a módulo contra
// uma implementação de referência em scripts-check-qrcode.mjs: qualquer diferença de um único
// pontinho reprova o teste. Se um dia isso falhar, o certo é trocar por uma biblioteca, não
// "consertar" no olho.
//
// Referência: ISO/IEC 18004. Nomes em inglês onde são termos da norma (finder, timing,
// alignment, mask) pra facilitar quem for comparar com a especificação.

// Por versão (1..10), nível M: bytes de correção por bloco, e como os dados se dividem em
// blocos. Duas "turmas" de blocos porque a norma permite blocos de tamanhos diferentes.
const BLOCOS_M = {
  1: { ecPorBloco: 10, grupos: [[1, 16]] },
  2: { ecPorBloco: 16, grupos: [[1, 28]] },
  3: { ecPorBloco: 26, grupos: [[1, 44]] },
  4: { ecPorBloco: 18, grupos: [[2, 32]] },
  5: { ecPorBloco: 24, grupos: [[2, 43]] },
  6: { ecPorBloco: 16, grupos: [[4, 27]] },
  7: { ecPorBloco: 18, grupos: [[4, 31]] },
  8: { ecPorBloco: 22, grupos: [[2, 38], [2, 39]] },
  9: { ecPorBloco: 22, grupos: [[3, 36], [2, 37]] },
  10: { ecPorBloco: 26, grupos: [[4, 43], [1, 44]] },
};

// Centros dos alignment patterns (os quadradinhos menores que ajudam a câmera a corrigir
// distorção). A versão 1 não tem nenhum.
const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// --- Aritmética de Galois GF(256), base da correção de erro Reed-Solomon -------------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // polinômio primitivo da norma
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function polinomioGerador(grau) {
  let poly = [1];
  for (let i = 0; i < grau; i += 1) {
    const proximo = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      proximo[j] ^= poly[j];
      proximo[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = proximo;
  }
  return poly;
}

function bytesDeCorrecao(dados, quantidade) {
  const gerador = polinomioGerador(quantidade);
  const resto = new Array(quantidade).fill(0);
  for (const byte of dados) {
    const fator = byte ^ resto[0];
    resto.shift();
    resto.push(0);
    if (fator !== 0) {
      for (let i = 0; i < quantidade; i += 1) resto[i] ^= gfMul(gerador[i + 1], fator);
    }
  }
  return resto;
}

// --- Codificação dos dados ----------------------------------------------------------------
function bytesDoTexto(texto) {
  return Array.from(new TextEncoder().encode(String(texto)));
}

function capacidadeDeDados(versao) {
  const { grupos } = BLOCOS_M[versao];
  return grupos.reduce((total, [blocos, porBloco]) => total + blocos * porBloco, 0);
}

function menorVersaoQueCabe(quantidadeDeBytes) {
  for (let versao = 1; versao <= 10; versao += 1) {
    // 4 bits de modo + 8 bits de contagem (versões 1..9) ou 16 bits (versão 10).
    const bitsDeCabecalho = 4 + (versao >= 10 ? 16 : 8);
    if (Math.ceil((bitsDeCabecalho + quantidadeDeBytes * 8) / 8) <= capacidadeDeDados(versao)) return versao;
  }
  return 0;
}

function montaCodewords(texto, versao) {
  const dados = bytesDoTexto(texto);
  const bits = [];
  const empurra = (valor, quantos) => { for (let i = quantos - 1; i >= 0; i -= 1) bits.push((valor >> i) & 1); };
  empurra(0b0100, 4);                       // modo byte
  empurra(dados.length, versao >= 10 ? 16 : 8);
  for (const byte of dados) empurra(byte, 8);

  const capacidade = capacidadeDeDados(versao) * 8;
  for (let i = 0; i < 4 && bits.length < capacidade; i += 1) bits.push(0); // terminador
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((valor, bit) => (valor << 1) | bit, 0));
  }
  // Preenchimento até encher a versão, alternando os dois bytes que a norma manda.
  const enchimento = [0xec, 0x11];
  for (let i = 0; codewords.length < capacidade / 8; i += 1) codewords.push(enchimento[i % 2]);
  return codewords;
}

// Os blocos são intercalados: primeiro byte de cada bloco, depois o segundo de cada, e assim
// por diante. Sem isso, um borrão no papel derrubaria um bloco inteiro em vez de um byte de cada.
function intercala(codewords, versao) {
  const { ecPorBloco, grupos } = BLOCOS_M[versao];
  const blocos = [];
  let posicao = 0;
  for (const [quantidade, porBloco] of grupos) {
    for (let i = 0; i < quantidade; i += 1) {
      const dados = codewords.slice(posicao, posicao + porBloco);
      posicao += porBloco;
      blocos.push({ dados, ec: bytesDeCorrecao(dados, ecPorBloco) });
    }
  }
  const saida = [];
  const maiorBloco = Math.max(...blocos.map((bloco) => bloco.dados.length));
  for (let i = 0; i < maiorBloco; i += 1) {
    for (const bloco of blocos) if (i < bloco.dados.length) saida.push(bloco.dados[i]);
  }
  for (let i = 0; i < ecPorBloco; i += 1) {
    for (const bloco of blocos) saida.push(bloco.ec[i]);
  }
  return saida;
}

// --- Desenho da matriz --------------------------------------------------------------------
function matrizVazia(tamanho) {
  return { modulos: Array.from({ length: tamanho }, () => new Array(tamanho).fill(0)), reservado: Array.from({ length: tamanho }, () => new Array(tamanho).fill(false)) };
}

function desenhaQuadrado(matriz, linha, coluna, tamanho, desenho) {
  for (let i = 0; i < tamanho; i += 1) {
    for (let j = 0; j < tamanho; j += 1) {
      const l = linha + i;
      const c = coluna + j;
      if (l < 0 || c < 0 || l >= matriz.modulos.length || c >= matriz.modulos.length) continue;
      matriz.modulos[l][c] = desenho(i, j);
      matriz.reservado[l][c] = true;
    }
  }
}

function desenhaEstrutura(matriz, versao) {
  const tamanho = matriz.modulos.length;
  // Finder patterns (os três olhos) mais o separador branco de 1 módulo em volta.
  const finder = (i, j) => {
    const di = Math.max(Math.abs(i - 3), Math.abs(j - 3));
    return di === 2 || di > 3 ? 0 : 1;
  };
  for (const [linha, coluna] of [[0, 0], [0, tamanho - 7], [tamanho - 7, 0]]) {
    desenhaQuadrado(matriz, linha - 1, coluna - 1, 9, (i, j) => finder(i - 1, j - 1));
  }
  // Timing patterns: a linha e a coluna pontilhadas que dão a escala.
  for (let i = 8; i < tamanho - 8; i += 1) {
    matriz.modulos[6][i] = i % 2 === 0 ? 1 : 0;
    matriz.reservado[6][i] = true;
    matriz.modulos[i][6] = i % 2 === 0 ? 1 : 0;
    matriz.reservado[i][6] = true;
  }
  // Alignment patterns, menos os que cairiam por cima dos finders.
  const centros = ALIGNMENT[versao];
  for (const linha of centros) {
    for (const coluna of centros) {
      const sobreFinder = (linha <= 8 && coluna <= 8) || (linha <= 8 && coluna >= tamanho - 9) || (linha >= tamanho - 9 && coluna <= 8);
      if (sobreFinder) continue;
      desenhaQuadrado(matriz, linha - 2, coluna - 2, 5, (i, j) => (Math.max(Math.abs(i - 2), Math.abs(j - 2)) === 1 ? 0 : 1));
    }
  }
  // Módulo escuro fixo e as áreas reservadas pro formato.
  matriz.modulos[4 * versao + 9][8] = 1;
  matriz.reservado[4 * versao + 9][8] = true;
  for (let i = 0; i < 9; i += 1) {
    if (!matriz.reservado[8][i]) { matriz.reservado[8][i] = true; matriz.modulos[8][i] = 0; }
    if (!matriz.reservado[i][8]) { matriz.reservado[i][8] = true; matriz.modulos[i][8] = 0; }
  }
  for (let i = 0; i < 8; i += 1) {
    matriz.reservado[8][tamanho - 1 - i] = true;
    matriz.reservado[tamanho - 1 - i][8] = true;
  }
  // Informação de versão (só da versão 7 pra cima).
  if (versao >= 7) {
    const bits = bchVersao(versao);
    for (let i = 0; i < 18; i += 1) {
      const bit = (bits >> i) & 1;
      const linha = Math.floor(i / 3);
      const coluna = tamanho - 11 + (i % 3);
      matriz.modulos[linha][coluna] = bit;
      matriz.reservado[linha][coluna] = true;
      matriz.modulos[coluna][linha] = bit;
      matriz.reservado[coluna][linha] = true;
    }
  }
}

function bchFormato(dados) {
  let valor = dados << 10;
  for (let i = 14; i >= 10; i -= 1) if ((valor >> i) & 1) valor ^= 0x537 << (i - 10);
  return ((dados << 10) | valor) ^ 0x5412;
}

function bchVersao(versao) {
  let valor = versao << 12;
  for (let i = 17; i >= 12; i -= 1) if ((valor >> i) & 1) valor ^= 0x1f25 << (i - 12);
  return (versao << 12) | valor;
}

function escreveFormato(matriz, mascara) {
  const tamanho = matriz.modulos.length;
  const bits = bchFormato((0b00 << 3) | mascara); // 00 = nível M
  // Ordem exata da norma. Trocar linha por coluna aqui foi o erro que a conferência contra a
  // implementação de referência pegou na primeira versão deste arquivo: o QR ficava com quatro
  // pontinhos diferentes, o suficiente pra câmera não ler.
  for (let i = 0; i < 15; i += 1) {
    const bit = (bits >> i) & 1;
    // Cópia 1: coluna 8 descendo, depois linha 8 voltando — em volta do finder de cima à esquerda.
    if (i < 6) matriz.modulos[i][8] = bit;
    else if (i === 6) matriz.modulos[7][8] = bit;
    else if (i === 7) matriz.modulos[8][8] = bit;
    else if (i === 8) matriz.modulos[8][7] = bit;
    else matriz.modulos[8][14 - i] = bit;
    // Cópia 2: partida entre os outros dois finders, pra sobreviver a um dano local. Aqui a
    // ordem é a inversa da cópia 1 — os 8 bits baixos na linha 8 à direita, os 7 altos na
    // coluna 8 embaixo, pulando o módulo escuro fixo que fica logo acima deles.
    if (i < 8) matriz.modulos[8][tamanho - 1 - i] = bit;
    else matriz.modulos[tamanho - 15 + i][8] = bit;
  }
}

const MASCARAS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

// Coloca os bits de dados em ziguezague, de baixo pra cima, em pares de colunas, pulando a
// coluna do timing pattern.
function preencheDados(matriz, codewords, mascara) {
  const tamanho = matriz.modulos.length;
  let bitIndex = 0;
  const proximoBit = () => {
    const posicao = bitIndex;
    bitIndex += 1;
    const byte = codewords[posicao >> 3];
    return byte === undefined ? 0 : (byte >> (7 - (posicao & 7))) & 1;
  };
  let subindo = true;
  for (let colunaDireita = tamanho - 1; colunaDireita > 0; colunaDireita -= 2) {
    if (colunaDireita === 6) colunaDireita -= 1; // a coluna 6 é do timing pattern
    for (let passo = 0; passo < tamanho; passo += 1) {
      const linha = subindo ? tamanho - 1 - passo : passo;
      for (const coluna of [colunaDireita, colunaDireita - 1]) {
        if (matriz.reservado[linha][coluna]) continue;
        const bit = proximoBit();
        matriz.modulos[linha][coluna] = MASCARAS[mascara](linha, coluna) ? bit ^ 1 : bit;
      }
    }
    subindo = !subindo;
  }
}

// As quatro penalidades da norma. Servem pra escolher a máscara que deixa o desenho menos
// "listrado" — quanto menor a nota, mais fácil pra câmera.
function penalidade(modulos) {
  const tamanho = modulos.length;
  let total = 0;

  // Regra 1: sequências de 5 ou mais módulos iguais, na horizontal e na vertical.
  for (let i = 0; i < tamanho; i += 1) {
    for (const pegaLinha of [true, false]) {
      let anterior = -1;
      let seguidos = 0;
      for (let j = 0; j < tamanho; j += 1) {
        const valor = pegaLinha ? modulos[i][j] : modulos[j][i];
        if (valor === anterior) seguidos += 1;
        else { if (seguidos >= 5) total += seguidos - 2; anterior = valor; seguidos = 1; }
      }
      if (seguidos >= 5) total += seguidos - 2;
    }
  }

  // Regra 2: blocos 2x2 da mesma cor.
  for (let i = 0; i < tamanho - 1; i += 1) {
    for (let j = 0; j < tamanho - 1; j += 1) {
      const v = modulos[i][j];
      if (v === modulos[i][j + 1] && v === modulos[i + 1][j] && v === modulos[i + 1][j + 1]) total += 3;
    }
  }

  // Regra 3: desenhos parecidos com o finder pattern no meio dos dados.
  const padrao1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const padrao2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < tamanho; i += 1) {
    for (let j = 0; j <= tamanho - 11; j += 1) {
      const linha = modulos[i].slice(j, j + 11);
      const coluna = Array.from({ length: 11 }, (_, k) => modulos[j + k][i]);
      for (const trecho of [linha, coluna]) {
        if (padrao1.every((v, k) => v === trecho[k]) || padrao2.every((v, k) => v === trecho[k])) total += 40;
      }
    }
  }

  // Regra 4: desequilíbrio entre claro e escuro.
  const escuros = modulos.reduce((soma, linha) => soma + linha.reduce((s, v) => s + v, 0), 0);
  const proporcao = (escuros * 100) / (tamanho * tamanho);
  total += Math.floor(Math.abs(proporcao - 50) / 5) * 10;
  return total;
}

// Matriz do QR: array de arrays de 0 (claro) e 1 (escuro). Devolve null se o texto não couber
// nas versões que este gerador cobre — quem chama decide o que mostrar no lugar.
export function qrMatrix(texto) {
  const dados = bytesDoTexto(texto);
  const versao = menorVersaoQueCabe(dados.length);
  if (!versao) return null;
  const codewords = intercala(montaCodewords(texto, versao), versao);
  const tamanho = versao * 4 + 17;

  let melhor = null;
  for (let mascara = 0; mascara < 8; mascara += 1) {
    const matriz = matrizVazia(tamanho);
    desenhaEstrutura(matriz, versao);
    escreveFormato(matriz, mascara);
    preencheDados(matriz, codewords, mascara);
    const nota = penalidade(matriz.modulos);
    if (!melhor || nota < melhor.nota) melhor = { nota, modulos: matriz.modulos };
  }
  return melhor.modulos;
}

// Caminho SVG com todos os módulos escuros, pra desenhar o QR com um <path> só em vez de
// centenas de <rect>. A margem clara de 4 módulos é exigida pela norma: sem ela, muita câmera
// simplesmente não enxerga o código.
export function qrSvgPath(modulos, margem = 4) {
  let d = '';
  for (let i = 0; i < modulos.length; i += 1) {
    for (let j = 0; j < modulos.length; j += 1) {
      if (modulos[i][j]) d += `M${j + margem} ${i + margem}h1v1h-1z`;
    }
  }
  return d;
}

export function qrSvgSize(modulos, margem = 4) {
  return modulos.length + margem * 2;
}
