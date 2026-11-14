# Cloudflare 本地验证更新：Phase 4A.1

2026-11-14 更新，基线 `a448da9bd8f32367c7d82d89175936f4fec498d9`。**原有两项本地运行时阻断已修复，本轮指定的本地业务路径通过。** 17 项 Workers API、5 项原有后台浏览器测试和 10 项探针通过。完整方法、统计、源码变换校验及剩余上线限制见 [A.1 交付报告](phase-4a-1-status.md)。

- Workers 不构造 Fastify/find-my-way，改用复用同一路由/鉴权注册的窄 fetch 入口；Node 保留 Fastify。
- hash-wasm 4.13.0 的装载器构建期转换为静态 `.wasm` 导入，保持 Argon2id 参数、PHC 与算法。LF 规范化源码 SHA-256：`0682e7339e5fc2107cceae8d460f02533cfcb0cc3fe65f5f622fb56158b75f7e`。
- Argon2 wasm：7148 bytes，SHA-256 `7a25eff94eb7bc559acb7305d8352ed24470670a9ae653d79d86f92f8a395c3d`；BLAKE2b wasm：7449 bytes，SHA-256 `2aa7f33c4ece502997304672bc8defa348a7a30ef9a191e8648d317830e50afd`。生成器拒绝未审查的版本/源码或残留动态编译。
- PG 启动 search_path、无 Rust 驱动错误映射、ctx.waitUntil 清理和查询超时均经实际业务/故障验证。没有删除 SQL 保护或改写历史迁移。
- 本轮本地开发 bundle 快照：API JS 1,510,663 bytes，Web JS 5,603,068 bytes；API JS 中未出现 find-my-way 或动态 WebAssembly.compile。另有静态 WASM 模块，不能把 JS 尺寸当作最终完整上传体积或线上 CPU 验收。
- 未部署、未建云资源；真实 Hyperdrive、线上 CPU/内存、Secure Cookie 和边缘 IP 仍待授权验证。不能把本地结果当作线上验收。

以下保留 Phase 4A 的历史证据，其“阻断/8 失败”是当时结果，不是当前 A.1 结果。

---

# Cloudflare 本地兼容性验证：Phase 4A

日期 2026-11-13；基线 `1833fc8f4c3358ee65812302611f8091c793f5af`。结论：**阻断**。目标构建成功不等于完整运行通过。本轮没有登录 Cloudflare、创建远程资源或部署。

## 依赖审计与最小改动矩阵

| 组件            | 现有版本                    | 实验版本/运行条件                                                                                        | 验证与结果                                                                              |
| --------------- | --------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Next.js / React | 16.4.6 / 19.3.1             | OpenNext 1.20.17，Wrangler 4.161.0，nodejs_compat，compatibility_date=2026-11-13                         | peer 范围满足；真实 OpenNext build 成功                                                 |
| Fastify         | 5.12.8                      | 官方 cloudflare:node httpServerHandler 薄入口；原路由和权限保持                                          | workerd 实际拒绝 find-my-way 动态 Function，阻断                                        |
| Prisma / Client | 6.19.3                      | 同版 @prisma/adapter-pg 6.19.3，pg 8.23.1；独立 prisma-client 生成器，runtime=workerd、engineType=client | workerd 真实 PG 交互事务、SQL SELECT 与 AiControl 读取通过；复杂业务尚未在 Workers 验收 |
| Argon2id        | @node-rs/argon2 2.2.2       | hash-wasm 4.13.0 候选，保持 m=19456,t=2,p=1，32 字节输出                                                 | Node 双向 PHC 通过；workerd 动态 WASM compile 被拒绝，阻断                              |
| vinext          | 未引入                      | 官方候选 1.4.5，React ^19.3.1 / Vite ^8、Node >=22                                                       | 只审计，不安装替换，不声称运行通过                                                      |
| 工具环境        | Node 24.22.1 / pnpm 11.25.0 | workerd 1.20261110.1                                                                                     | 本机 Linux 本地运行，不代表线上配额/CPU 验收                                            |

适配范围限定 `v2/cloudflare/`、独立生成/本地脚本、OpenNext 配置和 SSR API 客户端可选 Service Binding。原 Node 开发、构建、原生 Argon2、Prisma 生成器均保留；没有替换 Next/Fastify 业务框架，没有删除 SQL 触发器。

## 官方依据

核查公开官方源码与实际 npm 包 peer，未把示例最新版本假定为本项目版本。资料包括：

