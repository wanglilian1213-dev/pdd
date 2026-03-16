import { Link } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { PenLine, ArrowLeft, MessageSquare } from 'lucide-react';

export default function Register() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link to="/" className="flex items-center justify-center gap-2 mb-8">
          <div className="bg-red-700 p-2 rounded-xl shadow-sm">
            <PenLine className="h-6 w-6 text-white" />
          </div>
          <span className="font-bold text-2xl tracking-tight text-gray-900">拼代代</span>
        </Link>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Card className="border-gray-200 shadow-xl shadow-gray-200/50">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl font-bold tracking-tight">注册新账号</CardTitle>
            <CardDescription className="text-gray-500">
              创建您的长期可用账号
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-gray-900">
                  邮箱地址
                </label>
                <Input id="email" type="email" placeholder="name@example.com" required />
              </div>
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-gray-900">
                  设置密码
                </label>
                <Input id="password" type="password" required />
              </div>
              <div className="space-y-2">
                <label htmlFor="confirm-password" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-gray-900">
                  确认密码
                </label>
                <Input id="confirm-password" type="password" required />
              </div>
              <Button type="button" className="w-full h-11 text-base shadow-sm" asChild>
                <Link to="/login">注册并登录</Link>
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <div className="text-sm text-center text-gray-500">
              已有账号？{' '}
              <Link to="/login" className="font-semibold text-red-700 hover:text-red-600">
                直接登录
              </Link>
            </div>
            
            <div className="relative w-full">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-2 text-gray-500">遇到问题？</span>
              </div>
            </div>
            
            <div className="flex justify-center gap-4">
              <Link to="/" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-900">
                <ArrowLeft className="mr-2 h-4 w-4" /> 返回首页
              </Link>
              <a href="#" className="inline-flex items-center text-sm text-gray-500 hover:text-green-600">
                <MessageSquare className="mr-2 h-4 w-4" /> 联系客服
              </a>
            </div>
          </CardFooter>
        </Card>
        
        <p className="text-center text-xs text-gray-500 mt-8">
          注册成功后，即可使用“额度激活码”充值积分
        </p>
      </div>
    </div>
  );
}
