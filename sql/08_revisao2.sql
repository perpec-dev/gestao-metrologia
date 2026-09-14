-- =====================================================================
-- 08_revisao2.sql · Gestão de Metrologia · Perpec Oilfield Supply
--
-- MIGRAÇÃO para um banco que JÁ ESTÁ RODANDO.
-- Instalação nova não precisa deste arquivo: 01 a 04 já trazem tudo.
--
-- O que esta revisão muda, item a item:
--   1. Administrador volta a conseguir salvar os parâmetros do sistema.
--   2. A rastreabilidade da solicitação de calibração vira obrigatória.
--   4. Só instrumento calibrado ou descalibrado pode ser inativado —
--      e nunca enquanto estiver emprestado.
--   6. Certificado obrigatório para tornar um instrumento calibrado.
--   7. Alerta de vencimento passa a olhar até o fim do MÊS QUE VEM.
--   9. View de arquivos: uma "pasta" por equipamento.
--  10. Metrologista passa a inativar e reativar instrumento — quem abre a
--      gaveta e não acha o instrumento precisa registrar isso na hora.
--      Motivo, justificativa e auditoria continuam obrigatórios; APAGAR
--      segue exclusivo do administrador.
--  11. Remover (ou substituir) arquivo da pasta do instrumento, com
--      justificativa obrigatória na trilha de auditoria — para o
--      certificado anexado no instrumento errado. Só administrador, que
--      é o que a política de DELETE do Storage já exigia.
--  12. Anexar foto a um instrumento JÁ cadastrado. A foto é exigida no
--      cadastro pela tela e não pode ser na importação em massa — uma
--      planilha não carrega imagens. Sem este caminho, a única saída
--      seria recadastrar o instrumento, trocando a tag e jogando fora o
--      histórico.
--
-- COMO RODAR (SQL Editor do Supabase, nesta ordem):
--   1) este arquivo   -> configuração nova
--   2) 01_schema.sql  -> funções novas e regras novas
--   3) 02_rls.sql     -> permissões das funções novas
--   4) 03_views.sql   -> status com janela mensal + vw_arquivos
--
-- Rodar de novo não faz mal: tudo aqui é idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CONFIGURAÇÃO NOVA — horizonte do alerta de vencimento (item 7)
--
-- 'sim' (padrão): fica em âmbar tudo que vence até o último dia do mês
-- que vem. É o horizonte do controle mensal — a pergunta real é "o que
-- preciso resolver até fechar o mês que vem?", não "o que vence em 15
-- dias". 'nao' volta a janela em dias de 'dias_proximo_vencimento'.
-- ---------------------------------------------------------------------
insert into public.config (chave, valor)
values ('alerta_vencimento_proximo_mes', 'sim')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- 2. PERMISSÃO DE GRAVAR PARÂMETRO  (item 1 — o bug da tela)
--
-- Sintoma: administrador clicava em Salvar em qualquer parâmetro e
-- recebia "Operação bloqueada pelo banco: seu papel não permite alterar
-- este campo diretamente".
--
-- Causa: a tela grava com upsert (a chave pode nunca ter sido semeada, e
-- um UPDATE que não acha linha "dá certo" sem gravar nada). O INSERT
-- exige GRANT e policy próprios. O 05_admin.sql concedia os dois — mas o
-- 02_rls.sql começa com `revoke all ... from authenticated`, então toda
-- vez que o arquivo de permissões rodava (como a revisão anterior mandou
-- fazer), o grant de INSERT ia junto e o parâmetro travava de novo.
--
-- Correção em duas camadas: o grant volta e agora vive no 02_rls.sql
-- (sobrevive à próxima manutenção), e a tela passa a usar a RPC
-- salvar_config, que não depende de grant de tabela nenhum.
-- ---------------------------------------------------------------------
grant insert (chave, valor) on public.config to authenticated;

drop policy if exists config_criar on public.config;
create policy config_criar on public.config
  for insert to authenticated with check (public.sou_admin());

-- ---------------------------------------------------------------------
-- 3. COLUNA NOVA — quando a foto foi tirada  (item 12)
--
-- Duas coisas moram na tabela `inspecoes` porque as duas são "uma foto
-- com um texto", mas contam fatos diferentes: a inspeção DE RECEBIMENTO
-- prova o estado em que o instrumento chegou; a foto anexada DEPOIS
-- mostra o instrumento de hoje. As linhas que já existem são todas de
-- recebimento — é o único jeito que havia de criar uma —, então o default
-- já as classifica corretamente e nenhuma precisa ser corrigida à mão.
-- ---------------------------------------------------------------------
alter table public.inspecoes
  add column if not exists momento text not null default 'recebimento';