- [OpenNext 配置](https://opennext.js.org/cloudflare/get-started) 与 [官方源码](https://github.com/opennextjs/opennextjs-cloudflare)。实际锁定 1.20.17，Next peer `>=15.5.29 <16 || >=16.4.5`。
- [Workers Node HTTP](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)、[兼容层](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)、[Service Binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)。HTTP 桥接存在不代表所有 Fastify 依赖兼容。
- [Prisma 无 Rust 引擎](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/no-rust-engine)、[Prisma Cloudflare](https://www.prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-cloudflare)、[v6 文档源码](https://github.com/prisma/docs/tree/2b15bdc77e6841f61d7d6a7e1adb04edad52a25d)。6.19.3 支持该生成模式，同版 adapter 实测。
- [hash-wasm 官方实现](https://github.com/Daninet/hash-wasm)、[vinext](https://github.com/cloudflare/vinext)。候选使用动态 `WebAssembly.compile`，不能用 Node WASM 成功推断 Workers。
- 官方页面受网络策略限制时读取其 GitHub 文档源；固定来源、套餐与费用细节见 [3.1 评估](cloudflare-feasibility.md)，本文件新增的运行证据不沿用其测试数字。

## 可复现命令（全部本地）

```sh
cd v2
pnpm install --frozen-lockfile
pnpm db:test:start
# .env.test.local 是随机凭据、回环隔离库，禁止提交。
node --env-file=.env.test.local scripts/database.mjs migrate
pnpm cf:client
pnpm cf:typecheck
pnpm cf:build
pnpm cf:dev
# 另一终端：此项当前预期失败，不能当作验收通过。
pnpm cf:verify
```

脚本仅支持 build/dev；不提供远程发布子命令。Wrangler 明确 `--local --ip 127.0.0.1`。Web 4320 经 API Service Binding 访问，数据库凭据只加载 API 的私有 `.dev.vars`，不加载 Web。无 Hyperdrive/D1/R2/account ID 远程绑定，workers_dev/preview_urls 均关闭；这不构成部署安全认证，任何后续发布仍需审核。

## 实际证据

OpenNext 对现有 App Router 目标构建成功，生成 `.open-next/worker.js` 与服务端产物。原始 Next build 另行执行并通过。Wrangler 多 Worker 本地启动成功，绑定 API 已连通；SSR 日志证实通过绑定收到 API 503，没有回退假 API。

`pnpm cf:verify` 共 **10 项：2 通过，8 失败**，保留失败退出码：

| 检查                                     | 实际结果                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Prisma PG 交互事务、AiControl 查询       | 通过；隔离 PostgreSQL，默认费用关闭                                                                                                  |
| Argon2id hash/verify                     | 失败：`WebAssembly.compile(): Wasm code generation disallowed by embedder`                                                           |
| Fastify health 经绑定                    | 503；原始异常 `EvalError: Code generation from strings disallowed for this context`，源 `find-my-way/lib/node.js:compilePrefixMatch` |
| 首页、广场、详情、聊天、管理员登录、后台 | 各 500，API 阻断导致 SSR 失败；不存在伪登录、权限放行或假目录回退                                                                    |
| 收藏页面                                 | 200，本地静态页面；不能代表认证/数据库页面通过                                                                                       |

本地未压缩开发 bundle 快照：Web JS 5,603,054 bytes；API JS 3,094,289 bytes；OpenNext 服务端 handler 3,604,480 bytes。它们是不同产物，不可直接相加称为最终上传体积，也未统计发布压缩或线上启动 CPU。未执行 deploy/dry-run 上传流程。构建/运行告警包括代理环境、Node 颜色变量及兼容依赖；不掩盖实际请求失败。

## 运行与安全范围

PG 的 0001—0006 迁移、FK/CHECK/触发器/锁/回滚/认证在 **Node** 实测；Workers 只通过上述基本数据库事务。Workers 中管理员登录、Cookie 往返、CSRF、撤销、发布恢复、复杂交互事务、NOWAIT/断连错误映射、长文本、移动端后台及并发尚未通过。未因原有 Node 回归通过而标记 Workers 通过。

WASM 候选在 Node 中验证：Node 生成→WASM 验证，反向验证；Unicode/空格/256 字符、错误密码、畸形参数、随机盐及同时最多两次内存哈希，共五例通过。没有降低密码参数。Workers CPU、内存、并发压力未验证；不能承诺免费 CPU 足够。依赖锁定降低漂移，但不等于完成第三方安全审计。

Hyperdrive 仍是方案，不创建资源。保留托管 PostgreSQL 和独立迁移/应用账户；后续必须关闭敏感查询缓存，真实验证认证、撤销、余额及发布读取不陈旧。D1 无法直接保留当前 PG 约束、PL/pgSQL 与锁，不迁移。

## 最小后续修复方案

1. 把 Fastify 路由声明与业务服务最小解耦，评估不依赖动态代码生成的 fetch 入口；保留 Zod、权限、Origin/CSRF、Cookie、审计、错误结构和全部安全回归。不 monkey-patch `Function`，不打开不安全 eval。
2. 寻找可静态导入已审查 `.wasm` 模块的 Argon2id 实现，或维护经过审核的静态编译适配；现候选不投入生产。必须重新做 PHC 双向、参数、workerd 内存/CPU/并发验证。禁止降低强度。
3. 两个阻断解除后，复跑所有业务集成，再申请任何云资源授权；并独立做真实 Hyperdrive 与最小权限角色测试。vinext 保持候选，不进行无依据全站重写。

本地研究没有 Cloudflare 费用。未来 Paid Workers 最低约 $5/月，另付 PostgreSQL、备份、日志、网络；具体额度/价格须上线前重核。3.1 固定官方资料记录 Free 每日 100,000 请求、10ms CPU、128MB 内存、未压缩 64MiB 程序限制；不能把此处 bundle 尺寸当作免费可用证明。中国大陆跨境可达性未测，普通套餐不保证稳定访问，不能承诺一定可用。
