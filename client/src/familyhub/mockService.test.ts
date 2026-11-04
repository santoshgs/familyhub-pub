import { describe, expect, it } from 'vitest';
import { createFamilyHubMock } from './mockService';
import { SAMPLE_DAY } from './fixtures';

describe('Family Hub fictional service', () => {
    it('creates, completes, reopens, edits, and deletes a task without changing its date', () => {
        const request = createFamilyHubMock();
        const created = request('POST', '/api/familyhub/tasks', { title: '  Pack a picnic  ', member: 'jamie', due: '2026-10-31' }).data.tasks[0];
        expect(created).toMatchObject({ title: 'Pack a picnic', due: '2026-10-31', member: 'jamie', completed: false });
        expect(request('PUT', `/api/familyhub/tasks/${created.id}`, { completed: true }).data.tasks[0].completed).toBe(true);
        const reopened = request('PUT', `/api/familyhub/tasks/${created.id}`, { completed: false, title: 'Pack a bigger picnic' }).data.tasks[0];
        expect(reopened).toMatchObject({ title: 'Pack a bigger picnic', due: '2026-10-31', completed: false });
        expect(request('DELETE', `/api/familyhub/tasks/${created.id}`).data.tasks.some((task) => task.id === created.id)).toBe(false);
    });

    it('leaves a task unchanged when part of an update is invalid', () => {
        const request = createFamilyHubMock();
        const before = request('GET', '/api/familyhub').data.tasks[0];
        expect(() => request('PUT', `/api/familyhub/tasks/${before.id}`, { title: 'Changed', due: '2026-02-30' })).toThrow('valid due date');
        expect(request('GET', '/api/familyhub').data.tasks[0]).toEqual(before);
        expect(() => request('POST', '/api/familyhub/tasks', { title: ' ' })).toThrow();
        expect(() => request('PUT', `/api/familyhub/tasks/${before.id}`, { completed: 'false' })).toThrow();
    });

    it('keeps notes as literal text and preserves author on editing and pinning', () => {
        const request = createFamilyHubMock();
        const note = request('POST', '/api/familyhub/notes', { content: '<script>fictional text</script>', author: 'jamie', color: 'sage' }).data.notes[0];
        expect(note).toMatchObject({ content: '<script>fictional text</script>', author: 'jamie', color: 'sage' });
        const changed = request('PUT', `/api/familyhub/notes/${note.id}`, { content: 'Bring a warm layer', pinned: true }).data.notes[0];
        expect(changed).toMatchObject({ content: 'Bring a warm layer', pinned: true, author: 'jamie' });
        expect(request('DELETE', `/api/familyhub/notes/${note.id}`).data.notes.some((entry) => entry.id === note.id)).toBe(false);
    });

    it('does not leak mutable state between responses or independent sessions', () => {
        const request = createFamilyHubMock();
        const response = request('GET', '/api/familyhub');
        response.data.events[0].title = 'Changed outside the service';
        response.data.tasks.length = 0;
        expect(request('GET', '/api/familyhub').data.tasks.length).toBeGreaterThan(0);
        expect(request('GET', '/api/familyhub').data.events[0].title).toBe('Library story time');
        request('POST', '/api/familyhub/tasks', { title: 'Only in this session', due: SAMPLE_DAY });
        expect(createFamilyHubMock()('GET', '/api/familyhub').data.tasks.some((task) => task.title === 'Only in this session')).toBe(false);
    });

    it('restores fictional fixtures on reset without creating duplicate identifiers', () => {
        const request = createFamilyHubMock();
        const first = request('POST', '/api/familyhub/tasks', { title: 'First' }).data.tasks[0];
        const reset = request('POST', '/api/familyhub/reset').data;
        expect(reset.tasks.some((task) => task.id === first.id)).toBe(false);
        const second = request('POST', '/api/familyhub/tasks', { title: 'Second' }).data.tasks[0];
        expect(first.id).not.toBe(second.id);
    });

    it('rejects unknown actions and missing records rather than accepting phantom writes', () => {
        const request = createFamilyHubMock();
        expect(() => request('PUT', '/api/familyhub/tasks/not-a-task', { completed: true })).toThrow('no longer exists');
        expect(() => request('PUT', '/api/familyhub/notes/not-a-note', { content: 'Hello' })).toThrow('no longer exists');
        expect(() => request('POST', '/api/familyhub/oauth')).toThrow('not available');
    });
});
