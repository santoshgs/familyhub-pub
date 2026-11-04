import type { AiProposal } from '../components/app/MagicInput';
import { api } from '../lib/api';
import { googleProposal } from './googleProposal';

export const postProposal = async (proposal: AiProposal, google?: { timeZone: string }): Promise<void> => {
    // All launchers, including Settings, use Google in Family Hub mode.
    // Missing configuration must never create a competing local task/event.
    if (!google && import.meta.env.VITE_FAMILYHUB_LOCAL === 'true' && ['task', 'appointment'].includes(proposal.type)) {
        const response = await api.get<{ data: { connected: boolean; selection?: { timeZone: string } } }>('/api/familyhub/google/status');
        if (!response.data.connected || !response.data.selection) throw new Error('Connect Google and choose the family calendar and task list first.');
        google = { timeZone: response.data.selection.timeZone };
    }
    if (google) {
        const action = googleProposal(proposal, google.timeZone);
        if (action) { await api.post(action.endpoint, action.body); return; }
    }
    switch (proposal.type) {
        case 'task':
            await api.post('/api/tasks', {
                title: proposal.title,
                ...(proposal.description ? { description: proposal.description } : {}),
                ...(proposal.due_date ? { due_date: proposal.due_date } : {}),
                ...(proposal.priority ? { priority: proposal.priority } : {}),
                ...(proposal.frequency ? { frequency: proposal.frequency } : {}),
                assigned_to: proposal.assigned_to,
            });
            return;
        case 'appointment':
            await api.post('/api/appointments', {
                title: proposal.title,
                ...(proposal.description ? { description: proposal.description } : {}),
                start_time: proposal.start_time,
                ...(proposal.end_time ? { end_time: proposal.end_time } : {}),
                ...(proposal.location ? { location: proposal.location } : {}),
                family_member_ids: proposal.family_member_ids,
            });
            return;
        case 'shopping_item':
            await api.post('/api/shopping', {
                name: proposal.name,
                category: proposal.category,
                ...(proposal.quantity ? { quantity: proposal.quantity } : {}),
                ...(proposal.unit ? { unit: proposal.unit } : {}),
            });
            return;
        case 'budget_entry':
            await api.post('/api/budget/entries', {
                category: proposal.category,
                amount: proposal.amount,
                ...(proposal.description ? { description: proposal.description } : {}),
                date: proposal.date,
                is_expense: proposal.is_expense,
            });
            return;
    }
};

