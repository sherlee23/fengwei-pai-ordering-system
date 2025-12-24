-- 🔍 库存回滚功能诊断SQL（修正版）
-- ⚠️ 重要：order_items 是 orders 表中的 JSONB 字段，不是独立表！

-- ==========================================
-- 1. 检查所有部分发货记录
-- ==========================================
SELECT 
    st.id,
    st.created_at,
    st.transaction_type,
    st.order_id,
    p.name as product_name,
    st.quantity,
    st.previous_stock,
    st.new_stock,
    st.reason,
    st.reversal_of,
    CASE 
        WHEN st.reversal_of IS NOT NULL THEN '这是回滚记录'
        WHEN EXISTS (
            SELECT 1 FROM stock_transactions st2 
            WHERE st2.reversal_of = st.id
        ) THEN '已被回滚'
        ELSE '未回滚'
    END as rollback_status
FROM stock_transactions st
LEFT JOIN products p ON st.product_id = p.id
WHERE st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
ORDER BY st.created_at DESC
LIMIT 50;

-- ==========================================
-- 2. 检查回滚记录
-- ==========================================
SELECT 
    st1.id as rollback_id,
    st1.created_at as rollback_time,
    st1.transaction_type as rollback_type,
    st1.quantity as rollback_quantity,
    st1.reversal_of as original_id,
    st2.transaction_type as original_type,
    st2.quantity as original_quantity,
    st2.created_at as original_time,
    p.name as product_name
FROM stock_transactions st1
LEFT JOIN stock_transactions st2 ON st1.reversal_of = st2.id
LEFT JOIN products p ON st1.product_id = p.id
WHERE st1.transaction_type = 'stock_adjustment_reversal'
ORDER BY st1.created_at DESC
LIMIT 20;

-- ==========================================
-- 3. 检查特定订单的发货情况（修正版）
-- ==========================================
-- 替换 'YOUR_ORDER_ID' 为实际的订单号，例如 'FW20251111003'
WITH order_products AS (
    SELECT 
        o.id,
        o.order_id,
        o.status,
        jsonb_array_elements(o.order_items) as item
    FROM orders o
    WHERE o.order_id = 'YOUR_ORDER_ID'  -- 🔴 替换这里！
)
SELECT 
    op.order_id,
    op.status as order_status,
    op.item->>'product' as product_name,
    (op.item->>'quantity')::int as ordered_quantity,
    COALESCE(
        (SELECT SUM(ABS(st.quantity))
         FROM stock_transactions st
         JOIN products p ON p.id = st.product_id
         WHERE st.order_id = op.order_id
         AND st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
         AND st.quantity < 0
         AND p.name = op.item->>'product'
        ), 0
    ) as delivered_quantity,
    (op.item->>'quantity')::int - COALESCE(
        (SELECT SUM(ABS(st.quantity))
         FROM stock_transactions st
         JOIN products p ON p.id = st.product_id
         WHERE st.order_id = op.order_id
         AND st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
         AND st.quantity < 0
         AND p.name = op.item->>'product'
        ), 0
    ) as remaining_quantity
FROM order_products op;

-- ==========================================
-- 4. 检查所有"已完成"订单的发货状态（修正版）
-- ==========================================
WITH order_products AS (
    SELECT 
        o.id,
        o.order_id,
        o.status,
        o.created_at,
        jsonb_array_elements(o.order_items) as item
    FROM orders o
    WHERE o.status IN ('delivered', 'completed')
),
product_delivery AS (
    SELECT 
        op.order_id,
        op.item->>'product' as product_name,
        EXISTS (
            SELECT 1 
            FROM stock_transactions st
            JOIN products p ON p.id = st.product_id
            WHERE st.order_id = op.order_id
            AND st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
            AND st.quantity < 0
            AND p.name = op.item->>'product'
        ) as has_delivery_record
    FROM order_products op
)
SELECT 
    order_id,
    COUNT(*) as total_products,
    SUM(CASE WHEN has_delivery_record THEN 1 ELSE 0 END) as products_with_delivery,
    COUNT(*) - SUM(CASE WHEN has_delivery_record THEN 1 ELSE 0 END) as products_without_delivery
FROM product_delivery
GROUP BY order_id
HAVING COUNT(*) != SUM(CASE WHEN has_delivery_record THEN 1 ELSE 0 END)
ORDER BY order_id DESC;

