-- Baseline: documenta o schema já existente em produção (Supabase/Postgres) em 2026-09-03.
-- Regra P1.10 do Manual do produto: "Ausência do esquema de banco impede reproduzir e validar
-- integridade." Este arquivo não deveria mudar nada ao ser executado contra o banco atual
-- (tudo usa IF NOT EXISTS) — ele existe para que o schema fique versionado no repositório e
-- para permitir recriar um banco de homologação/desenvolvimento do zero.
--
-- Extraído via information_schema em 2026-09-03. Se o banco real divergir deste arquivo no
-- futuro, esta migration NÃO deve ser editada — crie uma nova migration com o ajuste e o motivo
-- (regra de governança da seção 17 do Manual do produto).

create extension if not exists pgcrypto;

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  course_slug text not null,
  class_date text not null,
  option_label text,
  capacity integer not null default 20,
  reserved_count integer not null default 0,
  sold_count integer not null default 0,
  status text not null default 'open',
  price_amount numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  name text not null,
  email text not null,
  whatsapp text,
  cpf_last4 text,
  created_source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists enrollments (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  student_id uuid references students(id),
  course_slug text not null,
  course_name text not null,
  class_date text not null,
  option_label text,
  flow text not null default 'asaas',
  status text not null default 'lead',
  source text,
  campaign text,
  amount_expected numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists carts (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  enrollment_id uuid references enrollments(id),
  student_id uuid references students(id),
  status text not null default 'created',
  coupon_code text,
  total_amount numeric,
  items jsonb not null default '[]'::jsonb,
  attribution jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  enrollment_id uuid references enrollments(id),
  student_id uuid references students(id),
  provider text not null default 'asaas',
  provider_payment_id text,
  method text,
  status text not null default 'created',
  amount numeric,
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'asaas',
  provider_event_id text,
  provider_payment_id text,
  event_type text,
  payment_id uuid references payments(id),
  processed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint payment_events_provider_provider_event_id_key unique (provider, provider_event_id)
);

create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  type text not null,
  value numeric not null,
  status text not null default 'active',
  starts_at timestamptz,
  ends_at timestamptz,
  max_uses integer,
  used_count integer not null default 0,
  course_slug text,
  class_date text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists upsell_offers (
  id uuid primary key default gen_random_uuid(),
  source_course_slug text not null,
  target_course_slug text not null,
  title text not null,
  description text,
  discount_type text,
  discount_value numeric,
  status text not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint upsell_offers_source_course_slug_target_course_slug_key unique (source_course_slug, target_course_slug)
);

create table if not exists acceptances (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  enrollment_id uuid references enrollments(id),
  student_id uuid references students(id),
  course_slug text not null,
  class_date text not null,
  terms_version text not null,
  terms_read boolean not null default false,
  payment_aware boolean not null default false,
  enrollment_aware boolean not null default false,
  wants_contact_before_payment boolean not null default false,
  ip text,
  user_agent text,
  attribution jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists student_access (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references students(id),
  status text not null default 'invited',
  auth_user_id uuid,
  invited_at timestamptz,
  activated_at timestamptz,
  expires_at timestamptz,
  last_access_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists student_certificates (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id),
  enrollment_id uuid references enrollments(id),
  course_slug text not null,
  class_date text,
  title text not null,
  file_path text not null,
  status text not null default 'draft',
  issued_at timestamptz,
  released_at timestamptz,
  released_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists student_notifications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id),
  course_slug text,
  class_date text,
  title text not null,
  message text not null,
  channel text not null default 'app',
  status text not null default 'draft',
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists course_content (
  id uuid primary key default gen_random_uuid(),
  course_slug text not null,
  class_date text,
  title text not null,
  description text,
  content_type text not null,
  file_path text,
  external_url text,
  sort_order integer not null default 0,
  status text not null default 'draft',
  published_at timestamptz,
  created_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agency_demands (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text not null default 'other',
  status text not null default 'received',
  priority text not null default 'normal',
  owner text,
  due_date date,
  waiting_for text,
  delivery_url text,
  client_visible boolean not null default true,
  sort_order bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  approved_at timestamptz,
  approval_note text
);

create table if not exists crm_activities (
  id uuid primary key default gen_random_uuid(),
  lead_key text not null,
  activity_type text not null,
  status text not null default 'open',
  note text,
  owner text,
  course text,
  phone text,
  email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists tracking_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  student_id uuid references students(id),
  enrollment_id uuid references enrollments(id),
  session_id text,
  url text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists testimonials (
  id uuid primary key default gen_random_uuid(),
  student_name text not null,
  course_slug text not null,
  course_name text not null,
  rating smallint not null,
  text text not null,
  photo_url text not null,
  status text not null default 'approved',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
