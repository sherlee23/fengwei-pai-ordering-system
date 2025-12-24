-- 🚀 快速诊断查询（简化版）
-- 不需要修改，直接复制粘贴到 Supabase SQL Editor 运行

-- ==========================================
-- 查询 1：检查最近的部分发货记录和回滚状态
-- ==========================================
SELECT 
    st.created_at::date as 日期,
    st.order_id as 订单号,
    p.name as 产品名称,
    st.transaction_type as 操作类型,
    st.quantity as 数量,
    st.reason as 原因,
    CASE 
        WHEN EXISTS (SELECT 1 FROM stock_transactions st2 WHERE st2.reversal_of::text = st.id::text) 
        THEN '✅ 已回滚' 
        ELSE '未回滚' 
    END as 回滚状态
FROM stock_transactions st
LEFT JOIN products p ON st.product_id = p.id
WHERE st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
ORDER BY st.created_at DESC
LIMIT 30;

-- ==========================================
-- 查询 2：检查产品名称是否匹配
-- ==========================================
-- 这是"已发货"不显示的最常见原因！
WITH order_product_names AS (
    SELECT DISTINCT
        jsonb_array_elements(order_items)->>'product' as product_name
    FROM orders
    WHERE order_items IS NOT NULL
)
SELECT 
    opn.product_name as 订单中的产品名,
    p.name as Products表中的名称,
    CASE 
        WHEN opn.product_name = p.name THEN '✅ 完全匹配'
        WHEN TRIM(opn.product_name) = TRIM(p.name) THEN '⚠️ 空格差异'
        ELSE '❌ 不匹配'
    END as 匹配状态
FROM order_product_names opn
LEFT JOIN products p ON TRIM(opn.product_name) = TRIM(p.name)
ORDER BY 匹配状态 DESC;

-- ==========================================
-- 查询 3：检查已完成订单的发货情况
-- ==========================================
WITH order_stats AS (
    SELECT 
        o.order_id,
        o.status,
        (SELECT SUM((item->>'quantity')::int)
         FROM jsonb_array_elements(o.order_items) as item
        ) as total_ordered,
        (SELECT COALESCE(SUM(ABS(st.quantity)), 0)
         FROM stock_transactions st
         WHERE st.order_id = o.order_id
         AND st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
         AND st.quantity < 0
        ) as total_delivered
    FROM orders o
    WHERE o.status IN ('delivered', 'completed')
)
SELECT 
    order_id as 订单号,
    status as 状态,
    total_ordered as 订购总数,
    total_delivered as 已发货总数,
    total_ordered - total_delivered as 未发货数,
    CASE 
        WHEN total_delivered = 0 THEN '❌ 完全未发货'
        WHEN total_delivered < total_ordered THEN '⚠️ 部分发货'
        WHEN total_delivered = total_ordered THEN '✅ 完全发货'
        ELSE '🚨 发货超量'
    END as 发货状态
FROM order_stats
ORDER BY order_id DESC
LIMIT 20;

-- ==========================================
-- 查询 4：查看所有回滚记录
-- ==========================================
SELECT 
    st1.created_at::date as 回滚日期,
    p.name as 产品名称,
    st1.quantity as 回滚数量,
    st2.transaction_type as 原操作类型,
    st2.quantity as 原数量,
    st2.order_id as 相关订单
FROM stock_transactions st1
LEFT JOIN stock_transactions st2 ON st1.reversal_of::text = st2.id::text
LEFT JOIN products p ON st1.product_id = p.id
WHERE st1.transaction_type = 'stock_adjustment_reversal'
ORDER BY st1.created_at DESC
LIMIT 20;

-- ==========================================
-- 🎯 重点检查：特定订单的详细发货情况
-- ==========================================
-- 🔴 把下面的 'FW20251111008' 替换成您要检查的订单号
WITH target_order AS (
    SELECT 
        o.id,
        o.order_id,
        o.status,
        jsonb_array_elements(o.order_items) as item
    FROM orders o
    WHERE o.order_id = 'FW20251111008'  -- 🔴 改成您的订单号！
)
SELECT 
    to2.order_id as 订单号,
    to2.item->>'product' as 产品名称,
    (to2.item->>'quantity')::int as 订购数量,
    (
        SELECT COALESCE(SUM(ABS(st.quantity)), 0)
        FROM stock_transactions st
        JOIN products p ON p.id = st.product_id
        WHERE st.order_id = to2.order_id
        AND st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
        AND st.quantity < 0
        AND p.name = to2.item->>'product'
    ) as 已发货数量,
    (to2.item->>'quantity')::int - (
        SELECT COALESCE(SUM(ABS(st.quantity)), 0)
        FROM stock_transactions st
        JOIN products p ON p.id = st.product_id
        WHERE st.order_id = to2.order_id
        AND st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
        AND st.quantity < 0
        AND p.name = to2.item->>'product'
    ) as 剩余未发货,
    EXISTS (
        SELECT 1
        FROM stock_transactions st
        JOIN products p ON p.id = st.product_id
        WHERE st.order_id = to2.order_id
        AND st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
        AND p.name = to2.item->>'product'
    ) as 有发货记录
FROM target_order to2;

-- ==========================================
-- 使用说明
-- ==========================================
/*
1. 查询1：查看最近的发货记录和回滚状态
   → 如果看到"已回滚"，说明回滚功能在数据库层面工作正常

2. 查询2：检查产品名称匹配（最重要！）
   → 如果看到"不匹配"，这就是"已发货"不显示的原因
   → 需要统一产品名称

3. 查询3：检查已完成订单的发货完整性
   → 找出状态是"已完成"但实际没发完的订单

4. 查询4：查看所有回滚操作历史
   → 确认回滚功能是否被使用过

5. 查询5：检查特定订单（需要修改订单号）
   → 详细分析某个订单为什么显示不正确

运行结果说明：
- ✅ = 正常
- ⚠️ = 需要注意
- ❌ = 有问题，需要修复
- 🚨 = 严重问题
*/
