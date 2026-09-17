/* =====================================================================
   CONFIG — ponto único de manutenção.
   Tudo que alguém um dia vai querer ajustar sem entender o código
   está aqui, comentado.
   ===================================================================== */

export const CONFIG = {
  /* ---- Conexão -----------------------------------------------------
     Project URL do Supabase, SEM /rest/v1 no fim, e a chave `anon`
     (Settings -> API). Jamais a chave service_role: esta página é
     pública e todo o JavaScript é visível.                            */
  SUPABASE_URL:      'https://vexkhzlsxcbxlkjpdogl.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZleGtoemxzeGNieGxranBkb2dsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MzE4MDEsImV4cCI6MjEwMzUwNzgwMX0.vdnwTWvOJuLBfoj44Zfx20vPYj_opDsIvdJCwns6jEc',

  /* ---- Identidade da aplicação -------------------------------------
     Isto aqui é um SISTEMA, não um formulário — por isso saiu do padrão
     FP-XXX-0000 (formulário padrão) e ganhou código próprio:

         APP-<SETOR>-<NNN>  ·  Rev.<NN>

         APP   aplicação Perpec (sempre)
         SETOR sigla de três letras do setor dono: MET, ENG, QUA, PRO…
         NNN   sequencial de três dígitos, por setor, na ordem em que a
               aplicação nasce — nunca reaproveitado
         Rev   revisão da aplicação, dois dígitos

     A leitura é a mesma do código de documento (tipo-setor-sequencial),
     de propósito: assim o inventário de aplicações e o de formulários
     ficam lado a lado sem ninguém precisar aprender duas gramáticas.

     O registro das aplicações fica em PADRAO-APLICACOES.md, na raiz do
     projeto — é de lá que sai o inventário. Aplicação nova: pegue o
     próximo número do setor, anote na tabela e use o código aqui.      */
  APP_REF:  'APP-MET-001 Rev.01',
  APP_NOME: 'Gestão de Metrologia',
  APP_SUB:  'Controle de calibração de instrumentos',
  EMPRESA:  'Perpec Oilfield Supply',

  /* ---- Bibliotecas externas (CDN) ---------------------------------
     Versões fixadas de propósito: atualização de CDN não pode quebrar
     a tela sozinha numa segunda-feira.                                */
  /* Referência apenas: `import` estático não aceita URL variável, então
     esta versão está repetida literalmente no topo de supabase.js.
     Ao atualizar, altere nos dois lugares.                            */
  CDN_SUPABASE: 'https://esm.sh/@supabase/supabase-js@2.45.4',
  CDN_XLSX:     'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm',
  CDN_PDFMAKE:  'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js',
  CDN_PDFFONTS: 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.js',

  /* ---- Buckets do Storage ----------------------------------------- */
  BUCKETS: {
    certificados: 'certificados',
    laudos:       'laudos',
    fotos:        'fotos',
    termos:       'termos'
  },

  /* ---- Limites de upload ------------------------------------------
     Acima disso o navegador trava em conexão ruim de fábrica.
     Valor em MB.                                                      */
  MAX_MB_PDF:  15,
  MAX_MB_FOTO: 10,

  /* ---- Cache local -------------------------------------------------
     Só conveniência (últimos filtros usados). O servidor é sempre a
     fonte da verdade; sair da conta apaga isto.                       */
  DB_KEY: 'perpec.metrologia.v1',

  /* ---- Termo de responsabilidade (texto base do formulário) -------- */
  TERMO: 'Declaro ter recebido o instrumento acima identificado em perfeitas ' +
         'condições de uso e conservação, comprometendo-me a zelar por sua ' +
         'integridade, a não realizar ajustes ou intervenções, e a devolvê-lo ' +
         'ao setor de Metrologia na data prevista ou imediatamente após o ' +
         'término da atividade.',

  /* ---- Corpo do e-mail de cobrança de devolução ---------------------
     >>> É AQUI QUE SE EDITA O TEXTO DO E-MAIL. <<<

     Usado em Empréstimo › Em aberto › "Notificar responsável". O e-mail
     não é enviado pelo sistema: ele abre pronto no cliente de e-mail de
     quem clicou, para a pessoa conferir e enviar — assim a mensagem sai
     assinada por ela e a resposta volta para ela, não para uma caixa de
     sistema que ninguém lê.

     Marcadores disponíveis (trocados na hora do envio):
       {responsavel} — nome cadastrado em Administração › E-mails por setor
       {setor}       — setor que está com o instrumento
       {qtd}         — quantos instrumentos estão atrasados naquele setor
       {tags}        — as tags, separadas por vírgula (só no assunto)
       {itens}       — o bloco com uma entrada por instrumento (ver ITEM)
       {assinatura}  — nome de quem está cobrando (usuário logado)
       {empresa}     — CONFIG.EMPRESA
       {documento}   — CONFIG.APP_REF (código da aplicação)

     ITEM é o modelo de UMA linha da lista. As linhas que dependem de
     dado opcional (prazo, devolução prevista) somem sozinhas quando o
     dado não existe — não deixe frase solta em volta delas.
     Marcadores do ITEM: {tag} {descricao} {responsavel_item} {saida}
                         {dias} {prazo} {prevista}                     */
  EMAIL_COBRANCA: {
    ASSUNTO_1: '[Metrologia] Devolução pendente — {tags} · {setor}',
    ASSUNTO_N: '[Metrologia] Devolução pendente — {qtd} instrumentos · {setor}',

    SAUDACAO:     'Prezado(a) {responsavel},',
    SAUDACAO_SEM: 'Prezado(a),',

    ABERTURA_1: 'O instrumento abaixo está com o setor {setor} além do prazo ' +
                'estabelecido pela Metrologia:',
    ABERTURA_N: 'Os instrumentos abaixo estão com o setor {setor} além do prazo ' +
                'estabelecido pela Metrologia:',

    ITEM: '• {tag} — {descricao}\n' +
          '  Responsável: {responsavel_item}\n' +
          '  Saída em {saida} · fora há {dias} dia(s){prazo}\n' +
          '  Devolução prevista: {prevista}',

    FECHAMENTO: 'Pedimos a gentileza de sinalizar ao responsável e providenciar ' +
                'a devolução ao setor de Metrologia.',

    ASSINATURA: 'Atenciosamente,\n'
  }
};
