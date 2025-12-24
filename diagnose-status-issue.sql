-- 🔍 诊断 partial delivered 状态问题
-- 在 Supabase SQL Editor 中执行

-- ==================================================
-- 步骤1：检查当前的约束
-- ==================================================

SELECT 
    conname AS "约束名称",
    contype AS "约束类型",
    pg_get_constraintdef(oid) AS "约束定义"
FROM pg_constraint
WHERE conrelid = 'orders'::regclass;

-- 预期结果：应该看到 orders_status_check 约束
-- 如果看到多个状态约束，说明有旧约束没删除干净

-- ==================================================
-- 步骤2：强制删除所有状态相关约束
-- ==================================================

-- 查找所有包含 'status' 的约束
DO $$
DECLARE
    constraint_record RECORD;
BEGIN
    FOR constraint_record IN 
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'orders'::regclass
        AND contype = 'c'
        AND (conname LIKE '%status%' OR pg_get_constraintdef(oid) LIKE '%status%')
    LOOP
        EXECUTE format('ALTER TABLE orders DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
        RAISE NOTICE '删除约束: %', constraint_record.conname;
    END LOOP;
END $$;

-- ==================================================
-- 步骤3：重新添加正确的约束
-- ==================================================

ALTER TABLE orders 
ADD CONSTRAINT orders_status_check 
CHECK (status::text = ANY (ARRAY[
    'pending'::text,
    'partial delivered'::text,
    'ready for pick up'::text,
    'delivered'::text,
    'completed'::text,
    'cancelled'::text
]));

-- ==================================================
-- 步骤4：验证新约束
-- ==================================================

-- 查看新约束
SELECT 
    conname AS "约束名称",
    pg_get_constraintdef(oid) AS "约束定义"
FROM pg_constraint
WHERE conrelid = 'orders'::regclass
AND conname = 'orders_status_check';

-- ==================================================
-- 步骤5：测试更新
-- ==================================================

-- 找一个测试订单
SELECT order_id, status, name
FROM orders
WHERE order_id = 'FW20251031003'
LIMIT 1;

-- 尝试更新为 partial delivered
-- UPDATE orders 
-- SET status = 'partial delivered'
-- WHERE order_id = 'FW20251031003';

-- 如果上面的 UPDATE 成功，说明问题解决了！

-- ==================================================
-- 步骤6：检查是否有触发器影响
-- ==================================================

-- 查看 orders 表的所有触发器
SELECT 
    tgname AS "触发器名称",
    pg_get_triggerdef(oid) AS "触发器定义"
FROM pg_trigger
WHERE tgrelid = 'orders'::regclass
AND NOT tgisinternal;

-- 如果有触发器验证状态，也需要更新

-- ==================================================
-- 🆘 如果仍然失败
-- ==================================================

-- 1. 检查 RLS (Row Level Security) 策略
SELECT * FROM pg_policies WHERE tablename = 'orders';

-- 2. 检查表结构
\d orders

-- 3. 尝试直接查询看是否有其他约束
SELECT * FROM information_schema.check_constraints 
WHERE constraint_schema = 'public' 
AND constraint_name LIKE '%order%';
