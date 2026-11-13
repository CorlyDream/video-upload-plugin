# 重新操作覆盖历史记录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“保留素材重新打开”原地更新平台历史任务，避免同一平台的重试在右侧列表新增记录。

**Architecture:** 保留现有 `Task.taskId` 作为历史条目标识；重试创建新标签页后直接重置并更新现有任务对象的运行字段，生成新的 `attemptId`，再走现有 `launch` 流程。平台、批次、素材、文案和封面选择继续来自原任务或当前批次。

**Tech Stack:** TypeScript、Chrome MV3 service worker、Vitest worker lifecycle harness。

**Spec:** `docs/superpowers/specs/2026-11-13-retry-overwrite-design.md`

## Global Constraints

- 重试后 `batch.tasks` 对该平台仍只有一条记录。
- 重试保留原任务 `taskId`，并生成新的 `attemptId`。
- 原标签页仍打开时拒绝重试，不自动发布或保存草稿。
- 保留现有视频、文案、主封面和 PK 封面选择。
- 不改变素材缓存、平台适配器或桥接授权协议。

## Review Focus

- 已完成任务重试后列表长度仍为 1，且历史条目 `taskId` 不变；回归测试归入 Task 1。
- 重试必须生成新的 `attemptId` 并重置旧的文档、步骤和状态字段；回归测试归入 Task 1。
- 重试必须继续沿用快手已选封面，不能重新抽选；现有测试继续覆盖该约束。
- 原平台标签页仍存在时，重试仍被拒绝；现有生命周期规则继续覆盖该约束。
- 持久化或启动前检查失败时，不能追加一个半初始化任务；现有 worker 错误路径继续覆盖该约束。

### Task 1: 原地重置并重试现有任务

**Files:**
- Modify: `src/extension/background.ts:187-280`
- Modify: `tests/background.test.ts:171-185`

**Interfaces:**
- Consumes: existing `Task`, `Batch`, `retry` command, tab creation and `launch` lifecycle.
- Produces: an existing task object whose `taskId` is stable, whose `attemptId` is new, and whose runtime fields are reset before `launch`.

- [ ] **Step 1: Extend the existing retry test with the required failing assertions**

  In `selects one cover per ratio for Kuaishou and retains the selection on retry`, save the original `taskId` and `attemptId`, then assert after retry that `batch.tasks` has length 1, `taskId` is unchanged, and `attemptId` differs. Keep the existing cover assertions.

- [ ] **Step 2: Run the focused test and verify it fails for duplicate history**

  Run: `npx vitest run tests/background.test.ts -t "selects one cover per ratio for Kuaishou"`

  Expected: FAIL because the current retry appends a second task and the latest task has a different `taskId`.

- [ ] **Step 3: Implement the minimal in-place retry update**

  In the shared `start`/`retry` branch, retain the existing task reference for retries. After creating the new tab and validating its id, update that object in place instead of constructing and pushing a new task. Preserve `taskId`, platform, batch/material/publication/cover semantics, and assign a fresh `attemptId`; reset `tabId`, `documentId`, `step`, `pipelineStage`, `status`, `reason`, `diagnosticPhase`, `videoAlreadyTransferred`, `uploadTabId`, `coverAssetId`, `pkCoverAssetIds`, and `coverPk` from the newly resolved retry inputs. Keep the existing initial-navigation guard and persistence failure handling, then call `launch` with the same object.

- [ ] **Step 4: Run the focused test and verify it passes**

  Run: `npx vitest run tests/background.test.ts -t "selects one cover per ratio for Kuaishou"`

  Expected: PASS, with one task, stable `taskId`, new `attemptId`, and unchanged selected covers.

- [ ] **Step 5: Run the complete repository verification**

  Run: `npm run typecheck && npm test && npm run build && npm run test:browser && npm run test:feedback && npm run test:kuaishou && npm run test:douyin && npm run test:downloads && npm run test:weixin && npm run test:bilibili`

  Expected: all commands exit 0; report any existing browser-fixture limitation separately from local unit/build results.

- [ ] **Step 6: Review the diff and commit the implementation**

  Run: `git diff --check` and `git status --short`; stage only `src/extension/background.ts`, `tests/background.test.ts`, and this implementation plan, then commit with `feat: overwrite task on retry`.
