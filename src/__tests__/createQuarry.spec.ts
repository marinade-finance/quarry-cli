import { findTransactionAddress, GokiSDK } from '@gokiprotocol/client';
import { QuarrySDK, RewarderWrapper } from '@quarryprotocol/quarry-sdk';
import {
  SignerWallet,
  SolanaProvider,
  TransactionEnvelope,
  Provider,
} from '@saberhq/solana-contrib';
import { createInitMintInstructions, Token } from '@saberhq/token-utils';
import { Connection, Keypair } from '@solana/web3.js';
import BN from 'bn.js';
import { fs } from 'mz';
import { parseKeypair } from '../keyParser';
import shellMatchers from 'jest-shell-matchers';
import { file } from 'tmp-promise';
import { MultisigHelper, MULTISIG_FACTORIES } from '../testHelpers/multisig';

jest.setTimeout(300000);

beforeAll(() => {
  // calling this will add the matchers
  // by calling expect.extend
  shellMatchers();
});

describe('create-quarry', () => {
  let provider: Provider;
  let quarry: QuarrySDK;
  let mintKeypair: Keypair;
  let rewarderWrapper: RewarderWrapper;

  beforeAll(async () => {
    provider = SolanaProvider.init({
      connection: new Connection('http://localhost:8899', 'confirmed'),
      wallet: new SignerWallet(await parseKeypair('~/.config/solana/id.json')),
    });
    quarry = QuarrySDK.load({ provider });
  });

  beforeEach(async () => {
    expect(
      quarry.provider.connection.getBalance(quarry.provider.walletKey)
    ).resolves.toBeGreaterThan(0);
    const { mintWrapper, tx: newWrapperAndMintTx } =
      await quarry.mintWrapper.newWrapperAndMint({
        mintKP: new Keypair(),
        decimals: 9,
        hardcap: new BN('18446744073709551615'),
      });
    await newWrapperAndMintTx.confirm();
    const { tx: createRewarderTx, key: rewarderKey } =
      await quarry.mine.createRewarder({
        mintWrapper,
      });
    mintKeypair = new Keypair();
    const tx = createRewarderTx.combine(
      await createInitMintInstructions({
        provider: quarry.provider,
        mintKP: mintKeypair,
        decimals: 9,
      })
    );
    tx.addSigners(mintKeypair);
    await tx.confirm();
    rewarderWrapper = await quarry.mine.loadRewarderWrapper(rewarderKey);
  });

  it('Runs with minimal parameters', async () => {
    await expect([
      'pnpm',
      [
        'cli',
        'create-quarry',
        '--rewarder',
        rewarderWrapper.rewarderKey.toBase58(),
        '--stake',
        mintKeypair.publicKey.toBase58(),
      ],
    ]).toHaveMatchingSpawnOutput(0);

    const quarryWrapper = await rewarderWrapper.getQuarry(
      Token.fromMint(mintKeypair.publicKey, 9)
    );
    expect(quarryWrapper.quarryData.tokenMintKey.toBase58()).toBe(
      mintKeypair.publicKey.toBase58()
    );
  });

  it('Runs with filesystem wallet admin', async () => {
    const admin = new Keypair();
    const { path: adminPath, cleanup } = await file();
    await fs.writeFile(adminPath, JSON.stringify(Array.from(admin.secretKey)));

    const tx = rewarderWrapper.transferAuthority({
      nextAuthority: admin.publicKey,
    });
    tx.append(
      await quarry.programs.Mine.methods
        .acceptAuthority()
        .accounts({
          authority: admin.publicKey,
          rewarder: rewarderWrapper.rewarderKey,
        })
        .instruction()
    );
    tx.addSigners(admin);
    await tx.confirm();

    await expect([
      'pnpm',
      [
        'cli',
        'create-quarry',
        '--rewarder',
        rewarderWrapper.rewarderKey.toBase58(),
        '--stake',
        mintKeypair.publicKey.toBase58(),
        '--admin',
        adminPath,
      ],
    ]).toHaveMatchingSpawnOutput(0);

    const quarryWrapper = await rewarderWrapper.getQuarry(
      Token.fromMint(mintKeypair.publicKey, 9)
    );
    expect(quarryWrapper.quarryData.tokenMintKey.toBase58()).toBe(
      mintKeypair.publicKey.toBase58()
    );
    await cleanup();
  });

  it('Runs with operator', async () => {
    const { key: operatorAddress, tx: createOperatorTx } =
      await quarry.createOperator({
        rewarder: rewarderWrapper.rewarderKey,
      });
    const transferTx = rewarderWrapper.transferAuthority({
      nextAuthority: operatorAddress,
    });
    const tx = transferTx.combine(createOperatorTx);
    await tx.confirm();

    await expect([
      'pnpm',
      [
        'cli',
        'create-quarry',
        '--rewarder',
        rewarderWrapper.rewarderKey.toBase58(),
        '--stake',
        mintKeypair.publicKey.toBase58(),
      ],
    ]).toHaveMatchingSpawnOutput(0);

    const quarryWrapper = await rewarderWrapper.getQuarry(
      Token.fromMint(mintKeypair.publicKey, 9)
    );
    expect(quarryWrapper.quarryData.tokenMintKey.toBase58()).toBe(
      mintKeypair.publicKey.toBase58()
    );
  });

  it('Runs with filesystem wallet operator', async () => {
    const admin = new Keypair();
    const { path: adminPath, cleanup } = await file();
    await fs.writeFile(adminPath, JSON.stringify(Array.from(admin.secretKey)));

    const { key: operatorAddress, tx: createOperatorTx } =
      await quarry.createOperator({
        rewarder: rewarderWrapper.rewarderKey,
      });
    const transferTx = rewarderWrapper.transferAuthority({
      nextAuthority: operatorAddress,
    });
    const tx = transferTx.combine(createOperatorTx);
    tx.append(
      await quarry.programs.Operator.methods
        .setQuarryCreator()
        .accounts({
          operator: operatorAddress,
          admin: quarry.provider.walletKey,
          delegate: admin.publicKey,
        })
        .instruction()
    );
    await tx.confirm();

    await expect([
      'pnpm',
      [
        'cli',
        'create-quarry',
        '--rewarder',
        rewarderWrapper.rewarderKey.toBase58(),
        '--stake',
        mintKeypair.publicKey.toBase58(),
        '--admin',
        adminPath,
      ],
    ]).toHaveMatchingSpawnOutput(0);

    const quarryWrapper = await rewarderWrapper.getQuarry(
      Token.fromMint(mintKeypair.publicKey, 9)
    );
    expect(quarryWrapper.quarryData.tokenMintKey.toBase58()).toBe(
      mintKeypair.publicKey.toBase58()
    );
    await cleanup();
  });

  const transferAuthority: (
    multisig: MultisigHelper
  ) => Promise<void> = async multisig => {
    let tx = rewarderWrapper.transferAuthority({
      nextAuthority: multisig.authority,
    });
    await tx.confirm();

    const txAddress = await multisig.createTransaction(
      new TransactionEnvelope(provider, [
        await quarry.programs.Mine.methods
          .acceptAuthority()
          .accounts({
            authority: multisig.authority,
            rewarder: rewarderWrapper.rewarderKey,
          })
          .instruction(),
      ])
    );
    await multisig.executeTransaction(txAddress);
  };

  for (const multisigFactory of MULTISIG_FACTORIES) {
    describe(`Multisig ${multisigFactory.name}`, () => {
      it(`Uses ${multisigFactory.name}`, async () => {
        const multisig = await multisigFactory.create({
          provider,
        });
        await transferAuthority(multisig);

        await expect([
          'pnpm',
          [
            'cli',
            'create-quarry',
            '--rewarder',
            rewarderWrapper.rewarderKey.toBase58(),
            '--stake',
            mintKeypair.publicKey.toBase58(),
          ],
        ]).toHaveMatchingSpawnOutput(0);

        await multisig.reload();
        expect(multisig.numTransactions.eqn(2)).toBeTruthy();

        await multisig.executeTransaction(
          await multisig.transactionByIndex(new BN(1))
        );

        const quarryWrapper = await rewarderWrapper.getQuarry(
          Token.fromMint(mintKeypair.publicKey, 9)
        );
        expect(quarryWrapper.quarryData.tokenMintKey.toBase58()).toBe(
          mintKeypair.publicKey.toBase58()
        );
      });

      it(`Uses ${multisigFactory.name} with filesystem proposer`, async () => {
        const proposer = new Keypair();
        const { path: proposerPath, cleanup } = await file();
        await fs.writeFile(
          proposerPath,
          JSON.stringify(Array.from(proposer.secretKey))
        );

        const multisig = await multisigFactory.create({
          provider,
          members: [proposer],
          includeWallet: false,
        });
        await transferAuthority(multisig);

        await expect([
          'pnpm',
          [
            'cli',
            'create-quarry',
            '--rewarder',
            rewarderWrapper.rewarderKey.toBase58(),
            '--stake',
            mintKeypair.publicKey.toBase58(),
            '--proposer',
            proposerPath,
          ],
        ]).toHaveMatchingSpawnOutput(0);

        await multisig.reload();
        expect(multisig.numTransactions.eqn(2)).toBeTruthy();

        await multisig.executeTransaction(
          await multisig.transactionByIndex(new BN(1))
        );

        const quarryWrapper = await rewarderWrapper.getQuarry(
          Token.fromMint(mintKeypair.publicKey, 9)
        );
        expect(quarryWrapper.quarryData.tokenMintKey.toBase58()).toBe(
          mintKeypair.publicKey.toBase58()
        );
      });

      it(`Uses ${multisigFactory.name} with operator`, async () => {
        const multisig = await multisigFactory.create({
          provider,
        });

        const { key: operatorAddress, tx: createOperatorTx } =
          await quarry.createOperator({
            rewarder: rewarderWrapper.rewarderKey,
          });
        const transferTx = rewarderWrapper.transferAuthority({
          nextAuthority: operatorAddress,
        });
        let tx = transferTx.combine(createOperatorTx);
        tx.append(
          await quarry.programs.Operator.methods
            .setQuarryCreator()
            .accounts({
              operator: operatorAddress,
              admin: quarry.provider.walletKey,
              delegate: multisig.authority,
            })
            .instruction()
        );
        await tx.confirm();

        await expect([
          'pnpm',
          [
            'cli',
            'create-quarry',
            '--rewarder',
            rewarderWrapper.rewarderKey.toBase58(),
            '--stake',
            mintKeypair.publicKey.toBase58(),
          ],
        ]).toHaveMatchingSpawnOutput(0);

        await multisig.reload();
        expect(multisig.numTransactions.eqn(1)).toBeTruthy();

        await multisig.executeTransaction(
          await multisig.transactionByIndex(new BN(0))
        );
        const quarryWrapper = await rewarderWrapper.getQuarry(
          Token.fromMint(mintKeypair.publicKey, 9)
        );
        expect(quarryWrapper.quarryData.tokenMintKey.toBase58()).toBe(
          mintKeypair.publicKey.toBase58()
        );
      });
    });
  }
});
