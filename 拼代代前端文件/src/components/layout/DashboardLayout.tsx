import { Link, Outlet, useLocation } from 'react-router-dom';
import { PenLine, LayoutDashboard, ListTodo, Wallet, LogOut, User, Menu, X } from 'lucide-react';
import { useState } from 'react';

export default function DashboardLayout() {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navigation = [
    { name: '工作台', href: '/dashboard/workspace', icon: LayoutDashboard },
    { name: '我的任务', href: '/dashboard/tasks', icon: ListTodo },
    { name: '账户额度', href: '/dashboard/recharge', icon: Wallet },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden bg-white border-b border-gray-200 p-4 flex justify-between items-center sticky top-0 z-50">
        <Link to="/" className="flex items-center gap-2">
          <div className="bg-red-700 p-1.5 rounded-lg">
            <PenLine className="h-5 w-5 text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight text-gray-900">拼代代</span>
        </Link>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="text-gray-500 hover:text-gray-900">
          {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200 transform transition-transform duration-200 ease-in-out
        md:relative md:translate-x-0
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="h-full flex flex-col">
          <div className="h-16 flex items-center px-6 border-b border-gray-200 hidden md:flex">
            <Link to="/" className="flex items-center gap-2">
              <div className="bg-red-700 p-1.5 rounded-lg">
                <PenLine className="h-5 w-5 text-white" />
              </div>
              <span className="font-bold text-xl tracking-tight text-gray-900">拼代代</span>
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto py-6 px-4">
            <nav className="space-y-1">
              {navigation.map((item) => {
                const isActive = location.pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`
                      group flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-colors
                      ${isActive 
                        ? 'bg-red-50 text-red-700' 
                        : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'}
                    `}
                  >
                    <item.icon
                      className={`
                        flex-shrink-0 -ml-1 mr-3 h-5 w-5
                        ${isActive ? 'text-red-700' : 'text-gray-400 group-hover:text-gray-500'}
                      `}
                      aria-hidden="true"
                    />
                    <span className="truncate">{item.name}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="p-4 border-t border-gray-200">
            <div className="flex items-center gap-3 px-3 py-2 mb-2 rounded-md bg-gray-50">
              <div className="bg-red-100 text-red-700 p-1.5 rounded-full">
                <User className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">user@example.com</p>
                <p className="text-xs text-gray-500 truncate">积分余额: 12,500</p>
              </div>
            </div>
            <Link
              to="/login"
              className="group flex items-center px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
              <LogOut className="flex-shrink-0 -ml-1 mr-3 h-5 w-5 text-gray-400 group-hover:text-gray-500" />
              退出登录
            </Link>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto bg-gray-50 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
      
      {/* Mobile overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-gray-900/50 z-30 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </div>
  );
}
