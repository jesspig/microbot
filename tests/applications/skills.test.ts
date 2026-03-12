/**
 * Skills 模块集成测试
 *
 * 测试技能加载、解析和内容加载功能
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  FilesystemSkillLoader,
  FilesystemSkill,
  parseFrontmatter,
  parseYamlFrontmatter,
} from "../../microagent/applications/skills/index.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SkillMeta } from "../../microagent/runtime/types.js";

// ============================================================================
// 测试常量
// ============================================================================

/** 跨平台兼容的测试技能目录 */
const TEST_SKILLS_DIR = join(tmpdir(), "micro-agent-test-skills");

// ============================================================================
// 测试辅助函数
// ============================================================================

/**
 * 创建测试技能目录结构
 */
async function setupTestSkillsDir(): Promise<void> {
  await mkdir(TEST_SKILLS_DIR, { recursive: true });
}

/**
 * 清理测试技能目录
 */
async function cleanupTestSkillsDir(): Promise<void> {
  try {
    await rm(TEST_SKILLS_DIR, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
}

/**
 * 创建测试技能文件
 */
async function createSkillFile(
  skillName: string,
  content: string
): Promise<void> {
  const skillDir = join(TEST_SKILLS_DIR, skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), content, "utf-8");
}

// ============================================================================
// 测试套件
// ============================================================================

describe("Skills 模块集成测试", () => {
  describe("parseYamlFrontmatter 函数", () => {
    test("应解析简单的键值对", () => {
      const yaml = `name: test-skill
description: A test skill
version: 1.0.0`;

      const meta = parseYamlFrontmatter(yaml);

      expect(meta.name).toBe("test-skill");
      expect(meta.description).toBe("A test skill");
      expect(meta.version).toBe("1.0.0");
    });

    test("应解析数组格式的字段", () => {
      const yaml = `name: test-skill
tags: [tag1, tag2, tag3]
dependencies: [dep1, dep2]`;

      const meta = parseYamlFrontmatter(yaml);

      expect(meta.tags).toEqual(["tag1", "tag2", "tag3"]);
      expect(meta.dependencies).toEqual(["dep1", "dep2"]);
    });

    test("应处理带引号的字符串值", () => {
      const yaml = `name: "test-skill-with-quotes"
description: 'A "quoted" description'`;

      const meta = parseYamlFrontmatter(yaml);

      expect(meta.name).toBe("test-skill-with-quotes");
      expect(meta.description).toBe('A "quoted" description');
    });

    test("应忽略注释行", () => {
      const yaml = `name: test-skill
# This is a comment
description: A test skill`;

      const meta = parseYamlFrontmatter(yaml);

      expect(meta.name).toBe("test-skill");
      expect(meta.description).toBe("A test skill");
    });

    test("应处理空行", () => {
      const yaml = `name: test-skill

description: A test skill

version: 1.0.0`;

      const meta = parseYamlFrontmatter(yaml);

      expect(meta.name).toBe("test-skill");
      expect(meta.description).toBe("A test skill");
      expect(meta.version).toBe("1.0.0");
    });

    test("应处理不完整的 frontmatter", () => {
      const yaml = `name: test-skill
invalid syntax here`;

      const meta = parseYamlFrontmatter(yaml);

      expect(meta.name).toBe("test-skill");
      expect(meta.description).toBeUndefined();
    });

    test("应处理空 frontmatter", () => {
      const meta = parseYamlFrontmatter("");

      expect(meta).toEqual({});
    });
  });

  describe("parseFrontmatter 函数", () => {
    test("应解析完整的 frontmatter 结构", () => {
      const content = `---
name: test-skill
description: A test skill
version: 1.0.0
tags: [tag1, tag2]
---

# Test Skill

This is the skill content.
`;

      const result = parseFrontmatter(content);

      expect(result.meta.name).toBe("test-skill");
      expect(result.meta.description).toBe("A test skill");
      expect(result.meta.version).toBe("1.0.0");
      expect(result.meta.tags).toEqual(["tag1", "tag2"]);
      expect(result.body).toContain("# Test Skill");
      expect(result.body).toContain("This is the skill content");
    });

    test("应处理没有 frontmatter 的内容", () => {
      const content = `# Test Skill

This is the skill content.
`;

      const result = parseFrontmatter(content);

      expect(result.meta).toEqual({});
      expect(result.body).toContain("# Test Skill");
    });

    test("应处理只有 frontmatter 的内容", () => {
      const content = `---
name: test-skill
description: A test skill
---

`;

      const result = parseFrontmatter(content);

      expect(result.meta.name).toBe("test-skill");
      expect(result.body).toBe("");
    });

    test("应处理空内容", () => {
      const result = parseFrontmatter("");

      expect(result.meta).toEqual({});
      expect(result.body).toBe("");
    });

    test("应处理 frontmatter 中的多行字符串", () => {
      const content = `---
name: test-skill
description: |
  A multi-line
  description
---

Content here.
`;

      const result = parseFrontmatter(content);

      expect(result.meta.name).toBe("test-skill");
      expect(result.meta.description).toBeDefined();
    });
  });

  describe("FilesystemSkill 类", () => {
    let skill: FilesystemSkill;
    const skillFilePath = join(TEST_SKILLS_DIR, "test-skill", "SKILL.md");

    beforeEach(async () => {
      await setupTestSkillsDir();
      const skillContent = `---
name: test-skill
description: A test skill
version: 1.0.0
---

# Test Skill

This is the skill content.
`;
      await createSkillFile("test-skill", skillContent);

      const skillMeta: SkillMeta = {
        name: "test-skill",
        description: "A test skill",
        version: "1.0.0",
      };

      skill = new FilesystemSkill(
        {
          name: "test-skill",
          path: skillFilePath,
          enabled: true,
          priority: 0,
        },
        skillMeta,
        skillFilePath
      );
    });

    afterEach(async () => {
      await cleanupTestSkillsDir();
    });

    describe("基础属性", () => {
      test("应具有正确的元数据", () => {
        expect(skill.meta.name).toBe("test-skill");
        expect(skill.meta.description).toBe("A test skill");
        expect(skill.meta.version).toBe("1.0.0");
      });

      test("应具有正确的配置", () => {
        expect(skill.config.name).toBe("test-skill");
        expect(skill.config.enabled).toBe(true);
        expect(skill.config.path).toBe(skillFilePath);
      });
    });

    describe("loadContent 方法", () => {
      test("应成功加载技能内容", async () => {
        const content = await skill.loadContent();

        expect(content).toContain("# Test Skill");
        expect(content).toContain("This is the skill content");
      });

      test("应缓存已加载的内容", async () => {
        const content1 = await skill.loadContent();
        const content2 = await skill.loadContent();

        expect(content1).toBe(content2);
      });

      test("应返回 body 而非 frontmatter", async () => {
        const content = await skill.loadContent();

        expect(content).not.toContain("name: test-skill");
        expect(content).not.toContain("description:");
      });
    });

    describe("reload 方法", () => {
      test("应重新加载技能内容", async () => {
        const content1 = await skill.loadContent();

        // 修改文件内容
        const newContent = `---
name: test-skill
---

# Updated Content
`;
        await writeFile(skillFilePath, newContent, "utf-8");

        const content2 = await skill.reload();

        expect(content1).not.toBe(content2);
        expect(content2).toContain("# Updated Content");
      });

      test("重新加载后应清除缓存", async () => {
        await skill.loadContent();
        expect(skill.getContent()).not.toBeNull();

        await skill.reload();
        expect(skill.getContent()).not.toBeNull();
      });
    });

    describe("getContent 方法", () => {
      test("应返回已加载的内容", async () => {
        await skill.loadContent();
        const cached = skill.getContent();

        expect(cached).not.toBeNull();
        expect(cached?.content).toContain("# Test Skill");
      });

      test("未加载时应返回 null", () => {
        const cached = skill.getContent();

        expect(cached).toBeNull();
      });

      test("应包含加载时间戳", async () => {
        await skill.loadContent();
        const cached = skill.getContent();

        expect(cached?.loadedAt).toBeDefined();
        expect(typeof cached?.loadedAt).toBe("number");
      });
    });
  });

  describe("FilesystemSkillLoader 类", () => {
    let loader: FilesystemSkillLoader;

    beforeEach(async () => {
      await setupTestSkillsDir();
      loader = new FilesystemSkillLoader(TEST_SKILLS_DIR);
    });

    afterEach(async () => {
      await cleanupTestSkillsDir();
    });

    describe("初始化和扫描", () => {
      test("应扫描并加载所有技能元数据", async () => {
        // 创建多个技能
        await createSkillFile(
          "skill1",
          `---
name: skill1
description: First skill
---

# Skill 1
`
        );

        await createSkillFile(
          "skill2",
          `---
name: skill2
description: Second skill
---

# Skill 2
`
        );

        const skills = await loader.listSkills();

        expect(skills.length).toBe(2);
        const skillNames = skills.map((s) => s.config.name);
        expect(skillNames).toContain("skill1");
        expect(skillNames).toContain("skill2");
      });

      test("应从目录名推断技能名称（当 frontmatter 缺少 name 时）", async () => {
        await createSkillFile(
          "inferred-skill",
          `---
description: Skill without name
---

# Inferred Skill
`
        );

        const skills = await loader.listSkills();

        expect(skills.length).toBe(1);
        expect(skills[0].meta.name).toBe("inferred-skill");
      });

      test("应从内容首行提取描述（当 frontmatter 缺少 description 时）", async () => {
        await createSkillFile(
          "skill-with-content-desc",
          `---
name: skill-with-content-desc
---

# This is the description from content

Skill content here.
`
        );

        const skills = await loader.listSkills();

        expect(skills[0].meta.description).toBe("This is the description from content");
      });

      test("应使用默认版本（当 frontmatter 缺少 version 时）", async () => {
        await createSkillFile(
          "skill-no-version",
          `---
name: skill-no-version
description: No version specified
---

# Content
`
        );

        const skills = await loader.listSkills();

        expect(skills[0].meta.version).toBe("1.0.0");
      });

      test("应处理空的技能目录", async () => {
        const skills = await loader.listSkills();

        expect(skills).toEqual([]);
      });

      test("应忽略非 SKILL.md 文件", async () => {
        const skillDir = join(TEST_SKILLS_DIR, "invalid-skill");
        await mkdir(skillDir, { recursive: true });
        await writeFile(join(skillDir, "README.md"), "Not a skill file", "utf-8");

        const skills = await loader.listSkills();

        expect(skills.length).toBe(0);
      });
    });

    describe("loadSkillContent 方法", () => {
      beforeEach(async () => {
        await createSkillFile(
          "test-skill",
          `---
name: test-skill
description: Test skill
version: 1.0.0
---

# Test Skill Content

This is the actual skill content.
`
        );
      });

      test("应成功加载技能内容", async () => {
        const content = await loader.loadSkillContent("test-skill");

        expect(content).not.toBeNull();
        expect(content).toContain("# Test Skill Content");
        expect(content).toContain("This is the actual skill content");
      });

      test("应返回 null 当技能不存在时", async () => {
        const content = await loader.loadSkillContent("non-existent-skill");

        expect(content).toBeNull();
      });

      test("应只返回 body 部分", async () => {
        const content = await loader.loadSkillContent("test-skill");

        expect(content).not.toContain("---");
        expect(content).not.toContain("name: test-skill");
      });
    });

    describe("reload 方法", () => {
      test("应重新扫描并加载所有技能", async () => {
        await createSkillFile(
          "skill1",
          `---
name: skill1
---

# Skill 1
`
        );

        let skills = await loader.listSkills();
        expect(skills.length).toBe(1);

        // 添加新技能
        await createSkillFile(
          "skill2",
          `---
name: skill2
---

# Skill 2
`
        );

        await loader.reload();
        skills = await loader.listSkills();

        expect(skills.length).toBe(2);
      });

      test("重新加载后应清除旧技能", async () => {
        await createSkillFile(
          "skill1",
          `---
name: skill1
---

# Skill 1
`
        );

        await loader.listSkills();

        // 删除技能文件
        const skillDir = join(TEST_SKILLS_DIR, "skill1");
        await rm(skillDir, { recursive: true });

        await loader.reload();
        const skills = await loader.listSkills();

        expect(skills.length).toBe(0);
      });
    });

    describe("技能元数据验证", () => {
      test("应正确解析所有元数据字段", async () => {
        await createSkillFile(
          "complete-skill",
          `---
name: complete-skill
description: A complete skill with all fields
version: 2.1.3
tags: [tag1, tag2, tag3]
dependencies: [dep1, dep2]
---

# Complete Skill
`
        );

        const skills = await loader.listSkills();

        expect(skills.length).toBe(1);
        expect(skills[0].meta.name).toBe("complete-skill");
        expect(skills[0].meta.description).toBe("A complete skill with all fields");
        expect(skills[0].meta.version).toBe("2.1.3");
        expect(skills[0].meta.tags).toEqual(["tag1", "tag2", "tag3"]);
        expect(skills[0].meta.dependencies).toEqual(["dep1", "dep2"]);
      });

      test("应处理包含特殊字符的技能名称", async () => {
        await createSkillFile(
          "skill-with_special-chars",
          `---
name: skill-with_special-chars
description: Special chars
---

# Content
`
        );

        const skills = await loader.listSkills();

        expect(skills[0].config.name).toBe("skill-with_special-chars");
      });
    });
  });

  describe("技能注册表集成", () => {
    let loader: FilesystemSkillLoader;

    beforeEach(async () => {
      await setupTestSkillsDir();
      loader = new FilesystemSkillLoader(TEST_SKILLS_DIR);

      // 创建测试技能
      await createSkillFile(
        "skill1",
        `---
name: skill1
description: First skill
---

# Skill 1
`
      );

      await createSkillFile(
        "skill2",
        `---
name: skill2
description: Second skill
---

# Skill 2
`
      );
    });

    afterEach(async () => {
      await cleanupTestSkillsDir();
    });

    test("应能够注册所有加载的技能", async () => {
      const skills = await loader.listSkills();
      const { SkillRegistry } = await import("../../microagent/runtime/skill/index.js");
      const registry = new SkillRegistry();

      for (const skill of skills) {
        registry.register(skill);
      }

      expect(registry.list().length).toBe(2);
    });

    test("应能够通过名称获取技能", async () => {
      const skills = await loader.listSkills();
      const { SkillRegistry } = await import("../../microagent/runtime/skill/index.js");
      const registry = new SkillRegistry();

      for (const skill of skills) {
        registry.register(skill);
      }

      const skill1 = registry.get("skill1");
      const skill2 = registry.get("skill2");

      expect(skill1).toBeDefined();
      expect(skill2).toBeDefined();
      expect(skill1?.config.name).toBe("skill1");
      expect(skill2?.config.name).toBe("skill2");
    });
  });

  describe("错误处理和边界情况", () => {
    let loader: FilesystemSkillLoader;

    beforeEach(async () => {
      await setupTestSkillsDir();
      loader = new FilesystemSkillLoader(TEST_SKILLS_DIR);
    });

    afterEach(async () => {
      await cleanupTestSkillsDir();
    });

    test("应处理损坏的 YAML frontmatter", async () => {
      await createSkillFile(
        "broken-yaml",
        `---
name: broken-yaml
invalid yaml syntax
---

# Content
`
      );

      const skills = await loader.listSkills();

      // 应该仍然加载技能，使用目录名
      expect(skills.length).toBe(1);
      expect(skills[0].config.name).toBe("broken-yaml");
    });

    test("应处理空的 SKILL.md 文件", async () => {
      await createSkillFile("empty-skill", "");

      const skills = await loader.listSkills();

      expect(skills.length).toBe(1);
      expect(skills[0].meta.description).toBe("无描述");
    });

    test("应处理只有 frontmatter 的技能", async () => {
      await createSkillFile(
        "metadata-only",
        `---
name: metadata-only
description: Only metadata
version: 1.0.0
---

`
      );

      const skills = await loader.listSkills();

      expect(skills.length).toBe(1);
      expect(skills[0].meta.name).toBe("metadata-only");
    });

    test("应处理只有内容的技能", async () => {
      await createSkillFile(
        "content-only",
        `# Content Only

This skill has no frontmatter.
`
      );

      const skills = await loader.listSkills();

      expect(skills.length).toBe(1);
      expect(skills[0].meta.name).toBe("content-only");
      expect(skills[0].meta.description).toBe("Content Only");
    });

    test("应处理深层嵌套的技能目录", async () => {
      // 虽然 FilesystemSkillLoader 只扫描一级子目录
      // 但测试确保它不会意外进入深层目录
      const deepDir = join(TEST_SKILLS_DIR, "level1", "level2");
      await mkdir(deepDir, { recursive: true });
      await writeFile(join(deepDir, "SKILL.md"), "---\nname: deep\n---\n", "utf-8");

      const skills = await loader.listSkills();

      // 深层目录中的技能不应该被加载
      expect(skills.length).toBe(0);
    });
  });

  describe("性能测试", () => {
    let loader: FilesystemSkillLoader;

    beforeEach(async () => {
      await setupTestSkillsDir();
      loader = new FilesystemSkillLoader(TEST_SKILLS_DIR);
    });

    afterEach(async () => {
      await cleanupTestSkillsDir();
    });

    test("应高效加载大量技能", async () => {
      const skillCount = 50;

      // 创建大量技能
      for (let i = 0; i < skillCount; i++) {
        await createSkillFile(
          `skill-${i}`,
          `---
name: skill-${i}
description: Skill number ${i}
version: 1.0.0
---

# Skill ${i}
`
        );
      }

      const startTime = Date.now();
      const skills = await loader.listSkills();
      const endTime = Date.now();

      expect(skills.length).toBe(skillCount);
      expect(endTime - startTime).toBeLessThan(1000); // 应该在 1 秒内完成
    });

    test("应高效加载大型技能内容", async () => {
      const largeContent = "# Large Skill\n\n" + "A".repeat(100000) + "\n";

      await createSkillFile(
        "large-skill",
        `---
name: large-skill
description: A large skill
version: 1.0.0
---

${largeContent}
`
      );

      const startTime = Date.now();
      const content = await loader.loadSkillContent("large-skill");
      const endTime = Date.now();

      expect(content).not.toBeNull();
      expect(content?.length).toBeGreaterThan(100000);
      expect(endTime - startTime).toBeLessThan(100); // 应该在 100ms 内完成
    });
  });
});
