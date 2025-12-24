import React, { useState, useEffect } from 'react';
import { supabase } from '../constants';

interface Staff {
    id: number;
    name: string;
    role: string;
    phone?: string;
    status: 'active' | 'inactive';
    created_at: string;
}

interface StaffManagementProps {
    showToast: (message: string, type?: 'success' | 'danger' | 'warning') => void;
}

const StaffManagement: React.FC<StaffManagementProps> = ({ showToast }) => {
    const [staffList, setStaffList] = useState<Staff[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
    
    const [formData, setFormData] = useState({
        name: '',
        role: '',
        phone: '',
        status: 'active' as 'active' | 'inactive'
    });

    const roles = [
        { value: '店长', label: '👨‍💼 店长', color: 'bg-purple-100 text-purple-800' },
        { value: '收银员', label: '👩‍💼 收银员', color: 'bg-blue-100 text-blue-800' },
        { value: '仓库管理员', label: '📦 仓库管理员', color: 'bg-green-100 text-green-800' },
        { value: '临时工', label: '👤 临时工', color: 'bg-gray-100 text-gray-800' }
    ];

    // 加载员工列表
    useEffect(() => {
        loadStaff();
    }, []);

    const loadStaff = async () => {
        try {
            const { data, error } = await supabase
                .from('staff')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setStaffList(data || []);
        } catch (error: any) {
            showToast(`加载员工列表失败: ${error.message}`, 'danger');
        } finally {
            setIsLoading(false);
        }
    };

    // 重置表单
    const resetForm = () => {
        setFormData({ name: '', role: '', phone: '', status: 'active' });
        setShowAddForm(false);
        setEditingStaff(null);
    };

    // 添加或更新员工
    const handleSaveStaff = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!formData.name.trim()) {
            showToast('请输入员工姓名', 'warning');
            return;
        }
        
        if (!formData.role) {
            showToast('请选择员工职位', 'warning');
            return;
        }

        try {
            if (editingStaff) {
                // 更新员工
                const { error } = await supabase
                    .from('staff')
                    .update({
                        name: formData.name.trim(),
                        role: formData.role,
                        phone: formData.phone.trim() || null,
                        status: formData.status
                    })
                    .eq('id', editingStaff.id);

                if (error) throw error;
                showToast(`员工 ${formData.name} 更新成功`, 'success');
            } else {
                // 添加员工
                const { error } = await supabase
                    .from('staff')
                    .insert([{
                        name: formData.name.trim(),
                        role: formData.role,
                        phone: formData.phone.trim() || null,
                        status: formData.status
                    }]);

                if (error) throw error;
                showToast(`员工 ${formData.name} 添加成功`, 'success');
            }

            resetForm();
            loadStaff();
        } catch (error: any) {
            showToast(`操作失败: ${error.message}`, 'danger');
        }
    };

    // 编辑员工
    const handleEditStaff = (staff: Staff) => {
        setFormData({
            name: staff.name,
            role: staff.role,
            phone: staff.phone || '',
            status: staff.status
        });
        setEditingStaff(staff);
        setShowAddForm(true);
    };

    // 删除员工
    const handleDeleteStaff = async (staff: Staff) => {
        if (!window.confirm(`确定要删除员工 ${staff.name} 吗？`)) return;

        try {
            const { error } = await supabase
                .from('staff')
                .delete()
                .eq('id', staff.id);

            if (error) throw error;
            showToast(`员工 ${staff.name} 已删除`, 'success');
            loadStaff();
        } catch (error: any) {
            showToast(`删除失败: ${error.message}`, 'danger');
        }
    };

    // 获取职位样式
    const getRoleStyle = (role: string) => {
        const roleConfig = roles.find(r => r.value === role);
        return roleConfig?.color || 'bg-gray-100 text-gray-800';
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-8">
                <i className="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
                <span className="ml-2 text-gray-600">加载员工列表中...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* 头部 */}
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">
                    <i className="fas fa-users mr-3 text-blue-600"></i>
                    员工管理
                </h2>
                <button
                    onClick={() => setShowAddForm(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium"
                >
                    <i className="fas fa-plus mr-2"></i>
                    添加员工
                </button>
            </div>

            {/* 员工列表 */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
                {staffList.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <i className="fas fa-users text-4xl mb-3 block text-gray-400"></i>
                        <p>还没有员工记录</p>
                        <p className="text-sm">点击"添加员工"开始管理员工信息</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">姓名</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">职位</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">联系电话</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">状态</th>
                                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">添加时间</th>
                                    <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {staffList.map((staff) => (
                                    <tr key={staff.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3 font-medium text-gray-900">
                                            {staff.name}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getRoleStyle(staff.role)}`}>
                                                {roles.find(r => r.value === staff.role)?.label || staff.role}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-600">
                                            {staff.phone || '-'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                                staff.status === 'active' 
                                                    ? 'bg-green-100 text-green-800' 
                                                    : 'bg-red-100 text-red-800'
                                            }`}>
                                                {staff.status === 'active' ? '在职' : '离职'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-600 text-sm">
                                            {new Date(staff.created_at).toLocaleDateString()}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-center space-x-2">
                                                <button
                                                    onClick={() => handleEditStaff(staff)}
                                                    className="text-blue-600 hover:text-blue-800 p-1"
                                                    title="编辑"
                                                >
                                                    <i className="fas fa-edit"></i>
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteStaff(staff)}
                                                    className="text-red-600 hover:text-red-800 p-1"
                                                    title="删除"
                                                >
                                                    <i className="fas fa-trash"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* 添加/编辑员工弹窗 */}
            {showAddForm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg p-6 w-full max-w-md">
                        <h3 className="text-lg font-bold mb-4">
                            {editingStaff ? '编辑员工' : '添加员工'}
                        </h3>
                        
                        <form onSubmit={handleSaveStaff} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    姓名 <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="输入员工姓名"
                                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    职位 <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={formData.role}
                                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                >
                                    <option value="">请选择职位</option>
                                    {roles.map((role) => (
                                        <option key={role.value} value={role.value}>
                                            {role.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    联系电话
                                </label>
                                <input
                                    type="text"
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    placeholder="输入联系电话（可选）"
                                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    状态
                                </label>
                                <select
                                    value={formData.status}
                                    onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}
                                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                >
                                    <option value="active">在职</option>
                                    <option value="inactive">离职</option>
                                </select>
                            </div>

                            <div className="flex space-x-3 pt-4">
                                <button
                                    type="button"
                                    onClick={resetForm}
                                    className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 py-2 px-4 rounded-lg font-medium"
                                >
                                    取消
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg font-medium"
                                >
                                    {editingStaff ? '更新' : '添加'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StaffManagement;