import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { OpenWalletDto } from "../dtos/OpenWalletDto";
import { OpenWalletUseCase } from "../../../application/use-cases/OpenWalletUseCase";
import { ReconcileWalletUseCase } from "../../../application/use-cases/ReconcileWalletUseCase";
import { WALLET_REPOSITORY_TOKEN } from "../../../application/ports/IWalletRepository";
import type { IWalletRepository } from "../../../application/ports/IWalletRepository";

@Controller("wallets")
export class WalletController {
  constructor(
    private readonly openWalletUseCase: OpenWalletUseCase,
    private readonly reconcileWalletUseCase: ReconcileWalletUseCase,
    @Inject(WALLET_REPOSITORY_TOKEN)
    private readonly walletRepo: IWalletRepository,
  ) {}

  @Post()
  async openWallet(@Body() dto: OpenWalletDto) {
    return this.openWalletUseCase.execute({
      playerId: dto.playerId,
      currency: dto.initialBalance?.currency ?? dto.currency ?? "BRL",
      initialAmount: dto.initialBalance?.amount ?? dto.initialAmount,
    });
  }

  @Get(":id")
  async getWallet(@Param("id") id: string) {
    const wallet = await this.walletRepo.findById(id, false);
    if (!wallet) {
      return { statusCode: 404, message: "Carteira não encontrada" };
    }
    return {
      walletId: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.balance.toString(),
      money: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }

  @Get(":id/reconcile")
  async reconcile(@Param("id") id: string) {
    return this.reconcileWalletUseCase.execute({ walletId: id });
  }

  @Post(":id/reconciliation")
  async reconciliation(@Param("id") id: string) {
    return this.reconcileWalletUseCase.execute({ walletId: id });
  }

  @Get(":id/ledger")
  async getLedger(
    @Param("id") id: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const pageSize = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const entries = await this.walletRepo.getLedgerEntries(
      id,
      pageSize,
      cursor,
    );
    const response = entries.map((e) => ({
      id: e.id,
      direction: e.direction,
      amount: e.money.toString(),
      currency: e.money.currency,
      money: e.money.toJSON(),
      balanceBefore: e.balanceBefore.toString(),
      balanceAfter: e.balanceAfter.toString(),
      balanceBeforeMoney: e.balanceBefore.toJSON(),
      balanceAfterMoney: e.balanceAfter.toJSON(),
      createdAt: e.createdAt.toISOString(),
    }));
    return {
      items: response,
      nextCursor:
        entries.length === pageSize
          ? entries[entries.length - 1].createdAt.toISOString()
          : null,
    };
  }
}
