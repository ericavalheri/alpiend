-- Catálogo de benefícios por selo (decisão de negócio §16.7 do Manual do produto, 03/09/2026):
-- a a escola ainda não tem uma regra fechada de "qual selo dá qual benefício" — cada selo pode dar
-- desconto progressivo, aula online gratuita, vivência/visita, brinde etc., e isso muda com o
-- tempo. Em vez de hardcodar essas regras no código, elas ficam numa tabela editável pelo
-- painel: a equipe cadastra/ajusta o benefício de cada selo sem precisar de deploy.
--
-- badge_key é o mesmo identificador usado em students.metadata.studentBadges.missions (ex.:
-- 'new_course', 'class_attendance', ou uma chave livre criada pela equipe pra um selo custom).

create table if not exists badge_benefits (
  id uuid primary key default gen_random_uuid(),
  badge_key text not null unique,
  badge_label text not null,
  benefit_type text not null default 'other' check (benefit_type in ('discount_percent', 'free_class', 'experience', 'gift', 'other')),
  benefit_detail text,
  discount_percent numeric,
  status text not null default 'active' check (status in ('active', 'archived')),
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
