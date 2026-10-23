# 网页元素消除器 Element Eraser

点选网页中的任意元素（广告、弹窗、推荐位…）即可隐藏，规则按网站保存在本地浏览器，刷新或换视频后自动重新隐藏。支持撤销、导入导出、快捷键、右键快速隐藏、Shadow DOM 穿透等。

> 仅本地存储，不上传任何数据。

## 功能

- **点选隐藏**：点扩展图标 → 开始选择 → 点击要隐藏的元素 → 确认隐藏。
- **多候选选择器**：一条规则同时保存多个候选选择器（语义 class / class+位置 / 稳定 id / 路径 / fullPath），命中任意一条即隐藏，SPA 换页后只要结构类似仍可命中。
- **持久化**：规则按网站域名存入 `chrome.storage.local`，刷新 / SPA 跳转自动重新隐藏；`MutationObserver` 兜底动态插入的广告。
- **撤销**：隐藏后 10 秒内或点选模式中按 `Ctrl+Z` 撤销最近一条；弹窗里也有「撤销上一条」。
- **导入 / 导出**：弹窗支持导出全部规则为 JSON、从文件导入（按站点合并、自动去重），换电脑不丢规则。
- **快捷键**：`Ctrl+Shift+Y` 直接开始 / 停止点选。
- **右键快速隐藏**：对任意元素右键 →「隐藏此元素」，免进点选模式。
- **失效规则提示**：加载后没命中的规则在弹窗标黄「⚠ 疑似失效」，提示重选。
- **规则定位**：弹窗每条规则有「定位」按钮，点击后页面上命中的元素橙色闪烁。
- **Shadow DOM 穿透**：点选与规则应用均支持 open shadow root 内的元素。
- **隐藏方式可选**：弹窗设置「移除占位（display:none，默认）/ 保留占位（visibility:hidden）」。
- **向上折叠动画**：隐藏时元素高度 / 边距收为 0 并淡出，下方内容自然补位，不留空隙。
- **深色弹窗**：跟随系统主题；iframe 内点选界面自动缩小适配。

## 安装（Chrome / Edge）

1. 下载并**解压** `element-eraser.zip`，得到 `element-eraser` 文件夹。
2. 地址栏输入 `chrome://extensions`（Edge 用 `edge://extensions`）。
3. 打开「开发者模式 / 开发人员模式」。
4. 点「加载已解压的扩展程序 / 加载解压缩的扩展」，选择**文件夹**（不是 zip）。
5. 工具栏出现图标即成功。

> Edge 注意：加载的是副本，改代码后要在扩展页点「重新加载」（↻）；改完记得 **F5 刷新网页**，新 content script 才会注入。
> 测试本地页面（`ad-test.html`）：在扩展详情页打开「允许访问文件网址」。

## 使用方法

1. 看到要隐藏的元素 → 点工具栏图标 →「开始选择要隐藏的元素」（或直接 `Ctrl+Shift+Y`）。
2. 鼠标移上去会出现**蓝色边框缓缓亮起**；点一下出现确认条。
   - 「隐藏此元素」→ 播放折叠动画并保存规则。
   - 「选父级」或 **Alt+滚轮**→ 选上一层容器（广告 img 与外层 div 同大时建议选父级）。
   - 父级与当前元素同大时，确认条会提示「建议选父级整体隐藏」。
3. `ESC` 退出点选；`Ctrl+Z` 撤销最近一条。
4. 弹窗里可管理规则：单条删除、全部恢复、定位、导入导出、切换隐藏方式。

## 规则存储

- 存于浏览器 `chrome.storage.local`，键名 `eraser_rules_v1`，按网站域名分类。
- 文件位置：浏览器用户数据目录下的 `Local Extension Settings\<扩展ID>\`（Edge：`%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\...`，Chrome 同理）。
- **仅本地、不联网、不上传**；清除浏览数据 / 换电脑会丢失——可用「导出规则」备份。

## 特效修改（在 `content.js` 顶部 `EFFECTS` 对象）

```js
var EFFECTS = {
  pick: {              // 点选高亮蓝框
    rgb: '33,150,243', // 颜色 RGB
    alpha: .9,         // 边框最终透明度
    bgAlpha: .16,      // 填充最终透明度
    width: 2,          // 边框粗细 px
    radius: 3,         // 圆角 px
    fadeIn: 600        // 缓动亮起时长 ms
  },
  hide: {              // 隐藏动画
    style: 'collapse', // collapse | scale | blur | scan | iris
    duration: 350,     // ms
    easing: 'ease'
  }
};
```

| 想改 | 改哪里 |
|---|---|
| 隐藏动画风格 | `hide.style` 一个单词：`collapse`（折叠，默认不留空隙）/ `scale`（缩放淡出）/ `blur`（模糊消散）/ `scan`（扫描擦除）/ `iris`（圆形闭合） |
| 折叠 / 动画时长 | `hide.duration`（ms） |
| 缓动曲线 | `hide.easing`（如 `ease-in-out`、`cubic-bezier(...)`） |
| 蓝框颜色 | `pick.rgb` |
| 蓝框淡入时长 / 粗细 / 圆角 / 透明度 | `pick.fadeIn` / `pick.width` / `pick.radius` / `pick.alpha`、`pick.bgAlpha` |

改完保存 → 重载扩展 + F5 页面即可看到效果。

## 文件结构

```
element-eraser/
├── manifest.json     MV3 清单（storage + contextMenus 权限、background、commands）
├── content.js        核心：规则应用 / 点选器 / Shadow DOM 穿透 / 隐藏动画 / 撤销 / 失效提示
├── background.js     service worker：右键菜单 + 快捷键
├── popup.html        弹窗界面（含深色模式）
├── popup.js          弹窗逻辑：撤销 / 导入导出 / 定位 / 隐藏方式切换
└── icon16/48/128.png 图标
```

仓库另附：`ad-test.html`（本地广告测试页）、`gen_icons.py`（Pillow 生成图标）。

## 兼容性

- Chrome / Edge（MV3）。
- Firefox 需在 manifest 加 `browser_specific_settings`。
- 不支持 `chrome://` 等内置页面；Shadow DOM 仅支持 **open** 模式。

## License

MIT
