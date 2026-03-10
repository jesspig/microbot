/**
 * Token 估算器测试
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  TokenEstimator,
  getTokenEstimator,
  configureTokenEstimator,
  resetTokenEstimator,
  DEFAULT_TOKEN_ESTIMATOR_CONFIG,
} from '../runtime/kernel/context-manager/token-estimator';

describe('TokenEstimator', () => {
  let estimator: TokenEstimator;

  beforeEach(() => {
    resetTokenEstimator();
    estimator = new TokenEstimator();
  });

  describe('estimateText', () => {
    it('空字符串返回 0', () => {
      expect(estimator.estimateText('')).toBe(0);
    });

    it('null 或 undefined 返回 0', () => {
      expect(estimator.estimateText(null as unknown as string)).toBe(0);
      expect(estimator.estimateText(undefined as unknown as string)).toBe(0);
    });

    it('纯英文文本估算', () => {
      const text = 'Hello World';
      // 默认：4 字符/token，英文
      const result = estimator.estimateText(text);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(text.length);
    });

    it('纯中文文本估算', () => {
      const text = '你好世界';
      // 默认：1.5 字符/token，中文
      const result = estimator.estimateText(text);
      expect(result).toBeGreaterThan(0);
      // 中文 token 数量应该比英文高（相同字符数）
    });

    it('中英文混合文本估算', () => {
      const text = 'Hello 世界';
      const result = estimator.estimateText(text);
      expect(result).toBeGreaterThan(0);
    });

    it('长文本估算', () => {
      const text = '这是一段较长的中文文本，用于测试 Token 估算器对于较长文本的处理能力。'.repeat(10);
      const result = estimator.estimateText(text);
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('estimateMessage', () => {
    it('字符串内容消息', () => {
      const message = { role: 'user', content: 'Hello' };
      const result = estimator.estimateMessage(message);
      // 应包含消息开销
      expect(result).toBeGreaterThan(0);
    });

    it('多模态内容消息', () => {
      const message = {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'image', image: 'base64...' },
        ],
      };
      const result = estimator.estimateMessage(message);
      expect(result).toBeGreaterThan(0);
    });

    it('JSON 内容消息', () => {
      const message = { role: 'user', content: { key: 'value' } };
      const result = estimator.estimateMessage(message);
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('estimateMessages', () => {
    it('批量估算消息', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      const result = estimator.estimateMessages(messages);
      expect(result).toBeGreaterThan(0);
    });

    it('空消息列表返回 0', () => {
      expect(estimator.estimateMessages([])).toBe(0);
    });
  });

  describe('配置', () => {
    it('使用默认配置', () => {
      const config = estimator.getConfig();
      expect(config.charsPerTokenEn).toBe(DEFAULT_TOKEN_ESTIMATOR_CONFIG.charsPerTokenEn);
      expect(config.charsPerTokenCn).toBe(DEFAULT_TOKEN_ESTIMATOR_CONFIG.charsPerTokenCn);
      expect(config.enableLanguageDetection).toBe(DEFAULT_TOKEN_ESTIMATOR_CONFIG.enableLanguageDetection);
    });

    it('自定义配置', () => {
      const customEstimator = new TokenEstimator({
        charsPerTokenEn: 3,
        charsPerTokenCn: 2,
        enableLanguageDetection: false,
      });
      const config = customEstimator.getConfig();
      expect(config.charsPerTokenEn).toBe(3);
      expect(config.charsPerTokenCn).toBe(2);
      expect(config.enableLanguageDetection).toBe(false);
    });

    it('更新配置', () => {
      estimator.updateConfig({ charsPerTokenEn: 5 });
      const config = estimator.getConfig();
      expect(config.charsPerTokenEn).toBe(5);
    });
  });

  describe('全局实例', () => {
    it('获取默认实例', () => {
      const instance1 = getTokenEstimator();
      const instance2 = getTokenEstimator();
      expect(instance1).toBe(instance2);
    });

    it('配置全局实例', () => {
      configureTokenEstimator({ charsPerTokenEn: 6 });
      const instance = getTokenEstimator();
      expect(instance.getConfig().charsPerTokenEn).toBe(6);
    });

    it('重置全局实例', () => {
      configureTokenEstimator({ charsPerTokenEn: 6 });
      resetTokenEstimator();
      const instance = getTokenEstimator();
      expect(instance.getConfig().charsPerTokenEn).toBe(DEFAULT_TOKEN_ESTIMATOR_CONFIG.charsPerTokenEn);
    });
  });

  describe('字符统计', () => {
    it('正确识别中文字符', () => {
      // 纯中文：每个字符都是汉字
      const cnText = '中文测试';
      const enText = 'test';
      
      const cnResult = estimator.estimateText(cnText);
      const enResult = estimator.estimateText(enText);
      
      // 中文 token 数应该比英文高（相同字符数，中文 token 比例更高）
      // 因为中文是 1.5 字符/token，英文是 4 字符/token
      // 4 个中文字符约 2.67 tokens
      // 4 个英文字符约 1 token
      expect(cnResult).toBeGreaterThan(enResult);
    });
  });
});
