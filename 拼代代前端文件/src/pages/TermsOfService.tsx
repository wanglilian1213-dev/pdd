import React from 'react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <main className="flex-grow pt-32 pb-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 md:p-12">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">服务条款</h1>
            <div className="prose prose-red max-w-none text-gray-600 space-y-6">
              <p>欢迎使用拼代代平台。请在注册和使用本服务前，仔细阅读以下条款。使用本平台即表示您同意接受本条款的约束。</p>

              <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-4">1. 服务内容</h3>
              <p>拼代代是一个基于人工智能的自动化写作辅助平台，提供文档解析、大纲生成、正文生成、引用核验及 AI 降重等工具服务。</p>

              <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-4">2. 用户责任与合规使用</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li>您必须提供真实、准确的注册信息，并妥善保管您的账号和密码。</li>
                <li>您不得利用本平台生成违反国家法律法规、危害国家安全、散布谣言、淫秽色情或侵犯他人合法权益的内容。</li>
                <li><strong>学术诚信免责：</strong> 本平台提供的生成内容仅供学习、参考和辅助研究之用。用户需对最终提交或发布的内容的原创性、合规性及学术诚信负责。因使用本平台生成内容而导致的任何学术纠纷、版权争议或处罚，本平台概不负责。</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-4">3. 知识产权</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li>平台本身的系统架构、算法模型、界面设计及相关代码的知识产权归拼代代所有。</li>
                <li>您使用本平台生成的文章内容，在您合法合规使用的前提下，相关权益归您所有。</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-4">4. 服务变更、中断与终止</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li>我们保留在不事先通知的情况下，修改、升级或暂停部分服务功能的权利。</li>
                <li>如发现用户严重违反本条款（如恶意攻击系统、批量生成违规内容等），我们有权立即终止提供服务，并封禁账号。</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-4">5. 免责声明</h3>
              <p>人工智能生成技术具有一定的概率性和不可预测性。我们尽最大努力提升生成质量和准确性，但不保证生成内容完全无误、无遗漏或绝对满足您的特定主观期望。对于因使用本服务产生的任何间接、偶然或惩罚性损失，平台不承担赔偿责任。</p>

              <div className="mt-12 p-4 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-500">
                本条款的最终解释权归拼代代所有。如有疑问，请联系客服邮箱：1318823634@qq.com 或添加客服微信：PDDService01。
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
