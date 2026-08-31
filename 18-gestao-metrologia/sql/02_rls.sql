-- =====================================================================
-- 02_rls.sql  ·  Gestão de Metrologia · Perpec Oilfield Supply
-- Permissões de coluna, Row Level Security e buckets do Storage.
--
-- Princípio: a página é pública e a chave anon é visível.
-- A proteção está no banco, nunca na tela.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. DERRUBAR TUDO E DEVOLVER O QUE FOR NECESSÁRIO
--    O Supabase concede tudo por padrão. É este bloco que impede,
--    por exemplo, alterar periodicidade ou inativar sem passar pela RPC
--    auditada.
-- ---------------------------------------------------------------------
revoke all on public.profiles, public.config, public.familias,
              public.periodicidade_fases, public.instrumentos,
              public.calibracoes, public.movimentacoes, public.documentos,
              public.inspecoes, public.auditoria
  from anon, authenticated;

-- PERFIS -------------------------------------------------------------
grant select (id, email, nome, papel, ativo, criado_em) on public.profiles to authenticated;
grant update (nome)                                     on public.profiles to authenticated;

-- CONFIG -------------------------------------------------------------
grant select (chave, valor) on public.config to authenticated;
grant update (valor)        on public.config to authenticated;   -- policy limita a admin

-- FAMÍLIAS -----------------------------------------------------------
-- Sem update de periodicidade: só a RPC alterar_periodicidade (security
-- definer) mexe nisso, e ela exige justificativa.
grant select on public.familias to authenticated;
grant insert (id, codigo, nome, periodicidade_meses, periodicidade_customizada)
  on public.familias to authenticated;
grant update (codigo, nome) on public.familias to authenticated;

-- FASES DE PERIODICIDADE ---------------------------------------------
-- Inserir na criação da família é livre; alterar/remover só pela RPC.
grant select on public.periodicidade_fases to authenticated;
grant insert (id, familia_id, ordem, intervalo_meses, vigencia_ate_meses, ancora)
  on public.periodicidade_fases to authenticated;

-- INSTRUMENTOS -------------------------------------------------------
-- condicao_fisica / motivo_inativo / justificativa_inativo ficam de fora:
-- inativação passa obrigatoriamente por inativar_instrumento().
grant select on public.instrumentos to authenticated;
grant update (fabricante, descricao, resolucao, num_serie, nota_fiscal,
              pedido_compra, localizacao_normal, standby, data_inicio_relogio,
              status_workflow)
  on public.instrumentos to authenticated;
grant insert (id, tag, familia_id, tipo, fabricante, descricao, resolucao,
              num_serie, nota_fiscal, pedido_compra, data_entrada, standby,
              localizacao_normal, origem, status_workflow)
  on public.instrumentos to authenticated;   -- usado só no import em massa
grant delete on public.instrumentos to authenticated;   -- policy limita a admin

-- CALIBRAÇÕES --------------------------------------------------------
grant select on public.calibracoes to authenticated;
grant insert (id, instrumento_id, data_calibracao, certificado_path,
              pedidos_associados, obs_metrologista, laudo_path, standby_apos)
  on public.calibracoes to authenticated;
grant update (certificado_path, pedidos_associados, obs_metrologista, laudo_path)
  on public.calibracoes to authenticated;
grant delete on public.calibracoes to authenticated;    -- policy limita a admin

-- MOVIMENTAÇÕES ------------------------------------------------------
-- Sem INSERT direto: a trava de status vive em registrar_movimentacao().
grant select on public.movimentacoes to authenticated;
grant update (data_retorno, obs_devolucao) on public.movimentacoes to authenticated;

-- DOCUMENTOS / INSPEÇÕES ---------------------------------------------
grant select, insert on public.documentos to authenticated;
grant delete         on public.documentos to authenticated;
grant select, insert on public.inspecoes  to authenticated;

-- AUDITORIA ----------------------------------------------------------
-- Sem grant de update/delete: ninguém altera a trilha pela API.
grant select on public.auditoria to authenticated;
grant insert (entidade, entidade_id, campo, valor_antigo, valor_novo,
              justificativa, usuario_email) on public.auditoria to authenticated;

