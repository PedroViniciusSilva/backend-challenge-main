import Decimal from "decimal.js";
import { IWalletRepository } from "../ports/IWalletRepository";
import { LedgerDirection } from "../../domain/models/WalletLedgerEntry";
import { Money } from "../../domain/models/Money";

export interface ReconcileWalletCommand {
  walletId: string;
}

export interface ReconcileWalletResult {
  walletId: string;
  currency: string;
  currentBalance: string;
  calculatedBalance: string;
  totalCredits: string;
  totalDebits: string;
  entriesCount: number;
  isConsistent: boolean;
  difference: string;
}

export class ReconcileWalletUseCase {
  constructor(private readonly walletRepo: IWalletRepository) {}

  async execute(
    command: ReconcileWalletCommand,
  ): Promise<ReconcileWalletResult> {
    const wallet = await this.walletRepo.findById(command.walletId, false);
    if (!wallet) {
      throw new Error(
        `Carteira ${command.walletId} não encontrada para reconciliação`,
      );
    }

    const entries = await this.walletRepo.getLedgerEntries(wallet.id, 100000);

    let credits = Money.from({ amount: "0.00", currency: wallet.currency });
    let debits = Money.from({ amount: "0.00", currency: wallet.currency });

    for (const entry of entries) {
      if (entry.direction === LedgerDirection.Credit) {
        credits = credits.add(entry.money);
      } else if (entry.direction === LedgerDirection.Debit) {
        debits = debits.add(entry.money);
      }
    }

    const calculatedBalance = credits.subtract(debits);
    const isConsistent = wallet.balance.equals(calculatedBalance);

    const currentDec = new Decimal(wallet.balance.toString());
    const calcDec = new Decimal(calculatedBalance.toString());
    const diffDec = currentDec.minus(calcDec).abs();

    return {
      walletId: wallet.id,
      currency: wallet.currency,
      currentBalance: wallet.balance.toString(),
      calculatedBalance: calculatedBalance.toString(),
      totalCredits: credits.toString(),
      totalDebits: debits.toString(),
      entriesCount: entries.length,
      isConsistent,
      difference: diffDec.toFixed(2),
    };
  }
}
