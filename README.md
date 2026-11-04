# COSMOS

Gestão administrativa para empresas privadas e organizações públicas. Primeira versão funcional (MVP), com interface em português, servidor Node.js e banco SQLite persistente. Não depende de pacotes externos.

## O que está disponível

- Cadastro de organização pública ou privada e do primeiro administrador.
- Troca da própria senha com encerramento de todas as sessões.
- Login e logout com sessões de 8 horas, cookies HttpOnly e senhas derivadas com scrypt e salt individual.
- Dados separados por organização no servidor.
- Cadastro de setores e pessoas, com perfis administrador e colaborador.
- Edição do nome, setor e perfil; desativação e reativação de pessoas.
- Bloqueio de login e encerramento de sessões ao desativar o acesso; novo login obrigatório ao alterar o perfil.
- Solicitações com protocolo, setor responsável, justificativa e prioridade.
- Aprovação ou recusa com parecer obrigatório e identificação de quem decidiu.
- Um administrador não pode avaliar a própria solicitação. Cadastre outro administrador para isso.
- Colaboradores veem apenas seus pedidos; administradores veem todos os pedidos da organização.
- Painel com indicadores, busca por título/protocolo e filtro por situação.
- Histórico das últimas 50 ações administrativas e de solicitações.
- Layout responsivo para computador, tablet e celular.

## Executar no computador

Instale **Node.js 24 ou superior**, baixe ou clone este repositório e abra o terminal na pasta COSMOS:

```bash
npm start
```

Abra **http://localhost:3000**. Não é necessário executar `npm install`.

1. Selecione **Cadastrar organização**.
2. Informe seu nome, organização, natureza pública/privada, e-mail e senha de pelo menos 12 caracteres.
3. Em **Setores**, cadastre as áreas da organização.
4. Em **Pessoas**, cadastre os colaboradores e outros administradores.
5. Crie um pedido em **Nova solicitação**.
6. Entre como outro administrador, abra o pedido e registre a decisão.

Não há usuário ou senha padrão, nem dados fictícios inseridos automaticamente.

## Executar no GitHub Codespaces

Com Node.js 24+ no Codespace, execute `npm start`. Abra a aba **PORTS / PORTAS**, localize a porta **3000** e escolha **Abrir no navegador**. Mantenha a porta privada durante os testes.

Para atualizar após integrar uma alteração no GitHub: pare o servidor com `Ctrl+C`, execute `git pull --ff-only` na branch `main` e inicie novamente com `npm start`. Se houver alterações locais, preserve-as antes de atualizar; não use comandos de descarte. O banco em `data/` é ignorado pelo Git e não é substituído por esta atualização.

Em **Minha conta**, qualquer usuário pode trocar a própria senha informando a atual. A nova senha deve ser diferente e ter pelo menos 12 caracteres. Todas as sessões da conta são encerradas, inclusive em outros navegadores. Não há recuperação de senha esquecida nesta versão.

## Executar no Replit

1. Importe este repositório no Replit.
2. Use um ambiente com **Node.js 24+** (`node --version` confirma a versão).
3. Configure o comando de execução como `npm start` e clique em **Run**.
4. Abra a janela de visualização do aplicativo. O servidor usa `0.0.0.0` e respeita a variável `PORT`.
5. Se a visualização usar HTTPS, configure `COOKIE_SECURE=true` em Secrets.

Os dados ficam em `data/cosmos.sqlite`. A execução precisa de disco persistente; instâncias efêmeras podem perder o arquivo ao reiniciar ou republicar. Não use múltiplas instâncias compartilhando esse SQLite. GitHub armazena o código; não executa o backend. GitHub Pages não é compatível com este servidor.

## Configuração

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP |
| `HOST` | `0.0.0.0` | Interface de rede |
| `DATABASE_PATH` | `data/cosmos.sqlite` | Caminho do banco persistente |
| `COOKIE_SECURE` | `false` | Use `true` quando acessado por HTTPS |

Há um `.env.example` como referência. Variáveis podem ser definidas no ambiente ou copiadas para `.env` e carregadas com `node --env-file=.env server.js`. O arquivo `.env` não é carregado automaticamente por `npm start` e não deve ser enviado ao Git.

## Gerenciar pessoas

Como administrador, abra **Pessoas → Editar** para alterar nome, setor, perfil ou situação de acesso. O e-mail permanece como identificador de login e não é editável nesta versão. Desativar preserva os pedidos e o histórico; reativar permite entrar novamente com a senha existente. Alterar o perfil também encerra as sessões da pessoa.

Um administrador não pode desativar o próprio acesso nem reduzir o próprio perfil: outro administrador deve fazê-lo. O servidor também impede a remoção do último administrador ativo. Mudanças são registradas no histórico.

A atualização adiciona automaticamente a coluna `active` ao banco existente e mantém as contas atuais ativas. Pare o servidor e faça backup do diretório `data/` antes de atualizar. A migração é aditiva; não apaga cadastros, pedidos ou sessões.

## Testes

```bash
npm test
```

Testes de integração com banco temporário verificam autenticação, persistência após reinício, permissões, isolamento entre organizações, decisões, bloqueio de autoaprovação, expiração por logout, origem das requisições e limite de tentativas.

## Estrutura

```text
server.js           API HTTP, autenticação e banco SQLite
public/index.html   Interface
public/styles.css   Layout responsivo
public/app.js       Navegação e integração com a API
test/app.test.js    Testes de integração
```

## API

Todas as operações de escrita recebem JSON. O cookie de sessão é emitido pelo servidor.

| Método | Rota | Acesso |
| --- | --- | --- |
| POST | `/api/register` | Cadastro de nova organização e administrador |
| POST | `/api/login` | Login |
| POST | `/api/logout` | Autenticado |
| POST | `/api/account/password` | Troca de senha da própria conta; exige senha atual |
| GET | `/api/workspace` | Dados visíveis ao usuário autenticado |
| POST | `/api/sectors` | Administrador |
| POST | `/api/users` | Administrador |
| POST | `/api/users/:id` | Administrador da mesma organização: edita nome, setor, perfil e acesso |
| POST | `/api/requests` | Autenticado |
| POST | `/api/requests/:id/decision` | Administrador da mesma organização, exceto autor |

## Limites desta versão

Este MVP não é uma implantação de produção. Antes de usar dados reais de funcionários ou órgãos, configure HTTPS, persistência e backups com restauração validada, revisão de acesso e política de retenção. O cadastro de organizações está aberto; restrinja-o no ambiente institucional se necessário. A proteção de tentativas é por IP e processo, sem confiar em cabeçalhos de proxy.

Ainda não há recuperação de senha esquecida, MFA, convites por e-mail, edição de e-mail e edição/desativação de setores, anexos, edição de solicitações, notificações, exportação ou integração com sistemas governamentais. Não há garantia automática de conformidade com LGPD ou regras administrativas. O histórico é um registro de aplicação no banco, não uma trilha imutável de auditoria.

Faça backup com o servidor parado, copiando o diretório `data` completo (incluindo eventuais arquivos WAL/SHM). Guarde o backup fora do repositório e limite o acesso ao diretório do banco.
