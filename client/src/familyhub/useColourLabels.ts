import { useEffect, useMemo, useState } from 'react';
import { loadPalette, paletteColours, snapLegend } from './colourLabels';

/** The household's colour labels, moved onto Google's colours (see snapLegend). Parents only load the palette. */
export function useColourLabels(legend: Record<string, string>, enabled: boolean): Record<string, string> {
    const [colours, setColours] = useState<string[] | null>(null);
    useEffect(() => {
        if (!enabled) return;
        let live = true;
        loadPalette().then((value) => { if (live) setColours(paletteColours(value)); }).catch(() => undefined);
        return () => { live = false; };
    }, [enabled]);
    return useMemo(() => colours ? snapLegend(legend, colours) : legend, [legend, colours]);
}
