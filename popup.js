/* 网页元素消除器 · popup (v1.3) */
(function () {
  'use strict';

  var RULES_KEY = 'eraser_rules_v1';
  var SETTINGS_KEY = 'eraser_settings_v1';

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

  function render(st) {
    $('#site').textContent = '当前网站：' + st.host + ' · 本页已隐藏 ' + st.hidden + ' 个元素';
    var btn = $('#pickBtn');
    btn.disabled = false;
    btn.style.background = '';
    btn.textContent = st.picking ? '停止选择（ESC 也可退出）' : '开始选择要隐藏的元素';
    btn.classList.toggle('picking', !!st.picking);
    $('#hideMode').value = st.hideMode === 'visibility' ? 'visibility' : 'display';
    $('#ruleCount').textContent = '已保存 ' + st.rules.length + ' 条规则';
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
      txt.textContent = r.label || sels[0];
      txt.title = '候选选择器：\n' + sels.join('\n');
      if (r.alive === false) {
        var tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = ' ⚠ 疑似失效';
        txt.appendChild(tag);
      }

      var loc = document.createElement('button');
      loc.className = 'loc';
      loc.textContent = '定位';
      loc.title = '在页面上闪烁显示该规则命中的元素';
      loc.addEventListener('click', function () {
        chrome.tabs.sendMessage(tabId, { type: 'LOCATE_RULE', id: r.id }, { frameId: 0 }, function () {
          void chrome.runtime.lastError;
        });
      });

      var del = document.createElement('button');
      del.className = 'del';
      del.textContent = '删除';
      del.addEventListener('click', function () {
        chrome.tabs.sendMessage(tabId, { type: 'REMOVE_RULE', id: r.id }, { frameId: 0 }, function (resp) {
          if (resp) render(resp);
        });
      });

      row.appendChild(txt);
      row.appendChild(loc);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  function refresh() {
    chrome.tabs.sendMessage(tabId, { type: 'GET_STATE' }, { frameId: 0 }, function (resp) {
      if (resp) render(resp);
    });
  }

  /* ---------- 交互 ---------- */

  $('#pickBtn').addEventListener('click', function () {
    chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_PICK' }, { frameId: 0 }, function (resp) {
      if (resp) render(resp);
    });
  });

  $('#clearBtn').addEventListener('click', function () {
    chrome.tabs.sendMessage(tabId, { type: 'CLEAR_RULES' }, { frameId: 0 }, function (resp) {
      if (resp) render(resp);
    });
  });

  $('#undoBtn').addEventListener('click', function () {
    chrome.tabs.sendMessage(tabId, { type: 'UNDO_LAST' }, { frameId: 0 }, function (resp) {
      if (resp) render(resp);
    });
  });

  /* ---------- 隐藏方式设置（实时生效） ---------- */

  $('#hideMode').addEventListener('change', function () {
    var patch = {};
    patch[SETTINGS_KEY] = { hideMode: this.value };
    chrome.storage.local.set(patch, function () {
      refresh(); // content script 会监听 storage 变化自动 reconcile
    });
  });

  /* ---------- 导出 / 导入 ---------- */

  $('#exportBtn').addEventListener('click', function () {
    chrome.storage.local.get(RULES_KEY, function (data) {
      var all = (data && data[RULES_KEY]) || {};
      var blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
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
    this.value = ''; // 允许重复选择同一文件
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var incoming;
      try { incoming = JSON.parse(reader.result); }
      catch (e) { alert('文件不是有效的 JSON'); return; }
      var rulesIn = incoming && incoming[RULES_KEY];
      if (!rulesIn || typeof rulesIn !== 'object') { alert('文件格式不对：缺少 ' + RULES_KEY); return; }
      chrome.storage.local.get(RULES_KEY, function (cur) {
        var all = (cur && cur[RULES_KEY]) || {};
        var added = 0;
        Object.keys(rulesIn).forEach(function (h) {
          var mine = all[h] || [];
          var ids = {};
          mine.forEach(function (r) { ids[r.id] = true; });
          (rulesIn[h] || []).forEach(function (r) {
            if (r && r.id && !ids[r.id]) { mine.push(r); ids[r.id] = true; added++; }
          });
          all[h] = mine;
        });
        var patch = {};
        patch[RULES_KEY] = all;
        chrome.storage.local.set(patch, function () {
          alert('导入完成：新增 ' + added + ' 条规则（当前打开的页面已即时生效）');
          refresh();
        });
      });
    };
    reader.onerror = function () { alert('读取文件失败'); };
    reader.readAsText(file, 'utf-8');
  });

  init();
})();
