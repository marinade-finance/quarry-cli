import {
  SignerWallet,
  SolanaProvider,
  TransactionEnvelope,
} from '@saberhq/solana-contrib';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { parseKeypair } from '@marinade.finance/solana-cli-utils';
import {
  QuarrySDK,
  QuarryWrapper,
  RewarderWrapper,
} from '@quarryprotocol/quarry-sdk';
import BN from 'bn.js';
import { createInitMintInstructions, Token, u64 } from '@saberhq/token-utils';
import { MintHelper, shellMatchers } from '@marinade.finance/solana-test-utils';
import { RewarderHelper } from '../testHelpers/rewarder';

jest.setTimeout(300000);

beforeAll(() => {
  // calling this will add the matchers
  // by calling expect.extend
  shellMatchers();
});

describe('set-rewards', () => {
  let provider: SolanaProvider;
  let sdk: QuarrySDK;
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
});
