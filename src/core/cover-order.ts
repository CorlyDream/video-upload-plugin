import type { AssetMeta } from './model';

export function flattenCovers(cover: AssetMeta | undefined, pkCovers: AssetMeta[] = []): AssetMeta[] {
  return cover ? [cover, ...pkCovers] : [];
}

export function coverPkEnabled(pkCovers: AssetMeta[]): boolean {
  return pkCovers.length > 0;
}

export function splitCovers(items: AssetMeta[]): { cover: AssetMeta | undefined; pkCovers: AssetMeta[] } {
  return { cover: items[0], pkCovers: items.slice(1) };
}

export function moveCover(items: AssetMeta[], from: number, to: number): AssetMeta[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function removeCover(items: AssetMeta[], index: number): AssetMeta[] {
  if (index < 0 || index >= items.length) return [...items];
  return items.filter((_, itemIndex) => itemIndex !== index);
}