-- ==========================================
-- 5. 检查产品名称匹配问题（修正版）
-- ==========================================
-- 检查 orders.order_items JSONB 中的产品名和 products 表是否匹配
WITH order_product_names AS (
    SELECT DISTINCT
        jsonb_array_elements(order_items)->>'product' as product_name
    FROM orders
    WHERE order_items IS NOT NULL
)
SELECT 
    opn.product_name as order_item_product,
    p.name as products_table_name,
    CASE 
        WHEN opn.product_name = p.name THEN '✅ 完全匹配'
        WHEN TRIM(opn.product_name) = TRIM(p.name) THEN '⚠️ 有空格差异'
        ELSE '❌ 不匹配'
    END as match_status
FROM order_product_names opn
LEFT JOIN products p ON TRIM(opn.product_name) = TRIM(p.name)
ORDER BY match_status DESC, opn.product_name;

-- ==========================================
-- 6. 查找可能被遗漏的发货记录
-- ==========================================
SELECT 
    st.id,
    st.created_at,
    st.transaction_type,
    st.order_id,
    p.name as product_name,
    st.quantity,
    st.reason,
    CASE 
        WHEN st.order_id IS NULL THEN '❌ 缺少订单号'
        WHEN NOT EXISTS (SELECT 1 FROM orders WHERE order_id = st.order_id) THEN '❌ 订单不存在'
        WHEN NOT EXISTS (
            SELECT 1 FROM orders o
            WHERE o.order_id = st.order_id
            AND o.order_items::text LIKE '%' || p.name || '%'
        ) THEN '❌ 订单中没有此产品'
        ELSE '✅ 关联正常'
    END as association_status
FROM stock_transactions st
LEFT JOIN products p ON st.product_id = p.id
WHERE st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
    AND st.quantity < 0
ORDER BY st.created_at DESC
LIMIT 50;

-- ==========================================
-- 7. 统计每个订单的发货完整度（修正版）
-- ==========================================
WITH order_stats AS (
    SELECT 
        o.id,
        o.order_id,
        o.status,
        o.created_at,
        jsonb_array_length(o.order_items) as total_items,
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
    WHERE o.status IN ('delivered', 'completed', 'ready for pick up')
)
SELECT 
    order_id,
    status,
    total_items,
    total_ordered,
    total_delivered,
    total_ordered - total_delivered as total_remaining,
    CASE 
        WHEN total_delivered = 0 THEN '❌ 完全未发货'
        WHEN total_delivered < total_ordered THEN '⚠️ 部分发货'
        WHEN total_delivered = total_ordered THEN '✅ 完全发货'
        WHEN total_delivered > total_ordered THEN '🚨 发货超量！'
    END as delivery_status
FROM order_stats
ORDER BY created_at DESC
LIMIT 20;

-- ==========================================
-- 2. 检查回滚记录
-- ==========================================
SELECT 
    st1.id as rollback_id,
    st1.created_at as rollback_time,
    st1.transaction_type as rollback_type,
    st1.quantity as rollback_quantity,
    st1.reversal_of as original_id,
    st2.transaction_type as original_type,
    st2.quantity as original_quantity,
    st2.created_at as original_time,
    p.name as product_name
FROM stock_transactions st1
LEFT JOIN stock_transactions st2 ON st1.reversal_of = st2.id
LEFT JOIN products p ON st1.product_id = p.id
WHERE st1.transaction_type = 'stock_adjustment_reversal'
ORDER BY st1.created_at DESC
LIMIT 20;

-- ==========================================
-- 3. 检查特定订单的发货情况
-- ==========================================
-- 替换 'YOUR_ORDER_ID' 为实际的订单号，例如 'FW20251111003'
SELECT 
    o.order_id,
    o.status as order_status,
    oi.product,
    oi.quantity as ordered_quantity,
    COALESCE(SUM(ABS(st.quantity)), 0) as delivered_quantity,
    oi.quantity - COALESCE(SUM(ABS(st.quantity)), 0) as remaining_quantity
FROM orders o
JOIN order_items oi ON o.id = oi.order_id
LEFT JOIN stock_transactions st ON 
    st.order_id = o.order_id 
    AND st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
    AND st.quantity < 0
    AND EXISTS (
        SELECT 1 FROM products p 
        WHERE p.id = st.product_id 
        AND p.name = oi.product
    )
WHERE o.order_id = 'YOUR_ORDER_ID'  -- 🔴 替换这里！
GROUP BY o.order_id, o.status, oi.product, oi.quantity
ORDER BY oi.product;

