import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app, query, registerWithPassword } from '../helpers';
import pool, { runMigrations } from '../../src/db';
import { moonLitPath, moonPhase } from '../../src/services/familyhub/extras/astronomy';
import { aqiLevel, buildWeatherPanel, compass } from '../../src/services/familyhub/extras/weatherPanel';
import { normalizeStandings } from '../../src/services/familyhub/extras/formula1';
import { buildCountdown, escapeWifiValue, qrPath, wifiPayload, zonedTimeToUtc } from '../../src/services/familyhub/extras/wifiCountdown';
import { latestSlot } from '../../src/services/familyhub/extras/markets';
import { DEFAULT_EXTRAS, parseExtrasSettings } from '../../src/services/familyhub/extras/settings';
import type { AmbientWeather } from '../../src/services/familyhub/ambient';

// Fictional data throughout: names, networks and teams are made up.
const photoDir = mkdtempSync(path.join(os.tmpdir(), 'familyhub-photos-'));
process.env.FAMILYHUB_PHOTO_DIR = photoDir;

let owner: Awaited<ReturnType<typeof registerWithPassword>>;
const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const frameToken = async () => (await request(app).post('/api/familyhub/ambient/display-session').set(as(owner.token)).send({})).body.data.token as string;

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
    await query('TRUNCATE users, oidc_flows RESTART IDENTITY CASCADE');
    owner = await registerWithPassword('extras-owner@example.test', 'fictional-password-1', 'Fictional Owner');
});
afterAll(async () => { rmSync(photoDir, { recursive: true, force: true }); await pool.end(); });

describe('settings', () => {
    it('validates fields and keeps secrets out of every response', async () => {
        const saved = await request(app).put('/api/familyhub/dashboard/settings').set(as(owner.token)).send({
            weather: { forecastDays: 14, unit: 'fahrenheit' },
            wifi: { enabled: true, ssid: 'Fictional Guest', encryption: 'WPA' },
            markets: { enabled: true, stocks: 'abc, spy, xyz', crypto: ['btc'] },
            secrets: { wifiPassword: 'fictional-pass-123', finnhubKey: 'fictionalKey12345' },
        });
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        expect(saved.body.data.weather).toMatchObject({ forecastDays: 14, unit: 'fahrenheit' });
        expect(saved.body.data.markets.stocks).toEqual(['ABC', 'XYZ']);
        expect(saved.body.data.secrets).toEqual({ wifiPassword: true, finnhubKey: true, coingeckoKey: false });
        expect(JSON.stringify(saved.body)).not.toContain('fictional-pass-123');
        expect(JSON.stringify(saved.body)).not.toContain('fictionalKey12345');
        const stored = (await query('SELECT settings::text AS s, encrypted_secrets FROM familyhub_dashboard_extras')).rows[0];
        expect(stored.s).not.toContain('fictional-pass');
        expect(stored.encrypted_secrets).not.toContain('fictional-pass');
    });

    it('rejects invalid values', async () => {
        const bad = [
            { weather: { forecastDays: 10 } },
            { wifi: { enabled: true, ssid: '' } },
            { wifi: { enabled: true, ssid: 'Net', encryption: 'WPA' } },
            { countdown: { enabled: true, title: 'Trip', target: 'next week' } },
            { markets: { stocks: ['$$$'] } },
            { photos: { intervalSeconds: 2 } },
            { formula1: { season: '1900' } },
        ];
        for (const body of bad) {
            expect((await request(app).put('/api/familyhub/dashboard/settings').set(as(owner.token)).send(body)).status, JSON.stringify(body)).toBe(400);
        }
    });

    it('is for parents only; a frame cannot read or change it', async () => {
        const frame = await frameToken();
        expect((await request(app).get('/api/familyhub/dashboard/settings').set(as(frame))).status).toBe(403);
        expect((await request(app).put('/api/familyhub/dashboard/settings').set(as(frame)).send({})).status).toBe(403);
    });

    it('parses partial documents onto the stored ones', () => {
        const next = parseExtrasSettings({ photos: { enabled: true } }, DEFAULT_EXTRAS);
        expect(next.photos).toEqual({ enabled: true, intervalSeconds: 12 });
        expect(next.weather).toEqual(DEFAULT_EXTRAS.weather);
    });
});

