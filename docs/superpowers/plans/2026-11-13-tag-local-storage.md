# 标签 Local Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在工作台空任务时恢复最近标签，并在开始文件交接验证时保存最近一次有效标签。

**Architecture:** 新增一个可注入 `Storage` 的纯标签存储助手，固定键名并吞掉浏览器存储异常。工作台只在没有任务文案时读取；开始按钮完成现有规范化和校验后写入规范化标签字符串。

**Tech Stack:** TypeScript, React 19, Vitest, browser `localStorage`.

**Spec:** `docs/superpowers/specs/2026-11-13-tag-local-storage-design.md`

## Global Constraints

- 只保存标签，不保存标题、正文、封面或平台选择。
- 使用工作台页面的 `localStorage`，不改变后台 `chrome.storage.local` 任务状态。
- 当前工作台不点击平台的真实“发布”按钮；保存时机是点击“开始文件交接验证”。
- 存储失败按没有历史标签处理，不阻断交接。
- 已有任务文案优先使用任务中保存的标签；只有空任务文案才回填历史标签。

## Review Focus

- 首次快照没有任务时应恢复历史标签；由快照标签选择规则测试覆盖，工作台接线按同一规则实现。
- 选择视频产生没有文案的新批次时不能清空已恢复标签；由空 publication 规则测试覆盖。
- 已有任务标签应覆盖历史标签；由已有 publication 规则测试覆盖。
- `localStorage` 被禁用或抛错时页面仍可继续；由存储助手异常测试覆盖。
- 点击开始时只保存规范化且通过校验的标签；由存储助手格式和工作台调用测试覆盖。

### Task 1: 标签存储助手

**Files:**
- Create: `src/core/tag-storage.ts`
- Test: `tests/tag-storage.test.ts`

**Interfaces:**
- Produces `RECENT_TAGS_STORAGE_KEY: string`.
- Produces `readStoredTags(storage?: Pick<Storage, 'getItem'>): string`.
- Produces `writeStoredTags(value: string, storage?: Pick<Storage, 'setItem'>): void`.

- [ ] **Step 1: Write failing tests**

  Add tests proving a stored string is read, writing uses the fixed key, empty/missing values return `''`, and get/set exceptions are swallowed.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npx vitest run tests/tag-storage.test.ts`
  Expected: FAIL because `src/core/tag-storage.ts` does not exist.

- [ ] **Step 3: Implement the minimal helper**

  Use the fixed key `video-upload-plugin.recent-tags`; default to `window.localStorage` only when available, and return/perform a no-op on storage errors.

- [ ] **Step 4: Run the focused test and verify it passes**

  Run: `npx vitest run tests/tag-storage.test.ts`
  Expected: PASS.

### Task 2: Workbench restore and save integration

**Files:**
- Modify: `src/workbench/main.tsx`
- Test: `tests/tag-storage.test.ts` (extend pure integration decision tests if needed)

**Interfaces:**
- Consumes `readStoredTags` and `writeStoredTags` from `src/core/tag-storage.ts`.
- Keeps existing `parseTags` and publication validation as the source of truth.

- [ ] **Step 1: Add a failing behavior test for empty-task selection**

  Pin that an empty snapshot selects stored tags, while a snapshot with publication tags keeps task tags. Keep this decision as a small exported/pure helper if direct React rendering is not available in the repository.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npx vitest run tests/tag-storage.test.ts`
  Expected: FAIL on the missing empty-task selection behavior.

- [ ] **Step 3: Implement restore and save**

  Import the helper in `main.tsx`. In `update`, when the snapshot has no publication tags, use `readStoredTags()`; when task publication exists, use its comma-joined tags. In `start`, after all existing publication validation succeeds and before permission request, call `writeStoredTags(publication.tags.join(','))`. Do not throw if storage fails.

- [ ] **Step 4: Run focused and existing publication tests**

  Run: `npx vitest run tests/tag-storage.test.ts tests/publication.test.ts`
  Expected: PASS.

### Task 3: Full verification

**Files:**
- No additional files.

- [ ] **Step 1: Run type checking**

  Run: `npm run typecheck`
  Expected: PASS with no TypeScript errors.

- [ ] **Step 2: Run the complete unit suite**

  Run: `npm test`
  Expected: PASS; report any pre-existing failure by test name.

- [ ] **Step 3: Build the extension**

  Run: `npm run build`
  Expected: PASS and produce the normal extension build output.
