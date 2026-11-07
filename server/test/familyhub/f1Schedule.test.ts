import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/urlGuard', async (original) => ({
    ...(await original<typeof import('../../src/utils/urlGuard')>()),
    assertSafeIntegrationUrl: vi.fn(async () => undefined),
}));
import { getNextFormulaRace } from '../../src/services/familyhub/ambient';

// Fictional schedule.
const races = { MRData: { RaceTable: { Races: [
    { raceName: 'Demo Grand Prix', date: '2031-11-02', time: '20:00:00Z', Circuit: { circuitName: 'Demo Park', Location: { locality: 'Demo City', country: 'Fictionland' } } },
    { raceName: 'Later Grand Prix', date: '2031-11-09', time: '17:00:00Z', Circuit: { circuitName: 'Later Ring', Location: { locality: 'Later', country: 'Fictionland' } } },
] } } };

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('keeps the last good F1 schedule through a failed refresh and moves on once a race has started', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-10-30T12:00:00Z'));
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(races));
    expect((await getNextFormulaRace(new Date()))?.name).toBe('Demo Grand Prix');

    // Seven hours later the cache has expired and Jolpica rate-limits us: keep showing the schedule.
    vi.setSystemTime(new Date('2031-10-30T19:00:00Z'));
    fetch.mockImplementation(async () => new Response('slow down', { status: 429 }));
    expect((await getNextFormulaRace(new Date()))?.name).toBe('Demo Grand Prix');

    // After the first race starts, a stale entry is not shown; a good answer gives the next race.
    vi.setSystemTime(new Date('2031-11-03T00:00:00Z'));
    fetch.mockImplementation(async () => Response.json(races));
    expect((await getNextFormulaRace(new Date()))?.name).toBe('Later Grand Prix');
});
