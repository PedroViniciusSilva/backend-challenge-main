import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { MikroORM, RequestContext } from "@mikro-orm/postgresql";
import mikroOrmConfig from "./infrastructure/database/mikro-orm.config";
import { WalletController } from "./interfaces/http/controllers/WalletController";
import { WagerController } from "./interfaces/http/controllers/WagerController";
import { HealthController } from "./interfaces/http/controllers/HealthController";
import { MetricsController } from "./interfaces/http/controllers/MetricsController";
import { OpenWalletUseCase } from "./application/use-cases/OpenWalletUseCase";
import { ProcessWagerUseCase } from "./application/use-cases/ProcessWagerUseCase";
import { ReconcileWalletUseCase } from "./application/use-cases/ReconcileWalletUseCase";
import { PostgresWalletRepository } from "./infrastructure/database/repositories/PostgresWalletRepository";
import { EntityManager } from "@mikro-orm/postgresql";
import { WALLET_REPOSITORY_TOKEN } from "./application/ports/IWalletRepository";
import type { IWalletRepository } from "./application/ports/IWalletRepository";
import {
  SQS_CLIENT,
  sqsClientFactory,
} from "./infrastructure/messaging/sqs.provider";
import { MessagingWorkersManager } from "./infrastructure/messaging/MessagingWorkersManager";
import { MetricsService } from "./infrastructure/observability/MetricsService";

@Module({
  imports: [MikroOrmModule.forRoot(mikroOrmConfig)],
  controllers: [
    WalletController,
    WagerController,
    HealthController,
    MetricsController,
  ],
  providers: [
    {
      provide: WALLET_REPOSITORY_TOKEN,
      useFactory: (em: EntityManager) => new PostgresWalletRepository(em),
      inject: [EntityManager],
    },
    {
      provide: OpenWalletUseCase,
      useFactory: (repo: IWalletRepository) => new OpenWalletUseCase(repo),
      inject: [WALLET_REPOSITORY_TOKEN],
    },
    {
      provide: ProcessWagerUseCase,
      useFactory: (repo: IWalletRepository, metrics: MetricsService) =>
        new ProcessWagerUseCase(repo, metrics),
      inject: [WALLET_REPOSITORY_TOKEN, MetricsService],
    },
    {
      provide: ReconcileWalletUseCase,
      useFactory: (repo: IWalletRepository) => new ReconcileWalletUseCase(repo),
      inject: [WALLET_REPOSITORY_TOKEN],
    },
    { provide: SQS_CLIENT, useFactory: sqsClientFactory },
    MetricsService,
    {
      provide: MessagingWorkersManager,
      useFactory: (
        em: EntityManager,
        sqs: import("@aws-sdk/client-sqs").SQSClient,
        processWager: ProcessWagerUseCase,
        repository: IWalletRepository,
        metrics: MetricsService,
      ) =>
        new MessagingWorkersManager(em, sqs, processWager, repository, metrics),
      inject: [
        EntityManager,
        SQS_CLIENT,
        ProcessWagerUseCase,
        WALLET_REPOSITORY_TOKEN,
        MetricsService,
      ],
    },
  ],
})
export class AppModule implements NestModule {
  constructor(private readonly orm: MikroORM) {}

  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply((_req: unknown, _res: unknown, next: () => void) => {
        RequestContext.create(this.orm.em, next);
      })
      .forRoutes("*");
  }
}
