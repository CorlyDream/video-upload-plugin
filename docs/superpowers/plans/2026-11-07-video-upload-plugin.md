# 视频上传填表助手 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. 执行任务时更新本文件及 execution.md；真站门槛未通过不能将后续里程碑标为完成。

**Goal:** 先证明纯 MV3 扩展跨源文件交接，再按设计交付五平台上传填表。
**Architecture:** React 工作台拥有串行执行与连接，Service Worker 校验身份和保存检查点，隔离世界 Content Script 操作文件控件。扩展 iframe 读取 IndexedDB，使用经认证的 MessageChannel 传 Blob。
**Tech Stack:** TypeScript、React、Vite、Vitest；Playwright 仅用于开发测试。
**Spec:** `docs/superpowers/specs/2026-11-07-video-upload-plugin-design.md`

## Global Constraints

- 不发布、不主动存草稿；不实现通用按钮点击或 Enter 提交。
- 普通扩展消息只传元数据；素材不经 JSON/base64 通道。
- 旧 batch/task/attempt/tab/document/step 消息无效；授权一次性、限时、限定素材和桥接 frame。
- 停止后不再写页面，关闭/刷新只恢复记录；不自动重试已交接文件。
- 真实平台上传须有指定素材和账号；页面接收文件不等于上传完成。
- M0 验证先于 M1/M2 完整 UI 和平台适配。未实测平台不能宣称支持。

## Files and interfaces

- `src/core/model.ts`: 平台、TaskBinding、Checkpoint、状态校验。
- `src/core/authorization.ts`: `authorizeClaim(grant, sender, now)` / `approveBridge` / `consumeGrant`，纯函数、拒绝旧文档和重复消费。
- `src/core/assets.ts`: `saveAsset(batchId, file)` / `readAsset(batchId, assetId)` / `deleteBatchAssets` / `purgeExpiredAssets`；事务完成后才返回。
- `src/extension/background.ts`: 串行小消息事件、唯一工作台、任务绑定、frame 握手与持久化。
- `src/extension/content.ts`: 仅唯一视频 input 的保守检查和一次交接；监听可信编辑/导航/连接断开。
- `src/extension/bridge.ts`: iframe 认证，校验 parent origin/source、一次性通道、读取授权素材。
- `src/workbench/`: 最小实验工作台，单视频、目标平台、串行任务、停止/查看/清理。
- `scripts/build.mjs`: 固定名 content/bridge/worker 文件，WAR 仅桥接静态文件。
- `tests/`: 单元测试 + 真实打包扩展的本地页面集成测试；不访问真实账号。

## Task 1: M0 模型、存储、授权与构建

- [x] 添加 npm/Vite/TS/Vitest 配置及锁文件。
- [ ] 先写测试：错误 tab/frame/document/origin、授权过期/重放、先审批后消费、跨批读取、24h 清理、事务失败不得留下素材。
- [ ] 运行 `npm test`，观察缺失行为；实现上述模型和授权存储接口。
- [x] `npm test && npm run typecheck` 通过。

## Task 2: M0 真实扩展文件交接

- [x] 添加 worker、content、bridge 和最小工作台。
- [ ] 先写浏览器测试：同一个素材依次交给两个目标源；内容摘要一致；输入赋值不能标成功；提交/存草稿计数必须为零。
- [ ] 补覆盖：重复开始、用户接管、关闭工作台、平台刷新、旧消息、已有内容/多输入歧义、素材清理。
- [x] `npm run build && npm run test:browser` 在独立 Chromium profile 实际加载 unpacked 扩展并通过。
- [ ] 20/100/500 MiB 桥接测试记录耗时、存储变化；测试夹具不等于真实平台视频处理。

## Task 3: M0 交付和真站门槛

- [x] README 写加载、操作、实验边界、验收方法；生成验证报告。
- [x] 独立代码审阅后修复重要问题，运行 `npm run check`（最后一轮浏览器夹具超时，带诊断复跑通过，见验证记录）。
- [ ] 用户指定素材和账号后：小红书+另一个平台同素材验证，再检查五站文件入口；记录浏览器版本、真实页面证据和资源释放。
- [ ] M0 真站通过后才启动 M1。

## Task 4: M1 小红书（依赖 Task 3 真站门槛）

- [ ] 根据真实页面观察确定登录/空编辑器/上传完成选择器和字段能力，保存脱敏 fixture。
- [ ] 文案共用与明确留空覆盖、单封面和字段回读；可信编辑立即接管。
- [ ] 测试真实完成证据、失败和超时、封面裁剪与话题歧义，人工项绝不误报填写成功。

## Task 5: M2 另外四个平台（依赖 M1）

- [ ] 依次适配抖音、B站、视频号、快手；每站先 fixture 再真站，无已验证能力则不启用。
- [ ] 一个视频至少两个站完整批次，单站受阻后继续，保留平台页面。

## Task 6: M3 恢复与兼容（依赖 M2）

- [ ] SW 终止重建、工作台关闭、刷新、登录失效、网络断开、重复启动及配额失败。
- [ ] Chrome/Edge 真扩展流程与 20/100/500 MiB 有效视频分级验证，按证据确定浏览器/容量支持范围。

## Review Focus

- 恶意宿主页复制桥接 URL，不得获得其他批次或绕过 top-document 审批。
- 消息在取消/刷新与文件交接之间竞争，不得继续写新页面。
- 全局 storage 写入并发不得覆盖授权消费和最终状态。
- Blob 写成功但元数据失败时，清理孤儿；清理失败不得虚报成功。
- 真实站点 CSP/控件与 fixture 不同，必须明确未验证，不得补猜选择器冒充验收。
