import { QuarrySDK } from '@quarryprotocol/quarry-sdk';
import { Keypair, PublicKey } from '@solana/web3.js';
import { Command } from 'commander';

export function installCreateRewarder(program: Command) {
  program.command('set-rewards');
}
/*
export async function createRewarder({
  quarry,
  rewarderBase,
  hardcap,
  rentPayer,
  proposer,
  simulate,
}: {
  quarry: QuarrySDK;
  rewarderBase: Keypair;
  mintWrapper: PublicKey;
}) {}
*/
