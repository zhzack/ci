Pipeline Runtime Protocol v2（建议方案）
一、设计原则

整个平台遵循以下原则：

1、Plugin 不感知平台

插件开发者无需：

import SDK
继承 Plugin 类
调用平台 API
调用 upload()
调用 finish()

插件就是一个普通程序。

例如：

build.py

build.sh

build

test.js

flash.exe

平台负责运行。

2、约定优于配置

平台提供统一运行目录：

workspace/

    input/

    output/

    temp/

    cache/

    logs/

    context.json

插件：

只读 input

只写 output

其它事情全部平台完成。

3、Runtime 与语言无关

Plugin 只声明：

runtime:

  type: python

entry:

  build.py

或者：

runtime:

  type: shell

entry:

  build.sh

Executor 自动决定如何执行。

以后支持：

python
shell
executable
docker
node
java
remote

无需修改插件。

二、Plugin Manifest

Plugin 由：

plugin/

    plugin.yaml

    source code

组成。

Manifest：

plugin:

  name: image_merge

  version: 1.0

runtime:

  type: python

  entry: merge.py

contract:

  inputs:

  outputs:

Plugin 唯一需要维护的就是：

contract。

三、Input Contract

输入不是参数。

输入统一叫：

Resource。

支持多种资源。

例如：

contract:

  inputs:

    image:

      type: file

      source: upload

      target:

        input/image.jpg

    config:

      type: file

      source: url

      target:

        config/config.json

    model:

      type: directory

      source: artifact

      target:

        models/

    threshold:

      type: number

      source: parameter

      default: 0.7

每个输入包含：

字段	说明
type	资源类型
source	来源
target	运行目录
default	默认值
required	是否必须
四、支持的 Resource Type

建议支持：

string

number

boolean

json

file

directory

list

后续：

git-repo

docker-image

artifact

五、支持的 Source

不要写死 upload。

统一：

parameter

普通文本。

UI：

输入框。

upload

用户上传。

UI：

上传按钮。

url

用户填写下载地址。

Executor：

自动下载。

artifact

来自上游。

Executor：

自动复制。

generated

平台生成。

例如：

workspace

pipeline_id

task_id

以后：

s3

minio

git

database

只需要新增 Source Provider。

六、Executor 输入准备

Executor 根据 Contract：

自动准备 Workspace。

例如：

workspace/

    input/

        image.jpg

    config/

        config.json

    models/


如果：

source=upload

Executor：

等待上传。

如果：

source=url

Executor：

下载。

如果：

artifact

Executor：

复制。

Plugin 根本不知道来源。

七、Context

Executor 自动生成：

context.json

例如：

{

    "pipeline":{

        "id":100

    },

    "task":{

        "name":"merge"

    },

    "workspace":"/workspace",

    "inputs":{

        "threshold":0.7

    }

}

同时注入：

PIPELINE_CONTEXT

PIPELINE_WORKSPACE

PIPELINE_TASK_ID

所有语言都可以读取。

八、Output Contract

插件不调用 upload。

而是声明：

outputs:

    merged:

        type: file

        path:

            output/{{inputs.image.basename}}_merge.jpg

    report:

        type: file

        path:

            output/report.json

Executor：

结束以后：

解析模板。

glob。

自动收集。

支持：

path:

    output/**/*.jpg

支持：

