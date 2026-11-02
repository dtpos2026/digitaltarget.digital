// ============================================================
// Kitchen Display — honesty locks (v1.93.0, from the offline POS).
//
// The board shows finished work for a short while, not a history. The display detection and window placement it relies
// on (the OS's own display list, never a guessed cable type) live in the Windows shell — dtpos-desktop,
// src/main/ipc/displayHelpers.ts and its tests — not in this repository.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const kds = readFileSync(resolve(__dirname, '../pages/KdsTvPage.tsx'), 'utf8');

describe('the kitchen board shows finished work, not a history', () => {
  it('keeps a short recent window rather than everything', () => {
    expect(kds).toMatch(/RECENT_MS/);
  });

  it('separates cancelled from completed', () => {
    // A cancellation must be noticed within seconds or food keeps being made.
    expect(kds).toMatch(/CANCELLED/);
    expect(kds).toMatch(/line-through/);
  });

  it('flags a genuinely new order and lets the flag expire', () => {
    expect(kds).toMatch(/freshIds/);
    expect(kds).toMatch(/NEW/);
    expect(kds).toMatch(/next\.delete\(id\)/);
  });

  it('honours reduced-motion', () => {
    // This screen is watched for hours; movement has to be optional.
    expect(kds).toMatch(/prefers-reduced-motion/);
  });
});
