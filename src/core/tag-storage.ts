import { hasPublication, normalizePublication, parseTags, type Publication } from './publication';

export const RECENT_TAGS_STORAGE_KEY = 'video-upload-plugin.recent-tags';
export const RECENT_COLLECTION_STORAGE_KEY = 'video-upload-plugin.recent-collection';

export function restoreTags(publication: Publication | undefined, storedTags: string): string {
  if (!publication || !hasPublication(publication)) return storedTags;
  return publication.tags.join(',');
}

export function restoreCollection(publication: Publication | undefined, storedCollection: string): string {
  if (!publication || !hasPublication(publication)) return storedCollection;
  return publication.collection ?? '';
}

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readStoredTags(storage: ReadStorage | undefined = defaultStorage()): string {
  if (!storage) return '';
  try {
    const value = storage.getItem(RECENT_TAGS_STORAGE_KEY) ?? '';
    return normalizePublication({ tags: parseTags(value) }, false).tags.join(',');
  } catch {
    return '';
  }
}

export function writeStoredTags(value: string, storage: WriteStorage | undefined = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(RECENT_TAGS_STORAGE_KEY, value);
  } catch {
    // Browser storage may be disabled or full; persistence is best effort.
  }
}

export function readStoredCollection(storage: ReadStorage | undefined = defaultStorage()): string {
  if (!storage) return '';
  try {
    const value = storage.getItem(RECENT_COLLECTION_STORAGE_KEY) ?? '';
    return normalizePublication({ collection: value }, false).collection ?? '';
  } catch {
    return '';
  }
}

export function writeStoredCollection(value: string, storage: WriteStorage | undefined = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(RECENT_COLLECTION_STORAGE_KEY, value);
  } catch {
    // Browser storage may be disabled or full; persistence is best effort.
  }
}
