/* =====================================================================
   Autenticação e guarda de rota.

   Regra de ouro: no app.html nada é renderizado antes da sessão estar
   confirmada. Nenhum dado pode piscar na tela antes da identificação.
   ===================================================================== */
import { sb, configurado } from './supabase.js';
import { esquecerTudo, msgErro } from './utils.js';

let _perfil = null;

export const perfil    = () => _perfil;
export const souAdmin  = () => !!_perfil && _perfil.papel === 'admin';
export const meuNome   = () => _perfil ? (_perfil.nome || _perfil.email) : '';
export const meuEmail  = () => _perfil ? _perfil.email : '';

/** Sessão + perfil. Retorna null se não houver ninguém logado. */
export async function carregarSessao(){
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { _perfil = null; return null; }

  const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  if (error || !data){
    // Usuário existe no Auth mas não tem perfil (gatilho não rodou, ou
    // o esquema foi instalado depois do usuário). Falhar em silêncio aqui
    // custa horas de depuração.
    throw new Error('Seu usuário não tem perfil cadastrado. Rode 01_schema.sql e insira a linha em public.profiles.');
  }
  if (!data.ativo) throw new Error('Seu acesso está desativado. Procure o administrador.');

  _perfil = data;
  return _perfil;
}

export async function entrar(email, senha){
  if (!configurado())
    throw new Error('Preencha SUPABASE_URL e SUPABASE_ANON_KEY em config.js antes de usar o sistema.');

  const { error } = await sb.auth.signInWithPassword({
    email: String(email).trim().toLowerCase(), password: senha
  });
  if (error) throw new Error(msgErro(error));
  return carregarSessao();
}

export async function sair(){
  try { await sb.auth.signOut(); } catch(e){}
  _perfil = null;
  esquecerTudo();                       // aparelho compartilhado não guarda dado de terceiro
  location.replace('index.html');
}

/** Chamada no topo do app.html. Sem sessão válida, volta para o login. */
export async function exigirSessao(){
  try {
    const p = await carregarSessao();
    if (!p){ location.replace('index.html'); return null; }
    return p;
  } catch (e){
    alert(msgErro(e));
    await sb.auth.signOut().catch(() => {});
    location.replace('index.html');
    return null;
  }
}

/** Sessão expirada em outra aba, ou token revogado: volta ao login. */
export function vigiarSessao(){
  sb.auth.onAuthStateChange((evento, sessao) => {
    if (evento === 'SIGNED_OUT' || (!sessao && evento !== 'INITIAL_SESSION')){
      _perfil = null;
      if (!/index\.html$/.test(location.pathname)) location.replace('index.html');
    }
  });
}
