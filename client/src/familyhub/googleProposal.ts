import type { AiProposal } from '../components/app/MagicInput';

type Action = { method: 'post' | 'patch' | 'delete'; endpoint: string; body?: unknown };
const shoppingItem = (listId: string, itemId: string) => `/api/familyhub/shopping/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`;

/**
 * Translate reviewed AI proposals into the same Google writes the cards make.
 * Changes to existing items (v2.1) carry the ids the server resolved, so they
 * need no Google selection here; null means "not a Google write".
 */
export function googleAction(proposal: AiProposal, timeZone?: string): Action | null {
    switch (proposal.type) {
        case 'appointment_update':
            // PATCH replaces title, time, place and colour, so the proposal carries all of them.
            return { method: 'patch', endpoint: `/api/familyhub/google/events/${encodeURIComponent(proposal.event_id)}`,
                body: { title: proposal.title, location: proposal.location, colorId: proposal.color_id || null, start: proposal.start, end: proposal.end } };
        case 'appointment_delete': return { method: 'delete', endpoint: `/api/familyhub/google/events/${encodeURIComponent(proposal.event_id)}` };
        case 'task_update': return { method: 'patch', endpoint: `/api/familyhub/google/tasks/${encodeURIComponent(proposal.task_id)}`, body: { title: proposal.title, dueDate: proposal.due_date } };
        case 'task_complete': return { method: 'patch', endpoint: `/api/familyhub/google/tasks/${encodeURIComponent(proposal.task_id)}`, body: { completed: true } };
        case 'task_delete': return { method: 'delete', endpoint: `/api/familyhub/google/tasks/${encodeURIComponent(proposal.task_id)}` };
        case 'shopping_check': return { method: 'patch', endpoint: shoppingItem(proposal.list_id, proposal.item_id), body: { checked: true } };
        case 'shopping_delete': return { method: 'delete', endpoint: shoppingItem(proposal.list_id, proposal.item_id) };
        case 'shopping_item':
            // On the household's Google shopping list when it has one; otherwise the local list.
            return proposal.list_id ? { method: 'post', endpoint: `/api/familyhub/shopping/lists/${encodeURIComponent(proposal.list_id)}/items`, body: {
                name: proposal.name, aisle: proposal.category,
                ...(proposal.quantity ? { quantity: String(proposal.quantity) } : {}), ...(proposal.unit ? { unit: proposal.unit } : {}),
            } } : null;
        default: break;
    }
    if (!timeZone) return null;
    const google = googleProposal(proposal, timeZone);
    return google ? { method: 'post', endpoint: google.endpoint, body: google.body } : null;
}

/** Translate reviewed OpenFamily AI proposals into the same Google card writes. */
export function googleProposal(proposal: AiProposal, timeZone: string): { endpoint: string; body: unknown } | null {
    if (proposal.type === 'task') {
        if (proposal.frequency && proposal.frequency !== 'Une fois') throw new Error('Recurring Google tasks must be configured in Google Tasks.');
        return { endpoint: '/api/familyhub/google/tasks', body: { title: proposal.title, dueDate: proposal.due_date || null,
            ...(proposal.description ? { description: proposal.description } : {}) } };
    }
    if (proposal.type === 'appointment') {
        // Without an end time the server uses the household's default event
        // length (Settings → Household → Calendar events), 60 minutes by default.
        // Since v2.1 the person's colour and a repeat rule come along when known.
        return { endpoint: '/api/familyhub/google/events', body: { title: proposal.title, location: proposal.location || undefined,
            ...(proposal.description ? { description: proposal.description } : {}),
            ...(proposal.color_id ? { colorId: proposal.color_id } : {}),
            ...(proposal.recurrence ? { recurrence: [proposal.recurrence] } : {}),
            start: { dateTime: proposal.start_time, timeZone }, ...(proposal.end_time ? { end: { dateTime: proposal.end_time, timeZone } } : {}) } };
    }
    return null;
}
