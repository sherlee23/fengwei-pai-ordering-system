// 🔍 浏览器控制台调试脚本
// 在浏览器控制台（F12 → Console）中粘贴并执行此脚本

console.log('===== 开始诊断 =====');

// 1. 检查 stockTransactions 数据
console.log('1. 流水记录总数:', window.stockTransactions?.length || 0);
console.log('2. 流水记录样本:', window.stockTransactions?.slice(0, 3));

// 2. 检查 Christine Fang 订单的流水记录
const christineTransactions = window.stockTransactions?.filter(t => 
    t.order_id === 'FW20251031003'
);
console.log('3. Christine 订单的流水记录:', christineTransactions);

// 3. 检查部分发货记录
const partialDeliveries = christineTransactions?.filter(t =>
    ['partial_delivery', 'stock_out', 'manual_order'].includes(t.transaction_type) &&
    t.quantity < 0
);
console.log('4. Christine 订单的出库记录:', partialDeliveries);

// 4. 按产品分组统计
const deliveryByProduct = {};
partialDeliveries?.forEach(trans => {
    const productName = trans.product?.name;
    if (productName) {
        deliveryByProduct[productName] = (deliveryByProduct[productName] || 0) + Math.abs(trans.quantity);
    }
});
console.log('5. 各产品已发货数量:', deliveryByProduct);

// 5. 检查订单数据
const order = window.orders?.find(o => o.order_id === 'FW20251031003');
console.log('6. Christine 订单数据:', order);
console.log('7. 订单产品列表:', order?.order_items);

// 6. 匹配检查
if (order?.order_items) {
    console.log('8. 产品匹配检查:');
    order.order_items.forEach(item => {
        const delivered = deliveryByProduct[item.product] || 0;
        const remaining = item.quantity - delivered;
        console.log(`   - ${item.product}: 订购${item.quantity}, 已发${delivered}, 剩余${remaining}`);
    });
}

console.log('===== 诊断完成 =====');
console.log('如果上面显示"已发货数量"都是0，说明数据没有正确匹配');
console.log('请将完整的输出结果截图或复制给开发者');
