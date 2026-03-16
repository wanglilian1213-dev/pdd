import { Link } from 'react-router-dom';
import { Button } from '../ui/button';
import { PenLine } from 'lucide-react';

export default function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <Link to="/" className="flex items-center gap-2">
              <div className="bg-red-700 p-1.5 rounded-lg">
                <PenLine className="h-5 w-5 text-white" />
              </div>
              <span className="font-bold text-xl tracking-tight text-gray-900">拼代代</span>
            </Link>
            <div className="hidden md:flex ml-10 space-x-8">
              <a href="#features" className="text-sm font-medium text-gray-600 hover:text-red-700 transition-colors">功能介绍</a>
              <a href="#cases" className="text-sm font-medium text-gray-600 hover:text-red-700 transition-colors">成功案例</a>
              <a href="#feedback" className="text-sm font-medium text-gray-600 hover:text-red-700 transition-colors">用户反馈</a>
              <a href="#faq" className="text-sm font-medium text-gray-600 hover:text-red-700 transition-colors">常见问题</a>
            </div>
          </div>
          <div className="flex items-center space-x-2 sm:space-x-4">
            <Link to="/login" className="hidden sm:block text-sm font-medium text-gray-600 hover:text-red-700 transition-colors">
              登录
            </Link>
            <Button asChild variant="default" className="shadow-sm text-xs sm:text-sm px-3 sm:px-4">
              <Link to="/dashboard">进入工作台</Link>
            </Button>
            <Button asChild variant="outline" className="hidden md:inline-flex border-red-200 text-red-700 hover:bg-red-50">
              <a href="#contact-sales">联系销售团队</a>
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
