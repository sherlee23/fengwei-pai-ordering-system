-- =====================================
-- 修复订单部分发货状态问题
-- =====================================

-- 问题描述：
-- 当订单部分发货后，订单状态应该保持为 'pending'（待处理/部分发货）
-- 但系统可能没有正确更新状态

-- 1. 查找有部分发货记录但状态不是 pending 的订单
SELECT 
    o.id,
    o.order_id,
    o.name,
    o.status,
    o.order_items,
    COUNT(st.id) as delivery_count
FROM orders o
LEFT JOIN stock_transactions st ON st.order_id = o.order_id 
    AND st.transaction_type IN ('partial_delivery', 'manual_order', 'stock_out')
WHERE 
    st.id IS NOT NULL  -- 有发货记录
    AND o.status != 'pending'  -- 但状态不是 pending
    AND o.status != 'delivered'  -- 也不是已完成
GROUP BY o.id, o.order_id, o.name, o.status, o.order_items
ORDER BY o.created_at DESC;

-- 2. 检查每个订单的发货情况（简化版本，避免复杂的JSON操作）
SELECT 
    o.id,
    o.order_id,
    o.name,
    o.status,
    o.order_items,
    COUNT(DISTINCT st.id) as delivery_record_count,
    jsonb_agg(DISTINCT jsonb_build_object(
        'product', p.name,
        'delivered_qty', ABS(st.quantity)
    )) FILTER (WHERE st.id IS NOT NULL) as delivered_items
FROM orders o
LEFT JOIN stock_transactions st ON st.order_id = o.order_id 
    AND st.transaction_type IN ('partial_delivery', 'manual_order', 'stock_out')
LEFT JOIN products p ON p.id = st.product_id
WHERE o.status IN ('pending', 'processing', 'ready for pick up')
GROUP BY o.id, o.order_id, o.name, o.status, o.order_items
ORDER BY o.id DESC
LIMIT 20;

-- 3. 自动修复：将有部分发货记录的订单状态设置为 pending
UPDATE orders
SET 
    status = 'pending',
    notes = COALESCE(notes, '') || E'\n\n【系统修复】检测到部分发货记录，状态已更新为待处理'
WHERE id IN (
    SELECT DISTINCT o.id
    FROM orders o
    INNER JOIN stock_transactions st ON st.order_id = o.order_id 
        AND st.transaction_type IN ('partial_delivery', 'manual_order', 'stock_out')
    WHERE o.status IN ('processing', 'ready for pick up')  -- 修复这些状态的订单
);

-- 4. 查找完全发货的订单（所有产品都已发完）
-- 这需要手动验证，因为需要比较订单数量和发货数量
SELECT 
    o.id,
    o.order_id,
    o.name,
    o.status,
    o.order_items
FROM orders o
WHERE EXISTS (
    SELECT 1
    FROM stock_transactions st
    WHERE st.order_id = o.order_id
        AND st.transaction_type IN ('partial_delivery', 'manual_order', 'stock_out', 'order')
)
AND o.status = 'pending'
ORDER BY o.created_at DESC
LIMIT 20;

-- 5. 验证修复结果
SELECT 
    status,
    COUNT(*) as order_count,
    COUNT(DISTINCT (
        SELECT COUNT(*)
        FROM stock_transactions st
        WHERE st.order_id = orders.order_id
            AND st.transaction_type IN ('partial_delivery', 'manual_order', 'stock_out')
    )) as with_deliveries
FROM orders
WHERE status IN ('pending', 'processing', 'ready for pick up', 'delivered')
GROUP BY status
ORDER BY status;
