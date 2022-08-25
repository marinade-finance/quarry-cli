import { SignerWallet, SolanaProvider } from '@saberhq/solana-contrib';
import { Connection } from '@solana/web3.js';
import { parseKeypair } from '@marinade.finance/solana-cli-utils';

describe('set-rewards', () => {
  let provider: SolanaProvider;

  beforeEach(async () => {
    provider = SolanaProvider.init({
      connection: new Connection('http://localhost:8899'),
      wallet: new SignerWallet(await parseKeypair('~/.config/solana/id.json')),
    });
  });

  it('runs', async () => {
    console.log(
      await provider.connection.getBalance(provider.wallet.publicKey)
    );
  });
});
