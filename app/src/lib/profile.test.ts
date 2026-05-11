import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadProfile,
  saveProfileName,
  saveProfileNotes,
  saveProfilePhoto,
} from './profile.svelte'

describe('loadProfile', () => {
  beforeEach(() => localStorage.clear())

  it('defaults name to Pi-keng and notes/photo empty on fresh storage', () => {
    const p = loadProfile()
    expect(p.name).toBe('Pi-keng')
    expect(p.notes).toBe('')
    expect(p.photo).toBeNull()
    expect(p.photoTs).toBeNull()
  })

  it('reads previously-saved values', () => {
    localStorage.setItem('ps_profile_name_v2', 'Junie')
    localStorage.setItem('ps_profile_notes_v2', 'Hello')
    localStorage.setItem('ps_profile_photo_v2', 'data:image/jpeg;base64,XYZ')
    localStorage.setItem('ps_profile_photo_ts_v2', '12345')
    const p = loadProfile()
    expect(p.name).toBe('Junie')
    expect(p.notes).toBe('Hello')
    expect(p.photo).toBe('data:image/jpeg;base64,XYZ')
    expect(p.photoTs).toBe(12345)
  })

  it('treats non-numeric photoTs as null (corrupt value tolerant)', () => {
    localStorage.setItem('ps_profile_photo_ts_v2', 'bogus')
    expect(loadProfile().photoTs).toBeNull()
  })
})

describe('saveProfileName', () => {
  beforeEach(() => localStorage.clear())

  it('trims whitespace', () => {
    saveProfileName('  Pi  ')
    expect(localStorage.getItem('ps_profile_name_v2')).toBe('Pi')
  })

  it('falls back to default when given empty / whitespace-only', () => {
    saveProfileName('   ')
    expect(localStorage.getItem('ps_profile_name_v2')).toBe('Pi-keng')
  })
})

describe('saveProfileNotes', () => {
  beforeEach(() => localStorage.clear())

  it('persists notes verbatim including newlines', () => {
    saveProfileNotes('line1\nline2')
    expect(localStorage.getItem('ps_profile_notes_v2')).toBe('line1\nline2')
  })
})

describe('saveProfilePhoto', () => {
  beforeEach(() => localStorage.clear())

  it('writes data URL + timestamp', () => {
    saveProfilePhoto('data:image/jpeg;base64,abc')
    expect(localStorage.getItem('ps_profile_photo_v2')).toBe('data:image/jpeg;base64,abc')
    expect(Number(localStorage.getItem('ps_profile_photo_ts_v2'))).toBeGreaterThan(0)
  })

  it('null clears both keys', () => {
    localStorage.setItem('ps_profile_photo_v2', 'old')
    localStorage.setItem('ps_profile_photo_ts_v2', '1')
    saveProfilePhoto(null)
    expect(localStorage.getItem('ps_profile_photo_v2')).toBeNull()
    expect(localStorage.getItem('ps_profile_photo_ts_v2')).toBeNull()
  })
})
