import { TransactionEnvelope } from '@saberhq/solana-contrib';
import { Keypair, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

export abstract class MultisigHelper {
  protected constructor(
    public readonly members: Keypair[],
    public readonly includeWallet: boolean,
    public readonly threshold: BN
  ) {}

  abstract createTransaction(tx: TransactionEnvelope): Promise<PublicKey>;
  abstract executeTransaction(address: PublicKey): Promise<void>;
  abstract get authority(): PublicKey;
  abstract get numTransactions(): BN;
  abstract reload(): Promise<void>;
  abstract transactionByIndex(index: BN): Promise<PublicKey>;
}
