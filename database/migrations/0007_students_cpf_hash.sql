-- Unificação de cadastro por CPF (pedido da Erica, 04/09/2026): antes, o mesmo CPF em duas
-- compras com email/WhatsApp diferentes gerava dois cadastros de aluna separados (e a
-- matrícula/selo de uma delas sumia da Minha Área). Guardamos só um hash do CPF completo, nunca
-- o CPF em si (mesma minimização de dados do cpf_last4) — ver hashCpf/findOrCreateStudent em
-- lib/db.mjs. Só passa a valer daqui pra frente: cadastros antigos ganham o hash na próxima
-- vez que a aluna fizer uma matrícula/compra informando o CPF de novo.

alter table students add column if not exists cpf_hash text;

create index if not exists students_cpf_hash_idx on students (cpf_hash) where cpf_hash is not null;
