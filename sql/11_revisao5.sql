-- =====================================================================
-- 11_revisao5.sql · Gestão de Metrologia · Perpec Oilfield Supply
--
-- MIGRAÇÃO + CORREÇÃO para um banco que JÁ ESTÁ RODANDO.
--
-- O DEFEITO (caso P-TER-07, 15/10/2026):
--   O instrumento entrou pela importação como calibrado em 17/02/2026,
--   com standby. Depois, para anexar o certificado, alguém usou "Tornar
--   calibrado" com a data de 03/02/2026 — ANTERIOR à calibração vigente.
--   Duas regras que não conversavam produziram o estado impossível:
--     · vw_instrumentos_status escolhe a vigente pela MAIOR data
--       -> continuou sendo a de 17/02, sem certificado e sem próxima
--          data (standby não tem vencimento);
--     · tg_calibracao_reflete_instrumento aplica o standby de quem
--       entrou POR ÚLTIMO -> o instrumento perdeu o standby.
--   Vigente sem próxima data + instrumento fora de standby = a view
--   cai em "descalibrado", com "Próxima calibração — · —".
--
--   O mesmo gesto, sem standby envolvido, não aparece na tela mas deixa
--   estrago: o certificado fica pendurado numa calibração escondida e a
--   vigente segue sem prova ("Abrir último certificado" some da ficha).
--
-- O QUE MUDA:
--   01_schema.sql -> tg_calibracao_data_proxima recusa calibração nova
--                    com data anterior à vigente (aponta o certificado
--                    retroativo). A tela de Tornar calibrado recusa antes
--                    de subir o PDF.
--   01_schema.sql -> RPC nova anexar_certificado_vigente: o caminho que
--                    faltava. Preenche o PDF da calibração vigente que
--                    entrou sem ele, sem criar calibração nem mexer em
--                    situação, vencimento ou standby. Na ficha, botão
--                    "Anexar certificado da calibração atual".
--   01_schema.sql -> RPC nova registrar_saida_standby: liga o relógio de
--                    validade com a data em que o instrumento SAIU do
--                    standby. Antes só o primeiro empréstimo fazia isso, e
--                    com a data de hoje. O 17/02 do P-TER-07 era isso —
--                    a saída do standby —, digitado como calibração por
--                    falta de onde pôr. Na ficha, botão "Registrar saída
--                    do standby". Correção do P-TER-07: 12_correcao_p_ter_07.sql.
--
-- COMO RODAR (SQL Editor do Supabase):
--   1) 01_schema.sql   -> a trava nova no gatilho e a RPC nova
--      02_rls.sql      -> permissão de execução da RPC nova
--      03_views.sql    -> rótulos "Calibração corrigida" e
--                         "Certificado anexado à calibração" no histórico
--   2) Este arquivo inteiro: o resultado que aparece é o RESUMO do fim
--      (uma linha por conferência). Para o detalhe de uma conferência,
--      selecione só a consulta dela e rode a seleção.
--   3) CORREÇÕES, instrumento a instrumento — estão comentadas de
--      propósito: qual data é a verdadeira só o PDF diz.
-- =====================================================================


-- ---------------------------------------------------------------------
-- CONFERÊNCIA 1 — calibrações escondidas (a causa)
--
-- Calibração NÃO retroativa gravada DEPOIS da vigente, mas com data
-- ANTERIOR a ela. Cada linha aqui é um "Tornar calibrado" que não virou
-- a calibração atual. Idealmente, lista vazia.
--
-- Leia as colunas assim:
--   instr_standby <> vigente_standby -> o instrumento está com a situação
--                                       errada na tela (caso P-TER-07);
--   vigente_tem_cert = false          -> o certificado foi parar na linha
--                                       escondida.
-- ---------------------------------------------------------------------
with vig as (
  select distinct on (instrumento_id) *
    from public.calibracoes
   where not retroativo
   order by instrumento_id, data_calibracao desc, criado_em desc
)
select i.tag,
       v.status_efetivo,
       i.status_workflow,
       i.standby                         as instr_standby,
       vig.data_calibracao               as vigente_data,
       vig.standby_apos                  as vigente_standby,
       vig.data_proxima                  as vigente_proxima,
       (vig.certificado_path is not null) as vigente_tem_cert,
       c.data_calibracao                 as escondida_data,
       c.standby_apos                    as escondida_standby,
       c.data_proxima                    as escondida_proxima,
       c.certificado_path                as escondida_cert,
       c.criado_por_email,
       c.criado_em,
       c.id                              as escondida_id,
       vig.id                            as vigente_id
  from public.calibracoes c
  join vig                         on vig.instrumento_id = c.instrumento_id
  join public.instrumentos i       on i.id = c.instrumento_id
  join public.vw_instrumentos_status v on v.id = i.id
 where not c.retroativo
   and c.id <> vig.id
   and c.criado_em > vig.criado_em
   and c.data_calibracao < vig.data_calibracao
 order by c.criado_em desc;


