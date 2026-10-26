import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type AppConfig,
  type ModelInfo,
  type ProviderAccount,
  type RemoteModel,
  fetchProviderModels,
  formatContextWindow,
  parseConfigToml,
  readConfigText,
  writeConfigText,
} from "./config";
import "./App.css";

/** 不在界面中展示的内置账户 */
const HIDDEN_ACCOUNTS = new Set(["builtin", "default", "atomgit"]);

/** 远端未提供上下文窗口时的默认展示值：1M */
const DEFAULT_CONTEXT_WINDOW = 1_000_000;

/** 从 [models."X"] / [models.X] / [models.'X'] 表头取出模型名，非模型表头返回 null */
function modelHeaderName(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner.startsWith("models.")) return null;
  return inner.slice("models.".length).trim().replace(/^["']|["']$/g, "");
}

/** 从 [provider_accounts."X"] 等表头取出账户名，非账户表头返回 null */
function accountHeaderName(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner.startsWith("provider_accounts.")) return null;
  return inner
    .slice("provider_accounts.".length)
    .trim()
    .replace(/^["']|["']$/g, "");
}

/** 转义 TOML 基本字符串里的反斜杠与双引号，避免模型 ID 含特殊字符时写出坏配置 */
function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

type IconProps = { className?: string };

function DownloadIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v3.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5V15" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

function SpinnerIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

function PlusIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

function EditIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function VisionIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Lucide cpu：芯片主体 + 引脚 + 内核方块，模型能力的通用符号 */}
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2" />
      <path d="M15 20v2" />
      <path d="M2 15h2" />
      <path d="M2 9h2" />
      <path d="M20 15h2" />
      <path d="M20 9h2" />
      <path d="M9 2v2" />
      <path d="M9 20v2" />
    </svg>
  );
}

function VisionOffIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 芯片 + 对角斜杠：表示不具备该能力 */}
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2" />
      <path d="M15 20v2" />
      <path d="M2 15h2" />
      <path d="M2 9h2" />
      <path d="M20 15h2" />
      <path d="M20 9h2" />
      <path d="M9 2v2" />
      <path d="M9 20v2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

function ChevronIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CloseIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function CheckIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m20 6-9 9-5-5" />
    </svg>
  );
}

