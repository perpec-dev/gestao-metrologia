-- =====================================================================
-- 03_views.sql  ·  Gestão de Metrologia · Perpec Oilfield Supply
-- Status calculado, empréstimos em aberto, linha do tempo
-- e a RPC de movimentação (que depende da view de status).
--
-- Regra 1: status_workflow guarda só o que o usuário declara.
-- 'proximo_vencimento' e 'vencido' NUNCA são gravados — são calculados
-- aqui e lidos pela tela. Nenhum cron muda linha de instrumento.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. STATUS EFETIVO
-- ---------------------------------------------------------------------
-- O `drop` é obrigatório, e não uma precaução: esta view expande `i.*`,
-- então toda coluna nova em `instrumentos` entra NO MEIO da lista de
-- colunas da view. `create or replace view` recusa renomear coluna, e o
-- arquivo falharia com "cannot change name of view column". Nenhuma
-- outra view depende desta; os grants voltam no fim deste mesmo arquivo.
drop view if exists public.vw_instrumentos_status;

create or replace view public.vw_instrumentos_status as
select
  i.*,
  f.codigo                     as familia_codigo,
  f.nome                       as familia_nome,
  f.periodicidade_meses,
  f.periodicidade_customizada,
  c.id                         as calibracao_id,
  c.data_calibracao            as ultima_calibracao,
  c.data_proxima,
  c.certificado_path,
  c.laudo_path,
  m.id                         as movimentacao_aberta_id,
  m.responsavel                as emprestado_para,
  m.setor                      as setor_atual,
  m.tipo                       as tipo_emprestimo,
  m.data_saida                 as emprestado_em,
  (m.id is not null)           as emprestado,
  coalesce(m.setor, i.localizacao_normal) as localizacao_atual,
  case
    -- Padrão de referência não tem exigência de calibração periódica:
    -- ele nunca vence, nunca fica "descalibrado" e não entra na fila de
    -- trabalho da metrologia. A classificação É a situação dele.
    when i.tipo = 'REFERENCIA'
      then 'referencia'
    when i.status_workflow in ('solicitado','em_calibracao_externa')
      then i.status_workflow
    when i.status_workflow = 'descalibrado'
      then 'descalibrado'
    when i.standby = true and i.data_inicio_relogio is null
      then 'standby_pausado'      -- relógio parado: validade indefinida
    when c.data_proxima is null
      then 'descalibrado'
    when c.data_proxima < current_date
      then 'descalibrado'
    when c.data_proxima - current_date <= public.cfg_int('dias_proximo_vencimento', 15)
      then 'proximo_vencimento'
    else 'calibrado'
  end                          as status_efetivo,
  c.data_proxima - current_date as dias_para_vencer
from public.instrumentos i
join public.familias f on f.id = i.familia_id
left join lateral (
  select * from public.calibracoes
   where instrumento_id = i.id
   order by data_calibracao desc, criado_em desc
   limit 1
) c on true
left join lateral (
  select * from public.movimentacoes
   where instrumento_id = i.id and data_retorno is null
   order by data_saida desc
   limit 1
) m on true;

alter view public.vw_instrumentos_status set (security_invoker = on);

-- ---------------------------------------------------------------------
-- 2. EMPRÉSTIMOS EM ABERTO  (lembretes do painel)
-- ---------------------------------------------------------------------
-- O `drop` é necessário uma única vez: a versão anterior desta view usava
-- `m.*` e ficou com as colunas em outra ordem. `create or replace` recusa
-- renomear coluna de view. Nada depende dela além da tela de empréstimo.
drop view if exists public.vw_emprestimos_abertos;

