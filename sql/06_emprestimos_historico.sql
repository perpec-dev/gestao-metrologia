-- =====================================================================
-- 06_emprestimos_historico.sql · Gestão de Metrologia · Perpec Oilfield
--
-- MIGRAÇÃO para um banco que JÁ ESTÁ RODANDO.
-- Instalação nova não precisa deste arquivo: 01_schema.sql já cria as
-- colunas novas e 03_views.sql já cria a view de histórico.
--
-- COMO RODAR (SQL Editor do Supabase, nesta ordem):
--   1) este arquivo    -> cria as colunas que faltavam
--   2) 02_rls.sql      -> tira o UPDATE direto em movimentacoes
--   3) 03_views.sql    -> cria vw_emprestimos_historico e a nova RPC
--
-- Rodar de novo não faz mal: tudo aqui é idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. COLUNAS DE DEVOLUÇÃO
--
-- Até aqui a devolução guardava só data e observação. Faltava o outro
-- lado da entrega: quem recebeu o instrumento de volta e qual usuário
-- do sistema registrou isso. Sem esses dois campos o histórico responde
-- "quando voltou", mas não "com quem foi acertado" — que é exatamente
-- a pergunta que aparece quando o instrumento volta danificado.
-- ---------------------------------------------------------------------
alter table public.movimentacoes
  add column if not exists recebido_por        text,
  add column if not exists devolvido_por_email text;

comment on column public.movimentacoes.recebido_por is
  'Quem da Metrologia recebeu o instrumento de volta.';
comment on column public.movimentacoes.devolvido_por_email is
  'Usuário do sistema que registrou a devolução.';

-- ---------------------------------------------------------------------
-- 2. CONFERÊNCIA
-- ---------------------------------------------------------------------
do $$
declare v_cols int;
begin
  select count(*) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'movimentacoes'
     and column_name in ('recebido_por','devolvido_por_email');

  if v_cols = 2 then
    raise notice 'Colunas prontas. Agora rode 02_rls.sql e depois 03_views.sql.';
  else
    raise warning 'Algo deu errado: esperava 2 colunas novas, encontrei %.', v_cols;
  end if;
end $$;

-- =====================================================================
-- DIAGNÓSTICO — descomente quando algo não bater
-- =====================================================================
-- -- Histórico completo, do mais recente para o mais antigo:
-- select tag, responsavel, setor, tipo, data_saida, data_retorno,
--        dias_fora, em_aberto, fora_do_prazo
--   from public.vw_emprestimos_historico
--  order by data_saida desc limit 50;
--
-- -- Quem mais leva instrumento, e quanto tempo costuma segurar:
-- select responsavel, setor, count(*) as saidas,
--        round(avg(dias_fora), 1) as media_dias,
--        count(*) filter (where fora_do_prazo) as fora_do_prazo
--   from public.vw_emprestimos_historico
--  group by responsavel, setor order by saidas desc;
--
-- -- Instrumentos que mais circulam:
-- select tag, descricao, count(*) as saidas, max(data_saida) as ultima
--   from public.vw_emprestimos_historico
--  group by tag, descricao order by saidas desc limit 20;
