-- =====================================================================
-- 01_schema.sql  ·  Gestão de Metrologia · Perpec Oilfield Supply
-- Tabelas, funções de domínio e gatilhos.
-- Rodar PRIMEIRO, no SQL Editor do Supabase.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0. PERFIS  (papel do usuário; id espelha auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  nome       text not null default '',
  papel      text not null default 'metrologista'
             check (papel in ('admin','metrologista')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- Cria o perfil automaticamente quando um usuário nasce no Auth.
create or replace function public.tg_novo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_novo_usuario();

-- ---------------------------------------------------------------------
-- 1. FUNÇÕES DE APOIO
--    security definer para lerem profiles sem cair na própria RLS
--    (senão a política que consulta profiles chama a si mesma).
-- ---------------------------------------------------------------------
create or replace function public.sou_ativo()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select ativo from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.sou_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'admin' and ativo from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.meu_email()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select email from public.profiles where id = auth.uid()),
                  (auth.jwt() ->> 'email'))
$$;

-- Justificativa da transação corrente. As RPCs auditadas gravam aqui
-- antes de alterar; os gatilhos de auditoria leem daqui.
create or replace function public.justificativa_atual()
returns text language sql stable as $$
  select nullif(btrim(coalesce(current_setting('app.justificativa', true), '')), '')
$$;

-- ---------------------------------------------------------------------
-- 2. CONFIGURAÇÕES (chave-valor)
-- ---------------------------------------------------------------------
create table if not exists public.config (
  chave text primary key,
  valor text not null
);

create or replace function public.cfg_int(p_chave text, p_padrao int)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select valor::int from public.config where chave = p_chave), p_padrao)
$$;

-- Mesma coisa para chave de texto. Valor em branco conta como ausente:
-- um campo esvaziado por engano na tela não pode virar regra de negócio.
create or replace function public.cfg_txt(p_chave text, p_padrao text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim((select valor from public.config where chave = p_chave)), ''), p_padrao)
$$;

