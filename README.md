# AtomCode 配置管理

可视化管理 [AtomCode](https://atomcode.atomgit.com) `~/.atomcode/config.toml` 的桌面应用，基于 Tauri 2 + React + TypeScript 构建。

它把原本需要手动编辑 TOML 的提供商与模型配置，变成可交互的界面操作：协议与 UA 选择、远端模型拉取、视觉能力与上下文编辑、原始配置查看，以及写回时的自动规范化整理。

## 特性

| 类别 | 能力 |
| --- | --- |
| 提供商管理 | 添加 / 编辑 / 删除账户；协议类型下拉选择；User-Agent 预设；删除时级联清理归属模型与 `default_provider` |
| 模型管理 | 从 `/v1/models` 拉取并勾选增删；搜索过滤；展示上下文、图文能力、积分倍率、推理档位 |
| 元数据编辑 | 上下文窗口（`1M` / `200K` / 数字）、视觉能力开关；远端缺失时写入默认 1M |
| 配置查看 | 只读查看 / 编辑原始 `config.toml`，保存前校验 TOML 合法性 |
| 写回整理 | provider / model 段落按名称排序归拢；注释归属绑定；清除多余空行 |
| 运行体验 | 单实例启动；后端兼容多种网关的元数据字段格式 |

## 快速开始

### 环境要求

- Node.js 18+
- Rust 工具链（Tauri 2 开发依赖）
- 平台：Windows / macOS / Linux

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run tauri dev
```

该命令会同时启动 Vite 前端（默认 `http://localhost:1420`）与 Tauri 桌面窗口，前端改动通过 HMR 实时生效。

### 构建发布包

```bash
npm run tauri build
```

产物位于 `src-tauri/target/release/bundle/`，按平台生成 MSI、NSIS 或对应安装包。

## 功能说明

### 协议与 User-Agent

协议类型以下拉框选择，覆盖 AtomCode 支持的取值：

| 协议值 | 说明 |
| --- | --- |
| `openai` | OpenAI 原生协议 |
| `openai-compatible` | OpenAI 兼容接口 |
| `openai-responses` | OpenAI Responses 接口 |
| `claude` | Claude / Anthropic 原生协议 |
| `anthropic-compatible` | Anthropic 兼容接口 |
| `ollama` | 本地 Ollama 服务 |
| `auto` | 自动识别 |

User-Agent 默认不设置（沿用 AtomCode 自带 UA），可选 Codex CLI 风格 UA，便于部分网关放行 Codex 专用模型。配置中已有的自定义协议或 UA 值会作为额外选项保留，编辑时不会丢失。

### 模型元数据

拉取远端模型后按账户展示，并解析以下字段：

- `context_window`：兼容数字、对象（`supported` 取最大值）及 `context_length` / `max_context_tokens` 等回退字段
- `supports_vision`：兼容 `supports_image_input` / `supports_images`
- `reasoning_effort_levels`：从 `reasoning_options` 或 `reasoning_supported_efforts` 提取，过滤 `off` / `none`
- 积分倍率：兼容数字与字符串（如 `"x0.11"`），按「账户 + 模型」缓存在 localStorage

已配置但远端未返回的模型也会列出，可手动取消勾选删除。

### 写回规范化

每次写回统一执行以下整理：

1. 顶层字段置顶
2. `[provider_accounts.*]` 与 `[models.*]` 分别按名称排序并归拢
3. 其余段落保持原有相对顺序
4. 段落内不留空行，段间保留恰好一个空行
5. 注释与其所属表头绑定，避免跨段漂移导致字段与表头分离

写回采用段落级文本替换，保留原文件中未涉及的内容。

## 项目结构

```text
.
├── src/
│   ├── App.tsx          # 界面与配置写回逻辑
│   ├── App.css          # 样式
│   ├── config.ts        # 配置解析、TOML 规范化、Tauri 命令封装
│   └── main.tsx         # 应用入口
└── src-tauri/
    ├── src/
    │   ├── lib.rs       # 配置读写、远端模型拉取、元数据解析
    │   └── main.rs      # Tauri 入口
    └── tauri.conf.json  # Tauri 配置
```

## 技术栈

- **前端**：React 19、TypeScript、Vite、`smol-toml`
- **后端**：Rust、Tauri 2、`reqwest`、`toml`
