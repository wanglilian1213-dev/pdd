import React from 'react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';

export default function ActivationRules() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <main className="flex-grow pt-32 pb-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 md:p-12">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">激活码使用规则</h1>
            <div className="prose prose-red max-w-none text-gray-600 space-y-6">
              <p>欢迎使用拼代代平台。为了保障您的权益，请在购买和使用额度激活码前，仔细阅读以下规则：</p>
              
              <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-4">1. 激活码的获取与面值</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li>本平台的额度激活码仅通过官方销售渠道（微信：PDDService01）出售，请勿通过第三方非官方渠道购买，以免造成财产损失。</li>
                <li>激活码分为四档固定额度：1,000 积分、5,000 积分、10,000 积分、20,000 积分。</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-4">2. 兑换与使用</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li>激活码为 16 位字母与数字组合，请在登录后的【工作台 - 充值中心】页面进行兑换。</li>
                <li>每个激活码仅限兑换一次，兑换成功后即刻失效，不可重复使用。</li>
                <li>同一账号可多次兑换不同的激活码，账户内的积分额度将自动累加。</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-4">3. 有效期与退款政策</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>长期有效：</strong> 兑换到账户内的积分额度长期有效，没有使用期限限制，不会按月清零。</li>
                <li><strong>不予退款：</strong> 激活码属于数字化虚拟商品，一经售出或兑换，不支持退换货或折现。</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-4">4. 违规处理</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li>严禁利用系统漏洞、外挂等非法手段获取或兑换激活码。</li>
                <li>严禁在未经官方授权的情况下，倒卖、转售激活码。</li>
                <li>如发现上述违规行为，平台有权冻结相关账号、清零违规获取的积分，并保留追究法律责任的权利。</li>
              </ul>

              <div className="mt-12 p-4 bg-red-50 rounded-lg border border-red-100 text-sm text-red-800">
                如果您在兑换过程中遇到任何问题，请及时联系客服邮箱：1318823634@qq.com 或添加客服微信：PDDService01 获取帮助。
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