-- ---------------------------------------------------------------------
-- CONFERÊNCIA 2 — standby do instrumento divergindo da calibração vigente
--
-- Pega o sintoma por outro lado, inclusive se ele tiver vindo de algum
-- caminho que a conferência 1 não cobre. Idealmente, lista vazia.
-- ---------------------------------------------------------------------
select v.tag, v.status_efetivo, v.status_workflow,
       i.standby            as instr_standby,
       c.standby_apos       as vigente_standby,
       v.ultima_calibracao, v.data_proxima, i.data_inicio_relogio
  from public.vw_instrumentos_status v
  join public.instrumentos i on i.id = v.id
  join public.calibracoes c  on c.id = v.calibracao_id
 where v.tipo = 'TMMDE'
   and i.standby is distinct from c.standby_apos
 order by v.tag;


-- ---------------------------------------------------------------------
-- CONFERÊNCIA 3 — o sintoma da tela
--
-- Declarado calibrado, exibido descalibrado SEM data de vencimento.
-- Descalibrado por vencimento tem data_proxima no passado e não entra
-- aqui; este é o descalibrado que não tem explicação. Lista vazia.
-- ---------------------------------------------------------------------
select tag, descricao, status_workflow, status_efetivo, standby,
       data_inicio_relogio, ultima_calibracao, data_proxima
  from public.vw_instrumentos_status
 where tipo = 'TMMDE'
   and status_workflow = 'calibrado'
   and status_efetivo  = 'descalibrado'
   and data_proxima is null
 order by tag;


-- ---------------------------------------------------------------------
-- CONFERÊNCIA 4 — a fila de risco
--
-- Calibração vigente SEM certificado: é o acervo importado, e é
-- exatamente onde alguém ia querer "anexar o PDF" e caía no mesmo
-- buraco. Esta lista é o trabalho que ainda vem, e o caminho dele agora
-- é o botão "Anexar certificado da calibração atual" na ficha.
-- ---------------------------------------------------------------------
select v.tag, v.descricao, v.status_efetivo, v.ultima_calibracao, v.data_proxima
  from public.vw_instrumentos_status v
 where v.tipo = 'TMMDE'
   and v.calibracao_id is not null
   and coalesce(btrim(v.certificado_path),'') = ''
 order by v.tag;


-- =====================================================================
-- CORREÇÕES — uma por instrumento, depois de abrir o PDF
--
-- Para cada linha da CONFERÊNCIA 1, abra o certificado da linha
-- escondida e responda: a calibração do PDF é a MESMA da vigente
-- (a data importada estava errada) ou é OUTRA, mais antiga?
--
-- Troque a tag e as datas e rode o bloco do cenário certo. Cada bloco é
-- uma transação: se algo não bater, nada fica pela metade.
-- O exemplo está preenchido com o P-TER-07.
-- =====================================================================

-- ---------------------------------------------------------------------
-- CENÁRIO A — o PDF é a calibração VERDADEIRA e a data importada estava
-- errada (a planilha disse 17/02, o certificado diz 03/02).
--
-- A linha importada (sem certificado, data errada) sai; a do PDF vira a
-- vigente — ela já tem próxima data calculada e o instrumento já está
-- sem standby, então a situação se acerta sozinha.
-- A remoção fica registrada na auditoria do instrumento.
-- ---------------------------------------------------------------------
-- begin;
--   insert into public.auditoria (entidade, entidade_id, campo, valor_antigo, valor_novo, justificativa, usuario_email)
--   select 'instrumentos', i.id, 'calibracao_corrigida',
--          'Calibração importada de ' || to_char(c.data_calibracao,'DD/MM/YYYY') || ' (sem certificado)',
--          'Removida — vale a de 03/02/2026, com certificado',
--          'Data da importação não confere com o certificado. Correção da revisão 5.',
--          'correcao-sql'
--     from public.calibracoes c join public.instrumentos i on i.id = c.instrumento_id
--    where i.tag = 'P-TER-07' and c.data_calibracao = '2026-02-17' and not c.retroativo;
--
--   delete from public.calibracoes c
--    using public.instrumentos i
--    where i.id = c.instrumento_id and i.tag = 'P-TER-07'
--      and c.data_calibracao = '2026-02-17' and not c.retroativo
--      and coalesce(btrim(c.certificado_path),'') = '';
-- commit;

