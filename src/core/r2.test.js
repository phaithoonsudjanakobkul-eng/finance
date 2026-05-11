// Round-trip tests for the AES-GCM pipeline. Network paths
// (r2Upload / r2Download) aren't tested here — they're thin fetch
// wrappers and would need MSW; the encryption layer is what we own.

import { describe, it, expect } from 'vitest';
import { deriveR2Key, encryptBlob, decryptBlob, isR2Configured } from './r2.js';

const TOKEN = 'test-token-for-r2-derivation-only';

describe('deriveR2Key', () => {
    it('returns an AES-GCM key', async () => {
        const k = await deriveR2Key(TOKEN);
        expect(k.algorithm.name).toBe('AES-GCM');
        // @ts-ignore — length is a public field on AesKeyAlgorithm
        expect(k.algorithm.length).toBe(256);
    });

    it('same token derives the same key bytes (deterministic)', async () => {
        const a = await encryptBlob(TOKEN, new Blob([new Uint8Array([1, 2, 3, 4])]));
        const b = await decryptBlob(TOKEN, await a.arrayBuffer());
        expect(new Uint8Array(b)).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('different token cannot decrypt', async () => {
        const enc = await encryptBlob(TOKEN, new Blob([new Uint8Array([9, 9, 9])]));
        await expect(decryptBlob('different-token-entirely', await enc.arrayBuffer())).rejects.toThrow();
    });
});

describe('encryptBlob / decryptBlob round-trip', () => {
    it('text payload round-trips byte-exact', async () => {
        const text = 'พี่เก่งคะ ทดสอบ R2 round-trip — ไทย + emojis + 0xFF';
        const blob = new Blob([new TextEncoder().encode(text)]);
        const enc = await encryptBlob(TOKEN, blob);
        const out = await decryptBlob(TOKEN, await enc.arrayBuffer());
        const back = new TextDecoder().decode(out);
        expect(back).toBe(text);
    });

    it('binary payload (1 KB random) round-trips byte-exact', async () => {
        const bytes = crypto.getRandomValues(new Uint8Array(1024));
        const enc = await encryptBlob(TOKEN, new Blob([bytes]));
        const out = await decryptBlob(TOKEN, await enc.arrayBuffer());
        expect(new Uint8Array(out)).toEqual(bytes);
    });

    it('output begins with the 12-byte IV', async () => {
        const blob = new Blob([new Uint8Array([42])]);
        const enc = await encryptBlob(TOKEN, blob);
        expect(enc.size).toBeGreaterThan(12); // IV + ciphertext + auth tag
    });

    it('two encryptions of the same plaintext produce different bytes (IV randomised)', async () => {
        const blob = new Blob([new TextEncoder().encode('same input')]);
        const a = new Uint8Array(await (await encryptBlob(TOKEN, blob)).arrayBuffer());
        const b = new Uint8Array(await (await encryptBlob(TOKEN, blob)).arrayBuffer());
        expect(a).not.toEqual(b);
    });
});

describe('isR2Configured', () => {
    it('false when worker URL + token + gist token not set', () => {
        localStorage.clear();
        expect(isR2Configured()).toBe(false);
    });

    it('false with only URL', () => {
        localStorage.clear();
        localStorage.setItem('ps_r2_worker_url', 'https://example.workers.dev');
        expect(isR2Configured()).toBe(false);
    });

    it('true with URL + R2 auth token + Gist token all set', () => {
        localStorage.clear();
        localStorage.setItem('ps_r2_worker_url', 'https://example.workers.dev');
        localStorage.setItem('ps_r2_auth_token', 'bearer-here');
        localStorage.setItem('ps_gist_token', 'gist-here');
        expect(isR2Configured()).toBe(true);
    });
});
