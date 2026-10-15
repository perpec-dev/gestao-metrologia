-- =====================================================================
-- 12_correcao_p_ter_07.sql · Gestão de Metrologia · Perpec Oilfield Supply
--
-- CORREÇÃO DE DADOS de um instrumento só: P-TER-07.
-- Rodar DEPOIS de 01, 02 e 03 da revisão 5 (11_revisao5.sql).
--
-- O que estava gravado (15/10/2026), cinco calibrações vigentes:
--   03/02/2026 · importação (joao, 17/09)        · sem certificado
--   17/02/2026 · standby     (sarah, 13/10)       · sem certificado
--   03/02/2026 ·             (sarah, 13/10)       · sem certificado
--   03/02/2026 ·             (sarah, 14/10)       · sem certificado
--   03/02/2026 ·             (sarah, 15/10)       · COM certificado
--
-- O que é verdade, conferido no PDF e com a metrologia:
--   · calibrado em 17/01/2026 (data do certificado);
--   · guardado em standby depois da calibração;
--   · saiu do standby em 17/02/2026.
-- 17/02 era a SAÍDA DO STANDBY, e não uma calibração: não havia onde
-- registrar essa data, e cada tentativa virou uma linha nova. Esse
-- caminho agora existe (registrar_saida_standby, botão na ficha).
--
-- O que este arquivo faz, numa transação só:
--   1. mantém a linha COM certificado e apaga as outras quatro (nenhuma
--      tem certificado, laudo ou documento — o bloco confere antes);
--   2. corrige a data dela para 17/01/2026, com standby;
--   3. liga o relógio em 17/02/2026 e recalcula o vencimento:
--      17/02/2026 + 12 meses = 17/02/2027 -> fim do mês = 28/02/2027;
--   4. registra tudo na auditoria do instrumento.
--
-- Rodar duas vezes não faz mal: se já estiver corrigido, o bloco avisa e
-- não mexe em nada.
-- =====================================================================

do $$
declare
  -- Quem está executando a correção: vai para a trilha de auditoria.
  v_autor    text := 'joao@perpec.com.br';
  v_tag      text := 'P-TER-07';
  v_data_cal date := '2026-01-17';
  v_saida    date := '2026-02-17';

  v_instr    uuid;
  v_manter   uuid;
  v_qtd_cert int;
  v_apagadas text;
  v_prox     date;
begin
  select id into v_instr from public.instrumentos where tag = v_tag;
  if v_instr is null then raise exception 'Instrumento % não encontrado.', v_tag; end if;

  -- Já corrigido? Uma vigente só, na data certa, com o relógio ligado.
  if (select count(*) from public.calibracoes
       where instrumento_id = v_instr and not retroativo) = 1
     and exists (select 1 from public.calibracoes
                  where instrumento_id = v_instr and not retroativo
                    and data_calibracao = v_data_cal)
     and (select data_inicio_relogio from public.instrumentos where id = v_instr) is not null
  then
    raise notice '% já está corrigido. Nada foi alterado.', v_tag;
    return;
  end if;

  -- A linha que fica é a ÚNICA com certificado. Mais de uma, ou nenhuma,
  -- quer dizer que o banco mudou desde a conferência: parar e olhar.
  select count(*) into v_qtd_cert
    from public.calibracoes
   where instrumento_id = v_instr and not retroativo
     and coalesce(btrim(certificado_path),'') <> '';
  if v_qtd_cert <> 1 then
    raise exception '% tem % calibração(ões) com certificado; esperado 1. Confira antes de corrigir.',
      v_tag, v_qtd_cert;
  end if;

  select id into v_manter
    from public.calibracoes
   where instrumento_id = v_instr and not retroativo
     and coalesce(btrim(certificado_path),'') <> '';

  -- Nada que vá ser apagado pode carregar prova: laudo ou documento
  -- pendurado (documentos.calibracao_id apaga em cascata).
  if exists (select 1 from public.calibracoes c
              where c.instrumento_id = v_instr and not c.retroativo and c.id <> v_manter
                and coalesce(btrim(c.laudo_path),'') <> '')
     or exists (select 1 from public.documentos d
                  join public.calibracoes c on c.id = d.calibracao_id
                 where c.instrumento_id = v_instr and not c.retroativo and c.id <> v_manter)
  then
    raise exception 'Alguma calibração a apagar de % tem laudo ou documento. Confira antes de corrigir.', v_tag;
  end if;

  -- O que sai fica descrito na trilha, com o que cada linha carregava.
  select string_agg(
           to_char(data_calibracao,'DD/MM/YYYY')
           || case when standby_apos then ' (standby)' else '' end
           || ' por ' || coalesce(criado_por_email,'?')
           || ' em '  || to_char(criado_em at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')
           || coalesce(' · pedido ' || nullif(btrim(pedidos_associados),''), '')
           || coalesce(' · obs: '   || nullif(btrim(obs_metrologista),''), ''),
           '; ' order by criado_em)
    into v_apagadas
    from public.calibracoes
   where instrumento_id = v_instr and not retroativo and id <> v_manter;

  -- 1. As quatro linhas sem certificado saem.
  delete from public.calibracoes
   where instrumento_id = v_instr and not retroativo and id <> v_manter;

  -- 2. A linha do certificado ganha a data e o standby verdadeiros. O
  --    gatilho grava data_proxima NULL (standby): o passo 3 recalcula.
  update public.calibracoes
     set data_calibracao = v_data_cal,
         standby_apos    = true
   where id = v_manter;

  -- 3. Standby com o relógio ligado na saída — o mesmo estado que o
  --    primeiro empréstimo deixaria. Meio-dia pelo mesmo motivo de
  --    registrar_saida_standby: meia-noite UTC é o dia anterior em Brasília.
  update public.instrumentos
     set standby             = true,
         data_inicio_relogio = (v_saida + time '12:00')::timestamptz
   where id = v_instr;

  v_prox := public.calcular_data_proxima(v_instr, v_data_cal, false);
  update public.calibracoes set data_proxima = v_prox where id = v_manter;

  -- 4. Trilha.
  insert into public.auditoria (entidade, entidade_id, campo, valor_antigo, valor_novo, justificativa, usuario_email)
  values
    ('instrumentos', v_instr, 'calibracao_corrigida', v_apagadas,
     'Calibração vigente: ' || to_char(v_data_cal,'DD/MM/YYYY') || ', com certificado, guardada em standby',
     '17/02/2026 era a saída do standby, registrada como calibração por falta de campo próprio; '
       || 'calibrações duplicadas sem certificado removidas. Data conferida no certificado. Correção da revisão 5.',
     v_autor),
    ('instrumentos', v_instr, 'data_inicio_relogio', null,
     'Saída do standby em ' || to_char(v_saida,'DD/MM/YYYY')
       || ' · próxima calibração ' || coalesce(to_char(v_prox,'DD/MM/YYYY'),'—'),
     'Data informada pela metrologia na correção da revisão 5.',
     v_autor);

  raise notice '% corrigido: calibração %, saída do standby %, próxima %.',
    v_tag, to_char(v_data_cal,'DD/MM/YYYY'), to_char(v_saida,'DD/MM/YYYY'), to_char(v_prox,'DD/MM/YYYY');
end $$;

-- Conferência: uma linha só, status 'calibrado', próxima 2027-02-28.
select tag, status_efetivo, status_workflow, standby, data_inicio_relogio,
       ultima_calibracao, data_proxima, dias_para_vencer,
       (certificado_path is not null) as tem_cert
  from public.vw_instrumentos_status
 where tag = 'P-TER-07';
