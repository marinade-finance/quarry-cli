import { GokiSDK } from '@gokiprotocol/client';
import { QuarrySDK } from '@quarryprotocol/quarry-sdk';
import { SignerWallet, SolanaProvider } from '@saberhq/solana-contrib';
import { Connection, Keypair } from '@solana/web3.js';

export interface Context {
  quarry: QuarrySDK;
  goki: GokiSDK;
  simulate: boolean;
}

const context: {
  quarry: QuarrySDK | null;
  goki: GokiSDK | null;
  simulate: boolean;
} = {
  quarry: null,
  goki: null,
  simulate: false,
};

export const setContext = ({
  cluster,
  walletKP,
  simulate,
}: {
  cluster: string;
  walletKP: Keypair;
  simulate: boolean;
}) => {
  const provider = SolanaProvider.init({
    connection: new Connection(cluster),
    wallet: new SignerWallet(walletKP),
  });
  context.quarry = QuarrySDK.load({ provider });
  context.goki = GokiSDK.load({ provider });
  context.simulate = simulate;
};

export const useContext = () => {
  return context as Context;
};
