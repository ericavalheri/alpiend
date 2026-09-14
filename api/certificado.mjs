// Consulta pública de certificado pelo código do rodapé.
//
// É a resposta à pergunta "esse certificado é de verdade?". Quem abre é quem RECEBEU o
// certificado — um salão conferindo uma candidata, por exemplo —, não a dona dele. Por isso
// não tem login: o próprio código é a chave, e são 32^8 combinações (mais de um trilhão).
//
// Devolve só o que já está impresso no papel: nome, curso, turma, carga horária e data de
// emissão. Nada de e-mail, telefone, CPF ou histórico — quem tem o código não ganha acesso ao
// cadastro da aluna.
import { findCertificateByCode } from '../lib/db.mjs';
import { normalizeCertificateCode } from '../lib/certificates.mjs';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  const code = normalizeCertificateCode(request.query?.code || '');
  if (code.length !== 8) {
    return response.status(400).json({ ok: false, error: 'invalid_code' });
  }
  try {
    const certificate = await findCertificateByCode(code);
    if (!certificate) {
      // 404 com a mesma cara pra código inexistente e pra certificado não liberado: quem está
      // tentando adivinhar código não aprende nada com a diferença.
      return response.status(404).json({ ok: false, error: 'certificate_not_found' });
    }
    return response.status(200).json({ ok: true, certificate });
  } catch (error) {
    console.error('certificate_lookup_failed', error);
    return response.status(500).json({ ok: false, error: 'certificate_lookup_failed' });
  }
}
