/* 自动化测试：用 jsdom 模拟浏览器环境，验证 content.js 核心逻辑
 * 运行：NODE_PATH=<workspace>/node_modules node test-eraser.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT_DIR = fs.existsSync(path.resolve(__dirname, 'element-eraser', 'manifest.json'))
  ? path.resolve(__dirname, 'element-eraser')
  : __dirname;
const contentSrc = fs.readFileSync(path.join(EXT_DIR, 'content.js'), 'utf8');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS  ' + msg); }
  else { failed++; console.log('  FAIL  ' + msg); }
}

/* ---- chrome API stub（两个 JSDOM 实例共享同一份 storage，模拟“刷新后规则还在”）---- */
const store = {};
const onChangedListeners = [];
global.__listener = null;
let pointEl = null;   // 当前鼠标下的元素（各场景可切换）
const chromeStub = {
  storage: {
    local: {
      get(key, cb) {
        const out = {};
        if (store[key] !== undefined) out[key] = store[key];
        cb(out);
      },
      set(obj, cb) {
        for (const k in obj) {
          store[k] = obj[k];
          onChangedListeners.forEach(fn => fn({ [k]: { newValue: obj[k] } }, 'local'));
        }
        if (cb) cb();
      }
    },
    onChanged: { addListener(fn) { onChangedListeners.push(fn); } }
  },
  runtime: {
    onMessage: { addListener(fn) { global.__listener = fn; } }
  }
};

