import { sleep } from '@saberhq/solana-contrib';

export async function waitForSuccess<T>({
  f,
  wait = 40000,
  step = 100,
}: {
  f: () => Promise<T>;
  wait?: number;
  step?: number;
}): Promise<T> {
  while (wait > 0) {
    try {
      return await f();
    } catch (_) {
      await sleep(step);
      wait -= step;
    }
  }
  throw new Error('Waiting failed');
}
