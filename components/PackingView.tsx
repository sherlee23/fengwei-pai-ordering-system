import React, { useState, useEffect, useRef } from 'react';
import { WorkingBarcodeScanner } from './WorkingBarcodeScanner';
import { supabase } from '../constants';
import { Order, Product } from '../types';

interface PackingViewProps {
    showToast: (message: string, type?: 'success' | 'danger' | 'warning') => void;
    onExit: () => void;
    orders: Order[];
    products: Product[];
    fetchOrders: () => void;
    directOrder?: Order; // 直接打包的订单（可选）
}

interface PackedItem {
    productName: string;
    originalQuantity: number; // 原订单数量
    deliveredQuantity: number; // 已发货数量
    remainingQuantity: number; // 还需打包数量
    packedQuantity: number; // 已打包数量
    emoji?: string;
}

// 获取订单产品的已发货数量
const getDeliveredQuantity = async (orderId: string, productName: string): Promise<number> => {
    try {
        const { data, error } = await supabase
            .from('stock_transactions')
            .select('quantity, product:product_id(name), transaction_type')
            .eq('order_id', orderId)
            .in('transaction_type', ['partial_delivery', 'stock_out', 'manual_order']); // 兼容旧数据，建议统一为partial_delivery
        
        if (error) throw error;
        
        return data
            ?.filter(trans => (trans.product as any)?.name === productName && trans.quantity < 0)
            .reduce((sum, trans) => sum + Math.abs(trans.quantity), 0) || 0;
    } catch (error) {
        console.error('获取已发货数量失败:', error);
        return 0;
    }
};