function makePage() {
  const html = `<!DOCTYPE html><html><body>
    <div id="top-banner" class="ad ad-top">顶部横幅广告</div>
    <article><p>正文</p><div class="ad ad-inline">信息流广告</div></article>
    <aside><div class="ad ad-side">侧边栏广告1</div><div class="ad ad-side">侧边栏广告2</div></aside>
    <div class="adzone"><div id="ad-promo" class="promo">评论区上方的广告块</div></div>
    <div class="commentzone"><div id="cmt-promo" class="promo">评论区里同 class 的图</div></div>
    <a id="adlink" href="https://example.com/ad">广告链接</a>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'https://news.example.com/', runScripts: 'outside-only' });
  const w = dom.window;
  if (!w.CSS || !w.CSS.escape) {
    w.CSS = Object.assign(w.CSS || {}, {
      escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c)
    });
  }
  w.chrome = chromeStub;
  w.document.elementFromPoint = () => pointEl || w.document.getElementById('top-banner');
  w.__nav = false;
  w.document.getElementById('adlink').addEventListener('click', () => { w.__nav = true; });
  return dom;
}

function send(msg) {
  return new Promise(resolve => { global.__listener(msg, { frameId: 0 }, resolve); });
}
function tick(ms) { return new Promise(r => setTimeout(r, ms || 30)); }

/** 确保点选模式处于期望状态（避免前序场景把模式开关掉） */
async function ensurePick(want) {
  let st = await send({ type: 'GET_STATE' });
  if (!!st.picking !== !!want) {
    await send({ type: 'TOGGLE_PICK' });
    st = await send({ type: 'GET_STATE' });
  }
  return st;
}

(async () => {
  console.log('== 场景1：首次打开页面，无规则 ==');
  let dom = makePage();
  let w = dom.window;
  w.eval(contentSrc);
  await tick(50);
  let st = await send({ type: 'GET_STATE' });
  assert(st.host === 'news.example.com', 'hostname 正确: ' + st.host);
  assert(st.rules.length === 0, '初始无规则');
  assert(w.document.getElementById('top-banner').style.display !== 'none', '广告初始可见');

  console.log('== 场景2：进入点选模式，点击广告并确认隐藏 ==');
  st = await ensurePick(true);
  assert(st.picking === true, '点选模式已开启');
  w.document.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
  await tick();
  w.document.dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }));
  await tick();
  const bar = w.document.getElementById('__eraser_confirm__');
  assert(!!bar, '点击后出现确认条');
  const btnHide = Array.from(bar.querySelectorAll('button')).find(b => b.textContent === '隐藏此元素');
  assert(!!btnHide, '确认条包含“隐藏此元素”按钮');
  btnHide.click();
  await tick(50);
  const saved = (store['eraser_rules_v1'] || {})['news.example.com'] || [];
  assert(saved.length === 1, '规则已保存到 storage（' + saved.length + ' 条）');
  assert(saved[0] && Array.isArray(saved[0].selectors) && saved[0].selectors.length >= 2,
    '规则保存为多候选选择器（' + (saved[0] ? (saved[0].selectors || []).join(' | ') : '无') + '）');
  const banner = w.document.getElementById('top-banner');
  assert(banner.style.display === 'none', '广告已被隐藏 (display:none)');
  assert(!!banner.getAttribute('data-eraser-hidden'), '已标记 data-eraser-hidden');

  console.log('== 场景3：站点重建 DOM 后被 Observer 自动重新隐藏 ==');
  const clone = w.document.createElement('div');
  clone.id = 'top-banner';
  clone.className = 'ad ad-top'; // 真实场景：重建的广告带有相同语义 class
  clone.textContent = '重建的广告';
  w.document.querySelector('article').appendChild(clone);
  await tick(500);
  assert(clone.style.display === 'none', '动态重建的广告已被自动隐藏');

  console.log('== 场景3b：模拟 SPA 换视频，广告挪到不同位置仍能命中 ==');
  // 原来的位置型选择器会因兄弟节点数量变化而失效，语义 class 候选应兜住
  const clone2 = w.document.createElement('div');
  clone2.className = 'ad ad-top';
  clone2.textContent = '换视频后又出现的广告';
  w.document.querySelector('aside').insertBefore(clone2, w.document.querySelector('aside').firstChild);
  await tick(500);
  assert(clone2.style.display === 'none', '位置变了但 class 相同的广告被自动隐藏');

  console.log('== 场景4：模拟刷新（新页面实例 + 同一份 storage）==');
  w.close();
  dom = makePage();
  w = dom.window;
  w.eval(contentSrc);
  await tick(50);
  st = await send({ type: 'GET_STATE' });
  assert(st.rules.length === 1, '刷新后规则仍在（' + st.rules.length + ' 条）');
  assert(st.hidden === 1, '刷新后广告自动隐藏（本页已隐藏 ' + st.hidden + ' 个）');
  assert(w.document.getElementById('top-banner').style.display === 'none', '刷新后广告保持隐藏');

  console.log('== 场景5：删除规则后恢复显示 ==');
  st = await send({ type: 'REMOVE_RULE', id: st.rules[0].id });
  await tick(50);
  assert(st.rules.length === 0, '规则已删除');
  assert(w.document.getElementById('top-banner').style.display !== 'none', '广告恢复显示');

  console.log('== 场景6：ESC 退出点选模式 ==');
  await ensurePick(true);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick();
  st = await send({ type: 'GET_STATE' });
  assert(st.picking === false, 'ESC 后退出点选模式');
  assert(!w.document.getElementById('__eraser_hint__'), '提示条已移除');

  console.log('== 场景7：隐藏后 UNDO_LAST 撤销 ==');
  await ensurePick(true);
  w.document.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
  await tick();
  w.document.dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }));
  await tick();
  const bar2 = w.document.getElementById('__eraser_confirm__');
  const btnHide2 = bar2 && Array.from(bar2.querySelectorAll('button')).find(b => b.textContent === '隐藏此元素');
  assert(!!btnHide2, '确认条再次出现');
  if (btnHide2) btnHide2.click();
  await tick(50);
  assert(w.document.getElementById('top-banner').style.display === 'none', '再次隐藏成功');
  st = await send({ type: 'UNDO_LAST' });
  await tick(150);
  assert(st.rules.length === 0, '撤销后规则清空（' + st.rules.length + ' 条）');
  assert(w.document.getElementById('top-banner').style.display !== 'none', '撤销后广告恢复显示');

  console.log('== 场景8：Ctrl+Z 快捷撤销 ==');
  await ensurePick(true);
  w.document.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
  await tick();
  w.document.dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }));
  await tick();
  const bar3 = w.document.getElementById('__eraser_confirm__');
  const btnHide3 = bar3 && Array.from(bar3.querySelectorAll('button')).find(b => b.textContent === '隐藏此元素');
  if (btnHide3) btnHide3.click();
  await tick(50);
  // 点选模式中按 Ctrl+Z 应撤销
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await tick(150);
  st = await send({ type: 'GET_STATE' });
  assert(st.rules.length === 0, 'Ctrl+Z 撤销后规则清空（' + st.rules.length + ' 条）');
  assert(w.document.getElementById('top-banner').style.display !== 'none', 'Ctrl+Z 撤销后广告恢复显示');

  console.log('== 场景9：作用域限定 —— 同 class 不同区域不被连带隐藏 ==');
  // 模拟 B 站：广告块与评论区里的图共用 class .promo，但祖先不同
  await ensurePick(true);
  pointEl = w.document.getElementById('ad-promo');
  w.document.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 9, clientY: 9 }));
  await tick();
  w.document.dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: 9, clientY: 9 }));
  await tick();
  const bar4 = w.document.getElementById('__eraser_confirm__');
  const btnHide4 = bar4 && Array.from(bar4.querySelectorAll('button')).find(b => b.textContent === '隐藏此元素');
  assert(!!btnHide4, '广告块确认条出现');
  if (btnHide4) btnHide4.click();
  await tick(80);
  assert(w.document.getElementById('ad-promo').style.display === 'none', '广告块已隐藏');
  assert(w.document.getElementById('cmt-promo').style.display !== 'none',
    '评论区里同 class 的元素没有被连带隐藏（作用域生效）');
  const savedPromo = (store['eraser_rules_v1'] || {})['news.example.com'] || [];
  const promoRule = savedPromo.find(r => (r.selectors || []).some(s => s.indexOf('promo') >= 0));
  assert(!!promoRule && !!promoRule.scope, '规则记录了作用域指纹: ' + (promoRule ? promoRule.scope : '无'));

  console.log('== 场景10：点选模式下点击链接不跳转 ==');
  const link = w.document.getElementById('adlink');
  const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 12, clientY: 12 });
  link.dispatchEvent(ev);
  await tick();
  assert(w.__nav === false, '页面自身的链接点击处理器没有被触发（未跳转）');
  assert(ev.defaultPrevented === true, '默认导航行为已被阻止');

  w.close();
  console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
