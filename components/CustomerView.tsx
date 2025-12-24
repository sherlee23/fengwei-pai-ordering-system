import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, SELF_PICKUP_ADDRESS, PRODUCT_IMAGE_BASE_URL, WHATSAPP_NUMBER } from '../constants';
import { Product, CartItem, FeatureFlags, Order } from '../types';

// --- Helper Components ---

const LoadingSpinner: React.FC<{ text: string }> = ({ text }) => (
    <div className="text-center p-10 col-span-full">
        <svg className="mx-auto h-12 w-12 text-red-600 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="mt-2 text-lg font-semibold text-gray-700">{text}</p>
    </div>
);

const ProductCard: React.FC<{ product: Product; onAddToCart: (product: Product) => void }> = ({ product, onAddToCart }) => {
    const isOutOfStock = !product.is_unlimited && (product.stock_quantity || 0) <= 0;
    const isLowStock = !product.is_unlimited && !isOutOfStock && (product.stock_quantity || 0) <= (product.min_stock_threshold || 5);
    const imageUrl = product.image_url || (product.image_url ? (String(product.image_url).startsWith('http') ? product.image_url : PRODUCT_IMAGE_BASE_URL + encodeURIComponent(String(product.image_url).trim())) : '');

    return (
        <div className={`bg-white rounded-xl shadow-lg hover:shadow-2xl transition-shadow duration-300 flex flex-col overflow-hidden ${isOutOfStock ? 'opacity-60 bg-gray-100' : ''}`}>
            <div className="relative h-52 bg-gray-100 flex items-center justify-center">
                {imageUrl ? <img src={imageUrl} alt={product.name} className="max-w-full max-h-full object-contain" /> : <div className="w-full h-full flex items-center justify-center text-6xl">{product.emoji || '🍽️'}</div>}
                {isOutOfStock && <div className="absolute top-2 right-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-full">已售完</div>}
                {isLowStock && <div className="absolute top-2 right-2 bg-yellow-500 text-black text-xs font-bold px-2 py-1 rounded-full">库存紧张</div>}
            </div>
            <div className="p-5 flex flex-col flex-grow">
                <h3 className="text-lg font-bold text-gray-800">{product.emoji} {product.name} <span className="text-sm font-normal text-gray-500">{product.is_unlimited ? '(预购)' : '(现货)'}</span></h3>
                <p className="text-sm text-gray-500 mb-3">库存: {product.is_unlimited ? '充足' : (product.stock_quantity || 0)}</p>
                <div className="mt-auto flex justify-between items-center">
                    <p className="text-xl font-extrabold text-red-600">RM{Number(product.price || 0).toFixed(2)}</p>
                    <button onClick={() => onAddToCart(product)} disabled={isOutOfStock} className="bg-red-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-400 flex items-center gap-2"><i className="fas fa-cart-plus"></i>添加</button>
                </div>
            </div>
        </div>
    );
};

