/**
 * 基础指标收集
 * 
 * 提供简单的指标收集功能，包括计数器和计时器。
 */

/** 指标类型 */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/** 指标值 */
export interface MetricValue {
  /** 指标名称 */
  name: string;
  /** 指标类型 */
  type: MetricType;
  /** 当前值 */
  value: number;
  /** 标签 */
  labels?: Record<string, string>;
  /** 时间戳 */
  timestamp: number;
}

/** 计时器状态 */
interface TimingState {
  startTime: number;
  name: string;
}

/**
 * 基础指标收集器
 */
export class Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private activeTimings = new Map<string, TimingState>();

  /**
   * 增加计数器
   * @param name - 计数器名称
   * @param value - 增加值，默认 1
   */
  incrementCounter(name: string, value = 1): void {
    const current = this.counters.get(name) ?? 0;
    this.counters.set(name, current + value);
  }

  /**
   * 设置仪表值
   * @param name - 仪表名称
   * @param value - 值
   */
  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  /**
   * 记录计时
   * @param name - 计时器名称
   * @param duration - 持续时间（毫秒）
   */
  recordTiming(name: string, duration: number): void {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, []);
    }
    this.histograms.get(name)!.push(duration);
  }

  /**
   * 开始计时
   * @param name - 计时器名称
   */
  startTiming(name: string): void {
    this.activeTimings.set(name, {
      startTime: Date.now(),
      name,
    });
  }

  /**
   * 结束计时
   * @param name - 计时器名称
   * @returns 持续时间（毫秒）
   */
  endTiming(name: string): number {
    const state = this.activeTimings.get(name);
    if (!state) {
      return 0;
    }
    this.activeTimings.delete(name);
    const duration = Date.now() - state.startTime;
    this.recordTiming(name, duration);
    return duration;
  }

  /**
   * 获取计数器值
   * @param name - 计数器名称
   */
  getCounter(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  /**
   * 获取仪表值
   * @param name - 仪表名称
   */
  getGauge(name: string): number | undefined {
    return this.gauges.get(name);
  }

  /**
   * 获取直方图统计
   * @param name - 直方图名称
   */
  getHistogramStats(name: string): {
    count: number;
    sum: number;
    min: number;
    max: number;
    avg: number;
  } | undefined {
    const values = this.histograms.get(name);
    if (!values || values.length === 0) {
      return undefined;
    }

    const sum = values.reduce((a, b) => a + b, 0);
    return {
      count: values.length,
      sum,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: sum / values.length,
    };
  }

  /**
   * 获取所有指标
   */
  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: {},
    };

    for (const [name] of this.histograms) {
      result.histograms = {
        ...(result.histograms as Record<string, unknown>),
        [name]: this.getHistogramStats(name),
      };
    }

    return result;
  }

  /**
   * 重置所有指标
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.activeTimings.clear();
  }

  /**
   * 导出为 Prometheus 格式
   */
  exportPrometheus(): string {
    const lines: string[] = [];

    // 计数器
    for (const [name, value] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${value}`);
    }

    // 仪表
    for (const [name, value] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${value}`);
    }

    // 直方图
    for (const [name] of this.histograms) {
      const stats = this.getHistogramStats(name);
      if (stats) {
        lines.push(`# TYPE ${name} histogram`);
        lines.push(`${name}_count ${stats.count}`);
        lines.push(`${name}_sum ${stats.sum}`);
        lines.push(`${name}_min ${stats.min}`);
        lines.push(`${name}_max ${stats.max}`);
        lines.push(`${name}_avg ${stats.avg}`);
      }
    }

    return lines.join('\n');
  }
}

/** 全局指标实例 */
export const metrics = new Metrics();
