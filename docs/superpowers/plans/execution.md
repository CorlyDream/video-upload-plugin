# Execution ledger

Plan: 2026-11-07-video-upload-plugin.md
Base: 8e6eb7c

- Ruling: 用户要求实施现有设计，视为设计确认；直接编写并执行计划，不重复询问设计审批。
- Ruling: 当前仓库仅文档且干净，在当前目录创建 feat/upload-bridge-m0 分支，便于用户直接检查产物；不额外创建 worktree。
- Ruling: M0 是先决验收门槛。未提供真实素材/账号前只完成可运行实验及本地证据，不以猜测的五站选择器替代实测。
- Pre-flight: Task 1 的绑定/授权类型由 Task 2 消费；Task 2 的夹具不构成 Task 3 真站证据。

- Task 1: 21 个单元测试通过，TypeScript 通过；首轮测试命令早于依赖安装完成，实际得到 vitest not found，未取得功能 RED 基线，不能声称完整遵循 TDD。
- Task 2: M0 源码与打包已生成；真实扩展集成测试已编写，首次执行缺少对应 Playwright Chromium，正在下载官方测试浏览器。
- 用户确认素材：10,571,835 字节 merged.mp4，现有 Chrome 小红书已登录；只授权上传验证，不发布/存草稿。
- 实机入口：Computer Use 能发现 Chrome 进程但 getApp 返回 cgWindowNotFound，已请用户打开当前桌面的 Chrome 窗口。未读取或复制 Profile/cookie。

- Task 2: 本地真实 unpacked 扩展两源交接成功；发布/存草稿 0 次；保护原稿、可信编辑接管、平台刷新/工作台重开暂停、清理通过。
- Review: 独立 reviewer 找到 2 个 Important lifecycle race，新增 tests/background.test.ts，在当前会话观察 2 条 RED 后修复，24 条 GREEN。
- Ruling: Playwright context.route 不保证拦住扩展新建标签页的首请求，首轮测试曾加载公开平台页面（临时空 Profile，无账号、无素材上传）；改用浏览器 DNS 映射到本机 TLS fixture 并禁止其余域名解析。后续集成完全本地。
- 20/100/500 MiB 合成字节传输和全量 SHA-256 校验通过；不是有效视频/真站证据。storage estimate 清理后未立即下降，不宣称物理空间即时释放。
- 实机门槛：已看到登录的小红书上传页面；浏览器 UI 工具要求未上架本地软件安装时确认，已请求加载 dist 和小红书 host 授权。
- Final local verification: 25 tests, TypeScript, build and real unpacked extension browser suite. Third lifecycle regression covers split URL/loading events before same-URL refresh. IndexedDB record count is explicitly zero after cleanup.
- 当前未执行 Chrome 开发者模式/本地扩展安装，等待 UI 工具要求的安装确认。未提交、未推送；完整第一版未完成，M0 真站门槛仍开放。
- Correction to final local verification: final combined check had one browser fixture page-load timeout; 25 unit/type/build passed. DEBUG_FIXTURE=1 npm run test:browser rerun passed all cases. Transient failure retained in verification report, not represented as a wholly green final combined command.

- 后续授权：用户明确允许在当前 Chrome 加载 dist、授予小红书权限并上传指定视频，无需重复征求这些授权。
- 实机安装尝试：已通过 Chrome UI 到达“选择扩展程序目录”并定位 dist；确认按钮持续 disabled，辅助功能树与界面状态不一致。重新定位/键盘/激活窗口后工具先后返回 noWindowsAvailable、elementHasNoFrame、cgWindowNotFound。尚无扩展安装成功证据，未选择视频、未向平台上传。请求用户手工完成加载后继续验证；这属于 UI 控制阻塞，不是授权不足。

- 用户报告已加载后，通过 UI 确认扩展 ID iedmmemoaiekahldcfjkcobhlpilaffi，工作台显示连接已断开。刷新后选择文件按钮恢复，随后再次断连。尚未选择素材或上传。
- 独立 Chromium 35 秒 idle 测试通过，不能声称稳定复现真实 Chrome 断连原因。为打开的工作台补充 15 秒 liveness 消息，关闭/断连清除计时器；不自动重连、不恢复任务，持久化与失联停止语义保留。26 个单元测试通过。
- 当前 Chrome UI 再次返回 cgWindowNotFound，无法点击扩展重新加载；新构建 dist 尚未在当前 Chrome 核验。
- 自动测试获得加载超时证据：任务 tab status=unloaded（无 URL），改为创建 active 平台标签页。随后 npm run check 全绿：26 unit + typecheck + build + browser integration。
- Chrome 再次连续 cgWindowNotFound，需用户刷新已安装扩展并将工作台保持在当前桌面；尚未真实上传。

- 用户截图：35.0 MiB merged.mp4 已缓存，小红书在初始加载时显示“平台页面在加载期间刷新”。此前以重复 tabs.onUpdated loading 判定刷新，存在误报；不能仅凭截图断言实际导航次数。
- 新增回归：同一实际导航收到多条 loading 状态，旧代码拒绝 run（RED）；改为 webNavigation.onBeforeNavigate 区分主页面新导航，tabs 状态只提供加载/URL信息，27 单元测试 GREEN。新增 webNavigation manifest 权限，只处理活动任务 tab/frame=0，不记录历史。重定向仍保守停止，不自动重复上传。
