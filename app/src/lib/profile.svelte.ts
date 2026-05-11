export interface ProfileSnapshot {
  name: string
  notes: string
  photo: string | null
  photoTs: number | null
}

const K_NAME  = 'ps_profile_name_v2'
const K_NOTES = 'ps_profile_notes_v2'
const K_PHOTO = 'ps_profile_photo_v2'
const K_PHOTO_TS = 'ps_profile_photo_ts_v2'

const DEFAULT_NAME = 'Pi-keng'

export function loadProfile(): ProfileSnapshot {
  if (typeof localStorage === 'undefined') {
    return { name: DEFAULT_NAME, notes: '', photo: null, photoTs: null }
  }
  return {
    name: localStorage.getItem(K_NAME) ?? DEFAULT_NAME,
    notes: localStorage.getItem(K_NOTES) ?? '',
    photo: localStorage.getItem(K_PHOTO),
    photoTs: parseTs(localStorage.getItem(K_PHOTO_TS)),
  }
}

function parseTs(raw: string | null): number | null {
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function saveProfileName(name: string): void {
  if (typeof localStorage === 'undefined') return
  const trimmed = name.trim() || DEFAULT_NAME
  localStorage.setItem(K_NAME, trimmed)
}

export function saveProfileNotes(notes: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(K_NOTES, notes)
}

export function saveProfilePhoto(dataUrl: string | null): void {
  if (typeof localStorage === 'undefined') return
  if (dataUrl) {
    localStorage.setItem(K_PHOTO, dataUrl)
    localStorage.setItem(K_PHOTO_TS, String(Date.now()))
  } else {
    localStorage.removeItem(K_PHOTO)
    localStorage.removeItem(K_PHOTO_TS)
  }
}

class ProfileStore {
  #snap = $state<ProfileSnapshot>(loadProfile())

  get name(): string { return this.#snap.name }
  get notes(): string { return this.#snap.notes }
  get photo(): string | null { return this.#snap.photo }
  get photoTs(): number | null { return this.#snap.photoTs }
  get initial(): string { return (this.#snap.name.trim().charAt(0) || 'P').toUpperCase() }

  setName(name: string): void {
    const trimmed = name.trim() || DEFAULT_NAME
    this.#snap = { ...this.#snap, name: trimmed }
    saveProfileName(trimmed)
  }

  setNotes(notes: string): void {
    this.#snap = { ...this.#snap, notes }
    saveProfileNotes(notes)
  }

  setPhoto(dataUrl: string | null): void {
    this.#snap = { ...this.#snap, photo: dataUrl, photoTs: dataUrl ? Date.now() : null }
    saveProfilePhoto(dataUrl)
  }
}

export const profile = new ProfileStore()
