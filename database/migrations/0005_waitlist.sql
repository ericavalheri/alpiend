-- Lista de espera real (decisão de negócio §16.8 do Manual do produto, 03/09/2026): antes,
-- /lista-de-espera era só um botão de WhatsApp — sem fila, sem ordem, sem aviso automático.
-- Agora quem entra na fila é avisado sozinho (WhatsApp) assim que uma vaga abre de verdade
-- (cancelamento/estorno liberando a vaga — ver releaseClassSeat em lib/db.mjs), por ordem de
-- chegada (FIFO), um aviso por vaga liberada.

create table if not exists waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  course_slug text not null,
  class_date text not null,
  name text not null,
  email text,
  whatsapp text not null,
  status text not null default 'waiting' check (status in ('waiting', 'notified', 'converted', 'cancelled')),
  notified_at timestamptz,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists waitlist_entries_lookup_idx on waitlist_entries (course_slug, class_date, status, created_at);
