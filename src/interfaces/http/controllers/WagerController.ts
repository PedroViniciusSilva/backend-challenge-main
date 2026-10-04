import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { ProcessWagerDto } from "../dtos/ProcessWagerDto";
import { ProcessWagerUseCase } from "../../../application/use-cases/ProcessWagerUseCase";

@Controller()
export class WagerController {
  constructor(private readonly processWagerUseCase: ProcessWagerUseCase) {}

  @Post(["wagers", "wagering/transactions"])
  @HttpCode(HttpStatus.OK)
  async processWager(
    @Body() dto: ProcessWagerDto,
    @Headers("x-idempotency-key") headerIdempotencyKey?: string,
    @Headers("x-correlation-id") correlationId?: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const idempotencyKey = headerIdempotencyKey || dto.idempotencyKey;
    const amount = dto.money?.amount || dto.amount;
    const currency = dto.money?.currency || dto.currency;
    if (!idempotencyKey || !amount || !currency) {
      throw new BadRequestException("Idempotency-Key e money são obrigatórios");
    }

    const result = await this.processWagerUseCase.execute({
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      idempotencyKey,
      walletId: dto.walletId,
      playerId: dto.playerId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind,
      amount: amount!,
      currency: currency!,
      referenceExternalTransactionId: dto.referenceExternalTransactionId,
      correlationId,
    });
    if (response) {
      if (result.status === "PENDING_REFERENCE") {
        response.status(HttpStatus.ACCEPTED);
      } else if (
        result.failureCode === "IDEMPOTENCY_PAYLOAD_CONFLICT" ||
        result.failureCode === "REFERENCE_ALREADY_REVERSED"
      ) {
        response.status(HttpStatus.CONFLICT);
      } else if (result.status === "REJECTED") {
        response.status(HttpStatus.UNPROCESSABLE_ENTITY);
      }
    }
    return result;
  }

  @Get([
    "wagers/transactions/:transactionId",
    "wagering/transactions/:transactionId",
  ])
  async getTransaction(@Param("transactionId") transactionId: string) {
    const transaction =
      await this.processWagerUseCase.findTransactionById(transactionId);
    if (!transaction) {
      throw new NotFoundException("Transação não encontrada");
    }
    return {
      transactionId: transaction.id,
      status: transaction.status,
      walletId: transaction.walletId,
      amount: transaction.money.toString(),
      currency: transaction.money.currency,
      money: transaction.money.toJSON(),
      failureCode: transaction.failureCode,
      referenceTransactionId: transaction.referenceTransactionId,
    };
  }

  @Get([
    "wagers/providers/:providerId/transactions/:externalTransactionId",
    "providers/:providerId/wagering/transactions/:externalTransactionId",
  ])
  async getTransactionByExternalId(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
  ) {
    const transaction =
      await this.processWagerUseCase.findTransactionByExternalId(
        providerId,
        externalTransactionId,
      );
    if (!transaction) {
      throw new NotFoundException("Transação não encontrada");
    }
    return {
      transactionId: transaction.id,
      status: transaction.status,
      walletId: transaction.walletId,
      amount: transaction.money.toString(),
      currency: transaction.money.currency,
      money: transaction.money.toJSON(),
      failureCode: transaction.failureCode,
      referenceTransactionId: transaction.referenceTransactionId,
    };
  }
}
