// java.util.Random, bit for bit: the game seeds its star field with it, so the same seed here puts
// every star where the game puts it, and picks a block's random model variant with it, so every
// grass top turns the way the game turns it. 48-bit state kept in a BigInt.

// BigInt calls rather than literals: the build targets ES2017 syntax.
const MULTIPLIER = BigInt(0x5deece66d);
const MASK = (BigInt(1) << BigInt(48)) - BigInt(1);
const ADDEND = BigInt(0xb);
// Mth.getSeed's constants, converted once rather than on every block the mesher looks up.
const Z_FACTOR = BigInt(116129781);
const MIX_FACTOR = BigInt(42317861);
const MIX_ADDEND = BigInt(11);
const SEED_SHIFT = BigInt(16);
const SHIFT_32 = BigInt(32);

export class JavaRandom {
  private seed: bigint;

  constructor(seed: number | bigint) {
    this.seed = (BigInt(seed) ^ MULTIPLIER) & MASK;
  }

  /** The next `bits` bits as Java's signed int: for 32 bits, the top bit is the sign. */
  private next(bits: number): number {
    this.seed = (this.seed * MULTIPLIER + ADDEND) & MASK;
    return Number(this.seed >> BigInt(48 - bits)) | 0;
  }

  /** Java's nextLong: two 32-bit draws, the first shifted up, as a signed 64-bit value. */
  nextLong(): bigint {
    const hi = BigInt(this.next(32)) << SHIFT_32;
    return BigInt.asIntN(64, hi + BigInt(this.next(32)));
  }

  nextFloat(): number {
    return this.next(24) / (1 << 24);
  }

  nextDouble(): number {
    return (this.next(26) * 2 ** 27 + this.next(27)) / 2 ** 53;
  }
}

/**
 * The game's seed for a block position (Mth.getSeed), the 64-bit arithmetic wrapped as Java's: an
 * int product in x, long products elsewhere, and an arithmetic shift at the end.
 */
export function positionSeed(x: number, y: number, z: number): bigint {
  let i = BigInt(Math.imul(x, 3129871)) ^ BigInt.asIntN(64, BigInt(z) * Z_FACTOR) ^ BigInt(y);
  i = BigInt.asIntN(64, i * i * MIX_FACTOR + i * MIX_ADDEND);
  return i >> SEED_SHIFT;
}

/**
 * Which of a block's `count` equally weighted model variants the game draws at a position: it
 * seeds its random with the position and takes the absolute low int of one long, modulo the total.
 */
export function variantAt(x: number, y: number, z: number, count: number): number {
  const low = Number(BigInt.asIntN(32, new JavaRandom(positionSeed(x, y, z)).nextLong()));
  return Math.abs(low) % count;
}
