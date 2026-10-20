<p align="center">
  <img src="icon.svg" width="96" alt="dsh-team-canvas">
</p>

<h1 align="center">dsh-team-canvas</h1>

<p align="center">
  Agent Teams 泳道看板 · 依赖 DAG 连线 · 通讯流<br>
  <sub>DeepSeek Harness 插件 · 布局移植自 <a href="https://github.com/NanmiCoder/cc-haha">cc-haha</a> 开源实现</sub>
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="dsh" src="https://img.shields.io/badge/dsh-%3E%3D0.2.0-3964fe">
</p>

---

## 它是什么

在 DSH 会话输入框上方放一块 **Agent Teams 可视化画布**：队长居中、成员在下、任务按依赖深度分泳道排列，中间用 **SVG 贝塞尔虚线**画出「谁依赖谁」和「谁正在做哪个任务」。

CC-haha 桌面端的 Agent Teams 面板有一套很好用的视觉语言 —— 泳道底板、虚线总线、任务卡状态徽章。这个插件把那套布局搬到 DSH 的 Web UI 里，用的是原版几何常量与路径算法，不是照着重画的近似版本。

## 长什么样

```
┌──────────────────────────────────────────────────────────────┐
│ 🤖 Agent Teams  [tally-squad]  [实验特性]                     │
├──────────────────────────────────────────────────────────────┤
│  3/6        2         8          1                            │
│  并行执行    完成      进行中      待办                        │
├───────────────────────────────────┬──────────────────────────┤
│  1 · 团队 · 队长居中，成员在下       │  通讯            88 条    │
│                                   │  全部 | 报告 | 私信       │
│              🤖 team-lead         ├──────────────────────────┤
│          协调·等待汇报·收件箱 51    │  👩‍💻 frontend-dev  17:15  │
│    ┆        ┆        ┆        ┆   │  P1 已修，mobile.png...   │
│   👨‍💻       🧪       🔍       👩‍💻  │                          │
│ backend  qa-eng  reviewer  frontend│  🤖 team-lead      17:15  │
│                                   │  后端 8000 已停...        │
│  2 · 共享任务列表 · 按依赖排层 →    │                          │
│  ┌─无依赖·可立即做─┐┌─第2层─┐┌收尾┐│  👩‍💻 frontend-dev  17:14  │
│  │ #1 后端实现 ═══╪╪═▶#4  ││ #6 ││  你抓到的真实 bug...      │
│  │ #2 前端实现 ═══╪╪═▶#5  ││    ││                          │
│  │ #3 QA 阶段一 ✓  ││      ││    ││                          │
│  └────────────────┘└──────┘└────┘│                          │
├───────────────────────────────────┴──────────────────────────┤
│  ┄┄ 依赖未满足  ┄┄ 依赖已满足  ┄┄ 正在执行  ┄┄ 刚解锁  ┄┄ 飞行中 │
└──────────────────────────────────────────────────────────────┘
```

## 连线怎么画的

这是本插件的核心。四条连线各司其职：

| 连线 | 形状 | 虚线 | 含义 |
|---|---|---|---|
| **任务依赖** | 三次贝塞尔，前置任务右缘 → 后继任务左缘 | `7 7` | 满足时用负责人强调色并流动，未满足用边框色 |
| **队长总线** | 折线：队长脚下 → 横向总线 → 各成员顶部 | `6 6` | 汇报关系 |
| **成员 peer 总线** | 折线：成员脚下 → 横向总线 → 成员脚下 | `4 7` | 同级通讯 |
| **执行 tether** | 三次贝塞尔，成员脚下 → 任务顶部 | `8 6` | 正在执行该任务的成员，流动动画 |

依赖边的路径函数：

```js
function dependencyPath(from, to) {
  const fromX = from.x + TASK_WIDTH
  const fromY = from.y + TASK_HEIGHT / 2
  const toX   = to.x
  const toY   = to.y + TASK_HEIGHT / 2
  const middle = fromX + (toX - fromX) / 2
  return `M ${fromX},${fromY} C ${middle},${fromY} ${middle},${toY} ${toX - 5},${toY}`
}
```

泳道划分用「最长依赖路径」算深度，带环与缺失节点兜底：

```js
function depthOf(id) {
  if (depths.has(id)) return depths.get(id)
  if (visiting.has(id)) return 0          // 环 → 回退 0
  const task = byId.get(id)
  if (!task) return 0                      // 缺失节点 → 0
  visiting.add(id)
  const deps = task.blockedBy.filter(d => byId.has(d))
  const depth = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(depthOf))
  visiting.delete(id)
  depths.set(id, depth)
  return depth
}
```

卡片是普通 DOM 绝对定位，连线是叠在上面的一层 `<svg>`。两者共用同一组几何常量（`TASK_WIDTH` / `TASK_HEIGHT` / `LANE_TOP` / `MEMBER_PITCH` …），所以缩放和主题切换都不会错位。

## 安装

```sh
dsh plugin --profile desktop add dsh-team-canvas
```

重启 DSH，打开任意会话，输入框上方就会出现面板。

手动安装（本地开发）：

```sh
git clone https://github.com/lj100886/dsh-team-canvas.git
dsh plugin --profile desktop add file:/path/to/dsh-team-canvas
```

## 主题

主体配色全部走宿主主题 token，亮色/暗色自动跟随：

```
--dsw-alias-bg-layer-1/2/3     背景层次
--dsw-alias-border-l2          边框与虚线
--dsw-alias-label-primary/2/3  文字层次
--dsw-alias-state-business-primary  强调色
--dsw-alias-state-success-primary   完成态
```

**成员身份色是唯一的例外**：八名成员需要能一眼分辨，而宿主只给了一个强调色 token，凑不出八个可区分的值。所以色相固定（保证同一成员跨会话颜色稳定），饱和度与明度通过 `color-mix()` 从 `--tc-accent` 派生，亮暗主题切换时跟着走。这八个值以 `--tc-m0` … `--tc-m7` 声明在样式表里，`client.js` 只引用变量——因为成员色还要喂给 SVG 的 `stroke` 表现属性，而那个位置不接受 `color-mix()` 这类 CSS 函数，写进去会让连线整条消失。

## 兼容性

| 项 | 值 |
|---|---|
| DSH | `>=0.2.0` |
| 平台 | Web / Desktop |
| Node | `>=20.18` |
| 注入槽位 | `conversation.input.dock` |
| 客户端依赖 | `@deepseek-ai/dsh-client-ui-conversation` |

## 当前状态

**已实现**：完整布局引擎、四类 SVG 连线、状态徽章、通讯面板、亮暗主题、i18n（zh/en，两份词典键位一致）、**实时 Agent Teams 投影接入**。

数据来自当前会话的 `state.projectionsBySession[sessionId].values.agentTeam` 投影——roster、共享任务、依赖边、执行态都读它。会话里还没有团队时，回退到本会话的 `todo_write` 工作清单；两者都没有才显示空态。

**未接入**：团队消息流。投影目前不携带成员间的通讯记录，通讯面板显示的是占位空态。

## 开发自检

```sh
node scripts/check-locale.mjs    # zh/en/en.json 键位一致，且覆盖代码用到的全部键
node scripts/check-accents.mjs   # 成员色只经 var(--tc-mN) 解析，不把 color-mix 写进 stroke
```

两条都是纯静态检查，不联网、不依赖宿主。


## 致谢

布局常量、路径算法、泳道分层逻辑移植自 [cc-haha](https://github.com/NanmiCoder/cc-haha) 的 `desktop/src/components/agentTeams/`（MIT）。没有那套实现打底，这个插件不会长成这样。

## License

MIT
