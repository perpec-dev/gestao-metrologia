-- =====================================================================
-- 09_revisao3.sql · Gestão de Metrologia · Perpec Oilfield Supply
--
-- MIGRAÇÃO para um banco que JÁ ESTÁ RODANDO.
-- Instalação nova não precisa deste arquivo: 01 a 04 já trazem tudo.
--
-- O que esta revisão muda, item a item:
--   1. A TAG pode entrar declarada. Até aqui o servidor sempre gerava a
--      tag e descartava a que viesse no pedido — migrar o acervo de uma
--      planilha renumerava tudo, e um instrumento etiquetado P-MCE-06
--      entrava como P-MCE-01. A etiqueta colada no instrumento é a fonte
--      da verdade; agora ela é preservada.
--   2. A próxima tag passa a ser o PRIMEIRO NÚMERO LIVRE, e não o maior
--      mais um. A numeração real tem buracos de instrumentos sucateados
--      ao longo dos anos, e nunca reaproveitá-los empurra a numeração
--      para sempre.
--   3. Função nova `tags_livres`, que devolve os N primeiros números
--      livres da família. É ela que alimenta o diálogo em que alguém
--      confirma a tag no cadastro avulso — a confirmação humana é o que
--      substituiu a regra antiga de nunca reaproveitar número, porque um
--      número livre no sistema pode estar colado num instrumento que
--      ninguém cadastrou. Só quem abre a gaveta sabe.
--   4. `criar_instrumento_completo` passa a serializar por
--      família+classificação (advisory lock) e a recusar tag que não
--      descreva a própria família.
--
-- COMO RODAR (SQL Editor do Supabase, nesta ordem):
--   1) 01_schema.sql  -> tags_livres, gerar_tag e criar_instrumento_completo
--   2) 02_rls.sql     -> permissão de execução da função nova
--
-- Este arquivo não tem DDL própria: ele documenta a revisão e traz as
-- conferências abaixo. 03_views.sql e 04_seed.sql não mudaram.
-- Rodar 01 e 02 de novo não faz mal: tudo neles é idempotente.
-- =====================================================================


-- ---------------------------------------------------------------------
-- CONFERÊNCIA 1 — tags que não descrevem a própria família (item 4)
--
-- A partir desta revisão o banco RECUSA uma tag declarada que não case
-- com `{P|PR}-{codigo da familia}-{NN}`. Instrumentos já gravados não são
-- tocados, mas vale saber se existe algum fora do padrão: é ele que vai
-- confundir a conta do próximo número livre da família.
-- Idealmente, lista vazia.
-- ---------------------------------------------------------------------
select i.tag, f.codigo as familia, i.tipo, i.descricao
  from public.instrumentos i
  join public.familias f on f.id = i.familia_id
 where i.tag !~ ('^' || case i.tipo when 'TMMDE' then 'P-' else 'PR-' end
                     || f.codigo || '-[0-9]{2,}$')
 order by f.codigo, i.tag;


-- ---------------------------------------------------------------------
-- CONFERÊNCIA 2 — os buracos de cada família (item 2)
--
-- Mostra, por família e classificação, quais números estão livres abaixo
-- do maior já usado. São exatamente os números que o cadastro avulso
-- passa a oferecer, e que antes ficavam perdidos para sempre.
-- ---------------------------------------------------------------------
with usados as (
  select f.codigo, i.tipo, (regexp_match(i.tag, '-([0-9]+)$'))[1]::int as n
    from public.instrumentos i
    join public.familias f on f.id = i.familia_id
   where i.tag ~ '-[0-9]+$'
),
faixa as (
  select codigo, tipo, count(*) as cadastrados, max(n) as maior_numero
    from usados group by codigo, tipo
)
select r.codigo, r.tipo, r.cadastrados, r.maior_numero,
       array_agg(g.s order by g.s) as livres
  from faixa r
  cross join lateral generate_series(1, r.maior_numero) as g(s)
 where not exists (select 1 from usados u
                    where u.codigo = r.codigo and u.tipo = r.tipo and u.n = g.s)
 group by r.codigo, r.tipo, r.cadastrados, r.maior_numero
 order by r.codigo, r.tipo;


-- ---------------------------------------------------------------------
-- CONFERÊNCIA 3 — o que o cadastro avulso vai oferecer (item 3)
--
-- Troque o código da família. Deve devolver os cinco primeiros números
-- livres, buracos primeiro. Numa família com 01 a 05 e 07 ocupados, a
-- resposta é {…-06, …-08, …-09, …-10, …-11}.
-- ---------------------------------------------------------------------
select f.codigo,
       public.tags_livres(f.id, 'TMMDE', 5)      as livres_tmmde,
       public.tags_livres(f.id, 'REFERENCIA', 5) as livres_referencia
  from public.familias f
 where f.codigo = 'MCE';
