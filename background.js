/* 网页元素消除器 · background service worker
 * 职责：
 *  1. 注册右键菜单「隐藏此元素」→ 通知页面 content script 快速隐藏右键的元素
 *  2. 注册快捷键 Ctrl+Shift+Y → 开始/停止点选模式
 */
'use strict';

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: 'eraser-hide',
      title: '隐藏此元素',
      contexts: ['all']
    });
  });
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId !== 'eraser-hide' || !tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'HIDE_CONTEXT_TARGET' }, function () {
    void chrome.runtime.lastError; // 页面不支持时忽略
  });
});

chrome.commands.onCommand.addListener(function (command) {
  if (command !== 'toggle-pick') return;
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    if (!tab || !tab.id) return;
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PICK' }, { frameId: 0 }, function () {
      void chrome.runtime.lastError;
    });
  });
});
