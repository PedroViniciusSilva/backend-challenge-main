# Decisões de arquitetura

## Organização

O projeto separa regras de negócio, casos de uso, infraestrutura e entrada HTTP. A
carteira é o aggregate root: qualquer alteração de saldo passa por ela e é
persistida junto com o lançamento correspondente.

## Dinheiro

`Money` usa `Decimal` e recebe valores como strings com duas casas decimais.
Nenhum cálculo financeiro depende de `number`, `float` ou `double`. O PostgreSQL
guarda os valores em `NUMERIC(18, 2)`.

## Concorrência

O repositório abre uma transação e busca a carteira com lock pessimista
(`FOR UPDATE`). Assim, duas operações na mesma wallet são serializadas pelo
PostgreSQL, enquanto wallets diferentes continuam podendo ser processadas em
paralelo.

## Idempotência

Cada transação tem uma chave única no banco e um hash do payload de negócio.
Uma repetição com o mesmo hash devolve o resultado original. A mesma chave com
payload diferente é tratada como conflito.

## Ledger

O ledger é append-only no fluxo da aplicação. Cada alteração de saldo cria
exatamente um lançamento com saldo anterior, valor, direção e saldo posterior.
A reconciliação reconstrói o saldo somando créditos e débitos, sem corrigir
silenciosamente divergências.

## Inbox e Outbox

Mensagens recebidas da fila podem ser registradas no Inbox junto com a
transação financeira. Eventos de domínio são gravados no Outbox dentro da mesma
transação SQL da alteração da carteira. O relay publica os eventos no SQS e
registra tentativas e backoff quando a fila está indisponível.

O SQS é tratado como entrega at-least-once. A garantia final de idempotência
continua no banco, não na ordenação ou deduplicação da fila.

## Referências

`REFUND` e `ROLLBACK` procuram a transação original pelo provider e pelo
identificador externo. Se ela ainda não existe, a nova transação fica em
`PENDING_REFERENCE`; quando existe, são conferidos wallet, jogador, rodada,
moeda, tipo e valor antes de aplicar a reversão.

## Autenticação

Autenticação externa não foi incluída nesta etapa do desafio. O ponto de
extensão fica nos controllers e pode ser substituído por um guard OIDC
integrado a Keycloak, Zitadel ou outro Identity Provider. Os endpoints de
health permanecem públicos.

## Execução local

```bash
bun install
docker compose up -d
bun run migration:up
bun run start:dev
```

Testes e build:

```bash
bun run build
bun test --no-cache
```
