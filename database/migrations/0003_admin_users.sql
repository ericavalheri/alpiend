-- Usuários administrativos individuais com papel/permissão (regra P1.7/13 do Manual do produto).
-- Hoje o painel admin usa uma única senha compartilhada (ADMIN_PASSWORD_HASH) sem identidade
-- nem trilha de quem fez o quê. Esta tabela substitui isso por usuários reais.

create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  name text not null,
  role text not null check (role in ('owner', 'comercial', 'atendimento', 'academico', 'marketing')),
  password_hash text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Depois de rodar esta migration, crie o primeiro usuário (owner) rodando localmente:
--   npm run admin:hash -- "uma-senha-com-12-ou-mais-caracteres"
-- e colando o valor de ADMIN_PASSWORD_HASH gerado (começa com pbkdf2_sha256$) no lugar de
-- <HASH_GERADO> abaixo.
--
-- insert into admin_users (username, name, role, password_hash)
-- values ('erica', 'Erica', 'owner', '<HASH_GERADO>');
