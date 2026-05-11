import { describe, it, expect } from 'vitest';
import { extractTikTokId, embedUrl } from './tiktok.js';

describe('extractTikTokId', () => {
    it('parses /@user/video/<id>', () => {
        expect(extractTikTokId('https://www.tiktok.com/@psphraseguy/video/7456123456789012345')).toBe('7456123456789012345');
    });
    it('parses /embed/v2/<id>', () => {
        expect(extractTikTokId('https://www.tiktok.com/embed/v2/7456123456789012345')).toBe('7456123456789012345');
    });
    it('parses /v/<id>.html', () => {
        expect(extractTikTokId('https://m.tiktok.com/v/7456123456789012345.html')).toBe('7456123456789012345');
    });
    it('parses bare digit string', () => {
        expect(extractTikTokId('74561234567890')).toBe('74561234567890');
    });
    it('rejects non-tiktok URLs', () => {
        expect(extractTikTokId('https://example.com/foo')).toBe(null);
        expect(extractTikTokId('https://vt.tiktok.com/abc/')).toBe(null);
        expect(extractTikTokId('')).toBe(null);
        expect(extractTikTokId('   ')).toBe(null);
        expect(extractTikTokId('not a url')).toBe(null);
    });
    it('rejects short digit strings (likely not a video id)', () => {
        expect(extractTikTokId('1234')).toBe(null);
    });
});

describe('embedUrl', () => {
    it('builds the TikTok embed URL', () => {
        expect(embedUrl('7456123456789012345')).toBe('https://www.tiktok.com/embed/v2/7456123456789012345');
    });
});
