import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CoverPreviewList, coverRole } from '../src/workbench/CoverPreviewList';
import type { AssetMeta } from '../src/core/model';

it('labels the first preview as the main cover and later previews as PK', () => {
  expect(coverRole(0)).toBe('主图');
  expect(coverRole(1)).toBe('PK');
});

it('uses drag sorting and a compact corner remove action without arrow controls', () => {
  const item: AssetMeta = { id: 'cover', batchId: 'batch', name: 'cover.png', size: 1, type: 'image/png', lastModified: 0, createdAt: 0 };
  const html = renderToStaticMarkup(React.createElement(CoverPreviewList, { items: [item], onChange: () => undefined }));
  expect(html).toContain('draggable="true"');
  expect(html).toContain('aria-label="移除 cover.png"');
  expect(html).not.toContain('上移');
  expect(html).not.toContain('下移');
});
