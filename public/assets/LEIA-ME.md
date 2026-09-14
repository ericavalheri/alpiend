# Imagens do projeto

O que sobrou aqui é reaproveitável entre clientes. O que era da escola anterior — fotos de
instrutores, logos de parceiros comerciais, artes de curso, logo e favicon — foi removido de
propósito: material de um cliente não vai para o site de outro.

## O que ficou

- `minha-area/` — personagens da jornada da aluna. Ilustrações genéricas, sem marca.
- `cursos/` — **vazio**. Coloque aqui a capa de cada curso e aponte em `src/catalog.js`.
- `instrutores/` — **vazio**. Foto de quem ensina, apontada em `mentorPhoto` no catálogo.
- `marca/` — **vazio**. Logo, favicon e ícone do app desta escola.

## O que precisa entrar em `marca/`

| Arquivo | Para quê | Tamanho |
|---|---|---|
| `favicon.svg` | aba do navegador | quadrado, vetor |
| `app-icon-192.png` | ícone do app instalado | 192×192 |
| `app-icon-512.png` | ícone do app instalado | 512×512 |
| `apple-touch-icon.png` | atalho no iPhone | 180×180 |

Depois de colocar os arquivos, aponte os caminhos em `index.html` e em
`public/manifest.webmanifest`.
