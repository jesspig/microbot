/**
 * 意图识别管道
 *
 * 分阶段意图识别：
 * 1. 预处理阶段：决定是否检索记忆
 * 2. 模型选择阶段：决定使用哪个模型
 *
 * 支持上下文重试：当意图识别需要上下文时，注入对话历史重新识别
 */

import type { LLMProvider, LLMMessage } from './base';
import type { PreflightResult, RoutingResult, IntentResult, PreflightPromptBuilder, HistoryEntry } from './prompts';
import { getLogger } from '@logtape/logtape';

const log = getLogger(['intent-pipeline']);

/** 意图管道配置 */
export interface IntentPipelineConfig {
  /** LLM Provider */
  provider: LLMProvider;
  /** 意图识别模型 */
  intentModel: string;
  /** 预处理阶段提示词构建函数 */
  buildPreflightPrompt: PreflightPromptBuilder;
  /** 模型选择阶段提示词构建函数 */
  buildRoutingPrompt: PreflightPromptBuilder;
}

/**
 * 意图识别管道
 */
export class IntentPipeline {
  private provider: LLMProvider;
  private intentModel: string;
  private buildPreflightPrompt: PreflightPromptBuilder;
  private buildRoutingPrompt: PreflightPromptBuilder;

  constructor(config: IntentPipelineConfig) {
    this.provider = config.provider;
    this.intentModel = config.intentModel;
    this.buildPreflightPrompt = config.buildPreflightPrompt;
    this.buildRoutingPrompt = config.buildRoutingPrompt;
  }

  /**
   * 执行完整的意图识别管道
   * @param content 用户消息内容
   * @param hasImage 是否包含图片
   * @param history 对话历史（可选，用于上下文重试）
   */
  async analyze(content: string, hasImage: boolean, history?: HistoryEntry[]): Promise<IntentResult> {
    const startTime = Date.now();

    // 阶段 1: 预处理（支持上下文重试）
    const preflight = await this.runPreflightWithRetry(content, hasImage, history);

    // 阶段 2: 模型选择
    const routing = await this.runRouting(content, hasImage);

    const elapsed = Date.now() - startTime;
    log.info('[IntentPipeline] 意图识别完成', {
      needMemory: preflight.needMemory,
      memoryTypes: preflight.memoryTypes,
      modelType: routing.type,
      elapsed: `${elapsed}ms`,
    });

    return { preflight, routing };
  }

  /**
   * 预处理（带上下文重试）
   *
   * 流程：
   * 1. 第一次识别：仅使用当前消息
   * 2. 如果 needContext=true 且有历史，注入上下文重新识别
   */
  private async runPreflightWithRetry(
    content: string,
    hasImage: boolean,
    history?: HistoryEntry[],
  ): Promise<PreflightResult> {
    // 第一次识别
    let result = await this.runPreflight(content, hasImage);

    // 如果需要上下文且有历史，进行第二次识别
    if (result.needContext && history && history.length > 0) {
      log.debug('[IntentPipeline] 需要上下文，注入历史重新识别', {
        historyLength: history.length,
      });

      result = await this.runPreflight(content, hasImage, history);
    }

    return result;
  }

  /**
   * 阶段 1: 预处理 - 决定是否检索记忆
   */
  private async runPreflight(
    content: string,
    hasImage: boolean,
    history?: HistoryEntry[],
  ): Promise<PreflightResult> {
    // 有图片时跳过记忆检索
    if (hasImage) {
      log.debug('[IntentPipeline] 预处理: 有图片，跳过记忆检索');
      return {
        needMemory: false,
        memoryTypes: [],
        reason: '图片识别任务不需要记忆上下文',
      };
    }

    const messages: LLMMessage[] = [
      { role: 'user', content: this.buildPreflightPrompt(content, hasImage, history) },
    ];

    try {
      const response = await this.provider.chat(messages, [], this.intentModel, {
        maxTokens: 200,
        temperature: 0.2,
      });

      const result = this.parsePreflightResponse(response.content);
      log.debug('[IntentPipeline] 预处理结果', { result });
      return result;
    } catch (error) {
      log.warn('[IntentPipeline] 预处理失败: {error}', {
        error: error instanceof Error ? error.message : String(error),
      });
      // 失败时默认不检索记忆
      return {
        needMemory: false,
        memoryTypes: [],
        reason: '预处理失败，跳过记忆检索',
      };
    }
  }

  /**
   * 阶段 2: 模型选择 - 决定使用哪个模型
   */
  private async runRouting(content: string, hasImage: boolean): Promise<RoutingResult> {
    // 有图片时直接返回 vision
    if (hasImage) {
      log.debug('[IntentPipeline] 模型选择: 有图片，使用 vision 模型');
      return { type: 'vision', reason: '检测到图片输入' };
    }

    const messages: LLMMessage[] = [
      { role: 'user', content: this.buildRoutingPrompt(content, hasImage) },
    ];

    try {
      const response = await this.provider.chat(messages, [], this.intentModel, {
        maxTokens: 100,
        temperature: 0.2,
      });

      const result = this.parseRoutingResponse(response.content);
      log.debug('[IntentPipeline] 模型选择结果', { result });
      return result;
    } catch (error) {
      log.warn('[IntentPipeline] 模型选择失败: {error}', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { type: 'chat', reason: '模型选择失败，默认使用对话模型' };
    }
  }

  /**
   * 解析预处理响应
   */
  private parsePreflightResponse(content: string): PreflightResult {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { needMemory: false, memoryTypes: [], reason: '无法解析响应' };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        needMemory?: boolean;
        memoryTypes?: string[];
        reason?: string;
        needContext?: boolean;
      };

      return {
        needMemory: parsed.needMemory ?? false,
        memoryTypes: (parsed.memoryTypes ?? []) as PreflightResult['memoryTypes'],
        reason: parsed.reason ?? '未提供理由',
        needContext: parsed.needContext,
      };
    } catch {
      return { needMemory: false, memoryTypes: [], reason: 'JSON 解析失败' };
    }
  }

  /**
   * 解析模型选择响应
   */
  private parseRoutingResponse(content: string): RoutingResult {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { type: 'chat', reason: '无法解析响应' };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        type?: string;
        reason?: string;
      };

      const validTypes = ['vision', 'coder', 'chat'];
      const type = validTypes.includes(parsed.type ?? '') ? parsed.type as RoutingResult['type'] : 'chat';

      return {
        type,
        reason: parsed.reason ?? '未提供理由',
      };
    } catch {
      return { type: 'chat', reason: 'JSON 解析失败' };
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<IntentPipelineConfig>): void {
    if (config.provider) this.provider = config.provider;
    if (config.intentModel) this.intentModel = config.intentModel;
    if (config.buildPreflightPrompt) this.buildPreflightPrompt = config.buildPreflightPrompt;
    if (config.buildRoutingPrompt) this.buildRoutingPrompt = config.buildRoutingPrompt;
  }
}
