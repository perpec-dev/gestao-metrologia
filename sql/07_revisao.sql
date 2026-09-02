-- =====================================================================
-- 07_revisao.sql · Gestão de Metrologia · Perpec Oilfield Supply
--
-- MIGRAÇÃO para um banco que JÁ ESTÁ RODANDO.
-- Instalação nova não precisa deste arquivo: 01 a 04 já trazem tudo.
--
-- O que esta revisão muda, item a item:
--   1. Pedido de compra passa a ser pedido na SOLICITAÇÃO da calibração
--      (coluna instrumentos.pedido_calibracao) e viaja até o certificado.
--   3. Instrumento de REFERÊNCIA vira uma classificação de verdade:
--      cadastro enxuto, campo de observações e SEM controle de validade.
--   4. Instrumento inativo sai do fluxo de calibração (trava no banco).
--   5. Novos motivos de inativação.
--   6. Vencimento no ÚLTIMO DIA do mês (controle mensal).
--   7. Relação de e-mails por setor, para cobrar devolução.
--
-- COMO RODAR (SQL Editor do Supabase, nesta ordem):
--   1) este arquivo   -> cria colunas, tabela e configurações novas
--   2) 01_schema.sql  -> funções novas (data próxima, status, calibração)
--   3) 02_rls.sql     -> permissões das colunas e da tabela novas
--   4) 03_views.sql   -> view de status com a classificação Referência
--
-- Rodar de novo não faz mal: tudo aqui é idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. COLUNAS NOVAS EM instrumentos
--
-- pedido_calibracao — item 1. O pedido de compra deixa de ser perguntado
--   no fim (ao tornar calibrado, quando o serviço já acabou) e passa a
--   ser perguntado no começo, quando a calibração é solicitada e o
--   pedido de fato existe. Fica guardado aqui até a calibração ser
--   registrada; nesse momento ele é copiado para a calibração e zerado.
--
-- observacoes — item 3. O padrão de referência tem cadastro enxuto:
--   o que não cabe em fabricante/série/descrição cabe aqui.
-- ---------------------------------------------------------------------
alter table public.instrumentos
  add column if not exists pedido_calibracao text,
  add column if not exists observacoes       text;

comment on column public.instrumentos.pedido_calibracao is
  'Pedido de compra associado na solicitação da calibração. Copiado para calibracoes.pedidos_associados quando a calibração é registrada.';
comment on column public.instrumentos.observacoes is
  'Observações complementares do cadastro. Principal campo livre do instrumento de referência.';

-- ---------------------------------------------------------------------
-- 2. E-MAILS POR SETOR  (item 7)
--
-- Quem cobra a devolução de um instrumento emprestado não é o sistema:
-- é o responsável pelo setor. Esta tabela guarda para onde escrever.
-- Só administrador grava (pela RPC); todo mundo lê, porque o botão de
-- notificar fica disponível também para o metrologista.
-- ---------------------------------------------------------------------
create table if not exists public.setores_email (
  setor                text primary key,
  email                text not null
                       check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  responsavel          text,
  atualizado_em        timestamptz not null default now(),
  atualizado_por_email text
);

comment on table public.setores_email is
  'Para quem a Metrologia escreve quando um empréstimo passa do prazo. Um e-mail por setor.';

-- ---------------------------------------------------------------------
-- 3. CONFIGURAÇÕES NOVAS E ATUALIZADAS
-- ---------------------------------------------------------------------

-- 3.1 Vencimento no último dia do mês (item 6).
insert into public.config (chave, valor)
values ('vencimento_fim_do_mes', 'sim')
on conflict (chave) do nothing;

-- 3.2 Motivos de inativação (item 5).
--     `on conflict do nothing` não serviria: a chave já existe e a lista
--     ficaria como está. Este bloco ACRESCENTA o que falta e preserva
--     qualquer motivo que a metrologia já tenha criado por conta própria.
do $$
declare
  v_atual text;
  v_lista text[] := '{}';
  v_item  text;
  v_novo  text;
begin
  select valor into v_atual from public.config where chave = 'motivos_inativacao';

  -- 1. Preserva, na ordem, o que a metrologia já tinha.
  foreach v_item in array string_to_array(coalesce(v_atual, ''), ',') loop
    if btrim(v_item) <> '' and lower(btrim(v_item)) <> 'outros' then
      v_lista := v_lista || btrim(v_item);
    end if;
  end loop;

  -- 2. Acrescenta os que faltam, sem duplicar por acento ou caixa.
  foreach v_novo in array array['Sucateado','Vago','Não entregue','Danificado',
                                'Não encontrado','Necessário manutenção'] loop
    if not exists (select 1 from unnest(v_lista) a where lower(a) = lower(v_novo)) then
      v_lista := v_lista || v_novo;
    end if;
  end loop;

  -- 3. "Outros" sempre por último: é a saída de emergência da lista,
  --    não a primeira opção — e é a única que exige descrever a
  --    segregação do instrumento na justificativa.
  v_lista := v_lista || 'Outros'::text;

  insert into public.config (chave, valor)
  values ('motivos_inativacao', array_to_string(v_lista, ','))
  on conflict (chave) do update set valor = excluded.valor;

  raise notice 'Motivos de inativação: %', array_to_string(v_lista, ',');
