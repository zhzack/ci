简化流水线平台设计文档
1. 项目背景

需要设计并实现一个轻量级流水线执行平台。

目标：

支持用户注册不同功能脚本（Plugin）
功能脚本来源可扩展：
Git 仓库
HTTP 下载链接
文件上传
后续支持更多来源
所有功能脚本遵循统一输入输出规范
流水线负责：
调度插件
管理输入输出
管理依赖关系
收集日志
管理产物

系统定位：

类似：

GitHub Actions
GitLab CI
Jenkins Pipeline

但是保持轻量，实现核心能力。

2. 总体架构

系统分为以下模块：

                         User

                          |
                          |

                  Pipeline Definition

                          |

                          v


                 +----------------+

                 | Pipeline Engine|

                 +----------------+

                          |

          +---------------+--------------+

          |                              |

          v                              v


 +----------------+              +----------------+

 | Plugin Manager |              | Task Executor  |

 +----------------+              +----------------+

          |                              |

          |                              |

          v                              v


 +----------------+              +----------------+

 | Plugin Storage |              | Runtime        |

 +----------------+              +----------------+

                                         |

                                         |

                                  Docker/Shell


3. 核心概念
3.1 Pipeline

流水线定义多个任务。

示例：

name: build_test


steps:

  - name: checkout

    plugin: git_clone@1.0


  - name: build

    plugin: gcc_build@1.0

    depends:

      - checkout


  - name: test

    plugin: unittest@1.0

    depends:

      - build

3.2 Plugin

插件代表一个功能。

例如：

gcc_build

docker_build

code_check

flash

test_runner


插件必须满足：

有描述文件
有执行入口
接收标准输入
输出标准结果
4. Plugin规范
4.1 插件目录结构
plugin/


├── plugin.yaml

├── run.sh

├── src/

└── README.md

4.2 plugin.yaml

示例：


name:

  gcc_build


version:

  1.0.0


description:

  gcc compile plugin



runtime:

  type:

    shell



entry:

  run.sh



inputs:


  source:

    type:

      directory

    required:

      true


  build_type:

    type:

      string



outputs:


  binary:

    type:

      file


5. Plugin执行协议

所有插件统一通过 JSON 通信。

输入

执行前生成：

input.json

示例：

{

 "task_id":

 "10001",


 "workspace":

 "/workspace",


 "params":

 {

   "source":

   "/workspace/src",


   "build_type":

   "release"

 }

}


插件读取：

input.json

输出

插件执行完成生成：

output.json

示例：

{

 "status":

 "success",


 "message":

 "build success",


 "artifacts":

 [

  {

   "name":

   "app.bin",


   "path":

   "build/app.bin"

  }

 ]

}

6. 插件注册系统

插件注册支持多种来源。

设计 Source Provider。

接口：

class PluginSource:


    def fetch(self):

        pass

6.1 Git Source

配置：


source:

 type:

   git


url:

 https://github.com/test/plugin.git


branch:

 master


行为：

git clone

checkout

install

6.2 HTTP Source

配置：


source:

 type:

   http


url:

 https://server/plugin.zip


行为：

download

unzip

6.3 Upload Source

用户上传 zip：

POST

/api/plugin/upload


保存：

storage/plugins/

7. Plugin数据库设计
plugin表

字段：

字段	说明
id	插件ID
name	名称
version	版本
source_type	来源类型
source_url	来源地址
status	状态
create_time	创建时间
plugin_version表

支持多个版本。

例如：

gcc_build

1.0

1.1

2.0

8. Pipeline Engine

负责：

8.1 加载Pipeline

读取：

pipeline.yaml

8.2 创建Task

例如：

Pipeline:

build_test


生成：

task1 checkout

task2 build

task3 test

8.3 DAG执行

支持：

depends

例如：

      checkout

          |

       build

       /   \

    test  scan


9. Executor设计

Executor负责执行插件。

流程：


prepare workspace


        |

download plugin


        |

generate input.json


        |

execute plugin


        |

collect output.json


        |

upload artifact


10. Runtime设计

第一版本支持：

Shell

直接执行：

./run.sh

Docker

插件声明：


runtime:

 type:

   docker


 image:

   gcc:12


执行：

docker run

-v workspace:/workspace

image

run.sh

11. Artifact管理

所有输出统一管理。

例如：

build/app.bin


转换：

{

"id":

"artifact001",


"name":

"app.bin",


"path":

"s3://xxx/app.bin"

}

12. Task状态

状态机：


PENDING

   |

READY

   |

RUNNING

   |

 +---------+

 |         |

SUCCESS  FAILED


13. 日志系统

插件stdout/stderr统一收集。

目录：

logs/


 pipeline_id/


    task_id.log



支持：

实时查看
下载
14. REST API设计
注册插件

POST

/api/plugin/register


请求：

{

"name":

"gcc_build",


"source":

{

"type":

"git",


"url":

"xxx"

}

}

查询插件

GET

/api/plugin/list

执行流水线

POST

/api/pipeline/run


请求：

{

"pipeline":

"build_test",


"params":

{

"branch":

"master"

}

}

15. 推荐技术栈
Backend

Python:

FastAPI
SQLAlchemy
Pydantic
Database

PostgreSQL

Queue

第一版：

ThreadPoolExecutor


后续：

Redis Queue

Celery

RabbitMQ

Storage

MinIO

Runtime

Docker

16. 项目目录结构
mini_pipeline/


├── server/

│

├── api/

│

├── pipeline/

│

├── scheduler/

│

├── executor/

│

├── plugin/

│

├── source/

│    ├── git.py

│    ├── http.py

│    └── upload.py

│

├── runtime/

│    └── docker.py

│

├── artifact/

│

├── database/

│

└── web/


17. 开发阶段要求
Phase 1 MVP

实现：

FastAPI服务
Plugin注册
Git/HTTP/Upload三种来源
Shell插件执行
input/output JSON协议
Pipeline YAML解析
DAG执行
日志保存
Phase 2

增加：

Docker执行环境
Artifact存储
Web管理页面
用户权限
Phase 3

增加：

分布式Runner
插件市场
Pipeline可视化
缓存
重试机制
18. Claude开发要求

请按照以下原则实现：

模块化设计
所有接口预留扩展能力
Plugin和Pipeline完全解耦
Source Provider插件化
Runtime插件化
所有配置使用YAML
优先实现MVP版本
提供完整README
提供Docker运行方式
提供测试用例
第一阶段交付目标

完成一个可运行Demo：

用户可以：

注册一个Git插件
创建Pipeline YAML
执行Pipeline
查看执行日志
获取插件输出文件

最终形成一个轻量级、可扩展流水线执行平台。