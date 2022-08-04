import { GokiSDK, SmartWalletWrapper } from "@gokiprotocol/client";
import {
  Operator,
  QuarrySDK,
  RewarderWrapper,
} from "@quarryprotocol/quarry-sdk";
import { TransactionEnvelope } from "@saberhq/solana-contrib";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import assert from "assert";
import BN from "bn.js";
import { Command } from "commander";
import { useContext } from "./context";
import { parseKeypair, parsePubkey } from "./keyParser";

export interface QuarryShare {
  mint: PublicKey;
  share: BN;
}

export function installSetRewards(program: Command) {
  program
    .command("set-rewards")
    .requiredOption(
      "--rewarder <address>",
      "Rewarder",
      parsePubkey,
      Promise.resolve(
        new PublicKey("J829VB5Fi7DMoMLK7bsVGFM82cRU61BKtiPz9PNFdL7b")
      )
    )
    .option(
      "--share <mint:share...>",
      "Quarry share",
      (value, acc: QuarryShare[] = []) => {
        const [mint, share] = value.split(":");
        acc.push({
          mint: new PublicKey(mint),
          share: new BN(share),
        });
        return acc;
      }
    )
    .option(
      "--rewards-per-share <value>",
      "Rewards per share",
      (value) => new BN(value)
    )
    .option(
      "--total-rewards <value>",
      "Total rewards",
      (value) => new BN(value)
    )
    .option("--daily", "Daily mode")
    .option("--weekly", "Weekly mode")
    .option("--annual", "Annual mode")
    .option("--share-allocator <keypair>", "Share alloctor", parseKeypair)
    .option("--rate-setter <keypair>", "Rate setter", parseKeypair)
    .option("--rent-payer <keypair>", "Rent payer", parseKeypair)
    .option("--proposer <keypair>", "Proposer", parseKeypair)
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
      }) => {
        const context = useContext();
        let multiplier = new BN(1);
        if (daily) {
          multiplier = new BN(365);
        }
        if (weekly) {
          if (!multiplier.eq(new BN(1))) {
            throw new Error("Only one of daily, weekly and annual must be set");
          }
          multiplier = new BN(52);
        }
        if (annual) {
          if (!multiplier.eq(new BN(1))) {
            throw new Error("Only one of daily, weekly and annual must be set");
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
  simulate?: boolean;
}) {
  const rewarderWrapper = await quarry.mine.loadRewarderWrapper(rewarder);
  const quarries = await quarry.mine.program.account.quarry.all(
    rewarderWrapper.rewarderKey.toBuffer()
  );
  const mints = quarries.map((quarry) => quarry.account.tokenMintKey);
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

      shareMap.forEach((value) => {
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

  if (rateSetter && !rateSetterAuthority.equals(rateSetter.publicKey)) {
    throw new Error(
      `Invalid rate setter ${
        rateSetter.publicKey
      }. Expected ${rateSetterAuthority.toBase58()}`
    );
  }

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

  let tx = new TransactionEnvelope(quarry.provider, []);

  if (shares) {
    let shareAllocatorSmartWallet: SmartWalletWrapper | undefined;
    if (!shareAllocator) {
      try {
        shareAllocatorSmartWallet = await goki.loadSmartWallet(
          shareAllocatorAuthority
        );
        console.log("Using share allocator GOKI smart wallet");
      } catch {
        /**/
      }
    }

    const setSharesTx = new TransactionEnvelope(quarry.provider, []);

    for (const quarryWrapper of quarries) {
      const share = shareMap.get(
        quarryWrapper.account.tokenMintKey.toBase58()
      )!;
      if (!share.eq(quarryWrapper.account.rewardsShare)) {
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

    if (shareAllocator) {
      setSharesTx.addSigners(shareAllocator);
    } else if (shareAllocatorSmartWallet) {
      while (setSharesTx.instructions.length > 0) {
        let testTx = new TransactionEnvelope(tx.provider, [
          ...setSharesTx.instructions,
        ]);
        do {
          const {
            tx: newTransactionTx,
            transactionKey,
            index,
          } = await shareAllocatorSmartWallet.newTransactionFromEnvelope({
            tx: testTx,
            proposer: proposer?.publicKey,
            payer: rentPayer?.publicKey,
          });
          if (proposer) {
            newTransactionTx.addSigners(proposer);
          }
          if (rentPayer) {
            newTransactionTx.addSigners(rentPayer);
          }
          const estimation = newTransactionTx.estimateSize();
          if ("size" in estimation) {
            console.log(
              `Creating GOKI tx #${index}) ${transactionKey.toBase58()}`
            );
            if (simulate) {
              const result = await newTransactionTx.simulate();
              console.log(JSON.stringify(result.value));
            } else {
              const result = await newTransactionTx.confirm();
              console.log(`Tx: ${result.signature}`);
            }
            break;
          }
          testTx.instructions.pop();
          assert(testTx.instructions.length > 0);
        } while (true);

        for (const _ of testTx.instructions) {
          setSharesTx.instructions.shift();
        }
      }
    } else if (!shareAllocatorAuthority.equals(quarry.provider.walletKey)) {
      throw new Error(`Share allocator ${shareAllocatorAuthority.toBase58()} signature is required`);
    }
    tx = tx.combine(setSharesTx); // must be empty if goki was used
  }

  if (totalRewards) {
    let rateSetterSmartWalletWrapper: SmartWalletWrapper | undefined;
    if (!rateSetter && totalRewards !== undefined) {
      try {
        rateSetterSmartWalletWrapper = await goki.loadSmartWallet(
          rateSetterAuthority
        );
        console.log("Using rate setter GOKI smart wallet");
      } catch {
        /**/
      }
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
      tx.addSigners(rateSetter);
    } else if (rateSetterSmartWalletWrapper) {
      const {
        tx: newTransactionTx,
        transactionKey,
        index,
      } = await rateSetterSmartWalletWrapper.newTransactionFromEnvelope({
        tx: setRatesTx,
        proposer: proposer?.publicKey,
        payer: rentPayer?.publicKey,
      });
      if (proposer) {
        newTransactionTx.addSigners(proposer);
      }
      if (rentPayer) {
        newTransactionTx.addSigners(rentPayer);
      }
      console.log(
        `Creating GOKI tx #${index}) ${transactionKey.toBase58()}`
      );
      if (simulate) {
        const result = await newTransactionTx.simulate();
        console.log(JSON.stringify(result.value));
      } else {
        const result = await newTransactionTx.confirm();
        console.log(`Tx: ${result.signature}`);
      }
      setRatesTx = new TransactionEnvelope(quarry.provider, []);
    }
    tx = tx.combine(setRatesTx);
  } else if (!rateSetterAuthority.equals(quarry.provider.walletKey)) {
    throw new Error(`Rate setter ${rateSetterAuthority.toBase58()} signature is required`);
  }

  if (tx.instructions.length == 0) {
    return;
  }

  if (simulate) {
    const result = await tx.simulate();
    console.log(JSON.stringify(result.value));
  } else {
    const result = await tx.confirm();
    console.log(`Tx: ${result.signature}`);
  }
}
