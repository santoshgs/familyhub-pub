export type MemberId = 'alex' | 'jamie' | 'leo' | 'maya';
export interface Member { id: MemberId; name: string; initial: string; color: string; tint: string }
export interface HubEvent {
    id: string; title: string; date: string; start: string; end: string;
    location: string; members: MemberId[]; description: string; category: string;
}
export interface HubTask {
    id: string; title: string; due: string; member: MemberId; completed: boolean;
}
export type NoteColor = 'butter' | 'rose' | 'sage';
export interface HubNote {
    id: string; content: string; author: MemberId; createdLabel: string;
    color: NoteColor; pinned: boolean;
}
export interface DaycareEntry {
    id: string; time: string; title: string; detail: string;
    type: 'activity' | 'meal' | 'nap' | 'arrival';
}
export interface Assignment {
    id: string; subject: string; title: string; due: string; description: string;
}
export interface HubSnapshot {
    events: HubEvent[]; tasks: HubTask[]; notes: HubNote[];
    daycare: DaycareEntry[]; assignments: Assignment[];
}
export type View = 'overview' | 'calendar' | 'tasks' | 'notes';
export type PreviewState = 'ready' | 'loading' | 'error' | 'empty';
export type CardId = 'calendar' | 'tasks' | 'notes' | 'daycare' | 'classroom';
