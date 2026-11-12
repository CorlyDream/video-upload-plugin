# 封面缩略图预览与排序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在工作台中显示保持比例的紧凑封面缩略图，并支持拖拽、键盘移动和单张删除来决定主图顺序。

**Architecture:** 把 `[cover, ...pkCovers]` 展平为一个纯数据列表，使用纯函数完成移动、删除和重新拆分；React 工作台负责读取 Blob、创建和释放 object URL，并将排序结果写回现有状态。平台适配器继续读取现有 `cover` 与 `pkCovers` 字段。

**Tech Stack:** React 19、TypeScript、Vitest、IndexedDB assets API、原生 HTML Drag and Drop、CSS。

**Spec:** `docs/superpowers/specs/2026-11-12-cover-preview-sort-design.md`

## Global Constraints

- 最多 4 张封面，第一张为主图，其余为 PK 候选。
- 缩略图固定紧凑尺寸并使用 `object-fit: contain`，保持图片原始宽高比。
- 不引入排序依赖，不改变 IndexedDB 资产协议和平台适配器协议。
- 不自动发布或保存草稿。

## Review Focus

- 删除第一张后第二张必须成为主图；测试归入 Task 1。
- 移动到列表首位后必须成为主图；测试归入 Task 1。
- 空列表和单图片移动不得产生越界；测试归入 Task 1。
- Blob 读取失败或 URL 变化不能遗留旧 object URL；测试归入 Task 2。
- 图片比例不同（横图、竖图、透明 PNG）都必须留在卡片内且不拉伸；测试归入 Task 3 的浏览器/DOM 检查。

### Task 1: 封面顺序纯函数

**Files:**
- Create: `src/core/cover-order.ts`
- Test: `tests/cover-order.test.ts`

**Interfaces:**
- Produces `flattenCovers(cover, pkCovers): AssetMeta[]`、`splitCovers(items): { cover?: AssetMeta; pkCovers: AssetMeta[] }`、`moveCover(items, from, to): AssetMeta[]` 和 `removeCover(items, index): AssetMeta[]`。

- [ ] **Step 1: Write the failing tests**

  覆盖 `[主图, PK1, PK2]` 移动 PK2 到首位、删除首位后重拆分、空列表/单项边界，以及不修改原数组。

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `npx vitest run tests/cover-order.test.ts`

  Expected: FAIL because `src/core/cover-order.ts` does not exist.

- [ ] **Step 3: Implement the four pure functions**

  `moveCover` 和 `removeCover` 返回新数组；无效索引或相同索引返回浅拷贝；`splitCovers` 将首项拆成 `cover`，剩余项保持顺序。

- [ ] **Step 4: Run the focused test to verify it passes**

  Run: `npx vitest run tests/cover-order.test.ts`

  Expected: PASS。

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/cover-order.ts tests/cover-order.test.ts
  git commit -m "feat: add cover ordering helpers"
  ```

### Task 2: 预览组件与资源生命周期

**Files:**
- Create: `src/workbench/CoverPreviewList.tsx`
- Modify: `src/workbench/main.tsx`
- Test: `tests/cover-preview.test.tsx` (或项目现有 React 测试入口)

**Interfaces:**
- Consumes `items: AssetMeta[]`, `disabled: boolean`, `onChange(items: AssetMeta[]): void`。
- Produces紧凑缩略图列表，卡片包含主图/PK标记、文件名、删除按钮、上移/下移按钮和原生拖拽事件。

- [ ] **Step 1: Write the failing tests**

  测试渲染第一张“主图”和其余“PK”、点击删除/上移调用新顺序、拖拽放置调用新顺序；为资产读取提供真实 fake IndexedDB Blob。

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `npx vitest run tests/cover-preview.test.tsx`

  Expected: FAIL because the component is not defined and no preview exists。

- [ ] **Step 3: Implement `CoverPreviewList` and connect it**

  使用 `readAsset(item.batchId, item.id)` 读取 Blob，`URL.createObjectURL` 生成预览 URL；在 items 变化和卸载时撤销旧 URL。拖拽完成后通过 `moveCover` 计算顺序，按钮通过同一逻辑完成排序。读取失败时显示文件名和“预览不可用”，不阻塞删除或排序。

- [ ] **Step 4: Run the focused test to verify it passes**

  Run: `npx vitest run tests/cover-preview.test.tsx`

  Expected: PASS。

- [ ] **Step 5: Commit**

  ```bash
  git add src/workbench/CoverPreviewList.tsx src/workbench/main.tsx tests/cover-preview.test.tsx
  git commit -m "feat: preview and reorder cover images"
  ```

### Task 3: 紧凑比例样式与全量验证

**Files:**
- Modify: `src/workbench/style.css`
- Modify: `src/workbench/CoverPreviewList.tsx` (only if accessibility attributes need adjustment)

- [ ] **Step 1: Add failing DOM/style assertions**

  在现有浏览器测试或最小 DOM 检查中断言预览图片使用 `object-fit: contain`，卡片尺寸紧凑，并且拖拽/键盘按钮具备可操作标签。

- [ ] **Step 2: Run the focused check to verify it fails**

  Run: `npm run typecheck`

  Expected: FAIL until the new classes and component wiring are complete。

- [ ] **Step 3: Implement styles**

  增加 `cover-preview-list`、`cover-preview-card`、`cover-preview-image` 等局部样式；预览区使用固定小尺寸、浅色背景、`object-fit: contain`，横竖图都完整显示；保留 `:focus-visible` 和禁用态。

- [ ] **Step 4: Run the full verification**

  Run: `npm run typecheck && npm test && npm run build`

  Expected: all commands pass。

- [ ] **Step 5: Commit**

  ```bash
  git add src/workbench/style.css
  git commit -m "style: keep cover previews compact and proportional"
  ```
