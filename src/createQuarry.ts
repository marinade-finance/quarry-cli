import { GokiSDK } from '@gokiprotocol/client';
import {
  findQuarryAddress,
  findRegistryAddress,
  Operator,
  QuarrySDK,
} from '@quarryprotocol/quarry-sdk';
import { TransactionEnvelope } from '@saberhq/solana-contrib';
import { Token } from '@saberhq/token-utils';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { Command } from 'commander';
import { useContext } from './context';
import {
  parseKeypair,
  parsePubkey,
  middleware as m,
} from '@marinade.finance/solana-cli-utils';

export function installCreateQuarry(program: Command) {
  program
    .command('create-quarry')
    .option(
      '--rewarder <address>',
      'Rewarder',
      parsePubkey,
      Promise.resolve(
        new PublicKey('J829VB5Fi7DMoMLK7bsVGFM82cRU61BKtiPz9PNFdL7b')
      )
    )
    .option('--stake <pubkey>', 'Stake token', parsePubkey)
    .option('--admin <keypair>', 'Authority', parseKeypair)
    .option('--rent-payer <keypair>', 'Rent payer', parseKeypair)
    .option('--proposer <keypair>', 'Proposer', parseKeypair)
    .option('--log-only', 'Do not create multisig transaction')
    .action(
      async ({
        rewarder,
        stake,
        admin,
        rentPayer,
        proposer,
        logOnly,
      }: {
        rewarder: Promise<PublicKey>;
        stake: Promise<PublicKey>;
        admin?: Promise<Keypair>;
        rentPayer?: Promise<Keypair>;
        proposer?: Promise<Keypair>;
        logOnly?: boolean;
      }) => {
        const context = useContext();
        await createQuarry({
          quarry: context.quarry,
          goki: context.goki,
          rewarder: await rewarder,
          stake: await stake,
          admin: await admin,
          rentPayer: await rentPayer,
          proposer: await proposer,
          logOnly,
          simulate: context.simulate,
        });
      }
    );
}

export async function createQuarry({
  quarry,
  goki,
  rewarder,
  stake,
  admin,
  rentPayer,
  proposer,
  logOnly,
  simulate,
}: {
  quarry: QuarrySDK;
  goki: GokiSDK;
  rewarder: PublicKey;
  stake: PublicKey;
  admin?: Keypair;
  rentPayer?: Keypair;
  proposer?: Keypair;
  logOnly?: boolean;
  simulate?: boolean;
}) {
  const rewarderWrapper = await quarry.mine.loadRewarderWrapper(rewarder);
  let operator: Operator | null = null;

  try {
    operator = await quarry.loadOperator(
      rewarderWrapper.rewarderData.authority
    );
  } catch (e) {
    /**/
  }

  let quarryCreator: PublicKey;
  if (operator) {
    quarryCreator = operator.data.quarryCreator;
  } else {
    quarryCreator = rewarderWrapper.rewarderData.authority;
  }

  if (admin && !admin.publicKey.equals(quarryCreator)) {
    throw new Error(
      `Wrong admin ${admin.publicKey.toBase58()} expected ${quarryCreator.toBase58()}`
    );
  }

  const middleware: m.Middleware[] = [];
  await m.installMultisigMiddleware({
    middleware,
    goki,
    address: quarryCreator,
    proposer,
    rentPayer,
    logOnly,
  });

  let tx = new TransactionEnvelope(quarry.provider, []);
  if (operator) {
    const [quarryAddress] = await findQuarryAddress(rewarder, stake);
    tx.append(
      await quarry.programs.Operator.methods
        .delegateCreateQuarryV2()
        .accounts({
          withDelegate: {
            operator: operator.key,
            delegate: quarryCreator,
            rewarder,
            quarryMineProgram: quarry.programs.Mine.programId,
          },
          quarry: quarryAddress,
          tokenMint: stake,
          payer: rentPayer?.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction()
    );
  } else {
    const { tx: createQuarryTx, quarry: quarryAddress } =
      await rewarderWrapper.createQuarry({
        token: Token.fromMint(stake, 9),
        authority: quarryCreator,
      });
    tx = createQuarryTx;
  }

  const [registry] = await findRegistryAddress(rewarder);

  tx = tx.combine(
    await quarry.registry.syncQuarry({
      tokenMint: stake,
      rewarderKey: rewarder,
    })
  );

  if (rentPayer) {
    tx.addSigners(rentPayer);
  }
  if (admin) {
    tx.addSigners(admin);
  }

  for (const m of middleware) {
    tx = await m.apply(tx);
  }

  if (!(await quarry.provider.getAccountInfo(registry))) {
    console.log('Creating rewarder registry');
    const { tx: createRegistryTx } = await quarry.registry.newRegistry({
      numQuarries: 256,
      rewarderKey: rewarder,
      payer: rentPayer?.publicKey,
    });
    tx = createRegistryTx.combine(tx); // Prepend
  }

  if (simulate) {
    const result = await tx.simulate();
    console.log(JSON.stringify(result.value));
  } else {
    const result = await tx.confirm();
    console.log(`Tx: ${result.signature}`);
  }
}
