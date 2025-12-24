-- 🎯 真正的终极修复：修改 product_status ENUM 类型
-- 
-- 问题根源：product_status 是 PostgreSQL ENUM 类型，不是表！
-- 必须使用 ALTER TYPE 来添加新的枚举值

-- ==================================================
-- 步骤1：查看当前的 ENUM 值
-- ==================================================

-- 查看 product_status ENUM 的所有值
SELECT unnest(enum_range(null::product_status))::text as status;

-- 当前应该显示 5 个值：
-- pending
-- ready_for_pickup  
-- delivered
-- completed
-- canceled

-- ==================================================
-- 步骤2：添加 'partial delivered' 到 ENUM 类型
-- ==================================================

-- ⚠️ 重要：必须单独执行此步骤，然后再执行后续步骤！
-- ⚠️ PostgreSQL 要求新 ENUM 值必须先提交才能使用

-- 添加新的枚举值
ALTER TYPE product_status ADD VALUE IF NOT EXISTS 'partial delivered';

-- 说明：
-- • IF NOT EXISTS 确保如果值已存在不会报错
-- • 新值会被添加到 ENUM 的末尾
-- • 必须提交后才能在后续步骤中使用

-- ==================================================
-- ⚠️⚠️⚠️ 停止！请先执行到这里！ ⚠️⚠️⚠️
-- ==================================================
-- 
-- 执行完上面的 ALTER TYPE 后：
-- 1. 点击"Run"提交这个命令
-- 2. 等待执行成功
-- 3. 然后再继续执行下面的步骤
--
-- PostgreSQL 限制：新 ENUM 值必须在单独的事务中提交
-- 不能在同一个SQL批次中添加并使用新值
--
-- ==================================================

-- ==================================================
-- 步骤3：验证添加成功
-- ==================================================

-- 再次查看所有 ENUM 值
SELECT unnest(enum_range(null::product_status))::text as status;

-- 现在应该看到 6 个值，包括 'partial delivered'

-- ==================================================
-- 步骤4：更新视图显示名称
-- ==================================================

-- 重新创建 product_status_dropdown 视图，添加 partial delivered 的显示
DROP VIEW IF EXISTS product_status_dropdown;

CREATE VIEW product_status_dropdown AS
SELECT 
    status,
    CASE 
        WHEN status = 'pending'::text THEN 'Pending'::text
        WHEN status = 'ready_for_pickup'::text THEN 'Ready for Pickup'::text
        WHEN status = 'delivered'::text THEN 'Delivered'::text
        WHEN status = 'completed'::text THEN 'Completed'::text
        WHEN status = 'partial delivered'::text THEN 'Partial Delivered'::text
        ELSE null::text
    END AS display_name,
    CASE 
        WHEN status = 'pending'::text THEN 1
        WHEN status = 'partial delivered'::text THEN 2
        WHEN status = 'ready_for_pickup'::text THEN 3
        WHEN status = 'delivered'::text THEN 4
        WHEN status = 'completed'::text THEN 5
        ELSE null::integer
    END AS sort_order
FROM (
    SELECT unnest(enum_range(null::product_status))::text AS status
) enum_values
ORDER BY sort_order;

-- ==================================================
-- 步骤5：测试订单状态更新
-- ==================================================

-- 测试更新 Christine Fang 的订单
UPDATE orders 
SET status = 'partial delivered'
WHERE order_id = 'FW20251031003';

-- 如果执行成功（没有报错），说明修复完成！

-- 查看结果
SELECT order_id, status, name, created_at
FROM orders
WHERE order_id = 'FW20251031003';

-- 应该显示 status = 'partial delivered'

-- ==================================================
-- ✅ 完成！现在可以：
-- ==================================================
-- 
-- 1. 刷新前端页面（Ctrl+F5）
-- 2. 手动更改订单状态为"部分已发" - 应该成功
-- 3. 编辑流水记录 - 订单状态会自动更新
-- 4. 产品会显示发货进度标签
-- 5. 合并打印会包含部分已发订单

-- ==================================================
-- 📝 技术说明
-- ==================================================
--
-- PostgreSQL ENUM 类型的限制：
-- • 只能在末尾添加新值（不能插入中间）
-- • 不能删除已存在的值
-- • 不能修改已存在值的名称
-- • 如需完全重建，需要先删除所有使用该类型的列，然后重建 ENUM
--
-- 我们的解决方案：
-- • 在末尾添加 'partial delivered'
-- • 通过视图的 CASE 语句控制显示顺序
-- • 功能完全正常，只是内部顺序不同
