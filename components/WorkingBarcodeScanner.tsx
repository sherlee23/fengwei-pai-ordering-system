import React, { useRef, useState, useEffect } from 'react';

interface WorkingBarcodeScanner {
    onScan: (data: string) => void;
}

export const WorkingBarcodeScanner: React.FC<WorkingBarcodeScanner> = ({ onScan }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [status, setStatus] = useState('正在初始化...');
    const [error, setError] = useState('');
    const [debugLog, setDebugLog] = useState<string[]>([]);
    const codeReaderRef = useRef<any>(null);
    const lastScannedRef = useRef({ code: '', time: 0 });
    const [isScanning, setIsScanning] = useState(false);

    const addDebugLog = (message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `${timestamp}: ${message}`;
        console.log(logEntry);
        setDebugLog(prev => [...prev.slice(-6), logEntry]);
    };

    const handleScanResult = (code: string) => {
        const now = Date.now();
        const timeDiff = now - lastScannedRef.current.time;
        
        // 防止重复扫描（2秒内相同条码只处理一次）
        if (lastScannedRef.current.code === code && timeDiff < 2000) {
            return;
        }
        
        lastScannedRef.current = { code, time: now };
        
        addDebugLog(`✅ 扫描成功: ${code}`);
        setStatus(`✅ 扫描成功: ${code}`);
        
        // 提供反馈
        if ('vibrate' in navigator) {
            navigator.vibrate([200, 100, 200]);
        }
        
        // 播放提示音（如果可能）
        try {
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFApGn+fzu2wdBzWU2e/NfC4EJ3jK7OCPQAoUXrTp66hVFA==');
            audio.play().catch(() => {}); // 忽略播放失败
        } catch (e) {}
        
        onScan(code);
        
        // 2秒后恢复扫描状态
        setTimeout(() => {
            setStatus('扫描中 - 将条码对准框内');
        }, 2000);
    };

    useEffect(() => {
        let isMounted = true;

        const startScanning = async () => {
            try {
                addDebugLog('=== 开始HTTPS扫描器初始化 ===');
                setStatus('正在请求摄像头权限...');

                // 检查环境
                if (!window.isSecureContext) {
                    throw new Error('需要HTTPS环境');
                }

                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    throw new Error('摄像头API不可用');
                }

                addDebugLog('✅ 环境检查通过');

                // 动态加载ZXing库
                if (typeof (window as any).ZXing === 'undefined') {
                    addDebugLog('正在加载ZXing库...');
                    setStatus('正在加载扫描引擎...');
                    
                    await new Promise<void>((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = 'https://unpkg.com/@zxing/library@latest/umd/index.min.js';
                        script.onload = () => {
                            addDebugLog('✅ ZXing库加载成功');
                            resolve();
                        };
                        script.onerror = () => {
                            addDebugLog('❌ ZXing库加载失败');
                            reject(new Error('扫描引擎加载失败'));
                        };
                        document.head.appendChild(script);
                    });
                }

                const ZXing = (window as any).ZXing;
                if (!ZXing || !ZXing.BrowserMultiFormatReader) {
                    throw new Error('ZXing库不完整');
                }

                addDebugLog('正在初始化扫描器...');
                codeReaderRef.current = new ZXing.BrowserMultiFormatReader();

                // 获取摄像头设备
                addDebugLog('正在获取摄像头设备...');
                const videoInputDevices = await codeReaderRef.current.listVideoInputDevices();
                addDebugLog(`找到 ${videoInputDevices.length} 个摄像头设备`);
                
                if (videoInputDevices.length === 0) {
                    throw new Error('没有找到可用的摄像头设备');
                }

                // 优先选择后置摄像头
                let selectedDeviceId = videoInputDevices[0].deviceId;
                for (const device of videoInputDevices) {
                    addDebugLog(`设备: ${device.label || '未命名设备'}`);
                    if (device.label.toLowerCase().includes('back') || 
                        device.label.toLowerCase().includes('rear') ||
                        device.label.toLowerCase().includes('environment')) {
                        selectedDeviceId = device.deviceId;
                        addDebugLog(`✅ 选择后置摄像头: ${device.label}`);
                        break;
                    }
                }

                if (!isMounted) return;

                addDebugLog('正在启动摄像头...');
                setStatus('正在启动摄像头...');

                // 启动扫描
                await codeReaderRef.current.decodeFromVideoDevice(
                    selectedDeviceId, 
                    videoRef.current, 
                    (result: any, err: any) => {
                        if (result) {
                            handleScanResult(result.getText());
                        }
                        // 忽略NotFoundException，这是正常的未找到条码错误
                        if (err && err.name !== 'NotFoundException') {
                            console.warn('扫描过程中的错误:', err);
                        }
                    }
                );

                if (isMounted) {
                    addDebugLog('✅ 扫描器启动成功');
                    setStatus('扫描中 - 将条码对准框内');
                    setIsScanning(true);
                }

            } catch (err: any) {
                addDebugLog(`❌ 扫描器启动失败: ${err.message}`);
                if (!isMounted) return;

                let errorMessage = '';
                if (err.name === 'NotAllowedError') {
                    errorMessage = '摄像头权限被拒绝 - 请允许摄像头访问';
                } else if (err.name === 'NotFoundError') {
                    errorMessage = '未检测到摄像头设备';
                } else if (err.name === 'NotSupportedError') {
                    errorMessage = '浏览器不支持摄像头功能';
                } else {
                    errorMessage = `启动失败: ${err.message}`;
                }
                
                setError(errorMessage);
            }
        };

        startScanning();

        return () => {
            isMounted = false;
            if (codeReaderRef.current) {
                try {
                    codeReaderRef.current.reset();
                    addDebugLog('扫描器已清理');
                } catch (e) {
                    console.warn('清理扫描器时出错:', e);
                }
            }
        };
    }, []);

    const handleManualInput = () => {
        const input = prompt('请手动输入条码:');
        if (input && input.trim()) {
            onScan(input.trim());
        }
    };

    if (error) {
        return (
            <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
                <div className="text-center mb-4">
                    <i className="fas fa-exclamation-triangle text-red-600 text-2xl mb-2"></i>
                    <p className="text-red-800 font-medium">扫描器启动失败</p>
                    <p className="text-red-700 text-sm mt-2">{error}</p>
                </div>
                
                <div className="space-y-2 text-sm text-red-700">
                    <p className="font-medium">解决方案:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>确保允许摄像头权限</li>
                        <li>检查摄像头是否被其他应用占用</li>
                        <li>刷新页面重新尝试</li>
                    </ul>
                </div>

                <button 
                    onClick={handleManualInput}
                    className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                    <i className="fas fa-keyboard mr-2"></i>
                    手动输入条码
                </button>

                {/* 调试信息 */}
                <div className="mt-4 p-3 bg-gray-100 rounded text-xs">
                    <p className="font-semibold mb-2">调试日志:</p>
                    <div className="max-h-32 overflow-y-auto">
                        {debugLog.map((log, index) => (
                            <div key={index} className="text-gray-600 mb-1">{log}</div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            <div className="relative bg-black rounded-lg overflow-hidden">
                {/* 状态显示 */}
                <div className="absolute top-4 left-4 right-4 z-10">
                    <div className="bg-black bg-opacity-70 text-white px-3 py-2 rounded-lg text-sm text-center">
                        <i className="fas fa-barcode mr-2"></i>
                        {status}
                    </div>
                </div>

                {/* 视频显示 - 移除镜像效果 */}
                <video 
                    ref={videoRef}
                    className="w-full h-64 object-cover"
                    playsInline
                    muted
                />

                {/* 扫描框 */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-80 h-32 border-2 border-green-400 rounded-lg relative">
                        {/* 四角标识 */}
                        <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-green-400"></div>
                        <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-green-400"></div>
                        <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-green-400"></div>
                        <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-green-400"></div>
                        
                        {/* 扫描线动画 - 只在扫描时显示 */}
                        {isScanning && (
                            <div className="absolute inset-x-0 top-1/2 transform -translate-y-1/2">
                                <div className="h-0.5 bg-green-400 animate-pulse shadow-lg"></div>
                            </div>
                        )}
                        
                        {/* 扫描框内提示 */}
                        <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-green-400 text-xs bg-black bg-opacity-50 px-2 py-1 rounded">
                                条码扫描区域
                            </span>
                        </div>
                    </div>
                </div>

                {/* 手动输入按钮 */}
                <div className="absolute bottom-4 left-4 right-4">
                    <button 
                        onClick={handleManualInput}
                        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                    >
                        <i className="fas fa-keyboard mr-2"></i>
                        手动输入条码
                    </button>
                </div>
            </div>

            {/* 简化的调试信息 */}
            <div className="mt-4 p-3 bg-green-50 rounded text-xs">
                <div className="flex justify-between items-center mb-2">
                    <p className="font-semibold text-green-800">HTTPS扫描器状态:</p>
                    <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                        {isScanning ? '运行中' : '初始化中'}
                    </span>
                </div>
                <div className="max-h-24 overflow-y-auto">
                    {debugLog.slice(-3).map((log, index) => (
                        <div key={index} className={`text-xs mb-1 ${
                            log.includes('✅') ? 'text-green-600' :
                            log.includes('❌') ? 'text-red-600' :
                            'text-gray-600'
                        }`}>
                            {log}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};