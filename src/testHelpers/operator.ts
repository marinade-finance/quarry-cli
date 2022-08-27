import { Operator, QuarrySDK } from '@quarryprotocol/quarry-sdk';
import { TransactionEnvelope } from '@saberhq/solana-contrib';
import { Keypair, PublicKey } from '@solana/web3.js';
import { MultisigHelper } from './multisig';

export interface PendingOperatorHelper {
  tx: TransactionEnvelope;
  key: PublicKey;
  factory(): Promise<OperatorHelper>;
}

export type OperatorHelperFactory = (
  rewarder: PublicKey
) => Promise<PendingOperatorHelper>;

export class OperatorHelper {
  private constructor(
    public readonly wrapper: Operator,
    public readonly admin?: Keypair | MultisigHelper,
    public readonly rateSetter?: Keypair | MultisigHelper,
    public readonly shareAllocator?: Keypair | MultisigHelper,
    public readonly quarryCreator?: Keypair | MultisigHelper
  ) {}

  static prepare({
    sdk,
    admin,
    rateSetter,
    shareAllocator,
    quarryCreator,
  }: {
    sdk: QuarrySDK;
    admin?: Keypair | MultisigHelper;
    rateSetter?: Keypair | MultisigHelper;
    shareAllocator?: Keypair | MultisigHelper;
    quarryCreator?: Keypair | MultisigHelper;
  }): OperatorHelperFactory {
    let adminAuthority: PublicKey;
    if (admin instanceof MultisigHelper) {
      adminAuthority = admin.authority;
    } else {
      adminAuthority = admin?.publicKey || sdk.provider.walletKey;
    }
    const rateSetterAuthority =
      rateSetter instanceof MultisigHelper
        ? rateSetter.authority
        : rateSetter?.publicKey || sdk.provider.walletKey;
    const shareAllocatorAuthority =
      shareAllocator instanceof MultisigHelper
        ? shareAllocator.authority
        : shareAllocator?.publicKey || sdk.provider.walletKey;
    const quarryCreatorAuthority =
      quarryCreator instanceof MultisigHelper
        ? quarryCreator.authority
        : quarryCreator?.publicKey || sdk.provider.walletKey;

    return async (rewarder: PublicKey) => {
      const { key, tx } = await sdk.createOperator({
        rewarder,
      }); // Admin is wallet for now

      if (!rateSetterAuthority.equals(sdk.provider.walletKey)) {
        tx.append(
          await sdk.programs.Operator.methods
            .setRateSetter()
            .accounts({
              operator: key,
              delegate: rateSetterAuthority,
            })
            .instruction()
        );
      }

      if (!shareAllocatorAuthority.equals(sdk.provider.walletKey)) {
        tx.append(
          await sdk.programs.Operator.methods
            .setShareAllocator()
            .accounts({
              operator: key,
              delegate: shareAllocatorAuthority,
            })
            .instruction()
        );
      }

      if (!quarryCreatorAuthority.equals(sdk.provider.walletKey)) {
        tx.append(
          await sdk.programs.Operator.methods
            .setQuarryCreator()
            .accounts({
              operator: key,
              delegate: quarryCreatorAuthority,
            })
            .instruction()
        );
      }

      if (!adminAuthority.equals(sdk.provider.walletKey)) {
        tx.append(
          await sdk.programs.Operator.methods
            .setAdmin()
            .accounts({
              operator: key,
              delegate: adminAuthority,
            })
            .instruction()
        );
      }

      // sdk.programs.Operator.methods.
      return {
        tx,
        key,
        async factory() {
          return new OperatorHelper(
            (await sdk.loadOperator(key))!,
            admin,
            rateSetter,
            shareAllocator,
            quarryCreator
          );
        },
      };
    };
  }
}
