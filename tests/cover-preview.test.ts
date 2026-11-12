import { expect, it } from 'vitest';
import { coverRole } from '../src/workbench/CoverPreviewList';

it('labels the first preview as the main cover and later previews as PK', () => {
  expect(coverRole(0)).toBe('主图');
  expect(coverRole(1)).toBe('PK');
});