-- ==========================================
-- 4. 检查所有"已完成"订单的发货状态
-- ==========================================
SELECT 
    o.order_id,
    o.status,
    o.created_at,
    COUNT(DISTINCT oi.id) as total_products,
    COUNT(DISTINCT CASE 
        WHEN EXISTS (
            SELECT 1 FROM stock_transactions st
            WHERE st.order_id = o.order_id
            AND st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
            AND st.quantity < 0
            AND EXISTS (
                SELECT 1 FROM products p 
                WHERE p.id = st.product_id 
                AND p.name = oi.product
            )
        ) THEN oi.id
    END) as products_with_delivery_records
FROM orders o
JOIN order_items oi ON o.id = oi.order_id
WHERE o.status = 'delivered'  -- 或 'completed'
GROUP BY o.order_id, o.status, o.created_at
HAVING COUNT(DISTINCT oi.id) != COUNT(DISTINCT CASE 
    WHEN EXISTS (
        SELECT 1 FROM stock_transactions st
        WHERE st.order_id = o.order_id
        AND st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
        AND st.quantity < 0
        AND EXISTS (
            SELECT 1 FROM products p 
            WHERE p.id = st.product_id 
            AND p.name = oi.product
        )
    ) THEN oi.id
END)
ORDER BY o.created_at DESC;

-- ==========================================
-- 5. 检查产品名称匹配问题
-- ==========================================
-- 这个查询检查 order_items 中的产品名和 products 表中的名称是否匹配
SELECT DISTINCT
    oi.product as order_item_product,
    p.name as products_table_name,
    CASE 
        WHEN oi.product = p.name THEN '✅ 完全匹配'
        WHEN TRIM(oi.product) = TRIM(p.name) THEN '⚠️ 有空格差异'
        ELSE '❌ 不匹配'
    END as match_status
FROM order_items oi
LEFT JOIN products p ON TRIM(oi.product) = TRIM(p.name)
WHERE oi.product IS NOT NULL
ORDER BY match_status DESC, oi.product;

-- ==========================================
-- 6. 查找可能被遗漏的发货记录
-- ==========================================
-- 检查哪些部分发货记录没有正确关联到订单
SELECT 
    st.id,
    st.created_at,
    st.transaction_type,
    st.order_id,
    p.name as product_name,
    st.quantity,
    st.reason,
    CASE 
        WHEN st.order_id IS NULL THEN '❌ 缺少订单号'
        WHEN NOT EXISTS (SELECT 1 FROM orders WHERE order_id = st.order_id) THEN '❌ 订单不存在'
        WHEN NOT EXISTS (
            SELECT 1 FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.order_id = st.order_id
            AND oi.product = p.name
        ) THEN '❌ 订单中没有此产品'
        ELSE '✅ 关联正常'
    END as association_status
FROM stock_transactions st
LEFT JOIN products p ON st.product_id = p.id
WHERE st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
    AND st.quantity < 0
ORDER BY st.created_at DESC
LIMIT 50;

-- ==========================================
-- 7. 统计每个订单的发货完整度
-- ==========================================
SELECT 
    o.order_id,
    o.status,
    COUNT(DISTINCT oi.id) as total_items,
    SUM(oi.quantity) as total_ordered,
    COALESCE(SUM(
        (SELECT COALESCE(SUM(ABS(st.quantity)), 0)
         FROM stock_transactions st
         JOIN products p ON p.id = st.product_id
         WHERE st.order_id = o.order_id
         AND st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
         AND st.quantity < 0
         AND p.name = oi.product)
    ), 0) as total_delivered,
    SUM(oi.quantity) - COALESCE(SUM(
        (SELECT COALESCE(SUM(ABS(st.quantity)), 0)
         FROM stock_transactions st
         JOIN products p ON p.id = st.product_id
         WHERE st.order_id = o.order_id
         AND st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
         AND st.quantity < 0
         AND p.name = oi.product)
    ), 0) as total_remaining
FROM orders o
JOIN order_items oi ON o.id = oi.order_id
WHERE o.status IN ('delivered', 'completed', 'ready for pick up')
GROUP BY o.order_id, o.status
ORDER BY o.created_at DESC
LIMIT 20;

-- ==========================================
-- 使用说明
-- ==========================================
/*
1. 查询 1：查看所有部分发货记录及回滚状态
2. 查询 2：查看所有回滚记录
3. 查询 3：查看特定订单的发货情况（需替换订单号）
4. 查询 4：找出"已完成"但发货记录不完整的订单
5. 查询 5：检查产品名称是否匹配
6. 查询 6：找出关联有问题的发货记录
7. 查询 7：统计每个订单的发货完整度

运行这些查询可以帮助诊断：
- 为什么某些产品没有显示"已发货"
- 为什么回滚功能不工作
- 产品名称是否匹配导致无法关联
*/
