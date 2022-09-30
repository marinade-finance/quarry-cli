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
import { parseKeypair } from '@marinade.finance/solana-cli-utils';
import shellMatchers from 'jest-shell-matchers';
import {
  createTempFileKeypair,
  KeypairSignerHelper,
  MULTISIG_FACTORIES,
} from '@marinade.finance/solana-test-utils';
import { MintHelper } from '@marinade.finance/solana-test-utils';
import { RewarderHelper } from '@marinade.finance/solana-test-utils';
import { OperatorHelper } from '@marinade.finance/solana-test-utils';
import { KedgereeSDK } from '@marinade.finance/kedgeree-sdk';

jest.setTimeout(300000);

beforeAll(() => {
  // calling this will add the matchers
  // by calling expect.extend
  shellMatchers();
});

describe('create-quarry', () => {
  let provider: Provider;
  let sdk: QuarrySDK;
  let kedgeree: KedgereeSDK;
  let mint: MintHelper;

  beforeAll(async () => {
    provider = SolanaProvider.init({
      connection: new Connection('http://localhost:8899', 'confirmed'),
      wallet: new SignerWallet(await parseKeypair('~/.config/solana/id.json')),
    });
    sdk = QuarrySDK.load({ provider });
    kedgeree = new KedgereeSDK({ provider });
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
    const {
      keypair: admin,
      path: adminPath,
      cleanup,
    } = await createTempFileKeypair();

    const rewarder = await RewarderHelper.create({
      sdk,
      admin: new KeypairSignerHelper(admin),
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
    const {
      keypair: admin,
      path: adminPath,
      cleanup,
    } = await createTempFileKeypair();

    const rewarder = await RewarderHelper.create({
      sdk,
      admin: OperatorHelper.prepare({
        sdk,
        quarryCreator: new KeypairSignerHelper(admin),
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
          kedgeree,
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
          ].concat(multisigFactory.side === 'community' ? ['--community'] : []),
        ]).toHaveMatchingSpawnOutput({
          code: 0,
          stderr: '',
        });

        await expect(
          multisig.executeAllPending().then(t => t.length)
        ).resolves.toBeGreaterThan(0);

        const quarryWrapper = await rewarder.wrapper.getQuarry(
          Token.fromMint(mint.address, 9)
        );
        expect(quarryWrapper.quarryData.tokenMintKey.toBase58()).toBe(
          mint.address.toBase58()
        );
      });

      it(`Uses ${multisigFactory.name} with filesystem proposer`, async () => {
        const {
          keypair: proposer,
          path: proposerPath,
          cleanup,
        } = await createTempFileKeypair();

        const multisig = await multisigFactory.create({
          kedgeree,
          members: [
            new KeypairSignerHelper(proposer),
            new KeypairSignerHelper(new Keypair()),
            new KeypairSignerHelper(new Keypair()),
          ],
          threshold: 2,
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
          ].concat(multisigFactory.side === 'community' ? ['--community'] : []),
        ]).toHaveMatchingSpawnOutput({
          code: 0,
          stderr: '',
        });

        await expect(
          multisig.executeAllPending().then(t => t.length)
        ).resolves.toBeGreaterThan(0);

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
          kedgeree,
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
          ].concat(multisigFactory.side === 'community' ? ['--community'] : []),
        ]).toHaveMatchingSpawnOutput({
          code: 0,
          stderr: '',
        });

        await expect(
          multisig.executeAllPending().then(t => t.length)
        ).resolves.toBeGreaterThan(0);

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
