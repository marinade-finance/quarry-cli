import { GokiSDK } from '@gokiprotocol/client';
import { Provider } from '@saberhq/solana-contrib';
import { Keypair } from '@solana/web3.js';
import BN from 'bn.js';
import { GokiHelper } from './goki';
import { MultisigHelper } from './multisig';

export { MultisigHelper } from './multisig';
export { GokiHelper } from './goki';

export interface MultisigFacotry {
  name: string;
  create: (config: {
    provider: Provider;
    members?: Keypair[];
    includeWallet?: boolean;
    threshold?: BN;
  }) => Promise<MultisigHelper>;
}

export const MULTISIG_FACTORIES: MultisigFacotry[] = [
  {
    name: 'Goki',
    create: ({ provider, members, includeWallet, threshold }) =>
      GokiHelper.create({
        members,
        includeWallet,
        threshold,
        goki: GokiSDK.load({ provider }),
      }),
  },
];
