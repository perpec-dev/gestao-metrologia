-- =====================================================================
-- 10_revisao4.sql · Gestão de Metrologia · Perpec Oilfield Supply
--
-- MIGRAÇÃO para um banco que JÁ ESTÁ RODANDO.
-- Instalação nova não precisa deste arquivo: 01 a 04 já trazem tudo.
--
-- O que esta revisão traz:
--   1. CERTIFICADO RETROATIVO. O acervo antigo entrou por importação em
--      massa e a planilha não carrega PDF, então todo o passado de
--      calibração ficou de fora. A única porta para anexar um
--      certificado era "Tornar calibrado", que registra calibração NOVA
--      — e faria um instrumento descalibrado hoje aparecer como
--      calibrado por causa de um papel de 2023.
--
--      Agora a ficha tem "Certificado retroativo": pede o PDF e a data
--      daquela calibração, e grava a linha marcada como histórica.
--
-- POR QUE ESTE ARQUIVO PRECISA RODAR PRIMEIRO
--   `calibracoes` é criada com `create table if not exists`, e isso NÃO
--   acrescenta coluna em tabela que já existe. Rodar o 01 antes deste
--   arquivo deixaria a coluna `retroativo` faltando, e tanto os gatilhos
--   quanto a vw_instrumentos_status quebrariam ao referenciá-la.
--
-- COMO RODAR (SQL Editor do Supabase, nesta ordem):
--   1) este arquivo   -> a coluna nova
--   2) 01_schema.sql  -> gatilhos e a RPC registrar_certificado_retroativo
--   3) 02_rls.sql     -> permissão de execução da função nova
--   4) 03_views.sql   -> status ignora retroativo; histórico e pasta o rotulam
--
-- Rodar de novo não faz mal: tudo aqui é idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. COLUNA NOVA
--
-- Toda calibração já gravada é vigente, não histórica — por isso o
-- default `false` está certo para o acervo inteiro que já existe.
-- ---------------------------------------------------------------------
alter table public.calibracoes
  add column if not exists retroativo boolean not null default false;

comment on column public.calibracoes.retroativo is
  'Certificado antigo anexado depois para completar o histórico. Não move a '
  'situação do instrumento (tg_calibracao_reflete_instrumento sai fora), não '
  'tem vencimento (data_proxima fica nula) e é ignorado por '
  'vw_instrumentos_status na escolha da última calibração.';


-- ---------------------------------------------------------------------
-- CONFERÊNCIA 1 — os retroativos, instrumento a instrumento
--
-- Toda linha aqui deve ter `data_proxima` NULA: certificado retroativo
-- não carrega prazo. E a `data_calibracao` deve ser sempre anterior à
-- coluna `vigente`, que é a calibração que governa a validade.
-- ---------------------------------------------------------------------
select i.tag,
       c.data_calibracao,
       c.data_proxima,
       (select max(x.data_calibracao) from public.calibracoes x
         where x.instrumento_id = i.id and not x.retroativo) as vigente,
       c.criado_por_email,
       c.criado_em
  from public.calibracoes c
  join public.instrumentos i on i.id = c.instrumento_id
 where c.retroativo
 order by i.tag, c.data_calibracao desc;


-- ---------------------------------------------------------------------
-- CONFERÊNCIA 2 — a situação não pode ter mudado
--
-- Compara o que a view diz ser a última calibração com o maior
-- data_calibracao NÃO retroativo. As duas colunas têm de bater sempre;
-- se divergirem, algum retroativo vazou para o cálculo do status.
-- Idealmente, lista vazia.
-- ---------------------------------------------------------------------
select v.tag, v.ultima_calibracao, m.maior_vigente, v.status_efetivo
  from public.vw_instrumentos_status v
  join lateral (
    select max(data_calibracao) as maior_vigente
      from public.calibracoes
     where instrumento_id = v.id and not retroativo
  ) m on true
 where v.ultima_calibracao is distinct from m.maior_vigente
 order by v.tag;
