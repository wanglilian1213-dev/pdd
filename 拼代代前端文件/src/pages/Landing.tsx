/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 主页（Landing）— 2026-04-19 落地页重设计版本。
 *
 * 设计主线：
 * 1. 不直接叫卖"查不出 AI"；以 Academic-RLHF™ 独家算法作为主叙事，让"自然语感"成为算法导出的自然结果。
 * 2. 三根柱子：98 分自然语感（算法）/ 100% 真实学术文献（Crossref）/ 0 返工（大纲先行），过程承诺优先于质量承诺。
 * 3. 保留原有 anchor ID：#features / #cases / #feedback / #faq / #contact-sales，与 Navbar / Footer 固定联动。
 *
 * 样式依赖：
 * - Tailwind v4 原子类
 * - `src/index.css` 底部 Landing-only utilities（grid-bg / text-gradient-red / marquee / animate-landing-float 等）
 */

import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  Bot,
  BookOpen,
  BookOpenCheck,
  BrainCircuit,
  Briefcase,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Edit3,
  FileCheck2,
  FileText,
  GraduationCap,
  Infinity as InfinityIcon,
  LayoutTemplate,
  Link2,
  Lock,
  Mail,
  MessageCircle,
  Minus,
  PenLine,
  Play,
  Quote,
  RefreshCw,
  ScrollText,
  SearchCheck,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  UploadCloud,
  Users,
  X,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';
import CustomerSupportPanel from '../components/support/CustomerSupportPanel';

