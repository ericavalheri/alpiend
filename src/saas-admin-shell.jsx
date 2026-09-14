import React from 'react';

export function SaasAdminShell({ active = '', children }) {
  const links = [
    { key: 'overview', href: '/painel', label: 'Visão geral', icon: '⌂' },
    { key: 'crm', href: '/painel/crm', label: 'CRM e vendas', icon: '◎' },
    { key: 'students', href: '/painel/alunos', label: 'Alunos', icon: '◉' },
    { key: 'demands', href: '/painel/demandas', label: 'Demandas', icon: '✓' },
  ];
  return <div className="saasAdminShell"><aside className="saasAdminSidebar"><a className="saasAdminBrand" href="/painel"><span>a escola</span><div><strong>Gestão</strong><small>Painel administrativo</small></div></a><nav aria-label="Navegação administrativa">{links.map((item) => <a className={active === item.key ? 'active' : ''} href={item.href} key={item.key}><i>{item.icon}</i><span>{item.label}</span></a>)}</nav><div className="saasAdminSidebar__help"><strong>Precisa de ajuda?</strong><span>Consulte os alertas antes de falar com a aluna.</span></div></aside><main className="saasAdminContent">{children}</main></div>;
}
