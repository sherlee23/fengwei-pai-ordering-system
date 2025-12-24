# 🧪 库存回滚功能测试指南

## 📋 测试前准备

1. **刷新页面**：先刷新浏览器页面以加载最新代码
2. **进入库存流水页面**：点击"库存流水"按钮
3. **确保有测试数据**：如果没有数据，可以先创建一条手动调整记录

---

## ✅ 测试场景 1：手动调整回滚

### 步骤：
1. 在库存流水页面，创建一条手动调整记录：
   - 选择任意产品
   - 调整数量：+5 或 -5
   - 原因：测试回滚功能
   - 点击确认

2. 在列表中找到刚才创建的记录

3. 点击"回滚"按钮

4. **预期结果：**
   - ✅ 显示确认对话框，说明回滚详情
   - ✅ 确认后，库存恢复到调整前的数量
   - ✅ 流水中出现一条"调整回滚"记录
   - ✅ 原记录显示"已回滚"标记，回滚按钮消失

---

## ✅ 测试场景 2：订单出库回滚

### 前提条件：
- 需要有一个已下单并扣减了库存的订单
- 订单类型为现货（非预购）

### 步骤：
1. 找到一个订单出库记录（transaction_type = 'order'）

2. 点击"回滚"按钮

3. **预期结果：**
   - ✅ 显示确认对话框
   - ✅ 回滚后库存增加（退还给仓库）
   - ✅ 订单状态不会改变（需要手动处理订单）
   - ✅ 原记录显示"已回滚"

---

## ✅ 测试场景 3：部分发货回滚

### 前提条件：
- 需要有一个订单进行过部分发货

### 步骤：
1. 找到一个部分发货记录（transaction_type = 'partial_delivery'）

2. 点击"回滚"按钮

3. **预期结果：**
   - ✅ 显示确认对话框
   - ✅ 回滚后库存增加
   - ✅ 原记录显示"已回滚"

---

## ✅ 测试场景 4：防止重复回滚

### 步骤：
1. 找到一条已经回滚过的记录（显示"已回滚"标记）

2. **预期结果：**
   - ✅ 该记录没有"回滚"按钮
   - ✅ 显示"已回滚"文字
   - ✅ 记录显示为灰色（半透明）

---

## ✅ 测试场景 5：不可回滚的类型

### 步骤：
1. 找到一条回滚操作记录（transaction_type = 'stock_adjustment_reversal'）

2. **预期结果：**
   - ✅ 该记录没有"回滚"按钮
   - ✅ 显示"回滚操作"标签（紫色）
   - ✅ 不应该能回滚回滚操作本身

---

## 🔍 验证回滚记录的字段

### 检查数据库：

在 Supabase SQL Editor 执行：

```sql
-- 查看最近的回滚记录
SELECT 
    id,
    product_id,
    transaction_type,
    quantity,
    previous_stock,
    new_stock,
    reason,
    reversal_of,  -- 🔑 应该指向被回滚的记录ID
    created_at
FROM stock_transactions
WHERE transaction_type = 'stock_adjustment_reversal'
ORDER BY created_at DESC
LIMIT 10;
```

### 预期结果：
- ✅ `transaction_type` = 'stock_adjustment_reversal'
- ✅ `reversal_of` 字段有值（指向原记录的 ID）
- ✅ `quantity` 符号与原记录相反（原来是 -5，现在是 +5）
- ✅ `reason` 包含"回滚"字样
- ✅ `notes` 包含原交易的详细信息

---

## 🐛 常见问题排查

### 问题 1：回滚按钮没有显示

**可能原因：**
1. 该操作类型不支持回滚
2. 该记录已经被回滚过了
3. 页面缓存，需要刷新

**解决方法：**
```
1. 刷新页面（Ctrl+F5 或 Cmd+Shift+R）
2. 检查记录的 transaction_type
3. 查看是否有"已回滚"标记
```

### 问题 2：回滚时提示"此类型的库存操作无法回滚"

**可能原因：**
- 这是一个回滚操作本身（不能回滚回滚）
- 代码没有正确更新

**解决方法：**
```
1. 确认已刷新页面
2. 检查浏览器控制台是否有错误
3. 查看 ROLLBACK-FIX-FINAL.md 确认支持的类型
```

### 问题 3：回滚后库存数量不对

**可能原因：**
- 原始记录的数量符号有误
- 并发操作导致库存冲突

**解决方法：**
```sql
-- 查看该产品的所有流水记录
SELECT 
    created_at,
    transaction_type,
    quantity,
    previous_stock,
    new_stock,
    reason
FROM stock_transactions
WHERE product_id = '你的产品ID'
ORDER BY created_at DESC
LIMIT 20;
```

---

## 📊 测试检查清单

使用此清单确保所有功能正常：

- [ ] ✅ 手动调整可以回滚
- [ ] ✅ 订单出库可以回滚
- [ ] ✅ 部分发货可以回滚
- [ ] ✅ 手动扣库存可以回滚
- [ ] ✅ 手动入库可以回滚
- [ ] ✅ 手动出库可以回滚
- [ ] ✅ 回滚操作本身不能再次回滚
- [ ] ✅ 已回滚的记录不能重复回滚
- [ ] ✅ 回滚后库存正确更新
- [ ] ✅ 回滚后创建了回滚流水记录
- [ ] ✅ 回滚流水的 reversal_of 字段正确指向原记录
- [ ] ✅ UI 正确显示"已回滚"标记
- [ ] ✅ 回滚按钮在已回滚记录上消失

---

## 🎯 快速测试命令

### 创建测试数据（在浏览器控制台执行）

```javascript
// 注意：仅在开发测试时使用！
// 这会创建一条库存调整记录用于测试回滚

// 1. 先获取一个产品ID
// 2. 在"库存流水"页面的"手动调整"功能中创建测试记录
// 3. 然后测试回滚功能
```

### 查看回滚记录（SQL）

```sql
-- 查看最近的所有回滚操作
SELECT 
    t1.id as rollback_id,
    t1.created_at as rollback_time,
    t1.quantity as rollback_quantity,
    t1.reversal_of as original_id,
    t2.transaction_type as original_type,
    t2.quantity as original_quantity,
    t2.reason as original_reason,
    p.name as product_name
FROM stock_transactions t1
LEFT JOIN stock_transactions t2 ON t1.reversal_of = t2.id
LEFT JOIN products p ON t1.product_id = p.id
WHERE t1.transaction_type = 'stock_adjustment_reversal'
ORDER BY t1.created_at DESC
LIMIT 10;
```

---

## 📞 需要帮助？

如果测试中发现任何问题，请提供以下信息：

1. **问题描述**：具体什么功能不工作
2. **操作步骤**：你做了什么操作
3. **预期结果**：应该发生什么
4. **实际结果**：实际发生了什么
5. **截图**：如果可能，提供错误信息截图
6. **控制台日志**：浏览器控制台（F12）的错误信息

---

**测试文档版本：** v1.0  
**最后更新：** 2024年  
**相关文档：** ROLLBACK-FIX-FINAL.md, ROLLBACK-GUIDE.md
