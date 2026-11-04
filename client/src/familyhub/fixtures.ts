import type { HubSnapshot, Member } from './types';

// Entirely fictional. A fixed sample day makes screenshots and interactions
// reproducible; this is never presented as today's real household schedule.
export const SAMPLE_DAY = '2026-10-28';
export const SAMPLE_DATE_LABEL = 'Wednesday, October 28';
export const MEMBERS: Member[] = [
    { id: 'alex', name: 'Alex', initial: 'A', color: '#775b9d', tint: '#eee7f5' },
    { id: 'jamie', name: 'Jamie', initial: 'J', color: '#b56845', tint: '#fae9dc' },
    { id: 'leo', name: 'Leo', initial: 'L', color: '#477c99', tint: '#e2eef5' },
    { id: 'maya', name: 'Maya', initial: 'M', color: '#577b56', tint: '#e6eddf' },
];
export const memberById = (id: string) => MEMBERS.find((member) => member.id === id) ?? MEMBERS[0];

const seed: HubSnapshot = {
    events: [
        { id: 'story', title: 'Library story time', date: SAMPLE_DAY, start: '10:30', end: '11:15', location: 'Maplewood Library', members: ['jamie', 'maya'], description: 'A morning of picture books, songs, and a little imagination. Bring the library tote.', category: 'Out & about' },
        { id: 'park', title: 'After-school park time', date: SAMPLE_DAY, start: '15:30', end: '16:30', location: 'Willow Park', members: ['alex', 'leo'], description: 'Meet by the big oak tree. Pack a snack and a warm layer.', category: 'Family time' },
        { id: 'dinner', title: 'Dinner, all together', date: SAMPLE_DAY, start: '18:00', end: '19:00', location: 'At home', members: ['alex', 'jamie', 'leo', 'maya'], description: 'Pasta night. Everyone gets a turn choosing the music.', category: 'At home' },
        { id: 'swim', title: 'Swimming lesson', date: '2026-10-29', start: '16:00', end: '16:45', location: 'Cedar Community Centre', members: ['alex', 'leo'], description: 'Bring a towel, goggles, and the blue swim bag.', category: 'Activities' },
        { id: 'walk', title: 'A little weekend adventure', date: '2026-10-31', start: '09:30', end: '11:00', location: 'Pine Trail', members: ['alex', 'jamie', 'leo', 'maya'], description: 'An easy woodland walk and a warm drink afterwards.', category: 'Family time' },
    ],
    tasks: [
        { id: 'permission', title: 'Sign the field trip form', due: SAMPLE_DAY, member: 'alex', completed: false },
        { id: 'boots', title: 'Pack Maya’s rain boots', due: SAMPLE_DAY, member: 'jamie', completed: false },
        { id: 'books', title: 'Return the library books', due: '2026-10-29', member: 'alex', completed: false },
        { id: 'snacks', title: 'Pick up snacks for the weekend', due: '2026-10-30', member: 'jamie', completed: false },
        { id: 'plants', title: 'Water the kitchen plants', due: SAMPLE_DAY, member: 'leo', completed: true },
    ],
    notes: [
        { id: 'grandparents', content: 'Grandma & Grandpa are coming for lunch on Sunday. Let’s make something cozy.', author: 'jamie', createdLabel: 'Yesterday', color: 'butter', pinned: true },
        { id: 'kindness', content: 'Leo helped Maya put on her shoes this morning. Little things, big love. ♡', author: 'alex', createdLabel: '8:15 AM', color: 'rose', pinned: false },
    ],
    daycare: [
        { id: 'arrival', time: '8:20 AM', title: 'A happy hello', detail: 'Settled in with a favourite book and a big smile.', type: 'arrival' },
        { id: 'art', time: '9:15 AM', title: 'A morning of little discoveries', detail: 'Leaf prints, autumn colours, and plenty of creative exploring.', type: 'activity' },
        { id: 'meal', time: '11:30 AM', title: 'Lunch, happily enjoyed', detail: 'Vegetable soup, wholegrain bread, and apple slices.', type: 'meal' },
        { id: 'nap', time: '12:15 PM', title: 'Time to recharge', detail: 'A peaceful nap from 12:15 to 1:30 PM.', type: 'nap' },
    ],
    assignments: [
        { id: 'reading', subject: 'Reading', title: 'A chapter & a little reflection', due: '2026-10-29', description: 'Read a chapter of your choice. Write three sentences about your favourite character.' },
        { id: 'nature', subject: 'Science', title: 'The autumn nature journal', due: '2026-10-30', description: 'Find three different leaves and draw what you notice about their shapes and colours.' },
    ],
};

export const createMockSnapshot = (): HubSnapshot => JSON.parse(JSON.stringify(seed)) as HubSnapshot;

export const dateLabel = (date: string): string => {
    if (!date) return 'No date';
    if (date === SAMPLE_DAY) return 'Today';
    if (date === '2026-10-29') return 'Tomorrow';
    return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
};

export const timeLabel = (time: string): string => {
    const [hour, minute] = time.split(':').map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
};
