#!/usr/bin/env bash
set -euo pipefail

echo "==> Inicializando filas SQS no LocalStack..."

# Criar Fila DLQ (Dead Letter Queue) FIFO
awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false

# Obter ARN da DLQ para associar à fila principal
DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-name wager-transactions-dlq.fifo \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

REDRIVE_POLICY=$(printf '{"deadLetterTargetArn":"%s","maxReceiveCount":"3"}' "$DLQ_ARN")

# Criar Fila Principal FIFO associada à DLQ (máximo de 3 tentativas)
awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false,RedrivePolicy="$REDRIVE_POLICY"

echo "==> Filas SQS criadas com sucesso!"