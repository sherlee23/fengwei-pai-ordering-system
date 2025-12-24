import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Product } from '../types';
import { supabase } from '../constants';
import { WorkingBarcodeScanner } from './WorkingBarcodeScanner';

interface POSItem {
    product: Product;
    quantity: number;
    subtotal: number;
}

interface POSViewProps {
    products: Product[];
    showToast: (message: string, type?: 'success' | 'danger' | 'warning') => void;
    onBack?: () => void;
}

const POSView: React.FC<POSViewProps> = ({ products, showToast, onBack }) => {
    const [cart, setCart] = useState<POSItem[]>([]);
    const [barcodeInput, setBarcodeInput] = useState('');
    const [customerName, setCustomerName] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [cashier, setCashier] = useState('');
    const [showQRPayment, setShowQRPayment] = useState(false);
    const [staffList, setStaffList] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [scanMode, setScanMode] = useState<'manual' | 'camera'>('manual');
    const barcodeInputRef = useRef<HTMLInputElement>(null);

    // 计算总金额
    const totalAmount = cart.reduce((sum, item) => sum + item.subtotal, 0);

    // 自动聚焦条形码输入框
    useEffect(() => {
        if (barcodeInputRef.current && !isScanning) {
            barcodeInputRef.current.focus();
        }
    }, [cart, isScanning]);

    // 加载员工列表
    useEffect(() => {
        const loadStaff = async () => {
            try {
                const { data, error } = await supabase
                    .from('staff')
                    .select('*')
                    .eq('status', 'active')
                    .order('name');

                if (error) {
                    console.error('加载员工列表失败:', error);
                    return;
                }

                setStaffList(data || []);
            } catch (error) {
                console.error('加载员工列表失败:', error);
            }
        };

        loadStaff();
    }, []);

    // 处理条形码扫描
    const handleBarcodeSubmit = useCallback((barcode: string) => {
        if (!barcode.trim()) return;

        // 查找产品
        const product = products.find(p => 
            p.barcode === barcode.trim() || 
            p.master_barcode === barcode.trim()
        );

        if (!product) {
            showToast(`❌ 未找到条形码: ${barcode}`, 'danger');
            setBarcodeInput('');
            return;
        }

        // 检查库存
        if (!product.is_unlimited && (product.stock_quantity || 0) <= 0) {
            showToast(`⚠️ ${product.name} 库存不足`, 'warning');
            setBarcodeInput('');
            return;
        }

        // 添加到购物车
        setCart(prev => {
            const existingIndex = prev.findIndex(item => item.product.id === product.id);
            
            if (existingIndex >= 0) {
                // 产品已存在，增加数量
                const newCart = [...prev];
                newCart[existingIndex].quantity += 1;
                newCart[existingIndex].subtotal = newCart[existingIndex].quantity * product.price;
                return newCart;
            } else {
                // 新产品
                return [...prev, {
                    product,
                    quantity: 1,
                    subtotal: product.price
                }];
            }
        });

        showToast(`✅ 已添加: ${product.name}`, 'success');
        setBarcodeInput('');
    }, [products, showToast]);

    // 手动输入条形码
    const handleBarcodeInputSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        handleBarcodeSubmit(barcodeInput);
    };

    // 修改商品数量
    const updateQuantity = (index: number, newQuantity: number) => {
        if (newQuantity <= 0) {
            removeItem(index);
            return;
        }

        setCart(prev => {
            const newCart = [...prev];
            newCart[index].quantity = newQuantity;
            newCart[index].subtotal = newQuantity * newCart[index].product.price;
            return newCart;
        });
    };

    // 移除商品
    const removeItem = (index: number) => {
        setCart(prev => prev.filter((_, i) => i !== index));
    };

    // 清空购物车
    const clearCart = () => {
        if (window.confirm('确定要清空购物车吗？')) {
            setCart([]);
        }
    };

    // 处理线上支付
    const handleOnlinePayment = () => {
        if (!customerName.trim()) {
            showToast('请先输入客户姓名', 'warning');
            return;
        }
        setShowQRPayment(true);
    };

    // 生成支付QR码数据
    const generatePaymentQR = () => {
        // 这里可以集成真实的支付接口，比如支付宝、微信支付等
        // 目前生成一个模拟的支付链接
        const paymentData = {
            amount: totalAmount,
            orderId: `POS-${Date.now()}`,
            customer: customerName,
            timestamp: new Date().toISOString()
        };
        
        // 实际实现时，这里应该调用支付接口生成真实的支付链接
        return `https://pay.example.com?amount=${paymentData.amount}&order=${paymentData.orderId}&customer=${encodeURIComponent(paymentData.customer)}`;
    };

    // 完成交易
    const handleCheckout = async () => {
        if (cart.length === 0) {
            showToast('购物车是空的', 'warning');
            return;
        }

        if (!customerName.trim()) {
            showToast('请输入客户姓名', 'warning');
            return;
        }

        if (!cashier.trim()) {
            showToast('请选择收款员', 'warning');
            return;
        }

        setLoading(true);
        
        try {
            // 生成订单号 - 使用与CustomerView相同的格式
            const prefix = `FW${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
            const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true }).like('order_id', `${prefix}%`);
            const orderId = `${prefix}${String((count || 0) + 1).padStart(3, '0')}`;
            
            // 准备订单数据
            const orderItems = cart.map(item => ({
                product: item.product.name,
                price: item.product.price,
                quantity: item.quantity,
                emoji: item.product.emoji,
                is_unlimited: item.product.is_unlimited,
                product_id: item.product.id,
                cost_price_snapshot: item.product.cost_price,
                shipping_cost_snapshot: null
            }));

            // 创建订单
            const { error: orderError } = await supabase.from('orders').insert([{
                order_id: orderId,
                name: customerName,
                phone: customerPhone || 'N/A',
                delivery_method: 'self-pickup',
                total_amount: totalAmount,
                remarks: `🏪 POS现场销售 - 收款员: ${cashier}`,
                payment_method: paymentMethod,
                payment_proof_url: null,
                status: 'completed', // POS销售直接标记为已完成
                order_items: orderItems,
                member_id: null
            }]);

            if (orderError) throw orderError;

            // 扣除库存（仅现货产品）
            for (const item of cart) {
                if (!item.product.is_unlimited) {
                    const currentStock = item.product.stock_quantity || 0;
                    const newStock = currentStock - item.quantity;

                    // 更新产品库存
                    const { error: stockError } = await supabase
                        .from('products')
                        .update({ stock_quantity: newStock })
                        .eq('id', item.product.id);

                    if (stockError) {
                        console.error('库存更新失败:', stockError);
                        continue;
                    }

                    // 记录库存流水
                    await supabase.from('stock_transactions').insert([{
                        product_id: item.product.id,
                        transaction_type: 'order',
                        quantity: -item.quantity,
                        previous_stock: currentStock,
                        new_stock: newStock,
                        reason: 'POS现场销售',
                        order_id: orderId,
                        operator: cashier,
                        notes: `🏪 POS现场销售\n客户: ${customerName}\n支付方式: ${paymentMethod}\n收款员: ${cashier}`
                    }]);
                }
            }

            showToast(`✅ 交易完成！订单号: ${orderId}`, 'success');
            
            // 重置表单
            setCart([]);
            setCustomerName('');
            setCustomerPhone('');
            setPaymentMethod('cash');
            setCashier('');
            setShowQRPayment(false);

        } catch (error: any) {
            showToast(`交易失败: ${error.message}`, 'danger');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-100">
            <div className="max-w-7xl mx-auto p-4">
                {/* 页面标题 */}
                <div className="bg-gradient-to-r from-green-600 to-green-700 text-white p-6 rounded-lg shadow-lg mb-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold">
                                <i className="fas fa-cash-register mr-3"></i>
                                锋味派 POS 收银系统
                            </h1>
                            <p className="text-green-100 mt-2">现场扫码销售 - 即时结账</p>
                        </div>
                        {onBack && (
                            <button
                                onClick={onBack}
                                className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg transition-colors"
                            >
                                <i className="fas fa-arrow-left mr-2"></i>
                                返回主页
                            </button>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* 左侧：扫码和商品选择 */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* 条形码扫描区 */}
                        <div className="bg-white p-6 rounded-lg shadow">
                            <h2 className="text-xl font-bold mb-4">
                                <i className="fas fa-barcode mr-2 text-blue-600"></i>
                                扫描商品条形码
                            </h2>
                            
                            {/* 扫描模式选择 */}
                            <div className="flex mb-4 border-b border-gray-200">
                                <button
                                    onClick={() => setScanMode('manual')}
                                    className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                                        scanMode === 'manual'
                                            ? 'border-blue-500 text-blue-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    <i className="fas fa-keyboard mr-2"></i>
                                    手动输入
                                </button>
                                <button
                                    onClick={() => setScanMode('camera')}
                                    className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                                        scanMode === 'camera'
                                            ? 'border-blue-500 text-blue-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    <i className="fas fa-camera mr-2"></i>
                                    摄像头扫描
                                </button>
                            </div>

                            {/* 手动输入模式 */}
                            {scanMode === 'manual' && (
                                <>
                                    <form onSubmit={handleBarcodeInputSubmit} className="mb-4">
                                        <div className="flex gap-3">
                                            <input
                                                ref={barcodeInputRef}
                                                type="text"
                                                value={barcodeInput}
                                                onChange={(e) => setBarcodeInput(e.target.value)}
                                                placeholder="扫描或输入条形码..."
                                                className="flex-1 text-lg p-3 border-2 border-blue-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                                                autoComplete="off"
                                            />
                                            <button
                                                type="submit"
                                                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
                                            >
                                                <i className="fas fa-plus mr-2"></i>
                                                添加
                                            </button>
                                        </div>
                                    </form>

                                    <div className="bg-blue-50 p-4 rounded-lg">
                                        <p className="text-sm text-blue-700">
                                            <i className="fas fa-info-circle mr-2"></i>
                                            <strong>使用说明：</strong>使用扫码枪扫描商品条形码，或手动输入条形码号码后点击"添加"
                                        </p>
                                    </div>
                                </>
                            )}

                            {/* 摄像头扫描模式 */}
                            {scanMode === 'camera' && (
                                <>
                                    <WorkingBarcodeScanner onScan={handleBarcodeSubmit} />
                                    <div className="bg-green-50 p-4 rounded-lg mt-4">
                                        <p className="text-sm text-green-700">
                                            <i className="fas fa-camera mr-2"></i>
                                            <strong>摄像头扫描：</strong>将商品条形码对准扫描框内，系统会自动识别并添加商品
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* 购物车 */}
                        <div className="bg-white p-6 rounded-lg shadow">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-xl font-bold">
                                    <i className="fas fa-shopping-cart mr-2 text-green-600"></i>
                                    购物车 ({cart.length})
                                </h2>
                                {cart.length > 0 && (
                                    <button
                                        onClick={clearCart}
                                        className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm"
                                    >
                                        <i className="fas fa-trash mr-2"></i>
                                        清空
                                    </button>
                                )}
                            </div>

                            {cart.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">
                                    <i className="fas fa-shopping-cart text-4xl mb-3 block text-gray-400"></i>
                                    <p>购物车是空的</p>
                                    <p className="text-sm">扫描商品条形码开始购物</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {cart.map((item, index) => (
                                        <div key={item.product.id} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                                            <span className="text-2xl">{item.product.emoji || '📦'}</span>
                                            <div className="flex-1">
                                                <h3 className="font-medium">{item.product.name}</h3>
                                                <p className="text-sm text-gray-600">RM{item.product.price.toFixed(2)} × {item.quantity}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => updateQuantity(index, item.quantity - 1)}
                                                    className="bg-gray-300 hover:bg-gray-400 text-gray-700 w-8 h-8 rounded-lg flex items-center justify-center"
                                                >
                                                    <i className="fas fa-minus"></i>
                                                </button>
                                                <span className="w-12 text-center font-medium">{item.quantity}</span>
                                                <button
                                                    onClick={() => updateQuantity(index, item.quantity + 1)}
                                                    className="bg-gray-300 hover:bg-gray-400 text-gray-700 w-8 h-8 rounded-lg flex items-center justify-center"
                                                >
                                                    <i className="fas fa-plus"></i>
                                                </button>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-bold text-green-600">RM{item.subtotal.toFixed(2)}</p>
                                                <button
                                                    onClick={() => removeItem(index)}
                                                    className="text-red-500 hover:text-red-700 text-sm"
                                                >
                                                    删除
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 右侧：结账区 */}
                    <div className="space-y-6">
                        {/* 总金额显示 */}
                        <div className="bg-white p-6 rounded-lg shadow">
                            <h2 className="text-xl font-bold mb-4">结账信息</h2>
                            
                            <div className="bg-green-50 p-4 rounded-lg mb-4">
                                <div className="text-center">
                                    <p className="text-sm text-gray-600 mb-1">应付金额</p>
                                    <p className="text-4xl font-bold text-green-600">RM{totalAmount.toFixed(2)}</p>
                                </div>
                            </div>

                            {/* 客户信息 */}
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        客户姓名 <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={customerName}
                                        onChange={(e) => setCustomerName(e.target.value)}
                                        placeholder="输入客户姓名"
                                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        联系电话 <span className="text-gray-500">(可选)</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={customerPhone}
                                        onChange={(e) => setCustomerPhone(e.target.value)}
                                        placeholder="输入联系电话"
                                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        支付方式
                                    </label>
                                    <select
                                        value={paymentMethod}
                                        onChange={(e) => {
                                            setPaymentMethod(e.target.value);
                                            setShowQRPayment(false);
                                        }}
                                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                    >
                                        <option value="cash">💵 现金支付</option>
                                        <option value="Maybank QR">🏦 Maybank QR</option>
                                        <option value="TNG eWallet">📱 TNG eWallet</option>
                                    </select>
                                </div>

                                {/* 收款员选择 - 所有支付方式都需要 */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        收款员 <span className="text-red-500">*</span>
                                    </label>
                                    <select
                                        value={cashier}
                                        onChange={(e) => setCashier(e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                    >
                                        <option value="">请选择收款员</option>
                                        {staffList.map((staff) => (
                                            <option key={staff.id} value={staff.name}>
                                                {staff.role === '店长' && '👨‍💼 '}
                                                {staff.role === '收银员' && '👩‍💼 '}
                                                {staff.role === '仓库管理员' && '📦 '}
                                                {staff.role === '临时工' && '👤 '}
                                                {staff.name}
                                                {staff.role !== staff.name && ` (${staff.role})`}
                                            </option>
                                        ))}
                                        {staffList.length === 0 && (
                                            <option disabled>暂无可用员工，请先在管理后台添加员工</option>
                                        )}
                                    </select>
                                    {staffList.length === 0 && (
                                        <p className="text-sm text-orange-600 mt-1">
                                            <i className="fas fa-exclamation-triangle mr-1"></i>
                                            请先到"管理后台 → 员工管理"添加员工信息
                                        </p>
                                    )}
                                </div>

                                {/* 线上支付时显示支付按钮 */}
                                {(paymentMethod === 'Maybank QR' || paymentMethod === 'TNG eWallet') && !showQRPayment && (
                                    <div className="bg-blue-50 p-4 rounded-lg">
                                        <p className="text-sm text-blue-700 mb-3">
                                            <i className="fas fa-qrcode mr-2"></i>
                                            点击下方按钮显示收款二维码，客户扫码完成支付
                                        </p>
                                        <button
                                            onClick={handleOnlinePayment}
                                            disabled={!customerName.trim()}
                                            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                                        >
                                            <i className="fas fa-qrcode mr-2"></i>
                                            显示收款二维码
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* 结账按钮 */}
                            <button
                                onClick={handleCheckout}
                                disabled={
                                    loading || 
                                    cart.length === 0 || 
                                    !customerName.trim() || 
                                    !cashier.trim()
                                }
                                className="w-full mt-6 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white py-4 px-6 rounded-lg font-bold text-lg disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all"
                            >
                                {loading ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin mr-2"></i>
                                        处理中...
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-credit-card mr-2"></i>
                                        完成交易
                                    </>
                                )}
                            </button>

                            {cart.length > 0 && customerName.trim() && (
                                <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                                    <p className="text-sm text-blue-700">
                                        <i className="fas fa-info-circle mr-1"></i>
                                        点击"完成交易"将立即：
                                    </p>
                                    <ul className="text-xs text-blue-600 mt-1 ml-4">
                                        <li>• 创建销售订单</li>
                                        <li>• 自动扣除库存</li>
                                        <li>• 记录销售流水</li>
                                    </ul>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 支付弹窗 */}
            {showQRPayment && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-bold">
                                {paymentMethod === 'Maybank QR' ? '🏦 Maybank 转账' : '📱 TNG 电子钱包'}
                            </h3>
                            <button
                                onClick={() => setShowQRPayment(false)}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                <i className="fas fa-times text-xl"></i>
                            </button>
                        </div>

                        {/* 订单摘要 */}
                        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <h4 className="font-bold text-yellow-800 mb-2">💰 转账金额确认</h4>
                            <div className="text-yellow-800 text-sm space-y-1">
                                {cart.map((item, index) => (
                                    <div key={index} className="flex justify-between">
                                        <span>{item.product.name} x{item.quantity}</span>
                                        <span>RM{item.subtotal.toFixed(2)}</span>
                                    </div>
                                ))}
                                <div className="border-t border-yellow-300 pt-2 font-bold flex justify-between">
                                    <span>总计</span>
                                    <span>RM{totalAmount.toFixed(2)}</span>
                                </div>
                            </div>
                            <p className="text-yellow-700 text-xs mt-2">
                                <strong>客户：</strong>{customerName}
                            </p>
                        </div>

                        {/* 支付信息 */}
                        <div className="flex flex-col items-center gap-4 mb-6">
                            {paymentMethod === 'Maybank QR' ? (
                                <>
                                    <img 
                                        src="https://edfnhhthztskuuosuasw.supabase.co/storage/v1/object/public/product-photos/IMG_4042.png" 
                                        alt="Maybank QR" 
                                        className="max-h-60 rounded-lg shadow-lg" 
                                    />
                                    <div className="text-sm p-4 bg-blue-50 rounded-lg border w-full">
                                        <p className="font-bold text-blue-800 mb-2">银行转账信息:</p>
                                        <p><strong>Bank:</strong> MAYBANK</p>
                                        <p><strong>Acc No:</strong> 114209540438</p>
                                        <p><strong>Name:</strong> CHOONG SHER LEE</p>
                                        <p className="mt-2 text-blue-600">
                                            <strong>转账金额:</strong> <span className="text-lg font-bold">RM{totalAmount.toFixed(2)}</span>
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <img 
                                        src="https://edfnhhthztskuuosuasw.supabase.co/storage/v1/object/public/product-photos/IMG_4043.jpeg" 
                                        alt="TNG QR" 
                                        className="max-h-60 rounded-lg shadow-lg" 
                                    />
                                    <div className="text-sm p-4 bg-green-50 rounded-lg border w-full">
                                        <p className="font-bold text-green-800 mb-2">Touch 'n Go 电子钱包:</p>
                                        <p className="text-green-600">请客户扫描上方二维码</p>
                                        <p className="mt-2 text-green-600">
                                            <strong>转账金额:</strong> <span className="text-lg font-bold">RM{totalAmount.toFixed(2)}</span>
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowQRPayment(false)}
                                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 px-4 rounded-lg font-medium"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleCheckout}
                                disabled={loading}
                                className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 px-4 rounded-lg font-medium disabled:bg-gray-400"
                            >
                                {loading ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin mr-2"></i>
                                        处理中...
                                    </>
                                ) : (
                                    '确认收款完成'
                                )}
                            </button>
                        </div>

                        <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                            <p className="text-orange-700 text-sm">
                                <i className="fas fa-exclamation-triangle mr-2"></i>
                                <strong>注意：</strong>请确认客户已完成转账后，再点击"确认收款完成"按钮
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default POSView;