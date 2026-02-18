/**
 * Skill 扩展入口
 * 
 * 导出所有技能模块，支持独立导入：
 * ```typescript
 * import { SkillsLoader, Skill } from '@microbot/sdk/extensions/skill';
 * ```
 */

// 技能加载器
export { SkillsLoader, getUserSkillsPath } from './loader';
export type { Skill, SkillSummary } from './loader';