-- Colunas listadas uma a uma, e não `m.*`, de propósito: com `*` o
-- PostgreSQL congela a expansão no momento da criação, e qualquer coluna
-- nova em `movimentacoes` entraria no meio da lista — o que faz o
-- `create or replace` desta view falhar na próxima vez que o arquivo rodar.
create or replace view public.vw_emprestimos_abertos as
select
  m.id, m.instrumento_id, m.tipo, m.entregue_por, m.responsavel, m.setor,
  m.termo_path, m.data_saida, m.data_prevista_retorno, m.data_retorno,
  m.recebido_por, m.obs_devolucao, m.criado_por_email, m.devolvido_por_email,
  m.criado_em,
  i.tag,
  i.descricao,
  f.nome as familia_nome,
  (current_date - m.data_saida::date) as dias_fora,
  case m.tipo
    when 'casual'  then public.cfg_int('prazo_alerta_emprestimo_casual_dias', 30)
    when 'externo' then public.cfg_int('prazo_alerta_emprestimo_externo_dias', 7)
    else null
  end as prazo_alerta_dias,
  case
    when m.tipo = 'casual'
      then (current_date - m.data_saida::date) > public.cfg_int('prazo_alerta_emprestimo_casual_dias', 30)
    when m.tipo = 'externo'
      then (current_date - m.data_saida::date) > public.cfg_int('prazo_alerta_emprestimo_externo_dias', 7)
    else false
  end as em_alerta
from public.movimentacoes m
join public.instrumentos i on i.id = m.instrumento_id
join public.familias f on f.id = i.familia_id
where m.data_retorno is null;

alter view public.vw_emprestimos_abertos set (security_invoker = on);

-- ---------------------------------------------------------------------
-- 2b. HISTÓRICO DE EMPRÉSTIMOS  (entrega e devolução, abertos e fechados)
--
-- Nenhuma linha de `movimentacoes` é apagada ou reaproveitada: a devolução
-- é um UPDATE que preenche data_retorno na MESMA linha da saída. Logo o
-- par entrega/devolução já é o registro histórico — esta view só o torna
-- legível (tag, descrição, duração, atraso) sem exigir join na tela.
-- ---------------------------------------------------------------------
create or replace view public.vw_emprestimos_historico as
select
  m.id, m.instrumento_id, m.tipo,
  m.entregue_por, m.responsavel, m.setor, m.termo_path,
  m.data_saida, m.data_prevista_retorno, m.data_retorno,
  m.recebido_por, m.obs_devolucao,
  m.criado_por_email, m.devolvido_por_email, m.criado_em,
  i.tag, i.descricao, i.num_serie, i.condicao_fisica,
  f.codigo as familia_codigo,
  f.nome   as familia_nome,
  (m.data_retorno is null) as em_aberto,
  -- Empréstimo aberto: dias fora até hoje. Fechado: duração real.
  (coalesce(m.data_retorno::date, current_date) - m.data_saida::date) as dias_fora,
  case
    when m.data_prevista_retorno is null then false
    else coalesce(m.data_retorno, now()) > m.data_prevista_retorno
  end as fora_do_prazo
from public.movimentacoes m
join public.instrumentos i on i.id = m.instrumento_id
join public.familias f     on f.id = i.familia_id;

alter view public.vw_emprestimos_historico set (security_invoker = on);

-- ---------------------------------------------------------------------
-- 3. LINHA DO TEMPO  (um instrumento, todos os eventos)
-- ---------------------------------------------------------------------
create or replace view public.vw_timeline as
  select i.id as instrumento_id, i.data_entrada::timestamptz as quando,
         'entrada'::text as tipo, 'Entrada no acervo' as titulo,
         concat_ws(' · ', nullif(i.nota_fiscal,''), nullif(i.pedido_compra,'')) as detalhe,
         null::text as arquivo_bucket, null::text as arquivo_path, null::text as autor
    from public.instrumentos i
union all
  select ins.instrumento_id, ins.criado_em, 'inspecao',
         'Inspeção visual',
         concat_ws(' · ', nullif(ins.laudo,''), nullif(ins.comentario,'')),
         'fotos', ins.foto_path, ins.criado_por_email
    from public.inspecoes ins
union all
  select c.instrumento_id, c.criado_em, 'calibracao',
         'Calibração realizada em ' || to_char(c.data_calibracao,'DD/MM/YYYY'),
         concat_ws(' · ',
           case when c.data_proxima is null then 'Sem vencimento (relógio pausado)'
                else 'Próxima: ' || to_char(c.data_proxima,'DD/MM/YYYY') end,
           nullif(c.pedidos_associados,''), nullif(c.obs_metrologista,'')),
         'certificados', c.certificado_path, c.criado_por_email
    from public.calibracoes c
