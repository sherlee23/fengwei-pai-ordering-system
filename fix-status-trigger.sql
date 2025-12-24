-- 🔧 修复订单状态验证触发器
-- 问题：validate_order_status_transition 触发器不允许 'partial delivered' 状态

-- ==================================================
-- 步骤1：查看触发器函数的定义
-- ==================================================

-- 查看 validate_order_status_transition 函数
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'validate_order_status_transition';

-- ==================================================
-- 步骤2：删除旧的触发器函数并重新创建（支持 partial delivered）
-- ==================================================

-- 删除旧函数
DROP FUNCTION IF EXISTS validate_order_status_transition() CASCADE;

-- 重新创建支持 partial delivered 的函数
CREATE OR REPLACE FUNCTION validate_order_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    -- 允许的状态列表（包含 partial delivered）
    IF NEW.status NOT IN (
        'pending',
        'partial delivered',  -- ✨ 新增
        'ready for pick up',
        'delivered',
        'completed',
        'cancelled'
    ) THEN
        RAISE EXCEPTION 'Invalid status value: %', NEW.status;
    END IF;

    -- 可选：添加状态转换规则验证
    -- 例如：cancelled 状态不能再改为其他状态
    IF OLD.status = 'cancelled' AND NEW.status != 'cancelled' THEN
        RAISE EXCEPTION 'Cannot change status from cancelled to %', NEW.status;
    END IF;

    -- 可选：completed 状态不能随便改
    IF OLD.status = 'completed' AND NEW.status != 'completed' THEN
        RAISE EXCEPTION 'Cannot change status from completed to %', NEW.status;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==================================================
-- 步骤3：重新创建触发器
-- ==================================================

CREATE TRIGGER validate_order_status_transition_trigger
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION validate_order_status_transition();

-- ==================================================
-- 步骤4：验证修复
-- ==================================================

-- 测试更新订单状态为 partial delivered
UPDATE orders 
SET status = 'partial delivered'
WHERE order_id = 'FW20251031003';

-- 如果上面执行成功，说明修复完成！

-- 查看结果
SELECT order_id, status, name
FROM orders
WHERE order_id = 'FW20251031003';

-- ==================================================
-- ✅ 完成！
-- ==================================================

-- 现在您可以：
-- 1. 在前端刷新页面（Ctrl+F5）
-- 2. 尝试在下拉菜单中选择"部分已发"状态
-- 3. 系统会自动在编辑流水记录后更新订单状态为 partial delivered
