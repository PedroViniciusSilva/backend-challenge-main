import { IWalletRepository } from "../ports/IWalletRepository";
import { Wallet } from "../../domain/models/Wallet";
import { Money } from "../../domain/models/Money";
import {
  WalletLedgerEntry,
  LedgerDirection,
} from "../../domain/models/WalletLedgerEntry";
import { OutboxMessage } from "../../domain/models/OutboxMessage";
import { WalletBalanceChanged } from "../../domain/events/DomainEvents";
import { v4 as uuidv4 } from "uuid";

export interface OpenWalletCommand {
  playerId: string;
  currency: string;
  initialAmount?: string;
}

export interface OpenWalletResult {
  walletId: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
  isNew: boolean;
}

export class OpenWalletUseCase {
  constructor(private readonly walletRepo: IWalletRepository) {}

  async execute(command: OpenWalletCommand): Promise<OpenWalletResult> {
    const currency = command.currency.trim().toUpperCase();
    const playerId = command.playerId.trim();

    const existing = await this.walletRepo.findByPlayerIdAndCurrency(
      playerId,
      currency,
    );
    if (existing) {
      return {
        walletId: existing.id,
        playerId: existing.playerId,
        currency: existing.currency,
        balance: existing.balance.toString(),
        version: existing.version,
        isNew: false,
      };
    }

    const walletId = uuidv4();
    const initialAmount = command.initialAmount ?? "0.00";
    const initialMoney = Money.from({ amount: initialAmount, currency });

    const wallet = Wallet.open({
      id: walletId,
      playerId,
      initialBalance: initialMoney,
    });

    let ledgerEntry: WalletLedgerEntry | undefined;
    let outboxMessage: OutboxMessage | undefined;

    if (!initialMoney.isZero()) {
      const txId = uuidv4();
      const zero = Money.from({ amount: "0.00", currency });

      ledgerEntry = WalletLedgerEntry.create({
        id: uuidv4(),
        walletId: wallet.id,
        transactionId: txId,
        direction: LedgerDirection.Credit,
        money: initialMoney,
        balanceBefore: zero,
        balanceAfter: initialMoney,
      });

      const event = new WalletBalanceChanged({
        eventId: uuidv4(),
        aggregateId: wallet.id,
        correlationId: uuidv4(),
        occurredAt: new Date(),
        data: {
          walletId: wallet.id,
          transactionId: txId,
          direction: LedgerDirection.Credit,
          money: initialMoney.toJSON(),
          balanceBefore: zero.toJSON(),
          balanceAfter: initialMoney.toJSON(),
          walletVersion: wallet.version,
        },
      });

      outboxMessage = OutboxMessage.enqueue(event);
    }

    await this.walletRepo.saveNewWallet(wallet, ledgerEntry, outboxMessage);

    return {
      walletId: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.balance.toString(),
      version: wallet.version,
      isNew: true,
    };
  }
}
