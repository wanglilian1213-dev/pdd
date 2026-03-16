import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Wallet, QrCode, MessageSquare, Zap, CheckCircle2, History, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useBalance } from '../../contexts/BalanceContext';
import { formatDate } from '../../lib/utils';

interface HistoryRecord {
  id: string;
  type: 'recharge' | 'consume' | 'refund';
  amount: number;
  balance_after: number;
  note: string;
  created_at: string;
}

function getRecordDisplay(record: HistoryRecord): { label: string; colorClass: string; displayAmount: string } {
  switch (record.type) {
    case 'recharge':
      return {
        label: record.note || '激活码充值',
        colorClass: 'text-emerald-600',
        displayAmount: `+${record.amount}`,
      };
    case 'consume':
      return {
        label: record.note || '积分扣除',
        colorClass: 'text-gray-900',
        displayAmount: `${record.amount}`,  // amount is already negative from backend
      };
    case 'refund':
      return {
        label: record.note || '退款',
        colorClass: 'text-amber-600',
        displayAmount: `+${record.amount}`,
      };
    default:
      return {
        label: record.note || '其他',
        colorClass: 'text-gray-900',
        displayAmount: String(record.amount),
      };
  }
}

export default function Recharge() {
  const { balance, refreshBalance } = useBalance();
  const [code, setCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [redeemSuccess, setRedeemSuccess] = useState(false);
  const [redeemDenomination, setRedeemDenomination] = useState(0);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [redeemError, setRedeemError] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [, historyData] = await Promise.all([
        refreshBalance(),
        api.getRechargeHistory(20, 0),
      ]);
      setHistory(historyData.records ?? []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '加载数据失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRedeem = async () => {
    if (!code.trim()) return;

    setIsRedeeming(true);
    setRedeemError('');
    setRedeemSuccess(false);

    try {
      const result = await api.redeemCode(code.trim());
      await refreshBalance();
      setRedeemDenomination(result.denomination);
      setRedeemSuccess(true);
      setCode('');

      // Refresh history to show the new record from backend
      const historyData = await api.getRechargeHistory(20, 0);
      setHistory(historyData.records ?? []);

      // Hide success message after 3 seconds
      setTimeout(() => {
        setRedeemSuccess(false);
      }, 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '兑换失败，请重试';
      setRedeemError(message);
      setTimeout(() => {
        setRedeemError('');
      }, 5000);
    } finally {
      setIsRedeeming(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        <span className="ml-3 text-gray-500">加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto flex flex-col items-center justify-center py-32 space-y-4">
        <p className="text-red-600">{error}</p>
        <Button variant="outline" onClick={fetchData}>重新加载</Button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">账户额度</h1>
        <p className="text-sm text-gray-500 mt-1">使用额度激活码充值积分，或联系销售团队购买。</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Balance & Recharge */}
        <div className="lg:col-span-2 space-y-8">
          {/* Balance Card */}
          <Card className="border-gray-200 shadow-sm bg-gradient-to-br from-red-700 to-red-900 text-white overflow-hidden relative">
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
            <CardContent className="p-8 relative z-10">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Wallet className="w-6 h-6 text-red-200" />
                  <span className="font-medium text-red-100">当前可用积分</span>
                </div>
                <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-medium text-red-100 border border-white/20">
                  长期有效
                </span>
              </div>
              <div className="text-5xl font-bold font-mono tracking-tight">
                {(balance ?? 0).toLocaleString()}
              </div>
              <div className="mt-6 pt-6 border-t border-red-600/50 flex flex-col sm:flex-row gap-4 sm:gap-6 text-sm text-red-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> 按需计费，透明扣除
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> 额度长期有效，不过期
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Activation Code Input */}
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="border-b border-gray-100 bg-gray-50/50">
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-500" /> 兑换激活码
              </CardTitle>
              <CardDescription>输入您购买的额度激活码，为账户充值积分。</CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="flex flex-col sm:flex-row gap-4">
                <Input
                  placeholder="请输入 16 位激活码 (例如: ABCD-1234-EFGH-5678)"
                  className="font-mono uppercase text-lg h-12"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={isRedeeming}
                />
                <Button
                  className="h-12 px-8 shadow-sm w-full sm:w-auto shrink-0"
                  onClick={handleRedeem}
                  disabled={isRedeeming || !code.trim()}
                >
                  {isRedeeming ? <Loader2 className="w-5 h-5 animate-spin" /> : '立即兑换'}
                </Button>
              </div>

              {redeemSuccess && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>兑换成功！已为您充值 {redeemDenomination.toLocaleString()} 积分。</span>
                </div>
              )}

              {redeemError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                  <span>{redeemError}</span>
                </div>
              )}

              <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600 space-y-2 border border-gray-100">
                <p className="font-medium text-gray-900 mb-1">兑换规则说明：</p>
                <ul className="list-disc list-inside space-y-1 ml-1">
                  <li>每个激活码仅限使用一次，兑换后即刻失效。</li>
                  <li>同一账号可多次兑换不同激活码，积分自动累加。</li>
                  <li>激活码包含 4 档固定额度：1000、3000、10000、20000 积分。</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* History */}
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="border-b border-gray-100 bg-gray-50/50 flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="w-5 h-5 text-gray-500" /> 最近记录
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-gray-500">查看全部</Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {history.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 text-sm">
                    暂无交易记录
                  </div>
                ) : (
                  history.map((record) => {
                    const display = getRecordDisplay(record);
                    return (
                      <div key={record.id} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{display.label}</p>
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{formatDate(record.created_at)}</p>
                        </div>
                        <div className={`font-mono font-bold ${display.colorClass}`}>
                          {display.displayAmount}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Sales Contact */}
        <div className="lg:col-span-1">
          <Card className="border-red-200 shadow-lg shadow-red-100 sticky top-24">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 to-red-700"></div>
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-xl">购买额度激活码</CardTitle>
              <CardDescription>请联系官方销售团队获取</CardDescription>
            </CardHeader>
            <CardContent className="p-6 flex flex-col items-center">
              <div className="w-48 h-48 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center mb-6 p-4">
                <QrCode className="w-12 h-12 text-gray-400 mb-2" />
                <span className="text-xs text-gray-500 text-center">微信二维码占位区<br/>请替换为真实二维码</span>
              </div>

              <div className="w-full bg-gray-50 rounded-lg p-4 border border-gray-100 mb-6 text-center">
                <div className="flex items-center justify-center gap-2 text-sm font-medium text-gray-600 mb-1">
                  <MessageSquare className="w-4 h-4 text-green-600" /> 官方微信号
                </div>
                <div className="font-mono font-bold text-lg text-gray-900 selection:bg-red-200">
                  PDDService01
                </div>
              </div>

              <div className="w-full space-y-3">
                <Button className="w-full shadow-sm">复制微信号</Button>
                <p className="text-xs text-center text-gray-500 leading-relaxed">
                  支持批量合作、长期采购优惠。<br/>添加客服获取专业【人工降AI服务】。
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
