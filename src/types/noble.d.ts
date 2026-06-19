/**
 * Ambient type declarations for ESM-only packages used by the ZK crypto module.
 *
 * The @noble/curves and @noble/hashes packages are ESM-only (type: "module"),
 * which TypeScript's CommonJS module resolution cannot discover.
 * These declarations provide the type information needed for compilation;
 * at runtime, vitest/ts-node resolve the actual ESM modules.
 */

declare module '@noble/curves/ed25519.js' {
  interface Ed25519Point {
    multiply(scalar: bigint): Ed25519Point;
    add(other: Ed25519Point): Ed25519Point;
    subtract(other: Ed25519Point): Ed25519Point;
    double(): Ed25519Point;
    equals(other: Ed25519Point): boolean;
    toBytes(): Uint8Array;
    toHex(): string;
    toAffine(): { x: bigint; y: bigint };
    negate(): Ed25519Point;
  }

  interface Ed25519PointStatic {
    BASE: Ed25519Point;
    ZERO: Ed25519Point;
    Fn: { ORDER: bigint };
    Fp: unknown;
    CURVE: unknown;
    fromHex(hex: string): Ed25519Point;
    fromAffine(affine: { x: bigint; y: bigint }): Ed25519Point;
  }

  export const ed25519: {
    Point: Ed25519PointStatic;
    keygen(): Uint8Array;
    getPublicKey(privateKey: Uint8Array): Uint8Array;
    sign(msg: Uint8Array, privateKey: Uint8Array): Uint8Array;
    verify(sig: Uint8Array, msg: Uint8Array, publicKey: Uint8Array): boolean;
  };
}

declare module '@noble/hashes/sha2.js' {
  export function sha512(msg: Uint8Array | string): Uint8Array;
  export function sha256(msg: Uint8Array | string): Uint8Array;
  export function sha384(msg: Uint8Array | string): Uint8Array;
}
