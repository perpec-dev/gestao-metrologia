-- =====================================================================
-- 05_admin.sql  ·  Gestão de Metrologia · Perpec Oilfield Supply
-- Gestão de perfis/permissões e manutenção em massa do acervo.
-- Rodar DEPOIS de 01 a 04.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. GESTÃO DE PERFIS
--    O perfil nasce sozinho (gatilho on_auth_user_created) sempre como
--    'metrologista' e ativo. Daqui para frente quem muda papel e acesso
--    é o administrador, pela tela — e tudo fica na auditoria.
-- ---------------------------------------------------------------------

create or replace function public.definir_papel(p_usuario uuid, p_papel text)
returns void language plpgsql security definer set search_path = public as $$
declare v_antigo text; v_email text;
begin
  if not public.sou_admin() then
    raise exception 'Somente administradores podem alterar papéis.';
  end if;
  if p_papel not in ('admin','metrologista') then
    raise exception 'Papel inválido: %', p_papel;
  end if;
  if p_usuario = auth.uid() and p_papel <> 'admin' then
    raise exception 'Você não pode rebaixar o seu próprio usuário. Peça a outro administrador.';
  end if;

  select papel, email into v_antigo, v_email from public.profiles where id = p_usuario;
  if v_antigo is null then raise exception 'Usuário não encontrado.'; end if;
  if v_antigo = p_papel then return; end if;

  update public.profiles set papel = p_papel where id = p_usuario;

  perform public.auditar('profiles', p_usuario, 'papel', v_antigo, p_papel,
                         'Alteração de papel de ' || v_email);
end $$;