describe('snapshot', () => {
    it('carries the Wi-Fi QR code and countdown to the frame, never the market keys', async () => {
        await request(app).put('/api/familyhub/dashboard/settings').set(as(owner.token)).send({
            wifi: { enabled: true, ssid: 'Fictional Guest', encryption: 'WPA' },
            countdown: { enabled: true, title: 'Fictional trip', target: '2030-01-15T07:00', checklist: [{ text: 'Pack', done: true }, 'Passports'] },
            secrets: { wifiPassword: 'fictional-pass-123', finnhubKey: 'fictionalKey12345' },
        }).expect(200);
        const frame = await frameToken();
        const snapshot = await request(app).get('/api/familyhub/ambient').set(as(frame));
        expect(snapshot.status).toBe(200);
        const extras = snapshot.body.data.extras;
        expect(extras.wifi).toMatchObject({ ssid: 'Fictional Guest', password: 'fictional-pass-123', security: 'WPA/WPA2' });
        expect(extras.wifi.qr.size).toBeGreaterThan(20);
        expect(extras.wifi.qr.path).toMatch(/^M\d/);
        expect(extras.countdown).toMatchObject({ title: 'Fictional trip', checklist: [{ text: 'Pack', done: true }, { text: 'Passports', done: false }] });
        expect(JSON.stringify(snapshot.body)).not.toContain('fictionalKey12345');
    });
});

const jpeg = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } } }).jpeg().toBuffer();

describe('photos', () => {
    it('scales uploads to the frame, serves them to the frame, and deletes them', async () => {
        const upload = await request(app).post('/api/familyhub/photos').set(as(owner.token)).set('Content-Type', 'image/jpeg').send(await jpeg(4000, 3000));
        expect(upload.status, JSON.stringify(upload.body)).toBe(201);
        expect(upload.body.data).toMatchObject({ width: 1067, height: 800 });
        const id = upload.body.data.id as string;

        await request(app).put('/api/familyhub/dashboard/settings').set(as(owner.token)).send({ photos: { enabled: true, intervalSeconds: 10 } }).expect(200);
        const frame = await frameToken();
        const snapshot = await request(app).get('/api/familyhub/ambient').set(as(frame));
        expect(snapshot.body.data.extras.photos).toEqual({ intervalSeconds: 10, ids: [id] });

        const served = await request(app).get(`/api/familyhub/ambient/photos/${id}`).set(as(frame));
        expect(served.status).toBe(200);
        expect(served.headers['content-type']).toBe('image/jpeg');
        const meta = await sharp(served.body as Buffer).metadata();
        expect([meta.width, meta.height]).toEqual([1067, 800]);

        // The frame is read-only: no uploads, deletions or thumbnails.
        expect((await request(app).post('/api/familyhub/photos').set(as(frame)).set('Content-Type', 'image/jpeg').send(await jpeg(10, 10))).status).toBe(403);
        expect((await request(app).delete(`/api/familyhub/photos/${id}`).set(as(frame))).status).toBe(403);

        // Another family cannot read it.
        const other = await registerWithPassword('extras-other@example.test', 'fictional-password-1', 'Other Owner');
        expect((await request(app).get(`/api/familyhub/ambient/photos/${id}`).set(as(other.token))).status).toBe(404);

        expect((await request(app).get(`/api/familyhub/photos/${id}/thumb`).set(as(owner.token))).status).toBe(200);
        expect((await request(app).delete(`/api/familyhub/photos/${id}`).set(as(owner.token))).status).toBe(200);
        expect((await request(app).get(`/api/familyhub/ambient/photos/${id}`).set(as(frame))).status).toBe(404);
    });

    it('rejects files that are not images', async () => {
        const upload = await request(app).post('/api/familyhub/photos').set(as(owner.token)).set('Content-Type', 'image/jpeg').send(Buffer.from('not an image'));
        expect(upload.status).toBe(400);
        expect((await query('SELECT count(*)::int AS n FROM familyhub_photos')).rows[0].n).toBe(0);
    });

    it('a frame token cannot reach other photo paths', async () => {
        const frame = await frameToken();
        expect((await request(app).get('/api/familyhub/photos').set(as(frame))).status).toBe(403);
        expect((await request(app).get('/api/familyhub/ambient/photos/../photos').set(as(frame))).status).not.toBe(200);
    });
});

