import { Command } from 'commander';
import { parseKeypair } from './keyParser';
import { Keypair } from '@solana/web3.js';
import { setContext } from './context';
import { installSetRewards } from './setRewards';
import { installCreateQuarry } from './createQuarry';

export function setup(): Command {
  const program = new Command();

  program
    .version('1.0.0')
    .allowExcessArguments(false)
    .option(
      '-c, --cluster <cluster>',
      'Solana cluster',
      'http://localhost:8899'
    )
    .option('--commitment <commitment>', 'Commitment', 'confirmed')
    .option('-k, --keypair <keypair>', 'Wallet keypair', parseKeypair)
    .option('-s, --simulate', 'Simulate')
    .hook('preAction', async (command: Command) => {
      const wallet = command.opts().keypair;
      const walletKP = wallet
        ? ((await wallet) as Keypair)
        : await parseKeypair('~/.config/solana/id.json');
      setContext({
        cluster: command.opts().cluster as string,
        walletKP,
        simulate: Boolean(command.opts().simulate),
      });
    });

  installSetRewards(program);
  installCreateQuarry(program);
  return program;
}
