import { expect, it, vi } from 'vitest';
vi.mock('../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
import { addLocalMinutes, defaultEnd, defaultStart } from './eventDefaults';

const zone = 'America/New_York';
it('starts a new event on the day being viewed, at 9 am unless that day is today', () => {
    const now = new Date('2026-11-14T19:20:00Z'); // 2:20 pm in Springfield
    expect(defaultStart('2026-12-03', zone, now)).toBe('2026-12-03T09:00');
    expect(defaultStart('2026-11-14', zone, now)).toBe('2026-11-14T15:00');
    expect(defaultStart(undefined, zone, now)).toBe('2026-11-14T15:00');
    expect(defaultStart(undefined, zone, new Date('2026-11-15T04:30:00Z'))).toBe('2026-11-14T09:00'); // 11:30 pm: no later hour today
});
it('ends a new event after the default length, or the next day when all-day', () => {
    expect(addLocalMinutes('2026-11-14T23:30', 60)).toBe('2026-11-15T00:30');
    expect(defaultEnd('2026-11-14T15:00', false, 45)).toBe('2026-11-14T15:45');
    expect(defaultEnd('2026-11-30', true, 60)).toBe('2026-12-01');
    expect(defaultEnd('', false, 60)).toBe('');
});
