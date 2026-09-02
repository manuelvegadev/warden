// java.util.Random, bit for bit: the game seeds its star field with it, so the same seed here puts
// every star where the game puts it. 48-bit state kept in a BigInt; a few thousand draws per scene.

// BigInt calls rather than literals: the build targets ES2017 syntax.
const MULTIPLIER = BigInt(0x5deece66d);
const MASK = (BigInt(1) << BigInt(48)) - BigInt(1);
const ADDEND = BigInt(0xb);

export class JavaRandom {
  private seed: bigint;

  constructor(seed: number | bigint) {
    this.seed = (BigInt(seed) ^ MULTIPLIER) & MASK;
  }

  private next(bits: number): number {
    this.seed = (this.seed * MULTIPLIER + ADDEND) & MASK;
    return Number(this.seed >> BigInt(48 - bits));
  }

  nextFloat(): number {
    return this.next(24) / (1 << 24);
  }

  nextDouble(): number {
    return (this.next(26) * 2 ** 27 + this.next(27)) / 2 ** 53;
  }
}
