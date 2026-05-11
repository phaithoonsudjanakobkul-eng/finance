type DocumentWithVT = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> }
}

export function withViewTransition(update: () => void): void {
  if (typeof document === 'undefined') {
    update()
    return
  }
  const doc = document as DocumentWithVT
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  if (prefersReduced || typeof doc.startViewTransition !== 'function') {
    update()
    return
  }
  doc.startViewTransition(update)
}
