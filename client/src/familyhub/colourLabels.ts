import { api } from '../lib/api';

/**
 * Colour labels ("green = Sam") are keyed by colour. Events only ever carry
 * Google's own colours (11 event colours, plus the calendar's), but a label
 * added with "Another colour" could be any shade, so it matched no event and
 * never showed in the event form. snapLegend moves such a label onto the
 * nearest Google colour, unless that colour already has a label of its own.
 */
export interface Palette { calendar: string | null; colors: Array<{ id: string; color: string }> }

let palette: Promise<Palette> | null = null;
export const loadPalette = () => {
    palette ??= api.get<{ data: Palette }>('/api/familyhub/google/colors').then((response) => response.data).catch((error) => { palette = null; throw error; });
    return palette;
};
export const paletteColours = (value: Palette): string[] => [...(value.calendar ? [value.calendar] : []), ...value.colors.map((swatch) => swatch.color)].map((colour) => colour.toLowerCase());

const HEX = /^#[0-9a-f]{6}$/;
const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const distance = (a: string, b: string) => { const [x, y] = [rgb(a), rgb(b)]; return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
/** Farther than this, a custom shade is not taken to mean a Google colour. */
const NEAR = 110;

/** The nearest Google colour for a shade, or null when none is near. */
export function nearestColour(colour: string, colours: string[]): string | null {
    const shade = colour.toLowerCase();
    if (!HEX.test(shade)) return null;
    let best: string | null = null, gap = Infinity;
    for (const candidate of colours) { const d = distance(shade, candidate); if (d < gap) { gap = d; best = candidate; } }
    return best && gap <= NEAR ? best : null;
}

export function snapLegend(legend: Record<string, string>, colours: string[]): Record<string, string> {
    const known = new Set(colours.map((colour) => colour.toLowerCase()));
    if (!known.size) return legend;
    const result: Record<string, string> = {};
    for (const [colour, label] of Object.entries(legend)) if (known.has(colour.toLowerCase())) result[colour.toLowerCase()] = label;
    for (const [colour, label] of Object.entries(legend)) {
        if (known.has(colour.toLowerCase())) continue;
        const nearest = nearestColour(colour, [...known]);
        if (nearest && !(nearest in result)) result[nearest] = label;
        else result[colour] = label;
    }
    return result;
}