alter table public.inspecoes drop constraint if exists insp_momento_ok;
alter table public.inspecoes add constraint insp_momento_ok
  check (momento in ('recebimento','posterior'));

-- ---------------------------------------------------------------------
-- 4. AVISAR O POSTGREST
--     Funções e views novas só aparecem para a API depois que o cache de
--     esquema recarrega.
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 5. CONFERÊNCIA
-- ---------------------------------------------------------------------
do $$
declare v_cfg int; v_ins int; v_col int;
begin
  select count(*) into v_cfg
    from public.config where chave = 'alerta_vencimento_proximo_mes';

  select count(*) into v_ins
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'config'
     and privilege_type = 'INSERT' and grantee = 'authenticated';

  select count(*) into v_col
    from information_schema.columns
   where table_schema = 'public' and table_name = 'inspecoes' and column_name = 'momento';

  if v_col <> 1 then
    raise warning 'A coluna inspecoes.momento não foi criada — o item 12 não vai funcionar.';
  end if;

  if v_cfg = 1 and v_ins >= 1 and v_col = 1 then
    raise notice 'Estrutura pronta. Agora rode 01_schema.sql, 02_rls.sql e 03_views.sql, nesta ordem.';
  else
    raise warning 'Faltou algo: config=% (esperado 1), grant de insert=% (esperado 2 colunas).',
      v_cfg, v_ins;
  end if;
end $$;

-- =====================================================================
-- DIAGNÓSTICO — descomente quando algo não bater
-- =====================================================================
-- -- Item 7: até quando vai o alerta hoje, e quem cai dentro dele.
-- select public.limite_alerta_vencimento() as alerta_ate;
-- select tag, descricao, data_proxima, dias_para_vencer, status_efetivo
--   from public.vw_instrumentos_status
--  where status_efetivo = 'proximo_vencimento' order by data_proxima;
--
-- -- Item 4: quem NÃO poderia ser inativado agora, e por quê.
-- select tag, descricao,
--        case when emprestado then 'emprestado para ' || emprestado_para
--             when tipo <> 'REFERENCIA' and status_workflow
--                  not in ('calibrado','descalibrado') then 'calibração em andamento'
--        end as bloqueio
--   from public.vw_instrumentos_status
--  where condicao_fisica = 'ativo'
--    and (emprestado or (tipo <> 'REFERENCIA'
--         and status_workflow not in ('calibrado','descalibrado')))
--  order by tag;
--
-- -- Item 9: a pasta de cada equipamento, do jeito que a tela Arquivos mostra.
-- select tag, tipo, nome, bucket, arquivo_path, quando
--   from public.vw_arquivos order by tag, quando desc;
--
-- -- Item 9: instrumentos sem nenhum arquivo anexado.
-- select i.tag, i.descricao from public.instrumentos i
--  where not exists (select 1 from public.vw_arquivos a where a.instrumento_id = i.id)
--  order by i.tag;
--
-- -- Item 11: tudo que já foi removido ou substituído, e por quem.
-- select a.criado_em, i.tag, a.campo, a.valor_antigo, a.valor_novo,
--        a.justificativa, a.usuario_email
--   from public.auditoria a
--   join public.instrumentos i on i.id = a.entidade_id
--  where a.campo in ('arquivo_removido','arquivo_substituido')
--  order by a.criado_em desc;
--
-- -- Item 11: calibrações que ficaram sem certificado depois de uma
-- --          remoção. Idealmente, lista vazia.
-- select i.tag, c.data_calibracao, c.criado_por_email
--   from public.calibracoes c join public.instrumentos i on i.id = c.instrumento_id
--  where coalesce(btrim(c.certificado_path),'') = ''
--  order by c.data_calibracao desc;
--
-- -- Item 12: instrumentos sem NENHUMA foto — a lista de trabalho depois
-- --          de uma importação em massa. É o mesmo recorte que o painel
-- --          "Sem foto" da tela Arquivos mostra.
-- select i.tag, i.descricao, i.data_entrada
--   from public.instrumentos i
--  where i.condicao_fisica = 'ativo'
--    and not exists (select 1 from public.inspecoes ins
--                     where ins.instrumento_id = i.id
--                       and coalesce(btrim(ins.foto_path),'') <> '')
--  order by i.tag;
--
-- -- Item 12: fotos anexadas depois do cadastro, e por quem.
-- select i.tag, ins.criado_em, ins.criado_por_email, ins.laudo
--   from public.inspecoes ins join public.instrumentos i on i.id = ins.instrumento_id
--  where ins.momento = 'posterior' order by ins.criado_em desc;
--
-- -- Item 1: confirmar que administrador consegue gravar parâmetro.
-- select public.salvar_config('dias_proximo_vencimento',
--          (select valor from public.config where chave='dias_proximo_vencimento'));
