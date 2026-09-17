# Gestão de Metrologia — Perpec Oilfield Supply

Controle de calibração de instrumentos: recebimento, cadastro, calibração,
empréstimo, inventário e relatórios.

**Stack:** Supabase (Postgres + Auth + Storage + Realtime + RLS) e frontend em
HTML/CSS/JS puro com ES Modules nativos. Sem Node, sem bundler, sem framework,
sem etapa de build. "Deploy" é copiar arquivos.

---

## Sumário

- [Instalação](#instalação)
- [Arquivos](#arquivos)
- [Como o sistema decide a situação de um instrumento](#como-o-sistema-decide-a-situação-de-um-instrumento)
- [Regras de negócio que moram no banco](#regras-de-negócio-que-moram-no-banco)
- [Uso diário](#uso-diário)
- [Papéis e permissões](#papéis-e-permissões)
- [Apagar e reimportar em massa](#apagar-e-reimportar-em-massa)
- [Os gráficos do painel](#os-gráficos-do-painel)
- [Backup](#backup)
- [Problemas comuns](#problemas-comuns)
- [Checklist antes de publicar](#checklist-antes-de-publicar)

---

## Instalação

### 1. Projeto Supabase

Crie o projeto na região **South America (São Paulo) · sa-east-1**, plano Pro.

### 2. Banco de dados

No **SQL Editor**, rode os arquivos **nesta ordem**, um de cada vez:

| Ordem | Arquivo | O que faz |
|---|---|---|
| 1 | `sql/01_schema.sql` | Tabelas, funções de domínio, gatilhos, RPCs |
| 2 | `sql/02_rls.sql` | Permissões de coluna, RLS, buckets do Storage, Realtime |
| 3 | `sql/03_views.sql` | `vw_instrumentos_status` e as RPCs que dependem dela |
| 4 | `sql/04_seed.sql` | Configurações obrigatórias e famílias iniciais |
| 5 | `sql/05_admin.sql` | Gestão de perfis, apagamento em massa, receitas de manutenção |

`sql/06_emprestimos_historico.sql` é **migração**, não instalação: serve para bancos
que já estavam rodando antes do histórico de empréstimos existir. Numa instalação
nova, os arquivos 01 e 03 já entregam tudo — pule o 06. Se o seu banco já estava
de pé, rode nesta ordem: **06 → 02 → 03**.

**Confirme antes de avançar** para o frontend:

```sql
select tag, status_efetivo, data_proxima, dias_para_vencer
  from public.vw_instrumentos_status;
```

Se a view responder (ainda que vazia), o banco está de pé.

### 3. Autenticação

`Authentication → Providers → Email`:

- **Confirm email: desligado.**
- **Allow new users to sign up:** ligado ou desligado, conforme a política da
  empresa. Com ele desligado, só o administrador cria usuários pelo painel.

Crie o primeiro usuário em `Authentication → Users → Add user`, com
**Auto Confirm** ligado. O perfil nasce sozinho (gatilho `on_auth_user_created`),
sempre como `metrologista`.

O administrador inicial é **joao@perpec.com.br**, e o bloco 4 de
`sql/04_seed.sql` já o promove a `admin`. **Ordem importa:** crie o usuário no
Auth primeiro e só então rode o `04`. Se rodar antes, o bloco não falha em
silêncio — ele emite um `WARNING` dizendo exatamente o que fazer, e você roda de
novo depois. Pode rodar quantas vezes quiser.

Para promover outra pessoa depois, use a tela `Administração → Usuários`, ou:

```sql
update public.profiles set papel='admin' where email='fulano@perpec.com.br';
```

### 4. Frontend

Em `config.js`, preencha:

```js
SUPABASE_URL:      'https://SEU-PROJETO.supabase.co',   // sem /rest/v1
SUPABASE_ANON_KEY: '...'                                // chave anon, NUNCA a service_role
```

Depois é só servir os arquivos estáticos. Qualquer uma destas serve:

- **Supabase Storage:** crie um bucket **público** chamado `app`, suba a árvore
  inteira preservando as pastas (`pages/`, `components/`) e acesse
  `https://<projeto>.supabase.co/storage/v1/object/public/app/index.html`.
- Um servidor interno (IIS, nginx, Apache), uma pasta compartilhada publicada,
  GitHub Pages, Netlify — qualquer host estático.

> **Não abra por `file://`.** ES Modules exigem `http://` ou `https://`.
> Para testar na máquina, qualquer servidor estático resolve; se houver Python
> instalado: `python -m http.server 8080` na pasta do projeto.

### 5. Logo

`logo.js` já contém a logo em base64 (`window.LOGO_B64`), usada no cabeçalho e
no PDF. Para trocar:

```powershell
$bytes = [System.IO.File]::ReadAllBytes("PERPEC - LOGO PRINCIPAL.png")
$b64   = [System.Convert]::ToBase64String($bytes)
$txt   = 'window.LOGO_B64 = "data:image/png;base64,' + $b64 + '";'
[System.IO.File]::WriteAllText("logo.js", $txt, (New-Object System.Text.UTF8Encoding($false)))
```

---

## Arquivos

```
/
├── index.html              login (o gate começa visível)
├── app.html                shell: cabeçalho, navegação e <main>
├── config.js               URL, chave anon, limites, textos  ← ponto único de manutenção
├── supabase.js             cliente singleton + camada de dados
├── auth.js                 login, logout, guarda de rota
├── router.js               roteador de hash, sem reload
├── utils.js                esc(), datas, toast, validação, CDNs
├── style.css               design system (tokens da Perpec)
├── /pages/                 uma tela por módulo: render(container) + destroy()
│   ├── dashboard.js  recebimento.js  cadastro.js  calibracao.js
│   ├── emprestimo.js inventario.js   relatorios.js
│   └── admin.js            usuários, parâmetros, manutenção, auditoria
├── /components/
│   ├── tabela.js           tabela ordenável
│   ├── modal.js            modal, confirmação, pedido de justificativa
│   ├── status-badge.js     situação e cor num só lugar
│   ├── graficos.js         arco, barras e Pareto em SVG puro
│   ├── timeline.js         linha do tempo do instrumento
│   └── form-instrumento.js formulário compartilhado (recebimento + avulso)
├── /sql/                   01_schema · 02_rls · 03_views · 04_seed · 05_admin
│                           06_emprestimos_historico (migração)
└── logo.js                 logo em base64
```

Cada página é um módulo ES que exporta `render(container, params)` e,
opcionalmente, `destroy()`. O roteador chama `render` ao entrar e `destroy` ao
sair — é em `destroy()` que os canais de Realtime são desligados.

Bibliotecas externas entram por CDN, sob demanda: **SheetJS** (Excel) e
**pdfmake** (PDF) só são baixados quando alguém clica em exportar.

---

## Como o sistema decide a situação de um instrumento

Esta é a parte que mais confunde quem mexe no código depois, então vale ler.

`instrumentos.status_workflow` guarda **apenas o que uma pessoa declarou**:
`calibrado`, `descalibrado`, `solicitado`, `em_calibracao_externa`.

`status_efetivo` é **calculado na hora**, pela view `vw_instrumentos_status`, e é
o que a tela sempre lê. Ele nunca é gravado em lugar nenhum — não existe cron
mudando linha de instrumento à meia-noite.

A ordem de decisão da view:

1. `solicitado` ou `em_calibracao_externa` → vence tudo.
2. `descalibrado` declarado → `descalibrado`.
3. standby com `data_inicio_relogio` nulo → **`standby_pausado`**.
4. sem `data_proxima` → `descalibrado`.
5. `data_proxima` no passado → `descalibrado`.
6. faltam ≤ `dias_proximo_vencimento` dias → `proximo_vencimento`.
7. caso contrário → `calibrado`.

### Semáforo

| Situação | Cor | Significado |
|---|---|---|
| Calibrado | verde | dentro do prazo |
| Próximo do vencimento | âmbar | vence dentro da janela configurada |
| Descalibrado | vermelho | vencido, sem calibração, ou declarado |
| Calibração solicitada | azul | pedido feito, instrumento na empresa |
| Em calibração externa | roxo | está no laboratório |
| Standby (relógio parado) | cinza | calibrado e guardado; validade não corre |

As cores estão em `style.css` como tokens `--status-*`, e os rótulos em
`components/status-badge.js`. **Mudou ali, mudou em toda a aplicação** — tela,
badge, tabela, painel, Excel e PDF.

### Relógio de standby

Instrumento marcado como **standby** e ainda não movimentado tem
`data_inicio_relogio = NULL` e `data_proxima = NULL`: a calibração não expira
enquanto ele estiver na gaveta.

Na **primeira saída**, a RPC `registrar_movimentacao`:

1. grava `data_inicio_relogio = now()`;
2. recalcula a `data_proxima` da última calibração a partir daquele instante.

A partir daí ele passa a envelhecer como qualquer outro.

### Periodicidade customizada

Uma família pode ter **fases**: intervalos diferentes conforme a idade do
instrumento. Exemplo do seed (blocos padrão):

| Ordem | Intervalo | Vale até | Âncora |
|---|---|---|---|
| 1 | 12 meses | 24 meses de idade | entrada |
| 2 | 24 meses | 60 meses de idade | entrada |
| 3 | 36 meses | — (última) | entrada |

A âncora define de onde a idade é contada: **data de entrada** ou **primeira
calibração**. A última fase, com vigência em branco, vale indefinidamente.

---

## Regras de negócio que moram no banco

A página é pública e o JavaScript é todo visível, inclusive a chave `anon`.
Por isso nenhuma regra crítica depende da tela:

| Regra | Onde é garantida |
|---|---|
| Só instrumento calibrado sai emprestado | `registrar_movimentacao()` — a tela não tem `INSERT` em `movimentacoes` |
| Posse e externo exigem termo | constraint `termo_obrigatorio` + a mesma RPC |
| Inativar exige motivo e justificativa | `inativar_instrumento()`; a coluna `condicao_fisica` não tem `GRANT` de UPDATE |
| Alterar periodicidade exige justificativa | `alterar_periodicidade()`; `familias.periodicidade_meses` não tem `GRANT` de UPDATE |
| Auditoria é somente-inclusão | sem `GRANT` de UPDATE/DELETE, sem policy, e gatilhos que levantam exceção |
| `data_proxima` não é escolhida pelo usuário | gatilho `calibracoes_data_proxima` sobrescreve sempre |
| Tag não se repete | `gerar_tag()` deriva do maior sufixo existente, e `tag` é `UNIQUE` |

Se a tela deixar passar alguma coisa, o banco recusa e o erro chega ao usuário
traduzido por `msgErro()` em `utils.js`.

---

## Uso diário

**Painel.** Primeira tela do dia: quantos instrumentos estão descalibrados, quais
vencem na janela configurada, e quais empréstimos passaram do prazo. Os números
grandes são clicáveis e levam à lista já filtrada.

**Recebimento.** Instrumento novo, com nota fiscal. A tag aparece assim que
família e tipo são escolhidos, e é reconfirmada pelo servidor ao salvar — se o
outro usuário cadastrar um instrumento da mesma família enquanto você digita, a
sua tag avança sozinha. Instrumento + inspeção + primeira calibração entram numa
única transação.

**Cadastro.** Instrumento avulso (sem NF), import de instrumentos por planilha,
criação de famílias e import de famílias. Os dois imports mostram prévia com as
linhas problemáticas marcadas antes de gravar qualquer coisa. Há botão para
baixar o modelo de planilha em cada aba — o de instrumentos vem com cinco linhas
de exemplo, uma por caso de preenchimento.

### Colunas da planilha de instrumentos

| Coluna | Obrigatória | Valores aceitos |
|---|---|---|
| `codigo` | sim | código da família já cadastrada (`PAQ`, `MIC`…) |
| `descricao` | sim | texto livre |
| `familia` | não | nome da família — informativo, ou usado se o código não bater |
| `fabricante`, `resolucao`, `num_serie`, `localizacao` | não | texto livre |
| `tipo` | não | `TMMDE` ou `REFERENCIA` (padrão: o escolhido na tela) |
| `data_entrada` | não | `AAAA-MM-DD` (padrão: o escolhido na tela) |
| `standby` | não | `sim` / `não` |
| `status` | não | `calibrado`, `descalibrado`, `solicitado`, `em calibracao externa` — **padrão `descalibrado`** |
| `data_calibracao` | só se `status=calibrado` | `AAAA-MM-DD` |
| `situacao` | não | `ativo` / `inativo` — também aceita `sucateado`, `vago`, `não entregue`, `danificado`, que já viram o motivo. **Padrão `ativo`** |
| `justificativa_inativo` | só se inativo | texto com 10+ caracteres |

Três coisas que a prévia checa e recusa antes de gravar: `calibrado` sem
`data_calibracao` (sem data não existe validade), `data_calibracao` no futuro ou
anterior à entrada, e linha inativa importada por quem não é administrador.

A **próxima calibração nunca vem da planilha** — quem calcula é o servidor, pela
periodicidade da família e pelo relógio de standby. Certificados em PDF também
não vêm por planilha: são anexados depois, na tela de Calibração.

**Calibração.** A lista de trabalho. Filtre por situação, família ou texto livre;
clique num instrumento para abrir a ficha com o histórico completo. O botão
**Tornar calibrado** pede data, certificado, pedidos, observações e laudo — a
próxima data é calculada pelo servidor, nunca digitada. A tela é atualizada ao
vivo: quando o outro usuário registra uma calibração, a linha pisca aqui.

**Empréstimo.** Busque por tag ou descrição. Se o instrumento não puder sair, a
tela diz o motivo antes de você preencher qualquer campo. Casual não pede termo;
posse e externo não salvam sem ele. A aba **Em aberto** lista o que está fora e
registra devolução — que exige informar **quem recebeu**, fechando o par da entrega.

A aba **Histórico** guarda todas as saídas e devoluções já registradas, com filtro
por período, tipo, situação (devolvidos, em aberto, fora do prazo) e busca livre.
Exporta para Excel e para PDF, e o PDF carrega no cabeçalho o recorte aplicado.
Nada é apagado quando o instrumento volta: a devolução preenche a mesma linha da
saída, então o par entrega/devolução é sempre íntegro. Devolução só acontece pela
RPC `registrar_devolucao` — não há `UPDATE` direto em `movimentacoes` pela API.

**Inventário.** O acervo inteiro, com condição física. Inativar abre um modal com
motivo e justificativa obrigatórios — os dois vão para a auditoria.

**Relatórios.** Filtros aplicados no servidor, prévia na tela, exportação para
Excel e para PDF. Há atalhos para os recortes mais pedidos (vencidos hoje,
vencem no mês, vencem no trimestre).

---

## Papéis e permissões

São dois papéis, e só dois. Mais granularidade do que isto vira burocracia
sem ganho numa equipe de metrologia.

| | metrologista | admin |
|---|---|---|
| Consultar tudo | sim | sim |
| Receber, cadastrar e importar | sim | sim |
| Registrar calibração | sim | sim |
| Emprestar e registrar devolução | sim | sim |
| Alterar periodicidade (com justificativa) | sim | sim |
| Inativar / reativar instrumento | **não** | sim |
| **Apagar** instrumentos | **não** | sim |
| Alterar parâmetros do sistema | **não** | sim |
| Gerenciar papéis e acessos | **não** | sim |

### Pela tela — `Administração → Usuários`

A aba aparece no menu só para quem é `admin`. Ali dá para trocar o papel
de qualquer pessoa e bloquear ou liberar o acesso, com a mudança indo para
a trilha de auditoria.

Duas travas propositais, que valem tanto na tela quanto na API:

- você **não** consegue rebaixar nem bloquear o seu próprio usuário;
- o sistema **não** deixa bloquear o último administrador ativo.

### Como entra gente nova

O Supabase é quem cria a credencial; a tela define o que a pessoa pode fazer.

1. Painel do Supabase → `Authentication → Users → Add user`, com **Auto Confirm** ligado.
2. O gatilho `on_auth_user_created` cria o perfil sozinho, como **metrologista ativo**.
3. Em `Administração → Usuários`, ajuste o papel se for o caso.

> Se `Allow new users to sign up` estiver ligado, qualquer pessoa com o link
> consegue criar conta e entrar como metrologista. Numa ferramenta interna,
> **desligue** e crie os usuários você mesmo.

### Bloquear ≠ apagar

Bloquear (`ativo = false`) tira o acesso na hora — todas as políticas de RLS
passam por `sou_ativo()` — e preserva o histórico do que a pessoa fez. É o que
você quer quando alguém sai da empresa. Apagar o usuário no painel do Supabase
também funciona, mas leva o perfil junto e deixa a auditoria com um e-mail sem
dono.

### Pelo SQL, se preferir

```sql
update public.profiles set papel='admin' where email='fulano@perpec.com.br';
update public.profiles set ativo=false   where email='fulano@perpec.com.br';
```

---

## Apagar e reimportar em massa

Feito para o ciclo normal de implantação: subir a planilha, ver que o dado
saiu errado, limpar e subir de novo.

**O que "apagar" leva junto.** Por cascata: calibrações, inspeções,
movimentações e documentos daquele instrumento. **Não** leva a trilha de
auditoria — ela é somente-inclusão, e o próprio apagamento entra nela com o
seu e-mail, a data e a justificativa. Famílias, parâmetros e usuários ficam
de pé, então a reimportação funciona logo em seguida.

**Os arquivos do Storage não somem.** Certificados, termos, laudos e fotos
continuam nos buckets. Para reimportar isso não atrapalha; para faxina
completa, a consulta que lista os órfãos está em `sql/05_admin.sql`, item 4.7.

### Três caminhos, do mais cirúrgico ao mais amplo

| Onde | O que faz | Como confirma |
|---|---|---|
| `Inventário` → marcar linhas → **Apagar selecionados** | só o que você marcou | justificativa de 10+ caracteres |
| `Administração → Manutenção` → **Apagar por família** | todos de uma família | justificativa de 10+ caracteres |
| `Administração → Manutenção` → **Limpar todo o acervo** | o acervo inteiro | digitar `APAGAR TUDO` + justificativa |

Todos os três exigem papel `admin` — e a verificação está na RPC, no banco,
não no botão.

### Pelo SQL Editor

Quando é mais rápido pelo banco (rodando como `postgres`, sem passar pelas
RPCs auditadas), as receitas prontas estão no item 4 de `sql/05_admin.sql`:
contagem por tabela, apagar tudo, desfazer só a importação de hoje, apagar por
família, zerar também as famílias, e — apenas para ambiente de teste — como
desligar e religar os gatilhos append-only para limpar a própria auditoria.

---

## Os gráficos do painel

Três, e cada um responde uma pergunta diferente. Todos em SVG escrito à mão
(`components/graficos.js`) — nenhuma biblioteca de gráficos entra no projeto.

| Gráfico | Pergunta que responde |
|---|---|
| **Arco de situação** | Como está o acervo agora? |
| **Carga por mês** | Quantas calibrações caem em cada um dos próximos 6 meses? Serve para negociar agenda com o laboratório. |
| **Pareto por família** | Onde atacar primeiro? A linha acumulada mostra quantas famílias resolvem 80% das pendências. |

Cada um tem uma **tabela-gêmea** embutida (*"Ver os números em tabela"*): nenhum
valor depende de enxergar cor ou de acertar o mouse num ponto.

### Por que meia-lua e não rosca fechada

Não é escolha estética. As cores do semáforo foram medidas com o validador de
paleta do design system (ΔE em OKLab, simulação de daltonismo Machado 2009,
contra a superfície branca do cartão):

- Numa **rosca fechada**, o último segmento encosta no primeiro — o que põe
  **verde colado no vermelho**: ΔE 4,2 sob deuteranopia. Reprovado. Nenhuma das
  24 ordens circulares possíveis passa, porque o problema é a paleta (que é
  padrão da empresa e não se mexe), não a ordem.
- O **arco aberto** tem adjacência linear. Na ordem
  `descalibrado → externa → próximo → solicitado → calibrado`, o pior par
  adjacente dá **ΔE 21,4 sob deuteranopia e 24,3 em visão normal** — bem acima
  dos pisos de 8 e 15.

**Standby fica fora dos gráficos.** Croma 0,022: como cinza ele é um ótimo
rótulo e um péssimo segmento — viraria uma mancha morta no anel. Nos gráficos
ele entra somado a "calibrado", que é exatamente o que ele é: um instrumento
válido com o relógio parado. Na tabela, na lista e no badge ele continua
aparecendo com nome próprio.

A ordem validada está em `ORDEM_GRAFICO`, em `components/status-badge.js`, com
os números no comentário. **Se mexer nas cores do semáforo, rode o validador de
novo antes de publicar.**

---

## Backup

O plano Pro faz **backup diário automático com 7 dias de retenção** — isso já
cobre o acidente comum. O que ele não cobre é o erro percebido três semanas
depois.

**Dump semanal para fora do Supabase.** A rota confiável é externa ao banco,
porque `pg_dump` não roda de dentro do Postgres:

```powershell
# Tarefa agendada semanal no Windows, ou um job de CI.
# A senha do banco está em Settings -> Database.
$data = Get-Date -Format 'yyyy-MM-dd'
pg_dump "postgresql://postgres:SENHA@db.SEU-PROJETO.supabase.co:5432/postgres" `
        --no-owner --format=custom `
        --file="\\servidor\backups\metrologia\metrologia-$data.dump"
```

Guarde os dumps num caminho com retenção maior que a do Supabase, e **teste a
restauração pelo menos uma vez** — backup que nunca foi restaurado é hipótese,
não backup.

Alternativa dentro da plataforma: uma **Edge Function** agendada por `pg_cron` +
`pg_net` que exporta as tabelas em CSV para um bucket privado. Funciona, mas
exporta dados, não o esquema — serve como complemento, não como substituto do
dump.

Os arquivos do Storage (certificados, termos, laudos, fotos) **não entram no
dump do banco**. Faça uma cópia periódica dos buckets à parte.

---

## Problemas comuns

**"Seu usuário não tem perfil cadastrado."**
O usuário existe em `auth.users` mas não em `public.profiles` — normalmente
porque foi criado antes de o esquema ser instalado. Rode o diagnóstico no fim de
`03_views.sql`:

```sql
select u.id, u.email, u.email_confirmed_at, p.papel, p.ativo
  from auth.users u left join public.profiles p on p.id=u.id order by u.created_at;
```

Insira a linha faltante em `public.profiles`.

**Login aceito, mas nenhuma tela mostra dados.**
`profiles.ativo = false`, ou a RLS não foi aplicada. Todas as políticas passam
por `sou_ativo()`.

**"E-mail ainda não confirmado."**
`Confirm email` ligado no painel. Desligue, ou confirme o usuário manualmente.

**A tela abre em branco e o console acusa CORS ou módulo.**
A página foi aberta por `file://`. ES Modules precisam de `http://`/`https://`.

**Alterei um `.js` e o navegador insiste no arquivo velho.**
`Ctrl+F5`. Hosts estáticos guardam cache de `.js` com folga.

**"Operação bloqueada pelo banco: seu papel não permite alterar este campo."**
É o comportamento esperado: `condicao_fisica` e a periodicidade só mudam pelas
RPCs auditadas. Use os botões da tela, não a API direta.

**Uma calibração ficou sem data de próxima.**
O instrumento está em standby com o relógio parado, e isso é correto: a validade
começa a contar na primeira saída. Confira com:

```sql
select tag, standby, data_inicio_relogio, ultima_calibracao, data_proxima, status_efetivo
  from public.vw_instrumentos_status where tag = 'P-PAQ-01';
```

**O Realtime não atualiza entre os dois usuários.**
Confira se as tabelas estão na publicação:

```sql
select tablename from pg_publication_tables where pubname='supabase_realtime';
```

O bloco final de `02_rls.sql` faz isso; rode-o de novo se necessário.

---

## Checklist antes de publicar

**Segurança**

- [ ] Nenhuma chave `service_role` nos arquivos publicados
- [ ] RLS ligada em todas as tabelas; nenhuma política atende `anon`
- [ ] `auditoria` sem `GRANT` de update/delete, e os dois gatilhos no lugar
- [ ] `condicao_fisica` e periodicidade sem `GRANT` de update direto
- [ ] Buckets do Storage com `public = false`
- [ ] Todo texto de usuário passa por `esc()` antes de virar `innerHTML`
- [ ] O gate de login começa visível em `index.html` e em `app.html`
- [ ] Sair apaga o cache local (`esquecerTudo()`)

**Funcionamento**

- [ ] `vw_instrumentos_status` responde no SQL Editor
- [ ] `gerar_tag` testado nas duas famílias e nos dois tipos
- [ ] `calcular_data_proxima` testado nos quatro casos: standby sem uso,
      standby com uso, fase simples, fase customizada
- [ ] Empréstimo de instrumento descalibrado é recusado **pelo banco**
- [ ] Posse e externo recusados sem termo
- [ ] Inativação sem justificativa é recusada
- [ ] Dois usuários logados ao mesmo tempo veem a mudança um do outro

**Interface**

- [ ] Legenda de cores visível nas telas que usam o semáforo
- [ ] Campos com 16px
- [ ] PDF sai com logo e com "Página X de Y"
- [ ] Excel abre no Excel em português sem passo de importação
- [ ] Testado com `Ctrl+F5` depois de publicar

---

*Perpec Oilfield Supply · FP-ENG-0018 · padrão de arquitetura do `KIT-INICIAL.md`*
