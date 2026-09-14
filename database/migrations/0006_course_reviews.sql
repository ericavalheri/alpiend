-- Avaliação de curso dentro da Minha Área (pedido da Erica, 04/09/2026): a aluna avalia o
-- curso que concluiu e ganha o selo "course_review" (cadastre o benefício dele em
-- Operação > Selos e benefícios). Só quem tem matrícula concluída (certificado liberado ou
-- status de conclusão) pode avaliar, e só uma vez por matrícula — ver createCourseReview em
-- lib/db.mjs, que confere isso no servidor antes de gravar aqui.

create table if not exists course_reviews (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  course_slug text not null,
  course_name text not null,
  rating smallint not null check (rating between 1 and 5),
  text text not null check (char_length(text) between 10 and 1200),
  created_at timestamptz not null default now(),
  unique (enrollment_id)
);

create index if not exists course_reviews_course_idx on course_reviews (course_slug, created_at desc);
