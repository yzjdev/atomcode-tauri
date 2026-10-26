# AtomCode 配置管理

基于 Tauri 2 + React + TypeScript 的桌面应用，用于可视化管理 AtomCode 的 `~/.atomcode/config.toml` 配置文件。

## 功能

- **提供商管理**：添加、编辑、删除提供商账户（`[provider_accounts."X"]` 段落）；删除时级联清除归属模型并清理 `default_provider`
- **模型管理**：从远端 `/v1/models` 拉取模型列表，勾选增删（已勾选排序靠前并高亮），支持搜索过滤
- **上下文窗口**：编辑单模型的 `context_window`，支持 `1M`、`200K`、`1000000` 等写法
- 轻量 TOML 子集解析，保留原文件其余内容不动

## 开发

```bash
npm install
npm run tauri dev
```

## 构建发布包

```bash
npm run tauri build
```

## 技术栈

- 前端：React 19 + TypeScript + Vite
- 后端：Rust（Tauri 2，`reqwest` 拉取远端模型）
