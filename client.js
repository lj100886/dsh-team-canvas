/**
 * dsh-team-canvas — Agent Teams 可视化面板（Client 端）
 *
 * 布局算法与连线绘制移植自 cc-haha 开源实现：
 *   desktop/src/components/agentTeams/AgentTeamsCanvas.tsx
 *   desktop/src/components/agentTeams/agentTeamsModel.ts
 *
 * 核心做法：绝对定位画布 + 一层 SVG。卡片是 DOM，连线是 SVG path。
 * 依赖连线用三次贝塞尔从「前置任务右边缘」弯到「后继任务左边缘」，
 * 满足与否决定颜色与虚线样式——这正是 cc-haha 截图里那些虚线的来源。
 */
window.__ModuleLoader__.load({
  id: 'dsh-team-canvas',
  factory(require) {
    var React = require('react');
    var h = React.createElement;

    /* ---------------------------------------------------------------- *
     * 几何常量（cc-haha 原值）
     * ---------------------------------------------------------------- */
    var FORMATION_TITLE_Y = 8;
    var TASKS_TITLE_Y = 388;
    var LEAD_TOP = 20;
    var LEAD_FOOT = 150;
    var LEAD_BUS_Y = 196;
    var MEMBER_TOP = 222;
    var MEMBER_FOOT = 352;
    var PEER_BUS_Y = 372;
    var MEMBER_PITCH = 190;
    var MEMBER_SLOT_WIDTH = 176;
    var TASK_WIDTH = 200;
    var TASK_HEIGHT = 92;
    var LANE_TOP = 410;
    var LANE_WIDTH = 216;
    var LANE_GAP = 16;
    var HORIZONTAL_PADDING = 20;
    var ROW_GAP = 14;
    var TASK_TOP = 448;
    var CANVAS_BOTTOM_PADDING = 24;

    /* ---------------------------------------------------------------- *
     * 演示数据。字段名与 DSH Agent Teams 投影一致，便于后续接真实数据。
     * ---------------------------------------------------------------- */
    var TEAM_NAME = 'tally-squad';

    var MEMBERS = [
      { id: 'team-lead', name: 'team-lead', avatar: '🤖', isLead: true, state: 'idle', accent: '#2563eb', inbox: 51 },
      { id: 'backend-dev', name: 'backend-dev', avatar: '👨‍💻', isLead: false, state: 'working', accent: '#0891b2', inbox: 4 },
      { id: 'qa-engineer', name: 'qa-engineer', avatar: '🧪', isLead: false, state: 'working', accent: '#7c3aed', inbox: 6 },
      { id: 'reviewer', name: 'reviewer', avatar: '🔍', isLead: false, state: 'working', accent: '#dc2626', inbox: 3 },
      { id: 'frontend-dev', name: 'frontend-dev', avatar: '👩‍💻', isLead: false, state: 'working', accent: '#16a34a', inbox: 5 }
    ];

    var TASKS = [
      { id: '1', title: '后端实现: FastAPI', owner: 'backend-dev', status: 'completed', blockedBy: [] },
      { id: '2', title: '前端实现: React+Vite', owner: 'frontend-dev', status: 'completed', blockedBy: [] },
      { id: '3', title: 'QA 阶段一: 契约一致性测试套件', owner: 'qa-engineer', status: 'completed', blockedBy: ['1'] },
      { id: '4', title: 'QA 阶段二: 端到端验证与缺陷报', owner: 'qa-engineer', status: 'in_progress', blockedBy: ['1'] },
      { id: '5', title: '审阅: 代码质量 + UI/UX 与无障碍', owner: 'reviewer', status: 'in_progress', blockedBy: ['2'] },
      { id: '6', title: '集成验收与交付 (team-lead)', owner: 'team-lead', status: 'pending', blockedBy: ['4', '5'] }
    ];

    var MESSAGES = [
      { from: 'frontend-dev', avatar: '👩‍💻', text: 'P1 已修，mobile.png 已部署到 review', time: '17:15', long: false },
      { from: 'frontend-dev', avatar: '👩‍💻', text: '修法（选了方案二，保留信息）：TaskRow 的 wrap 移动，sm 以上恢复 flex-row', time: '17:15', long: true },
      { from: 'team-lead', avatar: '🤖', text: '展示：后端 8000 已停（连接拒绝），QA/reviewer 等会连不上真实接口', time: '17:15', long: false },
      { from: 'frontend-dev', avatar: '👩‍💻', text: '你抓到的真实 bug，已修复。拆成两层说清楚：【已修复】行标题 overdue 判定与契约不一致', time: '17:14', long: true },
      { from: 'team-lead', avatar: '🤖', text: 'QA 的 P1-2（拖拽不流畅）我核实了，它的根因分析正确', time: '17:14', long: false }
    ];

    /* ---------------------------------------------------------------- *
     * 依赖深度：最长依赖路径，带环与缺失节点的确定性兜底
     * （agentTeamsModel.ts taskDepths 移植）
     * ---------------------------------------------------------------- */
    function compareTaskIds(a, b) {
      return String(a).localeCompare(String(b), undefined, { numeric: true });
    }

    function taskDepths(tasks) {
      var byId = new Map();
      tasks.forEach(function (task) { byId.set(task.id, task); });
      var depths = new Map();
      var visiting = new Set();

      function depthOf(id) {
        if (depths.has(id)) return depths.get(id);
        if (visiting.has(id)) return 0;
        var task = byId.get(id);
        if (!task) return 0;
        visiting.add(id);
        var deps = task.blockedBy.filter(function (d) { return byId.has(d); });
        var depth = deps.length === 0 ? 0 : 1 + Math.max.apply(null, deps.map(depthOf));
        visiting.delete(id);
        depths.set(id, depth);
        return depth;
      }

      tasks.forEach(function (task) { depthOf(task.id); });
      return depths;
    }

    /* ---------------------------------------------------------------- *
     * 任务布局（layoutWorkbenchTasks 移植）：按深度分泳道，泳道内按行堆叠
     * ---------------------------------------------------------------- */
    function layoutTasks(tasks, requestedWidth) {
      var sorted = tasks.slice().sort(function (a, b) {
        return compareTaskIds(a.id, b.id);
      });
      var depths = taskDepths(sorted);
      var byLayer = new Map();

      sorted.forEach(function (task) {
        var depth = depths.get(task.id) || 0;
        if (!byLayer.has(depth)) byLayer.set(depth, []);
        byLayer.get(depth).push(task);
      });

      var columns = sorted.length === 0
        ? 0
        : Math.max.apply(null, Array.from(depths.values())) + 1;
      var naturalWidth = HORIZONTAL_PADDING * 2
        + columns * LANE_WIDTH
        + Math.max(0, columns - 1) * LANE_GAP;
      var width = Math.max(naturalWidth, requestedWidth || 0);
      var startX = (width - naturalWidth) / 2 + HORIZONTAL_PADDING;

      var maxRows = 0;
      byLayer.forEach(function (layer) { maxRows = Math.max(maxRows, layer.length); });
      var stackHeight = maxRows === 0 ? 0 : maxRows * TASK_HEIGHT + (maxRows - 1) * ROW_GAP;
      var laneHeight = (TASK_TOP - LANE_TOP) * 2 + stackHeight;

      var lanes = [];
      for (var d = 0; d < columns; d += 1) {
        lanes.push({
          depth: d,
          x: startX + d * (LANE_WIDTH + LANE_GAP),
          y: LANE_TOP,
          width: LANE_WIDTH,
          height: laneHeight,
          count: (byLayer.get(d) || []).length
        });
      }

      var positioned = [];
      lanes.forEach(function (lane) {
        (byLayer.get(lane.depth) || []).forEach(function (task, row) {
          positioned.push({
            task: task,
            depth: lane.depth,
            row: row,
            x: lane.x + (LANE_WIDTH - TASK_WIDTH) / 2,
            y: TASK_TOP + row * (TASK_HEIGHT + ROW_GAP)
          });
        });
      });

      var byId = new Map();
      positioned.forEach(function (p) { byId.set(p.task.id, p); });

      return {
        tasks: positioned,
        byId: byId,
        lanes: lanes,
        width: width,
        height: LANE_TOP + laneHeight + CANVAS_BOTTOM_PADDING,
        columns: columns
      };
    }

    /* ---------------------------------------------------------------- *
     * SVG 路径
     * ---------------------------------------------------------------- */

    /** 依赖边：从前置任务右边缘，S 形弯到后继任务左边缘。 */
    function dependencyPath(from, to) {
      var fromX = from.x + TASK_WIDTH;
      var fromY = from.y + TASK_HEIGHT / 2;
      var toX = to.x;
      var toY = to.y + TASK_HEIGHT / 2;
      var middle = fromX + (toX - fromX) / 2;
      return 'M ' + fromX + ',' + fromY
        + ' C ' + middle + ',' + fromY + ' ' + middle + ',' + toY + ' ' + (toX - 5) + ',' + toY;
    }

    /** 成员 → 正在执行的任务：从成员脚下弯到任务顶部。 */
    function cubicTether(memberX, task) {
      var taskX = task.x + TASK_WIDTH / 2;
      return 'M ' + memberX + ',' + MEMBER_FOOT
        + ' C ' + memberX + ',' + (MEMBER_FOOT + 60) + ' '
        + taskX + ',' + (task.y - 50) + ' ' + taskX + ',' + task.y;
    }

    function polyline(points) {
      return points.map(function (point, index) {
        return (index === 0 ? 'M ' : 'L ') + point[0] + ',' + point[1];
      }).join(' ');
    }

    /* ---------------------------------------------------------------- *
     * 样式
     * ---------------------------------------------------------------- */
    var CSS = ''
      + '.tc-root{--tc-bg:var(--dsw-alias-bg-layer-1,#fff);'
      + '--tc-bg2:var(--dsw-alias-bg-layer-2,#f5f6f8);'
      + '--tc-bg3:var(--dsw-alias-bg-layer-3,#eceef2);'
      + '--tc-line:var(--dsw-alias-border-l2,#dce2eb);'
      + '--tc-strong:var(--dsw-alias-border-l3,#b9c2d0);'
      + '--tc-text:var(--dsw-alias-label-primary,#1a1a2e);'
      + '--tc-text2:var(--dsw-alias-label-secondary,#5b6472);'
      + '--tc-text3:var(--dsw-alias-label-tertiary,#8b93a1);'
      + '--tc-accent:var(--dsw-alias-state-business-primary,#3964fe);'
      + '--tc-ok:var(--dsw-alias-state-success-primary,#16a34a);'
      + '--tc-warn:var(--dsw-alias-state-warning-primary,#d97706);'
      + 'border:1px solid var(--tc-line);border-radius:12px;background:var(--tc-bg);'
      + 'color:var(--tc-text);font-size:13px;line-height:1.5;overflow:hidden;margin:8px 0}'
      + '.tc-root *{box-sizing:border-box;min-width:0}'
      + '.tc-bar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--tc-line);flex-wrap:wrap}'
      + '.tc-bar h3{margin:0;font-size:13px;font-weight:700;display:flex;align-items:center;gap:7px}'
      + '.tc-tag{font-size:10px;padding:1px 7px;border-radius:999px;background:var(--tc-accent);color:#fff;font-weight:500}'
      + '.tc-tag.warn{background:var(--tc-warn)}'
      + '.tc-bar .grow{flex:1}'
      + '.tc-btn{border:1px solid var(--tc-line);background:var(--tc-bg);color:var(--tc-text);'
      + 'border-radius:6px;padding:3px 10px;font:inherit;font-size:11px;font-weight:600;cursor:pointer}'
      + '.tc-btn:hover{border-color:var(--tc-strong)}'
      + '.tc-btn.primary{background:var(--tc-accent);border-color:var(--tc-accent);color:#fff}'
      + '.tc-sum{display:flex;border-bottom:1px solid var(--tc-line);background:var(--tc-bg2)}'
      + '.tc-sum div{flex:1;padding:6px 8px;text-align:center;border-right:1px solid var(--tc-line)}'
      + '.tc-sum div:last-child{border-right:none}'
      + '.tc-sum b{display:block;font-size:17px;font-weight:700;line-height:1.2}'
      + '.tc-sum span{font-size:10px;color:var(--tc-text3)}'
      + '.tc-body{display:flex;align-items:stretch;max-height:520px}'
      + '.tc-canvasbox{flex:1;min-width:0;overflow:auto}'
      + '.tc-canvas{position:relative}'
      + '.tc-svg{position:absolute;left:0;top:0;pointer-events:none}'
      + '.tc-person{position:absolute;width:176px;display:flex;flex-direction:column;'
      + 'align-items:center;gap:1px;padding:2px;z-index:10}'
      + '.tc-avatar{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;'
      + 'justify-content:center;font-size:23px;background:var(--tc-bg);'
      + 'border:2px solid var(--tc-line);position:relative}'
      + '.tc-person.lead .tc-avatar{width:58px;height:58px;font-size:29px;'
      + 'border-color:var(--tc-accent);box-shadow:0 0 0 3px rgba(57,100,254,.12)}'
      + '.tc-dot{position:absolute;right:-2px;bottom:-2px;width:12px;height:12px;border-radius:50%;'
      + 'border:2px solid var(--tc-bg);background:var(--tc-accent)}'
      + '.tc-dot.idle{background:var(--tc-text3)}'
      + '.tc-pname{font-size:11px;font-weight:600;text-align:center;max-width:170px;'
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '.tc-pstate{font-size:10px;color:var(--tc-accent);text-align:center;'
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px}'
      + '.tc-pstate.idle{color:var(--tc-text3)}'
      + '.tc-chips{display:flex;gap:3px;flex-wrap:wrap;justify-content:center}'
      + '.tc-chip{font-size:9px;padding:0 5px;border-radius:999px;'
      + 'border:1px solid var(--tc-line);color:var(--tc-text2);background:var(--tc-bg)}'
      + '.tc-chip.done{border-color:var(--tc-ok);color:var(--tc-ok)}'
      + '.tc-task{position:absolute;width:200px;height:92px;display:flex;flex-direction:column;'
      + 'gap:4px;border:1px solid var(--tc-line);border-radius:8px;padding:8px 9px;'
      + 'background:var(--tc-bg);z-index:10}'
      + '.tc-task.done{border-style:dashed;opacity:.72}'
      + '.tc-task.running{border-color:var(--tc-accent);box-shadow:0 0 0 1px rgba(57,100,254,.1)}'
      + '.tc-task.blocked{opacity:.72}'
      + '.tc-tnum{font-size:9px;font-weight:700;color:var(--tc-text3)}'
      + '.tc-ttitle{font-size:12px;font-weight:500;line-height:1.35;flex:1;min-height:0;'
      + 'overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;'
      + 'padding-right:36px}'
      + '.tc-towner{font-size:9px;color:var(--tc-text2);display:flex;align-items:center;gap:4px;'
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '.tc-tbadge{position:absolute;top:7px;right:7px;font-size:8px;font-weight:700;'
      + 'padding:1px 5px;border-radius:4px;color:#fff;background:var(--tc-text3)}'
      + '.tc-tbadge.done{background:var(--tc-ok)}'
      + '.tc-tbadge.running{background:var(--tc-accent)}'
      + '.tc-tbadge.blocked{background:var(--tc-warn)}'
      + '.tc-lane{position:absolute;z-index:20;font-size:11px;font-weight:600;color:var(--tc-text3);'
      + 'white-space:nowrap;display:flex;align-items:center;gap:6px}'
      + '.tc-lane em{font-style:normal;font-size:9px;font-weight:400;'
      + 'background:var(--tc-bg3);padding:0 5px;border-radius:8px}'
      + '.tc-sectitle{position:absolute;left:14px;z-index:20;font-size:11px;font-weight:600;color:var(--tc-text3)}'
      + '.tc-legend{display:flex;gap:16px;padding:8px 14px;border-top:1px solid var(--tc-line);'
      + 'background:var(--tc-bg2);flex-wrap:wrap;font-size:10px;color:var(--tc-text2)}'
      + '.tc-legend i{display:inline-flex;align-items:center;gap:5px;font-style:normal}'
      + '.tc-chat{width:310px;flex:none;border-left:1px solid var(--tc-line);display:flex;'
      + 'flex-direction:column;background:var(--tc-bg)}'
      + '.tc-chat h4{margin:0;padding:9px 12px;border-bottom:1px solid var(--tc-line);'
      + 'font-size:12px;font-weight:700;display:flex;justify-content:space-between;align-items:center}'
      + '.tc-chat h4 em{font-style:normal;font-size:10px;font-weight:500;color:var(--tc-text3)}'
      + '.tc-tabs{display:flex;gap:3px;padding:6px 10px;border-bottom:1px solid var(--tc-line);background:var(--tc-bg2)}'
      + '.tc-tabs button{font:inherit;font-size:10px;font-weight:500;padding:2px 9px;border-radius:6px;'
      + 'border:none;background:transparent;color:var(--tc-text2);cursor:pointer}'
      + '.tc-tabs button.on{background:var(--tc-accent);color:#fff}'
      + '.tc-msgs{flex:1;overflow-y:auto;padding:9px 11px}'
      + '.tc-msg{margin-bottom:10px;padding:6px 8px;border-radius:8px;background:var(--tc-bg2);'
      + 'border:1px solid transparent}'
      + '.tc-msg .mh{display:flex;align-items:center;gap:5px;margin-bottom:2px}'
      + '.tc-msg .ma{font-size:14px;line-height:1}'
      + '.tc-msg .mf{font-size:10px;font-weight:700;color:var(--tc-accent)}'
      + '.tc-msg .mt{font-size:9px;color:var(--tc-text3);margin-left:auto}'
      + '.tc-msg .mx{font-size:11px;line-height:1.5;padding-left:19px}'
      + '.tc-msg .mx.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'
      + '.tc-msg .me{display:inline-block;margin:3px 0 0 19px;font-size:9px;font-weight:500;'
      + 'padding:1px 6px;border-radius:4px;background:rgba(57,100,254,.09);color:var(--tc-accent);cursor:pointer}'
      + '.tc-empty{padding:28px;text-align:center;color:var(--tc-text3);font-size:12px}'
      + '@keyframes tc-flow{to{stroke-dashoffset:-28}}'
      + '.tc-flow{animation:tc-flow 1.1s linear infinite}'
      + '@keyframes tc-unlock{0%,100%{opacity:1}50%{opacity:.45}}'
      + '.tc-unlock{animation:tc-unlock 1.4s ease-in-out 2}';

    /* ---------------------------------------------------------------- *
     * 组件
     * ---------------------------------------------------------------- */
    function TeamCanvas(props) {
      var t = props.t;
      var openPair = React.useState(false);
      var open = openPair[0];
      var setOpen = openPair[1];

      var expandedPair = React.useState({});
      var expanded = expandedPair[0];
      var setExpanded = expandedPair[1];

      var layout = React.useMemo(function () {
        return layoutTasks(TASKS, 0);
      }, []);

      var memberPositions = React.useMemo(function () {
        var lead = null;
        var workers = [];
        MEMBERS.forEach(function (m) {
          if (m.isLead) lead = m; else workers.push(m);
        });
        var centerX = layout.width / 2;
        var list = [];
        if (lead) {
          list.push({ member: lead, isLead: true, centerX: centerX, top: LEAD_TOP });
        }
        var span = workers.length * MEMBER_PITCH;
        var first = centerX - span / 2 + MEMBER_PITCH / 2;
        workers.forEach(function (m, i) {
          list.push({ member: m, isLead: false, centerX: first + i * MEMBER_PITCH, top: MEMBER_TOP });
        });
        return list;
      }, [layout.width]);

      var stats = React.useMemo(function () {
        var completed = TASKS.filter(function (x) { return x.status === 'completed'; }).length;
        var running = TASKS.filter(function (x) { return x.status === 'in_progress'; }).length;
        var pending = TASKS.filter(function (x) { return x.status === 'pending' || x.status === 'blocked'; }).length;
        var working = MEMBERS.filter(function (m) { return m.state === 'working'; }).length;
        return {
          completed: completed,
          running: running,
          pending: pending,
          parallel: working + '/' + MEMBERS.length
        };
      }, []);

      var maxDepth = 0;
      layout.lanes.forEach(function (lane) { maxDepth = Math.max(maxDepth, lane.depth); });

      function toggleMessage(index) {
        setExpanded(function (prev) {
          var next = Object.assign({}, prev);
          next[index] = !next[index];
          return next;
        });
      }

      /* ---------- 顶部条 ---------- */
      var bar = h('div', { className: 'tc-bar' },
        h('h3', null,
          h('span', { style: { fontSize: '15px' } }, '🤖'),
          t('title'),
          h('span', { className: 'tc-tag' }, TEAM_NAME),
          h('span', { className: 'tc-tag warn' }, t('experimental'))
        ),
        h('span', { className: 'grow' }),
        h('button', { type: 'button', className: 'tc-btn', onClick: function () { setOpen(!open); } },
          open ? t('close') : t('openPanel'))
      );

      if (!open) {
        return h('div', { className: 'tc-root' },
          h('style', null, CSS),
          bar
        );
      }

      /* ---------- 统计条 ---------- */
      var summary = h('div', { className: 'tc-sum' },
        h('div', null, h('b', null, stats.parallel), h('span', null, t('parallel'))),
        h('div', null, h('b', null, stats.completed), h('span', null, t('completed'))),
        h('div', null, h('b', null, stats.running), h('span', null, t('inProgress'))),
        h('div', null, h('b', null, stats.pending), h('span', null, t('pending')))
      );

      /* ---------- SVG 层：所有连线 ---------- */
      var svgChildren = [];

      // 泳道底板
      layout.lanes.forEach(function (lane, index) {
        svgChildren.push(h('rect', {
          key: 'lane-' + lane.depth,
          x: lane.x,
          y: lane.y,
          width: lane.width,
          height: lane.height,
          rx: 14,
          fill: index % 2 === 0 ? 'var(--tc-bg2)' : 'var(--tc-bg3)',
          fillOpacity: 0.62,
          stroke: 'var(--tc-line)'
        }));
        svgChildren.push(h('path', {
          key: 'laneline-' + lane.depth,
          d: 'M ' + (lane.x + 12) + ',436 L ' + (lane.x + lane.width - 12) + ',436',
          stroke: 'var(--tc-line)',
          fill: 'none'
        }));
      });

      // 队长 → 成员总线
      var leadPos = memberPositions[0];
      var workerPos = memberPositions.slice(1);
      if (leadPos && workerPos.length > 0) {
        svgChildren.push(h('path', {
          key: 'lead-stem',
          d: 'M ' + leadPos.centerX + ',' + LEAD_FOOT + ' L ' + leadPos.centerX + ',' + LEAD_BUS_Y,
          fill: 'none', stroke: 'var(--tc-line)', strokeWidth: 2, strokeDasharray: '6 6'
        }));
        svgChildren.push(h('path', {
          key: 'lead-bus',
          d: 'M ' + workerPos[0].centerX + ',' + LEAD_BUS_Y
            + ' L ' + workerPos[workerPos.length - 1].centerX + ',' + LEAD_BUS_Y,
          fill: 'none', stroke: 'var(--tc-line)', strokeWidth: 2, strokeDasharray: '6 6'
        }));
        workerPos.forEach(function (p) {
          svgChildren.push(h('path', {
            key: 'lead-drop-' + p.member.id,
            d: 'M ' + p.centerX + ',' + LEAD_BUS_Y + ' L ' + p.centerX + ',' + MEMBER_TOP,
            fill: 'none', stroke: 'var(--tc-line)', strokeWidth: 2, strokeDasharray: '6 6'
          }));
        });
      }

      // 成员之间 peer 总线
      if (workerPos.length > 1) {
        svgChildren.push(h('path', {
          key: 'peer-bus',
          d: 'M ' + workerPos[0].centerX + ',' + MEMBER_FOOT
            + ' L ' + workerPos[0].centerX + ',' + PEER_BUS_Y
            + ' L ' + workerPos[workerPos.length - 1].centerX + ',' + PEER_BUS_Y
            + ' L ' + workerPos[workerPos.length - 1].centerX + ',' + MEMBER_FOOT,
          fill: 'none', stroke: 'var(--tc-line)', strokeWidth: 2, strokeDasharray: '4 7'
        }));
        workerPos.slice(1, -1).forEach(function (p) {
          svgChildren.push(h('path', {
            key: 'peer-drop-' + p.member.id,
            d: 'M ' + p.centerX + ',' + MEMBER_FOOT + ' L ' + p.centerX + ',' + PEER_BUS_Y,
            fill: 'none', stroke: 'var(--tc-line)', strokeWidth: 2, strokeDasharray: '4 7'
          }));
        });
      }

      // ★ 任务依赖连线：每个 blockedBy 一条贝塞尔曲线 + 终点圆点
      layout.tasks.forEach(function (to) {
        to.task.blockedBy.forEach(function (depId) {
          var from = layout.byId.get(depId);
          if (!from) return;
          var satisfied = from.task.status === 'completed';
          var owner = null;
          MEMBERS.forEach(function (m) { if (m.id === from.task.owner) owner = m; });
          var color = satisfied
            ? (owner ? owner.accent : 'var(--tc-text2)')
            : 'var(--tc-line)';
          svgChildren.push(h('path', {
            key: 'dep-' + depId + '-' + to.task.id,
            d: dependencyPath(from, to),
            fill: 'none',
            stroke: color,
            strokeWidth: 2,
            strokeDasharray: '7 7',
            opacity: satisfied ? 0.95 : 0.8,
            className: satisfied ? 'tc-flow' : undefined
          }));
          svgChildren.push(h('circle', {
            key: 'depdot-' + depId + '-' + to.task.id,
            cx: to.x - 4,
            cy: to.y + TASK_HEIGHT / 2,
            r: 3.2,
            fill: color
          }));
        });
      });

      // ★ 成员 → 正在执行的任务（tether）
      layout.tasks.forEach(function (p) {
        if (p.task.status !== 'in_progress') return;
        var mp = null;
        memberPositions.forEach(function (m) { if (m.member.id === p.task.owner) mp = m; });
        if (!mp) return;
        svgChildren.push(h('path', {
          key: 'tether-' + p.task.id,
          d: cubicTether(mp.centerX, p),
          fill: 'none',
          stroke: mp.member.accent,
          strokeWidth: 2.5,
          strokeDasharray: '8 6',
          className: 'tc-flow'
        }));
      });

      var svg = h('svg', {
        className: 'tc-svg',
        width: layout.width,
        height: layout.height,
        'aria-hidden': 'true'
      }, svgChildren);

      /* ---------- 区块标题 ---------- */
      var titles = [
        h('div', {
          key: 'title-team',
          className: 'tc-sectitle',
          style: { top: FORMATION_TITLE_Y + 'px' }
        }, '1 · ' + t('team') + ' · ' + t('teamHint')),
        h('div', {
          key: 'title-tasks',
          className: 'tc-sectitle',
          style: { top: TASKS_TITLE_Y + 'px' }
        }, '2 · ' + t('tasks') + ' · ' + t('tasksHint'))
      ];

      /* ---------- 泳道标题 ---------- */
      var laneTitles = layout.lanes.map(function (lane) {
        var label = lane.depth === 0
          ? t('laneNoDeps')
          : lane.depth === maxDepth
            ? t('laneFinal')
            : t('laneDepth').replace('{layer}', String(lane.depth + 1));
        var done = layout.tasks.filter(function (p) {
          return p.depth === lane.depth && p.task.status === 'completed';
        }).length;
        return h('div', {
          key: 'lane-title-' + lane.depth,
          className: 'tc-lane',
          style: { left: lane.x + 'px', top: (LANE_TOP + 8) + 'px', width: lane.width + 'px' }
        }, label, h('em', null, done + '/' + lane.count));
      });

      /* ---------- 成员卡片 ---------- */
      var memberCards = memberPositions.map(function (p) {
        var owned = TASKS.filter(function (x) { return x.owner === p.member.id; });
        var chips = owned.slice(-3).map(function (x) {
          return h('span', {
            key: 'chip-' + x.id,
            className: 'tc-chip' + (x.status === 'completed' ? ' done' : '')
          }, '#' + x.id);
        });
        var stateText = p.isLead
          ? t('coordinating') + ' · ' + t('inbox') + ' ' + p.member.inbox
          : (p.member.state === 'working' ? t('stateWorking') : t('stateIdle'));
        return h('div', {
          key: 'member-' + p.member.id,
          className: 'tc-person' + (p.isLead ? ' lead' : ''),
          style: {
            left: (p.centerX - MEMBER_SLOT_WIDTH / 2) + 'px',
            top: p.top + 'px'
          }
        },
          h('div', { className: 'tc-avatar' },
            p.member.avatar,
            h('div', {
              className: 'tc-dot' + (p.member.state === 'working' ? '' : ' idle')
            })
          ),
          h('div', { className: 'tc-pname' }, p.member.name),
          h('div', {
            className: 'tc-pstate' + (p.member.state === 'working' || p.isLead ? '' : ' idle')
          }, stateText),
          h('div', { className: 'tc-chips' }, chips)
        );
      });

      /* ---------- 任务卡片 ---------- */
      var statusLabel = {
        completed: t('taskCompleted'),
        in_progress: t('taskInProgress'),
        blocked: t('taskBlocked'),
        pending: t('taskPending')
      };
      var statusClass = {
        completed: 'done',
        in_progress: 'running',
        blocked: 'blocked',
        pending: ''
      };

      var taskCards = layout.tasks.map(function (p) {
        var owner = null;
        MEMBERS.forEach(function (m) { if (m.id === p.task.owner) owner = m; });
        var cls = statusClass[p.task.status] || '';
        return h('div', {
          key: 'task-' + p.task.id,
          className: 'tc-task ' + cls,
          style: { left: p.x + 'px', top: p.y + 'px' }
        },
          h('div', { className: 'tc-tbadge ' + cls }, statusLabel[p.task.status] || ''),
          h('div', { className: 'tc-tnum' }, '#' + p.task.id),
          h('div', { className: 'tc-ttitle' }, p.task.title),
          h('div', { className: 'tc-towner' },
            h('span', null, owner ? owner.avatar : '👤'),
            p.task.owner
          )
        );
      });

      var canvas = h('div', {
        className: 'tc-canvas',
        style: { width: layout.width + 'px', height: layout.height + 'px' }
      }, [svg].concat(titles, laneTitles, memberCards, taskCards));

      /* ---------- 图例 ---------- */
      function legendLine(color, dash, width) {
        return h('svg', { width: 26, height: 6 },
          h('path', {
            d: 'M 0,3 L 26,3',
            stroke: color,
            strokeWidth: width || 2,
            strokeDasharray: dash,
            fill: 'none'
          })
        );
      }

      var legend = h('div', { className: 'tc-legend' },
        h('i', null, legendLine('var(--tc-line)', '7 7'), t('legendUnsatisfied')),
        h('i', null, legendLine('var(--tc-text2)', '7 7'), t('legendSatisfied')),
        h('i', null, legendLine('var(--tc-accent)', '8 6', 2.5), t('legendActive')),
        h('i', null, legendLine('var(--tc-ok)', '7 7', 3), t('legendUnlocked')),
        h('i', null, legendLine('var(--tc-text3)', '4 7'), t('legendFlight'))
      );

      /* ---------- 通讯面板 ---------- */
      var messages = MESSAGES.map(function (msg, index) {
        var isExpanded = expanded[index] === true;
        return h('div', { key: 'msg-' + index, className: 'tc-msg' },
          h('div', { className: 'mh' },
            h('span', { className: 'ma' }, msg.avatar),
            h('span', { className: 'mf' }, msg.from),
            h('span', { className: 'mt' }, msg.time)
          ),
          h('div', { className: 'mx' + (msg.long && !isExpanded ? ' clamp' : '') }, msg.text),
          msg.long
            ? h('span', { className: 'me', onClick: function () { toggleMessage(index); } },
                isExpanded ? t('collapse') : t('expand'))
            : null
        );
      });

      var chat = h('div', { className: 'tc-chat' },
        h('h4', null, h('span', null, t('communication')), h('em', null, MESSAGES.length + ' ' + t('messages'))),
        h('div', { className: 'tc-tabs' },
          h('button', { type: 'button', className: 'on' }, t('tabAll')),
          h('button', { type: 'button' }, t('tabReports')),
          h('button', { type: 'button' }, t('tabMessages'))
        ),
        h('div', { className: 'tc-msgs' }, messages)
      );

      return h('div', { className: 'tc-root' },
        h('style', null, CSS),
        bar,
        summary,
        h('div', { className: 'tc-body' },
          h('div', { className: 'tc-canvasbox' }, canvas),
          chat
        ),
        legend
      );
    }

    /* ---------------------------------------------------------------- *
     * 插件入口
     * ---------------------------------------------------------------- */
    var NS = 'team-canvas';
    var ZH = {
      title: 'Agent Teams',
      experimental: '实验特性',
      openPanel: '展开面板',
      close: '收起面板',
      team: '团队',
      teamHint: '队长居中，成员在下',
      tasks: '共享任务列表',
      tasksHint: '按依赖排层，左 → 右',
      laneNoDeps: '无依赖 · 可立即做',
      laneDepth: '第 {layer} 层',
      laneFinal: '收尾',
      stateWorking: '工作中',
      stateIdle: '空闲',
      taskCompleted: '完成',
      taskInProgress: '执行中',
      taskBlocked: '阻塞',
      taskPending: '待办',
      parallel: '并行执行',
      completed: '完成',
      inProgress: '进行中',
      pending: '待办',
      communication: '通讯',
      messages: '条',
      tabAll: '全部',
      tabReports: '报告',
      tabMessages: '私信',
      expand: '展开',
      collapse: '收起',
      legendUnsatisfied: '依赖未满足',
      legendSatisfied: '依赖已满足（满足下游）',
      legendActive: '成员正在执行该任务',
      legendUnlocked: '刚解锁',
      legendFlight: '飞行中的消息/认领',
      inbox: '收件箱',
      coordinating: '协调 · 等待汇报'
    };

    return {
      inject: ['slots', 'locale'],
      apply: function (ctx) {
        ctx.effect(function () {
          return ctx.locale.register(NS, 'zh', ZH);
        }, 'dsh-team-canvas: dictionary');
        ctx.effect(function () {
          return ctx.locale.register(NS, 'en', ZH);
        }, 'dsh-team-canvas: dictionary-en');

        var t = ctx.locale.bind(NS);

        ctx.slots.inject('conversation.input.dock', function () {
          return ctx.slots.register({
            name: 'conversation.input.dock',
            id: 'team-canvas',
            order: 60
          }, function () {
            return h(TeamCanvas, { t: t });
          });
        });
      }
    };
  }
});