export default function Landing() {
  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans selection:bg-red-100 selection:text-red-900 antialiased">
      <Navbar />

      {/* ============== HERO ============== */}
      <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-28 overflow-hidden">
        <div className="absolute inset-0 grid-bg" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-red-600 opacity-[0.15] blur-[120px] rounded-full -z-10" />
        <div className="absolute top-40 right-10 w-[300px] h-[300px] bg-amber-500 opacity-[0.08] blur-[100px] rounded-full -z-10" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* 品牌小胶囊 */}
            <div className="flex justify-center mb-6">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-red-50 via-amber-50 to-red-50 border border-red-200 text-red-800 text-sm font-semibold shadow-sm">
                <Sparkles className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                <span>
                  由独家 <span className="font-black text-gray-900 tracking-tight">Academic-RLHF™</span> 算法驱动
                </span>
              </div>
            </div>

            {/* 大标题 */}
            <h1 className="text-center font-black tracking-tight text-gray-950 text-5xl md:text-7xl lg:text-[88px] leading-[0.95] mb-6">
              学术写作,
              <br className="md:hidden" />
              <span className="text-gradient-red">该有的样子。</span>
            </h1>

            {/* 副标题 */}
            <p className="text-center text-lg md:text-xl text-gray-600 max-w-3xl mx-auto mb-10 leading-relaxed">
              <span className="font-black text-gray-900">Academic-RLHF™</span> 深度对齐算法打磨的学术笔触,
              <span className="font-semibold text-gray-900">语感自然如亲笔</span>,
              <span className="font-semibold text-gray-900">文献真实可核验</span>,
              <span className="font-semibold text-gray-900">结构先行不走回头路</span>。
            </p>
          </motion.div>

          {/* 三根柱子 */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl mx-auto mb-10"
          >
            <div className="relative bg-white border border-gray-200 rounded-2xl p-6 pb-8 card-lift shadow-sm overflow-hidden">
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-red-500/5 rounded-full" />
              <div className="relative">
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-5xl font-black text-red-700 tabular-nums">98</span>
                  <span className="text-base font-bold text-red-700 ml-1">分</span>
                </div>
                <div className="text-sm font-bold text-gray-900 mb-1">自然语感</div>
                <div className="text-xs text-gray-500 leading-relaxed mb-3">
                  多轮算法复扫,笔触如人工反复斟酌
                </div>
                <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-100 rounded text-[10px] font-bold text-emerald-700 tracking-wider">
                  <BrainCircuit className="w-2.5 h-2.5" /> RLHF 对齐
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-emerald-400" />
            </div>

            <div className="relative bg-white border border-gray-200 rounded-2xl p-6 pb-8 card-lift shadow-sm overflow-hidden">
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-red-500/5 rounded-full" />
              <div className="relative">
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-5xl font-black text-red-700 tabular-nums">100</span>
                  <span className="text-2xl font-black text-red-700">%</span>
                </div>
                <div className="text-sm font-bold text-gray-900 mb-1">真实学术文献</div>
                <div className="text-xs text-gray-500 leading-relaxed mb-3">
                  接入 Crossref 核验,附独立 PDF 报告
                </div>
                <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 border border-red-100 rounded text-[10px] font-bold text-red-700 tracking-wider">
                  <SearchCheck className="w-2.5 h-2.5" /> Crossref 核验
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-red-600 to-red-500" />
            </div>

            <div className="relative bg-white border border-gray-200 rounded-2xl p-6 pb-8 card-lift shadow-sm overflow-hidden">
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-red-500/5 rounded-full" />
              <div className="relative">
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-5xl font-black text-red-700 tabular-nums">0</span>
                  <span className="text-base font-bold text-red-700 ml-1">返工</span>
                </div>
                <div className="text-sm font-bold text-gray-900 mb-1">大纲先行确认</div>
                <div className="text-xs text-gray-500 leading-relaxed mb-3">
                  结构锁定再落笔,不再推翻重写
                </div>
                <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-100 rounded text-[10px] font-bold text-amber-700 tracking-wider">
                  <LayoutTemplate className="w-2.5 h-2.5" /> Outline-First
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-amber-400" />
            </div>
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8"
          >
            <Link
              to="/login"
              className="inline-flex items-center gap-2 bg-red-700 hover:bg-red-800 text-white text-base font-bold px-7 py-4 rounded-xl shadow-lg shadow-red-700/30 transition-all hover:scale-[1.02]"
            >
              开启专业写作 <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="#how"
              className="inline-flex items-center gap-2 text-gray-700 hover:text-gray-900 text-base font-semibold px-4 py-3 group"
            >
              <span className="w-10 h-10 rounded-full border-2 border-gray-300 group-hover:border-red-700 flex items-center justify-center transition-colors">
                <Play className="w-4 h-4 fill-current" />
              </span>
              了解算法原理
            </a>
          </motion.div>

          {/* Social proof row */}
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-red-400 to-red-700 border-2 border-white" />
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-amber-700 border-2 border-white" />
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-700 border-2 border-white" />
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-700 border-2 border-white" />
              </div>
              <span>
                <strong className="text-gray-900">3,800+</strong> 专业写手 / 工作室在使用
              </span>
            </div>
            <div className="hidden sm:block w-px h-4 bg-gray-200" />
            <div className="flex items-center gap-1.5">
              <div className="flex text-amber-500">
                <Star className="w-4 h-4 fill-current" />
                <Star className="w-4 h-4 fill-current" />
                <Star className="w-4 h-4 fill-current" />
                <Star className="w-4 h-4 fill-current" />
                <Star className="w-4 h-4 fill-current" />
              </div>
              <span>
                <strong className="text-gray-900">4.9/5</strong> 用户满意度
              </span>
            </div>
            <div className="hidden sm:block w-px h-4 bg-gray-200" />
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>
                已处理 <strong className="text-gray-900">12 万+</strong> 任务
              </span>
            </div>
          </div>

          {/* Demo / Product preview */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mt-20 relative mx-auto max-w-6xl"
          >
            <div className="absolute -inset-4 bg-gradient-to-r from-red-600/20 via-amber-500/10 to-red-600/20 blur-2xl rounded-[3rem]" />
            <div className="relative rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-red-900/10 overflow-hidden">
              <div className="flex items-center px-4 py-3 border-b border-gray-100 bg-gray-50/80">
                <div className="flex space-x-2 w-24">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-amber-400" />
                  <div className="w-3 h-3 rounded-full bg-emerald-400" />
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-md px-3 py-1.5 text-xs font-medium text-gray-500 w-72 justify-center">
                    <Lock className="w-3 h-3" /> workspace.pindaidai.com
                  </div>
                </div>
                <div className="w-24" />
              </div>

              <div className="bg-gray-50/50 p-4 sm:p-6 md:p-8">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left: Files */}
                  <div className="lg:col-span-3 space-y-4 hidden md:block">
                    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                        <FileText className="w-3 h-3" /> 参考资料
                      </h4>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50/50 border border-red-100">
                          <div className="bg-red-100 p-1.5 rounded text-red-700">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="text-xs font-medium text-gray-700 truncate">
                            Rubric_Essay.pdf
                          </div>
                        </div>
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-50/50 border border-blue-100">
                          <div className="bg-blue-100 p-1.5 rounded text-blue-700">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="text-xs font-medium text-gray-700 truncate">
                            Syllabus.docx
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                        <Settings2 className="w-3 h-3" /> 智能解析
                      </h4>
                      <div className="space-y-3 text-xs">
                        <div>
                          <div className="text-[10px] text-gray-400 mb-0.5">目标字数</div>
                          <div className="font-semibold text-gray-800">2,500 Words</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-400 mb-0.5">引用格式</div>
                          <div className="font-semibold text-gray-800">APA 7</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-400 mb-0.5">最少引用</div>
                          <div className="font-semibold text-gray-800">15 条</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Center: Editor */}
                  <div className="lg:col-span-6">
                    <div className="bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden flex flex-col relative">
                      <div className="border-b border-gray-100 p-3 flex justify-between items-center">
                        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                          <div className="px-3 py-1.5 text-xs font-medium text-gray-500 rounded-md">
                            大纲
                          </div>
                          <div className="px-3 py-1.5 text-xs font-medium bg-white text-red-700 rounded-md shadow-sm">
                            正文
                          </div>
                        </div>
                        <span className="text-xs text-emerald-600 font-medium flex items-center gap-1 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-100">
                          <CheckCircle2 className="w-3 h-3" /> 已保存
                        </span>
                      </div>
                      <div className="p-6 sm:p-8 space-y-4">
                        <h2 className="text-2xl font-bold text-gray-900 mb-4 font-serif">
                          The Impact of AI on Supply Chain Resilience
                        </h2>
                        <div className="space-y-3 text-gray-700 text-sm leading-relaxed font-serif">
                          <p>
                            In the contemporary global market, supply chain disruptions have become
                            increasingly frequent, necessitating a shift from reactive to proactive
                            management strategies. Recent empirical evidence demonstrates that
                            artificial intelligence (AI) significantly mitigates these disruptions{' '}
                            <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-900 px-1.5 py-0.5 rounded border border-emerald-200 cursor-pointer hover:bg-emerald-100 transition-colors text-xs">
                              <ShieldCheck className="w-3 h-3" />
                              (Smith &amp; Johnson, 2025)
                            </span>
                            .
                          </p>
                          <p>
                            By leveraging machine learning algorithms, organizations can forecast
                            demand fluctuations with unprecedented accuracy{' '}
                            <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-900 px-1.5 py-0.5 rounded border border-emerald-200 cursor-pointer hover:bg-emerald-100 transition-colors text-xs">
                              <ShieldCheck className="w-3 h-3" />
                              (Chen et al., 2024)
                            </span>
                            .
                          </p>
                          <div className="h-3 w-full bg-gray-100 rounded animate-pulse" />
                          <div className="h-3 w-5/6 bg-gray-100 rounded animate-pulse" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right: QA */}
                  <div className="lg:col-span-3 space-y-4 hidden lg:block">
                    <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl border border-emerald-200 p-4 shadow-sm relative overflow-hidden">
                      <div className="absolute -right-4 -top-4 text-emerald-500/10">
                        <ShieldCheck className="w-24 h-24" />
                      </div>
                      <h4 className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider mb-3 flex items-center gap-1 relative">
                        <Sparkles className="w-3 h-3" /> 语感评分
                      </h4>
                      <div className="flex items-end gap-2 relative">
                        <div className="text-4xl font-black text-emerald-600 tracking-tighter">
                          98<span className="text-xl">分</span>
                        </div>
                        <div className="text-[10px] text-emerald-700 mb-1 font-semibold">
                          自然如亲笔
                        </div>
                      </div>
                      <div className="w-full bg-emerald-200/50 rounded-full h-1.5 mt-3 relative">
                        <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: '98%' }} />
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                        <FileCheck2 className="w-3 h-3" /> 交付检查
                      </h4>
                      <div className="space-y-2.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-700 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            格式规范
                          </span>
                          <span className="font-medium text-emerald-600">✓</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-700 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            引用数量
                          </span>
                          <span className="font-medium text-gray-600">15/15</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-700 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            文献核验
                          </span>
                          <span className="font-medium text-emerald-600">100%</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-700 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            学术语感
                          </span>
                          <span className="font-medium text-emerald-600">98</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ============== LOGO MARQUEE ============== */}
      <section className="py-10 border-y border-gray-100 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs font-bold text-gray-400 uppercase tracking-[0.2em] mb-6">
            服务于数千名专业写手、留学工作室与高校在读生
          </p>
          <div className="marquee">
            <div className="marquee-inner text-gray-400 font-semibold text-lg">
              <span className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5" />
                Ivy League 写作标准
              </span>
              <span className="flex items-center gap-2">
                <BookOpenCheck className="w-5 h-5" />
                APA 7 / MLA 9 / Chicago
              </span>
              <span className="flex items-center gap-2">
                <SearchCheck className="w-5 h-5" />
                Crossref 文献核验
              </span>
              <span className="flex items-center gap-2">
                <BrainCircuit className="w-5 h-5" />
                RLHF 深度对齐
              </span>
              <span className="flex items-center gap-2">
                <ScrollText className="w-5 h-5" />
                Harvard 引用风格
              </span>
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" />
                学术完整性合规
              </span>
              {/* duplicate for seamless loop */}
              <span className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5" />
                Ivy League 写作标准
              </span>
              <span className="flex items-center gap-2">
                <BookOpenCheck className="w-5 h-5" />
                APA 7 / MLA 9 / Chicago
              </span>
              <span className="flex items-center gap-2">
                <SearchCheck className="w-5 h-5" />
                Crossref 文献核验
              </span>
              <span className="flex items-center gap-2">
                <BrainCircuit className="w-5 h-5" />
                RLHF 深度对齐
              </span>
              <span className="flex items-center gap-2">
                <ScrollText className="w-5 h-5" />
                Harvard 引用风格
              </span>
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" />
                学术完整性合规
              </span>
            </div>
          </div>
        </div>
      </section>

      <WhySection />
      <ThreeClaimsSection />
      <HowSection />
      <TestimonialsSection />
      <AudienceSection />
      <FeaturesSection />
      <PricingSection />
      <FaqSection />
      <FinalCtaSection />
      <Footer />
    </div>
  );
}


