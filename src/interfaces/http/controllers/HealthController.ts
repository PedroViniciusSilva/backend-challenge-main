import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
} from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { SQS_CLIENT } from "../../../infrastructure/messaging/sqs.provider";

@Controller("health")
export class HealthController {
  constructor(
    private readonly em: EntityManager,
    @Optional() @Inject(SQS_CLIENT) private readonly sqsClient?: SQSClient,
  ) {}

  @Get("liveness")
  liveness() {
    return { status: "UP", timestamp: new Date().toISOString() };
  }

  @Get("live")
  live() {
    return this.liveness();
  }

  @Get("readiness")
  async readiness() {
    try {
      await this.em.getConnection().execute("SELECT 1");
      let sqs = "NOT_CONFIGURED";
      if (this.sqsClient && process.env.SQS_QUEUE_URL) {
        await this.sqsClient.send(
          new GetQueueAttributesCommand({
            QueueUrl: process.env.SQS_QUEUE_URL,
            AttributeNames: ["QueueArn"],
          }),
        );
        sqs = "CONNECTED";
      }
      const result = {
        status: "UP",
        database: "CONNECTED",
        sqs,
        timestamp: new Date().toISOString(),
      };
      return result;
    } catch (error) {
      const result = {
        status: "DOWN",
        database: "DISCONNECTED",
        error: String(error),
      };
      throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  @Get("ready")
  ready() {
    return this.readiness();
  }
}
