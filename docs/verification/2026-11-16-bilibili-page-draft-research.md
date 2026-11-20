# Bilibili 当前投稿页上传并存草稿研究

日期：2026-11-16（Asia/Shanghai）。范围：研究与已有现场证据复核；没有修改应用代码、构建、部署或新增账号操作。

本文记录改造前的研究状态与代码位置；后续实现和真实扩展结果见 [页面草稿改造与验证](2026-11-16-bilibili-page-draft-implementation.md)。

## 结论与纠正

- **当前页面可以上传视频后点击“存草稿”，留在草稿箱而不走投稿提交流程。** 本次单样本已通过列表、详情及重开编辑页确认持久化。
- 官方页面区分 `submitDraft` 与 `submitArchive`：前者使用 `/x/vupre/web/draft/add`，后者使用 `/x/vu/web/add/v3`。
- **纠正此前记忆/运行记录：“`/x/vu/web/add/v3` 创建未发布草稿”是错误结论。该接口是投稿提交接口，不可作为草稿保存或失败回退接口。**
- 当前现场回读：`BV1X5sA6oENq`、`BV1vZsE6kERS` 均为 `state: 0`、`state_desc: 开放浏览`，不能再称作未投稿草稿。
- 页面路线已证实可行；当前 MV3 插件能否复用同一文件选择流程仍未解决，不能据此宣称插件已经支持安全存草稿。

## 证据来源与复核方法

