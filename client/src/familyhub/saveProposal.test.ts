import { afterEach, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('../lib/api', () => ({ api: calls }));
import { postProposal } from './saveProposal';
import type { AiProposal } from '../components/app/MagicInput';
const task: AiProposal = { type: 'task', title: 'Fictional library bag', description: null, due_date: '2026-11-01', frequency: 'Une fois', priority: null, assigned_to: [], member_names: [] };
const appointment: AiProposal = { type: 'appointment', title: 'Fictional pickup', description: null, start_time: '2026-11-01T15:00', end_time: '2026-11-01T16:00', location: null, family_member_ids: [], member_names: [] };
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
it('routes every Family Hub launcher through the configured Google account and timezone', async () => {
    vi.stubEnv('VITE_FAMILYHUB_LOCAL', 'true');
    calls.get.mockResolvedValue({ data: { connected: true, selection: { timeZone: 'America/New_York' } } });
    await postProposal(task); await postProposal(appointment);
    expect(calls.post.mock.calls).toEqual([
        ['/api/familyhub/google/tasks', { title: task.title, dueDate: '2026-11-01' }],
        ['/api/familyhub/google/events', { title: appointment.title, location: undefined, start: { dateTime: appointment.start_time, timeZone: 'America/New_York' }, end: { dateTime: appointment.end_time, timeZone: 'America/New_York' } }],
    ]);
});
it('refuses an unconfigured Google connection instead of creating competing local data', async () => {
    vi.stubEnv('VITE_FAMILYHUB_LOCAL', 'true');
    calls.get.mockResolvedValue({ data: { connected: false } });
    await expect(postProposal(task)).rejects.toThrow('Connect Google');
    expect(calls.post).not.toHaveBeenCalled();
});
it('refuses unsupported recurring tasks', async () => {
    await expect(postProposal({ ...task, frequency: 'Quotidien' }, { timeZone: 'America/New_York' })).rejects.toThrow('Recurring');
    expect(calls.post).not.toHaveBeenCalled();
});
it('leaves a missing end time to the server, which applies the default event length', async () => {
    await postProposal({ ...appointment, end_time: null }, { timeZone: 'America/New_York' });
    expect(calls.post).toHaveBeenCalledWith('/api/familyhub/google/events', { title: appointment.title, location: undefined, start: { dateTime: appointment.start_time, timeZone: 'America/New_York' } });
});
it('preserves original OpenFamily writes outside opt-in Family Hub mode', async () => {
    vi.stubEnv('VITE_FAMILYHUB_LOCAL', 'false');
    await postProposal(task);
    expect(calls.get).not.toHaveBeenCalled();
    expect(calls.post).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({ title: task.title, due_date: '2026-11-01', frequency: 'Une fois' }));
});

it('sends colour and repeat rule with a new event, and shopping items to the chosen Google list', async () => {
    await postProposal({ ...appointment, color_id: '10', people: ['Fictional Sam'], recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=4' }, { timeZone: 'America/New_York' });
    expect(calls.post).toHaveBeenLastCalledWith('/api/familyhub/google/events', expect.objectContaining({ colorId: '10', recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=4'] }));
    await postProposal({ type: 'shopping_item', name: 'Floss', category: 'Sante', quantity: 2, unit: null, list_id: 'list/1', list_title: 'Groceries' });
    expect(calls.post).toHaveBeenLastCalledWith('/api/familyhub/shopping/lists/list%2F1/items', { name: 'Floss', aisle: 'Sante', quantity: '2' });
    await postProposal({ type: 'shopping_item', name: 'Floss', category: 'Sante', quantity: null, unit: null });
    expect(calls.post).toHaveBeenLastCalledWith('/api/shopping', { name: 'Floss', category: 'Sante' });
});
it('applies changes to existing Google items by the ids the server resolved', async () => {
    const start = { dateTime: '2026-11-20T15:00:00', timeZone: 'America/New_York' }, end = { dateTime: '2026-11-20T16:00:00', timeZone: 'America/New_York' };
    await postProposal({ type: 'appointment_update', event_id: 'ev1', title: 'Fictional vaccine', location: '', color_id: null, people: [], all_day: false, start, end, before: { title: 'Fictional vaccine', start, end, location: '' } });
    expect(calls.patch).toHaveBeenLastCalledWith('/api/familyhub/google/events/ev1', { title: 'Fictional vaccine', location: '', colorId: null, start, end });
    await postProposal({ type: 'appointment_delete', event_id: 'ev2', title: 'x', all_day: true, start: { date: '2026-11-20' } });
    expect(calls.delete).toHaveBeenLastCalledWith('/api/familyhub/google/events/ev2');
    await postProposal({ type: 'task_complete', task_id: 't1', title: 'x' });
    expect(calls.patch).toHaveBeenLastCalledWith('/api/familyhub/google/tasks/t1', { completed: true });
    await postProposal({ type: 'shopping_check', list_id: 'l1', item_id: 'i1', name: 'Milk', list_title: 'Groceries' });
    expect(calls.patch).toHaveBeenLastCalledWith('/api/familyhub/shopping/lists/l1/items/i1', { checked: true });
    expect(calls.get).not.toHaveBeenCalled();
});
