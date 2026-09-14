# Agenda de matrículas

Plataforma de cursos presenciais: catálogo público, matrícula com contrato assinado, pagamento,
área da aluna, CRM e painel administrativo.

Este projeto nasceu como cópia de um sistema em produção. Os dados da escola anterior foram
removidos e substituídos por campos em branco marcados com `PREENCHER`. **Nenhum CNPJ, endereço,
telefone, link de pagamento, pixel ou logo de outra escola ficou para trás** — e tem um teste que
garante isso a cada execução.

## Comece por aqui

```bash
npm install
npm test
```

O `npm test` é o seu roteiro. Ele separa três coisas:

- **passaram** — o que já está funcionando;
- **ainda não dá para conferir** — testes dormindo à espera de dado que você ainda não preencheu;
- **FALHARAM** — o que precisa de atenção.

No primeiro dia, tudo o que falha é `identidade`, e ele lista exatamente o que falta. Conforme
você preenche, os testes adormecidos acordam sozinhos.

## Ordem de configuração

**1. `src/lib/tenant.js`** — quem é a escola.
Nome, razão social, CNPJ, endereço, contatos, domínio. É o único lugar onde essa informação
mora; no projeto de origem ela estava espalhada por mais de cem arquivos, e foi exatamente
isso que tornou a troca de cliente arriscada.

**2. `src/catalog.js`** — os cursos.
Tem um curso de exemplo comentado campo a campo. Troque pelos reais e apague a linha
`exemplo: true`.

**3. `public/assets/`** — o material visual.
Veja `public/assets/LEIA-ME.md`: logo, favicon, ícones do app, capas dos cursos e fotos de quem
ensina.

**4. `src/lib/contracts.js`** — só se algum curso exigir contrato assinado.
`CLASS_TABLES` traz um modelo comentado. Curso que não aparece ali simplesmente não pede
assinatura, e a matrícula segue o fluxo normal.

**5. `.env.example` → variáveis de ambiente.**
Banco, pagamento, WhatsApp, Meta. Nada de segredo no repositório.

## Duas armadilhas que já custaram caro no projeto de origem

**O preço mostrado é sempre derivado, nunca escrito à mão.** Parcela é o total dividido pelo
número de pagamentos, calculado na hora. Quando esses números eram escritos em cada tela, o site
acabou anunciando a parcela de uma turma no preço de outra — e o contrato assinado saiu com o
valor de matrícula de outra turma.

**Desconto se calcula dividindo, não somando.** Para um preço de pré-venda com 20% de desconto,
o preço cheio é `pré-venda ÷ 0,8`. Multiplicar por 1,2 dá um desconto real de 16,67%, e a página
continua anunciando 20% — que é propaganda enganosa com prova aritmética na mesma tela.

## Estrutura

```
src/           front-end (React + Vite)
  lib/tenant.js      ← identidade da escola, preencher primeiro
  catalog.js         ← cursos
  lib/contracts.js   ← contrato e quadro de turmas
api/           funções serverless (Vercel)
lib/           regras de negócio do servidor
database/      migrations
scripts-check-*.mjs  a suíte de testes
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm start` | sobe o site em desenvolvimento |
| `npm run build` | build de produção |
| `npm test` | roda a suíte inteira com o resumo acima |
| `npm run test:identidade` | só o que falta configurar |
| `npm run admin:hash` | gera o hash da senha do painel |
