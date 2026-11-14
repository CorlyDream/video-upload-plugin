import { describe, expect, it } from 'vitest';
import { RECENT_COLLECTION_STORAGE_KEY, RECENT_TAGS_STORAGE_KEY, readStoredCollection, readStoredTags, restoreCollection, restoreTags, writeStoredCollection, writeStoredTags } from '../src/core/tag-storage';

describe('recent tag storage', () => {
  it('reads the stored tag string', () => {
    const storage = { getItem: (key: string) => key === RECENT_TAGS_STORAGE_KEY ? '英语启蒙,亲子英语' : null };

    expect(readStoredTags(storage)).toBe('英语启蒙,亲子英语');
  });

  it('writes the tag string under the fixed key', () => {
    const writes: Array<[string, string]> = [];
    const storage = { setItem: (key: string, value: string) => writes.push([key, value]) };

    writeStoredTags('英语启蒙,亲子英语', storage);

    expect(writes).toEqual([[RECENT_TAGS_STORAGE_KEY, '英语启蒙,亲子英语']]);
  });

  it('returns an empty string when no tags are stored', () => {
    expect(readStoredTags({ getItem: () => null })).toBe('');
  });

  it('treats invalid stored tags as empty', () => {
    expect(readStoredTags({ getItem: () => '带 空格' })).toBe('');
  });

  it('ignores storage failures while reading and writing', () => {
    expect(readStoredTags({ getItem: () => { throw new Error('blocked'); } })).toBe('');
    expect(() => writeStoredTags('标签', { setItem: () => { throw new Error('blocked'); } })).not.toThrow();
  });

  it('uses stored tags only when the task has no publication', () => {
    expect(restoreTags(undefined, '历史标签,另一个标签')).toBe('历史标签,另一个标签');
    expect(restoreTags({ title: '标题', description: '', tags: ['任务标签'] }, '历史标签')).toBe('任务标签');
    expect(restoreTags({ title: '标题', description: '', tags: [] }, '历史标签')).toBe('');
    expect(restoreTags({ title: '', description: '', tags: [] }, '历史标签')).toBe('历史标签');
  });

  it('reads and writes the most recent collection name', () => {
    const values = new Map<string, string>([[RECENT_COLLECTION_STORAGE_KEY, '英语启蒙合集']]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(readStoredCollection(storage)).toBe('英语启蒙合集');
    writeStoredCollection('亲子英语合集', storage);
    expect(values.get(RECENT_COLLECTION_STORAGE_KEY)).toBe('亲子英语合集');
  });

  it('trims stored collection names and ignores storage failures', () => {
    expect(readStoredCollection({ getItem: () => '  英语启蒙合集  ' })).toBe('英语启蒙合集');
    expect(readStoredCollection({ getItem: () => '   ' })).toBe('');
    expect(readStoredCollection({ getItem: () => { throw new Error('blocked'); } })).toBe('');
    expect(() => writeStoredCollection('合集', { setItem: () => { throw new Error('blocked'); } })).not.toThrow();
  });

  it('uses stored collections only when the task has no publication', () => {
    expect(restoreCollection(undefined, '历史合集')).toBe('历史合集');
    expect(restoreCollection({ title: '标题', description: '', tags: [], collection: '任务合集' }, '历史合集')).toBe('任务合集');
    expect(restoreCollection({ title: '标题', description: '', tags: [] }, '历史合集')).toBe('');
    expect(restoreCollection({ title: '', description: '', tags: [] }, '历史合集')).toBe('历史合集');
  });
});
