import { SQSClient } from "@aws-sdk/client-sqs";

export function createSQSClient(): SQSClient {
  const isLocal =
    process.env.AWS_ENDPOINT_URL || process.env.NODE_ENV !== "production";

  return new SQSClient({
    region: process.env.AWS_REGION || "us-east-1",
    endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
    },
    useQueueUrlAsEndpoint: !isLocal,
  });
}