union all
  select m.instrumento_id, m.data_saida, 'saida',
         'Saída (' || m.tipo || ') para ' || m.responsavel,
         concat_ws(' · ', 'Setor: ' || m.setor, 'Entregue por: ' || m.entregue_por),
         'termos', m.termo_path, m.criado_por_email
    from public.movimentacoes m
union all
  select m.instrumento_id, m.data_retorno, 'retorno',
         'Devolução por ' || m.responsavel,
         concat_ws(' · ',
           case when nullif(btrim(coalesce(m.recebido_por,'')),'') is not null
                then 'Recebido por: ' || m.recebido_por end,
           nullif(m.obs_devolucao,'')),
         null, null, coalesce(m.devolvido_por_email, m.criado_por_email)
    from public.movimentacoes m where m.data_retorno is not null
union all
  select a.entidade_id, a.criado_em, 'auditoria',
         'Alteração: ' || a.campo,
         concat_ws(' · ', coalesce(a.valor_antigo,'—') || ' → ' || coalesce(a.valor_novo,'—'),
                   nullif(a.justificativa,'')),
         null, null, a.usuario_email
    from public.auditoria a where a.entidade = 'instrumentos'
union all
  select d.instrumento_id, d.criado_em, 'documento',
         'Documento anexado' || coalesce(': ' || d.tipo, ''),
         d.nome, d.bucket, d.arquivo_path, d.criado_por_email
    from public.documentos d where d.instrumento_id is not null;

alter view public.vw_timeline set (security_invoker = on);

-- ---------------------------------------------------------------------
-- 4. RPC DE MOVIMENTAÇÃO
--    Regra 4: a trava de empréstimo mora aqui. A tela repete a checagem
--    para dar mensagem antes do clique, mas quem decide é o banco.
--    Regra 2: a primeira saída pós-standby liga o relógio de validade.
-- ---------------------------------------------------------------------
create or replace function public.registrar_movimentacao(
  p_instrumento_id uuid,
  p_dados jsonb
) returns public.movimentacoes
language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_tag     text;
  v_standby boolean;
  v_relogio timestamptz;
  v_aberta  uuid;
  v_tipo    text := p_dados->>'tipo';
  v_termo   text := nullif(btrim(coalesce(p_dados->>'termo_path','')),'');
  v_row     public.movimentacoes%rowtype;
begin
  if not public.sou_ativo() then raise exception 'Usuário sem permissão.'; end if;

  select status_efetivo, tag, standby, data_inicio_relogio
    into v_status, v_tag, v_standby, v_relogio
    from public.vw_instrumentos_status where id = p_instrumento_id;

  if v_status is null then raise exception 'Instrumento não encontrado.'; end if;

  -- 'standby_pausado' só existe para instrumento já calibrado cujo relógio
  -- ainda não partiu; emprestá-lo é justamente o que liga o relógio.
  -- 'referencia' entra porque o padrão de aferição não tem validade a
  -- vencer: exigir calibração em dia dele seria exigir uma regra que a
  -- própria classificação dispensa.
  if v_status not in ('calibrado','standby_pausado','referencia') then
    raise exception 'O instrumento % não pode sair: situação atual é "%". Só instrumentos calibrados podem ser emprestados.',
      v_tag, v_status;
  end if;

  select id into v_aberta from public.movimentacoes
   where instrumento_id = p_instrumento_id and data_retorno is null limit 1;
  if v_aberta is not null then
    raise exception 'O instrumento % já está emprestado. Registre a devolução antes de uma nova saída.', v_tag;
  end if;

  if v_tipo in ('posse','externo') and v_termo is null then
    raise exception 'Empréstimo do tipo "%" exige o termo de responsabilidade assinado.', v_tipo;
  end if;

  insert into public.movimentacoes (
    instrumento_id, tipo, entregue_por, responsavel, setor, termo_path,
    data_saida, data_prevista_retorno, criado_por_email
  ) values (
    p_instrumento_id, v_tipo,
    btrim(p_dados->>'entregue_por'), btrim(p_dados->>'responsavel'), btrim(p_dados->>'setor'),
    v_termo,
    coalesce(nullif(p_dados->>'data_saida','')::timestamptz, now()),
    nullif(p_dados->>'data_prevista_retorno','')::timestamptz,
    public.meu_email()
  ) returning * into v_row;

  -- Primeira movimentação pós-standby: o relógio começa a contar agora.
  if v_standby and v_relogio is null then
    update public.instrumentos
       set data_inicio_relogio = now()
     where id = p_instrumento_id;

    -- Recalcula o vencimento da última calibração a partir do relógio.
    update public.calibracoes c
       set data_proxima = public.calcular_data_proxima(c.instrumento_id, c.data_calibracao, false)
     where c.instrumento_id = p_instrumento_id
       and c.id = (select id from public.calibracoes
                    where instrumento_id = p_instrumento_id
                    order by data_calibracao desc, criado_em desc limit 1);
  end if;

  return v_row;
