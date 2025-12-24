import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { BrowserMultiFormatReader, BrowserCodeReader, BrowserQRCodeReader } from '@zxing/browser';
import { WorkingBarcodeScanner } from './WorkingBarcodeScanner';
import StaffManagement from './StaffManagement';
import PackingView from './PackingView';

// PDF.js 类型声明
declare const pdfjsLib: any;
import { supabase, ADMIN_PASSWORD } from '../constants';
import { Product, Order, FeatureFlags, Member, OrderItem, StockTransaction, PurchaseOrder, PurchaseOrderItem } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';

// --- Global Scope Declaration ---
declare const Html5Qrcode: any;
declare const JsBarcode: any;
declare const QRCode: any;

// --- Module-level Constants ---
const productMapping = {
    // 小笼汤包系列（需要去除规格括号）
    '鲜肉小笼汤包 ( 1 袋 9只）': '鲜肉小笼汤包',
    '黑松露小笼汤包 ( 1 袋 6只）': '黑松露小笼汤包',
    '菌菇小笼汤包 ( 1 袋 9只）': '菌菇小笼汤包',
    
    // 纸皮烧卖系列（需要去除规格括号）
    '黑猪三丁纸皮烧卖 ( 1 袋 6只）': '黑猪三丁纸皮烧卖',
    '黑椒牛肉纸皮烧卖 ( 1 袋 6只）': '黑椒牛肉纸皮烧卖',
    '黑猪梅菜干纸皮烧卖 ( 1 袋 6只）': '黑猪梅菜干纸皮烧卖',
    '乌米腊味纸皮烧卖 ( 1 袋 6只）': '乌米腊味纸皮烧卖',
    '三丁芝士纸皮烧卖 ( 1 袋 6只）': '三丁芝士纸皮烧卖',
    
    // 酥饼系列（需要去除规格括号）
    '黑猪肉酥饼 (一份 3袋，每 袋 4片）': '黑猪肉酥饼',
    '安格斯牛肉酥饼 (一份 3袋，每 袋 4片）': '安格斯牛肉酥饼',
    
    // 鸡翅系列（旧名称映射到新名称）
    '奥尔良鸡翅': '奥尔良烤翅中',
    '青花椒鸡翅': '青花椒烤翅中'
};

// --- Helper Functions ---
const copyTextUniversal = async (text: string): Promise<boolean> => {
    try {
        if (navigator.clipboard) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (err) {
        console.warn("Clipboard API failed, falling back.");
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
        return document.execCommand('copy');
    } catch (err) {
        return false;
    } finally {
        document.body.removeChild(ta);
    }
};

const buildOrderMessage = (order: Order) => {
    let msg = `🛎️ *锋味派新订单 #${order.order_id}*\n\n`;
    msg += `👤 *客户信息*\n`;
    msg += `📛 姓名: ${order.name}\n`;
    msg += `📱 电话: ${order.phone}\n`;
    msg += `🚚 取货方式: ${order.delivery_method === 'self-pickup' ? '自取' : 'Lalamove送货'}\n`;
    if (order.address) msg += `📍 地址: ${order.address}\n`;
    msg += `\n🛒 *订单明细*\n`;
    (order.order_items || []).forEach(item => {
        const typeLabel = item.is_unlimited ? ' (预购)' : ' (现货)';
        msg += `${item.emoji || '▫️'} ${item.product}${typeLabel} × ${item.quantity} = RM${((item.quantity || 0) * (item.price || 0)).toFixed(2)}\n`;
    });
    msg += `\n💰 *总金额: RM${Number(order.total_amount || 0).toFixed(2)}*\n`;
    msg += `📝 *备注*: ${order.remarks || '无'}\n`;
    msg += `📅 *下单时间*: ${new Date(order.created_at || Date.now()).toLocaleString('zh-CN')}`;
    return msg;
};

const printOrder = async (order: Order, stockTransactions: any[] = [], fetchStockTransactions?: () => Promise<void>) => {
    const printWindow = window.open('', '_blank', 'width=820,height=900');
    if (!printWindow) { alert('请允许弹出窗口以便打印。'); return; }
    const doc = printWindow.document;
    doc.open();
    
    // 确保库存流水数据已加载
    if (stockTransactions.length === 0 && fetchStockTransactions) {
        console.log('库存流水数据为空，先加载数据...');
        await fetchStockTransactions();
    }
    
    // 获取已发货数量
    const getDeliveredQuantities = async () => {
        try {
            console.log('开始查询已发货数量，订单ID:', order.order_id);
            
            // 先获取当前加载的stockTransactions数据
            console.log('当前stockTransactions数据量:', stockTransactions.length);
            
            if (stockTransactions.length > 0) {
                // 使用已加载的数据
                const deliveredMap: {[productName: string]: number} = {};
                
                stockTransactions.forEach(trans => {
                    if (trans.order_id === order.order_id && 
                        ['partial_delivery', 'stock_out', 'manual_order'].includes(trans.transaction_type) && // 兼容旧数据，建议统一为partial_delivery
                        trans.quantity < 0) {
                        
                        const productName = trans.product?.name;
                        if (productName) {
                            deliveredMap[productName] = (deliveredMap[productName] || 0) + Math.abs(trans.quantity);
                            console.log(`从已加载数据中找到: ${productName} 发货量 ${Math.abs(trans.quantity)}`);
                        }
                    }
                });
                
                console.log('从已加载数据计算的已发货数量映射:', deliveredMap);
                return deliveredMap;
            }
            
            // 如果没有已加载的数据，则直接查询
            const { data, error } = await supabase
                .from('stock_transactions')
                .select(`
                    *,
                    product:product_id(name, emoji)
                `)
                .eq('order_id', order.order_id)
                .in('transaction_type', ['partial_delivery', 'stock_out', 'manual_order']);
            
            if (error) throw error;
            
            console.log('直接查询到的发货数据:', data);
            
            const deliveredMap: {[productName: string]: number} = {};
            data?.forEach(trans => {
                const productName = (trans.product as any)?.name;
                if (productName && trans.quantity < 0) { // 负数表示出库
                    deliveredMap[productName] = (deliveredMap[productName] || 0) + Math.abs(trans.quantity);
                    console.log(`从直接查询找到: ${productName} 发货量 ${Math.abs(trans.quantity)}`);
                }
            });
            console.log('直接查询计算的已发货数量映射:', deliveredMap);
            return deliveredMap;
        } catch (error) {
            console.error('获取已发货数量失败:', error);
            return {};
        }
    };
    
    const deliveredQuantities = await getDeliveredQuantities();
    
    console.log('打印订单时获取到的已发货数量:', deliveredQuantities);
    
    doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>订单 ' + order.order_id + '</title>');
    // 加载JsBarcode库
    doc.write('<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>');
    doc.write('<style>body{font-family:Arial,sans-serif; margin:20px;} h1{font-size:24px; font-weight:bold;} div{margin:8px 0;} table{width:100%; border-collapse:collapse; margin-top:15px;} th, td{border:1px solid #333; padding:8px; text-align:left;} .checkbox{width:20px; height:20px; border:2px solid #333; display:inline-block; vertical-align:middle; margin-left:10px;} .delivered{color:#666; text-decoration:line-through; opacity:0.6;} tr.delivered td{background-color:#f0f0f0; color:#666;} .remaining{color:#e11d48; font-weight:bold;} .barcode-section{margin:20px 0; padding:10px; border:1px solid #999; text-align:center; background:#f9f9f9;} @media print{button{display:none}}</style></head><body>');
    doc.write('<h1>锋味派订单 #' + order.order_id + '</h1>');
    
    doc.write('<div><b>客户:</b> ' + order.name + '</div>');
    doc.write('<div><b>电话:</b> ' + order.phone + '</div>');
    doc.write(`<div><b>方式:</b> ${order.delivery_method === 'self-pickup' ? '自取' : 'Lalamove送货'}</div>`);
    doc.write('<div><b>备注:</b> ' + (order.remarks || '无') + '</div>');
    
    // 分离需要打包和已发货的产品
    const itemsToPack: any[] = [];
    const deliveredItems: any[] = [];
    
    (order.order_items || []).forEach(item => {
        const deliveredQty = deliveredQuantities[item.product] || 0;
        const remainingQty = Math.max(0, item.quantity - deliveredQty);
        
        console.log(`商品: ${item.product}, 总数量: ${item.quantity}, 已发货: ${deliveredQty}, 剩余: ${remainingQty}`);
        
        if (remainingQty > 0) {
            itemsToPack.push({ ...item, remaining: remainingQty, delivered: deliveredQty });
        } else if (deliveredQty > 0) {
            deliveredItems.push({ ...item, delivered: deliveredQty });
        }
    });
    
    // 需要打包的产品 - 双列布局
    if (itemsToPack.length > 0) {
        doc.write('<div style="margin-top:20px; border-top:2px solid #333; padding-top:10px;">');
        doc.write('<h2 style="font-size:18px; font-weight:bold; margin-bottom:15px; color:#e11d48;">📦 本次需要打包</h2>');
        doc.write('<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">');
        
        itemsToPack.forEach(item => {
            const qtyText = item.delivered > 0 
                ? `× ${item.remaining} <span style="font-size:11px; color:#666;">(已发${item.delivered})</span>`
                : `× ${item.remaining}`;
            
            doc.write(`
                <div style="border:1px solid #ddd; padding:10px; border-radius:4px; background:#fff;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="width:22px; height:22px; border:2.5px solid #333; display:inline-block; flex-shrink:0;"></span>
                        <div style="flex:1;">
                            <div style="font-size:16px; font-weight:bold; color:#000;">${item.product}</div>
                            <div style="font-size:14px; color:#e11d48; font-weight:bold; margin-top:2px;">${qtyText}</div>
                        </div>
                    </div>
                </div>
            `);
        });
        
        doc.write('</div></div>');
    }
    
    // 之前已发货的产品 - 列表形式
    if (deliveredItems.length > 0) {
        doc.write('<div style="margin-top:20px; border-top:1px dashed #999; padding-top:10px;">');
        doc.write('<h3 style="font-size:14px; font-weight:bold; margin-bottom:8px; color:#666;">✓ 之前已发货</h3>');
        doc.write('<div style="font-size:12px; color:#666; line-height:1.8;">');
        
        deliveredItems.forEach(item => {
            doc.write(`• ${item.product} × ${item.delivered} (已发完)<br/>`);
        });
        
        doc.write('</div></div>');
    }
    
    // 订单条形码 - 底部小尺寸
    doc.write('<div style="margin-top:25px; padding-top:15px; border-top:1px dashed #ccc; text-align:center;">');
    doc.write('<div style="font-size:11px; color:#999; margin-bottom:6px;">扫描订单号开始打包</div>');
    doc.write('<div style="display:inline-block;"><canvas id="orderBarcode"></canvas></div>');
    doc.write('<div style="font-size:13px; font-weight:bold; color:#333; margin-top:4px;">' + order.order_id + '</div>');
    doc.write('</div>');
    
    doc.write('<div style="margin-top:10px; padding-top:8px; font-size:11px; color:#888; border-top:1px dashed #ddd;">💡 打包提示：扫描上方条形码开始打包流程，打包时扫描每个产品条形码进行核验</div>');
    
    // JavaScript生成条形码 - 进一步缩小
    doc.write('<script>');
    doc.write('window.onload = function() {');
    doc.write('  if (typeof JsBarcode !== "undefined") {');
    doc.write('    JsBarcode("#orderBarcode", "ORDER-' + order.order_id + '", {');
    doc.write('      format: "CODE128",');
    doc.write('      width: 2.5,'); // 适中的线条宽度
    doc.write('      height: 30,'); // 进一步缩小高度
    doc.write('      displayValue: true,');
    doc.write('      fontSize: 10,'); // 缩小字体
    doc.write('      textMargin: 4,'); // 缩小边距
    doc.write('      margin: 5'); // 添加外边距
    doc.write('    });');
    doc.write('  }');
    doc.write('};');
    doc.write('</script>');
    
    doc.write('<button onclick="window.print()" style="font-size:16px;padding:10px 20px;margin-top:16px;">打印订单</button></body></html>');
    doc.close();
};


// --- Helper Components ---

const LoadingSpinner: React.FC<{ text?: string }> = ({ text }) => (
    <div className="flex flex-col items-center justify-center p-10 text-center w-full h-full">
        <svg className="h-12 w-12 text-red-600 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        {text && <p className="mt-4 text-lg font-semibold text-gray-700">{text}</p>}
    </div>
);

// --- Admin Panels ---
const Dashboard: React.FC<{ setView: (view: string) => void; allOrders: Order[]; products: Product[]; showToast: (message: string, type?: 'success' | 'danger' | 'warning') => void; }> = ({ setView, allOrders, products, showToast }) => {
    // 团购管理状态
    const [groupManagement, setGroupManagement] = useState({
        currentGroup: 1,
        groupHistory: [],
        lastResetDate: new Date().toISOString()
    });
    
    // 库存流水数据（用于计算已发货数量）
    const [transactions, setTransactions] = useState<StockTransaction[]>([]);
    // 添加stockTransactions状态以供printOrder函数使用
    const [stockTransactions, setStockTransactions] = useState<StockTransaction[]>([]);

    // 从 Supabase 加载团购管理数据
    const loadGroupManagement = useCallback(async () => {
        try {
            // 获取当前团购管理信息
            const { data: managementData, error: managementError } = await supabase
                .from('group_management')
                .select('*')
                .order('id', { ascending: false })
                .limit(1)
                .single();

            // 获取团购历史记录
            const { data: historyData, error: historyError } = await supabase
                .from('group_history')
                .select('*')
                .order('group_number', { ascending: true });

            if (managementError && managementError.code !== 'PGRST116') {
                console.error('加载团购管理数据失败:', managementError);
                return;
            }

            if (historyError) {
                console.error('加载团购历史数据失败:', historyError);
                return;
            }

            // 设置团购管理状态（转换数据库字段名为 camelCase）
            const groupManagementState = {
                currentGroup: managementData?.current_group || 1,
                groupHistory: (historyData || []).map((group: any) => ({
                    groupNumber: group.group_number,
                    startDate: group.start_date,
                    endDate: group.end_date,
                    totalBoxes: group.total_boxes,
                    orderCount: group.order_count,
                    firstOrderId: group.first_order_id,
                    lastOrderId: group.last_order_id,
                    completedGroups: group.completed_groups,
                    isManualComplete: group.is_manual_complete
                })),
                lastResetDate: managementData?.last_reset_date || new Date().toISOString()
            };

            setGroupManagement(groupManagementState);
            
            // 同时保存到 localStorage 作为备份
            localStorage.setItem('groupManagement', JSON.stringify(groupManagementState));
        } catch (error) {
            console.error('加载团购数据时出错:', error);
            // 如果 Supabase 加载失败，尝试从 localStorage 恢复
            const saved = localStorage.getItem('groupManagement');
            if (saved) {
                setGroupManagement(JSON.parse(saved));
            }
        }
    }, []);

    // 保存团购管理数据到 Supabase 和 localStorage
    const saveGroupManagement = async (data: any) => {
        try {
            setGroupManagement(data);
            
            // 保存到 Supabase - 团购管理表
            const { error: managementError } = await supabase
                .from('group_management')
                .upsert({
                    id: 1, // 固定ID，只维护一条记录
                    current_group: data.currentGroup,
                    last_reset_date: data.lastResetDate,
                    updated_at: new Date().toISOString()
                });

            if (managementError) {
                console.error('保存团购管理数据失败:', managementError);
                showToast('保存团购数据失败: ' + managementError.message, 'danger');
                return;
            }

            // 保存到 localStorage 作为备份
            localStorage.setItem('groupManagement', JSON.stringify(data));
            
            console.log('团购数据已成功保存到 Supabase');
        } catch (error) {
            console.error('保存团购数据时出错:', error);
            showToast('保存团购数据失败', 'danger');
        }
    };

    // 修复历史数据功能
    const handleFixHistoryData = async () => {
        const confirmMessage = `🔧 确认要修复历史团购数据吗？\n\n此操作将：\n✅ 修正所有历史团的完成团数为1团\n✅ 确保每个手动截团都正确记录为1团完成\n⚠️ 此操作不可逆，请确认继续\n\n💡 修复后团购统计将更加准确`;
        
        if (confirm(confirmMessage)) {
            try {
                // 修复 Supabase 中的历史数据
                const { error: updateError } = await supabase
                    .from('group_history')
                    .update({
                        completed_groups: 1,
                        is_manual_complete: true
                    })
                    .neq('id', 0); // 更新所有记录

                if (updateError) {
                    console.error('修复历史数据失败:', updateError);
                    showToast('修复历史数据失败: ' + updateError.message, 'danger');
                    return;
                }

                // 重新加载团购数据
                await loadGroupManagement();
                
                const successMessage = `🎉 历史数据修复完成！\n\n📊 修复结果：\n- 🔧 已修复 ${groupManagement.groupHistory.length} 个历史团记录\n- ✅ 所有历史团的完成团数已统一为1团\n- 🏷️ 所有团都已标记为手动截团\n- 💾 数据已同步到云端数据库\n\n💡 现在团购统计数据更加准确了！`;
                
                alert(successMessage);
            } catch (error) {
                console.error('修复历史数据时出错:', error);
                showToast('修复历史数据失败', 'danger');
            }
        }
    };

    // 清零/截团功能
    const handleGroupComplete = async () => {
        // 手动截团逻辑：无论当前多少盒，手动截团就是完成1团
        const totalCompletedGroups = 1; // 手动截团直接算作1团完成
        
        const confirmMessage = `确认要截止第${groupManagement.currentGroup}团并开始新一团吗？\n\n当前团统计：\n📦 总售出：${presaleStats.totalBoxes}盒\n📋 订单数：${presaleStats.orderCount}单\n🎯 订单范围：${presaleStats.firstOrderId || '无'} → ${presaleStats.lastOrderId || '无'}\n✅ 完成团数：${totalCompletedGroups}团 (手动截团)\n\n💡 手动截团将直接算作完成1团，无论当前盒数多少`;
        
        if (confirm(confirmMessage)) {
            const currentGroupNumber = groupManagement.currentGroup;
            const endDate = new Date().toISOString();
            
            // 🔥 特殊处理第一团：计算从系统开始到截团时的所有数据
            let historyData;
            if (currentGroupNumber === 1) {
                // 第一团：计算所有历史订单数据
                let allHistoryBoxes = 0;
                let allHistoryOrders: Order[] = [];
                
                if (allOrders && products) {
                    // 获取所有订单，按时间排序
                    allHistoryOrders = allOrders
                        .filter(order => new Date(order.created_at) <= new Date(endDate))
                        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                    
                    // 计算所有历史预购产品数量
                    allHistoryOrders.forEach(order => {
                        (order.order_items || []).forEach(item => {
                            const product = products.find(p => p.name === item.product);
                            if (product && product.is_unlimited && !item.product.includes('运费专用') && !item.product.includes('运费')) {
                                allHistoryBoxes += item.quantity || 0;
                            }
                        });
                    });
                }
                
                // 🎯 手动截团逻辑：无论多少盒，手动截团就直接算完成1团
                historyData = {
                    groupNumber: currentGroupNumber,
                    startDate: groupManagement.lastResetDate, // 系统开始时间
                    endDate: endDate,
                    totalBoxes: allHistoryBoxes, // 使用全部历史数据
                    orderCount: allHistoryOrders.length,
                    firstOrderId: allHistoryOrders.length > 0 ? allHistoryOrders[0].order_id : '',
                    lastOrderId: allHistoryOrders.length > 0 ? allHistoryOrders[allHistoryOrders.length - 1].order_id : '',
                    completedGroups: 1, // 手动截团直接算完成1团
                    isManualComplete: true // 标记为手动截团
                };
                
                console.log('第一团历史数据修正:', historyData);
            } else {
                // 后续团：使用当前计算的数据
                // 🎯 手动截团逻辑：无论多少盒，手动截团就直接算完成1团
                historyData = {
                    groupNumber: currentGroupNumber,
                    startDate: groupManagement.lastResetDate,
                    endDate: endDate,
                    totalBoxes: presaleStats.totalBoxes,
                    orderCount: presaleStats.orderCount,
                    firstOrderId: presaleStats.firstOrderId || '',
                    lastOrderId: presaleStats.lastOrderId || '',
                    completedGroups: 1, // 手动截团直接算完成1团
                    isManualComplete: true // 标记为手动截团
                };
            }
            
            // 先保存历史记录到 Supabase
            const { error: historyError } = await supabase
                .from('group_history')
                .insert([{
                    group_number: historyData.groupNumber,
                    start_date: historyData.startDate,
                    end_date: historyData.endDate,
                    total_boxes: historyData.totalBoxes,
                    order_count: historyData.orderCount,
                    first_order_id: historyData.firstOrderId,
                    last_order_id: historyData.lastOrderId,
                    completed_groups: historyData.completedGroups,
                    is_manual_complete: historyData.isManualComplete
                }]);

            if (historyError) {
                console.error('保存团购历史失败:', historyError);
                showToast('保存团购历史失败: ' + historyError.message, 'danger');
                return;
            }

            // 记录截团信息（更新本地状态）
            const newHistory = [...groupManagement.groupHistory, historyData];
            
            const newData = {
                currentGroup: currentGroupNumber + 1,
                groupHistory: newHistory,
                lastResetDate: endDate // 重置团开始时间为当前时间
            };
            
            await saveGroupManagement(newData);
            
            const successMessage = `🎉 第${currentGroupNumber}团已成功截止！\n\n📊 截止统计：\n- 📦 总售出：${historyData.totalBoxes}盒\n- 📋 订单数：${historyData.orderCount}单\n- 🎯 订单范围：${historyData.firstOrderId || '无'} → ${historyData.lastOrderId || '无'}\n- ✅ 完成团数：${historyData.completedGroups}团 (手动截团)\n- ⏰ 截止时间：${new Date().toLocaleString()}\n\n🚀 现在开始第${newData.currentGroup}团预购！\n💡 下一团将从0盒开始计算`;
            
            alert(successMessage);
        }
    };

    const stats = useMemo(() => {
        const today = new Date().toISOString().slice(0, 10);
        const monthStart = new Date();
        monthStart.setDate(1);
        const monthStartStr = monthStart.toISOString();

        const todayOrders = allOrders.filter(o => o.created_at >= today);
        const monthOrders = allOrders.filter(o => o.created_at >= monthStartStr);
        const pendingOrders = allOrders.filter(o => o.status === 'pending');
        
        const todaySales = todayOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
        const monthSales = monthOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
        
        // 🎯 总盈亏统计：从团购开始时间之后的所有订单（包括现货、预购、后续所有团）
        let totalBoxesSold = 0; // 总销量盒数（所有历史订单，仅用于参考）
        let totalBoxesSoldSinceGroup = 0; // 从团购开始后的总销量
        let totalRevenueSinceGroup = 0; // 从团购开始后的总销售额
        let totalCostSinceGroup = 0; // 从团购开始后的总成本
        let totalProfitSinceGroup = 0; // 从团购开始后的总利润
        let orderCountSinceGroup = 0; // 从团购开始后的订单数
        
        const groupStartTime = new Date(groupManagement.lastResetDate);
        
        allOrders
            .filter(order => order.status !== 'cancelled')
            .forEach(order => {
                const orderTime = new Date(order.created_at);
                const isAfterGroupStart = orderTime >= groupStartTime;
                
                (order.order_items || []).forEach(item => {
                    const isShippingProduct = item.product.includes('运费专用') || 
                                            item.product.includes('运费') ||
                                            item.product.toLowerCase().includes('shipping');
                    
                    if (!isShippingProduct) {
                        // 计算所有历史销量（用于显示）
                        totalBoxesSold += item.quantity || 0;
                        
                        // 🎯 从团购开始后的订单：计算销量和成本
                        if (isAfterGroupStart) {
                            totalBoxesSoldSinceGroup += item.quantity || 0;
                            
                            // 使用成本快照计算成本
                            if (item.cost_price_snapshot !== null && item.cost_price_snapshot !== undefined) {
                                const costPrice = Number(item.cost_price_snapshot);
                                const shippingCost = Number(item.shipping_cost_snapshot || 0);
                                totalCostSinceGroup += (costPrice + shippingCost) * (item.quantity || 0);
                            }
                        }
                    }
                });
                
                // 计算从团购开始后的销售额和订单数
                if (isAfterGroupStart) {
                    totalRevenueSinceGroup += Number(order.total_amount || 0);
                    orderCountSinceGroup++;
                }
            });
        
        // 计算总利润
        totalProfitSinceGroup = totalRevenueSinceGroup - totalCostSinceGroup;
        
        const totalStock = products.filter(p => !p.is_unlimited).reduce((sum, p) => sum + (p.stock_quantity || 0), 0);
        const stockValue = products.filter(p => !p.is_unlimited).reduce((sum, p) => sum + ((p.stock_quantity || 0) * (p.price || 0)), 0);
        const lowStockCount = products.filter(p => !p.is_unlimited && (p.stock_quantity || 0) <= (p.min_stock_threshold || 5)).length;

        return {
            todaySales, monthSales,
            todayOrders: todayOrders.length,
            pendingOrders: pendingOrders.length,
            availableProducts: products.filter(p => p.is_published).length,
            lowStock: lowStockCount, totalStock, stockValue,
            totalBoxesSold, // 所有历史订单的总销量（仅用于显示）
            totalBoxesSoldSinceGroup, // 从团购开始后的总销量
            totalRevenueSinceGroup, // 从团购开始后的总销售额
            totalCostSinceGroup, // 从团购开始后的总成本
            totalProfitSinceGroup, // 从团购开始后的总利润
            orderCountSinceGroup // 从团购开始后的订单数
        };
    }, [allOrders, products, groupManagement.lastResetDate]);
    
    const presaleStats = useMemo(() => {
        let totalPresaleBoxes = 0;
        let totalPresaleRevenue = 0; // 新增：本次团购的总销售额
        let totalPresaleCost = 0; // 新增：本次团购的总成本
        let totalPresaleProfit = 0; // 新增：本次团购的总利润
        let firstOrderId = '';
        let lastOrderId = '';
        let currentGroupOrders: Order[] = [];
        
        console.log('=== 开始计算当前团预购统计 ===');
        console.log('当前团号:', groupManagement.currentGroup);
        console.log('团开始时间:', groupManagement.lastResetDate);
        console.log('总订单数:', allOrders?.length || 0);
        console.log('总产品数:', products?.length || 0);
        
        if (allOrders && products) {
            const currentGroupStartTime = new Date(groupManagement.lastResetDate);
            console.log('当前团开始时间对象:', currentGroupStartTime);
            
            // 🔍 特殊处理第一团：如果是第一团且没有历史记录，应该显示所有历史数据
            if (groupManagement.currentGroup === 1 && groupManagement.groupHistory.length === 0) {
                console.log('🎯 第一团特殊处理：显示所有历史数据');
                // 第一团显示所有订单数据（排除已取消的订单）
                currentGroupOrders = allOrders
                    .filter(order => order.status !== 'cancelled')
                    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                console.log('第一团订单总数:', currentGroupOrders.length);
            } else {
                // 后续团：只计算当前团开始时间之后的订单（排除已取消的订单）
                console.log('🎯 后续团：按时间筛选订单');
                currentGroupOrders = allOrders
                    .filter(order => {
                        const orderTime = new Date(order.created_at);
                        const isAfterStart = orderTime >= currentGroupStartTime;
                        const isNotCancelled = order.status !== 'cancelled';
                        if (!isAfterStart) {
                            console.log(`订单${order.order_id}被过滤: ${orderTime} < ${currentGroupStartTime}`);
                        }
                        if (!isNotCancelled) {
                            console.log(`订单${order.order_id}被过滤: 已取消`);
                        }
                        return isAfterStart && isNotCancelled;
                    })
                    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                console.log('筛选后当前团订单数:', currentGroupOrders.length);
            }
            
            // 计算预购产品数量、销售额和成本
            currentGroupOrders.forEach(order => {
                (order.order_items || []).forEach(item => {
                    const product = products.find(p => p.name === item.product);
                    
                    // 🎯 关键修复：使用订单快照的 is_unlimited，而不是产品表的实时状态
                    // 这样即使产品后来改成现货，历史订单仍然会被正确统计
                    // 排除"运费专用"产品，只计算预购产品
                    if (item.is_unlimited && !item.product.includes('运费专用') && !item.product.includes('运费')) {
                        console.log(`计算预购产品: ${item.product} x ${item.quantity}`);
                        totalPresaleBoxes += item.quantity || 0;
                        // 计算销售额：数量 × 单价
                        totalPresaleRevenue += (item.quantity || 0) * (item.price || 0);
                        
                        // 🎯 优先使用订单项的成本快照（下单时的真实成本）
                        // 如果快照不存在，则从产品表获取当前成本（向后兼容）
                        let costPrice = 0;
                        let shippingCost = 0;
                        
                        if (item.cost_price_snapshot !== null && item.cost_price_snapshot !== undefined) {
                            // 使用快照成本（最准确）
                            costPrice = Number(item.cost_price_snapshot);
                            shippingCost = Number(item.shipping_cost_snapshot || 0);
                        } else if (product) {
                            // 快照不存在，使用产品表的当前成本（兼容旧数据）
                            costPrice = Number(product.cost_price || 0);
                            shippingCost = Number(product.shipping_cost || 0);
                        }
                        
                        const itemTotalCost = (costPrice + shippingCost) * (item.quantity || 0);
                        totalPresaleCost += itemTotalCost;
                    } else if (item.is_unlimited) {
                        // 🎯 修复：使用 item.is_unlimited 判断运费产品
                        console.log(`跳过运费产品: ${item.product}`);
                    }
                });
            });
            
            // 计算团购利润
            totalPresaleProfit = totalPresaleRevenue - totalPresaleCost;
            
            console.log('总预购盒数:', totalPresaleBoxes);
            console.log('总预购销售额:', totalPresaleRevenue);
            console.log('总预购成本:', totalPresaleCost);
            console.log('总预购利润:', totalPresaleProfit);
            
            // 记录当前团的第一单和最后一单订单号
            if (currentGroupOrders.length > 0) {
                firstOrderId = currentGroupOrders[0].order_id;
                lastOrderId = currentGroupOrders[currentGroupOrders.length - 1].order_id;
                console.log('订单范围:', firstOrderId, '→', lastOrderId);
            }
        }
        
        const completedGroups = Math.floor(totalPresaleBoxes / 200);
        const remainingBoxes = 200 - (totalPresaleBoxes % 200);
        
        console.log('完成团数:', completedGroups);
        console.log('剩余盒数:', remainingBoxes === 200 ? 0 : remainingBoxes);
        console.log('=== 预购统计计算完毕 ===');
        
        return { 
            totalBoxes: totalPresaleBoxes, 
            totalRevenue: totalPresaleRevenue, // 新增：返回销售额
            totalCost: totalPresaleCost, // 新增：返回总成本
            totalProfit: totalPresaleProfit, // 新增：返回总利润
            completedGroups, 
            remainingBoxes: remainingBoxes === 200 ? 0 : remainingBoxes,
            firstOrderId,
            lastOrderId,
            orderCount: currentGroupOrders.length
        };
    }, [allOrders, products, groupManagement.lastResetDate, groupManagement.currentGroup, groupManagement.groupHistory.length]);

    // 计算团购订单产品汇总（用于订购清单）
    const productSummary = useMemo((): { [key: string]: { quantity: number; emoji: string; orderCount: number } } => {
        const summary: { [key: string]: { quantity: number; emoji: string; orderCount: number } } = {};
        
        if (allOrders && products) {
            const currentGroupStartTime = new Date(groupManagement.lastResetDate);
            let currentGroupOrders: Order[] = [];
            
            // 筛选当前团的订单（与 presaleStats 逻辑一致）
            if (groupManagement.currentGroup === 1 && groupManagement.groupHistory.length === 0) {
                // 第一团：显示所有历史订单
                currentGroupOrders = allOrders.filter(order => order.status !== 'cancelled');
            } else {
                // 后续团：只显示当前团开始后的订单
                currentGroupOrders = allOrders.filter(order => {
                    const orderTime = new Date(order.created_at);
                    return orderTime >= currentGroupStartTime && order.status !== 'cancelled';
                });
            }
            
            // 汇总每个预购产品的数量
            currentGroupOrders.forEach(order => {
                (order.order_items || []).forEach(item => {
                    const product = products.find(p => p.name === item.product);
                    
                    // 🎯 关键修复：使用订单快照的 is_unlimited
                    // 只统计预购产品（排除现货和运费产品）
                    if (item.is_unlimited && !item.product.includes('运费专用') && !item.product.includes('运费')) {
                        const productName = item.product;
                        
                        if (!summary[productName]) {
                            summary[productName] = {
                                quantity: 0,
                                emoji: item.emoji || (product?.emoji) || '📦',
                                orderCount: 0
                            };
                        }
                        
                        summary[productName].quantity += item.quantity || 0;
                        summary[productName].orderCount += 1;
                    }
                });
            });
        }
        
        return summary;
    }, [allOrders, products, groupManagement.lastResetDate, groupManagement.currentGroup, groupManagement.groupHistory.length]);

    // 计算实际待订购数量（扣除已手动发货的部分）
    const actualOrderNeeds = useMemo(() => {
        const needs: { [key: string]: { 
            totalOrdered: number; 
            manuallyShipped: number; 
            needToOrder: number; 
            emoji: string;
        } } = {};
        
        // 1. 先统计所有订单的数量（从 productSummary）
        (Object.entries(productSummary) as [string, { quantity: number; emoji: string; orderCount: number }][]).forEach(([productName, data]) => {
            needs[productName] = {
                totalOrdered: data.quantity,
                manuallyShipped: 0,
                needToOrder: data.quantity,
                emoji: data.emoji
            };
        });
        
        // 2. 统计已手动发货的数量（从库存流水中）
        // 💡 这里不需要修改，因为流水记录是基于产品ID的，与订单类型无关
        if (transactions) {
            transactions
                .filter(trans => trans.transaction_type === 'manual_order')
                .forEach(trans => {
                    const product = products.find(p => p.id === trans.product_id);
                    if (product) {
                        const productName = product.name;
                        
                        if (needs[productName]) {
                            // 负数转为正数（-10 变成 10）
                            const shippedQty = Math.abs(trans.quantity);
                            needs[productName].manuallyShipped += shippedQty;
                            needs[productName].needToOrder -= shippedQty;
                        }
                    }
                });
        }
        
        return needs;
    }, [productSummary, transactions, products]);

    // 迁移本地数据到 Supabase
    const handleMigrateLocalData = async () => {
        const confirmMessage = `📦 确认要将本地团购数据迁移到云端数据库吗？\n\n此操作将：\n✅ 将 localStorage 中的团购数据同步到 Supabase\n✅ 确保数据在所有设备间同步\n✅ 防止数据丢失\n⚠️ 如果云端已有数据，将会合并处理\n\n💾 迁移后数据将更加安全和可靠`;
        
        if (confirm(confirmMessage)) {
            try {
                const localData = localStorage.getItem('groupManagement');
                if (!localData) {
                    showToast('没有找到本地团购数据', 'warning');
                    return;
                }

                const parsedData = JSON.parse(localData);
                
                // 如果有历史记录，先迁移历史数据
                if (parsedData.groupHistory && parsedData.groupHistory.length > 0) {
                    const { error: historyError } = await supabase
                        .from('group_history')
                        .upsert(parsedData.groupHistory.map((group: any) => ({
                            group_number: group.groupNumber,
                            start_date: group.startDate,
                            end_date: group.endDate,
                            total_boxes: group.totalBoxes,
                            order_count: group.orderCount,
                            first_order_id: group.firstOrderId,
                            last_order_id: group.lastOrderId,
                            completed_groups: group.completedGroups,
                            is_manual_complete: group.isManualComplete
                        })), { onConflict: 'group_number' });

                    if (historyError) {
                        console.error('迁移历史数据失败:', historyError);
                        showToast('迁移历史数据失败: ' + historyError.message, 'danger');
                        return;
                    }
                }

                // 迁移团购管理数据
                const { error: managementError } = await supabase
                    .from('group_management')
                    .upsert({
                        id: 1,
                        current_group: parsedData.currentGroup,
                        last_reset_date: parsedData.lastResetDate,
                        updated_at: new Date().toISOString()
                    });

                if (managementError) {
                    console.error('迁移管理数据失败:', managementError);
                    showToast('迁移管理数据失败: ' + managementError.message, 'danger');
                    return;
                }

                // 重新加载数据
                await loadGroupManagement();
                
                const successMessage = `🎉 数据迁移完成！\n\n📊 迁移结果：\n- 📦 已迁移团购管理信息\n- 📚 已迁移 ${parsedData.groupHistory?.length || 0} 个历史团记录\n- 💾 数据已安全存储到云端数据库\n- 🔄 所有设备现在可以同步数据\n\n💡 现在您可以安全地清除浏览器数据而不用担心丢失团购记录！`;
                
                alert(successMessage);
            } catch (error) {
                console.error('数据迁移时出错:', error);
                showToast('数据迁移失败', 'danger');
            }
        }
    };

    // 组件初始化时加载团购数据
    // 加载库存流水
    const loadTransactions = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('stock_transactions')
                .select('*')
                .eq('transaction_type', 'manual_order')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            setTransactions(data || []);
        } catch (error: any) {
            console.error('加载库存流水失败:', error);
        }
    }, []);

    // 获取库存流水数据（供printOrder函数使用）
    const fetchStockTransactions = useCallback(async () => {
        try {
            console.log('开始加载库存流水数据...');
            const { data, error } = await supabase
                .from('stock_transactions')
                .select(`
                    *,
                    product:product_id(name, emoji)
                `)
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            console.log('加载库存流水数据成功:', data?.length || 0, '条记录');
            setStockTransactions(data || []);
            
            // 🔍 调试: 将数据暴露到 window 对象供浏览器控制台访问
            (window as any).stockTransactions = data || [];
            console.log('✅ 已将 stockTransactions 暴露到 window 对象');
        } catch (error: any) {
            console.error('获取库存流水失败:', error);
        }
    }, []);

    useEffect(() => {
        loadGroupManagement();
        loadTransactions();
        // 初始化时就加载库存流水数据
        console.log('组件初始化，加载库存流水数据...');
        fetchStockTransactions();
    }, [loadGroupManagement, loadTransactions, fetchStockTransactions]);

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">仪表盘</h2>
            <div className="bg-gradient-to-r from-pink-500 to-rose-500 rounded-lg shadow-lg text-white p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xl font-bold">第{groupManagement.currentGroup}团预购统计 (每200盒成团)</h3>
                        <div className="flex gap-2">
                            <button 
                                onClick={handleGroupComplete}
                                className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                            >
                                🏁 截止本团
                            </button>
                            {groupManagement.groupHistory.length > 0 && (
                                <button 
                                    onClick={handleFixHistoryData}
                                    className="bg-yellow-500/20 hover:bg-yellow-500/30 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                                >
                                    🔧 修复历史数据
                                </button>
                            )}
                            <button 
                                onClick={handleMigrateLocalData}
                                className="bg-blue-500/20 hover:bg-blue-500/30 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                            >
                                📦 迁移本地数据
                            </button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                        <div className="bg-white/10 rounded-lg p-4">
                            <p className="text-sm opacity-90">已成团数</p>
                            <p className="text-2xl font-bold">{presaleStats.completedGroups}团</p>
                        </div>
                        <div className="bg-white/10 rounded-lg p-4">
                            <p className="text-sm opacity-90">总售出数量</p>
                            <p className="text-2xl font-bold">{presaleStats.totalBoxes}盒</p>
                            <p className="text-xs opacity-75">不含运费产品</p>
                        </div>
                        <div className="bg-white/10 rounded-lg p-4">
                            <p className="text-sm opacity-90">本团销售额</p>
                            <p className="text-2xl font-bold">RM{presaleStats.totalRevenue.toFixed(2)}</p>
                            <p className="text-xs opacity-75">预购产品销售额</p>
                        </div>
                        <div className="bg-white/10 rounded-lg p-4">
                            <p className="text-sm opacity-90">本团成本</p>
                            <p className="text-2xl font-bold">RM{presaleStats.totalCost.toFixed(2)}</p>
                            <p className="text-xs opacity-75">订货价+运输成本</p>
                        </div>
                        <div className={`bg-white/10 rounded-lg p-4 border-2 ${presaleStats.totalProfit >= 0 ? 'border-green-300' : 'border-red-300'}`}>
                            <p className="text-sm opacity-90">本团盈亏</p>
                            <p className={`text-2xl font-bold ${presaleStats.totalProfit >= 0 ? 'text-green-200' : 'text-red-200'}`}>
                                {presaleStats.totalProfit >= 0 ? '+' : ''}RM{presaleStats.totalProfit.toFixed(2)}
                            </p>
                            <p className="text-xs opacity-75">
                                利润率: {presaleStats.totalRevenue > 0 ? ((presaleStats.totalProfit / presaleStats.totalRevenue) * 100).toFixed(1) : '0'}%
                            </p>
                        </div>
                    </div>
                    
                    {/* 下一团还需 - 单独一行 */}
                    <div className="mt-4">
                        <div className="bg-white/10 rounded-lg p-4 text-center">
                            <p className="text-sm opacity-90">下一团还需</p>
                            <p className="text-3xl font-bold">{presaleStats.remainingBoxes}盒</p>
                        </div>
                    </div>
                    
                    {/* 团购历史记录 */}
                    <div className="mt-4 pt-4 border-t border-white/20">
                        <h4 className="text-sm font-semibold mb-2">📚 历史团购记录 (共{groupManagement.groupHistory.length}团)</h4>
                        
                        {groupManagement.groupHistory.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                                {groupManagement.groupHistory.slice(-6).reverse().map((group, index) => (
                                    <div key={index} className="bg-white/10 rounded p-3 border border-white/20">
                                        <div className="font-medium text-yellow-100 mb-2">
                                            🏆 第{group.groupNumber}团 {group.isManualComplete ? '(手动截团)' : '(自动完成)'}
                                        </div>
                                        <div className="opacity-75 mb-2">
                                            📅 {new Date(group.startDate).toLocaleDateString()} - {new Date(group.endDate).toLocaleDateString()}
                                        </div>
                                        <div className="text-yellow-200 font-semibold mb-1">
                                            📦 总计：{group.totalBoxes}盒
                                        </div>
                                        <div className="text-green-200 text-xs mb-1">
                                            ✅ 完成团数：{group.completedGroups}团
                                        </div>
                                        <div className="text-blue-200 text-xs mb-1">
                                            📋 订单数：{group.orderCount || 0}单
                                        </div>
                                        {group.firstOrderId && (
                                            <div className="text-cyan-200 text-xs">
                                                🎯 订单范围：{group.firstOrderId} → {group.lastOrderId}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="bg-white/5 rounded p-3 text-xs opacity-75">
                                <p>🔍 还没有截止的团购记录</p>
                                <p>点击上方"🏁 截止本团"按钮来完成当前团并开始新一团</p>
                            </div>
                        )}
                        
                        {groupManagement.groupHistory.length > 6 && (
                            <p className="text-xs opacity-75 mt-2">📋 显示最近6团记录，总共{groupManagement.groupHistory.length}团历史</p>
                        )}
                    </div>
                    
                    <div className="mt-4 text-xs opacity-75">
                        <p>💡 本团开始时间: {new Date(groupManagement.lastResetDate).toLocaleString()}</p>
                        <p>📋 当前团订单数: {presaleStats.orderCount}单</p>
                        {presaleStats.firstOrderId && (
                            <p>🎯 订单范围: {presaleStats.firstOrderId} → {presaleStats.lastOrderId}</p>
                        )}
                        <p>⚠️ 运费专用产品不计入预购统计</p>
                    </div>
                </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-lg shadow"><h3 className="text-sm font-medium text-gray-500">今日销售额</h3><p className="text-2xl font-bold text-green-600">RM{stats.todaySales.toFixed(2)}</p></div>
                <div className="bg-white p-6 rounded-lg shadow"><h3 className="text-sm font-medium text-gray-500">本月销售额</h3><p className="text-2xl font-bold text-blue-600">RM{stats.monthSales.toFixed(2)}</p></div>
                <div className="bg-white p-6 rounded-lg shadow"><h3 className="text-sm font-medium text-gray-500">今日订单</h3><p className="text-2xl font-bold text-purple-600">{stats.todayOrders}</p></div>
                <div className="bg-white p-6 rounded-lg shadow"><h3 className="text-sm font-medium text-gray-500">待处理订单</h3><p className="text-2xl font-bold text-orange-600">{stats.pendingOrders}</p></div>
            </div>
            
            {/* 总盈亏统计 - 与当前团购同步 */}
            <div className="bg-gradient-to-r from-indigo-500 to-purple-500 rounded-lg shadow-lg text-white p-6">
                <h3 className="text-xl font-bold mb-4">📊 总盈亏统计（从第{groupManagement.currentGroup}团开始）</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white/10 rounded-lg p-4">
                        <h3 className="text-sm opacity-90">当前团订单数</h3>
                        <p className="text-2xl font-bold">{presaleStats.orderCount}单</p>
                        <p className="text-xs opacity-75">第{groupManagement.currentGroup}团</p>
                    </div>
                    <div className="bg-white/10 rounded-lg p-4">
                        <h3 className="text-sm opacity-90">总销售额</h3>
                        <p className="text-2xl font-bold">RM{presaleStats.totalRevenue.toFixed(2)}</p>
                        <p className="text-xs opacity-75">当前团累计</p>
                    </div>
                    <div className="bg-white/10 rounded-lg p-4">
                        <h3 className="text-sm opacity-90">总成本</h3>
                        <p className="text-2xl font-bold">RM{presaleStats.totalCost.toFixed(2)}</p>
                        <p className="text-xs opacity-75">真实成本快照</p>
                    </div>
                    <div className={`bg-white/10 rounded-lg p-4 border-2 ${presaleStats.totalProfit >= 0 ? 'border-green-300' : 'border-red-300'}`}>
                        <h3 className="text-sm opacity-90">总盈亏</h3>
                        <p className={`text-2xl font-bold ${presaleStats.totalProfit >= 0 ? 'text-green-200' : 'text-red-200'}`}>
                            {presaleStats.totalProfit >= 0 ? '+' : ''}RM{presaleStats.totalProfit.toFixed(2)}
                        </p>
                        <p className="text-xs opacity-75">
                            利润率: {presaleStats.totalRevenue > 0 ? ((presaleStats.totalProfit / presaleStats.totalRevenue) * 100).toFixed(1) : '0.0'}%
                        </p>
                    </div>
                </div>
                <div className="mt-4 text-xs opacity-75 space-y-1">
                    <p>💡 <b>盈亏统计说明：</b></p>
                    <p>• ✅ <b>从第{groupManagement.currentGroup}团开始计算盈亏</b>（{presaleStats.orderCount}单订单）</p>
                    <p>• 📊 销量统计：{presaleStats.totalBoxes}盒（当前团预购产品）</p>
                    <p>• 🎯 所有订单都自动记录成本快照，数据100%准确</p>
                    <p>• 🚀 后续新订单会自动累加到盈亏统计中</p>
                    <p>• � 利润率 = (销售额 - 成本) / 销售额</p>
                    <p className="pt-2 border-t border-white/20">
                        📦 历史总销量：{stats.totalBoxesSold.toLocaleString()}盒（所有订单累计，不含运费产品）
                    </p>
                </div>
            </div>
            
            {/* 团购订单产品汇总 */}
            {/* 原始订单汇总 */}
            <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold mb-4 flex items-center justify-between">
                    <span>� 团购订单产品汇总（第{groupManagement.currentGroup}团 - 所有订单）</span>
                    <button 
                        onClick={() => {
                            type SummaryData = { quantity: number; emoji: string; orderCount: number };
                            const summaryText = (Object.entries(productSummary) as [string, SummaryData][])
                                .sort(([, a], [, b]) => b.quantity - a.quantity)
                                .map(([productName, data]) => `${data.emoji} ${productName}: ${data.quantity}份`)
                                .join('\n');
                            copyTextUniversal(`🛒 第${groupManagement.currentGroup}团订购清单（所有订单）\n\n${summaryText}\n\n📊 总计: ${(Object.values(productSummary) as SummaryData[]).reduce((sum, p) => sum + p.quantity, 0)}份\n📋 订单数: ${presaleStats.orderCount}单`);
                            showToast('订购清单已复制！', 'success');
                        }}
                        className="text-sm px-3 py-1 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                    >
                        <i className="fas fa-copy mr-1"></i>复制清单
                    </button>
                </h3>
                <div className="space-y-3">
                    {Object.keys(productSummary).length > 0 ? (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {((Object.entries(productSummary) as [string, { quantity: number; emoji: string; orderCount: number }][])
                                    .sort(([, a], [, b]) => b.quantity - a.quantity) // 按数量降序排列
                                    .map(([productName, data]) => (
                                        <div key={productName} className="flex items-center justify-between p-3 bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg border border-blue-200">
                                            <div className="flex items-center gap-2">
                                                <span className="text-2xl">{data.emoji}</span>
                                                <div>
                                                    <p className="font-semibold text-gray-800">{productName}</p>
                                                    <p className="text-xs text-gray-500">{data.orderCount}个订单</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-2xl font-bold text-blue-600">{data.quantity}</p>
                                                <p className="text-xs text-gray-500">份</p>
                                            </div>
                                        </div>
                                    )))}
                            </div>
                            <div className="mt-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border-l-4 border-green-500">
                                <div className="flex justify-between items-center">
                                    <div>
                                        <p className="text-sm text-gray-600">总订购数量</p>
                                        <p className="text-3xl font-bold text-green-600">
                                            {(Object.values(productSummary) as { quantity: number; emoji: string; orderCount: number }[]).reduce((sum, p) => sum + p.quantity, 0)} 份
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm text-gray-600">产品种类</p>
                                        <p className="text-3xl font-bold text-blue-600">
                                            {Object.keys(productSummary).length} 种
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm text-gray-600">订单总数</p>
                                        <p className="text-3xl font-bold text-purple-600">
                                            {presaleStats.orderCount} 单
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="text-xs text-gray-500 mt-2">
                                <p>💡 <b>说明：</b>此汇总显示所有订单的原始数量（包括已提前发货的）</p>
                                <p>📅 统计范围：第{groupManagement.currentGroup}团所有待处理订单</p>
                            </div>
                        </>
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            <i className="fas fa-inbox text-4xl mb-2"></i>
                            <p>当前团还没有预购订单</p>
                        </div>
                    )}
                </div>
            </div>

            {/* 实际待订购数量（扣除已发货） */}
            <div className="bg-gradient-to-r from-orange-50 to-red-50 p-6 rounded-lg shadow-lg border-2 border-orange-200">
                <h3 className="text-lg font-semibold mb-4 flex items-center justify-between">
                    <span className="flex items-center gap-2">
                        <i className="fas fa-shipping-fast text-orange-600"></i>
                        <span>🎯 实际待订购数量（第{groupManagement.currentGroup}团 - 扣除已发货）</span>
                    </span>
                    <button 
                        onClick={() => {
                            type OrderNeedData = { totalOrdered: number; manuallyShipped: number; needToOrder: number; emoji: string };
                            const needsText = (Object.entries(actualOrderNeeds) as [string, OrderNeedData][])
                                .filter(([, data]) => data.needToOrder > 0)
                                .sort(([, a], [, b]) => b.needToOrder - a.needToOrder)
                                .map(([productName, data]) => 
                                    `${data.emoji} ${productName}: ${data.needToOrder}份 (订${data.totalOrdered} - 发${data.manuallyShipped})`
                                )
                                .join('\n');
                            
                            const totalNeed = (Object.values(actualOrderNeeds) as OrderNeedData[]).reduce((sum, data) => sum + data.needToOrder, 0);
                            const totalShipped = (Object.values(actualOrderNeeds) as OrderNeedData[]).reduce((sum, data) => sum + data.manuallyShipped, 0);
                            
                            copyTextUniversal(`🎯 第${groupManagement.currentGroup}团实际待订购清单\n\n${needsText}\n\n📊 实际需订购: ${totalNeed}份\n✅ 已提前发货: ${totalShipped}份\n📋 订单总数: ${presaleStats.orderCount}单`);
                            showToast('实际订购清单已复制！', 'success');
                        }}
                        className="text-sm px-3 py-1 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
                    >
                        <i className="fas fa-copy mr-1"></i>复制实际清单
                    </button>
                </h3>
                <div className="space-y-3">
                    {Object.keys(actualOrderNeeds).length > 0 ? (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {((Object.entries(actualOrderNeeds) as [string, { totalOrdered: number; manuallyShipped: number; needToOrder: number; emoji: string }][])
                                    .sort(([, a], [, b]) => b.needToOrder - a.needToOrder)
                                    .map(([productName, data]) => (
                                        <div key={productName} className={`flex items-center justify-between p-4 rounded-lg border-2 ${
                                            data.needToOrder === 0 ? 'bg-green-50 border-green-300' : 
                                            data.manuallyShipped > 0 ? 'bg-yellow-50 border-yellow-300' : 
                                            'bg-white border-orange-300'
                                        }`}>
                                            <div className="flex items-center gap-2">
                                                <span className="text-2xl">{data.emoji}</span>
                                                <div>
                                                    <p className="font-semibold text-gray-800">{productName}</p>
                                                    <p className="text-xs text-gray-500">
                                                        订{data.totalOrdered} - 发{data.manuallyShipped} = 待{data.needToOrder}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className={`text-2xl font-bold ${
                                                    data.needToOrder === 0 ? 'text-green-600' : 
                                                    data.manuallyShipped > 0 ? 'text-orange-600' : 
                                                    'text-red-600'
                                                }`}>
                                                    {data.needToOrder}
                                                </p>
                                                <p className="text-xs text-gray-500">
                                                    {data.needToOrder === 0 ? '✅已完成' : '份'}
                                                </p>
                                            </div>
                                        </div>
                                    )))}
                            </div>
                            <div className="mt-4 p-4 bg-gradient-to-r from-orange-100 to-red-100 rounded-lg border-l-4 border-orange-600">
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <p className="text-sm text-gray-700">实际需订购</p>
                                        <p className="text-3xl font-bold text-orange-600">
                                            {(Object.values(actualOrderNeeds) as { totalOrdered: number; manuallyShipped: number; needToOrder: number; emoji: string }[]).reduce((sum, data) => sum + data.needToOrder, 0)} 份
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-700">已提前发货</p>
                                        <p className="text-3xl font-bold text-green-600">
                                            {(Object.values(actualOrderNeeds) as { totalOrdered: number; manuallyShipped: number; needToOrder: number; emoji: string }[]).reduce((sum, data) => sum + data.manuallyShipped, 0)} 份
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-700">完成度</p>
                                        <p className="text-3xl font-bold text-blue-600">
                                            {(() => {
                                                const values = Object.values(actualOrderNeeds) as { totalOrdered: number; manuallyShipped: number; needToOrder: number; emoji: string }[];
                                                const total = values.reduce((sum, data) => sum + data.totalOrdered, 0);
                                                const shipped = values.reduce((sum, data) => sum + data.manuallyShipped, 0);
                                                return total > 0 ? Math.round((shipped / total) * 100) : 0;
                                            })()}%
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="text-xs text-gray-700 mt-2 bg-white p-3 rounded-lg border border-orange-200">
                                <p className="font-semibold mb-1">📊 说明：</p>
                                <ul className="list-disc list-inside space-y-1">
                                    <li><b>实际需订购</b> = 订单总量 - 已提前发货数量</li>
                                    <li><b>已提前发货</b> = 从库存流水中统计的"手动扣库存"数量</li>
                                    <li><span className="text-green-600">●</span> 绿色：已全部提前发货，无需订购</li>
                                    <li><span className="text-yellow-600">●</span> 黄色：部分提前发货，还需订购</li>
                                    <li><span className="text-red-600">●</span> 红色：尚未发货，全部需订购</li>
                                </ul>
                            </div>
                        </>
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            <i className="fas fa-check-circle text-4xl mb-2 text-green-500"></i>
                            <p>当前团还没有预购订单，或所有产品都已发货</p>
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold mb-4">快捷操作</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <button onClick={() => setView('orders')} className="flex flex-col items-center p-4 bg-blue-50 hover:bg-blue-100 rounded-lg"><i className="fas fa-list text-2xl text-blue-600 mb-2"></i><span className="text-sm font-medium">查看订单</span></button>
                    <button onClick={() => setView('products')} className="flex flex-col items-center p-4 bg-green-50 hover:bg-green-100 rounded-lg"><i className="fas fa-pizza-slice text-2xl text-green-600 mb-2"></i><span className="text-sm font-medium">管理商品</span></button>
                    <button onClick={() => setView('inventory')} className="flex flex-col items-center p-4 bg-purple-50 hover:bg-purple-100 rounded-lg"><i className="fas fa-boxes text-2xl text-purple-600 mb-2"></i><span className="text-sm font-medium">库存管理</span></button>
                    <button onClick={() => setView('analytics')} className="flex flex-col items-center p-4 bg-orange-50 hover:bg-orange-100 rounded-lg"><i className="fas fa-chart-pie text-2xl text-orange-600 mb-2"></i><span className="text-sm font-medium">数据分析</span></button>
                </div>
            </div>
        </div>
    );
};

// --- Product Management ---
const AdminProducts: React.FC<{ showToast: Function; products: Product[]; fetchData: () => void; allOrders: Order[]; }> = ({ showToast, products, fetchData, allOrders }) => { 
    const [isModalOpen, setModalOpen] = useState(false);
    const [currentProduct, setCurrentProduct] = useState<Partial<Product> | null>(null);
    const [productImageFile, setProductImageFile] = useState<File | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [showBarcodeModal, setShowBarcodeModal] = useState(false);
    const [selectedProductForBarcode, setSelectedProductForBarcode] = useState<Product | null>(null);
    
    // 🔧 在父组件保存用户添加的 barcode，避免子组件重新渲染时丢失
    const userBarcodeRef = useRef<{[productId: number]: string}>({});

    const handleSave = async (productData: Product) => {
        setIsSaving(true);
        
        try {
            // 准备保存的数据，排除不需要的字段
            const { id, created_at, ...saveData } = {
                ...productData,
                price: Number(productData.price) || 0,
                cost_price: productData.cost_price !== null && productData.cost_price !== undefined 
                    ? Number(productData.cost_price) 
                    : null,
                shipping_cost: productData.shipping_cost !== null && productData.shipping_cost !== undefined 
                    ? Number(productData.shipping_cost) 
                    : null,
                // 🔧 修复库存逻辑：当切换为预购时，保留库存数量而不是清零
                // 这样切换回现货时，库存数量不会丢失
                stock_quantity: productData.is_unlimited ? (
                    // 预购模式：保留原有库存数量（如果有的话），不设为null
                    productData.stock_quantity !== null && productData.stock_quantity !== undefined 
                        ? Number(productData.stock_quantity) 
                        : null
                ) : (
                    // 现货模式：正常处理库存数量
                    productData.stock_quantity !== null && productData.stock_quantity !== undefined 
                        ? Number(productData.stock_quantity) 
                        : 0
                ),
                min_stock_threshold: Number(productData.min_stock_threshold) || 5,
                is_unlimited: Boolean(productData.is_unlimited),
                is_published: Boolean(productData.is_published)
            };

            // 🔍 调试日志：查看实际保存的数据
            console.log('📤 准备保存的数据:', saveData);
            console.log('📦 条形码数据:', {
                barcode: saveData.barcode,
                master_barcode: saveData.master_barcode,
                packs_per_unit: saveData.packs_per_unit
            });

            let result;
            if (productData.id) {
                // 更新现有产品
                console.log('🔄 更新产品 ID:', productData.id);
                result = await supabase
                    .from('products')
                    .update(saveData)
                    .eq('id', productData.id);
            } else {
                // 创建新产品
                console.log('➕ 创建新产品');
                result = await supabase
                    .from('products')
                    .insert([saveData]);
            }
            
            console.log('📥 数据库响应:', result);

            if (result.error) {
                throw result.error;
            }

            showToast(productData.id ? '产品已更新' : '产品已添加', 'success');
            setModalOpen(false);
            setCurrentProduct(null);
            fetchData(); // ✅ Changed from fetchProducts to fetchData
        } catch (error: any) {
            showToast(`保存产品失败: ${error.message}`, 'danger');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (product: Product) => {
        if (!window.confirm(`确定要删除产品 "${product.name}" 吗?`)) return;
        const { error } = await supabase.from('products').delete().eq('id', product.id);
        if (error) showToast(`删除失败: ${error.message}`, 'danger');
        else {
            showToast('产品已删除', 'success');
            fetchData(); // ✅ Changed from fetchProducts to fetchData
        }
    };

    // 筛选产品
    const filteredProducts = products.filter(product => {
        const searchLower = searchTerm.toLowerCase();
        const matchesSearch = !searchTerm || 
            product.name.toLowerCase().includes(searchLower) ||
            (product.category && product.category.toLowerCase().includes(searchLower)) ||
            (product.barcode && product.barcode.toLowerCase().includes(searchLower)) ||
            (product.description && product.description.toLowerCase().includes(searchLower));
        const matchesCategory = categoryFilter === 'all' || product.category === categoryFilter;
        return matchesSearch && matchesCategory;
    });

    // 获取所有分类
    const categories = [...new Set(products.map(p => p.category).filter(Boolean))];

    // 计算产品盈亏统计
    const profitStats = useMemo(() => {
        let totalProducts = 0;
        let productsWithCost = 0;
        let profitableProducts = 0;
        let losingProducts = 0;
        let totalPotentialProfit = 0;
        let averageMargin = 0;
        
        filteredProducts.forEach(product => {
            totalProducts++;
            const sellingPrice = Number(product.price || 0);
            const costPrice = Number(product.cost_price || 0);
            const shippingCost = Number(product.shipping_cost || 0);
            const totalCost = costPrice + shippingCost;
            
            if (totalCost > 0) {
                productsWithCost++;
                const profit = sellingPrice - totalCost;
                const margin = sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0;
                
                totalPotentialProfit += profit;
                averageMargin += margin;
                
                if (profit > 0) {
                    profitableProducts++;
                } else if (profit < 0) {
                    losingProducts++;
                }
            }
        });
        
        averageMargin = productsWithCost > 0 ? averageMargin / productsWithCost : 0;
        
        return {
            totalProducts,
            productsWithCost,
            productsWithoutCost: totalProducts - productsWithCost,
            profitableProducts,
            losingProducts,
            breakEvenProducts: productsWithCost - profitableProducts - losingProducts,
            totalPotentialProfit,
            averageMargin
        };
    }, [filteredProducts]);

    // 切换产品上架状态
    const toggleProductStatus = async (productId: number, currentStatus: boolean) => {
        const { error } = await supabase
            .from('products')
            .update({ is_published: !currentStatus })
            .eq('id', productId);
        
        if (error) {
            showToast(`状态更新失败: ${error.message}`, 'danger');
        } else {
            showToast(`产品已${!currentStatus ? '上架' : '下架'}`, 'success');
            fetchData();
        }
    };

    // 切换产品类型（现货/预购）
    const toggleProductType = async (productId: number, currentIsUnlimited: boolean) => {
        const { error } = await supabase
            .from('products')
            .update({ is_unlimited: !currentIsUnlimited })
            .eq('id', productId);
        
        if (error) {
            showToast(`类型切换失败: ${error.message}`, 'danger');
        } else {
            showToast(`产品已切换为${!currentIsUnlimited ? '预购' : '现货'}`, 'success');
            fetchData();
        }
    };

    // 生成产品条形码
    const generateBarcode = (product: Product) => {
        setSelectedProductForBarcode(product);
        setShowBarcodeModal(true);
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow animate-fade-in">
            <div className="flex flex-wrap gap-4 items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-800">
                    <i className="fas fa-pizza-slice mr-2 text-red-600"></i>
                    产品管理 ({filteredProducts.length}/{products.length})
                </h2>
                <div className="flex flex-wrap gap-2">
                    {/* 批量操作按钮 */}
                    <button 
                        onClick={async () => {
                            if (confirm('确认要批量上架所有产品吗？')) {
                                try {
                                    const { error } = await supabase
                                        .from('products')
                                        .update({ is_published: true })
                                        .neq('id', 0);
                                    if (error) throw error;
                                    showToast('所有产品已批量上架', 'success');
                                    fetchData();
                                } catch (error: any) {
                                    showToast(`批量上架失败: ${error.message}`, 'danger');
                                }
                            }
                        }}
                        className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-4 py-2 rounded-lg font-medium shadow hover:shadow-lg transition-all duration-200 text-sm">
                        <i className="fas fa-eye mr-1"></i>批量上架
                    </button>
                    <button 
                        onClick={async () => {
                            if (confirm('确认要批量下架所有产品吗？')) {
                                try {
                                    const { error } = await supabase
                                        .from('products')
                                        .update({ is_published: false })
                                        .neq('id', 0);
                                    if (error) throw error;
                                    showToast('所有产品已批量下架', 'success');
                                    fetchData();
                                } catch (error: any) {
                                    showToast(`批量下架失败: ${error.message}`, 'danger');
                                }
                            }
                        }}
                        className="bg-gradient-to-r from-gray-500 to-gray-600 text-white px-4 py-2 rounded-lg font-medium shadow hover:shadow-lg transition-all duration-200 text-sm">
                        <i className="fas fa-eye-slash mr-1"></i>批量下架
                    </button>
                    <button 
                        onClick={async () => {
                            if (confirm('确认要将所有产品批量设置为现货吗？')) {
                                try {
                                    const { error } = await supabase
                                        .from('products')
                                        .update({ is_unlimited: false })
                                        .neq('id', 0);
                                    if (error) throw error;
                                    showToast('所有产品已批量设置为现货', 'success');
                                    fetchData();
                                } catch (error: any) {
                                    showToast(`批量设置失败: ${error.message}`, 'danger');
                                }
                            }
                        }}
                        className="bg-gradient-to-r from-green-500 to-green-600 text-white px-4 py-2 rounded-lg font-medium shadow hover:shadow-lg transition-all duration-200 text-sm">
                        <i className="fas fa-box mr-1"></i>批量现货
                    </button>
                    <button 
                        onClick={async () => {
                            if (confirm('确认要将所有产品批量设置为预购吗？')) {
                                try {
                                    const { error } = await supabase
                                        .from('products')
                                        .update({ is_unlimited: true })
                                        .neq('id', 0);
                                    if (error) throw error;
                                    showToast('所有产品已批量设置为预购', 'success');
                                    fetchData();
                                } catch (error: any) {
                                    showToast(`批量设置失败: ${error.message}`, 'danger');
                                }
                            }
                        }}
                        className="bg-gradient-to-r from-purple-500 to-purple-600 text-white px-4 py-2 rounded-lg font-medium shadow hover:shadow-lg transition-all duration-200 text-sm">
                        <i className="fas fa-clock mr-1"></i>批量预购
                    </button>
                    <button 
                        onClick={() => { 
                            setCurrentProduct({ 
                                is_published: false, 
                                is_unlimited: false,
                                category: '',
                                emoji: '🍽️',
                                min_stock_threshold: 5
                            }); 
                            setProductImageFile(null); 
                            setModalOpen(true); 
                        }} 
                        className="bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-2 rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105">
                        <i className="fas fa-plus mr-2"></i>添加产品
                    </button>
                </div>
            </div>

            {/* 产品盈亏统计概览 */}
            <div className="bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg shadow-lg text-white p-6 mb-6">
                <h3 className="text-lg font-bold mb-4">
                    <i className="fas fa-chart-line mr-2"></i>
                    产品盈亏分析概览
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    <div className="bg-white/10 rounded-lg p-3">
                        <p className="text-xs opacity-90">总产品数</p>
                        <p className="text-2xl font-bold">{profitStats.totalProducts}</p>
                    </div>
                    <div className="bg-white/10 rounded-lg p-3">
                        <p className="text-xs opacity-90">已设置成本</p>
                        <p className="text-2xl font-bold">{profitStats.productsWithCost}</p>
                        <p className="text-xs opacity-75">{profitStats.productsWithoutCost}个未设置</p>
                    </div>
                    <div className="bg-white/10 rounded-lg p-3 border-2 border-green-300">
                        <p className="text-xs opacity-90">盈利产品</p>
                        <p className="text-2xl font-bold text-green-200">{profitStats.profitableProducts}</p>
                        <p className="text-xs opacity-75">✅ 赚钱中</p>
                    </div>
                    <div className="bg-white/10 rounded-lg p-3 border-2 border-red-300">
                        <p className="text-xs opacity-90">亏损产品</p>
                        <p className="text-2xl font-bold text-red-200">{profitStats.losingProducts}</p>
                        <p className="text-xs opacity-75">⚠️ 需优化</p>
                    </div>
                    <div className="bg-white/10 rounded-lg p-3">
                        <p className="text-xs opacity-90">平均利润率</p>
                        <p className={`text-2xl font-bold ${profitStats.averageMargin >= 0 ? 'text-green-200' : 'text-red-200'}`}>
                            {profitStats.averageMargin.toFixed(1)}%
                        </p>
                        <p className="text-xs opacity-75">所有产品</p>
                    </div>
                    <div className="bg-white/10 rounded-lg p-3 border-2 border-yellow-300">
                        <p className="text-xs opacity-90">潜在利润</p>
                        <p className={`text-xl font-bold ${profitStats.totalPotentialProfit >= 0 ? 'text-green-200' : 'text-red-200'}`}>
                            {profitStats.totalPotentialProfit >= 0 ? '+' : ''}RM{profitStats.totalPotentialProfit.toFixed(2)}
                        </p>
                        <p className="text-xs opacity-75">单件利润和</p>
                    </div>
                </div>
                <div className="mt-3 text-xs opacity-75">
                    <p>💡 盈亏分析说明：</p>
                    <p>• 潜在利润 = 各产品单件利润之和（售价 - 成本 - 运输）</p>
                    <p>• 实际盈利需结合销量数据，请查看仪表盘的总盈亏统计</p>
                    <p>• 建议优化亏损产品的定价或降低成本</p>
                </div>
            </div>

            {/* 搜索和筛选 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="relative">
                    <i className="fas fa-search absolute left-3 top-3 text-gray-400"></i>
                    <input
                        type="text"
                        placeholder="搜索产品名称、分类、条形码..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    />
                </div>
                <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500">
                    <option value="all">全部分类</option>
                    {categories.map(category => (
                        <option key={category} value={category}>{category}</option>
                    ))}
                </select>
                <div className="text-sm text-gray-600 flex items-center">
                    <i className="fas fa-info-circle mr-2"></i>
                    显示 {filteredProducts.length} 个产品
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm enhanced-table">
                    <thead>
                        <tr className="bg-gradient-to-r from-gray-50 to-gray-100">
                            <th className="p-3 text-left font-bold">产品信息 & 价格</th>
                            <th className="p-3 text-left font-bold">成本 & 盈亏</th>
                            <th className="p-3 text-left font-bold">库存信息</th>
                            <th className="p-3 text-left font-bold">类型</th>
                            <th className="p-3 text-left font-bold">分类</th>
                            <th className="p-3 text-left font-bold">状态</th>
                            <th className="p-3 text-left font-bold">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredProducts.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="p-8 text-center text-gray-500">
                                    <i className="fas fa-box-open text-4xl mb-2 text-gray-300"></i>
                                    <p>没有找到匹配的产品</p>
                                </td>
                            </tr>
                        ) : (
                            filteredProducts.map(product => {
                                // 计算盈亏
                                const sellingPrice = Number(product.price || 0);
                                const costPrice = Number(product.cost_price || 0);
                                const shippingCost = Number(product.shipping_cost || 0);
                                const totalCost = costPrice + shippingCost;
                                const profit = sellingPrice - totalCost;
                                const profitMargin = sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0;
                                const hasCostData = costPrice > 0 || shippingCost > 0;
                                
                                // 计算预计剩余库存（扣除所有已录入订单）
                                const currentStock = product.stock_quantity || 0;
                                let orderedQuantity = 0;
                                
                                // 计算所有待处理订单中该产品的总需求量
                                if (!product.is_unlimited) { // 只对现货商品计算
                                    allOrders.filter(order => 
                                        order.status === 'pending' || order.status === 'ready for pick up'
                                    ).forEach(order => {
                                        order.order_items?.forEach(item => {
                                            if (item.product === product.name) {
                                                orderedQuantity += item.quantity;
                                            }
                                        });
                                    });
                                }
                                
                                const estimatedRemainingStock = Math.max(0, currentStock - orderedQuantity);
                                
                                return (
                                <tr key={product.id} className="border-b hover:bg-gray-50 transition-colors">
                                    <td className="p-3 w-48">
                                        <div className="flex flex-col items-start">
                                            {/* 产品照片 */}
                                            <div className="w-14 h-14 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 mb-2">
                                                {product.image_url ? (
                                                    <img 
                                                        src={product.image_url.startsWith('http') ? product.image_url : `https://edfnhhthztskuuosuasw.supabase.co/storage/v1/object/public/product-photos/${encodeURIComponent(product.image_url)}`}
                                                        alt={product.name}
                                                        className="w-full h-full object-cover"
                                                        onError={(e) => {
                                                            e.currentTarget.style.display = 'none';
                                                            e.currentTarget.nextElementSibling.style.display = 'flex';
                                                        }}
                                                    />
                                                ) : null}
                                                <div className={`w-full h-full flex items-center justify-center text-xl ${product.image_url ? 'hidden' : ''}`}>
                                                    {product.emoji || '🍽️'}
                                                </div>
                                            </div>
                                            
                                            {/* 产品名称和ID */}
                                            <div className="mb-2 w-full">
                                                <h3 className="font-bold text-sm text-gray-800 mb-1 line-clamp-2">{product.name}</h3>
                                                <p className="text-xs text-gray-500">ID: {product.id}</p>
                                                {!product.image_url && (
                                                    <p className="text-xs text-orange-500 mt-1">
                                                        <i className="fas fa-exclamation-triangle mr-1"></i>未上传照片
                                                    </p>
                                                )}
                                            </div>
                                            
                                            {/* 价格信息 */}
                                            <div className="bg-green-50 border border-green-300 px-2 py-1 rounded w-full">
                                                <div className="text-xs text-green-700 font-medium mb-1">售价</div>
                                                <div className="font-bold text-base text-green-600">RM{(product.price || 0).toFixed(2)}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-3">
                                        {hasCostData ? (
                                            <div className="space-y-3">
                                                {/* 成本信息 - 水平布局 */}
                                                <div className="grid grid-cols-2 gap-3 text-sm">
                                                    <div className="bg-blue-50 p-2 rounded">
                                                        <div className="text-xs text-blue-600 mb-1">订货价</div>
                                                        <div className="font-bold text-blue-800">RM{costPrice.toFixed(2)}</div>
                                                    </div>
                                                    <div className="bg-orange-50 p-2 rounded">
                                                        <div className="text-xs text-orange-600 mb-1">运输费</div>
                                                        <div className="font-bold text-orange-800">RM{shippingCost.toFixed(2)}</div>
                                                    </div>
                                                </div>
                                                
                                                {/* 成本和盈亏 - 水平布局 */}
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="bg-gray-50 p-2 rounded">
                                                        <div className="text-xs text-gray-600 mb-1">总成本</div>
                                                        <div className="font-bold text-gray-800">RM{totalCost.toFixed(2)}</div>
                                                    </div>
                                                    <div className={`p-2 rounded ${profit >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                                                        <div className={`text-xs mb-1 ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>盈亏</div>
                                                        <div className={`font-bold ${profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                                            {profit >= 0 ? '+' : ''}RM{profit.toFixed(2)}
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                {/* 利润率 */}
                                                <div className="text-center">
                                                    <span className={`text-sm font-medium ${profitMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                        利润率: {profitMargin.toFixed(1)}%
                                                        {profit >= 0 ? ' ✅' : ' ⚠️'}
                                                    </span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="p-3 rounded bg-gray-50 border border-gray-200 text-center">
                                                <div className="text-sm text-gray-400">
                                                    <i className="fas fa-calculator mb-1"></i>
                                                    <div>未设置成本</div>
                                                    <div className="text-xs">无法计算盈亏</div>
                                                </div>
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-3">
                                        {product.is_unlimited ? (
                                            <span className="px-3 py-2 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                                                <i className="fas fa-infinity mr-1"></i>预购商品
                                            </span>
                                        ) : (
                                            <div className="space-y-3">
                                                {/* 当前库存 - 保持大字体 */}
                                                <div className="text-center">
                                                    <div className="text-sm text-gray-600 mb-1">当前库存</div>
                                                    <div className={`font-bold text-2xl ${
                                                        (product.stock_quantity || 0) === 0 ? 'text-red-600' :
                                                        (product.stock_quantity || 0) <= (product.min_stock_threshold || 5) ? 'text-yellow-600' :
                                                        'text-green-600'
                                                    }`}>
                                                        {product.stock_quantity || 0} 件
                                                    </div>
                                                    {(product.stock_quantity || 0) <= (product.min_stock_threshold || 5) && (product.stock_quantity || 0) > 0 && (
                                                        <i className="fas fa-exclamation-triangle text-yellow-500" title="库存紧张"></i>
                                                    )}
                                                </div>
                                                
                                                {/* 预计剩余库存 */}
                                                <div className={`p-2 rounded border ${
                                                    estimatedRemainingStock === 0 ? 'bg-red-50 border-red-300' :
                                                    estimatedRemainingStock <= (product.min_stock_threshold || 5) ? 'bg-yellow-50 border-yellow-300' :
                                                    'bg-green-50 border-green-300'
                                                }`}>
                                                    <div className="text-center">
                                                        <div className="text-xs text-gray-600 mb-1">预计剩余</div>
                                                        <div className={`font-bold text-lg ${
                                                            estimatedRemainingStock === 0 ? 'text-red-600' :
                                                            estimatedRemainingStock <= (product.min_stock_threshold || 5) ? 'text-yellow-600' :
                                                            'text-green-600'
                                                        }`}>
                                                            {estimatedRemainingStock} 件
                                                        </div>
                                                    </div>
                                                    <div className="text-xs text-gray-600 mt-1 text-center">
                                                        现有{currentStock} - 已订{orderedQuantity}
                                                    </div>
                                                    {estimatedRemainingStock <= (product.min_stock_threshold || 5) && estimatedRemainingStock > 0 && (
                                                        <div className="text-xs text-yellow-700 font-medium mt-1 text-center">
                                                            ⚠️ 预计库存紧张
                                                        </div>
                                                    )}
                                                    {estimatedRemainingStock === 0 && (
                                                        <div className="text-xs text-red-700 font-medium mt-1 text-center">
                                                            ❌ 预计库存不足
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-3">
                                        <div className="flex items-center gap-2">
                                            {/* 快速切换现货/预购 */}
                                            <button
                                                onClick={() => toggleProductType(product.id, product.is_unlimited)}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
                                                    product.is_unlimited 
                                                        ? 'bg-purple-500 hover:bg-purple-600' 
                                                        : 'bg-green-500 hover:bg-green-600'
                                                }`}
                                                title={product.is_unlimited ? '点击切换为现货' : '点击切换为预购'}>
                                                <span
                                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                                        product.is_unlimited ? 'translate-x-6' : 'translate-x-1'
                                                    }`}
                                                />
                                            </button>
                                            {/* 类型文字 */}
                                            <span className={`text-xs font-medium ${
                                                product.is_unlimited ? 'text-purple-700' : 'text-green-700'
                                            }`}>
                                                {product.is_unlimited ? '预购' : '现货'}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="p-3">
                                        <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                                            {product.category || '未分类'}
                                        </span>
                                    </td>
                                    <td className="p-3">
                                        <div className="flex items-center gap-2">
                                            {/* 快速开关 */}
                                            <button
                                                onClick={() => toggleProductStatus(product.id, product.is_published)}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                                                    product.is_published 
                                                        ? 'bg-green-500 hover:bg-green-600' 
                                                        : 'bg-gray-300 hover:bg-gray-400'
                                                }`}
                                                title={product.is_published ? '点击下架' : '点击上架'}>
                                                <span
                                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                                        product.is_published ? 'translate-x-6' : 'translate-x-1'
                                                    }`}
                                                />
                                            </button>
                                            {/* 状态文字 */}
                                            <span className={`text-xs font-medium ${
                                                product.is_published ? 'text-green-700' : 'text-gray-600'
                                            }`}>
                                                {product.is_published ? '已上架' : '已下架'}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="p-3">
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => generateBarcode(product)}
                                                className="text-purple-600 hover:text-purple-800 transition-colors"
                                                title="生成条形码">
                                                <i className="fas fa-barcode"></i>
                                            </button>
                                            <button
                                                onClick={() => { 
                                                    setCurrentProduct(product); 
                                                    setProductImageFile(null); 
                                                    setModalOpen(true); 
                                                }}
                                                className="text-blue-600 hover:text-blue-800 transition-colors"
                                                title="编辑">
                                                <i className="fas fa-edit"></i>
                                            </button>
                                            <button
                                                onClick={() => handleDelete(product)}
                                                className="text-red-600 hover:text-red-800 transition-colors"
                                                title="删除">
                                                <i className="fas fa-trash"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* 产品编辑模态框 */}
            <ProductEditModal 
                isOpen={isModalOpen}
                product={currentProduct}
                onSave={handleSave}
                onClose={() => setModalOpen(false)}
                showToast={showToast}
                userBarcodeRef={userBarcodeRef}
            />

            {/* 条形码生成模态框 */}
            <BarcodeModal 
                isOpen={showBarcodeModal}
                product={selectedProductForBarcode}
                onClose={() => {
                    setShowBarcodeModal(false);
                    setSelectedProductForBarcode(null);
                }}
            />
        </div>
    );
};

// --- Order Management ---
const AdminOrders: React.FC<{ showToast: Function; orders: Order[]; fetchOrders: () => void; products: Product[]; }> = ({ showToast, orders, fetchOrders, products }) => {
    const [updating, setUpdating] = useState<number | null>(null);
    const [uploadModal, setUploadModal] = useState<Order | null>(null);
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [filterStatus, setFilterStatus] = useState('');
    const [filterDelivery, setFilterDelivery] = useState('');
    const [searchText, setSearchText] = useState('');
    const [groupByCustomer, setGroupByCustomer] = useState(false); // 按顾客分组显示
    const [manuallyDeductedOrders, setManuallyDeductedOrders] = useState<Set<string>>(new Set()); // 已手动扣库存的订单
    const [directPackingOrder, setDirectPackingOrder] = useState<Order | null>(null); // 直接打包的订单
    const [showDirectPacking, setShowDirectPacking] = useState(false); // 显示直接打包界面
    const [showPartialDeliveryModal, setShowPartialDeliveryModal] = useState(false); // 部分发货模态框
    const [partialDeliveryOrder, setPartialDeliveryOrder] = useState<Order | null>(null); // 部分发货的订单
    const [partialDeliveryData, setPartialDeliveryData] = useState<{[key: string]: number}>({}); // 部分发货数据
    const [isPartialDeliveryLoading, setIsPartialDeliveryLoading] = useState(false); // 部分发货加载状态
    
    // 库存流水回滚状态
    const [stockTransactions, setStockTransactions] = useState<any[]>([]);
    const [showTransactionModal, setShowTransactionModal] = useState(false);
    const [loadingTransactions, setLoadingTransactions] = useState(false);
    const [reversalTransactionId, setReversalTransactionId] = useState<string | null>(null);

    // 部分发货功能
    const handlePartialDelivery = (order: Order) => {
        setPartialDeliveryOrder(order);
        // 初始化部分发货数据
        const initialData: {[key: string]: number} = {};
        order.order_items?.forEach(item => {
            if (item.product) {
                initialData[item.product] = item.quantity;
            }
        });
        setPartialDeliveryData(initialData);
        setShowPartialDeliveryModal(true);
    };

    // 确认部分发货（第一个实现）
    const handleConfirmPartialDelivery = async () => {
        if (!partialDeliveryOrder) return;

        // 验证发货数量
        const deliveryItems = Object.entries(partialDeliveryData).filter(([_, qty]) => (qty as number) > 0);
        if (deliveryItems.length === 0) {
            showToast('请至少选择一个产品进行发货', 'warning');
            return;
        }

        const confirmMsg = `📦 部分发货确认\n\n` +
            `订单号：${partialDeliveryOrder.order_id}\n` +
            `客户：${partialDeliveryOrder.name}\n` +
            `本次发货产品：${deliveryItems.length} 个\n\n` +
            deliveryItems.map(([productName, qty]) => `• ${productName}: ${qty} 件`).join('\n') +
            '\n\n确认部分发货吗？系统将扣减相应库存。';

        if (!window.confirm(confirmMsg)) {
            return;
        }

        setUpdating(partialDeliveryOrder.id);

        try {
            // 扣减库存并记录流水
            for (const [productName, deliveryQty] of deliveryItems) {
                const qty = Number(deliveryQty);
                if (qty <= 0) continue;

                const product = products.find(p => p.name === productName);
                if (!product) {
                    showToast(`产品 ${productName} 不存在`, 'danger');
                    continue;
                }

                const currentStock = product.stock_quantity || 0;
                if (currentStock < qty) {
                    showToast(`产品 ${productName} 库存不足，当前库存：${currentStock}`, 'danger');
                    continue;
                }

                const newStock = currentStock - qty;

                // 更新库存
                const { error: stockError } = await supabase
                    .from('products')
                    .update({ stock_quantity: newStock })
                    .eq('id', product.id);

                if (stockError) {
                    console.error('库存更新失败:', stockError);
                    continue;
                }

                // 记录库存流水
                const { error: transactionError } = await supabase
                    .from('stock_transactions')
                    .insert([{
                        product_id: product.id,
                        transaction_type: 'partial_delivery',
                        quantity: -qty,  // 负数表示出库
                        previous_stock: currentStock,
                        new_stock: newStock,
                        reason: '订单部分发货',
                        operator: 'admin',
                        notes: `订单部分发货\n订单号: ${partialDeliveryOrder.order_id}\n客户: ${partialDeliveryOrder.name}\n产品: ${productName}\n发货数量: ${qty}`
                    }]);

                if (transactionError) {
                    console.error('库存流水记录失败:', transactionError);
                }
            }

            // 检查是否完全发货，如果是则更新订单状态
            const allItemsFullyDelivered = partialDeliveryOrder.order_items?.every(item => {
                const deliveryQty = Number(partialDeliveryData[item.product || ''] || 0);
                return deliveryQty >= item.quantity;
            });

            if (allItemsFullyDelivered) {
                // 完全发货，更新订单状态
                const { error: statusError } = await supabase
                    .from('orders')
                    .update({ status: 'delivered' })
                    .eq('id', partialDeliveryOrder.id);

                if (statusError) {
                    console.error('订单状态更新失败:', statusError);
                }
            }

            showToast('部分发货完成！库存已更新', 'success');
            setShowPartialDeliveryModal(false);
            fetchOrders(); // 刷新订单列表
            fetchStockTransactions(); // 刷新库存流水数据

        } catch (error: any) {
            showToast(`部分发货失败: ${error.message}`, 'danger');
        } finally {
            setUpdating(null);
        }
    };

    // 获取库存交易记录
    const fetchStockTransactions = async () => {
        try {
            setLoadingTransactions(true);
            console.log('开始加载库存流水数据...');
            const { data, error } = await supabase
                .from('stock_transactions')
                .select(`
                    *,
                    product:product_id(name, emoji)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            console.log('加载库存流水数据成功:', data?.length || 0, '条记录');
            console.log('部分发货记录:', data?.filter(t => ['partial_delivery', 'stock_out', 'manual_order'].includes(t.transaction_type)));
            setStockTransactions(data || []);
        } catch (error: any) {
            console.error('获取库存交易记录失败:', error);
            showToast('获取库存交易记录失败', 'danger');
        } finally {
            setLoadingTransactions(false);
        }
    };

    // 库存流水回滚（第一个实现）
    const handleStockTransactionReversal = async (transactionId: string, transaction: any) => {
        try {
            setReversalTransactionId(transactionId);
            
            // 🆕 扩展：支持更多类型的回滚
            const allowedTypes = [
                'stock_adjustment', 
                'manual_in', 
                'manual_out', 
                'partial_delivery', 
                'manual_order',
                'order',  // 🆕 支持订单出库回滚
                'stock_out'  // 🆕 支持一般出库回滚
            ];
            
            if (!allowedTypes.includes(transaction.transaction_type)) {
                showToast('此类型的库存操作无法回滚', 'danger');
                return;
            }

            // 确认回滚
            const typeLabels: {[key: string]: string} = {
                'partial_delivery': '部分发货',
                'manual_order': '手动扣库存',
                'order': '订单出库',
                'stock_out': '手动出库',
                'manual_in': '手动入库',
                'manual_out': '手动出库',
                'stock_adjustment': '库存调整'
            };
            
            const operationType = typeLabels[transaction.transaction_type] || transaction.transaction_type;
            
            const confirmMsg = `⚠️ 确认要回滚这条${operationType}记录吗？\n\n` +
                `产品: ${transaction.product?.name}\n` +
                `类型: ${operationType}\n` +
                `数量: ${transaction.quantity}\n` +
                `原因: ${transaction.reason}\n` +
                `订单号: ${transaction.order_id || '无'}\n\n` +
                `回滚后库存将恢复到: ${transaction.previous_stock}\n\n` +
                `⚠️ 注意：此操作不可撤销！`;
            
            if (!window.confirm(confirmMsg)) {
                return;
            }

            // 获取当前库存
            const { data: product, error: productError } = await supabase
                .from('products')
                .select('stock_quantity, name')
                .eq('id', transaction.product_id)
                .single();

            if (productError) throw productError;

            const currentStock = product.stock_quantity;
            let newStock;
            let reversalType = 'stock_adjustment_reversal';
            let reversalQuantity;

            // 🔑 根据原交易类型进行反向操作
            if (transaction.quantity > 0) {
                // 原来是增加库存（入库操作），现在减少库存
                reversalQuantity = -Math.abs(transaction.quantity);
                newStock = currentStock - Math.abs(transaction.quantity);
            } else {
                // 原来是减少库存（出库操作），现在增加库存
                reversalQuantity = Math.abs(transaction.quantity);
                newStock = currentStock + Math.abs(transaction.quantity);
            }

            if (newStock < 0) {
                showToast(`回滚失败：库存不足\n当前库存：${currentStock}\n回滚需要：${Math.abs(reversalQuantity)}`, 'danger');
                return;
            }

            console.log(`回滚操作：${product.name} | 当前库存：${currentStock} → 新库存：${newStock}`);

            // 更新产品库存
            const { error: stockError } = await supabase
                .from('products')
                .update({ stock_quantity: newStock })
                .eq('id', transaction.product_id);

            if (stockError) throw stockError;

            // 记录回滚流水
            const reversalNotes = `🔄 回滚${operationType}操作\n` +
                `原交易ID: ${transactionId}\n` +
                `原交易类型: ${operationType}\n` +
                `原交易数量: ${transaction.quantity}\n` +
                `原交易原因: ${transaction.reason}\n` +
                `原订单号: ${transaction.order_id || '无'}\n` +
                `原交易时间: ${new Date(transaction.created_at).toLocaleString('zh-CN')}\n` +
                `回滚时间: ${new Date().toLocaleString('zh-CN')}`;

            const { error: transactionError } = await supabase
                .from('stock_transactions')
                .insert([{
                    product_id: transaction.product_id,
                    transaction_type: reversalType,
                    quantity: reversalQuantity,
                    previous_stock: currentStock,
                    new_stock: newStock,
                    reason: `回滚${operationType}`,
                    operator: 'admin',
                    order_id: transaction.order_id || null,
                    notes: reversalNotes,
                    reversal_of: transactionId  // 🔑 关联原交易
                }]);

            if (transactionError) {
                console.error('回滚流水记录失败:', transactionError);
                throw transactionError;
            }

            showToast(`✅ ${operationType}回滚成功！\n产品：${product.name}\n库存已恢复：${currentStock} → ${newStock}`, 'success');
            
            // 刷新数据
            await fetchOrders();
            await fetchStockTransactions();

        } catch (error: any) {
            console.error('库存回滚失败:', error);
            showToast(`❌ 库存回滚失败：${error.message}`, 'danger');
        } finally {
            setReversalTransactionId(null);
        }
    };

    const updateStatus = async (id: number, newStatus: string) => {
        setUpdating(id);
        
        try {
            // 如果是取消订单，需要处理库存退还
            if (newStatus === 'cancelled') {
                // 获取订单详情
                const order = orders.find(o => o.id === id);
                if (!order) {
                    showToast('订单不存在', 'danger');
                    return;
                }
                
                // 检查是否有已扣减的库存需要退还
                const itemsToRestore: Array<{
                    productId: number;
                    productName: string;
                    quantity: number;
                    currentStock: number;
                }> = [];
                
                for (const item of order.order_items || []) {
                    if (!item.product_id) continue;
                    
                    // 获取产品信息
                    const { data: productData } = await supabase
                        .from('products')
                        .select('stock_quantity, name, is_unlimited')
                        .eq('id', item.product_id)
                        .single();
                    
                    if (!productData) continue;
                    
                    // 检查库存流水，判断这个订单是否已经扣减过库存
                    const { data: transactions } = await supabase
                        .from('stock_transactions')
                        .select('*')
                        .eq('order_id', order.order_id)
                        .in('transaction_type', ['order', 'manual_order']);
                    
                    if (transactions && transactions.length > 0) {
                        // 找到这个产品的扣减记录
                        const productTransaction = transactions.find(t => t.product_id === item.product_id);
                        if (productTransaction) {
                            itemsToRestore.push({
                                productId: item.product_id,
                                productName: productData.name,
                                quantity: item.quantity,
                                currentStock: productData.stock_quantity || 0
                            });
                        }
                    }
                }
                
                // 如果有需要退还的库存，显示确认对话框
                if (itemsToRestore.length > 0) {
                    const confirmMsg = `⚠️ 取消订单 #${order.order_id}\n\n` +
                        `检测到以下产品已扣减库存，将自动退还：\n\n` +
                        itemsToRestore.map(item => 
                            `• ${item.productName} × ${item.quantity}\n` +
                            `  当前库存：${item.currentStock} → ${item.currentStock + item.quantity}`
                        ).join('\n') +
                        `\n\n确定要取消订单并退还库存吗？`;
                    
                    if (!window.confirm(confirmMsg)) {
                        setUpdating(null);
                        return;
                    }
                    
                    // 退还库存
                    for (const item of itemsToRestore) {
                        const newStock = item.currentStock + item.quantity;
                        
                        // 更新库存
                        await supabase
                            .from('products')
                            .update({ stock_quantity: newStock })
                            .eq('id', item.productId);
                        
                        // 记录库存流水
                        await supabase.from('stock_transactions').insert([{
                            product_id: item.productId,
                            transaction_type: 'stock_in',
                            quantity: item.quantity,
                            previous_stock: item.currentStock,
                            new_stock: newStock,
                            reason: '订单取消退还',
                            order_id: order.order_id,
                            operator: 'admin',
                            notes: `订单 #${order.order_id} 被取消，退还库存\n客户: ${order.name}\n产品: ${item.productName}\n数量: ${item.quantity}`
                        }]);
                    }
                    
                    showToast(`✅ 已退还 ${itemsToRestore.length} 个产品的库存`, 'success');
                }
            }
            
            // 更新订单状态
            const { error } = await supabase.from('orders').update({ status: newStatus }).eq('id', id);
            if (error) throw error;
            
            showToast('状态已更新', 'success');
            await fetchOrders();
            
        } catch (error: any) {
            showToast('状态更新失败: ' + error.message, 'danger');
        } finally {
            setUpdating(null);
        }
    };
    
    // 手动扣除订单库存（支持预购订单提前发货）
    const handleManualStockDeduction = async (order: Order) => {
        // 获取所有订单产品及其当前库存信息
        const allItems = order.order_items || [];
        const itemsWithStock: Array<{
            item: any;
            currentStock: number;
            productName: string;
        }> = [];
        
        // 检查每个产品的当前库存
        // ⚠️ 重要：只处理预购产品（is_unlimited: true），跳过现货产品（已自动扣库存）
        for (const item of allItems) {
            if (!item.product_id) continue;
            
            // 🔑 关键：跳过现货产品，因为下单时已经自动扣除库存了
            if (!item.is_unlimited) {
                console.log(`跳过现货产品 ${item.product}，下单时已自动扣库存`);
                continue;
            }
            
            const { data: productData } = await supabase
                .from('products')
                .select('stock_quantity, name, is_unlimited')
                .eq('id', item.product_id)
                .single();
            
            if (productData && (productData.stock_quantity || 0) > 0) {
                itemsWithStock.push({
                    item,
                    currentStock: productData.stock_quantity || 0,
                    productName: productData.name
                });
            }
        }
        
        if (itemsWithStock.length === 0) {
            // 检查是否所有产品都是现货（已自动扣库存）
            const allItemsAreInStock = allItems.every(item => !item.is_unlimited);
            if (allItemsAreInStock) {
                showToast('此订单全部为现货产品，下单时已自动扣除库存，无需手动操作', 'warning');
            } else {
                showToast('该订单的预购产品当前都没有库存，无法发货', 'warning');
            }
            return;
        }
        
        // 显示确认对话框，列出可发货的产品
        const confirmMsg = `📦 订单 #${order.order_id} - 手动扣库存发货（仅预购产品）\n\n` +
            `客户：${order.name} (${order.phone})\n\n` +
            `以下预购产品有库存，将扣除：\n` +
            itemsWithStock.map(({ item, currentStock }) => 
                `${item.emoji || '▫️'} ${item.product} × ${item.quantity}\n` +
                `   （当前库存：${currentStock}）`
            ).join('\n') +
            `\n\n⚠️ 注意：\n` +
            `• 只扣除预购产品库存\n` +
            `• 现货产品已在下单时自动扣除，不会重复扣减\n` +
            `• 将从现有库存中扣除预购部分\n` +
            `• 会记录详细的库存流水\n\n` +
            `确定要执行吗？`;
        
        if (!window.confirm(confirmMsg)) {
            return;
        }
        
        try {
            setUpdating(order.id);
            let successCount = 0;
            let failedItems: string[] = [];
            
            // 扣减每个有库存的产品
            for (const { item, currentStock } of itemsWithStock) {
                if (!item.product_id) {
                    console.warn(`Item ${item.product} missing product_id, skipping`);
                    continue;
                }
                
                // 检查库存是否足够
                if (currentStock < item.quantity) {
                    failedItems.push(`${item.product} (库存不足: ${currentStock}/${item.quantity})`);
                    continue;
                }
                
                const newStock = currentStock - item.quantity;
                
                // 1. 扣减库存（直接更新，不使用RPC函数，因为可能是预购产品）
                const { error: stockError } = await supabase
                    .from('products')
                    .update({ stock_quantity: newStock })
                    .eq('id', item.product_id);
                
                if (stockError) {
                    console.error(`Stock update failed for product ${item.product_id}:`, stockError);
                    failedItems.push(`${item.product} (更新失败)`);
                    continue;
                }
                
                // 2. 记录库存流水
                const { error: transactionError } = await supabase.from('stock_transactions').insert([{
                    product_id: item.product_id,
                    transaction_type: 'manual_order',
                    quantity: -item.quantity, // 负数表示减少
                    previous_stock: currentStock,
                    new_stock: newStock,
                    reason: `手动扣库存 - 提前发货`,
                    order_id: order.order_id,
                    operator: 'admin',
                    notes: `提前发货给客户: ${order.name} (${order.phone})\n产品: ${item.product}\n数量: ${item.quantity}\n订单类型: ${item.is_unlimited ? '预购订单' : '现货订单'}\n说明: 提前备货，先行发货`
                }]);
                
                if (transactionError) {
                    console.error('Failed to record stock transaction:', transactionError);
                }
                
                successCount++;
            }
            
            // 显示结果
            if (successCount > 0) {
                let message = `✅ 订单 #${order.order_id} 库存扣除完成！\n\n`;
                message += `✓ 成功发货 ${successCount} 个产品\n`;
                if (failedItems.length > 0) {
                    message += `✗ 失败 ${failedItems.length} 个产品:\n`;
                    failedItems.forEach(item => message += `  - ${item}\n`);
                }
                message += `\n💡 提示：库存数据已更新，切换到库存管理页面可查看最新库存`;
                showToast(message, failedItems.length > 0 ? 'warning' : 'success');
            } else {
                showToast(`❌ 订单 #${order.order_id} 所有产品都无法发货`, 'danger');
            }
            
            // 刷新所有数据（包括产品库存、订单、库存流水）
            await fetchOrders();
            await fetchStockTransactions(); // 刷新库存流水数据
            
            // 更新已扣库存的订单列表
            if (successCount > 0) {
                setManuallyDeductedOrders(prev => new Set(prev).add(order.order_id));
            }
            
        } catch (error: any) {
            showToast(`扣库存失败: ${error.message}`, 'danger');
        } finally {
            setUpdating(null);
        }
    };

    // 确认部分发货
    const confirmPartialDelivery = async () => {
        if (!partialDeliveryOrder || !partialDeliveryData) return;
        
        const order = partialDeliveryOrder;
        const deliveryItems = partialDeliveryData;
        
        // 验证所有输入数量
        for (const deliveryItem of deliveryItems) {
            const quantity = parseInt(deliveryItem.deliveryQuantity);
            if (quantity < 1 || quantity > deliveryItem.orderedQuantity) {
                showToast(`${deliveryItem.productName} 的发货数量无效`, 'danger');
                return;
            }
        }
        
        try {
            setIsPartialDeliveryLoading(true);
            
            let successCount = 0;
            const failedItems: string[] = [];
            
            for (const deliveryItem of deliveryItems) {
                const quantity = parseInt(deliveryItem.deliveryQuantity);
                if (quantity === 0) continue; // 跳过数量为0的产品
                
                // 获取当前库存
                const { data: productData } = await supabase
                    .from('products')
                    .select('stock_quantity, name')
                    .eq('id', deliveryItem.productId)
                    .single();
                
                if (!productData) {
                    failedItems.push(`${deliveryItem.productName} (产品未找到)`);
                    continue;
                }
                
                const currentStock = productData.stock_quantity || 0;
                
                // 检查库存是否足够
                if (currentStock < quantity) {
                    failedItems.push(`${deliveryItem.productName} (库存不足: ${currentStock}/${quantity})`);
                    continue;
                }
                
                const newStock = currentStock - quantity;
                
                // 扣减库存
                const { error: stockError } = await supabase
                    .from('products')
                    .update({ stock_quantity: newStock })
                    .eq('id', deliveryItem.productId);
                
                if (stockError) {
                    console.error(`Stock update failed for product ${deliveryItem.productId}:`, stockError);
                    failedItems.push(`${deliveryItem.productName} (更新失败)`);
                    continue;
                }
                
                // 记录库存流水
                await supabase.from('stock_transactions').insert([{
                    product_id: deliveryItem.productId,
                    transaction_type: 'partial_delivery',
                    quantity: -quantity, // 负数表示减少
                    previous_stock: currentStock,
                    new_stock: newStock,
                    reason: '部分发货',
                    order_id: order.order_id,
                    operator: 'admin',
                    notes: `部分发货给客户: ${order.name} (${order.phone})\n产品: ${deliveryItem.productName}\n本次发货: ${quantity}/${deliveryItem.orderedQuantity}\n剩余待发: ${deliveryItem.orderedQuantity - quantity}`
                }]);
                
                successCount++;
            }
            
            // 显示结果并关闭模态框
            if (successCount > 0) {
                let message = `✅ 订单 #${order.order_id} 部分发货完成！\n\n`;
                message += `✓ 成功发货 ${successCount} 个产品\n`;
                if (failedItems.length > 0) {
                    message += `✗ 失败 ${failedItems.length} 个产品:\n`;
                    failedItems.forEach(item => message += `  - ${item}\n`);
                }
                message += `\n💡 客户收到货品后，您可以记录剩余产品的后续发货`;
                showToast(message, failedItems.length > 0 ? 'warning' : 'success');
                
                // 关闭模态框
                setShowPartialDeliveryModal(false);
                setPartialDeliveryData({});
                
                // 刷新数据
                await fetchOrders();
            } else {
                showToast(`❌ 订单 #${order.order_id} 所有产品都无法发货`, 'danger');
            }
            
        } catch (error: any) {
            console.error('部分发货失败:', error);
            showToast(`部分发货失败: ${error.message}`, 'danger');
        } finally {
            setIsPartialDeliveryLoading(false);
        }
    };

    // 编辑流水记录后更新订单状态
    const updateOrderStatusAfterEdit = async (orderId: string) => {
        try {
            console.log('开始更新订单状态:', orderId);
            
            // 获取该订单的所有流水记录
            const { data: transactions, error: transError } = await supabase
                .from('stock_transactions')
                .select('quantity, transaction_type, product_id')
                .eq('order_id', orderId)
                .in('transaction_type', ['partial_delivery', 'stock_out', 'manual_order']);

            if (transError) {
                console.error('获取流水记录失败:', transError);
                throw transError;
            }

            console.log('订单流水记录:', transactions);

            // 获取订单信息
            const { data: order, error: orderError } = await supabase
                .from('orders')
                .select('order_items')
                .eq('order_id', orderId)
                .single();

            if (orderError) {
                console.error('获取订单信息失败:', orderError);
                throw orderError;
            }

            console.log('订单信息:', order);

            // 计算每个产品的发货情况
            const deliveredQuantities: {[key: string]: number} = {};
            transactions?.forEach(trans => {
                const product = products.find(p => p.id === trans.product_id);
                if (product && trans.quantity < 0) { // 负数表示出库
                    deliveredQuantities[product.name] = (deliveredQuantities[product.name] || 0) + Math.abs(trans.quantity);
                }
            });

            console.log('已发货数量统计:', deliveredQuantities);

            // 检查发货状态
            let totalOrdered = 0;
            let totalDelivered = 0;
            
            order.order_items?.forEach((item: any) => {
                totalOrdered += item.quantity || 0;
                totalDelivered += deliveredQuantities[item.product] || 0;
            });

            console.log(`发货统计: 总订购=${totalOrdered}, 总发货=${totalDelivered}`);

            // 🔧 修复：确定新的订单状态（添加 partial delivered 状态）
            let newStatus = 'pending';
            if (totalDelivered === 0) {
                newStatus = 'pending'; // 未发货 - 保持待处理
            } else if (totalDelivered < totalOrdered) {
                newStatus = 'partial delivered'; // ✅ 部分发货 - 新增状态
            } else if (totalDelivered >= totalOrdered) {
                newStatus = 'ready for pick up'; // ✅ 全部发货 - 等待打包
            }

            console.log(`订单状态更新: ${orderId}, 已订购: ${totalOrdered}, 已发货: ${totalDelivered}, 新状态: ${newStatus}`);

            // 更新订单状态
            const { error: updateError } = await supabase
                .from('orders')
                .update({ status: newStatus })
                .eq('order_id', orderId);

            if (updateError) {
                console.error('订单状态更新失败:', updateError);
            } else {
                console.log('订单状态更新成功:', newStatus);
                // 刷新订单数据
                await fetchOrders();
            }

            if (updateError) {
                console.error('订单状态更新失败:', updateError);
            }
        } catch (error) {
            console.error('更新订单状态失败:', error);
        }
    };

    // 撤销库存操作（第二个实现）
    const reverseStockOperation = async (transactionId: string) => {
        try {
            // 获取原始交易记录
            const { data: transaction, error: fetchError } = await supabase
                .from('stock_transactions')
                .select('*')
                .eq('id', transactionId)
                .single();
            
            if (fetchError || !transaction) {
                showToast('未找到原始交易记录', 'danger');
                return;
            }
            
            // 检查是否已经被撤销
            const { data: existingReversal } = await supabase
                .from('stock_transactions')
                .select('id')
                .eq('reversal_of', transactionId)
                .single();
            
            if (existingReversal) {
                showToast('此交易已经被撤销过了', 'warning');
                return;
            }
            
            // 检查是否可以撤销（只允许撤销手动操作和部分发货）
            const allowedTypes = ['manual_adjustment', 'manual_order', 'partial_delivery'];
            if (!allowedTypes.includes(transaction.transaction_type)) {
                showToast('此类型的库存操作无法撤销', 'warning');
                return;
            }
            
            // 获取产品当前库存
            const { data: productData } = await supabase
                .from('products')
                .select('stock_quantity, name')
                .eq('id', transaction.product_id)
                .single();
            
            if (!productData) {
                showToast('产品不存在', 'danger');
                return;
            }
            
            const currentStock = productData.stock_quantity || 0;
            const reversalQuantity = -transaction.quantity; // 反向操作
            const newStock = currentStock + reversalQuantity;
            
            // 检查撤销后库存不能为负数
            if (newStock < 0) {
                showToast(`撤销操作失败：${productData.name} 的库存不足以撤销此操作`, 'danger');
                return;
            }
            
            const confirmMsg = `⚠️ 撤销库存操作确认\n\n` +
                `产品：${productData.name}\n` +
                `原操作：${transaction.reason}\n` +
                `原操作数量：${transaction.quantity > 0 ? '+' : ''}${transaction.quantity}\n` +
                `当前库存：${currentStock}\n` +
                `撤销后库存：${newStock}\n\n` +
                `⚠️ 注意：撤销操作将影响库存数据，请确保操作正确！\n\n` +
                `确定要撤销这个库存操作吗？`;
            
            if (!window.confirm(confirmMsg)) {
                return;
            }
            
            setUpdating(transactionId);
            
            console.log('开始撤销操作:', {
                transactionId,
                productId: transaction.product_id,
                currentStock,
                newStock,
                reversalQuantity
            });
            
            // 更新产品库存
            const { error: stockError } = await supabase
                .from('products')
                .update({ stock_quantity: newStock })
                .eq('id', transaction.product_id);
            
            if (stockError) {
                console.error('库存更新失败:', stockError);
                showToast(`库存更新失败: ${stockError.message}`, 'danger');
                setUpdating('');
                return;
            }
            
            console.log('产品库存更新成功');
            
            // 记录撤销操作的库存流水
            const { error: transactionError } = await supabase.from('stock_transactions').insert([{
                product_id: transaction.product_id,
                transaction_type: 'reversal',
                quantity: reversalQuantity,
                previous_stock: currentStock,
                new_stock: newStock,
                reason: `撤销操作 - ${transaction.reason}`,
                order_id: transaction.order_id,
                operator: 'admin',
                notes: `撤销交易ID: ${transactionId}\n原因: 手动撤销库存操作\n原操作: ${transaction.transaction_type}\n原数量: ${transaction.quantity}`,
                reversal_of: transactionId
            }]);
            
            console.log('撤销流水记录结果:', { transactionError });
            
            if (transactionError) {
                console.error('记录撤销流水失败:', transactionError);
                showToast('撤销操作成功，但记录撤销流水失败', 'warning');
            } else {
                console.log('撤销流水记录成功');
                showToast(`✅ 库存操作撤销成功！\n${productData.name} 库存已从 ${currentStock} 调整为 ${newStock}`, 'success');
            }
            
            // 如果有关联的订单，更新订单状态
            if (transaction.order_id) {
                console.log('更新关联订单状态:', transaction.order_id);
                await updateOrderStatusAfterEdit(transaction.order_id);
            }
            
            // 刷新数据
            await fetchOrders();
            await fetchStockTransactions();
            
        } catch (error: any) {
            console.error('撤销操作失败:', error);
            showToast(`撤销操作失败: ${error.message}`, 'danger');
        } finally {
            setUpdating(null);
        }
    };
    
    const handleUploadProof = async () => {
        if (!uploadFile || !uploadModal) return;
        const path = `shipping_proofs/${uploadModal.order_id}-${uploadFile.name}`;
        const { error: uploadError } = await supabase.storage.from('payment-proofs').upload(path, uploadFile, { upsert: true });
        if (uploadError) { showToast('上传失败: ' + uploadError.message, 'danger'); return; }
        const { data: urlData } = supabase.storage.from('payment-proofs').getPublicUrl(path);
        const { error: updateError } = await supabase.from('orders').update({ shipping_payment_proof_url: urlData.publicUrl }).eq('id', uploadModal.id);
        if (updateError) showToast('更新订单失败: ' + updateError.message, 'danger');
        else {
            showToast('运费凭证上传成功!', 'success');
            setUploadModal(null);
            setUploadFile(null);
            fetchOrders();
        }
    };

    const sendShippingWhatsapp = (order: Order) => {
        const totalItems = (order.order_items || []).reduce((sum, item) => sum + (item.quantity || 0), 0);
        const shippingFee = totalItems * 5;
        const paymentLink = `https://fengweipaishop.netlify.app/?order_id=${order.order_id}`;
        const msg = `📦 *锋味派订单 #${order.order_id}*\n\n` +
            `亲爱的${order.name}，您的订单已准备发货。\n` +
            `请支付运费以完成配送。\n` +
            `订单号: ${order.order_id}\n` +
            `收件人: ${order.name}\n` +
            `联系电话: ${order.phone}\n` +
            `运费: RM${shippingFee.toFixed(2)} (RM5/件, 共${totalItems}件)\n` +
            `支付链接: ${paymentLink}\n` +
            `如已支付请忽略此消息，谢谢！`;
        const phone = order.phone.startsWith('60') ? order.phone : '60' + order.phone.replace(/^0/, '');
        const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
        window.open(whatsappUrl, '_blank');
    };

    const copyDetails = async (order: Order) => {
        const ok = await copyTextUniversal(buildOrderMessage(order));
        showToast(ok ? '订单信息已复制' : '复制失败', ok ? 'success' : 'danger');
    };

    // 直接进入打包模式
    const startDirectPacking = (order: Order) => {
        if (order.status !== 'pending') {
            showToast(`订单 ${order.order_id} 状态为 ${order.status}，不能打包`, 'warning');
            return;
        }
        
        setDirectPackingOrder(order);
        setShowDirectPacking(true);
        showToast(`开始打包订单 ${order.order_id}`, 'success');
    };

    // 退出直接打包模式
    const exitDirectPacking = () => {
        setDirectPackingOrder(null);
        setShowDirectPacking(false);
        fetchOrders(); // 刷新订单状态
    };

    // 检查哪些订单已手动扣库存
    useEffect(() => {
        const checkManualDeductions = async () => {
            if (orders.length === 0) return;
            
            const orderIds = orders.map(o => o.order_id);
            const { data: transactions } = await supabase
                .from('stock_transactions')
                .select('order_id')
                .in('order_id', orderIds)
                .eq('transaction_type', 'manual_order');
            
            if (transactions) {
                const deductedSet = new Set(transactions.map(t => t.order_id));
                setManuallyDeductedOrders(deductedSet);
            }
        };
        
        checkManualDeductions();
        
        // 强制刷新库存流水数据以显示部分发货信息
        console.log('订单数据变化，重新加载库存流水数据...');
        fetchStockTransactions();
    }, [orders]);

    const filteredOrders = useMemo(() => {
        return orders.filter(order => {
            const matchesStatus = !filterStatus || order.status === filterStatus;
            const matchesDelivery = !filterDelivery || order.delivery_method === filterDelivery;
            const matchesSearch = !searchText ||
                order.order_id.toLowerCase().includes(searchText.toLowerCase()) ||
                order.name.toLowerCase().includes(searchText.toLowerCase()) ||
                order.phone.toLowerCase().includes(searchText.toLowerCase());
            return matchesStatus && matchesSearch && matchesDelivery;
        }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); // 倒序排列，最新订单在前
    }, [orders, filterStatus, filterDelivery, searchText]);

    // 按顾客分组订单（包含待处理和部分已发的订单）
    const groupedOrders = useMemo(() => {
        if (!groupByCustomer) return null;
        
        // ✅ 处理待处理和部分已发状态的订单
        const pendingOrders = filteredOrders.filter(order => 
            order.status === 'pending' || order.status === 'partial delivered'
        );
        
        const groups: { [phone: string]: Order[] } = {};
        pendingOrders.forEach(order => {
            if (!groups[order.phone]) {
                groups[order.phone] = [];
            }
            groups[order.phone].push(order);
        });
        
        // 转换为数组并按订单数量排序（订单多的顾客在前）
        return Object.entries(groups)
            .map(([phone, orders]) => ({
                phone,
                customerName: orders[0].name,
                orders: orders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
                totalOrders: orders.length,
                totalAmount: orders.reduce((sum, order) => sum + (order.total_amount || 0), 0),
                totalItems: orders.reduce((sum, order) => 
                    sum + (order.order_items || []).reduce((itemSum, item) => itemSum + (item.quantity || 0), 0), 0
                )
            }))
            .sort((a, b) => b.totalOrders - a.totalOrders);
    }, [filteredOrders, groupByCustomer]);

    // 打印合并订单（同一个顾客的所有订单）
    const printMergedOrders = async (customerOrders: Order[], stockTransactions?: any[], fetchStockTransactionsFunc?: any) => {
        const printWindow = window.open('', '_blank', 'width=820,height=900');
        if (!printWindow) { alert('请允许弹出窗口以便打印。'); return; }
        const doc = printWindow.document;
        doc.open();
        
        const customerName = customerOrders[0].name;
        const customerPhone = customerOrders[0].phone;
        const orderIds = customerOrders.map(o => o.order_id).join(', ');
        
        // 确保库存流水数据已加载
        if (stockTransactions.length === 0) {
            console.log('合并打印：库存流水数据为空，先加载数据...');
            await fetchStockTransactions();
        }
        
        // 获取所有订单的已发货数量
        const getDeliveredQuantitiesForOrders = () => {
            const deliveredMap: {[orderAndProduct: string]: number} = {};
            
            customerOrders.forEach(order => {
                stockTransactions.forEach(trans => {
                    if (['partial_delivery', 'stock_out', 'manual_order'].includes(trans.transaction_type) && // 兼容旧数据，建议统一为partial_delivery
                        trans.order_id === order.order_id &&
                        trans.quantity < 0) {
                        
                        const productName = trans.product?.name;
                        if (productName) {
                            const key = `${order.order_id}-${productName}`;
                            deliveredMap[key] = (deliveredMap[key] || 0) + Math.abs(trans.quantity);
                        }
                    }
                });
            });
            
            console.log('合并打印已发货数量映射:', deliveredMap);
            return deliveredMap;
        };
        
        const deliveredQuantities = getDeliveredQuantitiesForOrders();
        
        doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>合并订单 - ' + customerName + '</title>');
        doc.write('<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>');
        doc.write('<style>body{font-family:Arial,sans-serif; margin:20px;} h1{font-size:24px; font-weight:bold; color:#e11d48;} h2{font-size:18px; font-weight:bold; margin-top:20px; color:#059669;} div{margin:8px 0;} table{width:100%; border-collapse:collapse; margin-top:15px;} th, td{border:1px solid #333; padding:8px; text-align:left;} .checkbox{width:20px; height:20px; border:2px solid #333; display:inline-block; vertical-align:middle; margin-left:10px;} .order-section{margin-top:30px; padding-top:20px; border-top:3px dashed #666;} .summary{background:#fef3c7; padding:15px; border-radius:8px; margin:20px 0; border:2px solid #f59e0b;} .page-break{page-break-after:always;} @media print{button{display:none}}</style></head><body>');
        
        // ============ 第一页：客户打包清单 ============
        doc.write('<div class="page-break">');
        
        // 标题
        doc.write('<h1>🎯 锋味派合并订单</h1>');
        doc.write('<div class="summary">');
        doc.write('<div style="font-size:18px; font-weight:bold; color:#e11d48;">📦 客户：' + customerName + '</div>');
        doc.write('<div style="font-size:16px; margin-top:6px; color:#0369a1;">� 电话：' + customerPhone + '</div>');
        doc.write('<div style="font-size:14px; margin-top:8px;">📋 合并订单数：<b>' + customerOrders.length + '</b> 单</div>');
        doc.write('<div style="font-size:14px;">🆔 订单号：' + orderIds + '</div>');
        doc.write('</div>');
        
        // 合并商品清单（汇总所有订单的商品，考虑已发货数量）
        const mergedItems: { [key: string]: { quantity: number, deliveredQuantity: number, remainingQuantity: number, product: string, emoji?: string, orderDetails: string[] } } = {};
        let totalItemsCount = 0; // 总产品数量（盒数）
        let totalDeliveredCount = 0; // 总已发货数量
        let totalRemainingCount = 0; // 总剩余数量
        
        customerOrders.forEach(order => {
            (order.order_items || []).forEach(item => {
                const deliveredKey = `${order.order_id}-${item.product}`;
                const deliveredQty = deliveredQuantities[deliveredKey] || 0;
                const remainingQty = Math.max(0, item.quantity - deliveredQty);
                
                if (!mergedItems[item.product]) {
                    mergedItems[item.product] = { 
                        quantity: 0, 
                        deliveredQuantity: 0,
                        remainingQuantity: 0,
                        product: item.product,
                        emoji: item.emoji,
                        orderDetails: []
                    };
                }
                
                mergedItems[item.product].quantity += item.quantity || 0;
                mergedItems[item.product].deliveredQuantity += deliveredQty;
                mergedItems[item.product].remainingQuantity += remainingQty;
                
                // 添加订单详情（如果有部分发货）
                if (deliveredQty > 0) {
                    mergedItems[item.product].orderDetails.push(`${order.order_id}: ${item.quantity}/${deliveredQty}/${remainingQty}`);
                }
                
                totalItemsCount += item.quantity || 0;
                totalDeliveredCount += deliveredQty;
                totalRemainingCount += remainingQty;
            });
        });
        
        doc.write('<h2>📦 合并商品清单（总计）</h2>');
        doc.write('<div style="background:#dcfce7; border:2px solid #16a34a; padding:12px; border-radius:8px; margin-bottom:15px;">');
        doc.write('<div style="font-size:16px; font-weight:bold; color:#15803d;">📊 总产品数量：<span style="font-size:20px; color:#e11d48;">' + totalItemsCount + '</span> 盒</div>');
        
        if (totalDeliveredCount > 0) {
            doc.write('<div style="font-size:14px; color:#059669; margin-top:4px;">✅ 已发货：<span style="font-weight:bold;">' + totalDeliveredCount + '</span> 盒</div>');
            doc.write('<div style="font-size:14px; color:#dc2626; margin-top:2px;">📦 本次需打包：<span style="font-weight:bold; font-size:16px;">' + totalRemainingCount + '</span> 盒</div>');
        }
        
        doc.write('<div style="font-size:12px; color:#166534; margin-top:4px;">💡 打包时请确保数量准确无误</div>');
        doc.write('</div>');
        doc.write('<table><thead><tr><th>商品</th><th style="width:120px;">总订单量</th><th style="width:100px;">已发货</th><th style="width:120px;">本次需打包</th><th style="width:80px;">已打包</th></tr></thead><tbody>');
        
        Object.values(mergedItems).forEach(item => {
            // 只显示还需要打包的商品
            if (item.remainingQuantity > 0) {
                let quantityDisplay = '';
                if (item.deliveredQuantity > 0) {
                    quantityDisplay = `<span style="color:#666;">${item.quantity}</span>`;
                } else {
                    quantityDisplay = `${item.quantity}`;
                }
                
                let deliveredDisplay = item.deliveredQuantity > 0 ? 
                    `<span style="color:#059669; font-weight:bold;">${item.deliveredQuantity}</span>` : 
                    `<span style="color:#ccc;">-</span>`;
                
                let remainingDisplay = `<span style="color:#dc2626; font-weight:bold; font-size:16px;">${item.remainingQuantity}</span>`;
                
                doc.write(`<tr><td>${item.emoji || '▫️'} ${item.product}</td><td style="text-align:center;">${quantityDisplay}</td><td style="text-align:center;">${deliveredDisplay}</td><td style="text-align:center;">${remainingDisplay}</td><td style="text-align:center;"><span class="checkbox"></span></td></tr>`);
            } else if (item.deliveredQuantity > 0) {
                // 已完全发货的商品，用灰色显示
                doc.write(`<tr style="opacity:0.6; background:#f9f9f9;"><td style="text-decoration:line-through;">${item.emoji || '▫️'} ${item.product}</td><td style="text-align:center; text-decoration:line-through;">${item.quantity}</td><td style="text-align:center; color:#059669; font-weight:bold;">${item.deliveredQuantity}</td><td style="text-align:center; color:#999;">已发完</td><td style="text-align:center;">✓</td></tr>`);
            }
        });
        doc.write('</tbody></table>');
        
        doc.write('</div>'); // 结束第一页
        
        // ============ 第二页及以后：各订单详细信息（内部核对用） ============
        doc.write('<h2 style="margin-top:0; color:#666;">📋 订单详细信息（内部核对用）</h2>');
        doc.write('<div style="background:#fff3cd; border:1px solid #ffc107; padding:10px; border-radius:6px; margin-bottom:20px; font-size:13px; color:#856404;">');
        doc.write('<b>⚠️ 内部使用页面</b> - 以下信息仅供内部核对订单详情和扫描条形码使用，无需交给客户。');
        doc.write('</div>');
        
        // 打包提示（内部使用）
        doc.write('<div style="background:#e3f2fd; border:1px solid #2196f3; padding:12px; border-radius:6px; margin-bottom:20px; font-size:13px; color:#1565c0;">');
        doc.write('<b>✅ 打包提示（内部）：</b><br/>');
        doc.write('1️⃣ 请按照第一页"合并商品清单"进行打包，确保数量准确<br/>');
        doc.write('2️⃣ 打包完成后在"已打包"栏打勾确认<br/>');
        doc.write('3️⃣ 此客户共有 <b>' + customerOrders.length + '</b> 个订单，请一次性完成打包<br/>');
        doc.write('4️⃣ 使用下方条形码进行订单核对和扫描');
        doc.write('</div>');
        
        customerOrders.forEach((order, index) => {
            // 计算订单状态和总计
            let orderTotal = 0;
            let orderDelivered = 0;
            let hasPartialDelivery = false;
            
            (order.order_items || []).forEach(item => {
                const deliveredKey = `${order.order_id}-${item.product}`;
                const deliveredQty = deliveredQuantities[deliveredKey] || 0;
                orderTotal += item.quantity || 0;
                orderDelivered += deliveredQty;
                if (deliveredQty > 0 && deliveredQty < item.quantity) {
                    hasPartialDelivery = true;
                }
            });
            
            const isFullyDelivered = orderDelivered > 0 && orderDelivered === orderTotal;
            const orderRemaining = orderTotal - orderDelivered;
            
            let titleStyle = 'color:#2563eb;';
            let statusText = '';
            if (isFullyDelivered) {
                titleStyle = 'background:#dcfce7; color:#166534; padding:8px; border-radius:4px;';
                statusText = ' ✅ 已发完';
            } else if (hasPartialDelivery || orderDelivered > 0) {
                titleStyle = 'background:#fef3c7; color:#a16207; padding:8px; border-radius:4px;';
                statusText = ` 🔄 部分发货 (${orderDelivered}/${orderTotal})`;
            }
            
            doc.write('<div class="order-section">');
            doc.write('<h3 style="' + titleStyle + '">订单 ' + (index + 1) + ' / ' + customerOrders.length + ' - #' + order.order_id + statusText + '</h3>');
            doc.write('<div><b>取货方式:</b> ' + (order.delivery_method === 'self-pickup' ? '自取' : 'Lalamove送货') + '</div>');
            if (order.address) doc.write('<div><b>地址:</b> ' + order.address + '</div>');
            doc.write('<div><b>备注:</b> ' + (order.remarks || '无') + '</div>');
            doc.write('<table style="margin-top:10px;"><thead><tr><th>商品</th><th style="width:80px;">订购</th><th style="width:80px;">已发</th><th style="width:100px;">需打包</th></tr></thead><tbody>');
            (order.order_items || []).forEach(item => {
                const deliveredKey = `${order.order_id}-${item.product}`;
                const deliveredQty = deliveredQuantities[deliveredKey] || 0;
                const remainingQty = Math.max(0, (item.quantity || 0) - deliveredQty);
                
                let rowStyle = '';
                let deliveredDisplay = '';
                let needPackDisplay = '';
                
                if (deliveredQty >= item.quantity) {
                    rowStyle = ' style="opacity:0.7; background:#f9f9f9;"';
                    deliveredDisplay = `<span style="color:#059669; font-weight:bold;">${deliveredQty}</span>`;
                    needPackDisplay = '<span style="color:#999;">已发完</span>';
                } else if (deliveredQty > 0) {
                    deliveredDisplay = `<span style="color:#a16207; font-weight:bold;">${deliveredQty}</span>`;
                    needPackDisplay = `<span style="color:#dc2626; font-weight:bold;">${remainingQty}</span>`;
                } else {
                    deliveredDisplay = '<span style="color:#ccc;">-</span>';
                    needPackDisplay = `<span style="color:#dc2626; font-weight:bold;">${remainingQty}</span>`;
                }
                
                doc.write(`<tr${rowStyle}><td>${item.emoji || '▫️'} ${item.product}</td><td style="text-align:center;">${item.quantity}</td><td style="text-align:center;">${deliveredDisplay}</td><td style="text-align:center;">${needPackDisplay}</td></tr>`);
            });
            doc.write('</tbody></table>');
            
            // 为每个订单添加条形码（内部核对用）
            doc.write('<div style="margin-top:20px; padding:8px; border:1px solid #ddd; background:#fafafa; display:inline-block;">');
            doc.write('<div style="font-size:10px; color:#999; margin-bottom:4px;">订单条形码（内部核对）</div>');
            doc.write('<svg id="barcode-' + order.order_id + '"></svg>');
            doc.write('<div style="font-size:10px; color:#bbb; margin-top:2px; text-align:center;">#' + order.order_id + '</div>');
            doc.write('</div>');
            
            doc.write('</div>');
        });
        
        doc.write('<button onclick="window.print()" style="font-size:16px;padding:10px 20px;margin-top:20px;background:#e11d48;color:white;border:none;border-radius:8px;cursor:pointer;">🖨️ 打印合并订单</button>');
        
        // 生成所有条形码
        doc.write('<script>');
        customerOrders.forEach(order => {
            doc.write('try{JsBarcode("#barcode-' + order.order_id + '", "' + order.order_id + '", {format:"CODE128", width:2.5, height:30, displayValue:false, margin:0});}catch(e){console.error(e);}');
        });
        doc.write('</script>');
        
        doc.write('</body></html>');
        doc.close();
    };

    return (
        <>
            {/* 直接打包模式 */}
            {showDirectPacking && directPackingOrder ? (
                <PackingView
                    showToast={showToast}
                    onExit={exitDirectPacking}
                    orders={orders} // 传递所有订单以便查找
                    products={products}
                    fetchOrders={fetchOrders}
                    directOrder={directPackingOrder} // 传递要直接打包的订单
                />
            ) : (
                <div className="bg-white p-6 rounded-lg shadow relative">
            {/* 数据一致性警告 - 只在有混合类型数据时显示 */}
            {(() => {
                const hasInconsistentData = stockTransactions.some(trans => 
                    ['stock_out', 'manual_order'].includes(trans.transaction_type) && 
                    trans.order_id && 
                    trans.quantity < 0
                );
                
                if (!hasInconsistentData) return null;
                
                return (
                    <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
                        <div className="flex items-center">
                            <i className="fas fa-exclamation-triangle text-red-600 mr-3"></i>
                            <div className="flex-1">
                                <p className="text-red-800 font-semibold">🚨 检测到数据不一致问题</p>
                                <p className="text-red-700 text-sm mt-1">
                                    系统检测到您的部分发货记录可能存在类型不统一的问题，这会导致订单状态显示混乱。
                                    建议立即点击 <span className="font-semibold">库存管理 → 库存流水 → 修复部分发货数据</span> 来解决此问题。
                                </p>
                                <button 
                                    onClick={() => {
                                        // 切换到库存管理标签
                                        const event = { target: { textContent: '库存管理' } } as any;
                                        (document.querySelector('[data-tab="inventory"]') as HTMLElement)?.click?.();
                                        // 提示用户操作步骤
                                        alert('💡 操作步骤：\n1. 点击"库存流水"标签\n2. 点击"修复部分发货数据"按钮\n3. 确认修复操作');
                                    }}
                                    className="mt-2 bg-red-600 hover:bg-red-700 text-white px-4 py-1 rounded text-sm font-medium transition-colors">
                                    <i className="fas fa-wrench mr-1"></i>
                                    立即修复
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
            
            <div className="flex flex-wrap gap-3 items-center justify-between mb-4">
                <h2 className="text-lg font-bold">
                    订单管理 ({groupByCustomer ? `${groupedOrders?.length || 0}位顾客 (待处理), ${filteredOrders.length}单` : `${filteredOrders.length}`})
                </h2>
                <div className="flex gap-2 flex-wrap">
                    <button 
                        onClick={() => setGroupByCustomer(!groupByCustomer)}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                            groupByCustomer 
                                ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-lg' 
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                        <i className={`fas ${groupByCustomer ? 'fa-users' : 'fa-list'} mr-2`}></i>
                        {groupByCustomer ? '顾客分组 (待处理/部分已发)' : '按顾客分组'}
                    </button>
                    <input type="text" placeholder="搜索..." value={searchText} onChange={(e) => setSearchText(e.target.value)} className="border px-3 py-1.5 rounded text-sm"/>
                    <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="border px-3 py-1.5 rounded text-sm">
                        <option value="">全部状态</option><option value="pending">待处理</option><option value="partial delivered">部分已发</option><option value="ready for pick up">待取货</option><option value="delivered">已发货</option><option value="completed">已完成</option><option value="cancelled">已取消</option>
                    </select>
                     <select value={filterDelivery} onChange={(e) => setFilterDelivery(e.target.value)} className="border px-3 py-1.5 rounded text-sm">
                        <option value="">全部取货方式</option><option value="self-pickup">自提</option><option value="lalamove">Lalamove</option>
                    </select>
                    <button
                        onClick={() => {
                            setShowTransactionModal(true);
                            if (stockTransactions.length === 0) {
                                fetchStockTransactions();
                            }
                        }}
                        className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors">
                        <i className="fas fa-history mr-2"></i>库存流水
                    </button>
                </div>
            </div>
            <div className="overflow-x-auto">
                {groupByCustomer && groupedOrders ? (
                    // 按顾客分组显示（仅待处理订单）
                    <div className="space-y-4">
                        {/* 提示信息 */}
                        <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
                            <div className="flex items-center">
                                <i className="fas fa-info-circle text-blue-500 mr-3 text-xl"></i>
                                <div>
                                    <p className="font-semibold text-blue-800">顾客分组模式 - 显示待处理/部分已发订单</p>
                                    <p className="text-sm text-blue-600 mt-1">
                                        自动按顾客归类需要继续处理的订单，方便合并打包发货。订单多的顾客会优先显示。
                                    </p>
                                </div>
                            </div>
                        </div>

                        {groupedOrders.map((group, groupIndex) => (
                            <div key={group.phone} className="border-2 border-purple-200 rounded-lg overflow-hidden bg-purple-50">
                                {/* 顾客信息头部 */}
                                <div className="bg-gradient-to-r from-purple-500 to-purple-600 text-white p-4">
                                    <div className="flex flex-wrap items-center justify-between">
                                        <div>
                                            <h3 className="text-lg font-bold">
                                                <i className="fas fa-user-circle mr-2"></i>
                                                {group.customerName}
                                            </h3>
                                            <p className="text-sm opacity-90">📱 {group.phone}</p>
                                        </div>
                                        <div className="flex flex-wrap gap-4 text-sm">
                                            <div className="bg-white/20 rounded-lg px-3 py-2">
                                                <div className="opacity-75">订单数</div>
                                                <div className="text-xl font-bold">{group.totalOrders}</div>
                                            </div>
                                            <div className="bg-white/20 rounded-lg px-3 py-2">
                                                <div className="opacity-75">总盒数</div>
                                                <div className="text-xl font-bold">{group.totalItems}</div>
                                            </div>
                                            <div className="bg-white/20 rounded-lg px-3 py-2">
                                                <div className="opacity-75">总金额</div>
                                                <div className="text-xl font-bold">RM{group.totalAmount.toFixed(2)}</div>
                                            </div>
                                        </div>
                                        <button 
                                            onClick={() => printMergedOrders(group.orders, stockTransactions, fetchStockTransactions)}
                                            className="bg-white text-purple-600 px-6 py-2 rounded-lg font-semibold hover:bg-purple-50 transition-all shadow-lg"
                                        >
                                            <i className="fas fa-print mr-2"></i>
                                            打印合并订单
                                        </button>
                                    </div>
                                </div>
                                
                                {/* 订单列表 */}
                                <div className="p-4">
                                    <table className="w-full text-sm">
                                        <thead className="bg-purple-100">
                                            <tr>
                                                <th className="p-3 text-left">订单号</th>
                                                <th className="p-3 text-left">订单明细</th>
                                                <th className="p-3 text-left">金额</th>
                                                <th className="p-3 text-left">状态</th>
                                                <th className="p-3 text-left">下单时间</th>
                                                <th className="p-3 text-left">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {group.orders.map(order => {
                                                const hasUnlimitedItems = order.order_items?.some(item => item.is_unlimited);
                                                const hasLimitedItems = order.order_items?.some(item => !item.is_unlimited);
                                                const isManuallyDeducted = manuallyDeductedOrders.has(order.order_id);
                                                
                                                // 判断订单类型
                                                let orderTypeLabel = '';
                                                let orderTypeColor = '';
                                                let orderTypeIcon = '';
                                                let orderTypeTitle = '';
                                                
                                                if (hasLimitedItems && !hasUnlimitedItems) {
                                                    // 纯现货订单
                                                    orderTypeLabel = '现货';
                                                    orderTypeColor = 'bg-green-100 text-green-700 border-green-300';
                                                    orderTypeIcon = 'fa-box';
                                                    orderTypeTitle = '现货订单 - 下单时已自动扣除库存';
                                                } else if (hasUnlimitedItems && !hasLimitedItems) {
                                                    // 纯预购订单
                                                    if (isManuallyDeducted) {
                                                        orderTypeLabel = '预购·已扣库存';
                                                        orderTypeColor = 'bg-amber-100 text-amber-700 border-amber-300';
                                                        orderTypeIcon = 'fa-clock-rotate-left';
                                                        orderTypeTitle = '预购订单 - 已手动提前扣除库存';
                                                    } else {
                                                        orderTypeLabel = '预购';
                                                        orderTypeColor = 'bg-purple-100 text-purple-700 border-purple-300';
                                                        orderTypeIcon = 'fa-clock';
                                                        orderTypeTitle = '预购订单 - 未扣库存（到货后再发）';
                                                    }
                                                } else if (hasLimitedItems && hasUnlimitedItems) {
                                                    // 混合订单
                                                    if (isManuallyDeducted) {
                                                        orderTypeLabel = '混合·已扣库存';
                                                        orderTypeColor = 'bg-amber-100 text-amber-700 border-amber-300';
                                                        orderTypeIcon = 'fa-layer-group';
                                                        orderTypeTitle = '混合订单（现货+预购） - 已手动扣除库存';
                                                    } else {
                                                        orderTypeLabel = '混合订单';
                                                        orderTypeColor = 'bg-blue-100 text-blue-700 border-blue-300';
                                                        orderTypeIcon = 'fa-layer-group';
                                                        orderTypeTitle = '混合订单（现货+预购） - 现货部分已扣库存';
                                                    }
                                                }
                                                
                                                return (
                                                <tr key={order.id} className="border-b align-top hover:bg-white">
                                                    <td className="p-3">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="font-medium text-blue-600">{order.order_id}</span>
                                                            {orderTypeLabel && (
                                                                <span 
                                                                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${orderTypeColor}`}
                                                                    title={orderTypeTitle}
                                                                >
                                                                    <i className={`fas ${orderTypeIcon} mr-1`}></i>{orderTypeLabel}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-gray-500 mt-1">
                                                            {order.remarks && order.remarks.includes('🏪 POS现场销售') ? (
                                                                <span className="bg-orange-100 text-orange-800 px-2 py-1 rounded-full font-medium">
                                                                    🏪 现场销售
                                                                </span>
                                                            ) : (
                                                                order.delivery_method === 'self-pickup' ? '自提' : 'Lalamove'
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="p-3 text-xs max-w-xs break-words">
                                                        {(order.order_items || []).map((item, index) => {
                                                            console.log(`订单 ${order.order_id} - 产品 ${item.product} - 库存流水记录数:`, stockTransactions.length);
                                                            console.log('所有流水记录:', stockTransactions);
                                                            // 从库存流水记录中查找此订单此产品的所有出库记录
                                                            const deliveryTransactions = stockTransactions.filter(trans => {
                                                                const isMatchingType = ['partial_delivery', 'stock_out', 'manual_order'].includes(trans.transaction_type); // 兼容旧数据
                                                                const isMatchingOrder = trans.order_id === order.order_id;
                                                                const isMatchingProduct = trans.product?.name === item.product;
                                                                const isOutbound = trans.quantity < 0; // 负数表示出库
                                                                
                                                                console.log(`产品 ${item.product} 检查流水:`, {
                                                                    transId: trans.id,
                                                                    transType: trans.transaction_type,
                                                                    orderId: trans.order_id,
                                                                    productName: trans.product?.name,
                                                                    quantity: trans.quantity,
                                                                    isMatchingType,
                                                                    isMatchingOrder,
                                                                    isMatchingProduct,
                                                                    isOutbound
                                                                });
                                                                
                                                                return isMatchingType && isMatchingOrder && isMatchingProduct && isOutbound;
                                                            });
                                                            const deliveredQuantity = deliveryTransactions.reduce((sum, trans) => sum + Math.abs(trans.quantity), 0);
                                                            const remainingQuantity = Math.max(0, item.quantity - deliveredQuantity);
                                                            
                                                            console.log(`产品 ${item.product} - 总数量: ${item.quantity}, 已发货: ${deliveredQuantity}, 剩余: ${remainingQuantity}`);
                                                            
                                                            return (
                                                                <div key={index} className="mb-1">
                                                                    <div className="flex items-center gap-1">
                                                                        <span className="mr-1">{item.emoji || '▫️'}</span>
                                                                        <span className="font-medium">{item.product}</span>
                                                                        <span className="text-gray-600">× {item.quantity}</span>
                                                                        {deliveredQuantity > 0 && deliveredQuantity < item.quantity && (
                                                                            <span className="text-xs bg-yellow-100 text-yellow-800 px-1 rounded font-medium">
                                                                                部分发货
                                                                            </span>
                                                                        )}
                                                                        {deliveredQuantity >= item.quantity && (
                                                                            <span className="text-xs bg-green-100 text-green-800 px-1 rounded font-medium">
                                                                                已发完
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    {deliveredQuantity > 0 && (
                                                                        <div className="ml-4 text-xs space-y-1">
                                                                            <div className="text-blue-600 bg-blue-50 px-2 py-1 rounded">
                                                                                <i className="fas fa-truck mr-1"></i>
                                                                                已发货：{deliveredQuantity}
                                                                            </div>
                                                                            {remainingQuantity > 0 && (
                                                                                <div className="text-orange-600 bg-orange-50 px-2 py-1 rounded">
                                                                                    <i className="fas fa-clock mr-1"></i>
                                                                                    待发货：{remainingQuantity}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                        {order.remarks && (
                                                            <div className={`mt-2 italic text-xs ${
                                                                order.remarks.includes('🏪 POS现场销售') 
                                                                    ? 'text-orange-700 bg-orange-50 p-2 rounded border-l-2 border-orange-400' 
                                                                    : 'text-gray-500'
                                                            }`}>
                                                                {order.remarks.includes('🏪 POS现场销售') && (
                                                                    <span className="font-medium">🏪 现场销售 | </span>
                                                                )}
                                                                备注: {order.remarks}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-red-600 font-semibold">RM{(order.total_amount || 0).toFixed(2)}</td>
                                                    <td className="p-3">
                                                        <select 
                                                            className="text-xs border rounded px-2 py-1 bg-white" 
                                                            value={order.status} 
                                                            onChange={(e) => updateStatus(order.id, e.target.value)} 
                                                            disabled={updating === order.id}
                                                        >
                                                            <option value="pending">待处理</option>
                                                            <option value="partial delivered">部分已发</option>
                                                            <option value="ready for pick up">待取货</option>
                                                            <option value="delivered">已发货</option>
                                                            <option value="completed">已完成</option>
                                                            <option value="cancelled">已取消</option>
                                                        </select>
                                                    </td>
                                                    <td className="p-3 text-xs text-gray-500">{new Date(order.created_at).toLocaleString('zh-CN')}</td>
                                                    <td className="p-3">
                                                        <div className="space-y-1 flex flex-col items-start min-w-[110px]">
                                                            {order.payment_proof_url && <a href={order.payment_proof_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-xs underline hover:text-blue-800">支付凭证</a>}
                                                            <button onClick={() => copyDetails(order)} className="bg-teal-500 hover:bg-teal-600 text-white text-xs rounded px-2 py-1 w-full text-left">复制详情</button>
                                                            <button onClick={async () => await printOrder(order, stockTransactions, fetchStockTransactions)} className="bg-indigo-500 hover:bg-indigo-600 text-white text-xs rounded px-2 py-1 w-full text-left">打印订单</button>
                                                            {/* 部分发货按钮 */}
                                                            {(order.status === 'pending' || order.status === 'ready for pick up') && (
                                                                <button 
                                                                    onClick={() => handlePartialDelivery(order)} 
                                                                    className="bg-orange-500 hover:bg-orange-600 text-white text-xs rounded px-2 py-1 w-full text-left"
                                                                    title="部分发货，自动扣减库存">
                                                                    <i className="fas fa-boxes mr-1"></i>部分发货
                                                                </button>
                                                            )}
                                                            {/* 直接打包按钮 */}
                                                            {order.status === 'pending' ? (
                                                                <button 
                                                                    onClick={() => startDirectPacking(order)} 
                                                                    className="bg-purple-600 hover:bg-purple-700 text-white text-xs rounded px-2 py-1 w-full text-left"
                                                                    title="跳过扫描直接开始打包">
                                                                    <i className="fas fa-box mr-1"></i>直接打包
                                                                </button>
                                                            ) : order.status === 'ready for pick up' && order.packing_completed_at ? (
                                                                <button 
                                                                    className="bg-green-100 text-green-700 border border-green-300 text-xs rounded px-2 py-1 w-full text-left cursor-not-allowed"
                                                                    disabled
                                                                    title={`打包完成时间: ${new Date(order.packing_completed_at).toLocaleString('zh-CN')}`}>
                                                                    <i className="fas fa-check-circle mr-1"></i>已完成打包
                                                                </button>
                                                            ) : null}
                                                            {/* 根据订单类型显示不同的库存操作按钮 */}
                                                            {hasLimitedItems && !hasUnlimitedItems && !isManuallyDeducted ? (
                                                                // 纯现货订单 - 已自动扣库存
                                                                <button 
                                                                    className="bg-green-100 text-green-700 border border-green-300 text-xs rounded px-2 py-1 w-full text-left cursor-not-allowed"
                                                                    disabled
                                                                    title="现货订单下单时已自动扣除库存"
                                                                >
                                                                    <i className="fas fa-check-circle mr-1"></i>已自动扣库存
                                                                </button>
                                                            ) : isManuallyDeducted ? (
                                                                // 已手动扣库存
                                                                <button 
                                                                    className="bg-amber-100 text-amber-700 border border-amber-300 text-xs rounded px-2 py-1 w-full text-left cursor-not-allowed"
                                                                    disabled
                                                                    title="此订单已手动扣库存，无法重复操作"
                                                                >
                                                                    <i className="fas fa-check-circle mr-1"></i>已手动扣库存
                                                                </button>
                                                            ) : (
                                                                // 可以手动扣库存（预购或混合订单）
                                                                <div className="space-y-1">
                                                                    <button 
                                                                        onClick={() => handleManualStockDeduction(order)} 
                                                                        disabled={updating === order.id}
                                                                        className="bg-red-600 hover:bg-red-700 text-white text-xs rounded px-2 py-1 w-full text-left disabled:bg-gray-400"
                                                                        title="提前发货 - 从现有库存扣除"
                                                                    >
                                                                        <i className="fas fa-box-open mr-1"></i>手动扣库存
                                                                    </button>
                                                                    <button 
                                                                        onClick={() => {
                                                                            const deliveryData = (order.order_items || []).map(item => ({
                                                                                productId: item.product_id,
                                                                                productName: item.product,
                                                                                orderedQuantity: item.quantity || 0,
                                                                                deliveryQuantity: (item.quantity || 0).toString()
                                                                            }));
                                                                            setPartialDeliveryOrder(order);
                                                                            setPartialDeliveryData(deliveryData);
                                                                            setShowPartialDeliveryModal(true);
                                                                        }}
                                                                        disabled={updating === order.id}
                                                                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs rounded px-2 py-1 w-full text-left disabled:bg-gray-400"
                                                                        title="部分发货 - 发货部分数量"
                                                                    >
                                                                        <i className="fas fa-shipping-fast mr-1"></i>部分发货
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )})}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}
                        {groupedOrders.length === 0 && (
                            <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                                <i className="fas fa-clipboard-check text-4xl text-gray-400 mb-3"></i>
                                <p className="text-gray-600 font-medium">没有待处理的订单需要分组</p>
                                <p className="text-sm text-gray-500 mt-2">所有订单都已处理完毕 🎉</p>
                            </div>
                        )}
                    </div>
                ) : (
                    // 原有的订单列表显示
                <table className="w-full text-sm">
                    <thead className="bg-gray-100"><tr><th className="p-3 text-left">订单号</th><th className="p-3 text-left">客户信息</th><th className="p-3 text-left">订单明细</th><th className="p-3 text-left">金额</th><th className="p-3 text-left">状态</th><th className="p-3 text-left">下单时间</th><th className="p-3 text-left">操作</th></tr></thead>
                    <tbody>
                        {filteredOrders.map(order => {
                            const hasUnlimitedItems = order.order_items?.some(item => item.is_unlimited);
                            const hasLimitedItems = order.order_items?.some(item => !item.is_unlimited);
                            const isManuallyDeducted = manuallyDeductedOrders.has(order.order_id);
                            
                            // 判断订单类型
                            let orderTypeLabel = '';
                            let orderTypeColor = '';
                            let orderTypeIcon = '';
                            let orderTypeTitle = '';
                            
                            if (hasLimitedItems && !hasUnlimitedItems) {
                                // 纯现货订单
                                orderTypeLabel = '现货';
                                orderTypeColor = 'bg-green-100 text-green-700 border-green-300';
                                orderTypeIcon = 'fa-box';
                                orderTypeTitle = '现货订单 - 下单时已自动扣除库存';
                            } else if (hasUnlimitedItems && !hasLimitedItems) {
                                // 纯预购订单
                                if (isManuallyDeducted) {
                                    orderTypeLabel = '预购·已扣库存';
                                    orderTypeColor = 'bg-amber-100 text-amber-700 border-amber-300';
                                    orderTypeIcon = 'fa-clock-rotate-left';
                                    orderTypeTitle = '预购订单 - 已手动提前扣除库存';
                                } else {
                                    orderTypeLabel = '预购';
                                    orderTypeColor = 'bg-purple-100 text-purple-700 border-purple-300';
                                    orderTypeIcon = 'fa-clock';
                                    orderTypeTitle = '预购订单 - 未扣库存（到货后再发）';
                                }
                            } else if (hasLimitedItems && hasUnlimitedItems) {
                                // 混合订单
                                if (isManuallyDeducted) {
                                    orderTypeLabel = '混合·已扣库存';
                                    orderTypeColor = 'bg-amber-100 text-amber-700 border-amber-300';
                                    orderTypeIcon = 'fa-layer-group';
                                    orderTypeTitle = '混合订单（现货+预购） - 已手动扣除库存';
                                } else {
                                    orderTypeLabel = '混合订单';
                                    orderTypeColor = 'bg-blue-100 text-blue-700 border-blue-300';
                                    orderTypeIcon = 'fa-layer-group';
                                    orderTypeTitle = '混合订单（现货+预购） - 现货部分已扣库存';
                                }
                            }
                            
                            return (
                            <tr key={order.id} className={`border-b align-top hover:bg-gray-50 ${
                                order.remarks && order.remarks.includes('POS现场销售') 
                                    ? 'bg-orange-50 border-l-4 border-orange-400' 
                                    : ''
                            }`}>
                                <td className="p-3">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-blue-600">{order.order_id}</span>
                                        {orderTypeLabel && (
                                            <span 
                                                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${orderTypeColor}`}
                                                title={orderTypeTitle}
                                            >
                                                <i className={`fas ${orderTypeIcon} mr-1`}></i>{orderTypeLabel}
                                            </span>
                                        )}
                                        {/* 已完成/已发货订单的整体标记 */}
                                        {(order.status === 'completed' || order.status === 'delivered') && (
                                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-green-50 text-green-700 border border-green-300">
                                                <i className="fas fa-check-circle mr-1"></i>已完成
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        {order.remarks && order.remarks.includes('POS现场销售') ? (
                                            <span className="bg-orange-100 text-orange-800 px-2 py-1 rounded-full font-medium">
                                                🏪 现场销售
                                            </span>
                                        ) : (
                                            order.delivery_method === 'self-pickup' ? '自提' : 'Lalamove'
                                        )}
                                    </div>
                                </td>
                                <td className="p-3"><div className="font-medium">{order.name}</div><div className="text-xs text-gray-500">{order.phone}</div></td>
                                <td className="p-3 text-xs max-w-xs break-words">
                                    {/* ✅ 已完成或已发货的订单：简化显示，不显示详细发货进度 */}
                                    {/* ⚠️ 注意：partial delivered 订单仍需显示进度！*/}
                                    {(order.status === 'completed' || order.status === 'delivered') ? (
                                        <div>
                                            {(order.order_items || []).map((item, index) => (
                                                <div key={index} className="mb-1">
                                                    <span className="mr-1">{item.emoji || '▫️'}</span>
                                                    <span className="font-medium">{item.product}</span>
                                                    <span className="text-gray-600">× {item.quantity}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        /* 未完成订单（pending, partial delivered, ready for pick up）：显示详细发货进度 */
                                        <div>
                                            {(order.order_items || []).map((item, index) => {
                                                // 从库存流水记录中查找此订单此产品的所有出库记录
                                                const deliveryTransactions = stockTransactions.filter(trans => {
                                                    const isMatchingType = ['partial_delivery', 'stock_out', 'manual_order'].includes(trans.transaction_type);
                                                    const isMatchingOrder = trans.order_id === order.order_id;
                                                    const isMatchingProduct = trans.product?.name === item.product;
                                                    const isOutbound = trans.quantity < 0; // 负数表示出库
                                                    return isMatchingType && isMatchingOrder && isMatchingProduct && isOutbound;
                                                });
                                                const deliveredQuantity = deliveryTransactions.reduce((sum, trans) => sum + Math.abs(trans.quantity), 0);
                                                const remainingQuantity = Math.max(0, item.quantity - deliveredQuantity);
                                                
                                                return (
                                                    <div key={index} className="mb-1">
                                                        <div className="flex items-center gap-1">
                                                            <span className="mr-1">{item.emoji || '▫️'}</span>
                                                            <span className="font-medium">{item.product}</span>
                                                            <span className="text-gray-600">× {item.quantity}</span>
                                                            {deliveredQuantity > 0 && deliveredQuantity < item.quantity && (
                                                                <span className="text-xs bg-yellow-100 text-yellow-800 px-1 rounded font-medium">
                                                                    部分发货
                                                                </span>
                                                            )}
                                                            {deliveredQuantity >= item.quantity && deliveredQuantity > 0 && (
                                                                <span className="text-xs bg-green-100 text-green-800 px-1 rounded font-medium">
                                                                    已发完
                                                                </span>
                                                            )}
                                                        </div>
                                                        {deliveredQuantity > 0 && (
                                                            <div className="ml-4 text-xs space-y-1">
                                                                <div className="text-blue-600 bg-blue-50 px-2 py-1 rounded">
                                                                    <i className="fas fa-truck mr-1"></i>
                                                                    已发货：{deliveredQuantity}
                                                                </div>
                                                                {remainingQuantity > 0 && (
                                                                    <div className="text-orange-600 bg-orange-50 px-2 py-1 rounded">
                                                                        <i className="fas fa-clock mr-1"></i>
                                                                        待发货：{remainingQuantity}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {order.remarks && (
                                        <div className={`mt-2 italic text-xs ${order.remarks.includes('POS现场销售') ? 'text-orange-700 bg-orange-50 p-2 rounded border-l-2 border-orange-400' : 'text-gray-500'}`}>
                                            {order.remarks.includes('POS现场销售') && (
                                                <span className="font-medium">🏪 现场销售 | </span>
                                            )}
                                            备注: {order.remarks}
                                        </div>
                                    )}
                                </td>
                                <td className="p-3 text-red-600 font-semibold">RM{(order.total_amount || 0).toFixed(2)}</td>
                                <td className="p-3"><select className="text-xs border rounded px-2 py-1 bg-white" value={order.status} onChange={(e) => updateStatus(order.id, e.target.value)} disabled={updating === order.id}><option value="pending">待处理</option><option value="partial delivered">部分已发</option><option value="ready for pick up">待取货</option><option value="delivered">已发货</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></td>
                                <td className="p-3 text-xs text-gray-500">{new Date(order.created_at).toLocaleString('zh-CN')}</td>
                                <td className="p-3"><div className="space-y-1 flex flex-col items-start min-w-[110px]">
                                    {order.payment_proof_url && <a href={order.payment_proof_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-xs underline hover:text-blue-800">支付凭证</a>}
                                    <button onClick={() => copyDetails(order)} className="bg-teal-500 hover:bg-teal-600 text-white text-xs rounded px-2 py-1 w-full text-left">复制详情</button>
                                    <button onClick={() => setUploadModal(order)} className="bg-purple-500 hover:bg-purple-600 text-white text-xs rounded px-2 py-1 w-full text-left">上传运费凭证</button>
                                    <button onClick={() => sendShippingWhatsapp(order)} className="bg-orange-500 hover:bg-orange-600 text-white text-xs rounded px-2 py-1 w-full text-left">发送运费信息</button>
                                    <button onClick={async () => await printOrder(order, stockTransactions, fetchStockTransactions)} className="bg-indigo-500 hover:bg-indigo-600 text-white text-xs rounded px-2 py-1 w-full text-left">打印订单</button>
                                    {/* 部分发货按钮 */}
                                    {(order.status === 'pending' || order.status === 'ready for pick up') && (
                                        <button 
                                            onClick={() => handlePartialDelivery(order)} 
                                            className="bg-amber-500 hover:bg-amber-600 text-white text-xs rounded px-2 py-1 w-full text-left"
                                            title="部分发货，自动扣减库存">
                                            <i className="fas fa-boxes mr-1"></i>部分发货
                                        </button>
                                    )}
                                    {/* 直接打包按钮 */}
                                    {order.status === 'pending' ? (
                                        <button 
                                            onClick={() => startDirectPacking(order)} 
                                            className="bg-purple-600 hover:bg-purple-700 text-white text-xs rounded px-2 py-1 w-full text-left"
                                            title="跳过扫描直接开始打包">
                                            <i className="fas fa-box mr-1"></i>直接打包
                                        </button>
                                    ) : order.status === 'ready for pick up' && order.packing_completed_at ? (
                                        <button 
                                            className="bg-green-100 text-green-700 border border-green-300 text-xs rounded px-2 py-1 w-full text-left cursor-not-allowed"
                                            disabled
                                            title={`打包完成时间: ${new Date(order.packing_completed_at).toLocaleString('zh-CN')}`}>
                                            <i className="fas fa-check-circle mr-1"></i>已完成打包
                                        </button>
                                    ) : null}
                                    {/* 根据订单类型显示不同的库存操作按钮 */}
                                    {hasLimitedItems && !hasUnlimitedItems && !isManuallyDeducted ? (
                                        // 纯现货订单 - 已自动扣库存
                                        <button 
                                            className="bg-green-100 text-green-700 border border-green-300 text-xs rounded px-2 py-1 w-full text-left cursor-not-allowed"
                                            disabled
                                            title="现货订单下单时已自动扣除库存"
                                        >
                                            <i className="fas fa-check-circle mr-1"></i>已自动扣库存
                                        </button>
                                    ) : isManuallyDeducted ? (
                                        // 已手动扣库存
                                        <button 
                                            className="bg-amber-100 text-amber-700 border border-amber-300 text-xs rounded px-2 py-1 w-full text-left cursor-not-allowed"
                                            disabled
                                            title="此订单已手动扣库存，无法重复操作"
                                        >
                                            <i className="fas fa-check-circle mr-1"></i>已手动扣库存
                                        </button>
                                    ) : (
                                        // 可以手动扣库存（预购或混合订单）
                                        <button 
                                            onClick={() => handleManualStockDeduction(order)} 
                                            disabled={updating === order.id}
                                            className="bg-red-600 hover:bg-red-700 text-white text-xs rounded px-2 py-1 w-full text-left disabled:bg-gray-400"
                                            title="提前发货 - 从现有库存扣除"
                                        >
                                            <i className="fas fa-box-open mr-1"></i>手动扣库存
                                        </button>
                                    )}
                                    {order.shipping_payment_proof_url && <a href={order.shipping_payment_proof_url} target="_blank" rel="noopener noreferrer" className="text-purple-600 text-xs underline hover:text-purple-800">运费凭证</a>}
                                </div></td>
                            </tr>
                        )})}
                    </tbody>
                </table>
                )}
                {!groupByCustomer && filteredOrders.length === 0 && <div className="text-center py-8 text-gray-500">没有找到符合条件的订单</div>}
            </div>
            {uploadModal && ReactDOM.createPortal(
                <div 
                    className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center p-4"
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 99999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'auto'
                    }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setUploadModal(null);
                        }
                    }}
                >
                    <div 
                        className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col p-6"
                        style={{ maxHeight: '90vh', overflow: 'auto' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="font-bold mb-4">上传运费凭证 for #{uploadModal.order_id}</h3>
                        <input 
                            type="file" 
                            onChange={(e) => setUploadFile(e.target.files ? e.target.files[0] : null)} 
                            className="w-full border p-2 rounded mb-4"
                        />
                        <div className="flex justify-end gap-2">
                            <button 
                                onClick={() => setUploadModal(null)} 
                                className="px-4 py-2 bg-gray-200 rounded"
                            >
                                取消
                            </button>
                            <button 
                                onClick={handleUploadProof} 
                                disabled={!uploadFile} 
                                className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-gray-300"
                            >
                                上传
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            
            {/* 部分发货模态框 */}
            {showPartialDeliveryModal && partialDeliveryOrder && ReactDOM.createPortal(
                <div 
                    className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center p-4"
                    style={{ zIndex: 99999 }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setShowPartialDeliveryModal(false);
                        }
                    }}
                >
                    <div 
                        className="bg-white rounded-lg shadow-xl w-full max-w-4xl"
                        style={{ maxHeight: '90vh', overflow: 'auto' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 头部 */}
                        <div className="bg-gradient-to-r from-amber-500 to-amber-600 text-white p-6 rounded-t-lg">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-2xl font-bold mb-2">
                                        <i className="fas fa-boxes mr-2"></i>
                                        订单部分发货
                                    </h3>
                                    <div className="text-amber-100 text-sm">
                                        订单号：{partialDeliveryOrder.order_id} | 客户：{partialDeliveryOrder.name}
                                    </div>
                                </div>
                                <button 
                                    onClick={() => setShowPartialDeliveryModal(false)}
                                    className="text-white hover:bg-white/20 rounded-full p-2 transition-all"
                                >
                                    <i className="fas fa-times text-xl"></i>
                                </button>
                            </div>
                        </div>
                        
                        {/* 内容 */}
                        <div className="p-6">
                            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded mb-6">
                                <div className="flex items-start">
                                    <i className="fas fa-exclamation-triangle text-yellow-500 mt-1 mr-3"></i>
                                    <div>
                                        <p className="font-semibold text-yellow-800">部分发货说明</p>
                                        <p className="text-sm text-yellow-600 mt-1">
                                            选择要发货的产品和数量，系统将自动扣减相应库存。建议根据实际出货情况进行部分发货。
                                        </p>
                                    </div>
                                </div>
                            </div>
                            
                            {/* 产品列表 */}
                            <div className="bg-gray-50 rounded-lg overflow-hidden">
                                <div className="bg-gradient-to-r from-gray-600 to-gray-700 text-white px-4 py-3 font-semibold">
                                    <i className="fas fa-list-ul mr-2"></i>
                                    选择发货产品和数量
                                </div>
                                
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-200">
                                            <tr>
                                                <th className="p-3 text-left">产品名称</th>
                                                <th className="p-3 text-center">订单数量</th>
                                                <th className="p-3 text-center">当前库存</th>
                                                <th className="p-3 text-center">发货数量</th>
                                                <th className="p-3 text-center">单价</th>
                                                <th className="p-3 text-center">小计</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(partialDeliveryOrder.order_items || []).map((item, idx) => {
                                                const product = products.find(p => p.name === item.product);
                                                const currentStock = product?.stock_quantity || 0;
                                                const deliveryQty = partialDeliveryData[item.product || ''] || 0;
                                                const subtotal = deliveryQty * item.price;
                                                
                                                return (
                                                    <tr key={idx} className="border-b hover:bg-gray-50">
                                                        <td className="p-3">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-lg">{item.emoji || '📦'}</span>
                                                                <div>
                                                                    <div className="font-medium text-gray-800">{item.product}</div>
                                                                    {item.is_unlimited && (
                                                                        <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">预购商品</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        
                                                        <td className="p-3 text-center">
                                                            <span className="inline-flex items-center justify-center bg-blue-100 text-blue-800 px-3 py-1 rounded-full font-medium">
                                                                {item.quantity}
                                                            </span>
                                                        </td>
                                                        
                                                        <td className="p-3 text-center">
                                                            <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full font-medium ${
                                                                currentStock < item.quantity 
                                                                    ? 'bg-red-100 text-red-800' 
                                                                    : currentStock <= (product?.min_stock_threshold || 5)
                                                                    ? 'bg-yellow-100 text-yellow-800'
                                                                    : 'bg-green-100 text-green-800'
                                                            }`}>
                                                                {currentStock}
                                                            </span>
                                                        </td>
                                                        
                                                        <td className="p-3 text-center">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    max={Math.min(item.quantity, currentStock)}
                                                                    value={deliveryQty}
                                                                    onChange={(e) => {
                                                                        const value = Math.min(
                                                                            parseInt(e.target.value) || 0, 
                                                                            Math.min(item.quantity, currentStock)
                                                                        );
                                                                        setPartialDeliveryData(prev => ({
                                                                            ...prev,
                                                                            [item.product || '']: value
                                                                        }));
                                                                    }}
                                                                    className="w-16 px-2 py-1 border border-gray-300 rounded text-center focus:outline-none focus:ring-2 focus:ring-amber-500"
                                                                />
                                                                <button
                                                                    onClick={() => {
                                                                        const maxQty = Math.min(item.quantity, currentStock);
                                                                        setPartialDeliveryData(prev => ({
                                                                            ...prev,
                                                                            [item.product || '']: maxQty
                                                                        }));
                                                                    }}
                                                                    className="text-xs text-amber-600 hover:text-amber-800 px-2 py-1 bg-amber-100 rounded"
                                                                    title="最大可发货"
                                                                >
                                                                    最大
                                                                </button>
                                                            </div>
                                                        </td>
                                                        
                                                        <td className="p-3 text-center text-gray-700">
                                                            RM{item.price.toFixed(2)}
                                                        </td>
                                                        
                                                        <td className="p-3 text-center">
                                                            <span className="font-bold text-gray-800">
                                                                RM{subtotal.toFixed(2)}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot className="bg-gradient-to-r from-gray-100 to-gray-200">
                                            <tr>
                                                <td colSpan={5} className="p-4 text-right font-bold text-gray-800">
                                                    部分发货总计：
                                                </td>
                                                <td className="p-4 text-center">
                                                    <span className="font-bold text-amber-600 text-lg">
                                                        RM{(() => {
                                                            let total = 0;
                                                            (partialDeliveryOrder.order_items || []).forEach(item => {
                                                                const deliveryQty = partialDeliveryData[item.product || ''] || 0;
                                                                total += deliveryQty * item.price;
                                                            });
                                                            return total.toFixed(2);
                                                        })()}
                                                    </span>
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        </div>
                        
                        {/* 底部操作按钮 */}
                        <div className="border-t p-6 bg-gray-50 flex gap-3 justify-end rounded-b-lg">
                            <button
                                onClick={() => setShowPartialDeliveryModal(false)}
                                className="px-6 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg font-medium transition-all"
                            >
                                <i className="fas fa-times mr-2"></i>
                                取消
                            </button>
                            <button
                                onClick={handleConfirmPartialDelivery}
                                disabled={updating !== null || (() => {
                                    return !Object.values(partialDeliveryData).some((qty: any) => (qty as number) > 0);
                                })()}
                                className="px-6 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-lg font-medium transition-all shadow-lg disabled:bg-gray-300 disabled:cursor-not-allowed"
                            >
                                {updating ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin mr-2"></i>
                                        处理中...
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-check mr-2"></i>
                                        确认部分发货
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            
            {/* 库存流水管理模态框 */}
            {showTransactionModal && ReactDOM.createPortal(
                <div 
                    className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center p-4"
                    style={{ zIndex: 99999 }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setShowTransactionModal(false);
                        }
                    }}
                >
                    <div 
                        className="bg-white rounded-lg shadow-xl w-full max-w-6xl"
                        style={{ maxHeight: '90vh', overflow: 'auto' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 头部 */}
                        <div className="bg-gradient-to-r from-amber-500 to-amber-600 text-white p-6 rounded-t-lg">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-2xl font-bold mb-2">
                                        <i className="fas fa-history mr-2"></i>
                                        库存流水管理与回滚
                                    </h3>
                                    <div className="text-amber-100 text-sm">
                                        查看库存变动记录，单独回滚手动调整操作
                                    </div>
                                </div>
                                <button 
                                    onClick={() => setShowTransactionModal(false)}
                                    className="text-white hover:bg-white/20 rounded-full p-2 transition-all"
                                >
                                    <i className="fas fa-times text-xl"></i>
                                </button>
                            </div>
                        </div>
                        
                        {/* 内容 */}
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h4 className="text-lg font-semibold text-gray-800">库存交易记录</h4>
                                    <p className="text-sm text-gray-600">显示最近100条库存变动记录，可单独回滚手动调整</p>
                                </div>
                                <button
                                    onClick={fetchStockTransactions}
                                    disabled={loadingTransactions}
                                    className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:bg-gray-400">
                                    {loadingTransactions ? (
                                        <><i className="fas fa-spinner fa-spin mr-2"></i>加载中...</>
                                    ) : (
                                        <><i className="fas fa-sync-alt mr-2"></i>刷新记录</>
                                    )}
                                </button>
                            </div>
                            
                            {/* 说明提示 */}
                            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded mb-6">
                                <div className="flex items-start">
                                    <i className="fas fa-info-circle text-blue-500 mt-1 mr-3"></i>
                                    <div>
                                        <p className="font-semibold text-blue-800">✨ 库存回滚功能（已升级）</p>
                                        <p className="text-sm text-blue-600 mt-1">
                                            • ✅ <strong>支持多种操作回滚</strong>：订单出库、部分发货、手动调整、手动入库/出库等<br/>
                                            • ✅ 每条记录都可以<strong>单独回滚</strong>，互不影响<br/>
                                            • ✅ 回滚操作会将库存恢复到操作前的数量，并自动记录回滚流水<br/>
                                            • ⚠️ 已回滚的记录会标记为"已回滚"，<strong>不能重复回滚</strong><br/>
                                            • 🔒 回滚操作本身不可再次回滚，防止数据混乱
                                        </p>
                                    </div>
                                </div>
                            </div>
                            
                            {/* 交易记录表格 */}
                            <div className="bg-gray-50 rounded-lg overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-200">
                                            <tr>
                                                <th className="p-3 text-left">时间</th>
                                                <th className="p-3 text-left">产品</th>
                                                <th className="p-3 text-left">操作类型</th>
                                                <th className="p-3 text-left">数量变动</th>
                                                <th className="p-3 text-left">库存变化</th>
                                                <th className="p-3 text-left">原因说明</th>
                                                <th className="p-3 text-left">操作人</th>
                                                <th className="p-3 text-center">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {stockTransactions.length === 0 ? (
                                                <tr>
                                                    <td colSpan={8} className="p-8 text-center text-gray-500">
                                                        <i className="fas fa-inbox text-4xl mb-2 text-gray-300"></i>
                                                        <p>暂无库存交易记录</p>
                                                    </td>
                                                </tr>
                                            ) : (
                                                stockTransactions.map(trans => {
                                                    const product = trans.product || { name: `产品#${trans.product_id}`, emoji: '📦' };
                                                    const typeConfig = {
                                                        stock_in: { label: '入库', color: 'bg-green-100 text-green-800', icon: 'fa-arrow-up' },
                                                        stock_out: { label: '出库', color: 'bg-orange-100 text-orange-800', icon: 'fa-arrow-down' },
                                                        order: { label: '订单出库', color: 'bg-blue-100 text-blue-800', icon: 'fa-shopping-cart' },
                                                        manual_order: { label: '手动扣库存', color: 'bg-red-100 text-red-800', icon: 'fa-box-open' },
                                                        manual_adjustment: { label: '手动调整', color: 'bg-yellow-100 text-yellow-800', icon: 'fa-edit' },
                                                        manual_in: { label: '手动入库', color: 'bg-green-100 text-green-800', icon: 'fa-plus' },
                                                        manual_out: { label: '手动出库', color: 'bg-red-100 text-red-800', icon: 'fa-minus' },
                                                        stock_adjustment: { label: '库存调整', color: 'bg-yellow-100 text-yellow-800', icon: 'fa-edit' },
                                                        stock_adjustment_reversal: { label: '调整回滚', color: 'bg-purple-100 text-purple-800', icon: 'fa-undo' },
                                                        partial_delivery: { label: '部分发货', color: 'bg-blue-100 text-blue-800', icon: 'fa-shipping-fast' },
                                                        tasting: { label: '内部试吃', color: 'bg-purple-100 text-purple-800', icon: 'fa-utensils' }
                                                    }[trans.transaction_type] || { label: trans.transaction_type, color: 'bg-gray-100 text-gray-800', icon: 'fa-question' };
                                                    
                                                    // 🔑 检查是否已被回滚（是否有其他记录的 reversal_of 字段指向此记录）
                                                    // 注意：需要将两个ID都转为字符串进行比较，避免类型不匹配
                                                    const isReversed = stockTransactions.some(t => 
                                                        t.reversal_of && String(t.reversal_of) === String(trans.id)
                                                    );
                                                    
                                                    // 🆕 扩展可回滚的操作类型（排除回滚操作本身和已被回滚的记录）
                                                    const canReverse = [
                                                        'manual_adjustment', 
                                                        'manual_in', 
                                                        'manual_out', 
                                                        'stock_adjustment', 
                                                        'partial_delivery', 
                                                        'manual_order',
                                                        'order',  // 🆕 支持订单出库回滚
                                                        'stock_out',  // 🆕 支持手动出库回滚
                                                        'stock_in'  // 🆕 支持手动入库回滚
                                                    ].includes(trans.transaction_type) && !isReversed;
                                                    
                                                    return (
                                                        <tr key={trans.id} className={`border-b hover:bg-gray-50 ${isReversed ? 'opacity-60 bg-gray-50' : ''}`}>
                                                            <td className="p-3 text-xs text-gray-600">
                                                                {new Date(trans.created_at).toLocaleString('zh-CN')}
                                                            </td>
                                                            <td className="p-3">
                                                                <div className="flex items-center gap-2">
                                                                    <span>{product.emoji || '📦'}</span>
                                                                    <span className="font-medium">{product.name}</span>
                                                                    {isReversed && (
                                                                        <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded">已回滚</span>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="p-3">
                                                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${typeConfig.color}`}>
                                                                    <i className={`fas ${typeConfig.icon} mr-1`}></i>
                                                                    {typeConfig.label}
                                                                </span>
                                                            </td>
                                                            <td className="p-3">
                                                                <span className={`font-bold ${trans.quantity >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                                    {trans.quantity >= 0 ? '+' : ''}{trans.quantity}
                                                                </span>
                                                            </td>
                                                            <td className="p-3 text-xs text-gray-600">
                                                                {trans.previous_stock} → {trans.new_stock}
                                                            </td>
                                                            <td className="p-3 text-xs max-w-xs">
                                                                <div className="space-y-1">
                                                                    <div>{trans.reason || '-'}</div>
                                                                    {trans.order_id && (
                                                                        <div className="text-blue-600 font-medium">
                                                                            <i className="fas fa-receipt mr-1"></i>订单: {trans.order_id}
                                                                        </div>
                                                                    )}
                                                                    {trans.notes && (
                                                                        <details className="text-gray-600 mt-1">
                                                                            <summary className="cursor-pointer text-blue-600 hover:text-blue-800 text-xs">
                                                                                <i className="fas fa-info-circle mr-1"></i>查看详情
                                                                            </summary>
                                                                            <div className="mt-1 p-2 bg-gray-50 rounded text-xs border border-gray-200">
                                                                                {trans.notes}
                                                                            </div>
                                                                        </details>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="p-3 text-xs">
                                                                <span className={`px-2 py-1 rounded text-xs ${
                                                                    trans.operator === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'
                                                                }`}>
                                                                    {trans.operator === 'admin' ? '👤 管理员' : trans.operator || '系统'}
                                                                </span>
                                                            </td>
                                                            <td className="p-3 text-center">
                                                                {canReverse && !isReversed && (
                                                                    <button
                                                                        onClick={() => handleStockTransactionReversal(trans.id, trans)}
                                                                        disabled={reversalTransactionId === trans.id}
                                                                        className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors disabled:bg-gray-200 disabled:text-gray-500"
                                                                        title={`单独回滚此库存操作 (${trans.transaction_type})`}
                                                                    >
                                                                        {reversalTransactionId === trans.id ? (
                                                                            <><i className="fas fa-spinner fa-spin mr-1"></i>回滚中</>
                                                                        ) : (
                                                                            <><i className="fas fa-undo mr-1"></i>回滚</>
                                                                        )}
                                                                    </button>
                                                                )}
                                                                {isReversed && (
                                                                    <span className="text-xs text-gray-500 px-3 py-1">
                                                                        <i className="fas fa-check mr-1"></i>已回滚
                                                                    </span>
                                                                )}
                                                                {trans.transaction_type === 'stock_adjustment_reversal' && (
                                                                    <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">
                                                                        <i className="fas fa-undo mr-1"></i>回滚操作
                                                                    </span>
                                                                )}
                                                                {!canReverse && !isReversed && trans.transaction_type !== 'stock_adjustment_reversal' && (
                                                                    <span className="text-xs text-gray-400 px-3 py-1">
                                                                        不可回滚
                                                                    </span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                        
                        {/* 底部操作 */}
                        <div className="border-t p-6 bg-gray-50 rounded-b-lg">
                            <div className="flex justify-between items-center">
                                <div className="text-sm text-gray-600">
                                    <i className="fas fa-info-circle mr-1"></i>
                                    显示最近 {stockTransactions.length} 条记录，每条记录可以单独回滚
                                </div>
                                <button
                                    onClick={() => setShowTransactionModal(false)}
                                    className="px-6 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg font-medium transition-all"
                                >
                                    <i className="fas fa-times mr-2"></i>
                                    关闭
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
                </div>
            )}
        </>
    );
};

// ======================================
// 🔹 Stock In Modal Component
// ======================================
const StockInModal: React.FC<{
    product: Product;
    onClose: () => void;
    onConfirm: (productId: number, quantity: number, costPrice: number | null, reason: string, operator: string, notes: string) => void;
    loading: boolean;
}> = ({ product, onClose, onConfirm, loading }) => {
    const [quantity, setQuantity] = useState('');
    const [costPrice, setCostPrice] = useState('');
    const [reason, setReason] = useState('');
    const [operator, setOperator] = useState('');
    const [notes, setNotes] = useState('');
    
    // 当选择"免费赠送"时，自动将成本价设为0
    const handleReasonChange = (newReason: string) => {
        setReason(newReason);
        if (newReason === '免费赠送') {
            setCostPrice('0');
        }
    };
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        const qty = parseInt(quantity);
        if (isNaN(qty) || qty <= 0) {
            alert('请输入有效的入库数量');
            return;
        }
        
        if (!reason.trim()) {
            alert('请输入入库原因');
            return;
        }
        
        if (!operator.trim()) {
            alert('请输入操作人姓名');
            return;
        }
        
        const cost = costPrice.trim() ? parseFloat(costPrice) : null;
        
        onConfirm(product.id, qty, cost, reason, operator, notes);
    };
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-gray-800">
                        <i className="fas fa-plus-circle text-green-600 mr-2"></i>
                        入库操作
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <i className="fas fa-times text-xl"></i>
                    </button>
                </div>
                
                <div className="bg-blue-50 p-4 rounded-lg mb-4">
                    <div className="flex items-center gap-3">
                        <span className="text-3xl">{product.emoji || '📦'}</span>
                        <div>
                            <p className="font-bold text-lg">{product.name}</p>
                            <p className="text-sm text-gray-600">当前库存：{product.stock_quantity || 0} 件</p>
                        </div>
                    </div>
                </div>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <i className="fas fa-boxes text-green-600 mr-1"></i>
                            入库数量 *
                        </label>
                        <input
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                            placeholder="请输入入库数量"
                            min="1"
                            required
                        />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <i className="fas fa-dollar-sign text-green-600 mr-1"></i>
                            单件成本 (选填)
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={costPrice}
                            onChange={(e) => setCostPrice(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                            placeholder="如：12.50"
                            disabled={reason === '免费赠送'}
                        />
                        {reason === '免费赠送' && (
                            <p className="mt-1 text-xs text-gray-500">
                                免费赠送的产品成本自动为 RM 0.00
                            </p>
                        )}
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <i className="fas fa-tag text-green-600 mr-1"></i>
                            入库原因 *
                        </label>
                        <select
                            value={reason}
                            onChange={(e) => handleReasonChange(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                            required>
                            <option value="">请选择原因</option>
                            <option value="供应商进货">供应商进货</option>
                            <option value="免费赠送">🎁 免费赠送（供应商随单赠送）</option>
                            <option value="退货入库">退货入库</option>
                            <option value="盘盈">盘盈</option>
                            <option value="调拨入库">调拨入库</option>
                            <option value="其他">其他</option>
                        </select>
                        {reason === '免费赠送' && (
                            <p className="mt-2 text-xs text-green-600 bg-green-50 p-2 rounded">
                                <i className="fas fa-info-circle mr-1"></i>
                                免费赠送的产品成本自动设为0，可用于内部试吃等用途
                            </p>
                        )}
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <i className="fas fa-user text-green-600 mr-1"></i>
                            操作人 *
                        </label>
                        <input
                            type="text"
                            value={operator}
                            onChange={(e) => setOperator(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                            placeholder="请输入您的姓名"
                            required
                        />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <i className="fas fa-sticky-note text-green-600 mr-1"></i>
                            备注 (选填)
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                            placeholder="如：供应商名称、批次号等"
                            rows={2}
                        />
                    </div>
                    
                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-2 px-4 rounded-lg font-medium transition-colors"
                            disabled={loading}>
                            取消
                        </button>
                        <button
                            type="submit"
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50"
                            disabled={loading}>
                            {loading ? '处理中...' : '确认入库'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// ======================================
// 🔹 Stock Out Modal Component
// ======================================
const StockOutModal: React.FC<{
    product: Product;
    onClose: () => void;
    onConfirm: (productId: number, quantity: number, reason: string, operator: string, notes: string) => void;
    loading: boolean;
}> = ({ product, onClose, onConfirm, loading }) => {
    const [quantity, setQuantity] = useState('');
    const [reason, setReason] = useState('');
    const [operator, setOperator] = useState('');
    const [notes, setNotes] = useState('');
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        const qty = parseInt(quantity);
        if (isNaN(qty) || qty <= 0) {
            alert('请输入有效的出库数量');
            return;
        }
        
        if (qty > (product.stock_quantity || 0)) {
            alert(`出库数量超过当前库存！当前库存：${product.stock_quantity || 0}`);
            return;
        }
        
        if (!reason.trim()) {
            alert('请输入出库原因');
            return;
        }
        
        if (!operator.trim()) {
            alert('请输入操作人姓名');
            return;
        }
        
        onConfirm(product.id, qty, reason, operator, notes);
    };
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-gray-800">
                        <i className="fas fa-minus-circle text-orange-600 mr-2"></i>
                        出库操作
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <i className="fas fa-times text-xl"></i>
                    </button>
                </div>
                
                <div className="bg-orange-50 p-4 rounded-lg mb-4">
                    <div className="flex items-center gap-3">
                        <span className="text-3xl">{product.emoji || '📦'}</span>
                        <div>
                            <p className="font-bold text-lg">{product.name}</p>
                            <p className="text-sm text-gray-600">当前库存：{product.stock_quantity || 0} 件</p>
                        </div>
                    </div>
                </div>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <i className="fas fa-boxes text-orange-600 mr-1"></i>
                            出库数量 *
                        </label>
                        <input
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                            placeholder="请输入出库数量"
                            min="1"
                            max={product.stock_quantity || 0}
                            required
                        />
                        <p className="text-xs text-gray-500 mt-1">最多可出库：{product.stock_quantity || 0} 件</p>
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <i className="fas fa-tag text-orange-600 mr-1"></i>
                            出库原因 *
                        </label>
                        <select
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                            required>
                            <option value="">请选择原因</option>
                            <option value="损坏">损坏</option>
                            <option value="过期">过期</option>
                            <option value="样品赠送">样品赠送</option>
                            <option value="盘亏">盘亏</option>
                            <option value="调拨出库">调拨出库</option>
                            <option value="其他">其他</option>
                        </select>
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <i className="fas fa-user text-orange-600 mr-1"></i>
                            操作人 *
                        </label>
                        <input
                            type="text"
                            value={operator}
                            onChange={(e) => setOperator(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                            placeholder="请输入您的姓名"
                            required
                        />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <i className="fas fa-sticky-note text-orange-600 mr-1"></i>
                            备注 (选填)
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                            placeholder="请详细说明出库情况"
                            rows={2}
                        />
                    </div>
                    
                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-2 px-4 rounded-lg font-medium transition-colors"
                            disabled={loading}>
                            取消
                        </button>
                        <button
                            type="submit"
                            className="flex-1 bg-orange-600 hover:bg-orange-700 text-white py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50"
                            disabled={loading}>
                            {loading ? '处理中...' : '确认出库'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// 内部试吃 Modal
const TastingModal: React.FC<{
    product: Product;
    onClose: () => void;
    onConfirm: (productId: number, quantity: number, operator: string, notes: string) => void;
    loading: boolean;
}> = ({ product, onClose, onConfirm, loading }) => {
    const [quantity, setQuantity] = useState('');
    const [operator, setOperator] = useState('');
    const [notes, setNotes] = useState('');
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        const qty = parseInt(quantity);
        if (isNaN(qty) || qty <= 0) {
            alert('请输入有效的试吃数量');
            return;
        }
        
        if (qty > (product.stock_quantity || 0)) {
            alert(`试吃数量超过当前库存！当前库存：${product.stock_quantity || 0}`);
            return;
        }
        
        if (!operator.trim()) {
            alert('请输入操作人姓名');
            return;
        }
        
        onConfirm(product.id, qty, operator, notes);
    };
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-gray-800">
                        <i className="fas fa-utensils text-purple-600 mr-2"></i>
                        内部试吃记录
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <i className="fas fa-times text-xl"></i>
                    </button>
                </div>
                
                <div className="bg-purple-50 p-4 rounded-lg mb-4">
                    <div className="flex items-center gap-3">
                        <span className="text-3xl">{product.emoji || '📦'}</span>
                        <div>
                            <p className="font-bold text-lg">{product.name}</p>
                            <p className="text-sm text-gray-600">当前库存：{product.stock_quantity || 0} 件</p>
                        </div>
                    </div>
                    <div className="mt-3 p-2 bg-white rounded border border-purple-200">
                        <p className="text-xs text-purple-800">
                            <i className="fas fa-info-circle mr-1"></i>
                            <strong>说明：</strong>内部试吃不计入销售额（免费），但会扣减库存，用于准确追踪成本和盈亏。
                        </p>
                    </div>
                </div>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <i className="fas fa-boxes text-purple-600 mr-1"></i>
                            试吃数量 *
                        </label>
                        <input
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            placeholder="请输入试吃数量"
                            min="1"
                            max={product.stock_quantity || 0}
                            required
                        />
                        <p className="text-xs text-gray-500 mt-1">最多可用：{product.stock_quantity || 0} 件</p>
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <i className="fas fa-user text-purple-600 mr-1"></i>
                            操作人 *
                        </label>
                        <input
                            type="text"
                            value={operator}
                            onChange={(e) => setOperator(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            placeholder="请输入您的姓名"
                            required
                        />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <i className="fas fa-sticky-note text-purple-600 mr-1"></i>
                            备注 (选填)
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            placeholder="例如：试吃人员、试吃场合、产品反馈等"
                            rows={2}
                        />
                    </div>
                    
                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-2 px-4 rounded-lg font-medium transition-colors"
                            disabled={loading}>
                            取消
                        </button>
                        <button
                            type="submit"
                            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50"
                            disabled={loading}>
                            {loading ? '处理中...' : '确认记录'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// 编辑流水记录模态框
const EditTransactionModal: React.FC<{
    transaction: any;
    products: Product[];
    onClose: () => void;
    onSave: (data: { transaction_type: string; reason: string; notes: string }) => void;
    loading: boolean;
}> = ({ transaction, products, onClose, onSave, loading }) => {
    const [transactionType, setTransactionType] = useState(transaction.transaction_type);
    const [reason, setReason] = useState(transaction.reason || '');
    const [notes, setNotes] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            transaction_type: transactionType,
            reason,
            notes
        });
    };

    const product = products.find(p => p.id === transaction.product_id);
    
    const transactionTypeOptions = [
        { value: 'stock_in', label: '入库', icon: 'fa-arrow-up', color: 'text-green-600' },
        { value: 'stock_out', label: '出库', icon: 'fa-arrow-down', color: 'text-orange-600' },
        { value: 'order', label: '订单出库', icon: 'fa-shopping-cart', color: 'text-blue-600' },
        { value: 'manual_order', label: '手动扣库存', icon: 'fa-box-open', color: 'text-red-600' },
        { value: 'partial_delivery', label: '部分发货', icon: 'fa-shipping-fast', color: 'text-blue-600' },
        { value: 'manual_adjustment', label: '手动调整', icon: 'fa-edit', color: 'text-yellow-600' },
        { value: 'manual_in', label: '手动入库', icon: 'fa-plus', color: 'text-green-600' },
        { value: 'manual_out', label: '手动出库', icon: 'fa-minus', color: 'text-red-600' },
        { value: 'stock_adjustment', label: '库存调整', icon: 'fa-edit', color: 'text-yellow-600' },
        { value: 'tasting', label: '内部试吃', icon: 'fa-utensils', color: 'text-purple-600' }
    ];

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b">
                    <h2 className="text-lg font-semibold">
                        <i className="fas fa-edit text-blue-600 mr-2"></i>
                        编辑流水记录
                    </h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <i className="fas fa-times"></i>
                    </button>
                </div>
                
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {/* 产品信息 */}
                    <div className="bg-gray-50 p-3 rounded-lg">
                        <div className="text-sm text-gray-600">编辑流水记录</div>
                        <div className="font-medium">{product?.emoji} {product?.name}</div>
                        <div className="text-xs text-gray-500">
                            数量变动: {transaction.quantity >= 0 ? '+' : ''}{transaction.quantity} | 
                            时间: {new Date(transaction.created_at).toLocaleString('zh-CN')}
                        </div>
                    </div>

                    {/* 流水类型 */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            <i className="fas fa-tags text-blue-600 mr-1"></i>
                            流水类型 *
                        </label>
                        <select
                            value={transactionType}
                            onChange={(e) => setTransactionType(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            required
                        >
                            {transactionTypeOptions.map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    
                    {/* 原因 */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            <i className="fas fa-comment text-blue-600 mr-1"></i>
                            操作原因 *
                        </label>
                        <input
                            type="text"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="请输入操作原因"
                            required
                        />
                    </div>
                    
                    {/* 编辑备注 */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            <i className="fas fa-sticky-note text-blue-600 mr-1"></i>
                            编辑说明 (选填)
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="说明本次编辑的原因"
                            rows={2}
                        />
                    </div>
                    
                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-2 px-4 rounded-lg font-medium transition-colors"
                            disabled={loading}>
                            取消
                        </button>
                        <button
                            type="submit"
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50"
                            disabled={loading}>
                            {loading ? '保存中...' : '保存更改'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const AdminInventory: React.FC<{ 
    products: Product[]; 
    allOrders: Order[]; 
    onReverseTransaction: (transactionId: string) => void;
    onRefreshData?: () => Promise<void>;
    showToast: (message: string, type: 'success' | 'danger' | 'warning') => void; 
}> = ({ products, allOrders, onReverseTransaction, onRefreshData, showToast }) => {
    const [loading, setLoading] = useState(false);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [showStockInModal, setShowStockInModal] = useState(false);
    const [showStockOutModal, setShowStockOutModal] = useState(false);
    const [showTastingModal, setShowTastingModal] = useState(false);
    const [showEditTransactionModal, setShowEditTransactionModal] = useState(false);
    const [showTransactionEditModal, setShowTransactionEditModal] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<any>(null);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'transactions'>('overview');
    
    // 加载库存流水
    const loadTransactions = useCallback(async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('stock_transactions')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            setTransactions(data || []);
        } catch (error: any) {
            console.error('加载库存流水失败:', error);
            showToast('加载库存流水失败', 'danger');
        } finally {
            setLoading(false);
        }
    }, [showToast]);
    const [purchaseOrderItems, setPurchaseOrderItems] = useState<{[key: number]: {normal: number, gift: number}}>({});
    
    // 计算每个产品的预购需求
    const preorderNeeds = useMemo(() => {
        const needs: {[productId: number]: number} = {};
        
        // 从待处理的预购订单中统计需求
        allOrders.filter(order => 
            order.status === 'pending' && 
            order.order_items?.some(item => item.is_unlimited)
        ).forEach(order => {
            order.order_items?.forEach(item => {
                if (item.is_unlimited && 
                    !item.product.includes('运费专用') && 
                    !item.product.includes('运费')) {
                    const product = products.find(p => p.name === item.product);
                    if (product) {
                        needs[product.id] = (needs[product.id] || 0) + item.quantity;
                    }
                }
            });
        });
        
        return needs;
    }, [allOrders, products]);
    
    // 显示所有产品（包括零库存），以便可以通过入库功能添加库存
    const inventoryProducts = useMemo(() => {
        // 返回所有产品，按库存状态排序：缺货 > 低库存 > 正常库存 > 零库存
        return [...products].sort((a, b) => {
            const aStock = a.stock_quantity || 0;
            const bStock = b.stock_quantity || 0;
            const aThreshold = a.min_stock_threshold || 5;
            const bThreshold = b.min_stock_threshold || 5;
            
            // 缺货（库存为0）排最前
            if (aStock === 0 && bStock > 0) return -1;
            if (aStock > 0 && bStock === 0) return 1;
            
            // 低库存排前面
            const aIsLow = aStock > 0 && aStock <= aThreshold;
            const bIsLow = bStock > 0 && bStock <= bThreshold;
            if (aIsLow && !bIsLow) return -1;
            if (!aIsLow && bIsLow) return 1;
            
            // 其他按库存数量降序
            return bStock - aStock;
        });
    }, [products]);
    
    const stats = useMemo(() => {
        // 只统计有实际库存的产品
        const productsWithStock = inventoryProducts.filter(p => (p.stock_quantity || 0) > 0);
        const totalStock = productsWithStock.reduce((sum, p) => sum + (p.stock_quantity || 0), 0);
        const stockValue = productsWithStock.reduce((sum, p) => sum + (p.stock_quantity || 0) * (p.price || 0), 0);
        const lowStockCount = inventoryProducts.filter(p => {
            const stock = p.stock_quantity || 0;
            const threshold = p.min_stock_threshold || 5;
            return stock > 0 && stock <= threshold;
        }).length;
        const outOfStockCount = inventoryProducts.filter(p => (p.stock_quantity || 0) === 0).length;
        return { totalStock, stockValue, lowStockCount, outOfStockCount };
    }, [inventoryProducts]);
    
    // 加载已订购数量（待收货 + 部分收货的采购订单）
    const loadPurchaseOrderItems = useCallback(async () => {
        try {
            // 1. 获取所有待收货和部分收货的采购订单
            const { data: orders, error: ordersError } = await supabase
                .from('purchase_orders')
                .select('id')
                .in('status', ['pending', 'partial']);
            
            if (ordersError) throw ordersError;
            
            if (!orders || orders.length === 0) {
                setPurchaseOrderItems({});
                return;
            }
            
            const orderIds = orders.map(o => o.id);
            
            // 2. 获取这些订单的产品明细
            const { data: items, error: itemsError } = await supabase
                .from('purchase_order_items')
                .select('product_id, ordered_quantity, received_quantity, is_gift')
                .in('purchase_order_id', orderIds);
            
            if (itemsError) throw itemsError;
            
            // 3. 按产品ID汇总：正常订购数量和赠品数量
            const summary: {[key: number]: {normal: number, gift: number}} = {};
            
            items?.forEach(item => {
                if (!summary[item.product_id]) {
                    summary[item.product_id] = { normal: 0, gift: 0 };
                }
                
                // 计算未收货数量（订购数量 - 已收货数量）
                const pendingQty = item.ordered_quantity - (item.received_quantity || 0);
                
                if (pendingQty > 0) {
                    if (item.is_gift) {
                        summary[item.product_id].gift += pendingQty;
                    } else {
                        summary[item.product_id].normal += pendingQty;
                    }
                }
            });
            
            setPurchaseOrderItems(summary);
        } catch (error: any) {
            console.error('加载采购订单失败:', error);
        }
    }, []);
    
    useEffect(() => {
        loadTransactions();
        loadPurchaseOrderItems();
    }, [loadTransactions, loadPurchaseOrderItems]);
    
    // 入库操作
    const handleStockIn = async (productId: number, quantity: number, costPrice: number | null, reason: string, operator: string, notes: string) => {
        setLoading(true);
        try {
            const product = products.find(p => p.id === productId);
            if (!product) throw new Error('产品不存在');
            
            const previousStock = product.stock_quantity || 0;
            const newStock = previousStock + quantity;
            
            // 1. 创建库存流水记录
            const { error: transError } = await supabase
                .from('stock_transactions')
                .insert([{
                    product_id: productId,
                    transaction_type: 'stock_in',
                    quantity: quantity,
                    previous_stock: previousStock,
                    new_stock: newStock,
                    reason: reason,
                    cost_price: costPrice,
                    operator: operator,
                    notes: notes
                }]);
            
            if (transError) throw transError;
            
            // 2. 更新产品库存
            const { error: updateError } = await supabase
                .from('products')
                .update({ stock_quantity: newStock })
                .eq('id', productId);
            
            if (updateError) throw updateError;
            
            alert(`✅ 入库成功！\n产品：${product.name}\n入库数量：${quantity}\n库存：${previousStock} → ${newStock}`);
            setShowStockInModal(false);
            setSelectedProduct(null);
            loadTransactions();
            window.location.reload(); // 刷新页面以更新库存
        } catch (error: any) {
            alert(`❌ 入库失败：${error.message}`);
        } finally {
            setLoading(false);
        }
    };
    
    // 出库操作
    const handleStockOut = async (productId: number, quantity: number, reason: string, operator: string, notes: string) => {
        setLoading(true);
        try {
            const product = products.find(p => p.id === productId);
            if (!product) throw new Error('产品不存在');
            
            const previousStock = product.stock_quantity || 0;
            if (quantity > previousStock) {
                throw new Error(`库存不足！当前库存：${previousStock}，出库数量：${quantity}`);
            }
            
            const newStock = previousStock - quantity;
            
            // 1. 创建库存流水记录
            const { error: transError } = await supabase
                .from('stock_transactions')
                .insert([{
                    product_id: productId,
                    transaction_type: 'stock_out',
                    quantity: -quantity, // 负数表示减少
                    previous_stock: previousStock,
                    new_stock: newStock,
                    reason: reason,
                    operator: operator,
                    notes: notes
                }]);
            
            if (transError) throw transError;
            
            // 2. 更新产品库存
            const { error: updateError } = await supabase
                .from('products')
                .update({ stock_quantity: newStock })
                .eq('id', productId);
            
            if (updateError) throw updateError;
            
            alert(`✅ 出库成功！\n产品：${product.name}\n出库数量：${quantity}\n库存：${previousStock} → ${newStock}`);
            setShowStockOutModal(false);
            setSelectedProduct(null);
            loadTransactions();
            window.location.reload(); // 刷新页面以更新库存
        } catch (error: any) {
            alert(`❌ 出库失败：${error.message}`);
        } finally {
            setLoading(false);
        }
    };
    
    // 内部试吃扣库存（免费但扣减库存，用于内部试吃、样品等）
    const handleTasting = async (productId: number, quantity: number, operator: string, notes: string) => {
        setLoading(true);
        try {
            const product = products.find(p => p.id === productId);
            if (!product) throw new Error('产品不存在');
            
            const previousStock = product.stock_quantity || 0;
            if (quantity > previousStock) {
                throw new Error(`库存不足！当前库存：${previousStock}，试吃数量：${quantity}`);
            }
            
            const newStock = previousStock - quantity;
            
            // 1. 创建库存流水记录（标记为内部试吃）
            const { error: transError } = await supabase
                .from('stock_transactions')
                .insert([{
                    product_id: productId,
                    transaction_type: 'tasting', // 新类型：内部试吃
                    quantity: -quantity, // 负数表示减少
                    previous_stock: previousStock,
                    new_stock: newStock,
                    reason: '内部试吃（免费）',
                    cost_price: 0, // 标记为免费
                    operator: operator,
                    notes: notes || '内部试吃，不计入销售额，但扣减库存以准确追踪成本'
                }]);
            
            if (transError) throw transError;
            
            // 2. 更新产品库存
            const { error: updateError } = await supabase
                .from('products')
                .update({ stock_quantity: newStock })
                .eq('id', productId);
            
            if (updateError) throw updateError;
            
            alert(`✅ 内部试吃记录成功！\n产品：${product.name}\n试吃数量：${quantity}\n库存：${previousStock} → ${newStock}\n💡 此操作免费但已扣减库存，用于准确计算成本`);
            setShowTastingModal(false);
            setSelectedProduct(null);
            loadTransactions();
            window.location.reload(); // 刷新页面以更新库存
        } catch (error: any) {
            alert(`❌ 记录失败：${error.message}`);
        } finally {
            setLoading(false);
        }
    };
    
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-800">
                    <i className="fas fa-boxes mr-2 text-purple-600"></i>
                    库存管理
                </h2>
                <div className="flex gap-2">
                    <button
                        onClick={() => setActiveTab('overview')}
                        className={`px-4 py-2 rounded-lg font-medium transition-all ${
                            activeTab === 'overview'
                                ? 'bg-purple-600 text-white shadow-lg'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}>
                        <i className="fas fa-chart-bar mr-2"></i>库存概览
                    </button>
                    <button
                        onClick={() => {
                            setActiveTab('transactions');
                            if (transactions.length === 0) {
                                loadTransactions();
                            }
                        }}
                        className={`px-4 py-2 rounded-lg font-medium transition-all ${
                            activeTab === 'transactions'
                                ? 'bg-purple-600 text-white shadow-lg'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}>
                        <i className="fas fa-history mr-2"></i>库存流水
                    </button>
                </div>
            </div>
            
            {/* 说明提示 */}
            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 text-sm">
                <p className="text-blue-800">
                    <i className="fas fa-info-circle mr-2"></i>
                    <strong>库存管理说明：</strong>显示所有产品（包括零库存产品）。点击"入库"按钮可为任何产品添加库存，系统会自动记录完整的库存流水。
                </p>
                <p className="text-blue-600 mt-2 text-xs">
                    💡 <strong>提示：</strong>产品按缺货 → 低库存 → 正常库存排序，方便优先处理需要补货的产品。
                </p>
            </div>
            
            {/* 统计卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white p-6 rounded-lg shadow-lg">
                    <h3 className="text-sm opacity-90 mb-2">总库存量</h3>
                    <p className="text-3xl font-bold">{stats.totalStock}件</p>
                    <p className="text-xs opacity-75 mt-2">所有有库存产品</p>
                </div>
                <div className="bg-gradient-to-br from-green-500 to-green-600 text-white p-6 rounded-lg shadow-lg">
                    <h3 className="text-sm opacity-90 mb-2">库存总价值</h3>
                    <p className="text-3xl font-bold">RM{stats.stockValue.toFixed(2)}</p>
                    <p className="text-xs opacity-75 mt-2">按销售价计算</p>
                </div>
                <div className="bg-gradient-to-br from-orange-500 to-orange-600 text-white p-6 rounded-lg shadow-lg">
                    <h3 className="text-sm opacity-90 mb-2">低库存商品</h3>
                    <p className="text-3xl font-bold">{stats.lowStockCount}个</p>
                    <p className="text-xs opacity-75 mt-2">需要及时补货</p>
                </div>
                <div className="bg-gradient-to-br from-red-500 to-red-600 text-white p-6 rounded-lg shadow-lg">
                    <h3 className="text-sm opacity-90 mb-2">缺货商品</h3>
                    <p className="text-3xl font-bold">{stats.outOfStockCount}个</p>
                    <p className="text-xs opacity-75 mt-2">库存为零</p>
                </div>
            </div>
            
            {/* 库存概览 */}
            {activeTab === 'overview' && (
                <div className="bg-white p-6 rounded-lg shadow">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold">产品库存列表</h3>
                        <div className="text-sm text-gray-500">
                            <i className="fas fa-info-circle mr-1"></i>
                            点击"入库"或"出库"按钮进行库存操作
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="p-3 text-left">商品</th>
                                    <th className="p-3 text-left">当前库存</th>
                                    <th className="p-3 text-left">已订购</th>
                                    <th className="p-3 text-left">预购需订购</th>
                                    <th className="p-3 text-left">预计总库存</th>
                                    <th className="p-3 text-left">预计剩余库存</th>
                                    <th className="p-3 text-left">最低阈值</th>
                                    <th className="p-3 text-left">状态</th>
                                    <th className="p-3 text-left">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {inventoryProducts.map(p => {
                                    const isLow = (p.stock_quantity || 0) <= (p.min_stock_threshold || 5);
                                    const isOut = (p.stock_quantity || 0) <= 0;
                                    return (
                                        <tr key={p.id} className="border-b hover:bg-gray-50">
                                            <td className="p-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-2xl">{p.emoji || '📦'}</span>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-medium">{p.name}</p>
                                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                                                p.is_unlimited 
                                                                    ? 'bg-purple-100 text-purple-700' 
                                                                    : 'bg-blue-100 text-blue-700'
                                                            }`}>
                                                                {p.is_unlimited ? '预售' : '现货'}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-gray-500">ID: {p.id}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-3">
                                                <span className={`text-lg font-bold ${
                                                    isOut ? 'text-red-600' : isLow ? 'text-yellow-600' : 'text-green-600'
                                                }`}>
                                                    {p.stock_quantity || 0}
                                                </span>
                                            </td>
                                            <td className="p-3">
                                                {(() => {
                                                    const orderedNormal = purchaseOrderItems[p.id]?.normal || 0;
                                                    const orderedGift = purchaseOrderItems[p.id]?.gift || 0;
                                                    const totalOrdered = orderedNormal + orderedGift;
                                                    
                                                    if (totalOrdered === 0) {
                                                        return <span className="text-gray-400">-</span>;
                                                    }
                                                    
                                                    return (
                                                        <div className="flex flex-col gap-1">
                                                            {orderedNormal > 0 && (
                                                                <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-medium">
                                                                    {orderedNormal}
                                                                </span>
                                                            )}
                                                            {orderedGift > 0 && (
                                                                <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs font-medium">
                                                                    🎁 {orderedGift}
                                                                </span>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
                                            </td>
                                            <td className="p-3">
                                                {(() => {
                                                    const currentStock = p.stock_quantity || 0;
                                                    const orderedTotal = (purchaseOrderItems[p.id]?.normal || 0) + (purchaseOrderItems[p.id]?.gift || 0);
                                                    const preorderDemand = preorderNeeds[p.id] || 0;
                                                    const stillNeed = preorderDemand - currentStock - orderedTotal;
                                                    
                                                    if (stillNeed <= 0 || preorderDemand === 0) {
                                                        return <span className="text-gray-400">-</span>;
                                                    }
                                                    
                                                    return (
                                                        <div className="flex flex-col gap-1">
                                                            <span className="bg-orange-100 text-orange-800 px-2 py-0.5 rounded text-xs font-medium">
                                                                📋 {stillNeed}
                                                            </span>
                                                            <span className="text-xs text-gray-500">
                                                                需{preorderDemand}
                                                            </span>
                                                        </div>
                                                    );
                                                })()}
                                            </td>
                                            <td className="p-3">
                                                {(() => {
                                                    const orderedTotal = (purchaseOrderItems[p.id]?.normal || 0) + (purchaseOrderItems[p.id]?.gift || 0);
                                                    const projectedStock = (p.stock_quantity || 0) + orderedTotal;
                                                    return (
                                                        <span className={`text-lg font-bold ${
                                                            projectedStock <= 0 ? 'text-red-600' : 
                                                            projectedStock <= (p.min_stock_threshold || 5) ? 'text-yellow-600' : 
                                                            'text-green-600'
                                                        }`}>
                                                            {projectedStock}
                                                        </span>
                                                    );
                                                })()}
                                            </td>
                                            <td className="p-3">
                                                {(() => {
                                                    const currentStock = p.stock_quantity || 0;
                                                    const orderedFromSupplier = (purchaseOrderItems[p.id]?.normal || 0) + (purchaseOrderItems[p.id]?.gift || 0); // 采购订单即将到货
                                                    let orderedByCustomers = 0;
                                                    
                                                    // 计算所有待处理订单中该产品的总需求量
                                                    if (!p.is_unlimited) { // 只对现货商品计算
                                                        allOrders.filter(order => 
                                                            order.status === 'pending' || order.status === 'ready for pick up'
                                                        ).forEach(order => {
                                                            order.order_items?.forEach(item => {
                                                                if (item.product === p.name) {
                                                                    orderedByCustomers += item.quantity;
                                                                }
                                                            });
                                                        });
                                                    }
                                                    
                                                    // 正确的公式：(当前库存 + 采购订单) - 客户订单 = 预计剩余
                                                    const estimatedRemaining = Math.max(0, currentStock + orderedFromSupplier - orderedByCustomers);
                                                    
                                                    if (p.is_unlimited) {
                                                        return <span className="text-gray-400">不适用</span>;
                                                    }
                                                    
                                                    return (
                                                        <div className="space-y-1">
                                                            <span className={`text-lg font-bold ${
                                                                estimatedRemaining === 0 ? 'text-red-600' :
                                                                estimatedRemaining <= (p.min_stock_threshold || 5) ? 'text-yellow-600' :
                                                                'text-blue-600'
                                                            }`}>
                                                                {estimatedRemaining}
                                                            </span>
                                                            <div className="text-xs text-gray-500">
                                                                <div>现有: {currentStock}</div>
                                                                <div>+采购: {orderedFromSupplier}</div>
                                                                <div>-客户订单: {orderedByCustomers}</div>
                                                            </div>
                                                            {estimatedRemaining === 0 && (
                                                                <div className="text-xs text-red-600 font-medium">
                                                                    ⚠️ 预计缺货
                                                                </div>
                                                            )}
                                                            {estimatedRemaining > 0 && estimatedRemaining <= (p.min_stock_threshold || 5) && (
                                                                <div className="text-xs text-yellow-600 font-medium">
                                                                    ⚡ 预计库存紧张
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
                                            </td>
                                            <td className="p-3">{p.min_stock_threshold || 5}</td>
                                            <td className="p-3">
                                                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                                                    isOut ? 'bg-red-100 text-red-800' : 
                                                    isLow ? 'bg-yellow-100 text-yellow-800' : 
                                                    'bg-green-100 text-green-800'
                                                }`}>
                                                    {isOut ? '⚠️ 缺货' : isLow ? '⚡ 低库存' : '✅ 正常'}
                                                </span>
                                            </td>
                                            <td className="p-3">
                                                <div className="flex gap-2 flex-wrap">
                                                    <button
                                                        onClick={() => {
                                                            setSelectedProduct(p);
                                                            setShowStockInModal(true);
                                                        }}
                                                        className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-xs font-medium transition-colors">
                                                        <i className="fas fa-plus-circle mr-1"></i>入库
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setSelectedProduct(p);
                                                            setShowStockOutModal(true);
                                                        }}
                                                        className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded text-xs font-medium transition-colors"
                                                        disabled={isOut}>
                                                        <i className="fas fa-minus-circle mr-1"></i>出库
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setSelectedProduct(p);
                                                            setShowTastingModal(true);
                                                        }}
                                                        className="bg-purple-500 hover:bg-purple-600 text-white px-3 py-1 rounded text-xs font-medium transition-colors"
                                                        disabled={isOut}
                                                        title="内部试吃（免费但扣库存）">
                                                        <i className="fas fa-utensils mr-1"></i>试吃
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            
            {/* 库存流水 */}
            {activeTab === 'transactions' && (
                <div className="bg-white p-6 rounded-lg shadow">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold">库存流水记录</h3>
                        <div className="flex gap-2">
                            <button
                                onClick={loadTransactions}
                                disabled={loading}
                                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium transition-colors disabled:bg-gray-400">
                                {loading ? (
                                    <><i className="fas fa-spinner fa-spin mr-2"></i>加载中...</>
                                ) : (
                                    <><i className="fas fa-sync-alt mr-2"></i>刷新流水</>
                                )}
                            </button>
                            <button
                                onClick={() => {
                                    setShowTastingModal(false);
                                    setSelectedProduct(null);
                                    setShowTransactionEditModal(true);
                                    if (transactions.length === 0) {
                                        loadTransactions();
                                    }
                                }}
                                className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm font-medium transition-colors">
                                <i className="fas fa-edit mr-2"></i>流水管理
                            </button>
                        </div>
                    </div>
                    
                    {/* 数据精准管理提示 */}
                    <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-4 text-sm">
                        <div className="flex items-start">
                            <i className="fas fa-info-circle text-blue-600 mt-1 mr-3"></i>
                            <div>
                                <p className="text-blue-800 font-semibold mb-2">📊 流水精准管理</p>
                                <p className="text-blue-700 mb-2">
                                    每个流水记录都可以单独编辑。如果您发现部分发货状态显示不准确，请点击该记录的"编辑"按钮进行修正。
                                </p>
                                <p className="text-blue-700 mb-2">
                                    <strong>操作说明：</strong> 点击"编辑"可修改类型和原因，点击"回滚"可撤销该操作。
                                </p>
                                <p className="text-xs text-blue-600">
                                    💡 建议：仅修正确实有误的记录，避免不必要的修改导致数据混乱。
                                </p>
                            </div>
                        </div>
                    </div>
                    
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="p-3 text-left">时间</th>
                                    <th className="p-3 text-left">产品</th>
                                    <th className="p-3 text-left">类型</th>
                                    <th className="p-3 text-left">数量变动</th>
                                    <th className="p-3 text-left">库存变化</th>
                                    <th className="p-3 text-left">原因</th>
                                    <th className="p-3 text-left">操作人</th>
                                    <th className="p-3 text-left">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transactions.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="p-8 text-center text-gray-500">
                                            <i className="fas fa-inbox text-4xl mb-2 text-gray-300"></i>
                                            <p>暂无库存流水记录</p>
                                        </td>
                                    </tr>
                                ) : (
                                    transactions.map(trans => {
                                        const product = products.find(p => p.id === trans.product_id) || trans.product;
                                        const typeConfig = {
                                            stock_in: { label: '入库', color: 'bg-green-100 text-green-800', icon: 'fa-arrow-up' },
                                            stock_out: { label: '出库', color: 'bg-orange-100 text-orange-800', icon: 'fa-arrow-down' },
                                            order: { label: '订单出库', color: 'bg-blue-100 text-blue-800', icon: 'fa-shopping-cart' },
                                            manual_order: { label: '手动扣库存', color: 'bg-red-100 text-red-800', icon: 'fa-box-open' },
                                            manual_adjustment: { label: '手动调整', color: 'bg-yellow-100 text-yellow-800', icon: 'fa-edit' },
                                            manual_in: { label: '手动入库', color: 'bg-green-100 text-green-800', icon: 'fa-plus' },
                                            manual_out: { label: '手动出库', color: 'bg-red-100 text-red-800', icon: 'fa-minus' },
                                            stock_adjustment: { label: '库存调整', color: 'bg-yellow-100 text-yellow-800', icon: 'fa-edit' },
                                            stock_adjustment_reversal: { label: '调整回滚', color: 'bg-purple-100 text-purple-800', icon: 'fa-undo' },
                                            partial_delivery: { label: '部分发货', color: 'bg-blue-100 text-blue-800', icon: 'fa-shipping-fast' },
                                            reversal: { label: '撤销操作', color: 'bg-gray-100 text-gray-800', icon: 'fa-undo' },
                                            tasting: { label: '内部试吃', color: 'bg-purple-100 text-purple-800', icon: 'fa-utensils' }
                                        }[trans.transaction_type];
                                        
                                        // 检查是否可以撤销 - 所有手动操作都可以回滚
                                        const canReverse = !['order', 'reversal', 'stock_adjustment_reversal'].includes(trans.transaction_type) && !trans.notes?.includes('【已回滚】');
                                        
                                        // 检查是否已被撤销
                                        const isReversed = trans.notes?.includes('【已回滚】');
                                        
                                        return (
                                            <tr key={trans.id} className={`border-b hover:bg-gray-50 ${isReversed ? 'opacity-60 bg-gray-50' : ''}`}>
                                                <td className="p-3 text-xs text-gray-600">
                                                    {new Date(trans.created_at).toLocaleString('zh-CN')}
                                                </td>
                                                <td className="p-3">
                                                    <div className="flex items-center gap-2">
                                                        <span>{product?.emoji || '📦'}</span>
                                                        <span className="font-medium">{product?.name || `产品#${trans.product_id}`}</span>
                                                        {isReversed && (
                                                            <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded">已撤销</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-3">
                                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${typeConfig?.color}`}>
                                                        <i className={`fas ${typeConfig?.icon} mr-1`}></i>
                                                        {typeConfig?.label}
                                                    </span>
                                                </td>
                                                <td className="p-3">
                                                    <span className={`font-bold ${trans.quantity >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                        {trans.quantity >= 0 ? '+' : ''}{trans.quantity}
                                                    </span>
                                                </td>
                                                <td className="p-3 text-xs text-gray-600">
                                                    {trans.previous_stock} → {trans.new_stock}
                                                </td>
                                                <td className="p-3 text-xs">
                                                    <div className="space-y-1">
                                                        <div>{trans.reason || '-'}</div>
                                                        {trans.order_id && (
                                                            <div className="text-blue-600 font-medium">
                                                                <i className="fas fa-receipt mr-1"></i>订单: {trans.order_id}
                                                            </div>
                                                        )}
                                                        {trans.notes && (
                                                            <details className="text-gray-600 mt-1">
                                                                <summary className="cursor-pointer text-blue-600 hover:text-blue-800">
                                                                    <i className="fas fa-info-circle mr-1"></i>查看详情
                                                                </summary>
                                                                <div className="mt-1 p-2 bg-gray-50 rounded text-xs border border-gray-200">
                                                                    {trans.notes}
                                                                </div>
                                                            </details>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-3 text-xs">
                                                    <span className={`px-2 py-1 rounded text-xs ${
                                                        trans.operator === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'
                                                    }`}>
                                                        {trans.operator === 'admin' ? '👤 管理员' : trans.operator || '系统'}
                                                    </span>
                                                </td>
                                                <td className="p-3 text-xs">
                                                    <div className="flex flex-col gap-1">
                                                        {/* 编辑按钮 - 所有记录都可以编辑 */}
                                                        <button
                                                            onClick={() => {
                                                                setEditingTransaction(trans);
                                                                setShowEditTransactionModal(true);
                                                            }}
                                                            disabled={loading || isReversed}
                                                            className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors disabled:bg-gray-200 disabled:text-gray-500"
                                                            title="编辑此流水记录"
                                                        >
                                                            <i className="fas fa-edit mr-1"></i>编辑
                                                        </button>
                                                        
                                                        {/* 回滚按钮 */}
                                                        {canReverse && !isReversed && (
                                                            <button
                                                                onClick={() => onReverseTransaction(trans.id)}
                                                                disabled={loading}
                                                                className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors disabled:bg-gray-200 disabled:text-gray-500"
                                                                title="回滚此库存操作"
                                                            >
                                                                {loading ? (
                                                                    <><i className="fas fa-spinner fa-spin mr-1"></i>回滚中</>
                                                                ) : (
                                                                    <><i className="fas fa-undo mr-1"></i>回滚</>
                                                                )}
                                                            </button>
                                                        )}
                                                        
                                                        {isReversed && (
                                                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                                                                <i className="fas fa-check mr-1"></i>已回滚
                                                            </span>
                                                        )}
                                                        
                                                        {trans.transaction_type === 'stock_adjustment_reversal' && (
                                                            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">
                                                                <i className="fas fa-undo mr-1"></i>回滚操作
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            
            {/* 入库模态框 */}
            {showStockInModal && selectedProduct && (
                <StockInModal
                    product={selectedProduct}
                    onClose={() => {
                        setShowStockInModal(false);
                        setSelectedProduct(null);
                    }}
                    onConfirm={handleStockIn}
                    loading={loading}
                />
            )}
            
            {/* 出库模态框 */}
            {showStockOutModal && selectedProduct && (
                <StockOutModal
                    product={selectedProduct}
                    onClose={() => {
                        setShowStockOutModal(false);
                        setSelectedProduct(null);
                    }}
                    onConfirm={handleStockOut}
                    loading={loading}
                />
            )}
            
            {/* 内部试吃模态框 */}
            {showTastingModal && selectedProduct && (
                <TastingModal
                    product={selectedProduct}
                    onClose={() => {
                        setShowTastingModal(false);
                        setSelectedProduct(null);
                    }}
                    onConfirm={handleTasting}
                    loading={loading}
                />
            )}
            
            {/* 编辑流水记录模态框 */}
            {showEditTransactionModal && editingTransaction && (
                <EditTransactionModal
                    transaction={editingTransaction}
                    products={products}
                    onClose={() => {
                        setShowEditTransactionModal(false);
                        setEditingTransaction(null);
                    }}
                    onSave={async (updatedData) => {
                        try {
                            setLoading(true);
                            const { error } = await supabase
                                .from('stock_transactions')
                                .update({
                                    transaction_type: updatedData.transaction_type,
                                    reason: updatedData.reason,
                                    notes: updatedData.notes ? 
                                        (editingTransaction.notes ? 
                                            editingTransaction.notes + ' [编辑：' + updatedData.notes + ']' : 
                                            '[编辑：' + updatedData.notes + ']'
                                        ) : editingTransaction.notes
                                })
                                .eq('id', editingTransaction.id);
                            
                            if (error) throw error;
                            
                            // 如果编辑的是订单相关的流水记录，需要同步更新订单状态
                            if (editingTransaction.order_id) {
                                // 简化版本的订单状态更新逻辑
                                try {
                                    const { data: orderTransactions, error: transError } = await supabase
                                        .from('stock_transactions')
                                        .select('quantity, transaction_type, product_id')
                                        .eq('order_id', editingTransaction.order_id)
                                        .in('transaction_type', ['partial_delivery', 'stock_out', 'manual_order']);

                                    if (!transError && orderTransactions) {
                                        // 这里可以添加更复杂的状态更新逻辑，暂时简化
                                        console.log('订单流水记录已更新，需要手动刷新订单页面查看状态变化');
                                    }
                                } catch (error) {
                                    console.log('订单状态同步检查失败:', error);
                                }
                            }
                            
                            showToast('✅ 流水记录更新成功', 'success');
                            setShowEditTransactionModal(false);
                            setEditingTransaction(null);
                            await loadTransactions();
                            if (onRefreshData) {
                                await onRefreshData(); // 刷新数据
                            }
                        } catch (error: any) {
                            showToast(`❌ 更新失败：${error.message}`, 'danger');
                        } finally {
                            setLoading(false);
                        }
                    }}
                    loading={loading}
                />
            )}
        </div>
    );
};

// ======================================
// 🔹 采购订单管理组件
// ======================================
const AdminPurchaseOrders: React.FC<{ 
    products: Product[];
    allOrders: Order[];
    showToast: (message: string, type?: 'success' | 'danger' | 'warning') => void;
}> = ({ products, allOrders, showToast }) => {
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
    const [purchaseOrderItems, setPurchaseOrderItems] = useState<{[key: number]: PurchaseOrderItem[]}>({});
    const [expandedPOIds, setExpandedPOIds] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<'list' | 'create' | 'transactions'>('list');
    const [filterStatus, setFilterStatus] = useState('');
    const [searchText, setSearchText] = useState('');
    const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
    const [showReceiveModal, setShowReceiveModal] = useState(false);
    const [showDetailsModal, setShowDetailsModal] = useState(false);
    const [showPartialReceiveModal, setShowPartialReceiveModal] = useState(false);
    const [partialReceiveData, setPartialReceiveData] = useState<{[key: number]: number}>({});
    
    // 流水管理状态
    const [purchaseTransactions, setPurchaseTransactions] = useState<any[]>([]);
    const [loadingTransactions, setLoadingTransactions] = useState(false);
    const [showEditTransactionModal, setShowEditTransactionModal] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<any>(null);
    
    // 创建采购单表单
    const [formData, setFormData] = useState({
        supplier_name: '',
        supplier_contact: '',
        order_date: new Date().toISOString().split('T')[0],
        expected_delivery_date: '',
        notes: '',
        created_by: ''
    });
    
    // 采购单产品列表
    const [poItems, setPOItems] = useState<Array<{
        product_id: number;
        product_name: string;
        ordered_quantity: number;
        unit_cost: number;
        is_gift?: boolean; // 是否为赠品
        pack_specification?: 'unit' | 'individual'; // 规格选择：份 | 单个包装
        individual_packs?: number; // 单个包装数量（仅当选择individual时）
    }>>([]);
    
    // 加载采购相关流水记录
    const loadPurchaseTransactions = useCallback(async () => {
        try {
            setLoadingTransactions(true);
            const { data, error } = await supabase
                .from('stock_transactions')
                .select(`
                    *,
                    product:product_id(name, emoji)
                `)
                .eq('transaction_type', 'stock_in') // 只显示入库记录
                .order('created_at', { ascending: false });

            if (error) throw error;
            setPurchaseTransactions(data || []);
        } catch (error: any) {
            showToast(`加载采购流水记录失败: ${error.message}`, 'danger');
        } finally {
            setLoadingTransactions(false);
        }
    }, [showToast]);

    // 采购流水记录回滚功能（支持防重复回滚）
    const reversePurchaseTransaction = async (transactionId: string) => {
        try {
            console.log('开始回滚采购交易:', transactionId);
            
            const transaction = purchaseTransactions.find(t => t.id === transactionId);
            if (!transaction) {
                console.error('没有找到要回滚的记录:', transactionId);
                showToast('没有找到要回滚的记录', 'danger');
                return;
            }

            console.log('找到交易记录:', transaction);

            // 🔑 检查是否已经被回滚过（使用 reversal_of 字段）
            const { data: existingReversal, error: checkError } = await supabase
                .from('stock_transactions')
                .select('id')
                .eq('reversal_of', transactionId)
                .single();
            
            if (existingReversal) {
                showToast('⚠️ 此入库操作已经被回滚过了，无法重复回滚', 'warning');
                return;
            }

            const confirmMsg = `⚠️ 确认回滚此入库操作？\n\n` +
                `产品：${transaction.product?.name}\n` +
                `数量：+${transaction.quantity}\n` +
                `原因：${transaction.reason}\n\n` +
                `回滚后将从当前库存中扣除 ${transaction.quantity} 件。\n\n` +
                `⚠️ 注意：此操作不可撤销！`;

            if (!window.confirm(confirmMsg)) {
                console.log('用户取消回滚操作');
                return;
            }

            setLoading(true);

            // 获取当前库存
            const product = products.find(p => p.id === transaction.product_id);
            if (!product) {
                console.error('产品不存在:', transaction.product_id);
                throw new Error('产品不存在');
            }

            console.log('当前产品信息:', product);

            const currentStock = product.stock_quantity || 0;
            if (currentStock < transaction.quantity) {
                console.error(`库存不足，当前库存：${currentStock}，需要：${transaction.quantity}`);
                throw new Error(`库存不足，当前库存：${currentStock}，需要：${transaction.quantity}`);
            }

            const newStock = currentStock - transaction.quantity;
            console.log(`库存变更: ${currentStock} -> ${newStock}`);

            // 1. 更新库存
            console.log('开始更新产品库存');
            const { error: stockError } = await supabase
                .from('products')
                .update({ stock_quantity: newStock })
                .eq('id', transaction.product_id);

            if (stockError) {
                console.error('库存更新失败:', stockError);
                throw stockError;
            }
            
            console.log('产品库存更新成功');

            // 2. 创建回滚记录（包含 reversal_of 字段）
            console.log('开始创建回滚记录');
            const reversalRecord = {
                product_id: transaction.product_id,
                transaction_type: 'stock_adjustment_reversal',
                quantity: -transaction.quantity, // 负数表示减少
                previous_stock: currentStock,
                new_stock: newStock,
                reason: `回滚采购入库操作`,
                operator: 'admin',
                notes: `回滚入库操作 ID: ${transactionId}\n原操作：${transaction.reason}\n数量：${transaction.quantity}\n回滚时间：${new Date().toLocaleString('zh-CN')}`,
                reversal_of: transactionId // 🔑 关键：记录回滚关系
            };
            console.log('回滚记录数据:', reversalRecord);

            const { error: reversalError, data: reversalData } = await supabase
                .from('stock_transactions')
                .insert([reversalRecord]);

            if (reversalError) {
                console.error('创建回滚记录失败:', reversalError);
                throw reversalError;
            }

            console.log('回滚记录创建成功:', reversalData);
            showToast('✅ 采购入库记录回滚成功', 'success');
            await loadPurchaseTransactions();

        } catch (error: any) {
            console.error('回滚操作失败:', error);
            showToast(`❌ 回滚失败：${error.message}`, 'danger');
        } finally {
            setLoading(false);
        }
    };

    // 🆕 回滚整个采购订单的所有入库记录
    const reversePurchaseOrder = async (purchaseOrderId: string) => {
        try {
            console.log('开始回滚整个采购订单:', purchaseOrderId);
            
            // 1. 获取该采购订单的所有入库记录（通过notes字段模糊匹配）
            const { data: transactions, error: fetchError } = await supabase
                .from('stock_transactions')
                .select(`
                    *,
                    product:product_id(name, emoji)
                `)
                .eq('transaction_type', 'stock_in')
                .ilike('notes', `%${purchaseOrderId}%`)
                .order('created_at', { ascending: true });
            
            if (fetchError) {
                console.error('获取采购订单入库记录失败:', fetchError);
                throw fetchError;
            }
            
            if (!transactions || transactions.length === 0) {
                showToast('⚠️ 该采购订单没有任何入库记录', 'warning');
                return;
            }
            
            console.log(`找到 ${transactions.length} 条入库记录`);
            
            // 2. 检查是否有已回滚的记录
            const notReversedTransactions = [];
            for (const transaction of transactions) {
                const { data: existingReversal } = await supabase
                    .from('stock_transactions')
                    .select('id')
                    .eq('reversal_of', transaction.id)
                    .single();
                
                if (!existingReversal) {
                    notReversedTransactions.push(transaction);
                }
            }
            
            if (notReversedTransactions.length === 0) {
                showToast('⚠️ 该采购订单的所有入库记录都已被回滚过了', 'warning');
                return;
            }
            
            console.log(`需要回滚 ${notReversedTransactions.length} 条记录`);
            
            // 3. 显示确认信息
            const productSummary = notReversedTransactions
                .map(t => `  • ${t.product?.name}: ${t.quantity} 件`)
                .join('\n');
            
            const confirmMsg = `⚠️ 确认回滚整个采购订单的所有入库操作？\n\n` +
                `采购单号：${purchaseOrderId}\n` +
                `需要回滚的产品：\n${productSummary}\n\n` +
                `共 ${notReversedTransactions.length} 个产品，` +
                `总计 ${notReversedTransactions.reduce((sum, t) => sum + t.quantity, 0)} 件货物\n\n` +
                `⚠️ 注意：此操作不可撤销！`;

            if (!window.confirm(confirmMsg)) {
                console.log('用户取消整单回滚操作');
                return;
            }
            
            setLoading(true);
            
            // 4. 逐个回滚所有入库记录
            const reversalResults = [];
            for (const transaction of notReversedTransactions) {
                try {
                    console.log(`回滚记录 ${transaction.id}: ${transaction.product?.name}`);
                    
                    // 获取当前库存
                    const product = products.find(p => p.id === transaction.product_id);
                    if (!product) {
                        console.error('产品不存在:', transaction.product_id);
                        reversalResults.push({
                            success: false,
                            product: transaction.product?.name,
                            error: '产品不存在'
                        });
                        continue;
                    }
                    
                    const currentStock = product.stock_quantity || 0;
                    if (currentStock < transaction.quantity) {
                        console.error(`库存不足: ${product.name}, 当前库存：${currentStock}，需要：${transaction.quantity}`);
                        reversalResults.push({
                            success: false,
                            product: product.name,
                            error: `库存不足 (当前库存：${currentStock}，需要：${transaction.quantity})`
                        });
                        continue;
                    }
                    
                    const newStock = currentStock - transaction.quantity;
                    
                    // 更新库存
                    const { error: stockError } = await supabase
                        .from('products')
                        .update({ stock_quantity: newStock })
                        .eq('id', transaction.product_id);
                    
                    if (stockError) {
                        console.error('库存更新失败:', stockError);
                        reversalResults.push({
                            success: false,
                            product: product.name,
                            error: `库存更新失败: ${stockError.message}`
                        });
                        continue;
                    }
                    
                    // 创建回滚记录
                    const reversalRecord = {
                        product_id: transaction.product_id,
                        transaction_type: 'stock_adjustment_reversal',
                        quantity: -transaction.quantity,
                        previous_stock: currentStock,
                        new_stock: newStock,
                        reason: `回滚采购单 ${purchaseOrderId}`,
                        operator: 'admin',
                        notes: `批量回滚入库操作\n采购单号: ${purchaseOrderId}\n原入库记录 ID: ${transaction.id}\n产品：${product.name}\n数量：${transaction.quantity}\n回滚时间：${new Date().toLocaleString('zh-CN')}`,
                        reversal_of: transaction.id
                    };
                    
                    const { error: reversalError } = await supabase
                        .from('stock_transactions')
                        .insert([reversalRecord]);
                    
                    if (reversalError) {
                        console.error('创建回滚记录失败:', reversalError);
                        reversalResults.push({
                            success: false,
                            product: product.name,
                            error: `创建回滚记录失败: ${reversalError.message}`
                        });
                        continue;
                    }
                    
                    reversalResults.push({
                        success: true,
                        product: product.name,
                        quantity: transaction.quantity
                    });
                    
                    console.log(`✅ 成功回滚: ${product.name}, 数量: ${transaction.quantity}`);
                } catch (error: any) {
                    console.error(`回滚失败: ${transaction.product?.name}`, error);
                    reversalResults.push({
                        success: false,
                        product: transaction.product?.name || '未知产品',
                        error: error.message
                    });
                }
            }
            
            // 5. 显示回滚结果
            const successCount = reversalResults.filter(r => r.success).length;
            const failCount = reversalResults.filter(r => !r.success).length;
            
            if (failCount === 0) {
                showToast(`✅ 采购单回滚成功！共回滚 ${successCount} 条入库记录`, 'success');
            } else if (successCount > 0) {
                const failedProducts = reversalResults
                    .filter(r => !r.success)
                    .map(r => `${r.product}: ${r.error}`)
                    .join('\n');
                showToast(
                    `⚠️ 部分回滚成功\n成功: ${successCount} 条\n失败: ${failCount} 条\n\n失败详情:\n${failedProducts}`,
                    'warning'
                );
            } else {
                const failedProducts = reversalResults
                    .filter(r => !r.success)
                    .map(r => `${r.product}: ${r.error}`)
                    .join('\n');
                showToast(`❌ 回滚失败\n${failedProducts}`, 'danger');
            }
            
            // 6. 刷新数据
            await loadPurchaseTransactions();
            await loadPurchaseOrders();
            
        } catch (error: any) {
            console.error('回滚整单操作失败:', error);
            showToast(`❌ 回滚整单失败：${error.message}`, 'danger');
        } finally {
            setLoading(false);
        }
    };

    // 编辑采购流水记录后更新相关数据
    const updateAfterPurchaseEdit = async () => {
        await loadPurchaseTransactions();
        await loadPurchaseOrders(); // 刷新采购订单状态
    };

    // 加载采购订单
    const loadPurchaseOrders = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('purchase_orders')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            setPurchaseOrders(data || []);
            
            // 加载所有采购订单的产品明细
            if (data && data.length > 0) {
                const poIds = data.map(po => po.id);
                const { data: itemsData, error: itemsError } = await supabase
                    .from('purchase_order_items')
                    .select('*')
                    .in('purchase_order_id', poIds);
                
                if (itemsError) {
                    console.error('加载采购明细失败:', itemsError);
                } else if (itemsData) {
                    // 按采购订单ID分组
                    const itemsByPO: {[key: number]: PurchaseOrderItem[]} = {};
                    itemsData.forEach(item => {
                        if (!itemsByPO[item.purchase_order_id]) {
                            itemsByPO[item.purchase_order_id] = [];
                        }
                        itemsByPO[item.purchase_order_id].push(item);
                    });
                    setPurchaseOrderItems(itemsByPO);
                }
            }
        } catch (error: any) {
            showToast(`加载采购订单失败: ${error.message}`, 'danger');
        } finally {
            setLoading(false);
        }
    }, [showToast]);
    
    useEffect(() => {
        loadPurchaseOrders();
    }, [loadPurchaseOrders]);
    
    // 添加产品到采购单
    const addItemToPO = () => {
        setPOItems([...poItems, {
            product_id: 0,
            product_name: '',
            ordered_quantity: 0,
            unit_cost: 0,
            is_gift: false,
            pack_specification: 'unit',
            individual_packs: 0
        }]);
    };
    
    // 移除产品
    const removeItemFromPO = (index: number) => {
        setPOItems(poItems.filter((_, i) => i !== index));
    };
    
    // 更新产品信息
    const updatePOItem = (index: number, field: string, value: any) => {
        const updated = [...poItems];
        (updated[index] as any)[field] = value;
        
        // 如果选择了产品，自动填充产品名称和单价
        if (field === 'product_id') {
            const product = products.find(p => p.id === parseInt(value));
            if (product) {
                updated[index].product_name = product.name;
                updated[index].unit_cost = product.cost_price || 0;
                // 重置规格选择
                updated[index].pack_specification = 'unit';
                updated[index].individual_packs = 0;
            }
        }
        
        // 处理规格选择变化
        if (field === 'pack_specification') {
            if (value === 'unit') {
                // 切换到按份订购，清空单个包装数量
                updated[index].individual_packs = 0;
            } else if (value === 'individual') {
                // 切换到按单个包装订购，清空份数
                updated[index].ordered_quantity = 0;
            }
        }
        
        // 如果输入单个包装数量，自动计算份数
        if (field === 'individual_packs') {
            const product = products.find(p => p.id === updated[index].product_id);
            const packsPerUnit = product?.packs_per_unit || 1;
            const packs = parseInt(value) || 0;
            
            if (packsPerUnit > 1) {
                // 自动转换：酥饼3包为1份
                updated[index].ordered_quantity = Math.floor(packs / packsPerUnit);
            } else {
                // 普通产品1包为1份
                updated[index].ordered_quantity = packs;
            }
        }
        
        // 如果标记为赠品，自动将单价设为0
        if (field === 'is_gift') {
            if (value === true) {
                updated[index].unit_cost = 0;
            } else {
                // 取消赠品时，恢复产品原价
                const product = products.find(p => p.id === updated[index].product_id);
                if (product) {
                    updated[index].unit_cost = product.cost_price || 0;
                }
            }
        }
        
        setPOItems(updated);
    };
    
    // 计算总金额
    const totalAmount = useMemo(() => {
        return poItems.reduce((sum, item) => sum + (item.ordered_quantity * item.unit_cost), 0);
    }, [poItems]);
    
    // 生成采购单号
    const generatePONumber = () => {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
        const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        return `PO-${dateStr}-${randomNum}`;
    };
    
    // 创建采购订单
    const handleCreatePO = async () => {
        // 验证表单
        if (!formData.supplier_name.trim()) {
            showToast('请输入供应商名称', 'warning');
            return;
        }
        
        if (!formData.created_by.trim()) {
            showToast('请输入创建人姓名', 'warning');
            return;
        }
        
        if (poItems.length === 0) {
            showToast('请至少添加一个产品', 'warning');
            return;
        }
        
        // 验证产品信息
        for (let i = 0; i < poItems.length; i++) {
            const item = poItems[i];
            if (!item.product_id || item.product_id === 0) {
                showToast(`请选择第 ${i + 1} 个产品`, 'warning');
                return;
            }
            if (item.ordered_quantity <= 0) {
                showToast(`第 ${i + 1} 个产品的数量必须大于0`, 'warning');
                return;
            }
            if (item.unit_cost < 0) {
                showToast(`第 ${i + 1} 个产品的单价不能为负数`, 'warning');
                return;
            }
        }
        
        setLoading(true);
        
        try {
            const poNumber = generatePONumber();
            
            // 1. 创建采购订单主表
            const { data: poData, error: poError } = await supabase
                .from('purchase_orders')
                .insert([{
                    purchase_order_id: poNumber,
                    supplier_name: formData.supplier_name,
                    supplier_contact: formData.supplier_contact || null,
                    order_date: formData.order_date,
                    expected_delivery_date: formData.expected_delivery_date || null,
                    actual_delivery_date: null,
                    status: 'pending',
                    total_amount: totalAmount,
                    notes: formData.notes || null,
                    created_by: formData.created_by
                }])
                .select()
                .single();
            
            if (poError) throw poError;
            
            // 2. 创建采购订单明细
            const itemsToInsert = poItems.map(item => ({
                purchase_order_id: poData.id,
                product_id: item.product_id,
                product_name: item.product_name,
                ordered_quantity: item.ordered_quantity,
                received_quantity: 0,
                unit_cost: item.unit_cost,
                subtotal: item.ordered_quantity * item.unit_cost,
                is_gift: item.is_gift || false, // 保存赠品标记
                notes: item.is_gift ? '供应商赠品' : null
            }));
            
            const { error: itemsError } = await supabase
                .from('purchase_order_items')
                .insert(itemsToInsert);
            
            if (itemsError) throw itemsError;
            
            showToast(`✅ 采购订单 ${poNumber} 创建成功！`, 'success');
            
            // 重置表单
            setFormData({
                supplier_name: '',
                supplier_contact: '',
                order_date: new Date().toISOString().split('T')[0],
                expected_delivery_date: '',
                notes: '',
                created_by: ''
            });
            setPOItems([]);
            
            // 刷新列表
            await loadPurchaseOrders();
            setActiveTab('list');
            
        } catch (error: any) {
            showToast(`创建采购订单失败: ${error.message}`, 'danger');
        } finally {
            setLoading(false);
        }
    };
    
    // 筛选订单
    const filteredPOs = useMemo(() => {
        return purchaseOrders.filter(po => {
            const matchesStatus = !filterStatus || po.status === filterStatus;
            const matchesSearch = !searchText ||
                po.purchase_order_id.toLowerCase().includes(searchText.toLowerCase()) ||
                po.supplier_name.toLowerCase().includes(searchText.toLowerCase());
            return matchesStatus && matchesSearch;
        });
    }, [purchaseOrders, filterStatus, searchText]);
    
    // 状态标签样式
    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'pending':
                return 'bg-yellow-100 text-yellow-700 border-yellow-300';
            case 'partial':
                return 'bg-blue-100 text-blue-700 border-blue-300';
            case 'completed':
                return 'bg-green-100 text-green-700 border-green-300';
            case 'cancelled':
                return 'bg-gray-100 text-gray-700 border-gray-300';
            default:
                return 'bg-gray-100 text-gray-700 border-gray-300';
        }
    };
    
    const getStatusText = (status: string) => {
        switch (status) {
            case 'pending': return '待收货';
            case 'partial': return '部分收货';
            case 'completed': return '已完成';
            case 'cancelled': return '已取消';
            default: return status;
        }
    };
    
    // 切换展开/折叠
    const toggleExpand = (poId: number) => {
        const newExpanded = new Set(expandedPOIds);
        if (newExpanded.has(poId)) {
            newExpanded.delete(poId);
        } else {
            newExpanded.add(poId);
        }
        setExpandedPOIds(newExpanded);
    };
    
    // 查看详情
    const viewPODetails = async (po: PurchaseOrder) => {
        setSelectedPO(po);
        setShowDetailsModal(true);
    };
    
    // 收货入库功能（一键入库）
    const handleReceiveAndStock = async (po: PurchaseOrder) => {
        const items = purchaseOrderItems[po.id] || [];
        
        if (items.length === 0) {
            showToast('该采购单没有产品明细', 'warning');
            return;
        }
        
        // 显示确认对话框
        const giftCount = items.filter(item => item.is_gift).length;
        const normalCount = items.length - giftCount;
        
        const confirmMsg = `📦 采购订单收货入库\n\n` +
            `订单号：${po.purchase_order_id}\n` +
            `供应商：${po.supplier_name}\n` +
            `总产品：${items.length} 个 (${normalCount}个正常 + ${giftCount}个赠品)\n` +
            `总金额：RM${po.total_amount.toFixed(2)}\n\n` +
            `确认收货并自动入库吗？\n\n` +
            `系统将自动：\n` +
            `• 更新所有产品库存\n` +
            `• 记录详细库存流水\n` +
            `• 赠品自动标记（成本RM0）\n` +
            `• 更新订单状态为已完成`;
        
        if (!window.confirm(confirmMsg)) {
            return;
        }
        
        setLoading(true);
        
        try {
            let successCount = 0;
            let failedItems: string[] = [];
            
            // 逐个产品入库
            for (const item of items) {
                try {
                    const product = products.find(p => p.id === item.product_id);
                    if (!product) {
                        failedItems.push(`${item.product_name} (产品不存在)`);
                        continue;
                    }
                    
                    const currentStock = product.stock_quantity || 0;
                    const newStock = currentStock + item.ordered_quantity;
                    
                    // 1. 更新库存
                    const { error: stockError } = await supabase
                        .from('products')
                        .update({ stock_quantity: newStock })
                        .eq('id', item.product_id);
                    
                    if (stockError) {
                        failedItems.push(`${item.product_name} (库存更新失败)`);
                        continue;
                    }
                    
                    // 2. 记录库存流水
                    const transactionReason = item.is_gift ? '免费赠送' : '供应商进货';
                    const transactionNotes = item.is_gift 
                        ? `🎁 供应商赠品 - 自动入库\n采购订单: ${po.purchase_order_id}\n供应商: ${po.supplier_name}\n数量: ${item.ordered_quantity}\n成本: RM 0.00 (赠品)`
                        : `采购订单自动入库\n订单号: ${po.purchase_order_id}\n供应商: ${po.supplier_name}\n数量: ${item.ordered_quantity}\n单价: RM${item.unit_cost.toFixed(2)}\n总成本: RM${(item.unit_cost * item.ordered_quantity).toFixed(2)}`;
                    
                    const { error: transactionError } = await supabase
                        .from('stock_transactions')
                        .insert([{
                            product_id: item.product_id,
                            transaction_type: 'stock_in',
                            quantity: item.ordered_quantity,
                            previous_stock: currentStock,
                            new_stock: newStock,
                            reason: transactionReason,
                            operator: po.created_by || 'admin',
                            notes: transactionNotes,
                            cost_price: item.is_gift ? 0 : item.unit_cost
                        }]);
                    
                    if (transactionError) {
                        console.error('Failed to record stock transaction:', transactionError);
                    }
                    
                    // 3. 更新采购订单明细的已收货数量
                    const { error: updateItemError } = await supabase
                        .from('purchase_order_items')
                        .update({ received_quantity: item.ordered_quantity })
                        .eq('id', item.id);
                    
                    if (updateItemError) {
                        console.error('Failed to update received quantity:', updateItemError);
                    }
                    
                    successCount++;
                    
                } catch (itemError: any) {
                    failedItems.push(`${item.product_name} (${itemError.message})`);
                }
            }
            
            // 4. 更新采购订单状态为已完成
            if (successCount === items.length) {
                const { error: statusError } = await supabase
                    .from('purchase_orders')
                    .update({ 
                        status: 'completed',
                        actual_delivery_date: new Date().toISOString().split('T')[0]
                    })
                    .eq('id', po.id);
                
                if (statusError) {
                    console.error('Failed to update PO status:', statusError);
                }
            }
            
            // 显示结果
            if (successCount > 0) {
                let message = `✅ 采购订单 ${po.purchase_order_id} 收货入库完成！\n\n`;
                message += `✓ 成功入库 ${successCount}/${items.length} 个产品\n`;
                if (failedItems.length > 0) {
                    message += `✗ 失败 ${failedItems.length} 个产品:\n`;
                    failedItems.forEach(item => message += `  - ${item}\n`);
                }
                message += `\n💡 库存已更新，可在"库存管理"查看详情`;
                showToast(message, failedItems.length > 0 ? 'warning' : 'success');
            } else {
                showToast(`❌ 所有产品都入库失败`, 'danger');
            }
            
            // 刷新采购订单列表
            await loadPurchaseOrders();
            setShowReceiveModal(false);
            
        } catch (error: any) {
            showToast(`收货入库失败: ${error.message}`, 'danger');
        } finally {
            setLoading(false);
        }
    };
    
    // 部分收货功能
    const handlePartialReceive = (po: PurchaseOrder) => {
        setSelectedPO(po);
        const items = purchaseOrderItems[po.id] || [];
        // 初始化部分收货数据，默认为剩余未收货数量
        const initialData: {[key: number]: number} = {};
        items.forEach(item => {
            const remainingQty = item.ordered_quantity - item.received_quantity;
            initialData[item.id] = remainingQty;
        });
        setPartialReceiveData(initialData);
        setShowPartialReceiveModal(true);
    };
    
    // 确认部分收货
    const confirmPartialReceive = async () => {
        if (!selectedPO) return;
        
        const items = purchaseOrderItems[selectedPO.id] || [];
        const receiveItems = items.filter(item => {
            const receiveQty = partialReceiveData[item.id] || 0;
            return receiveQty > 0;
        });
        
        if (receiveItems.length === 0) {
            showToast('请至少选择一个产品进行收货', 'warning');
            return;
        }
        
        // 验证数量是否有效
        for (const item of receiveItems) {
            const receiveQty = partialReceiveData[item.id] || 0;
            const remainingQty = item.ordered_quantity - item.received_quantity;
            if (receiveQty > remainingQty) {
                showToast(`${item.product_name} 收货数量不能超过剩余数量 ${remainingQty}`, 'danger');
                return;
            }
        }
        
        const confirmMsg = `📦 部分收货确认\n\n` +
            `订单号：${selectedPO.purchase_order_id}\n` +
            `本次收货产品：${receiveItems.length} 个\n\n` +
            receiveItems.map(item => {
                const receiveQty = partialReceiveData[item.id] || 0;
                return `• ${item.product_name}: ${receiveQty} 件`;
            }).join('\n') + '\n\n确认收货入库吗？';
        
        if (!window.confirm(confirmMsg)) {
            return;
        }
        
        setLoading(true);
        
        try {
            let successCount = 0;
            let failedItems: string[] = [];
            
            // 逐个产品入库
            for (const item of receiveItems) {
                const receiveQty = partialReceiveData[item.id] || 0;
                if (receiveQty <= 0) continue;
                
                try {
                    const product = products.find(p => p.id === item.product_id);
                    if (!product) {
                        failedItems.push(`${item.product_name} (产品不存在)`);
                        continue;
                    }
                    
                    const currentStock = product.stock_quantity || 0;
                    const newStock = currentStock + receiveQty;
                    
                    // 1. 更新库存
                    const { error: stockError } = await supabase
                        .from('products')
                        .update({ stock_quantity: newStock })
                        .eq('id', item.product_id);
                    
                    if (stockError) {
                        failedItems.push(`${item.product_name} (库存更新失败)`);
                        continue;
                    }
                    
                    // 2. 记录库存流水
                    const transactionReason = item.is_gift ? '免费赠送' : '供应商进货';
                    const transactionNotes = item.is_gift 
                        ? `🎁 供应商赠品 - 部分收货\n采购订单: ${selectedPO.purchase_order_id}\n供应商: ${selectedPO.supplier_name}\n本次收货: ${receiveQty} 件\n成本: RM 0.00 (赠品)`
                        : `采购订单部分收货\n订单号: ${selectedPO.purchase_order_id}\n供应商: ${selectedPO.supplier_name}\n本次收货: ${receiveQty} 件\n单价: RM${item.unit_cost.toFixed(2)}\n本次成本: RM${(item.unit_cost * receiveQty).toFixed(2)}`;
                    
                    const { error: transactionError } = await supabase
                        .from('stock_transactions')
                        .insert([{
                            product_id: item.product_id,
                            transaction_type: 'stock_in',
                            quantity: receiveQty,
                            previous_stock: currentStock,
                            new_stock: newStock,
                            reason: transactionReason,
                            operator: selectedPO.created_by || 'admin',
                            notes: transactionNotes,
                            cost_price: item.is_gift ? 0 : item.unit_cost
                        }]);
                    
                    if (transactionError) {
                        console.error('Failed to record stock transaction:', transactionError);
                    }
                    
                    // 3. 更新采购订单明细的已收货数量
                    const newReceivedQty = item.received_quantity + receiveQty;
                    const { error: updateItemError } = await supabase
                        .from('purchase_order_items')
                        .update({ received_quantity: newReceivedQty })
                        .eq('id', item.id);
                    
                    if (updateItemError) {
                        console.error('Failed to update received quantity:', updateItemError);
                    }
                    
                    successCount++;
                    
                } catch (itemError: any) {
                    failedItems.push(`${item.product_name} (${itemError.message})`);
                }
            }
            
            // 4. 检查是否所有产品都已完全收货，更新采购订单状态
            const updatedItems = await supabase
                .from('purchase_order_items')
                .select('ordered_quantity, received_quantity')
                .eq('purchase_order_id', selectedPO.id);
            
            if (updatedItems.data) {
                const allFullyReceived = updatedItems.data.every(item => 
                    item.received_quantity >= item.ordered_quantity
                );
                
                const hasPartiallyReceived = updatedItems.data.some(item => 
                    item.received_quantity > 0
                );
                
                let newStatus = selectedPO.status;
                if (allFullyReceived) {
                    newStatus = 'completed';
                } else if (hasPartiallyReceived) {
                    newStatus = 'partial';
                }
                
                const updateData: any = { status: newStatus };
                if (newStatus === 'completed') {
                    updateData.actual_delivery_date = new Date().toISOString().split('T')[0];
                }
                
                const { error: statusError } = await supabase
                    .from('purchase_orders')
                    .update(updateData)
                    .eq('id', selectedPO.id);
                
                if (statusError) {
                    console.error('Failed to update PO status:', statusError);
                }
            }
            
            // 显示结果
            if (successCount > 0) {
                let message = `✅ 采购订单 ${selectedPO.purchase_order_id} 部分收货完成！\n\n`;
                message += `✓ 成功入库 ${successCount}/${receiveItems.length} 个产品\n`;
                if (failedItems.length > 0) {
                    message += `✗ 失败 ${failedItems.length} 个产品:\n`;
                    failedItems.forEach(item => message += `  - ${item}\n`);
                }
                message += `\n💡 库存已更新，可在"库存管理"查看详情`;
                showToast(message, failedItems.length > 0 ? 'warning' : 'success');
            } else {
                showToast(`❌ 所有产品都入库失败`, 'danger');
            }
            
            // 刷新采购订单列表
            await loadPurchaseOrders();
            setShowPartialReceiveModal(false);
            
        } catch (error: any) {
            showToast(`部分收货失败: ${error.message}`, 'danger');
        } finally {
            setLoading(false);
        }
    };
    
    return (
        <div className="bg-white p-6 rounded-lg shadow">
            {/* 头部导航 */}
            <div className="flex flex-wrap gap-3 items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-800">
                    <i className="fas fa-truck-loading mr-2 text-blue-600"></i>
                    采购订单管理
                </h2>
                <div className="flex gap-2">
                    <button
                        onClick={() => setActiveTab('list')}
                        className={`px-4 py-2 rounded-lg font-medium transition-all ${
                            activeTab === 'list'
                                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                        <i className="fas fa-list mr-2"></i>
                        采购单列表
                    </button>
                    <button
                        onClick={() => {
                            // 手动创建时清空产品列表，让用户自己添加
                            if (activeTab !== 'create') {
                                setPOItems([]);
                            }
                            setActiveTab('create');
                        }}
                        className={`px-4 py-2 rounded-lg font-medium transition-all ${
                            activeTab === 'create'
                                ? 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-lg'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                        <i className="fas fa-plus-circle mr-2"></i>
                        手动创建采购单
                    </button>
                    <button
                        onClick={() => {
                            setActiveTab('transactions');
                            loadPurchaseTransactions();
                        }}
                        className={`px-4 py-2 rounded-lg font-medium transition-all ${
                            activeTab === 'transactions'
                                ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-lg'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                        <i className="fas fa-history mr-2"></i>
                        流水记录
                    </button>
                </div>
            </div>
            
            {/* 采购单列表 */}
            {activeTab === 'list' && (
                <div>
                    {/* 团购订货提醒 - 基于预购订单需求 */}
                    {(() => {
                        // 1. 计算每个产品在预购订单中的总需求量
                        const preorderDemand: {[productName: string]: {
                            product: Product;
                            neededQty: number;
                            orderCount: number;
                        }} = {};
                        
                        // 🎯 从所有待处理的预购订单中统计需求
                        // 使用订单快照的 is_unlimited，不受产品表实时状态影响
                        allOrders.filter(order => 
                            order.status === 'pending' && 
                            order.order_items?.some(item => item.is_unlimited)
                        ).forEach(order => {
                            order.order_items?.forEach(item => {
                                // 🎯 使用订单快照判断是否为预购产品
                                // 🚫 排除运费产品（运费专用不是实际货物，不需要订购）
                                if (item.is_unlimited && 
                                    !item.product.includes('运费专用') && 
                                    !item.product.includes('运费')) {
                                    if (!preorderDemand[item.product]) {
                                        const product = products.find(p => p.name === item.product);
                                        if (product) {
                                            preorderDemand[item.product] = {
                                                product,
                                                neededQty: 0,
                                                orderCount: 0
                                            };
                                        }
                                    }
                                    if (preorderDemand[item.product]) {
                                        preorderDemand[item.product].neededQty += item.quantity;
                                        preorderDemand[item.product].orderCount += 1;
                                    }
                                }
                            });
                        });
                        
                        // 2. 计算每个产品已订购的数量（从采购订单中）
                        const orderedQty: {[productName: string]: number} = {};
                        
                        purchaseOrders.filter(po => 
                            po.status === 'pending' || po.status === 'partial'
                        ).forEach(po => {
                            const items = purchaseOrderItems[po.id] || [];
                            items.forEach(item => {
                                orderedQty[item.product_name] = (orderedQty[item.product_name] || 0) + item.ordered_quantity;
                            });
                        });
                        
                        // 3. 🎯 关键修复：计算需要补充订购的产品（扣除现有库存）
                        const needToOrder = Object.entries(preorderDemand).map(([productName, data]) => {
                            const currentStock = data.product.stock_quantity || 0; // 现有库存
                            const alreadyOrdered = orderedQty[productName] || 0; // 已订购数量
                            
                            // 🔑 正确的计算公式：还需订购 = 预购需求 - 现有库存 - 已订购数量
                            const stillNeed = data.neededQty - currentStock - alreadyOrdered;
                            
                            return {
                                productName,
                                product: data.product,
                                neededQty: data.neededQty,
                                currentStock: currentStock, // 新增：显示现有库存
                                orderedQty: alreadyOrdered,
                                stillNeedQty: stillNeed,
                                orderCount: data.orderCount
                            };
                        }).filter(item => item.stillNeedQty > 0) // 只显示还需要订购的产品
                          .sort((a, b) => b.stillNeedQty - a.stillNeedQty); // 按缺口从大到小排序
                        
                        if (needToOrder.length > 0) {
                            const totalNeed = needToOrder.reduce((sum, item) => sum + item.stillNeedQty, 0);
                            
                            return (
                                <div className="bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-400 rounded-lg p-5 mb-6 shadow-lg">
                                    <div className="flex items-start">
                                        <i className="fas fa-exclamation-triangle text-red-600 text-3xl mt-1 mr-4 animate-pulse"></i>
                                        <div className="flex-1">
                                            <h3 className="font-bold text-xl text-red-800 mb-2">
                                                🚨 团购订货提醒
                                            </h3>
                                            <div className="bg-white border-2 border-red-300 rounded-lg p-3 mb-4">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <div className="text-sm text-gray-600">待发货预购订单</div>
                                                        <div className="text-2xl font-bold text-red-600">
                                                            还需订购 {totalNeed} 份产品
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-sm text-gray-600">涉及产品</div>
                                                        <div className="text-2xl font-bold text-orange-600">
                                                            {needToOrder.length} 个
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                {needToOrder.map(item => (
                                                    <div 
                                                        key={item.productName} 
                                                        className="bg-white border-2 border-red-200 rounded-lg p-4 hover:shadow-md transition-all"
                                                    >
                                                        <div className="flex items-center justify-between mb-3">
                                                            <div className="font-bold text-gray-800 flex items-center gap-2">
                                                                <span className="text-xl">{item.product.emoji}</span>
                                                                <span>{item.productName}</span>
                                                            </div>
                                                            <span className="bg-red-100 text-red-700 px-2 py-1 rounded-full text-xs font-bold">
                                                                缺 {item.stillNeedQty}
                                                            </span>
                                                        </div>
                                                        
                                                        <div className="space-y-2 text-sm">
                                                            <div className="flex justify-between items-center pb-2 border-b border-gray-200">
                                                                <span className="text-gray-600">📋 预购订单需求</span>
                                                                <span className="font-bold text-blue-600">{item.neededQty} 份</span>
                                                            </div>
                                                            <div className="flex justify-between items-center pb-2 border-b border-gray-200">
                                                                <span className="text-gray-600">📦 现有库存</span>
                                                                <span className="font-bold text-purple-600">-{item.currentStock} 份</span>
                                                            </div>
                                                            <div className="flex justify-between items-center pb-2 border-b border-gray-200">
                                                                <span className="text-gray-600">✅ 已订购数量</span>
                                                                <span className="font-bold text-green-600">-{item.orderedQty} 份</span>
                                                            </div>
                                                            <div className="flex justify-between items-center pt-2 bg-red-50 -mx-2 px-2 py-2 rounded">
                                                                <span className="text-red-700 font-semibold">⚠️ 还需订购</span>
                                                                <span className="font-bold text-red-700 text-lg">{item.stillNeedQty} 份</span>
                                                            </div>
                                                        </div>
                                                        
                                                        <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
                                                            <i className="fas fa-users mr-1"></i>
                                                            {item.orderCount} 个订单等待发货
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            
                                            <div className="mt-4 flex gap-3 flex-wrap">
                                                <button
                                                    onClick={() => {
                                                        // 自动填充订货提醒中的产品数据
                                                        const autoFillItems = needToOrder.map(item => ({
                                                            product_id: item.product.id,
                                                            product_name: item.productName,
                                                            ordered_quantity: item.stillNeedQty,
                                                            unit_cost: item.product.cost_price || 0,
                                                            is_gift: false,
                                                            pack_specification: 'unit',
                                                            individual_packs: 0
                                                        }));
                                                        setPOItems(autoFillItems);
                                                        setActiveTab('create');
                                                    }}
                                                    className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white px-6 py-3 rounded-lg font-bold transition-all shadow-lg text-lg"
                                                >
                                                    <i className="fas fa-cart-plus mr-2"></i>
                                                    立即创建采购单补货 ({needToOrder.length}个产品)
                                                </button>
                                                <div className="flex items-center text-sm text-red-700 bg-white px-4 py-2 rounded-lg border-2 border-red-200">
                                                    <i className="fas fa-info-circle mr-2"></i>
                                                    <div>
                                                        <div className="font-semibold">智能补货</div>
                                                        <div className="text-xs">点击按钮自动填充需要补货的产品和数量，可调整后确认</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        }
                        return null;
                    })()}
                    
                    {/* 筛选栏 */}
                    <div className="flex flex-wrap gap-3 mb-4">
                        <input
                            type="text"
                            placeholder="搜索采购单号或供应商..."
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-4 py-2 text-sm"
                        />
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="border border-gray-300 rounded-lg px-4 py-2 text-sm"
                        >
                            <option value="">全部状态</option>
                            <option value="pending">待收货</option>
                            <option value="partial">部分收货</option>
                            <option value="completed">已完成</option>
                            <option value="cancelled">已取消</option>
                        </select>
                    </div>
                    
                    {/* 统计卡片 */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 border-2 border-yellow-200 rounded-lg p-4">
                            <div className="text-sm text-yellow-700 mb-1">待收货</div>
                            <div className="text-2xl font-bold text-yellow-800">
                                {purchaseOrders.filter(po => po.status === 'pending').length}
                            </div>
                        </div>
                        <div className="bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-blue-200 rounded-lg p-4">
                            <div className="text-sm text-blue-700 mb-1">部分收货</div>
                            <div className="text-2xl font-bold text-blue-800">
                                {purchaseOrders.filter(po => po.status === 'partial').length}
                            </div>
                        </div>
                        <div className="bg-gradient-to-br from-green-50 to-green-100 border-2 border-green-200 rounded-lg p-4">
                            <div className="text-sm text-green-700 mb-1">已完成</div>
                            <div className="text-2xl font-bold text-green-800">
                                {purchaseOrders.filter(po => po.status === 'completed').length}
                            </div>
                        </div>
                        <div className="bg-gradient-to-br from-purple-50 to-purple-100 border-2 border-purple-200 rounded-lg p-4">
                            <div className="text-sm text-purple-700 mb-1">总采购单</div>
                            <div className="text-2xl font-bold text-purple-800">
                                {purchaseOrders.length}
                            </div>
                        </div>
                    </div>
                    
                    {/* 采购单表格 */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                                <tr>
                                    <th className="p-4 text-left font-bold">采购单号</th>
                                    <th className="p-4 text-left font-bold">供应商</th>
                                    <th className="p-4 text-left font-bold">下单日期</th>
                                    <th className="p-4 text-left font-bold">预计到货</th>
                                    <th className="p-4 text-left font-bold">总金额</th>
                                    <th className="p-4 text-left font-bold">状态</th>
                                    <th className="p-4 text-left font-bold">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredPOs.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="p-8 text-center text-gray-500">
                                            <i className="fas fa-inbox text-4xl mb-3 block text-gray-400"></i>
                                            {searchText || filterStatus ? '没有找到符合条件的采购单' : '还没有采购单，点击"创建采购单"开始'}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredPOs.map(po => {
                                        const items = purchaseOrderItems[po.id] || [];
                                        const isExpanded = expandedPOIds.has(po.id);
                                        
                                        return (
                                            <React.Fragment key={po.id}>
                                                <tr className="border-b hover:bg-gray-50">
                                                    <td className="p-4">
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => toggleExpand(po.id)}
                                                                className="text-blue-600 hover:text-blue-800"
                                                                title={isExpanded ? "收起产品清单" : "展开产品清单"}
                                                            >
                                                                <i className={`fas fa-chevron-${isExpanded ? 'down' : 'right'} text-sm`}></i>
                                                            </button>
                                                            <div>
                                                                <div className="font-medium text-blue-600">{po.purchase_order_id}</div>
                                                                <div className="text-xs text-gray-500">创建人: {po.created_by || '未知'}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="font-medium">{po.supplier_name}</div>
                                                        {po.supplier_contact && (
                                                            <div className="text-xs text-gray-500">{po.supplier_contact}</div>
                                                        )}
                                                    </td>
                                                    <td className="p-4 text-gray-600">
                                                        {new Date(po.order_date).toLocaleDateString('zh-CN')}
                                                    </td>
                                                    <td className="p-4 text-gray-600">
                                                        {po.expected_delivery_date 
                                                            ? new Date(po.expected_delivery_date).toLocaleDateString('zh-CN')
                                                            : '-'}
                                                    </td>
                                                    <td className="p-4">
                                                        <div>
                                                            <span className="font-semibold text-red-600">
                                                                RM{po.total_amount.toFixed(2)}
                                                            </span>
                                                            <div className="text-xs text-gray-500 mt-1">
                                                                {items.length} 个产品
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="p-4">
                                                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getStatusStyle(po.status)}`}>
                                                            {getStatusText(po.status)}
                                                        </span>
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="flex gap-2 flex-wrap">
                                                            <button
                                                                onClick={() => handleReceiveAndStock(po)}
                                                                disabled={po.status === 'completed' || po.status === 'cancelled' || loading}
                                                                className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-xs disabled:bg-gray-300 disabled:cursor-not-allowed"
                                                                title="一键收货入库 - 全部产品"
                                                            >
                                                                <i className="fas fa-box-open mr-1"></i>
                                                                全部收货
                                                            </button>
                                                            <button
                                                                onClick={() => handlePartialReceive(po)}
                                                                disabled={po.status === 'completed' || po.status === 'cancelled' || loading}
                                                                className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded text-xs disabled:bg-gray-300 disabled:cursor-not-allowed"
                                                                title="部分收货 - 分批次入库"
                                                            >
                                                                <i className="fas fa-boxes mr-1"></i>
                                                                部分收货
                                                            </button>
                                                            <button
                                                                onClick={() => viewPODetails(po)}
                                                                className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-xs"
                                                            >
                                                                <i className="fas fa-eye mr-1"></i>
                                                                详情
                                                            </button>
                                                            {/* 回滚整单按钮 - 只有部分收货或已完成的订单才能回滚 */}
                                                            {(po.status === 'partial' || po.status === 'completed') && (
                                                                <button
                                                                    onClick={() => reversePurchaseOrder(po.purchase_order_id)}
                                                                    disabled={loading}
                                                                    className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-xs disabled:bg-gray-300 disabled:cursor-not-allowed"
                                                                    title="回滚整单 - 撤销所有入库操作"
                                                                >
                                                                    <i className="fas fa-undo mr-1"></i>
                                                                    回滚整单
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                                
                                                {/* 展开显示产品清单 */}
                                                {isExpanded && items.length > 0 && (
                                                    <tr>
                                                        <td colSpan={7} className="p-0 bg-blue-50">
                                                            <div className="p-4">
                                                                <div className="bg-white rounded-lg border-2 border-blue-200 overflow-hidden">
                                                                    <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-4 py-2 font-semibold">
                                                                        <i className="fas fa-list-ul mr-2"></i>
                                                                        采购产品清单
                                                                    </div>
                                                                    <table className="w-full text-sm">
                                                                        <thead className="bg-gray-50">
                                                                            <tr>
                                                                                <th className="p-3 text-left">产品名称</th>
                                                                                <th className="p-3 text-center">订购数量</th>
                                                                                <th className="p-3 text-center">已收货数量</th>
                                                                                <th className="p-3 text-right">单价</th>
                                                                                <th className="p-3 text-right">小计</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {items.map((item, idx) => (
                                                                                <tr key={idx} className="border-b last:border-b-0 hover:bg-gray-50">
                                                                                    <td className="p-3">
                                                                                        <div className="flex items-center gap-2">
                                                                                            <span className="font-medium text-gray-800">{item.product_name}</span>
                                                                                            {item.is_gift && (
                                                                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-300">
                                                                                                    🎁 赠品
                                                                                                </span>
                                                                                            )}
                                                                                        </div>
                                                                                    </td>
                                                                                    <td className="p-3 text-center">
                                                                                        <span className="inline-flex items-center justify-center bg-blue-100 text-blue-800 px-3 py-1 rounded-full font-semibold">
                                                                                            {item.ordered_quantity}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td className="p-3 text-center">
                                                                                        <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full font-semibold ${
                                                                                            item.received_quantity === 0 
                                                                                                ? 'bg-gray-100 text-gray-600' 
                                                                                                : item.received_quantity < item.ordered_quantity
                                                                                                ? 'bg-yellow-100 text-yellow-800'
                                                                                                : 'bg-green-100 text-green-800'
                                                                                        }`}>
                                                                                            {item.received_quantity}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td className="p-3 text-right text-gray-600">
                                                                                        {item.is_gift ? (
                                                                                            <span className="text-green-600 font-medium">RM 0.00</span>
                                                                                        ) : (
                                                                                            `RM${item.unit_cost.toFixed(2)}`
                                                                                        )}
                                                                                    </td>
                                                                                    <td className="p-3 text-right">
                                                                                        {item.is_gift ? (
                                                                                            <span className="text-green-600 font-semibold">🎁 赠品</span>
                                                                                        ) : (
                                                                                            <span className="font-semibold text-red-600">
                                                                                                RM{item.subtotal.toFixed(2)}
                                                                                            </span>
                                                                                        )}
                                                                                    </td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                        <tfoot className="bg-gray-100">
                                                                            <tr>
                                                                                <td colSpan={4} className="p-3 text-right font-bold text-gray-800">
                                                                                    总计：
                                                                                </td>
                                                                                <td className="p-3 text-right">
                                                                                    <span className="font-bold text-red-600 text-lg">
                                                                                        RM{po.total_amount.toFixed(2)}
                                                                                    </span>
                                                                                </td>
                                                                            </tr>
                                                                        </tfoot>
                                                                    </table>
                                                                </div>
                                                                
                                                                {po.notes && (
                                                                    <div className="mt-3 bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
                                                                        <div className="flex">
                                                                            <i className="fas fa-sticky-note text-yellow-600 mt-1 mr-2"></i>
                                                                            <div>
                                                                                <div className="text-xs font-semibold text-yellow-800 mb-1">订单备注</div>
                                                                                <div className="text-sm text-yellow-700">{po.notes}</div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            
            {/* 创建采购单表单 */}
            {activeTab === 'create' && (
                <div className="max-w-4xl">
                    {poItems.length > 0 && (
                        <div className="bg-gradient-to-r from-green-50 to-green-100 border-l-4 border-green-500 p-4 rounded mb-4">
                            <div className="flex items-start">
                                <i className="fas fa-check-circle text-green-600 mt-1 mr-3 text-xl"></i>
                                <div>
                                    <p className="font-semibold text-green-800">✅ 已自动导入 {poItems.length} 个产品</p>
                                    <p className="text-sm text-green-700 mt-1">
                                        产品数量和单价已根据订货提醒自动填充，您可以根据实际情况调整后再提交采购单。
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded mb-6">
                        <div className="flex items-start">
                            <i className="fas fa-info-circle text-blue-500 mt-1 mr-3"></i>
                            <div>
                                <p className="font-semibold text-blue-800">创建采购订单</p>
                                <p className="text-sm text-blue-600 mt-1">
                                    记录向供应商订购的货物，便于后续收货验货和库存管理。采购单不会直接影响库存，只有收货时才会更新库存。
                                </p>
                            </div>
                        </div>
                    </div>
                    
                    {/* 供应商信息 */}
                    <div className="bg-gray-50 p-6 rounded-lg mb-6">
                        <h3 className="font-bold text-lg mb-4 text-gray-800">
                            <i className="fas fa-store mr-2 text-blue-600"></i>
                            供应商信息
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    供应商名称 <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={formData.supplier_name}
                                    onChange={(e) => setFormData({...formData, supplier_name: e.target.value})}
                                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                                    placeholder="例如：锋味派供应商"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    供应商联系方式
                                </label>
                                <input
                                    type="text"
                                    value={formData.supplier_contact}
                                    onChange={(e) => setFormData({...formData, supplier_contact: e.target.value})}
                                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                                    placeholder="电话或微信"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    下单日期 <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="date"
                                    value={formData.order_date}
                                    onChange={(e) => setFormData({...formData, order_date: e.target.value})}
                                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    预计到货日期
                                </label>
                                <input
                                    type="date"
                                    value={formData.expected_delivery_date}
                                    onChange={(e) => setFormData({...formData, expected_delivery_date: e.target.value})}
                                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    创建人姓名 <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={formData.created_by}
                                    onChange={(e) => setFormData({...formData, created_by: e.target.value})}
                                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                                    placeholder="输入你的姓名"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    备注
                                </label>
                                <textarea
                                    value={formData.notes}
                                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                                    rows={3}
                                    placeholder="订单备注信息..."
                                />
                            </div>
                        </div>
                    </div>
                    
                    {/* 采购产品列表 */}
                    <div className="bg-gray-50 p-6 rounded-lg mb-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-lg text-gray-800">
                                <i className="fas fa-shopping-cart mr-2 text-green-600"></i>
                                采购产品清单 ({poItems.length})
                            </h3>
                            <div className="flex gap-2">
                                {poItems.length > 0 && (
                                    <button
                                        onClick={() => {
                                            if (window.confirm('确定要清空所有产品吗？')) {
                                                setPOItems([]);
                                            }
                                        }}
                                        className="bg-gray-400 hover:bg-gray-500 text-white px-4 py-2 rounded-lg text-sm font-medium"
                                    >
                                        <i className="fas fa-trash mr-2"></i>
                                        清空列表
                                    </button>
                                )}
                                <button
                                    onClick={addItemToPO}
                                    className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
                                >
                                    <i className="fas fa-plus mr-2"></i>
                                    添加产品
                                </button>
                            </div>
                        </div>
                        
                        {poItems.length > 0 && (
                            <div className="bg-blue-50 border-l-4 border-blue-400 p-3 rounded mb-4">
                                <div className="flex items-start">
                                    <i className="fas fa-lightbulb text-blue-500 mt-0.5 mr-2"></i>
                                    <div className="text-sm text-blue-700">
                                        <span className="font-semibold">💡 提示：</span>
                                        产品数量和单价可以直接修改，修改后总金额会自动更新
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {poItems.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">
                                <i className="fas fa-shopping-basket text-4xl mb-3 block text-gray-400"></i>
                                <p className="font-medium">还没有添加产品</p>
                                <p className="text-sm mt-2">
                                    • 点击"添加产品"手动添加<br/>
                                    • 或从"采购单列表"的订货提醒一键导入
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {poItems.map((item, index) => (
                                    <div key={index} className="bg-white p-4 rounded-lg border-2 border-gray-200">
                                        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                                            <div className="md:col-span-2">
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                    产品 <span className="text-red-500">*</span>
                                                </label>
                                                <select
                                                    value={item.product_id}
                                                    onChange={(e) => updatePOItem(index, 'product_id', e.target.value)}
                                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                                >
                                                    <option value={0}>请选择产品</option>
                                                    {products.map(p => (
                                                        <option key={p.id} value={p.id}>
                                                            {p.emoji} {p.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                {/* 规格选择 */}
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                    订购规格 <span className="text-red-500">*</span>
                                                </label>
                                                <select
                                                    value={item.pack_specification || 'unit'}
                                                    onChange={(e) => updatePOItem(index, 'pack_specification', e.target.value)}
                                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
                                                >
                                                    <option value="unit">按份订购</option>
                                                    <option value="individual">按单个包装订购</option>
                                                </select>
                                                
                                                {/* 数量输入 */}
                                                {item.pack_specification === 'individual' ? (
                                                    <div>
                                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                                            单个包装数量 <span className="text-red-500">*</span>
                                                        </label>
                                                        <input
                                                            type="number"
                                                            value={item.individual_packs || ''}
                                                            onChange={(e) => updatePOItem(index, 'individual_packs', parseInt(e.target.value) || 0)}
                                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                                            placeholder="包装数量"
                                                            min="0"
                                                        />
                                                        {(() => {
                                                            const product = products.find(p => p.id === item.product_id);
                                                            const packsPerUnit = product?.packs_per_unit || 1;
                                                            const packs = item.individual_packs || 0;
                                                            const units = Math.floor(packs / packsPerUnit);
                                                            const remainder = packs % packsPerUnit;
                                                            
                                                            if (packsPerUnit > 1 && packs > 0) {
                                                                return (
                                                                    <div className="text-xs text-blue-600 mt-1">
                                                                        💡 自动转换：{packs}包 = {units}份
                                                                        {remainder > 0 && ` + ${remainder}包`}
                                                                        {packsPerUnit === 3 && (
                                                                            <span className="text-orange-600 block mt-1">
                                                                                🥠 酥饼：3包 = 1份
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                );
                                                            }
                                                            return null;
                                                        })()}
                                                    </div>
                                                ) : (
                                                    <div>
                                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                                            数量（份） <span className="text-red-500">*</span>
                                                        </label>
                                                        <input
                                                            type="number"
                                                            value={item.ordered_quantity || ''}
                                                            onChange={(e) => updatePOItem(index, 'ordered_quantity', parseInt(e.target.value) || 0)}
                                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                                            placeholder="数量"
                                                            min="0"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                    单价 (RM)
                                                </label>
                                                <input
                                                    type="number"
                                                    value={item.unit_cost || ''}
                                                    onChange={(e) => updatePOItem(index, 'unit_cost', parseFloat(e.target.value) || 0)}
                                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                                    placeholder="0.00"
                                                    step="0.01"
                                                    min="0"
                                                    disabled={item.is_gift}
                                                />
                                                <label className="flex items-center mt-2 text-sm">
                                                    <input
                                                        type="checkbox"
                                                        checked={item.is_gift || false}
                                                        onChange={(e) => updatePOItem(index, 'is_gift', e.target.checked)}
                                                        className="mr-2"
                                                    />
                                                    <span className="text-green-600 font-medium">
                                                        🎁 供应商赠品
                                                    </span>
                                                </label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1">
                                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                                        小计
                                                    </label>
                                                    <div className="text-lg font-semibold text-red-600">
                                                        {item.is_gift ? (
                                                            <span className="text-green-600">🎁 赠品</span>
                                                        ) : (
                                                            `RM${(item.ordered_quantity * item.unit_cost).toFixed(2)}`
                                                        )}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => removeItemFromPO(index)}
                                                    className="bg-red-500 hover:bg-red-600 text-white px-3 py-2 rounded text-sm"
                                                    title="移除"
                                                >
                                                    <i className="fas fa-trash"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    
                    {/* 总计 */}
                    <div className="bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-200 rounded-lg p-6 mb-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-lg font-bold text-gray-800">
                                    <i className="fas fa-calculator mr-2 text-red-600"></i>
                                    采购总金额
                                </div>
                                <div className="text-xs text-gray-600 mt-1">
                                    共 {poItems.length} 个产品，
                                    总数量 {poItems.reduce((sum, item) => sum + item.ordered_quantity, 0)} 份
                                </div>
                            </div>
                            <span className="text-3xl font-bold text-red-600">
                                RM{totalAmount.toFixed(2)}
                            </span>
                        </div>
                    </div>
                    
                    {/* 操作按钮 */}
                    <div className="flex gap-3">
                        <button
                            onClick={handleCreatePO}
                            disabled={loading || poItems.length === 0}
                            className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white px-6 py-3 rounded-lg font-bold disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all"
                        >
                            {loading ? (
                                <>
                                    <i className="fas fa-spinner fa-spin mr-2"></i>
                                    创建中...
                                </>
                            ) : (
                                <>
                                    <i className="fas fa-check-circle mr-2"></i>
                                    创建采购订单
                                </>
                            )}
                        </button>
                        <button
                            onClick={() => {
                                if (confirm('确定要取消创建采购单吗？所有填写的信息都会丢失。')) {
                                    setFormData({
                                        supplier_name: '',
                                        supplier_contact: '',
                                        order_date: new Date().toISOString().split('T')[0],
                                        expected_delivery_date: '',
                                        notes: '',
                                        created_by: ''
                                    });
                                    setPOItems([]);
                                    setActiveTab('list');
                                }
                            }}
                            disabled={loading}
                            className="bg-gray-300 hover:bg-gray-400 text-gray-700 px-6 py-3 rounded-lg font-bold disabled:cursor-not-allowed transition-all"
                        >
                            <i className="fas fa-times mr-2"></i>
                            取消
                        </button>
                    </div>
                </div>
            )}
            {/* 详情查看 Modal */}
            {showDetailsModal && selectedPO && ReactDOM.createPortal(
                <div 
                    className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center p-4"
                    style={{ zIndex: 99999 }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setShowDetailsModal(false);
                        }
                    }}
                >
                    <div 
                        className="bg-white rounded-lg shadow-xl w-full max-w-4xl"
                        style={{ maxHeight: '90vh', overflow: 'auto' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 头部 */}
                        <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-6 rounded-t-lg">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-2xl font-bold mb-2">
                                        <i className="fas fa-file-invoice mr-2"></i>
                                        采购订单详情
                                    </h3>
                                    <div className="text-blue-100 text-sm">
                                        订单号：{selectedPO.purchase_order_id}
                                    </div>
                                </div>
                                <button 
                                    onClick={() => setShowDetailsModal(false)}
                                    className="text-white hover:bg-white/20 rounded-full p-2 transition-all"
                                >
                                    <i className="fas fa-times text-xl"></i>
                                </button>
                            </div>
                        </div>
                        
                        {/* 内容 */}
                        <div className="p-6">
                            {/* 基本信息 */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <div className="text-sm text-gray-600 mb-1">供应商名称</div>
                                    <div className="font-semibold text-lg text-gray-800">{selectedPO.supplier_name}</div>
                                    {selectedPO.supplier_contact && (
                                        <div className="text-sm text-gray-600 mt-2">
                                            <i className="fas fa-phone mr-1"></i>
                                            {selectedPO.supplier_contact}
                                        </div>
                                    )}
                                </div>
                                
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <div className="text-sm text-gray-600 mb-1">订单状态</div>
                                    <span className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium border ${getStatusStyle(selectedPO.status)}`}>
                                        {getStatusText(selectedPO.status)}
                                    </span>
                                </div>
                                
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <div className="text-sm text-gray-600 mb-1">下单日期</div>
                                    <div className="font-semibold text-gray-800">
                                        <i className="fas fa-calendar-alt mr-2 text-blue-600"></i>
                                        {new Date(selectedPO.order_date).toLocaleDateString('zh-CN')}
                                    </div>
                                </div>
                                
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <div className="text-sm text-gray-600 mb-1">预计到货日期</div>
                                    <div className="font-semibold text-gray-800">
                                        <i className="fas fa-truck mr-2 text-green-600"></i>
                                        {selectedPO.expected_delivery_date 
                                            ? new Date(selectedPO.expected_delivery_date).toLocaleDateString('zh-CN')
                                            : '未设置'}
                                    </div>
                                </div>
                                
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <div className="text-sm text-gray-600 mb-1">创建人</div>
                                    <div className="font-semibold text-gray-800">
                                        <i className="fas fa-user mr-2 text-purple-600"></i>
                                        {selectedPO.created_by || '未知'}
                                    </div>
                                </div>
                                
                                <div className="bg-gradient-to-br from-red-50 to-orange-50 border-2 border-red-200 p-4 rounded-lg">
                                    <div className="text-sm text-gray-600 mb-1">订单总金额</div>
                                    <div className="text-3xl font-bold text-red-600">
                                        RM{selectedPO.total_amount.toFixed(2)}
                                    </div>
                                </div>
                            </div>
                            
                            {/* 备注 */}
                            {selectedPO.notes && (
                                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded mb-6">
                                    <div className="flex">
                                        <i className="fas fa-sticky-note text-yellow-600 mt-1 mr-3"></i>
                                        <div>
                                            <div className="font-semibold text-yellow-800 mb-1">订单备注</div>
                                            <div className="text-yellow-700">{selectedPO.notes}</div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            
                            {/* 产品清单 */}
                            <div className="border-2 border-blue-200 rounded-lg overflow-hidden">
                                <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-4 py-3 font-bold">
                                    <i className="fas fa-box-open mr-2"></i>
                                    采购产品清单
                                </div>
                                
                                {purchaseOrderItems[selectedPO.id]?.length > 0 ? (
                                    <table className="w-full">
                                        <thead className="bg-gray-100">
                                            <tr>
                                                <th className="p-3 text-left font-semibold">产品名称</th>
                                                <th className="p-3 text-center font-semibold">订购数量</th>
                                                <th className="p-3 text-center font-semibold">已收货</th>
                                                <th className="p-3 text-right font-semibold">单价</th>
                                                <th className="p-3 text-right font-semibold">小计</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {purchaseOrderItems[selectedPO.id].map((item, idx) => (
                                                <tr key={idx} className="border-b last:border-b-0 hover:bg-gray-50">
                                                    <td className="p-3">
                                                        <div className="font-medium text-gray-800">{item.product_name}</div>
                                                        {item.notes && (
                                                            <div className="text-xs text-gray-500 mt-1">{item.notes}</div>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <span className="inline-flex items-center justify-center bg-blue-100 text-blue-800 px-4 py-2 rounded-full font-bold text-lg">
                                                            {item.ordered_quantity}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <span className={`inline-flex items-center justify-center px-4 py-2 rounded-full font-bold text-lg ${
                                                            item.received_quantity === 0 
                                                                ? 'bg-gray-100 text-gray-600' 
                                                                : item.received_quantity < item.ordered_quantity
                                                                ? 'bg-yellow-100 text-yellow-800'
                                                                : 'bg-green-100 text-green-800'
                                                        }`}>
                                                            {item.received_quantity}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-right text-gray-700 font-medium">
                                                        RM{item.unit_cost.toFixed(2)}
                                                    </td>
                                                    <td className="p-3 text-right">
                                                        <span className="font-bold text-red-600 text-lg">
                                                            RM{item.subtotal.toFixed(2)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot className="bg-gradient-to-r from-gray-100 to-gray-200">
                                            <tr>
                                                <td colSpan={4} className="p-4 text-right font-bold text-gray-800 text-lg">
                                                    订单总计：
                                                </td>
                                                <td className="p-4 text-right">
                                                    <span className="font-bold text-red-600 text-2xl">
                                                        RM{selectedPO.total_amount.toFixed(2)}
                                                    </span>
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                ) : (
                                    <div className="p-8 text-center text-gray-500">
                                        <i className="fas fa-inbox text-4xl mb-3 block text-gray-400"></i>
                                        没有产品明细
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        {/* 底部操作按钮 */}
                        <div className="border-t p-6 bg-gray-50 flex gap-3 justify-end rounded-b-lg">
                            <button
                                onClick={() => setShowDetailsModal(false)}
                                className="px-6 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg font-medium transition-all"
                            >
                                <i className="fas fa-times mr-2"></i>
                                关闭
                            </button>
                            {selectedPO.status !== 'completed' && selectedPO.status !== 'cancelled' && (
                                <button
                                    onClick={() => {
                                        setShowDetailsModal(false);
                                        setShowReceiveModal(true);
                                    }}
                                    className="px-6 py-2 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white rounded-lg font-medium transition-all shadow-lg"
                                >
                                    <i className="fas fa-box-open mr-2"></i>
                                    开始收货
                                </button>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}
            
            {/* 部分收货 Modal */}
            {showPartialReceiveModal && selectedPO && ReactDOM.createPortal(
                <div 
                    className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center p-4"
                    style={{ zIndex: 99999 }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setShowPartialReceiveModal(false);
                        }
                    }}
                >
                    <div 
                        className="bg-white rounded-lg shadow-xl w-full max-w-4xl"
                        style={{ maxHeight: '90vh', overflow: 'auto' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 头部 */}
                        <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white p-6 rounded-t-lg">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-2xl font-bold mb-2">
                                        <i className="fas fa-boxes mr-2"></i>
                                        部分收货入库
                                    </h3>
                                    <div className="text-orange-100 text-sm">
                                        订单号：{selectedPO.purchase_order_id} | 供应商：{selectedPO.supplier_name}
                                    </div>
                                </div>
                                <button 
                                    onClick={() => setShowPartialReceiveModal(false)}
                                    className="text-white hover:bg-white/20 rounded-full p-2 transition-all"
                                >
                                    <i className="fas fa-times text-xl"></i>
                                </button>
                            </div>
                        </div>
                        
                        {/* 内容 */}
                        <div className="p-6">
                            <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded mb-6">
                                <div className="flex items-start">
                                    <i className="fas fa-info-circle text-amber-500 mt-1 mr-3"></i>
                                    <div>
                                        <p className="font-semibold text-amber-800">分批收货说明</p>
                                        <p className="text-sm text-amber-600 mt-1">
                                            您可以根据实际到货情况，选择部分产品进行收货入库。未收货的产品将保留在订单中，等待下次收货。
                                        </p>
                                    </div>
                                </div>
                            </div>
                            
                            {/* 产品列表 */}
                            <div className="bg-gray-50 rounded-lg overflow-hidden">
                                <div className="bg-gradient-to-r from-gray-600 to-gray-700 text-white px-4 py-3 font-semibold">
                                    <i className="fas fa-list-ul mr-2"></i>
                                    选择收货产品和数量
                                </div>
                                
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-200">
                                            <tr>
                                                <th className="p-3 text-left">产品名称</th>
                                                <th className="p-3 text-center">订购数量</th>
                                                <th className="p-3 text-center">已收货</th>
                                                <th className="p-3 text-center">剩余未收</th>
                                                <th className="p-3 text-center">本次收货数量</th>
                                                <th className="p-3 text-center">单价</th>
                                                <th className="p-3 text-center">小计</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(purchaseOrderItems[selectedPO.id] || []).map((item, idx) => {
                                                const remainingQty = item.ordered_quantity - item.received_quantity;
                                                const currentReceiveQty = partialReceiveData[item.id] || 0;
                                                const subtotal = currentReceiveQty * item.unit_cost;
                                                
                                                return (
                                                    <tr key={idx} className={`border-b hover:bg-gray-50 ${remainingQty === 0 ? 'opacity-50' : ''}`}>
                                                        <td className="p-3">
                                                            <div className="flex items-center gap-2">
                                                                <div className="font-medium text-gray-800">
                                                                    {item.product_name}
                                                                    {item.is_gift && (
                                                                        <span className="ml-2 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded">
                                                                            🎁 赠品
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        
                                                        <td className="p-3 text-center">
                                                            <span className="inline-flex items-center justify-center bg-blue-100 text-blue-800 px-3 py-1 rounded-full font-medium">
                                                                {item.ordered_quantity}
                                                            </span>
                                                        </td>
                                                        
                                                        <td className="p-3 text-center">
                                                            <span className="inline-flex items-center justify-center bg-green-100 text-green-800 px-3 py-1 rounded-full font-medium">
                                                                {item.received_quantity}
                                                            </span>
                                                        </td>
                                                        
                                                        <td className="p-3 text-center">
                                                            <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full font-medium ${
                                                                remainingQty === 0 
                                                                    ? 'bg-gray-100 text-gray-600' 
                                                                    : 'bg-yellow-100 text-yellow-800'
                                                            }`}>
                                                                {remainingQty}
                                                            </span>
                                                        </td>
                                                        
                                                        <td className="p-3 text-center">
                                                            {remainingQty > 0 ? (
                                                                <div className="flex items-center justify-center gap-2">
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        max={remainingQty}
                                                                        value={currentReceiveQty}
                                                                        onChange={(e) => {
                                                                            const value = Math.min(parseInt(e.target.value) || 0, remainingQty);
                                                                            setPartialReceiveData(prev => ({
                                                                                ...prev,
                                                                                [item.id]: value
                                                                            }));
                                                                        }}
                                                                        className="w-16 px-2 py-1 border border-gray-300 rounded text-center focus:outline-none focus:ring-2 focus:ring-orange-500"
                                                                    />
                                                                    <button
                                                                        onClick={() => {
                                                                            setPartialReceiveData(prev => ({
                                                                                ...prev,
                                                                                [item.id]: remainingQty
                                                                            }));
                                                                        }}
                                                                        className="text-xs text-orange-600 hover:text-orange-800 px-2 py-1 bg-orange-100 rounded"
                                                                        title="全部收货"
                                                                    >
                                                                        全部
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <span className="text-gray-400">已完成</span>
                                                            )}
                                                        </td>
                                                        
                                                        <td className="p-3 text-center text-gray-700">
                                                            {item.is_gift ? (
                                                                <span className="text-yellow-600 font-medium">免费</span>
                                                            ) : (
                                                                `RM${item.unit_cost.toFixed(2)}`
                                                            )}
                                                        </td>
                                                        
                                                        <td className="p-3 text-center">
                                                            <span className="font-bold text-gray-800">
                                                                RM{subtotal.toFixed(2)}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot className="bg-gradient-to-r from-gray-100 to-gray-200">
                                            <tr>
                                                <td colSpan={6} className="p-4 text-right font-bold text-gray-800">
                                                    本次收货总计：
                                                </td>
                                                <td className="p-4 text-center">
                                                    <span className="font-bold text-orange-600 text-lg">
                                                        RM{(() => {
                                                            let total = 0;
                                                            (purchaseOrderItems[selectedPO.id] || []).forEach(item => {
                                                                const receiveQty = partialReceiveData[item.id] || 0;
                                                                total += receiveQty * item.unit_cost;
                                                            });
                                                            return total.toFixed(2);
                                                        })()}
                                                    </span>
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        </div>
                        
                        {/* 底部操作按钮 */}
                        <div className="border-t p-6 bg-gray-50 flex gap-3 justify-end rounded-b-lg">
                            <button
                                onClick={() => setShowPartialReceiveModal(false)}
                                className="px-6 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg font-medium transition-all"
                            >
                                <i className="fas fa-times mr-2"></i>
                                取消
                            </button>
                            <button
                                onClick={confirmPartialReceive}
                                disabled={loading || (() => {
                                    const items = purchaseOrderItems[selectedPO.id] || [];
                                    return !items.some(item => (partialReceiveData[item.id] || 0) > 0);
                                })()}
                                className="px-6 py-2 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-lg font-medium transition-all shadow-lg disabled:bg-gray-300 disabled:cursor-not-allowed"
                            >
                                {loading ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin mr-2"></i>
                                        处理中...
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-check mr-2"></i>
                                        确认收货
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            
            {/* 流水记录管理 */}
            {activeTab === 'transactions' && (
                <div>
                    <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded mb-6">
                        <div className="flex items-start">
                            <i className="fas fa-info-circle text-amber-500 mt-1 mr-3"></i>
                            <div>
                                <p className="font-semibold text-amber-800">采购入库流水记录</p>
                                <p className="text-sm text-amber-600 mt-1">
                                    显示所有采购入库操作，可以编辑原因和类型，或回滚错误的入库操作。
                                </p>
                            </div>
                        </div>
                    </div>
                    
                    {loadingTransactions ? (
                        <div className="flex items-center justify-center py-8">
                            <i className="fas fa-spinner fa-spin mr-2"></i>
                            加载流水记录中...
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50">
                                        <th className="p-3 text-left">时间</th>
                                        <th className="p-3 text-left">产品</th>
                                        <th className="p-3 text-left">类型</th>
                                        <th className="p-3 text-left">数量变动</th>
                                        <th className="p-3 text-left">库存变化</th>
                                        <th className="p-3 text-left">原因</th>
                                        <th className="p-3 text-left">操作人</th>
                                        <th className="p-3 text-left">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {purchaseTransactions.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} className="p-8 text-center text-gray-500">
                                                <i className="fas fa-inbox text-3xl mb-2 block"></i>
                                                暂无采购入库记录
                                            </td>
                                        </tr>
                                    ) : (
                                        purchaseTransactions.map((trans) => {
                                            const typeConfig = {
                                                stock_in: { label: '入库', color: 'bg-green-100 text-green-800', icon: 'fa-arrow-up' },
                                            };
                                            const config = typeConfig[trans.transaction_type] || { label: trans.transaction_type, color: 'bg-gray-100 text-gray-700', icon: 'fa-question' };
                                            
                                            const isReversed = purchaseTransactions.some(t => 
                                                t.transaction_type === 'stock_adjustment_reversal' && 
                                                t.notes && t.notes.includes(`回滚入库操作 ID: ${trans.id}`)
                                            );
                                            
                                            return (
                                                <tr key={trans.id} className={`border-b hover:bg-gray-50 ${
                                                    isReversed ? 'opacity-60 bg-red-50' : ''
                                                }`}>
                                                    <td className="p-3 text-xs">
                                                        {new Date(trans.created_at).toLocaleString('zh-CN', {
                                                            year: 'numeric',
                                                            month: '2-digit',
                                                            day: '2-digit',
                                                            hour: '2-digit',
                                                            minute: '2-digit'
                                                        })}
                                                    </td>
                                                    <td className="p-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-lg">{trans.product?.emoji || '📦'}</span>
                                                            <span className="font-medium">{trans.product?.name || '未知产品'}</span>
                                                        </div>
                                                    </td>
                                                    <td className="p-3">
                                                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
                                                            <i className={`fas ${config.icon} mr-1`}></i>
                                                            {config.label}
                                                        </span>
                                                    </td>
                                                    <td className="p-3">
                                                        <span className={`font-bold ${trans.quantity >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                            {trans.quantity >= 0 ? '+' : ''}{trans.quantity}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-xs text-gray-600">
                                                        {trans.previous_stock} → {trans.new_stock}
                                                    </td>
                                                    <td className="p-3 text-xs">
                                                        <div className="space-y-1">
                                                            <div>{trans.reason || '-'}</div>
                                                            {trans.notes && (
                                                                <details className="text-gray-600 mt-1">
                                                                    <summary className="cursor-pointer text-blue-600 hover:text-blue-800">
                                                                        <i className="fas fa-info-circle mr-1"></i>查看详情
                                                                    </summary>
                                                                    <div className="mt-1 p-2 bg-gray-50 rounded text-xs border border-gray-200">
                                                                        {trans.notes}
                                                                    </div>
                                                                </details>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="p-3 text-xs">
                                                        <span className={`px-2 py-1 rounded text-xs ${
                                                            trans.operator === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'
                                                        }`}>
                                                            {trans.operator === 'admin' ? '👤 管理员' : trans.operator || '系统'}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-xs">
                                                        <div className="flex flex-col gap-1">
                                                            {/* 编辑按钮 */}
                                                            <button
                                                                onClick={() => {
                                                                    setEditingTransaction(trans);
                                                                    setShowEditTransactionModal(true);
                                                                }}
                                                                disabled={isReversed}
                                                                className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors disabled:bg-gray-200 disabled:text-gray-500"
                                                                title="编辑此记录"
                                                            >
                                                                {loading ? (
                                                                    <><i className="fas fa-spinner fa-spin mr-1"></i>编辑</>
                                                                ) : (
                                                                    <><i className="fas fa-edit mr-1"></i>编辑</>
                                                                )}
                                                            </button>
                                                            
                                                            {/* 回滚按钮 */}
                                                            {trans.transaction_type === 'stock_in' && !isReversed && (
                                                                <button
                                                                    onClick={() => reversePurchaseTransaction(trans.id)}
                                                                    disabled={loading}
                                                                    className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors disabled:bg-gray-200 disabled:text-gray-500"
                                                                    title="回滚此入库操作"
                                                                >
                                                                    {loading ? (
                                                                        <><i className="fas fa-spinner fa-spin mr-1"></i>回滚中</>
                                                                    ) : (
                                                                        <><i className="fas fa-undo mr-1"></i>回滚</>
                                                                    )}
                                                                </button>
                                                            )}
                                                            
                                                            {isReversed && (
                                                                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                                                                    <i className="fas fa-check mr-1"></i>已回滚
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
            
            {/* 编辑流水记录模态框 */}
            {showEditTransactionModal && editingTransaction && (
                <EditTransactionModal
                    transaction={editingTransaction}
                    products={products}
                    onClose={() => {
                        setShowEditTransactionModal(false);
                        setEditingTransaction(null);
                    }}
                    onSave={async (updatedData) => {
                        try {
                            setLoading(true);
                            const { error } = await supabase
                                .from('stock_transactions')
                                .update({
                                    transaction_type: updatedData.transaction_type,
                                    reason: updatedData.reason,
                                    notes: updatedData.notes ? 
                                        (editingTransaction.notes ? 
                                            editingTransaction.notes + ' [编辑：' + updatedData.notes + ']' : 
                                            '[编辑：' + updatedData.notes + ']'
                                        ) : editingTransaction.notes
                                })
                                .eq('id', editingTransaction.id);
                            
                            if (error) throw error;
                            
                            showToast('✅ 采购流水记录更新成功', 'success');
                            setShowEditTransactionModal(false);
                            setEditingTransaction(null);
                            await updateAfterPurchaseEdit();
                        } catch (error: any) {
                            showToast(`❌ 更新失败：${error.message}`, 'danger');
                        } finally {
                            setLoading(false);
                        }
                    }}
                    loading={loading}
                />
            )}
        </div>
    );
};

const AdminAnalytics: React.FC<{ allOrders: Order[]; products: Product[]; }> = ({ allOrders, products }) => {
    const getConsolidatedName = useCallback((name: string) => {
        // 0. 标准化空格（将多个连续空格替换为单个空格）
        const normalizedName = name.replace(/\s+/g, ' ').trim();
        
        // 1. 精确匹配（使用标准化后的名称）
        if ((productMapping as any)[normalizedName]) {
            return (productMapping as any)[normalizedName];
        }
        
        // 1.5 尝试用原始名称精确匹配（以防 mapping 中有多余空格）
        if ((productMapping as any)[name]) {
            return (productMapping as any)[name];
        }
        
        // 2. 模糊匹配：检查是否有任何 mapping 键包含在产品名中，或产品名包含在 mapping 键中
        const mappingEntries = Object.entries(productMapping);
        for (const [key, value] of mappingEntries) {
            // 标准化后比较
            const normalizedKey = key.replace(/\s+/g, ' ').trim();
            
            // 精确匹配标准化版本
            if (normalizedName === normalizedKey) {
                return value as string;
            }
            
            // 如果产品名包含 mapping 的键（去除括号和空格后比较）
            const cleanName = normalizedName.replace(/\s*\([^)]*\)/g, '').trim();
            const cleanKey = normalizedKey.replace(/\s*\([^)]*\)/g, '').trim();
            
            if (cleanName === cleanKey || 
                cleanName.includes(cleanKey) || 
                cleanKey.includes(cleanName)) {
                return value as string;
            }
        }
        
        // 3. 如果都找不到，返回清理后的产品名（去除括号内容）
        return normalizedName.replace(/\s*\([^)]*\)/g, '').trim();
    }, []);

    const [trendDays, setTrendDays] = useState(30);
    const salesTrendData = useMemo(() => {
        const salesByDate: { [key: string]: number } = {};
        let startDate: Date | null = null;
        if (trendDays !== 0) {
            startDate = new Date();
            startDate.setDate(startDate.getDate() - trendDays);
        }
        allOrders
            .filter(o => o.status !== 'cancelled') // 只排除已取消的订单，保留所有其他状态
            .filter(o => !startDate || new Date(o.created_at) > startDate)
            .forEach(o => {
                const date = new Date(o.created_at).toISOString().split('T')[0];
                salesByDate[date] = (salesByDate[date] || 0) + (o.total_amount || 0);
            });
        return Object.keys(salesByDate)
            .map(date => ({ date, sales: salesByDate[date] }))
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }, [allOrders, trendDays]);

    const productSales = useMemo(() => {
        // 彻底归一化所有产品名，聚合所有变体
        const sales: {
            [key: string]: {
                name: string,
                quantity: number,
                revenue: number,
                variants: Set<string>,
                variantCount: number
            }
        } = {};
        
        // 1. 首先，为所有数据库产品初始化（确保所有产品都显示，即使销量为0）
        products.forEach(product => {
            // 🔧 修复：更严格地排除运费产品（与仪表盘统计逻辑保持一致）
            const isShippingProduct = product.name.includes('运费专用') || 
                                    product.name.includes('运费') ||
                                    product.name.toLowerCase().includes('shipping');
            
            if (isShippingProduct) return;
            
            const productName = product.name.trim();
            // 使用归一化后的产品名作为键（确保与订单统计使用相同的键）
            const consolidatedName = getConsolidatedName(productName);
            if (!sales[consolidatedName]) {
                sales[consolidatedName] = {
                    name: consolidatedName,
                    quantity: 0,
                    revenue: 0,
                    variants: new Set([productName]), // 原始数据库产品名作为第一个变体
                    variantCount: 1
                };
            }
        });
        
        // 2. 然后，统计订单中的销售数据（只累加到数据库产品中）
        allOrders
            .filter(order => order.status !== 'cancelled') // 只排除已取消的订单，保留所有其他状态（包括pending）
            .forEach(o => o.order_items.forEach(item => {
                // 🔧 修复：更严格地排除运费产品（与仪表盘统计逻辑保持一致）
                const isShippingProduct = item.product.includes('运费专用') || 
                                        item.product.includes('运费') ||
                                        item.product.toLowerCase().includes('shipping');
                
                if (isShippingProduct) return;
                
                // 先归一化产品名
                const consolidated = getConsolidatedName(item.product.trim());
                
                // 只有当这个产品在数据库中存在时，才统计销量
                if (sales[consolidated]) {
                    sales[consolidated].quantity += (item.quantity || 0);
                    sales[consolidated].revenue += (item.quantity || 0) * (item.price || 0);
                    // 存储原始产品名作为变体（用于显示所有变体名称）
                    sales[consolidated].variants.add(item.product.trim());
                    sales[consolidated].variantCount = sales[consolidated].variants.size;
                }
                // 如果产品不在数据库中（历史产品），忽略它
            }));
        // 转换 Set 为数组
        return Object.values(sales).map(s => ({
            ...s,
            variants: Array.from(s.variants)
        }));
    }, [allOrders, products, getConsolidatedName]);

    const topProductsByQuantity = useMemo(() => {
        return [...productSales].sort((a, b) => b.quantity - a.quantity).slice(0, 10);
    }, [productSales]);

    const topProductsByRevenue = useMemo(() => {
        return [...productSales].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    }, [productSales]);

    const topCustomersData = useMemo(() => {
        const customerSales: { [phone: string]: { name: string, phone: string, totalAmount: number, orderCount: number } } = {};
        allOrders
            .filter(order => order.status !== 'cancelled') // 只排除已取消的订单，保留所有其他状态（包括pending）
            .forEach(o => {
                const phone = o.phone;
                if (!phone) return;
                if (!customerSales[phone]) {
                    customerSales[phone] = { name: o.name, phone, totalAmount: 0, orderCount: 0 };
                }
                customerSales[phone].totalAmount += (o.total_amount || 0);
                customerSales[phone].orderCount += 1;
            });
        return Object.values(customerSales).sort((a, b) => b.totalAmount - a.totalAmount).slice(0, 10);
    }, [allOrders]);

    const deliveryMethodData = useMemo(() => {
        const counts = allOrders.reduce((acc, order) => {
            const method = order.delivery_method === 'self-pickup' ? '自取' : 'Lalamove';
            acc[method] = (acc[method] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }, [allOrders]);

    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#FF1943'];

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">数据分析</h2>

            <div className="bg-white p-6 rounded-lg shadow">
            <div className="bg-white p-6 rounded-lg shadow mt-6">
                <h3 className="text-lg font-semibold mb-4 text-center">所有产品总销量（聚合变体）</h3>
                
                <table className="w-full text-sm border">
                    <thead>
                        <tr className="bg-gray-100">
                            <th className="p-2 text-left">产品名称</th>
                            <th className="p-2 text-left">变体</th>
                            <th className="p-2 text-right">变体数</th>
                            <th className="p-2 text-right">总销量</th>
                            <th className="p-2 text-right">总销售额</th>
                        </tr>
                    </thead>
                    <tbody>
                        {productSales
                            .sort((a, b) => b.quantity - a.quantity)
                            .map(stats => (
                                <tr key={stats.name} className="border-t">
                                    <td className="p-2">{stats.name}</td>
                                    <td className="p-2">{stats.variants.join(', ')}</td>
                                    <td className="p-2 text-right">{stats.variantCount}</td>
                                    <td className="p-2 text-right">{stats.quantity}</td>
                                    <td className="p-2 text-right">RM{stats.revenue.toFixed(2)}</td>
                                </tr>
                            ))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-gray-50 font-semibold border-t-2">
                            <td className="p-2" colSpan={2}>
                                总计：{productSales.length} 个产品组
                            </td>
                            <td className="p-2 text-right">
                                {productSales.reduce((sum, s) => sum + s.variantCount, 0)} 个变体
                            </td>
                            <td className="p-2 text-right">
                                {productSales.reduce((sum, s) => sum + s.quantity, 0)} 件
                            </td>
                            <td className="p-2 text-right">
                                RM{productSales.reduce((sum, s) => sum + s.revenue, 0).toFixed(2)}
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
                <div className="flex flex-wrap items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-center">销售趋势</h3>
                    <select
                        className="ml-2 px-2 py-1 border rounded text-sm"
                        value={trendDays}
                        onChange={e => setTrendDays(Number(e.target.value))}
                        style={{ minWidth: 90 }}
                    >
                        <option value={30}>近30天</option>
                        <option value={60}>近60天</option>
                        <option value={90}>近90天</option>
                        <option value={0}>全部</option>
                    </select>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={salesTrendData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis />
                        <Tooltip formatter={(value: number) => `RM${value.toFixed(2)}`} />
                        <Legend />
                        <Line type="monotone" dataKey="sales" name="销售额" stroke="#8884d8" activeDot={{ r: 8 }} />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-semibold mb-4 text-center">产品销量分布 (Top 10)</h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                            <Pie
                                data={topProductsByQuantity}
                                cx="50%"
                                cy="50%"
                                labelLine={false}
                                outerRadius={80}
                                fill="#8884d8"
                                dataKey="quantity"
                                nameKey="name"
                                label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                            >
                                {topProductsByQuantity.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip formatter={(value: number, name: string) => [`${name}: ${value} 件`]} />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-semibold mb-4 text-center">取货方式分布</h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                            <Pie data={deliveryMethodData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} fill="#82ca9d" label>
                                {deliveryMethodData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                            </Pie>
                            <Tooltip />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-semibold mb-4 text-center">Top 10 畅销产品 (按数量)</h3>
                    <ResponsiveContainer width="100%" height={400}>
                        <BarChart data={topProductsByQuantity} layout="vertical" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" />
                            <YAxis type="category" dataKey="name" width={100} interval={0} />
                            <Tooltip formatter={(value: number) => [`${value} 件`]} />
                            <Legend />
                            <Bar dataKey="quantity" name="销售数量" fill="#82ca9d" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-semibold mb-4 text-center">Top 10 畅销产品 (按收入)</h3>
                    <ResponsiveContainer width="100%" height={400}>
                        <BarChart data={topProductsByRevenue} layout="vertical" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" allowDecimals={false} />
                            <YAxis type="category" dataKey="name" width={100} interval={0} />
                            <Tooltip formatter={(value: number) => [`RM${value.toFixed(2)}`]} />
                            <Legend />
                            <Bar dataKey="revenue" name="销售收入" fill="#8884d8" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold mb-4 text-center">Top 10 客户 (按消费)</h3>
                <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={topCustomersData} margin={{ top: 5, right: 30, left: 20, bottom: 100 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" angle={-45} textAnchor="end" interval={0} />
                        <YAxis />
                        <Tooltip formatter={(value: number) => `RM${value.toFixed(2)}`} />
                        <Legend />
                        <Bar dataKey="totalAmount" name="总消费" fill="#ffc658" />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
const AdminMembers: React.FC<{ showToast: Function; featureFlags: FeatureFlags; members: Member[]; allOrders: Order[]; }> = ({ showToast, featureFlags, members, allOrders }) => { 
    const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc'); // 默认降序（最高消费在前）
    
    if (!featureFlags.members_enabled) return <div className="bg-white p-6 rounded-lg shadow">会员系统当前已禁用。可在【系统设置】中开启。</div>
    
    // 按手机号聚合订单金额，统计会员总消费（只统计已完成的订单）
    const memberSpendingMap = useMemo(() => {
        const spendingMap: { [phone: string]: number } = {};
        allOrders
            .filter(order => order.status !== 'cancelled') // 只排除已取消的订单，保留所有其他状态（包括pending）
            .forEach(order => {
                const phone = order.phone;
                if (!phone) return;
                spendingMap[phone] = (spendingMap[phone] || 0) + (order.total_amount || 0);
            });
        return spendingMap;
    }, [allOrders]);

    // 按消费金额排序会员列表
    const sortedMembers = useMemo(() => {
        return [...members].sort((a, b) => {
            const aSpent = memberSpendingMap[a.phone] || 0;
            const bSpent = memberSpendingMap[b.phone] || 0;
            return sortOrder === 'desc' ? bSpent - aSpent : aSpent - bSpent;
        });
    }, [members, sortOrder, memberSpendingMap]);
    
    return (
        <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex flex-wrap gap-3 items-center justify-between mb-4">
                <h2 className="text-lg font-bold">会员管理 ({members.length})</h2>
                <div className="flex gap-2 items-center">
                    <span className="text-sm text-gray-600">按消费排序:</span>
                    <button
                        onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                        className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-sm font-medium transition-colors"
                    >
                        {sortOrder === 'desc' ? '🔻 高到低' : '🔺 低到高'}
                    </button>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="p-3 text-left">姓名</th>
                            <th className="p-3 text-left">电话</th>
                            <th className="p-3 text-left">会员号</th>
                            <th className="p-3 text-left">积分</th>
                            <th className="p-3 text-left">
                                总消费 (RM)
                                <span className="ml-1 text-xs text-gray-500">
                                    {sortOrder === 'desc' ? '↓' : '↑'}
                                </span>
                                <span className="ml-2 text-xs text-gray-400">(统计所有已完成订单总金额，包括运费)</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedMembers.map((m, index) => (
                            <tr key={m.id} className="border-b hover:bg-gray-50">
                                <td className="p-3">
                                    <div className="flex items-center gap-2">
                                        {/* 显示排名 */}
                                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">
                                            #{index + 1}
                                        </span>
                                        {m.name}
                                    </div>
                                </td>
                                <td className="p-3">{m.phone}</td>
                                <td className="p-3">{m.member_no}</td>
                                <td className="p-3">{m.points}</td>
                                <td className="p-3">
                                    <span className="font-semibold text-green-600">
                                        {(memberSpendingMap[m.phone] || 0).toFixed(2)}
                                    </span>
                                    {/* 显示与数据库记录的差异 */}
                                    {Math.abs((memberSpendingMap[m.phone] || 0) - (m.total_spent || 0)) > 0.01 && (
                                        <div className="text-xs text-orange-600 mt-1">
                                            DB记录: {(m.total_spent || 0).toFixed(2)} 
                                            <span className="ml-1 text-gray-500">(差异)</span>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
const AdminSettings: React.FC<{ showToast: Function; featureFlags: FeatureFlags; setFeatureFlags: Function }> = ({ showToast, featureFlags, setFeatureFlags }) => { 
    const handleFlagChange = async (key: keyof FeatureFlags, value: boolean) => {
        const newFlags = { ...featureFlags, [key]: value };
        setFeatureFlags(newFlags);
        const { error } = await supabase.from('settings').update({ value: newFlags }).eq('key', 'feature_flags');
        if (error) showToast(`设置保存失败: ${error.message}`, 'danger');
        else showToast('设置已保存', 'success');
    };
    return (
        <div className="bg-white p-6 rounded-lg shadow max-w-md">
            <h2 className="text-lg font-bold mb-4">系统设置</h2>
            <div className="space-y-4">
                <div className="flex justify-between items-center"><label>启用会员系统</label><input type="checkbox" checked={featureFlags.members_enabled} onChange={e => handleFlagChange('members_enabled', e.target.checked)} className="h-5 w-5 rounded"/></div>
            </div>
        </div>
    );
};
const AdminScannerCamera: React.FC = () => { 
    const [activeTab, setActiveTab] = useState('camera');
    const [scanResult, setScanResult] = useState<string[]>([]);
    const qrReaderRef = useRef<HTMLDivElement>(null);
    const html5QrCodeRef = useRef<any>(null);

    const startScanner = useCallback(() => {
        if (qrReaderRef.current && !html5QrCodeRef.current) {
            const html5QrCode = new Html5Qrcode(qrReaderRef.current.id);
            html5QrCodeRef.current = html5QrCode;
            const config = { fps: 10, qrbox: { width: 250, height: 250 } };
            html5QrCode.start({ facingMode: "environment" }, config, 
                (decodedText: string) => { setScanResult(prev => [decodedText, ...prev]); },
                () => {}
            ).catch(() => {});
        }
    }, []);

    const stopScanner = useCallback(() => {
        if (html5QrCodeRef.current?.getState() === 2) { // 2 is SCANNING state
            html5QrCodeRef.current.stop().then(() => {
                html5QrCodeRef.current = null;
            }).catch(() => {});
        }
    }, []);

    useEffect(() => {
        return () => { stopScanner(); }
    }, [stopScanner]);

    return (
        <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-bold mb-4">扫码 & 拍照</h2>
            <div className="border-b mb-4 flex gap-4">
                <button onClick={() => {stopScanner(); setActiveTab('camera');}} className={`py-2 px-1 border-b-2 font-medium ${activeTab === 'camera' ? 'border-red-500 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>相机扫描</button>
                <button onClick={() => {stopScanner(); setActiveTab('gun');}} className={`py-2 px-1 border-b-2 font-medium ${activeTab === 'gun' ? 'border-red-500 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>扫码枪</button>
            </div>
            {activeTab === 'camera' && <>
                <div id="qr-reader-admin" ref={qrReaderRef} style={{ width: '100%', maxWidth: '500px' }} className="my-4 rounded-lg overflow-hidden"></div>
                <div className="flex gap-4">
                    <button onClick={startScanner} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold">开始扫描</button>
                    <button onClick={stopScanner} className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 font-semibold">停止</button>
                </div>
            </>}
            {activeTab === 'gun' && <input className="w-full p-2 border rounded mt-4" placeholder="等待扫码枪输入..." onKeyDown={e => {if(e.key === 'Enter') {setScanResult(prev => [(e.target as HTMLInputElement).value, ...prev]);(e.target as HTMLInputElement).value = '';}}} />}
            {scanResult.length > 0 && <div className="mt-4 p-4 bg-gray-100 rounded"><h4>扫描结果:</h4><ul className="list-disc list-inside">{scanResult.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
        </div>
    );
};


// --- Admin Main View ---
interface AdminViewProps {
    onExit: () => void;
    showToast: (message: string, type?: 'success' | 'danger' | 'warning') => void;
}

const Login: React.FC<{ onLogin: () => void; onExit: () => void; showToast: Function; }> = ({ onLogin, onExit, showToast }) => {
    const [password, setPassword] = useState('');
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (password === ADMIN_PASSWORD) { onLogin(); showToast('登录成功', 'success'); }
        else { showToast('密码错误', 'danger'); }
    };
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
            <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm">
                <h2 className="text-2xl font-bold text-center mb-6 text-gray-800">管理员登录</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="relative">
                        <input 
                            type={isPasswordVisible ? 'text' : 'password'} 
                            value={password} 
                            onChange={(e) => setPassword(e.target.value)} 
                            placeholder="请输入管理员密码" 
                            className="w-full px-4 py-3 border rounded-lg pr-10"
                            autoFocus 
                            required 
                        />
                        <button 
                            type="button" 
                            onClick={() => setIsPasswordVisible(!isPasswordVisible)} 
                            className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-500"
                            aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                        >
                            <i className={`fas ${isPasswordVisible ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                        </button>
                    </div>
                    <button type="submit" className="w-full bg-red-600 text-white font-bold py-3 rounded-lg hover:bg-red-700">登录</button>
                    <button type="button" onClick={onExit} className="w-full bg-gray-200 text-gray-800 font-bold py-3 rounded-lg hover:bg-gray-300 mt-2">返回商店</button>
                </form>
            </div>
        </div>
    );
};

export const AdminView: React.FC<AdminViewProps> = ({ onExit, showToast }) => {
    const [isAuthenticated, setAuthenticated] = useState(() => {
        // 从 localStorage 恢复登录状态
        const saved = localStorage.getItem('adminAuthenticated');
        return saved === 'true';
    });
    const [view, setView] = useState('dashboard');
    const [loading, setLoading] = useState(true);

    const [products, setProducts] = useState<Product[]>([]);
    const [allOrders, setAllOrders] = useState<Order[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [featureFlags, setFeatureFlags] = useState<FeatureFlags>({ members_enabled: true, points_enabled: true, spending_tracking_enabled: true });

    // 打包模式状态
    const [packingMode, setPackingMode] = useState(false);
    const [packingOrder, setPackingOrder] = useState<Order | null>(null);
    const [packedItems, setPackedItems] = useState<{[key: string]: number}>({});
    const [scannerActive, setScannerActive] = useState(false);

    // 库存流水管理状态
    const [stockTransactions, setStockTransactions] = useState<any[]>([]);
    const [showTransactionModal, setShowTransactionModal] = useState(false);
    const [loadingTransactions, setLoadingTransactions] = useState(false);
    const [reversalTransactionId, setReversalTransactionId] = useState<string | null>(null);

    // 获取库存交易记录
    const fetchStockTransactions = async () => {
        console.log('📦📦📦 fetchStockTransactions 开始执行...');
        try {
            setLoadingTransactions(true);
            const { data, error } = await supabase
                .from('stock_transactions')
                .select(`
                    *,
                    product:product_id(name, emoji)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setStockTransactions(data || []);
            
            // 🔍 调试: 将数据暴露到 window 对象供浏览器控制台访问
            (window as any).stockTransactions = data || [];
            console.log('✅ 已将 stockTransactions 暴露到 window 对象');
        } catch (error: any) {
            console.error('获取库存交易记录失败:', error);
            showToast('获取库存交易记录失败', 'danger');
        } finally {
            setLoadingTransactions(false);
        }
    };

    // 库存流水回滚
    const reverseStockTransaction = async (transactionId: string, transaction: any) => {
        try {
            setReversalTransactionId(transactionId);
            
            // 只能回滚手动调整和部分发货类型的交易
            if (!['stock_adjustment', 'manual_in', 'manual_out', 'partial_delivery', 'manual_order'].includes(transaction.transaction_type)) {
                showToast('此类型的库存操作无法回滚', 'danger');
                return;
            }

            // 确认回滚
            if (!window.confirm(`确认要回滚这条库存记录吗？\n\n产品: ${transaction.product?.name}\n类型: ${transaction.transaction_type}\n数量: ${transaction.quantity}\n原因: ${transaction.reason}\n\n回滚后库存将恢复到: ${transaction.previous_stock}`)) {
                return;
            }

            // 获取当前库存
            const { data: product, error: productError } = await supabase
                .from('products')
                .select('stock_quantity')
                .eq('id', transaction.product_id)
                .single();

            if (productError) throw productError;

            const currentStock = product.stock_quantity;
            let newStock;
            let reversalType;
            let reversalQuantity;

            // 根据原交易类型进行反向操作
            switch (transaction.transaction_type) {
                case 'stock_adjustment':
                case 'manual_in':
                    // 原来是增加库存，现在减少库存
                    newStock = currentStock - transaction.quantity;
                    reversalType = 'stock_adjustment_reversal';
                    reversalQuantity = transaction.quantity;
                    break;
                case 'manual_out':
                    // 原来是减少库存，现在增加库存
                    newStock = currentStock + transaction.quantity;
                    reversalType = 'stock_adjustment_reversal';
                    reversalQuantity = transaction.quantity;
                    break;
                default:
                    throw new Error('不支持的交易类型');
            }

            if (newStock < 0) {
                showToast('回滚失败：库存不能为负数', 'danger');
                return;
            }

            // 更新产品库存
            const { error: stockError } = await supabase
                .from('products')
                .update({ stock_quantity: newStock })
                .eq('id', transaction.product_id);

            if (stockError) throw stockError;

            // 记录回滚流水
            const { error: transactionError } = await supabase
                .from('stock_transactions')
                .insert([{
                    product_id: transaction.product_id,
                    transaction_type: reversalType,
                    quantity: reversalQuantity,
                    previous_stock: currentStock,
                    new_stock: newStock,
                    reason: '库存调整回滚',
                    operator: 'admin',
                    notes: `回滚交易记录\n原交易ID: ${transactionId}\n原交易类型: ${transaction.transaction_type}\n原交易数量: ${transaction.quantity}\n原交易原因: ${transaction.reason}\n原交易时间: ${new Date(transaction.created_at).toLocaleString()}`
                }]);

            if (transactionError) {
                console.error('回滚流水记录失败:', transactionError);
            }

            // 标记原交易为已回滚
            const { error: markError } = await supabase
                .from('stock_transactions')
                .update({ 
                    notes: `${transaction.notes || ''}\n\n【已回滚】- ${new Date().toLocaleString()}`
                })
                .eq('id', transactionId);

            if (markError) {
                console.error('标记原交易失败:', markError);
            }

            showToast('库存回滚成功！', 'success');
            await fetchData(); // 刷新产品列表
            await fetchStockTransactions(); // 刷新交易记录

        } catch (error: any) {
            console.error('库存回滚失败:', error);
            showToast(`库存回滚失败: ${error.message}`, 'danger');
        } finally {
            setReversalTransactionId(null);
        }
    };

    // 库存流水回滚 (简化版，接收transactionId)
    const reverseStockTransactionById = async (transactionId: string) => {
        try {
            setReversalTransactionId(transactionId);
            
            // 先获取交易记录详情
            const { data: transaction, error: fetchError } = await supabase
                .from('stock_transactions')
                .select(`
                    *,
                    product:product_id(name, emoji)
                `)
                .eq('id', transactionId)
                .single();
                
            if (fetchError) {
                throw new Error(`获取交易记录失败: ${fetchError.message}`);
            }
            
            if (!transaction) {
                throw new Error('交易记录不存在');
            }
            
            // 调用完整的回滚函数
            await reverseStockTransaction(transactionId, transaction);
            
        } catch (error: any) {
            console.error('库存回滚失败:', error);
            showToast(`库存回滚失败: ${error.message}`, 'danger');
            setReversalTransactionId(null);
        }
    };

    const fetchData = useCallback(async () => {
        console.log('🚀🚀🚀 fetchData 开始执行...');
        setLoading(true);
        try {
            // 1. 先快速加载 products, members, settings
            const [productsRes, membersRes, settingsRes] = await Promise.all([
                supabase.from('products').select('*').order('id'),
                supabase.from('members').select('*'),
                supabase.from('settings').select('value').eq('key', 'feature_flags').single()
            ]);

            if (productsRes.error) throw productsRes.error;
            setProducts(productsRes.data);

            if (membersRes.error) throw membersRes.error;
            setMembers(membersRes.data);

            if (settingsRes.data?.value) {
                setFeatureFlags(prev => ({ ...prev, ...(settingsRes.data.value as FeatureFlags) }));
            }

            // 2. 分页加载所有订单（带进度提示）
            console.log('📦 开始加载订单数据...');
            const startTime = Date.now();
            
            let allOrdersData: Order[] = [];
            let from = 0;
            const batchSize = 1000;
            let hasMore = true;
            let batchCount = 0;

            while (hasMore) {
                const { data, error, count } = await supabase
                    .from('orders')
                    .select('*', { count: 'exact' })  // 👈 获取总数
                    .order('created_at', { ascending: false })
                    .range(from, from + batchSize - 1);

                if (error) {
                    console.error('❌ 订单加载失败:', error);
                    throw error;
                }

                if (data && data.length > 0) {
                    batchCount++;
                    allOrdersData = [...allOrdersData, ...data];
                    
                    // 显示进度
                    const progress = count ? Math.round((allOrdersData.length / count) * 100) : 0;
                    console.log(
                      `✅ 批次${batchCount}: 加载${data.length}条 | ` +
                      `累计${allOrdersData.length}条 | ` +
                      `进度${progress}%`
                    );
                    
                    from += batchSize;
                    hasMore = data.length === batchSize;
                } else {
                    hasMore = false;
                }
            }

            const endTime = Date.now();
            const loadTime = ((endTime - startTime) / 1000).toFixed(2);
            
            console.log(
              `🎉 订单加载完成！\n` +
              `   总数: ${allOrdersData.length}条\n` +
              `   批次: ${batchCount}次\n` +
              `   耗时: ${loadTime}秒`
            );
            
            setAllOrders(allOrdersData);
            
            // 🔍 调试: 将数据暴露到 window 对象供浏览器控制台访问
            (window as any).orders = allOrdersData;
            console.log('✅ 已将 orders 暴露到 window 对象');
            
            // 3. 加载库存流水数据
            await fetchStockTransactions();

        } catch (error: any) {
            console.error('❌ 数据加载失败:', error);
            showToast(`数据加载失败: ${error.message}`, 'danger');
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    // 打包模式相关函数
    const startPackingMode = (orderId: string) => {
        const order = allOrders.find(o => o.order_id === orderId);
        if (order) {
            setPackingOrder(order);
            setPackingMode(true);
            setPackedItems({});
            showToast(`开始打包订单 #${orderId}`, 'success');
        } else {
            showToast('订单未找到', 'danger');
        }
    };

    const handleBarcodeScan = (scannedData: string) => {
        // 处理订单条形码 - 启动打包模式（支持 ORDER-FW... 或直接 FW... 格式）
        const orderIdMatch = scannedData.match(/(?:ORDER-)?(FW\d+)/);
        if (orderIdMatch) {
            const orderId = orderIdMatch[1];
            startPackingMode(orderId);
            return;
        }

        // 如果不在打包模式且不是订单码，显示提示
        if (!packingOrder) {
            showToast('请先扫描订单条形码进入打包模式', 'warning');
            return;
        }

        // 处理产品条形码 - 核验产品  
        console.log('🔍 开始产品条形码匹配');
        console.log('📝 扫描的条形码:', scannedData, '(长度:', scannedData.length, ')');
        console.log('📦 当前订单商品:', packingOrder.order_items.map(i => i.product));
        
        // 清理扫描数据：去除空格、换行符等
        const cleanedScanned = scannedData.trim().replace(/\s+/g, '');
        
        // 支持多个条形码（逗号分隔）- 精确匹配
        let product = products.find(p => {
            if (!p.barcode) return false;
            const barcodes = p.barcode.split(',').map(bc => bc.trim());
            return barcodes.some(bc => bc === cleanedScanned);
        });
        
        // 尝试不区分大小写匹配
        if (!product) {
            const lowerScanned = cleanedScanned.toLowerCase();
            product = products.find(p => {
                if (!p.barcode) return false;
                const barcodes = p.barcode.split(',').map(bc => bc.trim().toLowerCase());
                return barcodes.some(bc => bc === lowerScanned);
            });
        }
        
        // 尝试去除特殊字符后匹配（如连字符、下划线等）
        if (!product) {
            const alphanumericScanned = cleanedScanned.replace(/[^a-zA-Z0-9]/g, '');
            product = products.find(p => {
                if (!p.barcode) return false;
                const barcodes = p.barcode.split(',').map(bc => 
                    bc.trim().replace(/[^a-zA-Z0-9]/g, '')
                );
                return barcodes.some(bc => bc === alphanumericScanned);
            });
        }
        
        if (product) {
            console.log('✅ 找到匹配产品:', product.name);
        } else {
            console.log('❌ 未找到匹配产品');
            console.log('💡 产品列表中的条形码:', products
                .filter(p => p.barcode)
                .map(p => `${p.name}: ${p.barcode}`)
                .slice(0, 10)
            );
        }
        
        if (product) {
            console.log('找到匹配产品:', product);
            const orderItem = packingOrder.order_items?.find(item => 
                item.product === product.name || item.product.includes(product.name) || product.name.includes(item.product)
            );
            
            if (orderItem) {
                const itemKey = `${orderItem.product}`;
                const currentPacked = packedItems[itemKey] || 0;
                const requiredQuantity = orderItem.quantity || 1;
                
                if (currentPacked < requiredQuantity) {
                    setPackedItems(prev => ({
                        ...prev,
                        [itemKey]: currentPacked + 1
                    }));
                    
                    const newPacked = currentPacked + 1;
                    if (newPacked >= requiredQuantity) {
                        showToast(`✅ ${product.name} 已完成打包 (${newPacked}/${requiredQuantity})`, 'success');
                    } else {
                        showToast(`📦 ${product.name} 已扫描 ${newPacked}/${requiredQuantity}，还需扫描 ${requiredQuantity - newPacked} 个`, 'info');
                    }
                } else {
                    showToast(`⚠️ ${product.name} 已经完成打包了 (${currentPacked}/${requiredQuantity})`, 'warning');
                }
                showToast(`✅ 已确认打包: ${orderItem.product}`, 'success');
                console.log('产品确认成功:', orderItem.product);
            } else {
                showToast(`⚠️ ${product.name} 不在当前订单中`, 'warning');
                console.log('产品不在订单中:', product.name);
            }
        } else {
            console.log('未找到匹配的产品条形码');
            // 提供更详细的调试信息和解决方案
            showToast(`❌ 未识别的产品条形码: ${scannedData}\n\n调试信息：\n• 扫描内容: "${scannedData}"\n• 长度: ${scannedData.length}字符\n\n解决方案：\n1. 检查产品是否已录入条形码\n2. 尝试重新扫描（确保清晰）\n3. 或在产品管理中添加此条形码`, 'warning');
        }
    };

    const finishPacking = async () => {
        if (!packingOrder) return;
        
        // 检查是否所有商品都已打包确认
        const allItemsPacked = packingOrder.order_items?.every(item => {
            const packedCount = packedItems[item.product || ''] || 0;
            const requiredCount = item.quantity || 1;
            return packedCount >= requiredCount;
        });

        if (allItemsPacked) {
            // 更新订单状态为已打包
            console.log('尝试更新订单状态:', packingOrder.id);
            console.log('订单信息:', packingOrder);
            
            const { error } = await supabase
                .from('orders')
                .update({ status: 'ready for pick up' })
                .eq('id', packingOrder.id);
                
            if (!error) {
                showToast('订单打包完成！', 'success');
                setPackingMode(false);
                setPackingOrder(null);
                setPackedItems({});
                fetchData(); // 刷新数据
            } else {
                console.error('数据库更新错误:', error);
                showToast(`更新订单状态失败: ${error.message}`, 'danger');
            }
        } else {
            showToast('还有商品未确认打包', 'warning');
        }
    };

    useEffect(() => {
        if (isAuthenticated) {
            fetchData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated]);

    // 🔄 视图切换时自动刷新数据
    useEffect(() => {
        if (isAuthenticated && view) {
            console.log(`🔄 切换到视图: ${view}，刷新数据...`);
            fetchData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, isAuthenticated]);

    // 处理登录状态变化
    const handleLogin = () => {
        setAuthenticated(true);
        localStorage.setItem('adminAuthenticated', 'true');
    };

    // 处理退出登录
    const handleLogout = () => {
        setAuthenticated(false);
        localStorage.removeItem('adminAuthenticated');
        onExit();
    };

    if (!isAuthenticated) return <Login onLogin={handleLogin} onExit={onExit} showToast={showToast} />;

    const navItems = [
        { k: 'dashboard', i: 'chart-line', t: '仪表盘' }, { k: 'products', i: 'pizza-slice', t: '产品管理' },
        { k: 'orders', i: 'list', t: '订单管理' }, { k: 'inventory', i: 'boxes', t: '库存管理' },
        { k: 'purchase_orders', i: 'truck-loading', t: '采购订单' },
        { k: 'members', i: 'user-group', t: '会员管理' }, { k: 'analytics', i: 'chart-pie', t: '数据分析' },
        { k: 'staff', i: 'users', t: '员工管理' },
        { k: 'settings', i: 'gear', t: '系统设置' }, { k: 'scanner', i: 'qrcode', t: '扫码&拍照' },
    ];

    const renderView = () => {
        if (loading) return <LoadingSpinner text="正在加载后台数据..." />;
        
        // 如果在打包模式，显示打包界面
        if (packingMode && packingOrder) {
            return <PackingModeView 
                order={packingOrder} 
                products={products}
                packedItems={packedItems}
                onScanBarcode={handleBarcodeScan}
                onFinishPacking={finishPacking}
                onExitPacking={() => {
                    setPackingMode(false);
                    setPackingOrder(null);
                    setPackedItems({});
                }}
                showToast={showToast}
            />;
        }
        
        switch (view) {
            case 'dashboard': return <Dashboard setView={setView} allOrders={allOrders} products={products} showToast={showToast} />;
            case 'products': return <AdminProducts showToast={showToast} products={products} fetchData={fetchData} allOrders={allOrders} />;
            case 'orders': return <AdminOrders showToast={showToast} orders={allOrders} fetchOrders={fetchData} products={products} />;
            case 'inventory': return <AdminInventory products={products} allOrders={allOrders} onReverseTransaction={reverseStockTransactionById} onRefreshData={fetchData} showToast={showToast} />;
            case 'purchase_orders': return <AdminPurchaseOrders products={products} allOrders={allOrders} showToast={showToast} />;
            case 'members': return <AdminMembers showToast={showToast} featureFlags={featureFlags} members={members} allOrders={allOrders} />;
            case 'analytics': return <AdminAnalytics allOrders={allOrders} products={products} />;
            case 'staff': return <StaffManagement showToast={showToast} />;
            case 'settings': return <AdminSettings showToast={showToast} featureFlags={featureFlags} setFeatureFlags={setFeatureFlags} />;
            case 'scanner': return <BarcodeScannerView onScan={handleBarcodeScan} showToast={showToast} />;
            default: return <div>欢迎来到管理后台。</div>;
        }
    };

    return (
        <div className="flex flex-col md:flex-row h-screen bg-gradient-to-br from-gray-50 to-gray-100">
            <aside className="w-full md:w-64 bg-white shadow-xl flex-shrink-0 border-r border-gray-200">
                <div className="p-4 font-bold text-xl border-b hidden md:block bg-gradient-to-r from-red-600 to-red-700 text-white">
                    <i className="fas fa-crown mr-2"></i>锋味派管理
                </div>
                <nav className="p-2 md:p-4 space-x-2 md:space-x-0 md:space-y-2 flex flex-row md:flex-col overflow-x-auto">
                    {navItems.map(m => (
                        <button key={m.k} onClick={() => setView(m.k)} 
                            className={`admin-nav-item flex-shrink-0 md:w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left whitespace-nowrap transition-all duration-200 ${
                                view === m.k 
                                    ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg' 
                                    : 'hover:bg-gray-100 hover:shadow-md'
                            }`}>
                            <i className={`fas fa-${m.i} w-5`}></i>
                            <span className="hidden md:inline font-medium">{m.t}</span>
                        </button>
                    ))}
                </nav>
                <div className="p-4 mt-auto border-t bg-gray-50">
                    <button onClick={handleLogout} 
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-red-50 text-red-600 transition-all duration-200 hover:shadow-md">
                        <i className="fas fa-arrow-left mr-2"></i>返回商店
                    </button>
                </div>
            </aside>
            <main className="flex-1 p-3 md:p-6 overflow-y-auto bg-gradient-to-br from-gray-50 to-white">
                <div className="animate-fade-in">
                    {renderView()}
                </div>
            </main>
        </div>
    );
};

// ProductEditModal Component
const ProductEditModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    product: Product | null;
    onSave: (product: Product) => void;
    showToast: (message: string, type?: 'success' | 'danger' | 'warning') => void;
    userBarcodeRef: React.MutableRefObject<{[productId: number]: string}>;
}> = ({ isOpen, onClose, product, onSave, showToast, userBarcodeRef }) => {
    const [formData, setFormData] = useState<Partial<Product>>({});
    const [barcodeData, setBarcodeData] = useState('');
    const [barcodeInput, setBarcodeInput] = useState(''); // 新增：用于输入新条形码
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    // 照片上传相关状态
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);

    // 🔧 Modal 初始化逻辑 - 只在 Modal 打开/关闭时执行
    const prevIsOpenRef = useRef(false);
    
    useEffect(() => {
        const modalJustOpened = isOpen && !prevIsOpenRef.current;
        prevIsOpenRef.current = isOpen;
        
        if (modalJustOpened && product) {
            // Modal 刚打开时初始化（编辑产品）
            console.log('🆕 Modal 刚打开 - 编辑产品:', product.name, '(ID:', product.id, ')');
            console.log('🔍 product.barcode:', product.barcode);
            console.log('🔍 完整 userBarcodeRef.current:', JSON.stringify(userBarcodeRef.current));
            
            // 检查是否有用户添加的 barcode
            const userBarcode = userBarcodeRef.current[product.id];
            const barcodeToUse = userBarcode || product.barcode || '';
            
            console.log('🔍 userBarcode:', userBarcode, ', 使用:', barcodeToUse);
            
            setFormData({ ...product, barcode: barcodeToUse });
            setBarcodeData(barcodeToUse);
            setImagePreview(product.image_url || null);
            setImageFile(null);
            setBarcodeInput('');
            setShowBarcodeScanner(false);
        } else if (modalJustOpened && !product) {
            // Modal 刚打开时初始化（新建产品）
            console.log('🆕 Modal 刚打开 - 新建产品');
            setFormData({});
            setBarcodeData('');
            setImagePreview(null);
            setImageFile(null);
            setBarcodeInput('');
            setShowBarcodeScanner(false);
        }
    }, [isOpen, product, userBarcodeRef]);
    
    // 🔧 当 product 更新时（数据刷新），保护用户添加的 barcode
    useEffect(() => {
        if (isOpen && product && formData.id === product.id) {
            // Modal 已打开，且是同一个产品，检查是否需要保护 barcode
            const userBarcode = userBarcodeRef.current[product.id];
            
            if (userBarcode && formData.barcode !== userBarcode) {
                console.log('🛡️ 保护 barcode - 恢复用户添加的值:', userBarcode);
                setFormData(prev => ({ ...prev, barcode: userBarcode }));
                setBarcodeData(userBarcode);
            }
        }
    }, [product]);

    // 🔍 监控 formData.barcode 的变化
    useEffect(() => {
        console.log('🔍 formData.barcode 变化:', formData.barcode);
    }, [formData.barcode]);

    useEffect(() => {
        if (barcodeData && canvasRef.current && typeof JsBarcode !== 'undefined') {
            try {
                JsBarcode(canvasRef.current, barcodeData, {
                    format: "CODE128",
                    width: 2,
                    height: 50,
                    displayValue: true,
                    fontSize: 12
                });
            } catch (error) {
                console.error('Barcode generation error:', error);
            }
        }
    }, [barcodeData]);

    if (!isOpen) return null;

    // 处理照片文件选择
    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setImageFile(file);
            
            // 创建预览
            const reader = new FileReader();
            reader.onload = (event) => {
                setImagePreview(event.target?.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    // 上传照片到 Supabase
    const uploadImage = async (): Promise<string | null> => {
        if (!imageFile) return null;
        
        setUploadingImage(true);
        try {
            const fileName = `${Date.now()}-${imageFile.name}`;
            const { data, error } = await supabase.storage
                .from('product-photos')
                .upload(fileName, imageFile, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (error) throw error;
            
            return fileName;
        } catch (error) {
            console.error('Image upload error:', error);
            alert('照片上传失败，请重试');
            return null;
        } finally {
            setUploadingImage(false);
        }
    };

    // 处理条形码扫描结果
    const handleBarcodeScan = (scannedCode: string) => {
        const trimmedCode = scannedCode.trim();
        if (!trimmedCode) return;
        
        // 检查是否已存在
        const currentBarcodes = formData.barcode ? formData.barcode.split(',').map(b => b.trim()) : [];
        if (currentBarcodes.includes(trimmedCode)) {
            showToast('此条形码已存在！', 'warning');
            setShowBarcodeScanner(false);
            return;
        }
        
        // 添加到条形码列表
        const newBarcodes = [...currentBarcodes, trimmedCode];
        const newBarcode = newBarcodes.filter(b => b).join(',');
        
        setFormData({ ...formData, barcode: newBarcode });
        setBarcodeData(newBarcode);
        setBarcodeInput('');
        setShowBarcodeScanner(false);
        showToast(`条形码已添加: ${trimmedCode}`, 'success');
    };

    const handleSave = async () => {
        // 对于编辑现有产品，只要求必填字段
        const isEditing = !!product?.id;
        
        // 🔍 调试：查看保存前的 formData
        console.log('🔍 Modal handleSave - 完整 formData:', formData);
        console.log('🔍 Modal handleSave - barcode 字段:', formData.barcode);
        console.log('🔍 Modal handleSave - barcode 类型:', typeof formData.barcode);
        console.log('🔍 Modal handleSave - barcode 长度:', formData.barcode?.length);
        console.log('🔍 Modal handleSave - master_barcode 字段:', formData.master_barcode);
        console.log('🔍 Modal handleSave - packs_per_unit 字段:', formData.packs_per_unit);
        
        // 🔍 检查 barcode 是否为空字符串但应该有值
        if (formData.barcode === '' || !formData.barcode) {
            console.warn('⚠️ 警告：formData.barcode 是空的！');
            console.log('🔍 formData 的所有 keys:', Object.keys(formData));
        }
        
        if (!formData.name || formData.price === undefined || formData.price === null) {
            alert('请填写产品名称和价格！');
            return;
        }
        
        console.log('========== Modal handleSave 开始 ==========');
        console.log('🔍 完整 formData:', JSON.stringify(formData, null, 2));
        console.log('🔍 formData.barcode:', formData.barcode);
        console.log('🔍 formData.master_barcode:', formData.master_barcode);
        console.log('🔍 formData.packs_per_unit:', formData.packs_per_unit);
        
        // 如果是新产品，要求条形码；编辑时条形码可选
        if (!isEditing && !formData.barcode) {
            alert('新产品需要填写条形码！');
            return;
        }
        
        // 🔧 简化：直接使用 formData，不做额外处理
        let finalFormData = { ...formData };
        
        // 如果有新照片要上传
        if (imageFile) {
            const uploadedFileName = await uploadImage();
            if (uploadedFileName) {
                finalFormData.image_url = uploadedFileName;
            }
        }
        
        console.log('🔍 finalFormData 准备传递给 onSave:', JSON.stringify(finalFormData, null, 2));
        console.log('🔍 特别检查 finalFormData.barcode:', finalFormData.barcode);
        console.log('========== Modal handleSave 结束 ==========');
        
        onSave(finalFormData as Product);
        onClose();
    };

    if (!isOpen) return null;

    return ReactDOM.createPortal(
        <div 
            className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center p-4"
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 99999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'auto'
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
        >
            <div 
                className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col"
                style={{ maxHeight: '90vh', overflow: 'auto' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center p-5 border-b">
                    <div>
                        <h3 className="text-lg font-semibold">
                            {product?.id ? '编辑产品' : '新增产品'}
                        </h3>
                        {product?.id && (
                            <p className="text-sm text-blue-600 mt-1">
                                <i className="fas fa-info-circle mr-1"></i>
                                编辑现有产品时，只需修改您想要更改的字段
                            </p>
                        )}
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <i className="fas fa-times"></i>
                    </button>
                </div>
                
                <div className="flex-grow overflow-y-auto p-6">

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                产品名称 <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={formData.name || ''}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="输入产品名称"
                                autoComplete="off"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                价格 (售价) <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={(formData.price ?? '').toString()}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    if (value === '') {
                                        setFormData({ ...formData, price: 0 });
                                    } else if (/^\d*\.?\d*$/.test(value)) {
                                        // 允许数字和小数点
                                        const numValue = parseFloat(value);
                                        setFormData({ ...formData, price: isNaN(numValue) ? 0 : numValue });
                                    }
                                    // 如果输入的不符合价格格式，则忽略此次输入
                                }}
                                onFocus={(e) => {
                                    // 当焦点进入时，如果值为0，则选中所有文本，方便用户直接输入新值
                                    if (formData.price === 0) {
                                        e.target.select();
                                    }
                                }}
                                className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="0.00"
                                required
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    订货价/成本价
                                    <span className="text-xs text-gray-500 ml-1">(可选)</span>
                                </label>
                                <input
                                    type="text"
                                    value={(formData.cost_price ?? '').toString()}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        if (value === '') {
                                            setFormData({ ...formData, cost_price: null });
                                        } else if (/^\d*\.?\d*$/.test(value)) {
                                            const numValue = parseFloat(value);
                                            setFormData({ ...formData, cost_price: isNaN(numValue) ? null : numValue });
                                        }
                                    }}
                                    onFocus={(e) => {
                                        if ((formData.cost_price ?? 0) === 0) {
                                            e.target.select();
                                        }
                                    }}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="0.00"
                                />
                                <p className="text-xs text-gray-400 mt-1">从供应商购买的价格</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    运输成本
                                    <span className="text-xs text-gray-500 ml-1">(可选)</span>
                                </label>
                                <input
                                    type="text"
                                    value={(formData.shipping_cost ?? '').toString()}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        if (value === '') {
                                            setFormData({ ...formData, shipping_cost: null });
                                        } else if (/^\d*\.?\d*$/.test(value)) {
                                            const numValue = parseFloat(value);
                                            setFormData({ ...formData, shipping_cost: isNaN(numValue) ? null : numValue });
                                        }
                                    }}
                                    onFocus={(e) => {
                                        if ((formData.shipping_cost ?? 0) === 0) {
                                            e.target.select();
                                        }
                                    }}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="0.00"
                                />
                                <p className="text-xs text-gray-400 mt-1">从供应商运到您的成本</p>
                            </div>
                        </div>

                        {/* 利润预览 */}
                        {(formData.price > 0 && (formData.cost_price || formData.shipping_cost)) && (
                            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
                                <h4 className="text-sm font-semibold text-gray-700 mb-2">
                                    <i className="fas fa-calculator mr-2 text-blue-600"></i>
                                    利润预览
                                </h4>
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div>
                                        <span className="text-gray-600">售价：</span>
                                        <span className="font-semibold text-gray-800 ml-2">RM{formData.price.toFixed(2)}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-600">总成本：</span>
                                        <span className="font-semibold text-gray-800 ml-2">
                                            RM{((formData.cost_price || 0) + (formData.shipping_cost || 0)).toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="col-span-2 pt-2 border-t border-blue-200">
                                        <span className="text-gray-600">单品利润：</span>
                                        <span className={`font-bold ml-2 text-lg ${
                                            (formData.price - (formData.cost_price || 0) - (formData.shipping_cost || 0)) >= 0 
                                                ? 'text-green-600' 
                                                : 'text-red-600'
                                        }`}>
                                            RM{(formData.price - (formData.cost_price || 0) - (formData.shipping_cost || 0)).toFixed(2)}
                                        </span>
                                        <span className="text-xs text-gray-500 ml-2">
                                            ({((formData.price - (formData.cost_price || 0) - (formData.shipping_cost || 0)) / formData.price * 100).toFixed(1)}%)
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                            <textarea
                                value={formData.description || ''}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                rows={3}
                                placeholder="产品描述"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
                            <select
                                value={formData.category || ''}
                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                                <option value="">选择分类</option>
                                <option value="小笼包系列">小笼包系列</option>
                                <option value="小笼汤包系列">小笼汤包系列</option>
                                <option value="水饺系列">水饺系列</option>
                                <option value="蒸饺系列">蒸饺系列</option>
                                <option value="纸皮烧卖系列">纸皮烧卖系列</option>
                                <option value="虾肠系列">虾肠系列</option>
                                <option value="烤肠系列">烤肠系列</option>
                                <option value="酥皮烤肠系列">酥皮烤肠系列</option>
                                <option value="披萨系列">披萨系列</option>
                                <option value="酥饼系列">酥饼系列</option>
                                <option value="鸡排系列">鸡排系列</option>
                                <option value="鸡翅系列">鸡翅系列</option>
                                <option value="奶茶系列">奶茶系列</option>
                                <option value="其他">其他</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                包装单位
                                <span className="text-xs text-gray-500 ml-1">(可选)</span>
                            </label>
                            <div className="space-y-2">
                                <input
                                    type="number"
                                    min="1"
                                    value={formData.packs_per_unit || ''}
                                    onChange={(e) => {
                                        const value = e.target.value ? parseInt(e.target.value) : null;
                                        setFormData({ ...formData, packs_per_unit: value });
                                    }}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="例如：3 (表示每份包含3袋)"
                                />
                                <p className="text-xs text-gray-500">
                                    <i className="fas fa-info-circle mr-1"></i>
                                    设置后，打包时必须扫描相应数量的小包装。
                                    <br />
                                    例如：设置为 3，打包1份需要扫描3次小包装条形码
                                </p>
                                {formData.packs_per_unit && formData.packs_per_unit > 1 && (
                                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
                                        <p className="text-sm text-blue-800">
                                            <i className="fas fa-box mr-1"></i>
                                            打包提示：每扫描 {formData.packs_per_unit} 次小包装 = 完成 1 份产品
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 大盒条形码 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                <i className="fas fa-boxes mr-1 text-purple-600"></i>
                                大盒条形码
                                <span className="text-xs text-gray-500 ml-1">(可选)</span>
                            </label>
                            <div className="space-y-2">
                                <input
                                    type="text"
                                    value={formData.master_barcode || ''}
                                    onChange={(e) => setFormData({ ...formData, master_barcode: e.target.value })}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                    placeholder="例如：1234567890123"
                                />
                                <p className="text-xs text-gray-500">
                                    <i className="fas fa-info-circle mr-1"></i>
                                    用于整箱/大盒包装的条形码。扫描1次大盒 = 完成1份产品
                                    <br />
                                    例如：酥皮烤肠大盒（内含10小盒），扫描大盒条形码直接完成1份
                                </p>
                                {formData.master_barcode && formData.packs_per_unit && formData.packs_per_unit > 1 && (
                                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-2">
                                        <p className="text-sm text-purple-800">
                                            <i className="fas fa-boxes mr-1"></i>
                                            双条形码模式：
                                        </p>
                                        <ul className="text-xs text-purple-700 mt-1 space-y-1 ml-4">
                                            <li>• 扫描大盒条形码 → 直接完成1份</li>
                                            <li>• 扫描小盒条形码 × {formData.packs_per_unit} → 完成1份</li>
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Emoji图标</label>
                            <input
                                type="text"
                                value={formData.emoji || ''}
                                onChange={(e) => setFormData({ ...formData, emoji: e.target.value })}
                                className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="🍕 (例如: 🍕、🍔、🍰)"
                                maxLength={2}
                            />
                        </div>

                        {/* 产品照片上传 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">产品照片</label>
                            <div className="space-y-3">
                                {/* 照片预览 */}
                                {imagePreview && (
                                    <div className="relative w-full h-48 bg-gray-100 rounded-lg overflow-hidden">
                                        <img
                                            src={imagePreview.startsWith('http') 
                                                ? imagePreview 
                                                : `https://edfnhhthztskuuosuasw.supabase.co/storage/v1/object/public/product-photos/${encodeURIComponent(imagePreview)}`
                                            }
                                            alt="产品预览"
                                            className="w-full h-full object-contain"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setImagePreview(null);
                                                setImageFile(null);
                                                setFormData({ ...formData, image_url: '' });
                                            }}
                                            className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600"
                                        >
                                            ×
                                        </button>
                                    </div>
                                )}
                                
                                {/* 上传按钮 */}
                                <div className="grid grid-cols-2 gap-2">
                                    <label className="cursor-pointer">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={handleImageChange}
                                            className="hidden"
                                        />
                                        <div className="flex items-center justify-center px-3 py-2 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors">
                                            <i className="fas fa-image mr-2 text-gray-400"></i>
                                            <span className="text-sm text-gray-600">选择照片</span>
                                        </div>
                                    </label>
                                    
                                    <label className="cursor-pointer">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            capture="environment"
                                            onChange={handleImageChange}
                                            className="hidden"
                                        />
                                        <div className="flex items-center justify-center px-3 py-2 border-2 border-dashed border-gray-300 rounded-lg hover:border-green-400 hover:bg-green-50 transition-colors">
                                            <i className="fas fa-camera mr-2 text-gray-400"></i>
                                            <span className="text-sm text-gray-600">拍照</span>
                                        </div>
                                    </label>
                                </div>
                                
                                <p className="text-xs text-gray-500">
                                    支持 JPG、PNG 格式，推荐尺寸 1:1 方形照片，最大 5MB
                                </p>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                产品条形码 {product?.id ? <span className="text-gray-400 font-normal">(可选)</span> : <span className="text-red-500">*</span>}
                            </label>
                            
                            {/* 条形码列表显示 */}
                            {formData.barcode && formData.barcode.split(',').filter(bc => bc.trim()).length > 0 && (
                                <div className="mb-3 space-y-2">
                                    {formData.barcode.split(',').map((bc, idx) => {
                                        const trimmedBc = bc.trim();
                                        if (!trimmedBc) return null;
                                        return (
                                            <div key={idx} className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                                                <div className="flex items-center gap-2">
                                                    <i className="fas fa-barcode text-blue-600"></i>
                                                    <span className="font-mono text-sm">{trimmedBc}</span>
                                                    <span className="text-xs text-gray-500">#{idx + 1}</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const barcodes = formData.barcode?.split(',').filter(b => b.trim() !== trimmedBc) || [];
                                                        const newBarcode = barcodes.join(',');
                                                        setFormData({ ...formData, barcode: newBarcode });
                                                        setBarcodeData(newBarcode);
                                                        showToast('条形码已删除', 'success');
                                                    }}
                                                    className="text-red-500 hover:text-red-700 text-sm"
                                                    title="删除此条形码"
                                                >
                                                    <i className="fas fa-times"></i>
                                                </button>
                                            </div>
                                        );
                                    })}
                                    <p className="text-xs text-blue-600">
                                        <i className="fas fa-info-circle mr-1"></i>
                                        已添加 {formData.barcode.split(',').filter(bc => bc.trim()).length} 个条形码
                                    </p>
                                </div>
                            )}
                            
                            {/* 添加新条形码 */}
                            <div className="flex space-x-2">
                                <input
                                    type="text"
                                    value={barcodeInput}
                                    onChange={(e) => setBarcodeInput(e.target.value)}
                                    onKeyPress={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            if (barcodeInput.trim()) {
                                                const currentBarcodes = formData.barcode ? formData.barcode.split(',').map(b => b.trim()) : [];
                                                if (currentBarcodes.includes(barcodeInput.trim())) {
                                                    showToast('此条形码已存在！', 'warning');
                                                } else {
                                                    const newBarcodes = [...currentBarcodes, barcodeInput.trim()];
                                                    const newBarcode = newBarcodes.filter(b => b).join(',');
                                                    console.log('🔍 回车添加条形码 - 原条形码:', formData.barcode);
                                                    console.log('🔍 回车添加条形码 - 新条形码:', newBarcode);
                                                    setFormData({ ...formData, barcode: newBarcode });
                                                    setBarcodeData(newBarcode);
                                                    setBarcodeInput('');
                                                    console.log('🔍 回车添加条形码 - 更新后 formData:', { ...formData, barcode: newBarcode });
                                                    showToast('条形码已添加', 'success');
                                                }
                                            }
                                        }
                                    }}
                                    className="flex-1 p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="输入或扫描条形码，按回车添加"
                                    autoComplete="off"
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (barcodeInput.trim()) {
                                            const currentBarcodes = formData.barcode ? formData.barcode.split(',').map(b => b.trim()) : [];
                                            if (currentBarcodes.includes(barcodeInput.trim())) {
                                                showToast('此条形码已存在！', 'warning');
                                            } else {
                                                const newBarcodes = [...currentBarcodes, barcodeInput.trim()];
                                                const newBarcode = newBarcodes.filter(b => b).join(',');
                                                console.log('🔍 点击添加条形码 - 原barcode:', formData.barcode);
                                                console.log('🔍 点击添加条形码 - 新barcode:', newBarcode);
                                                
                                                // 🔧 保存到父组件的 ref，防止被 useEffect 覆盖
                                                if (product?.id) {
                                                    userBarcodeRef.current[product.id] = newBarcode;
                                                    console.log('💾 保存到 userBarcodeRef[' + product.id + ']:', newBarcode);
                                                    console.log('💾 完整 userBarcodeRef.current:', JSON.stringify(userBarcodeRef.current));
                                                }
                                                
                                                // 🔧 更新 formData
                                                const updatedFormData = { ...formData, barcode: newBarcode };
                                                setFormData(updatedFormData);
                                                setBarcodeData(newBarcode);
                                                setBarcodeInput('');
                                                
                                                console.log('🔍 点击添加条形码 - 更新后 formData.barcode:', updatedFormData.barcode);
                                                showToast('条形码已添加', 'success');
                                            }
                                        }
                                    }}
                                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                                    title="添加条形码"
                                >
                                    <i className="fas fa-plus mr-1"></i>添加
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowBarcodeScanner(true)}
                                    className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center"
                                    title="扫描条形码"
                                >
                                    <i className="fas fa-qrcode"></i>
                                </button>
                            </div>

                            <p className="text-xs text-gray-500 mt-1">
                                <i className="fas fa-lightbulb mr-1"></i>
                                支持多个条形码：手动输入或扫描后点击"添加"按钮，可为同一产品添加多个条形码
                                {product?.id && <span className="text-blue-600"> • 编辑现有产品时条形码为可选项</span>}
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    库存数量 {formData.is_unlimited && <span className="text-gray-400">(预购模式已禁用)</span>}
                                </label>
                                <input
                                    type="text"
                                    value={formData.is_unlimited ? '' : (formData.stock_quantity ?? '').toString()}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        // 允许空值和纯数字
                                        if (value === '') {
                                            setFormData({ ...formData, stock_quantity: 0 });
                                        } else if (/^\d+$/.test(value)) {
                                            const numValue = parseInt(value, 10);
                                            setFormData({ ...formData, stock_quantity: Math.max(0, numValue) });
                                        }
                                        // 如果输入的不是数字，则忽略此次输入
                                    }}
                                    onFocus={(e) => {
                                        // 当焦点进入时，如果值为0，则选中所有文本，方便用户直接输入新值
                                        if (formData.stock_quantity === 0) {
                                            e.target.select();
                                        }
                                    }}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500"
                                    placeholder={formData.is_unlimited ? "预购商品无库存限制" : "输入库存数量，0表示无库存"}
                                    disabled={formData.is_unlimited}
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    {formData.is_unlimited 
                                        ? "预购商品不需要管理库存" 
                                        : "可以输入0表示暂时无库存"
                                    }
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">库存预警阈值</label>
                                <input
                                    type="text"
                                    value={(formData.min_stock_threshold ?? 5).toString()}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        if (value === '') {
                                            setFormData({ ...formData, min_stock_threshold: 1 });
                                        } else if (/^\d+$/.test(value)) {
                                            const numValue = parseInt(value, 10);
                                            setFormData({ ...formData, min_stock_threshold: Math.max(1, numValue) });
                                        }
                                    }}
                                    onFocus={(e) => {
                                        // 当焦点进入时选中所有文本，方便用户直接输入新值
                                        e.target.select();
                                    }}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="低库存提醒阈值"
                                />
                                <p className="text-xs text-gray-500 mt-1">库存低于此数量时会显示预警</p>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <label className="flex items-start">
                                <input
                                    type="checkbox"
                                    checked={formData.is_unlimited || false}
                                    onChange={(e) => {
                                        const isUnlimited = e.target.checked;
                                        setFormData({ 
                                            ...formData, 
                                            is_unlimited: isUnlimited,
                                            // 如果是预购商品，清空库存数量
                                            stock_quantity: isUnlimited ? null : (formData.stock_quantity ?? 0)
                                        });
                                    }}
                                    className="mr-2 mt-0.5"
                                />
                                <div>
                                    <span>预购商品 (无库存限制)</span>
                                    <p className="text-xs text-gray-500 mt-1">
                                        启用后将不需要管理库存数量，适用于接受预订的商品
                                    </p>
                                </div>
                            </label>
                            
                            <label className="flex items-start">
                                <input
                                    type="checkbox"
                                    checked={formData.is_published || false}
                                    onChange={(e) => setFormData({ ...formData, is_published: e.target.checked })}
                                    className="mr-2 mt-0.5"
                                />
                                <div>
                                    <span>立即上架</span>
                                    <p className="text-xs text-gray-500 mt-1">
                                        启用后商品将在商店中显示，客户可以下单购买
                                    </p>
                                </div>
                            </label>
                        </div>

                        {barcodeData && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">条形码预览</label>
                                <div className="bg-gray-50 p-3 rounded-lg text-center">
                                    <canvas ref={canvasRef}></canvas>
                                    <p className="text-xs text-gray-500 mt-2">条形码: {barcodeData}</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                
                <div className="p-5 border-t bg-gray-50">
                    <div className="flex space-x-3">
                        <button
                            onClick={onClose}
                            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleSave}
                            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={uploadingImage}
                        >
                            {uploadingImage ? (
                                <>
                                    <i className="fas fa-spinner fa-spin mr-2"></i>
                                    上传中...
                                </>
                            ) : (
                                '保存'
                            )}
                        </button>
                    </div>
                </div>
            </div>
            
            {/* 条形码扫描器 */}
            {showBarcodeScanner && (
                <div 
                    className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center p-4"
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 99999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'auto'
                    }}
                >
                    <div 
                        className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col"
                        style={{ maxHeight: '90vh', overflow: 'auto' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center p-5 border-b">
                            <h3 className="text-lg font-semibold">扫描条形码</h3>
                            <button
                                onClick={() => setShowBarcodeScanner(false)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="flex-grow overflow-y-auto p-4">
                            <WorkingBarcodeScanner onScan={handleBarcodeScan} />
                        </div>
                    </div>
                </div>
            )}
        </div>,
        document.body
    );
};

// BarcodeModal Component
const BarcodeModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    product: Product | null;
}> = ({ isOpen, onClose, product }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const qrCanvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (product && isOpen) {
            // Generate barcode
            if (canvasRef.current && typeof JsBarcode !== 'undefined' && product.barcode) {
                try {
                    JsBarcode(canvasRef.current, product.barcode, {
                        format: "CODE128",
                        width: 3,
                        height: 80,
                        displayValue: true,
                        fontSize: 16,
                        textMargin: 10
                    });
                } catch (error) {
                    console.error('Barcode generation error:', error);
                }
            }

            // Generate QR code
            if (qrCanvasRef.current && typeof QRCode !== 'undefined') {
                try {
                    // 清空之前的二维码
                    qrCanvasRef.current.innerHTML = '';
                    const qrcode = new QRCode(qrCanvasRef.current, {
                        text: JSON.stringify({
                            id: product.id,
                            name: product.name,
                            price: product.price,
                            barcode: product.barcode
                        }),
                        width: 150,
                        height: 150,
                        colorDark: "#000000",
                        colorLight: "#ffffff",
                        correctLevel: QRCode.CorrectLevel.M
                    });
                } catch (error) {
                    console.error('QR code generation error:', error);
                }
            }
        }
    }, [product, isOpen]);

    const handlePrint = () => {
        window.print();
    };

    const handleDownloadBarcode = () => {
        if (canvasRef.current) {
            const link = document.createElement('a');
            link.download = `barcode-${product.name}-${product.id}.png`;
            link.href = canvasRef.current.toDataURL();
            link.click();
        }
    };

   const handleDowloadQR = () => {
        if (qrCanvasRef.current) {
            const canvas = qrCanvasRef.current.querySelector('canvas');
            if (canvas) {
                const link = document.createElement('a');
                link.download = `qrcode-${product.name}-${product.id}.png`;
                link.href = canvas.toDataURL();
                link.click();
            }
        }
   };

    if (!isOpen || !product) return null;

    return ReactDOM.createPortal(
        <div 
            className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center p-4"
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 99999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'auto'
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
        >
            <div 
                className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col"
                style={{ maxHeight: '90vh', overflow: 'auto' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-semibold">产品条形码</h3>
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg mb-4">
                        <h4 className="font-medium text-gray-700 mb-2">条形码</h4>
                        <div className="flex justify-center">
                            <canvas ref={canvasRef}></canvas>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-4">
                            <button
                                onClick={handlePrint}
                                className="px-3 py-2 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                            >
                                <i className="fas fa-print mr-1"></i>打印
                            </button>
                            <button
                                onClick={handleDownloadBarcode}
                                className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                            >
                                <i className="fas fa-download mr-1"></i>条形码
                            </button>
                            <button
                                onClick={handleDowloadQR}
                                className="px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                            >
                                <i className="fas fa-download mr-1"></i>二维码
                            </button>
                        </div>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                        <h5 className="text-sm font-medium text-gray-700 mb-3 text-center">二维码</h5>
                        <div className="flex justify-center">
                            <div ref={qrCanvasRef}></div>
                        </div>
                    </div>
                    <div className="flex mt-6">
                        <button
                            onClick={onClose}
                            className="w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            关闭
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

// PackingModeView Component - 打包模式界面
const PackingModeView: React.FC<{
    order: Order;
    products: Product[];
    packedItems: {[key: string]: number};
    onScanBarcode: (data: string) => void;
    onFinishPacking: () => void;
    onExitPacking: () => void;
    showToast: Function;
}> = ({ order, products, packedItems, onScanBarcode, onFinishPacking, onExitPacking, showToast }) => {
    const [scannerVisible, setScannerVisible] = useState(false);
    const [manualInput, setManualInput] = useState('');
    
const allItemsPacked = order.order_items?.every(item => {
    const packedCount = packedItems[item.product || ''] || 0;
    const requiredCount = item.quantity || 1;
    return packedCount >= requiredCount;
}) || false;

    const handleManualScan = () => {
        if (manualInput.trim()) {
            onScanBarcode(manualInput.trim());
            setManualInput('');
        }
    };

    return (
        <div className="p-6 bg-white rounded-lg shadow animate-fade-in">
            {/* 头部信息 */}
            <div>
                <h1 className="text-2xl font-bold text-gray-800">
                    <i className="fas fa-box-open mr-2 text-blue-600"></i>
                    打包模式 - 订单 #{order.order_id}
                </h1>
                <p className="text-gray-600 mt-1">
                    客户: {order.name} ({order.phone})
                </p>
            </div>
            <button
                onClick={onExitPacking}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
            >
                <i className="fas fa-times mr-2"></i>退出打包
            </button>
        {/* 打包订单明细列表 */}
        <div className="mt-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-3">
                <i className="fas fa-list-ul mr-2"></i>
                订单商品明细
            </h3>
            <div className="bg-gray-50 rounded-lg p-4 border">
                <table className="w-full text-sm">
                    <thead>
                        <tr>
                            <th className="p-2 text-left">商品</th>
                            <th className="p-2 text-left">数量</th>
                            <th className="p-2 text-left">已打包</th>
                            <th className="p-2 text-left">状态</th>
                        </tr>
                    </thead>
                    <tbody>
                        {order.order_items?.map((item, idx) => {
                            const packedCount = packedItems[item.product || ''] || 0;
                            const requiredCount = item.quantity || 1;
                            const isCompleted = packedCount >= requiredCount;
                            return (
                                <tr key={idx} className={isCompleted ? "bg-green-50" : ""}>
                                    <td className="p-2">{item.product}</td>
                                    <td className="p-2">{requiredCount}</td>
                                    <td className="p-2">{packedCount}</td>
                                    <td className="p-2">
                                        {isCompleted ? (
                                            <span className="text-green-600 font-bold">
                                                <i className="fas fa-check-circle mr-1"></i>已完成
                                            </span>
                                        ) : (
                                            <span className="text-gray-500">
                                                <i className="fas fa-hourglass-half mr-1"></i>待打包
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <h3 className="font-semibold text-blue-800 mb-3">
                        <i className="fas fa-camera mr-2"></i>扫描产品条形码
                    </h3>
                    <div className="space-y-3">
                        <button
                            onClick={() => setScannerVisible(!scannerVisible)}
                            className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            <i className={`fas ${scannerVisible ? 'fa-camera-slash' : 'fa-camera'} mr-2`}></i>
                            {scannerVisible ? '关闭摄像头' : '开启摄像头扫描'}
                        </button>
                        
                        <div className="flex space-x-2 mb-3">
                            <input
                                type="text"
                                value={manualInput}
                                onChange={(e) => setManualInput(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleManualScan()}
                                placeholder="或手动输入条形码"
                                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <button
                                onClick={handleManualScan}
                                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                            >
                                确认
                            </button>
                        </div>
                        <div className="mb-3">
                            <button
                                onClick={() => {
                                    setManualInput('ORDER-FW20250922002');
                                    onScanBarcode('ORDER-FW20250922002');
                                }}
                                className="w-full px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                            >
                                🚀 快速测试 - 加载订单 FW20250922002
                            </button>
                        </div>
                        
                        <div className="border-t pt-3">
                            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-3">
                                <h4 className="font-medium text-orange-800 mb-2">
                                    <i className="fas fa-file-pdf mr-2"></i>PDF条形码提示
                                </h4>
                                <p className="text-sm text-orange-700 mb-2">
                                    如果PDF条形码识别失败，请：
                                </p>
                                <ol className="text-sm text-orange-700 list-decimal list-inside space-y-1">
                                    <li>上传PDF后查看预览窗口</li>
                                    <li>找到条形码下方的文字/数字</li>
                                    <li>复制到上方手动输入框</li>
                                    <li>或截图条形码部分重新上传</li>
                                </ol>
                            </div>
                            
                            <label className="block text-sm font-medium text-blue-700 mb-2">
                                📷 拍照识别条形码或上传PDF订单
                            </label>
                            <input
                                type="file"
                                accept="image/*,application/pdf"
                                capture="environment"
                                onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    
                                    // 处理PDF文件
                                    if (file.type === 'application/pdf') {
                                        alert('检测到PDF文件，开始处理...');
                                        try {
                                            console.log('开始处理PDF文件:', file.name);
                                            
                                            // 动态加载PDF.js
                                            if (typeof (window as any).pdfjsLib === 'undefined') {
                                                console.log('加载PDF.js库...');
                                                const script = document.createElement('script');
                                                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
                                                document.head.appendChild(script);
                                                
                                                await new Promise((resolve, reject) => {
                                                    script.onload = () => {
                                                        console.log('PDF.js加载成功');
                                                        // 设置worker
                                                        (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                                                        resolve(true);
                                                    };
                                                    script.onerror = () => {
                                                        console.error('PDF.js加载失败');
                                                        reject(new Error('PDF.js加载失败'));
                                                    };
                                                });
                                            }
                                            
                                            const pdfjsLib = (window as any).pdfjsLib;
                                            if (!pdfjsLib) {
                                                throw new Error('PDF.js库未正确加载');
                                            }
                                            
                                            console.log('读取PDF文件...');
                                            const arrayBuffer = await file.arrayBuffer();
                                            console.log('PDF文件大小:', arrayBuffer.byteLength);
                                            
                                            const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
                                            console.log('PDF页数:', pdf.numPages);
                                            
                                            const page = await pdf.getPage(1);
                                            console.log('获取第一页成功');
                                            
                                            // 使用更高的分辨率
                                            const viewport = page.getViewport({scale: 3.0});
                                            const canvas = document.createElement('canvas');
                                            const ctx = canvas.getContext('2d');
                                            if (!ctx) throw new Error('无法创建canvas上下文');
                                            
                                            canvas.width = viewport.width;
                                            canvas.height = viewport.height;
                                            console.log('Canvas尺寸:', canvas.width, 'x', canvas.height);
                                            
                                            await page.render({
                                                canvasContext: ctx,
                                                viewport: viewport
                                            }).promise;
                                            console.log('PDF渲染完成');
                                            
                                            // 多种分辨率和处理方式尝试识别条形码
                                            console.log('开始识别条形码...');
                                            let recognitionSuccess = false;
                                            
                                            // 尝试多种方法识别条形码
                                            const scales = [3.0, 2.0, 4.0, 1.5, 5.0]; // 不同的缩放比例
                                            
                                            for (const scale of scales) {
                                                if (recognitionSuccess) break;
                                                
                                                try {
                                                    console.log(`尝试缩放比例: ${scale}`);
                                                    
                                                    // 重新渲染不同分辨率的图像
                                                    const viewport = page.getViewport({scale: scale});
                                                    const testCanvas = document.createElement('canvas');
                                                    const testCtx = testCanvas.getContext('2d');
                                                    if (!testCtx) continue;
                                                    
                                                    testCanvas.width = viewport.width;
                                                    testCanvas.height = viewport.height;
                                                    
                                                    await page.render({
                                                        canvasContext: testCtx,
                                                        viewport: viewport
                                                    }).promise;
                                                    
                                                    // 图像处理优化
                                                    const imageData = testCtx.getImageData(0, 0, testCanvas.width, testCanvas.height);
                                                    const data = imageData.data;
                                                    
                                                    // 增强对比度
                                                    for (let i = 0; i < data.length; i += 4) {
                                                        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                                                        const enhanced = avg > 128 ? 255 : 0; // 二值化
                                                        data[i] = enhanced;     // R
                                                        data[i + 1] = enhanced; // G
                                                        data[i + 2] = enhanced; // B
                                                    }
                                                    
                                                    testCtx.putImageData(imageData, 0, 0);
                                                    
                                                    // 尝试多种读取器
                                                    const readers = [
                                                        new BrowserMultiFormatReader(undefined, undefined),
                                                        new BrowserQRCodeReader(undefined, undefined),
                                                        new BrowserCodeReader(undefined, undefined)
                                                    ];
                                                    
                                                    let result = null;
                                                    for (const reader of readers) {
                                                        try {
                                                            result = await reader.decodeFromCanvas(testCanvas);
                                                            if (result) break;
                                                        } catch (readerError) {
                                                            console.log(`读取器${reader.constructor.name}失败:`, readerError.message);
                                                        }
                                                    }
                                                    
                                                    if (result && result.getText()) {
                                                        const text = result.getText();
                                                        console.log('识别到条形码:', text, '缩放比例:', scale);
                                                        onScanBarcode(text);
                                                        alert('PDF条形码识别成功: ' + text);
                                                        recognitionSuccess = true;
                                                        break;
                                                    }
                                                } catch (scaleError) {
                                                    console.log(`缩放比例${scale}识别失败:`, scaleError.message);
                                                }
                                            }
                                            
                                            if (!recognitionSuccess) {
                                                // 如果所有方法都失败，尝试裁剪不同区域
                                                console.log('尝试裁剪识别...');
                                                
                                                // 原始canvas
                                                const viewport = page.getViewport({scale: 3.0});
                                                const fullCanvas = document.createElement('canvas');
                                                const fullCtx = fullCanvas.getContext('2d');
                                                if (fullCtx) {
                                                    fullCanvas.width = viewport.width;
                                                    fullCanvas.height = viewport.height;
                                                    
                                                    await page.render({
                                                        canvasContext: fullCtx,
                                                        viewport: viewport
                                                    }).promise;
                                                    
                                                    // 尝试裁剪不同区域
                                                    const regions = [
                                                        {x: 0, y: 0, w: fullCanvas.width, h: fullCanvas.height / 3}, // 上部
                                                        {x: 0, y: fullCanvas.height / 3, w: fullCanvas.width, h: fullCanvas.height / 3}, // 中部
                                                        {x: 0, y: fullCanvas.height * 2/3, w: fullCanvas.width, h: fullCanvas.height / 3}, // 下部
                                                    ];
                                                    
                                                    for (const region of regions) {
                                                        if (recognitionSuccess) break;
                                                        
                                                        try {
                                                            const cropCanvas = document.createElement('canvas');
                                                            const cropCtx = cropCanvas.getContext('2d');
                                                            if (!cropCtx) continue;
                                                            
                                                            cropCanvas.width = region.w;
                                                            cropCanvas.height = region.h;
                                                            
                                                            cropCtx.drawImage(fullCanvas, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
                                                            
                                                            const readers = [
                                                                new BrowserMultiFormatReader(undefined, undefined),
                                                                new BrowserQRCodeReader(undefined, undefined),
                                                                new BrowserCodeReader(undefined, undefined)
                                                            ];
                                                            
                                                            let result = null;
                                                            for (const reader of readers) {
                                                                try {
                                                                    result = await reader.decodeFromCanvas(cropCanvas);
                                                                    if (result) break;
                                                                } catch (readerError) {
                                                                    console.log(`裁剪读取器失败:`, readerError.message);
                                                                }
                                                            }
                                                            
                                                            if (result && result.getText()) {
                                                                const text = result.getText();
                                                                console.log('裁剪区域识别成功:', text);
                                                                onScanBarcode(text);
                                                                alert('PDF条形码识别成功: ' + text);
                                                                recognitionSuccess = true;
                                                                break;
                                                            }
                                                        } catch (cropError) {
                                                            console.log('裁剪识别失败:', cropError.message);
                                                        }
                                                    }
                                                }
                                            }
                                            
                                            if (!recognitionSuccess) {
                                                console.log('所有识别方法都失败，尝试文本识别...');
                                                
                                                // 尝试OCR文本识别
                                                try {
                                                    const viewport = page.getViewport({scale: 2.0});
                                                    const textCanvas = document.createElement('canvas');
                                                    const textCtx = textCanvas.getContext('2d');
                                                    if (textCtx) {
                                                        textCanvas.width = viewport.width;
                                                        textCanvas.height = viewport.height;
                                                        
                                                        await page.render({
                                                            canvasContext: textCtx,
                                                            viewport: viewport
                                                        }).promise;
                                                        
                                                        // 显示PDF预览并提供手动输入
                                                        const previewDataUrl = textCanvas.toDataURL();
                                                        
                                                        // 创建一个模态框显示PDF内容和手动输入
                                                        const modal = document.createElement('div');
                                                        modal.style.cssText = `
                                                            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                                                            background: rgba(0,0,0,0.8); z-index: 10000;
                                                            display: flex; align-items: center; justify-content: center;
                                                        `;
                                                        
                                                        modal.innerHTML = `
                                                            <div style="background: white; padding: 20px; border-radius: 10px; max-width: 90%; max-height: 90%; overflow: auto;">
                                                                <h3 style="margin-top: 0;">PDF预览 - 请手动输入条形码</h3>
                                                                <img src="${previewDataUrl}" style="max-width: 100%; margin-bottom: 15px;" />
                                                                <div style="margin-bottom: 15px;">
                                                                    <input type="text" id="manualBarcodeInput" placeholder="请输入PDF中的条形码内容" 
                                                                           style="width: 300px; padding: 8px; margin-right: 10px; border: 1px solid #ccc; border-radius: 4px;" />
                                                                    <button id="confirmBarcode" style="padding: 8px 15px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">
                                                                        确认
                                                                    </button>
                                                                    <button id="cancelBarcode" style="padding: 8px 15px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 5px;">
                                                                        取消
                                                                    </button>
                                                                </div>
                                                                <p style="color: #666; font-size: 14px;">
                                                                    提示：找到PDF中的条形码下方的文字/数字，手动输入到上面的输入框中
                                                                </p>
                                                            </div>
                                                        `;
                                                        
                                                        document.body.appendChild(modal);
                                                        
                                                        const input = modal.querySelector('#manualBarcodeInput') as HTMLInputElement;
                                                        const confirmBtn = modal.querySelector('#confirmBarcode') as HTMLButtonElement;
                                                        const cancelBtn = modal.querySelector('#cancelBarcode') as HTMLButtonElement;
                                                        
                                                        input.focus();
                                                        
                                                        confirmBtn.onclick = () => {
                                                            const inputValue = input.value.trim();
                                                            if (inputValue) {
                                                                onScanBarcode(inputValue);
                                                                document.body.removeChild(modal);
                                                                alert('手动输入成功: ' + inputValue);
                                                            } else {
                                                                alert('请输入条形码内容');
                                                            }
                                                        };
                                                        
                                                        cancelBtn.onclick = () => {
                                                            document.body.removeChild(modal);
                                                        };
                                                        
                                                        input.onkeypress = (e) => {
                                                            if (e.key === 'Enter') {
                                                                confirmBtn.click();
                                                            }
                                                        };
                                                        
                                                        modal.onclick = (e) => {
                                                            if (e.target === modal) {
                                                                cancelBtn.click();
                                                            }
                                                        };
                                                        
                                                        return; // 不显示失败消息
                                                    }
                                                } catch (textError) {
                                                    console.error('文本识别失败:', textError);
                                                }
                                                
                                                alert('PDF条形码识别失败\n建议：\n1. 确认PDF中包含标准条形码格式\n2. 截图条形码部分重新上传\n3. 或使用下方手动输入功能');
                                            }
                                        } catch (err) {
                                            console.error('PDF处理错误:', err);
                                            alert('PDF处理失败: ' + (err as any).message + '\n建议截图条形码部分重新上传');
                                        }
                                        return;
                                    }
                                    
                                    try {
                                        const reader = new FileReader();
                                        reader.onload = async () => {
                                            try {
                                                const img = new Image();
                                                img.onload = async () => {
                                                    try {
                                                        const codeReader = new BrowserMultiFormatReader(undefined, undefined);
                                                        // 尝试多种识别方法
                                                        let result = null;
                                                        
                                                        // 方法1: 直接从图片元素识别
                                                        try {
                                                            result = await codeReader.decodeFromImageElement(img);
                                                        } catch (e1) {
                                                            console.log('方法1失败:', e1);
                                                            
                                                            // 方法2: 使用画布处理后识别
                                                            try {
                                                                const canvas = document.createElement('canvas');
                                                                const ctx = canvas.getContext('2d');
                                                                if (ctx) {
                                                                    // 调整图片大小提高识别率
                                                                    const scale = Math.min(800/img.width, 600/img.height);
                                                                    canvas.width = img.width * scale;
                                                                    canvas.height = img.height * scale;
                                                                    
                                                                    // 提高图像质量
                                                                    ctx.imageSmoothingEnabled = false;
                                                                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                                                                    
                                                                    result = await codeReader.decodeFromCanvas(canvas);
                                                                }
                                                            } catch (e2) {
                                                                console.log('方法2失败:', e2);
                                                                throw new Error('所有识别方法都失败了');
                                                            }
                                                        }
                                                        
                                                        if (result && result.getText()) {
                                                            const text = result.getText();
                                                            onScanBarcode(text);
                                                            alert('识别成功: ' + text);
                                                        } else {
                                                            alert('未识别到条形码，请确保：\n1. 图片清晰\n2. 条形码完整\n3. 光线充足');
                                                        }
                                                    } catch(err) {
                                                        alert('识别失败: ' + (err as any).message + '\n请尝试：\n1. 重新拍摄更清晰的照片\n2. 确保条形码完整可见\n3. 或使用手动输入');
                                                    }
                                                };
                                                img.crossOrigin = 'anonymous';
                                                img.src = reader.result as string;
                                            } catch (err) {
                                                alert('图片处理失败: ' + (err as any).message);
                                            }
                                        };
                                        reader.readAsDataURL(file);
                                    } catch (err:any) {
                                        alert('读取文件失败: ' + err.message);
                                    }
                                }}
                                className="w-full px-3 py-2 border border-dashed border-blue-300 rounded-lg text-sm bg-blue-50 hover:bg-blue-100"
                            />
                            <p className="text-xs text-blue-600 mt-1">手机拍照上传条形码图片</p>
                        </div>
                    </div>
                    
                    {scannerVisible && (
                        <div className="mt-4 border rounded-lg overflow-hidden">
                            <WorkingBarcodeScanner onScan={onScanBarcode} />
                        </div>
                    )}
                </div>

                {/* 打包进度 */}
                <div className="bg-gray-50 p-4 rounded-lg border">
                    <h3 className="font-semibold text-gray-800 mb-3">
                        <i className="fas fa-list-check mr-2"></i>打包进度
                    </h3>
                    <div className="space-y-2">
                        {order.order_items?.map((item, index) => {
                            const packedCount = packedItems[item.product || ''] || 0;
                            const requiredCount = item.quantity || 1;
                            const isCompleted = packedCount >= requiredCount;
                            return (
                                <div key={index} className={`flex items-center justify-between p-2 rounded ${
                                    isCompleted ? 'bg-green-100 border-green-300' : 'bg-white border-gray-200'
                                } border`}>
                                    <div className="flex-1">
                                        <span className="font-medium">{item.product}</span>
                                        <div className="text-sm text-gray-600">
                                            数量: {packedCount}/{requiredCount}
                                        </div>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        {isCompleted ? (
                                            <i className="fas fa-check-circle text-green-600 text-lg"></i>
                                        ) : (
                                            <i className="fas fa-circle text-gray-300 text-lg"></i>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* 完成按钮 */}
            <div className="flex justify-center">
                <button
                    onClick={onFinishPacking}
                    disabled={!allItemsPacked}
                    className={`px-8 py-4 font-bold text-lg rounded-lg transition-all ${
                        allItemsPacked 
                            ? 'bg-green-600 hover:bg-green-700 text-white shadow-lg hover:shadow-xl' 
                            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                >
                    <i className="fas fa-check-double mr-2"></i>
                    完成打包 ({order.order_items?.filter(item => {
                        const packedCount = packedItems[item.product || ''] || 0;
                        const requiredCount = item.quantity || 1;
                        return packedCount >= requiredCount;
                    }).length || 0}/{order.order_items?.length || 0})
                </button>
            </div>
        </div>
    );
};

// BarcodeScannerView Component - 条形码扫描页面
const BarcodeScannerView: React.FC<{
    onScan: (data: string) => void;
    showToast: Function;
}> = ({ onScan, showToast }) => {
    const [scannerActive, setScannerActive] = useState(false);
    const [manualInput, setManualInput] = useState('');
    const [scanHistory, setScanHistory] = useState<string[]>([]);

    const handleScan = (data: string) => {
        onScan(data);
        setScanHistory(prev => [data, ...prev.slice(0, 9)]); // 保留最近10条记录
        showToast(`扫描到: ${data}`, 'success');
    };

    const handleManualInput = () => {
        if (manualInput.trim()) {
            handleScan(manualInput.trim());
            setManualInput('');
        }
    };

    return (
        <div className="p-6 bg-white rounded-lg shadow animate-fade-in">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">
                <i className="fas fa-barcode mr-2 text-purple-600"></i>
                条形码扫描器
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 扫描区域 */}
                <div className="space-y-4">
                    <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                        <h3 className="font-semibold text-purple-800 mb-3">摄像头扫描</h3>
                        <button
                            onClick={() => setScannerActive(!scannerActive)}
                            className={`w-full px-4 py-3 rounded-lg font-semibold transition-colors ${
                                scannerActive 
                                    ? 'bg-red-600 hover:bg-red-700 text-white' 
                                        : 'bg-purple-600 hover:bg-purple-700 text-white'
                                }`}
                        >
                            <i className={`fas ${scannerActive ? 'fa-stop' : 'fa-play'} mr-2`}></i>
                            {scannerActive ? '停止扫描' : '开始扫描'}
                        </button>
                        
                        {scannerActive && (
                            <div className="mt-4 border rounded-lg overflow-hidden">
                                <WorkingBarcodeScanner onScan={handleScan} />
                            </div>
                        )}
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg border">
                        <h3 className="font-semibold text-gray-800 mb-3">手动输入</h3>
                        <div className="flex space-x-2 mb-3">
                            <input
                                type="text"
                                value={manualInput}
                                onChange={(e) => setManualInput(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleManualInput()}
                                placeholder="输入条形码内容"
                                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            />
                            <button
                                onClick={handleManualInput}
                                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                            >
                                确认
                            </button>
                        </div>
                        
                        <div className="border-t pt-3">
                            <h4 className="text-sm font-medium text-gray-700 mb-2">📷 拍照上传条形码或PDF订单</h4>
                            <input
                                type="file"
                                accept="image/*,application/pdf"
                                capture="environment"
                                onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    
                                    // 处理PDF文件
                                    if (file.type === 'application/pdf') {
                                        alert('检测到PDF文件，开始处理...');
                                        try {
                                            console.log('开始处理PDF文件:', file.name);
                                            
                                            // 动态加载PDF.js
                                            if (typeof (window as any).pdfjsLib === 'undefined') {
                                                console.log('加载PDF.js库...');
                                                const script = document.createElement('script');
                                                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
                                                document.head.appendChild(script);
                                                
                                                await new Promise((resolve, reject) => {
                                                    script.onload = () => {
                                                        console.log('PDF.js加载成功');
                                                        // 设置worker
                                                        (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                                                        resolve(true);
                                                    };
                                                    script.onerror = () => {
                                                        console.error('PDF.js加载失败');
                                                        reject(new Error('PDF.js加载失败'));
                                                    };
                                                });
                                            }
                                            
                                            const pdfjsLib = (window as any).pdfjsLib;
                                            if (!pdfjsLib) {
                                                throw new Error('PDF.js库未正确加载');
                                            }
                                            
                                            console.log('读取PDF文件...');
                                            const arrayBuffer = await file.arrayBuffer();
                                            console.log('PDF文件大小:', arrayBuffer.byteLength);
                                            
                                            const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
                                            console.log('PDF页数:', pdf.numPages);
                                            
                                            const page = await pdf.getPage(1);
                                            console.log('获取第一页成功');
                                            
                                            // 如果自动识别失败，显示预览窗口
                                            let recognitionSuccess = false;
                                            
                                            try {
                                                // 尝试自动识别
                                                const viewport = page.getViewport({scale: 3.0});
                                                const canvas = document.createElement('canvas');
                                                const ctx = canvas.getContext('2d');
                                                if (!ctx) throw new Error('无法创建canvas上下文');
                                                
                                                canvas.width = viewport.width;
                                                canvas.height = viewport.height;
                                                
                                                await page.render({
                                                    canvasContext: ctx,
                                                    viewport: viewport
                                                }).promise;
                                                
                                                const codeReader = new BrowserMultiFormatReader(undefined, undefined);
                                                const result = await codeReader.decodeFromCanvas(canvas);
                                                
                                                if (result && result.getText()) {
                                                    const text = result.getText();
                                                    handleScan(text);
                                                    alert('PDF条形码识别成功: ' + text);
                                                    recognitionSuccess = true;
                                                }
                                            } catch (autoError) {
                                                console.log('自动识别失败，显示预览窗口');
                                            }
                                            
                                            if (!recognitionSuccess) {
                                                // 显示PDF预览并提供手动输入
                                                const viewport = page.getViewport({scale: 2.0});
                                                const textCanvas = document.createElement('canvas');
                                                const textCtx = textCanvas.getContext('2d');
                                                if (textCtx) {
                                                    textCanvas.width = viewport.width;
                                                    textCanvas.height = viewport.height;
                                                    
                                                    await page.render({
                                                        canvasContext: textCtx,
                                                        viewport: viewport
                                                    }).promise;
                                                    
                                                    // 显示PDF预览并提供手动输入
                                                    const previewDataUrl = textCanvas.toDataURL();
                                                    
                                                    // 创建一个模态框显示PDF内容和手动输入
                                                    const modal = document.createElement('div');
                                                    modal.style.cssText = `
                                                        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                                                        background: rgba(0,0,0,0.8); z-index: 10000;
                                                        display: flex; align-items: center; justify-content: center;
                                                    `;
                                                    
                                                    modal.innerHTML = `
                                                        <div style="background: white; padding: 20px; border-radius: 10px; max-width: 90%; max-height: 90%; overflow: auto;">
                                                            <h3 style="margin-top: 0;">PDF预览 - 请手动输入条形码</h3>
                                                            <img src="${previewDataUrl}" style="max-width: 100%; margin-bottom: 15px;" />
                                                            <div style="margin-bottom: 15px;">
                                                                <input type="text" id="manualBarcodeInput" placeholder="请输入PDF中的条形码内容" 
                                                                       style="width: 300px; padding: 8px; margin-right: 10px; border: 1px solid #ccc; border-radius: 4px;" />
                                                                <button id="confirmBarcode" style="padding: 8px 15px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">
                                                                    确认
                                                                </button>
                                                                <button id="cancelBarcode" style="padding: 8px 15px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 5px;">
                                                                    取消
                                                                </button>
                                                            </div>
                                                            <p style="color: #666; font-size: 14px;">
                                                                提示：找到PDF中的条形码下方的文字/数字，手动输入到上面的输入框中
                                                            </p>
                                                        </div>
                                                    `;
                                                    
                                                    document.body.appendChild(modal);
                                                    
                                                    const input = modal.querySelector('#manualBarcodeInput') as HTMLInputElement;
                                                    const confirmBtn = modal.querySelector('#confirmBarcode') as HTMLButtonElement;
                                                    const cancelBtn = modal.querySelector('#cancelBarcode') as HTMLButtonElement;
                                                    
                                                    input.focus();
                                                    
                                                    confirmBtn.onclick = () => {
                                                        const inputValue = input.value.trim();
                                                        if (inputValue) {
                                                            handleScan(inputValue);
                                                            document.body.removeChild(modal);
                                                            alert('手动输入成功: ' + inputValue);
                                                        } else {
                                                            alert('请输入条形码内容');
                                                        }
                                                    };
                                                    
                                                    cancelBtn.onclick = () => {
                                                        document.body.removeChild(modal);
                                                    };
                                                    
                                                    input.onkeypress = (e) => {
                                                        if (e.key === 'Enter') {
                                                            confirmBtn.click();
                                                        }
                                                    };
                                                    
                                                    modal.onclick = (e) => {
                                                        if (e.target === modal) {
                                                            cancelBtn.click();
                                                        }
                                                    };
                                                    
                                                    return; // 不显示失败消息
                                                }
                                            }
                                        } catch (err) {
                                            console.error('PDF处理错误:', err);
                                            alert('PDF处理失败: ' + (err as any).message + '\n建议截图条形码部分重新上传');
                                        }
                                        return;
                                    }
                                    
                                    try {
                                        const reader = new FileReader();
                                        reader.onload = async () => {
                                            const img = new Image();
                                            img.onload = async () => {
                                                try {
                                                    const codeReader = new BrowserMultiFormatReader(undefined, undefined);
                                                    // 尝试多种识别方法
                                                    let result = null;
                                                    
                                                    // 方法1: 直接从图片元素识别
                                                    try {
                                                        result = await codeReader.decodeFromImageElement(img);
                                                    } catch (e1) {
                                                        console.log('方法1失败:', e1);
                                                        
                                                        // 方法2: 使用画布处理后识别
                                                        try {
                                                            const canvas = document.createElement('canvas');
                                                            const ctx = canvas.getContext('2d');
                                                            if (ctx) {
                                                                // 调整图片大小提高识别率
                                                                const scale = Math.min(800/img.width, 600/img.height);
                                                                canvas.width = img.width * scale;
                                                                canvas.height = img.height * scale;
                                                                
                                                                // 提高图像质量
                                                                ctx.imageSmoothingEnabled = false;
                                                                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                                                                
                                                                result = await codeReader.decodeFromCanvas(canvas);
                                                            }
                                                        } catch (e2) {
                                                            console.log('方法2失败:', e2);
                                                            throw new Error('所有识别方法都失败了');
                                                        }
                                                    }
                                                    
                                                    if (result && result.getText()) {
                                                        const text = result.getText();
                                                        handleScan(text);
                                                        alert('识别成功: ' + text);
                                                    } else {
                                                        alert('未识别到条形码，请确保：\n1. 图片清晰\n2. 条形码完整\n3. 光线充足');
                                                    }
                                                } catch(err) {
                                                    alert('识别失败: ' + (err as any).message + '\n请尝试：\n1. 重新拍摄更清晰的照片\n2. 确保条形码完整可见\n3. 或使用手动输入');
                                                }
                                            };
                                            img.crossOrigin = 'anonymous';
                                            img.src = reader.result as string;
                                        };
                                        reader.readAsDataURL(file);
                                    } catch(err:any) {
                                        alert('读取文件失败: ' + err.message);
                                    }
                                }}
                                className="w-full px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-gray-400"
                            />
                            <p className="text-xs text-gray-500 mt-1">手机用户可以拍照上传条形码图片</p>
                        </div>
                    </div>
                </div>

                {/* 扫描历史 */}
                <div className="bg-gray-50 p-4 rounded-lg border">
                    <h3 className="font-semibold text-gray-800 mb-3">
                        <i className="fas fa-history mr-2"></i>扫描记录
                    </h3>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                        {scanHistory.length === 0 ? (
                            <p className="text-gray-500 text-center py-4">暂无扫描记录</p>
                        ) : (
                            scanHistory.map((item, index) => (
                                <div key={index} className="bg-white p-2 rounded border text-sm">
                                    <span className="font-mono">{item}</span>
                                    <span className="text-xs text-gray-500 ml-2">
                                        {item.startsWith('ORDER-') ? '订单码' : item.startsWith('PRODUCT-') ? '产品码' : '其他'}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h4 className="font-semibold text-blue-800 mb-2">使用说明</h4>
                <ul className="text-sm text-blue-700 space-y-1">
                    <li><strong>订单条形码:</strong> 以"ORDER-"开头，扫描后自动进入打包模式</li>
                    <li><strong>产品条形码:</strong> 以"PRODUCT-"开头，在打包模式中用于核验产品</li>
                    <li><strong>摄像头权限:</strong> 需要允许浏览器访问摄像头才能扫描</li>
                </ul>
            </div>
        </div>
    );
};

// BarcodeScannerCamera Component - 摄像头扫描组件
const BarcodeScannerCamera: React.FC<{
    onScan: (data: string) => void;
}> = ({ onScan }) => {
    const [error, setError] = useState<string>('');
    const [isSupported, setIsSupported] = useState(true);

    useEffect(() => {
        let html5QrCode: any;
        
        const startScanner = async () => {
            try {
                // 检查是否支持摄像头
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    setError('您的设备不支持摄像头访问');
                    setIsSupported(false);
                    return;
                }

                if (typeof Html5Qrcode !== 'undefined') {
                    html5QrCode = new Html5Qrcode("qr-reader");
                    
                    // 获取可用摄像头
                    const devices = await Html5Qrcode.getCameras();
                    if (devices && devices.length > 0) {
                        // 优先使用后置摄像头，如果没有则使用第一个可用摄像头
                        const cameraId = devices.find(device => 
                            device.label.toLowerCase().includes('back') || 
                            device.label.toLowerCase().includes('rear')
                        )?.id || devices[0].id;

                        const config = {
                            fps: 10,
                            qrbox: { width: 200, height: 200 },
                            aspectRatio: 1.0
                        };
                        
                        await html5QrCode.start(
                            cameraId,
                            config,
                            (decodedText: string) => {
                                onScan(decodedText);
                            },
                            (errorMessage: string) => {
                                // 扫描失败可以忽略，这是正常的
                            }
                        );
                        setError('');
                    } else {
                        setError('未找到可用的摄像头');
                    }
                } else {
                    setError('扫描库未加载');
                }
            } catch (err: any) {
                console.error("摄像头启动失败:", err);
                if (err.name === 'NotAllowedError') {
                    setError('请允许访问摄像头权限');
                } else if (err.name === 'NotFoundError') {
                    setError('未找到摄像头设备');
                } else if (err.name === 'NotSupportedError') {
                    setError('您的浏览器不支持摄像头扫描');
                } else {
                    setError('摄像头启动失败，请检查权限设置');
                }
            }
        };

        startScanner();

        return () => {
            if (html5QrCode) {
                html5QrCode.stop().catch(() => {});
            }
        };
    }, [onScan]);

    if (!isSupported || error) {
        return (
            <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg text-center">
                <i className="fas fa-exclamation-triangle text-yellow-600 text-2xl mb-2"></i>
                <p className="text-yellow-800 font-medium mb-2">摄像头扫描不可用</p>
                <p className="text-yellow-700 text-sm mb-4">{error}</p>
                <div className="text-left text-sm text-yellow-700">
                    <p className="font-medium mb-1">解决方案:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>访问HTTPS版本: <strong>{`https://${window.location.hostname}:${window.location.port || '3002'}/`}</strong></li>
                        <li>若首次访问提示“不安全/证书”, 选择 继续访问 / 仍要加载</li>
                        <li>Safari: 地址栏左侧 aA -&gt; 网站设置 -&gt; 允许摄像头</li>
                        <li>允许后下拉刷新页面重新启动扫描</li>
                        <li>若仍失败: 打开 iPhone 设置 → Safari → 清除历史记录与网站数据，再重试</li>
                        <li>无法使用时改用下方手动输入或拍照上传</li>
                    </ul>
                </div>
            </div>
        );
    }

    return (
        <div className="relative bg-black rounded-lg overflow-hidden">
            <div id="qr-reader" style={{ width: '100%', minHeight: '300px' }}></div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-48 border-2 border-green-400 border-dashed opacity-50 rounded-lg"></div>
            </div>
            <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
                对准条形码扫描
            </div>
        </div>
    );
};
