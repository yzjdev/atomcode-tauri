# 项目说明

## 构建约定

- 正式版（release）只编译并提交 `release/atomcode-tauri.exe`，不生成、不提交 MSI / NSIS 安装包。
- 更新正式版流程：运行 `npm run tauri build`，将 `src-tauri/target/release/atomcode-tauri.exe` 覆盖到 `release/atomcode-tauri.exe`，然后提交并推送该 exe。
