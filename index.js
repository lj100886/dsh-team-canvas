/**
 * dsh-team-canvas — Agent Teams 可视化面板（Host 端）
 *
 * Host 侧只负责让这个 bundle 挂载；所有数据与渲染都在 Client 端完成。
 */

export const name = 'team-canvas';

export const inject = [];

export function apply(ctx) {
  ctx.logger?.info?.('[team-canvas] Agent Teams canvas loaded');
}
