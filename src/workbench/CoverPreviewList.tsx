import React, { useEffect, useState } from 'react';
import type { AssetMeta } from '../core/model';
import { readAsset } from '../core/assets';
import { moveCover, removeCover } from '../core/cover-order';

export function coverRole(index: number): string {
  return index === 0 ? '主图' : 'PK';
}

interface CoverPreviewListProps {
  items: AssetMeta[];
  disabled?: boolean;
  onChange: (items: AssetMeta[]) => void;
}

export function CoverPreviewList({ items, disabled = false, onChange }: CoverPreviewListProps) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [dragIndex, setDragIndex] = useState<number>();

  useEffect(() => {
    let active = true;
    const created: string[] = [];
    setUrls({});
    setFailed({});
    void Promise.all(items.map(async item => {
      try {
        const asset = await readAsset(item.batchId, item.id);
        const url = URL.createObjectURL(asset.blob);
        created.push(url);
        return [item.id, url] as const;
      } catch {
        return [item.id, ''] as const;
      }
    })).then(entries => {
      if (!active) {
        created.forEach(url => URL.revokeObjectURL(url));
        return;
      }
      setUrls(Object.fromEntries(entries.filter(([, url]) => url)));
      setFailed(Object.fromEntries(entries.filter(([, url]) => !url).map(([id]) => [id, true])));
    });
    return () => {
      active = false;
      created.forEach(url => URL.revokeObjectURL(url));
    };
  }, [items]);

  return <div className="cover-preview-list" aria-label="封面预览列表">
    {items.map((item, index) => {
      return <article
        className={`cover-preview-card${dragIndex === index ? ' is-dragging' : ''}`}
        key={item.id}
        draggable={!disabled}
        onDragStart={event => { if (disabled) return; setDragIndex(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); }}
        onDragEnd={() => setDragIndex(undefined)}
        onDragOver={event => { if (!disabled) event.preventDefault(); }}
        onDrop={event => { event.preventDefault(); if (disabled) return; const from = Number(event.dataTransfer.getData('text/plain')); if (Number.isInteger(from)) onChange(moveCover(items, from, index)); setDragIndex(undefined); }}
      >
        <div className="cover-preview-image-wrap">
          {urls[item.id] ? <img className="cover-preview-image" src={urls[item.id]} alt={`${coverRole(index)}：${item.name}`} onError={() => { setFailed(current => ({ ...current, [item.id]: true })); setUrls(current => { const next = { ...current }; delete next[item.id]; return next; }); }} /> : <span className="cover-preview-placeholder" aria-hidden="true">{failed[item.id] ? '预览不可用' : '读取中…'}</span>}
        </div>
        <div className="cover-preview-meta"><strong>{coverRole(index)}</strong><span title={item.name}>{item.name}</span></div>
        <button className="cover-preview-remove" type="button" aria-label={`移除 ${item.name}`} title="移除封面" disabled={disabled} onClick={() => onChange(removeCover(items, index))}>×</button>
      </article>;
    })}
  </div>;
}
