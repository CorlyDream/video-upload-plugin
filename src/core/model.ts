export const platforms = [
  { id: 'xiaohongshu', name: '小红书', origin: 'https://creator.xiaohongshu.com', path: '/publish/publish?source=official' },
  { id: 'douyin', name: '抖音', origin: 'https://creator.douyin.com', path: '/creator-micro/content/upload?enter_from=dou_web' },
  { id: 'bilibili', name: 'B站', origin: 'https://member.bilibili.com', path: '/platform/upload/video/frame' },
  { id: 'weixin', name: '视频号', origin: 'https://channels.weixin.qq.com', path: '/platform/post/create' },
  { id: 'kuaishou', name: '快手', origin: 'https://cp.kuaishou.com', path: '/article/publish/video' },
] as const;
export type PlatformId = typeof platforms[number]['id'];
export type TaskStatus = 'checking' | 'transferring' | 'needs_attention' | 'paused' | 'aborted' | 'failed';
export interface TaskBinding {
  batchId: string; taskId: string; attemptId: string; tabId: number; documentId: string; step: number;
}
export interface Checkpoint extends TaskBinding { status: TaskStatus; reason: string; pipelineStage?: string }
export interface Task extends Checkpoint { diagnosticPhase?: string; videoAlreadyTransferred?: boolean; uploadTabId?: number; platform: PlatformId; assetId: string; createdAt: number; publication?: import('./publication').Publication; coverAssetId?: string; pkCoverAssetIds?: string[]; coverPk?: boolean }
export interface Batch { id: string; asset: AssetMeta; tasks: Task[]; createdAt: number; publication?: import('./publication').Publication; cover?: AssetMeta; pkCovers?: AssetMeta[]; coverPk?: boolean }
export interface AssetMeta { id: string; batchId: string; name: string; type: string; size: number; lastModified: number; createdAt: number }
export interface Asset extends AssetMeta { blob: Blob }
export interface SenderIdentity { tabId: number; frameId: number; documentId: string; url: string }
export const isActive = (status: TaskStatus) => status === 'checking' || status === 'transferring';
export function acceptCheckpoint(current: Checkpoint, event: Checkpoint): Checkpoint | null {
  if (!isActive(current.status) || event.step !== current.step + 1) return null;
  if (['batchId', 'taskId', 'attemptId', 'tabId', 'documentId'].some(key => current[key as keyof TaskBinding] !== event[key as keyof TaskBinding])) return null;
  if (!['transferring', 'needs_attention', 'paused', 'aborted', 'failed'].includes(event.status)) return null;
  return event;
}
