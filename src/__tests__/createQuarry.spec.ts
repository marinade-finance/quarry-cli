import { findTransactionAddress, GokiSDK } from '@gokiprotocol/client';
import {
  QuarrySDK,
  QuarryWrapper,
  RewarderWrapper,
} from '@quarryprotocol/quarry-sdk';
import { SignerWallet, SolanaProvider } from '@saberhq/solana-contrib';
import { createInitMintInstructions, Token } from '@saberhq/token-utils';
import { Connection, Keypair } from '@solana/web3.js';
import BN from 'bn.js';
import { fs } from 'mz';
import { parseKeypair } from '../keyParser';
import { waitForSuccess } from '../testHelpers/waitForSuccess';
import shellMatchers = require('jest-shell-matchers');
import { file } from 'tmp-promise';

jest.setTimeout(300000);

beforeAll(() => {
  // calling this will add the matchers
  // by calling expect.extend
  shellMatchers();
});

describe('create-quarry', () => {
  let quarry: QuarrySDK;
  let goki: GokiSDK;
  let mintKeypair: Keypair;
  let rewarderWrapper: RewarderWrapper;

  beforeAll(async () => {
    const provider = SolanaProvider.init({
      connection: new Connection('http://localhost:8899'),
      wallet: new SignerWallet(await parseKeypair('~/.config/solana/id.json')),
    });
    quarry = QuarrySDK.load({ provider });
    goki = GokiSDK.load({ provider });
  });

  beforeEach(async () => {
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
    await waitForSuccess({
      f: async () => {
        rewarderWrapper = await quarry.mine.loadRewarderWrapper(rewarderKey);
      },
    });
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

    await expect(
      waitForSuccess({
        f: async () => {
          const quarryWrapper = await rewarderWrapper.getQuarry(
            Token.fromMint(mintKeypair.publicKey, 9)
          );
          return quarryWrapper.quarryData.tokenMintKey.toBase58();
        },
        wait: 40000,
      })
    ).resolves.toBe(mintKeypair.publicKey.toBase58());
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
    await waitForSuccess({
      f: async () => {
        rewarderWrapper = await quarry.mine.loadRewarderWrapper(
          rewarderWrapper.rewarderKey
        );
        if (!rewarderWrapper.rewarderData.authority.equals(admin.publicKey)) {
          throw Error('Not updated yet');
        }
      },
    });

    expect([
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

    await expect(
      waitForSuccess({
        f: async () => {
          const quarryWrapper = await rewarderWrapper.getQuarry(
            Token.fromMint(mintKeypair.publicKey, 9)
          );
          return quarryWrapper.quarryData.tokenMintKey.toBase58();
        },
      })
    ).resolves.toBe(mintKeypair.publicKey.toBase58());
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
    await waitForSuccess({
      f: async () => {
        if (!(await quarry.loadOperator(operatorAddress))) {
          throw Error('Not created yet');
        }
      },
    });

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

    await expect(
      waitForSuccess({
        f: async () => {
          const quarryWrapper = await rewarderWrapper.getQuarry(
            Token.fromMint(mintKeypair.publicKey, 9)
          );
          return quarryWrapper.quarryData.tokenMintKey.toBase58();
        },
      })
    ).resolves.toBe(mintKeypair.publicKey.toBase58());
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
    await waitForSuccess({
      f: async () => {
        if (!(await quarry.loadOperator(operatorAddress))) {
          throw Error('Not created yet');
        }
      },
    });

    expect([
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

    await expect(
      waitForSuccess({
        f: async () => {
          const quarryWrapper = await rewarderWrapper.getQuarry(
            Token.fromMint(mintKeypair.publicKey, 9)
          );
          return quarryWrapper.quarryData.tokenMintKey.toBase58();
        },
      })
    ).resolves.toBe(mintKeypair.publicKey.toBase58());
    await cleanup();
  });

  it('Uses GOKI', async () => {
    const { smartWalletWrapper, tx: newSmartWalletTx } =
      await goki.newSmartWallet({
        owners: [goki.provider.walletKey],
        threshold: new BN(1),
        numOwners: 1,
      });

    let tx = rewarderWrapper
      .transferAuthority({
        nextAuthority: smartWalletWrapper.key,
      })
      .combine(newSmartWalletTx);
    await tx.confirm();
    await waitForSuccess({
      f: () => goki.loadSmartWallet(smartWalletWrapper.key),
    });

    const { transactionKey: acceptAuthorityTxAddress, tx: acceptAuthorityTx } =
      await smartWalletWrapper.newTransaction({
        instructions: [
          await quarry.programs.Mine.methods
            .acceptAuthority()
            .accounts({
              authority: smartWalletWrapper.key,
              rewarder: rewarderWrapper.rewarderKey,
            })
            .instruction(),
        ],
      });
    await acceptAuthorityTx.confirm();
    await waitForSuccess({
      f: async () => {
        if (!(await smartWalletWrapper.reloadData()).numTransactions.eqn(1)) {
          throw new Error('Not created yet');
        }
      },
    });

    tx = await smartWalletWrapper.executeTransaction({
      transactionKey: acceptAuthorityTxAddress,
    });
    await tx.confirm();

    await waitForSuccess({
      f: async () => {
        rewarderWrapper = await quarry.mine.loadRewarderWrapper(
          rewarderWrapper.rewarderKey
        );
        if (
          !rewarderWrapper.rewarderData.authority.equals(smartWalletWrapper.key)
        ) {
          throw Error('Not updated yet');
        }
      },
    });

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

    await expect(
      waitForSuccess({
        f: async () => {
          const smartWalletData = await smartWalletWrapper.reloadData();
          if (!smartWalletData.numTransactions.eqn(2)) {
            throw new Error('Not created yet');
          }
          return true;
        },
      })
    ).resolves.toBeTruthy();

    tx = await smartWalletWrapper.executeTransaction({
      transactionKey: (
        await findTransactionAddress(smartWalletWrapper.key, 1)
      )[0],
    });
    await tx.confirm();
    await expect(
      waitForSuccess({
        f: async () => {
          const quarryWrapper = await rewarderWrapper.getQuarry(
            Token.fromMint(mintKeypair.publicKey, 9)
          );
          return quarryWrapper.quarryData.tokenMintKey.toBase58();
        },
      })
    ).resolves.toBe(mintKeypair.publicKey.toBase58());
  });

  it('Uses GOKI with filesystem proposer', async () => {
    const proposer = new Keypair();
    const { path: proposerPath, cleanup } = await file();
    await fs.writeFile(
      proposerPath,
      JSON.stringify(Array.from(proposer.secretKey))
    );

    const { smartWalletWrapper, tx: newSmartWalletTx } =
      await goki.newSmartWallet({
        owners: [proposer.publicKey],
        threshold: new BN(1),
        numOwners: 1,
      });

    let tx = rewarderWrapper
      .transferAuthority({
        nextAuthority: smartWalletWrapper.key,
      })
      .combine(newSmartWalletTx);
    await tx.confirm();
    await waitForSuccess({
      f: () => goki.loadSmartWallet(smartWalletWrapper.key),
    });

    const { transactionKey: acceptAuthorityTxAddress, tx: acceptAuthorityTx } =
      await smartWalletWrapper.newTransaction({
        proposer: proposer.publicKey,
        instructions: [
          await quarry.programs.Mine.methods
            .acceptAuthority()
            .accounts({
              authority: smartWalletWrapper.key,
              rewarder: rewarderWrapper.rewarderKey,
            })
            .instruction(),
        ],
      });
    acceptAuthorityTx.addSigners(proposer);
    await acceptAuthorityTx.confirm();
    await waitForSuccess({
      f: async () => {
        if (!(await smartWalletWrapper.reloadData()).numTransactions.eqn(1)) {
          throw new Error('Not created yet');
        }
      },
    });

    tx = await smartWalletWrapper.executeTransaction({
      transactionKey: acceptAuthorityTxAddress,
      owner: proposer.publicKey,
    });
    tx.addSigners(proposer);
    await tx.confirm();

    await waitForSuccess({
      f: async () => {
        rewarderWrapper = await quarry.mine.loadRewarderWrapper(
          rewarderWrapper.rewarderKey
        );
        if (
          !rewarderWrapper.rewarderData.authority.equals(smartWalletWrapper.key)
        ) {
          throw Error('Not updated yet');
        }
      },
    });

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

    await expect(
      waitForSuccess({
        f: async () => {
          const smartWalletData = await smartWalletWrapper.reloadData();
          if (!smartWalletData.numTransactions.eqn(2)) {
            throw new Error('Not created yet');
          }
          return true;
        },
      })
    ).resolves.toBeTruthy();

    tx = await smartWalletWrapper.executeTransaction({
      transactionKey: (
        await findTransactionAddress(smartWalletWrapper.key, 1)
      )[0],
      owner: proposer.publicKey,
    });
    tx.addSigners(proposer);
    await tx.confirm();
    await expect(
      waitForSuccess({
        f: async () => {
          const quarryWrapper = await rewarderWrapper.getQuarry(
            Token.fromMint(mintKeypair.publicKey, 9)
          );
          return quarryWrapper.quarryData.tokenMintKey.toBase58();
        },
      })
    ).resolves.toBe(mintKeypair.publicKey.toBase58());
  });

  it('Uses GOKI with operator', async () => {
    const { smartWalletWrapper, tx: newSmartWalletTx } =
      await goki.newSmartWallet({
        owners: [goki.provider.walletKey],
        threshold: new BN(1),
        numOwners: 1,
      });

    const { key: operatorAddress, tx: createOperatorTx } =
      await quarry.createOperator({
        rewarder: rewarderWrapper.rewarderKey,
      });
    const transferTx = rewarderWrapper.transferAuthority({
      nextAuthority: operatorAddress,
    });
    let tx = transferTx.combine(createOperatorTx).combine(newSmartWalletTx);
    tx.append(
      await quarry.programs.Operator.methods
        .setQuarryCreator()
        .accounts({
          operator: operatorAddress,
          admin: quarry.provider.walletKey,
          delegate: smartWalletWrapper.key,
        })
        .instruction()
    );
    await tx.confirm();
    await waitForSuccess({
      f: async () => {
        if (!(await quarry.loadOperator(operatorAddress))) {
          throw Error('Not created yet');
        }
      },
    });

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

    await expect(
      waitForSuccess({
        f: async () => {
          const smartWalletData = await smartWalletWrapper.reloadData();
          if (!smartWalletData.numTransactions.eqn(1)) {
            throw new Error('Not created yet');
          }
          return true;
        },
      })
    ).resolves.toBeTruthy();

    tx = await smartWalletWrapper.executeTransaction({
      transactionKey: (
        await findTransactionAddress(smartWalletWrapper.key, 0)
      )[0],
    });
    await tx.confirm();
    await expect(
      waitForSuccess({
        f: async () => {
          const quarryWrapper = await rewarderWrapper.getQuarry(
            Token.fromMint(mintKeypair.publicKey, 9)
          );
          return quarryWrapper.quarryData.tokenMintKey.toBase58();
        },
      })
    ).resolves.toBe(mintKeypair.publicKey.toBase58());
  });
});
