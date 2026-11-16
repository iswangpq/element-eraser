/* 网页元素消除器 · popup (v1.2) */
(function () {
  'use strict';

  var RULES_KEY = 'eraser_rules_v1';
  var SETTINGS_KEY = 'eraser_settings_v1';
  var COSMETIC_KEY = 'eraser_cosmetic_v1';

  function $(s) { return document.querySelector(s); }

  var tabId = null;

  function init() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab) { fail('找不到当前标签页'); return; }
      tabId = tab.id;
      chrome.tabs.sendMessage(tabId, { type: 'GET_STATE' }, { frameId: 0 }, function (resp) {
        if (chrome.runtime.lastError || !resp) {
          fail('当前页面不支持（浏览器内置页面，或请刷新后重试）');
          return;
        }
        render(resp);
      });
    });
  }

  function fail(msg) {
    $('#site').textContent = msg;
    $('#pickBtn').disabled = true;
    $('#pickBtn').style.background = '#bbb';
    $('#ruleList').innerHTML = '';
  }

  function send(msg, cb) {
    chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }, function (resp) {
      if (resp) cb && cb(resp);
    });
  }

  function render(st) {
    $('#site').textContent = '当前网站：' + st.host + ' · 本页已隐藏 ' + st.hidden + ' 个元素';
    var btn = $('#pickBtn');
    btn.disabled = false;
    btn.style.background = '';
    btn.textContent = st.picking ? '停止选择（ESC 也可退出）' : '开始选择要隐藏的元素';
    btn.classList.toggle('picking', !!st.picking);
    $('#hideMode').value = st.hideMode === 'visibility' ? 'visibility' : 'display';
    $('#pauseChk').checked = !!st.paused;
    $('#revealChk').checked = !!st.reveal;
    $('#ruleCount').textContent = '已保存 ' + st.rules.length + ' 条规则';
    renderRules(st);
    renderAuto(st);
  }

  function renderRules(st) {
    var list = $('#ruleList');
    list.innerHTML = '';
    if (!st.rules.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '暂无规则。点击上方按钮，再点选网页中的广告元素。';
      list.appendChild(empty);
      return;
    }
    st.rules.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'rule' + (r.alive === false ? ' stale' : '');

      var txt = document.createElement('span');
      txt.className = 'txt';
      var sels = r.selectors && r.selectors.length ? r.selectors : [r.selector];
      // 旧规则的标签可能只有 "div"/"a" 这种，看不出是什么 → 用候选选择器兜底显示
      var labelText = r.label || sels[0];
      if (!/[.#「]/.test(labelText)) labelText = sels[0];
      txt.textContent = labelText;
      txt.title = (r.label ? '规则：' + r.label + '\n' : '') +
                   '候选选择器：\n' + sels.join('\n') + (r.scope ? '\n作用域：' + r.scope : '');
      if (r.alive === false) {
        var tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = ' ⚠ 未命中';
        tag.title = '这条规则在当前页面没有匹配到任何元素（页面结构可能变了），点「重选」重新指定目标';
        txt.appendChild(tag);
      }
      if (typeof r.hits === 'number' && r.hits > 0) {
        var hitTag = document.createElement('span');
        hitTag.className = 'tag';
        hitTag.style.color = '#2e7d32';
        hitTag.textContent = ' 命中' + r.hits;
        txt.appendChild(hitTag);
      }
      if (r.loose) {
        var looseTag = document.createElement('span');
        looseTag.className = 'tag';
        looseTag.style.color = '#c62828';
        looseTag.textContent = ' 宽松';
        looseTag.title = '本页没有按作用域精准命中，已降级按 class 匹配，可能误伤；点「重选」可收紧作用域';
        txt.appendChild(looseTag);
      }

      var loc = document.createElement('button');
      loc.className = 'loc';
      loc.textContent = '定位';
      loc.title = '在页面上闪烁显示该规则命中的元素';
      loc.addEventListener('click', function () {
        send({ type: 'LOCATE_RULE', id: r.id });
      });

      if (r.alive === false) {
        var re = document.createElement('button');
        re.className = 'loc';
        re.textContent = '重选';
        re.title = '重新点选目标元素，直接替换这条规则';
        re.addEventListener('click', function () {
          send({ type: 'REPICK_RULE', id: r.id });
        });
        row.appendChild(txt);
        row.appendChild(re);
        row.appendChild(loc);
        row.appendChild(del);
        list.appendChild(row);
        return;
      }

      var del = document.createElement('button');
      del.className = 'del';
      del.textContent = '删除';
      del.addEventListener('click', function () {
        send({ type: 'REMOVE_RULE', id: r.id }, render);
      });

      row.appendChild(txt);
      row.appendChild(loc);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  function renderAuto(st) {
    var list = $('#autoList');
    list.innerHTML = '';
    var items = st.cosmetic || [];
    $('#autoCount').textContent = '自动规则（文本 / 导入）' + (items.length ? ' ' + items.length : '');
    if (!items.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '暂无自动规则。可用上方「按文本隐藏」，或导入 uBlock 风格规则。';
      list.appendChild(empty);
      return;
    }
    items.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'rule auto';
      var txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = r.label || r.id;
      txt.title = r.label || '';
      var del = document.createElement('button');
      del.className = 'del';
      del.textContent = '删除';
      del.addEventListener('click', function () {
        send({ type: 'REMOVE_COSMETIC', id: r.id }, render);
      });
      row.appendChild(txt);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  function refresh() {
    send({ type: 'GET_STATE' }, render);
  }

  /* ---------- 交互 ---------- */

  $('#pickBtn').addEventListener('click', function () {
    send({ type: 'TOGGLE_PICK' }, render);
  });

  $('#clearBtn').addEventListener('click', function () {
    send({ type: 'CLEAR_RULES' }, render);
  });

  $('#undoBtn').addEventListener('click', function () {
    send({ type: 'UNDO_LAST' }, render);
  });

  /** 写设置前先读旧值合并，避免改一个字段把另一个冲掉 */
  function saveSettings(patch, cb) {
    chrome.storage.local.get(SETTINGS_KEY, function (data) {
      var cur = (data && data[SETTINGS_KEY]) || {};
      var next = {
        hideMode: cur.hideMode === 'visibility' ? 'visibility' : 'display',
        paused: cur.paused || {},
        reveal: !!cur.reveal
      };
      Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
      var out = {};
      out[SETTINGS_KEY] = next;
      chrome.storage.local.set(out, function () { cb && cb(); });
    });
  }

  $('#hideMode').addEventListener('change', function () {
    saveSettings({ hideMode: this.value }, refresh);
  });

  $('#pauseChk').addEventListener('change', function () {
    send({ type: 'SET_PAUSE', paused: this.checked }, render);
  });

  $('#revealChk').addEventListener('change', function () {
    send({ type: 'SET_REVEAL', reveal: this.checked }, render);
  });

  $('#addTextBtn').addEventListener('click', function () {
    var t = $('#textRule').value.trim();
    if (!t) return;
    send({ type: 'ADD_TEXT_RULE', text: t }, function () {
      $('#textRule').value = '';
      refresh();
    });
  });

  $('#importFilterBtn').addEventListener('click', function () {
    var txt = $('#filterText').value;
    if (!txt.trim()) return;
    send({ type: 'IMPORT_COSMETIC', text: txt }, function (resp) {
      if (resp) {
        alert('导入完成：新增 ' + resp.added + ' 条规则' +
              (resp.skipped ? '，忽略 ' + resp.skipped + ' 行非外观规则' : ''));
      }
      $('#filterText').value = '';
      refresh();
    });
  });

  /* ---------- 导出 / 导入（手动规则 + 自动规则） ---------- */

  $('#exportBtn').addEventListener('click', function () {
    chrome.storage.local.get([RULES_KEY, COSMETIC_KEY], function (data) {
      var out = {};
      out[RULES_KEY] = (data && data[RULES_KEY]) || {};
      out[COSMETIC_KEY] = (data && data[COSMETIC_KEY]) || {};
      var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'element-eraser-rules.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 1000);
    });
  });

  $('#importBtn').addEventListener('click', function () {
    $('#importFile').click();
  });

  $('#importFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var incoming;
      try { incoming = JSON.parse(reader.result); }
      catch (e) { alert('文件不是有效的 JSON'); return; }
      var rulesIn = incoming && incoming[RULES_KEY];
      var cosIn = incoming && incoming[COSMETIC_KEY];
      if (!rulesIn && !cosIn) { alert('文件格式不对：缺少规则内容'); return; }
      chrome.storage.local.get([RULES_KEY, COSMETIC_KEY], function (cur) {
        var all = (cur && cur[RULES_KEY]) || {};
        var cos = (cur && cur[COSMETIC_KEY]) || {};
        var added = 0;
        if (rulesIn) {
          Object.keys(rulesIn).forEach(function (h) {
            var mine = all[h] || [];
            var ids = {};
            mine.forEach(function (r) { ids[r.id] = true; });
            (rulesIn[h] || []).forEach(function (r) {
              if (r && r.id && !ids[r.id]) { mine.push(r); ids[r.id] = true; added++; }
            });
            all[h] = mine;
          });
        }
        if (cosIn) {
          Object.keys(cosIn).forEach(function (h) {
            var mine = cos[h] || [];
            var sigs = {};
            mine.forEach(function (r) { sigs[r.selector + '|' + r.kind + '|' + (r.text || '')] = true; });
            (cosIn[h] || []).forEach(function (r) {
              var sig = r.selector + '|' + r.kind + '|' + (r.text || '');
              if (!sigs[sig]) { mine.push(r); sigs[sig] = true; added++; }
            });
            cos[h] = mine;
          });
        }
        var patch = {};
        patch[RULES_KEY] = all;
        patch[COSMETIC_KEY] = cos;
        chrome.storage.local.set(patch, function () {
          alert('导入完成：新增 ' + added + ' 条规则（当前页面已即时生效）');
          refresh();
        });
      });
    };
    reader.onerror = function () { alert('读取文件失败'); };
    reader.readAsText(file, 'utf-8');
  });

  init();
})();
