import { query } from '../../db';
import { decryptCredentials } from '../../utils/crypto';
import type { AiProvider, AiSettings } from './index';

/**
 * The household's AI provider (one row per family in ai_settings), for server
 * features that call the model on their own schedule, like Family Updates
 * (v2.3). Null when AI is not set up or switched off. The key stays server-side.
 */
export async function loadHouseholdAi(familyId: string): Promise<(AiSettings & { enabled: true }) | null> {
    const row = (await query('SELECT provider, base_url, encrypted_api_key, model, enabled FROM ai_settings WHERE user_id = $1', [familyId])).rows[0] as
        { provider: AiProvider; base_url: string | null; encrypted_api_key: string | null; model: string; enabled: boolean } | undefined;
    if (!row || !row.enabled || !row.model) return null;
    let apiKey: string | null = null;
    if (row.encrypted_api_key) { try { apiKey = decryptCredentials(row.encrypted_api_key).api_key ?? null; } catch { apiKey = null; } }
    return { provider: row.provider, base_url: row.base_url, api_key: apiKey, model: row.model, enabled: true };
}

/** What the settings screens may show about the provider: never the key or URL. */
export async function householdAiSummary(familyId: string): Promise<{ configured: boolean; provider: AiProvider | null; model: string | null }> {
    const row = (await query('SELECT provider, model, enabled FROM ai_settings WHERE user_id = $1', [familyId])).rows[0] as { provider: AiProvider; model: string; enabled: boolean } | undefined;
    return row && row.enabled && row.model ? { configured: true, provider: row.provider, model: row.model } : { configured: false, provider: null, model: null };
}
