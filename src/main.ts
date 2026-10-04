import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { DomainExceptionFilter } from "./interfaces/http/filters/DomainExceptionFilter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new DomainExceptionFilter());

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`==> Distributed Wagering Processor rodando na porta ${port}`);
}

bootstrap();
