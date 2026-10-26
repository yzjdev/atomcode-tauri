use serde::Serialize;
use std::fs;
use std::path::PathBuf;

/// 配置文件路径：~/.atomcode/config.toml
fn config_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(".atomcode").join("config.toml"))
        .ok_or_else(|| "无法定位用户主目录".to_string())
}

/// 原样读出配置文件文本。
#[tauri::command]
fn read_config_text() -> Result<String, String> {
    let path = config_path()?;
    fs::read_to_string(&path).map_err(|e| format!("读取配置失败: {e}"))
}

/// 原样写回配置文件文本（覆盖保存）。
#[tauri::command]
fn write_config_text(text: String) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    // 写入前校验 TOML 合法，防止把坏配置写回磁盘
    text.parse::<toml::Table>()
        .map_err(|e| format!("TOML 格式错误: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("写入配置失败: {e}"))
}

/// 远端模型（/v1/models 返回的单项）。
#[derive(Serialize, Clone)]
pub struct RemoteModel {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_vision: Option<bool>,
}

/// 拼接远端模型列表地址：兼容 base_url 已带 `/v1` 或已指向 `/models` 的写法。
fn models_url(base_url: &str) -> Result<String, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("base_url 为空，无法拉取模型".to_string());
    }
    if base.ends_with("/models") {
        Ok(base.to_string())
    } else if base.ends_with("/v1") {
        Ok(format!("{base}/models"))
    } else {
        Ok(format!("{base}/v1/models"))
    }
}

/// 转发 GET {base_url}/v1/models 请求，规避浏览器跨域限制。
/// 兼容 OpenAI 风格 { data: [{id, ...}] } 与裸数组 [{id, ...}] 两种返回。
#[tauri::command]
async fn fetch_provider_models(
    base_url: String,
    api_key: String,
) -> Result<Vec<RemoteModel>, String> {
    let url = models_url(&base_url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let mut req = client.get(&url);
    if !api_key.trim().is_empty() {
        req = req.bearer_auth(api_key.trim());
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("请求 {url} 失败: {e}"))?;
    let status = resp.status();
    // 先取文本再解析：非 JSON 的错误响应（比如 HTML 错误页）也能返回可读信息
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败 (HTTP {status}): {e}"))?;
    if !status.is_success() {
        let trimmed = text.trim();
        let brief: String = trimmed.chars().take(300).collect();
        let ellipsis = if trimmed.chars().count() > 300 { "…" } else { "" };
        return Err(format!("HTTP {status}: {brief}{ellipsis}"));
    }
    let body: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("解析响应失败 (HTTP {status}): {e}"))?;

    let items = match &body {
        serde_json::Value::Array(a) => a.clone(),
        serde_json::Value::Object(o) => match o.get("data") {
            Some(serde_json::Value::Array(a)) => a.clone(),
            _ => return Err("响应格式无法识别（缺少 data 数组）".to_string()),
        },
        _ => return Err("响应格式无法识别".to_string()),
    };

    let mut models: Vec<RemoteModel> = items
        .into_iter()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.to_string();
            // 元数据按常见命名做尽力解析，缺失则不展示
            let context_window = item
                .get("context_window")
                .or_else(|| item.get("context_length"))
                .or_else(|| item.get("max_context_tokens"))
                .and_then(|v| v.as_u64());
            let supports_vision = item
                .get("supports_vision")
                .or_else(|| item.get("supports_image_input"))
                .and_then(|v| v.as_bool());
            Some(RemoteModel {
                id,
                context_window,
                supports_vision,
            })
        })
        .collect();
    // 聚合网关可能重复返回同一模型，去重 + 排序让列表稳定
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models.dedup_by(|a, b| a.id == b.id);

    Ok(models)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_config_text,
            write_config_text,
            fetch_provider_models
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
