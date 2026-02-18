/**
 * Service 扩展入口
 * 
 * 导出所有服务模块，支持独立导入：
 * ```typescript
 * import { CronService, HeartbeatService } from '@microbot/sdk/extensions/service';
 * ```
 */

// Cron 服务
export { CronService } from './cron/service';

// Heartbeat 服务
export { HeartbeatService } from './heartbeat/service';