/**
 * 高度过渡的折叠容器：内容始终挂载，避免卸载重建导致无法播放进出动画。
 * 高度取自内容实测值（height 过渡在 WebView 内核上普遍支持，grid-template-rows 插值不一定）。
 */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setContentHeight(el.scrollHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={`collapse${open ? " open" : ""}`}
      style={{ height: open ? contentHeight : 0 }}
    >
      <div className="collapse-inner" ref={innerRef}>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [configText, setConfigText] = useState<string>("");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [fetching, setFetching] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchResult, setFetchResult] = useState<{
    account: ProviderAccount;
    models: RemoteModel[];
  } | null>(null);
  const [editing, setEditing] = useState<ProviderAccount | null>(null);
  const [adding, setAdding] = useState(false);
  // 待确认删除的提供商
  const [deleting, setDeleting] = useState<ProviderAccount | null>(null);

  const reload = useCallback(async () => {
    try {
      const text = await readConfigText();
      setConfigText(text);
      setConfig(parseConfigToml(text));
      setError(null);
    } catch (e) {
      setError(String(e));
      setConfig(null);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /** 应用模型增删：重写 [models."X"] 段落后整体写回 */
  const applyModelSelection = async (
    accountName: string,
    additions: RemoteModel[],
    removals: string[],
  ) => {
    const lines = configText.split(/\r?\n/);
    // 删除：移除对应 [models."X"] 段落块（表头带引号/不带引号都能识别）
    for (const modelId of removals) {
      const existing = config?.models.find(
        (m) => m.account === accountName && m.model === modelId,
      );
      if (!existing) continue;
      const start = lines.findIndex((l) => modelHeaderName(l) === existing.name);
      if (start < 0) continue;
      let end = start + 1;
      while (end < lines.length && !(lines[end].trim().startsWith("[") && lines[end].trim().endsWith("]"))) {
        end++;
      }
      lines.splice(start, end - start);
    }
    // 添加：在文件末尾追加新段落，远端返回的元数据一并写入
    let out = lines.join("\n").replace(/\s*$/, "\n");
    for (const m of additions) {
      out += `\n[models."${escapeTomlString(m.id)}"]\n`;
      out += `account = "${escapeTomlString(accountName)}"\n`;
      out += `model = "${escapeTomlString(m.id)}"\n`;
      if (m.context_window != null && m.context_window > 0) {
        out += `context_window = ${m.context_window}\n`;
      }
      if (m.supports_vision != null) {
        out += `supports_vision = ${m.supports_vision}\n`;
      }
    }
    await writeConfigText(out);
    await reload();
  };

  /**
   * 添加提供商：在最后一个 [provider_accounts.X] 段落之后插入新段落
   * （没有账户段落时插到文件末尾）。
   */
  const addProviderAccount = async (next: ProviderAccount) => {
    const lines = configText.split(/\r?\n/);
    // 找最后一个账户段落的结束位置
    let insertAt = -1;
    for (let i = 0; i < lines.length; i++) {
      if (accountHeaderName(lines[i]) != null) {
        let end = i + 1;
        while (
          end < lines.length &&
          !(lines[end].trim().startsWith("[") && lines[end].trim().endsWith("]"))
        ) {
          end++;
        }
        insertAt = end;
      }
    }

    const block = [
      `[provider_accounts."${escapeTomlString(next.name)}"]`,
      `provider = "${escapeTomlString(next.provider)}"`,
      `base_url = "${escapeTomlString(next.baseUrl)}"`,
      `api_key = "${escapeTomlString(next.apiKey)}"`,
    ];
    if (insertAt >= 0) {
      lines.splice(insertAt, 0, "", ...block);
    } else {
      const tail = lines.join("\n").replace(/\s*$/, "\n");
      await writeConfigText(`${tail}\n${block.join("\n")}\n`);
      await reload();
      return;
    }

    await writeConfigText(lines.join("\n"));
    await reload();
  };

  /**
   * 更新单个模型的上下文窗口：只替换目标 [models."X"] 段落内的 context_window 行，
   * 该行原本不存在时插入到段落末尾。
   */
  const updateModelContext = async (modelName: string, contextWindow: number) => {
    const lines = configText.split(/\r?\n/);
    const start = lines.findIndex((l) => modelHeaderName(l) === modelName);
    if (start < 0) throw new Error(`配置中找不到模型 ${modelName}`);

    // 段落边界（不含后续表头）
    let end = start + 1;
    while (
      end < lines.length &&
      !(lines[end].trim().startsWith("[") && lines[end].trim().endsWith("]"))
    ) {
      end++;
    }

    const line = `context_window = ${contextWindow}`;
    const existing = lines
      .slice(start + 1, end)
      .findIndex((l) => /^(\s*)context_window\s*=/.test(l));
    if (existing >= 0) {
      lines[start + 1 + existing] = line;
    } else {
      lines.splice(end, 0, line);
    }

    await writeConfigText(lines.join("\n"));
    await reload();
  };

  /**
   * 更新提供商账户：重写 [provider_accounts.X] 段落。
   * 重命名时表头换新名，并同步所有引用旧名的 models.account 字段。
   */
  const updateProviderAccount = async (
    original: ProviderAccount,
    next: ProviderAccount,
  ) => {
    const lines = configText.split(/\r?\n/);
    const start = lines.findIndex(
      (l) => accountHeaderName(l) === original.name,
    );
    if (start < 0) throw new Error(`配置中找不到提供商 ${original.name}`);

    // 找到段落边界
    let end = start + 1;
    while (
      end < lines.length &&
      !(lines[end].trim().startsWith("[") && lines[end].trim().endsWith("]"))
    ) {
      end++;
    }

    // 重写段落内容，字段顺序保持 名称表头 → provider → base_url → api_key
    const header = `[provider_accounts."${escapeTomlString(next.name)}"]`;
    const body = [
      header,
      `provider = "${escapeTomlString(next.provider)}"`,
      `base_url = "${escapeTomlString(next.baseUrl)}"`,
      `api_key = "${escapeTomlString(next.apiKey)}"`,
    ];
    lines.splice(start, end - start, ...body);

    // 重命名时同步模型归属：逐行扫描，仅在 account 值等于原账户名时替换
    const out = lines
      .map((l) => {
        const m = l.match(/^(\s*account\s*=\s*)"((?:[^"\\]|\\.)*)"\s*$/);
        if (m && m[2] === original.name) {
          return `${m[1]}"${escapeTomlString(next.name)}"`;
        }
        return l;
      })
      .join("\n");

    await writeConfigText(out);
    await reload();
  };

  /**
   * 删除提供商：移除 [provider_accounts."X"] 段落，以及所有归属它的
   * [models."Y"] 段落；default_provider 指向它时一并清掉。
   */
  const deleteProviderAccount = async (name: string) => {
    const lines = configText.split(/\r?\n/);

    // 删除账户段落
    const accStart = lines.findIndex((l) => accountHeaderName(l) === name);
    if (accStart < 0) throw new Error(`配置中找不到提供商 ${name}`);
    let accEnd = accStart + 1;
    while (
      accEnd < lines.length &&
      !(lines[accEnd].trim().startsWith("[") && lines[accEnd].trim().endsWith("]"))
    ) {
      accEnd++;
    }
    lines.splice(accStart, accEnd - accStart);

    // 删除归属该账户的所有模型段落
    for (const m of config?.models.filter((m) => m.account === name) ?? []) {
      const start = lines.findIndex((l) => modelHeaderName(l) === m.name);
      if (start < 0) continue;
      let end = start + 1;
      while (
        end < lines.length &&
        !(lines[end].trim().startsWith("[") && lines[end].trim().endsWith("]"))
      ) {
        end++;
      }
      lines.splice(start, end - start);
    }

    // 清理指向该账户的 default_provider
    const out = lines
      .map((l) => (/^\s*default_provider\s*=/.test(l) ? "" : l))
      .filter((l, i, arr) => {
        // 过滤掉清空 default_provider 后残留的连续空行
        if (l === "" && i > 0 && arr[i - 1] === "") return false;
        return true;
      })
      .join("\n");

    await writeConfigText(out.replace(/\n{3,}/g, "\n\n"));
    await reload();
  };

  if (error) {
    return (
      <div className="page">
        <div className="card">
          <h2>无法加载配置</h2>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="page">
        <div className="card">
          <p className="muted">未找到配置文件 (~/.atomcode/config.toml)</p>
        </div>
      </div>
    );
  }

  const accounts = config.accounts.filter(
    (a) => !HIDDEN_ACCOUNTS.has(a.name.toLowerCase()),
  );
  const orphan = config.models.filter(
    (m) => !config.accounts.some((a) => a.name === m.account),
  );

  const toggleAccount = (name: string) =>
    setExpanded((s) => ({ ...s, [name]: !(s[name] ?? false) }));

  return (
    <div className="page">
      <header className="header">
        <span className="header-label">提供商</span>
        <button
          className="btn"
          onClick={() => setAdding(true)}
          title="添加提供商"
        >
          <PlusIcon />
          添加提供商
        </button>
      </header>

      {accounts.map((acc, cardIdx) => {
        const groupModels = config.models.filter((m) => m.account === acc.name);
        const isOpen = expanded[acc.name] ?? false;
        return (
          <section
            key={acc.name}
            className="card"
            style={{ animationDelay: `${cardIdx * 60}ms` }}
            onClick={() => groupModels.length > 0 && toggleAccount(acc.name)}
          >
            <div className="card-header">
              <span className="card-title">
                {acc.name}（{groupModels.length} 个模型）
              </span>
              <span
                className="expand-hint"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <button
                  className="btn ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(acc);
                  }}
                  title="编辑提供商"
                >
                  <EditIcon />
                  编辑
                </button>
                <button
                  className="btn ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFetching(acc.name);
                    setFetchError(null);
                    fetchProviderModels(acc.baseUrl, acc.apiKey)
                      .then((models) => setFetchResult({ account: acc, models }))
                      .catch((e) => {
                        setFetchError(`${acc.name}: ${e}`);
                      })
                      .finally(() => setFetching(null));
                  }}
                  disabled={fetching != null}
                >
                  {fetching === acc.name ? (
                    <SpinnerIcon className="spin" />
                  ) : (
                    <DownloadIcon />
                  )}
                  {fetching === acc.name ? "拉取中…" : "拉取模型"}
                </button>
                <button
                  className="btn ghost danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleting(acc);
                  }}
                  title="删除提供商"
                >
                  <CloseIcon />
                  删除
                </button>
                <button
                  type="button"
                  className="expand-toggle"
                  title={isOpen ? "收起" : "展开"}
                  aria-label={isOpen ? "收起" : "展开"}
                  aria-expanded={isOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (groupModels.length > 0) toggleAccount(acc.name);
                  }}
                >
                  <ChevronIcon className={`chevron${isOpen ? " up" : ""}`} />
                </button>
              </span>
            </div>
            <div className="kv">
              <span className="k">Base URL</span>
              <span className="kv-value">{acc.baseUrl}</span>
              <span className="provider-tag" title={`类型：${acc.provider}`}>
                {acc.provider}
              </span>
            </div>
            <div className="kv">
              <span className="k">API Key</span>
              <span>{acc.apiKey ? "已设置" : "未设置"}</span>
            </div>
            <Collapse open={isOpen}>
              {groupModels.map((m) => (
                <ModelRows key={m.name} model={m} onUpdateContext={updateModelContext} />
              ))}
            </Collapse>
          </section>
        );
      })}

      {orphan.length > 0 && (
        <section
          className="card"
          onClick={() => setExpanded((s) => ({ ...s, __orphan: !(s.__orphan ?? false) }))}
        >
          <div className="card-header">
            <span className="card-title">未归属提供商（{orphan.length} 个模型）</span>
            <button
              type="button"
              className="expand-toggle"
              title={(expanded.__orphan ?? false) ? "收起" : "展开"}
              aria-label={(expanded.__orphan ?? false) ? "收起" : "展开"}
              aria-expanded={expanded.__orphan ?? false}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((s) => ({ ...s, __orphan: !(s.__orphan ?? false) }));
              }}
            >
              <ChevronIcon
                className={`chevron${(expanded.__orphan ?? false) ? " up" : ""}`}
              />
            </button>
          </div>
          <div className="kv">
            <span className="k">模型数</span>
            <span>{orphan.length}</span>
          </div>
          <Collapse open={expanded.__orphan ?? false}>
            {orphan.map((m) => (
              <ModelRows key={m.name} model={m} onUpdateContext={updateModelContext} />
            ))}
          </Collapse>
        </section>
      )}

      {fetchError && (
        <div className="modal-backdrop" onClick={() => setFetchError(null)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h3>拉取失败</h3>
            <p className="error-text">{fetchError}</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setFetchError(null)}>
                <CloseIcon />
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {adding && (
        <EditAccountDialog
          account={null}
          takenNames={new Set(config.accounts.map((a) => a.name.toLowerCase()))}
          onDismiss={() => setAdding(false)}
          onSubmit={(next) =>
            addProviderAccount(next).then(() => {
              setAdding(false);
              setExpanded((s) => ({ ...s, [next.name]: true }));
            })
          }
        />
      )}

      {editing && (
        <EditAccountDialog
          account={editing}
          takenNames={new Set(
            config.accounts
              .filter((a) => a.name !== editing.name)
              .map((a) => a.name.toLowerCase()),
          )}
          onDismiss={() => setEditing(null)}
          onSubmit={(next) =>
            updateProviderAccount(editing, next).then(() => setEditing(null))
          }
        />
      )}

      {fetchResult && (
        <FetchModelsDialog
          account={fetchResult.account}
          remoteModels={fetchResult.models}
          existingIds={new Set(
            config.models
              .filter((m) => m.account === fetchResult.account.name)
              .map((m) => m.model),
          )}
          onDismiss={() => setFetchResult(null)}
          onApply={applyModelSelection}
        />
      )}

      {deleting && (
        <DeleteConfirmDialog
          account={deleting}
          modelCount={
            config.models.filter((m) => m.account === deleting.name).length
          }
          onDismiss={() => setDeleting(null)}
          onConfirm={() =>
            deleteProviderAccount(deleting.name).then(() => setDeleting(null))
          }
        />
      )}
    </div>
  );
}