- 一手页面脚本：[index.912f45fd.js](https://s1.hdslb.com/bfs/static/creator-monorepo/videoup/static/js/index.912f45fd.js)。这是本次下载快照的精确 URL，不是稳定公开 API 契约。
- 本地快照：[uploader-4.js](/tmp/bilibili-draft-research/uploader-4.js:1)；映射：[uploader-sources.json](/tmp/bilibili-draft-research/uploader-sources.json:1)，数组索引 4 对应上述 URL。
- 脚本 SHA-256：`b41087bd17a3c98b35abaa869646954b8522b5b6eb48f100021dd802ab57c191`。
- 现场记录：[live-evidence.json](/tmp/bilibili-draft-research/live-evidence.json:1)。浏览器验证由父任务完成；本研究只读取脱敏结果，没有重做浏览器操作。
- 脚本为单行压缩代码。下文定位使用解码后字符串的 **0 起始字符偏移**，配合函数名/路径搜索复核；不是字节偏移。
- 本地实现与测试按当前含未提交修改的工作树读取，结论不代表远端、已打包或已部署版本。旧记忆仅用于定位需要纠正的说法，不作为事实依据。

## 官方脚本中的行为边界

下表路径均为 `member.bilibili.com` 页面相关接口；方法及函数来自上述脚本，list 一行另注明证据来源。

| 用途 | 方法与路径 | 直接证据 |
| --- | --- | --- |
| 新建草稿 | `POST /x/vupre/web/draft/add` | `submitDraft`，字符 361249 起 |
| 更新草稿 | `POST /x/vupre/web/draft/update` | `editDraft`，字符 361815 起 |
| 读取草稿 | `GET /x/vupre/web/draft/view` | `getArchiveDraftInfo`，路径字符 358875 起 |
| 列出草稿 | `GET /x/vupre/web/draft/list` | 现场记录的接口分类及 `listCode: 0`；该路径字面量未在本份 uploader 脚本中找到 |
| 投稿提交 | `POST /x/vu/web/add/v3` | `submitArchive`，字符 360553 附近；完整请求 URL 字符 360818 附近 |

`submitDraftVideoAPI` 根据 `isEditDraftMode` 选择 `editDraft` 或 `submitDraft`。
成功分支显示“已存入草稿箱”，普通浏览器单任务下跳转草稿管理页；多任务/客户端环境有不同收尾分支（字符 1061380 附近）。
因此“跳转”应结合具体环境判断；不能只靠按钮点击或成功文案认定持久化。

可核对的页面路由：

- 投稿编辑入口：[当前上传页](https://member.bilibili.com/platform/upload/video/frame)。
- 保存后：[草稿管理页](https://member.bilibili.com/platform/upload-manager/article?group=draft)，脚本成功分支也包含此路由。
- 本次重开：[草稿 4129599 编辑页](https://member.bilibili.com/platform/upload/video/frame?type=draft&draftId=4129599)。
- 脚本解析 `type=draft&draftId=...` 并进入 `isEditDraftMode`，与普通稿件 `type=edit` 分开（字符 907532、2074870 附近）。

这些是本次源码/现场确认的内部接口和页面路由，不是已查到的官方开发者支持承诺。

## 页面限制与字段保留

- 按钮显示条件：非互动、账号 `white.grayscale.draft_white.auth.Bool` 有能力、非多 P、非普通稿件编辑模式（字符 663273、663786 起）。
- `doSubmitDraft` 再校验上传完成、单 P，并拒绝互动视频及部分直播素材类型；上传未完成明确报“请上传完成再保存”（字符 1045270 起）。
- 草稿数量到达上限时提示“30个”；保存错误码 `20100` 对应上限弹窗（字符 436650、1062564 附近）。本次未实际触发上限。
- 保存不等于完整编辑状态快照：`serverDraft` 序列化省略 `desc_format_id`、`ai_cover_param`、`videos.pre_command`、`interactive`、`adorder_good_info_list`、`live_to_arc`（字符 1005660 附近）。
- 页面还提示章节和卡片配置将失效，并有草稿部分内容失效后清空/回默认值的处理（字符 1105758、1147661 附近）。
- 因此封面、声明、活动/权限相关设置、章节与其他元数据必须逐项重开回读，不能由标题和视频持久化推导全部字段都已保留。

## 本次真实页面样本

以下均来自现场记录，不是本研究重新执行或根据脚本推测：

1. 使用与工作台缓存素材匹配的同一视频，大小 **52,450,701 字节**。
2. 先直接向 `input[name=buploader]:not([accept=.txt])` 设置文件，UPOS 初始化 HTTP 400，页面仍停在空上传入口。
3. 随后点击 `.upload-area`，等待实际文件选择器，再 `setFiles` 同一路径，成功进入编辑页。
4. 页面观察到 `31%`、`15.6MB/50.0MB`、`1.3MB/s` 等真实上传进度，最终显示“上传完成”；只读 Vue 任务状态为 `3`，文件大小匹配。
5. 标题设为 **用英语说我能自己吃（草稿验证）**，只点击“存草稿”，没有点击“立即投稿”。
6. 跳转到 `group=draft`，草稿数 **0 → 1**；`listCode`、`viewCode` 均为 `0`。
7. 草稿 ID **4129599**，视频 `cid` **43660216370**，详情中存在视频 filename。
8. 通过 `type=draft&draftId=4129599` 重开后，标题保留、视频仍显示上传完成。
9. archives 数量始终为 **24**，投稿列表没有本次研究标题；历史两条 BV 的当前状态均为“开放浏览”。

这些证据支持“这个样本保存到了独立草稿箱”，并纠正旧稿件分类。
记录没有附完整保存过程的网络请求日志，故“全过程零投稿端点请求”仍须作为后续独立验收项，不能假装已完成抓包证明。

本次未设置封面（仍为“添加封面”），未设置创作声明（仍为占位提示）；标签由页面自动填入“生活记录、记录、绘画”，没有验证工作台标签自动配置。
样本证明视频和标题持久化，不足以验证封面、声明、简介、标签、定时等自动化全部兼容。

## 文件交接与 Vue 状态风险

- 直接设置指定 input 失败、从页面入口唤起文件选择器成功，是本次两条路径的观察结果。
- **原因仍未确认**：不能概括为所有合成事件必失败、所有原生事件必成功，也不能将具体 input/时序/上传器上下文差异排除。
- 本次 ego `fill` 改变 input DOM 值，但只读 Vue `archive.title` 仍是 `merged`；使用原生键盘全选并输入后，Vue 标题和可见计数才更新。
- 这说明只比对 DOM 值会误报填写成功；不能直接等同于插件当前 setter/event 路径一定失败，但必须补真实页面验证及保存后回读。
- 浏览器自动化可接收本地路径的文件选择器，与 MV3 通过 bridge 交接缓存 Blob 的能力不同；路径/权限/文件身份如何连接仍是待解决的集成问题。

## 当前插件与测试的差距

- [content.ts:189](/Users/ajk-corly/vscode/video-upload-plugin/src/extension/content.ts:189) 的注释把 HTTP 400 泛化为合成 FileList 被拒绝，并错误称直传结果为普通草稿。
- [content.ts:195](/Users/ajk-corly/vscode/video-upload-plugin/src/extension/content.ts:195) 对尚未传输的 B 站任务直接调用 `uploadBilibiliDirect`；不是先走页面、失败才回退。
- [bilibili.ts:109](/Users/ajk-corly/vscode/video-upload-plugin/src/extension/bilibili.ts:109) 构造 submission，随后第 117 行 POST `add/v3`；第 116、120 行“稿件草稿”文案掩盖了实际投稿行为。
- [content.ts:235](/Users/ajk-corly/vscode/video-upload-plugin/src/extension/content.ts:235) 的页面填写分支与直传分支分开；[bilibili.ts:290](/Users/ajk-corly/vscode/video-upload-plugin/src/extension/bilibili.ts:290) 明确结束于“未投稿、未保存草稿”，没有页面存草稿检查点。
- [bilibili.ts:247](/Users/ajk-corly/vscode/video-upload-plugin/src/extension/bilibili.ts:247) 设置标题并派发事件，第 266 行仅核对 DOM；尚不足以证明 Vue 模型或服务端草稿值一致。
- [tests/bilibili-browser.mjs:9](/Users/ajk-corly/vscode/video-upload-plugin/tests/bilibili-browser.mjs:9) 用 `setContent` 构造页面；第 64 行“零提交”仅覆盖 fixture 按钮计数。
- [tests/bilibili-browser.mjs:123](/Users/ajk-corly/vscode/video-upload-plugin/tests/bilibili-browser.mjs:123) 的直传测试使用 fake fetch，最后统一返回 `BV-test`，只断言分片/cid/tid；没有阻止 `add/v3`，没有验证官方草稿身份或持久化。

## 建议流程与后续验收

建议插件沿页面流程工作：确认空白页面与素材身份 → 从正确页面入口交接视频 → 等待真实上传完成 → 填写并验证字段 → **明确的“保存草稿”检查点** → 点击可见“存草稿” → 核验持久化草稿 ID。
检查点必须区分上传完成、字段完成、草稿已保存；保存结果不明时先只读对账，禁止自动转为投稿或盲目再次创建。
**草稿任务永不回退到 `add/v3` 或普通稿件 edit/提交入口。** 文件选择器与缓存 Blob 的对接需先做可行性验证，再承诺全自动支持。

具体后续验收（本研究没有执行）：

1. **零投稿端点**：真实 MV3 扩展从开始到重开全程记录脱敏网络方法/路径；允许草稿 add/update，断言无 `POST /x/vu/web/add/v3`、普通稿件 edit 或其他投稿写入，且未点击“立即投稿”。本地回归也对这些写请求设置失败断言。
2. **真实文件交接**：工作台缓存 Blob 经实际插件通道进入正确上传器；核对素材大小/身份、进度、完成标记及视频 filename/cid。与文件选择器对照复现，确认差异原因；不能用 fake fetch 验收。
3. **持久化草稿**：保存前记录列表基线；保存后返回/对账得到唯一 draft ID，list/view 成功；重开并刷新或重新进入同一草稿，核对标题与视频，archives 无新增本次稿件。
4. **元数据真值**：测试标题、简介、标签、封面、创作声明及需支持的定时字段；分别检查页面模型与保存后详情/重开结果，避免 DOM 值一致但模型未更新。
5. **更新与恢复**：再次编辑同一 draft ID 应更新而不新增；超时、断连、导航后先查询原 ID，禁止自动重复创建，也禁止重新上传已完成视频。
6. **限制与失败**：上传未完成、多 P、互动、能力缺失、30 草稿上限、字段失效提示均清晰停止/交接，不误报成功、不绕过限制、不触发投稿。

本次交付仅为本文件；未修复代码、运行构建/测试或部署。已有未提交修改全部保留。