/* ============================================================
 * Why Us — 对比表
 * ============================================================ */
function WhySection() {
  const rows = [
    {
      label: '语言自然度',
      hint: '学术笔触与长短句节奏',
      general: { icon: X, tone: 'red', text: '机械感明显' },
      basic: { icon: AlertTriangle, tone: 'amber', text: '节奏不稳' },
      us: '98 分如亲笔',
    },
    {
      label: '文献真实性',
      hint: '每条引用可核验',
      general: { icon: X, tone: 'red', text: '容易虚构' },
      basic: { icon: Minus, tone: 'gray', text: '不作保证' },
      us: '附核验报告',
    },
    {
      label: '按 Rubric 严谨生成',
      hint: '字数 / 格式 / 评分标准',
      general: { icon: AlertTriangle, tone: 'amber', text: '需反复调教' },
      basic: { icon: X, tone: 'red', text: '只做改写' },
      us: '多文件自动解析',
    },
    {
      label: '结构先行确认',
      hint: '大纲锁定再写正文',
      general: { icon: X, tone: 'red', text: '一把梭' },
      basic: { icon: X, tone: 'red', text: '无此概念' },
      us: '大纲先确认',
    },
    {
      label: '质量保障机制',
      hint: '失败场景自动退款',
      general: { icon: X, tone: 'red', text: '不退' },
      basic: { icon: X, tone: 'red', text: '不退' },
      us: '自动全额退',
    },
  ] as const;

  return (
    <section id="why" className="py-24 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-50 border border-red-100 text-red-700 text-xs font-bold uppercase tracking-wider mb-4">
            为什么选拼代代
          </div>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            为什么通用大模型<br className="md:hidden" />
            <span className="text-gradient-red">写不出学术稿?</span>
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            学术写作不是"把话讲清楚"这么简单。通用模型没有学术语料的深度对齐,
            <strong className="text-gray-900">Academic-RLHF™</strong> 就是为这一层差距而生。
          </p>
        </div>

        <div className="bg-white rounded-3xl border border-gray-200 shadow-xl overflow-hidden">
          <div className="grid grid-cols-4 bg-gray-50 border-b border-gray-200">
            <div className="p-5 md:p-6 text-xs md:text-sm font-semibold text-gray-500 uppercase tracking-wider flex items-center">
              对比项
            </div>
            <div className="p-5 md:p-6 text-center text-xs md:text-sm font-bold text-gray-600 border-l border-gray-200">
              <div className="flex flex-col items-center gap-1">
                <span>通用大模型</span>
                <span className="text-[10px] font-normal text-gray-400 tracking-wider">
                  GPT / Claude 等
                </span>
              </div>
            </div>
            <div className="p-5 md:p-6 text-center text-xs md:text-sm font-bold text-gray-600 border-l border-gray-200">
              <div className="flex flex-col items-center gap-1">
                <span>普通写作工具</span>
                <span className="text-[10px] font-normal text-gray-400 tracking-wider">
                  通用改写产品
                </span>
              </div>
            </div>
            <div className="p-5 md:p-6 text-center text-xs md:text-sm font-bold text-white bg-red-700 border-l border-red-700 relative">
              <div className="flex flex-col items-center gap-1">
                <span>拼代代</span>
                <span className="text-[10px] font-normal text-red-100 tracking-wider">
                  Academic-RLHF™ 驱动
                </span>
              </div>
            </div>
          </div>

          {rows.map((row, idx) => (
            <div
              key={row.label}
              className={`grid grid-cols-4 ${
                idx === rows.length - 1 ? '' : 'border-b border-gray-100'
              } hover:bg-gray-50/50 transition-colors`}
            >
              <div className="p-5 md:p-6">
                <div className="font-bold text-gray-900 text-sm md:text-base mb-1">{row.label}</div>
                <div className="text-xs text-gray-500">{row.hint}</div>
              </div>
              <ComparisonCell cell={row.general} />
              <ComparisonCell cell={row.basic} />
              <div className="p-5 md:p-6 text-center border-l border-gray-100 bg-red-50/30 flex flex-col items-center justify-center gap-1">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Check className="w-5 h-5 text-emerald-700" />
                </div>
                <span className="text-xs font-semibold text-emerald-700">{row.us}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

type ComparisonCellProps = {
  cell: {
    icon: typeof X;
    tone: 'red' | 'amber' | 'gray';
    text: string;
  };
};

function ComparisonCell({ cell }: ComparisonCellProps) {
  const Icon = cell.icon;
  const bgByTone = {
    red: 'bg-red-50',
    amber: 'bg-amber-50',
    gray: 'bg-gray-100',
  }[cell.tone];
  const textByTone = {
    red: 'text-red-600',
    amber: 'text-amber-600',
    gray: 'text-gray-500',
  }[cell.tone];
  return (
    <div className="p-5 md:p-6 text-center border-l border-gray-100 flex flex-col items-center justify-center gap-1">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${bgByTone}`}>
        <Icon className={`w-5 h-5 ${textByTone}`} />
      </div>
      <span className="text-xs text-gray-500">{cell.text}</span>
    </div>
  );
}


/* ============================================================
 * Three Claims — 算法特质深度区
 * ============================================================ */
function ThreeClaimsSection() {
  return (
    <section className="py-24 bg-gradient-to-b from-gray-50 to-white relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-50" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        {/* Claim 1: RLHF */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-32">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold uppercase tracking-wider mb-4">
              <BrainCircuit className="w-3.5 h-3.5" /> 算法特质 1 / 3
            </div>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-5 leading-tight">
              <span className="text-gradient-red">Academic-RLHF™</span>
              <br />
              对齐的专业笔触。
            </h2>
            <p className="text-lg text-gray-600 leading-relaxed mb-6">
              基于千万级学术语料的监督微调与人类反馈强化学习,模型深度理解学术论证逻辑、长短句节奏与专业术语的取舍。输出的每一段话,都像在图书馆斟酌过的样子。
            </p>
            <div className="space-y-3">
              <ClaimBullet title="多轮算法复扫" desc="语感未达标自动重写,直至稳定达到学术笔触标准" />
              <ClaimBullet title="学术节奏建模" desc="长短句交错,避免通用模型的机械倾向" />
              <ClaimBullet title="专业词汇校准" desc="保留学术严谨性,不会出现口语化滑坡" />
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-8 bg-gradient-to-br from-emerald-400/20 to-red-500/20 blur-3xl" />
            <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 p-8">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <BrainCircuit className="w-5 h-5 text-emerald-700" />
                  </div>
                  <div className="font-bold text-gray-900">算法打磨进度</div>
                </div>
                <span className="text-xs text-gray-500">多轮迭代</span>
              </div>
              <ProgressRow label="初稿 · 通用模型基线" value={13} score="13 分" color="red" />
              <ProgressRow label="算法对齐 · 第二轮" value={76} score="76 分" color="amber" />
              <ProgressRow
                label="节奏校准 · 达标放行 ✓"
                value={98}
                score="98 分"
                color="emerald"
                pulse
                emphasized
              />
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3 mt-6">
                <div className="w-12 h-12 rounded-full bg-emerald-600 flex items-center justify-center text-white">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <div className="font-bold text-emerald-900">学术笔触达标</div>
                  <div className="text-xs text-emerald-700">自然语感 · 放心交付</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Claim 2: Citation verification */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-32">
          <div className="order-2 lg:order-1 relative">
            <div className="absolute -inset-8 bg-gradient-to-br from-red-500/20 to-amber-400/20 blur-3xl" />
            <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                    <FileCheck2 className="w-5 h-5 text-red-700" />
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 text-sm">引用核验报告</div>
                    <div className="text-[10px] text-gray-500">
                      Citation_Verification_Report.pdf
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs font-semibold text-red-700 hover:text-red-800 flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> 下载
                </button>
              </div>
              <div className="space-y-3">
                <CitationItem
                  index="[1]"
                  text="Smith, A., & Johnson, B. (2025). Predictive analytics in modern logistics."
                  italic="JOM"
                  tail=", 42(3), 112-128."
                  year="2025"
                />
                <CitationItem
                  index="[2]"
                  text="Chen, L., Wang, H., & Park, S. (2024). AI-driven supply chain resilience."
                  italic="Nature Machine Intelligence"
                  tail=", 6(2), 445-460."
                  year="2024"
                />
                <CitationItem
                  index="[3]"
                  text="Martinez, R. et al. (2023). Machine learning for demand forecasting."
                  italic="Management Science"
                  tail=", 69(7), 3891-3910."
                  year="2023"
                />
                <div className="text-center text-xs text-gray-400 py-2">
                  ... 共 15 条引用,全部核验通过
                </div>
              </div>
              <div className="mt-4 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-lg p-3 flex items-center justify-between">
                <span className="text-sm font-bold text-emerald-800">核验结果:</span>
                <span className="text-sm font-black text-emerald-700">15/15 真实有效</span>
              </div>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-bold uppercase tracking-wider mb-4">
              <BookOpenCheck className="w-3.5 h-3.5" /> 算法特质 2 / 3
            </div>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-5 leading-tight">
              每一条文献,
              <br />都 <span className="text-gradient-red">有迹可循</span>。
            </h2>
            <p className="text-lg text-gray-600 leading-relaxed mb-6">
              系统接入 Crossref、Semantic Scholar 等权威学术网络,引用环节与检索环节实时联动——只从真实、可追溯的学术资源中取材。每次交付都附一份独立 PDF 核验报告,支持发给客户做复核。
            </p>
            <div className="grid grid-cols-2 gap-3">
              <StatCard big="100" suffix="%" label="引用可核验率" />
              <StatCard big="2020+" label="优先近 5 年文献" />
              <StatCard big="APA 7" label="默认格式(可切换)" />
              <StatCard big="PDF" label="独立核验报告" />
            </div>
          </div>
        </div>

        {/* Claim 3: Outline first */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold uppercase tracking-wider mb-4">
              <LayoutTemplate className="w-3.5 h-3.5" /> 算法特质 3 / 3
            </div>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-5 leading-tight">
              结构先行,
              <br />
              <span className="text-gradient-red">斟酌再落笔</span>。
            </h2>
            <p className="text-lg text-gray-600 leading-relaxed mb-6">
              专业的学术写作,从来不是一口气写完就交。系统先输出结构化英文大纲,供你或客户斟酌、调整、确认——结构定了,论证走向也就定了,后续的正文便能稳稳落在计划里。
            </p>
            <div className="space-y-3">
              <OutlineBullet
                icon={UploadCloud}
                title="自动解析 Rubric"
                desc="字数、评分标准、章节要求一次梳理"
              />
              <OutlineBullet
                icon={PenLine}
                title="大纲可直接编辑"
                desc="供本人斟酌,或发客户共同确认"
              />
              <OutlineBullet
                icon={FileText}
                title="结构确认后再展开"
                desc="论证稳稳落在计划里,少走弯路"
              />
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-8 bg-gradient-to-br from-amber-400/20 to-red-500/20 blur-3xl" />
            <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 font-serif">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="px-2 py-1 text-[10px] font-sans font-bold text-red-700 bg-red-50 rounded">
                    大纲视图
                  </div>
                  <span className="text-xs text-gray-500 font-sans">Draft v2 · 客户已确认</span>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-sans text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                  <Lock className="w-3 h-3" /> 已锁定
                </span>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-4">
                The Impact of AI on Supply Chain Resilience
              </h3>
              <div className="space-y-3 text-sm">
                <OutlineRow num="1. Introduction" hint="Background · Thesis statement · Scope" />
                <OutlineRow
                  num="2. Literature Review"
                  hint="AI in logistics · Resilience frameworks · Research gap"
                />
                <OutlineRow
                  num="3. Case Analysis: Predictive Analytics"
                  hint="Machine learning models · Demand forecasting · Real-world cases"
                />
                <OutlineRow
                  num="4. Autonomous Logistics & Risk Mitigation"
                  hint="Warehouse automation · Route optimization · Crisis response"
                />
                <OutlineRow
                  num="5. Conclusion"
                  hint="Key findings · Implications · Future research"
                />
              </div>
              <button
                type="button"
                className="mt-5 w-full bg-red-700 hover:bg-red-800 text-white font-sans text-sm font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                大纲已锁定,生成正文 <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ClaimBullet({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
        <Check className="w-4 h-4 text-emerald-700" />
      </div>
      <div>
        <div className="font-semibold text-gray-900">{title}</div>
        <div className="text-sm text-gray-500">{desc}</div>
      </div>
    </div>
  );
}

function ProgressRow({
  label,
  value,
  score,
  color,
  pulse,
  emphasized,
}: {
  label: string;
  value: number;
  score: string;
  color: 'red' | 'amber' | 'emerald';
  pulse?: boolean;
  emphasized?: boolean;
}) {
  const bar = {
    red: 'bg-red-500',
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
  }[color];
  const labelColor = emphasized ? 'text-emerald-700' : 'text-gray-500';
  const scoreColor = {
    red: 'text-red-600',
    amber: 'text-amber-600',
    emerald: 'text-emerald-700',
  }[color];
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex justify-between items-center mb-2">
        <span className={`text-xs font-semibold ${labelColor}`}>{label}</span>
        <span className={`text-xs font-bold ${scoreColor}`}>{score}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${bar} rounded-full ${pulse ? 'animate-landing-pulse-soft' : ''}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function CitationItem({
  index,
  text,
  italic,
  tail,
  year,
}: {
  index: string;
  text: string;
  italic: string;
  tail: string;
  year: string;
}) {
  return (
    <div className="border border-gray-100 rounded-lg p-3 hover:border-emerald-200 hover:bg-emerald-50/30 transition-colors">
      <div className="flex items-start justify-between mb-1">
        <span className="text-xs font-bold text-gray-700">{index}</span>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
          <Check className="w-2.5 h-2.5" /> 已核验
        </span>
      </div>
      <div className="text-xs font-serif text-gray-700 leading-relaxed mb-1">
        {text} <em>{italic}</em>
        {tail}
      </div>
      <div className="flex items-center gap-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <Calendar className="w-3 h-3" /> {year}
        </span>
        <span className="flex items-center gap-1">
          <BookOpen className="w-3 h-3" /> Article
        </span>
        <span className="flex items-center gap-1">
          <Link2 className="w-3 h-3" /> DOI 验证通过
        </span>
      </div>
    </div>
  );
}

function StatCard({ big, suffix, label }: { big: string; suffix?: string; label: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="text-3xl font-black text-gray-900 mb-1">
        {big}
        {suffix && <span className="text-lg">{suffix}</span>}
      </div>
      <div className="text-xs font-semibold text-gray-600">{label}</div>
    </div>
  );
}

function OutlineBullet({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof FileText;
  title: string;
  desc: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-3">
      <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5 text-red-700" />
      </div>
      <div>
        <div className="font-bold text-gray-900 text-sm">{title}</div>
        <div className="text-xs text-gray-500">{desc}</div>
      </div>
    </div>
  );
}

function OutlineRow({ num, hint }: { num: string; hint: string }) {
  return (
    <div className="border-l-2 border-red-700 pl-3 py-1">
      <div className="font-semibold text-gray-900">{num}</div>
      <div className="text-xs text-gray-500 font-sans">{hint}</div>
    </div>
  );
}


/* ============================================================
 * How it works — 3 步流程
 * ============================================================ */
function HowSection() {
  return (
    <section id="how" className="py-24 bg-gray-950 text-white relative overflow-hidden">
      <div className="absolute inset-0 dark-grid-bg" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-900 opacity-20 blur-[150px] rounded-full" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-900/40 border border-red-700/50 text-red-300 text-xs font-bold uppercase tracking-wider mb-4">
            如何工作
          </div>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            从 Rubric 到成稿,<br className="md:hidden" />
            <span className="text-red-400">3 步搞定</span>。
          </h2>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            流程透明,每一步都知道系统在干什么,拒绝黑盒。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          <div className="hidden md:block absolute top-16 left-[16%] right-[16%] h-px bg-gradient-to-r from-red-500/0 via-red-500/50 to-red-500/0 z-0" />

          <HowCard
            step="01"
            Icon={UploadCloud}
            title="上传任务材料"
            desc="把 Rubric、Syllabus、参考文献一次性拖进去,系统自动识别字数、格式、评分标准。"
          >
            <div className="bg-black/40 rounded-lg p-3 border border-gray-800">
              <HowFileLine name="Rubric_Essay.pdf" />
              <HowFileLine name="Syllabus.docx" />
            </div>
          </HowCard>

          <HowCard
            step="02"
            Icon={LayoutTemplate}
            title="确认英文大纲"
            desc="系统先出大纲,你/客户确认结构后,才进入正文阶段。锁定后不再返工。"
          >
            <div className="bg-black/40 rounded-lg p-3 border border-gray-800 space-y-1.5">
              <HowOutlineLine n={1} text="Introduction" />
              <HowOutlineLine n={2} text="Literature Review" />
              <HowOutlineLine n={3} text="Case Analysis" />
              <div className="text-[10px] text-gray-500 pl-6">...</div>
            </div>
          </HowCard>

          <HowCard
            step="03"
            Icon={Download}
            title="交付正文 + 报告"
            desc="正文经过 Academic-RLHF™ 算法多轮打磨,同步附上 PDF 引用核验报告,可直接交付。"
          >
            <div className="bg-black/40 rounded-lg p-3 border border-gray-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-red-400" />
                  Essay.docx
                </span>
                <span className="text-[10px] text-emerald-400">算法已打磨</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Citations.pdf
                </span>
                <span className="text-[10px] text-emerald-400">15/15 ✓</span>
              </div>
            </div>
          </HowCard>
        </div>
      </div>
    </section>
  );
}

function HowCard({
  step,
  Icon,
  title,
  desc,
  children,
}: {
  step: string;
  Icon: typeof UploadCloud;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <div className="relative z-10 bg-gray-900/60 backdrop-blur border border-gray-800 rounded-2xl p-6 card-lift">
      <div className="flex items-center justify-between mb-5">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center font-black text-xl shadow-lg shadow-red-900/50">
          {step}
        </div>
        <Icon className="w-8 h-8 text-red-400" />
      </div>
      <h3 className="text-xl font-bold mb-2">{title}</h3>
      <p className="text-sm text-gray-400 leading-relaxed mb-4">{desc}</p>
      {children}
    </div>
  );
}

function HowFileLine({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 mb-2 last:mb-0">
      <FileText className="w-3.5 h-3.5 text-red-400" />
      <span className="text-xs text-gray-300 font-mono">{name}</span>
      <span className="ml-auto text-[10px] text-emerald-400">✓ 已解析</span>
    </div>
  );
}

function HowOutlineLine({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-4 h-4 rounded bg-red-900/50 text-red-400 flex items-center justify-center text-[9px] font-bold">
        {n}
      </span>
      <span className="text-gray-300 font-serif">{text}</span>
    </div>
  );
}

/* ============================================================
 * Testimonials — 用户证言
 * ============================================================ */
function TestimonialsSection() {
  const cards = [
    {
      quote: '大纲先行这个功能太赞了。客户确认后我再点生成,几乎没有返工过。单产效率翻倍。',
      role: '资深商科写手',
      meta: '月接单 30+ 篇',
      gradient: 'from-amber-400 to-amber-700',
    },
    {
      quote:
        '作为留学生最怕的就是文献靠不住。拼代代找的引用全都能在谷歌学术和数据库里查到,APA 格式也工工整整,省下了我大量核对的时间。',
      role: '北美在读留学生',
      meta: '商科 Master',
      gradient: 'from-blue-400 to-blue-700',
    },
    {
      quote: '算法会自己做多轮打磨,不用我盯着。直到语感稳稳达到学术线才放行,很省心。',
      role: '高频接单用户',
      meta: '日均 5+ 任务',
      gradient: 'from-emerald-400 to-emerald-700',
    },
    {
      quote: '最喜欢的是流程明确。上传、看大纲、出正文、算法再打磨一轮,每一步都知道系统在干什么。',
      role: '学生个人用户',
      meta: '文科本科',
      gradient: 'from-purple-400 to-purple-700',
    },
    {
      quote: '激活码充值模式很方便,按需购买不绑卡。额度长期有效,适合我们这种要长期用的。',
      role: '专业代写',
      meta: '3 年从业经验',
      gradient: 'from-red-400 to-red-700',
    },
    {
      quote: '多文件分析能力惊艳。一次扔 5 个 PDF 进去,核心得分点全提炼出来,不偏题。',
      role: '小型教育团队',
      meta: '负责人',
      gradient: 'from-teal-400 to-teal-700',
    },
  ];

  return (
    <section id="feedback" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-50 border border-red-100 text-red-700 text-xs font-bold uppercase tracking-wider mb-4">
            用户反馈
          </div>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">同行怎么说?</h2>
          <p className="text-lg text-gray-600">真实用户的真实交付,不用我们吹。</p>
        </div>

        <div className="max-w-4xl mx-auto mb-10 relative">
          <div className="absolute -inset-4 bg-gradient-to-r from-red-600/10 to-amber-500/10 blur-2xl rounded-3xl" />
          <div className="relative bg-white border border-gray-200 rounded-3xl shadow-xl p-8 md:p-12">
            <Quote className="w-10 h-10 text-red-600/20 mb-4" />
            <p className="text-xl md:text-2xl font-serif text-gray-800 leading-relaxed mb-6">
              "最打动我们的是那份<strong className="text-red-700">引用核验报告</strong>——直接发给客户做复核,显得专业又透明。
              <strong className="text-red-700">Academic-RLHF™</strong> 写出来的语感是真的顺,客户反馈的修改意见明显少了一半。"
            </p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center text-white font-bold text-lg">
                  王
                </div>
                <div>
                  <div className="font-bold text-gray-900">王先生</div>
                  <div className="text-xs text-gray-500">某留学辅导工作室 · 负责人</div>
                </div>
              </div>
              <div className="flex text-amber-500">
                <Star className="w-5 h-5 fill-current" />
                <Star className="w-5 h-5 fill-current" />
                <Star className="w-5 h-5 fill-current" />
                <Star className="w-5 h-5 fill-current" />
                <Star className="w-5 h-5 fill-current" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cards.map((card) => (
            <div
              key={card.role + card.meta}
              className="bg-gray-50 border border-gray-100 rounded-2xl p-6 card-lift"
            >
              <div className="flex items-center gap-1 text-amber-500 mb-3">
                <Star className="w-4 h-4 fill-current" />
                <Star className="w-4 h-4 fill-current" />
                <Star className="w-4 h-4 fill-current" />
                <Star className="w-4 h-4 fill-current" />
                <Star className="w-4 h-4 fill-current" />
              </div>
              <p className="text-sm text-gray-700 leading-relaxed mb-5 font-serif">
                "{card.quote}"
              </p>
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${card.gradient}`} />
                <div>
                  <div className="text-xs font-bold text-gray-900">{card.role}</div>
                  <div className="text-[10px] text-gray-500">{card.meta}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}


/* ============================================================
 * Audience — 三类人群
 * ============================================================ */
function AudienceSection() {
  return (
    <section id="cases" className="py-24 bg-gray-50 border-y border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-50 border border-red-100 text-red-700 text-xs font-bold uppercase tracking-wider mb-4">
            适合谁用
          </div>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            三类人,解决<span className="text-gradient-red">同一个痛点</span>。
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <AudienceCard
            gradient="from-red-600 to-red-800"
            iconBg="bg-red-50"
            iconColor="text-red-700"
            Icon={Briefcase}
            title="接单个人"
            sub="追求单产利润与交付速度"
            pain="客户反复修改,返工吃掉利润"
            benefits={['大纲先发客户确认,再写正文', '多文件一次解析,省 80% 读题时间']}
            resultBg="bg-red-50/50"
            resultBorder="border-red-100"
            resultLabelColor="text-red-900"
            resultValueColor="text-red-700"
            resultLabel="典型效果"
            resultValue="月接单吞吐量 ×2.3"
          />
          <AudienceCard
            gradient="from-gray-800 to-black"
            iconBg="bg-gray-100"
            iconColor="text-gray-800"
            Icon={Users}
            title="小型工作室"
            sub="追求批量处理与交付标准"
            pain="写手水平不一,交稿质量起伏"
            benefits={['统一算法打磨,质量更可预期', '批量激活码充值,成本透明']}
            resultBg="bg-gray-50"
            resultBorder="border-gray-200"
            resultLabelColor="text-gray-700"
            resultValueColor="text-gray-900"
            resultLabel="典型效果"
            resultValue="客诉率 ↓ 52%"
            popular
          />
          <AudienceCard
            gradient="from-amber-500 to-amber-700"
            iconBg="bg-amber-50"
            iconColor="text-amber-700"
            Icon={GraduationCap}
            title="学生个人"
            sub="追求操作简单与结果靠谱"
            pain="复杂 Rubric 无从下手,缺少专业笔触"
            benefits={['上传 Syllabus 即自动开工', '算法对齐的学术笔触,放心提交']}
            resultBg="bg-amber-50/50"
            resultBorder="border-amber-100"
            resultLabelColor="text-amber-900"
            resultValueColor="text-amber-700"
            resultLabel="典型效果"
            resultValue="一稿通过率 >95%"
          />
        </div>
      </div>
    </section>
  );
}

type AudienceCardProps = {
  gradient: string;
  iconBg: string;
  iconColor: string;
  Icon: typeof Briefcase;
  title: string;
  sub: string;
  pain: string;
  benefits: string[];
  resultBg: string;
  resultBorder: string;
  resultLabelColor: string;
  resultValueColor: string;
  resultLabel: string;
  resultValue: string;
  popular?: boolean;
};

function AudienceCard({
  gradient,
  iconBg,
  iconColor,
  Icon,
  title,
  sub,
  pain,
  benefits,
  resultBg,
  resultBorder,
  resultLabelColor,
  resultValueColor,
  resultLabel,
  resultValue,
  popular,
}: AudienceCardProps) {
  return (
    <div className="bg-white rounded-3xl overflow-hidden border border-gray-200 card-lift shadow-sm relative">
      {popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 bg-amber-400 text-amber-950 text-[10px] font-black px-3 py-1 rounded-full shadow-lg whitespace-nowrap">
          最受欢迎
        </div>
      )}
      <div className={`h-2 bg-gradient-to-r ${gradient}`} />
      <div className="p-8">
        <div className={`w-14 h-14 rounded-2xl ${iconBg} flex items-center justify-center mb-5`}>
          <Icon className={`w-7 h-7 ${iconColor}`} />
        </div>
        <h3 className="text-2xl font-bold mb-2">{title}</h3>
        <p className="text-sm text-gray-500 mb-5">{sub}</p>
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <span className="text-sm text-gray-700">{pain}</span>
          </div>
          {benefits.map((b) => (
            <div key={b} className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <span className="text-sm text-gray-700">{b}</span>
            </div>
          ))}
        </div>
        <div className={`mt-6 p-4 ${resultBg} border ${resultBorder} rounded-xl`}>
          <div className={`text-xs font-semibold ${resultLabelColor}`}>{resultLabel}</div>
          <div className={`text-lg font-black ${resultValueColor}`}>{resultValue}</div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * Features — 功能一览
 * ============================================================ */
function FeaturesSection() {
  const features = [
    {
      Icon: FileText,
      title: '多文件上传深度分析',
      desc: 'Rubric、Syllabus、Reading 一次性拖入,多模态引擎精准提取核心得分点。',
      tag: '核心',
      primary: true,
    },
    {
      Icon: Settings2,
      title: '自动提取写作要求',
      desc: '字数、格式、引用风格、章节数自动识别,转化为硬性约束指导生成。',
      tag: '效率',
    },
    {
      Icon: LayoutTemplate,
      title: '英文大纲先确认',
      desc: '先出大纲再写正文,可发客户确认,从根本上杜绝结构返工。',
      tag: '核心',
      primary: true,
    },
    {
      Icon: PenLine,
      title: '完整英文正文生成',
      desc: '基于确认大纲,生成逻辑严密、语言地道的学术英文正文。',
      tag: '能力',
    },
    {
      Icon: FileCheck2,
      title: '真实文献 + 核验报告',
      desc: '接入 Crossref 等学术网络,每条引用有迹可循,附独立 PDF 报告。',
      tag: '核心',
      primary: true,
    },
    {
      Icon: Bot,
      title: '算法多轮打磨',
      desc: 'Academic-RLHF™ 对学术语感做多轮复扫,未达标自动重写,直至笔触自然。',
      tag: '核心',
      primary: true,
    },
    {
      Icon: MessageCircle,
      title: '人工客服兜底',
      desc: '遇到系统处理不了的复杂任务,随时联系客服协助排查。',
      tag: '服务',
    },
    {
      Icon: RefreshCw,
      title: '失败全额退款',
      desc: 'API 异常、解析失败等场景系统自动全额退回积分,不丢钱。',
      tag: '安全',
    },
    {
      Icon: Download,
      title: '一键导出多格式',
      desc: '正文 DOCX + 引用 PDF,一键打包导出,直接发客户。',
      tag: '交付',
    },
  ];

  return (
    <section id="features" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-50 border border-red-100 text-red-700 text-xs font-bold uppercase tracking-wider mb-4">
            功能一览
          </div>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            一个平台,<span className="text-gradient-red">全流程闭环</span>。
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            从需求解析到最终交付,不用在几个工具之间来回切。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f) => (
            <div
              key={f.title}
              className="bg-gradient-to-br from-white to-gray-50 border border-gray-200 rounded-2xl p-6 card-lift"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="p-2.5 bg-red-50 text-red-700 rounded-xl">
                  <f.Icon className="w-6 h-6" />
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    f.primary ? 'bg-red-700 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {f.tag}
                </span>
              </div>
              <h3 className="text-lg font-bold mb-2">{f.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}


/* ============================================================
 * Pricing — 定价与充值
 * ============================================================ */
function PricingSection() {
  return (
    <section
      id="contact-sales"
      className="py-24 bg-gradient-to-br from-red-700 via-red-800 to-red-950 text-white relative overflow-hidden"
    >
      <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-[500px] h-[500px] bg-amber-400 opacity-10 blur-[120px] rounded-full" />
      <div className="absolute top-1/2 right-1/4 -translate-y-1/2 w-[500px] h-[500px] bg-red-500 opacity-20 blur-[120px] rounded-full" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-white text-xs font-bold uppercase tracking-wider mb-4">
            充值与价格
          </div>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            按字计费,<span className="text-amber-300">透明到小数点</span>。
          </h2>
          <p className="text-lg text-red-100 max-w-2xl mx-auto">
            激活码充值,不绑卡,额度不过期。失败自动全额退款。
          </p>
        </div>

        {/* Per-feature pricing */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-5xl mx-auto mb-16">
          <PriceTile Icon={PenLine} value="0.1" label="正文生成" />
          <PriceTile Icon={Sparkles} value="0.4" label="算法深度打磨" />
          <PriceTile Icon={Edit3} value="0.2" label="文章修改" />
          <PriceTile Icon={FileCheck2} value="0.1" label="文章评审" />
        </div>

        {/* Packages */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 max-w-5xl mx-auto mb-10">
          <PackageTile label="入门" credits="1,000" hint="约 10 篇 1000 字作业" />
          <PackageTile label="常用" credits="5,000" hint="约 50 篇 1000 字作业" />
          <PackageTile label="推荐" credits="10,000" hint="约 100 篇 1000 字作业" highlight />
          <PackageTile label="工作室" credits="20,000" hint="约 200 篇 1000 字作业" />
        </div>

        <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <div className="flex items-center gap-2 bg-white/10 backdrop-blur rounded-lg p-3 border border-white/10">
            <CheckCircle2 className="w-4 h-4 text-amber-300 flex-shrink-0" />
            <span className="text-sm">按需扣费,透明明细</span>
          </div>
          <div className="flex items-center gap-2 bg-white/10 backdrop-blur rounded-lg p-3 border border-white/10">
            <InfinityIcon className="w-4 h-4 text-amber-300 flex-shrink-0" />
            <span className="text-sm">额度长期有效,不过期</span>
          </div>
          <div className="flex items-center gap-2 bg-white/10 backdrop-blur rounded-lg p-3 border border-white/10">
            <RefreshCw className="w-4 h-4 text-amber-300 flex-shrink-0" />
            <span className="text-sm">失败自动全额退回</span>
          </div>
        </div>

        {/* Contact sales panel */}
        <div className="max-w-3xl mx-auto bg-white rounded-3xl p-8 md:p-10 shadow-2xl text-gray-900 relative">
          <div className="absolute -top-4 -right-4 bg-amber-400 text-amber-950 text-xs font-black px-3 py-1 rounded-full shadow-lg transform rotate-6">
            官方直营
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div>
              <h3 className="text-2xl font-black mb-3">购买激活码</h3>
              <p className="text-gray-600 mb-5 leading-relaxed">
                扫右侧二维码联系客服,按需购买激活码。登录后输入激活码即可完成充值,支持批量合作与长期采购优惠。
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-700">
                  <MessageCircle className="w-4 h-4 text-red-700" />
                  <span>扫码添加官方客服</span>
                </div>
                <div className="flex items-center gap-2 text-gray-700">
                  <Mail className="w-4 h-4 text-red-700" />
                  <span>联系邮箱详见客服面板</span>
                </div>
                <div className="flex items-center gap-2 text-gray-700">
                  <Clock className="w-4 h-4 text-red-700" />
                  <span>工作时间:9:00 - 22:00(全年无休)</span>
                </div>
              </div>
            </div>
            <CustomerSupportPanel
              note="支持批量合作、长期采购优惠。扫码添加客服后,可直接咨询充值和平台使用问题。"
              imageClassName="w-48 max-w-full rounded-2xl border border-gray-200 shadow-sm"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function PriceTile({
  Icon,
  value,
  label,
}: {
  Icon: typeof PenLine;
  value: string;
  label: string;
}) {
  return (
    <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-5 text-center hover:bg-white/15 transition-colors">
      <Icon className="w-7 h-7 text-amber-300 mx-auto mb-3" />
      <div className="text-3xl font-black mb-1">
        {value}
        <span className="text-base font-bold text-red-200 ml-1">/字</span>
      </div>
      <div className="text-xs text-red-200 font-semibold">{label}</div>
    </div>
  );
}

function PackageTile({
  label,
  credits,
  hint,
  highlight,
}: {
  label: string;
  credits: string;
  hint: string;
  highlight?: boolean;
}) {
  if (highlight) {
    return (
      <div className="bg-gradient-to-br from-amber-300 to-amber-500 rounded-2xl p-6 text-center text-amber-950 card-lift relative shadow-2xl shadow-amber-900/30">
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-950 text-amber-300 text-[10px] font-black px-3 py-1 rounded-full whitespace-nowrap">
          最受欢迎
        </div>
        <div className="text-xs font-bold text-amber-900 uppercase tracking-wider mb-2">{label}</div>
        <div className="text-4xl font-black mb-1">{credits}</div>
        <div className="text-xs text-amber-900 mb-4">积分</div>
        <div className="text-xs font-semibold">{hint}</div>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl p-6 text-center text-gray-900 card-lift">
      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{label}</div>
      <div className="text-4xl font-black text-red-700 mb-1">{credits}</div>
      <div className="text-xs text-gray-500 mb-4">积分</div>
      <div className="text-xs text-gray-600">{hint}</div>
    </div>
  );
}

/* ============================================================
 * FAQ
 * ============================================================ */
function FaqSection() {
  const faqs = [
    {
      q: '支持哪些文件格式?',
      a: '支持 txt、md、docx、pdf、ppt、pptx 等常见格式。多模态解析引擎可同时处理多份文件,自动提取 Rubric、Syllabus、Reading Materials 的核心得分点。',
      open: true,
    },
    {
      q: '大纲先行怎么操作?',
      a: '上传任务要求后,系统先输出英文大纲。你可以自己改,也可以发客户确认。大纲锁定后才开始生成正文,根本不会出现"结构不对"返工。',
    },
    {
      q: '如何保证语感自然、质量稳定?',
      a: '正文生成后自动进入多轮算法打磨,由 Academic-RLHF™ 模块对学术语感、句式节奏、专业术语做反复校准。未达标则自动重写,直至笔触自然稳定,不额外收费。',
    },
    {
      q: '文献真实吗?格式对吗?',
      a: '引用格式按任务文件提取,默认 APA 7。每 1000 字至少 5 条引用,优先用 2020 年以后的学术论文,不用 book。最终交付附独立 PDF 核验报告,每条引用的数量、年份、类型、DOI 验证结果一目了然。',
    },
    {
      q: '各项功能是怎么收费的?',
      a: `按字精确计费,不足一字按一字向上取整:
• 正文生成:0.1 积分/字
• 算法深度打磨:0.4 积分/字
• 文章修改:0.2 积分/字
• 文章评审:0.1 积分/字

汉字按字、英文按词。失败场景(API 超时、解析失败等)系统自动全额退款。`,
    },
    {
      q: '怎么充值?',
      a: '激活码充值模式,不绑卡。联系客服购买后,在工作台输入激活码即可充值。同一账号可多次兑换,额度叠加、长期有效。',
    },
  ];

  return (
    <section id="faq" className="py-24 bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-50 border border-red-100 text-red-700 text-xs font-bold uppercase tracking-wider mb-4">
            常见问题
          </div>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">还有疑问?</h2>
        </div>

        <div className="space-y-3">
          {faqs.map((faq) => (
            <details
              key={faq.q}
              className="group bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden"
              {...(faq.open ? { open: true } : {})}
            >
              <summary className="flex items-center justify-between p-5 cursor-pointer list-none hover:bg-gray-50">
                <span className="font-bold text-gray-900 flex items-center gap-2">
                  <span className="text-red-700">Q:</span>
                  {faq.q}
                </span>
                <ChevronDown className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-5 pb-5 text-sm text-gray-600 leading-relaxed whitespace-pre-line">
                {faq.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * Final CTA
 * ============================================================ */
function FinalCtaSection() {
  return (
    <section className="py-20 bg-gray-950 text-white relative overflow-hidden">
      <div className="absolute inset-0 dark-grid-bg" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-red-700 opacity-20 blur-[120px] rounded-full" />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative">
        <h2 className="text-4xl md:text-6xl font-black tracking-tight mb-6">
          交付学术写作
          <br />
          该有的样子。
        </h2>
        <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
          独家 Academic-RLHF™ 算法打磨的专业笔触,可核验的真实文献,大纲先行不走回头路。一次体验,胜过千言万语。
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-base font-bold px-8 py-4 rounded-xl shadow-xl shadow-red-900/50 transition-all hover:scale-[1.02]"
          >
            开启专业写作 <ArrowRight className="w-5 h-5" />
          </Link>
          <a
            href="#contact-sales"
            className="inline-flex items-center gap-2 text-gray-300 hover:text-white text-base font-semibold px-6 py-4 border border-gray-700 rounded-xl hover:border-gray-500 transition-colors"
          >
            <MessageCircle className="w-5 h-5" /> 联系销售
          </a>
        </div>
      </div>
    </section>
  );
}