end $$;

-- ---------------------------------------------------------------------
-- 4. AVISAR O POSTGREST
--     Colunas e funções novas só aparecem para a API depois que o cache
--     de esquema recarrega. Sem isto, a tela recebe "column does not
--     exist" por alguns minutos e parece que a migração falhou.
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 5. CONFERÊNCIA
-- ---------------------------------------------------------------------
do $$
declare v_cols int; v_tab int; v_cfg int;
begin
  select count(*) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'instrumentos'
     and column_name in ('pedido_calibracao','observacoes');

  select count(*) into v_tab
    from information_schema.tables
   where table_schema = 'public' and table_name = 'setores_email';

  select count(*) into v_cfg
    from public.config where chave in ('vencimento_fim_do_mes','motivos_inativacao');

  if v_cols = 2 and v_tab = 1 and v_cfg = 2 then
    raise notice 'Estrutura pronta. Agora rode 01_schema.sql, 02_rls.sql e 03_views.sql, nesta ordem.';
  else
    raise warning 'Faltou algo: colunas=% (esperado 2), tabela=% (esperado 1), config=% (esperado 2).',
      v_cols, v_tab, v_cfg;
  end if;
end $$;

-- =====================================================================
-- 6. OPCIONAL — REAJUSTAR OS VENCIMENTOS QUE JÁ EXISTEM
--
-- A regra do fim do mês (item 6) vale automaticamente para as PRÓXIMAS
-- calibrações registradas. O acervo que já está no banco continua com o
-- vencimento no dia exato até ser recalibrado — o que, com periodicidade
-- de 12 meses, significa um ano de datas em dois padrões diferentes.
--
-- Este bloco alinha o que já existe. NÃO roda sozinho, de propósito:
-- reescrever data de validade de calibração em massa é o tipo de coisa
-- que uma auditoria pergunta, e a decisão é da metrologia, não da
-- migração.
--
-- O ajuste só empurra a data para a frente, sempre dentro do MESMO mês:
-- nenhum instrumento vence mais cedo do que vence hoje. Alguns vencidos
-- há poucos dias voltam a ficar válidos até o fim do mês — que é
-- exatamente o que a regra nova diz.
--
-- Só a ÚLTIMA calibração de cada instrumento é recalculada: é ela que
-- manda no status. As anteriores ficam como estão, porque são histórico.
--
-- PASSO 1 — confira o que mudaria (só leitura, pode rodar à vontade):
/*
select i.tag, i.descricao, c.data_calibracao,
       c.data_proxima                                              as vence_hoje,
       public.calcular_data_proxima(c.instrumento_id, c.data_calibracao, c.standby_apos) as passaria_a_vencer
  from public.calibracoes c
  join public.instrumentos i on i.id = c.instrumento_id
 where c.id = (select id from public.calibracoes
                where instrumento_id = c.instrumento_id
                order by data_calibracao desc, criado_em desc limit 1)
   and c.data_proxima is distinct from
       public.calcular_data_proxima(c.instrumento_id, c.data_calibracao, c.standby_apos)
 order by i.tag;
*/
--
-- PASSO 2 — se concordar com a lista acima, descomente e rode:
/*
update public.calibracoes c
   set data_proxima = public.calcular_data_proxima(
         c.instrumento_id, c.data_calibracao, c.standby_apos)
 where c.id = (select id from public.calibracoes
                where instrumento_id = c.instrumento_id
                order by data_calibracao desc, criado_em desc limit 1);
*/
-- =====================================================================

-- =====================================================================
-- DIAGNÓSTICO — descomente quando algo não bater
-- =====================================================================
-- -- Item 6: o que cada instrumento venceria se fosse calibrado hoje.
-- --         Com 'vencimento_fim_do_mes' ligado, toda data cai no dia 28/29/30/31.
-- select tag, descricao,
--        public.calcular_data_proxima(id, current_date, false) as venceria_em
--   from public.instrumentos where tipo = 'TMMDE' order by tag;
--
-- -- Item 3: referências não têm data de vencimento nem status de calibração.
-- select tag, descricao, tipo, status_efetivo, data_proxima
--   from public.vw_instrumentos_status where tipo = 'REFERENCIA' order by tag;
--
-- -- Item 1: pedidos aguardando a calibração voltar.
-- select tag, descricao, status_workflow, pedido_calibracao
--   from public.instrumentos where pedido_calibracao is not null order by tag;
--
-- -- Item 7: setores com empréstimo em aberto e sem e-mail cadastrado.
-- select distinct a.setor
--   from public.vw_emprestimos_abertos a
--   left join public.setores_email e on e.setor = a.setor
--  where e.setor is null;
