# Staging readonly script validation：两次失败及最小修复

## 实际失败记录

| 提交 | Actions | 失败步骤 | 实际错误 |
|---|---|---|---|
| de1ab472073b77cf8e86427f417b407020768947 | https://github.com/caoborui99-max/personaverse/actions/runs/42610212193 | Require real readonly boundary and compare fixture metadata | KernelBoundaryTests.setUpClass，test_readonly.py:180：`AssertionError: Required kernel read-only/network boundary is unavailable; cannot claim normal check verified` |
| 37ef2b65216d0a4fb7c2ca3f18ef879e15959906 | https://github.com/caoborui99-max/personaverse/actions/runs/42611119552 | 同上 | 同一AssertionError；新增诊断明确输出 `WRITABLE_MOUNTS [('/proc/sys/fs/binfmt_misc', 'rw,relatime')]` 与 `NET_SEPARATE True` |

两次均为17项普通测试完成后，隔离测试组在setup阶段停止。正常/异常退出的7种文件元数据场景尚未执行，不能把它们算作通过。PR事件对应运行42610446095、42611126864也失败，不能仅挑选push事件报告。

## 原因分类

- 环境特性：Ubuntu GitHub runner存在binfmt_misc自动挂载；仅递归ro-bind根目录后，仍出现一个rw子挂载。
- 脚本问题：只读启动器没有将这个自动挂载补齐为ro，无法达到它自己承诺的完整只读边界。
- 测试行为正确：所有挂载必须ro的保护及CI的“不允许跳过”策略阻止了不安全通过。网络隔离已成功；不是缺少网络隔离，也不是管理员/数据库/8000服务故障。

## 最小修复

只在bubblewrap子命名空间添加 `--remount-ro /proc/sys/fs/binfmt_misc`：同时更新正式启动器和两处内核测试命令；CI增加同参数的强制元数据校验，预期必须为 `WRITABLE_MOUNTS []`、`NET_SEPARATE True`。

不白名单忽略rw挂载、不更改readonly_boundary的判断、不chmod、不关闭CI强制策略、不改宿主挂载、服务或数据库。该挂载/内核能力不可用时仍然停止。固定部署目标仍为 `8d37d06065d6e0c8b05c2ee7bf7eec4fc7ce0844`。

同步README、测试记录和源码校验和。本修复分支移除过期ZIP，原PR #2不变；CI从白名单源码生成新ZIP及校验和，作为artifact提供。

## 验证范围

本地仍被平台禁止创建嵌套网络命名空间：17项通过、内核组明确跳过。不是完整隔离成功。修复后的GitHub Actions必须实际建立隔离，执行正常、dirty、bad_checksum、wal_sidecar、wal_header、corrupt、git_helper共7种临时夹具场景；逐项比较文件/目录清单、SHA256和全部纳秒元数据。

最终验证以本修复提交的Actions状态和PR报告为准；未访问任何Ubuntu线上服务器、8000/9000服务、生产数据库、真实凭据或模型接口。即使CI通过，也不代表生产/预发布服务已获部署授权。
