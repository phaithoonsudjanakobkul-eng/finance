const KEY = 'ps_dark'

export function loadDark(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(KEY) === '1'
}

export function saveDark(dark: boolean): void {
  if (typeof localStorage === 'undefined') return
  if (dark) localStorage.setItem(KEY, '1')
  else localStorage.removeItem(KEY)
}

export function applyDarkClass(dark: boolean): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', dark)
}

class ThemeStore {
  dark = $state(loadDark())

  toggle(): void {
    this.dark = !this.dark
    saveDark(this.dark)
    applyDarkClass(this.dark)
  }

  init(): void {
    applyDarkClass(this.dark)
  }
}

export const theme = new ThemeStore()
