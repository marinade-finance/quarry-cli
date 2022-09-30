import { SignerWallet, SolanaProvider } from '@saberhq/solana-contrib';
import { Connection, Keypair } from '@solana/web3.js';
import { parseKeypair } from '@marinade.finance/solana-cli-utils';
import { QuarrySDK } from '@quarryprotocol/quarry-sdk';
import BN from 'bn.js';
import {
  createTempFileKeypair,
  KeypairSignerHelper,
  shellMatchers,
} from '@marinade.finance/solana-test-utils';
import { RewarderHelper } from '@marinade.finance/solana-test-utils';
import { OperatorHelper } from '@marinade.finance/solana-test-utils';
import { MULTISIG_FACTORIES } from '@marinade.finance/solana-test-utils';
import { KedgereeSDK } from '@marinade.finance/kedgeree-sdk';

jest.setTimeout(300000);

beforeAll(() => {
  // calling this will add the matchers
  // by calling expect.extend
  shellMatchers();
});

describe('set-rewards', () => {
  let provider: SolanaProvider;
  let sdk: QuarrySDK;
  let kedgeree: KedgereeSDK;
  // let mintKeypair: Keypair;
  // let rewarderWrapper: RewarderWrapper;
  // let quarries: { mint: MintHelper; quarry: QuarryWrapper }[];
  const initialShares = [43, 10, 345, 29, 287, 76, 22, 17, 81, 90]; // total 1000
  const initialRate = 1000000;

  beforeAll(async () => {
    provider = SolanaProvider.init({
      connection: new Connection('http://localhost:8899', 'confirmed'),
      wallet: new SignerWallet(await parseKeypair('~/.config/solana/id.json')),
    });
    sdk = QuarrySDK.load({ provider });
    kedgeree = new KedgereeSDK({ provider });
  });

  /*
  beforeEach(async () => {
    const { mintWrapper, tx: newWrapperAndMintTx } =
      await sdk.mintWrapper.newWrapperAndMint({
        mintKP: new Keypair(),
        decimals: 9,
        hardcap: new BN('18446744073709551615'),
      });
    await newWrapperAndMintTx.confirm();
    const { tx: createRewarderTx, key: rewarderKey } =
      await sdk.mine.createRewarder({
        mintWrapper,
      });
    mintKeypair = new Keypair();
    let tx = createRewarderTx.combine(
      await createInitMintInstructions({
        provider: sdk.provider,
        mintKP: mintKeypair,
        decimals: 9,
      })
    );
    tx.addSigners(mintKeypair);
    await tx.confirm();
    rewarderWrapper = await sdk.mine.loadRewarderWrapper(rewarderKey);

    // Create test quarries
    tx = new TransactionEnvelope(provider, []);
    const mints: MintHelper[] = [];
    for (let i = 0; i < 10; i++) {
      const mint = await MintHelper.create({ provider });
      const { tx: createQuarryTx } = await rewarderWrapper.createQuarry({
        token: Token.fromMint(mint.address, 9),
      });
      tx = tx.combine(createQuarryTx);
      mints.push(mint);
    }
    await Promise.all(tx.partition().map(tx => tx.confirm()));

    quarries = [];
    for (const mint of mints) {
      quarries.push({
        mint,
        quarry: await rewarderWrapper.getQuarry(
          Token.fromMint(mint.address, 9)
        ),
      });
    }

    // Setup some initial rates
    tx = rewarderWrapper.setAnnualRewards({
      newAnnualRate: new u64(1000000),
    });
    for (let i = 0; i < quarries.length; i++) {
      tx = tx.combine(
        quarries[i].quarry.setRewardsShare(new u64(initialShares[i]))
      );
    }
    await Promise.all(tx.partition().map(tx => tx.confirm()));

    tx = await rewarderWrapper.syncQuarryRewards(
      quarries.map(quarry => quarry.mint.address)
    );
    await Promise.all(tx.partition().map(tx => tx.confirm()));

    rewarderWrapper = await sdk.mine.loadRewarderWrapper(rewarderKey);
    expect(rewarderWrapper.rewarderData.totalRewardsShares.toString()).toBe(
      '1000'
    );
    const quarry0 = await rewarderWrapper.getQuarry(
      Token.fromMint(quarries[0].mint.address, 9)
    );
    expect(quarry0.quarryData.rewardsShare.toString()).toBe('43');
    expect(quarry0.quarryData.annualRewardsRate.toString()).toBe('43000');
  });
  */

  it('It sets total rewards', async () => {
    const rewarder = await RewarderHelper.create({
      sdk,
      rate: initialRate,
      quarryShares: initialShares,
    });
    await expect([
      'pnpm',
      [
        'cli',
        'set-rewards',
        '--rewarder',
        rewarder.address.toBase58(),
        '--total-rewards',
        2000000,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stderr: '',
    });
    await rewarder.reload();
    for (let i = 0; i < initialShares.length; i++) {
      expect(
        rewarder.quarries[i].wrapper.quarryData.annualRewardsRate.toString()
      ).toBe((2000 * initialShares[i]).toString());
    }
  });

  it('It sets quarry shares', async () => {
    const rewarder = await RewarderHelper.create({
      sdk,
      rate: initialRate,
      quarryShares: initialShares,
    });

    const shares = [2376, 2387, 963, 21, 833, 0, 823, 467, 1735, 395]; // 10000 total
    await expect([
      'pnpm',
      [
        'cli',
        'set-rewards',
        '--rewarder',
        rewarder.address.toBase58(),
        ...shares
          .map((s, i) => [
            '--share',
            rewarder.quarries[i].mint.address + ':' + s,
          ])
          .flat(),
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stderr: '',
    });
    await rewarder.reload();
    expect(rewarder.wrapper.rewarderData.totalRewardsShares.toString()).toBe(
      '10000'
    );
    for (let i = 0; i < rewarder.quarries.length; i++) {
      expect(
        rewarder.quarries[i].wrapper.quarryData.annualRewardsRate.toString()
      ).toBe((shares[i] * 100).toString());
    }
  });

  it('It sets quarry shares and total rate', async () => {
    const rewarder = await RewarderHelper.create({
      sdk,
      rate: initialRate,
      quarryShares: initialShares,
    });

    const shares = [3256, 5797]; // + intial_shares = 10000 total
    await expect([
      'pnpm',
      [
        'cli',
        'set-rewards',
        '--rewarder',
        rewarder.address.toBase58(),
        ...shares
          .map((s, i) => [
            '--share',
            rewarder.quarries[i].mint.address + ':' + s,
          ])
          .flat(),
        '--total-rewards',
        2000000,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stderr: '',
    });
    await rewarder.reload();
    expect(rewarder.wrapper.rewarderData.totalRewardsShares.toString()).toBe(
      '10000'
    );
    for (let i = 0; i < rewarder.quarries.length; i++) {
      expect(
        rewarder.quarries[i].wrapper.quarryData.annualRewardsRate.toString()
      ).toBe(((shares[i] || initialShares[i]) * 200).toString());
    }
  });

  it('It sets quarry shares and total rate with filesystem wallet admin', async () => {
    const {
      keypair: admin,
      path: adminPath,
      cleanup,
    } = await createTempFileKeypair();

    const rewarder = await RewarderHelper.create({
      sdk,
      admin: new KeypairSignerHelper(admin),
      rate: initialRate,
      quarryShares: initialShares,
    });
    const shares = [3256, 5797]; // + intial_shares = 10000 total
    await expect([
      'pnpm',
      [
        'cli',
        'set-rewards',
        '--rewarder',
        rewarder.address.toBase58(),
        ...shares
          .map((s, i) => [
            '--share',
            rewarder.quarries[i].mint.address + ':' + s,
          ])
          .flat(),
        '--total-rewards',
        2000000,
        '--share-allocator',
        adminPath,
        '--rate-setter',
        adminPath,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stderr: '',
    });
    await rewarder.reload();
    expect(rewarder.wrapper.rewarderData.totalRewardsShares.toString()).toBe(
      '10000'
    );
    for (let i = 0; i < rewarder.quarries.length; i++) {
      expect(
        rewarder.quarries[i].wrapper.quarryData.annualRewardsRate.toString()
      ).toBe(((shares[i] || initialShares[i]) * 200).toString());
    }

    await cleanup();
  });

  it('It sets quarry shares and total rate with operator', async () => {
    const rewarder = await RewarderHelper.create({
      sdk,
      admin: OperatorHelper.prepare({
        sdk,
      }),
      rate: initialRate,
      quarryShares: initialShares,
    });
    const shares = [3256, 5797]; // + intial_shares = 10000 total
    await expect([
      'pnpm',
      [
        'cli',
        'set-rewards',
        '--rewarder',
        rewarder.address.toBase58(),
        ...shares
          .map((s, i) => [
            '--share',
            rewarder.quarries[i].mint.address + ':' + s,
          ])
          .flat(),
        '--total-rewards',
        2000000,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stderr: '',
    });
    await rewarder.reload();
    expect(rewarder.wrapper.rewarderData.totalRewardsShares.toString()).toBe(
      '10000'
    );
    for (let i = 0; i < rewarder.quarries.length; i++) {
      expect(
        rewarder.quarries[i].wrapper.quarryData.annualRewardsRate.toString()
      ).toBe(((shares[i] || initialShares[i]) * 200).toString());
    }
  });

  it('It sets quarry shares and total rate with filesystem wallet operator', async () => {
    const {
      keypair: rateSetter,
      path: rateSetterPath,
      cleanup: rateSetterCleanup,
    } = await createTempFileKeypair();
    const {
      keypair: shareAllocator,
      path: shareAllocatorPath,
      cleanup: shareAllocatorCleanup,
    } = await createTempFileKeypair();

    const rewarder = await RewarderHelper.create({
      sdk,
      admin: OperatorHelper.prepare({
        sdk,
        rateSetter: new KeypairSignerHelper(rateSetter),
        shareAllocator: new KeypairSignerHelper(shareAllocator),
      }),
      rate: initialRate,
      quarryShares: initialShares,
    });
    const shares = [3256, 5797]; // + intial_shares = 10000 total
    await expect([
      'pnpm',
      [
        'cli',
        'set-rewards',
        '--rewarder',
        rewarder.address.toBase58(),
        ...shares
          .map((s, i) => [
            '--share',
            rewarder.quarries[i].mint.address + ':' + s,
          ])
          .flat(),
        '--total-rewards',
        2000000,
        '--share-allocator',
        shareAllocatorPath,
        '--rate-setter',
        rateSetterPath,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stderr: '',
    });
    await rewarder.reload();
    expect(rewarder.wrapper.rewarderData.totalRewardsShares.toString()).toBe(
      '10000'
    );
    for (let i = 0; i < rewarder.quarries.length; i++) {
      expect(
        rewarder.quarries[i].wrapper.quarryData.annualRewardsRate.toString()
      ).toBe(((shares[i] || initialShares[i]) * 200).toString());
    }

    await rateSetterCleanup();
    await shareAllocatorCleanup();
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
          rate: initialRate,
          quarryShares: initialShares,
        });

        const shares = [3256, 5797]; // + intial_shares = 10000 total
        await expect([
          'pnpm',
          [
            'cli',
            'set-rewards',
            '--rewarder',
            rewarder.address.toBase58(),
            ...shares
              .map((s, i) => [
                '--share',
                rewarder.quarries[i].mint.address + ':' + s,
              ])
              .flat(),
            '--total-rewards',
            2000000,
          ].concat(multisigFactory.side === 'community' ? ['--community'] : []),
        ]).toHaveMatchingSpawnOutput({
          code: 0,
          stderr: '',
        });

        await expect(
          multisig.executeAllPending().then(t => t.length)
        ).resolves.toBeGreaterThan(0);

        await rewarder.syncQuarries();

        await rewarder.reload();
        expect(
          rewarder.wrapper.rewarderData.totalRewardsShares.toString()
        ).toBe('10000');
        for (let i = 0; i < rewarder.quarries.length; i++) {
          expect(
            rewarder.quarries[i].wrapper.quarryData.annualRewardsRate.toString()
          ).toBe(((shares[i] || initialShares[i]) * 200).toString());
        }
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
          rate: initialRate,
          quarryShares: initialShares,
        });

        const shares = [3256, 5797]; // + intial_shares = 10000 total
        await expect([
          'pnpm',
          [
            'cli',
            'set-rewards',
            '--rewarder',
            rewarder.address.toBase58(),
            ...shares
              .map((s, i) => [
                '--share',
                rewarder.quarries[i].mint.address + ':' + s,
              ])
              .flat(),
            '--total-rewards',
            2000000,
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

        await rewarder.syncQuarries();
        await rewarder.reload();
        expect(
          rewarder.wrapper.rewarderData.totalRewardsShares.toString()
        ).toBe('10000');
        for (let i = 0; i < rewarder.quarries.length; i++) {
          expect(
            rewarder.quarries[i].wrapper.quarryData.annualRewardsRate.toString()
          ).toBe(((shares[i] || initialShares[i]) * 200).toString());
        }

        cleanup();
      });
    });

    it(`Uses ${multisigFactory.name} with operator`, async () => {
      const multisig = await multisigFactory.create({
        kedgeree,
      });
      const rewarder = await RewarderHelper.create({
        sdk,
        admin: OperatorHelper.prepare({
          sdk,
          rateSetter: multisig,
          shareAllocator: multisig,
        }),
        rate: initialRate,
        quarryShares: initialShares,
      });

      const shares = [3256, 5797]; // + intial_shares = 10000 total
      await expect([
        'pnpm',
        [
          'cli',
          'set-rewards',
          '--rewarder',
          rewarder.address.toBase58(),
          ...shares
            .map((s, i) => [
              '--share',
              rewarder.quarries[i].mint.address + ':' + s,
            ])
            .flat(),
          '--total-rewards',
          2000000,
        ].concat(multisigFactory.side === 'community' ? ['--community'] : []),
      ]).toHaveMatchingSpawnOutput({
        code: 0,
        stderr: '',
      });

      await expect(
        multisig.executeAllPending().then(t => t.length)
      ).resolves.toBeGreaterThan(0);

      await rewarder.syncQuarries();

      await rewarder.reload();
      expect(rewarder.wrapper.rewarderData.totalRewardsShares.toString()).toBe(
        '10000'
      );
      for (let i = 0; i < rewarder.quarries.length; i++) {
        expect(
          rewarder.quarries[i].wrapper.quarryData.annualRewardsRate.toString()
        ).toBe(((shares[i] || initialShares[i]) * 200).toString());
      }
    });

    it(`Uses 2 instances of ${multisigFactory.name} with operator`, async () => {
      const rateSetterMultisig = await multisigFactory.create({
        kedgeree,
      });
      const shareAllocatorMultisig = await multisigFactory.create({
        kedgeree,
      });
      const rewarder = await RewarderHelper.create({
        sdk,
        admin: OperatorHelper.prepare({
          sdk,
          rateSetter: rateSetterMultisig,
          shareAllocator: shareAllocatorMultisig,
        }),
        rate: initialRate,
        quarryShares: initialShares,
      });

      const shares = [3256, 5797]; // + intial_shares = 10000 total
      await expect([
        'pnpm',
        [
          'cli',
          'set-rewards',
          '--rewarder',
          rewarder.address.toBase58(),
          ...shares
            .map((s, i) => [
              '--share',
              rewarder.quarries[i].mint.address + ':' + s,
            ])
            .flat(),
          '--total-rewards',
          2000000,
        ].concat(multisigFactory.side === 'community' ? ['--community'] : []),
      ]).toHaveMatchingSpawnOutput({
        code: 0,
        stderr: '',
      });

      await expect(
        rateSetterMultisig.executeAllPending().then(t => t.length)
      ).resolves.toBeGreaterThan(0);

      await expect(
        shareAllocatorMultisig.executeAllPending().then(t => t.length)
      ).resolves.toBeGreaterThan(0);

      await rewarder.syncQuarries();

      await rewarder.reload();
      expect(rewarder.wrapper.rewarderData.totalRewardsShares.toString()).toBe(
        '10000'
      );
      for (let i = 0; i < rewarder.quarries.length; i++) {
        expect(
          rewarder.quarries[i].wrapper.quarryData.annualRewardsRate.toString()
        ).toBe(((shares[i] || initialShares[i]) * 200).toString());
      }
    });
  }
});
