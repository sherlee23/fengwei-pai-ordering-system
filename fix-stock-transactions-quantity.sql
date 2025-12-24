-- ================================
-- 修复库存流水数量显示问题
-- ================================

-- 1. 查看所有出库类型但数量为正数的异常记录
SELECT 
    id,
    created_at,
    product_id,
    transaction_type,
    quantity,
    previous_stock,
    new_stock,
    reason,
    order_id,
    notes
FROM stock_transactions
WHERE 
    transaction_type IN ('stock_out', 'order', 'manual_order', 'partial_delivery', 'manual_out')
    AND quantity > 0  -- 出库但数量为正数（异常）
    AND new_stock < previous_stock  -- 但库存确实减少了（证明是真的出库）
ORDER BY created_at DESC;

-- 2. 修复这些异常记录：将正数改为负数
UPDATE stock_transactions
SET 
    quantity = -ABS(quantity),  -- 确保是负数
    notes = COALESCE(notes, '') || E'\n\n【系统修复】数量符号已修正为负数'
WHERE 
    transaction_type IN ('stock_out', 'order', 'manual_order', 'partial_delivery', 'manual_out')
    AND quantity > 0
    AND new_stock < previous_stock;

-- 3. 查看所有入库类型但数量为负数的异常记录
SELECT 
    id,
    created_at,
    product_id,
    transaction_type,
    quantity,
    previous_stock,
    new_stock,
    reason,
    order_id,
    notes
FROM stock_transactions
WHERE 
    transaction_type IN ('stock_in', 'manual_in', 'stock_adjustment')
    AND quantity < 0  -- 入库但数量为负数（异常）
    AND new_stock > previous_stock  -- 但库存确实增加了（证明是真的入库）
ORDER BY created_at DESC;

-- 4. 修复这些异常记录：将负数改为正数
UPDATE stock_transactions
SET 
    quantity = ABS(quantity),  -- 确保是正数
    notes = COALESCE(notes, '') || E'\n\n【系统修复】数量符号已修正为正数'
WHERE 
    transaction_type IN ('stock_in', 'manual_in', 'stock_adjustment')
    AND quantity < 0
    AND new_stock > previous_stock;

-- 5. 验证修复结果
SELECT 
    transaction_type,
    COUNT(*) as total,
    SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END) as positive_qty,
    SUM(CASE WHEN quantity < 0 THEN 1 ELSE 0 END) as negative_qty,
    SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END) as zero_qty
FROM stock_transactions
GROUP BY transaction_type
ORDER BY transaction_type;

-- 6. 查找仍然异常的记录
SELECT 
    id,
    transaction_type,
    quantity,
    previous_stock,
    new_stock,
    (new_stock - previous_stock) as actual_change,
    reason
FROM stock_transactions
WHERE 
    -- 出库类型但数量为正 OR 入库类型但数量为负
    (transaction_type IN ('stock_out', 'order', 'manual_order', 'partial_delivery', 'manual_out') AND quantity > 0)
    OR
    (transaction_type IN ('stock_in', 'manual_in') AND quantity < 0)
ORDER BY created_at DESC
LIMIT 20;
