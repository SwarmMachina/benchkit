export default function shuffle(arr: string[]): string[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0

    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }

  return arr
}
