import React, { useState, useEffect } from 'react';
import { CustomerView } from './components/CustomerView';
import { AdminView } from './components/AdminView';
import PackingView from './components/PackingView';
import POSView from './components/POSView';
import { ToastState, Product } from './types';
import { supabase } from './constants';

// Shared Toast Component
const Toast: React.FC<{ message: string; type: 'success' | 'danger' | 'warning'; onDismiss: () => void }> = ({ message, type, onDismiss }) => {
    const typeClasses = {
        success: "bg-green-100 text-green-700 border-green-300",
        danger: "bg-red-100 text-red-700 border-red-300",
        warning: "bg-yellow-100 text-yellow-700 border-yellow-300",
    };
    const icons = {
        success: <i className="fas fa-check-circle"></i>,
        danger: <i className="fas fa-times-circle"></i>,
        warning: <i className="fas fa-exclamation-triangle"></i>,
    };

    useEffect(() => {
        const timer = setTimeout(onDismiss, 3000);
        return () => clearTimeout(timer);
    }, [onDismiss]);

    return (
        <div className={`flex items-center w-full max-w-xs p-4 space-x-4 rounded-lg shadow-lg border animate-slide-in-down ${typeClasses[type]}`}>
            <div className="text-xl">{icons[type]}</div>
            <div className="pl-4 text-sm font-semibold">{message}</div>
        </div>
    );
};

function App() {
    const [view, setView] = useState<'customer' | 'admin' | 'packing' | 'pos'>(() => {
        // 根据 URL 路径决定初始视图
        const path = window.location.pathname;
        if (path === '/packing' || path.includes('/packing')) {
            return 'packing';
        }
        if (path === '/pos' || path.includes('/pos')) {
            return 'pos';
        }
        return 'customer';
    });
    const [toast, setToast] = useState<ToastState | null>(null);
    const [products, setProducts] = useState<Product[]>([]);

    // 获取产品数据
    useEffect(() => {
        const fetchProducts = async () => {
            try {
                const { data, error } = await supabase
                    .from('products')
                    .select('*')
                    .order('name');
                
                if (error) {
                    console.error('获取产品列表失败:', error);
                    return;
                }
                
                setProducts(data || []);
            } catch (error) {
                console.error('获取产品列表失败:', error);
            }
        };

        fetchProducts();
    }, []);

    // 监听 URL 变化
    useEffect(() => {
        const handlePopState = () => {
            const path = window.location.pathname;
            if (path === '/packing' || path.includes('/packing')) {
                setView('packing');
            } else if (path === '/pos' || path.includes('/pos')) {
                setView('pos');
            } else {
                setView('customer');
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const showToast = (message: string, type: 'success' | 'danger' | 'warning' = 'success') => {
        setToast({ message, type, id: Date.now() });
    };

    const renderView = () => {
        if (view === 'packing') {
            return <PackingView 
                showToast={showToast} 
                onExit={() => setView('customer')}
                orders={[]} 
                products={products}
                fetchOrders={() => {}}
            />;
        }
        if (view === 'pos') {
            return <POSView products={products} showToast={showToast} onBack={() => setView('customer')} />;
        }
        if (view === 'admin') {
            return <AdminView onExit={() => setView('customer')} showToast={showToast} />;
        }
        return <CustomerView onAdminClick={() => setView('admin')} onPOSClick={() => setView('pos')} showToast={showToast} />;
    };

    return (
        <div className="min-h-screen">
            {toast && (
                <div className="fixed top-5 right-5 z-[9999]">
                    <Toast
                        key={toast.id}
                        message={toast.message}
                        type={toast.type}
                        onDismiss={() => setToast(null)}
                    />
                </div>
            )}
            {renderView()}
        </div>
    );
}

export default App;