-- FUNÇÕES ------------------------------------------------------------
grant execute on function public.sou_ativo()   to authenticated;
grant execute on function public.sou_admin()   to authenticated;
grant execute on function public.meu_email()   to authenticated;
grant execute on function public.cfg_int(text,int) to authenticated;
grant execute on function public.gerar_tag(uuid,text) to authenticated;
grant execute on function public.calcular_data_proxima(uuid,date,boolean) to authenticated;
grant execute on function public.criar_instrumento_completo(jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.registrar_calibracao(uuid,jsonb) to authenticated;
grant execute on function public.alterar_periodicidade(uuid,int,boolean,jsonb,text) to authenticated;
grant execute on function public.inativar_instrumento(uuid,text,text) to authenticated;
grant execute on function public.reativar_instrumento(uuid,text) to authenticated;
grant execute on function public.definir_status_workflow(uuid,text,text) to authenticated;
grant execute on function public.auditar(text,uuid,text,text,text,text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.config              enable row level security;
alter table public.familias            enable row level security;
alter table public.periodicidade_fases enable row level security;
alter table public.instrumentos        enable row level security;
alter table public.calibracoes         enable row level security;
alter table public.movimentacoes       enable row level security;
alter table public.documentos          enable row level security;
alter table public.inspecoes           enable row level security;
alter table public.auditoria           enable row level security;

-- PERFIS
drop policy if exists perfis_ler on public.profiles;
create policy perfis_ler on public.profiles
  for select to authenticated using (public.sou_ativo());

drop policy if exists perfis_editar_o_meu on public.profiles;
create policy perfis_editar_o_meu on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- CONFIG — todos leem, só admin altera
drop policy if exists config_ler on public.config;
create policy config_ler on public.config
  for select to authenticated using (public.sou_ativo());

drop policy if exists config_alterar on public.config;
create policy config_alterar on public.config
  for update to authenticated using (public.sou_admin()) with check (public.sou_admin());

-- FAMÍLIAS
drop policy if exists fam_ler on public.familias;
create policy fam_ler on public.familias
  for select to authenticated using (public.sou_ativo());
drop policy if exists fam_criar on public.familias;
create policy fam_criar on public.familias
  for insert to authenticated with check (public.sou_ativo());
drop policy if exists fam_alterar on public.familias;
create policy fam_alterar on public.familias
  for update to authenticated using (public.sou_ativo()) with check (public.sou_ativo());

-- FASES
drop policy if exists fases_ler on public.periodicidade_fases;
create policy fases_ler on public.periodicidade_fases
  for select to authenticated using (public.sou_ativo());
drop policy if exists fases_criar on public.periodicidade_fases;
create policy fases_criar on public.periodicidade_fases
  for insert to authenticated with check (public.sou_ativo());

-- INSTRUMENTOS
drop policy if exists instr_ler on public.instrumentos;
create policy instr_ler on public.instrumentos
  for select to authenticated using (public.sou_ativo());
drop policy if exists instr_criar on public.instrumentos;
create policy instr_criar on public.instrumentos
  for insert to authenticated with check (public.sou_ativo());
drop policy if exists instr_alterar on public.instrumentos;
create policy instr_alterar on public.instrumentos
  for update to authenticated using (public.sou_ativo()) with check (public.sou_ativo());
drop policy if exists instr_apagar on public.instrumentos;
create policy instr_apagar on public.instrumentos
  for delete to authenticated using (public.sou_admin());

-- CALIBRAÇÕES
drop policy if exists cal_ler on public.calibracoes;
create policy cal_ler on public.calibracoes
  for select to authenticated using (public.sou_ativo());
drop policy if exists cal_criar on public.calibracoes;
create policy cal_criar on public.calibracoes
  for insert to authenticated with check (public.sou_ativo());
drop policy if exists cal_alterar on public.calibracoes;
create policy cal_alterar on public.calibracoes
  for update to authenticated using (public.sou_ativo()) with check (public.sou_ativo());
drop policy if exists cal_apagar on public.calibracoes;
create policy cal_apagar on public.calibracoes
  for delete to authenticated using (public.sou_admin());

-- MOVIMENTAÇÕES
drop policy if exists mov_ler on public.movimentacoes;
create policy mov_ler on public.movimentacoes
  for select to authenticated using (public.sou_ativo());
drop policy if exists mov_devolver on public.movimentacoes;
create policy mov_devolver on public.movimentacoes
  for update to authenticated using (public.sou_ativo()) with check (public.sou_ativo());

-- DOCUMENTOS / INSPEÇÕES
drop policy if exists doc_ler on public.documentos;
create policy doc_ler on public.documentos
  for select to authenticated using (public.sou_ativo());
drop policy if exists doc_criar on public.documentos;
create policy doc_criar on public.documentos
  for insert to authenticated with check (public.sou_ativo());
drop policy if exists doc_apagar on public.documentos;
create policy doc_apagar on public.documentos
  for delete to authenticated using (public.sou_admin());

drop policy if exists insp_ler on public.inspecoes;
create policy insp_ler on public.inspecoes
  for select to authenticated using (public.sou_ativo());
drop policy if exists insp_criar on public.inspecoes;
create policy insp_criar on public.inspecoes
  for insert to authenticated with check (public.sou_ativo());

-- AUDITORIA — leitura e inclusão. Sem policy de update/delete:
-- combinada com os gatilhos tg_auditoria_imutavel, a trilha é append-only.
drop policy if exists aud_ler on public.auditoria;
create policy aud_ler on public.auditoria
  for select to authenticated using (public.sou_ativo());
drop policy if exists aud_criar on public.auditoria;
create policy aud_criar on public.auditoria
  for insert to authenticated with check (public.sou_ativo());

-- ---------------------------------------------------------------------
-- 3. STORAGE — buckets privados
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('certificados','certificados',false),
  ('laudos','laudos',false),
  ('fotos','fotos',false),
  ('termos','termos',false)
on conflict (id) do update set public = false;

drop policy if exists metrologia_storage_ler on storage.objects;
create policy metrologia_storage_ler on storage.objects
  for select to authenticated
  using (bucket_id in ('certificados','laudos','fotos','termos') and public.sou_ativo());

drop policy if exists metrologia_storage_enviar on storage.objects;
create policy metrologia_storage_enviar on storage.objects
  for insert to authenticated
  with check (bucket_id in ('certificados','laudos','fotos','termos') and public.sou_ativo());

drop policy if exists metrologia_storage_substituir on storage.objects;
create policy metrologia_storage_substituir on storage.objects
  for update to authenticated
  using (bucket_id in ('certificados','laudos','fotos','termos') and public.sou_ativo());

drop policy if exists metrologia_storage_apagar on storage.objects;
create policy metrologia_storage_apagar on storage.objects
  for delete to authenticated
  using (bucket_id in ('certificados','laudos','fotos','termos') and public.sou_admin());

-- ---------------------------------------------------------------------
-- 4. REALTIME — publicar as tabelas que o painel acompanha ao vivo
-- ---------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.instrumentos;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.calibracoes;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.movimentacoes; exception when duplicate_object then null; end;
end $$;