const CartSidebar: React.FC<{ isOpen: boolean; cart: CartItem[]; updateQuantity: (id: number, q: number) => void; removeFromCart: (id: number) => void; totalPrice: number; onClose: () => void; onCheckout: () => void; }> = ({ isOpen, cart, updateQuantity, removeFromCart, totalPrice, onClose, onCheckout }) => {
    return (
        <div>
            <div className={`fixed inset-0 bg-black/60 z-40 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />
            <div className={`fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-xl z-50 transform transition-transform ${isOpen ? 'translate-x-0' : 'translate-x-full'} flex flex-col`}>
                <header className="flex items-center justify-between p-5 border-b"><h2 className="text-xl font-bold">购物车</h2><button onClick={onClose}><i className="fas fa-times text-xl text-gray-500"></i></button></header>
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {cart.length === 0 ? <div className="text-center text-gray-500 mt-20"><i className="fas fa-shopping-cart text-4xl mb-3"></i><p>购物车是空的</p></div> :
                        cart.map(item => (
                            <div key={item.id} className="flex items-center gap-4">
                                <div className="text-3xl">{item.emoji || '🍽️'}</div>
                                <div className="flex-1">
                                    <p className="font-semibold">{item.name}</p>
                                    <p className="text-sm text-red-600">RM{Number(item.price || 0).toFixed(2)}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="w-7 h-7 bg-gray-200 rounded">-</button>
                                        <span>{item.quantity}</span>
                                        <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="w-7 h-7 bg-gray-200 rounded">+</button>
                                    </div>
                                </div>
                                <button onClick={() => removeFromCart(item.id)} className="text-gray-400 hover:text-red-500"><i className="fas fa-trash"></i></button>
                            </div>
                        ))
                    }
                </div>
                <footer className="p-5 border-t">
                    <div className="flex justify-between font-bold text-lg mb-4"><span>总计:</span><span className="text-red-600">RM{totalPrice.toFixed(2)}</span></div>
                    <button onClick={onCheckout} disabled={cart.length === 0} className="w-full bg-red-600 text-white font-bold py-3 rounded-lg hover:bg-red-700 disabled:bg-gray-300">去结算</button>
                </footer>
            </div>
        </div>
    );
};

// ... More components defined below ...

// --- Main Customer View ---
interface CustomerViewProps {
    onAdminClick: () => void;
    onPOSClick?: () => void;
    showToast: (message: string, type?: 'success' | 'danger' | 'warning') => void;
}

export const CustomerView: React.FC<CustomerViewProps> = ({ onAdminClick, onPOSClick, showToast }) => {
    const [products, setProducts] = useState<Product[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [featureFlags, setFeatureFlags] = useState<FeatureFlags>({ members_enabled: true, points_enabled: true, spending_tracking_enabled: true });
    const [lastOrder, setLastOrder] = useState<Order | null>(null);

    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [orderData, setOrderData] = useState<any>(null);

    // 定义完整的14个系列分类（按您提供的列表）
    
    
    // 只显示有产品的分类，但保持固定顺序
    const categories = useMemo(() => ['全部商品', ...new Set(products.map(p => p.category).filter(Boolean))], [products]);
    
    const [activeCategory, setActiveCategory] = useState('全部商品');

    const filteredProducts = useMemo(() => {
        if (activeCategory === '全部商品') return products;
        return products.filter(p => p.category === activeCategory);
    }, [products, activeCategory]);

    const refreshData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [productsRes, settingsRes] = await Promise.all([
                supabase.from('products').select('*').eq('is_published', true).order('id'),
                supabase.from('settings').select('value').eq('key', 'feature_flags').single()
            ]);
            if (productsRes.error) throw productsRes.error;
            setProducts(productsRes.data || []);
            if (settingsRes.data?.value) setFeatureFlags(prev => ({ ...prev, ...settingsRes.data.value as FeatureFlags }));
        } catch (error: any) {
            showToast(`加载数据失败: ${error.message}`, 'danger');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        refreshData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const addToCart = (product: Product) => {
        setCart(prev => {
            const exist = prev.find(i => i.id === product.id);
            if (exist) {
                if (product.is_unlimited || exist.quantity < (product.stock_quantity || 0)) {
                    showToast(`${product.name} 数量+1`, 'success');
                    return prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
                } else {
                    showToast(`${product.name} 库存不足`, 'warning');
                    return prev;
                }
            }
            showToast(`${product.name} 已添加`, 'success');
            return [...prev, { ...product, quantity: 1 }];
        });
    };
    const updateCartQuantity = (id: number, q: number) => setCart(prev => q <= 0 ? prev.filter(i => i.id !== id) : prev.map(i => i.id === id ? { ...i, quantity: q } : i));
    const removeFromCart = (id: number) => setCart(prev => prev.filter(i => i.id !== id));
    const cartTotal = useMemo(() => cart.reduce((t, i) => t + (i.price || 0) * i.quantity, 0), [cart]);
    const totalItems = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart]);

    const handleOrderSuccess = (finalOrder: Order) => {
        setCart([]);
        setIsConfirmOpen(false);
        setIsCheckoutOpen(false);
        setLastOrder(finalOrder);
        refreshData();
    };
    
    if (lastOrder) {
        return <OrderSuccessModal order={lastOrder} onNewOrder={() => setLastOrder(null)} />
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50">
            {/* 欢迎横幅 */}
            <div className="bg-gradient-to-r from-red-600 via-red-700 to-red-800 text-white py-3 animate-slide-in-down">
                <div className="max-w-7xl mx-auto px-4 text-center">
                    <p className="text-sm md:text-base font-medium">
                        🎉 <span className="animate-pulse">欢迎来到锋味派！</span> 
                        精选美食，现货预购一站式服务 🛒
                    </p>
                </div>
            </div>

            <header className="bg-white shadow-xl sticky top-0 z-40 border-b-2 border-red-100">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center py-4">
                    <div className="flex items-center gap-4 animate-fade-in">
                        <div className="p-2 bg-gradient-to-br from-red-500 to-red-600 rounded-full shadow-lg">
                            <i className="fas fa-utensils text-2xl text-white"></i>
                        </div>
                        <div>
                            <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-red-600 to-red-800 bg-clip-text text-transparent">
                                锋味派美食团购
                            </h1>
                            <p className="text-sm text-gray-600 hidden md:block">新鲜美味，品质保证</p>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        {/* 购物车按钮 */}
                        <button 
                            onClick={() => setIsCartOpen(true)} 
                            className="relative p-3 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-full shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200">
                            <i className="fas fa-shopping-cart text-lg"></i>
                            {totalItems > 0 && (
                                <span className="absolute -top-2 -right-2 bg-yellow-400 text-red-800 text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center animate-bounce">
                                    {totalItems}
                                </span>
                            )}
                        </button>
                        
                        <button onClick={onAdminClick} className="text-gray-600 hover:text-red-600 transition-all duration-200 hover:transform hover:scale-105">
                            <div className="flex flex-col items-center">
                                <i className="fas fa-user-shield text-2xl"></i>
                                <span className="text-xs mt-1 font-medium">管理后台</span>
                            </div>
                        </button>

                        {onPOSClick && (
                            <button onClick={onPOSClick} className="text-gray-600 hover:text-green-600 transition-all duration-200 hover:transform hover:scale-105">
                                <div className="flex flex-col items-center">
                                    <i className="fas fa-cash-register text-2xl"></i>
                                    <span className="text-xs mt-1 font-medium">现场销售</span>
                                </div>
                            </button>
                        )}
                    </div>
                </div>
            </header>
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="mb-8 sticky top-[80px] bg-gray-50/90 backdrop-blur-sm py-3 z-30">
                    <div className="flex space-x-2 overflow-x-auto pb-2">{categories.map(category => (<button key={category} onClick={() => setActiveCategory(category)} className={`px-4 py-2 text-sm font-semibold rounded-full whitespace-nowrap transition-colors ${activeCategory === category ? 'bg-red-600 text-white shadow' : 'bg-white text-gray-700 hover:bg-gray-200'}`}>{category}</button>))}</div>
                </div>
                {isLoading ? <LoadingSpinner text="加载商品中..." /> : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">{filteredProducts.length > 0 ? filteredProducts.map(product => (<ProductCard key={product.id} product={product} onAddToCart={addToCart} />)) : <p className="col-span-full text-center text-gray-500">该分类下暂无商品。</p>}</div>
                )}
            </main>
            <CartSidebar isOpen={isCartOpen} cart={cart} updateQuantity={updateCartQuantity} removeFromCart={removeFromCart} totalPrice={cartTotal} onClose={() => setIsCartOpen(false)} onCheckout={() => { setIsCartOpen(false); setIsCheckoutOpen(true); }} />
            {isCheckoutOpen && <CheckoutModal cart={cart} total={cartTotal} onClose={() => setIsCheckoutOpen(false)} onConfirm={(data) => { setOrderData(data); setIsCheckoutOpen(false); setIsConfirmOpen(true); }} showToast={showToast} />}
            {isConfirmOpen && <ConfirmationModal orderData={orderData} onConfirm={handleOrderSuccess} onCancel={() => { setIsConfirmOpen(false); setIsCheckoutOpen(true); }} showToast={showToast} featureFlags={featureFlags} />}
        </div>
    );
};

// --- Checkout and Confirmation Modals ---

const CheckoutModal: React.FC<{ cart: CartItem[], total: number, onClose: () => void, onConfirm: (data: any) => void, showToast: Function }> = ({ cart, total, onClose, onConfirm, showToast }) => {
    const [formData, setFormData] = useState({ name: '', phone: '', delivery: 'self-pickup', address: '', remarks: '', paymentMethod: '' });
    const [paymentProof, setPaymentProof] = useState<File | null>(null);
    const [errors, setErrors] = useState<any>({});
    const [agree, setAgree] = useState(false);

    const validate = () => {
        const newErrors: any = {};
        if (!agree) newErrors.agree = '请阅读并同意条款';
        if (!formData.name.trim()) newErrors.name = '请输入姓名';
        if (!/^(01)[0-9]{8,9}$/.test(formData.phone.trim())) newErrors.phone = '请输入有效的马来西亚手机号 (01... )';
        if (formData.delivery === 'lalamove' && !formData.address.trim()) newErrors.address = '请输入收货地址';
        if (!formData.paymentMethod) newErrors.paymentMethod = '请选择付款方式';
        if ((formData.paymentMethod === 'Maybank QR' || formData.paymentMethod === 'TNG eWallet') && !paymentProof) newErrors.paymentProof = '请上传付款凭证';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (validate()) { onConfirm({ ...formData, paymentProof, cart, total }); }
        else { showToast('请检查并填写所有必填项', 'warning'); }
    };

    return (
        <div 
            className="fixed inset-0 bg-black/60 z-50 overflow-y-auto"
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
                minHeight: '100vh'
            }}
        >
            <form onSubmit={handleSubmit} className="bg-white rounded-lg w-full max-w-lg my-8 flex flex-col animate-fade-in"
                style={{
                    maxHeight: 'calc(100vh - 2rem)',
                    margin: 'auto'
                }}
            >
                <div className="flex justify-between items-center p-5 border-b"><h3 className="font-bold text-xl">填写订单信息</h3><button type="button" onClick={onClose}><i className="fas fa-times text-xl"></i></button></div>
                <div className="p-6 space-y-4 overflow-y-auto">
                    <div className="p-4 bg-yellow-50 border-l-4 border-yellow-400 text-yellow-800">
                        <h4 className="font-bold">⚠️ 重要声明 / Important Notice</h4>
                        <ul className="list-disc list-inside text-sm space-y-1 mt-2">
                            <li>此为预购商品，订单汇总后统一向供应商订购。</li>
                            <li>预计等待时间：30-60天（从下单日起计算）。</li>
                            <li>当前价格已包含国际运费，运费是根据实际物流成本调整收取。</li>
                            <li>价格不含本地运费，可自取也可以安排Lalamove或物流配送。</li>
                        </ul>
                        <div className="mt-4"><label className="flex items-center"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="h-4 w-4 text-red-600 border-gray-300 rounded focus:ring-red-500" /><span className="ml-2 text-sm font-semibold text-gray-900">我已阅读并同意上述条款</span></label>{errors.agree && <p className="text-red-500 text-xs mt-1">{errors.agree}</p>}</div>
                    </div>
                    <div><label className="block text-sm font-semibold mb-1">姓名 *</label><input className="w-full border rounded p-2" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />{errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}</div>
                    <div><label className="block text-sm font-semibold mb-1">电话 *</label><input className="w-full border rounded p-2" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="例如 0162327792" />{errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}</div>
                    <div><label className="block text-sm font-semibold mb-1">取货方式 *</label><select className="w-full border rounded p-2" value={formData.delivery} onChange={e => setFormData({ ...formData, delivery: e.target.value })}><option value="self-pickup">自取</option><option value="lalamove">Lalamove送货</option></select></div>
                    {formData.delivery === 'self-pickup' && (<div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-sm"><p><strong>自取地址:</strong> {SELF_PICKUP_ADDRESS}</p></div>)}
                    {formData.delivery === 'lalamove' && (<div><label className="block text-sm font-semibold mb-1">收货地址 *</label><textarea className="w-full border rounded p-2" rows={3} value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} placeholder="请在此填写Lalamove送货地址"></textarea>{errors.address && <p className="text-red-500 text-xs mt-1">{errors.address}</p>}</div>)}
                    <div><label className="block text-sm font-semibold mb-1">付款方式 *</label><select className="w-full border rounded p-2" value={formData.paymentMethod} onChange={e => setFormData({ ...formData, paymentMethod: e.target.value })}><option value="">请选择</option><option value="Maybank QR">Maybank QR</option><option value="TNG eWallet">TNG eWallet</option></select>{errors.paymentMethod && <p className="text-red-500 text-xs mt-1">{errors.paymentMethod}</p>}</div>
                    {(formData.paymentMethod === 'Maybank QR' || formData.paymentMethod === 'TNG eWallet') && (<>
                        <div className="flex flex-col md:flex-row justify-center items-center gap-4">
                            {formData.paymentMethod === 'Maybank QR' ? (<>
                                <img src="https://edfnhhthztskuuosuasw.supabase.co/storage/v1/object/public/product-photos/IMG_4042.png" alt="Maybank QR" className="max-h-40 rounded-lg" />
                                <div className="text-sm p-3 bg-gray-50 rounded-lg border"><b>银行转账信息:</b><br />Bank: MAYBANK<br />Acc No: 114209540438<br />Name: CHOONG SHER LEE</div>
                            </>) : <img src="https://edfnhhthztskuuosuasw.supabase.co/storage/v1/object/public/product-photos/IMG_4043.jpeg" alt="TNG QR" className="max-h-40 rounded-lg" />}
                        </div>
                        
                        {/* 在上传凭证前再次显示订单摘要 */}
                        <div className="p-4 bg-green-50 border-l-4 border-green-400 rounded-lg">
                            <h4 className="font-bold text-green-800 mb-2">💰 转账金额确认</h4>
                            <div className="text-green-800 text-sm space-y-1">
                                {cart.map((item: CartItem) => (
                                    <div key={item.id} className="flex justify-between">
                                        <span>{item.emoji} {item.name} × {item.quantity}</span>
                                        <span>RM{((item.price || 0) * item.quantity).toFixed(2)}</span>
                                    </div>
                                ))}
                                <div className="border-t border-green-300 pt-2 mt-2 flex justify-between font-bold text-lg">
                                    <span>总转账金额:</span>
                                    <span className="text-red-600">RM{total.toFixed(2)}</span>
                                </div>
                            </div>
                        </div>

                        <div><label className="block text-sm font-semibold mb-1">上传付款凭证 *</label><input type="file" accept="image/*,application/pdf" className="w-full border rounded p-2" onChange={e => setPaymentProof(e.target.files ? e.target.files[0] : null)} />{errors.paymentProof && <p className="text-red-500 text-xs mt-1">{errors.paymentProof}</p>}</div>
                    </>)}
                    <div><label className="block text-sm font-semibold mb-1">备注</label><textarea className="w-full border rounded p-2" rows={2} value={formData.remarks} onChange={e => setFormData({ ...formData, remarks: e.target.value })}></textarea></div>
                </div>
                <div className="p-5 border-t flex justify-end gap-3"><button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 rounded">取消</button><button type="submit" className="px-4 py-2 bg-red-600 text-white rounded">确认订单</button></div>
            </form>
        </div>
    );
};

const ConfirmationModal: React.FC<{ orderData: any; onConfirm: (order: Order) => void; onCancel: () => void; showToast: Function; featureFlags: FeatureFlags; }> = ({ orderData, onConfirm, onCancel, showToast, featureFlags }) => {
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            const prefix = `FW${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
            const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true }).like('order_id', `${prefix}%`);
            const order_id = `${prefix}${String((count || 0) + 1).padStart(3, '0')}`;
            
            const { paymentProof, cart, total, ...formData } = orderData;
            
            let payment_proof_url = null;
            if (paymentProof) {
                // 清理文件名，移除中文字符和特殊字符
                const cleanFileName = paymentProof.name
                    .replace(/[^\w\-_.]/g, '') // 只保留字母、数字、连字符、下划线和点
                    .replace(/[\u4e00-\u9fff]/g, '') // 移除中文字符
                    .substring(0, 50); // 限制长度
                
                const fileExtension = paymentProof.name.split('.').pop() || 'jpg';
                const safeFileName = cleanFileName || `payment_${Date.now()}`;
                const path = `payment_proofs/${order_id}-${Date.now()}.${fileExtension}`;
                
                const { error } = await supabase.storage.from('payment-proofs').upload(path, paymentProof);
                if (error) throw new Error(`凭证上传失败: ${error.message}`);
                payment_proof_url = supabase.storage.from('payment-proofs').getPublicUrl(path).data.publicUrl;
            }

            const remarksWithAddress = formData.delivery === 'lalamove'
                ? `[Lalamove 地址: ${formData.address}] ${formData.remarks || ''}`.trim()
                : formData.remarks;

            const payload = {
                order_id, name: formData.name, phone: formData.phone, delivery_method: formData.delivery,
                total_amount: total, remarks: remarksWithAddress, payment_method: formData.paymentMethod,
                payment_proof_url, status: 'pending',
                order_items: cart.map((i: CartItem) => ({ 
                    product: i.name, 
                    price: i.price, 
                    quantity: i.quantity, 
                    emoji: i.emoji, 
                    is_unlimited: i.is_unlimited, 
                    product_id: i.id,
                    // 成本快照：记录下单时的成本，用于准确计算盈亏
                    cost_price_snapshot: i.cost_price || null,
                    shipping_cost_snapshot: i.shipping_cost || null
                })),
            };
            
            const { data: finalOrder, error } = await supabase.from('orders').insert([payload]).select().single();
            if (error) throw error;

            // 扣减库存并记录流水（仅现货订单）
            for (const item of cart) {
                if (!item.is_unlimited) {
                    // 1. 获取当前库存
                    const { data: productData } = await supabase
                        .from('products')
                        .select('stock_quantity')
                        .eq('id', item.id)
                        .single();
                    
                    const previousStock = productData?.stock_quantity || 0;
                    const newStock = previousStock - item.quantity;
                    
                    // 2. 扣减库存
                    const { error: stockError } = await supabase.rpc('decrease_stock', { 
                        p_id: item.id, 
                        p_quantity: item.quantity 
                    });
                    
                    if (stockError) {
                        console.error(`Stock update failed for product ${item.id}:`, stockError.message);
                    } else {
                        // 3. 记录库存流水
                        await supabase.from('stock_transactions').insert([{
                            product_id: item.id,
                            transaction_type: 'order',
                            quantity: -item.quantity, // 负数表示减少
                            previous_stock: previousStock,
                            new_stock: newStock,
                            reason: `客户订单: ${item.name}`,
                            order_id: finalOrder.order_id,
                            operator: 'system',
                            notes: `客户: ${payload.name || '匿名'}, 数量: ${item.quantity}`
                        }]);
                    }
                }
            }
            onConfirm(finalOrder);
        } catch (error: any) {
            showToast(`提交失败: ${error.message}`, 'danger');
            setIsSubmitting(false);
        }
    };

    return (
        <div 
            className="fixed inset-0 bg-black/60 z-50 overflow-y-auto"
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
                minHeight: '100vh'
            }}
        >
            <div className="bg-white rounded-lg w-full max-w-lg my-8 animate-fade-in"
                style={{
                    maxHeight: 'calc(100vh - 2rem)',
                    margin: 'auto'
                }}
            >
                <div className="p-6">
                    <h2 className="text-xl font-bold text-center mb-4">订单确认</h2>
                    <div className="space-y-2 text-sm">
                        <p><strong>姓名:</strong> {orderData.name}</p>
                        <p><strong>电话:</strong> {orderData.phone}</p>
                        <hr className="my-2" />
                        <ul className="list-disc list-inside pl-4">
                            {orderData.cart.map((item: CartItem) => (
                                <li key={item.id}>{item.name} x {item.quantity} = RM{((item.price || 0) * item.quantity).toFixed(2)}</li>
                            ))}
                        </ul>
                        <hr className="my-2" />
                        <p className="text-right font-bold text-lg">总金额: <span className="text-red-600">RM{orderData.total.toFixed(2)}</span></p>
                    </div>
                </div>
                <div className="px-6 py-4 bg-gray-50 flex justify-between rounded-b-lg">
                    <button onClick={onCancel} disabled={isSubmitting} className="px-4 py-2 bg-gray-300 rounded-lg hover:bg-gray-400">返回修改</button>
                    <button onClick={handleSubmit} disabled={isSubmitting} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400">{isSubmitting ? '提交中...' : '确认并提交'}</button>
                </div>
            </div>
        </div>
    );
};

