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
import { parseKeypair } from '@marinade.finance/solana-cli-utils';
import shellMatchers from 'jest-shell-matchers';
import { file } from 'tmp-promise';
import { MultisigHelper, MULTISIG_FACTORIES } from '@marinade.finance/solana-test-utils';
import { MintHelper } from '@marinade.finance/solana-test-utils';
import { RewarderHelper } from '@marinade.finance/solana-test-utils';
import { OperatorHelper } from '@marinade.finance/solana-test-utils';

jest.setTimeout(300000);

beforeAll(() => {
  // calling this will add the matchers
  // by calling expect.extend
  shellMatchers();
});

describe('create-quarry', () => {
  let provider: Provider;
  let sdk: QuarrySDK;
  let mint: MintHelper;

  beforeAll(async () => {
    provider = SolanaProvider.init({
      connection: new Connection('http://localhost:8899', 'confirmed'),
      wallet: new SignerWallet(await parseKeypair('~/.config/solana/id.json')),
    });
    sdk = QuarrySDK.load({ provider });
  });

  beforeEach(async () => {
    // Prepare for quarry creation
    mint = await MintHelper.create({ provider });
  });

  it('Runs with minimal parameters', async () => {
    const rewarder = await RewarderHelper.create({
      sdk,
    });
    await expect([
      'pnpm',
      [
        'cli',
        'create-quarry',
        '--rewarder',
        rewarder.address.toBase58(),
        '--stake',
        mint.address.toBase58(),
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stderr: '',
    });

    const quarryWrapper = await rewarder.wrapper.getQuarry(
      Token.fromMint(mint.address, 9)
    );
    expect(quarryWrapper.quarryData.tokenMintKey.toBase58()).toBe(
      mint.address.toBase58()
    );
  });

  it('Runs with filesystem wallet admin', async () => {
    const admin = new Keypair();
    const { path: adminPath, cleanup } = await file();
    await fs.writeFile(adminPath, JSON.stringify(Array.from(admin.secretKey)));

    const rewarder = await RewarderHelper.create({
      sdk,
      admin,
    });

    await expect([
      'pnpm',
      [
        'cli',
        'create-quarry',
        '--rewarder',
        rewarder.address.toBase58(),
        '--stake',
        mint.address.toBase58(),
        '--admin',
        adminPath,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stderr: '',
    });

    const quarryWrapper = await rewarder.wrapper.getQuarry(
      Token.fromMint(mint.address, 9)
    );
    expect(quarryWrapper.quarryData.tokenMintKey.toBase58()).toBe(
      mint.address.toBase58()
    );
    await cleanup();
  });

  it('Runs with operator', async () => {
    const rewarder = await RewarderHelper.create({
      sdk,
      admin: OperatorHelper.prepare({
        sdk,
      }),
    });

    await expect([
      'pnpm',
      [
        'cli',
        'create-quarry',
        '--rewarder',
        rewarder.address.toBase58(),
        '--stake',
        mint.address.toBase58(),
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stderr: '',
    });

    const quarryWrapper = await rewarder.wrapper.getQuarry(
      Token.fromMint(mint.address, 9)
    );
    expect(quarryWrapper.quarryData.tokenMintKey.toBase58()).toBe(
      mint.address.toBase58()
    );
  });

  it('Runs with filesystem wallet operator', async () => {
    const admin = new Keypair();
    const { path: adminPath, cleanup } = await file();
    await fs.writeFile(adminPath, JSON.stringify(Array.from(admin.secretKey)));

    const rewarder = await RewarderHelper.create({
      sdk,
      admin: OperatorHelper.prepare({
        sdk,
        quarryCreator: admin,
      }),
    });

    await expect([
      'pnpm',
      [
        'cli',
        'create-quarry',
        '--rewarder',
        rewarder.address.toBase58(),
        '--stake',
        mint.address.toBase58(),
        '--admin',
        adminPath,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stderr: '',
    });

    const quarryWrapper = await rewarder.wrapper.getQuarry(
      Token.fromMint(mint.address, 9)
    );
    expect(quarryWrapper.quarryData.tokenMintKey.toBase58()).toBe(
      mint.address.toBase58()
    );
    await cleanup();
  });

  for (const multisigFactory of MULTISIG_FACTORIES) {
    describe(`Multisig ${multisigFactory.name}`, () => {
      it(`Uses ${multisigFactory.name}`, async () => {
        const multisig = await multisigFactory.create({
          provider,
        });
        const rewarder = await RewarderHelper.create({
          sdk,
          admin: multisig,
        });

        await expect([
          'pnpm',
          [
            'cli',
            'create-quarry',
            '--rewarder',
            rewarder.address.toBase58(),
            '--stake',
            mint.address.toBase58(),
          ],
        ]).toHaveMatchingSpawnOutput({
          code: 0,
          stderr: '',
        });

        await multisig.reload();
        expect(multisig.numTransactions.eqn(2)).toBeTruthy();

        await multisig.executeTransaction(
          await multisig.transactionByIndex(new BN(1))
        );

        const quarryWrapper = await rewarder.wrapper.getQuarry(
          Token.fromMint(mint.address, 9)
        );
        expect(quarryWrapper.quarryData.tokenMintKey.toBase58()).toBe(
          mint.address.toBase58()
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
          members: [proposer, new Keypair(), new Keypair()],
          threshold: new BN(2),
          includeWallet: false,
        });
        const rewarder = await RewarderHelper.create({
          sdk,
          admin: multisig,
        });

        await expect([
          'pnpm',
          [
            'cli',
            'create-quarry',
            '--rewarder',
            rewarder.address.toBase58(),
            '--stake',
            mint.address.toBase58(),
            '--proposer',
            proposerPath,
          ],
        ]).toHaveMatchingSpawnOutput({
          code: 0,
          stderr: '',
        });

        await multisig.reload();
        expect(multisig.numTransactions.eqn(2)).toBeTruthy();

        await multisig.executeTransaction(
          await multisig.transactionByIndex(new BN(1))
        );

        const quarryWrapper = await rewarder.wrapper.getQuarry(
          Token.fromMint(mint.address, 9)
        );
        expect(quarryWrapper.quarryData.tokenMintKey.toBase58()).toBe(
          mint.address.toBase58()
        );

        await cleanup();
      });

      it(`Uses ${multisigFactory.name} with operator`, async () => {
        const multisig = await multisigFactory.create({
          provider,
        });

        const rewarder = await RewarderHelper.create({
          sdk,
          admin: OperatorHelper.prepare({
            sdk,
            quarryCreator: multisig,
          }),
        });

        await expect([
          'pnpm',
          [
            'cli',
            'create-quarry',
            '--rewarder',
            rewarder.address.toBase58(),
            '--stake',
            mint.address.toBase58(),
          ],
        ]).toHaveMatchingSpawnOutput({
          code: 0,
          stderr: '',
        });

        await multisig.reload();
        expect(multisig.numTransactions.eqn(1)).toBeTruthy();

        await multisig.executeTransaction(
          await multisig.transactionByIndex(new BN(0))
        );
        const quarryWrapper = await rewarder.wrapper.getQuarry(
          Token.fromMint(mint.address, 9)
        );
        expect(quarryWrapper.quarryData.tokenMintKey.toBase58()).toBe(
          mint.address.toBase58()
        );
      });
    });
  }
});
