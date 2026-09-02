# Local Package Tool 插件 (local-package-tool)

`local-package-tool` 是一个用于将 SOC 侧自研 IM 产物包与 M 侧交付产物包（及可选第三方模块包）合并打包为对外交付整包的 Mini Pipeline 插件。同时自动提取版本信息、生成 MD5 校验文件、部署说明 Readme，并基于元数据生成 CPU 绑核分布分析 JSON 与可视化 HTML 报表。

---

## 1. 插件基本信息

- **插件名称**：`local-package-tool`
- **版本**：`1.0.0`
- **运行时**：`shell` (入口脚本: `run.sh`)
- **协议标准**：Mini Pipeline Runtime Protocol v2 (Zero-SDK)

---

## 2. 输入资源定义 (Inputs)

| 输入项名称 (`name`) | 类型 (`type`) | 来源 (`source`) | 是否必填 (`required`) | 目标路径 (`target`) | 描述 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `full_package_name` | `string` | `parameter` | **是 (必填)** | `full_package_name.txt` | 期望生成的对外整包名称（不含 `.tar.gz` 后缀，例如 `Lcsuvcar_L3_IPD_SoC-SW100-RP12-hotfix1_Orin-X_20260421`） |
| `im_package` | `file` | `upload` / `package` | **是 (必填)** | `im/im_package.tar.gz` | SOC 侧 CI 流水线编译出的 IM 包（`.tar.gz` 格式） |
| `m_package` | `file` | `upload` / `package` | **是 (必填)** | `m/m_package.tar.gz` | M 侧提供的交付产物包（`.tar.gz` 格式，有且仅有 1 个） |
| `modules_package` | `file` | `upload` / `package` | **否 (选填)** | `modules/modules_package.tar.gz` | 可选的第三方模块压缩包（支持 `.tar.gz` 或 `.zip` 格式） |

> **使用说明**：
> - 用户在前端页面或 API 触发流水线时，在表单中填入 `full_package_name` 参数，并在上传框中上传 `im_package` 与 `m_package`（`modules_package` 为选填项）。
> - 也支持通过制品仓库（Package Hub）中已存在的文件作为输入来源（`source: package`）。

---

## 3. 输出产物定义 (Outputs)

| 产物名称 (`name`) | 类型 (`type`) | 路径模式 (`path`) | 说明 |
| :--- | :--- | :--- | :--- |
| `packages` | `directory` | `output` | 输出目录根文件夹，收集所有生成物料 |
| `full_package` | `file` | `output/**/*.tar.gz` | 生成的总整包文件（内含 `im/` 与 `m/` 完整目录结构，使用 pigz/gzip 高效压缩） |
| `checksum` | `file` | `output/**/*.checksum.txt` | 总整包对应的 MD5 校验码文件 |
| `readme` | `file` | `output/**/*.readme.txt` | 针对当前版本的部署说明及 IM/M Version 提取信息 |
| `affinity_json` | `file` | `output/**/module_affinity.json` | 模块 CPU 核心亲和性与调度优先级元数据 JSON |
| `affinity_html` | `file` | `output/**/module_affinity.html` | 模块 CPU 绑核分布柱状图与下钻可视化 HTML 报表 |

*(当上传了 `modules_package` 时，还会额外在对应输出目录生成 `<IM原名>.tar.gz`、`<IM原名>.checksum.txt` 与 `<IM原名>.readme.txt` 的 im+modules 汇总产物)*

---

## 4. 示例流水线 (Pipeline YAML)

```yaml
name: local-package-pipeline
description: 打包交付对外整包流水线
params:
  full_package_name: "Lcsuvcar_L3_IPD_SoC-SW100-RP12-hotfix1_Orin-X_20260421"
steps:
  - name: package-step
    plugin: local-package-tool@1.0.0
    with:
      full_package_name: "${{ params.full_package_name }}"
      im_package:
        source: upload
      m_package:
        source: upload
      modules_package:
        source: upload
```

---

## 5. 迁移改造说明

相较于原离线终端执行脚本（`/data/gitlabpro/local_package_tool/deploy.sh`），本插件进行了如下适配与优化：
1. **移除 `sudo` 依赖**：流水线工作节点以当前 Agent/容器权限执行，杜绝了 CI 交互式提权阻塞问题；
2. **移除交互式倒计时确认**：转为完全非阻塞的全自动 CI 执行流程；
3. **适配 Pipeline Runtime Protocol v2**：根据 `context.json`、`params.json` 及 `input/`、`output/` 工作空间自动解析输入与产物收集；
4. **兼顾单包与多包模式**：自动识别 `IPD` / `RIPD` 变体并分发构建；
5. **智能压缩器探测**：优先使用多线程 `pigz` 进行高效压缩，环境缺失时平滑回退至标准 `gzip`。
