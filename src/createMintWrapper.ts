import { QuarrySDK } from '@quarryprotocol/quarry-sdk';
import { Keypair, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { Command } from 'commander';

export function installCreateMintWrapper(program: Command) {
  program
    .command('create-mint-wrapper')
    .option('-m, --mint <keypair-or-pubkey>', 'Create or use mint')
    .option('--decimals <decimals>', 'Decimals', parseFloat, 9)
    .option('--hardcap <hardcap>', 'Hard cap')
    .option('--mint-wrapper-base <keypair>', 'Mint wrapper base')
    .option('-a, --admin <admin>', 'Admin authority');
}

export async function createMintWrapper({
  quarry,
  mint = new Keypair(),
  decimals,
  hardcap = new BN('18446744073709551615'),
  mintWrapperBase = new Keypair(),
  admin = quarry.provider.walletKey,
  rentPayer,
  simulate,
}: {
  quarry: QuarrySDK;
  mint?: PublicKey | Keypair;
  decimals: number;
  hardcap?: BN;
  mintWrapperBase?: Keypair;
  admin?: PublicKey;
  rentPayer?: Keypair;
  simulate?: boolean;
}) {
  let tx;
  if (mint instanceof PublicKey) {
    const { mintWrapper, tx: newWrapperTx } =
      await quarry.mintWrapper.newWrapper({
        hardcap,
        tokenMint: mint,
        baseKP: mintWrapperBase,
        admin,
        payer: rentPayer?.publicKey,
      });
    console.log(
      `Create mint wrapper ${mintWrapper.toBase58()} for mint ${mint.toBase58()}`
    );
    tx = newWrapperTx;
  } else {
    const { mintWrapper, tx: newWrapperAndMintTx } =
      await quarry.mintWrapper.newWrapperAndMint({
        mintKP: mint,
        decimals,
        hardcap,
        baseKP: mintWrapperBase,
        admin,
        payer: rentPayer?.publicKey,
      });
    console.log(
      `Create mint ${mint.publicKey.toBase58()} with wrapper ${mintWrapper.toBase58()}`
    );
    tx = newWrapperAndMintTx;
  }

  if (simulate) {
    const result = await tx.simulate();
    console.log(JSON.stringify(result.value));
  } else {
    const result = await tx.confirm();
    console.log(`Tx: ${result.signature}`);
  }
}