-- Chave de configuração lida como sim/não.
create or replace function public.cfg_bool(p_chave text, p_padrao boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select lower(public.cfg_txt(p_chave, case when p_padrao then 'sim' else 'nao' end))
         in ('sim','s','true','1','yes')
$$;

-- ---------------------------------------------------------------------
-- 2b. E-MAIL DO RESPONSÁVEL POR SETOR
--     Quem cobra a devolução de um instrumento emprestado não é o
--     sistema: é o responsável pelo setor. Isto guarda para onde
--     escrever. Só administrador grava (RPC salvar_email_setor);
--     todo mundo lê, porque o botão de notificar também é do
--     metrologista.
-- ---------------------------------------------------------------------
create table if not exists public.setores_email (
  setor                text primary key,
  email                text not null
                       check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  responsavel          text,
  atualizado_em        timestamptz not null default now(),
  atualizado_por_email text
);

-- ---------------------------------------------------------------------
-- 3. FAMÍLIAS E PERIODICIDADE
-- ---------------------------------------------------------------------
create table if not exists public.familias (
  id                        uuid primary key default gen_random_uuid(),
  codigo                    text not null unique
                            check (codigo ~ '^[A-Z0-9]{2,10}$'),
  nome                      text not null check (char_length(btrim(nome)) >= 2),
  periodicidade_meses       int  not null check (periodicidade_meses between 1 and 600),
  periodicidade_customizada boolean not null default false,
  criado_em                 timestamptz not null default now()
);

create table if not exists public.periodicidade_fases (
  id                 uuid primary key default gen_random_uuid(),
  familia_id         uuid not null references public.familias(id) on delete cascade,
  ordem              int  not null check (ordem >= 1),
  intervalo_meses    int  not null check (intervalo_meses between 1 and 600),
  vigencia_ate_meses int  check (vigencia_ate_meses >= 1),   -- null = fase final, vale indefinidamente
  ancora             text not null default 'entrada'
                     check (ancora in ('entrada','primeira_calibracao')),
  criado_em          timestamptz not null default now(),
  unique (familia_id, ordem)
);
create index if not exists fases_familia_idx on public.periodicidade_fases (familia_id, ordem);

-- ---------------------------------------------------------------------
-- 4. INSTRUMENTOS
-- ---------------------------------------------------------------------
create table if not exists public.instrumentos (
  id                     uuid primary key default gen_random_uuid(),
  tag                    text not null unique,
  familia_id             uuid not null references public.familias(id) on delete restrict,
  -- Classificação do instrumento. TMMDE é medição de uso, com todo o
  -- controle de validade. REFERENCIA é padrão de aferição: cadastro
  -- enxuto, sem exigência de calibração periódica.
  tipo                   text not null check (tipo in ('TMMDE','REFERENCIA')),
  fabricante             text,
  descricao              text not null check (char_length(btrim(descricao)) >= 2),
  resolucao              text,
  num_serie              text,
  observacoes            text,      -- campo livre; o principal da referência
  nota_fiscal            text,
  pedido_compra          text,
  -- Pedido associado na SOLICITAÇÃO da calibração. Copiado para a
  -- calibração e zerado quando ela é registrada.
  pedido_calibracao      text,
  data_entrada           date not null,
  standby                boolean not null default false,
  -- 1ª movimentação pós-standby. NULL + standby = relógio de validade pausado.
  data_inicio_relogio    timestamptz,
  condicao_fisica        text not null default 'ativo' check (condicao_fisica in ('ativo','inativo')),
  -- Texto livre alimentado por config.motivos_inativacao: sucateado,
  -- vago, não entregue, danificado, não encontrado, necessário
  -- manutenção, outros. Lista aberta de propósito — a metrologia
  -- acrescenta o que a realidade dela pedir, sem migração de banco.
  motivo_inativo         text,
  justificativa_inativo  text,
  localizacao_normal     text,
  status_workflow        text not null default 'descalibrado'
                         check (status_workflow in ('calibrado','descalibrado','solicitado','em_calibracao_externa')),
  origem                 text not null default 'avulso' check (origem in ('recebimento','avulso')),
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now()
);
create index if not exists instrumentos_familia_idx  on public.instrumentos (familia_id);
create index if not exists instrumentos_atualiz_idx  on public.instrumentos (atualizado_em desc);

-- ---------------------------------------------------------------------
-- 5. CALIBRAÇÕES
-- ---------------------------------------------------------------------
create table if not exists public.calibracoes (
  id                 uuid primary key default gen_random_uuid(),
  instrumento_id     uuid not null references public.instrumentos(id) on delete cascade,
  data_calibracao    date not null,
  data_proxima       date,                 -- calculada pelo gatilho; NULL = relógio pausado
  certificado_path   text,
  pedidos_associados text,
  obs_metrologista   text,
  laudo_path         text,
  standby_apos       boolean not null default false,
  criado_por_email   text,
  criado_em          timestamptz not null default now()
);
create index if not exists calibracoes_instr_idx on public.calibracoes (instrumento_id, data_calibracao desc);

-- ---------------------------------------------------------------------
-- 6. MOVIMENTAÇÕES (empréstimos)
-- ---------------------------------------------------------------------
create table if not exists public.movimentacoes (
  id                     uuid primary key default gen_random_uuid(),
  instrumento_id         uuid not null references public.instrumentos(id) on delete cascade,
  tipo                   text not null check (tipo in ('casual','posse','externo')),
  entregue_por           text not null check (char_length(btrim(entregue_por)) >= 3),
  responsavel            text not null check (char_length(btrim(responsavel)) >= 3),
  setor                  text not null,
  termo_path             text,
  data_saida             timestamptz not null default now(),
  data_prevista_retorno  timestamptz,
  data_retorno           timestamptz,       -- NULL = ainda emprestado
  recebido_por           text,              -- quem da Metrologia recebeu de volta
  obs_devolucao          text,
  criado_por_email       text,              -- quem registrou a SAÍDA
  devolvido_por_email    text,              -- quem registrou a DEVOLUÇÃO
  criado_em              timestamptz not null default now(),
  -- Regra 5: posse e externo não existem sem termo assinado.
  constraint termo_obrigatorio check (tipo = 'casual' or coalesce(btrim(termo_path),'') <> '')
);
create index if not exists mov_instr_idx  on public.movimentacoes (instrumento_id, data_saida desc);
create index if not exists mov_aberta_idx on public.movimentacoes (data_retorno) where data_retorno is null;

-- ---------------------------------------------------------------------
-- 7. DOCUMENTOS AVULSOS
-- ---------------------------------------------------------------------
create table if not exists public.documentos (
  id             uuid primary key default gen_random_uuid(),
  instrumento_id uuid references public.instrumentos(id) on delete cascade,
  calibracao_id  uuid references public.calibracoes(id) on delete cascade,
  tipo           text,
  nome           text,
  bucket         text not null default 'laudos',
  arquivo_path   text not null,
  criado_por_email text,
  criado_em      timestamptz not null default now(),
  constraint doc_tem_dono check (instrumento_id is not null or calibracao_id is not null)
);
create index if not exists doc_instr_idx on public.documentos (instrumento_id);

-- ---------------------------------------------------------------------
-- 8. INSPEÇÕES VISUAIS (recebimento)
-- ---------------------------------------------------------------------
create table if not exists public.inspecoes (
  id             uuid primary key default gen_random_uuid(),
  instrumento_id uuid not null references public.instrumentos(id) on delete cascade,
  foto_path      text,
  laudo          text,
  comentario     text,
  criado_por_email text,
  criado_em      timestamptz not null default now()
);
create index if not exists insp_instr_idx on public.inspecoes (instrumento_id);

-- ---------------------------------------------------------------------
-- 9. AUDITORIA (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.auditoria (
  id            uuid primary key default gen_random_uuid(),
  entidade      text not null,
  entidade_id   uuid not null,
  campo         text not null,
  valor_antigo  text,
  valor_novo    text,
  justificativa text,
  usuario_email text,
  criado_em     timestamptz not null default now()
);
create index if not exists aud_entidade_idx on public.auditoria (entidade, entidade_id, criado_em desc);

-- Append-only garantido no banco, não só por policy.
create or replace function public.tg_auditoria_imutavel()
returns trigger language plpgsql as $$
begin
  raise exception 'A trilha de auditoria é somente-inclusão: % não é permitido.', tg_op;
end $$;

drop trigger if exists auditoria_sem_update on public.auditoria;
create trigger auditoria_sem_update before update on public.auditoria
  for each row execute function public.tg_auditoria_imutavel();

drop trigger if exists auditoria_sem_delete on public.auditoria;
create trigger auditoria_sem_delete before delete on public.auditoria
  for each row execute function public.tg_auditoria_imutavel();

create or replace function public.auditar(
  p_entidade text, p_entidade_id uuid, p_campo text,
  p_antigo text, p_novo text, p_justificativa text
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.auditoria (entidade, entidade_id, campo, valor_antigo, valor_novo, justificativa, usuario_email)
  values (p_entidade, p_entidade_id, p_campo, p_antigo, p_novo, p_justificativa, public.meu_email());
end $$;

-- ---------------------------------------------------------------------
-- 10. GERAÇÃO DE TAG
--     Prefixo: TMMDE -> 'P-'  ·  REFERENCIA -> 'PR-'
--     Formato: {prefixo}{codigo_familia}-{sequencial 2 dígitos}
--     Sequencial independente por (família, tipo).
--     Deriva do MAIOR sufixo existente, não de COUNT(*): apagar um
--     instrumento não pode fazer a próxima tag repetir uma antiga.
-- ---------------------------------------------------------------------
create or replace function public.gerar_tag(p_familia_id uuid, p_tipo text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_codigo  text;
  v_prefixo text;
  v_seq     int;
begin
  select codigo into v_codigo from public.familias where id = p_familia_id;
  if v_codigo is null then
    raise exception 'Família não encontrada.';
  end if;
  if p_tipo not in ('TMMDE','REFERENCIA') then
    raise exception 'Tipo inválido: %', p_tipo;
  end if;

  v_prefixo := case p_tipo when 'TMMDE' then 'P-' else 'PR-' end;

  select coalesce(max((regexp_match(tag, '-([0-9]+)$'))[1]::int), 0) + 1
    into v_seq
    from public.instrumentos
   where familia_id = p_familia_id and tipo = p_tipo;

  return v_prefixo || v_codigo || '-' || lpad(v_seq::text, 2, '0');
end $$;

-- ---------------------------------------------------------------------
-- 11. MOTOR DE PRÓXIMA CALIBRAÇÃO
--     Regras:
--       · classificação REFERENCIA -> NULL (padrão de aferição não tem
--         exigência de calibração periódica neste controle)
--       · standby com relógio pausado (data_inicio_relogio NULL) -> NULL
--         (validade indefinida enquanto o instrumento não for usado)
--       · base = maior entre data_calibracao e data_inicio_relogio
--       · família simples      -> base + periodicidade_meses
--       · família customizada  -> fase vigente conforme a IDADE do
--         instrumento na âncora da fase (entrada ou 1ª calibração)
--       · por fim, se 'vencimento_fim_do_mes' estiver ligado, a data
--         é empurrada para o último dia do mês de vencimento
-- ---------------------------------------------------------------------
create or replace function public.calcular_data_proxima(
  p_instrumento_id uuid,
  p_data_calibracao date,
  p_standby_apos boolean default false
) returns date language plpgsql stable security definer set search_path = public as $$
declare
  i             public.instrumentos%rowtype;
  f             public.familias%rowtype;
  v_base        date;
  v_ancora_tipo text;
  v_ancora_data date;
  v_idade       int;
  v_intervalo   int;
  v_proxima     date;
  r             record;
begin
  select * into i from public.instrumentos where id = p_instrumento_id;
  if not found then raise exception 'Instrumento não encontrado.'; end if;
  select * into f from public.familias where id = i.familia_id;

  -- Padrão de referência: sem controle de validade. Guardar uma data de
  -- vencimento aqui faria a view classificá-lo como descalibrado e ele
  -- entraria na fila de trabalho da metrologia sem precisar.
  if i.tipo = 'REFERENCIA' then return null; end if;

  -- Relógio pausado: a calibração não expira enquanto o instrumento
  -- estiver guardado sem uso.
  --
  -- p_standby_apos é o estado de standby DEPOIS desta calibração — o
  -- gatilho tg_calibracao_reflete_instrumento grava exatamente esse
  -- valor em instrumentos.standby. Por isso a decisão é dele, e não do
  -- standby atual da tabela: tirar um instrumento do standby ao
  -- calibrá-lo precisa produzir uma data real de vencimento.
  if p_standby_apos then return null; end if;

  v_base := p_data_calibracao;
  if i.data_inicio_relogio is not null
     and i.data_inicio_relogio::date > v_base then
    v_base := i.data_inicio_relogio::date;
  end if;

  if f.periodicidade_customizada then
    select ancora into v_ancora_tipo
      from public.periodicidade_fases
     where familia_id = f.id order by ordem limit 1;
    v_ancora_tipo := coalesce(v_ancora_tipo, 'entrada');

    if v_ancora_tipo = 'primeira_calibracao' then
      select min(data_calibracao) into v_ancora_data
        from public.calibracoes where instrumento_id = i.id;
      v_ancora_data := coalesce(v_ancora_data, p_data_calibracao);
    else
      v_ancora_data := i.data_entrada;
    end if;

    v_idade := (extract(year  from age(v_base, v_ancora_data)) * 12
              + extract(month from age(v_base, v_ancora_data)))::int;

    for r in
      select * from public.periodicidade_fases where familia_id = f.id order by ordem
    loop
      if r.vigencia_ate_meses is null or v_idade < r.vigencia_ate_meses then
        v_intervalo := r.intervalo_meses;
        exit;
      end if;
      v_intervalo := r.intervalo_meses;   -- guarda a última como fallback
    end loop;
  end if;

  v_intervalo := coalesce(v_intervalo, f.periodicidade_meses);
  v_proxima   := (v_base + (v_intervalo || ' months')::interval)::date;

  -- Controle mensal de vencimentos: a metrologia fecha o mês, não o dia.
  -- Calibrado em 20/08/2025 com periodicidade de 12 meses vence em
  -- 31/08/2026, e não em 20/08/2026 — o instrumento continua válido
  -- até o fim do mês em que a calibração cai.
  --
  -- date_trunc + 1 mês - 1 dia acerta fevereiro e ano bissexto sozinho;
  -- somar 30 dias, não.
  if public.cfg_bool('vencimento_fim_do_mes', true) then
    v_proxima := (date_trunc('month', v_proxima) + interval '1 month' - interval '1 day')::date;
  end if;

  return v_proxima;
end $$;

-- Gatilho: data_proxima nunca é escolhida pelo cliente.
create or replace function public.tg_calibracao_data_proxima()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.data_proxima := public.calcular_data_proxima(
    new.instrumento_id, new.data_calibracao, new.standby_apos);
  if tg_op = 'INSERT' then
    new.criado_por_email := coalesce(new.criado_por_email, public.meu_email());
  end if;
  return new;
end $$;

drop trigger if exists calibracoes_data_proxima on public.calibracoes;
create trigger calibracoes_data_proxima
  before insert or update of data_calibracao, standby_apos on public.calibracoes
  for each row execute function public.tg_calibracao_data_proxima();

-- Gatilho: registrar calibração move o instrumento para 'calibrado'
-- e reaplica (ou não) o standby.
create or replace function public.tg_calibracao_reflete_instrumento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.instrumentos
     set status_workflow     = 'calibrado',
         standby             = new.standby_apos,
         data_inicio_relogio = case when new.standby_apos then null else data_inicio_relogio end,
         atualizado_em       = now()
   where id = new.instrumento_id;
  return new;
end $$;

drop trigger if exists calibracoes_reflete on public.calibracoes;
create trigger calibracoes_reflete after insert on public.calibracoes
  for each row execute function public.tg_calibracao_reflete_instrumento();

-- ---------------------------------------------------------------------
-- 12. GATILHOS DE AUDITORIA
-- ---------------------------------------------------------------------
create or replace function public.tg_carimbo_instrumento()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  new.criado_em     := old.criado_em;   -- imutável
  return new;
end $$;

drop trigger if exists instrumentos_carimbo on public.instrumentos;
create trigger instrumentos_carimbo before update on public.instrumentos
  for each row execute function public.tg_carimbo_instrumento();

-- Condição física: mudar exige justificativa (regra 6).
create or replace function public.tg_auditoria_condicao()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_just text;
begin
  if new.condicao_fisica is distinct from old.condicao_fisica then
    v_just := coalesce(public.justificativa_atual(), nullif(btrim(new.justificativa_inativo),''));
    if v_just is null then
      raise exception 'Alterar a condição física exige justificativa. Use a função inativar_instrumento/reativar_instrumento.';
    end if;
    perform public.auditar('instrumentos', new.id, 'condicao_fisica',
                           old.condicao_fisica, new.condicao_fisica, v_just);
  end if;
  if new.status_workflow is distinct from old.status_workflow then
    perform public.auditar('instrumentos', new.id, 'status_workflow',
                           old.status_workflow, new.status_workflow, public.justificativa_atual());
  end if;
  return new;
end $$;

drop trigger if exists instrumentos_auditoria on public.instrumentos;
create trigger instrumentos_auditoria after update on public.instrumentos
  for each row execute function public.tg_auditoria_condicao();

-- Periodicidade da família: alterar exige justificativa (regra 3).
create or replace function public.tg_auditoria_familia()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_just text := public.justificativa_atual();
begin
  if new.periodicidade_meses is distinct from old.periodicidade_meses
     or new.periodicidade_customizada is distinct from old.periodicidade_customizada then
    if v_just is null then
      raise exception 'Alterar a periodicidade exige justificativa. Use a função alterar_periodicidade.';
    end if;
    if new.periodicidade_meses is distinct from old.periodicidade_meses then
      perform public.auditar('familias', new.id, 'periodicidade_meses',
                             old.periodicidade_meses::text, new.periodicidade_meses::text, v_just);
    end if;
    if new.periodicidade_customizada is distinct from old.periodicidade_customizada then
      perform public.auditar('familias', new.id, 'periodicidade_customizada',
                             old.periodicidade_customizada::text, new.periodicidade_customizada::text, v_just);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists familias_auditoria on public.familias;
create trigger familias_auditoria after update on public.familias
  for each row execute function public.tg_auditoria_familia();

-- Fases: criar não exige justificativa (é a definição inicial da família);
-- alterar ou remover exige.
create or replace function public.tg_auditoria_fases()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_just text := public.justificativa_atual();
  v_fam  uuid := coalesce(new.familia_id, old.familia_id);
  v_ant  text;
  v_nov  text;
begin
  v_ant := case when old is null then null else
    format('ordem %s · %s mês(es) · vigência até %s · âncora %s',
           old.ordem, old.intervalo_meses, coalesce(old.vigencia_ate_meses::text,'—'), old.ancora) end;
  v_nov := case when new is null then null else
    format('ordem %s · %s mês(es) · vigência até %s · âncora %s',
           new.ordem, new.intervalo_meses, coalesce(new.vigencia_ate_meses::text,'—'), new.ancora) end;

  if tg_op in ('UPDATE','DELETE') and v_just is null then
    raise exception 'Alterar fases de periodicidade exige justificativa. Use a função alterar_periodicidade.';
  end if;

  perform public.auditar('periodicidade_fases', v_fam, 'fase_' || lower(tg_op), v_ant, v_nov, v_just);
  return coalesce(new, old);
end $$;

drop trigger if exists fases_auditoria on public.periodicidade_fases;
create trigger fases_auditoria after insert or update or delete on public.periodicidade_fases
  for each row execute function public.tg_auditoria_fases();

-- ---------------------------------------------------------------------
-- 13. RPCs TRANSACIONAIS
--     A tela nunca monta um INSERT de várias tabelas por conta própria.
-- ---------------------------------------------------------------------

-- 13.1 Recebimento / cadastro avulso: instrumento + inspeção + 1ª calibração
create or replace function public.criar_instrumento_completo(
  p_instrumento jsonb,
  p_inspecao    jsonb default null,
  p_calibracao  jsonb default null
) returns public.instrumentos
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_tag  text;
  v_fam  uuid := (p_instrumento->>'familia_id')::uuid;
  v_tipo text := p_instrumento->>'tipo';
  v_row  public.instrumentos%rowtype;
begin
  if not public.sou_ativo() then raise exception 'Usuário sem permissão.'; end if;

  v_tag := public.gerar_tag(v_fam, v_tipo);

  insert into public.instrumentos (
    tag, familia_id, tipo, fabricante, descricao, resolucao, num_serie,
    observacoes, nota_fiscal, pedido_compra, data_entrada, standby,
    localizacao_normal, origem, status_workflow
  ) values (
    v_tag, v_fam, v_tipo,
    nullif(btrim(coalesce(p_instrumento->>'fabricante','')),''),
    p_instrumento->>'descricao',
    nullif(btrim(coalesce(p_instrumento->>'resolucao','')),''),
    nullif(btrim(coalesce(p_instrumento->>'num_serie','')),''),
    nullif(btrim(coalesce(p_instrumento->>'observacoes','')),''),
    nullif(btrim(coalesce(p_instrumento->>'nota_fiscal','')),''),
    nullif(btrim(coalesce(p_instrumento->>'pedido_compra','')),''),
    (p_instrumento->>'data_entrada')::date,
    -- Standby é mecânica de validade de calibração: não existe para
    -- padrão de referência, mesmo que a tela mande true por engano.
    (v_tipo = 'TMMDE' and coalesce((p_instrumento->>'standby')::boolean, false)),
    nullif(btrim(coalesce(p_instrumento->>'localizacao_normal','')),''),
    coalesce(p_instrumento->>'origem','avulso'),
    'descalibrado'
  ) returning id into v_id;

  if p_inspecao is not null and p_inspecao <> 'null'::jsonb then
    insert into public.inspecoes (instrumento_id, foto_path, laudo, comentario, criado_por_email)
    values (v_id,
            nullif(btrim(coalesce(p_inspecao->>'foto_path','')),''),
            nullif(btrim(coalesce(p_inspecao->>'laudo','')),''),
            nullif(btrim(coalesce(p_inspecao->>'comentario','')),''),
            public.meu_email());
  end if;

  if p_calibracao is not null and p_calibracao <> 'null'::jsonb
     and coalesce(p_calibracao->>'data_calibracao','') <> '' then
    insert into public.calibracoes (
      instrumento_id, data_calibracao, certificado_path, pedidos_associados,
      obs_metrologista, laudo_path, standby_apos
    ) values (
      v_id, (p_calibracao->>'data_calibracao')::date,
      nullif(btrim(coalesce(p_calibracao->>'certificado_path','')),''),
      nullif(btrim(coalesce(p_calibracao->>'pedidos_associados','')),''),
      nullif(btrim(coalesce(p_calibracao->>'obs_metrologista','')),''),
      nullif(btrim(coalesce(p_calibracao->>'laudo_path','')),''),
      coalesce((p_calibracao->>'standby_apos')::boolean, false)
    );
  end if;

  select * into v_row from public.instrumentos where id = v_id;
  return v_row;
end $$;

-- 13.2 Tornar calibrado
create or replace function public.registrar_calibracao(
  p_instrumento_id uuid,
  p_dados jsonb
) returns public.calibracoes
language plpgsql security definer set search_path = public as $$
declare
  v_row    public.calibracoes%rowtype;
  v_cond   text;
  v_tag    text;
  v_pedido text;
begin
  if not public.sou_ativo() then raise exception 'Usuário sem permissão.'; end if;

  select condicao_fisica, tag, nullif(btrim(coalesce(pedido_calibracao,'')),'')
    into v_cond, v_tag, v_pedido
    from public.instrumentos where id = p_instrumento_id;
  if v_cond is null then raise exception 'Instrumento não encontrado.'; end if;

  -- Instrumento inativo está fora do fluxo: não encontrado, em
  -- manutenção, sucateado. Calibrar um deles seria registrar um serviço
  -- em cima de um instrumento que a metrologia declarou indisponível.
  if v_cond = 'inativo' then
    raise exception 'O instrumento % está inativo. Reative-o no Inventário antes de registrar a calibração.', v_tag;
  end if;

  -- O pedido de compra é perguntado na SOLICITAÇÃO da calibração e
  -- guardado no instrumento até aqui. Ele é a fonte da verdade; o que
  -- veio da tela só entra quando não houve solicitação registrada.
  v_pedido := coalesce(v_pedido, nullif(btrim(coalesce(p_dados->>'pedidos_associados','')),''));

  insert into public.calibracoes (
    instrumento_id, data_calibracao, certificado_path, pedidos_associados,
    obs_metrologista, laudo_path, standby_apos
  ) values (
    p_instrumento_id, (p_dados->>'data_calibracao')::date,
    nullif(btrim(coalesce(p_dados->>'certificado_path','')),''),
    v_pedido,
    nullif(btrim(coalesce(p_dados->>'obs_metrologista','')),''),
    nullif(btrim(coalesce(p_dados->>'laudo_path','')),''),
    coalesce((p_dados->>'standby_apos')::boolean, false)
  ) returning * into v_row;

  -- Ciclo fechado: o pedido acompanhou a solicitação até o certificado
  -- e não deve reaparecer na próxima calibração deste instrumento.
  update public.instrumentos set pedido_calibracao = null
   where id = p_instrumento_id and pedido_calibracao is not null;

  return v_row;
end $$;

-- 13.3 Alterar periodicidade (auditada, justificativa obrigatória)
create or replace function public.alterar_periodicidade(
  p_familia_id    uuid,
  p_periodicidade int,
  p_customizada   boolean,
  p_fases         jsonb,
  p_justificativa text
) returns void language plpgsql security definer set search_path = public as $$
declare f jsonb;
begin
  if not public.sou_ativo() then raise exception 'Usuário sem permissão.'; end if;
  if coalesce(btrim(p_justificativa),'') = '' then
    raise exception 'Informe a justificativa da alteração de periodicidade.';
  end if;

  perform set_config('app.justificativa', p_justificativa, true);

  update public.familias
     set periodicidade_meses       = p_periodicidade,
         periodicidade_customizada = p_customizada
   where id = p_familia_id;

  delete from public.periodicidade_fases where familia_id = p_familia_id;

  if p_customizada and p_fases is not null then
    for f in select * from jsonb_array_elements(p_fases) loop
      insert into public.periodicidade_fases (familia_id, ordem, intervalo_meses, vigencia_ate_meses, ancora)
      values (p_familia_id,
              (f->>'ordem')::int,
              (f->>'intervalo_meses')::int,
              nullif(f->>'vigencia_ate_meses','')::int,
              coalesce(f->>'ancora','entrada'));
    end loop;
  end if;
end $$;

-- 13.4 Inativar / reativar (auditada, justificativa obrigatória, só admin)
create or replace function public.inativar_instrumento(
  p_instrumento_id uuid,
  p_motivo text,
  p_justificativa text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_admin() then
    raise exception 'Somente administradores podem inativar instrumentos.';
  end if;
  if coalesce(btrim(p_justificativa),'') = '' then
    raise exception 'Informe a justificativa da inativação.';
  end if;

  perform set_config('app.justificativa', p_justificativa, true);

  update public.instrumentos
     set condicao_fisica       = 'inativo',
         motivo_inativo        = p_motivo,
         justificativa_inativo = p_justificativa
   where id = p_instrumento_id;
end $$;

create or replace function public.reativar_instrumento(
  p_instrumento_id uuid,
  p_justificativa text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_admin() then
    raise exception 'Somente administradores podem reativar instrumentos.';
  end if;
  if coalesce(btrim(p_justificativa),'') = '' then
    raise exception 'Informe a justificativa da reativação.';
  end if;

  perform set_config('app.justificativa', p_justificativa, true);

  update public.instrumentos
     set condicao_fisica       = 'ativo',
         motivo_inativo        = null,
         justificativa_inativo = p_justificativa
   where id = p_instrumento_id;
end $$;

-- 13.5 Mudar status de workflow (solicitado / em calibração externa / descalibrado)
--
-- A assinatura ganhou p_pedido. Duas versões coexistindo deixariam o
-- PostgREST com chamada ambígua, por isso a antiga sai antes.
drop function if exists public.definir_status_workflow(uuid, text, text);

create or replace function public.definir_status_workflow(
  p_instrumento_id uuid,
  p_status text,
  p_justificativa text default null,
  p_pedido text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_cond text; v_tag text;
begin
  if not public.sou_ativo() then raise exception 'Usuário sem permissão.'; end if;
  if p_status not in ('calibrado','descalibrado','solicitado','em_calibracao_externa') then
    raise exception 'Status inválido: %', p_status;
  end if;

  select condicao_fisica, tag into v_cond, v_tag
    from public.instrumentos where id = p_instrumento_id;
  if v_cond is null then raise exception 'Instrumento não encontrado.'; end if;

  -- Instrumento inativado pode estar não encontrado, em manutenção ou
  -- na sucata. Solicitar calibração dele não quer dizer nada — a tela
  -- esconde os botões, e aqui a trava é de verdade.
  if v_cond = 'inativo' then
    raise exception 'O instrumento % está inativo. Reative-o no Inventário antes de mudar a situação de calibração.', v_tag;
  end if;

  perform set_config('app.justificativa', coalesce(p_justificativa,''), true);

  update public.instrumentos
     set status_workflow   = p_status,
         -- O pedido de compra entra na SOLICITAÇÃO e sai quando o
         -- instrumento volta para descalibrado (solicitação abortada).
         -- Enviar para o laboratório não mexe: é o mesmo pedido.
         pedido_calibracao = case
           when p_status = 'solicitado'
             then coalesce(nullif(btrim(coalesce(p_pedido,'')),''), pedido_calibracao)
           when p_status = 'descalibrado' then null
           else pedido_calibracao
         end
   where id = p_instrumento_id;
end $$;

-- 13.6 E-mail do responsável pelo setor (cobrança de devolução)
create or replace function public.salvar_email_setor(
  p_setor text,
  p_email text,
  p_responsavel text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_admin() then
    raise exception 'Somente administradores podem cadastrar e-mails de setor.';
  end if;
  if coalesce(btrim(p_setor),'') = '' then
    raise exception 'Informe o setor.';
  end if;

  insert into public.setores_email (setor, email, responsavel, atualizado_por_email)
  values (btrim(p_setor), lower(btrim(p_email)),
          nullif(btrim(coalesce(p_responsavel,'')),''), public.meu_email())
  on conflict (setor) do update
    set email                = excluded.email,
        responsavel          = excluded.responsavel,
        atualizado_em        = now(),
        atualizado_por_email = excluded.atualizado_por_email;
end $$;

create or replace function public.remover_email_setor(p_setor text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_admin() then
    raise exception 'Somente administradores podem remover e-mails de setor.';
  end if;
  delete from public.setores_email where setor = btrim(p_setor);
end $$;
