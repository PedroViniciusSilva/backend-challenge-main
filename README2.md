# Guia completo do projeto

Este documento explica, de forma prática, como o desafio foi organizado, o que
cada pasta e arquivo faz, como as partes se conectam e como validar a entrega.
O [README.md](./README.md) continua sendo o enunciado oficial do desafio.
As decisões e trade-offs estão detalhados no
[ARCHITECTURE.md](./ARCHITECTURE.md).

## 1. O que o projeto faz

O projeto é um processador distribuído de transações de apostas. Ele:

- abre carteiras para jogadores;
- recebe operações `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`;
- calcula dinheiro sem usar `number` ou ponto flutuante;
- protege o saldo contra concorrência;
- registra cada alteração no ledger;
- evita débitos ou créditos duplicados;
- recebe mensagens pelo HTTP ou SQS;
- grava mensagens recebidas no Inbox;
- publica eventos pela Transactional Outbox;
- reprocessa referências que chegaram fora de ordem;
- usa retry, backoff e DLQ;
- expõe health checks, métricas e logs estruturados;
- suporta múltiplos processos compartilhando o mesmo PostgreSQL.

## 2. Fluxo geral

### Entrada HTTP

```text
HTTP
  -> DTO + ValidationPipe
  -> Controller
  -> Use Case
  -> transação PostgreSQL
  -> lock da wallet
  -> wallet + transação + ledger + outbox
  -> resposta HTTP
```

### Entrada SQS

```text
SQS
  -> SqsConsumerWorker
  -> envelope e normalização do payload
  -> Inbox persistente
  -> mesmo ProcessWagerUseCase usado pelo HTTP
  -> commit PostgreSQL
  -> ack/delete da mensagem
```

### Publicação de eventos

```text
Processamento financeiro
  -> evento gravado na Outbox na mesma transação SQL
  -> OutboxRelayWorker
  -> claim com FOR UPDATE SKIP LOCKED
  -> publicação SQS
  -> marcação como publicado
```

Se o processo morrer depois do commit e antes do `ack`, a mensagem reaparece.
O Inbox e a idempotência do banco impedem que o efeito financeiro seja aplicado
novamente.

## 3. Como o projeto foi construído

1. O domínio foi definido sem dependência de NestJS, HTTP ou SQS.
2. `Money`, `Wallet`, `WagerTransaction` e `WalletLedgerEntry` receberam
   factories e invariantes próprias.
3. Os casos de uso foram separados da persistência por meio de ports.
4. O contrato `IWalletRepository` foi implementado com MikroORM/PostgreSQL.
5. O lock pessimista passou a usar a `walletId` como unidade de concorrência.
6. Inbox, alteração financeira, ledger e Outbox foram colocados na mesma
   transação SQL.
7. Os controllers, DTOs e filtros HTTP foram adicionados sobre os casos de uso.
8. O consumidor SQS, relay da Outbox e worker de referências foram conectados
   ao ciclo de vida do NestJS.
9. Migrations e constraints foram adicionadas para reforçar as garantias no
   próprio banco.
10. Foram criados testes unitários, de integração, E2E, concorrência,
    homologação e processos independentes.

## 4. Estrutura de diretórios

| Diretório | Responsabilidade |
|---|---|
| `infra/localstack` | Inicialização das filas SQS locais |
| `src/domain` | Regras de negócio e modelos puros |
| `src/application` | Casos de uso, ports e utilitários |
| `src/infrastructure/database` | PostgreSQL, MikroORM, migrations e repositório |
| `src/infrastructure/messaging` | SQS, Inbox, Outbox e workers |
| `src/infrastructure/observability` | Métricas da aplicação |
| `src/interfaces/http` | Controllers, DTOs e filtro de erros HTTP |
| `test/unit` | Testes isolados de domínio, aplicação e workers |
| `test/integration` | Testes contra PostgreSQL |
| `test/e2e` | Testes HTTP com NestJS |
| `test/concurrency` | Concorrência real dentro da aplicação |
| `test/homologation` | PostgreSQL e LocalStack em containers |
| `test/operational` | Processos independentes, crash recovery e restart |
| `dist` | Saída gerada pelo build; não é código-fonte |
| `node_modules` | Dependências instaladas; não deve ser entregue |

