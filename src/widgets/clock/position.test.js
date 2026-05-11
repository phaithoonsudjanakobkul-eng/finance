import { describe, it, expect } from 'vitest';
import { clampToViewport, edgeDistance, shouldStow, stowFabFor } from './position.js';

describe('clampToViewport', () => {
    it('passes through in-range points', () => {
        const r = clampToViewport({ x: 100, y: 50, w: 80, h: 40, vw: 1024, vh: 768 });
        expect(r).toEqual({ x: 100, y: 50 });
    });
    it('clamps negative x/y to 0', () => {
        const r = clampToViewport({ x: -10, y: -5, w: 80, h: 40, vw: 1024, vh: 768 });
        expect(r).toEqual({ x: 0, y: 0 });
    });
    it('clamps to right/bottom edge so box stays inside', () => {
        const r = clampToViewport({ x: 999, y: 999, w: 80, h: 40, vw: 1024, vh: 768 });
        expect(r.x).toBe(1024 - 80);
        expect(r.y).toBe(768 - 40);
    });
    it('handles box larger than viewport without going negative', () => {
        const r = clampToViewport({ x: 50, y: 50, w: 2000, h: 2000, vw: 1024, vh: 768 });
        expect(r).toEqual({ x: 0, y: 0 });
    });
});

describe('edgeDistance', () => {
    it('reports left when near the left edge', () => {
        const r = edgeDistance({ x: 5, y: 300, w: 80, h: 40, vw: 1024, vh: 768 });
        expect(r.edge).toBe('left');
        expect(r.distance).toBe(5);
    });
    it('reports right when near the right edge', () => {
        const r = edgeDistance({ x: 1024 - 80 - 3, y: 300, w: 80, h: 40, vw: 1024, vh: 768 });
        expect(r.edge).toBe('right');
        expect(r.distance).toBe(3);
    });
    it('reports top when near the top edge', () => {
        const r = edgeDistance({ x: 500, y: 2, w: 80, h: 40, vw: 1024, vh: 768 });
        expect(r.edge).toBe('top');
        expect(r.distance).toBe(2);
    });
    it('reports bottom when near the bottom edge', () => {
        const r = edgeDistance({ x: 500, y: 768 - 40 - 1, w: 80, h: 40, vw: 1024, vh: 768 });
        expect(r.edge).toBe('bottom');
        expect(r.distance).toBe(1);
    });
});

describe('shouldStow', () => {
    it('true when ≤ threshold from any edge', () => {
        expect(shouldStow({ x: 5,  y: 300, w: 80, h: 40, vw: 1024, vh: 768 })).toBe(true);
        expect(shouldStow({ x: 939, y: 300, w: 80, h: 40, vw: 1024, vh: 768 })).toBe(true); // right edge ≈ 5
    });
    it('false when well inside the viewport', () => {
        expect(shouldStow({ x: 400, y: 300, w: 80, h: 40, vw: 1024, vh: 768 })).toBe(false);
    });
    it('respects custom threshold', () => {
        expect(shouldStow({ x: 60, y: 300, w: 80, h: 40, vw: 1024, vh: 768, threshold: 100 })).toBe(true);
        expect(shouldStow({ x: 60, y: 300, w: 80, h: 40, vw: 1024, vh: 768, threshold: 10  })).toBe(false);
    });
});

describe('stowFabFor', () => {
    it('left edge → bottom-left corner', () => {
        const r = stowFabFor({ edge: 'left', vw: 1024, vh: 768 });
        expect(r.x).toBe(16);
        expect(r.y).toBe(768 - 44 - 16);
    });
    it('right edge → bottom-right corner', () => {
        const r = stowFabFor({ edge: 'right', vw: 1024, vh: 768 });
        expect(r.x).toBe(1024 - 44 - 16);
        expect(r.y).toBe(768 - 44 - 16);
    });
    it('top edge → top-right corner', () => {
        const r = stowFabFor({ edge: 'top', vw: 1024, vh: 768 });
        expect(r.x).toBe(1024 - 44 - 16);
        expect(r.y).toBe(16);
    });
    it('respects custom fabSize + inset', () => {
        const r = stowFabFor({ edge: 'left', vw: 1024, vh: 768, fabSize: 60, inset: 8 });
        expect(r.x).toBe(8);
        expect(r.y).toBe(768 - 60 - 8);
    });
});
