export default function shuffle(arr: string[]): string[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0
    const current = arr[i]
    const replacement = arr[j]

    if (current === undefined || replacement === undefined) {
      continue
    }

    arr[i] = replacement
    arr[j] = current
  }

  return arr
}
