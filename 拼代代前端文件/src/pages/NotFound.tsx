import { Link } from 'react-router-dom';
import { ArrowLeft, LayoutDashboard, SearchX, PenLine } from 'lucide-react';
import { Button } from '../components/ui/button';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto flex min-h-[80vh] max-w-3xl flex-col items-center justify-center rounded-3xl border border-gray-200 bg-white px-6 py-12 text-center shadow-xl shadow-gray-200/50">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-2xl bg-red-700 p-3 shadow-sm">
            <PenLine className="h-7 w-7 text-white" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-gray-900">拼代代</span>
        </div>

        <div className="mb-6 rounded-full bg-red-50 p-4 text-red-700">
          <SearchX className="h-10 w-10" />
        </div>

        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-red-700">404</p>
        <h1 className="mt-3 text-3xl font-bold text-gray-900">这个页面不存在</h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-gray-500">
          可能是网址输错了，或者你打开的是一个已经失效的旧链接。你可以回首页重新开始，或者直接进入工作台继续操作。
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="shadow-sm">
            <Link to="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回首页
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/dashboard/workspace">
              <LayoutDashboard className="mr-2 h-4 w-4" />
              进入工作台
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
