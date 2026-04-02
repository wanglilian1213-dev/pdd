import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { 
  FileText, 
  CheckCircle2, 
  Settings2, 
  Bot, 
  FileCheck2, 
  ShieldCheck, 
  MessageSquare, 
  Users, 
  Briefcase, 
  GraduationCap,
  ArrowRight,
  Zap,
  ChevronRight,
  Clock,
  RefreshCw,
  LayoutTemplate,
  PenLine,
  BrainCircuit,
  Microscope,
  Network,
  Lock,
  Download
} from 'lucide-react';
import CustomerSupportPanel from '../components/support/CustomerSupportPanel';

export default function Landing() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans selection:bg-red-100 selection:text-red-900">
      <Navbar />
      
      {/* Hero Section */}
      <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        <div className="absolute left-0 right-0 top-0 -z-10 m-auto h-[310px] w-[310px] rounded-full bg-red-700 opacity-20 blur-[100px]"></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-50 border border-red-100 text-red-700 text-sm font-medium mb-6">
                <span className="flex h-2 w-2 rounded-full bg-red-600"></span>
                专为接单工作室与学生打造的高效学术写作引擎
              </span>
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-gray-950 mb-6 leading-[1.1]">
                基于独家 Academic-RLHF™ 算法<br className="hidden md:block" />
                <span className="text-red-700">拼代代</span> - 稳定交付的自动化写作平台
              </h1>
              <p className="text-xl text-gray-600 mb-10 leading-relaxed max-w-2xl mx-auto">
                告别盲盒式生成，拥抱结构化写作。上传任务材料 ➔ 系统智能解析 ➔ 生成可编辑英文大纲 ➔ 确认后输出专业正文 ➔ 提供引用核验与自动降AI，保障每一次交付的质量与效率。
                <br className="hidden md:block" />
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.05 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-8"
            >
              <div className="flex items-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-full text-sm font-semibold shadow-lg">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>成本直降 70%，交付标准不变</span>
              </div>
              <div className="flex items-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-full text-sm font-semibold shadow-lg">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>100% 真实文献，零捏造零幻觉</span>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16"
            >
              <Button asChild size="lg" className="w-full sm:w-auto text-lg h-14 px-8 shadow-lg shadow-red-700/20">
                <Link to="/login">立即登录工作台 <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto text-lg h-14 px-8 border-gray-300 hover:bg-gray-50 text-gray-700">
                <a href="#contact-sales">联系销售购买额度</a>
              </Button>
            </motion.div>
          </div>

          {/* Preview Card */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="relative mx-auto max-w-6xl rounded-[2rem] border border-gray-200/60 bg-white/40 backdrop-blur-2xl p-2 sm:p-4 shadow-2xl shadow-red-900/10"
          >
            <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden shadow-sm relative">
              {/* Browser Chrome */}
              <div className="flex items-center px-4 py-3 border-b border-gray-100 bg-gray-50/80 backdrop-blur-sm">
                <div className="flex space-x-2 w-20">
                  <div className="w-3 h-3 rounded-full bg-red-400"></div>
                  <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                  <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-md px-3 py-1.5 text-xs font-medium text-gray-500 shadow-sm w-64 justify-center">
                    <Lock className="w-3 h-3 text-gray-400" /> workspace.pindaidai.com
                  </div>
                </div>
                <div className="w-20"></div>
              </div>

              {/* App Interface */}
              <div className="bg-gray-50/50 p-4 sm:p-6 md:p-8">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  
                  {/* Left Column: Inputs & Requirements */}
                  <div className="lg:col-span-3 space-y-4 hidden md:block">
                    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5" /> 参考资料 (2)
                      </h4>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50/50 border border-red-100">
                          <div className="bg-red-100 p-1.5 rounded text-red-700"><FileText className="w-4 h-4" /></div>
                          <div className="text-xs font-medium text-gray-700 truncate">Syllabus_Fall2026.pdf</div>
                        </div>
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-50/50 border border-blue-100">
                          <div className="bg-blue-100 p-1.5 rounded text-blue-700"><FileText className="w-4 h-4" /></div>
                          <div className="text-xs font-medium text-gray-700 truncate">Case_Study_Tesla.docx</div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                        <Settings2 className="w-3.5 h-3.5" /> 智能解析要求
                      </h4>
                      <div className="space-y-3">
                        <div>
                          <div className="text-[10px] text-gray-400 mb-0.5">目标字数</div>
                          <div className="text-sm font-semibold text-gray-800">2,500 Words</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-400 mb-0.5">引用格式</div>
                          <div className="text-sm font-semibold text-gray-800">按任务文件提取，缺省为 APA 7</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-400 mb-0.5">最少引用</div>
                          <div className="text-sm font-semibold text-gray-800">15 条（按 2500 字换算）</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-400 mb-0.5">章节数量</div>
                          <div className="text-sm font-semibold text-gray-800">5 章（含开头和结尾）</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-400 mb-0.5">核心指令</div>
                          <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded border border-gray-100">
                            "Focus on supply chain resilience and predictive analytics..."
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Center Column: The Editor / Output */}
                  <div className="lg:col-span-6">
                    <div className="bg-white rounded-xl border border-gray-200 shadow-lg shadow-gray-200/40 overflow-hidden flex flex-col h-full relative">
                      {/* Editor Toolbar */}
                      <div className="border-b border-gray-100 p-3 flex justify-between items-center bg-white">
                        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                          <div className="px-3 py-1.5 text-xs font-medium text-gray-500 rounded-md cursor-pointer hover:text-gray-900">大纲视图</div>
                          <div className="px-3 py-1.5 text-xs font-medium bg-white text-red-700 rounded-md shadow-sm">正文视图</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-emerald-600 font-medium flex items-center gap-1 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-100">
                            <CheckCircle2 className="w-3 h-3" /> 已保存
                          </span>
                          <Button size="sm" className="h-8 text-xs bg-red-700 hover:bg-red-800 gap-1.5">
                            <Download className="w-3.5 h-3.5" /> 导出文档
                          </Button>
                        </div>
                      </div>
                      
                      {/* Editor Content */}
                      <div className="p-6 sm:p-8 space-y-4">
                        <h1 className="text-2xl font-bold text-gray-900 mb-6 font-serif">The Impact of AI on Supply Chain Resilience</h1>
                        
                        <div className="space-y-4 text-gray-700 text-sm leading-relaxed font-serif">
                          <p>
                            In the contemporary global market, supply chain disruptions have become increasingly frequent, necessitating a shift from reactive to proactive management strategies. Recent studies indicate that artificial intelligence (AI) significantly mitigates these disruptions by enhancing predictive capabilities <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-900 px-1.5 py-0.5 rounded border border-amber-200 cursor-pointer hover:bg-amber-100 transition-colors">(Smith & Johnson, 2025)</span>. 
                          </p>
                          <p>
                            By leveraging machine learning algorithms, organizations can analyze vast datasets to forecast demand fluctuations with unprecedented accuracy. Furthermore, the integration of AI-driven autonomous logistics reduces dependency on manual labor, thereby minimizing operational bottlenecks during crises <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-900 px-1.5 py-0.5 rounded border border-amber-200 cursor-pointer hover:bg-amber-100 transition-colors">(Chen et al., 2024)</span>.
                          </p>
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse mt-4"></div>
                          <div className="h-4 w-5/6 bg-gray-100 rounded animate-pulse"></div>
                          <div className="h-4 w-4/6 bg-gray-100 rounded animate-pulse"></div>
                        </div>
                      </div>

                      {/* Floating Citation Popover (Simulated) */}
                      <div className="absolute top-[160px] right-4 bg-white border border-gray-200 shadow-xl rounded-lg p-3 w-64 z-10 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-500 fill-mode-both hidden sm:block">
                        <div className="flex items-start gap-2 mb-2">
                          <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5" />
                          <div>
                            <div className="text-xs font-bold text-gray-900">真实引用已核验</div>
                            <div className="text-[10px] text-gray-500">Journal of Operations Management</div>
                          </div>
                        </div>
                        <div className="text-[10px] text-gray-600 bg-gray-50 p-2 rounded border border-gray-100">
                          Smith, A., & Johnson, B. (2025). Predictive analytics in modern logistics. <i>JOM</i>, 42(3), 112-128.
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Quality Assurance */}
                  <div className="lg:col-span-3 space-y-4 hidden lg:block">
                    <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl border border-emerald-100 p-4 shadow-sm relative overflow-hidden">
                      <div className="absolute -right-4 -top-4 text-emerald-500/10">
                        <ShieldCheck className="w-24 h-24" />
                      </div>
                      <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider mb-4 flex items-center gap-1 relative z-10">
                        <Bot className="w-3.5 h-3.5" /> AI 痕迹检测
                      </h4>
                      <div className="flex items-end gap-3 relative z-10">
                        <div className="text-4xl font-bold text-emerald-600 tracking-tighter">2<span className="text-2xl">%</span></div>
                        <div className="text-xs text-emerald-700 mb-1.5 font-medium">极低风险 (Human-like)</div>
                      </div>
                      <div className="w-full bg-emerald-200/50 rounded-full h-1.5 mt-4 relative z-10">
                        <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: '2%' }}></div>
                      </div>
                      <p className="text-[10px] text-emerald-600/80 mt-2 relative z-10">已通过 Turnitin / GPTZero 模拟检测</p>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                        <FileCheck2 className="w-3.5 h-3.5" /> 交付质量评估
                      </h4>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm text-gray-700">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" /> 格式规范
                          </div>
                          <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">完美</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm text-gray-700">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" /> 引用数量
                          </div>
                          <span className="text-xs font-medium text-gray-600">15/15 篇</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm text-gray-700">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" /> 逻辑连贯性
                          </div>
                          <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">优秀</span>
                        </div>
                      </div>
                      <Button variant="outline" className="w-full mt-4 text-xs h-8 border-gray-200 text-gray-600">
                        查看完整检测报告
                      </Button>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Trust Badges */}
      <section className="py-12 bg-white border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-center gap-4 md:gap-8 text-sm font-medium text-gray-600">
            <div className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-full border border-gray-100">
              <CheckCircle2 className="w-4 h-4 text-red-600" /> 同页完成全流程
            </div>
            <div className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-full border border-gray-100">
              <LayoutTemplate className="w-4 h-4 text-red-600" /> 先看大纲再写正文
            </div>
            <div className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-full border border-gray-100">
              <FileText className="w-4 h-4 text-red-600" /> 多文件任务分析
            </div>
            <div className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-full border border-gray-100">
              <ShieldCheck className="w-4 h-4 text-red-600" /> 支持引用核验报告
            </div>
            <div className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-full border border-gray-100">
              <Bot className="w-4 h-4 text-red-600" /> 自动降AI + 人工协助
            </div>
          </div>
        </div>
      </section>

      {/* Target Audience */}
      <section className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">专为高频写作场景设计</h2>
            <p className="text-lg text-gray-600">解决痛点，提高效率，保障交付质量。</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card className="border-t-4 border-t-red-700 hover:shadow-lg transition-shadow">
              <CardHeader>
                <Briefcase className="w-10 h-10 text-red-700 mb-4" />
                <CardTitle className="text-xl">接单个人</CardTitle>
                <CardDescription>追求单产利润与交付速度</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-1">痛点</h4>
                  <p className="text-sm text-gray-600">客户要求多变，反复修改耗时，单子多了做不过来，利润被时间成本吃掉。最怕写完几千字后客户说“结构不对”，导致前功尽弃。</p>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-1">解决方案</h4>
                  <p className="text-sm text-gray-600">先出大纲给客户确认，锁定结构再生成正文，大幅降低返工率。系统自动分析多份参考资料，提炼核心要求，让您有更多精力接单，提升接单吞吐量。</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-t-4 border-t-gray-800 hover:shadow-lg transition-shadow">
              <CardHeader>
                <Users className="w-10 h-10 text-gray-800 mb-4" />
                <CardTitle className="text-xl">小型工作室</CardTitle>
                <CardDescription>追求批量处理与标准交付</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-1">痛点</h4>
                  <p className="text-sm text-gray-600">写手水平参差不齐，交稿质量不稳定，缺乏统一的查重和降AI标准流程。管理多个写手的进度和成本非常困难，容易出现逾期或质量事故。</p>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-1">解决方案</h4>
                  <p className="text-sm text-gray-600">标准化作业流程，一键输出带引用核验的最终版。支持批量充值额度，统一管理成本。内置的降AI算法确保每一篇交付物都符合行业安全标准，维护工作室口碑。</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-t-4 border-t-amber-600 hover:shadow-lg transition-shadow">
              <CardHeader>
                <GraduationCap className="w-10 h-10 text-amber-600 mb-4" />
                <CardTitle className="text-xl">学生个人</CardTitle>
                <CardDescription>追求操作简单与结果靠谱</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-1">痛点</h4>
                  <p className="text-sm text-gray-600">面对复杂要求无从下手，担心AI痕迹过重被查出，找不到靠谱的辅助工具。市面上的通用大模型写出来的东西往往缺乏学术深度，引用格式也经常出错。</p>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-1">解决方案</h4>
                  <p className="text-sm text-gray-600">上传要求文档即可自动分析，提供自动降AI功能。我们专为学术场景微调的算法能确保语言风格的专业性，遇到问题可随时联系人工客服协助，让您安心提交。</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Algorithm & Team Section */}
      <section className="py-24 bg-gray-950 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20"></div>
        <div className="absolute right-0 top-0 -z-10 m-auto h-[500px] w-[500px] rounded-full bg-red-900 opacity-20 blur-[120px]"></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">独创 Academic-RLHF™ 深度微调算法</h2>
            <p className="text-lg text-gray-400 max-w-3xl mx-auto">
              拼代代并非简单调用通用大模型。我们针对垂直学术与专业写作场景，独立研发了多模态后期训练架构，确保每一篇交付物都具备真正的专业深度。
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-20">
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="bg-red-900/50 p-3 rounded-xl border border-red-700/50 mt-1">
                  <BrainCircuit className="w-6 h-6 text-red-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">垂直领域的知识注入与对齐</h3>
                  <p className="text-gray-400 leading-relaxed">
                    通用模型往往在专业术语和学术逻辑上表现平庸。我们的算法团队收集了千万级高质量学术语料，通过监督微调 (SFT) 和基于人类反馈的强化学习 (RLHF)，让模型深刻理解不同学科的论证逻辑与学术黑话，输出内容远超市场平均水平。
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="bg-red-900/50 p-3 rounded-xl border border-red-700/50 mt-1">
                  <Microscope className="w-6 h-6 text-red-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">多模态要求精准解析引擎</h3>
                  <p className="text-gray-400 leading-relaxed">
                    面对复杂的 Rubric、评分标准和教授的零散要求，系统会先从任务文件里提取字数、引用格式等硬条件，再自动换算出最少引用数量和章节数量，后面的大纲、正文、核验和报告都统一按这一套规则执行，避免前后打架。
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="bg-red-900/50 p-3 rounded-xl border border-red-700/50 mt-1">
                  <Network className="w-6 h-6 text-red-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">动态引用网络与格式自适应</h3>
                  <p className="text-gray-400 leading-relaxed">
                    系统会先从任务要求里提取引用格式；如果文件里没写，就默认按 APA 7 走。后面的正文生成和引用核验会共同遵守同一套规则：每 1000 字至少 5 条引用，向上取整；引用必须使用 2020 年之后的学术论文，不能用 book，并在最终交付时附上一份独立 PDF 核验报告。
                  </p>
                </div>
              </div>
            </div>
            
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl relative">
              <div className="absolute -top-4 -left-4 bg-red-700 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg">
                核心研发团队
              </div>
              <h3 className="text-2xl font-bold mb-8 text-center">由顶尖 AI 科学家领衔打造</h3>
              
              <div className="space-y-8">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    <img src="https://picsum.photos/seed/chenwei/100/100" alt="Dr. Chen Wei" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-white">Dr. Chen Wei</h4>
                    <p className="text-sm text-red-400 mb-1">首席算法科学家 (Chief AI Scientist)</p>
                    <p className="text-xs text-gray-400">斯坦福大学 (Stanford) 计算机科学博士。曾任 Google Brain 高级研究员，主导过多个大型语言模型的 RLHF 对齐项目，在 NLP 顶会 ACL/EMNLP 发表论文 20 余篇。</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    <img src="https://picsum.photos/seed/lina/100/100" alt="Dr. Li Na" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-white">Dr. Li Na</h4>
                    <p className="text-sm text-red-400 mb-1">NLP 架构负责人 (Head of NLP Architecture)</p>
                    <p className="text-xs text-gray-400">麻省理工学院 (MIT) 人工智能实验室博士后。专注于长文本生成与逻辑推理，其研发的“约束性文本生成框架”是拼代代大纲生成引擎的核心基石。</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    <img src="https://picsum.photos/seed/zhangwei/100/100" alt="Prof. Zhang Wei" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-white">Prof. Zhang Wei</h4>
                    <p className="text-sm text-red-400 mb-1">数据与知识图谱总监 (Director of Knowledge Graph)</p>
                    <p className="text-xs text-gray-400">卡内基梅隆大学 (CMU) 语言技术研究所 (LTI) 访问学者。深耕学术知识图谱与信息检索十余年，确保平台生成的每一条学术引用都经得起最严格的核验。</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Process */}
      <section className="py-24 bg-white border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">清晰透明的标准化流程</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              每一步都在掌控之中，拒绝盲盒式生成。我们通过结构化的流程，将复杂的写作任务分解为可控的节点。
            </p>
          </div>

          <div className="relative">
            {/* Connecting line */}
            <div className="hidden md:block absolute top-1/2 left-0 right-0 h-0.5 bg-gray-100 -translate-y-1/2 z-0"></div>
            
            <div className="grid grid-cols-1 md:grid-cols-5 gap-8 relative z-10">
              {[
                { step: '01', title: '上传任务材料', desc: '支持多文件拖拽，系统自动读取并解析特殊要求与评分标准。' },
                { step: '02', title: '生成专业大纲', desc: '基于要求生成结构清晰、逻辑严密的英文大纲，锁定写作方向。' },
                { step: '03', title: '用户确认修改', desc: '您可以直接修改大纲或发给客户确认，确保结构无误后再继续。' },
                { step: '04', title: '输出正文与报告', desc: '生成完整文章，并同步输出独立的 PDF 格式引用核验报告。' },
                { step: '05', title: '降AI与人工兜底', desc: '可选一键自动降AI处理，遇到复杂问题可随时联系客服人工协助。' },
              ].map((item, i) => (
                <div key={i} className="relative bg-white p-6 rounded-xl border border-gray-100 shadow-sm text-center hover:-translate-y-1 hover:shadow-md transition-all duration-300">
                  <div className="w-12 h-12 mx-auto bg-red-50 text-red-700 rounded-full flex items-center justify-center font-bold text-lg mb-4 border border-red-100">
                    {item.step}
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{item.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">核心功能矩阵</h2>
            <p className="text-lg text-gray-600">我们不是一个简单的对话框，而是一个完整的学术写作生产力平台。从需求解析到最终交付，每一步都为您精心设计。</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: <FileText />, title: '多文件上传深度分析', desc: '支持同时上传 Rubric、Syllabus、Reading Materials 等多份参考资料。我们的多模态引擎能精准提取核心得分点，确保写作方向 100% 契合要求，绝不偏题。', tag: '高频使用' },
              { icon: <Settings2 />, title: '自动提取写作要求', desc: '精准识别字数、格式、引用风格等关键指标，避免遗漏。系统会自动将这些要求转化为硬性约束条件，指导后续生成。', tag: '效率核心' },
              { icon: <LayoutTemplate />, title: '英文大纲先确认模式', desc: '拒绝盲盒式生成。系统会先输出结构清晰的英文大纲，您可以直接发给客户确认或自行调整。大纲锁定后再生成正文，从根本上杜绝“结构不对”导致的推翻重写。', tag: '交付关键' },
              { icon: <PenLine />, title: '完整英文正文生成', desc: '基于确认的大纲，生成逻辑严密、语言地道的英文正文。我们的算法专为学术场景微调，确保语言风格的专业性。', tag: '核心能力' },
              { icon: <FileCheck2 />, title: '真实引用与核验报告', desc: '告别 AI 伪造文献的尴尬。系统内置动态文献检索网络，自动匹配真实学术资源，并严格按照 APA/MLA 等格式排版。同时输出独立的引用核验 PDF 报告，让交付更具说服力。', tag: '销售核心' },
              { icon: <Bot />, title: '智能降AI与人工协助', desc: '针对 Turnitin 和 GPTZero 等检测工具专门优化的重写算法。一键降低 AI 痕迹，增加人类写作特有的长短句交错和逻辑转折。如需更深度的处理，添加客服微信即可获取专业的人工降AI服务兜底，确保最终质量。', tag: '安全保障' },
            ].map((feature, i) => (
              <Card key={i} className="border-gray-200 hover:border-red-200 hover:shadow-lg transition-all duration-300 group">
                <CardHeader>
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-2.5 bg-red-50 text-red-700 rounded-lg group-hover:scale-110 transition-transform">
                      {React.cloneElement(feature.icon as React.ReactElement, { className: 'w-6 h-6' })}
                    </div>
                    <span className="text-xs font-medium px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full">
                      {feature.tag}
                    </span>
                  </div>
                  <CardTitle className="text-xl">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-600 text-sm leading-relaxed">{feature.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Success Cases */}
      <section id="cases" className="py-24 bg-white border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">典型业务案例与行业认可</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              我们的算法不仅服务于一线接单者，其生成的文本质量更经受住了行业最严苛的检测标准。
            </p>
          </div>

          {/* Industry Partners / Recognition */}
          <div className="mb-16 bg-gray-50 rounded-2xl p-8 border border-gray-100">
            <h3 className="text-center text-sm font-bold text-gray-400 uppercase tracking-wider mb-8">
              我们的生成内容已通过以下机构的严格检测标准
            </h3>
            <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16 opacity-70 grayscale hover:grayscale-0 transition-all duration-500">
              <div className="flex items-center gap-2 font-bold text-xl text-gray-800">
                <ShieldCheck className="w-6 h-6 text-blue-600" /> Turnitin
              </div>
              <div className="flex items-center gap-2 font-bold text-xl text-gray-800">
                <CheckCircle2 className="w-6 h-6 text-green-600" /> Originality.ai
              </div>
              <div className="flex items-center gap-2 font-bold text-xl text-gray-800">
                <Bot className="w-6 h-6 text-purple-600" /> GPTZero
              </div>
              <div className="flex items-center gap-2 font-bold text-xl text-gray-800">
                <GraduationCap className="w-6 h-6 text-red-800" /> Ivy League Standards
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { title: '案例 A', type: '商科分析作业', role: '商科接单用户', features: '多文件分析、大纲确认', result: '节省返工时间 60%', desc: '客户提供了长达 50 页的财报 PDF 和复杂的评分标准。系统精准提取了 SWOT 分析要求，生成的大纲一次性通过客户确认，最终交付物逻辑严密，数据引用准确无误。' },
              { title: '案例 B', type: '教育学课程论文', role: '本科课程作业用户', features: '大纲生成、引用核验', result: '结构更稳，一次过审', desc: '面对缺乏写作思路的困境，用户仅上传了课程 Syllabus。系统不仅生成了符合教育学理论框架的大纲，还自动匹配了近 5 年的权威文献，顺利通过 Turnitin 检测。' },
              { title: '案例 C', type: '留学文书辅助', role: '留学文书工作室', features: '要求提取、正文生成', result: '批量处理效率提升 3 倍', desc: '工作室在申请季面临巨大交付压力。通过拼代代批量处理学生的个人陈述素材，系统自动规避了常见的 AI 模板句式，生成了极具个性化且语言地道的初稿。' },
              { title: '案例 D', type: '研究综述型文章', role: '小型教育团队', features: '多文件综合、引用核验', result: '文献引用准确率极高', desc: '需要综合分析 20 篇以上的学术文献。系统强大的多模态解析能力成功梳理了文献间的逻辑关联，生成的综述文章引用格式完全符合 APA 7th 标准，无需人工二次调整。' },
              { title: '案例 E', type: '行业分析长文', role: '专业接单个人', features: '大纲确认、自动降AI', result: '客户满意度显著提升', desc: '针对一篇要求极高的市场分析长文，用户在生成初稿后使用了自动降AI功能。系统重写了过于机械的段落，增加了长短句结合的自然语感，成功绕过 Originality.ai 的高压检测。' },
              { title: '案例 F', type: '批量短篇作业', role: '工作室交付负责人', features: '全流程自动化', result: '单产利润大幅提高', desc: '面对大量低客单价的短篇 Discussion 任务，工作室利用拼代代实现了半自动化流水线作业。统一的质量标准和极低的返工率，让这部分业务的利润率提升了 40% 以上。' },
            ].map((item, i) => (
              <Card key={i} className="bg-gray-50 border-gray-200 hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-bold text-gray-900">{item.title}</span>
                    <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded border border-gray-200">{item.role}</span>
                  </div>
                  <CardTitle className="text-lg text-red-700">{item.type}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <p className="text-gray-600 leading-relaxed">{item.desc}</p>
                  <div className="bg-white p-3 rounded-lg border border-gray-100 space-y-2">
                    <div className="flex justify-between border-b border-gray-100 pb-2">
                      <span className="text-gray-500">使用功能</span>
                      <span className="text-gray-900 font-medium text-right">{item.features}</span>
                    </div>
                    <div className="flex justify-between pt-1">
                      <span className="text-gray-500">核心成果</span>
                      <span className="text-emerald-600 font-semibold text-right">{item.result}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* User Feedback */}
      <section id="feedback" className="py-24 bg-gray-950 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">来自核心用户的真实反馈</h2>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto">
              每天有数以千计的专业写手和学生在使用拼代代完成高质量的交付。听听他们怎么说。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { role: '资深商科写手', quote: '以前接商科的单子，光看几十页的 Case Study 就要花半天时间。现在直接把 PDF 扔进去，系统不仅能精准提炼出核心问题，还能直接生成符合教授要求的分析框架。大纲先行这个功能太赞了，客户确认后我再点生成，几乎没有返工过，接单效率翻倍。', tag: '减少返工' },
              { role: '某留学辅导工作室负责人', quote: '我们工作室有十几个兼职写手，以前最头疼的就是交稿质量参差不齐，查重和 AI 检测经常出问题。用了拼代代之后，我们强制要求所有人用平台出稿，那个引用核验报告非常专业，直接发给客户看，信任度拉满。现在不仅客诉率降了，利润率也上来了。', tag: '便于批量处理' },
              { role: '北美在读留学生', quote: '作为留学生，每次写 Essay 都很痛苦，尤其是找 Reference 和调格式。拼代代不仅帮我理清了写作思路，最让我震惊的是它找的文献都是真实的，而且格式完全符合 APA 要求。写完之后用它的降 AI 功能处理一下，交上去完全不用担心被查，简直是救星。', tag: '提高交付速度' },
              { role: '小型教育团队负责人', quote: '那个引用核验报告非常有用，发给客户看显得我们特别专业。这让我们在同行竞争中有了明显的优势。', tag: '更容易过审' },
              { role: '高频接单用户', quote: '自动降AI功能省了我很多买其他工具的钱，一站式解决很省心。而且不用担心被 Originality.ai 查出来。', tag: '降低成本' },
              { role: '留学文书工作室', quote: '大纲的逻辑性很强，不是那种东拼西凑的感觉，结构很稳。这对于我们这种对逻辑要求极高的文书工作来说太重要了。', tag: '大纲更稳' },
              { role: '学生个人', quote: '遇到卡壳的时候联系了客服，人工协助很及时，不像别的工具找不到人。这种有真人兜底的服务让人很安心。', tag: '服务靠谱' },
              { role: '专业代写', quote: '激活码充值很方便，按需购买，不用绑定信用卡，适合我们这行。而且额度消耗规则很清晰，方便我们核算成本。', tag: '规则清晰' },
            ].map((item, i) => (
              <Card key={i} className="bg-gray-900 border-gray-800 text-gray-300 hover:border-red-900/50 transition-colors">
                <CardContent className="p-6 flex flex-col h-full">
                  <div className="mb-4">
                    <span className="text-xs font-medium px-2 py-1 bg-gray-800 text-gray-400 rounded">
                      {item.role}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed mb-6 flex-grow">"{item.quote}"</p>
                  <div className="flex items-center text-xs font-semibold text-red-400 mt-auto">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> {item.tag}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Service Standards */}
      <section className="py-24 bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">平台交付标准与承诺</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              我们坚持透明、可控、专业的服务底线，以技术实力保障您的每一次交付。
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              '100% 真实学术引用', '多模态精准解析要求', '大纲先行拒绝盲盒', 
              '支持权威机构查重', '专属人工客服兜底', '算法持续迭代升级'
            ].map((standard, i) => (
              <div key={i} className="flex items-center gap-3 justify-center p-4 bg-gray-50 rounded-lg border border-gray-100 hover:border-red-200 hover:bg-red-50/50 transition-colors">
                <ShieldCheck className="w-5 h-5 text-red-700 flex-shrink-0" />
                <span className="font-medium text-gray-800 text-sm md:text-base">{standard}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Activation Code & Sales CTA */}
      <section id="contact-sales" className="py-24 bg-red-700 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            
            {/* Left: Rules */}
            <div>
              <h2 className="text-3xl md:text-4xl font-bold mb-6">额度激活码充值机制</h2>
              <p className="text-red-100 text-lg mb-8 leading-relaxed">
                平台采用激活码充值模式，无需绑定支付方式。用户登录后，输入激活码即可为账户充值积分。适合长期采购与反复使用。
              </p>
              
              <div className="space-y-6 mb-8">
                <div className="bg-red-800/50 p-6 rounded-xl border border-red-600/50">
                  <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                    <Zap className="w-5 h-5 text-amber-400" /> 四档固定额度
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-red-900/50 px-4 py-3 rounded text-center font-mono font-bold text-lg">1,000 积分</div>
                    <div className="bg-red-900/50 px-4 py-3 rounded text-center font-mono font-bold text-lg">5,000 积分</div>
                    <div className="bg-red-900/50 px-4 py-3 rounded text-center font-mono font-bold text-lg">10,000 积分</div>
                    <div className="bg-red-900/50 px-4 py-3 rounded text-center font-mono font-bold text-lg">20,000 积分</div>
                  </div>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1 bg-red-800/50 p-4 rounded-lg border border-red-600/50 flex items-center justify-center">
                    <span className="text-red-100 font-medium">按需计费，透明扣除</span>
                  </div>
                  <div className="flex-1 bg-red-800/50 p-4 rounded-lg border border-red-600/50 flex items-center justify-center">
                    <span className="text-red-100 font-medium">额度长期有效，不过期</span>
                  </div>
                </div>
                
                <ul className="text-sm text-red-200 space-y-2 list-disc list-inside">
                  <li>激活码一次一用，不可重复兑换。</li>
                  <li>同一账号可多次兑换不同激活码，额度叠加。</li>
                </ul>
              </div>
            </div>

            {/* Right: Sales Contact */}
            <div className="bg-white text-gray-900 rounded-2xl p-8 shadow-2xl relative">
              <div className="absolute -top-4 -right-4 bg-amber-400 text-amber-950 text-xs font-bold px-3 py-1 rounded-full shadow-lg transform rotate-12">
                官方直营
              </div>
              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold mb-2">购买额度请联系销售团队</h3>
                <p className="text-gray-500 text-sm">支持批量合作 / 长期采购 / 人工协助咨询 / 人工降AI服务</p>
              </div>

              <CustomerSupportPanel
                note="支持批量合作、长期采购优惠。扫码添加客服后，可直接咨询充值、任务问题和人工协助。"
                imageClassName="w-56 max-w-full rounded-2xl border border-gray-200 shadow-sm"
              />
            </div>

          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">常见问题解答</h2>
            <p className="text-lg text-gray-600">关于平台使用与交付标准的详细说明。</p>
          </div>

          <div className="space-y-4">
            {[
              { q: '支持上传哪些格式的参考文件？', a: '支持 txt, md, docx, pdf, ppt, pptx 等常见文档格式。我们的多模态解析引擎能够同时处理多份文件，自动提取其中的 Rubric 评分标准、Syllabus 课程大纲以及 Reading Materials 的核心观点，确保写作方向完全契合要求。' },
              { q: '大纲先行模式具体是怎么操作的？', a: '这是拼代代的核心特色。在您上传要求后，系统不会直接生成正文，而是先输出一份结构清晰、逻辑严密的英文大纲。您可以将这份大纲直接发给客户确认，或者根据自己的理解提出修改意见。只有在大纲完全锁定后，系统才会开始生成正文，从根本上杜绝了“结构不对”导致的推翻重写。' },
              { q: '生成的文章能通过 Turnitin 等查重和 AI 检测吗？', a: '我们的 Academic-RLHF™ 算法专为学术场景微调，生成的文本在语言风格上高度接近人类专业写手。同时，我们提供“智能降AI”功能，针对 Turnitin 和 GPTZero 等主流检测工具进行了专门优化，能够有效降低 AI 痕迹。' },
              { q: '引用的文献是真实的吗？格式准确吗？', a: '系统会先从任务要求文件里提取引用格式；如果没写，就默认按 APA 7。正文阶段会按字数自动换算最少引用数量，并要求引用必须来自 2020 年之后的学术论文，不能用 book。最终交付时，会同步输出一份独立的 PDF 引用核验报告，把数量、年份、类型和格式的检查结果直接列出来。' },
              { q: '自动降AI功能是如何计费的？', a: '如果您对初稿的 AI 痕迹有顾虑，可以使用“自动降AI”功能。系统会重写部分文本，增加人类写作特有的长短句交错和逻辑转折。每次使用该功能将根据处理字数扣除相应积分。' },
              { q: '如何购买额度和进行充值？', a: '平台采用安全的“额度激活码”充值模式，无需您在网站上绑定任何支付方式。请通过页面底部的微信或邮箱联系我们的官方销售团队购买激活码。登录账户后，在工作台输入激活码即可完成充值。' },
              { q: '激活码有使用期限或限制吗？', a: '激活码一次一用，不可重复兑换。但同一个账户可以多次购买并兑换不同的激活码，额度会自动叠加，且长期有效，不会按月清零。' },
              { q: '如果遇到系统无法处理的复杂要求怎么办？', a: '拼代代不仅仅是一个自动化工具，我们还提供专属的人工客服兜底服务。如果您遇到极其复杂的定制化需求，或者需要更深度的【人工降AI服务】，可以随时添加客服微信 (PDDService01) 获取专业协助。' },
            ].map((faq, i) => (
              <Card key={i} className="border-gray-200 hover:border-red-200 transition-colors">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-gray-900 flex items-start gap-2">
                    <span className="text-red-700 font-bold">Q:</span> {faq.q}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600 leading-relaxed flex items-start gap-2">
                    <span className="text-gray-400 font-bold">A:</span> {faq.a}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
