import { run } from '@marinade.finance/solana-test-utils';
import { PublicKey } from '@solana/web3.js';

run([
  {
    address: new PublicKey('QMNeHCGYnLVDn1icRAfQZpjPLBNkfGbSKRB83G5d8KB'),
    path: 'fixtures/quarry-mine.so',
  },
  {
    address: new PublicKey('QMWoBmAyJLAsA1Lh9ugMTw2gciTihncciphzdNzdZYV'),
    path: 'fixtures/quarry-mint-wrapper.so',
  },
  {
    address: new PublicKey('QoP6NfrQbaGnccXQrMLUkog2tQZ4C1RFgJcwDnT8Kmz'),
    path: 'fixtures/quarry-operator.so',
  },
  {
    address: new PublicKey('QREGBnEj9Sa5uR91AV8u3FxThgP5ZCvdZUW2bHAkfNc'),
    path: 'fixtures/quarry-registry.so',
  },
  {
    address: new PublicKey('GokivDYuQXPZCWRkwMhdH2h91KpDQXBEmpgBgs55bnpH'),
    path: 'fixtures/goki-smart-wallet.so',
  },
  {
    address: new PublicKey('GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw'),
    path: 'fixtures/spl-governance.so',
  },
  {
    address: new PublicKey('kedgrkbZ5TcjRz2fSpZMcasWzyxd8SuEaXoGfbkPddc'),
    path: 'fixtures/kedgeree.so',
  },
]);
