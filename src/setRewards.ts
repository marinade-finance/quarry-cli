import { GokiSDK, SmartWalletWrapper } from '@gokiprotocol/client';
import {
  Operator,
  QuarrySDK,
  RewarderWrapper,
} from '@quarryprotocol/quarry-sdk';
import {
  TransactionEnvelope,
  TransactionReceipt,
} from '@saberhq/solana-contrib';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  RpcResponseAndContext,
  SimulatedTransactionResponse,
} from '@solana/web3.js';
import assert from 'assert';
import BN from 'bn.js';
import { Command } from 'commander';
import { useContext } from './context';
import {
  parseKeypair,
  parsePubkey,
  middleware as m,
} from '@marinade.finance/solana-cli-utils';

export interface QuarryShare {
  mint: PublicKey;
  share: BN;
}

export function installSetRewards(program: Command) {
  program
    .command('set-rewards')
    .requiredOption(
      '--rewarder <address>',
      'Rewarder',
      parsePubkey,
      Promise.resolve(
        new PublicKey('J829VB5Fi7DMoMLK7bsVGFM82cRU61BKtiPz9PNFdL7b')
      )
    )
    .option(
      '--share <mint:share...>',
      'Quarry share',
      (value, acc: QuarryShare[] = []) => {
        const [mint, share] = value.split(':');
        acc.push({
          mint: new PublicKey(mint),
          share: new BN(share),
        });
        return acc;
      }
    )
    .option(
      '--rewards-per-share <value>',
      'Rewards per share',
      value => new BN(value)
    )
    .option('--total-rewards <value>', 'Total rewards', value => new BN(value))
    .option('--daily', 'Daily mode')
    .option('--weekly', 'Weekly mode')
    .option('--annual', 'Annual mode')
    .option('--share-allocator <keypair>', 'Share alloctor', parseKeypair)
    .option('--rate-setter <keypair>', 'Rate setter', parseKeypair)
    .option('--rent-payer <keypair>', 'Rent payer', parseKeypair)
    .option('--proposer <keypair>', 'Proposer', parseKeypair)
    .option('--log-only', 'Do not create multisig transaction')
    .option('--community', 'Create community proposal')
    .action(
      async ({
        rewarder,
        share,
        rewardsPerShare,
        totalRewards,
        daily,
        weekly,
        annual,
        shareAllocator,
        rateSetter,
        rentPayer,
        proposer,
        logOnly,
        community = false,
      }: {
        rewarder: Promise<PublicKey>;
        share?: QuarryShare[];
        rewardsPerShare?: BN;
        totalRewards?: BN;
        daily: boolean;
        weekly: boolean;
        annual: boolean;
        shareAllocator?: Promise<Keypair>;
        rateSetter?: Promise<Keypair>;
        rentPayer?: Promise<Keypair>;
        proposer?: Promise<Keypair>;
        logOnly?: boolean;
        community?: boolean;
      }) => {
        const context = useContext();
        let multiplier = new BN(1);
        if (daily) {
          multiplier = new BN(365);
        }
        if (weekly) {
          if (!multiplier.eq(new BN(1))) {
            throw new Error('Only one of daily, weekly and annual must be set');
          }
          multiplier = new BN(52);
        }
        if (annual) {
          if (!multiplier.eq(new BN(1))) {
            throw new Error('Only one of daily, weekly and annual must be set');
          }
        }
        await setRewards({
          quarry: context.quarry,
          goki: context.goki,
          rewarder: await rewarder,
          shares: share,
          rewardsPerShare,
          totalRewards,
          multiplier,
          shareAllocator: await shareAllocator,
          rateSetter: await rateSetter,
          rentPayer: await rentPayer,
          proposer: await proposer,
          community,
          simulate: context.simulate,
        });
      }
    );
}

