/**
 * 技能管理器
 *
 * 负责技能加载和管理
 */

import { SkillRegistry } from "../../runtime/index.js";
import { FilesystemSkillLoader } from "../skills/index.js";
import { SKILLS_DIRS } from "../shared/constants.js";
import { builderLogger, logMethodCall, logMethodReturn, logMethodError, createTimer } from "../shared/logger.js";

const MODULE_NAME = "SkillManager";

/**
 * 技能管理器
 * 负责技能加载和管理
 */
export class SkillManager {
  /** 技能注册表 */
  private readonly skills = new SkillRegistry();

  /**
   * 获取技能注册表
   * @returns 技能注册表
   */
  getRegistry(): SkillRegistry {
    return this.skills;
  }

  /**
   * 加载技能
   * 支持从多个目录加载技能，按优先级顺序加载
   */
  async load(): Promise<void> {
    const timer = createTimer();
    const logger = builderLogger();
    logMethodCall(logger, { method: "load", module: MODULE_NAME, params: { skillsDirs: SKILLS_DIRS } });

    try {
      let totalSkills = 0;

      // 从所有技能目录加载
      for (const skillsDir of SKILLS_DIRS) {
        const loader = new FilesystemSkillLoader(skillsDir);
        const skills = await loader.listSkills();

        if (skills.length > 0) {
          logger.debug("加载技能目录", { skillsDir, count: skills.length });

          for (const skill of skills) {
            // 避免重复注册（优先保留先加载的）
            if (!this.skills.get(skill.config.name)) {
              this.skills.register(skill);
              totalSkills++;
            } else {
              logger.debug("技能已存在，跳过", { skillName: skill.config.name, skillsDir });
            }
          }
        }
      }

      logMethodReturn(logger, {
        method: "load",
        module: MODULE_NAME,
        result: { skillsCount: totalSkills, directories: SKILLS_DIRS.length },
        duration: timer(),
      });
    } catch (err) {
      const error = err as Error;
      logMethodError(logger, {
        method: "load",
        module: MODULE_NAME,
        error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) },
        params: { skillsDirs: SKILLS_DIRS },
        duration: timer(),
      });
      throw error;
    }
  }
}