## 5. Arquivos da raiz

| Arquivo | Função |
|---|---|
| `.env` | Configuração local; contém valores da máquina e não deve ser compartilhado |
| `.env.exemple` | Modelo das variáveis necessárias para configurar o projeto |
| `README.md` | Enunciado, regras e critérios do desafio |
| `README2.md` | Este guia didático da implementação |
| `ARCHITECTURE.md` | Decisões, garantias, trade-offs e limitações |
| `package.json` | Dependências e scripts Bun |
| `bun.lock` | Versões travadas das dependências |
| `docker-compose.yml` | Serviços locais PostgreSQL e LocalStack |
| `tsconfig.json` | Compilação TypeScript em modo estrito |

## 6. Inicialização da aplicação

| Arquivo | Função |
|---|---|
| `src/main.ts` | Cria o NestJS, ativa validação global, filtro de exceções e shutdown hooks |
| `src/app.module.ts` | Registra ORM, controllers, casos de uso, repositório, SQS, métricas e workers |

O `main.ts` também ativa `enableShutdownHooks()`, permitindo que os workers
devolvam mensagens em andamento ao SQS durante o encerramento.

## 7. Camada `domain`

### Modelos

| Arquivo | Função |
|---|---|
| `src/domain/models/Money.ts` | Value object imutável baseado em `Decimal`; valida escala, moeda e valores |
| `src/domain/models/Wallet.ts` | Aggregate root do saldo; aplica débito, crédito e versionamento |
| `src/domain/models/WagerTransaction.ts` | Representa operação, status, referência e transições |
| `src/domain/models/WalletLedgerEntry.ts` | Lançamento imutável com saldo anterior, movimento e saldo posterior |
| `src/domain/models/InboxMessage.ts` | Modelo de mensagem recebida e processada |
| `src/domain/models/OutboxMessage.ts` | Modelo de evento pendente, tentativas e backoff |

As entidades usam construtores privados e factories. O dinheiro é serializado
como `{ amount: string, currency: string }`. O banco usa `NUMERIC(18,2)`.

### Eventos e erros

| Arquivo | Função |
|---|---|
| `src/domain/events/IntegrationEvent.ts` | Envelope versionado com eventId, aggregateId, correlationId e data |
| `src/domain/events/DomainEvents.ts` | Eventos processado, rejeitado, saldo alterado e referência pendente |
| `src/domain/errors/DomainError.ts` | Códigos de falha estáveis e erros de domínio |

Os códigos permitem diferenciar saldo insuficiente, conflito de idempotência,
referência ausente, reversão duplicada, moeda incompatível e falhas internas.

## 8. Camada `application`

| Arquivo | Função |
|---|---|
| `src/application/ports/IWalletRepository.ts` | Contrato para wallet, transação, ledger, Inbox, Outbox e retries |
| `src/application/use-cases/OpenWalletUseCase.ts` | Abre wallet, cria saldo inicial e evento de abertura |
| `src/application/use-cases/ProcessWagerUseCase.ts` | Fluxo financeiro principal para todas as operações |
| `src/application/use-cases/ReconcileWalletUseCase.ts` | Reconstrói o saldo pelo ledger e sinaliza divergências |
| `src/application/utils/CanonicalJson.ts` | Ordena dados e calcula hash canônico para idempotência |

### Responsabilidades do `ProcessWagerUseCase`

- valida a chave de idempotência;
- calcula o hash do payload de negócio;
- retorna replay para payload igual;
- rejeita a mesma chave com payload diferente;
- abre transação SQL;
- localiza a wallet com lock pessimista;
- valida referência, player, provider, rodada, moeda e valor;
- processa `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`;
- cria no máximo um lançamento por wallet/transação;
- grava Inbox e Outbox atomicamente;
- atualiza métricas e logs;
- retorna status, saldo e código de falha.

## 9. Camada `infrastructure/database`

### Configuração e execução

| Arquivo | Função |
|---|---|
| `src/infrastructure/database/mikro-orm.config.ts` | Conexão, entidades e ordem das migrations |
| `src/infrastructure/database/run-migrations.ts` | Executa migrations pendentes |

