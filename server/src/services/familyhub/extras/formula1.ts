import { readCappedText, safeFetch } from '../../../lib/safeFetch';

/**
 * Driver and constructor standings from Jolpica (the Ergast-compatible API),
 * normalised on the Pi with team colours and gaps to the leader.
 */

/** Team colours by Ergast constructorId; unknown teams get a neutral grey. */
const TEAM_COLOURS: Record<string, string> = {
    red_bull: '#3671C6', mclaren: '#FF8000', ferrari: '#E8002D', mercedes: '#27F4D2', aston_martin: '#229971',
    alpine: '#0093CC', williams: '#64C4FF', rb: '#6692FF', racing_bulls: '#6692FF', alphatauri: '#5E8FAA',
    sauber: '#52E252', kick_sauber: '#52E252', audi: '#BB0A30', haas: '#B6BABD', cadillac: '#C9A227', alfa: '#C92D4B',
};
export const teamColour = (constructorId: string) => TEAM_COLOURS[constructorId] ?? '#8a94a6';

export interface DriverStanding { position: number; driverId: string; name: string; number: string; code: string; team: string; teamId: string; colour: string; points: number; wins: number; favorite: boolean }
export interface ConstructorStanding { position: number; teamId: string; name: string; colour: string; points: number; wins: number; gap: number; favorite: boolean }
export interface Standings { season: string; round: string; drivers: DriverStanding[]; constructors: ConstructorStanding[]; fetchedAt: string }

const text = (value: unknown, max = 80) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const num = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };

export function normalizeStandings(driversJson: unknown, constructorsJson: unknown, favorites: { team: string; driver: string }): Omit<Standings, 'fetchedAt'> {
    const driverList = (driversJson as { MRData?: { StandingsTable?: { season?: unknown; round?: unknown; StandingsLists?: Array<{ season?: unknown; round?: unknown; DriverStandings?: unknown[] }> } } })
        ?.MRData?.StandingsTable?.StandingsLists?.[0];
    const constructorList = (constructorsJson as { MRData?: { StandingsTable?: { StandingsLists?: Array<{ ConstructorStandings?: unknown[] }> } } })
        ?.MRData?.StandingsTable?.StandingsLists?.[0];
    const drivers: DriverStanding[] = (Array.isArray(driverList?.DriverStandings) ? driverList!.DriverStandings : []).slice(0, 30).map((raw) => {
        const row = raw as Record<string, any>;
        const driver = row.Driver ?? {}, team = Array.isArray(row.Constructors) ? row.Constructors[row.Constructors.length - 1] ?? {} : {};
        const driverId = text(driver.driverId, 40), teamId = text(team.constructorId, 40);
        return {
            position: num(row.position), driverId, name: [text(driver.givenName, 40), text(driver.familyName, 40)].filter(Boolean).join(' '),
            number: text(driver.permanentNumber, 3), code: text(driver.code, 3), team: text(team.name, 60), teamId, colour: teamColour(teamId),
            points: num(row.points), wins: num(row.wins), favorite: Boolean(favorites.driver && driverId === favorites.driver) || Boolean(!favorites.driver && favorites.team && teamId === favorites.team),
        };
    }).filter((row) => row.position > 0 && row.name);
    const constructorsRaw = Array.isArray(constructorList?.ConstructorStandings) ? constructorList!.ConstructorStandings : [];
    const leaderPoints = num((constructorsRaw[0] as Record<string, unknown> | undefined)?.points);
    const constructors: ConstructorStanding[] = constructorsRaw.slice(0, 15).map((raw) => {
        const row = raw as Record<string, any>;
        const team = row.Constructor ?? {};
        const teamId = text(team.constructorId, 40), points = num(row.points);
        return { position: num(row.position), teamId, name: text(team.name, 60), colour: teamColour(teamId), points, wins: num(row.wins),
            gap: Math.max(0, leaderPoints - points), favorite: Boolean(favorites.team && teamId === favorites.team) };
    }).filter((row) => row.position > 0 && row.name);
    return { season: text(driverList?.season, 8), round: text(driverList?.round, 4), drivers, constructors };
}

const cache = new Map<string, { value: Standings | null; expiresAt: number }>();
const pending = new Map<string, Promise<Standings | null>>();

export async function getStandings(season: string, pollMinutes: number, favorites: { team: string; driver: string }): Promise<Standings | null> {
    const key = season;
    const hit = cache.get(key);
    const withFavorites = (value: Standings | null) => value && {
        ...value,
        drivers: value.drivers.map((row) => ({ ...row, favorite: favorites.driver ? row.driverId === favorites.driver : Boolean(favorites.team && row.teamId === favorites.team) })),
        constructors: value.constructors.map((row) => ({ ...row, favorite: Boolean(favorites.team && row.teamId === favorites.team) })),
    };
    if (hit && hit.expiresAt > Date.now()) return withFavorites(hit.value);
    const inFlight = pending.get(key);
    if (inFlight) return withFavorites(await inFlight);
    const work = (async () => {
        try {
            const base = `https://api.jolpi.ca/ergast/f1/${encodeURIComponent(season)}`;
            const [driversResponse, constructorsResponse] = await Promise.all([
                safeFetch(`${base}/driverStandings.json?limit=40`, { timeoutMs: 10_000, maxBytes: 256 * 1024 }),
                safeFetch(`${base}/constructorStandings.json?limit=20`, { timeoutMs: 10_000, maxBytes: 128 * 1024 }),
            ]);
            if (!driversResponse.ok || !constructorsResponse.ok) throw new Error('Standings unavailable.');
            const normalized = normalizeStandings(
                JSON.parse(await readCappedText(driversResponse, 256 * 1024)),
                JSON.parse(await readCappedText(constructorsResponse, 128 * 1024)),
                { team: '', driver: '' },
            );
            const value: Standings | null = normalized.drivers.length || normalized.constructors.length ? { ...normalized, fetchedAt: new Date().toISOString() } : null;
            cache.set(key, { value, expiresAt: Date.now() + (value ? pollMinutes : 30) * 60_000 });
            return value;
        } catch {
            // Keep the last good standings through a failed refresh.
            const stale = hit?.value ?? null;
            cache.set(key, { value: stale, expiresAt: Date.now() + 15 * 60_000 });
            return stale;
        } finally { pending.delete(key); }
    })();
    pending.set(key, work);
    return withFavorites(await work);
}
