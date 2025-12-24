-- 🎯 超级简化版诊断查询
-- 直接复制运行，无需修改任何内容

-- ==========================================
-- 查询 1：查看最近的库存流水记录
-- ==========================================
SELECT 
    created_at,
    order_id,
    transaction_type,
    quantity,
    reason
FROM stock_transactions
ORDER BY created_at DESC
LIMIT 20;

-- ==========================================
-- 查询 2：查看是否有回滚记录
-- ==========================================
SELECT 
    id,
    created_at,
    transaction_type,
    reversal_of,
    quantity,
    reason
FROM stock_transactions
WHERE transaction_type = 'stock_adjustment_reversal'
ORDER BY created_at DESC
LIMIT 10;

-- ==========================================
-- 查询 3：查看部分发货记录
-- ==========================================
SELECT 
    st.id,
    st.created_at,
    st.order_id,
    p.name as product_name,
    st.transaction_type,
    st.quantity,
    st.reversal_of
FROM stock_transactions st
LEFT JOIN products p ON p.id = st.product_id
WHERE st.transaction_type IN ('partial_delivery', 'stock_out', 'manual_order', 'order')
ORDER BY st.created_at DESC
LIMIT 20;

-- ==========================================
-- 查询 4：检查订单产品名称（从JSONB中提取）
-- ==========================================
SELECT 
    order_id,
    status,
    jsonb_array_elements(order_items)->>'product' as product_name,
    (jsonb_array_elements(order_items)->>'quantity')::int as quantity
FROM orders
WHERE status IN ('delivered', 'completed')
ORDER BY created_at DESC
LIMIT 20;

-- ==========================================
-- 查询 5：查看products表的产品名称
-- ==========================================
SELECT 
    id,
    name,
    stock_quantity,
    emoji
FROM products
ORDER BY name
LIMIT 30;

-- ==========================================
-- 🎯 关键诊断：检查特定订单
-- ==========================================
-- 把 'FW20251111008' 改成你想检查的订单号
SELECT 
    o.order_id,
    o.status,
    jsonb_pretty(o.order_items) as 订单产品详情
FROM orders o
WHERE o.order_id = 'FW20251111008';

-- 查看这个订单的所有库存流水
SELECT 
    st.created_at,
    st.transaction_type,
    p.name as product_name,
    st.quantity,
    st.reason
FROM stock_transactions st
LEFT JOIN products p ON p.id = st.product_id
WHERE st.order_id = 'FW20251111008'
ORDER BY st.created_at DESC;

-- ==========================================
-- 使用说明
-- ==========================================
/*
这些查询都很简单，不需要复杂的JOIN或类型转换。

如何使用：
1. 先运行查询1-5，了解数据库的整体状态
2. 如果要检查特定订单，修改查询6中的订单号
3. 根据结果判断问题所在

常见问题诊断：
- 如果查询2返回空结果 → 从来没有执行过回滚操作
- 如果查询3显示大量记录 → 说明有很多发货记录
- 如果查询4和查询5的产品名称不一致 → 这就是"已发货"不显示的原因
*/
