/* ============================================================
 * 网页元素消除器 Element Eraser · content script (v1.3)
 * 功能：
 *  1. 按站点读取隐藏规则并自动应用（刷新 / SPA 跳转均生效）
 *  2. 点选器：点击隐藏、Alt+滚轮选父级、ESC 退出、Shadow DOM 穿透
 *  3. 一条规则多候选选择器（语义 class / 位置路径…），SPA 换页仍可命中
 *  4. MutationObserver 兜底动态广告；隐藏动画（向上吸入折叠，可换风格）
 *  5. 撤销（Ctrl+Z / 弹窗按钮）、右键「隐藏此元素」、失效规则提示、
 *     规则定位闪烁、隐藏方式可选（display / visibility）
 * ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'eraser_rules_v1';
  var SETTINGS_KEY = 'eraser_settings_v1';
  var HIGHLIGHT_ID = '__eraser_highlight__';
  var HINT_ID = '__eraser_hint__';
  var CONFIRM_ID = '__eraser_confirm__';
  var INFO_ID = '__eraser_info__';
  var MAX_Z = 2147483647;

  var IN_FRAME = (function () {
    try { return window.self !== window.top; } catch (e) { return false; }
  })();

  /* ---------- 特效配置：想调手感只改这里 ---------- */
  var EFFECTS = {
    // 点选高亮蓝框
    pick: {
      rgb: '33,150,243',      // 颜色（RGB）
      alpha: .9,              // 边框最终透明度
      bgAlpha: .16,           // 填充最终透明度
      width: 2,               // 边框粗细 px
      radius: 3,              // 圆角 px
      fadeIn: 600             // 缓动亮起时长 ms
    },
    // 隐藏动画：style 可选 'collapse' | 'scale' | 'blur' | 'scan' | 'iris'
    hide: {
      style: 'collapse',      // collapse = 向上吸入折叠（默认，不留空隙）
      duration: 350,          // ms
      easing: 'ease'
    }
  };

  var host = location.hostname;
  var settings = { hideMode: 'display' }; // display=移除占位 | visibility=保留占位
  var rules = []; // [{ id, selectors:[...], label, createdAt }]，兼容旧格式 { selector }
  var picking = false;
  var confirmOpen = false;
  var current = null;
  var overlay = null;
  var overlayAnim = null;
  var hintEl = null;
  var observer = null;
  var applyTimer = null;
  var matchedIds = {};   // 最近一次 applyRules 命中过的规则 id
  var hitCounts = {};    // 最近一次 applyRules 每条规则命中的元素数
  var readyAt = Date.now();
  var lastHiddenAt = 0;  // 最近一次手动隐藏时间（用于 Ctrl+Z 宽限期）
  var lastContextTarget = null; // 右键菜单快速隐藏用
  var lastContextAt = 0;
  var currentRaw = null;  // 鼠标下的原始元素（用于判断是否换了目标）
  var infoEl = null;      // 元素信息卡

  /* ---------------- 存储 ---------------- */

  function loadRules() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORAGE_KEY, function (data) {
        var all = (data && data[STORAGE_KEY]) || {};
        rules = all[host] || [];
        resolve(rules);
      });
    });
  }

  function loadSettings() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(SETTINGS_KEY, function (data) {
        var s = (data && data[SETTINGS_KEY]) || {};
        settings.hideMode = s.hideMode === 'visibility' ? 'visibility' : 'display';
        resolve(settings);
      });
    });
  }

  function persist(cb) {
    chrome.storage.local.get(STORAGE_KEY, function (data) {
      var all = (data && data[STORAGE_KEY]) || {};
      all[host] = rules;
      var patch = {};
      patch[STORAGE_KEY] = all;
      chrome.storage.local.set(patch, cb);
    });
  }

  /* ---------------- 规则应用（含 Shadow DOM 穿透） ---------------- */

  function ruleSelectors(r) {
    return (r.selectors && r.selectors.length ? r.selectors : [r.selector]).filter(Boolean);
  }

  /** 收集 document + 所有 open shadow root（一次遍历，供本轮所有选择器复用） */
  function collectRoots() {
    var roots = [document];
    function walk(root) {
      var all;
      try { all = root.querySelectorAll('*'); } catch (e) { return; }
      for (var i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) {
          roots.push(all[i].shadowRoot);
          walk(all[i].shadowRoot);
        }
      }
    }
    walk(document);
    return roots;
  }

  function deepQueryAll(sel, roots) {
    var out = [];
    for (var k = 0; k < roots.length; k++) {
      try {
        var els = roots[k].querySelectorAll(sel);
        for (var i = 0; i < els.length; i++) out.push(els[i]);
      } catch (e) { /* 非法选择器忽略 */ }
    }
    return out;
  }

  function hideEl(el, ruleId) {
    if (settings.hideMode === 'visibility') {
      el.style.setProperty('visibility', 'hidden', 'important');
    } else {
      el.style.setProperty('display', 'none', 'important');
    }
    el.setAttribute('data-eraser-hidden', ruleId);
  }

  function applyRules() {
    var n = 0;
    matchedIds = {};
    hitCounts = {};
    var roots = collectRoots();
    for (var i = 0; i < rules.length; i++) {
      var sels = ruleSelectors(rules[i]);
      var hit = false;
      var seen = [];
      for (var s = 0; s < sels.length; s++) {
        var els = deepQueryAll(sels[s], roots);
        for (var j = 0; j < els.length; j++) {
          var el = els[j];
          // 作用域不符 → 不是这条规则要藏的东西（如评论区里同 class 的图片）
          if (rules[i].scope && !matchesScope(el, rules[i].scope)) continue;
          if (seen.indexOf(el) === -1) seen.push(el);
          if (el.getAttribute('data-eraser-hidden') === rules[i].id) { hit = true; continue; }
          hideEl(el, rules[i].id);
          hit = true;
          n++;
        }
      }
      if (hit) matchedIds[rules[i].id] = true;
      hitCounts[rules[i].id] = seen.length;
    }
    return n;
  }

  /** 把已不在规则里的元素恢复显示（删除/撤销规则时调用） */
  function reconcile() {
    var ids = {};
    rules.forEach(function (r) { ids[r.id] = true; });
    var hidden = document.querySelectorAll('[data-eraser-hidden]');
    for (var i = 0; i < hidden.length; i++) {
      if (!ids[hidden[i].getAttribute('data-eraser-hidden')]) {
        hidden[i].style.removeProperty('display');
        hidden[i].style.removeProperty('visibility');
        hidden[i].removeAttribute('data-eraser-hidden');
      }
    }
    applyRules();
  }

  function scheduleApply() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(applyRules, 250);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(scheduleApply);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // SPA 路由切换（同页跳转域名不变时靠 Observer，域名变化时重新加载规则）
    setInterval(function () {
      if (location.hostname !== host) {
        host = location.hostname;
        loadRules().then(applyRules);
      }
    }, 1000);
  }

  // popup / 导入 / 设置变更后本页面即时生效
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes[SETTINGS_KEY]) {
      var ns = changes[SETTINGS_KEY].newValue || {};
      settings.hideMode = ns.hideMode === 'visibility' ? 'visibility' : 'display';
      reconcile();
    }
    if (changes[STORAGE_KEY]) {
      var all = changes[STORAGE_KEY].newValue || {};
      rules = all[host] || [];
      reconcile();
    }
  });

  /* ---------------- 选择器生成（多候选） ---------------- */

  function isUnique(sel) {
    try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; }
  }

  function matchCount(sel) {
    try { return document.querySelectorAll(sel).length; } catch (e) { return 9999; }
  }

  /**
   * 判断 class 是否"稳定可复用"：排除构建工具生成的哈希类（css-1x2y3z 等），
   * 这类 class 换个视频/页面就变，写进选择器只会让规则失效。
   */
  function isStableClass(c) {
    if (!c || c.length < 3 || c.length > 40) return false;
    if (/^\d/.test(c)) return false;
    if (/[0-9a-f]{8,}/i.test(c)) return false;
    var digits = (c.match(/\d/g) || []).length;
    if (digits >= 2 && digits >= c.length * 0.2) return false;
    if (/^(css|sc|jss|style|chakra|Mui)[-_:]/i.test(c) && digits > 0) return false;
    return true;
  }

  function classesOf(el) {
    var out = [];
    for (var i = 0; i < el.classList.length && out.length < 3; i++) {
      var c = el.classList[i];
      if (isStableClass(c)) out.push(c);
    }
    return out;
  }

  /** 兜底：从根节点带 :nth-child 的完整路径（Shadow DOM 内元素路径会截断在 host 边界） */
  function fullPath(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1) {
      var sib = node, idx = 1;
      while ((sib = sib.previousElementSibling)) idx++;
      parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + idx + ')');
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  /** 带类名+位置的路径选择器 */
  function pathSelector(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      if (node.id && isUnique('#' + CSS.escape(node.id))) {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }
      var sel = node.tagName.toLowerCase();
      var cls = classesOf(node);
      sel += cls.map(function (c) { return '.' + CSS.escape(c); }).join('');
      var sib = node, idx = 1;
      while ((sib = sib.previousElementSibling)) {
        if (sib.tagName === node.tagName) idx++;
      }
      sel += ':nth-of-type(' + idx + ')';
      parts.unshift(sel);
      node = node.parentElement;
    }
    var out = parts.join(' > ');
    return out || fullPath(el);
  }

  /**
   * 候选选择器数组（从通用到精确，命中任意一条即隐藏）：
   *  1. 纯语义 class 选择器（跨视频/换页通用）
   *  2. class + 位置
   *  3. 稳定 id
   *  4. 类名+位置路径
   *  5. 完整 nth-child 路径兜底
   */
  function buildCandidates(el) {
    var cands = [];
    function push(s) {
      if (s && cands.indexOf(s) === -1) cands.push(s);
    }

    var stable = classesOf(el);
    if (stable.length) {
      var tag = el.tagName.toLowerCase();
      var loose = tag + stable.map(function (c) { return '.' + CSS.escape(c); }).join('');
      // 通用 class 选择器：命中数不多时才启用，防止误伤大量普通元素
      if (matchCount(loose) <= 20) push(loose);
      var sib = el, idx = 1;
      while ((sib = sib.previousElementSibling)) {
        if (sib.tagName === el.tagName) idx++;
      }
      push(loose + ':nth-of-type(' + idx + ')');
    }

    if (el.id && isStableClass(el.id) && isUnique('#' + CSS.escape(el.id))) {
      push('#' + CSS.escape(el.id));
    }

    push(pathSelector(el));
    push(fullPath(el));
    if (!cands.length) push(fullPath(el));
    return cands;
  }

  function labelOf(el) {
    var t = el.tagName.toLowerCase();
    if (el.id) t += '#' + el.id;
    var txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20);
    return t + (txt ? '「' + txt + '」' : '');
  }

  /* ---------------- 精准化：目标提升 / 作用域指纹 / 风险评估 ---------------- */

  // 常见广告语义（用于把"图片/文字"上提成真正的广告块）
  var AD_HINT = /(ad|ads|advert|advertisement|sponsor|sponsorize|promotion|promote|banner|creative|commercial|recommend|推广|广告)/i;
  // 纯内容元素：本身不该作为隐藏目标（其 class 常常与别处共用）
  var CONTENT_TAGS = {
    IMG: 1, SVG: 1, SPAN: 1, P: 1, I: 1, EM: 1, STRONG: 1, B: 1, TIME: 1,
    BR: 1, PATH: 1, G: 1, USE: 1, LABEL: 1, SMALL: 1, CITE: 1, Q: 1, A: 0
  };

  function hasAdHint(el) {
    if (!el) return false;
    var cls = (typeof el.className === 'string') ? el.className : '';
    var s = cls + ' ' + (el.id || '') + ' ' +
            (el.getAttribute('data-ad') || '') + ' ' + (el.getAttribute('aria-label') || '');
    return AD_HINT.test(s);
  }

  function hasRole(el) {
    if (!el || !el.getAttribute) return false;
    var r = el.getAttribute('role');
    return r === 'button' || r === 'link' || r === 'banner';
  }

  /** 目标体量评估（面积占比 / 文本量 / 子元素数） */
  function assess(el) {
    if (!el || el.nodeType !== 1) return { ratio: 0, textLen: 0, kids: 0, risky: false, rect: null };
    var r = el.getBoundingClientRect();
    var vw = window.innerWidth || 1200, vh = window.innerHeight || 800;
    var ratio = (r.width * r.height) / (vw * vh);
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    var kids = el.children.length;
    return {
      ratio: ratio,
      textLen: text.length,
      kids: kids,
      rect: r,
      risky: ratio > 0.3 || text.length > 800 || kids > 80
    };
  }

  /** 是否适合作为"隐藏目标"：不能太大、不能含大量正文 */
  function suitableTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    var a = assess(el);
    if (a.ratio > 0.4 || a.textLen > 900 || a.kids > 200) return false;
    var tag = el.tagName;
    if (tag === 'A' || hasAdHint(el) || hasRole(el)) return true;
    return !CONTENT_TAGS[tag];
  }

  function sizesSimilar(a, b) {
    if (!a || !b) return false;
    var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return ra.width <= rb.width * 1.6 && ra.height <= rb.height * 1.6;
  }

  /**
   * 智能目标提升：点到图片/文字时自动上移到真正的广告容器。
   * 这是"关广告把评论区一起带走"的根治点——原来存的是最内层 img 的 class，
   * 而这类 class 常常和评论区头像共用，规则一匹配就把评论区的图也藏了。
   */
  function pickTarget(el) {
    if (!el || el.nodeType !== 1) return el;
    var cur = el, hops = 0;
    while (cur && cur.nodeType === 1 && hops < 5) {
      if (suitableTarget(cur)) return cur;
      var p = cur.parentElement;
      if (p && p.nodeType === 1 && sizesSimilar(p, cur) && suitableTarget(p)) return p;
      cur = p;
      hops++;
    }
    return el;
  }

  /** 祖先链（用于信息卡展示） */
  function ancestorChain(el) {
    var parts = [], node = el.parentElement, depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth < 3) {
      var cls = classesOf(node);
      var seg = node.tagName.toLowerCase();
      if (cls.length) seg += '.' + cls[0];
      parts.unshift(seg);
      depth++;
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  /**
   * 作用域指纹：记录目标的祖先链（稳定 class）。
   * 规则匹配时若祖先链不符则跳过 —— 同 class 不同区域不再互相误伤。
   */
  function buildScope(el) {
    var parts = [], node = el.parentElement, depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth < 3) {
      var cls = classesOf(node);
      if (cls.length) {
        parts.unshift(node.tagName.toLowerCase() + '.' + CSS.escape(cls[0]));
        depth++;
      }
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function matchesSimple(el, part) {
    var m = /^([a-z0-9-]+)?(?:\.([^\s>.]+))?$/i.exec(part);
    if (!m) return false;
    if (m[1] && el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
    if (m[2]) {
      try { if (!el.matches(part)) return false; } catch (e) { return false; }
    }
    return true;
  }

  /** 宽松的祖先链匹配：允许中间隔着没有稳定 class 的节点 */
  function matchesScope(el, scope) {
    if (!scope) return true;
    var parts = scope.split(' > ');
    var node = el.parentElement, i = 0;
    while (node && node.nodeType === 1) {
      if (i < parts.length && matchesSimple(node, parts[i])) i++;
      node = node.parentElement;
    }
    return i >= parts.length;
  }

  /* ---------------- 隐藏动画（EFFECTS.hide.style 可切换风格） ---------------- */

  function collapseHide(el, done) {
    if (typeof done !== 'function') done = function () {};
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { done(); return; }
    if (r.height < 1) { done(); return; }

    var cs = getComputedStyle(el);
    var dur = EFFECTS.hide.duration, ez = EFFECTS.hide.easing;
    var isInline = cs.display === 'inline';
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      el.removeEventListener('transitionend', onEnd);
      try {
        if (settings.hideMode === 'visibility') el.style.setProperty('visibility', 'hidden', 'important');
        else el.style.display = 'none'; // 先隐藏，避免清样式瞬间闪回
        el.style.transition = '';
        el.style.overflow = '';
        el.style.height = '';
        el.style.marginTop = '';
        el.style.marginBottom = '';
        el.style.paddingTop = '';
        el.style.paddingBottom = '';
        el.style.opacity = '';
      } catch (e) { /* 忽略 */ }
      done();
    }
    function onEnd(ev) {
      if (ev.propertyName === 'height' || ev.propertyName === 'opacity') finish();
    }
    try {
      if (isInline) {
        el.style.transition = 'opacity ' + dur + 'ms ' + ez;
        el.style.opacity = '0';
      } else {
        el.style.overflow = 'hidden';
        el.style.height = r.height + 'px';
        el.style.marginTop = (parseFloat(cs.marginTop) || 0) + 'px';
        el.style.marginBottom = (parseFloat(cs.marginBottom) || 0) + 'px';
        el.style.paddingTop = cs.paddingTop;
        el.style.paddingBottom = cs.paddingBottom;
        void el.offsetHeight; // 强制重排，确立起始态
        el.style.transition =
          'height ' + dur + 'ms ' + ez + ', opacity ' + dur + 'ms ' + ez +
          ', margin ' + dur + 'ms ' + ez + ', padding ' + dur + 'ms ' + ez;
        el.style.height = '0px';
        el.style.marginTop = '0px';
        el.style.marginBottom = '0px';
        el.style.paddingTop = '0px';
        el.style.paddingBottom = '0px';
        el.style.opacity = '0';
      }
    } catch (e) { finish(); return; }
    el.addEventListener('transitionend', onEnd);
    setTimeout(finish, dur + 200); // 兜底
  }

  /** 统一入口：按 EFFECTS.hide.style 分发 */
  function animateHide(el, done) {
    if (typeof done !== 'function') done = function () {};
    var style = EFFECTS.hide.style;
    if (style === 'collapse') { collapseHide(el, done); return; }
    if (typeof el.animate !== 'function') { // 环境不支持 WAAPI：直接隐藏
      if (settings.hideMode === 'visibility') el.style.setProperty('visibility', 'hidden', 'important');
      else el.style.display = 'none';
      done();
      return;
    }

    var dur = Math.round(EFFECTS.hide.duration * 1.6);
    var frames = null;
    if (style === 'scale') {
      el.style.transformOrigin = 'center';
      frames = [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(.85)' }
      ];
    } else if (style === 'blur') {
      frames = [
        { opacity: 1, filter: 'blur(0px) brightness(1)' },
        { opacity: 0, filter: 'blur(12px) brightness(1.35)' }
      ];
    } else if (style === 'scan') {
      frames = [
        { clipPath: 'inset(0 0 0 0%)', opacity: 1 },
        { clipPath: 'inset(0 0 0 100%)', opacity: 0 }
      ];
    } else if (style === 'iris') {
      frames = [
        { clipPath: 'circle(150% at 50% 50%)', opacity: 1 },
        { clipPath: 'circle(0% at 50% 50%)', opacity: 0 }
      ];
    }
    if (!frames) { collapseHide(el, done); return; }

    var anim = el.animate(frames, { duration: dur, easing: EFFECTS.hide.easing, fill: 'forwards' });
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      try {
        if (settings.hideMode === 'visibility') el.style.setProperty('visibility', 'hidden', 'important');
        else el.style.display = 'none';
      } catch (e) { /* 忽略 */ }
      try { anim.cancel(); } catch (e) { /* 忽略 */ } // 取消 fill:forwards，避免恢复时残留
      try { el.style.transformOrigin = ''; } catch (e) { /* 忽略 */ }
      done();
    }
    if (anim.onfinish !== undefined) anim.onfinish = finish;
    setTimeout(finish, dur + 250); // 兜底
  }

  /* ---------------- 点选器 ---------------- */

  /** 穿透 Shadow DOM 的 elementFromPoint */
  function deepElementFromPoint(x, y) {
    var el = null;
    try { el = document.elementFromPoint(x, y); } catch (e) { return null; }
    var guard = 0;
    while (el && el.shadowRoot && guard < 10) {
      var inner = null;
      try { inner = el.shadowRoot.elementFromPoint(x, y); } catch (e) { break; }
      if (!inner || inner === el) break;
      el = inner;
      guard++;
    }
    return el;
  }

  function startPick() {
    if (picking) return;
    picking = true;
    confirmOpen = false;
    current = null;
    currentRaw = null;
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    document.addEventListener('scroll', onScroll, true);
    // 导航阻断：在 window 捕获阶段拦截，先于页面任何脚本执行，
    // 防止广告在 mousedown / window 捕获监听器里直接跳转
    window.addEventListener('click', onPickClick, true);
    window.addEventListener('mousedown', blockNav, true);
    window.addEventListener('mouseup', blockNav, true);
    window.addEventListener('auxclick', blockNav, true);
    window.addEventListener('dblclick', blockNav, true);
    window.addEventListener('touchstart', blockNav, true);
    window.addEventListener('touchend', blockNav, true);
    showHint('点击要隐藏的元素 · Alt+滚轮=选父级 · ESC 退出 · Ctrl+Z 撤销');
  }

  function stopPick() {
    picking = false;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('wheel', onWheel, { capture: true });
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('click', onPickClick, true);
    window.removeEventListener('mousedown', blockNav, true);
    window.removeEventListener('mouseup', blockNav, true);
    window.removeEventListener('auxclick', blockNav, true);
    window.removeEventListener('dblclick', blockNav, true);
    window.removeEventListener('touchstart', blockNav, true);
    window.removeEventListener('touchend', blockNav, true);
    removeOverlay();
    removeHint();
    removeConfirm();
    removeInfo();
    current = null;
    currentRaw = null;
  }

  /** 阻断页面级跳转/打开新标签（放行我们自己的 UI） */
  function blockNav(e) {
    if (!picking) return;
    var t = e.target;
    if (t && t.closest && (t.closest('#' + CONFIRM_ID) || t.closest('#' + HINT_ID) || t.closest('#' + INFO_ID))) return;
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    // touch 不 preventDefault，否则移动端会连 click 一起吞掉
    if (e.type !== 'touchstart' && e.type !== 'touchend') e.preventDefault();
  }

  /** 点选确认：同样放在 window 捕获阶段，页面脚本拿不到这次点击 */
  function onPickClick(e) {
    if (!picking) return;
    var t = e.target;
    if (t && t.closest && (t.closest('#' + CONFIRM_ID) || t.closest('#' + HINT_ID) || t.closest('#' + INFO_ID))) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    var raw = deepElementFromPoint(e.clientX, e.clientY);
    var target = pickTarget(raw || current);
    if (!target) return;
    current = target;
    drawOverlay(target);
    fadeOverlayIn();
    showConfirm(target);
  }

  function onMove(e) {
    if (!picking) return;
    var raw = deepElementFromPoint(e.clientX, e.clientY);
    if (!raw || raw === overlay) return;
    if (raw.closest && raw.closest('#' + CONFIRM_ID)) return;
    if (raw !== currentRaw) {
      currentRaw = raw;
      // 智能提升：点到图片/文字时上移到真正的广告容器，避免存下会误伤别处的 class
      var target = pickTarget(raw);
      current = target;
      drawOverlay(target);
      fadeOverlayIn();
      showInfo(target);
    }
  }

  function onScroll() {
    if (picking && current) drawOverlay(current);
  }

  function onWheel(e) {
    if (!picking || !current || !e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    var p = current.parentElement;
    if (p && p.nodeType === 1 && p !== document.documentElement) {
      current = p;
      drawOverlay(p);
      fadeOverlayIn();
      if (confirmOpen) showConfirm(p);
    }
  }

  function onKey(e) {
    if (!picking || e.key !== 'Escape') return;
    e.stopPropagation();
    if (confirmOpen) { removeConfirm(); return; }
    stopPick();
  }

  /* ---------------- 撤销 ---------------- */

  function undoLast() {
    if (!rules.length) { updateHint('没有可撤销的规则'); return false; }
    var ni = 0;
    for (var i = 1; i < rules.length; i++) {
      if (rules[i].createdAt > rules[ni].createdAt) ni = i;
    }
    var removed = rules.splice(ni, 1)[0];
    persist(function () {
      reconcile();
      updateHint('已撤销：' + (removed.label || '规则') + ' · 共 ' + rules.length + ' 条');
    });
    return true;
  }

  // Ctrl+Z：点选模式中，或刚隐藏完 10 秒内（输入框内不拦截）
  document.addEventListener('keydown', function (e) {
    if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    if ((e.key || '').toLowerCase() !== 'z') return;
    var t = e.target;
    if (t && t.nodeType === 1 &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var recent = lastHiddenAt && (Date.now() - lastHiddenAt < 10000);
    if (!picking && !recent) return;
    if (undoLast()) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  /* ---------------- 右键菜单快速隐藏 ---------------- */

  document.addEventListener('contextmenu', function (e) {
    lastContextTarget = e.target;
    lastContextAt = Date.now();
  }, true);

  /* ---------------- 规则定位闪烁 ---------------- */

  function flashElements(els) {
    for (var i = 0; i < els.length; i++) {
      try {
        els[i].animate([
          { boxShadow: '0 0 0 0 rgba(255,171,0,0)' },
          { boxShadow: '0 0 0 4px rgba(255,171,0,1)' },
          { boxShadow: '0 0 0 0 rgba(255,171,0,0)' }
        ], { duration: 900, iterations: 2 });
      } catch (e) { /* 忽略 */ }
    }
  }

  /* ---------------- 浮层 UI ---------------- */

  function drawOverlay(el) {
    var r = el.getBoundingClientRect();
    var P = EFFECTS.pick;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = HIGHLIGHT_ID;
      document.documentElement.appendChild(overlay);
    }
    overlay.style.cssText =
      'position:fixed;pointer-events:none;z-index:' + (MAX_Z - 1) + ';' +
      'border:' + P.width + 'px solid rgba(' + P.rgb + ',0);' +
      'background:rgba(' + P.rgb + ',0);border-radius:' + P.radius + 'px;' +
      'transition:border-color ' + P.fadeIn + 'ms ease,background-color ' + P.fadeIn + 'ms ease;' +
      'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;';
  }

  // 每次换到新元素都重新从透明缓动亮起蓝色边框（WAAPI 每次独立播放，必然触发）
  function fadeOverlayIn() {
    if (!overlay) return;
    var P = EFFECTS.pick;
    var from = 'rgba(' + P.rgb + ',0)';
    var toB = 'rgba(' + P.rgb + ',' + P.alpha + ')';
    var toBg = 'rgba(' + P.rgb + ',' + P.bgAlpha + ')';
    if (typeof overlay.animate !== 'function') {
      overlay.style.borderColor = toB;
      overlay.style.backgroundColor = toBg;
      return;
    }
    if (overlayAnim) { try { overlayAnim.cancel(); } catch (e) { /* 忽略 */ } }
    overlayAnim = overlay.animate(
      [
        { borderColor: from, backgroundColor: from },
        { borderColor: toB, backgroundColor: toBg }
      ],
      { duration: P.fadeIn, easing: 'ease', fill: 'forwards' }
    );
  }

  function removeOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    overlayAnim = null;
  }

  function showHint(text) {
    removeHint();
    hintEl = document.createElement('div');
    hintEl.id = HINT_ID;
    var f = IN_FRAME ? 'font:11px/1.4 system-ui,"Microsoft YaHei",sans-serif;padding:4px 10px;'
                     : 'font:13px/1.4 system-ui,"Microsoft YaHei",sans-serif;padding:8px 14px;';
    hintEl.style.cssText =
      'position:fixed;left:8px;top:8px;z-index:' + MAX_Z + ';' +
      'background:#323232;color:#fff;border-radius:20px;' + f +
      'box-shadow:0 2px 10px rgba(0,0,0,.3);max-width:90%;';
    hintEl.textContent = text;
    document.documentElement.appendChild(hintEl);
  }

  function updateHint(text) { if (hintEl) hintEl.textContent = text; }

  /* ---------------- 元素信息卡（点之前就知道会藏什么） ---------------- */

  function showInfo(el) {
    if (!infoEl) {
      infoEl = document.createElement('div');
      infoEl.id = INFO_ID;
      infoEl.style.cssText =
        'position:fixed;z-index:' + (MAX_Z - 2) + ';pointer-events:none;' +
        'background:rgba(30,32,36,.94);color:#e8eaed;border-radius:6px;padding:6px 9px;' +
        'font:11px/1.5 ui-monospace,Consolas,"Microsoft YaHei",monospace;' +
        'white-space:pre;max-width:340px;box-shadow:0 2px 10px rgba(0,0,0,.35);';
      document.documentElement.appendChild(infoEl);
    }
    var a = assess(el);
    var cands = buildCandidates(el);
    var hit = 0;
    try { hit = matchCount(cands[0] || ''); } catch (e) { hit = 0; }
    var cls = (typeof el.className === 'string') ? el.className.trim().split(/\s+/).slice(0, 3) : [];
    var lines = [];
    lines.push(el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : ''));
    lines.push('祖先: ' + (ancestorChain(el) || '(无)'));
    lines.push('本页命中 ' + hit + ' 个 · 面积 ' + Math.round(a.ratio * 100) + '% · 文本 ' + a.textLen + ' 字');
    if (a.risky) lines.push('⚠ 目标偏大或含正文，直接隐藏容易误伤');
    infoEl.textContent = lines.join('\n');

    var r = a.rect;
    var top = r.bottom + 8;
    if (top + 76 > window.innerHeight) top = Math.max(8, r.top - 76);
    infoEl.style.left = Math.min(Math.max(8, r.left), window.innerWidth - 350) + 'px';
    infoEl.style.top = top + 'px';
  }

  function removeInfo() {
    if (infoEl && infoEl.parentNode) infoEl.parentNode.removeChild(infoEl);
    infoEl = null;
  }

  function removeHint() {
    if (hintEl && hintEl.parentNode) hintEl.parentNode.removeChild(hintEl);
    hintEl = null;
  }

  function mkBtn(text, color) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.style.cssText = 'border:1px solid ' + color + ';background:' + color + ';color:#fff;' +
      'padding:' + (IN_FRAME ? '3px 8px' : '4px 10px') + ';border-radius:4px;' +
      'font-size:' + (IN_FRAME ? 11 : 12) + 'px;cursor:pointer;';
    return b;
  }

  function showConfirm(el) {
    removeConfirm();
    confirmOpen = true;
    var cands = buildCandidates(el);
    var scope = buildScope(el);
    var a = assess(el);
    var risky = a.risky;
    var bar = document.createElement('div');
    bar.id = CONFIRM_ID;
    var fs = IN_FRAME ? 12 : 13;
    var mw = IN_FRAME ? 240 : 360;
    bar.style.cssText =
      'position:fixed;z-index:' + MAX_Z + ';display:flex;flex-direction:column;gap:6px;' +
      'background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px 10px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.25);' +
      'font:' + fs + 'px/1.4 system-ui,"Microsoft YaHei",sans-serif;max-width:' + mw + 'px;';

    // 智能提示：父级容器与当前元素几乎一样大 → 建议直接选父级
    var tipText = '';
    var pr = el.parentElement && el.parentElement.getBoundingClientRect();
    var r0 = el.getBoundingClientRect();
    if (pr && Math.abs(pr.width - r0.width) < 6 && Math.abs(pr.height - r0.height) < 6) {
      tipText = '父级容器与当前元素大小相同，建议「选父级」整体隐藏';
    }

    var row1 = document.createElement('div');
    row1.style.cssText = 'display:flex;gap:8px;align-items:center;';
    var label = document.createElement('span');
    label.style.cssText = 'color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;';
    label.textContent = labelOf(el);
    label.title = '候选选择器：\n' + cands.join('\n') + (scope ? '\n作用域：' + scope : '');

    var btnHide = mkBtn('隐藏此元素', '#1e88e5');
    var btnParent = mkBtn('选父级', '#757575');
    var btnCancel = mkBtn('取消', '#bdbdbd');
    var armed = false;
    var warnEl = null;

    btnHide.addEventListener('click', function (ev) {
      ev.stopPropagation();
      // 目标偏大 / 含大量正文时，先警告再放行，避免误伤整块内容
      if (risky && !armed) {
        armed = true;
        btnHide.textContent = '仍要隐藏';
        btnHide.style.background = '#e53935';
        btnHide.style.borderColor = '#e53935';
        if (warnEl) {
          warnEl.style.color = '#e53935';
          warnEl.textContent = '⚠ 该目标占页面 ' + Math.round(a.ratio * 100) + '%、含 ' + a.textLen +
            ' 字正文，隐藏可能误伤。再点一次「仍要隐藏」确认，或点「选父级」重新定位。';
        }
        return;
      }
      removeConfirm();
      hideAndSave(el, cands, scope);
    });
    btnParent.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var p = el.parentElement;
      if (p && p.nodeType === 1 && p !== document.documentElement) {
        current = p;
        drawOverlay(p);
        fadeOverlayIn();
        showConfirm(p);
      }
    });
    btnCancel.addEventListener('click', function (ev) {
      ev.stopPropagation();
      removeConfirm();
    });

    row1.appendChild(label);
    row1.appendChild(btnHide);
    row1.appendChild(btnParent);
    row1.appendChild(btnCancel);
    bar.appendChild(row1);

    if (risky) {
      warnEl = document.createElement('div');
      warnEl.style.cssText = 'color:#e53935;font-size:' + (fs - 1) + 'px;';
      warnEl.textContent = '⚠ 目标偏大或含大量正文，直接隐藏容易误伤（例如把整块评论区一起藏掉）。';
      bar.appendChild(warnEl);
    } else if (tipText) {
      var tip = document.createElement('div');
      tip.style.cssText = 'color:#b26a00;font-size:' + (fs - 1) + 'px;';
      tip.textContent = '💡 ' + tipText;
      bar.appendChild(tip);
    }

    document.documentElement.appendChild(bar);

    var r = el.getBoundingClientRect();
    var top = r.bottom + 8;
    if (top + 60 > window.innerHeight) top = Math.max(8, r.top - 60);
    bar.style.left = Math.min(Math.max(8, r.left), window.innerWidth - mw - 12) + 'px';
    bar.style.top = top + 'px';
  }

  function removeConfirm() {
    confirmOpen = false;
    var bar = document.getElementById(CONFIRM_ID);
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }

  function primaryOf(rule) {
    var s = ruleSelectors(rule);
    return s[0] || '';
  }

  function hideAndSave(el, cands, scope) {
    var primary = cands[0] || '';
    for (var i = 0; i < rules.length; i++) {
      if (primaryOf(rules[i]) === primary) {
        updateHint('该元素已在隐藏列表中');
        return;
      }
    }
    // 先播隐藏动画，播完再写入规则
    animateHide(el, function () {
      var rule = {
        id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        selectors: cands,
        scope: scope || '',          // 祖先作用域，避免同 class 不同区域互相误伤
        label: labelOf(el),
        createdAt: Date.now()
      };
      rules.push(rule);
      lastHiddenAt = Date.now();
      persist(function () {
        applyRules();
        var hits = hitCounts[rule.id] || 0;
        updateHint('已隐藏 ' + hits + ' 个元素 · 共 ' + rules.length + ' 条规则 · Ctrl+Z 撤销');
      });
    });
  }

  /* ---------------- 消息 ---------------- */

  function state() {
    var grace = Date.now() - readyAt < 3000; // 刚加载的 3 秒内不算失效
    var out = [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      out.push({
        id: r.id,
        selectors: ruleSelectors(r),
        scope: r.scope || '',
        label: r.label,
        createdAt: r.createdAt,
        hits: hitCounts[r.id] || 0,
        alive: grace ? true : !!matchedIds[r.id]
      });
    }
    return {
      host: host,
      rules: out,
      picking: picking,
      hidden: document.querySelectorAll('[data-eraser-hidden]').length,
      hideMode: settings.hideMode
    };
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    // 只响应扩展页面（popup/background）发来的指令，忽略来自其他 frame 的转发
    if (sender.id !== chrome.runtime.id) return;

    if (msg.type === 'GET_STATE') {
      loadRules().then(loadSettings).then(function () { sendResponse(state()); });
      return true;
    }
    if (msg.type === 'TOGGLE_PICK') {
      if (picking) stopPick(); else startPick();
      sendResponse(state());
      return;
    }
    if (msg.type === 'REMOVE_RULE') {
      rules = rules.filter(function (r) { return r.id !== msg.id; });
      persist(function () { reconcile(); sendResponse(state()); });
      return true;
    }
    if (msg.type === 'CLEAR_RULES') {
      rules = [];
      persist(function () { reconcile(); sendResponse(state()); });
      return true;
    }
    if (msg.type === 'UNDO_LAST') {
      undoLast();
      setTimeout(function () { sendResponse(state()); }, 80);
      return true;
    }
    if (msg.type === 'LOCATE_RULE') {
      var rule = null;
      for (var i = 0; i < rules.length; i++) if (rules[i].id === msg.id) rule = rules[i];
      var els = [];
      if (rule) {
        var roots = collectRoots();
        var sels = ruleSelectors(rule);
        for (var s = 0; s < sels.length; s++) {
          var found = deepQueryAll(sels[s], roots);
          for (var j = 0; j < found.length; j++) {
            if (els.indexOf(found[j]) === -1) els.push(found[j]);
          }
        }
      }
      flashElements(els);
      sendResponse({ found: els.length });
      return;
    }
    if (msg.type === 'HIDE_CONTEXT_TARGET') {
      // 右键菜单「隐藏此元素」：只处理 5 秒内右键过的元素（由所在 frame 记录）
      var t = lastContextTarget;
      var fresh = t && (Date.now() - lastContextAt) < 5000;
      lastContextTarget = null;
      if (fresh) {
        var connected = true;
        try { connected = t.isConnected !== false; } catch (e) { /* 忽略 */ }
        if (connected && t.nodeType === 1) {
          if (picking) stopPick();
          hideAndSave(t, buildCandidates(t), buildScope(t));
        }
      }
      sendResponse(state());
      return;
    }
  });

  /* ---------------- 启动 ---------------- */

  loadRules().then(loadSettings).then(function () {
    readyAt = Date.now();
    applyRules();
    startObserver();
  });
})();
