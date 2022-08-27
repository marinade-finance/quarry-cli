import {
  findTransactionAddress,
  GokiSDK,
  SmartWalletWrapper,
} from '@gokiprotocol/client';
import { TransactionEnvelope } from '@saberhq/solana-contrib';
import { Keypair, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { MultisigHelper } from './multisig';

export class GokiHelper extends MultisigHelper {
  private constructor(
    public readonly goki: GokiSDK,
    members: Keypair[],
    includeWallet: boolean,
    threshold: BN,
    public readonly smartWalletWrapper: SmartWalletWrapper
  ) {
    super(members, includeWallet, threshold);
  }

  static async create({
    goki,
    members = [],
    includeWallet = true,
    threshold = new BN(1),
  }: {
    goki: GokiSDK;
    members?: Keypair[];
    includeWallet?: boolean;
    threshold?: BN;
  }): Promise<GokiHelper> {
    const { smartWalletWrapper, tx } = await goki.newSmartWallet({
      owners: (includeWallet ? [goki.provider.walletKey] : []).concat(
        members.map(m => m.publicKey)
      ),
      threshold,
      numOwners: members.length + 1,
    });
    await tx.confirm();
    return new GokiHelper(
      goki,
      members,
      includeWallet,
      threshold,
      smartWalletWrapper
    );
  }

  async createTransaction(inner: TransactionEnvelope): Promise<PublicKey> {
    const { tx, transactionKey } =
      await this.smartWalletWrapper.newTransactionFromEnvelope({
        tx: inner,
        proposer: this.includeWallet
          ? this.goki.provider.walletKey
          : this.members[0].publicKey,
        payer: this.goki.provider.walletKey,
      });
    if (!this.includeWallet) {
      tx.addSigners(this.members[0]);
    }
    await tx.confirm();
    await this.smartWalletWrapper.reloadData();
    return transactionKey;
  }

  async executeTransaction(address: PublicKey): Promise<void> {
    const info = await this.smartWalletWrapper.fetchTransaction(address);
    let signersLeft =
      this.smartWalletWrapper.data!.threshold.toNumber() -
      info.signers.filter(s => s).length;
    let tx = new TransactionEnvelope(this.goki.provider, []);
    for (let i = 0; i < info.signers.length && signersLeft > 0; i++) {
      if (!info.signers[i]) {
        tx = tx.combine(
          this.smartWalletWrapper.approveTransaction(
            address,
            this.members[i].publicKey
          )
        );
        tx.addSigners(this.members[i]);
        signersLeft--;
      }
    }
    tx = tx.combine(
      await this.smartWalletWrapper.executeTransaction({
        transactionKey: address,
        owner: this.includeWallet
          ? this.goki.provider.walletKey
          : this.members[0].publicKey,
      })
    );
    if (!this.includeWallet) {
      tx.addSigners(this.members[0]);
    }
    await tx.confirm();
  }

  get authority() {
    return this.smartWalletWrapper.key;
  }

  get numTransactions() {
    return this.smartWalletWrapper.data!.numTransactions;
  }

  async reload(): Promise<void> {
    await this.smartWalletWrapper.reloadData();
  }

  async transactionByIndex(index: BN): Promise<PublicKey> {
    const [tx] = await findTransactionAddress(
      this.smartWalletWrapper.key,
      index.toNumber()
    );
    return tx;
  }
}