/** 长按删除的确认弹窗：确认后删除提供商及其全部模型 */
function DeleteConfirmDialog({
  account,
  modelCount,
  onDismiss,
  onConfirm,
}: {
  account: ProviderAccount;
  modelCount: number;
  onDismiss: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
      onDismiss();
    } catch (e) {
      setError(String(e));
      setDeleting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onDismiss}>
      <div
        className="card modal modal-confirm"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>删除提供商（{account.name}）？</h3>
        <p className="muted small">
          将同时删除该提供商下的 {modelCount} 个模型，此操作无法撤销。
        </p>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onDismiss}>
            取消
          </button>
          <button className="btn danger" onClick={confirm} disabled={deleting}>
            {deleting ? "删除中…" : "删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 解析用户输入的上下文窗口：支持 "1M"、"200K"、"1000000" 等写法，非法时返回 null */
function parseContextWindow(input: string): number | null {
  const s = input.trim().toUpperCase();
  if (s === "") return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([KM])?$/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const multiplier = m[2] === "K" ? 1_000 : m[2] === "M" ? 1_000_000 : 1;
  return Math.round(value * multiplier);
}

/** 新增/编辑提供商的表单弹窗：四个字段校验，名称不能与其他账户重复 */
function EditAccountDialog({
  account,
  takenNames,
  onDismiss,
  onSubmit,
}: {
  /** 新增时传 null */
  account: ProviderAccount | null;
  takenNames: Set<string>;
  onDismiss: () => void;
  onSubmit: (next: ProviderAccount) => Promise<void>;
}) {
  const isEdit = account != null;
  const [name, setName] = useState(account?.name ?? "");
  const [provider, setProvider] = useState(account?.provider ?? "openai-compatible");
  const [baseUrl, setBaseUrl] = useState(account?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState(account?.apiKey ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nameError =
    name.trim() === ""
      ? "名称不能为空"
      : (!isEdit || name.trim() !== account.name) && takenNames.has(name.trim())
        ? "该名称已被其他提供商使用"
        : null;
  const providerError = provider.trim() === "" ? "类型不能为空" : null;
  const baseUrlError = baseUrl.trim() === "" ? "Base URL 不能为空" : null;

  const valid = !nameError && !providerError && !baseUrlError;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        provider: provider.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
      });
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onDismiss}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          {isEdit ? `编辑提供商（${account.name}）` : "添加提供商"}
        </h3>
        <div className="form">
          <label className="form-field">
            <span className="form-label">名称</span>
            <input
              className={`form-input${nameError ? " invalid" : ""}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 my-provider"
            />
            {nameError && <span className="error-text">{nameError}</span>}
          </label>
          <label className="form-field">
            <span className="form-label">类型</span>
            <input
              className={`form-input${providerError ? " invalid" : ""}`}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="例如 openai"
            />
            {providerError && <span className="error-text">{providerError}</span>}
          </label>
          <label className="form-field">
            <span className="form-label">Base URL</span>
            <input
              className={`form-input${baseUrlError ? " invalid" : ""}`}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
            {baseUrlError && <span className="error-text">{baseUrlError}</span>}
          </label>
          <label className="form-field">
            <span className="form-label">API Key</span>
            <input
              className="form-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="留空表示未设置"
              autoComplete="off"
            />
          </label>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onDismiss}>
            <CloseIcon />
            取消
          </button>
          <button className="btn" onClick={submit} disabled={!valid || saving}>
            <CheckIcon />
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModelRows({
  model,
  onUpdateContext,
}: {
  model: ModelInfo;
  onUpdateContext: (modelName: string, contextWindow: number) => Promise<void>;
}) {
  const contextWindow =
    model.contextWindow != null && model.contextWindow > 0
      ? model.contextWindow
      : DEFAULT_CONTEXT_WINDOW;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(formatContextWindow(contextWindow));
    setError(null);
    setEditing(true);
  };

  const commit = async () => {
    const parsed = parseContextWindow(draft);
    if (parsed == null) {
      setError("格式：1M / 200K / 纯数字");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onUpdateContext(model.name, parsed);
      setEditing(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      setEditing(false);
      setError(null);
    }
  };

  return (
    <div
      className="model-item"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="model-item-main">
        <span className="model-item-name" title={model.name}>
          {model.name}
        </span>
        <span className="model-item-meta">
          {model.supportsVision != null && (
            <span
              className={`model-item-vision${model.supportsVision ? " on" : " off"}`}
              title={model.supportsVision ? "支持图文" : "不支持图文"}
            >
              {model.supportsVision ? (
                <VisionIcon />
              ) : (
                <VisionOffIcon />
              )}
            </span>
          )}
          {/* 上下文窗口用便签样式突出显示；点击进入编辑 */}
          {editing ? (
            <span className="note note-editing" onClick={(e) => e.stopPropagation()}>
              <input
                className="note-input"
                value={draft}
                autoFocus
                disabled={saving}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                onBlur={commit}
                title="支持 1M / 200K / 纯数字，回车保存，Esc 取消"
              />
            </span>
          ) : (
            <span
              className="note"
              role="button"
              title={`上下文窗口 ${formatContextWindow(contextWindow)}，点击修改`}
              onClick={(e) => {
                e.stopPropagation();
                startEdit();
              }}
            >
              {formatContextWindow(contextWindow)}
            </span>
          )}
        </span>
        {error && <span className="error-text model-item-error">{error}</span>}
      </div>
      {model.name !== model.model && (
        <span className="model-item-id" title={model.model}>
          {model.model}
        </span>
      )}
    </div>
  );
}

function FetchModelsDialog({
  account,
  remoteModels,
  existingIds,
  onDismiss,
  onApply,
}: {
  account: ProviderAccount;
  remoteModels: RemoteModel[];
  existingIds: Set<string>;
  onDismiss: () => void;
  onApply: (
    accountName: string,
    additions: RemoteModel[],
    removals: string[],
  ) => Promise<void>;
}) {
  // 已配置项默认勾选（取消勾选 = 删除）；远端新增默认不勾选（勾选 = 添加）
  const [selected, setSelected] = useState<Set<string>>(new Set(existingIds));
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const visible = useMemo(
    () =>
      // 已勾选的模型排在前面，其余保持原有字母序（稳定排序）
      remoteModels
        .filter((m) =>
          search.trim() === ""
            ? true
            : m.id.toLowerCase().includes(search.trim().toLowerCase()),
        )
        .sort(
          (a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)),
        ),
    [remoteModels, search, selected],
  );

  const additions = remoteModels.filter(
    (m) => !existingIds.has(m.id) && selected.has(m.id),
  );
  const removals = [...existingIds].filter((id) => !selected.has(id));

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      await onApply(account.name, additions, removals);
      onDismiss();
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onDismiss}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <h3>远端模型（{account.name}）</h3>
        <p className="muted small">
          共 {remoteModels.length} 个远端模型。勾选=添加，取消勾选=删除；当前已有的会默认勾选。
        </p>
        <div className="search-wrap">
          <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            className="search"
            type="text"
            placeholder="搜索模型"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="model-list">
          {visible.length === 0 && (
            <p className="muted small empty-hint">
              {remoteModels.length === 0
                ? "远端没有返回任何模型，请检查 base_url 是否正确（接口为 /v1/models）"
                : "没有匹配的模型，换个关键词试试"}
            </p>
          )}
          {visible.map((model) => {
            return (
              <label
                key={model.id}
                className={`model-row${selected.has(model.id) ? " checked" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(model.id)}
                  onChange={(e) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(model.id);
                      else next.delete(model.id);
                      return next;
                    })
                  }
                />
                <span className="model-id">
                  {model.id}
                  <span className="muted meta">
                    {[
                      `上下文 ${formatContextWindow(
                        model.context_window && model.context_window > 0
                          ? model.context_window
                          : DEFAULT_CONTEXT_WINDOW,
                      )}`,
                      model.supports_vision != null
                        ? model.supports_vision
                          ? "支持图文"
                          : "不支持图文"
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {(additions.length > 0 || removals.length > 0) && (
          <p className="primary-text">
            {[
              additions.length > 0 && `将添加 ${additions.length} 个`,
              removals.length > 0 && `将删除 ${removals.length} 个`,
            ]
              .filter(Boolean)
              .join("，")}
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onDismiss}>
            <CloseIcon />
            取消
          </button>
          <button
            className="btn"
            onClick={apply}
            disabled={(additions.length === 0 && removals.length === 0) || applying}
          >
            <CheckIcon />
            {applying ? "应用中…" : "应用更改"}
          </button>
        </div>
      </div>
    </div>
  );
}