end $$;

-- A assinatura ganhou p_recebido_por. Duas versões coexistindo deixariam
-- o PostgREST com chamada ambígua, por isso a antiga sai antes.
drop function if exists public.registrar_devolucao(uuid, text);

create or replace function public.registrar_devolucao(
  p_movimentacao_id uuid,
  p_obs text default null,
  p_recebido_por text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_ativo() then raise exception 'Usuário sem permissão.'; end if;
  -- UPDATE na própria linha da saída: entrega e devolução são o mesmo
  -- registro, e é isso que mantém o par sempre íntegro no histórico.
  update public.movimentacoes
     set data_retorno        = now(),
         obs_devolucao       = nullif(btrim(coalesce(p_obs,'')),''),
         recebido_por        = nullif(btrim(coalesce(p_recebido_por,'')),''),
         devolvido_por_email = public.meu_email()
   where id = p_movimentacao_id and data_retorno is null;
  if not found then raise exception 'Movimentação não encontrada ou já devolvida.'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. PERMISSÕES DAS VIEWS E DAS RPCs DESTE ARQUIVO
-- ---------------------------------------------------------------------
revoke all on public.vw_instrumentos_status, public.vw_emprestimos_abertos,
              public.vw_emprestimos_historico, public.vw_timeline
         from anon, authenticated;

grant select on public.vw_instrumentos_status    to authenticated;
grant select on public.vw_emprestimos_abertos    to authenticated;
grant select on public.vw_emprestimos_historico  to authenticated;
grant select on public.vw_timeline               to authenticated;

grant execute on function public.registrar_movimentacao(uuid,jsonb)     to authenticated;
grant execute on function public.registrar_devolucao(uuid,text,text)    to authenticated;

-- =====================================================================
-- DIAGNÓSTICO — descomente quando algo não bate
-- =====================================================================
-- -- Usuários do Auth x perfis (a causa nº 1 de "login funciona mas não vê nada"):
-- select u.id, u.email, u.email_confirmed_at, p.papel, p.ativo
--   from auth.users u left join public.profiles p on p.id = u.id order by u.created_at;
--
-- -- Status calculado, instrumento a instrumento:
-- select tag, descricao, status_workflow, standby, data_inicio_relogio,
--        ultima_calibracao, data_proxima, dias_para_vencer, status_efetivo
--   from public.vw_instrumentos_status order by dias_para_vencer nulls last;
--
-- -- Teste do motor de periodicidade sem gravar nada:
-- select tag, public.calcular_data_proxima(id, current_date, false) as proxima_se_calibrar_hoje
--   from public.instrumentos;
--
-- -- Próxima tag que cada família/tipo receberia:
-- select f.codigo, t.tipo, public.gerar_tag(f.id, t.tipo)
--   from public.familias f cross join (values ('TMMDE'),('REFERENCIA')) t(tipo)
--  order by f.codigo, t.tipo;
