import { parse } from "smol-toml";
import { invoke } from "@tauri-apps/api/core";

/** 配置数据结构（对齐 config.toml） */
export interface ProviderAccount {
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  /** HTTP 请求 User-Agent；空字符串表示不设置（使用默认 UA） */
  userAgent: string;
}

export interface ModelInfo {
  name: string;
  account: string;
  model: string;
  contextWindow: number | null;
  supportsVision: boolean | null;
  reasoningEffortLevels: string[];
}

export interface AppConfig {
  defaultProvider: string | null;
  defaultModel: string | null;
  accounts: ProviderAccount[];
  models: ModelInfo[];
}

/** atomcode 支持的 provider 协议类型（下拉选项）。
 * 值与 config.toml 中 [provider_accounts.X].provider 对应。 */
export const PROVIDER_PROTOCOLS: { value: string; label: string }[] = [
  { value: "openai", label: "OpenAI 协议" },
  { value: "openai-compatible", label: "OpenAI 兼容接口" },
  { value: "openai-responses", label: "OpenAI Responses 接口" },
  { value: "claude", label: "Claude / Anthropic 原生" },
  { value: "anthropic-compatible", label: "Anthropic 兼容接口" },
  { value: "ollama", label: "本地 Ollama" },
  { value: "auto", label: "自动识别 (auto)" },
];

/** 判断协议值是否在支持列表内（用于兼容配置中自定义的旧值）。 */
export const isKnownProtocol = (value: string) =>
  PROVIDER_PROTOCOLS.some((p) => p.value === value);

/** Codex CLI 风格 User-Agent。部分网关按此 UA 放行 Codex 专用模型。
 * 来源：codex-rs 的 get_codex_user_agent() 格式。 */
export const CODEX_USER_AGENT =
  "codex_cli_rs/0.98.0 (Windows 10.0.26100; x86_64) WindowsTerminal";

/** User-Agent 下拉选项；空值表示不设置（沿用 atomcode 默认 UA）。 */
export const USER_AGENT_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "不设置（默认）" },
  { value: CODEX_USER_AGENT, label: "Codex CLI" },
];

export interface RemoteModel {
  id: string;
  context_window?: number;
  supports_vision?: boolean;
  /** 远端提供的推理档位 */
  reasoning_effort_levels?: string[];
  /** 远端提供的积分倍率（各网关字段命名不一，后端尽力解析） */
  credit_multiplier?: number;
  /** 仅前端使用：该行来自本地配置而远端未返回 */
  absent_remote?: boolean;
}

/** 用 smol-toml（TOML 1.0 规范完整实现）解析：只取顶层 default_provider/default_model、
 * [provider_accounts.X] 与 [models."X"] 所需字段，文件其余内容不参与展示。 */
export function parseConfigToml(text: string): AppConfig {
  const doc = parse(text);

  const isTable = (v: unknown): v is Record<string, unknown> =>
    Object.prototype.toString.call(v) === "[object Object]";

  const accounts: ProviderAccount[] = [];
  if (isTable(doc.provider_accounts)) {
    for (const [name, t] of Object.entries(doc.provider_accounts)) {
      if (!isTable(t)) continue;
      accounts.push({
        name,
        provider: typeof t.provider === "string" ? t.provider : "",
        baseUrl: typeof t.base_url === "string" ? t.base_url : "",
        apiKey: typeof t.api_key === "string" ? t.api_key : "",
        userAgent: typeof t.user_agent === "string" ? t.user_agent : "",
      });
    }
  }

  const models: ModelInfo[] = [];
  if (isTable(doc.models)) {
    for (const [name, t] of Object.entries(doc.models)) {
      if (!isTable(t)) continue;
      models.push({
        name,
        account: typeof t.account === "string" ? t.account : "",
        model: typeof t.model === "string" ? t.model : "",
        contextWindow:
          typeof t.context_window === "number" && Number.isFinite(t.context_window)
            ? t.context_window
            : null,
        supportsVision: typeof t.supports_vision === "boolean" ? t.supports_vision : null,
        reasoningEffortLevels: Array.isArray(t.reasoning_effort_levels)
          ? t.reasoning_effort_levels.filter(
              (v): v is string => typeof v === "string" && v !== "",
            )
          : [],
      });
    }
  }

  return {
    defaultProvider: typeof doc.default_provider === "string" ? doc.default_provider : null,
    defaultModel: typeof doc.default_model === "string" ? doc.default_model : null,
    accounts,
    models,
  };
}

type SectionCategory = "provider_accounts" | "models" | "other";

interface TomlSection {
  name: string;
  category: SectionCategory;
  /** 段落名去掉引号后的部分，用于排序 */
  sortKey: string;
  /** 紧邻表头之前、属于该段落的注释行 */
  leading: string[];
  /** 表头 + 段落内容（不含段间空行） */
  body: string[];
}

