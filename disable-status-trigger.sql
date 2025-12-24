-- 🚨 临时解决方案：禁用状态验证触发器
-- 如果您想快速测试功能，可以先禁用触发器

-- ==================================================
-- 方案A：临时禁用触发器（快速测试）
-- ==================================================

-- 禁用触发器
ALTER TABLE orders DISABLE TRIGGER validate_order_status_transition_trigger;

-- 现在可以自由更改订单状态了
-- 测试更新
UPDATE orders 
SET status = 'partial delivered'
WHERE order_id = 'FW20251031003';

-- 查看结果
SELECT order_id, status, name FROM orders WHERE order_id = 'FW20251031003';

-- ⚠️ 注意：禁用后就没有状态验证了，任何状态都可以设置
-- ⚠️ 建议测试完成后重新启用或修复触发器

-- ==================================================
-- 重新启用触发器（测试完成后）
-- ==================================================

-- 方法1：重新启用旧触发器（不推荐，还是会报错）
-- ALTER TABLE orders ENABLE TRIGGER validate_order_status_transition_trigger;

-- 方法2：先执行 fix-status-trigger.sql 修复触发器，然后启用
-- 步骤：
-- 1. 保持触发器禁用状态
-- 2. 执行 fix-status-trigger.sql 中的步骤2和步骤3
-- 3. 新触发器会自动启用

-- ==================================================
-- 方案B：完全删除触发器（不推荐）
-- ==================================================

-- 如果您不需要状态验证，可以完全删除
-- DROP TRIGGER IF EXISTS validate_order_status_transition_trigger ON orders;
-- DROP FUNCTION IF EXISTS validate_order_status_transition();

-- ⚠️ 删除后就永久没有状态验证了

-- ==================================================
-- 推荐做法
-- ==================================================

-- 1. 先执行本文件的"方案A"临时禁用触发器
-- 2. 测试前端功能是否正常
-- 3. 确认功能正常后，执行 fix-status-trigger.sql 修复触发器
-- 4. 新触发器会自动支持 partial delivered 状态