export async function setRewards({
  quarry,
  goki,
  rewarder,
  shares,
  rewardsPerShare,
  totalRewards,
  multiplier = new BN(1),
  shareAllocator,
  rateSetter,
  rentPayer,
  proposer,
  logOnly,
  community = false,
  simulate,
}: {
  quarry: QuarrySDK;
  goki: GokiSDK;
  rewarder: PublicKey;
  shares?: QuarryShare[];
  rewardsPerShare?: BN;
  totalRewards?: BN;
  multiplier?: BN;
  shareAllocator?: Keypair;
  rateSetter?: Keypair;
  rentPayer?: Keypair;
  proposer?: Keypair;
  logOnly?: boolean;
  community?: boolean;
  simulate?: boolean;
}) {
  const rewarderWrapper = await quarry.mine.loadRewarderWrapper(rewarder);
  const quarries = await quarry.mine.program.account.quarry.all(
    rewarderWrapper.rewarderKey.toBuffer()
  );
  const shareMap = new Map<string, BN>();
  for (const quarryWrapper of quarries) {
    shareMap.set(
      quarryWrapper.account.tokenMintKey.toBase58(),
      quarryWrapper.account.rewardsShare
    );
  }

  if (shares) {
    for (const r of shares) {
      shareMap.set(r.mint.toBase58(), r.share);
    }
  }

  if (totalRewards === undefined) {
    if (rewardsPerShare !== undefined) {
      let totalShare = new BN(0);

      shareMap.forEach(value => {
        totalShare = totalShare.add(value);
      });
      totalRewards = totalShare.mul(rewardsPerShare);
    }
  }

  if (totalRewards !== undefined) {
    totalRewards = totalRewards.mul(multiplier);
  }

  let operator: Operator | null = null;

  try {
    operator = await quarry.loadOperator(
      rewarderWrapper.rewarderData.authority
    );
  } catch (e) {
    /**/
  }

  let rateSetterAuthority: PublicKey;
  let shareAllocatorAuthority: PublicKey;
  if (operator) {
    rateSetterAuthority = operator.data.rateSetter;
    shareAllocatorAuthority = operator.data.shareAllocator;
  } else {
    shareAllocatorAuthority = rateSetterAuthority =
      rewarderWrapper.rewarderData.authority;
  }

  let hasChanges = false;
  let hasMultisigs = false;

  if (shares) {
    if (
      shareAllocator &&
      !shareAllocatorAuthority.equals(shareAllocator.publicKey)
    ) {
      throw new Error(
        `Invalid share allocator ${
          shareAllocator.publicKey
        }. Expected ${shareAllocatorAuthority.toBase58()}`
      );
    }

    const middleware: m.Middleware[] = [];
    await m.installMultisigMiddleware({
      middleware,
      goki,
      address: shareAllocatorAuthority,
      proposer,
      rentPayer,
      logOnly,
      community,
    });
    if (middleware.length > 0) {
      hasMultisigs = true;
    }

    let setSharesTx = new TransactionEnvelope(quarry.provider, []);

    for (const quarryWrapper of quarries) {
      const share = shareMap.get(
        quarryWrapper.account.tokenMintKey.toBase58()
      )!;
      if (!share.eq(quarryWrapper.account.rewardsShare)) {
        hasChanges = true;
        console.log(
          `Quarry for ${quarryWrapper.account.tokenMintKey.toBase58()} change rate ${
            quarryWrapper.account.rewardsShare
          } -> ${share}`
        );
        if (operator) {
          setSharesTx.append(
            await quarry.programs.Operator.methods
              .delegateSetRewardsShare(share)
              .accounts({
                withDelegate: {
                  operator: operator.key,
                  delegate: shareAllocatorAuthority,
                  rewarder,
                  quarryMineProgram: quarry.programs.Mine.programId,
                },
                quarry: quarryWrapper.publicKey,
              })
              .instruction()
          );
        } else {
          setSharesTx.append(
            await quarry.programs.Mine.methods
              .setRewardsShare(share)
              .accounts({
                auth: {
                  authority: shareAllocatorAuthority,
                  rewarder,
                },
                quarry: quarryWrapper.publicKey,
              })
              .instruction()
          );
        }
      }
    }

    for (const m of middleware) {
      setSharesTx = await m.apply(setSharesTx);
    }

    if (shareAllocator) {
      setSharesTx.addSigners(shareAllocator);
    }

    for (const tx of setSharesTx.partition()) {
      if (simulate) {
        const result = await tx.simulate();
        console.log(JSON.stringify(result.value));
      } else {
        const result = await tx.confirm();
        console.log(`Tx: ${result.signature}`);
      }
    }
  }

  if (
    totalRewards &&
    !totalRewards.eq(rewarderWrapper.rewarderData.annualRewardsRate)
  ) {
    hasChanges = true;
    if (rateSetter && !rateSetterAuthority.equals(rateSetter.publicKey)) {
      throw new Error(
        `Invalid rate setter ${
          rateSetter.publicKey
        }. Expected ${rateSetterAuthority.toBase58()}`
      );
    }

    const middleware: m.Middleware[] = [];
    await m.installMultisigMiddleware({
      middleware,
      goki,
      address: rateSetterAuthority,
      proposer,
      rentPayer,
      logOnly,
      community,
    });
    if (middleware.length > 0) {
      hasMultisigs = true;
    }

    let setRatesTx = new TransactionEnvelope(quarry.provider, []);

    if (operator) {
      setRatesTx.append(
        await quarry.programs.Operator.methods
          .delegateSetAnnualRewards(totalRewards)
          .accounts({
            withDelegate: {
              operator: operator.key,
              delegate: rateSetterAuthority,
              rewarder,
              quarryMineProgram: quarry.programs.Mine.programId,
            },
          })
          .instruction()
      );
    } else {
      setRatesTx.append(
        await quarry.programs.Mine.methods
          .setAnnualRewards(totalRewards)
          .accounts({
            auth: {
              authority: shareAllocatorAuthority,
              rewarder,
            },
          })
          .instruction()
      );
    }

    if (rateSetter) {
      setRatesTx.addSigners(rateSetter);
    }

    for (const m of middleware) {
      setRatesTx = await m.apply(setRatesTx);
    }
    if (simulate) {
      const result = await setRatesTx.simulate();
      console.log(JSON.stringify(result.value));
    } else {
      const result = await setRatesTx.confirm();
      console.log(`Tx: ${result.signature}`);
    }
  }

  if (hasChanges && !hasMultisigs) {
    const tx = await rewarderWrapper.syncQuarryRewards(
      quarries.map(quarry => quarry.account.tokenMintKey)
    );
    const results = await Promise.all(
      tx.partition().map(async tx => {
        if (simulate) {
          return tx.simulate();
        } else {
          return tx.confirm();
        }
      })
    );
    if (simulate) {
      for (const r of results) {
        console.log(
          (r as RpcResponseAndContext<SimulatedTransactionResponse>).value
        );
      }
    } else {
      for (const r of results) {
        console.log(`Tx: ${(r as TransactionReceipt).signature}`);
      }
    }
  }
}
