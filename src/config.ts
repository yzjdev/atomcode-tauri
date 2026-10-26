import { invoke } from "@tauri-apps/api/core";

/** 配置数据结构（对齐 config.toml） */
export interface ProviderAccount {
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
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

export interface RemoteModel {
  id: string;
  context_window?: number;
  supports_vision?: boolean;
}

/** 轻量 TOML 子集解析（与 Kotlin 版逻辑一致）：只关心顶层标量、[provider_accounts.X] 与 [models."X"]。 */
export function parseConfigToml(text: string): AppConfig {
  let defaultProvider: string | null = null;
  let defaultModel: string | null = null;
  const accounts: ProviderAccount[] = [];
  const models: ModelInfo[] = [];

  let section: string | null = null;
  let accountName: string | null = null;
  let modelName: string | null = null;
  let accountProvider = "";
  let accountBaseUrl = "";
  let accountApiKey = "";
  let modelAccount: string | null = null;
  let modelId: string | null = null;
  let modelContext: number | null = null;
  let modelVision: boolean | null = null;
  let modelEffort: string[] = [];

  const stripQuotes = (raw: string) => {
    const s = raw.trim();
    if (
      s.length >= 2 &&
      ((s.startsWith('"') && s.endsWith('"')) ||
        (s.startsWith("'") && s.endsWith("'")))
    ) {
      return s.slice(1, -1);
    }
    return s;
  };

  const flushAccount = () => {
    if (accountName != null) {
      accounts.push({
        name: accountName,
        provider: accountProvider,
        baseUrl: accountBaseUrl,
        apiKey: accountApiKey,
      });
    }
    accountName = null;
    accountProvider = "";
    accountBaseUrl = "";
    accountApiKey = "";
  };

  const flushModel = () => {
    if (modelName != null) {
      models.push({
        name: modelName,
        account: modelAccount ?? "",
        model: modelId ?? "",
        contextWindow: modelContext,
        supportsVision: modelVision,
        reasoningEffortLevels: modelEffort,
      });
    }
    modelName = null;
    modelAccount = null;
    modelId = null;
    modelContext = null;
    modelVision = null;
    modelEffort = [];
  };

  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    let line = lines[i].trim();
    i++;
    if (line === "" || line.startsWith("#")) continue;

    // 跨行数组（reasoning_effort_levels = [ ... ]）
    if (line.includes("=")) {
      const after = line.slice(line.indexOf("=") + 1).trim();
      if (after.startsWith("[") && !after.endsWith("]")) {
        while (i < lines.length && !lines[i - 1].trim().endsWith("]")) {
          line += " " + lines[i].trim();
          i++;
        }
      }
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      if (section === "provider_accounts") flushAccount();
      if (section === "models") flushModel();
      const header = line.slice(1, -1).trim();
      if (header === "provider_accounts" || header.startsWith("provider_accounts.")) {
        section = "provider_accounts";
        accountName = stripQuotes(header.split(".").slice(1).join(".") || "");
      } else if (header === "models" || header.startsWith("models.")) {
        section = "models";
        modelName = stripQuotes(header.split(".").slice(1).join(".") || "");
      } else {
        section = header.split(".")[0].trim();
      }
      continue;
    }

    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = stripQuotes(line.slice(0, eq).trim());
    const value = line.slice(eq + 1).trim();

    if (section == null) {
      if (key === "default_provider") defaultProvider = stripQuotes(value);
      if (key === "default_model") defaultModel = stripQuotes(value);
    } else if (section === "provider_accounts") {
      if (key === "provider") accountProvider = stripQuotes(value);
      if (key === "base_url") accountBaseUrl = stripQuotes(value);
      if (key === "api_key") accountApiKey = stripQuotes(value);
    } else if (section === "models") {
      if (key === "account") modelAccount = stripQuotes(value);
      if (key === "model") modelId = stripQuotes(value);
      if (key === "context_window") modelContext = Number(value) || null;
      if (key === "supports_vision")
        modelVision = value.trim() === "true" ? true : value.trim() === "false" ? false : null;
      if (key === "reasoning_effort_levels") {
        const inner = value.replace(/^\[/, "").replace(/\]$/, "");
        modelEffort = inner
          .split(",")
          .map(stripQuotes)
          .filter((s) => s !== "");
      }
    }
  }
  flushAccount();
  flushModel();

  return { defaultProvider, defaultModel, accounts, models };
}

// ---- Tauri 命令封装 ----

export const readConfigText = () => invoke<string>("read_config_text");

export const writeConfigText = (text: string) =>
  invoke<void>("write_config_text", { text });

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
