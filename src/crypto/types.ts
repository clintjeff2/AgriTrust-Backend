/**
 * Zero-Knowledge Verification Layer Types
 *
 * Defines the core data structures for the ZK provenance system:
 * Pedersen commitments, range proofs, and batch proof containers.
 */

/** A Pedersen commitment represented as a 32-byte compressed ed25519 point. */
export interface PedersenCommitment {
  commitment: Uint8Array;
}

/** Opening information for a Pedersen commitment (value + blinding factor). */
export interface Opening {
  value: bigint;
  blinding: Uint8Array;
}

/**
 * A zero-knowledge range proof proving that a committed value lies within
 * a specified interval [min, max] without revealing the value itself.
 *
 * Proof structure (compact binary format):
 *   [1 byte: dimensionName length] [N bytes: dimensionName]
 *   [4 bytes: numBits (big-endian)]
 *   [32 bytes: value commitment]
 *   [32 bytes: farmer key hash]
 *   For each bit (numBits times):
 *     [32 bytes: C_i commitment]
 *     [8 bytes: e_0 (big-endian u64 as scalar)]
 *     [8 bytes: e_1 (big-endian u64 as scalar)]
 *     [32 bytes: z_0 scalar]
 *     [32 bytes: z_1 scalar]
 *
 * Total size: 1 + N + 4 + 32 + 32 + numBits * (32 + 8 + 8 + 32 + 32) = 69 + N + numBits * 112
 * For typical dimensions (N ≤ 20, numBits ≤ 8): ≤ 69 + 20 + 896 = 985 bytes < 2 KB ✓
 */
export interface RangeProof {
  /** Pedersen commitment to the value being proved. */
  commitment: PedersenCommitment;
  /** Serialized proof data in the compact binary format described above. */
  proof: Uint8Array;
  /** 16-byte dimension identifier (hash of the dimension name). */
  dimensionId: Uint8Array;
}

/** Supported certification dimensions for organic compliance verification. */
export type CertificationDimension =
  | 'organic_compost_used'
  | 'pesticide_free_days'
  | 'nitrate_level'
  | 'soil_ph'
  | 'water_usage'
  | 'carbon_footprint';

/** Pre-computed dimension IDs for known certification dimensions. */
export const DIMENSION_IDS: Record<string, Uint8Array> = {
  organic_compost_used: hexToBytes('01000000000000000000000000000000'),
  pesticide_free_days: hexToBytes('02000000000000000000000000000000'),
  nitrate_level: hexToBytes('03000000000000000000000000000000'),
  soil_ph: hexToBytes('04000000000000000000000000000000'),
  water_usage: hexToBytes('05000000000000000000000000000000'),
  carbon_footprint: hexToBytes('06000000000000000000000000000000'),
};

/** A collection of range proofs for a single supply log batch. */
export interface BatchProof {
  /** 32-byte farmer public key used to bind proofs to a specific farmer. */
  farmerPublicKey: Uint8Array;
  /** Range proofs, one per certification dimension in the batch. */
  proofs: RangeProof[];
  /** Unix timestamp (ms) when the batch was proven. */
  timestamp: number;
}

/** A supply log batch submitted by a farmer for organic certification verification. */
export interface SupplyLogBatch {
  batchId: string;
  farmerId: string;
  /** ZK proofs for certification dimensions; null if proofs are pending. */
  proofs: BatchProof | null;
  /** Additional batch metadata (location, crop type, etc.). */
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/** Error type for ZK-related failures. */
export class ZKError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZKError';
  }
}

/** Convert a hex string (no 0x prefix) to Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
