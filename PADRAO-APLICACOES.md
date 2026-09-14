# Padrão de código das aplicações Perpec

> **Nada aqui tem a ver com a aba Inventário desta aplicação.** Aquela tela é o acervo de
> instrumentos da metrologia — paquímetros, torquímetros, blocos padrão. Este documento é
> de outra natureza: fala das **aplicações** desenvolvidas pela Perpec, e existe para que o
> registro delas seja possível. Duas coisas com o mesmo nome, em assuntos diferentes.

Este arquivo é a **carteira de identidade desta aplicação** e a cópia do padrão que a
nomeou. O **registro geral das aplicações é outro documento**, fora deste projeto — veja
[Onde fica o registro](#onde-fica-o-registro).

---

## Por que um código novo

O padrão `FP-XXX-0000` identifica **formulário**: um documento com campos, revisão e
retenção. Um sistema não é isso. Ele tem banco de dados, usuários, permissões, versões
que sobem em produção e um custo de manutenção que continua depois que o formulário já
foi impresso e arquivado.

Misturar os dois no mesmo sequencial faz o registro mentir nas duas pontas: quem conta
formulários conta sistemas junto, e quem procura sistemas precisa saber de cor quais
números são aplicação.

---

## O código

```
APP-<SETOR>-<NNN>  ·  Rev.<NN>

          APP-MET-001 Rev.01
          │   │   │      └── revisão da aplicação, dois dígitos
          │   │   └───────── sequencial de três dígitos, por setor
          │   └───────────── setor dono, três letras
          └───────────────── aplicação Perpec (sempre "APP")
```

| Parte | Regra |
|---|---|
| `APP` | Fixo. É o que separa aplicação de formulário (`FP`) e de procedimento. |
| `SETOR` | Sigla de três letras do setor **dono** da aplicação — quem responde por ela, não quem a programou. |
| `NNN` | Sequencial de três dígitos, **por setor**, na ordem em que a aplicação nasce. Nunca reaproveitado: aplicação desativada mantém o número, e o próximo continua de onde parou. |
| `Rev` | Revisão da aplicação. Sobe quando muda o que o usuário vê ou o que o banco guarda; correção de defeito não sobe revisão. |

A leitura é a mesma do código de documento — tipo, setor, sequencial — de propósito:
assim os dois registros ficam lado a lado sem ninguém precisar aprender duas gramáticas.

### Siglas de setor

| Sigla | Setor |
|---|---|
| `MET` | Metrologia |
| `ENG` | Engenharia |
| `QUA` | Qualidade |
| `PRO` | Produção |
| `MAN` | Manutenção |
| `LOG` | Logística |
| `ADM` | Administrativo |
| `COM` | Comercial |
| `SMS` | Segurança, Meio Ambiente e Saúde |

Setor que não estiver na lista entra aqui antes de virar código — duas siglas para o
mesmo setor é o começo de um registro que não fecha.

---

## Esta aplicação

| Campo | Valor |
|---|---|
| **Código** | `APP-MET-001 Rev.01` |
| **Nome** | Gestão de Metrologia |
| **O que faz** | Controle de calibração de instrumentos: cadastro, calibração, empréstimo, inventário do acervo, arquivos e relatórios |
| **Setor dono** | Metrologia |
| **Situação** | Em produção |
| **Início** | 2026 |
| **Onde roda** | Supabase (Postgres + Auth + Storage) e host estático |
| **Responsável** | João Amaral |
| **Pasta** | `Dev-2026/18-gestao-metrologia-rev1` |

O código vive em um lugar só, `CONFIG.APP_REF` em `config.js`, e de lá aparece sozinho na
faixa preta do topo, no rodapé da tela, no login e no rodapé de todo PDF gerado.

---

## Onde fica o registro

O registro geral — a tabela com **todas** as aplicações da Perpec — é um documento
separado, fora deste projeto. O lugar natural é a raiz de `Dev-2026`, ao lado das pastas
das aplicações:

```
Dev-2026/
├── APLICACOES-PERPEC.md      ← o registro geral (todas as aplicações)
├── 18-gestao-metrologia-rev1/
│   └── PADRAO-APLICACOES.md  ← este arquivo: o padrão + a identidade desta aplicação
└── ...
```

Manter a tabela completa dentro de cada projeto criaria, com o tempo, uma versão
diferente do registro em cada pasta — e registro que existe em cinco versões não é
registro. Aqui fica só a linha desta aplicação; lá ficam todas.

**Modelo da tabela do registro geral** (copie para o documento externo):

| Código | Aplicação | Setor | Situação | Início | Onde roda | Responsável |
|---|---|---|---|---|---|---|
| `APP-MET-001 Rev.01` | Gestão de Metrologia | Metrologia | Em produção | 2026 | Supabase + host estático | João Amaral |

Colunas, e por que cada uma existe:

- **Código** — a chave do registro. Com a revisão, para saber qual versão está no ar.
- **Aplicação** — o nome que o usuário vê. Nome sem descrição obriga a abrir o sistema
  para lembrar o que ele era.
- **Setor** — quem responde pela aplicação. É a quem se pergunta antes de desligá-la.
- **Situação** — `Em desenvolvimento`, `Em produção`, `Descontinuada`. Aplicação
  descontinuada **fica na tabela**: sumir com a linha apaga a memória de que ela existiu,
  e o número dela continua queimado.
- **Início** — ano da primeira versão em produção.
- **Onde roda** — banco e hospedagem. É a primeira pergunta de qualquer auditoria de TI e
  a primeira de qualquer migração.
- **Responsável** — a pessoa, não o setor.

---

## Como nasce uma aplicação nova

1. Escolha a sigla do setor dono.
2. Pegue o **próximo número livre daquele setor** no registro geral.
3. Acrescente a linha lá, com situação `Em desenvolvimento`.
4. Escreva o código no `config.js` da aplicação nova:

```js
APP_REF: 'APP-MET-002 Rev.01',
```

5. Leve uma cópia deste arquivo para o projeto novo, com a seção **Esta aplicação**
   preenchida com os dados dele.
