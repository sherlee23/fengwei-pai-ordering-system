# 📤 上传项目到 GitHub 的步骤

## 方法1: 使用 GitHub Desktop（最简单）

1. **下载 GitHub Desktop**
   - 访问：https://desktop.github.com
   - 下载并安装

2. **登录 GitHub 账号**
   - 如果没有账号，先到 https://github.com 注册

3. **创建新仓库**
   - 打开 GitHub Desktop
   - File → New Repository
   - 名称：`fengwei-pai-ordering-system`
   - 本地路径：选择当前文件夹的**父文件夹**
   - ✅ Initialize this repository with a README
   - 点击 "Create Repository"

4. **发布到 GitHub**
   - 点击 "Publish repository"
   - ⚠️ 取消勾选 "Keep this code private"（如果要公开分享）
   - 或保持勾选（私有仓库，需要邀请协作者）
   - 点击 "Publish Repository"

5. **复制仓库链接**
   - 完成后，点击 "View on GitHub"
   - 复制浏览器地址栏的URL
   - 例如：`https://github.com/你的用户名/fengwei-pai-ordering-system`

6. **分享给AI平台**
   - 把链接发给 Claude/ChatGPT/Gemini
   - 说：请帮我检查这个项目的代码：[链接]

---

## 方法2: 使用命令行 Git

在当前文件夹打开终端（右键 → Git Bash Here），运行：

```bash
# 1. 初始化 Git 仓库
git init

# 2. 添加所有文件
git add .

# 3. 创建第一次提交
git commit -m "Initial commit - 锋味派订购系统"

# 4. 到 GitHub 网站创建新仓库
# 访问：https://github.com/new
# 仓库名：fengwei-pai-ordering-system
# 不要勾选 "Initialize this repository with a README"
# 复制显示的命令（类似下面的）

# 5. 关联远程仓库并推送
git remote add origin https://github.com/你的用户名/fengwei-pai-ordering-system.git
git branch -M main
git push -u origin main
```

---

## 方法3: 直接在 GitHub 网站上传

1. 访问 https://github.com/new
2. 创建新仓库：`fengwei-pai-ordering-system`
3. 点击 "uploading an existing file"
4. 把整个项目文件夹拖进去
5. ⚠️ 注意：不要上传 `node_modules` 文件夹（太大）

---

## ⚠️ 重要提醒

### 上传前务必检查：

1. **删除敏感信息**
   ```powershell
   # 检查是否有密码、密钥
   notepad constants.ts
   ```
   
2. **创建 .gitignore**（已为你准备，见下方文件）

3. **排除大文件**
   - node_modules（已在 .gitignore）
   - .env 环境变量文件
   - 数据库备份文件

### 如果项目包含敏感信息：

**选择私有仓库（Private Repository）**，然后：
- 邀请协作者：Settings → Collaborators → Add people
- 或分享临时访问：Settings → Deploy keys

---

## 📋 分享给AI时说什么

把下面这段话和GitHub链接一起发给AI：

```
你好！我遇到一个React + Supabase项目的问题，请帮我检查：

项目仓库：https://github.com/你的用户名/fengwei-pai-ordering-system

问题描述：
当订单状态更改为"部分已发"(partial delivered)后，订单中的产品没有显示发货进度指示器（黄色"部分发货"徽章和蓝色已发数量框）。

核心文件：
- components/AdminView.tsx（11,553行）- 主要逻辑所在
- constants.ts - Supabase配置
- types.ts - 类型定义

已经确认的：
✅ 数据库 product_status ENUM 已包含 'partial delivered'
✅ 触发器已修复
✅ UI下拉菜单已添加选项
✅ 用户可以选择状态
❌ 产品列表不显示进度指示器（问题所在）

请帮我：
1. 检查 AdminView.tsx 中的显示逻辑
2. 分析为什么 deliveredQuantity 计算可能返回0
3. 检查 stockTransactions 数据流
4. 提供修复建议

详细问题报告见：ISSUE-REPORT-部分发货显示问题.md
```

---

## ✅ 完成后你会得到

- 一个GitHub仓库链接
- 可以分享给任何人/AI
- 代码有版本控制
- 可以在线查看和编辑

---

**问题？** 如果遇到任何问题，告诉我具体在哪一步卡住了！
