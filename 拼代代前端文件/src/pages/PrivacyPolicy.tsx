import React from 'react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <main className="flex-grow pt-32 pb-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 md:p-12">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">隐私政策</h1>
            <div className="prose prose-red max-w-none text-gray-600 space-y-6">
              <p>生效日期：2026年3月15日</p>
              <p>拼代代（以下简称“我们”或“本平台”）非常重视用户的隐私和个人信息保护。本隐私政策旨在向您说明我们如何收集、使用、存储和保护您的个人信息。</p>

              <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-4">1. 我们收集的信息</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>账号信息：</strong> 当您注册账号时，我们会收集您的邮箱地址和密码（加密存储）。</li>
                <li><strong>上传的文档与数据：</strong> 当您使用智能写作功能时，我们会收集您上传的参考文件（如 PDF、Word 等）以及您输入的写作要求和指令。</li>
                <li><strong>使用记录：</strong> 我们会记录您的积分消耗历史、生成的文章记录以及操作日志，以便为您提供历史记录查询服务。</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-4">2. 信息的处理与使用</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>核心服务：</strong> 您上传的文档和要求仅用于当前任务的 AI 解析和文章生成。我们使用先进的加密传输技术保障数据在传输过程中的安全。</li>
                <li><strong>数据隔离：</strong> 您的任务数据与账号严格绑定，其他用户无法访问。</li>
                <li><strong>不用于模型训练：</strong> 我们承诺，未经您明确授权，绝不会将您上传的私人文档或生成的文章用于公开大模型的训练。</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-4">3. 信息的存储与保护</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li>我们采用行业标准的安全技术措施（如 SSL/TLS 加密、数据库加密等）来防止您的信息遭到未经授权的访问、泄露、篡改或丢失。</li>
                <li>您的数据存储在安全的云服务器中，并设有严格的访问控制机制。</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-4">4. 信息的共享与披露</h3>
              <p>我们不会向任何第三方出售、交易或无偿提供您的个人信息和上传的文档，除非：</p>
              <ul className="list-disc pl-5 space-y-2">
                <li>事先获得您的明确同意。</li>
                <li>根据法律法规、司法机关或行政机关的强制性要求。</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-4">5. 联系我们</h3>
              <p>如果您对本隐私政策有任何疑问或建议，请联系客服邮箱：1318823634@qq.com 或添加客服微信：PDDService01。</p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
