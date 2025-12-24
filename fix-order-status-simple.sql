-- =====================================
-- 修复订单部分发货状态问题 (简化版)
-- =====================================

-- 步骤 1: 查找有部分发货记录的订单
SELECT 
    o.id,
    o.order_id,
    o.name,
    o.status,
    COUNT(st.id) as delivery_record_count
FROM orders o
LEFT JOIN stock_transactions st ON st.order_id = o.order_id 
    AND st.transaction_type IN ('partial_delivery', 'manual_order', 'stock_out')
WHERE st.id IS NOT NULL
GROUP BY o.id, o.order_id, o.name, o.status
ORDER BY o.created_at DESC;

-- 步骤 2: 查找状态异常的订单（有发货记录但状态不是pending）
SELECT 
    o.id,
    o.order_id,
    o.name,
    o.status as current_status,
    COUNT(st.id) as delivery_count
FROM orders o
INNER JOIN stock_transactions st ON st.order_id = o.order_id 
    AND st.transaction_type IN ('partial_delivery', 'manual_order', 'stock_out')
WHERE o.status IN ('processing', 'ready for pick up')  -- 需要修复的状态
GROUP BY o.id, o.order_id, o.name, o.status
ORDER BY o.created_at DESC;

-- 步骤 3: 修复订单状态
-- 将有部分发货记录但状态不是pending的订单，更新为pending
UPDATE orders
SET status = 'pending'
WHERE id IN (
    SELECT DISTINCT o.id
    FROM orders o
    INNER JOIN stock_transactions st ON st.order_id = o.order_id 
        AND st.transaction_type IN ('partial_delivery', 'manual_order', 'stock_out')
    WHERE o.status IN ('processing', 'ready for pick up')
);

-- 步骤 4: 验证修复结果
SELECT 
    o.id,
    o.order_id,
    o.name,
    o.status,
    COUNT(st.id) as delivery_count
FROM orders o
LEFT JOIN stock_transactions st ON st.order_id = o.order_id 
    AND st.transaction_type IN ('partial_delivery', 'manual_order', 'stock_out')
WHERE st.id IS NOT NULL
GROUP BY o.id, o.order_id, o.name, o.status
ORDER BY o.created_at DESC
LIMIT 20;

-- 步骤 5: 统计各状态的订单数量
SELECT 
    status,
    COUNT(*) as order_count
FROM orders
WHERE status IN ('pending', 'processing', 'ready for pick up', 'delivered')
GROUP BY status
ORDER BY status;
