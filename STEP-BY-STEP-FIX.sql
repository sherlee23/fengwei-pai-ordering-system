-- 🎯 分步执行指南：添加 partial delivered 状态
-- 
-- ⚠️ 重要：必须分成3个步骤执行，不能一次运行全部！
-- PostgreSQL 限制：新 ENUM 值必须先提交事务才能使用

-- ============================================================
-- 🟢 第一步：添加 ENUM 值（单独执行此步骤）
-- ============================================================

ALTER TYPE product_status ADD VALUE IF NOT EXISTS 'partial delivered';

-- ✅ 执行完此步骤后，点击"Run"提交
-- ✅ 等待看到"Success"提示
-- ✅ 然后再继续下一步

-- ============================================================
-- 🟡 第二步：验证并更新视图（执行此部分）
-- ============================================================

-- 2.1 验证 ENUM 值已添加
SELECT unnest(enum_range(null::product_status))::text as status;
-- 应该看到 6 个值，包括 'partial delivered'

-- 2.2 重建视图
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

-- ✅ 执行完此步骤后，再继续下一步

-- ============================================================
-- 🔵 第三步：测试订单更新（执行此部分）
-- ============================================================

-- 3.1 测试更新 Christine Fang 的订单
UPDATE orders 
SET status = 'partial delivered'
WHERE order_id = 'FW20251031003';

-- 3.2 查看结果
SELECT order_id, status, name, created_at
FROM orders
WHERE order_id = 'FW20251031003';

-- ✅ 应该显示 status = 'partial delivered'

-- ============================================================
-- ✅ 完成！
-- ============================================================

-- 现在可以：
-- 1. 刷新前端页面（Ctrl+F5）
-- 2. 查看 Christine Fang 订单 - 应该显示部分已发
-- 3. 产品应该显示发货进度标签
-- 4. 下拉菜单应该有"部分已发"选项
-- 5. 编辑流水记录会自动更新订单状态
