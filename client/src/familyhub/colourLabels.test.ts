import { expect, it, vi } from 'vitest';
vi.mock('../lib/api', () => ({ api: { get: vi.fn() } }));
import { nearestColour, snapLegend } from './colourLabels';

const google = ['#9fe1e7', '#a4bdfc', '#7ae7bf', '#dbadff', '#ff887c', '#fbd75b', '#ffb878', '#46d6db', '#e1e1e1', '#5484ed', '#51b749', '#dc2127'];
it('moves a label on a custom shade onto the nearest Google colour', () => {
    expect(snapLegend({ '#33b679': 'Fictional Sam', '#9fe1e7': 'Fictional Lee', '#ff887c': 'Parent' }, google)).toEqual({ '#51b749': 'Fictional Sam', '#9fe1e7': 'Fictional Lee', '#ff887c': 'Parent' });
});
it('never replaces a label already on that Google colour, and keeps far-off shades as they are', () => {
    expect(snapLegend({ '#51b749': 'Family', '#4caf50': 'Fictional Sam' }, google)).toEqual({ '#51b749': 'Family', '#4caf50': 'Fictional Sam' });
    expect(nearestColour('#000000', google)).toBeNull();
    expect(snapLegend({ '#33b679': 'Fictional Sam' }, [])).toEqual({ '#33b679': 'Fictional Sam' });
});