const OrderSuccessModal: React.FC<{ order: Order; onNewOrder: () => void }> = ({ order, onNewOrder }) => {
    const buildOrderMessage = (order: Order) => {
        let msg = `🛎️ *锋味派新订单 #${order.order_id}*

`;
        msg += `👤 *客户信息*
`;
        msg += `📛 姓名: ${order.name}
`;
        msg += `📱 电话: ${order.phone}
`;
        msg += `🚚 取货方式: ${order.delivery_method === 'self-pickup' ? '自取' : 'Lalamove送货'}
`;

        // 如果是自取，显示详细的自取信息
        if (order.delivery_method === 'self-pickup') {
            msg += `📍 自取地址: ${SELF_PICKUP_ADDRESS}
`;
            msg += `⏰ 取货时间: 另行通知
`;
            msg += `📞 联络号码: ${WHATSAPP_NUMBER.replace(/^60/, '0')}
`;
        } else if (order.address) {
            msg += `📍 地址: ${order.address}
`;
        }

        msg += `
🛒 *订单明细*
`;
        (order.order_items || []).forEach(item => {
            // 自动匹配 emoji
            let emoji = item.emoji;
            if (!emoji) {
                const productName = item.product || '';
                if (productName.includes('烤肠')) emoji = '🌭';
                else if (productName.includes('虾')) emoji = '🦐';
                else if (productName.includes('披萨')) emoji = '🍕';
                else if (productName.includes('汤包') || productName.includes('小笼')) emoji = '🥟';
                else if (productName.includes('酥饼')) emoji = '🥮';
                else if (productName.includes('鸡排') || productName.includes('鸡翅')) emoji = '🍗';
                else if (productName.includes('水饺')) emoji = '🥟';
                else if (productName.includes('蒸饺')) emoji = '🥟';
                else if (productName.includes('烧卖')) emoji = '🥟';
                else if (productName.includes('奶茶')) emoji = '🧋';
                else emoji = '▫️';
            }
            const typeLabel = item.is_unlimited ? ' (预购)' : ' (现货)';
            msg += `${emoji} ${item.product}${typeLabel} × ${item.quantity} = RM${Number(item.price * item.quantity).toFixed(2)}
`;
        });
        msg += `
💰 *总金额: RM${Number(order.total_amount || 0).toFixed(2)}*
`;
        msg += `📝 *备注*: ${order.remarks || '无'}
`;
        msg += `📅 *下单时间*: ${new Date(order.created_at || Date.now()).toLocaleString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur' })}
`;
        return msg;
    };
    
    const whatsappMsg = useMemo(() => buildOrderMessage(order), [order]);
    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(whatsappMsg)}`;
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(whatsappMsg);
            alert('订单消息已复制！');
        } catch (err) {
            alert('复制失败，请手动复制。');
        }
    };
    
    return (
        <div 
            className="fixed inset-0 bg-black/60 z-50 overflow-y-auto"
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
                minHeight: '100vh'
            }}
        >
            <div className="bg-white rounded-lg w-full max-w-lg text-center p-6 space-y-4 my-8 animate-fade-in"
                style={{
                    maxHeight: 'calc(100vh - 2rem)',
                    margin: 'auto'
                }}
            >
                <i className="fas fa-check-circle text-5xl text-green-500"></i>
                <h2 className="text-2xl font-bold">下单成功!</h2>
                <div className="text-left text-sm bg-gray-100 p-3 rounded max-h-40 overflow-y-auto whitespace-pre-wrap">{whatsappMsg}</div>
                <p className="text-gray-600">请点击下方按钮，将订单信息发送到 WhatsApp。</p>
                <div className="flex flex-col sm:flex-row gap-2">
                    <button onClick={handleCopy} className="flex-1 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600">复制消息</button>
                    <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={onNewOrder} className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center justify-center gap-2"><i className="fab fa-whatsapp"></i>发送到 WhatsApp</a>
                </div>
                <button onClick={onNewOrder} className="w-full mt-2 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg">继续下单</button>
            </div>
        </div>
    );
};