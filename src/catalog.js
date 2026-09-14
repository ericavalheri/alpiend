import { tenant } from './lib/tenant.js';

// CATÁLOGO DE CURSOS — PREENCHA COM OS CURSOS DESTA ESCOLA.
//
// Este arquivo é o ponto de partida do catálogo. Em produção, quem manda é a tabela `courses`
// do banco, que a escola edita pelo painel; este arquivo entra enquanto o banco ainda não foi
// sincronizado, e serve de referência de formato.
//
// Fica aqui um único curso de exemplo, com todos os campos preenchidos e comentados. Troque
// pelos cursos de verdade — o exemplo tem `exemplo: true` e o teste de identidade reprova a
// publicação enquanto ele existir, para ninguém subir o site com curso inventado.

const LOCATION = tenant.local;

export const fallbackCourses = [
  {
    // --- identificação ---
    exemplo: true,                       // APAGUE esta linha ao trocar pelo curso real
    slug: 'curso-exemplo',               // vai na URL: /curso/curso-exemplo
    aliases: [],                         // outros slugs que devem levar a este curso
    name: 'Curso Exemplo',
    category: 'Formação',                // rótulo pequeno no card: Formação, Base, Workshop...

    // --- texto de venda ---
    promise: 'Uma frase que diz o que a aluna sai sabendo fazer.',
    long: 'Parágrafo de apresentação do curso, para a página interna. Fale do que a aluna vai aprender e de como as aulas acontecem.',

    // --- quem ensina ---
    mentor: 'Nome do Instrutor',
    mentorTitle: 'Especialidade do instrutor',
    mentorBio: 'Uma ou duas frases sobre a experiência de quem ensina.',
    mentorPhoto: '',                     // opcional — ex.: '/assets/instrutores/nome.webp'
    mentorInstagram: '',                 // opcional — URL completa

    // --- preço ---
    // O parcelamento mostrado é sempre derivado de priceNumber, nunca escrito à mão: foi assim
    // que o projeto de origem acabou anunciando a parcela de uma turma no preço de outra.
    location: LOCATION,
    price: 'R$ 1.200,00',
    priceNumber: 1200,
    installments: '12x R$ 100,00 sem juros',

    // --- turma ---
    status: 'Vagas abertas',
    level: 'Para quem está começando ou quer aperfeiçoar a técnica',
    workload: 'Curso presencial',
    dates: ['10 e 11 de Março de 2027'],
    reservedByDate: { '10 e 11 de Março de 2027': 0 },
    capacity: 18,                        // o site fecha a turma ao atingir este número

    // --- imagens ---
    image: '',                           // capa do card. Ex.: '/assets/cursos/exemplo.webp'
    banner: '',
    mobileBanner: '',

    // --- conteúdo da página ---
    highlights: [
      { title: 'Curso presencial', description: 'Aulas com demonstração e prática real.' },
      { title: 'Material didático', description: 'Todo o material das aulas está incluso.' },
      { title: 'Certificação', description: 'Certificado ao concluir o curso.' },
    ],
    learn: [
      { title: 'Primeiro módulo', description: 'O que a aluna aprende nesta parte.' },
      { title: 'Segundo módulo', description: 'O que a aluna aprende nesta parte.' },
    ],
    forWho: ['Quem está começando', 'Profissionais em evolução'],
  },
];
