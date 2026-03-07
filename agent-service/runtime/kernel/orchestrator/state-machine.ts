/**
 * Agent 状态机
 *
 * 管理 Agent 的执行状态转换。
 */

import { getLogger } from '@logtape/logtape';

const log = getLogger(['kernel', 'state-machine']);

/** Agent 状态 */
export type AgentState =
  | 'idle'
  | 'thinking'
  | 'planning'
  | 'executing'
  | 'waiting'
  | 'completed'
  | 'error';

/** 状态转换事件 */
export type StateTransitionEvent =
  | 'start'
  | 'think'
  | 'plan'
  | 'execute'
  | 'wait'
  | 'complete'
  | 'error'
  | 'reset';

/** 状态转换监听器 */
export type StateTransitionListener = (
  from: AgentState,
  to: AgentState,
  event: StateTransitionEvent
) => void;

/** 状态机配置 */
export interface StateMachineConfig {
  /** 是否启用状态转换日志 */
  enableLogging?: boolean;
}

/**
 * Agent 状态机
 */
export class AgentStateMachine {
  private state: AgentState = 'idle';
  private listeners: StateTransitionListener[] = [];

  constructor(private config: StateMachineConfig = {}) {}

  /**
   * 获取当前状态
   */
  getState(): AgentState {
    return this.state;
  }

  /**
   * 触发状态转换
   */
  transition(event: StateTransitionEvent): void {
    const from = this.state;
    const to = this.getNextState(from, event);

    if (to === from) {
      log.debug('[StateMachine] 无效状态转换', { from, event });
      return;
    }

    this.state = to;

    if (this.config.enableLogging) {
      log.info('[StateMachine] 状态转换', { from, to, event });
    }

    this.notifyListeners(from, to, event);
  }

  /**
   * 添加状态转换监听器
   */
  addListener(listener: StateTransitionListener): void {
    this.listeners.push(listener);
  }

  /**
   * 移除状态转换监听器
   */
  removeListener(listener: StateTransitionListener): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 重置状态
   */
  reset(): void {
    const from = this.state;
    this.state = 'idle';
    this.notifyListeners(from, 'idle', 'reset');
  }

  /**
   * 获取下一个状态
   */
  private getNextState(current: AgentState, event: StateTransitionEvent): AgentState {
    const transitions: Record<AgentState, Partial<Record<StateTransitionEvent, AgentState>>> = {
      idle: {
        start: 'thinking',
      },
      thinking: {
        plan: 'planning',
        execute: 'executing',
        complete: 'completed',
        error: 'error',
      },
      planning: {
        execute: 'executing',
        wait: 'waiting',
        error: 'error',
      },
      executing: {
        think: 'thinking',
        wait: 'waiting',
        complete: 'completed',
        error: 'error',
      },
      waiting: {
        execute: 'executing',
        complete: 'completed',
        error: 'error',
      },
      completed: {
        start: 'thinking',
      },
      error: {
        start: 'thinking',
      },
    };

    return transitions[current]?.[event] ?? current;
  }

  /**
   * 通知监听器
   */
  private notifyListeners(from: AgentState, to: AgentState, event: StateTransitionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(from, to, event);
      } catch (error) {
        log.error('[StateMachine] 监听器错误', { error: String(error) });
      }
    }
  }
}