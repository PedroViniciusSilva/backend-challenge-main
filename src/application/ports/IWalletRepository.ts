import { Wallet } from "../../domain/models/Wallet";
import { WalletLedgerEntry } from "../../domain/models/WalletLedgerEntry";
import { WagerTransaction } from "../../domain/models/WagerTransaction";
import { OutboxMessage } from "../../domain/models/OutboxMessage";
import { InboxMessage } from "../../domain/models/InboxMessage";

export const WALLET_REPOSITORY_TOKEN = "IWalletRepository";

export interface SaveWagerAtomicParams {
  wallet: Wallet;
  transaction: WagerTransaction;
  ledgerEntry?: WalletLedgerEntry;
  outboxMessages: OutboxMessage[];
  inboxMessage?: InboxMessage;
}

export interface IWalletRepository {
  findById(id: string, lock?: boolean): Promise<Wallet | null>;
  findByPlayerIdAndCurrency(
    playerId: string,
    currency: string,
  ): Promise<Wallet | null>;
  findTransactionByIdempotencyKey(
    key: string,
  ): Promise<WagerTransaction | null>;
  findTransactionById(id: string): Promise<WagerTransaction | null>;
  findTransactionByExternalId(
    providerId: string,
    externalId: string,
  ): Promise<WagerTransaction | null>;
  findPendingReferenceTransactions(limit: number): Promise<WagerTransaction[]>;
  getPendingReferenceRetry?(
    transactionId: string,
  ): Promise<{ attempts: number; nextAttemptAt?: Date }>;
  savePendingReferenceRetry?(
    transactionId: string,
    attempts: number,
    nextAttemptAt: Date,
  ): Promise<void>;
  clearPendingReferenceRetry?(transactionId: string): Promise<void>;
  findReversalByReference(
    referenceTransactionId: string,
    kind: WagerTransaction["kind"],
  ): Promise<WagerTransaction | null>;
  saveNewWallet(
    wallet: Wallet,
    ledgerEntry?: WalletLedgerEntry,
    outboxMessage?: OutboxMessage,
  ): Promise<void>;
  saveWagerAtomic(params: SaveWagerAtomicParams): Promise<void>;
  getLedgerEntries(
    walletId: string,
    limit: number,
    cursor?: string,
  ): Promise<WalletLedgerEntry[]>;
  transactional<T>(action: (repo: IWalletRepository) => Promise<T>): Promise<T>;
}
