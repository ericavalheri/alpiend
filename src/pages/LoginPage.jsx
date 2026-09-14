// Login do painel administrativo. Extraído de src/main.jsx (organização de arquivos
// pedida pela Erica, 05/09/2026).
import { useEffect, useState } from 'react';

export function LoginPage() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next') || '/painel';
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState({ loading: true, configured: false, authenticated: false });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/admin/login', { credentials: 'include' })
      .then((response) => response.json())
      .then((data) => {
        setStatus({ loading: false, configured: !!data.configured, authenticated: !!data.authenticated });
        if (data.authenticated) window.location.href = next;
      })
      .catch(() => setStatus({ loading: false, configured: false, authenticated: false }));
  }, [next]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        const messages = {
          admin_auth_not_configured: 'A senha do painel ainda não foi configurada na Vercel.',
          invalid_credentials: 'Senha inválida.',
          too_many_attempts: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.',
        };
        setError(messages[data.error] || 'Não foi possível entrar no painel.');
        return;
      }
      window.location.href = next;
    } catch {
      setError('Falha de conexão ao validar o acesso.');
    } finally {
      setSubmitting(false);
    }
  }

  return <section className="adminLoginPage"><div className="adminLoginCard"><p className="eyebrow">Área restrita a escola</p><h1>Painel administrativo protegido</h1><p>Entre com a senha administrativa para acessar vendas, alunos, cupons, carrinhos e relatórios da agenda.</p>{status.loading ? <div className="loginNotice">Verificando segurança do painel...</div> : !status.configured ? <div className="loginNotice loginNotice--danger">A autenticação ainda não foi configurada. Por segurança, o painel permanece bloqueado até a criação das variáveis secretas na Vercel.</div> : <form className="adminLoginForm" onSubmit={submit}><label htmlFor="admin-password">Senha do painel<input id="admin-password" name="password" type="password" autoComplete="current-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Digite a senha administrativa" /></label>{error && <div className="loginNotice loginNotice--danger">{error}</div>}<button className="button button--primary" type="submit" disabled={submitting}>{submitting ? 'Validando...' : 'Entrar no painel'}</button></form>}<div className="loginSecurityList"><span>Proteções ativas</span><ul><li>Cookie httpOnly assinado</li><li>Senha validada no servidor</li><li>Bloqueio do /painel sem sessão</li><li>Rate limit básico contra tentativa de senha</li></ul></div></div></section>;
}
