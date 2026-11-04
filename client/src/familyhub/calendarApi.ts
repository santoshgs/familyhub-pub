import { api } from '../lib/api';
import type { HubCalendarEvent } from './calendarDates';
export async function loadCalendarRange(start: string, end: string): Promise<HubCalendarEvent[]> {
    const params = new URLSearchParams({ start, end });
    const response = await api.get<{ data: { events: HubCalendarEvent[] } }>(`/api/familyhub/google/calendar?${params}`);
    return response.data.events;
}
