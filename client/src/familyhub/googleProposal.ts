import type { AiProposal } from '../components/app/MagicInput';
/** Translate reviewed OpenFamily AI proposals into the same Google card writes. */
export function googleProposal(proposal: AiProposal, timeZone: string): { endpoint: string; body: unknown } | null {
    if (proposal.type === 'task') {
        if (proposal.frequency && proposal.frequency !== 'Une fois') throw new Error('Recurring Google tasks must be configured in Google Tasks.');
        return { endpoint: '/api/familyhub/google/tasks', body: { title: proposal.title, dueDate: proposal.due_date || null,
            ...(proposal.description ? { description: proposal.description } : {}) } };
    }
    if (proposal.type === 'appointment') {
        if (!proposal.end_time) throw new Error('Please provide an end time for the Google Calendar event.');
        return { endpoint: '/api/familyhub/google/events', body: { title: proposal.title, location: proposal.location || undefined,
            ...(proposal.description ? { description: proposal.description } : {}),
            start: { dateTime: proposal.start_time, timeZone }, end: { dateTime: proposal.end_time, timeZone } } };
    }
    return null;
}
