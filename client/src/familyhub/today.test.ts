import { expect, it } from 'vitest';
import { cleanDaycareText, describeDay, dueLabel, onColour, splitTime, worldHue, WORLD_HUES } from './today';

it('names nearby days the way people say them', () => {
    expect(describeDay('2026-11-05', '2026-11-05', 'America/New_York')).toBe('Today');
    expect(describeDay('2026-11-06', '2026-11-05', 'America/New_York')).toBe('Tomorrow');
    expect(dueLabel('2026-11-03', '2026-11-05', 'America/New_York')).toBe('Overdue');
});

it('splits the clock time from its day period', () => {
    const { time } = splitTime(new Date('2026-11-05T13:30:00Z'), 'America/New_York');
    expect(time).toMatch(/^0?8:30$/);
});

it('picks readable text for light and dark colours', () => {
    expect(onColour('#F7C21B')).toBe('#1B1B1F');
    expect(onColour('#1F4FD8')).toBe('#FFFFFF');
    expect(onColour('not a colour')).toBe('#1B1B1F');
});

it('drops decorative banner rules from daycare emails', () => {
    expect(cleanDaycareText('************* Report ************* Naps ---- 1:08pm')).toBe('Report Naps 1:08pm');
    expect(cleanDaycareText('one two three four', 9)).toBe('one two…');
});

it('maps Google calendar colours to the nearest Board Book hue', () => {
    expect(worldHue('#e67c73')).toBe(WORLD_HUES.tomato); // flamingo
    expect(worldHue('#f6bf26')).toBe(WORLD_HUES.sun); // banana
    expect(worldHue('#33b679')).toBe(WORLD_HUES.grass); // sage
    expect(worldHue('#7986cb')).toBe(WORLD_HUES.cobalt); // lavender
    expect(worldHue('#616161')).toBe('#5A5A66'); // graphite
});
