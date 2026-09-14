// Imagens da marca e dos parceiros. PREENCHA com o material desta escola.
//
// Os campos vazios fazem o site cair no fallback (SafeImage esconde imagem que não carrega),
// então nada quebra enquanto o material não chega — mas o site fica sem identidade visual.

export const brand = {
  logo: '/assets/marca/logo-alpiend.png',
  school: '',    // opcional — foto da escola, usada na home
  school2: '',   // opcional
  school3: '',   // opcional
};

// Marcas parceiras exibidas na home. Deixe [] se a escola não tiver parcerias a exibir —
// nunca reaproveite os parceiros de outra escola, é relação comercial dela, não sua.
export const partnerLogos = [
  // { src: '/assets/parceiros/logos/exemplo.png', name: 'Nome do Parceiro' },
];

// Capa por curso, quando a arte não estiver no próprio catálogo.
// A chave é o slug do curso em src/catalog.js.
export const courseImageBySlug = {
  // 'curso-exemplo': '/assets/cursos/exemplo.webp',
};
