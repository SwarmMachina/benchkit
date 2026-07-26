const BYTES_PER_MIB = 1024 ** 2

/**
 * Converts bytes to mebibytes without rounding.
 * @param bytes Byte count to convert.
 * @returns `bytes / 1_048_576`.
 */
export function bytesToMiB(bytes: number): number {
  return bytes / BYTES_PER_MIB
}
