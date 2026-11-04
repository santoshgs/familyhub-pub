import { afterEach, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
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
it('requires explicit end times and refuses unsupported recurring tasks', async () => {
    await expect(postProposal({ ...task, frequency: 'Quotidien' }, { timeZone: 'America/New_York' })).rejects.toThrow('Recurring');
    await expect(postProposal({ ...appointment, end_time: null }, { timeZone: 'America/New_York' })).rejects.toThrow('end time');
    expect(calls.post).not.toHaveBeenCalled();
});
it('preserves original OpenFamily writes outside opt-in Family Hub mode', async () => {
    vi.stubEnv('VITE_FAMILYHUB_LOCAL', 'false');
    await postProposal(task);
    expect(calls.get).not.toHaveBeenCalled();
    expect(calls.post).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({ title: task.title, due_date: '2026-11-01', frequency: 'Une fois' }));
});