### Migrations

| Arquivo | Função |
|---|---|
| `Migration20261003000001.ts` | Cria wallets, ledger, transações, Inbox e Outbox |
| `Migration20261003000002.ts` | Adiciona claim/lease da Outbox |
| `Migration20261003000003.ts` | Cria retries persistentes de `PENDING_REFERENCE` |
| `Migration20261003000004.ts` | Adiciona constraints financeiras e proteção append-only do ledger |

A última migration garante no banco:

- wallet sem saldo negativo;
- ledger com valor e saldos não negativos;
- uma entrada por `(transaction_id, wallet_id)`;
- directions, statuses e kinds válidos;
- bloqueio de `UPDATE` e `DELETE` no ledger por trigger.

### Entidades MikroORM

| Arquivo | Função |
|---|---|
| `WalletEntity.ts` | Mapeia wallets, saldo, versão e unicidade player/moeda |
| `WalletLedgerEntryEntity.ts` | Mapeia lançamentos imutáveis do ledger |
| `WagerTransactionEntity.ts` | Mapeia transações e chave de idempotência |
| `InboxMessageEntity.ts` | Mapeia Inbox com chave `(consumerName, messageId)` |
| `OutboxMessageEntity.ts` | Mapeia eventos, tentativas, publicação e lease |

### Repositório

| Arquivo | Função |
|---|---|
| `PostgresWalletRepository.ts` | Implementa todas as operações SQL e transações atômicas |

Esse repositório aplica `PESSIMISTIC_WRITE` na wallet. Assim, duas operações
sobre a mesma wallet são serializadas, enquanto wallets diferentes podem ser
processadas em paralelo.

## 10. Camada `infrastructure/messaging`

| Arquivo | Função |
|---|---|
| `sqs-client.ts` | Cria cliente AWS SQS para LocalStack ou AWS |
| `sqs.provider.ts` | Registra o cliente SQS como provider NestJS |
| `SqsConsumerWorker.ts` | Recebe, normaliza, processa, reconhece e devolve mensagens |
| `OutboxRelayWorker.ts` | Faz claim, publica eventos e agenda retry |
| `PendingReferenceWorker.ts` | Reprocessa referências ausentes com backoff persistente |
| `MessagingWorkersManager.ts` | Inicia e encerra os três workers no ciclo do NestJS |

O consumidor só remove a mensagem depois do commit. Em falha, a visibilidade
volta a zero para permitir redelivery. O modo de crash controlado usado no
teste operacional é ativado apenas com `CRASH_AFTER_COMMIT_BEFORE_ACK=true`.

O relay usa claim temporário, `FOR UPDATE SKIP LOCKED` e lease. Se uma instância
morrer depois de reivindicar uma mensagem, outra pode assumir o trabalho após a
expiração.

## 11. Observabilidade

| Arquivo | Função |
|---|---|
| `src/infrastructure/observability/MetricsService.ts` | Mantém contadores de status, duplicatas, retries, DLQ, locks, latência e lag |
| `src/interfaces/http/controllers/MetricsController.ts` | Expõe as métricas em `GET /metrics` |

Também existem logs JSON para processamento, retry, rejeição, publicação e
crash controlado. Os logs usam identificadores de correlação e não registram o
payload financeiro completo.

## 12. API HTTP

| Arquivo | Função |
|---|---|
| `HealthController.ts` | `GET /health/live` e `GET /health/ready` |
| `MetricsController.ts` | `GET /metrics` |
| `WalletController.ts` | Criação, consulta, ledger paginado e reconciliação |
| `WagerController.ts` | Submissão e consulta de transações |
| `OpenWalletDto.ts` | Valida `playerId`, `initialBalance`, moeda e valor inicial |
| `ProcessWagerDto.ts` | Valida o payload de aposta e seus aliases compatíveis |
| `DomainExceptionFilter.ts` | Converte erros de domínio em respostas HTTP consistentes |

Rotas principais:

```text
POST /wallets
GET  /wallets/:walletId
GET  /wallets/:walletId/ledger?cursor=...&limit=50
POST /wallets/:walletId/reconciliation
POST /wagering/transactions
GET  /wagering/transactions/:transactionId
GET  /providers/:providerId/wagering/transactions/:externalTransactionId
GET  /health/live
GET  /health/ready
GET  /metrics
```

