import { describe, expect, it } from 'vitest';
import { flattenCovers, moveCover, removeCover, splitCovers } from '../src/core/cover-order';
import type { AssetMeta } from '../src/core/model';

const asset = (id: string): AssetMeta => ({ id, batchId: 'batch', name: `${id}.png`, size: 1, type: 'image/png', lastModified: 0, createdAt: 0 });

describe('cover ordering', () => {
  it('flattens and splits the main cover and PK covers', () => {
    const main = asset('main');
    const pk = [asset('pk-1'), asset('pk-2')];
    expect(flattenCovers(main, pk)).toEqual([main, ...pk]);
    expect(splitCovers([main, ...pk])).toEqual({ cover: main, pkCovers: pk });
  });

  it('moves a cover to the first position without mutating the input', () => {
    const items = [asset('main'), asset('pk-1'), asset('pk-2')];
    expect(moveCover(items, 2, 0).map(item => item.id)).toEqual(['pk-2', 'main', 'pk-1']);
    expect(items.map(item => item.id)).toEqual(['main', 'pk-1', 'pk-2']);
  });

  it('removes the first cover and leaves the next cover ready to become main', () => {
    const items = [asset('main'), asset('pk-1')];
    expect(splitCovers(removeCover(items, 0))).toEqual({ cover: items[1], pkCovers: [] });
  });

  it('handles empty, single-item and invalid moves safely', () => {
    expect(moveCover([], 0, 0)).toEqual([]);
    const one = [asset('one')];
    expect(moveCover(one, 0, 0)).toEqual(one);
    expect(moveCover(one, -1, 0)).toEqual(one);
    expect(removeCover(one, 4)).toEqual(one);
    expect(splitCovers([])).toEqual({ cover: undefined, pkCovers: [] });
  });
});
