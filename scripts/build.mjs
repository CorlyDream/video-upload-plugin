import { build } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
const origins = ['https://creator.xiaohongshu.com/*','https://creator.douyin.com/*','https://member.bilibili.com/*','https://channels.weixin.qq.com/*','https://cp.kuaishou.com/*'];
await build({ configFile: false, build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: 'workbench.html' } } });
for (const entry of ['background', 'content', 'bridge']) {
  await build({ configFile: false, build: { outDir: 'dist', emptyOutDir: false, lib: { entry: `src/extension/${entry}.ts`, name: entry, formats: ['iife'], fileName: () => `${entry}.js` } } });
}
await mkdir('dist', { recursive: true });
await writeFile('dist/bridge.html', '<!doctype html><html><head><meta charset="UTF-8"><title>素材桥接</title></head><body><script src="bridge.js"></script></body></html>');
await writeFile('dist/manifest.json', JSON.stringify({
  manifest_version: 3, name: '视频上传填表助手 · 路径验证版', version: '0.1.0',
  description: '实验性视频文件交接。只交给页面控件，由你核验；不发布、不保存草稿。',
  permissions: ['storage', 'scripting', 'webNavigation'], optional_host_permissions: origins,
  background: { service_worker: 'background.js' },
  action: { default_title: '打开视频上传工作台' },
  web_accessible_resources: [{ resources: ['bridge.html', 'bridge.js'], matches: origins }],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
}, null, 2));
