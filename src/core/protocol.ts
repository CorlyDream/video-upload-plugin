import type { AssetMeta, Batch, Checkpoint, PlatformId, Task } from './model';
export type WorkbenchCommand =
  | { type: 'get' }
  | { type: 'prepare'; asset: AssetMeta }
  | { type: 'configure'; publication: import('./publication').Publication; coverAssetId?: string; pkCoverAssetIds?: string[]; coverPk?: boolean }
  | { type: 'start'; platform: PlatformId }
  | { type: 'retry'; taskId: string }
  | { type: 'resume'; taskId: string }
  | { type: 'stop' }
  | { type: 'clear' }
  | { type: 'open'; taskId: string };
export type PageCommand = { type: 'run'; task: Task; token: string; origin: string } | { type: 'stop' };
export type PageMessage = { type: 'heartbeat' } | { type: 'checkpoint'; checkpoint: Checkpoint } | { type: 'approve'; token: string; claimId: string };
export interface Snapshot { batch?: Batch }
export interface Response { id?: string; ok: boolean; error?: string; snapshot?: Snapshot }
export interface Request { id: string; command: WorkbenchCommand }
