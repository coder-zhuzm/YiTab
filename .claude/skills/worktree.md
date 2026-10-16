---
name: worktree
description: 创建并切入隔离的 Git Worktree 进行并发会话开发，若未提供任务描述则主动询问用户，自动软链 node_modules 避免重复安装
---

# Worktree 隔离工作流

当用户输入 `/worktree` 或请求以 worktree 方式处理任务时，严格按照以下步骤执行：

## 1. 任务描述检查（无描述时必须询问）

- **若用户未提供任务描述**（即仅输入了 `/worktree`）：
  - **必须立即主动询问用户**：
    > "请问当前新任务的目标是什么？（例如：`修复设置页弹窗` 或 `优化书签去重`，我将为你创建隔离分支与工作树）"
  - 暂停并等待用户回答，获取任务目标后再继续下一阶段。
- **若用户已提供任务描述**（例如 `/worktree 修复设置中心小窗问题`）：
  - 直接提取 2-4 个英文单词生成规范的特性分支名（例如 `feat/options-popup-fix`）。

## 2. 建立与切入 Worktree

1. 使用 `EnterWorktree` 工具创建并切换进入工作树；若工具不可用，则通过 Bash 命令创建：
   ```bash
   git worktree add -b "<branch-name>" ".claude/worktrees/<branch-name>" origin/main
   ```
2. **秒级共享依赖（关键）**：
   - 检查主工程根目录是否存在 `node_modules`；
   - 若存在且新 worktree 目录下不存在 `node_modules`，立即创建软链接：
     ```bash
     ln -s /data/YiTab/node_modules <worktree-path>/node_modules
     ```
   - 确保直接可以使用 `npm test` 和 `npm run build`，零耗时安装依赖。

## 3. 隔离开发与提交流程

- 当前会话后续所有文件读写、构建和测试，严格限制在当前 worktree 目录下；
- 提交和推送必须限制在当前特性分支，严禁将未确认的并发工作直接推送到 `main`；
- 任务验证完成并由用户确认后，可通过 `ExitWorktree` 清理并切回。