create or replace function public.definir_ativo(p_usuario uuid, p_ativo boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_antigo boolean; v_email text;
begin
  if not public.sou_admin() then
    raise exception 'Somente administradores podem ativar ou desativar acessos.';
  end if;
  if p_usuario = auth.uid() and p_ativo = false then
    raise exception 'Você não pode desativar o seu próprio acesso.';
  end if;

  select ativo, email into v_antigo, v_email from public.profiles where id = p_usuario;
  if v_email is null then raise exception 'Usuário não encontrado.'; end if;

  -- Nunca deixar o sistema sem nenhum administrador ativo.
  if p_ativo = false and exists (
       select 1 from public.profiles where id = p_usuario and papel = 'admin')
     and (select count(*) from public.profiles where papel = 'admin' and ativo) <= 1 then
    raise exception 'Este é o último administrador ativo. Promova outro antes de desativá-lo.';
  end if;

  if v_antigo = p_ativo then return; end if;

  update public.profiles set ativo = p_ativo where id = p_usuario;

  perform public.auditar('profiles', p_usuario, 'ativo', v_antigo::text, p_ativo::text,
                         (case when p_ativo then 'Acesso liberado para ' else 'Acesso bloqueado para ' end) || v_email);
end $$;

create or replace function public.definir_nome_usuario(p_usuario uuid, p_nome text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_admin() and p_usuario <> auth.uid() then
    raise exception 'Você só pode alterar o seu próprio nome.';
  end if;
  if char_length(btrim(coalesce(p_nome,''))) < 3 then
    raise exception 'Informe o nome completo.';
  end if;
  update public.profiles set nome = btrim(p_nome) where id = p_usuario;
end $$;

-- ---------------------------------------------------------------------
-- 2. MANUTENÇÃO EM MASSA
--    Para o ciclo "subi errado, quero corrigir e resubir".
--    Apagar instrumento leva junto, por cascata: calibrações, inspeções,
--    movimentações e documentos. NÃO leva a auditoria — ela é
--    somente-inclusão, e o próprio apagamento entra nela.
-- ---------------------------------------------------------------------

create or replace function public.apagar_instrumentos(
  p_ids uuid[],
  p_justificativa text
) returns int language plpgsql security definer set search_path = public as $$
declare r record; v_qtd int := 0;
begin
  if not public.sou_admin() then
    raise exception 'Somente administradores podem apagar instrumentos.';
  end if;
  if char_length(btrim(coalesce(p_justificativa,''))) < 10 then
    raise exception 'Informe a justificativa do apagamento (mínimo 10 caracteres).';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  -- Auditar ANTES de apagar: depois do delete a linha não existe mais.
  for r in select id, tag, descricao from public.instrumentos where id = any(p_ids) loop
    perform public.auditar('instrumentos', r.id, 'apagado',
                           r.tag || ' — ' || r.descricao, null, p_justificativa);
    v_qtd := v_qtd + 1;
  end loop;

  delete from public.instrumentos where id = any(p_ids);
  return v_qtd;
end $$;

/* Reset do acervo, para reimportar a planilha corrigida.
   Exige digitar a frase de confirmação — não existe botão que faça isso
   por acidente. Famílias, configurações e usuários ficam de pé. */
create or replace function public.apagar_todos_instrumentos(
  p_confirmacao text,
  p_justificativa text
) returns int language plpgsql security definer set search_path = public as $$
declare v_qtd int;
begin
  if not public.sou_admin() then
    raise exception 'Somente administradores podem limpar o acervo.';
  end if;
  if coalesce(p_confirmacao,'') <> 'APAGAR TUDO' then
    raise exception 'Confirmação incorreta. Digite exatamente: APAGAR TUDO';
  end if;
  if char_length(btrim(coalesce(p_justificativa,''))) < 10 then
    raise exception 'Informe a justificativa (mínimo 10 caracteres).';
  end if;

  select count(*) into v_qtd from public.instrumentos;

  perform public.auditar('instrumentos', gen_random_uuid(), 'acervo_apagado',
                         v_qtd::text || ' instrumento(s)', '0', p_justificativa);

  -- `where true`: o Supabase liga a extensão pg_safeupdate por padrão,
  -- que recusa DELETE/UPDATE sem cláusula WHERE mesmo dentro de função
  -- security definer. O filtro é sintático, não muda o que é apagado.
  delete from public.instrumentos where true;
  return v_qtd;
end $$;

/* Apagar só o que veio de uma família — útil quando a planilha de uma
   família saiu errada e o resto do acervo está correto. */
create or replace function public.apagar_instrumentos_da_familia(
  p_familia_id uuid,
  p_justificativa text
) returns int language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  select array_agg(id) into v_ids from public.instrumentos where familia_id = p_familia_id;
  return public.apagar_instrumentos(v_ids, p_justificativa);
end $$;

-- ---------------------------------------------------------------------
-- 2.1 CONFIGURAÇÕES QUE FALTAM
--     A tela de Administração salva parâmetro com upsert, para o caso de
--     a chave nunca ter sido semeada. Sem GRANT e política de INSERT, o
--     upsert falharia — e o 02_rls.sql só previu UPDATE.
-- ---------------------------------------------------------------------
grant insert (chave, valor) on public.config to authenticated;

drop policy if exists config_criar on public.config;
create policy config_criar on public.config
  for insert to authenticated with check (public.sou_admin());

-- Repõe qualquer chave obrigatória que esteja faltando. Idempotente:
-- as que já existem ficam com o valor atual.
insert into public.config (chave, valor) values
  ('dias_proximo_vencimento', '15'),
  ('setores', 'Qualidade,Produção,Manutenção,Logística,Engenharia'),
  ('prazo_alerta_emprestimo_casual_dias', '30'),
  ('prazo_alerta_emprestimo_externo_dias', '7'),
  ('motivos_inativacao', 'Sucateado,Vago,Não entregue,Danificado')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- 3. PERMISSÕES
-- ---------------------------------------------------------------------
grant execute on function public.definir_papel(uuid,text)                 to authenticated;
grant execute on function public.definir_ativo(uuid,boolean)              to authenticated;
grant execute on function public.definir_nome_usuario(uuid,text)          to authenticated;
grant execute on function public.apagar_instrumentos(uuid[],text)         to authenticated;
grant execute on function public.apagar_todos_instrumentos(text,text)     to authenticated;
grant execute on function public.apagar_instrumentos_da_familia(uuid,text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. RECEITAS DE MANUTENÇÃO (SQL Editor)
--    Descomente, leia, e só então rode. Estas rodam como `postgres`:
--    ignoram RLS e não passam pelas RPCs auditadas.
--
--    O Supabase liga por padrão a extensão pg_safeupdate, que recusa
--    DELETE/UPDATE sem WHERE — por isso os apagamentos totais abaixo
--    levam `where true`. É só sintaxe: não muda o que é apagado.
-- ---------------------------------------------------------------------

-- -- 4.1 Quantos registros existem hoje:
-- select 'instrumentos'  as tabela, count(*) from public.instrumentos
-- union all select 'calibracoes',   count(*) from public.calibracoes
-- union all select 'movimentacoes', count(*) from public.movimentacoes
-- union all select 'inspecoes',     count(*) from public.inspecoes
-- union all select 'documentos',    count(*) from public.documentos
-- union all select 'auditoria',     count(*) from public.auditoria;

-- -- 4.2 Apagar TODOS os instrumentos (cascata leva calibrações,
-- --     movimentações, inspeções e documentos). Famílias e config ficam.
-- delete from public.instrumentos where true;

-- -- 4.3 Apagar só os importados hoje (desfazer uma importação recém-feita):
-- delete from public.instrumentos
--  where criado_em >= current_date and origem = 'avulso';

-- -- 4.4 Apagar por família:
-- delete from public.instrumentos
--  where familia_id = (select id from public.familias where codigo = 'PAQ');

-- -- 4.5 Zerar TAMBÉM as famílias (recomeço completo do cadastro).
-- --     Instrumentos primeiro: a FK é `on delete restrict`.
-- delete from public.instrumentos where true;
-- delete from public.familias where true;

-- -- 4.6 Recomeço de verdade, inclusive a trilha de auditoria.
-- --     Os gatilhos append-only bloqueiam DELETE: desligue, apague, religue.
-- --     Use só em ambiente de testes, nunca em produção com dado real.
-- alter table public.auditoria disable trigger auditoria_sem_delete;
-- delete from public.auditoria where true;
-- alter table public.auditoria enable  trigger auditoria_sem_delete;

-- -- 4.7 Arquivos no Storage NÃO somem com o delete do banco.
-- --     Veja o que ficou órfão nos buckets:
-- select o.bucket_id, o.name, o.created_at
--   from storage.objects o
--  where o.bucket_id in ('certificados','laudos','fotos','termos')
--    and not exists (select 1 from public.calibracoes c
--                     where c.certificado_path = o.name or c.laudo_path = o.name)
--    and not exists (select 1 from public.movimentacoes m where m.termo_path = o.name)
--    and not exists (select 1 from public.inspecoes i where i.foto_path = o.name)
--    and not exists (select 1 from public.documentos d where d.arquivo_path = o.name);
-- -- e então, se confirmar que são lixo mesmo:
-- -- delete from storage.objects where bucket_id='certificados' and name = '...';

-- -- 4.8 Conferir usuários e papéis:
-- select p.email, p.nome, p.papel, p.ativo, u.last_sign_in_at
--   from public.profiles p join auth.users u on u.id = p.id
--  order by p.papel, p.email;

-- -- 4.9 Promover alguém a administrador sem passar pela tela:
-- update public.profiles set papel='admin' where email='fulano@perpec.com.br';
-- --     (o administrador inicial, joao@perpec.com.br, é promovido pelo
-- --      bloco 4 de 04_seed.sql — não precisa repetir aqui.)