const PackingView: React.FC<PackingViewProps> = ({ 
    showToast, 
    onExit, 
    orders, 
    products, 
    fetchOrders,
    directOrder
}) => {
    const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
    const [packedItems, setPackedItems] = useState<PackedItem[]>([]);
    const [scanningStep, setScanningStep] = useState<'order' | 'products'>('order');
    const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
    const [manualBarcode, setManualBarcode] = useState('');
    const [packingProgress, setPackingProgress] = useState<{[key: string]: number}>({});
    const [isComplete, setIsComplete] = useState(false);

    // 自动开始直接打包模式
    useEffect(() => {
        if (directOrder && !currentOrder) {
            console.log('🚀 直接打包模式，自动开始打包订单:', directOrder.order_id);
            initializePackingForOrder(directOrder);
        }
    }, [directOrder, currentOrder, showToast]);
    
    // 初始化订单打包（考虑已发货数量）
    const initializePackingForOrder = async (order: Order) => {
        setCurrentOrder(order);
        
        // 获取每个产品的已发货数量并计算剩余需打包数量
        const items: PackedItem[] = [];
        for (const item of order.order_items || []) {
            const deliveredQty = await getDeliveredQuantity(order.order_id, item.product);
            const remainingQty = Math.max(0, item.quantity - deliveredQty);
            
            if (remainingQty > 0) { // 只添加还需要打包的商品
                items.push({
                    productName: item.product,
                    originalQuantity: item.quantity,
                    deliveredQuantity: deliveredQty,
                    remainingQuantity: remainingQty,
                    packedQuantity: 0,
                    emoji: item.emoji
                });
            }
        }
        
        setPackedItems(items);
        setScanningStep('products');
        
        if (items.length === 0) {
            showToast(`订单 ${order.order_id} 所有商品已发货完毕，无需打包`, 'warning');
        } else {
            showToast(`开始打包订单 ${order.order_id}，需打包 ${items.length} 种商品`, 'success');
        }
    };

    // 重置状态
    const resetPacking = () => {
        setCurrentOrder(null);
        setPackedItems([]);
        setScanningStep('order');
        setPackingProgress({});
        setIsComplete(false);
        setManualBarcode('');
    };

    // 扫描订单条形码
    const handleOrderScan = async (scannedCode: string) => {
        console.log('📦 扫描订单条形码:', scannedCode);
        
        // 订单条形码格式: ORDER-FWxxx 或直接 FWxxx
        let orderNumber = scannedCode;
        if (scannedCode.startsWith('ORDER-')) {
            orderNumber = scannedCode.substring(6);
        }
        
        // 查找对应的订单
        const targetOrder = orders.find(order => order.order_id === orderNumber);
        
        if (!targetOrder) {
            showToast(`未找到订单 ${orderNumber}，请检查条形码`, 'danger');
            return;
        }
        
        if (targetOrder.status !== 'pending') {
            showToast(`订单 ${orderNumber} 状态为 ${targetOrder.status}，不能打包`, 'warning');
            return;
        }
        
        console.log('✅ 找到订单:', targetOrder);
        setShowBarcodeScanner(false);
        await initializePackingForOrder(targetOrder);
    };

    // 扫描产品条形码
    const handleProductScan = (scannedCode: string) => {
        console.log('📦 扫描产品条形码:', scannedCode);
        
        // 查找对应的产品
        const product = products.find(p => 
            p.barcode === scannedCode || 
            p.master_barcode === scannedCode ||
            p.id.toString() === scannedCode
        );
        
        if (!product) {
            showToast(`未找到条形码 ${scannedCode} 对应的产品`, 'danger');
            return;
        }
        
        console.log('✅ 找到产品:', product.name);
        
        // 在当前订单中查找这个产品
        const itemIndex = packedItems.findIndex(item => item.productName === product.name);
        
        if (itemIndex === -1) {
            showToast(`产品 ${product.name} 不在当前订单中`, 'warning');
            return;
        }
        
        const currentItem = packedItems[itemIndex];
        
        // 检查是否已经打包完成
        if (currentItem.packedQuantity >= currentItem.remainingQuantity) {
            showToast(`${product.name} 已打包完成 (${currentItem.remainingQuantity}/${currentItem.remainingQuantity})`, 'warning');
            return;
        }
        
        // 增加已打包数量
        const newPackedItems = [...packedItems];
        newPackedItems[itemIndex] = {
            ...currentItem,
            packedQuantity: currentItem.packedQuantity + 1
        };
        
        setPackedItems(newPackedItems);
        setShowBarcodeScanner(false);
        
        const newPackedQty = currentItem.packedQuantity + 1;
        showToast(
            `${product.name} +1 (${newPackedQty}/${currentItem.remainingQuantity})`,
            newPackedQty === currentItem.remainingQuantity ? 'success' : 'warning'
        );
        
        // 检查是否全部打包完成
        checkPackingComplete(newPackedItems);
    };

    // 检查打包是否完成
    const checkPackingComplete = (items: PackedItem[]) => {
        const allComplete = items.every(item => item.packedQuantity === item.remainingQuantity);
        setIsComplete(allComplete);
        
        if (allComplete) {
            showToast('🎉 订单打包完成！可以标记为准备取货', 'success');
        }
    };

    // 手动调整数量
    const adjustQuantity = (productName: string, delta: number) => {
        const newPackedItems = packedItems.map(item => {
            if (item.productName === productName) {
                const newQty = Math.max(0, Math.min(item.remainingQuantity, item.packedQuantity + delta));
                return { ...item, packedQuantity: newQty };
            }
            return item;
        });
        
        setPackedItems(newPackedItems);
        checkPackingComplete(newPackedItems);
    };

    // 完成打包并更新订单状态
    const completePacking = async () => {
        if (!currentOrder || !isComplete) return;
        
        try {
            const { error } = await supabase
                .from('orders')
                .update({ 
                    status: 'ready for pick up',
                    packing_completed_at: new Date().toISOString()
                })
                .eq('id', currentOrder.id);
            
            if (error) throw error;
            
            showToast(`订单 ${currentOrder.order_id} 已标记为准备取货`, 'success');
            fetchOrders();
            resetPacking();
        } catch (error: any) {
            showToast(`更新订单状态失败: ${error.message}`, 'danger');
        }
    };

    // 处理条形码扫描结果
    const handleBarcodeScanned = (result: string) => {
        if (directOrder) {
            // 直接打包模式，只处理产品扫描
            handleProductScan(result);
        } else {
            // 正常模式，根据步骤处理
            if (scanningStep === 'order') {
                handleOrderScan(result);
            } else {
                handleProductScan(result);
            }
        }
    };

    // 手动输入条形码
    const handleManualSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (manualBarcode.trim()) {
            handleBarcodeScanned(manualBarcode.trim());
            setManualBarcode('');
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 p-4">
            <div className="max-w-4xl mx-auto">
                {/* 头部 */}
                <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
                    <div className="flex items-center justify-between mb-4">
                        <h1 className="text-3xl font-bold text-gray-800">
                            <i className="fas fa-box mr-3 text-blue-600"></i>
                            智能打包系统
                        </h1>
                        <button
                            onClick={onExit}
                            className="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors">
                            <i className="fas fa-arrow-left mr-2"></i>
                            返回管理
                        </button>
                    </div>
                    
                    {/* 打包流程指示器 */}
                    <div className="flex items-center space-x-4 mb-4">
                        {directOrder ? (
                            // 直接打包模式 - 跳过第一步
                            <>
                                <div className="flex items-center px-4 py-2 rounded-full bg-green-100 text-green-800">
                                    <span className="mr-2">✅</span>
                                    订单已选定 #{directOrder.order_id}
                                </div>
                                <i className="fas fa-arrow-right text-gray-400"></i>
                                <div className={`flex items-center px-4 py-2 rounded-full ${
                                    isComplete ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                                }`}>
                                    <span className="mr-2">2️⃣</span>
                                    扫描产品条形码
                                    {isComplete && <i className="fas fa-check ml-2"></i>}
                                </div>
                                <i className="fas fa-arrow-right text-gray-400"></i>
                                <div className={`flex items-center px-4 py-2 rounded-full ${
                                    isComplete ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-500'
                                }`}>
                                    <span className="mr-2">3️⃣</span>
                                    完成打包
                                </div>
                            </>
                        ) : (
                            // 正常模式
                            <>
                                <div className={`flex items-center px-4 py-2 rounded-full ${
                                    scanningStep === 'order' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                                }`}>
                                    <span className="mr-2">1️⃣</span>
                                    扫描订单条形码
                                    {scanningStep !== 'order' && <i className="fas fa-check ml-2"></i>}
                                </div>
                                <i className="fas fa-arrow-right text-gray-400"></i>
                                <div className={`flex items-center px-4 py-2 rounded-full ${
                                    scanningStep === 'products' 
                                        ? (isComplete ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800')
                                        : 'bg-gray-100 text-gray-500'
                                }`}>
                                    <span className="mr-2">2️⃣</span>
                                    扫描产品条形码
                                    {isComplete && <i className="fas fa-check ml-2"></i>}
                                </div>
                                <i className="fas fa-arrow-right text-gray-400"></i>
                                <div className={`flex items-center px-4 py-2 rounded-full ${
                                    isComplete ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-500'
                                }`}>
                                    <span className="mr-2">3️⃣</span>
                                    完成打包
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* 当前订单信息 */}
                {currentOrder && (
                    <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
                        <h2 className="text-xl font-bold text-gray-800 mb-4">
                            <i className="fas fa-receipt mr-2 text-green-600"></i>
                            当前打包订单
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="text-sm font-medium text-gray-500">订单号</label>
                                <p className="text-lg font-bold text-blue-600">{currentOrder.order_id}</p>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-500">客户</label>
                                <p className="text-lg font-semibold">{currentOrder.name}</p>
                                <p className="text-sm text-gray-600">{currentOrder.phone}</p>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-500">配送方式</label>
                                <p className="text-lg font-semibold">
                                    {currentOrder.delivery_method === 'self-pickup' ? '自取' : 'Lalamove送货'}
                                </p>
                            </div>
                        </div>
                        {currentOrder.remarks && (
                            <div className="mt-4">
                                <label className="text-sm font-medium text-gray-500">备注</label>
                                <p className="text-gray-700">{currentOrder.remarks}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* 打包进度 */}
                {packedItems.length > 0 && (
                    <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
                        <h2 className="text-xl font-bold text-gray-800 mb-4">
                            <i className="fas fa-tasks mr-2 text-purple-600"></i>
                            打包进度
                        </h2>
                        <div className="space-y-3">
                            {packedItems.map((item, index) => {
                                const isItemComplete = item.packedQuantity === item.remainingQuantity;
                                const progress = (item.packedQuantity / item.remainingQuantity) * 100;
                                
                                return (
                                    <div key={index} className={`p-4 rounded-lg border-2 ${
                                        isItemComplete ? 'bg-green-50 border-green-300' : 'bg-yellow-50 border-yellow-300'
                                    }`}>
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center">
                                                <span className="text-2xl mr-2">{item.emoji || '📦'}</span>
                                                <div>
                                                    <span className="font-semibold text-lg">{item.productName}</span>
                                                    <div className="text-sm text-gray-600">
                                                        原订单：{item.originalQuantity} | 已发货：{item.deliveredQuantity} | 待打包：{item.remainingQuantity}
                                                    </div>
                                                </div>
                                                {isItemComplete && <i className="fas fa-check ml-2 text-green-600"></i>}
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <button
                                                    onClick={() => adjustQuantity(item.productName, -1)}
                                                    disabled={item.packedQuantity === 0}
                                                    className="w-8 h-8 bg-red-500 text-white rounded-full hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed">
                                                    <i className="fas fa-minus"></i>
                                                </button>
                                                <span className={`text-xl font-bold px-3 py-1 rounded ${
                                                    isItemComplete ? 'bg-green-200 text-green-800' : 'bg-yellow-200 text-yellow-800'
                                                }`}>
                                                    {item.packedQuantity} / {item.remainingQuantity}
                                                </span>
                                                <button
                                                    onClick={() => adjustQuantity(item.productName, 1)}
                                                    disabled={item.packedQuantity >= item.remainingQuantity}
                                                    className="w-8 h-8 bg-green-500 text-white rounded-full hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed">
                                                    <i className="fas fa-plus"></i>
                                                </button>
                                            </div>
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-2">
                                            <div 
                                                className={`h-2 rounded-full transition-all duration-300 ${
                                                    isItemComplete ? 'bg-green-500' : 'bg-yellow-500'
                                                }`}
                                                style={{ width: `${progress}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        
                        {/* 完成打包按钮 */}
                        {isComplete && (
                            <div className="mt-6 text-center">
                                <button
                                    onClick={completePacking}
                                    className="bg-green-600 text-white px-8 py-3 rounded-lg font-bold text-lg hover:bg-green-700 transition-colors animate-pulse">
                                    <i className="fas fa-check-circle mr-2"></i>
                                    完成打包并标记为准备取货
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* 扫描区域 */}
                <div className="bg-white rounded-lg shadow-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold text-gray-800">
                            <i className="fas fa-qrcode mr-2 text-blue-600"></i>
                            {directOrder ? '扫描产品条形码' : (scanningStep === 'order' ? '扫描订单条形码' : '扫描产品条形码')}
                        </h2>
                        <button
                            onClick={() => setShowBarcodeScanner(!showBarcodeScanner)}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                                showBarcodeScanner 
                                    ? 'bg-red-500 text-white hover:bg-red-600' 
                                    : 'bg-blue-500 text-white hover:bg-blue-600'
                            }`}>
                            <i className={`fas ${showBarcodeScanner ? 'fa-stop' : 'fa-camera'} mr-2`}></i>
                            {showBarcodeScanner ? '停止扫描' : '开启摄像头'}
                        </button>
                    </div>

                    {/* 摄像头扫描器 */}
                    {showBarcodeScanner && (
                        <div className="mb-6">
                            <WorkingBarcodeScanner onScanResult={handleBarcodeScanned} />
                        </div>
                    )}

                    {/* 手动输入 */}
                    <div className="border-t pt-4">
                        <h3 className="text-lg font-semibold mb-3">手动输入条形码</h3>
                        <form onSubmit={handleManualSubmit} className="flex gap-3">
                            <input
                                type="text"
                                value={manualBarcode}
                                onChange={(e) => setManualBarcode(e.target.value)}
                                placeholder={directOrder ? '输入产品条形码' : (scanningStep === 'order' ? '输入订单条形码 (如: FW001)' : '输入产品条形码')}
                                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            <button
                                type="submit"
                                disabled={!manualBarcode.trim()}
                                className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
                                <i className="fas fa-search mr-2"></i>
                                扫描
                            </button>
                        </form>
                    </div>

                    {/* 重新开始按钮 */}
                    {currentOrder && (
                        <div className="mt-6 text-center">
                            <button
                                onClick={resetPacking}
                                className="bg-gray-500 text-white px-6 py-2 rounded-lg hover:bg-gray-600 transition-colors">
                                <i className="fas fa-redo mr-2"></i>
                                重新开始打包
                            </button>
                        </div>
                    )}
                </div>

                {/* 操作指南 */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-6">
                    <h3 className="text-lg font-semibold text-blue-800 mb-3">
                        <i className="fas fa-info-circle mr-2"></i>
                        操作指南
                    </h3>
                    <div className="text-blue-700 space-y-2">
                        {directOrder ? (
                            // 直接打包模式指南
                            <>
                                <p><strong>🎯 直接打包模式：</strong> 无需扫描订单条形码，直接开始打包</p>
                                <p><strong>第一步：</strong> 逐一扫描订单中每个产品的条形码进行核验</p>
                                <p><strong>第二步：</strong> 确保所有产品数量正确后，点击"完成打包"</p>
                                <p><strong>💡 提示：</strong> 可以使用手动按钮调整数量，或重新扫描同一产品增加计数</p>
                                <p><strong>⚡ 优势：</strong> 跳过订单扫描步骤，减少操作失误，提高打包效率</p>
                            </>
                        ) : (
                            // 正常模式指南
                            <>
                                <p><strong>第一步：</strong> 从订单打印单上扫描订单条形码，或手动输入订单号</p>
                                <p><strong>第二步：</strong> 逐一扫描订单中每个产品的条形码进行核验</p>
                                <p><strong>第三步：</strong> 确保所有产品数量正确后，点击"完成打包"</p>
                                <p><strong>💡 提示：</strong> 可以使用手动按钮调整数量，或重新扫描同一产品增加计数</p>
                                <p><strong>⚠️ 注意：</strong> 只有状态为"待处理"的订单才能进行打包操作</p>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PackingView;
