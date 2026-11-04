import { createMockSnapshot, MEMBERS, SAMPLE_DAY } from './fixtures';
import type { HubNote, MemberId, NoteColor } from './types';

// An adapter inside OpenFamily's existing demo API, never a production backend.
// Keep mutations here so a future service can replace the mock without moving
// provider logic into cards. All state is discarded on page reload.
export function createFamilyHubMock() {
    let snapshot = createMockSnapshot();
    let sequence = 0;
    const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    const text = (value: unknown, max: number): string => {
        if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`Please enter between 1 and ${max} characters.`);
        return value.trim();
    };
    const member = (value: unknown): MemberId => MEMBERS.find((entry) => entry.id === value)?.id ?? 'alex';
    const color = (value: unknown): NoteColor => value === 'rose' || value === 'sage' ? value : 'butter';
    const due = (value: unknown): string => {
        if (value === '' || value === undefined) return '';
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Please choose a valid due date.');
        const parsed = new Date(`${value}T12:00:00Z`);
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('Please choose a valid due date.');
        return value;
    };
    return (method: string, endpoint: string, raw?: unknown) => {
        const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const path = endpoint.split('?')[0].replace(/^\/api\/familyhub/, '');
        if (method === 'POST' && path === '/reset') snapshot = createMockSnapshot();
        else if (method === 'POST' && path === '/tasks') {
            snapshot.tasks.unshift({ id: `hub-task-${++sequence}`, title: text(body.title, 200), due: due(body.due ?? SAMPLE_DAY), member: member(body.member), completed: false });
        } else if (method === 'PUT' && path.startsWith('/tasks/')) {
            const task = snapshot.tasks.find((entry) => entry.id === path.slice(7));
            if (!task) throw new Error('This task no longer exists.');
            const next = { ...task };
            if ('title' in body) next.title = text(body.title, 200);
            if ('due' in body) next.due = due(body.due);
            if ('member' in body) next.member = member(body.member);
            if ('completed' in body) {
                if (typeof body.completed !== 'boolean') throw new Error('Invalid task status.');
                next.completed = body.completed;
            }
            Object.assign(task, next);
        } else if (method === 'DELETE' && path.startsWith('/tasks/')) {
            snapshot.tasks = snapshot.tasks.filter((task) => task.id !== path.slice(7));
        } else if (method === 'POST' && path === '/notes') {
            snapshot.notes.unshift({ id: `hub-note-${++sequence}`, content: text(body.content, 500), author: member(body.author), createdLabel: 'Just now', color: color(body.color), pinned: false });
        } else if (method === 'PUT' && path.startsWith('/notes/')) {
            const note = snapshot.notes.find((entry) => entry.id === path.slice(7));
            if (!note) throw new Error('This note no longer exists.');
            const next: HubNote = { ...note };
            if ('content' in body) next.content = text(body.content, 500);
            if ('color' in body) next.color = color(body.color);
            if ('pinned' in body) next.pinned = Boolean(body.pinned);
            Object.assign(note, next);
        } else if (method === 'DELETE' && path.startsWith('/notes/')) {
            snapshot.notes = snapshot.notes.filter((note) => note.id !== path.slice(7));
        } else if (!(method === 'GET' && path === '')) {
            throw new Error('This mock action is not available.');
        }
        return { success: true as const, data: copy(snapshot) };
    };
}

export const familyHubMockRequest = createFamilyHubMock();