const sectionCategory = (name: string): SectionCategory => {
  const base = name.split(".")[0];
  if (base === "provider_accounts") return "provider_accounts";
  if (base === "models") return "models";
  return "other";
};

const unquoteKey = (s: string): string => {
  const t = s.trim();
  if (
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) ||
      (t.startsWith("'") && t.endsWith("'")))
  ) {
    return t.slice(1, -1);
  }
  return t;
};

/** 段落名 → 排序键（去掉 provider_accounts./models. 前缀与引号） */
const sortKeyOf = (name: string): string => {
  const parts = name.split(".");
  const rest = parts.slice(1).join(".");
  return unquoteKey(rest || name);
};

/** 规范化 TOML 排版并整理段落顺序：
 * 顶层字段 → provider_accounts（按名称排序）→ models（按名称排序）→ 其余段落（保持原序）。
 *
 * 注释规则（关键）：
 * - 注释始终绑定它后面的表头，作为该段落的前置文档注释；绝不跨段漂移。
 * - provider_accounts / models 段落正文里的注释（例如被旧版本误插进来的全局文档）
 *   统一移到文件末尾，保证表头与其字段紧贴、不被注释拆散。
 * - 其余段落（network.proxy / datalog 等）正文里的注释保持原位（如注释掉的示例配置）。 */
export function normalizeTomlText(text: string): string {
  const nonBlank = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== "");

  const isHeader = (l: string) => /^\s*\[.+\]\s*$/.test(l);
  const isComment = (l: string) => l.trim().startsWith("#");

  const preamble: string[] = [];
  const sections: TomlSection[] = [];
  let pending: string[] = []; // 尚未归属的注释
  let current: TomlSection | null = null;

  for (const line of nonBlank) {
    if (isComment(line)) {
      pending.push(line);
      continue;
    }
    if (isHeader(line)) {
      const name = line.trim().slice(1, -1).trim();
      current = {
        name,
        category: sectionCategory(name),
        sortKey: sortKeyOf(name),
        leading: pending,
        body: [line],
      };
      sections.push(current);
      pending = [];
      continue;
    }
    // 字段行：先把待归属注释放进当前段落（无当前段落则放 preamble）
    const target = current?.body ?? preamble;
    if (pending.length) {
      target.push(...pending);
      pending = [];
    }
    target.push(line);
  }
  const tail = pending;

  // 把 provider/model 段落正文里的注释抽到文件末尾，保证字段紧贴表头
  const misplaced: string[] = [];
  for (const s of sections) {
    if (s.category !== "provider_accounts" && s.category !== "models") continue;
    const kept: string[] = [];
    for (const l of s.body) {
      if (isComment(l)) misplaced.push(l);
      else kept.push(l);
    }
    s.body = kept;
  }

  const byName = (a: TomlSection, b: TomlSection) =>
    a.sortKey.localeCompare(b.sortKey, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  const ordered = [
    ...sections.filter((s) => s.category === "provider_accounts").sort(byName),
    ...sections.filter((s) => s.category === "models").sort(byName),
    ...sections.filter((s) => s.category === "other"),
  ];

  // 组装：块间恰好一个空行，块内字段连续
  const chunks: string[] = [];
  if (preamble.length) chunks.push(preamble.join("\n"));
  for (const s of ordered) {
    const block = [...s.leading, ...s.body];
    if (block.length) chunks.push(block.join("\n"));
  }
  if (misplaced.length) chunks.push(misplaced.join("\n"));
  if (tail.length) chunks.push(tail.join("\n"));

  return chunks.join("\n\n") + "\n";
}

// ---- Tauri 命令封装 ----

export const readConfigText = () => invoke<string>("read_config_text");

/** 写回前统一规范化排版，保证界面编辑与程序化写入都不产生杂乱空行。 */
export const writeConfigText = (text: string) =>
  invoke<void>("write_config_text", { text: normalizeTomlText(text) });

export const fetchProviderModels = (baseUrl: string, apiKey: string) =>
  invoke<RemoteModel[]>("fetch_provider_models", {
    baseUrl,
    apiKey,
  });

/** 格式化上下文窗口大小（与 Kotlin 版 formatContextWindow 一致） */
export function formatContextWindow(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v % 1 === 0 ? v : v.toFixed(1)}M`;
  }
  if (n >= 1000) {
    const v = n / 1000;
    return `${v % 1 === 0 ? v : v.toFixed(1)}K`;
  }
  return String(n);
}

/** 格式化积分倍率：去掉多余小数零，前缀 ×（如 ×0.5、×3） */
export function formatMultiplier(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return `×${rounded}`;
}
