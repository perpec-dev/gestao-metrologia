/* =====================================================================
   Cliente Supabase (singleton) e camada de dados.

   Nenhuma tela monta query solta: toda leitura e toda gravação passa
   por uma função nomeada aqui, para ficar visível no código o que sai
   da máquina — e para as regras de negócio terem um só lugar.
   ===================================================================== */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { CONFIG } from './config.js';
import { nomeSeguro, msgErro } from './utils.js';

/* A biblioteca acrescenta /rest/v1 sozinha — remova se vier no config. */
function urlBase(u){
  return String(u || '').trim().replace(/\/+$/,'')
    .replace(/\/(rest|auth|storage|realtime)\/v1$/i,'').replace(/\/+$/,'');
}

export const sb = createClient(urlBase(CONFIG.SUPABASE_URL), CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

export const configurado = () =>
  /^https:\/\/.+\.supabase\.co$/.test(urlBase(CONFIG.SUPABASE_URL)) &&
  CONFIG.SUPABASE_ANON_KEY.length > 40;

/* Toda resposta do PostgREST passa por aqui: erro vira exceção legível. */
function ok(res){
  if (res.error) throw new Error(msgErro(res.error));
  return res.data;
}

/* ===================================================================
   CONFIGURAÇÕES (chave-valor) — lidas uma vez e guardadas em memória
   =================================================================== */
let _config = null;

export async function carregarConfig(forcar = false){
  if (_config && !forcar) return _config;
  const linhas = ok(await sb.from('config').select('chave,valor'));
  _config = Object.fromEntries(linhas.map(l => [l.chave, l.valor]));
  return _config;
}
export const cfg      = (chaveCfg, padrao = '') => (_config && _config[chaveCfg] != null) ? _config[chaveCfg] : padrao;
export const cfgInt   = (chaveCfg, padrao = 0)  => parseInt(cfg(chaveCfg, String(padrao)), 10) || padrao;
export const cfgLista = (chaveCfg)              => cfg(chaveCfg,'').split(',').map(s => s.trim()).filter(Boolean);

export async function salvarConfig(chaveCfg, valor){
  ok(await sb.from('config').update({ valor: String(valor) }).eq('chave', chaveCfg).select());
  if (_config) _config[chaveCfg] = String(valor);
}

/* ===================================================================
   FAMÍLIAS E PERIODICIDADE
   =================================================================== */
export const listarFamilias = async () =>
  ok(await sb.from('familias').select('*').order('codigo'));

export const listarFases = async familiaId =>
  ok(await sb.from('periodicidade_fases').select('*').eq('familia_id', familiaId).order('ordem'));

export const listarTodasFases = async () =>
  ok(await sb.from('periodicidade_fases').select('*').order('familia_id').order('ordem'));

export async function criarFamilia({ codigo, nome, periodicidade_meses, periodicidade_customizada, fases }){
  const fam = ok(await sb.from('familias').insert({
    codigo: codigo.trim().toUpperCase(), nome: nome.trim(),
    periodicidade_meses, periodicidade_customizada: !!periodicidade_customizada
  }).select().single());

  if (periodicidade_customizada && fases && fases.length){
    ok(await sb.from('periodicidade_fases').insert(
      fases.map((f, i) => ({
        familia_id: fam.id, ordem: f.ordem ?? (i+1),
        intervalo_meses: f.intervalo_meses,
        vigencia_ate_meses: f.vigencia_ate_meses ?? null,
        ancora: f.ancora || 'entrada'
      }))
    ).select());
  }
  return fam;
}

/** Alteração de periodicidade: sempre auditada, justificativa obrigatória. */
export async function alterarPeriodicidade({ familia_id, periodicidade_meses, customizada, fases, justificativa }){
  return ok(await sb.rpc('alterar_periodicidade', {
    p_familia_id: familia_id,
    p_periodicidade: periodicidade_meses,
    p_customizada: !!customizada,
    p_fases: fases || [],
    p_justificativa: justificativa
  }));
}

/* ===================================================================
   INSTRUMENTOS
   =================================================================== */
export const listarInstrumentos = async () =>
  ok(await sb.from('vw_instrumentos_status').select('*').order('tag'));

export const buscarInstrumento = async id =>
  ok(await sb.from('vw_instrumentos_status').select('*').eq('id', id).single());

/** Filtros aplicados no servidor (usado pelos relatórios). */
export async function consultarInstrumentos(filtros = {}){
  let q = sb.from('vw_instrumentos_status').select('*');
  if (filtros.status_efetivo?.length)  q = q.in('status_efetivo', filtros.status_efetivo);
  if (filtros.familia_id)              q = q.eq('familia_id', filtros.familia_id);
  if (filtros.condicao_fisica)         q = q.eq('condicao_fisica', filtros.condicao_fisica);
  if (filtros.tipo)                    q = q.eq('tipo', filtros.tipo);
  if (filtros.proxima_de)              q = q.gte('data_proxima', filtros.proxima_de);
  if (filtros.proxima_ate)             q = q.lte('data_proxima', filtros.proxima_ate);
  if (filtros.calibracao_de)           q = q.gte('ultima_calibracao', filtros.calibracao_de);
  if (filtros.calibracao_ate)          q = q.lte('ultima_calibracao', filtros.calibracao_ate);
  return ok(await q.order('tag'));
}

export const proximaTag = async (familia_id, tipo) =>
  ok(await sb.rpc('gerar_tag', { p_familia_id: familia_id, p_tipo: tipo }));

/** Recebimento e cadastro avulso: instrumento + inspeção + 1ª calibração
    numa única transação no servidor. */
export const criarInstrumentoCompleto = async (instrumento, inspecao, calibracao) =>
  ok(await sb.rpc('criar_instrumento_completo', {
    p_instrumento: instrumento,
    p_inspecao:    inspecao   || null,
    p_calibracao:  calibracao || null
  }));

/** Import em massa: uma tag por linha, geradas em sequência antes do insert. */
export async function importarInstrumentos(linhas){
  const criados = [];
  for (const l of linhas){
    criados.push(await criarInstrumentoCompleto(l, null, null));
  }
  return criados;
}

export const atualizarInstrumento = async (id, campos) =>
  ok(await sb.from('instrumentos').update(campos).eq('id', id).select().single());

export const definirStatusWorkflow = async (id, status, justificativa = null) =>
  ok(await sb.rpc('definir_status_workflow', {
    p_instrumento_id: id, p_status: status, p_justificativa: justificativa
  }));

export const inativarInstrumento = async (id, motivo, justificativa) =>
  ok(await sb.rpc('inativar_instrumento', {
    p_instrumento_id: id, p_motivo: motivo, p_justificativa: justificativa
  }));

export const reativarInstrumento = async (id, justificativa) =>
  ok(await sb.rpc('reativar_instrumento', {
    p_instrumento_id: id, p_justificativa: justificativa
  }));

/* ===================================================================
   CALIBRAÇÕES
   =================================================================== */
export const listarCalibracoes = async instrumentoId =>
  ok(await sb.from('calibracoes').select('*')
       .eq('instrumento_id', instrumentoId).order('data_calibracao', { ascending:false }));

export const registrarCalibracao = async (instrumentoId, dados) =>
  ok(await sb.rpc('registrar_calibracao', { p_instrumento_id: instrumentoId, p_dados: dados }));

/* ===================================================================
   MOVIMENTAÇÕES
   =================================================================== */
export const listarEmprestimosAbertos = async () =>
  ok(await sb.from('vw_emprestimos_abertos').select('*').order('data_saida'));

export const listarMovimentacoes = async instrumentoId =>
  ok(await sb.from('movimentacoes').select('*')
       .eq('instrumento_id', instrumentoId).order('data_saida', { ascending:false }));

/** A trava de status vive no banco; aqui só repassamos. */
export const registrarMovimentacao = async (instrumentoId, dados) =>
  ok(await sb.rpc('registrar_movimentacao', { p_instrumento_id: instrumentoId, p_dados: dados }));

export const registrarDevolucao = async (movimentacaoId, obs) =>
  ok(await sb.rpc('registrar_devolucao', { p_movimentacao_id: movimentacaoId, p_obs: obs || null }));

/* ===================================================================
   LINHA DO TEMPO E DOCUMENTOS
   =================================================================== */
export const listarTimeline = async instrumentoId =>
  ok(await sb.from('vw_timeline').select('*')
       .eq('instrumento_id', instrumentoId).order('quando', { ascending:false }));

export const listarDocumentos = async instrumentoId =>
  ok(await sb.from('documentos').select('*').eq('instrumento_id', instrumentoId)
       .order('criado_em', { ascending:false }));

export const anexarDocumento = async doc =>
  ok(await sb.from('documentos').insert(doc).select().single());

/* ===================================================================
   STORAGE
   =================================================================== */
export async function enviarArquivo(bucket, arquivo, prefixo = ''){
  if (!arquivo) return null;
  const limiteMB = /^image\//.test(arquivo.type) ? CONFIG.MAX_MB_FOTO : CONFIG.MAX_MB_PDF;
  if (arquivo.size > limiteMB * 1024 * 1024)
    throw new Error(`Arquivo maior que ${limiteMB} MB. Comprima o documento antes de enviar.`);

  const caminho = (prefixo ? prefixo.replace(/\/+$/,'')+'/' : '') +
                  Date.now() + '-' + nomeSeguro(arquivo.name);
  const { error } = await sb.storage.from(bucket).upload(caminho, arquivo, {
    cacheControl: '3600', upsert: false, contentType: arquivo.type || undefined
  });
  if (error) throw new Error(msgErro(error));
  return caminho;
}

/** Link temporário (1 h). Buckets são privados: não existe URL pública. */
export async function urlAssinada(bucket, caminho, segundos = 3600){
  if (!caminho) return null;
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(caminho, segundos);
  if (error) throw new Error(msgErro(error));
  return data.signedUrl;
}

export async function abrirArquivo(bucket, caminho){
  const url = await urlAssinada(bucket, caminho);
  if (url) window.open(url, '_blank', 'noopener');
}

/* ===================================================================
   ADMINISTRAÇÃO — perfis, permissões e trilha
   Toda alteração passa por RPC: as colunas papel e ativo não têm
   GRANT de UPDATE para o cliente.
   =================================================================== */
export const listarUsuarios = async () =>
  ok(await sb.from('profiles').select('*').order('papel').order('email'));

export const definirPapel = async (usuarioId, papel) =>
  ok(await sb.rpc('definir_papel', { p_usuario: usuarioId, p_papel: papel }));

export const definirAtivo = async (usuarioId, ativo) =>
  ok(await sb.rpc('definir_ativo', { p_usuario: usuarioId, p_ativo: ativo }));

export const definirNomeUsuario = async (usuarioId, nome) =>
  ok(await sb.rpc('definir_nome_usuario', { p_usuario: usuarioId, p_nome: nome }));

export async function listarAuditoria({ entidade = null, limite = 300 } = {}){
  let q = sb.from('auditoria').select('*').order('criado_em', { ascending:false }).limit(limite);
  if (entidade) q = q.eq('entidade', entidade);
  return ok(await q);
}

/* ===================================================================
   MANUTENÇÃO EM MASSA
   Apagar instrumento leva junto, por cascata, calibrações, inspeções,
   movimentações e documentos. A auditoria fica — e registra o
   apagamento. Só administrador; a trava está no banco.
   =================================================================== */
export const apagarInstrumentos = async (ids, justificativa) =>
  ok(await sb.rpc('apagar_instrumentos', { p_ids: ids, p_justificativa: justificativa }));

export const apagarTodosInstrumentos = async (confirmacao, justificativa) =>
  ok(await sb.rpc('apagar_todos_instrumentos', {
    p_confirmacao: confirmacao, p_justificativa: justificativa }));

export const apagarInstrumentosDaFamilia = async (familiaId, justificativa) =>
  ok(await sb.rpc('apagar_instrumentos_da_familia', {
    p_familia_id: familiaId, p_justificativa: justificativa }));

/* ===================================================================
   REALTIME
   Um canal por tela. destroy() da página desliga.
   =================================================================== */
export function ouvir(nome, tabelas, aoMudar){
  const canal = sb.channel(nome);
  tabelas.forEach(t => canal.on('postgres_changes',
    { event:'*', schema:'public', table:t },
    payload => aoMudar(t, payload)));
  canal.subscribe();
  return () => { try { sb.removeChannel(canal); } catch(e){} };
}
