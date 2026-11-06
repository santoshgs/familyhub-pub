/**
 * Moon phase computed on the Pi (no extra service): age in the synodic month
 * from a known new moon, illuminated fraction, phase name, the next full and
 * new moons, and the SVG path of the lit part for the display to draw as is.
 * Accuracy is within about a day, which is plenty for a wall display.
 */

const SYNODIC_DAYS = 29.530588853;
// New moon of January 6, 2000, 18:14 UTC (a standard reference epoch).
const REFERENCE_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const DAY_MS = 86_400_000;

export interface MoonPhase {
    /** Days since the last new moon, 0 to 29.53. */
    ageDays: number;
    /** Illuminated fraction, 0 (new) to 1 (full). */
    illumination: number;
    waxing: boolean;
    name: string;
    nextFullMoon: string;
    nextNewMoon: string;
    /** SVG path of the lit area inside a 48 × 48 box (circle centre 24,24, radius 20). */
    litPath: string;
}

const PHASE_NAMES: Array<[number, string]> = [
    [1.0, 'New moon'], [6.4, 'Waxing crescent'], [8.4, 'First quarter'], [13.8, 'Waxing gibbous'],
    [15.8, 'Full moon'], [21.1, 'Waning gibbous'], [23.1, 'Last quarter'], [28.5, 'Waning crescent'], [30, 'New moon'],
];

/** The lit part as a path: the outer half on the lit side plus the terminator ellipse. */
export function moonLitPath(illumination: number, waxing: boolean, cx = 24, cy = 24, r = 20): string {
    const k = Math.min(1, Math.max(0, illumination));
    if (k < 0.005) return '';
    const rx = Math.abs(1 - 2 * k) * r;
    const top = `${cx} ${cy - r}`, bottom = `${cx} ${cy + r}`;
    const round = (n: number) => Math.round(n * 100) / 100;
    // Outer arc along the lit side, then back along the terminator. In SVG (y
    // down) sweep 1 is clockwise: top → right → bottom.
    const outerSweep = waxing ? 1 : 0;
    const crescent = k < 0.5;
    const innerSweep = waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0);
    return `M ${top} A ${r} ${r} 0 0 ${outerSweep} ${bottom} A ${round(rx)} ${r} 0 0 ${innerSweep} ${top} Z`;
}

export function moonPhase(at: Date = new Date()): MoonPhase {
    const elapsedDays = (at.getTime() - REFERENCE_NEW_MOON) / DAY_MS;
    const ageDays = ((elapsedDays % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
    const illumination = (1 - Math.cos((2 * Math.PI * ageDays) / SYNODIC_DAYS)) / 2;
    const waxing = ageDays < SYNODIC_DAYS / 2;
    const name = PHASE_NAMES.find(([limit]) => ageDays < limit)?.[1] ?? 'New moon';
    const untilFull = ((SYNODIC_DAYS / 2 - ageDays) + SYNODIC_DAYS) % SYNODIC_DAYS;
    const untilNew = SYNODIC_DAYS - ageDays;
    return {
        ageDays: Math.round(ageDays * 10) / 10,
        illumination: Math.round(illumination * 100) / 100,
        waxing,
        name,
        nextFullMoon: new Date(at.getTime() + untilFull * DAY_MS).toISOString(),
        nextNewMoon: new Date(at.getTime() + untilNew * DAY_MS).toISOString(),
        litPath: moonLitPath(illumination, waxing),
    };
}
