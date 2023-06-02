import { GokiSDK } from '@gokiprotocol/client';
import { KedgereeSDK } from '@marinade.finance/kedgeree-sdk';
import { QuarrySDK } from '@quarryprotocol/quarry-sdk';
import { SignerWallet, SolanaProvider } from '@saberhq/solana-contrib';
import { Cluster, Connection, Keypair, clusterApiUrl } from '@solana/web3.js';

export interface Context {
  quarry: QuarrySDK;
  goki: GokiSDK;
  kedgeree: KedgereeSDK;
  simulate: boolean;
}

const context: {
  quarry: QuarrySDK | null;
  goki: GokiSDK | null;
  kedgeree: KedgereeSDK | null;
  simulate: boolean;
} = {
  quarry: null,
  goki: null,
  kedgeree: null,
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
  try {
    cluster = clusterApiUrl(cluster as Cluster);
  } catch (e) {
    // ignore
  }
  const provider = SolanaProvider.init({
    connection: new Connection(cluster, 'confirmed'),
    wallet: new SignerWallet(walletKP),
  });
  context.quarry = QuarrySDK.load({ provider });
  context.goki = GokiSDK.load({ provider });
  context.kedgeree = new KedgereeSDK({ provider });
  context.simulate = simulate;
};

export const useContext = () => {
  return context as Context;
};
