# Calendar Studio / 日历工作台

[中文](#中文) | [English](#english)

Calendar Studio 是一个面向 Obsidian 日笔记与任务的日历插件。它支持在月、周、日、双周、议程和甘特视图中查看日程，并可通过拖拽和缩放调整时间。

本项目是 [Obsidian Big Calendar](https://github.com/Quorafind/Obsidian-Big-Calendar) 的重命名修改版。原项目由 [Boninall](https://github.com/Quorafind) 创建并以 MIT 许可发布。感谢原作者的工作与开源贡献。

> 本仓库中的 Calendar Studio 是一个独立修改版，不是上游官方仓库，也未上架 Obsidian 社区插件市场。

## 功能

- 月、周、日、双周、议程和甘特视图
- 从日笔记中的任务和时间块读取事件
- 点击事件跳转到对应笔记
- 创建、编辑、拖拽和缩放事件
- 文件变化后自动刷新日程
- 可配置每周起始日、时间范围和笔记处理范围
- 内置中英文等多语言界面

## 安装

1. 从本仓库下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 在 Vault 中创建目录 `.obsidian/plugins/calendar-studio/`。
3. 将三个文件放入该目录。
4. 重启 Obsidian，在“设置 > 第三方插件”中启用 `Calendar Studio`。

## 使用

插件会识别以下日笔记写法：

```markdown
- [ ] 15:00 团队会议
- [ ] 14:00-18:00 项目讨论
- 19:00 晚餐
- [ ] 整理项目提案
```

启用后，可从左侧 ribbon 图标或命令面板打开日历。事件的新增与修改会写回配置的日笔记位置。

## 开发

```bash
npm install
npm run dev
npm run build
```

构建输出为根目录下的 `main.js` 和 `styles.css`。

## 致谢与许可

- 原项目：[Quorafind/Obsidian-Big-Calendar](https://github.com/Quorafind/Obsidian-Big-Calendar)
- 原作者：Boninall
- 本项目修改与维护：pmmxd
- 许可：[MIT](LICENSE)

原始版权声明保留在 [LICENSE](LICENSE) 中。

## English

Calendar Studio is a calendar plugin for Obsidian daily notes and tasks. It provides month, week, day, bi-week, agenda, and Gantt views, with drag-and-drop and resize support.

This project is a renamed derivative of [Obsidian Big Calendar](https://github.com/Quorafind/Obsidian-Big-Calendar), originally created by [Boninall](https://github.com/Quorafind) and released under the MIT License. Thanks to the original author for the work and the open-source contribution.

> This is an independent modified version. It is not the official upstream repository and is not published in the Obsidian Community Plugins directory.

### Features

- Month, week, day, bi-week, agenda, and Gantt views
- Events parsed from tasks and time blocks in daily notes
- Click-through from events to their source notes
- Create, edit, drag, and resize events
- Automatic refresh when notes change
- Configurable week start, visible hours, and note-processing scope
- Built-in localization, including Chinese and English

### Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from this repository.
2. Create `.obsidian/plugins/calendar-studio/` in your vault.
3. Put the three files in that directory.
4. Restart Obsidian and enable `Calendar Studio` under **Settings > Community plugins**.

### Development

```bash
npm install
npm run dev
npm run build
```

### Credits and license

- Upstream: [Quorafind/Obsidian-Big-Calendar](https://github.com/Quorafind/Obsidian-Big-Calendar)
- Original author: Boninall
- Modifications and maintenance: pmmxd
- License: [MIT](LICENSE)

The original copyright notice is preserved in [LICENSE](LICENSE).
