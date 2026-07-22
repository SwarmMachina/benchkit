const BYTES_PER_MIB = 1024 ** 2

export function bytesToMiB(bytes: number): number {
  return bytes / BYTES_PER_MIB
}
