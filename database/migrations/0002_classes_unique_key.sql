-- Corrige uma lacuna encontrada ao revisar o schema real: "classes" não tinha nenhuma
-- constraint única em (course_slug, class_date). A reserva atômica de vaga implementada na
-- Fase 1 (reserveClassSeat, regra P0.5 do Manual do produto) faz UPDATE ... WHERE course_slug = $1
-- AND class_date = $2 — se existisse mais de uma linha para a mesma turma, o UPDATE poderia
-- mexer nas duas ao mesmo tempo e a proteção de capacidade ficaria incorreta.
--
-- Este bloco primeiro avisa se já existem duplicatas (e não aplica a constraint nesse caso,
-- para não travar o deploy) — se isso acontecer, as duplicatas precisam ser resolvidas
-- manualmente (decidir qual linha é a "oficial", somar sold_count/reserved_count nela, apagar
-- as demais) antes de rodar esta migration de novo.

do $$
declare
  duplicate_count integer;
begin
  select count(*) into duplicate_count
  from (
    select course_slug, class_date
    from classes
    group by course_slug, class_date
    having count(*) > 1
  ) as dupes;

  if duplicate_count > 0 then
    raise exception 'classes tem % combinação(ões) de course_slug+class_date duplicada(s). Resolva as duplicatas antes de aplicar esta migration (veja o comentário no topo do arquivo).', duplicate_count;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'classes_course_slug_class_date_key'
  ) then
    alter table classes add constraint classes_course_slug_class_date_key unique (course_slug, class_date);
  end if;
end $$;
