import { Link } from 'react-router-dom';
import { PenLine } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-gray-950 text-gray-300 py-16 border-t border-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="col-span-1 md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-6">
              <div className="bg-red-700 p-1.5 rounded-lg">
                <PenLine className="h-5 w-5 text-white" />
              </div>
              <span className="font-bold text-xl tracking-tight text-white">拼代代</span>
            </Link>
            <p className="text-sm text-gray-400 leading-relaxed">
              专业的文章自动写作 SaaS 平台。为接单工作室和学生用户提供高效、稳定、可控的智能写作交付方案。
            </p>
          </div>
          
          <div>
            <h4 className="text-white font-semibold mb-4">页面导航</h4>
            <ul className="space-y-3 text-sm">
              <li><a href="#features" className="hover:text-red-400 transition-colors">功能介绍</a></li>
              <li><a href="#cases" className="hover:text-red-400 transition-colors">成功案例</a></li>
              <li><a href="#feedback" className="hover:text-red-400 transition-colors">用户反馈</a></li>
              <li><a href="#faq" className="hover:text-red-400 transition-colors">常见问题</a></li>
            </ul>
          </div>
          
          <div>
            <h4 className="text-white font-semibold mb-4">使用说明</h4>
            <ul className="space-y-3 text-sm">
              <li><Link to="/login" className="hover:text-red-400 transition-colors">登录账户</Link></li>
              <li><Link to="/register" className="hover:text-red-400 transition-colors">注册账户</Link></li>
              <li><Link to="/activation-rules" className="hover:text-red-400 transition-colors">激活码使用规则</Link></li>
              <li><a href="#contact-sales" className="hover:text-red-400 transition-colors">联系销售购买额度</a></li>
            </ul>
          </div>
          
          <div>
            <h4 className="text-white font-semibold mb-4">免责声明</h4>
            <p className="text-xs text-gray-500 leading-relaxed">
              本平台提供的自动写作服务仅供参考与辅助，用户需对最终生成内容的合法性、原创性及合规性负责。平台不对生成内容的最终使用结果承担法律责任。
            </p>
          </div>
        </div>
        
        <div className="mt-16 pt-8 border-t border-gray-900 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-gray-500">
            &copy; {new Date().getFullYear()} 拼代代. All rights reserved.
          </p>
          <div className="flex space-x-6 text-sm text-gray-500">
            <Link to="/privacy-policy" className="hover:text-white transition-colors">隐私政策</Link>
            <Link to="/terms-of-service" className="hover:text-white transition-colors">服务条款</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