Respostas financeiras expõem `money: { amount, currency }`. Campos achatados
anteriores continuam disponíveis para compatibilidade. O envio de transações
usa `200` para processamento concluído, `202` para referência pendente, `409`
para conflitos, `422` para rejeições de negócio, `400` para payload inválido e
`503` para falhas de infraestrutura.

## 13. Infraestrutura local

| Arquivo | Função |
|---|---|
| `docker-compose.yml` | Sobe PostgreSQL 16 e LocalStack |
| `infra/localstack/init-sqs.sh` | Cria fila FIFO principal e DLQ com redrive após três recebimentos |

Serviços esperados:

```text
PostgreSQL: localhost:5432
LocalStack: localhost:4566
Fila: wager-transactions.fifo
DLQ: wager-transactions-dlq.fifo
```

## 14. Testes

### Testes unitários

| Arquivo | Cobertura |
|---|---|
| `CanonicalJson.test.ts` | Hash independente da ordem das propriedades |
| `Money.test.ts` | Escala, moeda, entradas inválidas e operações |
| `Wallet.test.ts` | Débito, crédito, versão e saldo |
| `WalletLedgerEntry.test.ts` | Imutabilidade e equilíbrio do ledger |
| `WagerTransaction.test.ts` | Estados, referências e reversões |
| `MessagingModels.test.ts` | Inbox e Outbox |
| `OpenWalletUseCase.test.ts` | Abertura idempotente de wallet |
| `ProcessWagerUseCase.test.ts` | BET, rejeição e idempotência |
| `ReconcileWalletUseCase.test.ts` | Reconciliação consistente e inconsistente |
| `SqsConsumerWorker.test.ts` | Consumo e deduplicação pelo Inbox |
| `OutboxRelayWorker.test.ts` | Publicação e retry |
| `PendingReferenceWorker.test.ts` | Reprocessamento de referências |

### Testes de integração, E2E e concorrência

| Arquivo | Cobertura |
|---|---|
| `PostgresWalletRepository.test.ts` | Persistência e lock real no PostgreSQL |
| `ApiEndpoints.test.ts` | Health, wallet e transação via HTTP |
| `WagerConcurrency.test.ts` | 50 débitos concorrentes e rajada idempotente |

### Homologação distribuída

| Arquivo | Cobertura |
|---|---|
| `distributed-scenarios.test.ts` | Inbox, redelivery, DLQ, dois relays, referências fora de ordem, refund, rollback e ledger |

### Operação com processos reais

| Arquivo | Cobertura |
|---|---|
| `distributed-processes.test.ts` | Três instâncias HTTP, crash entre commit/ack, wallets paralelas e restart completo |

## 15. Comandos

```bash
# instalar dependências
bun install

# iniciar PostgreSQL e LocalStack
docker compose up -d --wait

# aplicar migrations
bun run migration:up

# executar em desenvolvimento
bun run start:dev

# compilar
bun run build

# suíte principal
bun test

# testes E2E
bun run test:e2e

# concorrência
bun run test:concurrency

# homologação com containers ativos
bun run test:homologation

# subir containers, migrar e homologar
bun run test:homologation:containers

# suíte principal + homologação
bun run test:all

# processos independentes, crash recovery e restart
bun run test:operational

# formatar
bun run format
```

## 16. Resultado da revisão final

Na última validação:

- build aprovado;
- migrations sem pendências;
- Problems/TypeScript sem erros;
- Prettier aprovado;
- 47 testes da suíte principal passando;
- 5 cenários de homologação passando;
- 4 cenários operacionais passando;
- 56 testes aprovados no total;
- 0 falhas;
- PostgreSQL e LocalStack reais utilizados nos testes distribuídos.

Autenticação externa não foi implementada porque o enunciado permite essa
decisão. Ela está documentada no `ARCHITECTURE.md`, com ponto de extensão para
Keycloak, Zitadel ou outro Identity Provider. Teste de carga com p50/p95/p99
também é opcional no desafio e não faz parte da contagem acima.
