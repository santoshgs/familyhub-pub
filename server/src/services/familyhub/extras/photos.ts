import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { query } from '../../../db';

/**
 * Photos for the frame's slideshow, uploaded from a phone in Settings.
 *
 * The Pi does all the image work: each upload is decoded once, turned upright
 * from its EXIF orientation, scaled to fit the frame's 1280 × 800 screen,
 * re-encoded as JPEG without metadata (no location or camera details are kept)
 * and stored next to a small thumbnail for the management page. The frame only
 * ever downloads one pre-scaled JPEG at a time.
 */

export const FRAME_WIDTH = 1280;
export const FRAME_HEIGHT = 800;
export const MAX_PHOTOS = 200;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 200;

export class PhotoError extends Error {
    constructor(message: string, readonly status = 400) { super(message); }
}

/** Where photos are kept: the persistent uploads volume in Docker, ./uploads in development. */
export const photoRoot = () => path.resolve(process.env.FAMILYHUB_PHOTO_DIR || path.join(process.env.UPLOADS_DIR || (process.env.NODE_ENV === 'production' ? '/app/uploads' : 'uploads'), 'familyhub-photos'));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Paths are built only from validated UUIDs, never from client text. */
const fileFor = (familyId: string, photoId: string, variant: 'full' | 'thumb') => {
    if (!UUID.test(familyId) || !UUID.test(photoId)) throw new PhotoError('Invalid photo.', 404);
    return path.join(photoRoot(), familyId.toLowerCase(), `${photoId.toLowerCase()}${variant === 'thumb' ? '-thumb' : ''}.jpg`);
};

export interface PhotoRow { id: string; width: number; height: number; bytes: number; createdAt: string }

export async function listPhotos(familyId: string): Promise<PhotoRow[]> {
    const result = await query(`SELECT id, width, height, bytes, created_at FROM familyhub_photos WHERE family_id = $1 ORDER BY created_at DESC, id`, [familyId]);
    return result.rows.map((row: Record<string, unknown>) => ({ id: String(row.id), width: Number(row.width), height: Number(row.height), bytes: Number(row.bytes),
        createdAt: new Date(String(row.created_at)).toISOString() }));
}

export async function addPhoto(familyId: string, uploadedBy: string | undefined, input: Buffer): Promise<PhotoRow> {
    if (!input.length) throw new PhotoError('Choose a photo to upload.');
    if (input.length > MAX_UPLOAD_BYTES) throw new PhotoError('That photo is larger than 25 MB.', 413);
    const count = await query('SELECT count(*)::int AS n FROM familyhub_photos WHERE family_id = $1', [familyId]);
    if (Number(count.rows[0]?.n) >= MAX_PHOTOS) throw new PhotoError(`The slideshow holds up to ${MAX_PHOTOS} photos. Delete some first.`, 409);

    let full: { data: Buffer; info: { width: number; height: number } };
    let thumb: Buffer;
    try {
        // limitInputPixels guards against decompression bombs (here ~80 MP).
        const source = sharp(input, { limitInputPixels: 80_000_000, failOn: 'error' }).rotate();
        full = await source.clone().resize(FRAME_WIDTH, FRAME_HEIGHT, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
        thumb = await source.clone().resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover' }).jpeg({ quality: 72 }).toBuffer();
    } catch {
        throw new PhotoError('That file is not a photo this server can read (JPEG, PNG, WebP or GIF).');
    }

    const id = randomUUID();
    await mkdir(path.dirname(fileFor(familyId, id, 'full')), { recursive: true, mode: 0o750 });
    await writeFile(fileFor(familyId, id, 'full'), full.data, { mode: 0o640 });
    await writeFile(fileFor(familyId, id, 'thumb'), thumb, { mode: 0o640 });
    try {
        const result = await query(`INSERT INTO familyhub_photos (id, family_id, uploaded_by, width, height, bytes)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING created_at`, [id, familyId, uploadedBy ?? null, full.info.width, full.info.height, full.data.length]);
        return { id, width: full.info.width, height: full.info.height, bytes: full.data.length, createdAt: new Date(String(result.rows[0].created_at)).toISOString() };
    } catch (error) {
        await removeFiles(familyId, id);
        throw error;
    }
}

const removeFiles = async (familyId: string, id: string) => {
    await rm(fileFor(familyId, id, 'full'), { force: true });
    await rm(fileFor(familyId, id, 'thumb'), { force: true });
};

export async function deletePhoto(familyId: string, id: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const result = await query('DELETE FROM familyhub_photos WHERE id = $1 AND family_id = $2 RETURNING id', [id, familyId]);
    if (!result.rows.length) return false;
    await removeFiles(familyId, id);
    return true;
}

/** The JPEG bytes of one of the family's photos, or null when it is not theirs. */
export async function readPhoto(familyId: string, id: string, variant: 'full' | 'thumb'): Promise<Buffer | null> {
    if (!UUID.test(id)) return null;
    const owned = await query('SELECT 1 FROM familyhub_photos WHERE id = $1 AND family_id = $2', [id, familyId]);
    if (!owned.rows.length) return null;
    const file = fileFor(familyId, id, variant);
    try {
        if (!(await stat(file)).isFile()) return null;
        return await readFile(file);
    } catch {
        return null;
    }
}
