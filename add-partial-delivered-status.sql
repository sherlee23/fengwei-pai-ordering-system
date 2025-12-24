-- 📋 添加 'partial delivered' 订单状态到数据库
-- 执行此SQL在 Supabase SQL Editor 中
-- 
-- ⚠️ 重要：请完整复制并执行以下所有SQL语句

-- ==================================================
-- 第一步：删除所有可能存在的旧约束
-- ==================================================

-- 删除 orders 表的状态约束
ALTER TABLE orders 
DROP CONSTRAINT IF EXISTS orders_status_check;

-- 删除其他可能的约束名称（有些系统可能用不同命名）
ALTER TABLE orders 
DROP CONSTRAINT IF EXISTS orders_status_check1;

ALTER TABLE orders 
DROP CONSTRAINT IF EXISTS check_status;

-- ==================================================
-- 第二步：添加新的状态约束
-- ==================================================

ALTER TABLE orders 
ADD CONSTRAINT orders_status_check 
CHECK (status IN (
    'pending',
    'partial delivered',
    'ready for pick up',
    'delivered',
    'completed',
    'cancelled'
));

-- ==================================================
-- 第三步：验证约束是否成功添加
-- ==================================================

-- 查看 orders 表的所有约束
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'orders'::regclass
AND contype = 'c';  -- c = check constraint

-- 预期结果应该显示：
-- constraint_name: orders_status_check
-- constraint_definition: CHECK ((status = ANY (ARRAY['pending'::text, 'partial delivered'::text, ...])))

-- ==================================================
-- 测试新状态（可选）
-- ==================================================

-- 测试更新一个订单为 partial delivered 状态
-- UPDATE orders 
-- SET status = 'partial delivered'
-- WHERE order_id = 'FW20251031003';

-- 如果上面的 UPDATE 执行成功，说明约束已正确添加！

-- ==================================================
-- 📝 状态说明
-- ==================================================
-- 
-- • pending: 订单刚创建，还没开始发货
-- • partial delivered: 已经发货一部分产品，还有产品待发货 ✨ 新增
-- • ready for pick up: 所有产品都已发货，等待客户取货
-- • delivered: 已发货
-- • completed: 订单完成
-- • cancelled: 订单取消
--
-- ==================================================
-- ✅ 执行完成后的检查清单
-- ==================================================
--
-- 1. 验证查询显示了 orders_status_check 约束
-- 2. 测试 UPDATE 语句能够成功执行
-- 3. 刷新前端页面（Ctrl+F5）
-- 4. 尝试在订单管理中更改订单状态为"部分已发"