describe('computed on the Pi', () => {
    it('Wi-Fi payload escapes reserved characters', () => {
        expect(escapeWifiValue('a;b,c:d"e\\f')).toBe('a\\;b\\,c\\:d\\"e\\\\f');
        expect(wifiPayload('Guest;Net', 'WPA', 'p:ss', true)).toBe('WIFI:T:WPA;S:Guest\\;Net;P:p\\:ss;H:true;;');
        expect(wifiPayload('Open Net', 'nopass', '', false)).toBe('WIFI:T:nopass;S:Open Net;;');
        expect(qrPath('WIFI:T:nopass;S:x;;').path).toContain('h');
    });

    it('countdown converts the household wall clock across daylight saving', () => {
        expect(zonedTimeToUtc('2026-11-16T07:00', 'America/New_York')?.toISOString()).toBe('2026-11-16T12:00:00.000Z');
        expect(zonedTimeToUtc('2026-07-01T07:00', 'America/New_York')?.toISOString()).toBe('2026-07-01T11:00:00.000Z');
        const countdown = buildCountdown({ enabled: true, title: 'Trip', target: '2026-11-16T07:00', checklist: [] }, 'America/New_York', new Date('2026-11-02T02:00:00Z'));
        expect(countdown?.daysLeft).toBe(14);
    });

    it('moon phase and lit path', () => {
        const full = moonPhase(new Date('2026-01-03T10:03:00Z'));
        expect(full.illumination).toBeGreaterThan(0.97);
        const newMoon = moonPhase(new Date('2026-01-18T19:52:00Z'));
        expect(newMoon.illumination).toBeLessThan(0.03);
        expect(moonLitPath(0, true)).toBe('');
        expect(moonLitPath(0.25, true)).toBe('M 24 4 A 20 20 0 0 1 24 44 A 10 20 0 0 0 24 4 Z');
        expect(moonLitPath(0.75, false)).toBe('M 24 4 A 20 20 0 0 0 24 44 A 10 20 0 0 0 24 4 Z');
    });

    it('weather panel: AQI levels, compass, bar positions, forecast length', () => {
        expect(aqiLevel(24)).toEqual({ level: 'Good', tone: 'good' });
        expect(aqiLevel(120).tone).toBe('sensitive');
        expect(compass(315)).toBe('NW');
        const days = Array.from({ length: 16 }, (_, i) => ({ date: `2026-11-${String(i + 3).padStart(2, '0')}`, weatherCode: 3, high: 10 + (i % 3), low: 2 + (i % 2), precipitation: 20 }));
        const weather: AmbientWeather = { temperature: 7.4, weatherCode: 2, high: 9, low: 2, timezone: 'America/New_York', fetchedAt: '', unit: 'celsius',
            details: { apparent: 5, humidity: 68, windSpeed: 14, windDirection: 315, gusts: 22, isDay: true, sunrise: '2026-11-02T06:42', sunset: '2026-11-02T17:04', days } };
        const panel = buildWeatherPanel(weather, null, { forecastDays: 7, unit: 'celsius', showAqi: true, showMoon: false }, new Date('2026-11-02T17:00:00Z'))!;
        expect(panel.days).toHaveLength(7);
        expect(panel.current).toMatchObject({ temperature: 7, windCompass: 'NW' });
        expect(panel.sun?.daylight).toBe('10 h 22 min');
        expect(panel.sun?.isUp).toBe(true);
        expect(panel.moon).toBeNull();
        for (const day of panel.days) expect(day.barLeft + day.barWidth).toBeLessThanOrEqual(104);
    });

    it('standings: colours, gaps and favourites', () => {
        const drivers = { MRData: { StandingsTable: { StandingsLists: [{ season: '2026', round: '20', DriverStandings: [
            { position: '1', points: '300', wins: '7', Driver: { driverId: 'fic_one', permanentNumber: '7', code: 'ONE', givenName: 'Fictional', familyName: 'One' }, Constructors: [{ constructorId: 'mclaren', name: 'McLaren' }] },
            { position: '2', points: '280', wins: '5', Driver: { driverId: 'fic_two', permanentNumber: '16', code: 'TWO', givenName: 'Fictional', familyName: 'Two' }, Constructors: [{ constructorId: 'ferrari', name: 'Ferrari' }] },
        ] }] } } };
        const constructors = { MRData: { StandingsTable: { StandingsLists: [{ ConstructorStandings: [
            { position: '1', points: '550', wins: '10', Constructor: { constructorId: 'mclaren', name: 'McLaren' } },
            { position: '2', points: '500', wins: '6', Constructor: { constructorId: 'ferrari', name: 'Ferrari' } },
        ] }] } } };
        const result = normalizeStandings(drivers, constructors, { team: 'ferrari', driver: '' });
        expect(result.drivers[1]).toMatchObject({ name: 'Fictional Two', number: '16', colour: '#E8002D', wins: 5, favorite: true });
        expect(result.constructors[1]).toMatchObject({ gap: 50, favorite: true });
    });

    it('markets fetch at the open, mid-day and the close only', () => {
        // Thursday, November 5, 2026; New York is UTC-5.
        expect(latestSlot(new Date('2026-11-05T14:00:00Z'))).toBe('2026-11-04 0965'); // 9:00: still Wednesday's close
        expect(latestSlot(new Date('2026-11-05T14:40:00Z'))).toBe('2026-11-05 0575'); // 9:40: the open
        expect(latestSlot(new Date('2026-11-05T18:00:00Z'))).toBe('2026-11-05 0750'); // 13:00: mid-day
        expect(latestSlot(new Date('2026-11-07T18:00:00Z'))).toBe('2026-11-06 0965'); // Saturday: Friday's close
    });
});
