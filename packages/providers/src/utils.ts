/**
 * Provider 工具函数
 */

import type { LLMMessage, ContentPart, MessageContent } from './base';

/** 图片扩展名 */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];

/**
 * 构建用户消息内容
 *
 * 如果有媒体文件，返回多模态数组格式（OpenAI 推荐顺序：先图片，后文本）
 *
 * @param text - 文本内容
 * @param media - 媒体文件列表（data URI 或 URL 格式）
 * @returns 单文本或 ContentPart 数组
 */
export function buildUserContent(text: string, media?: string[]): MessageContent {
  if (!media || media.length === 0) {
    return text;
  }

  const content: ContentPart[] = [];

  // 先添加图片（OpenAI 推荐顺序）
  for (const m of media) {
    const isImage = IMAGE_EXTENSIONS.some(ext => m.toLowerCase().includes(ext)) ||
      m.includes('image/') ||
      m.startsWith('data:image');

    if (isImage) {
      content.push({
        type: 'image_url',
        image_url: {
          url: m,
          detail: 'auto',
        },
      });
    }
  }

  // 再添加文本
  if (text) {
    content.push({
      type: 'text',
      text: text,
    });
  }

  return content.length > 0 ? content : text;
}

/**
 * 将消息转换为纯文本格式
 *
 * 用于非视觉模型，将多模态消息中的图片替换为 `[图片]` 占位符。
 *
 * @param messages - 原始消息列表
 * @returns 转换后的纯文本消息列表
 */
export function convertToPlainText(messages: LLMMessage[]): LLMMessage[] {
  return messages.map(msg => {
    // 如果内容已经是字符串，直接返回
    if (typeof msg.content === 'string') return msg;

    // ContentPart[] -> 纯文本
    const textParts: string[] = [];
    for (const part of msg.content as ContentPart[]) {
      if (part.type === 'text') {
        textParts.push(part.text);
      } else if (part.type === 'image_url') {
        textParts.push('[图片]');
      }
    }

    return { ...msg, content: textParts.join('\n') };
  });
}
