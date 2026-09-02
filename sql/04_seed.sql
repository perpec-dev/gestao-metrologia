-- =====================================================================
-- 04_seed.sql  ·  Gestão de Metrologia · Perpec Oilfield Supply
-- Configurações obrigatórias e famílias iniciais.
-- Pode ser rodado mais de uma vez sem duplicar nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CONFIGURAÇÕES
--    Alteráveis na tela por quem tem papel 'admin'.
-- ---------------------------------------------------------------------
insert into public.config (chave, valor) values
  -- Quantos dias antes do vencimento o instrumento entra em "próximo do
  -- vencimento" (âmbar) no painel e na lista de calibração.
  ('dias_proximo_vencimento', '15'),

  -- Lista do campo "setor" no empréstimo. Separada por vírgula.
  ('setores', 'Qualidade,Produção,Manutenção,Logística,Engenharia'),

  -- Empréstimo casual sem devolução após N dias vira lembrete no painel.
  ('prazo_alerta_emprestimo_casual_dias', '30'),

  -- Empréstimo externo em aberto após N dias vira lembrete no painel.
  ('prazo_alerta_emprestimo_externo_dias', '7'),

  -- Motivos oferecidos ao inativar um instrumento no inventário.
  -- "Outros" fica por último de propósito: é a saída de emergência da
  -- lista, e obriga o usuário a descrever a segregação na justificativa.
  ('motivos_inativacao',
   'Sucateado,Vago,Não entregue,Danificado,Não encontrado,Necessário manutenção,Outros'),

  -- Controle mensal de vencimentos: 'sim' empurra a próxima calibração
  -- para o ÚLTIMO DIA do mês de vencimento. Calibrado em 20/08/2025 com
  -- periodicidade de 12 meses vence em 31/08/2026, não em 20/08/2026.
  -- 'nao' volta ao vencimento no dia exato.
  ('vencimento_fim_do_mes', 'sim')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- 2. FAMÍLIAS INICIAIS
--    O código vira o miolo da tag: PAQ -> P-PAQ-01 / PR-PAQ-01.
--    Ajuste a periodicidade conforme o plano de calibração da empresa.
-- ---------------------------------------------------------------------
insert into public.familias (codigo, nome, periodicidade_meses, periodicidade_customizada) values
  ('PAQ', 'Paquímetro',                    12, false),
  ('MIC', 'Micrômetro',                    12, false),
  ('REL', 'Relógio comparador',            12, false),
  ('SUB', 'Súbito (medidor interno)',      12, false),
  ('TOR', 'Torquímetro',                    6, false),
  ('MAN', 'Manômetro',                     12, false),
  ('TER', 'Termômetro',                    12, false),
  ('TRE', 'Trena / régua',                 24, false),
  ('GON', 'Goniômetro',                    24, false),
  ('NIV', 'Nível de precisão',             24, false),
  ('BAL', 'Balança',                       12, false),
  ('DUR', 'Durômetro',                     12, false),
  ('BLP', 'Blocos padrão',                 36, false)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------
-- 3. EXEMPLO DE PERIODICIDADE CUSTOMIZADA
--    Blocos padrão: mais frequente enquanto novos, espaçando com a idade.
--    Âncora 'entrada' = a idade conta a partir da entrada no acervo.
--    A última fase tem vigencia_ate_meses NULL: vale indefinidamente.
-- ---------------------------------------------------------------------
do $$
declare v_fam uuid;
begin
  select id into v_fam from public.familias where codigo = 'BLP';
  if v_fam is not null and not exists (select 1 from public.periodicidade_fases where familia_id = v_fam) then
    update public.familias set periodicidade_customizada = true where id = v_fam;

    insert into public.periodicidade_fases (familia_id, ordem, intervalo_meses, vigencia_ate_meses, ancora) values
      (v_fam, 1, 12,   24, 'entrada'),   -- até 2 anos de idade: a cada 12 meses
      (v_fam, 2, 24,   60, 'entrada'),   -- de 2 a 5 anos:       a cada 24 meses
      (v_fam, 3, 36, null, 'entrada');   -- acima de 5 anos:     a cada 36 meses
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. PRIMEIRO ADMINISTRADOR — joao@perpec.com.br
--
--    O perfil nasce sozinho pelo gatilho on_auth_user_created, sempre
--    como 'metrologista'. Este bloco promove o administrador da
--    metrologia a 'admin'.
--
--    ORDEM IMPORTA: crie o usuário ANTES, em
--    Authentication -> Users -> Add user, com Auto Confirm ligado.
--    Rodar isto antes disso não promove ninguém — por isso o bloco
--    AVISA em vez de falhar em silêncio, que é o erro que custa horas.
--
--    Pode rodar quantas vezes quiser.
-- ---------------------------------------------------------------------
do $$
declare
  v_email text := 'joao@perpec.com.br';
  v_nome  text := 'João Amaral';
  v_id    uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(v_email);

  if v_id is null then
    raise warning
      'Usuário % ainda não existe no Auth. Crie em Authentication -> Users -> Add user (Auto Confirm ligado) e rode este bloco de novo.',
      v_email;
    return;
  end if;

  -- O gatilho pode não ter rodado se o esquema foi instalado depois do usuário.
  insert into public.profiles (id, email, nome, papel, ativo)
  values (v_id, lower(v_email), v_nome, 'admin', true)
  on conflict (id) do update
    set papel = 'admin',
        ativo = true,
        nome  = coalesce(nullif(btrim(public.profiles.nome), ''), excluded.nome);

  raise notice 'Pronto: % é administrador e está ativo.', v_email;
end $$;

-- ---------------------------------------------------------------------
-- 5. CONFERÊNCIA
-- ---------------------------------------------------------------------
-- select chave, valor from public.config order by chave;
-- select codigo, nome, periodicidade_meses, periodicidade_customizada from public.familias order by codigo;
-- select f.codigo, p.ordem, p.intervalo_meses, p.vigencia_ate_meses, p.ancora
--   from public.periodicidade_fases p join public.familias f on f.id = p.familia_id
--  order by f.codigo, p.ordem;
