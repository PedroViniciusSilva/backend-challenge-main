import { SQSClient } from "@aws-sdk/client-sqs";
import { createSQSClient } from "./sqs-client";

export const SQS_CLIENT = "SQS_CLIENT";

export function sqsClientFactory(): SQSClient {
  return createSQSClient();
}