-- ---------------------------------------------------------------------
-- CENÁRIO B — o PDF é de uma calibração MAIS ANTIGA, e a importada
-- (17/02) é a vigente de verdade.
--
-- B.1 A linha do PDF vira retroativa: sai do cálculo e perde o
--     vencimento. O gatilho não roda numa mudança de `retroativo`, por
--     isso a data_proxima é zerada aqui.
-- B.2 O standby do instrumento volta a ser o da vigente — ele estava em
--     standby antes do "Tornar calibrado" errado.
--     Se o standby da PLANILHA é que estava errado (o instrumento está
--     em uso), rode B.2-alternativo em vez do B.2: a vigente perde o
--     standby, o gatilho recalcula o vencimento (17/02/2026 + 12 meses
--     = 28/02/2027) e o instrumento fica calibrado com prazo.
-- ---------------------------------------------------------------------
-- begin;
--   -- B.1
--   update public.calibracoes c
--      set retroativo = true, data_proxima = null
--     from public.instrumentos i
--    where i.id = c.instrumento_id and i.tag = 'P-TER-07'
--      and c.data_calibracao = '2026-02-03' and not c.retroativo;
--
--   -- B.2 — instrumento de volta ao standby da vigente
--   update public.instrumentos i
--      set standby = c.standby_apos
--     from public.vw_instrumentos_status v
--     join public.calibracoes c on c.id = v.calibracao_id
--    where v.id = i.id and i.tag = 'P-TER-07';
--
--   -- B.2-alternativo — a vigente não estava em standby
--   -- update public.calibracoes c
--   --    set standby_apos = false
--   --   from public.instrumentos i
--   --  where i.id = c.instrumento_id and i.tag = 'P-TER-07'
--   --    and c.data_calibracao = '2026-02-17' and not c.retroativo;
--
--   insert into public.auditoria (entidade, entidade_id, campo, valor_antigo, valor_novo, justificativa, usuario_email)
--   select 'instrumentos', i.id, 'calibracao_corrigida',
--          'Calibração de 03/02/2026 registrada como atual',
--          'Reclassificada como certificado retroativo',
--          'Registrada por "Tornar calibrado" com data anterior à vigente. Correção da revisão 5.',
--          'correcao-sql'
--     from public.instrumentos i where i.tag = 'P-TER-07';
-- commit;

-- ---------------------------------------------------------------------
-- DEPOIS DE CORRIGIR: as conferências 1, 2 e 3 devem voltar vazias, e a
-- ficha do instrumento deve mostrar a próxima data (ou "sem contagem",
-- se ele ficou em standby).
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- RESUMO — as quatro conferências numa tabela só
--
-- O SQL Editor do Supabase, rodando o arquivo inteiro, mostra só o
-- resultado da ÚLTIMA consulta. Por isso este resumo fica por último:
-- uma linha por conferência, com a quantidade e as tags. Para ver o
-- detalhe de uma delas, selecione a consulta lá em cima e rode só ela.
-- ---------------------------------------------------------------------
with vig as (
  select distinct on (instrumento_id) *
    from public.calibracoes
   where not retroativo
   order by instrumento_id, data_calibracao desc, criado_em desc
),
c1 as (
  select distinct i.tag
    from public.calibracoes c
    join vig                   on vig.instrumento_id = c.instrumento_id
    join public.instrumentos i on i.id = c.instrumento_id
   where not c.retroativo and c.id <> vig.id
     and c.criado_em > vig.criado_em
     and c.data_calibracao < vig.data_calibracao
),
c2 as (
  select v.tag
    from public.vw_instrumentos_status v
    join public.instrumentos i on i.id = v.id
    join public.calibracoes c  on c.id = v.calibracao_id
   where v.tipo = 'TMMDE' and i.standby is distinct from c.standby_apos
),
c3 as (
  select tag from public.vw_instrumentos_status
   where tipo = 'TMMDE' and status_workflow = 'calibrado'
     and status_efetivo = 'descalibrado' and data_proxima is null
),
c4 as (
  select tag from public.vw_instrumentos_status
   where tipo = 'TMMDE' and calibracao_id is not null
     and coalesce(btrim(certificado_path),'') = ''
),
-- Em standby com o relógio parado: validade indefinida. Vale conferir na
-- prateleira — o que já saiu para uso precisa de "Registrar saída do
-- standby", senão nunca vence.
c5 as (
  select tag from public.vw_instrumentos_status
   where tipo = 'TMMDE' and standby and data_inicio_relogio is null
     and condicao_fisica = 'ativo'
)
select '1 · calibração escondida (causa) — deve ser 0' as conferencia,
       count(*) as qtd, string_agg(tag, ', ' order by tag) as tags from c1
union all
select '2 · standby divergente — deve ser 0', count(*), string_agg(tag, ', ' order by tag) from c2
union all
select '3 · calibrado sem data, exibido descalibrado — deve ser 0', count(*), string_agg(tag, ', ' order by tag) from c3
union all
select '4 · calibração atual sem certificado — fila do botão novo', count(*), string_agg(tag, ', ' order by tag) from c4
union all
select '5 · em standby sem contagem — conferir se ainda estão guardados', count(*), string_agg(tag, ', ' order by tag) from c5;
