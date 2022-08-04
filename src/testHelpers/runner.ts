import { SignerWallet, sleep, SolanaProvider } from '@saberhq/solana-contrib';
import { Connection } from '@solana/web3.js';
import { exec, execSync, spawn, spawnSync } from 'child_process';
import { parseKeypair } from '../keyParser';


async function run() {
  console.log('Starting test validator');
  const testValidator = spawn('solana-test-validator', [
    '--bpf-program',
    'QMNeHCGYnLVDn1icRAfQZpjPLBNkfGbSKRB83G5d8KB',
    'fixtures/quarry-mine.so',
    '--bpf-program',
    'QMWoBmAyJLAsA1Lh9ugMTw2gciTihncciphzdNzdZYV',
    'fixtures/quarry-mint-wrapper.so',
    '--bpf-program',
    'QoP6NfrQbaGnccXQrMLUkog2tQZ4C1RFgJcwDnT8Kmz',
    'fixtures/quarry-operator.so',
    '--bpf-program',
    'QREGBnEj9Sa5uR91AV8u3FxThgP5ZCvdZUW2bHAkfNc',
    'fixtures/quarry-registry.so',
    '--bpf-program',
    'GokivDYuQXPZCWRkwMhdH2h91KpDQXBEmpgBgs55bnpH',
    'fixtures/goki-smart-wallet.so'
  ]);
  testValidator.stderr.on('data', data => console.log(data.toString('latin1')));
  try {
    // testValidator.on('close', code => console.log(`Close ${code}`));
    const provider = SolanaProvider.init({
      connection: new Connection('http://localhost:8899'),
      wallet: new SignerWallet(await parseKeypair('~/.config/solana/id.json')),
    });

    let wait = 10000;
    const step = 100;
    while (wait > 0) {
      try {
        await provider.connection.getLatestBlockhash();
        break;
      } catch (e) {
        await sleep(step);
        wait -= step;
      }
    }
    if (wait <= 0) {
      testValidator.kill();
      throw new Error(
        'Unable to get latest blockhash. Test validator does not look started'
      );
    }
    console.log('Test validator online');

    const test = spawn('pnpm', ['_test'], {stdio: 'inherit'});
    await new Promise((resolve, reject) => test.on('close', code => {
      if (code) {
        reject(code);
      } else {
        resolve(null);
      }
    }))
  } finally {
    testValidator.kill();
  }
}

run();