path:

    output/**

全部收集。

九、Artifact

Executor 收集以后：

自动生成：

Artifact。

例如：

Artifact

    merged.jpg

    report.json

上传：

MinIO

本地

NAS

S3

都可以。

Pipeline 不关心。

十、Artifact Mapping（建议新增）

不要让下一步：

直接依赖：

文件路径。

建议：

使用资源映射。

例如：

Step1：

outputs:

    firmware:

        path:

            output/app.bin

    report:

        path:

            output/report.json

Step2：

inputs:

    firmware:

        source:

            artifact

        from:

            compile.firmware

    report:

        source:

            artifact

        from:

            compile.report

Executor：

自动：

compile

↓

firmware

↓

workspace/input/app.bin

Plugin 不需要知道。

十一、Metadata

除了文件。

插件可能输出：

版本号

MD5

Image Name

URL

建议支持：

metadata。

例如：

outputs:

    metadata:

        type: json

        path:

            output/metadata.json

Executor：

读取。

Pipeline：

以后：

可以：

${compile.version}
十二、错误处理

统一：

退出码。

0

成功
非0

失败

Executor：

自动：

收集：

stdout

stderr

支持：

error.json

例如：

{

    "code":"BUILD1001",

    "message":"compile failed",

    "suggestion":"check gcc"

}

如果没有：

就解析：

stderr。

十三、Plugin 生命周期

Executor：

统一：

Resolve Plugin

↓

Resolve Inputs

↓

Download Resources

↓

Create Workspace

↓

Generate Context

↓

Execute

↓

Collect Logs

↓

Collect Outputs

↓

Generate Artifacts

↓

Upload Artifact

↓

Generate Metadata

↓

Finish Task

Plugin：

只负责：

Read Files

↓

Do Business

↓

Write Files
十四、UI 自动生成

Plugin Contract：

例如：

inputs:

    image:

        type:file

        source:upload

    config:

        type:file

        source:url

    threshold:

        type:number

        source:parameter

UI：

自动：

Image

[Upload]

Config

[URL]

Threshold

[ 0.7 ]

无需开发页面。

Marketplace：

天然支持。

十五、扩展能力

整个 Runtime 只有三个可扩展点：

Plugin Source

Git

HTTP

Upload

S3

Database
Runtime

Shell

Python

Docker

Node

Remote

K8S
Resource Source

Upload

URL

Artifact

Parameter

Generated

MinIO

Git

以后新增能力：

无需修改插件。

十六、为什么这样设计

相比传统流水线，这套方案有几个优势：

能力	GitLab CI	GitHub Actions	本方案
多语言执行	✅	✅	✅
无 SDK	⚠️（依赖脚本）	⚠️（依赖 Action）	✅
自动生成 UI	❌	❌	✅
输入资源抽象	❌	❌	✅
Artifact 映射	⚠️	⚠️	✅
Runtime 可扩展	✅	⚠️	✅
插件侵入性	中	中	极低
十七、建议增加两个能力（现代流水线常见）
1. Hook（生命周期）

允许插件声明：

hooks:
  pre:
    - prepare.sh
  post:
    - cleanup.sh

这样可以做环境准备、临时文件清理，而不会污染主业务脚本。

2. Capability（能力声明）

例如：

capabilities:
  network: true
  docker: false
  gpu: true
  cache: true

Executor 根据这些能力决定运行环境（是否联网、是否挂载 Docker Socket、是否调度到 GPU 节点等）。

最终架构
                  Pipeline
                      │
          解析 Pipeline + 参数
                      │
                      ▼
              Pipeline Executor
                      │
     ┌────────────────┼────────────────┐
     │                │                │
     ▼                ▼                ▼
Resource Resolver  Runtime Loader  Artifact Manager
     │                │                │
(upload/url/      (python/sh/      (collect/upload/
 artifact/...)     docker/...)      mapping)
     │                │                │
     └────────────────┼────────────────┘
                      ▼
                 Plugin Process
                      │
         读取 workspace + context
                      │
                执行业务逻辑
                      │
           写入 workspace/output
                      │
                      ▼
              Executor 自动收集结果

这套架构的核心思想只有一句话：

**把"插件"降级为一个普通程序，把"平台"升级为一个负责资源解析、运行时管理、产物管理和调度的 Runtime。插件只关心业务，平台负责一切运行时能力。**这样后续无论增加 Python、Shell、Docker、远程执行、Kubernetes Runner，还是对象存储、缓存复用，都不需要插件开发者修改已有代码。